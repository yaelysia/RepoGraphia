import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeNewBundle } from '../dist/output.js';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'repographia output safety '));
after(() => fs.rmSync(temp, { recursive: true, force: true }));
const source = path.join(temp, 'source with spaces');
fs.mkdirSync(source);
const original = 'export function leaf() { return 1; }\nexport function entry() { return leaf(); }\n';
const sourceFile = path.join(source, 'main.ts');
fs.writeFileSync(sourceFile, original);
const cli = path.resolve('dist/cli.js');
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 20000 });

for (const filename of ['graph.json', 'index.html']) {
  test(`analyze refuses a ${filename} hard link to source without any partial output`, () => {
    const dest = path.join(temp, 'hardlink-' + filename); fs.mkdirSync(dest);
    fs.linkSync(sourceFile, path.join(dest, filename));
    const result = run('analyze', source, '--out', dest);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /already exists/);
    assert.equal(fs.readFileSync(sourceFile, 'utf8'), original);
    assert.deepEqual(fs.readdirSync(dest), [filename]);
  });
}
test('analyze preserves an existing report and rejects even an empty existing directory', () => {
  const dest = path.join(temp, 'existing'); fs.mkdirSync(dest);
  assert.equal(run('analyze', source, '--out', dest).status, 1);
  for (const name of ['graph.json', 'index.html']) fs.writeFileSync(path.join(dest, name), 'original ' + name);
  assert.equal(run('analyze', source, '--out', dest).status, 1);
  for (const name of ['graph.json', 'index.html']) assert.equal(fs.readFileSync(path.join(dest, name), 'utf8'), 'original ' + name);
});
test('invalid feature data fails before the report directory is created', () => {
  const dest = path.join(temp, 'invalid-sidecar-report'), sidecar = path.join(temp, 'invalid.json');
  fs.writeFileSync(sidecar, '{}');
  assert.equal(run('analyze', source, '--out', dest, '--features', sidecar).status, 1);
  assert.ok(!fs.existsSync(dest));
  assert.equal(fs.readFileSync(sourceFile, 'utf8'), original);
});
test('README clone-and-build usage works from an unrelated cwd with spaces', () => {
  const dest = path.join(temp, 'new report');
  const result = spawnSync(process.execPath, [cli, 'analyze', source, '--out', dest, '--include-source'],
    { cwd: temp, encoding: 'utf8', timeout: 20000 });
  assert.equal(result.status, 0, result.stderr);
  const graphFile = path.join(dest, 'graph.json'), graph = JSON.parse(fs.readFileSync(graphFile, 'utf8'));
  assert.equal(graph.files[0].source, original);
  assert.match(fs.readFileSync(path.join(dest, 'index.html'), 'utf8'), /Content-Security-Policy/);
  assert.equal(run('query', graphFile, 'callees', 'entry').status, 0);
  const overview = run('agent', 'overview', graphFile);
  assert.equal(overview.status, 0, overview.stderr);
  assert.ok(JSON.parse(overview.stdout).data.proposalHeader.baseDigest);
  assert.equal(run('features', 'init', graphFile, '--out', path.join(temp, 'features.json')).status, 0);
});
test('shared bundle writer is exclusive and keeps ordered receipt last', () => {
  const dest = path.join(temp, 'bundle');
  writeNewBundle(dest, { 'data.json': '{}', 'receipt.json': 'completed' });
  assert.equal(fs.readFileSync(path.join(dest, 'receipt.json'), 'utf8'), 'completed');
  assert.throws(() => writeNewBundle(dest, { 'data.json': 'replacement' }), { code: 'EEXIST' });
  assert.equal(fs.readFileSync(path.join(dest, 'data.json'), 'utf8'), '{}');
});
test('shared bundle writer rejects path traversal before creating a directory', () => {
  for (const name of ['../escape', 'a/b', 'a\\b', '..', '.', 'C:escape']) {
    const dest = path.join(temp, 'invalid-bundle');
    assert.throws(() => writeNewBundle(dest, { [name]: 'no' }), /single path components/);
    assert.ok(!fs.existsSync(dest));
  }
});
