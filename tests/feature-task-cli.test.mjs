import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { analyze } from '../dist/analyze.js';
import { digest } from '../dist/agent.js';
import { createFeatureMapApi } from '../dist/feature-map.js';
import { createFeatureTask, featureRevisionHeader } from '../dist/feature-tasks.js';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'repographia-task-cli-')), source = path.join(directory, 'source');
after(() => fs.rmSync(directory, { recursive: true, force: true }));
fs.mkdirSync(source);
fs.writeFileSync(path.join(source, 'main.ts'), `export function notify(enabled: boolean, send: () => void) {
  if (!enabled) return false;
  const label = "Ready 'now'";
  send();
  return label;
}
export function deliver() { return 1; }
notify(true, deliver);
`);
fs.writeFileSync(path.join(source, 'other.ts'), 'export function outside() { return "context only"; }');
const graph = analyze(source, { includeSource: true }), api = createFeatureMapApi(), at = '2026-10-23T00:00:00Z';
const entry = graph.nodes.find(node => node.name === 'notify'), outside = graph.nodes.find(node => node.name === 'outside');
const call = graph.relations.find(edge => edge.targetLabel === 'send');
const edit = (map, operation) => api.edit(graph, map, operation, { expectedRevision: map.revision, actor: 'human fixture', actorKind: 'manual', at, reason: 'Explicit fixture content.' });
let features = api.create(graph);
for (const id of ['existing', 'second']) features = edit(features, { op: 'feature', feature: { id, title: id, description: 'An existing bounded capability.', questions: [] } });
features = edit(features, { op: 'mapping', id: 'existing-entry', featureId: 'existing', nodeId: entry.id, role: 'entry', rationale: 'Existing reference.', relationIds: [call.id] });
features = edit(features, { op: 'review', id: 'existing-entry', decision: 'accepted' });
const allowed = { files: ['main.ts'], featureIds: ['existing', 'second'], mappingIds: ['existing-entry'], newFeatures: true, parentId: null };
const bundle = createFeatureTask(graph, features, 'changes', 'Revisit the supplied local scope.', allowed, at);
const draft = () => ({ ...featureRevisionHeader(bundle), batchId: 'cli-batch', summary: 'An exact, bounded explanation.',
  features: [{ action: 'add', feature: { id: 'new-capability', title: 'Send when enabled', description: 'Calls the supplied sender when enabled; the result is not delivery confirmation.', questions: [] }, reason: 'Describe an evidenced capability.' }],
  mappings: [{ action: 'add', id: 'new-entry', featureId: 'new-capability', nodeId: entry.id, role: 'entry', rationale: 'The explicit guard precedes the sender callsite.', relationIds: [call.id], reason: 'Record exact source evidence.' }],
  retractions: [], checks: [
    { featureId: 'new-capability', nodeId: entry.id, kind: 'support', quote: 'send();', explanation: 'The supplied sender is referenced by this callsite.' },
    { featureId: 'new-capability', nodeId: entry.id, kind: 'limit', quote: 'if (!enabled) return false;', explanation: 'Disabled input returns before the callsite.' },
  ], exploredFiles: ['main.ts'], unexplored: ['The sender implementation and delivery outcome.'] });
const bundleFile = path.join(directory, 'task-bundle.json'), proposalFile = path.join(directory, 'revision.json');
fs.writeFileSync(bundleFile, JSON.stringify(bundle)); fs.writeFileSync(proposalFile, JSON.stringify(draft()));
const cliFile = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
function cli(...args) {
  // Real output descriptors also work in restricted runners that cannot collect
  // child-process pipes. Exercise the actual CLI, including its exit status.
  const capture = fs.mkdtempSync(path.join(os.tmpdir(), 'repographia-task-cli-output-'));
  const out = path.join(capture, 'stdout'), err = path.join(capture, 'stderr');
  const descriptors = [];
  try {
    descriptors.push(fs.openSync(out, 'wx'), fs.openSync(err, 'wx'));
    const result = spawnSync(process.execPath, [cliFile, 'agent', 'task', ...args], { stdio: ['ignore', ...descriptors], timeout: 20000 });
    return { ...result, stdout: fs.readFileSync(out, 'utf8'), stderr: fs.readFileSync(err, 'utf8') };
  } finally { descriptors.forEach(fd => fs.closeSync(fd)); fs.rmSync(capture, { recursive: true, force: true }); }
}
const bytes = () => [bundleFile, proposalFile, path.join(source, 'main.ts'), path.join(source, 'other.ts')].map(file => fs.readFileSync(file, 'utf8'));
function jsonResult(result) { assert.ifError(result.error); assert.equal(result.status, 0, result.stderr); assert.equal(result.stderr, ''); return JSON.parse(result.stdout); }
function errorResult(result) { assert.ifError(result.error); assert.equal(result.status, 1, result.stdout); assert.equal(result.stdout, ''); const value = JSON.parse(result.stderr); assert.equal(value.ok, false); assert.ok(value.error.hint); return value.error; }

