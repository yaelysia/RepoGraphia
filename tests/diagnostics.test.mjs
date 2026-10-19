import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolutionSummary, diagnosticRecords } from '../dist/diagnostics.js';
import { renderHtml } from '../dist/report.js';

const location = { file: 'main.ts', start: 0, end: 4, line: 1, column: 1, endLine: 1, endColumn: 5 };
const edge = (id, status, reason, kind = 'call', file = 'main.ts') => ({ id, from:'entry', targets:[], kind, status,
  targetLabel:'fn', evidence:{ rule:'test-fixture', reason, explanation:'Fixture only', excerpt:'fn()', fileHash:'a'.repeat(64), location:{...location,file} } });
const graph = { schemaVersion:1, project:{name:'Fixture', snapshot:'snapshot', compilerVersion:'test', analysisRevision:3},
  files:[], nodes:[], diagnostics:[], coverage:{syntaxCalls:999, limitations:[], unindexed:[], ignoredDirectories:[], skippedSymlinks:[], callsByStatus:{}},
  relations:[edge('p1','unresolved','parameter-value','call','tests/first.test.ts'), edge('p2','unresolved','parameter-value'),
    edge('p3','unresolved','parameter-value'), edge('p4','unresolved','parameter-value'),
    edge('old','unresolved',undefined), edge('future','unresolved','future-reason'),
    edge('bound','bound'),edge('candidate','candidate'),edge('external','external'),
    edge('module','unresolved','dynamic-import','import'),edge('callback','unresolved','parameter-value','callback')] };
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'repographia-diagnostics-cli-'));
after(()=>fs.rmSync(temp,{recursive:true,force:true}));
const file=path.join(temp,'graph.json');fs.writeFileSync(file,JSON.stringify(graph));
const run=(...args)=>spawnSync(process.execPath,[path.resolve('dist/cli.js'),'query',file,...args],{encoding:'utf8',timeout:10000});

test('diagnostic totals partition actual explicit calls, not stale coverage counters or callback/module edges',()=>{
  const r=resolutionSummary(graph);assert.equal(r.totalCallsites,9);
  assert.deepEqual(r.counts,{bound:1,candidate:1,unresolved:6,external:1});
  assert.equal(r.groups.reduce((sum,g)=>sum+g.count,0),r.counts.unresolved);
  assert.equal(r.snapshot,graph.project.snapshot);
});
test('legacy and future reason codes are unclassified rather than reverse-inferred',()=>{
  const old=structuredClone(graph);delete old.project.analysisRevision;
  const r=resolutionSummary(old);assert.equal(r.analysisRevision,null);
  assert.equal(r.groups.find(g=>g.reason==='unclassified').count,2);
});
test('bounded examples prioritize non-test paths and disclose omitted records',()=>{
  const r=resolutionSummary(graph,2),g=r.groups.find(g=>g.reason==='parameter-value');
  assert.deepEqual(g.examples,['p2','p3']);assert.equal(g.omittedExamples,2);assert.equal(g.testPathCount,1);
  assert.equal(resolutionSummary(graph,0).groups[0].examples.length,0);
});
test('summary and paging preserve the original graph and full source evidence',()=>{
  const before=JSON.stringify(graph);resolutionSummary(graph);const r=diagnosticRecords(graph,'parameter-value',{limit:2});
  assert.equal(JSON.stringify(graph),before);
  assert.deepEqual(r.relations[0].evidence,graph.relations[1].evidence);
});
test('reason paging returns exact continuation and end boundaries',()=>{
  const first=diagnosticRecords(graph,'parameter-value',{limit:2});
  assert.equal(first.total,4);assert.equal(first.boundary.hasMore,true);assert.equal(first.boundary.nextOffset,2);
  const next=diagnosticRecords(graph,'parameter-value',{limit:2,offset:first.boundary.nextOffset});
  assert.deepEqual(next.relations.map(e=>e.id),['p4','p1']);assert.equal(next.boundary.nextOffset,null);
  assert.equal(diagnosticRecords(graph,'parameter-value',{offset:20}).boundary.returned,0);
});
test('empty categories still state their evidence scope without inventing a runtime conclusion',()=>{
  const r=diagnosticRecords(graph,'property-value');assert.equal(r.total,0);
  assert.equal(r.boundary.hasMore,false);assert.match(r.boundary.explanation,/not proof/);
});
test('invalid categories and query budgets fail explicitly',()=>{
  for(const reason of ['bogus','__proto__','constructor']) assert.throws(()=>diagnosticRecords(graph,reason),/Unknown/);
  for(const options of [{limit:0},{limit:101},{limit:NaN},{offset:-1},{offset:0.5},{offset:Number.MAX_SAFE_INTEGER+1}])
    assert.throws(()=>diagnosticRecords(graph,'parameter-value',options));
  for(const n of [-1,21,NaN]) assert.throws(()=>resolutionSummary(graph,n));
});
test('CLI diagnostics needs no selector and retains grouped counts',()=>{
  const r=run('diagnostics');assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).counts.unresolved,6);
});
test('CLI focused diagnostics paginate and retain original relation evidence',()=>{
  const r=run('diagnostics','parameter-value','--limit','1','--offset','1');assert.equal(r.status,0,r.stderr);
  const data=JSON.parse(r.stdout);assert.equal(data.relations.length,1);assert.equal(data.relations[0].id,'p3');
  assert.ok(data.relations[0].evidence.location);assert.equal(data.boundary.nextOffset,2);
});
test('CLI rejects invalid reasons, invalid numbers and budgets without a category',()=>{
  for(const args of [['diagnostics','not-real'],['diagnostics','parameter-value','--limit','oops'],['diagnostics','--offset','2']])
    assert.equal(run(...args).status,1);
});
test('HTML embeds the same pure diagnostic summary as CLI rather than a second classifier',()=>{
  const html=renderHtml(graph);const data=html.match(/<script id="resolution-data" type="application\/json">(.*?)<\/script>/s);
  assert.ok(data);assert.deepEqual(JSON.parse(data[1]),resolutionSummary(graph));
});
test('diagnostic embedding also escapes source-derived IDs and supports old graphs',()=>{
  const old=structuredClone(graph);delete old.project.analysisRevision;
  delete old.relations[0].evidence.reason;old.relations[0].id='</script><script>globalThis.pwned=true</script>';
  const html=renderHtml(old);assert.ok(!html.includes(old.relations[0].id));
  assert.ok(html.includes('unclassified'));assert.ok(html.includes("connect-src 'none'"));
});
