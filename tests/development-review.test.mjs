import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { analyze } from '../dist/analyze.js';
import { createFeatureMapApi } from '../dist/feature-map.js';
import { compareDevelopmentReview, developmentReviewDigest } from '../dist/development-review.js';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'repographia-development-review-'));
after(() => fs.rmSync(directory, { recursive: true, force: true }));
const api = createFeatureMapApi(), clone = structuredClone;
const hash = value => createHash('sha256').update(value).digest('hex');
const digest = value => hash(JSON.stringify(value));
let serial = 0;
const source = {
  'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler',
    strict: true, types: [] }, include: ['*.ts'] }),
  'a-unrelated.ts': 'export function unrelated() { return 3; }\n',
  'b-leaf.ts': 'export function leaf() { return 1; }\n',
  'c-entry.ts': "import { leaf } from './b-leaf';\nexport function entry() { return leaf(); }\n",
};
function write(root, file, text) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text);
}
function capture(root) {
  let inputs;
  const graph = analyze(root, { includeSource: true, onInputs: value => { inputs = value; } });
  return { graph, inputs };
}
function fixture(files = source) {
  const root = path.join(directory, String(++serial)); fs.mkdirSync(root);
  for (const [file, text] of Object.entries(files)) write(root, file, text);
  return { root, before: capture(root) };
}
const context = map => ({ expectedRevision: map.revision, actor: 'fixture reviewer', actorKind: 'manual',
  at: '2026-10-23T00:00:00Z', reason: 'Synthetic fixture operation, not user acceptance.' });
const node = (version, name, kind = 'function') => version.graph.nodes.find(item => item.name === name && item.kind === kind);
function feature(version, map, id, extra = {}) {
  return api.edit(version.graph, map, { op: 'feature', feature: { id, title: id,
    summary: 'One sentence for ' + id, description: 'Fixture explanation for ' + id, questions: [], ...extra } }, context(map));
}
function mapping(version, map, featureId, target, id = featureId + '-map') {
  return api.edit(version.graph, map, { op: 'mapping', id, featureId, nodeId: target.id,
    role: 'implementation', rationale: 'Explicit fixture source.',
    relationIds: version.graph.relations.filter(edge => edge.from === target.id).map(edge => edge.id) }, context(map));
}
function document(version, names = ['entry']) {
  let map = api.create(version.graph);
  for (const name of names) { map = feature(version, map, name); map = mapping(version, map, name, node(version, name)); }
  return map;
}
const decide = (version, map, id, decision) => api.edit(version.graph, map, { op: 'review', id, decision }, context(map));
const task = ids => ({ id: 'test-round', title: 'Improve declared behavior', ...(ids === undefined ? {} : {
  intent: { goal: 'Check the selected capability', author: 'fixture user', source: 'manual', featureIds: ids,
    checks: [{ id: 'check-one', text: 'The expected behavior is explicitly verified.' }] } }) });
function report(before, after, beforeMap, afterMap = beforeMap, ids, history = []) {
  return compareDevelopmentReview({ task: task(ids), before: { ...before, features: beforeMap },
    after: { ...after, features: afterMap }, history: new Map(history.map(version => [version.graph.project.snapshot, version])) });
}
const row = (result, id = 'entry') => result.features.find(feature => feature.id === id);

test('unchanged fixed versions retain declared targets without claiming completion or mutation', () => {
  const { before } = fixture(), map = document(before), original = JSON.stringify({ before, map });
  const result = report(before, before, map, map, ['entry']);
  assert.equal(result.reviewVersion, 1); assert.equal(result.before.snapshot, before.graph.project.snapshot);
  assert.equal(result.before.featureDigest, digest(api.validate(map))); assert.equal(result.after.featureRevision, map.revision);
  assert.equal(row(result).scope, 'declared'); assert.equal(row(result).affected, false);
  assert.equal(result.summary.declaredWithoutObservedChanges, 1); assert.equal(result.summary.changedFiles, 0);
  assert.equal(result.summary.newlyPendingReferences, 0); assert.deepEqual(result.unassigned, []);
  assert.equal('completed' in result, false); assert.equal('testPassed' in result, false);
  assert.equal(JSON.stringify({ before, map }), original);
});