test('task overview routes to its own revision header and independently paginates frozen edit scope', () => {
  assert.match(jsonResult(cli('--help')).help, /never applies or accepts/);
  const value = jsonResult(cli('overview', bundleFile, '--limit', '1')).data;
  assert.deepEqual(value.proposalHeader, featureRevisionHeader(bundle)); assert.equal(value.overview.proposalHeader, undefined);
  assert.equal(value.scopeFiles.items[0].path, 'main.ts'); assert.equal(value.scopeFiles.nextOffset, null);
  assert.equal(value.editableFeatures.items.length, 1); assert.equal(value.editableFeatures.nextOffset, 1);
  const next = jsonResult(cli('overview', bundleFile, '--offset', '1', '--limit', '1')).data.editableFeatures;
  assert.equal(next.nextOffset, null); assert.notEqual(next.items[0].id, value.editableFeatures.items[0].id);
  assert.equal(value.editableMappings.items[0].decision, 'accepted'); assert.equal(value.newFeatures, true);
});

test('evidence navigation remains available beyond edit scope and preserves source and origin cursors', () => {
  const search = jsonResult(cli('search', bundleFile, 'outside')).data;
  assert.ok(search.matches.items.some(node => node.id === outside.id));
  const outsideView = jsonResult(cli('inspect', bundleFile, outside.id)).data;
  assert.match(outsideView.source.text, /context only/);
  const first = jsonResult(cli('inspect', bundleFile, entry.id, '--source-limit', '10')).data.source;
  const remainder = jsonResult(cli('inspect', bundleFile, entry.id, '--source-offset', String(first.nextOffset))).data.source;
  assert.equal(first.text + remainder.text, graph.files.find(file => file.path === 'main.ts').source.slice(entry.location.start, entry.location.end));
  const relation = jsonResult(cli('relation', bundleFile, call.id, '--limit', '1')).data;
  assert.equal(relation.relation.status, 'candidate'); assert.equal(relation.origins.complete, false);
  assert.equal(relation.origins.records.items.length, 1); assert.notEqual(relation.origins.records.nextOffset, null);
});

test('task check validates a review without applying, accepting, or rewriting any input', () => {
  const before = bytes(), inventory = fs.readdirSync(directory).sort();
  const value = jsonResult(cli('check', bundleFile, proposalFile, '--author', 'agent fixture')).data;
  assert.equal(value.valid, true); assert.equal(value.applied, false); assert.equal(value.decision, 'proposed');
  assert.equal(value.document, undefined); assert.equal(value.features, undefined);
  assert.equal(value.changes.find(change => change.kind === 'mapping').after.decision, 'proposed');
  assert.deepEqual(bytes(), before); assert.deepEqual(fs.readdirSync(directory).sort(), inventory);
});

test('task submit creates only a revision/review/receipt bundle for human import and never accepts or applies it', () => {
  const before = bytes(), out = path.join(directory, 'submission');
  const result = jsonResult(cli('submit', bundleFile, proposalFile, '--author', 'agent fixture', '--out', out));
  assert.equal(result.applied, false); assert.equal(result.revision, path.join(out, 'revision.json'));
  assert.deepEqual(fs.readdirSync(out).sort(), ['receipt.json', 'review.json', 'revision.json']);
  assert.deepEqual(JSON.parse(fs.readFileSync(result.revision, 'utf8')), draft());
  const receipt = JSON.parse(fs.readFileSync(result.receipt, 'utf8'));
  assert.equal(receipt.applied, false); assert.equal(receipt.decision, 'proposed'); assert.equal(receipt.proposalDigest, digest(draft()));
  const review = JSON.parse(fs.readFileSync(path.join(out, 'review.json'), 'utf8'));
  assert.equal(review.document, undefined); assert.equal(review.changes.find(change => change.kind === 'mapping').after.decision, 'proposed');
  const saved = fs.readdirSync(out).map(name => [name, fs.readFileSync(path.join(out, name), 'utf8')]);
  errorResult(cli('submit', bundleFile, proposalFile, '--author', 'another agent', '--out', out));
  assert.deepEqual(fs.readdirSync(out).map(name => [name, fs.readFileSync(path.join(out, name), 'utf8')]), saved);
  assert.deepEqual(bytes(), before);
});

