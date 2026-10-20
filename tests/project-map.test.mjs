import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createProjectMapApi } from '../dist/project-map.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const api = createProjectMapApi();

// Independently specified graph: repeated symbol names, multiple candidates,
// type-only imports, a callback, missing endpoints, a cycle and unindexed files.
// Expectations below are hand-written; none are produced by the projection.
const paths = ['entry.ts','core/a.ts','core/b.ts','ui/view.ts','ui/types.ts','tests/a.test.ts','orphan/lone.ts'];
const loc = (file, start = 0) => ({ file, start, end: start + 1, line: start + 1, column: 1, endLine: start + 1, endColumn: 2 });
const graph = {
  schemaVersion: 1, project: { name: 'labelled', snapshot: 'snapshot-A', commit: null, dirty: null, compilerVersion: 'fixture', config: null, createdAt: 'fixture' },
  files: paths.map(path => ({ path, hash: 'hash-'+path, lines: 20 })),
  nodes: paths.flatMap((file,i) => [
    { id: 'f'+i, name: file, kind: 'file', location: loc(file), parent: null, snippet: '', hasBody: true },
    { id: 'n'+i, name: 'sameName', kind: 'function', location: loc(file,1), parent: 'f'+i, snippet: '', hasBody: true },
  ]),
  relations: [], diagnostics: [],
  coverage: { unindexed: [{ path: 'scripts/scan.py', reason: 'unsupported-language' },{ path: 'scripts/boot.ps1', reason: 'unsupported-language' }],
    indexedFiles: 999, syntaxCalls: 999, inventorySourceFiles: 999, callsByStatus: { bound: 999, candidate: 0, external: 0, unresolved: 0 },
    skippedSymlinks: [], ignoredDirectories: ['node_modules'], limitations: [] },
};
function edge(id, from, targets, kind='call', status='bound', typeOnly) {
  const file = graph.nodes.find(n => n.id === from)?.location.file ?? 'core/a.ts';
  return { id, from, targets, kind, status, ...(typeOnly !== undefined ? { typeOnly } : {}), targetLabel: id,
    evidence: { rule:'hand-labelled', explanation:id, location:loc(file,2), fileHash:'hash-'+file, excerpt:id } };
}
graph.relations = [
  edge('entry-call','n0',['n1']), edge('multi','n1',['n2','n3','n4'],'call','candidate'),
  edge('types','n3',['n1'],'import','bound',true), edge('callback','n2',['n3'],'callback'),
  edge('unknown','n1',[],'call','unresolved'), edge('external','n2',[],'call','external'),
  edge('from-test','n5',['n1']), edge('to-test','n1',['n5'],'call','candidate'),
  edge('missing','n3',['does-not-exist'],'call','unresolved'), edge('self','n2',['n2'],'tag'),
  edge('jsx','n0',['n4'],'jsx','candidate'), edge('heritage','n1',['n2'],'extends','bound',false),
  edge('value-import','n2',['n3'],'import','bound',false), edge('inside-call','n1',['n2']),
];
const index = api.index(graph);
const root = () => api.project(index);
const ids = page => page.relations.map(e=>e.id).sort();