test('a changed mapped implementation exposes fixed code, original checks and outside-declared records', () => {
  const { root, before } = fixture(), map = document(before, ['entry', 'leaf']);
  write(root, 'b-leaf.ts', source['b-leaf.ts'].replace('return 1', 'return 2'));
  const current = capture(root), result = report(before, current, map, map, ['entry']);
  assert.equal(row(result, 'leaf').scope, 'outside-declared'); assert.equal(result.summary.outsideDeclaredFeatures, 1);
  assert.equal(row(result).referenceChanges[0].kind, 'newly-pending');
  assert.ok(row(result).referenceChanges[0].after.reasons.includes('changed-static-neighborhood'));
  assert.equal(row(result, 'leaf').changedFiles[0].path, 'b-leaf.ts');
  assert.equal(row(result, 'leaf').change, 'unchanged'); assert.deepEqual(row(result, 'leaf').descriptionChanges, []);
  assert.equal(result.code.files.find(file => file.path === 'b-leaf.ts').before.snapshot, before.graph.project.snapshot);
  assert.equal(result.code.files.find(file => file.path === 'b-leaf.ts').after.snapshot, current.graph.project.snapshot);
  assert.deepEqual(result.task.intent.checks, task(['entry']).intent.checks);
});

test('unrelated edits leave another exact feature untouched and visible as an unchanged declared target', () => {
  const { root, before } = fixture(), map = document(before, ['entry', 'unrelated']);
  write(root, 'a-unrelated.ts', source['a-unrelated.ts'].replace('return 3', 'return 4'));
  const result = report(before, capture(root), map, map, ['entry']);
  assert.equal(row(result).affected, false); assert.deepEqual(row(result).changedFiles, []);
  assert.equal(row(result).references.baselineAtAfter[0].status, 'matched');
  assert.equal(result.summary.declaredWithoutObservedChanges, 1);
  assert.equal(row(result, 'unrelated').affected, true); assert.equal(result.summary.outsideDeclaredFeatures, 1);
});

test('a selected parent does not silently grant target scope to its explicit child or shared-code feature', () => {
  const { root, before } = fixture(); let map = feature(before, api.create(before.graph), 'parent');
  map = feature(before, map, 'child', { parentId: 'parent' });
  map = mapping(before, map, 'child', node(before, 'leaf'));
  map = feature(before, map, 'another'); map = mapping(before, map, 'another', node(before, 'leaf'));
  write(root, 'b-leaf.ts', source['b-leaf.ts'].replace('return 1', 'return 2'));
  const result = report(before, capture(root), map, map, ['parent']);
  assert.equal(row(result, 'parent').scope, 'declared'); assert.equal(row(result, 'parent').affected, false);
  assert.equal(row(result, 'child').scope, 'outside-declared'); assert.equal(row(result, 'another').scope, 'outside-declared');
  assert.equal(result.summary.outsideDeclaredFeatures, 2); assert.equal('dependencies' in result, false);
});

test('a task without explicit feature scope does not infer scope from its textual goal', () => {
  const { root, before } = fixture(), map = document(before);
  write(root, 'c-entry.ts', source['c-entry.ts'] + '\nentry();\n');
  const current = capture(root), noIntent = report(before, current, map);
  assert.equal(row(noIntent).scope, 'undeclared'); assert.equal(noIntent.summary.outsideDeclaredFeatures, 0);
  const emptyScope = report(before, current, map, map, []);
  assert.equal(row(emptyScope).scope, 'undeclared'); assert.equal(emptyScope.summary.declaredFeatures, 0);
});

