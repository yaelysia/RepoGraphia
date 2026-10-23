import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { analyze } from '../dist/analyze.js';
import { ContinuousWorkspace, WorkspaceError } from '../dist/workspace.js';
import { createFeatureMapApi } from '../dist/feature-map.js';
import { validDevelopmentReviewState } from '../dist/development-review-store.js';

const api = createFeatureMapApi();
const text = 'export function report() { return "csv"; }\n';
const rejected = status => error => error instanceof WorkspaceError && error.statusCode === status;
const intent = () => ({ goal: 'Explain the new export behavior and verify the header.', author: 'project owner', source: 'manual',
  featureIds: ['report'], checks: [{ id: 'header', text: 'The exported header is preserved.' }] });
async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'repographia-development-'));
  const root = path.join(directory, 'source'), out = path.join(directory, 'workspace'), opened = [];
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noLib: true }, include: ['*.ts'] }));
  const source = path.join(root, 'entry.ts'); fs.writeFileSync(source, text);
  const open = () => {
    const workspace = new ContinuousWorkspace({ root, directory: out, watch: false, reconcileMs: 0, debounceMs: 0 }, {
      analyze: async root => { let inputs; const graph = analyze(root, { includeSource: true, onInputs: value => { inputs = value; } }); return { graph, inputs }; },
    }); opened.push(workspace); return workspace;
  };
  t.after(async () => { for (const workspace of opened) await workspace.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const workspace = open(); await workspace.refresh(true);
  const graph = workspace.getGraph(workspace.state().latestSnapshot);
  let map = workspace.getFeatures();
  const edit = operation => { map = api.edit(graph, map, operation, { expectedRevision: map.revision, actor: 'fixture', actorKind: 'manual', at: '2026-10-23T00:00:00Z', reason: 'Author explicit fixture records.' }); };
  edit({ op: 'feature', feature: { id: 'report', title: 'Export reports', summary: 'Create report output.', description: 'The indexed function returns a format label.', questions: [] } });
  edit({ op: 'mapping', id: 'report-entry', featureId: 'report', nodeId: graph.nodes.find(node => node.name === 'report').id, role: 'entry', rationale: 'Explicit fixture association.', relationIds: [] });
  edit({ op: 'review', id: 'report-entry', decision: 'accepted' });
  workspace.saveFeatures(map, workspace.featureDigest);
  return { workspace, root, out, open, source, manifest: path.join(out, 'workspace.json') };
}
async function task(workspace, declaration = intent()) { return workspace.beginTask('Add a report format', workspace.featureDigest, declaration); }
function input(response, record = { kind: 'review', target: { kind: 'round', id: response.report.task.id }, decision: 'reviewed', actor: 'human reader', reason: 'Reviewed this fixed code and annotation comparison.' }) {
  return { taskId: response.report.task.id, snapshot: response.report.after.snapshot, featureDigest: response.report.after.featureDigest,
    comparisonDigest: response.report.comparisonDigest, expectedRevision: response.revision, record };
}
function reviseExplanation(workspace, summary) {
  const old = workspace.getFeatures(), graph = workspace.getGraph(old.basis.snapshot);
  const next = api.edit(graph, old, { op: 'feature', feature: { ...old.features[0], summary } },
    { expectedRevision: old.revision, actor: 'reader', actorKind: 'manual', at: '2026-10-23T01:00:00Z', reason: 'Refine the explicit explanation.' });
  workspace.saveFeatures(next, workspace.featureDigest);
}

test('task intent freezes explicit scope and checks, copies cannot mutate it, and legacy tasks remain readable', async t => {
  const { workspace, open } = await fixture(t), declaration = intent();
  const pending = task(workspace, declaration); declaration.featureIds.length = 0; declaration.checks[0].text = 'Mutated external object';
  const started = await pending;
  assert.deepEqual(started.intent, intent());
  started.intent.featureIds.length = 0; workspace.state().tasks[0].intent.checks.length = 0;
  const saved = workspace.getTask(started.id); assert.deepEqual(saved.intent, intent());
  const legacy = await workspace.beginTask('Old title-only task', workspace.featureDigest);
  const legacyReview = workspace.developmentReview(legacy.id);
  assert.equal(legacyReview.report.task.intent, undefined); assert.equal(legacyReview.report.features[0].scope, 'undeclared');
  await workspace.close(); const reopened = open();
  assert.deepEqual(reopened.getTask(saved.id), saved); assert.equal(reopened.getTask(legacy.id).intent, undefined);
});

test('invalid, invented, duplicate and over-budget goal scope never creates a task', async t => {
  const { workspace } = await fixture(t);
  for (const invalid of [null, { ...intent(), invented: true }, { ...intent(), featureIds: ['missing'] },
    { ...intent(), featureIds: ['report', 'report'] }, { ...intent(), checks: [{ id: 'same', text: 'one' }, { id: 'same', text: 'two' }] },
    { ...intent(), checks: Array.from({ length: 51 }, (_, i) => ({ id: 'c' + i, text: 'check' })) }])
    await assert.rejects(task(workspace, invalid), rejected(400));
  assert.equal(workspace.state().tasks.length, 0);
});

test('reading comparison is nonmutating and accepted mapping is not a code review or a test result', async t => {
  const { workspace, manifest } = await fixture(t), started = await task(workspace);
  const old = fs.readFileSync(manifest, 'utf8'), map = workspace.getFeatures();
  const report = workspace.developmentReview(started.id);
  assert.equal(report.revision, 0); assert.deepEqual(report.records, []); assert.deepEqual(report.history, []);
  assert.equal(report.report.before.featureDigest, started.featureDigest);
  assert.equal(report.report.after.featureDigest, workspace.featureDigest);
  assert.equal(report.report.features[0].references.after[0].decision, 'accepted');
  assert.equal(report.report.summary.declaredWithoutObservedChanges, 1);
  assert.equal(fs.readFileSync(manifest, 'utf8'), old); assert.deepEqual(workspace.getFeatures(), map);
});

test('review, verification self-report and Agent explanation append independently and survive restart', async t => {
  const { workspace, out, open, source } = await fixture(t), started = await task(workspace), map = workspace.getFeatures();
  const sourceBefore = fs.readFileSync(source, 'utf8');
  let response = workspace.developmentReview(started.id);
  response = workspace.recordDevelopmentReview(input(response));
  assert.equal(response.revision, 1); assert.equal(response.records[0].kind, 'review');
  response = workspace.recordDevelopmentReview(input(response, { kind: 'verification', target: { kind: 'criterion', id: 'header' }, status: 'passed',
    source: 'agent', author: 'external Codex declaration', actor: 'human importer', method: 'Declared command: npm test', evidence: 'Agent reported a pass; this tool did not execute it.' }));
  assert.equal(response.records[1].source, 'agent'); assert.equal(response.records[1].status, 'passed');
  response = workspace.recordDevelopmentReview(input(response, { kind: 'note', target: { kind: 'feature', id: 'report' }, source: 'agent', author: 'Codex',
    actor: 'human importer', text: 'A claimed explanation remains separate from observed code facts.' }));
  assert.equal(response.revision, 3); assert.equal(response.history[0].recordCount, 3);
  assert.deepEqual(response.records.map(record => record.sequence), [1, 2, 3]);
  assert.deepEqual(workspace.getFeatures(), map); assert.equal(fs.readFileSync(source, 'utf8'), sourceBefore);
  assert.equal(fs.readdirSync(path.join(out, 'development-reviews')).filter(file => file.endsWith('.json')).length, 1);
  const key = response.report.comparisonDigest, expected = structuredClone(response.records);
  response.records[0].reason = 'mutated return'; response.report.task.intent.goal = 'mutated return';
  await workspace.close(); const reopened = open(), recovered = reopened.savedDevelopmentReview(key);
  assert.deepEqual(recovered.records, expected); assert.equal(recovered.current.writable, false);
  assert.equal(recovered.report.task.intent.goal, intent().goal); assert.deepEqual(reopened.getFeatures(), map);
});

test('another page cannot overwrite review revision; retries cannot duplicate a successfully committed record', async t => {
  const { workspace } = await fixture(t), started = await task(workspace);
  const viewed = workspace.developmentReview(started.id), request = input(viewed), original = structuredClone(request);
  const saved = workspace.recordDevelopmentReview(request);
  assert.deepEqual(request, original); assert.equal(saved.revision, 1);
  assert.throws(() => workspace.recordDevelopmentReview(request), rejected(409));
  const fresh = workspace.developmentReview(started.id);
  const changed = workspace.recordDevelopmentReview(input(fresh, { ...request.record, decision: 'needs-work', reason: 'A second manual assessment keeps the first in history.' }));
  assert.equal(changed.revision, 2); assert.equal(changed.records[0].decision, 'reviewed'); assert.equal(changed.records[1].decision, 'needs-work');
});

test('source changes before rebuild and later snapshots block stale submissions; new version starts unreviewed', async t => {
  const { workspace, source } = await fixture(t), started = await task(workspace);
  const first = workspace.recordDevelopmentReview(input(workspace.developmentReview(started.id))), stale = input(first);
  fs.writeFileSync(source, text.replace('"csv"', '"json"'));
  assert.throws(() => workspace.recordDevelopmentReview(stale), rejected(409));
  assert.equal(workspace.developmentReview(started.id).current.writable, false);
  await workspace.refresh(true);
  assert.throws(() => workspace.recordDevelopmentReview(stale), rejected(409));
  const next = workspace.developmentReview(started.id);
  assert.notEqual(next.report.comparisonDigest, first.report.comparisonDigest); assert.equal(next.revision, 0);
  assert.equal(next.report.summary.newlyPendingReferences, 1); assert.equal(next.report.summary.affectedFeatures, 1);
  assert.equal(next.history[0].recordCount, 1); assert.deepEqual(workspace.savedDevelopmentReview(first.report.comparisonDigest).records, first.records);
});

test('annotation-only edits do not inherit earlier review and preserve frozen baseline explanation', async t => {
  const { workspace } = await fixture(t), started = await task(workspace);
  const first = workspace.recordDevelopmentReview(input(workspace.developmentReview(started.id)));
  reviseExplanation(workspace, 'Create a format label; actual export behavior needs evidence.');
  const next = workspace.developmentReview(started.id);
  assert.equal(next.report.after.snapshot, first.report.after.snapshot); assert.notEqual(next.report.after.featureDigest, first.report.after.featureDigest);
  assert.equal(next.revision, 0); assert.equal(next.report.summary.changedFiles, 0); assert.equal(next.report.summary.changedDescriptions, 1);
  assert.equal(next.report.features[0].before.summary, 'Create report output.');
  assert.throws(() => workspace.recordDevelopmentReview(input(first)), rejected(409));
});

test('forged comparison, unknown target, Agent decision, missing evidence and oversized UTF-8 record cannot publish', async t => {
  const { workspace, manifest } = await fixture(t), started = await task(workspace), response = workspace.developmentReview(started.id);
  const request = input(response), old = fs.readFileSync(manifest, 'utf8');
  assert.throws(() => workspace.recordDevelopmentReview({ ...request, comparisonDigest: '0'.repeat(64) }), rejected(409));
  for (const record of [null, { ...request.record, source: 'agent' }, { ...request.record, target: { kind: 'feature', id: 'missing' } },
    { ...request.record, target: { kind: 'file', id: 'entry.ts' } },
    { kind: 'verification', target: request.record.target, status: 'passed', source: 'agent', author: 'Codex', actor: 'reader', method: 'npm test', evidence: '' },
    { kind: 'note', target: request.record.target, source: 'manual', author: 'reader', actor: 'reader', text: '字'.repeat(12000) }])
    assert.throws(() => workspace.recordDevelopmentReview({ ...request, record }), rejected(400));
  assert.equal(fs.readFileSync(manifest, 'utf8'), old);
});

test('a review cannot record a result against a different task or criterion', async t => {
  const { workspace } = await fixture(t), first = await task(workspace), second = await task(workspace);
  const old = workspace.developmentReview(first.id), current = workspace.developmentReview(second.id);
  assert.throws(() => workspace.recordDevelopmentReview({ ...input(current), comparisonDigest: old.report.comparisonDigest }), rejected(409));
  assert.throws(() => workspace.recordDevelopmentReview(input(current, { kind: 'review', target: { kind: 'criterion', id: 'invented' },
    decision: 'reviewed', actor: 'reader', reason: 'This check was never declared.' })), rejected(400));
});

test('failed manifest publication leaves no review decision, reopens safely, and reuses only intact orphan report', async t => {
  const { workspace, manifest, open } = await fixture(t), started = await task(workspace);
  const response = workspace.developmentReview(started.id), original = fs.renameSync, previous = fs.readFileSync(manifest, 'utf8');
  fs.renameSync = function (from, to) { if (to === manifest) throw new Error('injected publication failure'); return original.call(fs, from, to); };
  try { assert.throws(() => workspace.recordDevelopmentReview(input(response)), /injected publication failure/); }
  finally { fs.renameSync = original; }
  assert.equal(fs.readFileSync(manifest, 'utf8'), previous);
  await workspace.close(); const reopened = open();
  assert.equal(reopened.developmentReview(started.id).revision, 0);
  assert.equal(reopened.recordDevelopmentReview(input(reopened.developmentReview(started.id))).revision, 1);
});

test('source change after durable manifest temporary prevents the only publication rename', async t => {
  const { workspace, source, manifest, open } = await fixture(t), started = await task(workspace), old = fs.readFileSync(manifest, 'utf8');
  const response = workspace.developmentReview(started.id), original = fs.writeFileSync;
  let changed = false;
  fs.writeFileSync = function (file, data, ...rest) {
    const result = original.call(fs, file, data, ...rest);
    if (!changed && typeof data === 'string' && data.includes('"developmentReview"') && data.includes('"records"')) {
      changed = true; original.call(fs, source, text.replace('"csv"', '"xml"'));
    }
    return result;
  };
  try { assert.throws(() => workspace.recordDevelopmentReview(input(response)), rejected(409)); }
  finally { fs.writeFileSync = original; }
  assert.equal(changed, true); assert.equal(fs.readFileSync(manifest, 'utf8'), old);
  await workspace.close(); const reopened = open();
  assert.equal(reopened.developmentReview(started.id).revision, 0);
});

test('baseline intent is not published if code changes after the manifest temporary is written', async t => {
  const { workspace, source } = await fixture(t), original = fs.writeFileSync;
  let changed = false;
  fs.writeFileSync = function (file, data, ...rest) {
    const result = original.call(fs, file, data, ...rest);
    if (!changed && typeof data === 'string' && data.includes('"intent"') && data.includes('"activeTaskId"')) {
      changed = true; original.call(fs, source, text.replace('"csv"', '"xml"'));
    }
    return result;
  };
  try { await assert.rejects(task(workspace), rejected(409)); }
  finally { fs.writeFileSync = original; }
  assert.equal(changed, true); assert.equal(workspace.state().tasks.length, 0);
});

test('damaged stored comparison is never recomputed over its original review history', async t => {
  const { workspace, out, open } = await fixture(t), started = await task(workspace);
  const saved = workspace.recordDevelopmentReview(input(workspace.developmentReview(started.id))), key = saved.report.comparisonDigest;
  const file = fs.readdirSync(path.join(out, 'development-reviews')).find(file => file.endsWith('.json'));
  fs.writeFileSync(path.join(out, 'development-reviews', file), '{}');
  assert.throws(() => workspace.savedDevelopmentReview(key), rejected(500));
  assert.throws(() => workspace.developmentReview(started.id), rejected(500));
  await workspace.close(); const reopened = open(); assert.throws(() => reopened.savedDevelopmentReview(key), rejected(500));
});

test('invalid record sequences and foreign endpoints make a stored manifest fail closed', async t => {
  const { workspace, manifest, open } = await fixture(t), started = await task(workspace);
  workspace.recordDevelopmentReview(input(workspace.developmentReview(started.id)));
  await workspace.close(); const original = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  assert.equal(validDevelopmentReviewState(original.developmentReview), true);
  for (const mutate of [state => { state.developmentReview.records[0].sequence = 2; },
    state => { state.developmentReview.reports[0].before.snapshot = 'f'.repeat(64); },
    state => { state.developmentReview.records[0].actor = ''; },
    state => { state.developmentReview.reports.push(structuredClone(state.developmentReview.reports[0])); }]) {
    const broken = structuredClone(original); mutate(broken); fs.writeFileSync(manifest, JSON.stringify(broken));
    assert.throws(open, /damaged workspace manifest/);
  }
  fs.writeFileSync(manifest, JSON.stringify(original)); assert.equal(open().state().tasks.length, 1);
});

test('closed workspace stays readable but refuses all new development records', async t => {
  const { workspace } = await fixture(t), started = await task(workspace);
  const response = workspace.developmentReview(started.id); await workspace.close();
  assert.equal(workspace.developmentReview(started.id).current.writable, false);
  assert.throws(() => workspace.recordDevelopmentReview(input(response)), rejected(409));
  await assert.rejects(task(workspace), rejected(409));
});

test('syntactically valid but foreign stored targets and altered task intent cannot be read or exported as original review', async t => {
  const { workspace, manifest, open } = await fixture(t), started = await task(workspace);
  const response = workspace.recordDevelopmentReview(input(workspace.developmentReview(started.id))), key = response.report.comparisonDigest;
  await workspace.close(); const original = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  for (const mutate of [state => { state.developmentReview.records[0].target = { kind: 'criterion', id: 'not-declared' }; },
    state => { state.tasks[0].intent.goal = 'A different goal cannot silently replace the recorded one'; }]) {
    const broken = structuredClone(original); mutate(broken); fs.writeFileSync(manifest, JSON.stringify(broken));
    const reopened = open(); assert.throws(() => reopened.savedDevelopmentReview(key), rejected(500)); await reopened.close();
  }
  fs.writeFileSync(manifest, JSON.stringify(original));
  assert.equal(open().savedDevelopmentReview(key).revision, 1);
});
