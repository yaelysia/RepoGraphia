import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { analyze } from '../dist/analyze.js';
import { createFeatureMapApi } from '../dist/feature-map.js';
import { createFeatureMigrationApi } from '../dist/feature-migration.js';
import { createAgentApi } from '../dist/agent.js';
import { migrationFixture } from './helpers/migration-fixture.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repographia-feature-hierarchy-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const source = path.join(root, 'source'); fs.mkdirSync(source);
fs.writeFileSync(path.join(source, 'run.ts'), `export function run(enabled: boolean, send: () => void) {
  if (!enabled) return false;
  send();
  return true;
}
`);
const graph = analyze(source, { includeSource: true }), api = createFeatureMapApi();
const node = graph.nodes.find(n => n.name === 'run'), relation = graph.relations.find(r => r.targetLabel === 'send');
const at = '2026-10-22T00:00:00.000Z';
const context = map => ({ expectedRevision: map.revision, actor: 'fixture reviewer', actorKind: 'manual', at, reason: 'Explicit hierarchy fixture' });
const feature = (id, parentId, summary) => ({ id, title: id, description: 'Requests sending only when enabled; delivery is not proved.', questions: [],
  ...(parentId === undefined ? {} : { parentId }), ...(summary === undefined ? {} : { summary }) });
const editFeature = (map, f) => api.edit(graph, map, { op: 'feature', feature: f }, context(map));
const mapping = (featureId, id = featureId + '-map') => ({ op: 'mapping', id, featureId, nodeId: node.id, role: 'entry',
  rationale: 'This declaration contains the guarded sender invocation.', relationIds: [relation.id] });
let old = editFeature(api.create(graph), feature('parent'));
old = api.edit(graph, old, mapping('parent'), context(old));
old = api.edit(graph, old, { op: 'review', id: 'parent-map', decision: 'accepted' }, context(old));

test('legacy validation and assessment preserve flat document bytes and schema', () => {
  const original = JSON.stringify(old);
  assert.equal(api.create(graph).schemaVersion, 1);
  assert.equal(JSON.stringify(api.validate(old)), original);
  api.assess(graph, old); api.hierarchy(old.features);
  assert.equal(JSON.stringify(old), original);
  assert.equal(editFeature(old, feature('another')).schemaVersion, 1);
});

test('first explicit containment upgrades only the returned document and retains existing decisions and provenance', () => {
  const original = JSON.stringify(old), next = editFeature(old, feature('child', 'parent', 'Checks the request before sending.'));
  assert.equal(next.schemaVersion, 3);
  assert.equal(JSON.stringify(old), original);
  assert.deepEqual(next.features[0], old.features[0]);
  assert.deepEqual(next.history.slice(0, old.history.length), old.history);
  assert.deepEqual(next.mappings[0], { ...old.mappings[0], basis: old.basis });
  assert.equal(next.mappings[0].decision, 'accepted');
  assert.deepEqual(api.hierarchy(next.features).path('child').map(f => f.id), ['parent', 'child']);
});

test('authoring a summary upgrades the document and follows existing semantic-edit review rules', () => {
  const next = editFeature(old, { ...old.features[0], summary: 'Sends when enabled.' });
  assert.equal(next.schemaVersion, 3);
  assert.equal(next.mappings[0].decision, 'proposed');
  assert.equal(next.history.at(-1).before.summary, undefined);
  assert.equal(next.history.at(-1).after.summary, 'Sends when enabled.');
  assert.equal(next.features[0].description, old.features[0].description);
});

test('schema 3 requires mapping basis and older schemas reject hierarchy metadata', () => {
  const valid = editFeature(old, feature('child', 'parent'));
  for (const mutate of [m => delete m.mappings[0].basis, m => { m.schemaVersion = 2; },
    m => { m.schemaVersion = 1; delete m.mappings[0].basis; }]) {
    const next = structuredClone(valid); mutate(next); assert.throws(() => api.validate(next));
  }
  const mapped = api.edit(graph, valid, mapping('child'), context(valid));
  assert.deepEqual(mapped.mappings.at(-1).basis, old.basis);
  assert.equal(api.assess(graph, mapped).summary.stale, 0);
});