test('pending references already present at the starting point are not new task effects', () => {
  const { root, before: original } = fixture(), map = document(original, ['leaf']);
  write(root, 'b-leaf.ts', source['b-leaf.ts'].replace('return 1', 'return 2'));
  const before = capture(root), result = report(before, before, map, map, ['leaf'], [original]);
  assert.equal(result.summary.preexistingPendingReferences, 1); assert.equal(result.summary.newlyPendingReferences, 0);
  assert.equal(row(result, 'leaf').preexistingPending[0].status, 'needs-review');
  assert.deepEqual(row(result, 'leaf').referenceChanges, []); assert.equal(row(result, 'leaf').affected, false);
  write(root, 'b-leaf.ts', source['b-leaf.ts'].replace('return 1', 'return 3'));
  const again = report(before, capture(root), map, map, ['leaf'], [original]);
  assert.equal(again.summary.preexistingPendingReferences, 1); assert.equal(again.summary.newlyPendingReferences, 0);
  assert.equal(row(again, 'leaf').affected, true); assert.equal(row(again, 'leaf').changedFiles[0].path, 'b-leaf.ts');
});

test('reused old source paths stay historical hints and never become a current entity association', () => {
  const { root, before: original } = fixture(), map = document(original, ['leaf']);
  write(root, 'b-leaf.ts', 'export function completelyDifferent() { return 8; }\n');
  const before = capture(root);
  write(root, 'b-leaf.ts', 'export function completelyDifferent() { return 9; }\n');
  const current = capture(root), result = report(before, current, map, map, ['leaf'], [original]);
  const feature = row(result, 'leaf');
  assert.equal(feature.preexistingPending.length, 1); assert.equal(feature.referenceChanges.length, 0);
  assert.equal(result.summary.newlyPendingReferences, 0);
  assert.equal(feature.changedFiles[0].path, 'b-leaf.ts', 'This is only the file path stored in the old annotation.');
  assert.ok(feature.references.before.every(item => item.current === undefined));
  assert.ok(feature.references.after.every(item => item.current === undefined));
  assert.ok(result.unassigned.find(file => file.path === 'b-leaf.ts').afterNodes.some(item => item.name === 'completelyDifferent'));
  assert.ok(result.limitations.some(text => text.includes('不能按路径重用旧身份')));
});

test('missing original histories remain unverified and cannot manufacture a newly broken reference', () => {
  const { root, before: original } = fixture(), map = document(original);
  write(root, 'a-unrelated.ts', source['a-unrelated.ts'] + 'unrelated();\n');
  const before = capture(root), result = report(before, before, map);
  assert.equal(row(result).references.before[0].status, 'unverified');
  assert.ok(row(result).preexistingPending[0].reasons.includes('missing-baseline-graph'));
  assert.equal(result.summary.newlyPendingReferences, 0); assert.equal(row(result).affected, false);
});

test('reference recovery is reported without accepting new code or erasing the old pending state', () => {
  const { root, before: original } = fixture(), map = document(original, ['leaf']);
  write(root, 'b-leaf.ts', source['b-leaf.ts'].replace('return 1', 'return 2'));
  const before = capture(root);
  const result = report(before, original, map, map, ['leaf'], [original]);
  assert.equal(row(result, 'leaf').referenceChanges[0].kind, 'resolved');
  assert.equal(row(result, 'leaf').preexistingPending.length, 1);
  assert.equal(row(result, 'leaf').references.after[0].decision, 'proposed');
  assert.equal(result.summary.newlyPendingReferences, 0);
});

test('feature meaning and implicit review resets remain separate from source changes', () => {
  const { before } = fixture(); let map = document(before);
  map = decide(before, map, 'entry-map', 'accepted');
  const changed = api.edit(before.graph, map, { op: 'feature', feature: { ...map.features[0],
    summary: 'A revised explanation', questions: ['What remains unknown?'] } }, context(map));
  const result = report(before, before, map, changed, ['entry']);
  assert.deepEqual(result.code.files, []); assert.equal(row(result).change, 'modified');
  assert.deepEqual(row(result).descriptionChanges.map(change => change.field), ['summary', 'questions']);
  assert.deepEqual(row(result).reviewChanges, [{ mappingId: 'entry-map', before: 'accepted', after: 'proposed' }]);
  assert.equal(result.summary.changedReviewDecisions, 1); assert.equal(result.summary.changedMappings, 0);
  assert.equal(result.summary.newlyPendingReferences, 0);
});

