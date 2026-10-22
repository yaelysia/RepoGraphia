import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { analyze } from '../dist/analyze.js';
import { ContinuousWorkspace, WorkspaceError } from '../dist/workspace.js';
import { createFeatureMapApi } from '../dist/feature-map.js';
import { featureRevisionHeader } from '../dist/feature-tasks.js';

const api = createFeatureMapApi();
const sourceText = `import { support } from './support.js';
export function notify(enabled: boolean, send: () => void) {
  if (!enabled) return false;
  support();
  send();
  return true;
}
`;
const captured = root => {
  let inputs;
  const graph = analyze(root, { includeSource: true, onInputs: value => { inputs = value; } });
  return { graph, inputs };
};
async function fixture(t, dependencies = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'repographia-feature-store-'));
  const root = path.join(directory, 'project'), out = path.join(directory, 'workspace'), opened = [];
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noLib: true, module: 'NodeNext', moduleResolution: 'NodeNext' }, include: ['*.ts'] }));
  fs.writeFileSync(path.join(root, 'entry.ts'), sourceText);
  fs.writeFileSync(path.join(root, 'support.ts'), 'export function support() { return 1; }\n');
  fs.writeFileSync(path.join(root, 'other.ts'), 'export function outside() { return 2; }\n');
  const open = () => {
    const workspace = new ContinuousWorkspace({ root, directory: out, watch: false, reconcileMs: 0, debounceMs: 0 },
      { analyze: async root => captured(root), ...dependencies });
    opened.push(workspace); return workspace;
  };
  t.after(async () => { for (const workspace of opened) await workspace.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const workspace = open(); await workspace.refresh(true);
  return { directory, root, out, workspace, open, source: path.join(root, 'entry.ts'), manifest: path.join(out, 'workspace.json') };
}
const baseline = workspace => ({ expectedSnapshot: workspace.state().latestSnapshot, expectedFeatureDigest: workspace.featureDigest });
const prepare = (workspace, input = {}) => workspace.prepareFeatureTask({ kind: 'overview', goal: 'Explain the guarded request and its limits.', ...baseline(workspace), ...input });
const decide = (workspace, id, decision = 'apply', input = {}) => workspace.decideFeatureProposal(id,
  { decision, actor: 'human reviewer', reason: 'Review this complete batch and retain the original evidence.', ...baseline(workspace), ...input });
const rejectStatus = status => error => error instanceof WorkspaceError && error.statusCode === status;
function proposal(bundle, id = 'guarded-request') {
  const node = bundle.graph.nodes.find(node => node.name === 'notify'), relation = bundle.graph.relations.find(edge => edge.from === node.id && edge.targetLabel === 'send');
  return { ...featureRevisionHeader(bundle), batchId: id + '-batch', summary: 'Describe the enabled guard and request callsite.',
    features: [{ action: 'add', feature: { id, title: id, summary: 'Request through the supplied sender when enabled.', description: 'The disabled branch returns before the supplied sender callsite.', questions: ['What confirms delivery?'],
      ...(bundle.task.allowed.parentId ? { parentId: bundle.task.allowed.parentId } : {}) }, reason: 'Add an evidenced capability.' }],
    mappings: [{ action: 'add', id: id + '-entry', featureId: id, nodeId: node.id, role: 'entry', rationale: 'The function contains the guard and sender callsite.', relationIds: relation ? [relation.id] : [], reason: 'Preserve exact source evidence.' }],
    retractions: [], checks: [
      { featureId: id, nodeId: node.id, kind: 'support', quote: 'send();', explanation: 'A callsite addresses the supplied sender; it does not prove delivery.' },
      { featureId: id, nodeId: node.id, kind: 'limit', quote: 'if (!enabled) return false;', explanation: 'Disabled requests return before that callsite.' },
    ], exploredFiles: ['entry.ts'], unexplored: ['Receiver implementation and actual delivery.'] };
}
function exploration(bundle, files = bundle.task.allowed.files, batchId = 'exploration-batch') {
  return { ...featureRevisionHeader(bundle), batchId, summary: 'Record a bounded reading declaration.', features: [], mappings: [], retractions: [], checks: [], exploredFiles: files, unexplored: ['No claim of complete behavioral understanding.'] };
}
function edit(workspace, operation, map = workspace.getFeatures()) {
  return api.edit(workspace.getGraph(workspace.state().latestSnapshot), map, operation,
    { expectedRevision: map.revision, actor: 'manual fixture', actorKind: 'manual', at: '2026-10-23T00:00:00Z', reason: 'Explicitly authored fixture content.' });
}
function seedHierarchy(workspace) {
  let map = workspace.getFeatures();
  for (const [id, parentId] of [['root', null], ['child', 'root'], ['grandchild', 'child'], ['deep', 'grandchild'], ['other', null]]) {
    map = edit(workspace, { op: 'feature', feature: { id, title: id, summary: 'A bounded capability.', description: 'An authored explanation.', questions: [], ...(parentId ? { parentId } : {}) } }, map);
  }
  const graph = workspace.getGraph(workspace.state().latestSnapshot);
  for (const [id, featureId, name] of [['child-entry', 'child', 'notify'], ['other-entry', 'other', 'outside']]) {
    map = edit(workspace, { op: 'mapping', id, featureId, nodeId: graph.nodes.find(node => node.name === name).id, role: 'entry', rationale: 'Existing explicit reference.', relationIds: [] }, map);
    map = edit(workspace, { op: 'review', id, decision: 'accepted' }, map);
  }
  workspace.saveFeatures(map, workspace.featureDigest); return map;
}

test('M1 manifests gain immutable feature tasks without moving the feature head, and reopen restores exact bundles', async t => {
  const { workspace, out, manifest, open } = await fixture(t), before = workspace.state();
  assert.equal(JSON.parse(fs.readFileSync(manifest)).featureWork, undefined);
  const input = { kind: 'overview', goal: 'First bounded project overview.', ...baseline(workspace) }, original = structuredClone(input);
  const task = workspace.prepareFeatureTask(input), bundle = workspace.featureTaskBundle(task.id);
  assert.deepEqual(input, original); assert.equal(workspace.featureDigest, before.feature.digest); assert.deepEqual(workspace.state().view, before.view);
  assert.deepEqual(task.allowed.files, bundle.graph.files.map(file => file.path).sort()); assert.deepEqual(task.allowed.featureIds, []);
  assert.deepEqual(bundle.features, workspace.getFeatures()); assert.ok(fs.existsSync(path.join(out, 'feature-tasks', task.bundleDigest + '.json')));
  task.allowed.files.length = 0; bundle.graph.files[0].source = 'changed returned copy';
  const saved = workspace.featureTaskBundle(task.id);
  assert.ok(saved.task.allowed.files.length); assert.notEqual(saved.graph.files[0].source, 'changed returned copy');
  await workspace.close(); const reopened = open();
  assert.deepEqual(reopened.featureTaskBundle(task.id), saved);
  assert.equal(reopened.featureWork().tasks[0].id, task.id); assert.deepEqual(reopened.featureWork().coverage, saved.graph.coverage);
});

test('import stays unapplied; applying one complete batch publishes a proposed map and manual audit that survive reopening', async t => {
  const { workspace, open, source } = await fixture(t), old = baseline(workspace), originalSource = fs.readFileSync(source, 'utf8');
  const task = prepare(workspace), bundle = workspace.featureTaskBundle(task.id), draft = proposal(bundle), original = structuredClone(draft);
  const metadata = workspace.importFeatureProposal({ proposal: draft, author: 'external agent' });
  assert.deepEqual(draft, original); assert.equal(metadata.status, 'pending'); assert.equal(workspace.featureDigest, old.expectedFeatureDigest);
  const review = workspace.featureProposal(metadata.id);
  assert.equal(review.review.status, 'ready'); assert.equal(review.review.document, undefined);
  assert.equal(workspace.featureWork().exploration.summary.declared, 0);
  const result = decide(workspace, metadata.id), map = workspace.getFeatures();
  assert.equal(result.proposal.status, 'applied'); assert.equal(result.proposal.decision.actorKind, 'manual');
  assert.equal(workspace.featureDigest, result.feature.digest); assert.equal(workspace.state().view.featureDigest, result.feature.digest);
  assert.equal(map.mappings[0].decision, 'proposed'); assert.equal(workspace.getFeatures(old.expectedFeatureDigest).features.length, 0);
  const audit = map.history.at(-1);
  assert.equal(audit.operation, 'migration'); assert.equal(audit.after.kind, 'feature-task-apply'); assert.equal(audit.actorKind, 'manual');
  assert.equal(audit.after.batchId, draft.batchId); assert.equal(audit.after.proposalDigest, metadata.id); assert.equal(audit.before.featureDigest, old.expectedFeatureDigest);
  assert.equal(workspace.featureProposal(metadata.id).review.status, 'applied'); assert.equal(workspace.featureWork().exploration.summary.declared, 1);
  assert.equal(workspace.featureWork(old.expectedSnapshot, old.expectedFeatureDigest).exploration.summary.declared, 0, 'historical annotations cannot acquire future exploration');
  assert.equal(fs.readFileSync(source, 'utf8'), originalSource); assert.deepEqual(workspace.featureTaskBundle(task.id), bundle);
  await workspace.close(); const reopened = open();
  assert.equal(reopened.featureDigest, result.feature.digest); assert.equal(reopened.featureProposal(metadata.id).metadata.decision.reason, result.proposal.decision.reason);
  assert.equal(reopened.featureWork().exploration.files.find(file => file.path === 'entry.ts').status, 'declared');
});

test('late proposals remain importable, readable and rejectable while unsynchronized or newer code blocks application', async t => {
  const { workspace, source } = await fixture(t), task = prepare(workspace), draft = proposal(workspace.featureTaskBundle(task.id));
  const old = baseline(workspace); fs.writeFileSync(source, sourceText.replace('return true', 'return false'));
  const metadata = workspace.importFeatureProposal({ proposal: draft, author: 'late agent' });
  assert.equal(workspace.featureProposal(metadata.id).review.status, 'stale');
  assert.ok(workspace.featureProposal(metadata.id).review.reasons.includes('saved-inputs-changed'));
  assert.throws(() => decide(workspace, metadata.id), rejectStatus(409)); assert.equal(workspace.featureDigest, old.expectedFeatureDigest);
  await workspace.refresh();
  assert.ok(workspace.featureProposal(metadata.id).review.reasons.includes('snapshot-conflict'));
  assert.throws(() => decide(workspace, metadata.id), rejectStatus(409));
  const later = workspace.importFeatureProposal({ proposal: proposal(workspace.featureTaskBundle(task.id), 'even-later'), author: 'later agent' });
  assert.equal(workspace.featureProposal(later.id).review.status, 'stale');
  assert.throws(() => decide(workspace, later.id), rejectStatus(409));
  const rejected = decide(workspace, metadata.id, 'reject', old);
  assert.equal(rejected.feature, undefined); assert.equal(rejected.proposal.status, 'rejected'); assert.equal(workspace.featureDigest, old.expectedFeatureDigest);
  assert.equal(workspace.featureWork().exploration.summary.declared, 0); assert.equal(workspace.featureProposal(metadata.id).review.status, 'rejected');
  assert.throws(() => decide(workspace, metadata.id, 'reject'), rejectStatus(409));
});

test('annotation compare-and-swap rejects a second same-baseline batch even when the caller supplies the new head', async t => {
  const { workspace } = await fixture(t), firstTask = prepare(workspace), secondTask = prepare(workspace), old = baseline(workspace);
  const first = workspace.importFeatureProposal({ proposal: proposal(workspace.featureTaskBundle(firstTask.id), 'first'), author: 'agent' });
  const second = workspace.importFeatureProposal({ proposal: proposal(workspace.featureTaskBundle(secondTask.id), 'second'), author: 'agent' });
  decide(workspace, first.id);
  assert.ok(workspace.featureProposal(second.id).review.reasons.includes('feature-conflict'));
  assert.throws(() => decide(workspace, second.id, 'apply', old), rejectStatus(409));
  assert.throws(() => decide(workspace, second.id), rejectStatus(409));
  assert.deepEqual(workspace.getFeatures().features.map(feature => feature.id), ['first']);
  assert.equal(workspace.featureWork().proposals.find(item => item.id === second.id).status, 'pending');
});

test('same task/batch identity cannot name different content; identical imports are immutable and idempotent', async t => {
  const { workspace, out } = await fixture(t), task = prepare(workspace), draft = proposal(workspace.featureTaskBundle(task.id));
  const first = workspace.importFeatureProposal({ proposal: draft, author: 'first declared author' });
  const blob = path.join(out, 'feature-proposals', first.contentDigest + '.json'), bytes = fs.readFileSync(blob, 'utf8');
  assert.deepEqual(workspace.importFeatureProposal({ proposal: structuredClone(draft), author: 'another declared author' }), first);
  const changed = structuredClone(draft); changed.summary = 'Different content using the same batch identity.';
  assert.throws(() => workspace.importFeatureProposal({ proposal: changed, author: 'agent' }), rejectStatus(409));
  decide(workspace, first.id, 'reject');
  assert.equal(workspace.importFeatureProposal({ proposal: draft, author: 'retry author' }).status, 'rejected');
  assert.equal(workspace.featureWork().proposals.length, 1); assert.equal(fs.readFileSync(blob, 'utf8'), bytes);
});

test('an atomic manifest failure leaves the proposal, feature version and view unpublished and allows a safe retry', async t => {
  const { workspace, manifest, open } = await fixture(t), task = prepare(workspace);
  const imported = workspace.importFeatureProposal({ proposal: proposal(workspace.featureTaskBundle(task.id)), author: 'agent' });
  const before = fs.readFileSync(manifest, 'utf8'), state = workspace.state(), rename = fs.renameSync; let publications = 0;
  try {
    fs.renameSync = (from, to) => { if (to === manifest) { publications++; throw new Error('fixture atomic publication failure'); } return rename(from, to); };
    assert.throws(() => decide(workspace, imported.id), /fixture atomic publication failure/);
  } finally { fs.renameSync = rename; }
  assert.equal(publications, 1); assert.equal(fs.readFileSync(manifest, 'utf8'), before); assert.equal(workspace.featureDigest, state.feature.digest);
  assert.deepEqual(workspace.state().view, state.view); assert.equal(workspace.featureProposal(imported.id).metadata.status, 'pending');
  await workspace.close(); const reopened = open();
  assert.equal(reopened.featureDigest, state.feature.digest); assert.equal(reopened.featureProposal(imported.id).metadata.status, 'pending');
  const result = decide(reopened, imported.id), saved = JSON.parse(fs.readFileSync(manifest));
  assert.equal(saved.featureHead, result.feature.digest); assert.equal(saved.view.featureDigest, result.feature.digest);
  assert.ok(saved.featureVersions.some(version => version.digest === result.feature.digest)); assert.equal(saved.featureWork.proposals[0].status, 'applied');
});

test('a saved-file edit after immutable writes prevents both task publication and proposal application', async t => {
  const { workspace, source, out, manifest, open } = await fixture(t), original = fs.readFileSync(source, 'utf8'), rename = fs.renameSync;
  let armed = 'feature-tasks', triggered = false;
  const interrupt = (from, to) => {
    const result = rename(from, to);
    if (!triggered && path.dirname(to) === path.join(out, armed)) { triggered = true; fs.writeFileSync(source, original + '// saved during publication\n'); }
    return result;
  };
  let before = fs.readFileSync(manifest, 'utf8');
  try { fs.renameSync = interrupt; assert.throws(() => prepare(workspace), rejectStatus(409)); }
  finally { fs.renameSync = rename; fs.writeFileSync(source, original); }
  assert.ok(triggered); assert.equal(fs.readFileSync(manifest, 'utf8'), before); assert.equal(workspace.featureWork().tasks.length, 0);
  const task = prepare(workspace), imported = workspace.importFeatureProposal({ proposal: proposal(workspace.featureTaskBundle(task.id)), author: 'agent' });
  before = fs.readFileSync(manifest, 'utf8'); armed = 'features'; triggered = false;
  try { fs.renameSync = interrupt; assert.throws(() => decide(workspace, imported.id), rejectStatus(409)); }
  finally { fs.renameSync = rename; fs.writeFileSync(source, original); }
  assert.ok(triggered); assert.equal(fs.readFileSync(manifest, 'utf8'), before); assert.equal(workspace.featureProposal(imported.id).metadata.status, 'pending');
  assert.equal(workspace.getFeatures().features.length, 0);
  const oldHead = workspace.featureDigest; await workspace.close(); const reopened = open();
  assert.equal(reopened.featureDigest, oldHead); assert.equal(reopened.featureProposal(imported.id).metadata.status, 'pending');
});

test('the final input check runs after writing the manifest temporary and before publishing its pointers', async t => {
  const { workspace, manifest, source } = await fixture(t), task = prepare(workspace);
  const imported = workspace.importFeatureProposal({ proposal: proposal(workspace.featureTaskBundle(task.id)), author: 'agent' });
  const originalSource = fs.readFileSync(source, 'utf8'), originalManifest = fs.readFileSync(manifest, 'utf8'), write = fs.writeFileSync;
  let injected = false;
  try {
    fs.writeFileSync = (file, data, ...options) => {
      const result = write(file, data, ...options);
      if (!injected && typeof file === 'number' && typeof data === 'string' && data.includes('"featureWork"')) {
        const next = JSON.parse(data);
        if (next.featureWork?.proposals.some(proposal => proposal.id === imported.id && proposal.status === 'applied')) {
          injected = true; write(source, originalSource + '// edit during manifest write\n');
        }
      }
      return result;
    };
    assert.throws(() => decide(workspace, imported.id), rejectStatus(409));
  } finally { fs.writeFileSync = write; write(source, originalSource); }
  assert.ok(injected); assert.equal(fs.readFileSync(manifest, 'utf8'), originalManifest);
  assert.equal(workspace.featureProposal(imported.id).metadata.status, 'pending'); assert.equal(workspace.getFeatures().features.length, 0);
});

test('selected non-root feature tasks authorize the complete subtree and related files, preserving its existing parent and unrelated decisions', async t => {
  const { workspace } = await fixture(t); seedHierarchy(workspace);
  const task = prepare(workspace, { kind: 'feature', featureId: 'child' }), bundle = workspace.featureTaskBundle(task.id);
  assert.deepEqual(task.allowed.featureIds, ['child','grandchild','deep']); assert.deepEqual(task.allowed.mappingIds, ['child-entry']);
  assert.deepEqual(task.allowed.files, ['entry.ts','support.ts']); assert.equal(task.allowed.newFeatures, true);
  assert.ok(!task.allowed.featureIds.includes('root')); assert.ok(!task.allowed.files.includes('other.ts'));
  const draft = proposal(bundle); draft.features = [{ action: 'revise', feature: { ...bundle.features.features.find(feature => feature.id === 'child'), description: 'A clarified bounded interpretation.' }, reason: 'Clarify the existing child without moving it.' }];
  draft.mappings = []; draft.checks.forEach(check => { check.featureId = 'child'; });
  const imported = workspace.importFeatureProposal({ proposal: draft, author: 'agent' }), review = workspace.featureProposal(imported.id);
  const reset = review.review.changes.find(change => change.kind === 'mapping' && change.action === 'review-reset' && change.id === 'child-entry');
  assert.ok(reset); assert.equal(reset.before.decision, 'accepted'); assert.equal(reset.after.decision, 'proposed'); assert.equal(review.review.summary.resetMappings, 1);
  decide(workspace, imported.id);
  assert.equal(workspace.getFeatures().features.find(feature => feature.id === 'child').parentId, 'root');
  assert.equal(workspace.getFeatures().mappings.find(mapping => mapping.id === 'child-entry').decision, 'proposed');
  assert.equal(workspace.getFeatures().mappings.find(mapping => mapping.id === 'other-entry').decision, 'accepted');
});

test('missing old association files yield an explicit discovery scope without binding a same-name replacement', async t => {
  const { workspace, source, root } = await fixture(t); seedHierarchy(workspace);
  const old = workspace.getFeatures().mappings.find(mapping => mapping.id === 'child-entry');
  fs.renameSync(source, path.join(root, 'renamed.ts')); await workspace.refresh();
  const task = prepare(workspace, { kind: 'feature', featureId: 'child' }), bundle = workspace.featureTaskBundle(task.id);
  assert.deepEqual(task.allowed.files, bundle.graph.files.map(file => file.path).sort()); assert.ok(task.allowed.files.includes('renamed.ts'));
  const reference = workspace.featureWork().references.mappings.find(mapping => mapping.id === old.id);
  assert.equal(reference.status, 'unmatched'); assert.equal(reference.current, undefined);
  assert.equal(workspace.getFeatures().mappings.find(mapping => mapping.id === old.id).code.file, 'entry.ts');
  assert.equal(workspace.getFeatures().mappings.find(mapping => mapping.id === old.id).decision, 'accepted');
  const draft = proposal(bundle); draft.exploredFiles = ['other.ts']; draft.mappings[0].featureId = 'other';
  assert.throws(() => workspace.importFeatureProposal({ proposal: draft, author: 'agent' }), rejectStatus(400));
});

test('exploration is only an applied self-report tied to a file hash; changed and new files enter changes scope', async t => {
  const { workspace, source, root } = await fixture(t), task = prepare(workspace), bundle = workspace.featureTaskBundle(task.id);
  const imported = workspace.importFeatureProposal({ proposal: exploration(bundle), author: 'agent' });
  assert.equal(workspace.featureWork().exploration.summary.declared, 0);
  decide(workspace, imported.id); assert.equal(workspace.featureWork().exploration.summary.declared, 3);
  fs.writeFileSync(source, sourceText + '// changed after the declared reading\n'); fs.writeFileSync(path.join(root, 'new.ts'), 'export const newlyAdded = () => 3;');
  await workspace.refresh();
  const work = workspace.featureWork(), byPath = new Map(work.exploration.files.map(file => [file.path, file]));
  assert.equal(byPath.get('entry.ts').status, 'changed'); assert.equal(byPath.get('new.ts').status, 'unexplored'); assert.equal(byPath.get('support.ts').status, 'declared');
  assert.ok(byPath.get('entry.ts').records.every(record => record.hash !== byPath.get('entry.ts').hash));
  const changes = prepare(workspace, { kind: 'changes' });
  assert.ok(changes.allowed.files.includes('entry.ts')); assert.ok(changes.allowed.files.includes('new.ts'));
  assert.ok(work.references.unassignedNodes.some(node => node.file === 'new.ts'));
  assert.ok(work.exploration.summary.limitations.some(text => text.includes('自述')));
});

test('reference checks use each mapping original basis and leave unavailable historical evidence unverified', async t => {
  const { workspace, source } = await fixture(t); seedHierarchy(workspace);
  const before = workspace.getFeatures(), oldSnapshot = before.basis.snapshot;
  fs.writeFileSync(source, sourceText + '// source changed\n'); await workspace.refresh();
  const task = prepare(workspace), bundle = workspace.featureTaskBundle(task.id), imported = workspace.importFeatureProposal({ proposal: exploration(bundle), author: 'agent' });
  decide(workspace, imported.id);
  const retained = workspace.getFeatures().mappings.find(mapping => mapping.id === 'child-entry');
  assert.equal(retained.basis.snapshot, oldSnapshot); assert.equal(retained.decision, 'accepted');
  assert.equal(workspace.featureWork().references.mappings.find(mapping => mapping.id === retained.id).status, 'needs-review');
  const missing = workspace.getFeatures(); missing.mappings.find(mapping => mapping.id === 'other-entry').basis.snapshot = 'a'.repeat(64);
  workspace.saveFeatures(missing, workspace.featureDigest);
  const unknown = workspace.featureWork().references.mappings.find(mapping => mapping.id === 'other-entry');
  assert.equal(unknown.status, 'unverified'); assert.deepEqual(unknown.reasons, ['missing-baseline-graph']);
});

test('damaged immutable proposal/task data is rejected rather than repaired or used to apply', async t => {
  const { workspace, out, manifest } = await fixture(t), task = prepare(workspace), bundle = workspace.featureTaskBundle(task.id);
  const imported = workspace.importFeatureProposal({ proposal: proposal(bundle), author: 'agent' }), before = fs.readFileSync(manifest, 'utf8');
  const proposalFile = path.join(out, 'feature-proposals', imported.contentDigest + '.json'), original = fs.readFileSync(proposalFile, 'utf8');
  fs.writeFileSync(proposalFile, original + ' ');
  assert.throws(() => workspace.featureProposal(imported.id), rejectStatus(500)); assert.throws(() => decide(workspace, imported.id), rejectStatus(500));
  assert.equal(fs.readFileSync(manifest, 'utf8'), before); assert.equal(fs.readFileSync(proposalFile, 'utf8'), original + ' ');
  fs.writeFileSync(proposalFile, original);
  const taskFile = path.join(out, 'feature-tasks', task.bundleDigest + '.json'); fs.appendFileSync(taskFile, ' ');
  assert.throws(() => workspace.featureTaskBundle(task.id), rejectStatus(500)); assert.throws(() => decide(workspace, imported.id), rejectStatus(500));
  assert.equal(fs.readFileSync(manifest, 'utf8'), before);
});

test('closed workspaces reject every feature mutator and existing save/baseline mutators without changing persisted data', async t => {
  const { workspace, manifest } = await fixture(t), task = prepare(workspace), bundle = workspace.featureTaskBundle(task.id), draft = proposal(bundle);
  const imported = workspace.importFeatureProposal({ proposal: draft, author: 'agent' }), current = baseline(workspace), map = workspace.getFeatures(), view = workspace.state().view;
  const before = fs.readFileSync(manifest, 'utf8'); await workspace.close();
  for (const operation of [() => prepare(workspace), () => workspace.importFeatureProposal({ proposal: draft, author: 'agent' }),
    () => decide(workspace, imported.id), () => decide(workspace, imported.id, 'reject'), () => workspace.saveFeatures(map, current.expectedFeatureDigest), () => workspace.saveView(view)])
    assert.throws(operation, rejectStatus(409));
  await assert.rejects(workspace.beginTask('closed baseline', current.expectedFeatureDigest), rejectStatus(409)); await assert.rejects(workspace.refresh(), rejectStatus(409));
  assert.equal(fs.readFileSync(manifest, 'utf8'), before); assert.equal(workspace.featureProposal(imported.id).review.status, 'stale');
});

test('invalid scopes, unknown IDs and missing baseline inputs fail without publishing a task', async t => {
  const { workspace, source, manifest } = await fixture(t), before = fs.readFileSync(manifest, 'utf8');
  assert.throws(() => prepare(workspace, { kind: 'feature', featureId: 'unknown' }), rejectStatus(404));
  assert.throws(() => prepare(workspace, { kind: 'overview', featureId: 'unexpected' }), rejectStatus(400));
  assert.throws(() => prepare(workspace, { expectedFeatureDigest: 'a'.repeat(64) }), rejectStatus(409));
  assert.throws(() => workspace.featureTaskBundle('../../outside'), rejectStatus(404)); assert.throws(() => workspace.featureProposal('unknown'), rejectStatus(404));
  assert.throws(() => prepare(workspace, { expectedSnapshot: undefined }), rejectStatus(400));
  fs.writeFileSync(source, sourceText + '// unsynchronized\n'); assert.throws(() => prepare(workspace), rejectStatus(409));
  assert.equal(fs.readFileSync(manifest, 'utf8'), before);
});
