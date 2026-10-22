import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { analyze } from '../dist/analyze.js';
import { compareWorkspaceGraphs } from '../dist/workspace-diff.js';

const roots=[];
const hash=text=>createHash('sha256').update(text).digest('hex');
function project(files) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'repographia-workspace-diff-'));roots.push(root);
  for(const [file,text] of Object.entries(files)) {fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),text);}
  return root;
}
after(()=>roots.forEach(root=>fs.rmSync(root,{recursive:true,force:true})));
const source={
  'leaf.ts':'export function leaf() { return 1; }\n',
  'entry.ts':"import {leaf} from './leaf';\nexport function entry() { return leaf(); }\n",
  'callback.ts':'export function register() { return [1].map(() => 2); }\n',
};
const root=project(source),base=analyze(root,{includeSource:true});
fs.writeFileSync(path.join(root,'leaf.ts'),'// unrelated heading\n'+source['leaf.ts']);
fs.writeFileSync(path.join(root,'callback.ts'),'// unrelated heading\n'+source['callback.ts']);
const shifted=analyze(root,{includeSource:true});
fs.writeFileSync(path.join(root,'leaf.ts'),source['leaf.ts'].replace('return 1','return 2'));
const modified=analyze(root,{includeSource:true});

function rekey(graph) {
  const changed=structuredClone(graph),ids=new Map(changed.nodes.map((n,i)=>[n.id,'different-node-'+i]));
  for(const node of changed.nodes){node.id=ids.get(node.id);if(node.parent)node.parent=ids.get(node.parent);}
  for(const [i,edge] of changed.relations.entries()){
    edge.id='different-edge-'+i;edge.from=ids.get(edge.from);edge.targets=edge.targets.map(id=>ids.get(id));
    for(const item of edge.evidence.valueOrigins?.sources??[])item.target=ids.get(item.target);
  }
  changed.nodes.reverse();changed.relations.reverse();changed.project.createdAt='2030-01-01T00:00:00Z';
  return changed;
}

test('snapshot-local IDs, record order and capture time do not create code differences',()=>{
  const next=rekey(base),untouched=JSON.stringify(base);
  next.project.snapshot=hash('different-input-but-same-records');
  const result=compareWorkspaceGraphs(base,next);
  assert.deepEqual(result.files,[]);assert.equal(result.summary.unchanged,3);assert.equal(result.inputSnapshotChanged,true);
  assert.equal(JSON.stringify(base),untouched);
  assert.equal(result.before.snapshot,base.project.snapshot);assert.equal(result.after.snapshot,next.project.snapshot);
});

test('unrelated leading text does not turn matching declarations and call bindings into removals',()=>{
  const result=compareWorkspaceGraphs(base,shifted);
  assert.equal(result.summary.modified,2);assert.equal(result.summary.analysisChanged,0);
  assert.equal(result.files.some(file=>file.path==='entry.ts'),false);
  for(const file of result.files){assert.equal(file.declarations.added,0,file.path);assert.equal(file.declarations.removed,0,file.path);}
  const callback=result.files.find(file=>file.path==='callback.ts');
  assert.equal(callback.relations.added,0);assert.equal(callback.relations.removed,0);
  assert.ok(callback.diff.lines.some(line=>line.kind==='added'&&line.text==='// unrelated heading'));
});

test('same-name changed declarations remain before/after records and expose related unchanged caller evidence',()=>{
  const result=compareWorkspaceGraphs(base,modified);
  const file=result.files.find(item=>item.path==='leaf.ts');
  assert.equal(file.kind,'modified');assert.equal(file.declarations.added,1);assert.equal(file.declarations.removed,1);
  assert.equal(file.declarations.before[0].snapshot,base.project.snapshot);
  assert.equal(file.declarations.after[0].snapshot,modified.project.snapshot);
  assert.ok(file.diff.lines.some(line=>line.kind==='removed'&&line.text.includes('return 1')));
  assert.ok(file.diff.lines.some(line=>line.kind==='added'&&line.text.includes('return 2')));
  const caller=result.files.find(item=>item.path==='entry.ts');
  assert.equal(caller.kind,'analysis');assert.equal(caller.before.hash,caller.after.hash);
  assert.equal(caller.relations.removed,1);assert.equal(caller.relations.added,1);
  assert.equal(caller.relations.before[0].kind,'call');assert.equal(caller.relations.after[0].status,'bound');
  assert.equal(caller.relations.before[0].snapshot,base.project.snapshot);
});

