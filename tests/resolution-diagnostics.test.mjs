import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyze } from '../dist/analyze.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repographia-reasons-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));
// These declarations are analysis fixtures, not installed or executed dependencies.
fs.mkdirSync(path.join(root, 'node_modules/fixture-lib'), { recursive: true });
fs.writeFileSync(path.join(root, 'node_modules/fixture-lib/package.json'), JSON.stringify({ name: 'fixture-lib', types: 'index.d.ts' }));
fs.writeFileSync(path.join(root, 'node_modules/fixture-lib/index.d.ts'), `
export declare function externalFn(): number;
export declare const service: { run: () => number };
`);
fs.writeFileSync(path.join(root, 'api.d.ts'), 'export declare function api(): number;\n');
const source = `
import { externalFn, service } from 'fixture-lib';
import { api } from './api.js';
export function builtins() { new Map(); new Set(); new Error(); String(1); }
export function externalProperty() { return service.run(); }
export function externalDirect() { return externalFn(); }
function leaf() { return 1; }
function other() { return 2; }
export function shadowed(Map: () => number) { return Map(); }
export function typedParameter(fn: typeof externalFn) { return fn(); }
let moving = externalFn; moving = other;
const saved = moving;
export function movingAlias() { return saved(); }
const fixed = externalFn;
export function fixedAlias() { return fixed(); }
const obj = { run: leaf, arrow: () => leaf() };
obj.run = other;
export function objectRun() { return obj.run(); }
export function objectArrow() { return obj.arrow(); }
const detached = obj.run;
export function detachedProperty() { return detached(); }
class Worker { work = () => leaf(); }
export function field(worker: Worker) { return worker.work(); }
export function propertyParameter(input: { task: () => number }) { return input.task(); }
export function bindingParameter([setter]: [() => number]) { return setter(); }
function factory() { return leaf; }
const produced = factory();
export function factoryResult() { return produced(); }
export function outOfScope() { return api(); }
export function unknownReceiver(value: any) { return value.doesNotExist(); }
export function dynamicModule(name: string) { return import(name); }
export function declarationOnly(value: { get task(): () => number }) { return value.task(); }
class WithGetter { get task() { return leaf; } }
const getterObject = new WithGetter();
const getterAlias = getterObject.task;
export function actualGetter() { return getterObject.task(); }
export function aliasedGetter() { return getterAlias(); }
export function passing() { return accept(obj.run); }
function accept(fn: () => number) { return fn(); }
`;
fs.writeFileSync(path.join(root, 'source.ts'), source);
const graph = analyze(root, { includeSource: true });
const nodes = new Map(graph.nodes.map(n => [n.id, n]));
const calls = name => {
  const n = graph.nodes.find(n => n.name === name && n.kind === 'function');
  assert.ok(n, name);
  return graph.relations.filter(e => e.from === n.id && e.kind === 'call');
};
const one = name => { const es = calls(name); assert.equal(es.length, 1, name); return es[0]; };

