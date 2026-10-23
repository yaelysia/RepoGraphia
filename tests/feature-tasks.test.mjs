import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyze } from '../dist/analyze.js';
import { digest } from '../dist/agent.js';
import { createFeatureMapApi } from '../dist/feature-map.js';
import { createFeatureTask, validateFeatureTaskBundle, featureRevisionHeader, checkFeatureRevision } from '../dist/feature-tasks.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repographia-feature-task-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));
fs.writeFileSync(path.join(root, 'main.ts'), `export function notify(enabled: boolean, send: () => void) {
  if (!enabled) return false;
  const message = "Ready 'now'";
  send();
  return message;
}
export function deliver() { return "queued"; }
notify(true, deliver);
`);
fs.writeFileSync(path.join(root, 'other.ts'), `export function untouched() { return "untouched"; }
untouched();
`);
const graph = analyze(root, { includeSource: true }), api = createFeatureMapApi(), at = '2026-10-23T00:00:00Z';
const node = name => graph.nodes.find(node => node.name === name), entry = node('notify'), delivery = node('deliver'), other = node('untouched');
const call = graph.relations.find(edge => edge.targetLabel === 'send');
const edit = (map, operation) => api.edit(graph, map, operation, { expectedRevision: map.revision, actor: 'human fixture', actorKind: 'manual', at, reason: 'Explicit fixture decision.' });
const feature = (id, parentId) => ({ id, title: 'Capability ' + id, summary: 'A bounded explanation.', description: 'Calls the supplied sender when enabled; no delivery guarantee.', questions: [], ...(parentId ? { parentId } : {}) });
let original = api.create(graph);
for (const id of ['notify', 'unrelated']) original = edit(original, { op: 'feature', feature: feature(id) });
for (const [id, featureId, target, decision] of [['entry', 'notify', entry, 'accepted'], ['support', 'notify', delivery, 'rejected'], ['other', 'unrelated', other, 'accepted']]) {
  original = edit(original, { op: 'mapping', id, featureId, nodeId: target.id, role: 'implementation', rationale: 'Explicit fixture association.', relationIds: target.id === entry.id ? [call.id] : [] });
  original = edit(original, { op: 'review', id, decision });
}
const scope = () => ({ files: ['main.ts'], featureIds: ['notify'], mappingIds: ['entry', 'support'], newFeatures: true, parentId: null });
const task = (options = {}) => createFeatureTask(options.graph ?? graph, options.features ?? original, options.kind ?? 'overview', 'Explain this bounded capability.', options.allowed ?? scope(), at);
const checks = (featureId, nodeId = entry.id) => [
  { featureId, nodeId, kind: 'support', quote: 'send();', explanation: 'This callsite requests the supplied sender.' },
  { featureId, nodeId, kind: 'limit', quote: 'if (!enabled) return false;', explanation: 'Disabled input returns before the callsite.' },
];
const revision = bundle => ({ ...featureRevisionHeader(bundle), batchId: 'batch-1', summary: 'Bounded source-based revision.', features: [], mappings: [], retractions: [], checks: [], exploredFiles: [], unexplored: ['Transport outcome has not been established.'] });
function adding(bundle, proposed = [feature('new-child', 'notify')]) {
  return { ...revision(bundle), features: proposed.map(feature => ({ action: 'add', feature, reason: 'Separate an evidenced part.' })),
    mappings: proposed.map(feature => ({ action: 'add', id: feature.id + '-entry', featureId: feature.id, nodeId: entry.id, role: 'entry', rationale: 'The enabled guard precedes the sender callsite.', relationIds: [call.id], reason: 'Record the exact implementation.' })),
    checks: proposed.flatMap(feature => checks(feature.id)), exploredFiles: ['main.ts'] };
}
const check = (bundle, proposal) => checkFeatureRevision(bundle, proposal, 'declared agent', at);
const replace = bundle => ({ ...revision(bundle), mappings: [{ action: 'replace', id: 'entry', featureId: 'notify', nodeId: entry.id,
  role: 'entry', rationale: 'Re-examined the guarded sender callsite.', relationIds: [call.id], reason: 'Current source was read again.' }], checks: checks('notify') });