test('mapping acceptance alone changes annotation review records without becoming code acceptance', () => {
  const { before } = fixture(), map = document(before), accepted = decide(before, map, 'entry-map', 'accepted');
  const result = report(before, before, map, accepted);
  assert.deepEqual(result.code.files, []); assert.equal(row(result).mappingChanges[0].kind, 'review');
  assert.deepEqual(row(result).mappingChanges[0].fields, ['decision']);
  assert.equal(result.summary.changedMappings, 0); assert.equal(result.summary.changedReviewDecisions, 1);
  assert.equal('codeDecision' in result, false); assert.equal('verification' in result, false);
});

test('added, removed and reassigned annotations preserve exact before/after content', () => {
  const { before } = fixture(), map = document(before, ['entry', 'leaf']);
  let changed = feature(before, map, 'new-feature');
  changed = mapping(before, changed, 'new-feature', node(before, 'entry'), 'entry-map');
  changed = clone(changed); changed.features = changed.features.filter(item => item.id !== 'leaf');
  changed.mappings = changed.mappings.filter(item => item.featureId !== 'leaf');
  const result = report(before, before, map, changed);
  assert.equal(row(result, 'new-feature').change, 'added'); assert.equal(row(result, 'leaf').change, 'removed');
  const moved = row(result).mappingChanges.find(item => item.id === 'entry-map');
  assert.equal(moved.before.featureId, 'entry'); assert.equal(moved.after.featureId, 'new-feature');
  assert.ok(moved.fields.includes('featureId')); assert.deepEqual(row(result, 'new-feature').mappingChanges[0], moved);
  assert.equal(result.summary.addedFeatures, 1); assert.equal(result.summary.removedFeatures, 1);
});

test('a rejected mapping neither grants ownership nor introduces active task effects', () => {
  const { root, before } = fixture(); let map = document(before, ['leaf']);
  map = decide(before, map, 'leaf-map', 'rejected');
  write(root, 'b-leaf.ts', source['b-leaf.ts'].replace('return 1', 'return 2'));
  const current = capture(root), result = report(before, current, map);
  assert.equal(row(result, 'leaf').affected, false); assert.equal(result.summary.newlyPendingReferences, 0);
  assert.ok(result.unassigned.find(file => file.path === 'b-leaf.ts').afterNodes.some(item => item.name === 'leaf'));
  assert.equal(row(result, 'leaf').references.after[0].decision, 'rejected');
});

test('snapshot-local node and relation ID churn creates no feature, code or reference effects', () => {
  const { before } = fixture(), map = document(before), current = clone(before);
  const ids = new Map(current.graph.nodes.map((item, index) => [item.id, 'different-' + index]));
  for (const item of current.graph.nodes) { item.id = ids.get(item.id); if (item.parent) item.parent = ids.get(item.parent); }
  current.graph.relations.forEach((edge, index) => { edge.id = 'edge-' + index; edge.from = ids.get(edge.from);
    edge.targets = edge.targets.map(id => ids.get(id)); for (const item of edge.evidence.valueOrigins?.sources ?? []) item.target = ids.get(item.target); });
  current.graph.project.snapshot = hash('synthetic input ID churn'); current.graph.nodes.reverse(); current.graph.relations.reverse();
  const result = report(before, current, map);
  assert.deepEqual(result.code.files, []); assert.deepEqual(row(result).referenceChanges, []); assert.equal(row(result).affected, false);
  assert.notEqual(row(result).references.before[0].current.nodeId, row(result).references.after[0].current.nodeId);
});