test('hierarchy preserves sibling order and traverses explicit descendants only', () => {
  const rows = [feature('root'), feature('second'), feature('b', 'root'), feature('deep', 'a'), feature('a', 'root')];
  const before = JSON.stringify(rows), tree = api.hierarchy(rows);
  assert.deepEqual(tree.children().map(f => f.id), ['root', 'second']);
  assert.deepEqual(tree.children('root').map(f => f.id), ['b', 'a']);
  assert.deepEqual(tree.path('deep').map(f => f.id), ['root', 'a', 'deep']);
  assert.deepEqual(tree.descendants('root').map(f => f.id), ['b', 'a', 'deep']);
  assert.deepEqual(tree.children('deep'), []);
  const children = tree.children('root'); children.reverse();
  assert.deepEqual(tree.children('root').map(f => f.id), ['b', 'a']);
  assert.equal(JSON.stringify(rows), before);
  assert.throws(() => tree.path('unknown'), /unknown feature/);
  assert.throws(() => tree.descendants('unknown'), /unknown feature/);
});

test('a valid 1000-level document follows actual depth with no smaller traversal ceiling', () => {
  const rows = Array.from({ length: 1000 }, (_, i) => feature('f' + i, i ? 'f' + (i - 1) : undefined));
  const map = api.validate({ ...api.create(graph), schemaVersion: 3, features: rows });
  const tree = api.hierarchy(map.features);
  assert.equal(tree.path('f999').length, 1000);
  assert.equal(tree.descendants('f0').length, 999);
  rows[0].parentId = 'f999';
  assert.throws(() => api.hierarchy(rows), /cyclic/);
});

for (const [name, rows, error] of [
  ['unknown parent', [feature('a', 'missing')], /unknown parent/],
  ['self parent', [feature('a', 'a')], /itself/],
  ['two-node cycle', [feature('a', 'b'), feature('b', 'a')], /cyclic/],
  ['disconnected cycle', [feature('root'), feature('a', 'c'), feature('b', 'a'), feature('c', 'b')], /cyclic/],
  ['duplicate feature', [feature('a'), feature('a')], /duplicate/],
  ['empty summary', [feature('a', undefined, '   ')], /summary/],
  ['oversized summary', [feature('a', undefined, 'x'.repeat(201))], /summary/],
  ['null parent', [feature('a', null)], /invalid id/],
]) test('hierarchy rejects ' + name, () => {
  assert.throws(() => api.validate({ ...api.create(graph), schemaVersion: 3, features: rows }), error);
});

test('reparenting an ancestor below a descendant fails atomically', () => {
  let map = editFeature(old, feature('child', 'parent'));
  map = editFeature(map, feature('leaf', 'child'));
  const original = JSON.stringify(map);
  assert.throws(() => editFeature(map, { ...map.features[0], parentId: 'leaf' }), /cyclic/);
  assert.equal(JSON.stringify(map), original);
  const moved = editFeature(map, feature('leaf'));
  assert.equal(moved.schemaVersion, 3);
  assert.deepEqual(api.hierarchy(moved.features).path('leaf').map(f => f.id), ['leaf']);
});

test('shared mappings never create containment and parent features do not inherit child mappings', () => {
  let map = editFeature(old, feature('other'));
  map = api.edit(graph, map, mapping('other'), context(map));
  assert.equal(api.hierarchy(map.features).children().length, 2);
  assert.equal(api.hierarchy(map.features).descendants('parent').length, 0);
  map = editFeature(map, feature('child', 'parent'));
  map = api.edit(graph, map, mapping('child'), context(map));
  assert.equal(api.assess(graph, map).features.find(f => f.id === 'parent').mappingIds.length, 1);
  assert.equal(api.forNode(graph, map, node.id).length, 3);
});

test('the browser factory exposes the same full-depth hierarchy and edit validation', () => {
  const browser = vm.runInNewContext(`(${createFeatureMapApi.toString()})()`);
  const next = editFeature(old, feature('child', 'parent', 'A concise explanation.'));
  assert.equal(JSON.stringify(browser.hierarchy(next.features).path('child')), JSON.stringify(api.hierarchy(next.features).path('child')));
  assert.deepEqual(JSON.parse(JSON.stringify(browser.assess(graph, next))), api.assess(graph, next));
});

