import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { analyze } from '../dist/analyze.js';
import { createFeatureMapApi } from '../dist/feature-map.js';
import { createFeatureMigrationApi } from '../dist/feature-migration.js';
import { checkFeatureReferences } from '../dist/feature-references.js';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'repographia-feature-references-'));
after(() => fs.rmSync(directory, { recursive: true, force: true }));
const api = createFeatureMapApi(), migration = createFeatureMigrationApi(api);
const clone = structuredClone, digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
let serial = 0;
const source = {
  'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler',
    strict: true, types: [] }, include: ['*.ts'] }),
  'a-unrelated.ts': 'export function unrelated() { return 3; }\n',
  'b-leaf.ts': 'export function leaf() { return 1; }\n',
  'c-entry.ts': "import { leaf } from './b-leaf';\nexport function entry() { return leaf(); }\n",
};
const write = (root, name, text) => {
  fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
  fs.writeFileSync(path.join(root, name), text);
};
function capture(root, project) {
  let inputs;
  const graph = analyze(root, { project, includeSource: true, onInputs: value => { inputs = value; } });
  return { graph, inputs };
}
function fixture(extra = {}) {
  const root = path.join(directory, String(++serial)); fs.mkdirSync(root);
  for (const [name, text] of Object.entries({ ...source, ...extra })) write(root, name, text);
  return { root, before: capture(root) };
}
const node = (version, name, kind = 'function') => version.graph.nodes.find(item => item.name === name && item.kind === kind);
const context = map => ({ expectedRevision: map.revision, actor: 'reference-test-reviewer', actorKind: 'manual',
  at: '2026-10-22T00:00:00Z', reason: 'Explicit fixture decision, not user acceptance.' });
function document(version, names = ['entry']) {
  let map = api.create(version.graph);
  for (const name of names) {
    map = api.edit(version.graph, map, { op: 'feature', feature: { id: name, title: name,
      description: 'Independent source fixture ' + name, questions: [] } }, context(map));
    const target = node(version, name);
    map = api.edit(version.graph, map, { op: 'mapping', id: name + '-map', featureId: name, nodeId: target.id,
      role: 'implementation', rationale: 'Explicit fixture declaration.',
      relationIds: version.graph.relations.filter(edge => edge.from === target.id).map(edge => edge.id) }, context(map));
  }
  return map;
}
const review = (version, map, id, decision) => api.edit(version.graph, map, { op: 'review', id, decision }, context(map));
const report = (current, map, ...versions) => checkFeatureReferences(current, map,
  new Map(versions.map(version => [version.graph.project.snapshot, version])));
const row = (result, id = 'entry-map') => result.mappings.find(mapping => mapping.id === id);

test('same-snapshot references can be checked without capture records; decisions and source version remain separate', () => {
  const { before } = fixture(); let map = document(before);
  map = review(before, map, 'entry-map', 'accepted');
  const result = report({ graph: before.graph }, map);
  assert.equal(row(result).status, 'matched'); assert.equal(row(result).decision, 'accepted');
  assert.deepEqual(row(result).originalBasis, map.basis);
  assert.equal(result.featureDigest, digest(map)); assert.equal(result.revision, map.revision);
  assert.equal(result.snapshot, before.graph.project.snapshot);
  assert.ok(row(result).warnings.includes('reference-check-not-semantic-review'));
});

test('an unrelated added call reorders global edge IDs without invalidating another exact static neighborhood', () => {
  const { root, before } = fixture(); let map = document(before, ['entry', 'unrelated']);
  map = review(before, map, 'entry-map', 'accepted');
  write(root, 'a-unrelated.ts', source['a-unrelated.ts'] + 'unrelated();\n');
  const after = capture(root), original = map.mappings.find(item => item.id === 'entry-map').evidence[0];
  const newEdge = after.graph.relations.find(edge => edge.from === node(after, 'entry').id);
  assert.notEqual(original.relationId, newEdge.id, 'The fixture must exercise actual analyzer ID churn.');
  const result = report(after, map, before);
  assert.equal(row(result).status, 'matched'); assert.equal(row(result).decision, 'accepted');
  assert.deepEqual(row(result).current.relationIds, [newEdge.id]);
  assert.equal(row(result, 'unrelated-map').status, 'needs-review');
  assert.equal(result.summary.matched, 1); assert.equal(result.summary.needsReview, 1);
  assert.equal(api.assess(after.graph, map).summary.current, 0, 'Legacy strict freshness must remain unchanged.');
  assert.notEqual(migration.plan(before.graph, after.graph, map).rows[0].status, 'reusable');
  assert.throws(() => api.edit(after.graph, map, { op: 'review', id: 'entry-map', decision: 'accepted' }, context(map)), /stale/);
});

