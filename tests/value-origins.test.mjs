import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyze } from '../dist/analyze.js';
import { neighborhood } from '../dist/query.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repographia-origins-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));
// Only parsed, never executed. Expected targets are named independently of the extractor.
const source = `
import { importedBox, importedInvoke } from './other.js';
const { task: importedTask } = importedBox;
export function crossFileUse() { return importedTask(); }
importedInvoke(beta);
export function typedThis(this: void, fn: () => number) { return fn(); }
typedThis(alpha);
export function overloadedOrigin(fn: () => number): number;
export function overloadedOrigin(fn: () => number) { return fn(); }
overloadedOrigin(beta);
export function alpha() { return 1; }
export function beta() { return 2; }
const box = { task: alpha, short: beta, nested: { work: alpha } };
const { task: renamed } = box;
export function objectUse() { renamed(); }
const { nested: { work } } = box;
export function nestedUse() { work(); }
const tuple = [alpha, beta] as const;
const [, second] = tuple;
export function arrayUse() { second(); }
const { alpha: shortFn } = { alpha };
export function shorthandUse() { shortFn(); }
const { task: wrapped } = ({ task: alpha } satisfies { task: () => number });
export function wrappedUse() { wrapped(); }
export function invoke(fn: () => number) { return fn(); }
invoke(alpha); invoke(beta);
export function relay(fn: () => number) { return invoke(fn); }
relay(alpha);
export function forwardingUse(fn: () => number) { const alias = fn; return alias(); }
forwardingUse(beta);
export function defaultUse(fn: () => number = alpha) { return fn(); }
defaultUse();
export function destructuredParameter({ task }: { task: () => number }) { return task(); }
destructuredParameter({ task: beta });
export class Consumer {
  constructor(private handler: () => number) {}
  use() { return this.handler(); }
}
new Consumer(alpha);
export function unknown(fn: () => number) { return fn(); }
export function changed(fn: () => number) { fn = beta; return fn(); }
changed(alpha);
export function changedByPattern(fn: () => number) { ({ fn } = { fn: beta }); return fn(); }
changedByPattern(alpha);
export function variadic(...fns: (() => number)[]) { const [first] = fns; return first(); }
variadic(alpha);
const { task: fallback = alpha } = {} as { task?: () => number };
export function defaultBindingUse() { fallback(); }
const { ...rest } = { task: alpha };
const { task: restTask } = rest;
export function restUse() { restTask(); }
const additional = { task: beta };
const { task: spreadTask } = { task: alpha, ...additional };
export function spreadUse() { spreadTask(); }
const key = 'task';
const { [key]: computedTask } = { task: alpha };
export function computedUse() { computedTask(); }
const { task: getterTask } = { get task() { return alpha; } };
export function getterUse() { getterTask(); }
function factory() { return [alpha] as const; }
const [created] = factory();
export function factoryUse() { created(); }
let moving = { task: alpha }; moving = { task: beta };
const { task: fromMoving } = moving;
export function mutableSourceUse() { fromMoving(); }
const fake = {} as { task: typeof alpha };
const { task: fromType } = fake;
export function typeOnlyUse() { fromType(); }
const [spreadEntry] = [...tuple];
export function spreadArrayUse() { spreadEntry(); }
export function spreadCallUse(fn: () => number) { return fn(); }
const args: [() => number] = [alpha]; spreadCallUse(...args);
const runtime = { method(fn: () => number) { return fn(); } }; runtime.method(alpha);
const recursive = (fn: () => number) => { recursive(fn); return fn(); };
recursive(alpha);
export function reassignedCallee(fn: () => number) { return fn(); }
// @ts-expect-error Intentional JavaScript-style rebinding tests the conservative stop.
reassignedCallee = unknown; reassignedCallee(alpha);
export class OverwrittenConsumer { constructor(private fn: () => number) {} useWritten() { this.fn = beta; return this.fn(); } }
new OverwrittenConsumer(alpha);
export function iterationWrite(fn: () => number) { for (fn of [beta]) {} return fn(); }
iterationWrite(alpha);
export function fan(fn: () => number) { return fn(); }
${Array.from({length:30}, () => 'fan(alpha);').join('\n')}
const deep0 = { task: alpha };
${Array.from({length:20}, (_,i) => `const deep${i+1} = deep${i};`).join('\n')}
const { task: deepTask } = deep20;
export function deepUse() { deepTask(); }
`;

