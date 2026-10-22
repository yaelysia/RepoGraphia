import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyze } from '../dist/analyze.js';
import { checkAnalysisInputs, loadProject } from '../dist/project.js';

const roots = [];
after(() => roots.forEach(root => fs.rmSync(root, { recursive: true, force: true })));
const config = { compilerOptions: { noLib: true, module: 'ESNext', moduleResolution: 'Bundler' }, files: ['main.ts'] };
function fixture(files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repographia-inputs-')); roots.push(root);
  for (const [file, text] of Object.entries({ 'tsconfig.json': JSON.stringify(config), 'main.ts': 'export function main() { return 1; }', ...files })) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text);
  }
  return root;
}
function captured(root) {
  let inputs;
  const graph = analyze(root, { includeSource: true, onInputs: value => { inputs = value; } });
  assert.ok(inputs);
  return { graph, inputs: JSON.parse(JSON.stringify(inputs)) };
}

test('captured inputs survive worker-style serialization and detect source edits without changing the old graph', () => {
  const root = fixture(), { graph, inputs } = captured(root);
  assert.deepEqual(checkAnalysisInputs(inputs), { current: true, changed: [] });
  assert.equal(inputs.reads.find(item => item.path === path.join(root, 'main.ts')).hash, graph.files[0].hash);
  fs.writeFileSync(path.join(root, 'main.ts'), 'export function main() { return 2; }');
  const check = checkAnalysisInputs(inputs);
  assert.equal(check.current, false); assert.ok(check.changed.includes(path.join(root, 'main.ts')));
  assert.match(graph.files[0].source, /return 1/);
  assert.notEqual(captured(root).graph.project.snapshot, graph.project.snapshot);
});

test('configuration and compiler reads share fixed per-path content through the complete rebuild', () => {
  const root = fixture(), project = loadProject(root);
  const before = project.captureInputs(), originalConfig = project.inputReader.readFile(path.join(root, 'tsconfig.json'));
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ ...config, compilerOptions: { ...config.compilerOptions, strict: true } }));
  fs.writeFileSync(path.join(root, 'main.ts'), 'export function main() { return 99; }');
  assert.equal(project.inputReader.readFile(path.join(root, 'tsconfig.json')), originalConfig);
  assert.match(project.inputReader.readFile(path.join(root, 'main.ts')), /return 1/);
  assert.deepEqual(project.captureInputs().reads, before.reads);
  assert.equal(checkAnalysisInputs(project.captureInputs()).current, false);
});

test('root and inherited configuration bytes participate even when compiler options are unchanged', () => {
  const root = fixture({
    'base.json': '{"compilerOptions":{"strict":true}}',
    'tsconfig.json': JSON.stringify({ ...config, extends: './base.json' }),
  });
  const first = captured(root);
  assert.ok(first.inputs.reads.some(item => item.path === path.join(root, 'base.json')));
  fs.appendFileSync(path.join(root, 'base.json'), '\n// changed explanation, identical options\n');
  assert.equal(checkAnalysisInputs(first.inputs).current, false);
  const second = captured(root); assert.notEqual(second.graph.project.snapshot, first.graph.project.snapshot);
  fs.appendFileSync(path.join(root, 'tsconfig.json'), '\n// changed root config\n');
  assert.equal(checkAnalysisInputs(second.inputs).current, false);
  assert.notEqual(captured(root).graph.project.snapshot, second.graph.project.snapshot);
});

test('inherited configuration outside the root is captured and reconciled', () => {
  const external = fixture({ 'external.json': '{"compilerOptions":{"strict":true}}' });
  const root = fixture({ 'tsconfig.json': JSON.stringify({ ...config, extends: path.join(external, 'external.json') }) });
  const first = captured(root);
  fs.appendFileSync(path.join(external, 'external.json'), '\n// outside root update\n');
  assert.ok(checkAnalysisInputs(first.inputs).changed.includes(path.join(external, 'external.json')));
  assert.notEqual(captured(root).graph.project.snapshot, first.graph.project.snapshot);
});

test('inventory additions and deletions invalidate captures including changes outside the selected program', () => {
  const root = fixture(), first = captured(root);
  fs.writeFileSync(path.join(root, 'outside.ts'), 'export const outside = 1;');
  assert.equal(checkAnalysisInputs(first.inputs).current, false);
  const second = captured(root);
  assert.notEqual(second.graph.project.snapshot, first.graph.project.snapshot);
  assert.ok(second.graph.coverage.unindexed.some(item => item.path === 'outside.ts'));
  fs.unlinkSync(path.join(root, 'outside.ts'));
  assert.equal(checkAnalysisInputs(second.inputs).current, false);
  assert.equal(captured(root).graph.project.snapshot, first.graph.project.snapshot);
});