test('task bundles freeze exact graph, annotation digest and scope without exposing input references', () => {
  const allowed = scope(), before = JSON.stringify([graph, original, allowed]), bundle = task({ allowed });
  assert.equal(bundle.task.graphDigest, digest(graph)); assert.equal(bundle.task.featureDigest, digest(original));
  assert.equal(bundle.task.featureRevision, original.revision); assert.equal(bundle.taskDigest, digest(bundle.task));
  bundle.graph.files[0].source = 'changed outside input'; bundle.features.features[0].title = 'changed'; bundle.task.allowed.files.push('other.ts');
  assert.equal(JSON.stringify([graph, original, allowed]), before);
  for (const mutate of [b => { b.graph.files[0].source += 'tampered'; }, b => { b.features.features[0].title = 'tampered'; },
    b => { b.task.allowed.files.push('other.ts'); }, b => { b.taskDigest = '0'.repeat(64); }]) {
    const bad = task(); mutate(bad); assert.throws(() => validateFeatureTaskBundle(bad), /match|digest/i);
  }
});

test('same-batch ancestors may follow their children and do not impose a one-level drilldown limit', () => {
  const bundle = task({ kind: 'feature', allowed: { ...scope(), parentId: 'notify' } });
  const proposal = adding(bundle, [feature('grandchild', 'child'), feature('child', 'parent'), feature('parent', 'notify')]);
  const before = JSON.stringify([bundle, proposal]), result = check(bundle, proposal);
  assert.equal(JSON.stringify([bundle, proposal]), before);
  assert.deepEqual(api.hierarchy(result.document.features).path('grandchild').map(feature => feature.id), ['notify', 'parent', 'child', 'grandchild']);
  assert.equal(result.document.schemaVersion, 3); assert.equal(result.summary.addedFeatures, 3); assert.equal(result.summary.addedMappings, 3);
  assert.ok(result.document.mappings.filter(mapping => mapping.id.endsWith('-entry')).every(mapping => mapping.decision === 'proposed'));
  for (const mapping of original.mappings) assert.deepEqual(result.document.mappings.find(item => item.id === mapping.id), mapping);
  assert.deepEqual(result.document.history.slice(0, original.history.length), original.history);
  for (const quote of result.checks) assert.equal(graph.files.find(file => file.path === quote.file).source.slice(quote.start, quote.end), quote.quote);
  result.document.features[0].title = 'caller mutation'; result.changes[0].after.title = 'caller mutation';
  assert.equal(JSON.stringify([bundle, proposal]), before);
});

test('task scope rejects edits to other files, features, mappings and exploration records', () => {
  const bundle = task();
  for (const mutate of [
    p => { p.mappings[0].nodeId = other.id; },
    p => { p.mappings[0].featureId = 'unrelated'; },
    p => { p.features = [{ action: 'revise', feature: feature('unrelated'), reason: 'Not authorized.' }]; },
    p => { p.mappings[0] = { ...p.mappings[0], action: 'replace', id: 'other', featureId: 'unrelated' }; },
    p => { p.retractions.push({ mappingId: 'other', reason: 'Not authorized.' }); },
    p => { p.exploredFiles.push('other.ts'); },
    p => { p.features[0].feature.parentId = 'unrelated'; },
  ]) { const proposal = adding(bundle); mutate(proposal); assert.throws(() => check(bundle, proposal), /outside task scope|Parent is outside/); }
  const closed = task({ allowed: { ...scope(), newFeatures: false } });
  assert.throws(() => check(closed, adding(closed)), /outside task scope/);
});

test('the complete final hierarchy rejects cycles, unknown parents, self-parenting and duplicate sibling titles', () => {
  const bundle = task();
  for (const features of [
    [feature('a', 'b'), feature('b', 'a')], [feature('a', 'missing')], [feature('a', 'a')],
    [feature('a', 'notify'), { ...feature('b', 'notify'), title: '  CAPABILITY A  ' }],
  ]) assert.throws(() => check(bundle, adding(bundle, features)), /cyclic|unknown parent|contain itself|Duplicate feature name/);
});

