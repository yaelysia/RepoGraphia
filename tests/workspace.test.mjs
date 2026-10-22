import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { analyze } from '../dist/analyze.js';
import { createFeatureMapApi } from '../dist/feature-map.js';
import { ContinuousWorkspace } from '../dist/workspace.js';
import { startWorkspaceServer } from '../dist/workspace-server.js';
import { compareWorkspaceGraphs } from '../dist/workspace-diff.js';

const featureApi = createFeatureMapApi();
const captured = root => {
  let inputs;
  const graph = analyze(root, { includeSource: true, onInputs: value => { inputs = value; } });
  return { graph, inputs };
};
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'repographia-live-'));
  const root = path.join(directory, 'project'), out = path.join(directory, 'workspace');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noLib: true }, include: ['*.ts'] }));
  fs.writeFileSync(path.join(root, 'entry.ts'), 'export function run() { return 1; }\n');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { root, out, source: path.join(root, 'entry.ts'), directory };
}
function open(t, setup, dependencies = {}) {
  const workspace = new ContinuousWorkspace({ root: setup.root, directory: setup.out, watch: false, reconcileMs: 0, debounceMs: 0 },
    { analyze: async root => captured(root), ...dependencies });
  t.after(() => workspace.close());
  return workspace;
}
function editFeature(workspace, title = '执行入口') {
  const graph = workspace.getGraph(workspace.state().latestSnapshot), map = workspace.getFeatures();
  return featureApi.edit(graph, map, { op: 'feature', feature: { id: 'run', title, summary: '从入口执行任务', description: '人工说明', questions: [] } },
    { expectedRevision: map.revision, actor: 'reviewer', actorKind: 'manual', at: new Date().toISOString(), reason: '审阅入口' });
}
const nextTurn = () => new Promise(resolve => setTimeout(resolve, 5));
async function until(predicate, timeout = 10_000) {
  const started = Date.now();
  while (!predicate()) { if (Date.now() - started > timeout) throw new Error('Timed out waiting for workspace condition'); await nextTurn(); }
}

test('real worker captures saved working files and a task compares from the actual starting point', async t => {
  const setup = fixture(t);
  // This pre-existing working-copy change must be part of the starting point, not a task change.
  fs.writeFileSync(setup.source, 'export function run() { return 7; }\n');
  const workspace = new ContinuousWorkspace({ root: setup.root, directory: setup.out, watch: false, reconcileMs: 0, debounceMs: 0 });
  t.after(() => workspace.close());
  await workspace.refresh(true);
  const task = await workspace.beginTask('修改返回值', workspace.featureDigest);
  assert.match(workspace.getGraph(task.snapshot).files[0].source, /return 7/);
  fs.writeFileSync(setup.source, 'export function run() { return 8; }\n');
  const current = await workspace.refresh();
  const difference = compareWorkspaceGraphs(workspace.getGraph(task.snapshot), workspace.getGraph(current.id));
  assert.equal(difference.summary.modified, 1);
  assert.match(difference.files[0].before.source, /return 7/);
  assert.match(difference.files[0].after.source, /return 8/);
  assert.equal(workspace.getTask(task.id).snapshot, task.snapshot);
  assert.equal(workspace.state().view.snapshot, task.snapshot, 'background update must not replace the saved reading version');
});

test('saved annotations, task baseline and selected version survive reopening with all old versions retained', async t => {
  const setup = fixture(t), workspace = open(t, setup);
  const original = await workspace.refresh(true), firstDigest = workspace.featureDigest;
  const edited = workspace.saveFeatures(editFeature(workspace), firstDigest);
  const task = await workspace.beginTask('核对入口', edited.digest);
  fs.writeFileSync(setup.source, 'export function run() { return 2; }\n');
  const current = await workspace.refresh();
  assert.equal(workspace.getFeatures().basis.snapshot, original.id, 'new code must not silently rebase old functional interpretations');
  workspace.saveView({ snapshot: original.id, taskId: task.id });
  await workspace.close();
  const reopened = open(t, setup);
  assert.equal(reopened.state().latestSnapshot, current.id);
  assert.equal(reopened.state().view.snapshot, original.id);
  assert.equal(reopened.getFeatures().features[0].title, '执行入口');
  assert.equal(reopened.getFeatures(firstDigest).features.length, 0);
  assert.equal(reopened.getTask(task.id).featureDigest, edited.digest);
  assert.equal(reopened.state().snapshots.length, 2);
});

