import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyze } from '../dist/analyze.js';
import { neighborhood } from '../dist/query.js';

// Parse this fixture only. None of its declarations or expressions are executed.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repographia-evidence-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const source = `
class Base {} class Other {}
let Parent = Base; Parent = Other;
const Saved = Parent;
class MutableDerived extends Parent {}
class AliasDerived extends Saved {}
class DirectDerived extends Base {}
interface Contract { execute(): void; }
interface ExtendedContract extends Contract {}
class Implementation implements Contract { execute() {} }
function leaf() { return 1; }
function other() { return 2; }
const wrapped = (() => leaf()) satisfies () => number;
wrapped();
const forwarded = leaf satisfies () => number;
forwarded();
let mutable = leaf; mutable = other;
const guardedAlias = mutable satisfies () => number;
guardedAlias();
function register(fn: () => number) { return fn(); }
function registration() { register((() => leaf()) satisfies () => number); }
function classKey() { return 'run' as const; }
function methodBody() { return 1; }
class Named { [classKey()]() { return methodBody(); } }
function objectKey() { return 'run' as const; }
function objectBody() { return 1; }
function makeObject() { return { [objectKey()]() { return objectBody(); } }; }
function nestedKey() { return 'run' as const; }
class Nested { [(() => nestedKey())()]() { return methodBody(); } }
function accessorKey() { return 'value' as const; }
class Accessor { get [accessorKey()]() { return methodBody(); } }
`;
fs.writeFileSync(path.join(root, 'source.ts'), source);
const graph = analyze(root, { includeSource: true });
const node = (name, kind) => {
  const matches = graph.nodes.filter(n => n.name === name && (!kind || n.kind === kind));
  assert.equal(matches.length, 1, `Expected exactly one ${kind ?? 'node'}: ${name}`);
  return matches[0];
};
const edge = (label, kind = 'call') => {
  const matches = graph.relations.filter(e => e.targetLabel === label && e.kind === kind);
  assert.equal(matches.length, 1, `Expected exactly one ${kind} edge: ${label}`);
  return matches[0];
};
const owner = e => graph.nodes.find(n => n.id === e.from);

test('hardening fixture is type-correct; uncertainty is not a missing-types artifact', () => {
  assert.deepEqual(graph.diagnostics.filter(d => d.category === 'error'), []);
});
test('direct superclass retains its lexical binding without becoming a function call', () => {
  const e = edge('Base', 'extends');
  assert.equal(e.status, 'bound');
  assert.deepEqual(e.targets, [node('Base', 'class').id]);
});
test('mutable superclass is a candidate, never a proven binding to its initializer', () => {
  const e = edge('Parent', 'extends');
  assert.equal(e.status, 'candidate');
  assert.deepEqual(e.targets, [node('Base', 'class').id]);
  assert.match(e.evidence.explanation, /candidate|reassignment|value.flow/i);
});
test('constant alias does not erase uncertainty of a mutable superclass', () => {
  const e = edge('Saved', 'extends');
  assert.equal(e.status, 'candidate');
  assert.equal(e.typeOnly, false);
  assert.deepEqual(e.targets, [node('Base', 'class').id]);
});
test('interface extension and implementation stay bound type relationships', () => {
  for (const e of graph.relations.filter(e => e.targetLabel === 'Contract')) {
    assert.equal(e.status, 'bound');
    assert.equal(e.typeOnly, true);
    assert.deepEqual(e.targets, [node('Contract', 'interface').id]);
  }
  assert.equal(graph.relations.filter(e => e.targetLabel === 'Contract').length, 2);
});
test('satisfies-wrapped arrow retains its implementation and useful declaration name', () => {
  const e = edge('wrapped');
  assert.equal(e.status, 'bound');
  assert.deepEqual(e.targets, [node('wrapped', 'function').id]);
  assert.equal(node('wrapped', 'function').hasBody, true);
});
test('satisfies-wrapped constant alias uses the value symbol, not a type-name guess', () => {
  const e = edge('forwarded');
  assert.equal(e.status, 'bound');
  assert.deepEqual(e.targets, [node('leaf', 'function').id]);
});
test('satisfies does not turn a mutable callable alias into a bound implementation', () => {
  const e = edge('guardedAlias');
  assert.equal(e.status, 'candidate');
  assert.deepEqual(e.targets, [node('leaf', 'function').id]);
});
test('wrapped callback passing is retained but is not an invocation edge', () => {
  const id = node('registration', 'function').id;
  const owned = graph.relations.filter(e => e.from === id);
  const callbacks = owned.filter(e => e.kind === 'callback');
  assert.equal(callbacks.length, 1);
  assert.equal(callbacks[0].status, 'bound');
  assert.ok(!owned.some(e => e.kind === 'call' && e.targets.includes(callbacks[0].targets[0])));
  assert.equal(edge('fn').status, 'unresolved');
});
test('computed class method name belongs to the definition context, not the method body', () => {
  assert.equal(owner(edge('classKey')).id, node('Named', 'class').id);
  const method = node('[classKey()]', 'method');
  const calls = graph.relations.filter(e => e.from === method.id && e.kind === 'call');
  assert.deepEqual(calls.map(e => e.targetLabel), ['methodBody']);
  const reachable = neighborhood(graph, method.id, { direction: 'out', depth: 2 });
  assert.ok(!reachable.nodes.some(n => n.name === 'classKey'));
});
test('computed object method name belongs to the enclosing function, not the new method', () => {
  assert.equal(owner(edge('objectKey')).id, node('makeObject', 'function').id);
  assert.equal(owner(edge('objectBody')).id, node('[objectKey()]', 'method').id);
});
test('nested function in a computed name has the same definition-context parent as its IIFE call', () => {
  const callback = owner(edge('nestedKey'));
  assert.equal(callback.parent, node('Nested', 'class').id);
  const invocation = graph.relations.find(e => e.kind === 'call' && e.targets.includes(callback.id));
  assert.ok(invocation);
  assert.equal(invocation.from, callback.parent);
});
test('computed accessor name is not reported as a call from the accessor body', () => {
  assert.equal(owner(edge('accessorKey')).id, node('Accessor', 'class').id);
  assert.notEqual(edge('accessorKey').from, node('[accessorKey()]', 'method').id);
});
test('corrected relations keep exact source ranges, file hashes and valid endpoints', () => {
  const ids = new Set(graph.nodes.map(n => n.id));
  for (const e of graph.relations) {
    assert.ok(ids.has(e.from));
    assert.ok(e.targets.every(id => ids.has(id)));
    assert.equal(e.evidence.fileHash, graph.files[0].hash);
    assert.equal(e.evidence.excerpt, source.slice(e.evidence.location.start, e.evidence.location.end).slice(0, 1200));
  }
});
test('analysis metadata distinguishes changed extraction rules from older R1 snapshots', () => {
  assert.equal(graph.project.analysisRevision, 3);
});