test('a selected-feature task cannot add a disconnected root or move its descendant out of the selected subtree', () => {
  const bundle = task({ kind: 'feature', allowed: { ...scope(), parentId: 'notify' } });
  assert.throws(() => check(bundle, adding(bundle, [feature('outside-root')])), /selected subtree/);
  let nested = edit(original, { op: 'feature', feature: feature('existing-child', 'notify') });
  const scoped = task({ features: nested, kind: 'feature', allowed: { ...scope(), featureIds: ['notify', 'existing-child'], parentId: 'notify' } });
  const proposal = revision(scoped); proposal.features = [{ action: 'revise', feature: feature('existing-child'), reason: 'Attempt to detach.' }];
  assert.throws(() => check(scoped, proposal), /selected subtree/);
});

test('revising any authored feature meaning returns its accepted mappings to proposed and preserves unrelated decisions', () => {
  const allowed = { ...scope(), featureIds: ['notify', 'unrelated'] };
  for (const mutate of [f => { f.title += ' changed'; }, f => { f.summary += ' changed'; }, f => { f.description += ' Changed limit.'; },
    f => { f.questions.push('New uncertainty?'); }, f => { f.parentId = 'unrelated'; }]) {
    const bundle = task({ allowed }), changed = structuredClone(original.features.find(feature => feature.id === 'notify')); mutate(changed);
    const proposal = { ...revision(bundle), features: [{ action: 'revise', feature: changed, reason: 'Reassess the stated meaning.' }], checks: checks('notify') };
    const result = check(bundle, proposal);
    assert.equal(result.document.mappings.find(mapping => mapping.id === 'entry').decision, 'proposed');
    const reset = result.changes.filter(change => change.action === 'review-reset');
    assert.equal(result.summary.resetMappings, 1); assert.equal(reset.length, 1);
    assert.equal(reset[0].id, 'entry'); assert.equal(reset[0].before.decision, 'accepted'); assert.equal(reset[0].after.decision, 'proposed');
    assert.equal(result.document.mappings.find(mapping => mapping.id === 'support').decision, 'rejected');
    assert.deepEqual(result.document.mappings.find(mapping => mapping.id === 'other'), original.mappings.find(mapping => mapping.id === 'other'));
    assert.deepEqual(result.document.history.slice(0, original.history.length), original.history);
  }
});

test('object-key order alone does not revoke an unchanged feature decision', () => {
  const bundle = task(), unchanged = Object.fromEntries(Object.entries(original.features.find(feature => feature.id === 'notify')).reverse());
  const proposal = { ...revision(bundle), features: [{ action: 'revise', feature: unchanged, reason: 'Same authored meaning.' }], checks: checks('notify') };
  const result = check(bundle, proposal);
  assert.equal(result.document.mappings.find(mapping => mapping.id === 'entry').decision, 'accepted');
  assert.equal(original.mappings.find(mapping => mapping.id === 'entry').decision, 'accepted');
});

test('a task rooted at a nested feature can retain its outside parent without authorizing that ancestor', () => {
  const nested = edit(original, { op: 'feature', feature: feature('notify', 'unrelated') });
  const bundle = task({ features: nested, kind: 'feature', allowed: { ...scope(), parentId: 'notify' } });
  const revised = { ...feature('notify', 'unrelated'), summary: 'An updated explanation inside the selected subtree.' };
  const proposal = { ...revision(bundle), features: [{ action: 'revise', feature: revised, reason: 'Clarify the selected feature.' }], checks: checks('notify') };
  const result = check(bundle, proposal);
  assert.equal(result.document.features.find(feature => feature.id === 'notify').parentId, 'unrelated');
  assert.deepEqual(result.document.features.find(feature => feature.id === 'unrelated'), nested.features.find(feature => feature.id === 'unrelated'));
  const detached = structuredClone(proposal); delete detached.features[0].feature.parentId;
  assert.throws(() => check(bundle, detached), /retain its original parent/);
  const ancestor = structuredClone(proposal); ancestor.features.push({ action: 'revise', feature: feature('unrelated'), reason: 'Try changing an unauthorized ancestor.' });
  assert.throws(() => check(bundle, ancestor), /outside task scope/);
});

test('replacing a previously accepted association captures a new proposed record and retains its decision history', () => {
  const bundle = task(), result = check(bundle, replace(bundle));
  const mapping = result.document.mappings.find(mapping => mapping.id === 'entry');
  assert.equal(mapping.decision, 'proposed'); assert.deepEqual(mapping.basis, api.basis(graph));
  const history = result.document.history.at(-1); assert.equal(history.operation, 'mapping');
  assert.equal(history.before.decision, 'accepted'); assert.equal(history.after.decision, 'proposed'); assert.equal(history.actorKind, 'agent');
  assert.equal(result.summary.replacedMappings, 1);
  assert.equal(result.summary.resetMappings, 0); assert.equal(result.changes.filter(change => change.id === 'entry').length, 1);
});