test('overlapping annotation saves use compare-and-swap and retain the losing draft unchanged', async t => {
  const setup = fixture(t), workspace = open(t, setup);
  await workspace.refresh(true);
  const digest = workspace.featureDigest, first = editFeature(workspace, '第一个修订'), second = editFeature(workspace, '第二个修订');
  const saved = workspace.saveFeatures(first, digest), copy = JSON.stringify(second);
  assert.throws(() => workspace.saveFeatures(second, digest), error => error.statusCode === 409);
  assert.equal(workspace.featureDigest, saved.digest);
  assert.equal(JSON.stringify(second), copy);
  assert.equal(workspace.getFeatures(digest).features.length, 0);
});

test('an edit during analysis cannot publish a mixed or superseded snapshot', async t => {
  const setup = fixture(t);
  let release, delayed = false;
  const workspace = open(t, setup, { analyze: async root => {
    const result = captured(root);
    if (delayed) await new Promise(resolve => { release = resolve; });
    return result;
  } });
  const original = await workspace.refresh(true);
  delayed = true;
  const rebuilding = workspace.refresh(true);
  const rejected = assert.rejects(rebuilding, error => error.statusCode === 409);
  await until(() => release);
  fs.writeFileSync(setup.source, 'export function run() { return 3; }\n');
  release(); await rejected;
  assert.equal(workspace.state().latestSnapshot, original.id);
  assert.equal(workspace.state().snapshots.length, 1);
  assert.equal(workspace.state().status, 'changed');
  delayed = false;
  const current = await workspace.refresh();
  assert.notEqual(current.id, original.id);
});

test('a baseline requested during an older run waits for its own fresh inputs', async t => {
  const setup = fixture(t);
  let release, delayOnce = false;
  const workspace = open(t, setup, { analyze: async root => {
    const result = captured(root);
    if (delayOnce) { delayOnce = false; await new Promise(resolve => { release = resolve; }); }
    return result;
  } });
  await workspace.refresh(true);
  delayOnce = true;
  const oldRun = workspace.refresh(true);
  const rejected = assert.rejects(oldRun, error => error.statusCode === 409);
  await until(() => release);
  const baseline = workspace.beginTask('正在保存时开始', workspace.featureDigest);
  fs.writeFileSync(setup.source, 'export function run() { return 9; }\n');
  release(); await rejected;
  const task = await baseline;
  assert.match(workspace.getGraph(task.snapshot).files[0].source, /return 9/);
  const difference = compareWorkspaceGraphs(workspace.getGraph(task.snapshot), workspace.getGraph(workspace.state().latestSnapshot));
  assert.equal(difference.files.length, 0);
});

test('annotation changes during baseline capture require another explicit start', async t => {
  const setup = fixture(t); let release, delay = false;
  const workspace = open(t, setup, { analyze: async root => {
    const result = captured(root);
    if (delay) await new Promise(resolve => { release = resolve; });
    return result;
  } });
  await workspace.refresh(true); delay = true;
  const digest = workspace.featureDigest;
  const baseline = workspace.beginTask('有并发编辑', digest);
  const rejected = assert.rejects(baseline, error => error.statusCode === 409);
  await until(() => release);
  workspace.saveFeatures(editFeature(workspace), digest);
  release(); await rejected;
  assert.equal(workspace.state().tasks.length, 0);
});

test('failed analysis retains the last graph and recovery can publish the next valid one', async t => {
  const setup = fixture(t); let fail = false;
  const workspace = open(t, setup, { analyze: async root => { if (fail) throw new Error('fixture analyzer failure'); return captured(root); } });
  const original = await workspace.refresh(true);
  fail = true; await assert.rejects(workspace.refresh(true), /fixture analyzer failure/);
  assert.equal(workspace.state().latestSnapshot, original.id);
  assert.equal(workspace.state().status, 'error');
  assert.ok(workspace.getGraph(original.id).nodes.length);
  fail = false; await workspace.refresh(true);
  assert.equal(workspace.state().status, 'current');
});

test('a failed atomic manifest update cannot mark annotations saved or replace the old head', async t => {
  const setup = fixture(t), workspace = open(t, setup);
  await workspace.refresh(true);
  const digest = workspace.featureDigest, before = fs.readFileSync(path.join(setup.out, 'workspace.json'), 'utf8');
  const document = editFeature(workspace), rename = fs.renameSync;
  try {
    fs.renameSync = (from, to) => { if (to === path.join(setup.out, 'workspace.json')) throw new Error('fixture disk failure'); return rename(from, to); };
    assert.throws(() => workspace.saveFeatures(document, digest), /fixture disk failure/);
  } finally { fs.renameSync = rename; }
  assert.equal(workspace.featureDigest, digest);
  assert.equal(fs.readFileSync(path.join(setup.out, 'workspace.json'), 'utf8'), before);
  assert.equal(workspace.getFeatures().features.length, 0);
  assert.notEqual(workspace.saveFeatures(document, digest).digest, digest);
});

