import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('../scripts/verify-project-map.mjs', import.meta.url));
const files = ['src/renderer/view.ts', 'src/run.ts', 'electron/main.ts', 'collector/tools.ts'];
const location = (file, start = 0) => ({ file, start, end: start + 4, line: 1, column: start + 1, endLine: 1, endColumn: start + 5 });
function fixture() {
  const graph = {
    schemaVersion: 1,
    project: { name: 'comparison-fixture', snapshot: 'before-input-contract', analysisRevision: 4,
      compilerVersion: '5.9.3', commit: 'same-source', config: 'tsconfig.json', createdAt: 'before', dirty: null },
    files: files.map(file => ({ path: file, hash: 'hash:' + file, lines: 1, source: 'function run() { next(); }' })),
    nodes: files.flatMap((file, i) => [
      { id: 'f' + i, name: file, kind: 'file', location: location(file), parent: null, snippet: '', hasBody: true },
      { id: 'n' + i, name: 'run', kind: 'function', location: location(file, 1), parent: 'f' + i, snippet: 'run', hasBody: true },
    ]),
    relations: [], diagnostics: [],
    coverage: { indexedFiles: files.length, inventorySourceFiles: files.length, unindexed: [], skippedSymlinks: [],
      ignoredDirectories: [], syntaxCalls: 2, callsByStatus: { bound: 0, candidate: 1, unresolved: 1, external: 0 }, limitations: ['Static evidence only.'] },
  };
  const edge = (id, from, targets, kind, status) => {
    const ownerFile = graph.nodes.find(node => node.id === from).location.file;
    return { id, from, targets, kind, status, targetLabel: 'next',
      evidence: { rule: 'fixture', explanation: 'Independently labelled static evidence.', location: location(ownerFile, 2),
        fileHash: 'hash:' + ownerFile, excerpt: 'next()' } };
  };
  graph.relations = [edge('candidate', 'n0', ['n1'], 'call', 'candidate'), edge('unknown', 'n1', [], 'call', 'unresolved'),
    { ...edge('types', 'f2', ['f1'], 'import', 'bound'), typeOnly: true }];
  graph.relations[0].evidence.valueOrigins = { complete: false, truncated: true, visited: 3,
    limits: { maxDepth: 12, maxSteps: 64, maxSources: 16, maxStops: 16, maxCallsites: 16 },
    sources: [{ target: 'n1', path: [{ kind: 'implementation', location: location(files[1], 1), fileHash: 'hash:' + files[1], excerpt: 'run' }] }],
    stops: [{ reason: 'open-callers', location: location(files[0], 1), fileHash: 'hash:' + files[0], excerpt: 'callback' }] };
  graph.relations[1].evidence.reason = 'parameter-value';
  return graph;
}
function verify(t, before, after) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repographia-map-comparison-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = [path.join(dir, 'before.json'), path.join(dir, 'after.json')], out = path.join(dir, 'result.json');
  const contents = [JSON.stringify(before), JSON.stringify(after)];
  input.forEach((file, i) => fs.writeFileSync(file, contents[i]));
  const result = spawnSync(process.execPath, [script, ...input, out], { encoding: 'utf8' });
  input.forEach((file, i) => assert.equal(fs.readFileSync(file, 'utf8'), contents[i], 'comparison must not rewrite its inputs'));
  return { ...result, report: fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null };
}

test('same-source map verification retains different input-contract snapshots without rewriting either one', t => {
  const before = fixture(), after = structuredClone(before);
  after.project.snapshot = 'after-input-contract'; after.project.createdAt = 'after';
  const result = verify(t, before, after);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.report.beforeSnapshot, before.project.snapshot); assert.equal(result.report.afterSnapshot, after.project.snapshot);
  assert.equal(result.report.identicalRelations, true); assert.equal(result.report.identicalRelationFacts, true);
  assert.ok(result.report.maps.every(map => map.snapshot === after.project.snapshot));
});