test('candidate and incomplete provenance changes survive the comparison without being called execution', () => {
  const { before } = fixture(), map = document(before), current = clone(before);
  current.graph.project.snapshot = hash('synthetic candidate facts');
  const edge = current.graph.relations.find(item => item.kind === 'call' && item.targetLabel === 'leaf');
  edge.status = 'candidate'; edge.evidence.valueOrigins = { complete: false, truncated: true, visited: 8,
    limits: { maxDepth: 3, maxSteps: 8, maxSources: 2, maxStops: 2, maxCallsites: 2 },
    sources: [{ target: edge.targets[0], path: [{ location: edge.evidence.location, fileHash: edge.evidence.fileHash,
      excerpt: edge.evidence.excerpt, kind: 'argument' }] }],
    stops: [{ location: edge.evidence.location, fileHash: edge.evidence.fileHash, excerpt: edge.evidence.excerpt, reason: 'step-budget' }] };
  const result = report(before, current, map);
  assert.equal(row(result).referenceChanges[0].kind, 'newly-pending');
  assert.ok(row(result).references.baselineAtAfter[0].warnings.includes('neighborhood-candidate'));
  assert.ok(row(result).references.baselineAtAfter[0].warnings.includes('truncated-value-origins'));
  const record = result.code.files.find(file => file.path === 'c-entry.ts').relations.after[0];
  assert.equal(record.status, 'candidate'); assert.equal(record.evidence.valueOrigins.stops[0].reason, 'step-budget');
});

test('leading text shifts require reference review even when M1 matches the unchanged declaration text', () => {
  const { root, before } = fixture(), map = document(before, ['leaf']);
  write(root, 'b-leaf.ts', '// heading only\n' + source['b-leaf.ts']);
  const result = report(before, capture(root), map);
  assert.equal(result.code.files.find(file => file.path === 'b-leaf.ts').declarations.added, 0);
  assert.equal(row(result, 'leaf').referenceChanges[0].kind, 'newly-pending');
  assert.equal(row(result, 'leaf').references.after[0].current, undefined);
  assert.ok(result.unassigned.find(file => file.path === 'b-leaf.ts').afterNodes.some(item => item.name === 'leaf'));
});

test('file-level associations do not grant ownership to declarations and complete unknown lists exceed preview budgets', () => {
  const files = { 'tsconfig.json': source['tsconfig.json'], 'many.ts': 'export function initial() { return 1; }\n' };
  const { root, before } = fixture(files); let map = feature(before, api.create(before.graph), 'container');
  map = mapping(before, map, 'container', before.graph.nodes.find(item => item.kind === 'file' && item.location.file === 'many.ts'));
  const added = Array.from({ length: 65 }, (_, index) => `export function added${index}() { return ${index}; }`).join('\n');
  write(root, 'many.ts', files['many.ts'] + added);
  const current = capture(root), afterMap = documentForFile(current, 'container', 'many.ts');
  const result = report(before, current, map, afterMap);
  const unknown = result.unassigned.find(file => file.path === 'many.ts');
  assert.ok(unknown.beforeNodes.some(item => item.name === 'initial')); assert.equal(unknown.afterNodes.length, 66);
  assert.ok(unknown.afterNodes.every(item => item.kind === 'function'));
  assert.equal(result.code.files[0].declarations.after.length, 40); assert.equal(result.code.files[0].declarations.truncated, true);
  assert.equal(result.summary.unassignedAfterNodes, 66);
});

function documentForFile(version, id, file) {
  let map = feature(version, api.create(version.graph), id);
  return mapping(version, map, id, version.graph.nodes.find(item => item.kind === 'file' && item.location.file === file));
}

test('source changes without non-file entities remain explicitly unknown even with a file association', () => {
  const files = { 'tsconfig.json': source['tsconfig.json'], 'values.ts': 'export const value = 1;\n' };
  const { root, before } = fixture(files), map = documentForFile(before, 'values', 'values.ts');
  write(root, 'values.ts', 'export const value = 2;\n');
  const current = capture(root), result = report(before, current, map, documentForFile(current, 'values', 'values.ts'));
  assert.equal(result.unassigned.length, 1); assert.equal(result.unassigned[0].beforeWithoutEntities, true);
  assert.equal(result.unassigned[0].afterWithoutEntities, true); assert.deepEqual(result.unassigned[0].afterNodes, []);
});

