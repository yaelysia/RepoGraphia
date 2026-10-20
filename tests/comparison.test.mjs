import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'repographia-comparison-'));
after(()=>fs.rmSync(temp,{recursive:true,force:true}));
const base={project:{compilerVersion:'5.9.3',analysisRevision:2,snapshot:'old'},
  files:[{path:'x.ts',hash:'same'}],coverage:{syntaxCalls:1,callsByStatus:{unresolved:1}},
  relations:[{id:'old-id',kind:'call',status:'unresolved',targetLabel:'fn',evidence:{rule:'old',location:{file:'x.ts',start:0,end:4}}}]};
function run(before,after) {
  const a=path.join(temp,'a.json'),b=path.join(temp,'b.json'),out=path.join(temp,'out.json');
  fs.writeFileSync(a,JSON.stringify(before));fs.writeFileSync(b,JSON.stringify(after));
  const result=spawnSync(process.execPath,['scripts/compare-resolution.mjs',a,b,out],{encoding:'utf8',timeout:10000});
  return {...result,data:result.status===0?JSON.parse(fs.readFileSync(out,'utf8')):null};
}
test('comparison uses callsite coordinates across rule revisions, not snapshot-local IDs',()=>{
  const next=structuredClone(base);next.project.analysisRevision=3;next.project.snapshot='new';next.relations[0].id='new-id';
  next.relations[0].status='external';next.coverage.callsByStatus={external:1};
  const r=run(base,next);assert.equal(r.status,0,r.stderr);
  assert.equal(r.data.identicalExplicitCallsites,true);assert.equal(r.data.transitions[0].transition,'unresolved -> external');
  assert.equal(r.data.transitions[0].count,1);
});
test('changed indexed sources cannot masquerade as analyzer improvements',()=>{
  const next=structuredClone(base);next.files[0].hash='different';
  assert.notEqual(run(base,next).status,0);
});
test('changed compiler versions cannot enter a same-input comparison',()=>{
  const next=structuredClone(base);next.project.compilerVersion='other';
  assert.notEqual(run(base,next).status,0);
});
test('dropping a callsite cannot improve the unresolved count unnoticed',()=>{
  const next=structuredClone(base);next.relations=[];next.coverage.syntaxCalls=0;
  assert.notEqual(run(base,next).status,0);
});
