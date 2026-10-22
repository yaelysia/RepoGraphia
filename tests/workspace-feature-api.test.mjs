import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { analyze } from '../dist/analyze.js';
import { ContinuousWorkspace } from '../dist/workspace.js';
import { startWorkspaceServer } from '../dist/workspace-server.js';
import { featureRevisionHeader } from '../dist/feature-tasks.js';

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'repographia-feature-api-'));
  const root = path.join(directory, 'project'); fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'tsconfig.json'), '{"compilerOptions":{"noLib":true},"include":["*.ts"]}');
  const source = path.join(root, 'main.ts');
  fs.writeFileSync(source, 'export function run(enabled: boolean) { if (!enabled) return 0; return 1; }\n');
  const workspace = new ContinuousWorkspace({ root, directory: path.join(directory, 'workspace'), watch: false, reconcileMs: 0 }, {
    analyze: async root => { let inputs; const graph = analyze(root, { includeSource: true, onInputs: value => { inputs = value; } }); return { graph, inputs }; },
  });
  await workspace.refresh(true);
  const app = await startWorkspaceServer(workspace, { start: false });
  t.after(async () => { await app.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const request = (route, body, method = body ? 'POST' : 'GET') => fetch(app.origin + route, {
    method, headers: { 'X-RepoGraphia-Token': app.token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const baseline = () => ({ expectedSnapshot: workspace.state().latestSnapshot, expectedFeatureDigest: workspace.featureDigest });
  const prepare = async () => {
    const response = await request('/api/feature-tasks', { kind: 'overview', goal: 'Explain the guarded return.', ...baseline() });
    assert.equal(response.status, 201); const { task } = await response.json();
    const bundleResponse = await request(`/api/feature-tasks/${task.id}/bundle`); assert.equal(bundleResponse.status, 200);
    assert.match(bundleResponse.headers.get('content-disposition'), /attachment/);
    return { task, bundle: await bundleResponse.json() };
  };
  const proposal = bundle => {
    const node = bundle.graph.nodes.find(node => node.name === 'run');
    return { ...featureRevisionHeader(bundle), batchId: 'api-batch', summary: 'Describe the guarded return without an execution claim.',
      features: [{ action: 'add', feature: { id: 'guard', title: '条件返回', summary: '启用时返回 1，未启用时返回 0。', description: '只解释这个源码入口的条件和返回值。', questions: [] }, reason: 'Record the exact conditional behavior.' }],
      mappings: [{ action: 'add', id: 'guard-entry', featureId: 'guard', nodeId: node.id, role: 'entry', rationale: 'This declaration contains the guard and return.', relationIds: [], reason: 'Use the exact source entity.' }],
      retractions: [], checks: [
        { featureId: 'guard', nodeId: node.id, kind: 'support', quote: 'return 1;', explanation: 'The normal enabled path returns this value.' },
        { featureId: 'guard', nodeId: node.id, kind: 'limit', quote: 'if (!enabled) return 0;', explanation: 'Disabled input exits early.' },
      ], exploredFiles: ['main.ts'], unexplored: ['Callers and runtime inputs have not been checked.'] };
  };
  return { workspace, app, request, baseline, prepare, proposal, source };
}

test('feature APIs authenticate frozen tasks, preview proposals, and atomically apply without accepting mappings', async t => {
  const { workspace, app, request, baseline, prepare, proposal } = await fixture(t);
  for (const route of ['/api/feature-work', '/api/feature-tasks', '/api/feature-proposals'])
    assert.equal((await fetch(app.origin + route)).status, 401);
  const script = await fetch(app.origin + '/workspace-analysis.js');
  assert.equal(script.status, 200); assert.equal(script.headers.get('cache-control'), 'no-store');
  assert.match(script.headers.get('content-type'), /javascript/); assert.doesNotMatch(await script.text(), new RegExp(app.token));
  assert.equal((await request('/api/feature-tasks', { kind: 'overview', goal: 'Untrusted scope', ...baseline(), allowed: { files: ['outside.ts'] } })).status, 400);
  const { task, bundle } = await prepare(), before = baseline(), revision = proposal(bundle);
  assert.deepEqual(await (await request(`/api/feature-tasks/${task.id}/bundle`)).json(), bundle);
  assert.equal((await request('/api/feature-proposals', { proposal: { ...revision, taskDigest: '0'.repeat(64) }, author: 'Agent' })).status, 409);
  assert.equal((await request('/api/feature-proposals', { proposal: { ...revision, accepted: true }, author: 'Agent' })).status, 400);
  const imported = await request('/api/feature-proposals', { proposal: revision, author: 'Agent' }); assert.equal(imported.status, 201);
  const { proposal: metadata } = await imported.json();
  const detail = await (await request(`/api/feature-proposals/${metadata.id}`)).json();
  assert.equal(detail.review.status, 'ready'); assert.equal(detail.review.document, undefined);
  assert.equal(detail.review.changes.find(change => change.kind === 'mapping').after.decision, 'proposed');
  assert.equal(workspace.featureDigest, before.expectedFeatureDigest, 'import/read do not apply');
  const route = `/api/feature-proposals/${metadata.id}/decision`;
  const decision = { decision: 'apply', actor: 'Human', reason: 'Read the batch and apply for mapping review.', ...before };
  assert.equal((await request(route, { ...decision, expectedFeatureDigest: '0'.repeat(64) })).status, 409);
  assert.equal(workspace.featureProposal(metadata.id).metadata.status, 'pending');
  const response = await request(route, decision); assert.equal(response.status, 200);
  const applied = await response.json(); assert.equal(applied.proposal.status, 'applied'); assert.equal(applied.feature.digest, workspace.featureDigest);
  assert.equal(workspace.getFeatures().mappings[0].decision, 'proposed');
  assert.equal(workspace.getFeatures(before.expectedFeatureDigest).features.length, 0);
  assert.equal(workspace.getFeatures().history.at(-1).actorKind, 'manual');
  assert.equal((await request(route, decision)).status, 409);
  const work = await (await request('/api/feature-work')).json();
  assert.equal(work.exploration.files[0].status, 'declared'); assert.equal(work.references.summary.matched, 1);
  assert.ok(work.coverage); assert.equal(work.proposals[0].status, 'applied');
});

test('late revision API keeps original evidence readable and rejects the batch without changing current annotations', async t => {
  const { workspace, request, baseline, prepare, proposal, source } = await fixture(t);
  const { task, bundle } = await prepare(), revision = proposal(bundle), first = baseline();
  fs.writeFileSync(source, 'export function run(enabled: boolean) { if (!enabled) return 0; return 2; }\n');
  await workspace.refresh();
  const imported = await request('/api/feature-proposals', { proposal: revision, author: 'Agent' }); assert.equal(imported.status, 201);
  const { proposal: metadata } = await imported.json(), detail = await (await request(`/api/feature-proposals/${metadata.id}`)).json();
  assert.equal(detail.review.status, 'stale'); assert.ok(detail.review.reasons.includes('snapshot-conflict'));
  assert.equal(detail.task.basis.snapshot, first.expectedSnapshot); assert.equal(detail.review.checks[0].quote, 'return 1;');
  assert.deepEqual(await (await request(`/api/feature-tasks/${task.id}/bundle`)).json(), bundle);
  const digest = workspace.featureDigest, route = `/api/feature-proposals/${metadata.id}/decision`;
  assert.equal((await request(route, { decision: 'apply', actor: 'Human', reason: 'Old task must not overwrite current code.', ...baseline() })).status, 409);
  const refused = await request(route, { decision: 'reject', actor: 'Human', reason: 'Prepare a new task for current code.', ...first });
  assert.equal(refused.status, 200); assert.equal((await refused.json()).proposal.status, 'rejected'); assert.equal(workspace.featureDigest, digest);
  const work = await (await request('/api/feature-work')).json(); assert.equal(work.exploration.files[0].status, 'unexplored');
  assert.equal(workspace.getFeatures().features.length, 0);
});