test('path groups represent direct children and retain isolated and unsupported areas', () => {
  const p = root();
  assert.deepEqual(p.groups.map(g=>g.path), ['core','entry.ts','orphan','scripts','ui']);
  assert.equal(p.groups.find(g=>g.path==='scripts').unindexedFiles,2);
  assert.deepEqual(p.groups.find(g=>g.path==='orphan').counts,{ all:0,internal:0,between:0,outside:0,targetless:0,missing:0,hiddenTargets:0 });
  assert.equal(p.summary.indexedFiles,6); assert.equal(p.summary.unindexedFiles,2);
  assert.equal(p.summary.relations,13); // not the deliberately stale coverage count
});
test('multiple candidate functions in one child group do not inflate its relation count', () => {
  const link=root().links.find(l=>l.from==='core' && l.to==='ui');
  assert.equal(link.count,3); // multi, callback, value-import
  assert.deepEqual(link.breakdown,[
    { kind:'call',status:'candidate',typeOnly:false,count:1 },
    { kind:'callback',status:'bound',typeOnly:false,count:1 },
    { kind:'import',status:'bound',typeOnly:false,count:1 },
  ]);
});
test('reverse direction and type-only membership are not coalesced with forward calls', () => {
  const link=root().links.find(l=>l.from==='ui' && l.to==='core');
  assert.equal(link.count,1);
  assert.deepEqual(link.breakdown,[{ kind:'import',status:'bound',typeOnly:true,count:1 }]);
});
test('internal relations survive folding without synthetic self-loop links', () => {
  assert.ok(root().links.every(l=>l.from!==l.to));
  assert.deepEqual(ids(api.records(index,{}, { group:'core',category:'internal' })),['heritage','inside-call','multi','self']);
});
test('targetless external and unknown relations remain evidence, not fake destination nodes', () => {
  assert.equal(root().summary.counts.targetless,2);
  assert.deepEqual(ids(api.records(index,{}, { category:'targetless' })),['external','unknown']);
  assert.ok(!root().groups.some(g=>g.path==='external' || g.path==='unknown'));
});
test('unknown endpoint is reported separately from a legitimate external boundary', () => {
  assert.equal(root().summary.counts.missing,1);
  assert.deepEqual(ids(api.records(index,{}, { category:'missing' })),['missing']);
});
test('test hiding is symmetric while preserving the unmodified original evidence', () => {
  const p=root(); assert.equal(p.boundary.hiddenFiles,1); assert.equal(p.boundary.hiddenTestRelations,1);
  assert.equal(p.summary.counts.hiddenTargets,1);
  assert.ok(p.links.every(l=>l.from!=='tests' && l.to!=='tests'));
  const row=api.records(index,{}, { category:'hiddenTargets' }).relations[0];
  assert.equal(row.id,'to-test'); assert.deepEqual(row.targets,['n5']);
});
test('test opt-in restores both directions and does not upgrade candidates', () => {
  const p=api.project(index,{showTests:true});
  assert.equal(p.summary.relations,14); assert.equal(p.boundary.hiddenFiles,0);
  assert.equal(p.links.find(l=>l.from==='core' && l.to==='tests').breakdown[0].status,'candidate');
  assert.equal(p.links.find(l=>l.from==='tests' && l.to==='core').count,1);
});
test('drilling into a directory keeps incoming and outgoing scope-boundary evidence', () => {
  const p=api.project(index,{scope:'core'});
  assert.deepEqual(p.groups.map(g=>g.path),['core/a.ts','core/b.ts']);
  assert.deepEqual(ids(api.records(index,{scope:'core'},{category:'outside'})),['callback','entry-call','multi','types','value-import']);
  assert.ok(p.links.every(l=>l.from.startsWith('core/') && l.to.startsWith('core/')));
});
test('directory containment is segment-aware, not a common-prefix guess', () => {
  const g=structuredClone(graph); g.files.push({path:'core-extra/a.ts',hash:'h',lines:1});
  assert.equal(api.project(api.index(g),{scope:'core'}).groups.length,2);
});
test('same-named functions cannot redirect path grouping or evidence endpoints', () => {
  const rows=api.records(index,{}, {from:'entry.ts',to:'core'}).relations;
  assert.equal(rows.length,1); assert.deepEqual(rows[0].targets,['n1']);
});
test('relation kind and status filtering preserves folder inventory and reports omissions', () => {
  const p=api.project(index,{kinds:['call'],statuses:['candidate']});
  assert.equal(p.groups.length,5); assert.equal(p.summary.relations,2);
  assert.equal(p.links.length,1); assert.equal(p.links[0].count,1);
  assert.ok(p.boundary.filteredRelations>0);
});
test('empty filters mean no relations, not fallback to everything', () => {
  assert.equal(api.project(index,{kinds:[]}).links.length,0);
  assert.equal(api.project(index,{statuses:[]}).summary.relations,0);
});
test('node and link budgets affect display only; omitted evidence is still queryable', () => {
  const p=api.project(index,{maxNodes:1,maxLinks:0});
  assert.equal(p.groups.length,1); assert.equal(p.links.length,0); assert.equal(p.summary.relations,13);
  assert.equal(p.boundary.omittedGroups,4); assert.equal(p.boundary.omittedLinks,root().summary.links);
  assert.equal(p.boundary.truncated,true);
  assert.equal(api.records(index,{maxNodes:1,maxLinks:0},{from:'core',to:'ui'}).total,3);
});
test('directed evidence paging is exhaustive, stable, and deduplicated', () => {
  const first=api.records(index,{}, {from:'core',to:'ui'}, {limit:1});
  const all=[]; let offset=0;
  while(offset!==null){const p=api.records(index,{}, {from:'core',to:'ui'},{limit:1,offset});all.push(...p.relations.map(e=>e.id));offset=p.nextOffset;}
  assert.equal(first.total,3); assert.deepEqual(all.sort(),['callback','multi','value-import']);
  assert.equal(api.records(index,{}, {},{offset:1000}).relations.length,0);
});
test('each aggregate count equals its independently fetched unique evidence count', () => {
  for(const options of [{},{scope:'core'},{showTests:true},{kinds:['call']},{statuses:['unresolved']}]) {
    const p=api.project(index,options);
    for(const link of p.links) assert.equal(link.count,api.records(index,options,{from:link.from,to:link.to}).total);
    for(const g of p.groups) for(const category of Object.keys(g.counts)) assert.equal(g.counts[category],api.records(index,options,{group:g.path,category}).total);
    assert.equal(p.summary.relations,api.records(index,options).total);
  }
});
test('projection is a one-hop aggregation, never fabricated transitive reachability', () => {
  assert.ok(!root().links.some(l=>l.from==='ui' && l.to==='entry.ts'));
});
test('legacy metadata and snapshot identities survive without invented analysis revisions', () => {
  const p=root();assert.equal(p.snapshot,'snapshot-A');assert.equal(p.projectionRevision,1);
  assert.ok(!Object.hasOwn(graph.project,'analysisRevision'));
});
test('neither index, projection nor evidence paging mutate graph or retained origin paths', () => {
  const g=structuredClone(graph); g.relations[1].evidence.valueOrigins={complete:false,truncated:true,sources:[],stops:[]};
  const before=JSON.stringify(g);const i=api.index(g);api.project(i);api.records(i);
  assert.equal(JSON.stringify(g),before);
  assert.equal(api.records(i,{}, {from:'core',to:'ui'}).relations.find(e=>e.id==='multi').evidence.valueOrigins.truncated,true);
});
test('invalid scopes, selectors and nonfinite budgets fail explicitly', () => {
  for(const scope of ['..','/core','core/../ui','core\\a','not-here','entry.ts']) assert.throws(()=>api.project(index,{scope}));
  for(const maxNodes of [0,Infinity,1.5,1001]) assert.throws(()=>api.project(index,{maxNodes}));
  assert.throws(()=>api.project(index,{kinds:['made-up']}));
  assert.throws(()=>api.records(index,{}, {from:'core'}));
  assert.throws(()=>api.records(index,{}, {group:'core',from:'core',to:'ui'}));
  assert.throws(()=>api.records(index,{}, {category:'made-up'}));
  assert.throws(()=>api.records(index,{}, {},{limit:0}));
});
test('empty and unsupported-only snapshots retain meaningful scope without invented symbols', () => {
  const g=structuredClone(graph);g.nodes=[];g.files=[];g.relations=[];
  const p=api.project(api.index(g));assert.equal(p.groups[0].path,'scripts');assert.equal(p.summary.relations,0);
  g.coverage.unindexed=[];assert.equal(api.project(api.index(g)).summary.groups,0);
});
test('duplicate identities fail rather than silently lose evidence; stale unindexed overlap does not double count', () => {
  const g=structuredClone(graph);g.relations.push(g.relations[0]);assert.throws(()=>api.index(g));
  const h=structuredClone(graph);h.coverage.unindexed.push({path:'core/a.ts',reason:'stale'});
  assert.equal(api.project(api.index(h)).summary.unindexedFiles,2);
});
test('path and reason strings cannot modify object prototypes', () => {
  const g=structuredClone(graph);g.coverage.unindexed.push({path:'__proto__/a.py',reason:'__proto__'});
  const p=api.project(api.index(g));assert.equal(p.groups.find(g=>g.path==='__proto__').unindexedReasons.__proto__,1);
  assert.equal({}.polluted,undefined);
});
test('compiled factory is self-contained and yields identical results in a browser-like realm', () => {
  const remote=vm.runInNewContext('('+createProjectMapApi.toString()+')()');
  assert.equal(JSON.stringify(remote.project(remote.index(graph))),JSON.stringify(root()));
});
test('thousand-node cyclic input stays bounded and original edge membership is not lost', () => {
  const g=structuredClone(graph);g.files=[];g.nodes=[];g.relations=[];g.coverage.unindexed=[];
  for(let i=0;i<1000;i++){const file=`m${String(i).padStart(4,'0')}/a.ts`;g.files.push({path:file,hash:'h',lines:1});g.nodes.push({id:'x'+i,kind:'file',name:file,location:loc(file),parent:null});
    g.relations.push({...edge('large'+i,'n0',[]),from:'x'+i,targets:['x'+((i+1)%1000)],evidence:{...edge('tmp','n0',[]).evidence,location:loc(file)}});}
  const p=api.project(api.index(g));assert.equal(p.groups.length,12);assert.ok(p.links.length<=24);assert.equal(p.summary.relations,1000);assert.equal(p.summary.links,1000);
});

function cli(args) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rg-map-cli-'));
  try { const file=path.join(dir,'graph.json');fs.writeFileSync(file,JSON.stringify(graph));
    return spawnSync(process.execPath,['dist/cli.js','query',file,...args],{encoding:'utf8'});
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
}
test('CLI map and library share the same scope and budgets',()=>{
  const r=cli(['map','core','--max-nodes','1','--max-links','0']);assert.equal(r.status,0,r.stderr);
  assert.deepEqual(JSON.parse(r.stdout),api.project(index,{scope:'core',maxNodes:1,maxLinks:0}));
});
test('CLI map-records retains full evidence for a directed aggregate',()=>{
  const r=cli(['map-records','.','--from','core','--to','ui','--limit','2']);assert.equal(r.status,0,r.stderr);
  assert.deepEqual(JSON.parse(r.stdout),api.records(index,{}, {from:'core',to:'ui'},{limit:2}));
});
test('CLI invalid projection scope and budgets fail without empty success output',()=>{
  for(const args of [['map','/core'],['map','--max-nodes','NaN'],['map-records','--from','core']]) {
    const r=cli(args);assert.notEqual(r.status,0);assert.ok(r.stderr.includes('RepoGraphia:'));
  }
});