test('resolution fixture is type-correct with its own external declarations', () => {
  assert.deepEqual(graph.diagnostics.filter(d => d.category === 'error'), []);
});
test('standard-library var declarations are external boundaries, not unknown values', () => {
  const es = graph.relations.filter(e => nodes.get(e.from)?.name === 'builtins');
  assert.equal(es.length, 4);
  for (const e of es) { assert.equal(e.status, 'external', e.targetLabel); assert.deepEqual(e.targets, []); }
});
test('dependency callable property records a declaration boundary, not an implementation', () => {
  const e = one('externalProperty');
  assert.equal(e.status, 'external'); assert.deepEqual(e.targets, []);
  assert.match(e.evidence.explanation, /not.*(execution|runtime)|implementation.*not/i);
});
test('existing direct dependency calls and immutable function aliases stay external', () => {
  for (const name of ['externalDirect', 'fixedAlias']) assert.equal(one(name).status, 'external');
});
test('same-named local Map parameter never inherits the standard-library boundary', () => {
  const e = one('shadowed');
  assert.equal(e.status, 'unresolved'); assert.equal(e.evidence.reason, 'parameter-value');
});
test('local callable parameter with external type remains a local unresolved value', () => {
  const e = one('typedParameter');
  assert.equal(e.status, 'unresolved'); assert.equal(e.evidence.reason, 'parameter-value');
});
test('mutable aliases of external functions are not reclassified as direct external bindings', () => {
  const e = one('movingAlias');
  assert.equal(e.status, 'unresolved'); assert.equal(e.evidence.reason, 'mutable-value');
});
test('object property initialized with a function retains only its initializer candidate', () => {
  const e = one('objectRun'); assert.equal(e.status, 'candidate');
  assert.deepEqual(e.targets.map(id => nodes.get(id).name), ['leaf']);
  assert.ok(!e.targets.some(id => nodes.get(id).name === 'other'));
});
test('arrow property and class field link to declared bodies without certain dispatch', () => {
  for (const [name, target] of [['objectArrow','arrow'], ['field','work']]) {
    const e = one(name); assert.equal(e.status, 'candidate', name);
    assert.deepEqual(e.targets.map(id => nodes.get(id).name), [target]);
  }
});
test('detaching a mutable property does not erase its candidate status', () => {
  const e = one('detachedProperty'); assert.equal(e.status, 'candidate');
  assert.deepEqual(e.targets.map(id => nodes.get(id).name), ['leaf']);
});
test('uninitialized property contracts stay unresolved instead of matching a nearby function', () => {
  const e = one('propertyParameter');
  assert.equal(e.status, 'unresolved'); assert.equal(e.evidence.reason, 'property-value');
});
test('destructured callables are explicitly classified without guessing their value flow', () => {
  const e = one('bindingParameter');
  assert.equal(e.status, 'unresolved'); assert.equal(e.evidence.reason, 'binding-pattern');
});
test('factory-returned callable remains unknown without a return-value analysis', () => {
  const e = one('factoryResult');
  assert.equal(e.status, 'unresolved'); assert.equal(e.evidence.reason, 'returned-callable');
});
test('local declaration-only module discloses source evidence rather than a fabricated implementation', () => {
  const e = one('outOfScope');
  assert.equal(e.status, 'unresolved'); assert.equal(e.evidence.reason, 'out-of-scope-declaration');
  assert.deepEqual(e.targets, []);
  assert.equal(e.evidence.declaration.location.file, 'api.d.ts');
  assert.equal(e.evidence.declaration.location.line, 1);
  assert.match(e.evidence.declaration.fileHash, /^[a-f0-9]{64}$/);
});
test('untyped receivers and dynamic module loader calls have distinct diagnostic reasons', () => {
  assert.equal(one('unknownReceiver').evidence.reason, 'missing-symbol');
  assert.equal(one('dynamicModule').evidence.reason, 'dynamic-import');
});
test('getter returning a callable is not mistaken for a call of the getter body', () => {
  const e = one('declarationOnly');
  assert.notEqual(e.status, 'bound');
  assert.ok(!e.targets.some(id => nodes.get(id)?.hasBody));
});
test('property callback evidence is not promoted to callback invocation', () => {
  const n = graph.nodes.find(n => n.name === 'passing');
  const passed = graph.relations.filter(e => e.from === n.id && e.kind === 'callback');
  assert.equal(passed.length, 1); assert.equal(passed[0].status, 'candidate');
  assert.ok(!calls('passing').some(e => e.targets.includes(passed[0].targets[0])));
});
test('all unresolved explicit calls have one diagnostic reason and intact callsite evidence', () => {
  const es = graph.relations.filter(e => ['call','construct','tag'].includes(e.kind) && e.status === 'unresolved');
  assert.ok(es.length > 5);
  for (const e of es) {
    assert.ok(e.evidence.reason, e.targetLabel);
    assert.equal(e.evidence.excerpt, source.slice(e.evidence.location.start, e.evidence.location.end).slice(0,1200));
    assert.ok(nodes.has(e.from)); assert.ok(e.targets.every(id => nodes.has(id)));
  }
});

test('getter implementation and captured getter result are not callable target bodies', () => {
  for (const name of ['actualGetter', 'aliasedGetter']) {
    const e = one(name); assert.equal(e.status, 'unresolved');
    assert.equal(e.evidence.reason, 'returned-callable'); assert.deepEqual(e.targets, []);
  }
});
