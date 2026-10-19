import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { analyze } from '../dist/analyze.js';
import { renderHtml } from '../dist/report.js';
import { resolutionSummary } from '../dist/diagnostics.js';
import { ANALYSIS_REVISION } from '../dist/model.js';

const revision='490d822a9593d8d4b78a9188dd0daa0ae791eaf6';
const root=path.resolve(process.argv[2]||'../Codex-Monitor');
const out=path.resolve(process.argv[3]||'reports/codex-monitor');
const state=()=>execFileSync('git',['-C',root,'status','--porcelain'],{encoding:'utf8'});
assert.equal(execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),revision,'Use the pinned sample commit');
const before=state(), started=performance.now();
const graph=analyze(root,{includeSource:true});
graph.project.name='Codex-Monitor';
const byId=new Map(graph.nodes.map(n=>[n.id,n]));
const checks=[];
function binding(file,expression,targetFile,targetName) {
  const matches=graph.relations.filter(e=>e.kind==='call'&&e.evidence.location.file===file&&e.targetLabel===expression);
  assert.ok(matches.some(e=>e.status==='bound'&&e.targets.some(id=>{
    const n=byId.get(id); return n.location.file===targetFile&&n.name===targetName;
  })),`${file}: ${expression} -> ${targetFile}:${targetName}`);
  checks.push(`${file}:${expression} -> ${targetFile}:${targetName}`);
}
binding('electron/monitor-service.ts','collect','electron/collector.ts','refresh');
binding('electron/collector.ts','scanLocal','electron/local.ts','scanLocal');
binding('electron/local.ts','inferStatus','electron/rollout.ts','inferStatus');
assert.ok(graph.files.length>50);
assert.ok(graph.coverage.unindexed.some(x=>x.path==='collector/scan.py'&&x.reason==='unsupported-language'));
const ipc=graph.relations.filter(e=>e.kind==='call'&&e.targetLabel==='ipcRenderer.invoke');
assert.ok(ipc.length>0);
assert.ok(ipc.every(e=>!e.targets.some(t=>byId.get(t).location.file==='electron/ipc-handlers.ts')),'Do not invent IPC bridge calls');
for(const e of graph.relations) {
  assert.ok(byId.has(e.from)); assert.ok(e.targets.every(t=>byId.has(t)));
  assert.ok(e.evidence.fileHash); assert.ok(e.evidence.location.line>0);
}
assert.equal(state(),before,'Analyzing must not modify the sample repository');
const diagnosticSummary=resolutionSummary(graph);
assert.equal(graph.project.analysisRevision,ANALYSIS_REVISION);
assert.equal(diagnosticSummary.groups.reduce((n,g)=>n+g.count,0),graph.coverage.callsByStatus.unresolved);
assert.ok(!diagnosticSummary.groups.some(g=>g.reason==='unclassified'),'Current unknown calls must retain a reason');
const maps=graph.relations.filter(e=>e.kind==='construct'&&e.targetLabel==='Map'&&e.evidence.location.file==='src/shared/activity-tracker.ts');
assert.ok(maps.length>0); assert.ok(maps.every(e=>e.status==='external'&&!e.targets.length));
const cache=graph.relations.find(e=>e.kind==='construct'&&e.targetLabel==='DesktopDirectoryCache'&&e.evidence.location.file==='electron/desktop-runtime-logs.ts');
assert.equal(cache?.evidence.reason,'out-of-scope-declaration');
assert.ok(cache.evidence.declaration.location.file.endsWith('.d.mts'));
const summary={analysisRevision:graph.project.analysisRevision,snapshot:graph.project.snapshot,sample:'yaelysia/Codex-Monitor',revision,compiler:graph.project.compilerVersion,
  files:graph.files.length,symbols:graph.nodes.filter(n=>n.kind!=='file').length,
  explicitCallsites:graph.coverage.syntaxCalls,callsByStatus:graph.coverage.callsByStatus,
  unindexed:graph.coverage.unindexed.length,diagnostics:graph.diagnostics.length,
  elapsedMs:Math.round(performance.now()-started),verifiedBindings:checks,
  warning:'These are observed index counts and selected assertions, not measured call-graph precision or recall.'};
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'graph.json'),JSON.stringify(graph,null,2));
fs.writeFileSync(path.join(out,'index.html'),renderHtml(graph));
fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2));
fs.writeFileSync(path.join(out,'resolution-summary.json'),JSON.stringify(diagnosticSummary,null,2));
// Schema-compatibility fixture, not an assertion of older analyzer behavior.
const legacy={...graph,project:{...graph.project,name:'Legacy-format fixture',analysisRevision:undefined},
  files:graph.files.map(({source,...rest})=>rest),
  relations:graph.relations.map(e=>({...e,evidence:{...e.evidence,reason:undefined,declaration:undefined}}))};
fs.writeFileSync(path.join(out,'legacy-test.html'),renderHtml(legacy));
console.log(JSON.stringify(summary,null,2));
