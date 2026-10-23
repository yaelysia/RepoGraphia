import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { analyze } from '../dist/analyze.js';
import { ContinuousWorkspace } from '../dist/workspace.js';
import { startWorkspaceServer } from '../dist/workspace-server.js';

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'repographia-development-api-'));
  const root = path.join(directory, 'source'); fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'tsconfig.json'), '{"compilerOptions":{"noLib":true},"include":["*.ts"]}');
  const source = path.join(root, 'entry.ts'); fs.writeFileSync(source, 'export function run() { return 1; }\n');
  const workspace = new ContinuousWorkspace({ root, directory: path.join(directory, 'workspace'), watch: false, reconcileMs: 0, debounceMs: 0 }, {
    analyze: async root => { let inputs; const graph = analyze(root, { includeSource: true, onInputs: value => { inputs = value; } }); return { graph, inputs }; },
  });
  await workspace.refresh(true);
  const app = await startWorkspaceServer(workspace, { start: false });
  t.after(async () => { await app.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const request = (route, body, method = body === undefined ? 'GET' : 'POST', extra = {}) => fetch(app.origin + route, {
    method, headers: { 'X-RepoGraphia-Token': app.token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const start = async () => {
    const response = await request('/api/baseline', { title: 'Review the return value', expectedFeatureDigest: workspace.featureDigest,
      intent: { goal: 'Understand the returned value.', author: 'project owner', source: 'manual', featureIds: [], checks: [{ id: 'value', text: 'Check the expected return.' }] } });
    assert.equal(response.status, 201); return (await response.json()).task;
  };
  const review = async task => {
    const response = await request('/api/development-review?' + new URLSearchParams({ task: task.id, snapshot: workspace.state().latestSnapshot, featureDigest: workspace.featureDigest }));
    assert.equal(response.status, 200); return response.json();
  };
  return { workspace, app, request, source, start, review };
}
const record = result => ({ taskId: result.report.task.id, snapshot: result.report.after.snapshot, featureDigest: result.report.after.featureDigest,
  comparisonDigest: result.report.comparisonDigest, expectedRevision: result.revision,
  record: { kind: 'review', target: { kind: 'round', id: result.report.task.id }, actor: 'reader', decision: 'needs-work', reason: 'Runtime verification is still missing.' } });

test('development review endpoints retain loopback authentication, origin checks, and script isolation', async t => {
  const { app, request, start } = await fixture(t), task = await start();
  const routes = ['/api/development-review?task=' + task.id, '/api/development-review/records', '/api/development-reviews/' + '0'.repeat(64), '/api/development-reviews/' + '0'.repeat(64) + '/export'];
  for (const route of routes) assert.equal((await fetch(app.origin + route)).status, 401);
  assert.equal((await request(routes[0], undefined, 'GET', { Origin: 'https://untrusted.example' })).status, 403);
  // Fetch normalizes the Host header; send a real malformed HTTP request to exercise the service boundary.
  const wrongHost = await new Promise((resolve, reject) => {
    const req = http.request(app.origin + routes[0], { headers: { Host: 'untrusted.example', 'X-RepoGraphia-Token': app.token } }, response => {
      response.resume(); response.on('end', () => resolve(response.statusCode));
    }); req.on('error', reject); req.end();
  });
  assert.equal(wrongHost, 403);
  assert.equal((await request(routes[0], undefined, 'GET', { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  const script = await fetch(app.origin + '/workspace-review.js'); assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type'), /javascript/); assert.equal(script.headers.get('cache-control'), 'no-store');
  assert.doesNotMatch(await script.text(), new RegExp(app.token));
  const page = await fetch(app.origin + '/'); assert.match(page.headers.get('content-security-policy'), /connect-src 'self'/);
});

test('HTTP workflow fixes task scope, appends independent facts, rejects collisions, and exports original fixed review', async t => {
  const { workspace, request, start, review } = await fixture(t), task = await start(), result = await review(task), before = workspace.getFeatures();
  assert.equal(result.revision, 0); assert.equal(result.report.task.intent.checks[0].id, 'value');
  const requestBody = record(result);
  let response = await request('/api/development-review/records', requestBody); assert.equal(response.status, 201);
  const saved = await response.json(); assert.equal(saved.revision, 1);
  assert.equal((await request('/api/development-review/records', requestBody)).status, 409);
  assert.equal((await request('/api/development-review/records', { ...record(saved), overwrite: true })).status, 400);
  assert.equal((await request('/api/development-review/records', { ...record(saved), record: { ...requestBody.record, source: 'agent' } })).status, 400);
  const evidence = '</script><img src="https://invalid.example/x" onerror="alert(1)"> Declared output; never execute.';
  response = await request('/api/development-review/records', { ...record(saved), record: { kind: 'verification', target: { kind: 'criterion', id: 'value' },
    actor: 'human importer', source: 'agent', author: 'external Agent', status: 'failed', method: 'Reported test output', evidence } });
  assert.equal(response.status, 201); const verified = await response.json();
  assert.equal(verified.records[0].kind, 'review'); assert.equal(verified.records[1].kind, 'verification'); assert.equal(verified.records[1].source, 'agent');
  assert.deepEqual(workspace.getFeatures(), before);
  const base = '/api/development-reviews/' + verified.report.comparisonDigest;
  const history = await (await request(base)).json(); assert.equal(history.current.writable, false); assert.deepEqual(history.records, verified.records);
  const exported = await request(base + '/export'); assert.equal(exported.status, 200);
  assert.match(exported.headers.get('content-disposition'), /attachment; filename="repographia-development-[a-f0-9]+.json"/);
  assert.equal(exported.headers.get('cache-control'), 'no-store'); assert.equal(exported.headers.get('x-content-type-options'), 'nosniff');
  const payload = await exported.json(); assert.equal(payload.exportVersion, 1); assert.deepEqual(payload.report, result.report);
  assert.deepEqual(payload.records, verified.records); assert.equal(payload.records[1].evidence, evidence);
});

test('stale HTTP results stay readable, cannot record against newer source, and later versions remain unreviewed', async t => {
  const { workspace, request, source, start, review } = await fixture(t), task = await start(), initial = await review(task);
  const saved = await (await request('/api/development-review/records', record(initial))).json();
  fs.writeFileSync(source, 'export function run() { return 2; }\n');
  assert.equal((await request('/api/development-review/records', record(saved))).status, 409);
  await workspace.refresh(true);
  const current = await review(task); assert.equal(current.revision, 0); assert.equal(current.report.summary.unassignedFiles, 1);
  assert.notEqual(current.report.comparisonDigest, saved.report.comparisonDigest); assert.equal(current.history.length, 1);
  assert.equal((await request('/api/development-review/records', record(saved))).status, 409);
  const old = await (await request('/api/development-reviews/' + saved.report.comparisonDigest)).json();
  assert.equal(old.report.after.snapshot, initial.report.after.snapshot); assert.equal(old.records[0].reason, saved.records[0].reason);
  const malformed = await request('/api/baseline', { title: 'invalid goal', expectedFeatureDigest: workspace.featureDigest, intent: { goal: 'incomplete' } });
  assert.equal(malformed.status, 400); assert.equal(workspace.state().tasks.length, 1);
});