test('only outer relation order and snapshot-local relation IDs may change', t => {
  const before = fixture(), after = structuredClone(before);
  after.relations.reverse(); after.relations.forEach((edge, i) => { edge.id = 'new-edge:' + i; });
  // Object property insertion order is not an analysis fact either.
  after.relations[0].evidence = Object.fromEntries(Object.entries(after.relations[0].evidence).reverse());
  const result = verify(t, before, after);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.report.identicalRelations, false); assert.equal(result.report.identicalRelationFacts, true);
});

test('changed source, declarations, coverage, diagnostics or analysis setup still fail the sample gate', t => {
  const changes = [
    graph => { graph.files[0].hash = 'different'; }, graph => { graph.nodes[0].name = 'different'; },
    graph => { graph.coverage.callsByStatus.candidate++; }, graph => { graph.diagnostics.push({ category: 'error', code: 'TS1', message: 'changed' }); },
    ...['analysisRevision', 'compilerVersion', 'commit', 'config'].map(key => graph => { graph.project[key] = 'different'; }),
  ];
  for (const change of changes) {
    const before = fixture(), after = structuredClone(before); change(after);
    const result = verify(t, before, after); assert.notEqual(result.status, 0); assert.equal(result.report, null);
  }
});

test('full relation evidence including origin paths, stops and budgets remains mandatory', t => {
  const changes = [
    edge => { edge.kind = 'construct'; }, edge => { edge.status = 'bound'; }, edge => { edge.from = 'n2'; },
    edge => { edge.targets = ['n2']; }, edge => { edge.targetLabel = 'different'; }, edge => { edge.typeOnly = true; },
    edge => { edge.evidence.rule = 'different'; }, edge => { edge.evidence.explanation = 'different'; },
    edge => { edge.evidence.fileHash = 'different'; }, edge => { edge.evidence.location.end++; },
    edge => { edge.evidence.excerpt = 'different()'; }, edge => { edge.evidence.reason = 'complex-expression'; },
    edge => { edge.evidence.declaration = { location: location(files[3]), fileHash: 'different' }; },
    edge => { edge.evidence.valueOrigins.truncated = false; }, edge => { edge.evidence.valueOrigins.complete = true; },
    edge => { edge.evidence.valueOrigins.visited++; }, edge => { edge.evidence.valueOrigins.limits.maxCallsites--; },
    edge => { edge.evidence.valueOrigins.sources[0].target = 'n2'; },
    edge => { edge.evidence.valueOrigins.sources[0].path[0].kind = 'direct-callsite'; },
    edge => { edge.evidence.valueOrigins.stops[0].reason = 'caller-budget'; },
  ];
  for (const change of changes) {
    const before = fixture(), after = structuredClone(before); change(after.relations[0]);
    const result = verify(t, before, after);
    assert.notEqual(result.status, 0); assert.match(result.stderr, /Full relation facts and multiplicity must not change/);
    assert.equal(result.report, null);
  }
});

test('equal counts and unique fact sets cannot hide changed duplicate multiplicity', t => {
  const before = fixture(); before.relations.push({ ...structuredClone(before.relations[0]), id: 'repeated-candidate' });
  const after = structuredClone(before); after.relations[3] = { ...structuredClone(before.relations[1]), id: 'repeated-unknown' };
  const result = verify(t, before, after);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /Full relation facts and multiplicity must not change/);
  assert.equal(result.report, null);
});

test('ignoring cross-snapshot edge IDs does not permit duplicate IDs inside either snapshot', t => {
  for (const side of ['before', 'after']) {
    const graphs = { before: fixture(), after: fixture() };
    graphs[side].relations[1].id = graphs[side].relations[0].id;
    const result = verify(t, graphs.before, graphs.after);
    assert.notEqual(result.status, 0); assert.match(result.stderr, /Duplicate relation ID/); assert.equal(result.report, null);
  }
});