test('a reasoned retraction retains the old mapping, anchors and history as inactive', () => {
  const bundle = task(), proposal = { ...revision(bundle), retractions: [{ mappingId: 'entry', reason: 'The earlier association overstates the observed result.' }] };
  const before = JSON.stringify([bundle, proposal]), result = check(bundle, proposal), mapping = result.document.mappings.find(mapping => mapping.id === 'entry');
  assert.equal(JSON.stringify([bundle, proposal]), before); assert.equal(mapping.decision, 'rejected');
  const old = original.mappings.find(mapping => mapping.id === 'entry');
  assert.deepEqual(mapping.code, old.code); assert.deepEqual(mapping.evidence, old.evidence); assert.deepEqual(mapping.basis, old.basis);
  assert.equal(result.document.mappings.length, original.mappings.length); assert.deepEqual(result.document.history.slice(0, original.history.length), original.history);
  const history = result.document.history.at(-1); assert.equal(history.operation, 'review'); assert.equal(history.actorKind, 'agent');
  assert.equal(history.before.decision, 'accepted'); assert.equal(history.after.decision, 'rejected'); assert.match(history.reason, /overstates/);
  assert.equal(result.summary.retractions, 1); assert.equal(result.changes[0].kind, 'retraction');
});

test('retractions reject missing reasons, already rejected mappings and repeated or combined operations', () => {
  const bundle = task();
  for (const retractions of [[{ mappingId: 'entry', reason: ' ' }], [{ mappingId: 'support', reason: 'Already inactive.' }],
    [{ mappingId: 'entry', reason: 'One.' }, { mappingId: 'entry', reason: 'Two.' }]])
    assert.throws(() => check(bundle, { ...revision(bundle), retractions }), /reason|inactive|duplicated/);
  const proposal = replace(bundle); proposal.retractions.push({ mappingId: 'entry', reason: 'Conflicting second operation.' });
  assert.throws(() => check(bundle, proposal), /duplicated/);
});

test('a task against new code preserves untouched old mapping bases instead of upgrading historical acceptance', () => {
  const currentGraph = structuredClone(graph); currentGraph.project.snapshot = 'f'.repeat(64);
  const bundle = task({ graph: currentGraph }), before = JSON.stringify([bundle, original]), result = check(bundle, replace(bundle));
  assert.equal(JSON.stringify([bundle, original]), before); assert.equal(result.document.basis.snapshot, currentGraph.project.snapshot);
  assert.equal(result.document.mappings.find(mapping => mapping.id === 'entry').decision, 'proposed');
  assert.equal(result.document.mappings.find(mapping => mapping.id === 'entry').basis.snapshot, currentGraph.project.snapshot);
  for (const id of ['support', 'other']) assert.deepEqual(result.document.mappings.find(mapping => mapping.id === id), original.mappings.find(mapping => mapping.id === id));
  const assessment = api.assess(currentGraph, result.document).mappings.find(row => row.mapping.id === 'other');
  assert.equal(assessment.current, false); assert.equal(assessment.mapping.decision, 'accepted'); assert.ok(assessment.issues.includes('changed-snapshot'));
  assert.ok(result.document.history.some(row => row.operation === 'migration' && row.after.retainedOriginalReferences === true));
});

test('every frozen header field rejects a late or differently based revision', () => {
  const bundle = task();
  for (const key of ['revisionProtocol', 'taskId', 'taskDigest', 'snapshot', 'baseDigest', 'expectedRevision']) {
    const proposal = adding(bundle); proposal[key] = typeof proposal[key] === 'number' ? proposal[key] + 1 : 'changed';
    assert.throws(() => check(bundle, proposal), error => error.code === 'TASK_CONFLICT', key);
  }
  const changedBase = structuredClone(original); changedBase.features[0].description += ' Different same-revision content.';
  const next = task({ features: changedBase }); assert.equal(next.task.featureRevision, bundle.task.featureRevision);
  assert.notEqual(next.task.featureDigest, bundle.task.featureDigest);
  const proposal = adding(bundle); proposal.taskId = next.task.id; proposal.taskDigest = next.taskDigest;
  assert.throws(() => check(next, proposal), error => error.code === 'TASK_CONFLICT');
});