test('workspace locations and locks protect source files and unrelated directories', async t => {
  const setup = fixture(t);
  assert.throws(() => new ContinuousWorkspace({ root: setup.root, directory: path.join(setup.root, 'data') }), /outside/);
  const occupied = path.join(setup.directory, 'occupied'); fs.mkdirSync(occupied); fs.writeFileSync(path.join(occupied, 'keep.txt'), 'keep');
  assert.throws(() => new ContinuousWorkspace({ root: setup.root, directory: occupied }), /empty directory/);
  assert.equal(fs.readFileSync(path.join(occupied, 'keep.txt'), 'utf8'), 'keep');
  const workspace = open(t, setup);
  assert.throws(() => new ContinuousWorkspace({ root: setup.root, directory: setup.out }), /already open/);
  await workspace.close();
  const reopened = open(t, setup); await reopened.refresh(true);
  assert.ok(reopened.state().latestSnapshot);
});

test('periodic reconciliation updates the graph when filesystem notifications are unavailable', async t => {
  const setup = fixture(t);
  const workspace = new ContinuousWorkspace({ root: setup.root, directory: setup.out, watch: false, reconcileMs: 100, debounceMs: 0 }, { analyze: async root => captured(root) });
  t.after(() => workspace.close()); workspace.start();
  await until(() => workspace.state().status === 'current');
  const original = workspace.state().latestSnapshot;
  fs.writeFileSync(setup.source, 'export function run() { return 11; }\n');
  await until(() => workspace.state().latestSnapshot !== original);
  assert.match(workspace.getGraph(workspace.state().latestSnapshot).files[0].source, /return 11/);
  assert.equal(workspace.state().watch.active, false);
});

test('closing during analysis prevents late publication and releases its lock', async t => {
  const setup = fixture(t); let entered = false;
  const workspace = open(t, setup, { analyze: async (_root, _project, signal) => {
    entered = true;
    await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  } });
  const run = workspace.refresh(true); const rejected = assert.rejects(run, /closed|aborted/);
  await until(() => entered); await workspace.close(); await rejected;
  assert.equal(workspace.state().snapshots.length, 0);
  assert.equal(fs.existsSync(path.join(setup.out, 'workspace.lock')), false);
});

test('loopback server authenticates data and writes, isolates report capabilities, and exports offline HTML', async t => {
  const setup = fixture(t), workspace = open(t, setup);
  await workspace.refresh(true);
  const app = await startWorkspaceServer(workspace, { start: false });
  t.after(() => app.close());
  const headers = { 'X-RepoGraphia-Token': app.token };
  const request = (route, options = {}) => fetch(app.origin + route, { ...options, headers: { ...headers, ...options.headers } });
  assert.equal((await fetch(app.origin + '/api/state')).status, 401);
  assert.equal((await request('/api/state', { headers: { Origin: 'https://example.invalid' } })).status, 403);
  // fetch normalizes Host in some supported Node versions; send the intended wire header explicitly.
  const invalidHost = await new Promise((resolve, reject) => {
    const request = http.get(app.origin + '/api/state', { headers: { ...headers, Host: 'example.invalid' } }, response => {
      response.resume(); response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
  });
  assert.equal(invalidHost, 403);
  const shell = await fetch(app.origin + '/');
  assert.match(shell.headers.get('content-security-policy'), /script-src 'self'/);
  assert.doesNotMatch(shell.headers.get('content-security-policy'), /unsafe-inline/);
  assert.doesNotMatch(await shell.text(), new RegExp(app.token));
  const report = await (await request('/api/report')).json();
  assert.match(report.url, /^\/report\/[a-f0-9]+$/);
  assert.equal((await fetch(app.origin + '/api/state', { headers: { 'X-RepoGraphia-Token': report.url.split('/').at(-1) } })).status, 401);
  const page = await fetch(app.origin + report.url), html = await page.text();
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /workspace-data/);
  assert.doesNotMatch(html, new RegExp(app.token));
  const exported = await request('/api/export');
  assert.match(exported.headers.get('content-disposition'), /attachment/);
  assert.doesNotMatch(await exported.text(), /id="workspace-data"/);
  const bad = await request('/api/features', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedDigest: '0'.repeat(64), document: workspace.getFeatures() }) });
  assert.equal(bad.status, 409);
  const baselineResponse = await request('/api/baseline', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '本地审阅', expectedFeatureDigest: workspace.featureDigest }) });
  assert.equal(baselineResponse.status, 201);
  const { task } = await baselineResponse.json();
  const difference = await (await request(`/api/diff?task=${task.id}`)).json();
  assert.equal(difference.files.length, 0);
  const none = await (await request(`/api/report?snapshot=${task.snapshot}&featureDigest=none&readOnly=1`)).json();
  assert.equal(none.featureDigest, null);
});