test('a newly created default tsconfig is noticed when the earlier project had none', () => {
  const root = fixture(); fs.unlinkSync(path.join(root, 'tsconfig.json'));
  const first = captured(root);
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify(config));
  assert.equal(checkAnalysisInputs(first.inputs).current, false);
  assert.ok(first.inputs.files.some(item => item.path === path.join(root, 'tsconfig.json') && !item.exists));
});

test('previously missing dependency resolution is detected without traversing node_modules inventory', () => {
  const root = fixture({ 'main.ts': "import { run } from 'fresh-package'; run();" });
  fs.mkdirSync(path.join(root, 'node_modules'));
  const first = captured(root);
  assert.ok(first.graph.relations.some(edge => edge.kind === 'import' && edge.status === 'unresolved'));
  fs.mkdirSync(path.join(root, 'node_modules', 'fresh-package'));
  fs.writeFileSync(path.join(root, 'node_modules', 'fresh-package', 'index.d.ts'), 'export declare function run(): void;');
  const check = checkAnalysisInputs(first.inputs);
  assert.equal(check.current, false);
  assert.ok(check.changed.some(file => file.includes('node_modules')));
  const second = captured(root);
  assert.deepEqual(second.inputs.inventory, first.inputs.inventory);
  assert.notEqual(second.graph.project.snapshot, first.graph.project.snapshot);
  assert.ok(second.graph.relations.some(edge => edge.kind === 'call' && edge.status === 'external'));
});

test('declaration contents and package resolution metadata are captured as analysis inputs', () => {
  const root = fixture({
    'main.ts': "import { run } from 'existing-package'; run();",
    'node_modules/existing-package/package.json': '{"name":"existing-package","types":"one.d.ts"}',
    'node_modules/existing-package/one.d.ts': 'export declare function run(): void;',
    'node_modules/existing-package/two.d.ts': 'export declare const run: number;',
  });
  const first = captured(root), declarations = path.join(root, 'node_modules/existing-package/one.d.ts');
  fs.appendFileSync(declarations, '\nexport declare function second(): void;');
  assert.ok(checkAnalysisInputs(first.inputs).changed.includes(declarations));
  const second = captured(root), metadata = path.join(root, 'node_modules/existing-package/package.json');
  fs.writeFileSync(metadata, '{"name":"existing-package","types":"two.d.ts"}');
  assert.ok(checkAnalysisInputs(second.inputs).changed.includes(metadata));
  assert.notEqual(captured(root).graph.project.snapshot, second.graph.project.snapshot);
});

test('new automatic type packages invalidate the recorded directory query', () => {
  const root = fixture({ 'main.ts': 'ambientFn();' });
  fs.mkdirSync(path.join(root, 'node_modules/@types'), { recursive: true });
  const first = captured(root);
  fs.mkdirSync(path.join(root, 'node_modules/@types/ambient'));
  fs.writeFileSync(path.join(root, 'node_modules/@types/ambient/index.d.ts'), 'declare function ambientFn(): void;');
  const check = checkAnalysisInputs(first.inputs);
  assert.equal(check.current, false);
  assert.ok(check.changed.some(file => file.includes('@types')));
  const second = captured(root);
  assert.deepEqual(second.inputs.inventory, first.inputs.inventory);
  assert.ok(second.graph.relations.some(edge => edge.kind === 'call' && edge.status === 'external'));
});

test('missing read results stay fixed for the run and a later file appears only in the next rebuild', () => {
  const root = fixture(), project = loadProject(root), missing = path.join(root, 'later.ts');
  assert.equal(project.inputReader.readFile(missing), undefined);
  fs.writeFileSync(missing, 'export function later() {}');
  assert.equal(project.inputReader.readFile(missing), undefined);
  assert.equal(checkAnalysisInputs(project.captureInputs()).current, false);
  assert.match(loadProject(root).inputReader.readFile(missing), /function later/);
});

test('removed source and replaced configuration fail reconciliation instead of remaining current', () => {
  const root = fixture(), first = captured(root);
  fs.unlinkSync(path.join(root, 'main.ts'));
  assert.ok(checkAnalysisInputs(first.inputs).changed.includes(path.join(root, 'main.ts')));
  fs.writeFileSync(path.join(root, 'tsconfig.json'), '{ broken config');
  assert.equal(checkAnalysisInputs(first.inputs).current, false);
  assert.throws(() => captured(root));
});