test('a rejected feature/code pair cannot be revived by a new ID or role', () => {
  const bundle = task(), proposal = revision(bundle);
  proposal.mappings = [{ action: 'add', id: 'bypass-review', featureId: 'notify', nodeId: delivery.id, role: 'entry', rationale: 'A new ID does not remove the old decision.', relationIds: [], reason: 'Attempted retry.' }];
  assert.throws(() => check(bundle, proposal), /including rejected records/);
  assert.equal(original.mappings.find(mapping => mapping.id === 'support').decision, 'rejected');
});

test('source quotes preserve quotes and whitespace and reject missing, ambiguous or unrelated evidence', () => {
  const bundle = task(), proposal = adding(bundle); proposal.checks[0].quote = 'const message = "Ready \'now\'";';
  const result = check(bundle, proposal), evidence = result.checks[0];
  assert.equal(graph.files.find(file => file.path === evidence.file).source.slice(evidence.start, evidence.end), proposal.checks[0].quote);
  for (const mutate of [p => { p.checks[0].quote = 'sendAll();'; }, p => { p.checks[0].quote = 'return'; },
    p => { p.checks[0].nodeId = delivery.id; }, p => { p.checks.pop(); }, p => { p.checks[0].featureId = 'unrelated'; }]) {
    const bad = adding(bundle); mutate(bad); assert.throws(() => check(bundle, bad), /Quote|current mapping|support and limit|unrelated/);
  }
});

test('unknown fields and spoofed decisions or actors cannot enter a revision', () => {
  const bundle = task();
  for (const mutate of [p => { p.decision = 'accepted'; }, p => { p.actorKind = 'manual'; }, p => { p.features[0].feature.decision = 'accepted'; },
    p => { p.features[0].op = 'review'; }, p => { p.mappings[0].decision = 'accepted'; }, p => { p.mappings[0].op = 'mapping'; },
    p => { p.checks[0].fileHash = '0'.repeat(64); }, p => { p.retractions.push({ mappingId: 'entry', reason: 'With an unknown field.', remove: true }); }]) {
    const proposal = adding(bundle); mutate(proposal); assert.throws(() => check(bundle, proposal), /unknown field/);
  }
});

test('missing or tampered full source cannot be used for current mapping evidence', () => {
  for (const mutate of [g => { delete g.files.find(file => file.path === 'main.ts').source; },
    g => { g.files.find(file => file.path === 'main.ts').source += '// tampered'; }]) {
    const changed = structuredClone(graph); mutate(changed);
    const bundle = task({ graph: changed }); assert.throws(() => check(bundle, replace(bundle)), /source|required|hash/i);
  }
});

test('exploration-only records capture exact file versions without implying new mappings or acceptance', () => {
  const bundle = task(), proposal = { ...revision(bundle), exploredFiles: ['main.ts'] }, result = check(bundle, proposal);
  assert.deepEqual(result.document, original); assert.deepEqual(result.changes, []);
  assert.deepEqual(result.exploredFiles, [{ path: 'main.ts', hash: graph.files.find(file => file.path === 'main.ts').hash }]);
  assert.match(result.warnings.join(' '), /declared by the Agent, not independently proved/);
  assert.throws(() => check(bundle, revision(bundle)), /Empty revision/);
  assert.throws(() => check(bundle, { ...proposal, exploredFiles: ['main.ts', 'main.ts'] }), /Duplicate explored/);
});

test('unrelated relation evidence and duplicate feature or mapping operations fail atomically', () => {
  const bundle = task();
  for (const mutate of [p => { p.features.push(structuredClone(p.features[0])); }, p => { p.mappings.push(structuredClone(p.mappings[0])); },
    p => { p.mappings[0].relationIds = [graph.relations.find(edge => edge.targetLabel === 'untouched').id]; }]) {
    const proposal = adding(bundle), before = JSON.stringify(bundle); mutate(proposal);
    assert.throws(() => check(bundle, proposal), /Duplicate|unrelated-relation/); assert.equal(JSON.stringify(bundle), before);
  }
});