test('an unrelated indexed file can enter the scope without clearing exact references in other files', () => {
  const { root, before } = fixture(), map = document(before);
  write(root, 'new.ts', 'export function added() { return 9; }\nadded();\n');
  const after = capture(root), result = report(after, map, before);
  assert.equal(row(result).status, 'matched');
  assert.ok(result.unassignedNodes.some(item => item.id === node(after, 'added').id));
  assert.ok(!result.unassignedNodes.some(item => item.id === node(after, 'entry').id));
});

test('full static neighborhoods catch a changed callee even when mapped source and relation anchors are unchanged', () => {
  const { root, before } = fixture(), map = document(before);
  write(root, 'b-leaf.ts', 'export function leaf() { return 2; }\n');
  const after = capture(root), result = report(after, map, before);
  assert.equal(before.graph.files.find(file => file.path === 'c-entry.ts').hash,
    after.graph.files.find(file => file.path === 'c-entry.ts').hash);
  assert.equal(row(result).status, 'needs-review');
  assert.ok(row(result).reasons.includes('changed-static-neighborhood')); assert.equal(row(result).current, undefined);
});

test('an added incoming call is visible for a declaration-only mapping', () => {
  const { root, before } = fixture(), map = document(before, ['leaf']);
  assert.equal(map.mappings[0].evidence.length, 0);
  write(root, 'a-unrelated.ts', "import { leaf } from './b-leaf';\nexport function unrelated() { return leaf(); }\n");
  const result = report(capture(root), map, before);
  assert.equal(row(result, 'leaf-map').status, 'needs-review');
  assert.ok(row(result, 'leaf-map').reasons.includes('changed-static-neighborhood'));
});

test('leading text shifts require explicit rechecking and never reanchor by the same name', () => {
  const { root, before } = fixture(), map = document(before);
  write(root, 'c-entry.ts', '// saved before the declarations\n' + source['c-entry.ts']);
  const after = capture(root), result = report(after, map, before);
  assert.notEqual(node(before, 'entry').id, node(after, 'entry').id);
  assert.equal(row(result).status, 'needs-review');
  assert.ok(row(result).reasons.includes('exact-anchor-recheck-required'));
  assert.equal(row(result).current, undefined);
  assert.ok(result.unassignedNodes.some(item => item.id === node(after, 'entry').id));
});

test('leaving the index is unmatched and retains the original basis, without claiming a disk deletion', () => {
  const { root, before } = fixture(), map = document(before);
  write(root, 'tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ES2022', types: [] }, files: ['a-unrelated.ts'] }));
  const after = capture(root), result = report(after, map, before);
  assert.equal(fs.existsSync(path.join(root, 'c-entry.ts')), true);
  assert.equal(row(result).status, 'unmatched');
  assert.ok(row(result).reasons.includes('missing-indexed-file'));
  assert.deepEqual(row(result).originalBasis, map.basis);
});

test('a multi-basis document checks each deferred mapping against its actual original graph', () => {
  const { root, before } = fixture(); let map = document(before, ['entry', 'leaf']);
  map = review(before, map, 'entry-map', 'accepted');
  write(root, 'a-unrelated.ts', 'export function unrelated() { return 4; }\n');
  const middle = capture(root), plan = migration.plan(before.graph, middle.graph, map);
  const migrated = migration.apply(before.graph, middle.graph, map, { sourceRevision: map.revision,
    from: plan.from, to: plan.to, actions: [{ id: 'leaf-map', action: 'carry' }] }, context(map));
  write(root, 'a-unrelated.ts', 'export function unrelated() { return 5; }\n');
  const current = capture(root), result = report(current, migrated, before, middle);
  assert.equal(row(result).status, 'matched'); assert.equal(row(result).decision, 'accepted');
  assert.equal(row(result).originalBasis.snapshot, before.graph.project.snapshot);
  assert.equal(row(result, 'leaf-map').status, 'matched');
  assert.equal(row(result, 'leaf-map').originalBasis.snapshot, middle.graph.project.snapshot);
  const missing = report(current, migrated, middle);
  assert.equal(row(missing).status, 'unverified'); assert.ok(row(missing).reasons.includes('missing-baseline-graph'));
  assert.equal(row(missing, 'leaf-map').status, 'matched');
  assert.equal(api.assess(current.graph, migrated).summary.current, 0);
});

