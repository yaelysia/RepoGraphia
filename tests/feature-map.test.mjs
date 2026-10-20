import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { analyze } from '../dist/analyze.js';
import { createFeatureMapApi } from '../dist/feature-map.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repographia-features-'));
after(() => fs.rmSync(root, {recursive:true,force:true}));
fs.writeFileSync(path.join(root,'lib.ts'), 'export function shared() { return 1; }\nexport function other() { return 2; }\n');
fs.writeFileSync(path.join(root,'app.ts'), `import {shared,other} from './lib';
export function run(handler:()=>number) { return handler(); }
run(shared); run(other);
export function unrelated() { return other(); }
`);
const graph = analyze(root, {includeSource:true}), api = createFeatureMapApi();
const clone = x => JSON.parse(JSON.stringify(x));
const node = n => graph.nodes.find(x => x.name === n && x.kind === 'function');
const handler = graph.relations.find(x => x.kind === 'call' && x.targetLabel === 'handler');
const ctx = (m,actorKind='agent') => ({expectedRevision:m.revision,actor:'fixture author',actorKind,at:'2026-10-20T00:00:00.000Z',reason:'Explicit fixture annotation'});
const change = (m,p,actorKind) => api.edit(graph,m,p,ctx(m,actorKind));
const f = {id:'one',title:'First feature',description:'A partial semantic proposal',questions:['Other entry points are not mapped.']};
let seed = change(api.create(graph), {op:'feature',feature:f});
seed = change(seed, {op:'feature',feature:{...f,id:'two',title:'Second feature'}});
const add = (m,id='m1',featureId='one',n=node('run'),evidence=[handler.id]) => change(m,
 {op:'mapping',id,featureId,nodeId:n.id,role:'implementation',rationale:'Explicit annotation of this source declaration',relationIds:evidence});
seed = add(seed); seed = add(seed,'m2','two');
const review = (m,decision) => change(m,{op:'review',id:'m1',decision},'manual');

