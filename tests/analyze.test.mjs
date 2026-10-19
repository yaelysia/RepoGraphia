import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { analyze } from '../dist/analyze.js';
import { findNode, neighborhood } from '../dist/query.js';
import { safeJson, renderHtml } from '../dist/report.js';

const roots=[];
function project(files) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'repographia-test-')); roots.push(root);
  for(const [file,text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true}); fs.writeFileSync(path.join(root,file),text); }
  return root;
}
after(()=>roots.forEach(root=>fs.rmSync(root,{recursive:true,force:true})));
const root=project({
  'tsconfig.json': JSON.stringify({compilerOptions:{strict:true,target:'ES2022',module:'ESNext',moduleResolution:'Bundler',jsx:'preserve',allowJs:true},include:['src/**/*']}),
  'src/base.ts': `export function leaf() { return 1; }
export function overloaded(value: string): string;
export function overloaded(value: number): number;
export function overloaded(value: string | number) { return value; }
export const arrow = () => leaf();
export interface Handler { execute(): void; }
export class A implements Handler { execute() { leaf(); } }
export class B implements Handler { execute() {} }
export class Child extends A {}
export class Constructed { constructor() { leaf(); } }
export default function defaultFn() { return leaf(); }
export function repeat() { repeat(); }
`,
  'src/barrel.ts': `export { leaf as renamed } from './base'; export type { Handler } from './base';`,
  'src/main.ts': `import { renamed as aliased } from './barrel';
import defaultFn, { arrow, overloaded, A, Constructed, repeat } from './base';
import type { Handler } from './base';
export function entry() { aliased(); arrow(); overloaded(1); defaultFn(); repeat(); }
export function viaInterface(h: Handler) { h.execute(); }
export function dynamic(fn: () => void) { fn(); }
export function shadowed() { const aliased = () => 2; aliased(); }
export function registration() { [1].forEach(arrow); [1].map(() => aliased()); }
export function construct() { new Constructed(); new A(); }
export function unknown(x: any) { x.mystery(); }
export function tag(v: TemplateStringsArray) { return v; }
export function tagged() { tag\`hello\`; }
const constantAlias = aliased; constantAlias();
let mutable = arrow; mutable = defaultFn; const indirectAlias = mutable; indirectAlias();
export function later() { return import('./base'); }
`,
  'src/view.tsx': `import { arrow as Widget } from './base'; export const View = () => <section><Widget /></section>;`,
  'src/helper.js': 'export function jsHelper() { return Math.max(1, 2); }',
  'outside.ts': 'export function notInConfig() {}',
  'worker.py': 'print("not executed")',
  'node_modules/ignored.ts': 'throw new Error("never indexed")',
  'src/security.ts': `export const text = '</script><script>globalThis.pwned=1</script>'; export function sentinel(){ throw new Error('do not run'); }`,
});
const graph=analyze(root,{includeSource:true});
const n=(name,file)=>graph.nodes.find(n=>n.name===name && (!file||n.location.file===file));
const owned=(name)=>graph.relations.filter(e=>e.from===n(name).id);
const calls=(name)=>owned(name).filter(e=>['call','construct','tag'].includes(e.kind));

