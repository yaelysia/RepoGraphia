import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFeatureSceneApi} from '../dist/feature-scene.js';
import {graph as fixture} from './helpers/report-line-endings.mjs';
const graph=structuredClone(fixture),loc=graph.nodes[1].location;
graph.nodes.push({id:'class:A',name:'A',kind:'class',parent:'file:src/start.ts',location:loc},
 {id:'method:run',name:'run',kind:'method',parent:'class:A',location:loc},
 {id:'callback:1',name:'<callback:1:1>',kind:'function',parent:'method:run',location:loc});
const item=(id,node='node:start',role='implementation',feature='f',current=true,decision='proposed')=>({
 current,issues:current?[]:['changed-snapshot'],warnings:[],mapping:{id,featureId:feature,role,decision,
 code:{nodeId:node,name:graph.nodes.find(n=>n.id===node)?.name??'old-name',file:'src/start.ts',kind:'function',start:0,end:1,fileHash:'a'.repeat(64)},evidence:[],rationale:'explicit mapping'}});
const api=createFeatureSceneApi().create(graph),base=[item('start','node:start','entry'),item('finish','node:finish')];
test('role groups preserve explicit entries, empty groups and defaults',()=>{
 const result=api.project(base,'f');assert.deepEqual(result.groups.map(g=>[g.role,g.total]),[['entry',1],['implementation',1],['support',0],['test',0]]);
 assert.equal(result.shown,2);assert.equal(result.calls.edges.length,1);
});
test('support/test fold counts without deleting annotations',()=>{
 const input=[...base,item('support','method:run','support'),item('test','callback:1','test')];
 const r=api.project(input,'f');assert.equal(r.hidden,2);assert.equal(r.total,4);assert.equal(r.groups[2].items.length,0);
 assert.equal(api.project(input,'f',{support:5,test:5}).shown,4);
});
test('budgets are explicit and deterministic',()=>{
 const input=Array.from({length:60},(_,i)=>item('m'+i));const r=api.project(input,'f',{implementation:50});
 assert.equal(r.shown,50);assert.equal(r.hidden,10);assert.deepEqual(r,api.project(input,'f',{implementation:50}));
});
for(const n of [-1,1.5,NaN,Infinity,51])test(`invalid presentation budget ${n} rejected`,()=>assert.throws(()=>api.project(base,'f',{entry:n}),/budget/));
test('shared code counts are explicit memberships, not feature dependencies',()=>{
 const r=api.project([...base,item('shared','node:start','support','g'),item('duplicate','node:start','entry','g')],'f');
 assert.deepEqual(r.groups[0].items[0].sharedWith,['g']);assert.ok(!('featureEdges' in r));
});
test('rejected and stale memberships do not count as shared code',()=>{
 const r=api.project([...base,item('rejected','node:start','entry','g',true,'rejected'),item('stale','node:start','entry','h',false)],'f');
 assert.deepEqual(r.groups[0].items[0].sharedWith,[]);
});
test('friendly labels use lexical class and function context',()=>{
 assert.equal(api.label(item('m','method:run')).title,'A.run');
 const r=api.label(item('c','callback:1'));assert.equal(r.title,'A.run · 回调');assert.equal(r.original,'<callback:1:1>');
});
test('stale anchors never borrow current same-ID parents or locations',()=>{
 const r=api.label(item('old','method:run','entry','f',false));assert.equal(r.title,'run');assert.equal(r.line,null);
});
test('parent cycles terminate',()=>{
 const g=structuredClone(graph);g.nodes.find(n=>n.id==='class:A').parent='method:run';
 assert.equal(createFeatureSceneApi().create(g).label(item('m','method:run')).title,'A.run');
});
test('only original call/construct/tag relations become directed code edges',()=>{
 const g=structuredClone(graph);for(const kind of ['callback','jsx','import','extends','implements','reexport'])g.relations.push({...g.relations[0],id:kind,kind});
 const r=createFeatureSceneApi().create(g).project(base,'f');assert.deepEqual(r.calls.edges[0].relationIds,['edge:start-finish']);assert.equal(r.calls.edges.length,1);
});
test('candidate targets remain candidate; duplicates do not inflate source evidence',()=>{
 const g=structuredClone(graph);g.relations[0].status='candidate';g.relations[0].targets.push('node:finish');
 const r=createFeatureSceneApi().create(g).project([...base,item('finish-2','node:finish')],'f');
 assert.equal(r.calls.edges.length,1);assert.equal(r.calls.edges[0].status,'candidate');assert.equal(r.calls.internalRelations,1);
});
test('stale and rejected entities cannot create live call edges',()=>{
 for(const mode of ['stale','rejected']){
  const rows=[base[0],item('finish','node:finish','implementation','f',mode!=='stale',mode==='rejected'?'rejected':'accepted')];
  const r=api.project(rows,'f');assert.equal(r.calls.edges.length,0);assert.equal(r.calls.boundaryRelations,1);
 }
});
test('folded endpoints are counted but not drawn',()=>{
 const r=api.project(base,'f',{implementation:0});assert.equal(r.calls.edges.length,0);assert.equal(r.calls.hiddenRelations,1);
});
test('external and targetless calls retain boundary counts without invented nodes',()=>{
 const g=structuredClone(graph);g.relations.push({...g.relations[0],id:'unknown',targets:[],status:'unresolved'});
 const r=createFeatureSceneApi().create(g).project(base,'f');assert.equal(r.calls.boundaryRelations,1);assert.equal(r.calls.edges.length,1);
});
test('multi-target relations may have both internal and outside boundaries',()=>{
 const g=structuredClone(graph);g.relations[0].targets.push('node:missing');
 const r=createFeatureSceneApi().create(g).project(base,'f');assert.equal(r.calls.internalRelations,1);assert.equal(r.calls.boundaryRelations,1);
});
test('self calls remain disclosed without a false cross-node arrow',()=>{
 const g=structuredClone(graph);g.relations[0].targets=['node:start'];
 const r=createFeatureSceneApi().create(g).project(base,'f');assert.equal(r.calls.selfRelations,1);assert.equal(r.calls.edges.length,0);
});
test('pair aggregation retains every original relation ID',()=>{
 const g=structuredClone(graph);g.relations.push({...g.relations[0],id:'another-site'});
 const r=createFeatureSceneApi().create(g).project(base,'f');assert.equal(r.calls.edges.length,1);assert.deepEqual(r.calls.edges[0].relationIds,['edge:start-finish','another-site']);
});
test('edge budget discloses omitted pairs',()=>{
 const g=structuredClone(graph),rows=[base[0]];g.relations=[];
 for(let i=0;i<40;i++){const id='n'+i;g.nodes.push({...graph.nodes[1],id});rows.push(item('m'+i,id));g.relations.push({...graph.relations[0],id:'e'+i,targets:[id]});}
 const r=createFeatureSceneApi().create(g).project(rows,'f',{implementation:50});assert.equal(r.calls.edges.length,32);assert.equal(r.calls.omittedPairs,8);
});
test('unknown feature is explicitly empty',()=>assert.equal(api.project(base,'absent').total,0));
test('projection never mutates the static graph or assessments',()=>{
 const before=JSON.stringify([graph,base]);api.project(base,'f');api.label(base[0]);assert.equal(JSON.stringify([graph,base]),before);
});
