import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyze } from '../dist/analyze.js';
import { createFeatureMapApi } from '../dist/feature-map.js';
import { checkFeatureReferences } from '../dist/feature-references.js';
import { renderHtml } from '../dist/report.js';

const api = createFeatureMapApi();
const jsonBlock = (html, id) => {
  const match = html.match(new RegExp('<script id="' + id + '" type="application/json">([\\s\\S]*?)</script>'));
  assert.ok(match, 'Missing inert JSON block: ' + id);
  return JSON.parse(match[1]);
};
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repographia-reference-report-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'tsconfig.json'), '{"compilerOptions":{"noLib":true},"include":["*.ts"]}');
  fs.writeFileSync(path.join(root, 'a-other.ts'), 'export function other() { return 0; }\n');
  fs.writeFileSync(path.join(root, 'b-entry.ts'), 'export function entry() { return 1; }\n');
  const capture = () => {
    let inputs;
    const graph = analyze(root, { includeSource: true, onInputs: value => { inputs = value; } });
    return { graph, inputs };
  };
  const before = capture();
  const edit = (map, operation) => api.edit(before.graph, map, operation, { expectedRevision: map.revision,
    actor: 'report fixture', actorKind: 'manual', at: '2026-10-23T00:00:00Z', reason: 'Fixture annotation, not human acceptance.' });
  let map = edit(api.create(before.graph), { op: 'feature', feature: { id: 'f-entry', title: 'Read the return',
    summary: 'A bounded source explanation.', description: 'No runtime behavior is asserted.', questions: [] } });
  map = edit(map, { op: 'mapping', id: 'm-entry', featureId: 'f-entry',
    nodeId: before.graph.nodes.find(node => node.name === 'entry').id, role: 'implementation',
    rationale: 'The exact declaration contains the return.', relationIds: [] });
  fs.appendFileSync(path.join(root, 'a-other.ts'), 'other();\n');
  const after = capture(), references = checkFeatureReferences(after, map, new Map([[before.graph.project.snapshot, before]]));
  assert.equal(references.summary.matched, 1);
  assert.equal(api.assess(after.graph, map).summary.stale, 1);
  return { graph: after.graph, map, references };
}

test('pinned reference reports survive HTML export separately from unchanged strict annotation assessment', t => {
  const { graph, map, references } = fixture(t), original = structuredClone({ graph, map, references });
  const html = renderHtml(graph, map, { featureReferences: references });
  assert.deepEqual(jsonBlock(html, 'feature-reference-data'), references);
  assert.deepEqual(jsonBlock(html, 'feature-data'), map);
  assert.deepEqual(jsonBlock(html, 'graph-data'), graph);
  assert.deepEqual({ graph, map, references }, original);
  assert.equal(api.assess(graph, map).summary.stale, 1, 'Export must not relax legacy assessment or migrate anchors.');
  assert.doesNotMatch(html, /id="workspace-data"|function createWorkspaceBridge/);
  assert.match(html, /connect-src 'none'/);
  const legacy = renderHtml(graph, map);
  assert.doesNotMatch(legacy, /id="feature-reference-data"/);
  assert.deepEqual(jsonBlock(legacy, 'feature-data'), map);
});

test('HTML rendering rejects reference reports belonging to another graph, annotation or protocol', t => {
  const { graph, map, references } = fixture(t);
  for (const change of [
    report => { report.snapshot = '0'.repeat(64); },
    report => { report.featureDigest = '0'.repeat(64); },
    report => { report.revision++; },
    report => { report.referenceVersion = 2; },
    report => { report.mappings[0].featureId = 'foreign-feature'; },
    report => { report.mappings[0].current.nodeId = 'foreign-node'; },
    report => { report.mappings[0].current.nodeId = graph.nodes.find(node => node.name === 'other').id; },
    report => { report.mappings[0].status = 'needs-review'; },
    report => { report.mappings.push(structuredClone(report.mappings[0])); },
  ]) {
    const invalid = structuredClone(references); change(invalid);
    assert.throws(() => renderHtml(graph, map, { featureReferences: invalid }));
  }
  assert.throws(() => renderHtml(graph, undefined, { featureReferences: references }));
  const changed = structuredClone(map); changed.features[0].description = 'Different content at the same document revision.';
  assert.throws(() => renderHtml(graph, changed, { featureReferences: references }));
});

test('exported reference strings stay inert and cannot break out of their JSON block', t => {
  const { graph, map, references } = fixture(t);
  const payload = '</script><script id="unexpected-executable">globalThis.referenceInjection = true</script>&\u2028\u2029';
  references.limitations.push(payload);
  const html = renderHtml(graph, map, { featureReferences: references });
  assert.deepEqual(jsonBlock(html, 'feature-reference-data'), references);
  assert.doesNotMatch(html, /<script id="unexpected-executable">/);
});