test('missing captures or a mismatched history entry cannot make an old reference verified', () => {
  const { root, before } = fixture(), map = document(before);
  write(root, 'a-unrelated.ts', 'export function unrelated() { return 4; }\n');
  const after = capture(root);
  const missing = report(after, map, { graph: before.graph });
  assert.equal(row(missing).status, 'unverified'); assert.ok(row(missing).reasons.includes('analysis-inputs-unavailable'));
  const wrong = checkFeatureReferences(after, map, new Map([[before.graph.project.snapshot, after]]));
  assert.equal(row(wrong).status, 'unverified'); assert.ok(row(wrong).reasons.includes('baseline-basis-mismatch'));
});

test('invalid original anchors remain unverified even if a similarly named current declaration exists', () => {
  const { before } = fixture(), map = document(before); map.mappings[0].code.start++;
  const result = report(before, map);
  assert.equal(row(result).status, 'unverified'); assert.ok(row(result).reasons.includes('original-reference-unverified'));
  assert.equal(row(result).current, undefined);
});

test('inherited config bytes invalidate local checks even when effective graph facts remain identical', () => {
  const { root, before } = fixture({ 'base.json': '{"compilerOptions":{"strict":true}}',
    'tsconfig.json': JSON.stringify({ extends: './base.json', compilerOptions: { target: 'ES2022', module: 'ESNext',
      moduleResolution: 'Bundler', types: [] }, include: ['*.ts'] }) });
  const map = document(before); write(root, 'base.json', '{ "compilerOptions": { "strict": true } }\n');
  const after = capture(root), result = report(after, map, before);
  assert.deepEqual(before.graph.nodes, after.graph.nodes); assert.deepEqual(before.graph.relations, after.graph.relations);
  assert.equal(row(result).status, 'needs-review'); assert.ok(row(result).reasons.includes('changed-analysis-inputs'));
});

test('ambient declaration changes are conservative gates even when the mapped relation records did not change', () => {
  const { root, before } = fixture({ 'environment.d.ts': 'declare const ambientFlag: string;\n' });
  const map = document(before); write(root, 'environment.d.ts', 'declare const ambientFlag: number;\n');
  const after = capture(root), result = report(after, map, before);
  assert.deepEqual(before.graph.relations, after.graph.relations);
  assert.equal(row(result).status, 'needs-review'); assert.ok(row(result).reasons.includes('changed-analysis-inputs'));
});

test('an explicitly selected configuration remains an environment input even if it is also indexed as source', () => {
  const { root } = fixture(); write(root, 'settings.ts', source['tsconfig.json']);
  const before = capture(root, 'settings.ts'), map = document(before);
  assert.ok(before.graph.files.some(file => file.path === 'settings.ts'));
  write(root, 'settings.ts', source['tsconfig.json'] + '\n');
  const result = report(capture(root, 'settings.ts'), map, before);
  assert.equal(row(result).status, 'needs-review'); assert.ok(row(result).reasons.includes('changed-analysis-inputs'));
});

test('nonstandard transitive inherited configuration is protected while ordinary source changes stay local', () => {
  const { root, before } = fixture({
    'tsconfig.json': JSON.stringify({ ...JSON.parse(source['tsconfig.json']), extends: './settings.ts' }),
    'settings.ts': '{"extends":"./inherited.ts","compilerOptions":{"strict":true}}',
    'inherited.ts': '{"compilerOptions":{"allowJs":false}}',
  });
  let map = document(before); map = review(before, map, 'entry-map', 'accepted');
  for (const file of ['settings.ts', 'inherited.ts']) {
    assert.ok(before.graph.files.some(item => item.path === file));
    assert.ok(before.inputs.configReads.includes(path.join(root, file)));
  }
  write(root, 'a-unrelated.ts', source['a-unrelated.ts'] + 'unrelated();\n');
  const ordinaryChange = capture(root), unchanged = report(ordinaryChange, map, before);
  assert.equal(row(unchanged).status, 'matched'); assert.equal(row(unchanged).decision, 'accepted');
  fs.appendFileSync(path.join(root, 'inherited.ts'), '\n// same options, changed config bytes\n');
  const after = capture(root), changed = report(after, map, before);
  assert.deepEqual(ordinaryChange.graph.relations, after.graph.relations);
  assert.equal(row(changed).status, 'needs-review'); assert.equal(row(changed).decision, 'accepted');
  assert.ok(row(changed).reasons.includes('changed-analysis-inputs')); assert.equal(row(changed).current, undefined);
  assert.deepEqual(row(changed).originalBasis, map.basis);
});