test('schema 2 upgrade and later migration preserve deferred bases, hierarchy and descriptions', () => {
  const fixture = migrationFixture(path.join(root, 'migration')), migration = createFeatureMigrationApi(api);
  const { before, after: target } = fixture;
  const apply = (a, b, map) => {
    const plan = migration.plan(a, b, map);
    return migration.apply(a, b, map, { sourceRevision: map.revision, from: plan.from, to: plan.to,
      actions: [{ id: 'keep', action: 'carry' }] }, context(map));
  };
  const legacy = apply(before, target, fixture.map);
  const nested = api.edit(target, legacy, { op: 'feature', feature: feature('nested', 'fixture', 'An explicit grouping.') }, context(legacy));
  assert.equal(nested.schemaVersion, 3);
  assert.deepEqual(nested.mappings, legacy.mappings);
  const future = structuredClone(target); future.project.snapshot = 'e'.repeat(64);
  const result = apply(target, future, nested);
  assert.equal(result.schemaVersion, 3);
  assert.deepEqual(result.features, nested.features);
  assert.equal(result.mappings.find(m => m.id === 'change').basis.snapshot, before.project.snapshot);
  assert.equal(api.assess(future, result).summary.stale, 3);
});

function proposal(rows, base) {
  const agent = createAgentApi(graph, base), header = agent.overview().proposalHeader;
  return { agent, draft: { ...header, batchId: 'hierarchy-batch', scope: 'Guarded request components', unexplored: [], features: rows,
    mappings: rows.map(f => mapping(f.id)), checks: rows.flatMap(f => [
      { featureId: f.id, nodeId: node.id, kind: 'support', quote: 'send();', explanation: 'A guarded sender callsite.' },
      { featureId: f.id, nodeId: node.id, kind: 'limit', quote: 'if (!enabled) return false;', explanation: 'Disabled requests exit first.' },
    ]) } };
}

test('agent accepts child-before-parent batches without changing old proposal protocol', () => {
  const rows = [feature('leaf', 'child'), feature('child', 'root'), feature('root', undefined, 'Handles a guarded request.')];
  const { agent, draft } = proposal(rows), original = JSON.stringify(draft);
  const result = agent.propose(draft, 'fixture agent', at);
  assert.equal(draft.schemaVersion, 1); assert.equal(JSON.stringify(draft), original);
  assert.equal(result.features.schemaVersion, 3);
  assert.deepEqual(result.features.features.map(f => f.id), ['root', 'child', 'leaf']);
  assert.ok(result.features.mappings.every(m => m.decision === 'proposed'));
  assert.equal(result.receipt.checks.length, 6);
  assert.deepEqual(api.hierarchy(result.features.features).path('leaf').map(f => f.id), ['root', 'child', 'leaf']);
});

test('agent may append a child to an existing feature without rewriting parent meaning or decisions', () => {
  const { agent, draft } = proposal([feature('child', 'parent', 'An explicit bounded child.')], old);
  const result = agent.propose(draft, 'fixture agent', at);
  assert.deepEqual(result.features.features[0], old.features[0]);
  assert.equal(result.features.mappings[0].decision, 'accepted');
  assert.deepEqual(result.features.history.slice(0, old.history.length), old.history);
});

test('agent allows the same child title in different parents but rejects duplicate siblings', () => {
  const rows = [feature('one'), feature('two'), { ...feature('one-child', 'one'), title: 'Guard' },
    { ...feature('two-child', 'two'), title: 'Guard' }];
  const { agent, draft } = proposal(rows);
  assert.equal(agent.propose(draft, 'fixture agent', at).receipt.addedFeatures, 4);
  draft.features[3].parentId = 'one';
  assert.throws(() => agent.propose(draft, 'fixture agent', at), e => e.code === 'EXISTING_FEATURE');
});

test('agent rejects invalid full-batch ancestry and still requires each child own evidence', () => {
  for (const rows of [[feature('a', 'missing')], [feature('a', 'b'), feature('b', 'a')]]) {
    const { agent, draft } = proposal(rows);
    assert.throws(() => agent.propose(draft, 'fixture agent', at), e => e.code === 'INVALID_HIERARCHY');
  }
  const { agent, draft } = proposal([feature('root'), feature('child', 'root')]);
  const missingMapping = structuredClone(draft); missingMapping.mappings.pop();
  assert.throws(() => agent.propose(missingMapping, 'fixture agent', at), e => e.code === 'UNMAPPED_FEATURE');
  draft.checks.pop();
  assert.throws(() => agent.propose(draft, 'fixture agent', at), e => e.code === 'MISSING_CHECK');
});
