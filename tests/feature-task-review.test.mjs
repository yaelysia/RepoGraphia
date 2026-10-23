import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyze } from '../dist/analyze.js';
import { createFeatureMapApi } from '../dist/feature-map.js';
import { createFeatureTask, featureRevisionHeader, checkFeatureRevision } from '../dist/feature-tasks.js';

const api = createFeatureMapApi(), at = '2026-10-23T00:00:00Z';
function fixture(t, decision = 'accepted') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repographia-task-review-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noLib: true }, include: ['*.ts'] }));
  fs.writeFileSync(path.join(root, 'main.ts'), 'export function alpha() { return 1; }\n');
  fs.writeFileSync(path.join(root, 'other.ts'), 'export const unrelated = 1;\n');
  const before = analyze(root, { includeSource: true }), original = before.nodes.find(node => node.name === 'alpha');
  const edit = (map, operation) => api.edit(before, map, operation, {
    expectedRevision: map.revision, actor: 'fixture reviewer', actorKind: 'manual', at, reason: 'Explicit fixture decision.',
  });
  let map = edit(api.create(before), { op: 'feature', feature: {
    id: 'capability', title: 'Capability', description: 'An explicitly authored fixture capability.', questions: [],
  } });
  map = edit(map, { op: 'mapping', id: 'old-alpha', featureId: 'capability', nodeId: original.id,
    role: 'implementation', rationale: 'The original alpha declaration.', relationIds: [] });
  map = edit(map, { op: 'review', id: 'old-alpha', decision });
  return { root, before, original, map };
}
const task = (graph, map) => createFeatureTask(graph, map, 'changes', 'Review the explicitly selected current declaration.', {
  files: ['main.ts'], featureIds: ['capability'], mappingIds: ['old-alpha'], newFeatures: false, parentId: null,
}, at);
const addition = (bundle, node) => ({
  ...featureRevisionHeader(bundle), batchId: 'review-batch', summary: 'An explicit current source association.', features: [],
  mappings: [{ action: 'add', id: 'new-current', featureId: 'capability', nodeId: node.id, role: 'implementation',
    rationale: 'The exact current declaration.', relationIds: [], reason: 'Associate the explicitly inspected declaration.' }],
  retractions: [], checks: [
    { featureId: 'capability', nodeId: node.id, kind: 'support', quote: node.name === 'bravo' ? 'return 2;' : 'return 1;',
      explanation: 'The source returns this literal.' },
    { featureId: 'capability', nodeId: node.id, kind: 'limit', quote: `function ${node.name}()`,
      explanation: 'This declaration has no input parameter.' },
  ], exploredFiles: ['main.ts'], unexplored: [],
});

test('cross-snapshot node ID collisions do not prohibit an explicit new mapping to different current source', t => {
  const { root, before, original, map } = fixture(t);
  fs.writeFileSync(path.join(root, 'main.ts'), 'export function bravo() { return 2; }\n');
  const current = analyze(root, { includeSource: true }), node = current.nodes.find(item => item.name === 'bravo');
  assert.notEqual(current.project.snapshot, before.project.snapshot);
  assert.equal(node.id, original.id, 'The analyzer hashes the same file/kind/range into an equal snapshot-local ID.');
  assert.notEqual(current.files.find(file => file.path === 'main.ts').hash, map.mappings[0].code.fileHash);
  const bundle = task(current, map), proposal = addition(bundle, node);
  proposal.retractions.push({ mappingId: 'old-alpha', reason: 'The former alpha declaration is no longer the current implementation.' });
  const beforeInputs = JSON.stringify([bundle, proposal, map]);
  const result = checkFeatureRevision(bundle, proposal, 'fixture agent', at);
  assert.equal(JSON.stringify([bundle, proposal, map]), beforeInputs);
  const previous = result.document.mappings.find(mapping => mapping.id === 'old-alpha');
  assert.deepEqual(previous.code, map.mappings[0].code);
  assert.equal(previous.basis.snapshot, before.project.snapshot); assert.equal(previous.decision, 'rejected');
  const added = result.document.mappings.find(mapping => mapping.id === 'new-current');
  assert.equal(added.code.name, 'bravo'); assert.equal(added.basis.snapshot, current.project.snapshot);
  assert.equal(added.decision, 'proposed');
  assert.equal(api.assess(current, result.document).mappings.find(row => row.mapping.id === added.id).current, true);
});

test('a new ID cannot revive an exactly rejected feature/code pair in its original snapshot', t => {
  const { before, original, map } = fixture(t, 'rejected'), bundle = task(before, map), proposal = addition(bundle, original);
  const saved = JSON.stringify([bundle, proposal, map]);
  assert.throws(() => checkFeatureRevision(bundle, proposal, 'fixture agent', at), /including rejected records/);
  assert.equal(JSON.stringify([bundle, proposal, map]), saved);
});

test('an unrelated snapshot change cannot bypass an old rejection of the same exact source anchor', t => {
  const { root, before, original, map } = fixture(t, 'rejected');
  fs.writeFileSync(path.join(root, 'other.ts'), 'export const unrelated = 2;\n');
  const current = analyze(root, { includeSource: true }), node = current.nodes.find(item => item.name === 'alpha');
  assert.notEqual(current.project.snapshot, before.project.snapshot); assert.equal(node.id, original.id);
  assert.equal(current.files.find(file => file.path === 'main.ts').hash, map.mappings[0].code.fileHash);
  const bundle = task(current, map);
  assert.throws(() => checkFeatureRevision(bundle, addition(bundle, node), 'fixture agent', at), /including rejected records/);
});