fs.writeFileSync(path.join(root, 'source.ts'), source);
fs.writeFileSync(path.join(root, 'other.ts'), `import { alpha } from './source.js';
export const importedBox = { task: alpha };
export function importedInvoke(fn: () => number) { return fn(); }
`);
const graph = analyze(root, { includeSource: true });
const nodes = new Map(graph.nodes.map(n => [n.id, n]));
function call(owner, label) {
  const e = graph.relations.filter(e => e.kind === 'call' && nodes.get(e.from)?.name === owner && (!label || e.targetLabel === label));
  assert.equal(e.length, 1, `${owner}:${label ?? ''}`); return e[0];
}
function candidate(owner, expected, label) {
  const e = call(owner, label);
  assert.equal(e.status, 'candidate');
  assert.deepEqual([...new Set(e.targets.map(id => nodes.get(id).name))].sort(), [...expected].sort());
  assert.equal(e.evidence.valueOrigins.complete, false);
  assert.equal(e.evidence.rule, 'bounded-value-origin');
  return e;
}
for (const [owner, expected] of [
  ['crossFileUse',['alpha']], ['importedInvoke',['beta']], ['typedThis',['alpha']], ['overloadedOrigin',['beta']],
  ['objectUse',['alpha']], ['nestedUse',['alpha']], ['arrayUse',['beta']],
  ['shorthandUse',['alpha']], ['wrappedUse',['alpha']], ['forwardingUse',['beta']],
  ['defaultUse',['alpha']], ['destructuredParameter',['beta']], ['use',['alpha']],
]) test(`finite origin: ${owner} retains only justified declaration candidates`, () => candidate(owner,expected));
test('known arguments union as candidates, never an exclusive runtime parameter value', () => {
  const e = candidate('invoke',['alpha','beta']);
  assert.ok(e.evidence.valueOrigins.stops.some(s => s.reason === 'open-callers'));
});
for (const [owner, stop] of [
  ['unknown','open-callers'], ['changed','written-value'], ['changedByPattern','written-value'],
  ['variadic','rest-binding'], ['defaultBindingUse','default-binding'], ['restUse','rest-binding'],
  ['spreadUse','spread-source'], ['computedUse','dynamic-key'], ['getterUse','getter-result'],
  ['factoryUse','call-result'], ['mutableSourceUse','mutable-binding'], ['typeOnlyUse','missing-property'],
  ['reassignedCallee','written-callee'], ['useWritten','written-value'], ['iterationWrite','written-value'],
  ['spreadArrayUse','spread-source'], ['spreadCallUse','spread-arguments'], ['method','unsupported-caller'],
]) test(`finite boundary: ${owner} stops at ${stop} without fabricated targets`, () => {
  const e = call(owner); assert.equal(e.status,'unresolved'); assert.deepEqual(e.targets,[]);
  assert.ok(e.evidence.valueOrigins.stops.some(s => s.reason === stop), JSON.stringify(e.evidence.valueOrigins));
});
test('recursive argument exploration terminates and retains its cycle boundary', () => {
  const e = candidate('recursive',['alpha'],'fn');
  assert.ok(e.evidence.valueOrigins.stops.some(s => s.reason === 'cycle'));
});
test('origin paths and stop points retain real ranges and file hashes', () => {
  const byFile = new Map(graph.files.map(f => [f.path,f]));
  for (const e of graph.relations) {
    const trace = e.evidence.valueOrigins; if (!trace) continue;
    assert.ok(trace.visited <= trace.limits.maxSteps);
    assert.ok(trace.sources.length <= trace.limits.maxSources);
    assert.ok(trace.stops.length <= trace.limits.maxStops);
    for (const point of [...trace.sources.flatMap(s => s.path), ...trace.stops]) {
      const f = byFile.get(point.location.file); assert.ok(f);
      assert.equal(point.fileHash, f.hash);
      assert.equal(point.excerpt, f.source.slice(point.location.start,point.location.end).slice(0,240));
    }
    for (const s of trace.sources) assert.ok(e.targets.includes(s.target));
  }
});
test('default graph queries omit inferred origins and retain them only on explicit candidate opt-in', () => {
  const n = graph.nodes.find(n => n.name === 'objectUse');
  const a = neighborhood(graph,n.id,{direction:'out'});
  assert.equal(a.relations.length,0); assert.equal(a.omittedRelations.length,1);
  const b = neighborhood(graph,n.id,{direction:'out',includeCandidates:true});
  assert.equal(b.relations.length,1); assert.ok(b.relations[0].evidence.valueOrigins);
});
test('caller attribution is not rewritten into the caller that merely passed an argument', () => {
  const e = call('invoke'); assert.equal(nodes.get(e.from).name, 'invoke');
  assert.ok(graph.relations.some(r => r.kind === 'callback' && r.targetLabel === 'alpha'));
});

test('exceeding the direct-caller budget is explicit, even when retained candidates look identical', () => {
  const e = candidate('fan',['alpha']);
  assert.equal(e.evidence.valueOrigins.truncated,true);
  assert.ok(e.evidence.valueOrigins.stops.some(s => s.reason === 'caller-budget'));
});
test('deep origin traversal stops with a budget boundary rather than inventing a distant leaf', () => {
  const e = call('deepUse'); assert.equal(e.status,'unresolved'); assert.deepEqual(e.targets,[]);
  assert.equal(e.evidence.valueOrigins.truncated,true);
  assert.ok(e.evidence.valueOrigins.stops.some(s => s.reason === 'budget'));
});
test('baseline positive fixtures compile; expected failures are semantic boundaries, not type errors', () => {
  assert.deepEqual(graph.diagnostics.filter(d=>d.category==='error'),[]);
});