test('legacy capture without config read purposes cannot verify cross-snapshot references in either direction', () => {
  const { root, before } = fixture({
    'tsconfig.json': JSON.stringify({ ...JSON.parse(source['tsconfig.json']), extends: './settings.ts' }),
    'settings.ts': '{"compilerOptions":{"strict":true}}',
  });
  const map = document(before);
  write(root, 'a-unrelated.ts', source['a-unrelated.ts'] + 'unrelated();\n');
  const after = capture(root), oldBefore = clone(before), oldAfter = clone(after);
  delete oldBefore.inputs.configReads; delete oldAfter.inputs.configReads;
  for (const [from, to] of [[oldBefore, after], [before, oldAfter], [oldBefore, oldAfter]]) {
    const result = report(to, map, from);
    assert.equal(row(result).status, 'unverified'); assert.equal(row(result).current, undefined);
    assert.ok(row(result).reasons.includes('analysis-inputs-unavailable'));
  }
  const missingAttribution = clone(before); missingAttribution.inputs.configReads = [];
  assert.equal(row(report(after, map, missingAttribution)).status, 'unverified', 'A configured project must attribute its selected config.');
  fs.appendFileSync(path.join(root, 'settings.ts'), '\n');
  assert.notEqual(row(report(capture(root), map, oldBefore)).status, 'matched');
  assert.equal(row(report(oldBefore, map)).status, 'matched', 'Exact same-snapshot checking remains supported for old reports.');
});

test('an explicitly captured absence of configuration still permits local cross-snapshot matching', () => {
  const { root } = fixture(); fs.unlinkSync(path.join(root, 'tsconfig.json'));
  const before = capture(root), map = document(before);
  write(root, 'a-unrelated.ts', source['a-unrelated.ts'] + 'unrelated();\n');
  const after = capture(root);
  assert.equal(before.graph.project.config, null); assert.equal(after.graph.project.config, null);
  assert.deepEqual(before.inputs.configReads, []); assert.deepEqual(after.inputs.configReads, []);
  assert.equal(row(report(after, map, before)).status, 'matched');
});

test('installing a previously missing type package changes captured resolution inputs', () => {
  const { root, before } = fixture({ 'a-unrelated.ts': "import type { Flag } from 'missing-type';\nexport function unrelated() { return 3; }\n" });
  const map = document(before);
  write(root, 'node_modules/missing-type/package.json', '{"types":"index.d.ts"}');
  write(root, 'node_modules/missing-type/index.d.ts', 'export type Flag = boolean;\n');
  const after = capture(root), result = report(after, map, before);
  assert.ok(before.graph.diagnostics.some(item => item.code === 'TS2307'));
  assert.ok(!after.graph.diagnostics.some(item => item.code === 'TS2307'));
  assert.equal(row(result).status, 'needs-review'); assert.ok(row(result).reasons.includes('changed-analysis-inputs'));
});

function rekey(version) {
  const result = clone(version), ids = new Map(result.graph.nodes.map((item, i) => [item.id, 'rekey-node-' + i]));
  for (const item of result.graph.nodes) { item.id = ids.get(item.id); if (item.parent) item.parent = ids.get(item.parent); }
  for (const [i, edge] of result.graph.relations.entries()) {
    edge.id = 'rekey-edge-' + i; edge.from = ids.get(edge.from); edge.targets = edge.targets.map(id => ids.get(id));
    for (const origin of edge.evidence.valueOrigins?.sources ?? []) origin.target = ids.get(origin.target);
  }
  result.graph.project.snapshot = 'f'.repeat(64); result.graph.nodes.reverse(); result.graph.relations.reverse();
  return result;
}
test('temporary structural comparison ignores only IDs/order, while candidate and origin limits remain explicit', () => {
  const { before } = fixture({ 'c-entry.ts': "import { leaf } from './b-leaf';\nexport function entry(handler:()=>number) { return handler(); }\nentry(leaf);\n" });
  const edge = before.graph.relations.find(item => item.from === node(before, 'entry').id);
  assert.equal(edge.status, 'candidate'); assert.ok(edge.evidence.valueOrigins.sources.length);
  assert.ok(edge.evidence.valueOrigins.stops.length); edge.evidence.valueOrigins.truncated = true;
  let map = document(before); map = review(before, map, 'entry-map', 'accepted');
  const current = rekey(before), result = report(current, map, before);
  assert.equal(row(result).status, 'matched'); assert.equal(row(result).decision, 'accepted');
  assert.ok(row(result).warnings.includes('evidence-candidate'));
  assert.ok(row(result).warnings.includes('incomplete-value-origins'));
  assert.ok(row(result).warnings.includes('truncated-value-origins'));
  assert.ok(row(result).current.relationIds[0].startsWith('rekey-edge-'));
  for (const mutate of [item => { item.status = 'unresolved'; item.targets = []; item.evidence.reason = 'missing-symbol'; },
    item => { item.typeOnly = true; }, item => { item.kind = 'construct'; },
    item => { item.evidence.valueOrigins.limits.maxSteps++; }, item => { item.evidence.valueOrigins.truncated = false; },
    item => { item.evidence.valueOrigins.stops[0].reason += '-changed'; }, item => { item.evidence.valueOrigins.sources[0].path[0].kind += '-changed'; }]) {
    const changed = clone(current), changedEdge = changed.graph.relations.find(item => item.targetLabel === 'handler');
    const originalEdge = clone(changedEdge); mutate(changedEdge); assert.notDeepEqual(changedEdge, originalEdge);
    const checked = report(changed, map, before);
    assert.equal(row(checked).status, 'needs-review'); assert.ok(row(checked).reasons.includes('changed-static-neighborhood'));
  }
});