test('renaming a file remains one removed index path and one added path without same-name pairing',()=>{
  const renamed=structuredClone(base),target=renamed.files.find(file=>file.path==='leaf.ts');target.path='renamed.ts';
  for(const node of renamed.nodes)if(node.location.file==='leaf.ts')node.location.file='renamed.ts';
  const result=compareWorkspaceGraphs(base,renamed);
  const old=result.files.find(file=>file.path==='leaf.ts'),next=result.files.find(file=>file.path==='renamed.ts');
  assert.equal(old.kind,'removed');assert.equal(old.after,null);assert.equal(next.kind,'added');assert.equal(next.before,null);
  assert.equal(old.declarations.removed,1);assert.equal(next.declarations.added,1);
});

test('ambiguous identical declaration text is not paired across edited source',()=>{
  const text='function repeated() { return 1; }\nfunction repeated() { return 1; }\n';
  const root=project({'duplicate.ts':text}),before=analyze(root,{includeSource:true});
  fs.writeFileSync(path.join(root,'duplicate.ts'),'// moved\n'+text);
  const after=analyze(root,{includeSource:true}),file=compareWorkspaceGraphs(before,after).files[0];
  assert.equal(file.kind,'modified');assert.equal(file.declarations.removed,2);assert.equal(file.declarations.added,2);
});

test('unchanged source without embedding still compares exact anchors rather than IDs',()=>{
  const before=structuredClone(base);before.files.forEach(file=>delete file.source);
  const after=rekey(before);assert.deepEqual(compareWorkspaceGraphs(before,after).files,[]);
});

test('changed source without embedding does not use truncated snippets as a match',()=>{
  const before=structuredClone(base),after=structuredClone(modified);
  before.files.forEach(file=>delete file.source);after.files.forEach(file=>delete file.source);
  const row=compareWorkspaceGraphs(before,after).files.find(file=>file.path==='leaf.ts');
  assert.equal(row.diff.available,false);assert.match(row.diff.reason,/未保存完整源码/);
  assert.equal(row.declarations.removed,1);assert.equal(row.declarations.added,1);
  assert.equal('source' in row.before,false);
});

test('candidate, unresolved and truncated origin changes survive unchanged source comparison',()=>{
  const before=structuredClone(base),after=structuredClone(base);
  const edge=after.relations.find(relation=>relation.kind==='call'&&relation.targetLabel==='leaf');
  edge.status='candidate';edge.evidence.reason='parameter-value';
  edge.evidence.valueOrigins={complete:false,truncated:true,visited:12,
    limits:{maxDepth:5,maxSteps:12,maxSources:2,maxStops:2,maxCallsites:2},
    sources:[{target:edge.targets[0],path:[{location:edge.evidence.location,fileHash:edge.evidence.fileHash,excerpt:edge.evidence.excerpt,kind:'argument'}]}],
    stops:[{location:edge.evidence.location,fileHash:edge.evidence.fileHash,excerpt:edge.evidence.excerpt,reason:'step-budget'}]};
  let result=compareWorkspaceGraphs(before,after),row=result.files.find(file=>file.path==='entry.ts');
  assert.equal(row.kind,'analysis');assert.equal(row.after.relationsByStatus.candidate,1);
  assert.equal(row.relations.after[0].evidence.valueOrigins.truncated,true);
  assert.equal(row.relations.after[0].evidence.valueOrigins.stops[0].reason,'step-budget');
  const changed=structuredClone(after);changed.relations.find(relation=>relation.id===edge.id).evidence.valueOrigins.truncated=false;
  result=compareWorkspaceGraphs(after,changed);assert.equal(result.summary.analysisChanged,1);
  const unknown=structuredClone(before);const call=unknown.relations.find(relation=>relation.id===edge.id);
  call.status='unresolved';call.targets=[];call.evidence.reason='missing-symbol';
  row=compareWorkspaceGraphs(before,unknown).files.find(file=>file.path==='entry.ts');
  assert.equal(row.after.relationsByStatus.unresolved,1);assert.deepEqual(row.relations.after[0].targets,[]);
});

test('call, construct, import and callback facts remain distinct even with matching endpoints',()=>{
  const after=structuredClone(base),edge=after.relations.find(relation=>relation.kind==='call'&&relation.targetLabel==='leaf');
  edge.kind='construct';
  const row=compareWorkspaceGraphs(base,after).files.find(file=>file.path==='entry.ts');
  assert.equal(row.relations.before[0].kind,'call');assert.equal(row.relations.after[0].kind,'construct');
});

test('relation comparison treats duplicate records as a multiset',()=>{
  const after=structuredClone(base),edge=after.relations.find(relation=>relation.kind==='call'&&relation.targetLabel==='leaf');
  after.relations.push({...structuredClone(edge),id:'duplicate-record'});
  const row=compareWorkspaceGraphs(base,after).files.find(file=>file.path==='entry.ts');
  assert.equal(row.relations.added,1);assert.equal(row.relations.removed,0);assert.equal(row.relations.after[0].kind,'call');
});