test('query and check outputs refuse existing files, including task and revision inputs', () => {
  const before = bytes();
  for (const [operation, file] of [['overview', bundleFile], ['check', proposalFile]]) {
    const args = operation === 'check' ? ['check', bundleFile, proposalFile, '--author', 'agent fixture'] : ['overview', bundleFile];
    assert.equal(errorResult(cli(...args, '--out', file)).code, 'EEXIST');
  }
  const newFile = path.join(directory, 'check-result.json');
  const output = jsonResult(cli('check', bundleFile, proposalFile, '--author', 'agent fixture', '--out', newFile));
  assert.equal(output.output, newFile); assert.equal(JSON.parse(fs.readFileSync(newFile, 'utf8')).data.applied, false);
  assert.deepEqual(bytes(), before);
});

test('a mixed valid/invalid revision produces an actionable error without a partially published bundle', () => {
  const invalid = draft(); invalid.checks[1].quote = 'This quote is not in the supplied entity.';
  const file = path.join(directory, 'invalid-revision.json'), out = path.join(directory, 'invalid-submission'); fs.writeFileSync(file, JSON.stringify(invalid));
  const before = bytes(), error = errorResult(cli('submit', bundleFile, file, '--author', 'agent fixture', '--out', out));
  assert.equal(error.code, 'INVALID_REVISION'); assert.match(error.message, /Quote/); assert.equal(fs.existsSync(out), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), invalid); assert.deepEqual(bytes(), before);
});

test('a revision from another frozen task cannot be submitted by replacing only the input bundle', () => {
  const newer = createFeatureTask(graph, features, 'changes', 'A separately created task.', allowed, at), file = path.join(directory, 'newer-task.json');
  fs.writeFileSync(file, JSON.stringify(newer)); const out = path.join(directory, 'late-submission');
  assert.equal(errorResult(cli('submit', file, proposalFile, '--author', 'agent fixture', '--out', out)).code, 'TASK_CONFLICT');
  assert.equal(fs.existsSync(out), false);
});

test('CLI preserves exact JSON quotation and declared author text without treating it as a command', () => {
  const proposal = draft(); proposal.features[0].feature.title = 'A "quoted" capability';
  proposal.checks[0].quote = 'const label = "Ready \'now\'";';
  const file = path.join(directory, 'quoted-revision.json'); fs.writeFileSync(file, JSON.stringify(proposal));
  const author = 'Agent "literal" name with spaces';
  const value = jsonResult(cli('check', bundleFile, file, '--author', author)).data;
  assert.equal(value.author, author); assert.equal(value.checks[0].quote, proposal.checks[0].quote);
  assert.equal(value.changes.find(change => change.kind === 'feature').after.title, proposal.features[0].feature.title);
});

test('unknown flags, unsupported operations, missing authors, unknown fields and invalid budgets fail as JSON', () => {
  for (const args of [['overview', bundleFile, '--features', 'sidecar.json'], ['inspect', bundleFile, entry.id, '--source-limit', '-1'],
    ['overview', bundleFile, '--limit', '0'], ['apply', bundleFile, proposalFile], ['check', bundleFile, proposalFile],
    ['submit', bundleFile, proposalFile, '--author', 'agent fixture']]) errorResult(cli(...args));
  const proposal = draft(); proposal.mappings[0].decision = 'accepted';
  const file = path.join(directory, 'spoofed-revision.json'); fs.writeFileSync(file, JSON.stringify(proposal));
  assert.match(errorResult(cli('check', bundleFile, file, '--author', 'agent fixture')).message, /unknown field/);
});

test('a damaged task bundle is rejected rather than silently repaired or overwritten', () => {
  const damaged = structuredClone(bundle); damaged.graph.files[0].source += 'tampered';
  const file = path.join(directory, 'damaged-task.json'); fs.writeFileSync(file, JSON.stringify(damaged));
  const before = fs.readFileSync(file, 'utf8');
  assert.match(errorResult(cli('overview', file)).message, /frozen input/); assert.equal(fs.readFileSync(file, 'utf8'), before);
});