test('a duplicate structural relation cannot be collapsed or chosen arbitrarily as evidence', () => {
  const { before } = fixture(), map = document(before), current = rekey(before);
  const edge = current.graph.relations.find(item => item.targetLabel === 'leaf' && item.kind === 'call');
  current.graph.relations.push({ ...clone(edge), id: 'duplicate-edge' });
  const result = report(current, map, before);
  assert.equal(row(result).status, 'needs-review'); assert.ok(row(result).reasons.includes('ambiguous-relation-anchor'));
  assert.ok(row(result).reasons.includes('changed-static-neighborhood'));
});

test('rejected mappings remain recorded but do not hide unassigned code', () => {
  const { before } = fixture(); let map = document(before);
  map = review(before, map, 'entry-map', 'rejected');
  const result = report(before, map);
  assert.equal(row(result).status, 'matched'); assert.equal(row(result).decision, 'rejected');
  assert.equal(result.summary.mappedNodes, 0);
  assert.ok(result.unassignedNodes.some(item => item.id === node(before, 'entry').id));
});

test('file and parent-feature associations do not imply ownership of their child functions', () => {
  const { before } = fixture(); let map = api.create(before.graph);
  for (const feature of [{ id: 'parent', title: 'Parent', description: 'Explicit grouping.', questions: [] },
    { id: 'child', parentId: 'parent', title: 'Child', description: 'No own reference.', questions: [] }])
    map = api.edit(before.graph, map, { op: 'feature', feature }, context(map));
  const file = before.graph.nodes.find(item => item.kind === 'file' && item.location.file === 'c-entry.ts');
  map = api.edit(before.graph, map, { op: 'mapping', id: 'file-map', featureId: 'parent', nodeId: file.id,
    role: 'support', rationale: 'File scope only.', relationIds: [] }, context(map));
  const result = report(before, map);
  assert.equal(result.features.find(item => item.id === 'parent').status, 'matched');
  assert.equal(result.features.find(item => item.id === 'child').status, 'unmapped');
  assert.deepEqual(result.features.find(item => item.id === 'child').mappingIds, []);
  assert.ok(result.unassignedNodes.some(item => item.id === node(before, 'entry').id));
  assert.ok(!result.unassignedNodes.some(item => item.id === file.id));
});

test('checking and editing returned results cannot mutate graphs, captures, annotations or history', () => {
  const { before } = fixture(), map = document(before), current = rekey(before), versions = new Map([[before.graph.project.snapshot, before]]);
  const saved = JSON.stringify([before, current, map]);
  const result = checkFeatureReferences(current, map, versions);
  result.mappings[0].originalBasis.snapshot = 'a'.repeat(64); result.mappings[0].current.relationIds.push('fake');
  result.unassignedNodes[0].name = 'mutated'; result.features[0].mappingIds.push('fake');
  assert.equal(JSON.stringify([before, current, map]), saved);
  assert.equal(row(checkFeatureReferences(current, map, versions)).status, 'matched');
});

test('analysis contract changes and unversioned baselines cannot become a local freshness shortcut', () => {
  const { before } = fixture(), map = document(before);
  for (const mutate of [graph => { graph.project.analysisRevision++; }, graph => { graph.project.compilerVersion = '99.0.0'; },
    graph => { graph.project.config = 'other.json'; }, graph => { graph.project.name = 'another-project'; }]) {
    const current = rekey(before); mutate(current.graph);
    assert.equal(row(report(current, map, before)).status, 'needs-review');
  }
  const legacy = clone(before); delete legacy.graph.project.analysisRevision;
  const legacyMap = clone(map); legacyMap.basis.analysisRevision = null;
  const result = report(legacy, legacyMap);
  assert.equal(row(result).status, 'unverified'); assert.ok(row(result).reasons.includes('unversioned-analysis'));
});