test('record preview limits retain complete unmatched counts and disclose omitted evidence',()=>{
  const after=structuredClone(base),edge=after.relations.find(relation=>relation.kind==='call'&&relation.targetLabel==='leaf');
  for(let i=0;i<100;i++)after.relations.push({...structuredClone(edge),id:'additional-'+i,status:'unresolved',targets:[]});
  const result=compareWorkspaceGraphs(base,after),row=result.files.find(file=>file.path==='entry.ts');
  assert.equal(row.relations.added,100);assert.equal(row.relations.removed,0);
  assert.equal(row.relations.after.length,result.limits.recordsPerSide);assert.equal(row.relations.truncated,true);
  assert.equal(row.after.relationsByStatus.unresolved,100);
});

function sourceGraph(text,snapshot='source') {
  const graph=structuredClone(base);graph.project.snapshot=hash(snapshot);graph.files=[{path:'text.ts',hash:hash(text),lines:text.split('\n').length,source:text}];
  graph.nodes=[];graph.relations=[];graph.coverage.indexedFiles=1;graph.coverage.inventorySourceFiles=1;
  graph.coverage.syntaxCalls=0;graph.coverage.callsByStatus={bound:0,candidate:0,unresolved:0,external:0};return graph;
}

test('large diffs disclose line and source preview budgets while retaining exact snapshot refs',()=>{
  const before=sourceGraph(Array.from({length:1000},(_,i)=>'before-'+i+'-'.repeat(50)).join('\n'),'old');
  const after=sourceGraph(Array.from({length:1000},(_,i)=>'after-'+i+'-'.repeat(50)).join('\n'),'new');
  const result=compareWorkspaceGraphs(before,after),row=result.files[0];
  assert.equal(row.before.sourceTruncated,true);assert.equal(row.after.sourceTruncated,true);
  assert.equal(row.diff.truncated,true);assert.equal(row.diff.omittedBeforeLines,880);assert.equal(row.diff.omittedAfterLines,880);
  assert.equal(row.diff.lines.filter(line=>line.kind==='removed').length,120);
  assert.equal(row.diff.lines.filter(line=>line.kind==='added').length,120);
  assert.equal(row.before.snapshot,before.project.snapshot);assert.equal(row.after.snapshot,after.project.snapshot);
  assert.ok(row.diff.lines.reduce((sum,line)=>sum+line.text.length,0)<=result.limits.diffCharacters);
});

test('very long individual lines cannot hide truncation or starve the other comparison side',()=>{
  const row=compareWorkspaceGraphs(sourceGraph('a'.repeat(100000),'old'),sourceGraph('b'.repeat(100000),'new')).files[0];
  assert.equal(row.diff.lines.length,2);assert.ok(row.diff.lines.every(line=>line.textTruncated));
  assert.equal(row.diff.truncated,true);assert.equal(row.diff.lines[0].kind,'removed');assert.equal(row.diff.lines[1].kind,'added');
});

test('line-ending changes remain a source modification even when displayed lines match',()=>{
  const row=compareWorkspaceGraphs(sourceGraph('one\r\ntwo\r\n','old'),sourceGraph('one\ntwo\n','new')).files[0];
  assert.equal(row.kind,'modified');assert.notEqual(row.before.hash,row.after.hash);
  assert.equal(row.diff.available,true);assert.match(row.diff.reason,/换行/);
});

test('scope gaps and analysis-contract changes stay explicit without invented file changes',()=>{
  const after=structuredClone(base);after.project.analysisRevision=undefined;after.project.compilerVersion='different';
  after.project.config='tsconfig.other.json';after.project.snapshot=hash('config-change');
  after.coverage.unindexed.push({path:'worker.py',reason:'unsupported-language'});
  const result=compareWorkspaceGraphs(base,after);
  assert.deepEqual(result.files,[]);assert.equal(result.contractChanges.length,3);assert.equal(result.inputSnapshotChanged,true);
  assert.equal(result.after.analysisRevision,null);assert.deepEqual(result.scope.after.unindexed,[{path:'worker.py',reason:'unsupported-language'}]);
  result.scope.after.unindexed.length=0;assert.equal(after.coverage.unindexed.length,1);
});

test('diagnostic-only changes retain both versions without pretending source was edited',()=>{
  const after=structuredClone(base);after.diagnostics.push({category:'error',code:'TS2307',file:'entry.ts',line:1,message:'Cannot find module'});
  const result=compareWorkspaceGraphs(base,after);
  assert.deepEqual(result.files,[]);assert.equal(result.diagnostics.changed,true);
  assert.equal(result.diagnostics.after.at(-1).code,'TS2307');assert.equal(result.diagnostics.before.length,base.diagnostics.length);
  const reordered=structuredClone(after);reordered.diagnostics.reverse();
  assert.equal(compareWorkspaceGraphs(after,reordered).diagnostics.changed,false);
});