test('absent annotation versions and an empty graph have honest null identities and no invented features', () => {
  const { before } = fixture(), empty = clone(before);
  empty.graph.project.snapshot = hash('empty fixture'); empty.graph.files = []; empty.graph.nodes = []; empty.graph.relations = [];
  empty.graph.coverage.indexedFiles = 0; empty.graph.coverage.inventorySourceFiles = 0;
  empty.graph.coverage.syntaxCalls = 0; empty.graph.coverage.callsByStatus = { bound: 0, candidate: 0, unresolved: 0, external: 0 };
  const result = report(empty, empty, null);
  assert.equal(result.before.featureDigest, null); assert.equal(result.after.featureRevision, null);
  assert.deepEqual(result.features, []); assert.deepEqual(result.code.files, []); assert.deepEqual(result.unassigned, []);
  const removed = report(before, empty, null);
  assert.equal(removed.summary.changedFiles, 3); assert.ok(removed.unassigned.every(file => file.kind === 'removed'));
  assert.ok(removed.unassigned.every(file => file.afterNodes.length === 0));
});

test('analysis contract changes and indexing gaps remain visible even without source-file changes', () => {
  const { before } = fixture(), map = document(before), current = clone(before);
  current.graph.project.analysisRevision = 99; current.graph.project.snapshot = hash('other analysis contract');
  current.graph.coverage.unindexed.push({ path: 'service.py', reason: 'unsupported-language' });
  const result = report(before, current, map);
  assert.deepEqual(result.code.files, []); assert.ok(result.code.contractChanges.includes('分析规则版本变化'));
  assert.equal(result.code.scope.after.unindexed.at(-1).path, 'service.py');
  assert.equal(row(result).referenceChanges[0].kind, 'newly-pending');
});

test('report identity is repeatable and covers exact annotation, goal and uncertainty content', () => {
  const { before } = fixture(), map = document(before), result = report(before, before, map, map, ['entry']);
  assert.deepEqual(report(before, before, map, map, ['entry']), result);
  assert.equal(developmentReviewDigest(JSON.parse(JSON.stringify(result))), result.comparisonDigest);
  const changed = clone(result); changed.task.intent.goal = 'A different declared objective';
  assert.notEqual(developmentReviewDigest(changed), result.comparisonDigest);
  const altered = clone(result); altered.references.after.mappings[0].warnings.push('additional uncertainty');
  assert.notEqual(developmentReviewDigest(altered), result.comparisonDigest);
  const reordered = clone(map); reordered.features = reordered.features.map(item => Object.fromEntries(Object.entries(item).reverse()));
  const alternate = report(before, before, map, reordered);
  assert.notEqual(alternate.after.featureDigest, alternate.before.featureDigest);
  assert.equal(alternate.summary.affectedFeatures, 0, 'Object key order is a version difference, not meaning.');
  assert.equal(result.task.intent.source, 'manual');
});

test('invalid or later-only target IDs and duplicated checks cannot silently broaden the frozen goal', () => {
  const { before } = fixture(), map = document(before), changed = feature(before, map, 'later');
  assert.throws(() => report(before, before, map, changed, ['later']), /starting point/);
  assert.throws(() => report(before, before, map, map, ['entry', 'entry']), /scope/);
  const input = { task: task(['entry']), before: { ...before, features: map }, after: { ...before, features: map }, history: new Map() };
  input.task.intent.checks.push(clone(input.task.intent.checks[0]));
  assert.throws(() => compareDevelopmentReview(input), /checks/);
  input.task.intent.checks = Array.from({ length: 51 }, (_, index) => ({ id: 'check-' + index, text: 'Declared check.' }));
  assert.throws(() => compareDevelopmentReview(input), /checks/);
});