test('feature source fixture has no compiler errors and starts with zero inferred semantics',()=>{
 assert.equal(graph.diagnostics.length,0); assert.equal(api.create(graph).features.length,0);
 assert.equal(handler.status,'candidate');
});
test('two features may share code without becoming the same feature or creating a dependency',()=>{
 assert.equal(api.forNode(graph,seed,node('run').id).length,2);
 assert.equal(api.assess(graph,seed).summary.mappedNodes,1);
 assert.ok(!('relations' in api.assess(graph,seed)));
});
test('one feature may map to multiple exact declarations',()=>{
 const m=add(seed,'m3','one',node('shared'),[]); assert.equal(api.assess(graph,m).features[0].mappingIds.length,2);
});
test('candidate evidence and incomplete origin warnings survive a manual acceptance',()=>{
 const a=api.assess(graph,review(seed,'accepted')).mappings[0];
 assert.equal(a.mapping.decision,'accepted');assert.ok(a.warnings.includes('evidence-candidate'));
 assert.ok(a.warnings.includes('incomplete-value-origins')); assert.equal(handler.status,'candidate');
});
test('agent cannot mark its own proposed mapping accepted',()=>{
 assert.throws(()=>change(seed,{op:'review',id:'m1',decision:'accepted'}),/cannot self-accept/);
});
test('rejected mappings remain in the document but leave current reverse lookup',()=>{
 const m=review(seed,'rejected');assert.equal(m.mappings.length,2);assert.equal(api.forNode(graph,m,node('run').id).length,1);
});
test('declaration-only evidence is explicit, not a verified functional claim',()=>{
 const m=add(seed,'m3','one',node('shared'),[]);
 assert.ok(api.assess(graph,m).mappings[2].warnings.includes('declaration-only'));
});
for(const [name,mutate,expected] of [
 ['snapshot',g=>g.project.snapshot='f'.repeat(64),'changed-snapshot'],
 ['analysis revision',g=>g.project.analysisRevision++,'changed-analysisRevision'],
 ['compiler',g=>g.project.compilerVersion='9.0.0','changed-compilerVersion'],
 ['config',g=>g.project.config='other.json','changed-config'],
 ['missing revision',g=>delete g.project.analysisRevision,'unversioned-analysis'],
 ['changed source hash',g=>g.files.find(f=>f.path==='app.ts').hash='f'.repeat(64),'changed-source'],
 ['missing file',g=>g.files=g.files.filter(f=>f.path!=='app.ts'),'missing-file'],
 ['missing symbol',g=>g.nodes=g.nodes.filter(n=>n.id!==node('run').id),'missing-node'],
 ['same id wrong source range',g=>g.nodes.find(n=>n.id===node('run').id).location.start++,'changed-node-anchor'],
 ['missing evidence',g=>g.relations=g.relations.filter(e=>e.id!==handler.id),'missing-relation'],
 ['candidate upgraded in substituted graph',g=>g.relations.find(e=>e.id===handler.id).status='bound','changed-relation-anchor'],
 ['relation target substitution',g=>g.relations.find(e=>e.id===handler.id).targets=[node('unrelated').id],'changed-relation-anchor'],
]) test(name+' is stale and cannot silently reuse an old acceptance',()=>{
 const g=clone(graph);mutate(g); const m=review(seed,'accepted'), a=api.assess(g,m).mappings[0];
 assert.equal(a.current,false);assert.ok(a.issues.includes(expected),JSON.stringify(a));
 assert.equal(a.mapping.decision,'accepted');assert.equal(api.forNode(g,m,node('run').id).length,0);
 assert.throws(()=>api.edit(g,m,{op:'review',id:'m1',decision:'accepted'},ctx(m,'manual')),/stale/);
});
test('same-name replacement is not reanchored, and unrelated source evidence is rejected',()=>{
 const g=clone(graph);g.nodes.find(n=>n.id===node('run').id).id='replacement';
 assert.equal(api.assess(g,seed).mappings[0].current,false);
 const e=graph.relations.find(e=>e.from===node('unrelated').id);
 assert.throws(()=>add(seed,'bad','one',node('run'),[e.id]),/unrelated-relation/);
});
test('changed feature meaning resets previous acceptance but does not erase rejected decisions',()=>{
 let m=review(seed,'accepted');m=change(m,{op:'feature',feature:{...f,description:'A different semantic claim'}});
 assert.equal(m.mappings[0].decision,'proposed');assert.equal(m.history.at(-1).before.description,f.description);
 m=review(m,'rejected');m=change(m,{op:'feature',feature:f});assert.equal(m.mappings[0].decision,'rejected');
});
test('explicit code correction resets acceptance and retains the previous anchor',()=>{
 const m=add(review(seed,'accepted'),'m1','one',node('shared'),[]);
 assert.equal(m.mappings.find(m=>m.id==='m1').decision,'proposed');
 assert.equal(m.history.at(-1).before.code.nodeId,node('run').id);
});
test('stale graph cannot receive new anchors by updating the document basis implicitly',()=>{
 const g=clone(graph);g.project.snapshot='f'.repeat(64);
 assert.throws(()=>api.edit(g,seed,{op:'mapping',id:'new',featureId:'one',nodeId:node('shared').id,role:'support',rationale:'x',relationIds:[]},ctx(seed)),/stale basis/);
});
test('edit revision conflict leaves original document and code graph untouched',()=>{
 const original=JSON.stringify(seed), g=JSON.stringify(graph);
 assert.throws(()=>api.edit(graph,seed,{op:'review',id:'m1',decision:'rejected'},{...ctx(seed),expectedRevision:0}),/revision conflict/);
 review(seed,'accepted');assert.equal(JSON.stringify(seed),original);assert.equal(JSON.stringify(graph),g);
});
test('malformed, duplicate and dangling annotations fail closed',()=>{
 for(const mutate of [m=>m.schemaVersion=2,m=>m.features.push(m.features[0]),m=>m.mappings[0].featureId='absent',
   m=>m.mappings[0].code.file='../bad',m=>m.mappings[0].code.fileHash='bad',m=>m.revision++,
   m=>m.mappings[0].decision='verified',m=>m.mappings[0].evidence.push(m.mappings[0].evidence[0]),
   m=>m.features[0].titel='typo']) {const m=clone(seed);mutate(m);assert.throws(()=>api.validate(m));}
});
test('unmapped feature and explicit questions remain visible',()=>{
 const m=change(seed,{op:'feature',feature:{...f,id:'unknown'}});
 assert.equal(api.assess(graph,m).features.at(-1).mappingIds.length,0);
 assert.equal(api.assess(graph,m).features.at(-1).questions.length,1);
});
test('changing only report timestamp does not invalidate anchors or mutate stored basis',()=>{
 const g=clone(graph);g.project.createdAt='new timestamp';assert.equal(api.assess(g,seed).summary.stale,0);
});
test('the browser executes the same pure validation factory',()=>{
 const browser=vm.runInNewContext(`(${createFeatureMapApi.toString()})()`);
 assert.deepEqual(JSON.parse(JSON.stringify(browser.assess(graph,seed))),api.assess(graph,seed));
});
test('file-level membership does not silently map every child function',()=>{
 const n=graph.nodes.find(n=>n.kind==='file'&&n.location.file==='lib.ts');
 const m=add(seed,'file-map','one',n,[]);const a=api.assess(graph,m).mappings.at(-1);
 assert.ok(a.warnings.includes('file-level-scope'));assert.equal(api.forNode(graph,m,node('shared').id).length,0);
});
test('module imports remain non-call evidence after semantic acceptance',()=>{
 const n=graph.nodes.find(n=>n.kind==='file'&&n.location.file==='app.ts');
 const e=graph.relations.find(e=>e.kind==='import');const m=add(seed,'import-map','one',n,[e.id]);
 const accepted=api.edit(graph,m,{op:'review',id:'import-map',decision:'accepted'},ctx(m,'manual'));
 assert.ok(api.assess(graph,accepted).mappings.at(-1).warnings.includes('non-call-evidence'));
 assert.equal(api.assess(graph,accepted).mappings.at(-1).mapping.evidence[0].kind,'import');
});
