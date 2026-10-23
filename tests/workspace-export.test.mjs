import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyze } from '../dist/analyze.js';
import { createFeatureMapApi } from '../dist/feature-map.js';
import { ContinuousWorkspace } from '../dist/workspace.js';
import { startWorkspaceServer } from '../dist/workspace-server.js';

const api = createFeatureMapApi();
const jsonBlock = (html, id) => {
  const match = html.match(new RegExp('<script id="' + id + '" type="application/json">([\\s\\S]*?)</script>'));
  assert.ok(match, 'Missing inert JSON block: ' + id);
  return JSON.parse(match[1]);
};
async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'repographia-workspace-export-'));
  const root = path.join(directory, 'project'); fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
    noLib: true, module: 'ESNext', moduleResolution: 'Bundler' }, include: ['*.ts'] }));
  const sources = {
    'a-other.ts': 'export function other() { return 0; }\n',
    'b-leaf.ts': 'export function leaf() { return 1; }\n',
    'c-entry.ts': "import { leaf } from './b-leaf';\nexport function entry() { return leaf(); }\n",
  };
  for (const [name, source] of Object.entries(sources)) fs.writeFileSync(path.join(root, name), source);
  const workspace = new ContinuousWorkspace({ root, directory: path.join(directory, 'workspace'), watch: false, reconcileMs: 0 }, {
    analyze: async root => {
      let inputs;
      const graph = analyze(root, { includeSource: true, onInputs: value => { inputs = value; } });
      return { graph, inputs };
    },
  });
  let app;
  t.after(async () => { if (app) await app.close(); else await workspace.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  await workspace.refresh(true);
  const before = workspace.getGraph(workspace.state().latestSnapshot);
  const edit = (map, operation) => api.edit(before, map, operation, { expectedRevision: map.revision,
    actor: 'export fixture', actorKind: 'manual', at: '2026-10-23T00:00:00Z', reason: 'Explicit fixture history.' });
  let map = edit(workspace.getFeatures(), { op: 'feature', feature: { id: 'f-main', title: 'Original explanation',
    summary: 'Read fixed source references.', description: 'A finite source explanation with no execution promise.', questions: ['Runtime behavior is not verified.'] } });
  for (const [name, decision] of [['entry', 'proposed'], ['leaf', 'accepted'], ['other', 'rejected']]) {
    const node = before.nodes.find(node => node.name === name && node.kind === 'function');
    map = edit(map, { op: 'mapping', id: 'm-' + name, featureId: 'f-main', nodeId: node.id,
      role: 'implementation', rationale: 'Exact declaration fixture.', relationIds: before.relations.filter(edge => edge.from === node.id).map(edge => edge.id) });
    if (decision !== 'proposed') map = edit(map, { op: 'review', id: 'm-' + name, decision });
  }
  workspace.saveFeatures(map, workspace.featureDigest);
  app = await startWorkspaceServer(workspace, { start: false });
  const request = route => fetch(app.origin + route, { headers: { 'X-RepoGraphia-Token': app.token } });
  const exported = async (snapshot, featureDigest) => {
    const query = new URLSearchParams();
    if (snapshot !== undefined) query.set('snapshot', snapshot);
    if (featureDigest !== undefined) query.set('featureDigest', featureDigest);
    const response = await request('/api/export?' + query);
    assert.equal(response.status, 200, await response.clone().text());
    assert.match(response.headers.get('content-disposition'), /attachment; filename="repographia-/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return response.text();
  };
  return { root, workspace, app, before, map, edit, exported, request };
}

test('workspace offline export carries exact current reference checks across unrelated changes and real relation ID churn', async t => {
  const { root, workspace, app, before, map, exported } = await fixture(t);
  const original = structuredClone(map), digest = workspace.featureDigest;
  fs.appendFileSync(path.join(root, 'a-other.ts'), 'other();\n');
  await workspace.refresh();
  const snapshot = workspace.state().latestSnapshot, graph = workspace.getGraph(snapshot);
  assert.notEqual(snapshot, before.project.snapshot);
  const relation = graph.relations.find(edge => edge.targetLabel === 'leaf' && edge.kind === 'call');
  assert.notEqual(relation.id, map.mappings.find(mapping => mapping.id === 'm-entry').evidence[0].relationId,
    'The fixture must exercise actual relation ID churn, not just a different snapshot string.');
  const references = workspace.featureWork(snapshot, digest).references;
  assert.equal(references.summary.matched, 2);
  assert.equal(references.summary.needsReview, 1);
  assert.equal(references.mappings.find(row => row.id === 'm-entry').current.relationIds[0], relation.id);
  const html = await exported();
  assert.deepEqual(jsonBlock(html, 'feature-reference-data'), references);
  assert.deepEqual(jsonBlock(html, 'feature-data'), original);
  assert.deepEqual(jsonBlock(html, 'graph-data'), graph);
  assert.equal(api.assess(graph, original).summary.stale, 3);
  assert.deepEqual(workspace.getFeatures(), original);
  assert.equal(workspace.featureDigest, digest);
  assert.match(html, /connect-src 'none'/);
  assert.doesNotMatch(html, /id="workspace-data"|function createWorkspaceBridge/);
  assert.ok(!html.includes(app.token)); assert.ok(!html.includes(app.origin));
});

test('offline export preserves changed, unmatched and unavailable references instead of promoting them to matched', async t => {
  const { root, workspace, map, exported } = await fixture(t);
  const unavailable = structuredClone(map);
  unavailable.mappings.find(mapping => mapping.id === 'm-other').basis.snapshot = 'a'.repeat(64);
  workspace.saveFeatures(unavailable, workspace.featureDigest);
  fs.appendFileSync(path.join(root, 'c-entry.ts'), '// saved change requires review\n');
  fs.unlinkSync(path.join(root, 'b-leaf.ts'));
  await workspace.refresh();
  const expected = workspace.featureWork().references;
  assert.equal(expected.mappings.find(row => row.id === 'm-entry').status, 'needs-review');
  assert.equal(expected.mappings.find(row => row.id === 'm-leaf').status, 'unmatched');
  assert.equal(expected.mappings.find(row => row.id === 'm-other').status, 'unverified');
  assert.equal(expected.summary.matched, 0);
  const html = await exported();
  assert.deepEqual(jsonBlock(html, 'feature-reference-data'), expected);
  assert.deepEqual(jsonBlock(html, 'feature-data'), unavailable);
  assert.ok(expected.mappings.every(row => row.current === undefined));
});

test('offline exports honor explicitly selected historical code and annotation versions independently of the current head', async t => {
  const { root, workspace, before, map, edit, exported } = await fixture(t);
  const firstDigest = workspace.featureDigest;
  const changed = edit(map, { op: 'feature', feature: { ...map.features[0], title: 'Later explanation' } });
  workspace.saveFeatures(changed, firstDigest);
  const latestDigest = workspace.featureDigest;
  fs.appendFileSync(path.join(root, 'a-other.ts'), 'other();\n'); await workspace.refresh();
  const latestSnapshot = workspace.state().latestSnapshot;
  for (const snapshot of [before.project.snapshot, latestSnapshot]) {
    const html = await exported(snapshot, firstDigest);
    assert.deepEqual(jsonBlock(html, 'feature-reference-data'), workspace.featureWork(snapshot, firstDigest).references);
    assert.deepEqual(jsonBlock(html, 'feature-data'), map);
    assert.equal(jsonBlock(html, 'graph-data').project.snapshot, snapshot);
  }
  const current = await exported();
  assert.equal(jsonBlock(current, 'feature-reference-data').featureDigest, latestDigest);
  assert.deepEqual(jsonBlock(current, 'feature-data'), changed);
  assert.equal(workspace.featureDigest, latestDigest);
});

test('explicit annotation-free offline export stays valid and contains no inherited reference report', async t => {
  const { workspace, exported, request } = await fixture(t);
  const html = await exported(workspace.state().latestSnapshot, 'none');
  assert.equal(jsonBlock(html, 'feature-data'), null);
  assert.doesNotMatch(html, /id="feature-reference-data"|id="workspace-data"/);
  assert.match(html, /connect-src 'none'/);
  assert.equal((await request('/api/export?featureDigest=' + '0'.repeat(64))).status, 404);
});