test('indexes selected TS/TSX/JS program and inventories unsupported/out-of-scope sources',()=>{
  assert.equal(graph.files.length,6);
  assert.ok(graph.coverage.unindexed.some(x=>x.path==='worker.py'&&x.reason==='unsupported-language'));
  assert.ok(graph.coverage.unindexed.some(x=>x.path==='outside.ts'&&x.reason==='outside-selected-program'));
  assert.ok(!graph.files.some(f=>f.path.includes('node_modules')));
});
test('barrel reexports and import aliases resolve to the real lexical declaration',()=>{
  const edge=calls('entry').find(e=>e.targetLabel==='aliased');
  assert.equal(edge.status,'bound'); assert.deepEqual(edge.targets,[n('leaf').id]);
});
test('default import binds the declaration rather than guessing from the local name',()=>{
  assert.deepEqual(calls('entry').find(e=>e.targetLabel==='defaultFn').targets,[n('defaultFn').id]);
});
test('overload calls target the implementation body, not arbitrary signature',()=>{
  const edge=calls('entry').find(e=>e.targetLabel==='overloaded');
  const target=graph.nodes.find(n=>n.id===edge.targets[0]); assert.equal(target.hasBody,true); assert.equal(target.kind,'function');
});
test('lexical shadowing never uses a same-named import target',()=>{
  const edge=calls('shadowed')[0]; assert.equal(graph.nodes.find(n=>n.id===edge.targets[0]).location.file,'src/main.ts');
  assert.notEqual(edge.targets[0],n('leaf').id);
});
test('interface dispatch keeps the contract as candidate and never invents A/B targets',()=>{
  const edge=calls('viaInterface')[0]; assert.equal(edge.status,'candidate'); assert.equal(edge.evidence.rule,'type-contract');
  assert.ok(edge.targets.every(id=>graph.nodes.find(n=>n.id===id).kind==='signature'));
});
test('callable parameters remain unresolved',()=>{
  assert.equal(calls('dynamic')[0].status,'unresolved'); assert.equal(calls('dynamic')[0].targets.length,0);
});
test('untyped receiver never gains targets by matching method names',()=>{
  assert.equal(calls('unknown')[0].status,'unresolved'); assert.deepEqual(calls('unknown')[0].targets,[]);
});
test('callback passing is a separate non-call relation',()=>{
  const edges=owned('registration').filter(e=>e.kind==='callback');
  assert.ok(edges.some(e=>e.targets.includes(n('arrow').id)));
  assert.ok(!calls('registration').some(e=>e.targets.includes(n('arrow').id)));
});
test('nested callback calls belong to the callback, not its outer registration function',()=>{
  const nested=graph.relations.find(e=>e.kind==='call'&&e.targetLabel==='aliased'&&n('registration').location.start<e.evidence.location.start);
  assert.match(graph.nodes.find(n=>n.id===nested.from).name,/callback/);
});
test('construct and tagged template are explicit call kinds',()=>{
  assert.equal(calls('construct').filter(e=>e.kind==='construct').length,2);
  assert.equal(calls('tagged')[0].kind,'tag');
});
test('constant aliases of a mutable callable are not promoted to certain binding',()=>{
  const edge=graph.relations.find(e=>e.kind==='call'&&e.targetLabel==='indirectAlias');
  assert.notEqual(edge.status,'bound');
});
test('type-only import and reexport do not become function calls',()=>{
  assert.ok(graph.relations.some(e=>e.kind==='import'&&e.typeOnly));
  assert.ok(graph.relations.some(e=>e.kind==='reexport'&&e.typeOnly));
});
test('declared heritage stays distinct from dispatch/calls',()=>{
  assert.equal(graph.relations.filter(e=>e.kind==='implements').length,2);
  assert.ok(graph.relations.some(e=>e.kind==='extends'&&e.targets.includes(n('A').id)));
});
test('JSX is a component reference and intrinsic HTML tags are not functions',()=>{
  const jsx=graph.relations.filter(e=>e.kind==='jsx'); assert.equal(jsx.length,1); assert.equal(jsx[0].status,'candidate');
  assert.equal(jsx[0].targetLabel,'Widget');
});
test('dynamic literal import retains both callsite and module resolution evidence',()=>{
  assert.ok(owned('later').some(e=>e.kind==='import'&&e.targets.includes('file:src/base.ts')));
  assert.equal(calls('later').length,1);
});
test('external declarations are explicit boundaries, not project callees',()=>{
  const external=calls('jsHelper')[0]; assert.equal(external.status,'external'); assert.deepEqual(external.targets,[]);
});
test('every relation has an owner, valid targets, exact location and source hash',()=>{
  const ids=new Set(graph.nodes.map(n=>n.id));
  for (const e of graph.relations) {
    assert.ok(ids.has(e.from)); assert.ok(e.targets.every(t=>ids.has(t)));
    const f=graph.files.find(f=>f.path===e.evidence.location.file);
    assert.equal(e.evidence.fileHash,createHash('sha256').update(f.source).digest('hex'));
    assert.equal(e.evidence.excerpt,f.source.slice(e.evidence.location.start,e.evidence.location.end).slice(0,1200));
  }
});
test('all explicit callsites partition into exactly one resolution status',()=>{
  assert.equal(graph.coverage.syntaxCalls,graph.relations.filter(e=>['call','construct','tag'].includes(e.kind)).length);
  assert.equal(graph.coverage.syntaxCalls,Object.values(graph.coverage.callsByStatus).reduce((a,b)=>a+b));
});
test('unresolved global declarations generate visible compiler diagnostics',()=>{
  assert.ok(graph.diagnostics.some(d=>d.category==='error'&&d.file==='src/view.tsx'));
});
test('callers/callees default traversal excludes callbacks, candidates and JSX',()=>{
  const result=neighborhood(graph,n('arrow').id,{direction:'in'});
  assert.ok(result.nodes.some(x=>x.name==='entry'));
  assert.ok(!result.relations.some(e=>['callback','jsx'].includes(e.kind)));
});
test('candidate inclusion is explicit and query boundaries disclose omitted edges',()=>{
  const result=neighborhood(graph,n('viaInterface').id,{direction:'out'});
  assert.equal(result.relations.length,0); assert.equal(result.omittedRelations.length,1);
  assert.equal(neighborhood(graph,n('viaInterface').id,{direction:'out',includeCandidates:true}).relations.length,1);
});
test('recursive traversal terminates and node budgets are explicit',()=>{
  assert.ok(neighborhood(graph,n('repeat').id,{depth:8,direction:'out'}).nodes.length===1);
  const limited=neighborhood(graph,n('entry').id,{direction:'out',limit:2,depth:8});
  assert.equal(limited.nodes.length,2); assert.equal(limited.boundary.truncated,true);
});
test('ambiguous names and invalid traversal arguments fail rather than guessing',()=>{
  assert.throws(()=>findNode(graph,'overloaded'),/Ambiguous/);
  assert.throws(()=>findNode(graph,'not-there'),/not found/);
  assert.throws(()=>neighborhood(graph,n('entry').id,{depth:-1}));
});
test('HTML data embedding cannot turn repository text into executable script',()=>{
  const hostile='</script><img src=x onerror=alert(1)>\u2028';
  assert.equal(JSON.parse(safeJson(hostile)),hostile); assert.ok(!safeJson(hostile).includes('<'));
  const html=renderHtml(graph); assert.ok(!html.includes("</script><script>globalThis.pwned"));
  assert.ok(html.includes("connect-src 'none'")); assert.ok(html.includes("script-src 'sha256-"));
});
test('source embedding is opt-in and snapshot hashes change on source edits',()=>{
  const small=project({'main.ts':'export function one() { return 1; }'});
  const a=analyze(small), b=analyze(small);
  assert.equal(a.project.snapshot,b.project.snapshot); assert.ok(a.files.every(f=>f.source===undefined));
  assert.deepEqual(a.nodes,b.nodes); assert.deepEqual(a.relations,b.relations);
  fs.writeFileSync(path.join(small,'main.ts'),'export function one() { return 2; }');
  assert.notEqual(a.project.snapshot,analyze(small).project.snapshot);
});
test('invalid tsconfig is rejected instead of silently falling back',()=>{
  const invalid=project({'tsconfig.json':'{ definitely invalid','main.ts':'f();'});
  assert.throws(()=>analyze(invalid));
});
test('missing modules stay unresolved and maintain their callsite',()=>{
  const missing=analyze(project({'main.ts':"import { fn } from 'not-installed-package'; fn();"}));
  assert.ok(missing.relations.some(e=>e.kind==='import'&&e.status==='unresolved'));
  assert.equal(missing.coverage.syntaxCalls,1); assert.equal(missing.coverage.callsByStatus.unresolved,1);
});
test('symlinked source is not traversed and boundary is disclosed', {skip: process.platform==='win32' ? 'requires symlink privilege' : false},()=>{
  const linked=project({'main.ts':'export const value=1'}), outside=project({'secret.ts':'export function secret(){}'});
  fs.symlinkSync(path.join(outside,'secret.ts'),path.join(linked,'linked.ts'));
  const result=analyze(linked);
  assert.ok(result.coverage.skippedSymlinks.includes('linked.ts'));
  assert.ok(!result.files.some(f=>f.path==='linked.ts'));
});
test('project references are disclosed rather than claimed as full monorepo coverage',()=>{
  const ref=project({'tsconfig.json':JSON.stringify({files:[],references:[{path:'./sub'}]}),'sub/tsconfig.json':'{}','sub/a.ts':'export function a(){}'});
  const result=analyze(ref); assert.equal(result.files.length,0);
  assert.ok(result.diagnostics.some(d=>d.code==='project-references'));
  assert.ok(result.coverage.unindexed.some(f=>f.path==='sub/a.ts'));
});

test('explicit class construction connects to the constructor body',()=>{
  const edge=calls('construct').find(e=>e.targetLabel==='Constructed');
  assert.equal(graph.nodes.find(n=>n.id===edge.targets[0]).kind,'constructor');
  assert.ok(neighborhood(graph,n('construct').id,{direction:'out',depth:2}).nodes.some(n=>n.name==='leaf'));
});
