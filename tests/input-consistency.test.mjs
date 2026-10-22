import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { analyze } from '../dist/analyze.js';
import { analysisInputDigest, checkAnalysisInputs, loadProject } from '../dist/project.js';

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

test('directory scans preserve compiler traversal order while captures use sorted copies', () => {
  const root = fixture({ 'z.ts': 'function lastAtRoot() {}', 'a/nested.ts': 'function nested() {}' });
  const project = loadProject(root), extensions = ['.ts'], includes = ['**/*.ts'];
  const expected = ts.sys.readDirectory(root, extensions, undefined, includes);
  assert.notDeepEqual(expected, [...expected].sort(), 'fixture must exercise root files before nested files');
  const returned = project.inputReader.readDirectory(root, extensions, undefined, includes);
  assert.deepEqual(returned, expected);
  const inputs = project.captureInputs(), query = inputs.directoryQueries.find(item => item.path === root);
  assert.deepEqual(query.files, [...expected].sort());
  returned.reverse(); query.files.push('caller-only-mutation');
  assert.deepEqual(project.inputReader.readDirectory(root, extensions, undefined, includes), expected);
  assert.deepEqual(checkAnalysisInputs(project.captureInputs()), { current: true, changed: [] });
});

test('directory names retain the host order without exposing or mutating the cached result', () => {
  const root = fixture({ 'a/one.ts': '', 'z/two.ts': '' }), project = loadProject(root);
  const getDirectories = ts.sys.getDirectories, expected = getDirectories(root).sort().reverse();
  assert.equal(expected.length, 2);
  try {
    ts.sys.getDirectories = directory => directory === root ? [...expected] : getDirectories(directory);
    const returned = project.inputReader.getDirectories(root);
    assert.deepEqual(returned, expected);
    const inputs = project.captureInputs(), item = inputs.directoryNames.find(item => item.path === root);
    assert.deepEqual(item.names, [...expected].sort());
    returned.push('caller-only-mutation'); item.names.reverse();
    assert.deepEqual(project.inputReader.getDirectories(root), expected);
    assert.deepEqual(checkAnalysisInputs(project.captureInputs()), { current: true, changed: [] });
  } finally { ts.sys.getDirectories = getDirectories; }
});

test('input capture does not change the callers selected by the existing origin budget', () => {
  const root = fixture({
    'tsconfig.json': JSON.stringify({ compilerOptions: config.compilerOptions, include: ['**/*.ts'] }),
    'main.ts': 'function accept(callback: () => void) { callback(); }',
    'z.ts': 'function rootFirst() {}\naccept(rootFirst);',
    ...Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`a/caller${String(i).padStart(2, '0')}.ts`,
      `function nested${i}() {}\naccept(nested${i});`])),
  });
  const { graph, inputs } = captured(root), nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const relation = graph.relations.find(edge => edge.targetLabel === 'callback');
  const origins = relation.evidence.valueOrigins;
  assert.equal(relation.status, 'candidate'); assert.equal(origins.complete, false);
  assert.equal(origins.truncated, true); assert.equal(origins.limits.maxCallsites, 16);
  assert.deepEqual(origins.stops.map(stop => stop.reason), ['open-callers', 'caller-budget']);
  assert.deepEqual(origins.sources.map(source => nodes.get(source.target).name),
    ['rootFirst', ...Array.from({ length: 15 }, (_, i) => `nested${i}`)]);
  assert.deepEqual(origins.sources.map(source => source.path.find(point => point.kind === 'direct-callsite').location.file),
    ['z.ts', ...Array.from({ length: 15 }, (_, i) => `a/caller${String(i).padStart(2, '0')}.ts`)]);
  assert.deepEqual([...relation.targets].sort(), origins.sources.map(source => source.target).sort());
  assert.deepEqual(checkAnalysisInputs(inputs), { current: true, changed: [] });
});

test('config read attribution follows actual nonstandard transitive extends even when those files are indexed as source', () => {
  const root = fixture({
    'tsconfig.json': JSON.stringify({ compilerOptions: config.compilerOptions, extends: './settings.ts', include: ['*.ts'] }),
    'settings.ts': '{"extends":"./inherited.ts","compilerOptions":{"strict":true}}',
    'inherited.ts': '{"compilerOptions":{"allowJs":false}}',
    'ordinary.ts': 'export const ordinary = 1;',
    'unused-settings.ts': '{"compilerOptions":{"strict":false}}',
  });
  const first = captured(root), expected = ['tsconfig.json', 'settings.ts', 'inherited.ts'].map(file => path.join(root, file)).sort();
  assert.deepEqual(first.inputs.configReads, expected);
  for (const file of ['settings.ts', 'inherited.ts']) {
    const indexed = first.graph.files.find(item => item.path === file);
    assert.ok(indexed, 'Nonstandard inherited configuration must also be indexed in this fixture.');
    assert.equal(first.inputs.reads.find(item => item.path === path.join(root, file)).hash, indexed.hash);
  }
  assert.ok(first.inputs.reads.some(item => item.path === path.join(root, 'ordinary.ts')));
  assert.ok(first.inputs.reads.some(item => item.path === path.join(root, 'unused-settings.ts')));
  const project = loadProject(root), inputs = project.captureInputs(), digest = analysisInputDigest(inputs);
  inputs.configReads.reverse();
  assert.equal(analysisInputDigest(inputs), digest, 'Attribution order must not create a different snapshot.');
  inputs.configReads.push(path.join(root, 'ordinary.ts'));
  assert.notEqual(analysisInputDigest(inputs), digest, 'Read purpose must participate in the snapshot digest.');
  assert.deepEqual(project.captureInputs().configReads, expected);
  const inherited = path.join(root, 'inherited.ts'), original = project.inputReader.readFile(inherited);
  fs.appendFileSync(inherited, '\n// configuration update\n');
  assert.equal(project.inputReader.readFile(inherited), original);
  assert.equal(analysisInputDigest(project.captureInputs()), digest, 'Repeated compiler reads use the same captured bytes.');
  assert.ok(checkAnalysisInputs(first.inputs).changed.includes(inherited));
});

test('empty configuration attribution differs from legacy absence while old captures still reconcile', () => {
  const root = fixture(); fs.unlinkSync(path.join(root, 'tsconfig.json'));
  const { inputs } = captured(root), legacy = structuredClone(inputs); delete legacy.configReads;
  assert.deepEqual(inputs.configReads, []);
  assert.notEqual(analysisInputDigest(inputs), analysisInputDigest(legacy));
  assert.deepEqual(checkAnalysisInputs(legacy), { current: true, changed: [] });
  assert.equal(analysisInputDigest(JSON.parse(JSON.stringify(inputs))), analysisInputDigest(inputs));
  fs.appendFileSync(path.join(root, 'main.ts'), '\n// later source\n');
  assert.equal(checkAnalysisInputs(legacy).current, false);
});

test('a real extends resolution query detects a newly preferred configuration path with identical options', () => {
  const root = fixture({
    'tsconfig.json': JSON.stringify({ ...config, extends: './settings' }),
    'settings.json': '{"compilerOptions":{"strict":true}}',
  });
  const first = captured(root), preferred = path.join(root, 'settings'), fallback = path.join(root, 'settings.json');
  assert.ok(first.inputs.files.some(item => item.path === preferred && !item.exists));
  assert.ok(first.inputs.configReads.includes(fallback));
  assert.ok(!first.inputs.configReads.includes(preferred), 'Existence probes are not read-purpose observations.');
  fs.writeFileSync(preferred, fs.readFileSync(fallback, 'utf8'));
  assert.ok(checkAnalysisInputs(first.inputs).changed.includes(preferred));
  const second = captured(root);
  assert.ok(second.inputs.configReads.includes(preferred)); assert.ok(!second.inputs.configReads.includes(fallback));
  assert.deepEqual(first.graph.nodes, second.graph.nodes); assert.deepEqual(first.graph.relations, second.graph.relations);
  assert.notEqual(first.graph.project.snapshot, second.graph.project.snapshot);
});
