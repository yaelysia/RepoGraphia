import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {createFeatureMapApi} from '../dist/feature-map.js';
import {createFeatureMigrationApi} from '../dist/feature-migration.js';
import {migrationFixture} from './helpers/migration-fixture.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'repographia-migration-'));
after(()=>fs.rmSync(root,{recursive:true,force:true}));
const {before,after:next,map}=migrationFixture(path.join(root,'source'));
const api=createFeatureMapApi(), migration=createFeatureMigrationApi(api), copy=structuredClone;
const ctx=(m=map)=>({expectedRevision:m.revision,actor:'automated-test-reviewer',actorKind:'manual',at:'2026-10-20T01:00:00Z',reason:'Test-only migration, not a real user acceptance'});
const request=(old=before,target=next,m=map,actions=[{id:'keep',action:'carry'}])=>{
 const p=migration.plan(old,target,m);return {sourceRevision:m.revision,from:p.from,to:p.to,actions};
};
const run=(actions,m=map,g=next)=>migration.apply(before,g,m,request(before,g,m,actions),ctx(m));
const replace=(id='change')=>({id,action:'replace',nodeId:next.nodes.find(n=>n.name==='change'&&n.kind==='function').id,
 relationIds:[],role:'implementation',rationale:'Explicitly inspected new target, re-review needed'});

test('real edited source distinguishes unchanged, changed, removed and affected dependency',()=>{
 assert.equal(before.diagnostics.length,0);assert.equal(next.diagnostics.length,0);
 const p=migration.plan(before,next,map);
 assert.deepEqual(Object.fromEntries(p.rows.map(r=>[r.id,r.status])),{keep:'reusable',change:'needs-review',removed:'unmatched',caller:'needs-review'});
 assert.ok(p.rows.find(r=>r.id==='caller').reasons.includes('changed-static-neighborhood'));
});
test('plan and apply never mutate either graph, sidecar or submitted request',()=>{
 const originals=[before,next,map].map(JSON.stringify),req=request(),raw=JSON.stringify(req);
 migration.plan(before,next,map);migration.apply(before,next,map,req,ctx());
 assert.deepEqual([before,next,map].map(JSON.stringify),originals);assert.equal(JSON.stringify(req),raw);
});
test('partial migration is schema 2 and deferred records keep old snapshot identity',()=>{
 const out=run([{id:'keep',action:'carry'}]),a=api.assess(next,out);
 assert.equal(out.schemaVersion,2);assert.equal(out.basis.snapshot,next.project.snapshot);
 assert.deepEqual(a.mappings.map(m=>[m.mapping.id,m.current]),[['keep',true],['change',false],['removed',false],['caller',false]]);
 assert.equal(out.mappings.find(m=>m.id==='caller').basis.snapshot,before.project.snapshot);
 assert.equal(out.history.at(-1).before.mappings.length,4);assert.equal(out.history.at(-1).operation,'migration');
});
test('accepted references reset to proposed, with original decision preserved in history',()=>{
 const m=api.edit(before,map,{op:'review',id:'keep',decision:'accepted'},ctx());const out=run([{id:'keep',action:'carry'}],m);
 assert.equal(out.mappings[0].decision,'proposed');assert.equal(out.history.at(-1).before.mappings[0].decision,'accepted');
});
test('rejected records stay rejected, including explicit replacement',()=>{
 const m=api.edit(before,map,{op:'review',id:'change',decision:'rejected'},ctx());const out=run([replace()],m);
 assert.equal(out.mappings.find(m=>m.id==='change').decision,'rejected');
 assert.equal(api.forNode(next,out,replace().nodeId).length,0);
});
test('explicit replacement binds only selected current ID and never inherits old acceptance',()=>{
 const out=run([replace('removed')]);assert.equal(api.assess(next,out).mappings.find(m=>m.mapping.id==='removed').current,true);
 assert.equal(out.history.at(-1).before.mappings.find(m=>m.id==='removed').code.name,'removed');
 assert.equal(out.mappings.find(m=>m.id==='removed').code.name,'change');
});
test('same-name replacement with a different ID is unmatched and not automatically searched',()=>{
 const g=copy(next);g.nodes.find(n=>n.name==='keep'&&n.kind==='function').id='replacement-id';
 assert.equal(migration.plan(before,g,map).rows[0].status,'unmatched');
 assert.throws(()=>run([{id:'keep',action:'carry'}],map,g),/cannot carry/);
});
for(const [name,mutate] of [
 ['analysis rules',g=>g.project.analysisRevision++],['compiler',g=>g.project.compilerVersion='99.0.0'],
 ['config',g=>g.project.config='different.json'],['project name',g=>g.project.name='other-project'],
 ['unknown analysis version',g=>delete g.project.analysisRevision],
 ['source hash',g=>g.files.find(f=>f.path==='stable.ts').hash='a'.repeat(64)],
 ['new caller',g=>g.relations.push({...g.relations[0],id:'new-call',targets:[map.mappings[0].code.nodeId]})],
]) test(name+' disables blind carry despite unchanged symbol name',()=>{
 const g=copy(next);mutate(g);assert.notEqual(migration.plan(before,g,map).rows[0].status,'reusable');
 assert.throws(()=>run([{id:'keep',action:'carry'}],map,g),/cannot carry/);
});
test('same unchanged node ID cannot make a deferred annotation current',()=>{
 const out=run([replace()]);const m=api.assess(next,out).mappings.find(m=>m.mapping.id==='keep');
 assert.equal(m.current,false);assert.ok(m.issues.includes('changed-snapshot'));
 assert.equal(api.forNode(next,out,m.mapping.code.nodeId).length,0);
 assert.throws(()=>api.edit(next,out,{op:'review',id:'keep',decision:'accepted'},ctx(out)),/stale/);
});
test('schema-v1 remains readable; schema-v2 rejects missing per-mapping provenance',()=>{
 assert.deepEqual(api.validate(map),map);const out=run([{id:'keep',action:'carry'}]);delete out.mappings[0].basis;
 assert.throws(()=>api.validate(out));
});
test('editing an explicit deferred mapping after migration updates its own basis only',()=>{
 const out=run([{id:'keep',action:'carry'}]);const {action,...correction}=replace('caller');const updated=api.edit(next,out,{op:'mapping',...correction,featureId:'fixture'},ctx(out));
 assert.equal(api.assess(next,updated).mappings.find(m=>m.mapping.id==='caller').current,true);
 assert.equal(api.assess(next,updated).mappings.find(m=>m.mapping.id==='removed').current,false);
});
test('second migration preserves older deferred records without laundering their old basis',()=>{
 const out=run([{id:'keep',action:'carry'}]),g=copy(next);g.project.snapshot='b'.repeat(64);
 const p=migration.plan(next,g,out);assert.equal(p.rows[1].status,'needs-review');
 const result=migration.apply(next,g,out,request(next,g,out,[{id:'keep',action:'carry'}]),ctx(out));
 assert.equal(result.mappings[1].basis.snapshot,before.project.snapshot);assert.equal(api.assess(g,result).summary.stale,3);
});
test('current user-declared acceptance is not executable permission for an agent migration',()=>{
 assert.throws(()=>migration.apply(before,next,map,request(),{...ctx(),actorKind:'agent'}),/manual/);
});
for(const [name,mutate] of [
 ['stale revision',r=>r.sourceRevision--],['wrong target snapshot',r=>r.to.snapshot='f'.repeat(64)],
 ['wrong source snapshot',r=>r.from.snapshot='f'.repeat(64)],['unknown plan data',r=>r.rows=[]],
 ['duplicate actions',r=>r.actions.push(r.actions[0])],['missing mapping',r=>r.actions[0].id='absent'],
 ['unknown action',r=>r.actions[0].action='accept-all'],['all deferred',r=>r.actions[0].action='defer'],
 ['unverified carry',r=>r.actions[0].id='caller'],
]) test(name+' fails atomically without changing the source document',()=>{
 const r=request();mutate(r);const raw=JSON.stringify(map);assert.throws(()=>migration.apply(before,next,map,r,ctx()));assert.equal(JSON.stringify(map),raw);
});
test('wrong old graph and identical basis fail instead of producing a successful empty plan',()=>{
 assert.throws(()=>migration.plan(next,next,map),/old graph/);assert.throws(()=>migration.plan(before,before,map),/unnecessary/);
});
test('replacement with unrelated evidence fails rather than changing the original sidecar',()=>{
 const a=replace();a.nodeId=map.mappings[0].code.nodeId;a.relationIds=[next.relations.find(e=>e.kind==='call').id];
 assert.throws(()=>run([a]),/unrelated-relation/);
});
test('browser migration factory and CLI factory produce identical plans',()=>{
 const other=vm.runInNewContext(`(${createFeatureMigrationApi.toString()})((${createFeatureMapApi.toString()})())`);
 assert.deepEqual(JSON.parse(JSON.stringify(other.plan(before,next,map))),migration.plan(before,next,map));
});
const paths=['old.json','new.json','features.json'].map(n=>path.join(root,n));
[before,next,map].forEach((g,i)=>fs.writeFileSync(paths[i],JSON.stringify(g)));
const cli=(...args)=>spawnSync(process.execPath,['dist/cli.js','features',...args],{encoding:'utf8'});
test('CLI plan agrees with API, and plan output cannot overwrite any existing file',()=>{
 const out=path.join(root,'plan.json');const p=cli('plan',...paths,'--out',out);assert.equal(p.status,0,p.stderr);
 assert.deepEqual(JSON.parse(fs.readFileSync(out)),migration.plan(before,next,map));assert.notEqual(cli('plan',...paths,'--out',out).status,0);
});
test('CLI explicit migration creates a new sidecar and check returns 2 for deferred records',()=>{
 const patch=path.join(root,'request.json'),out=path.join(root,'result.json');fs.writeFileSync(patch,JSON.stringify({...request(),reason:ctx().reason}));
 const args=['migrate',...paths,'--patch',patch,'--expected-revision',String(map.revision),'--author','cli-test','--actor-kind','manual','--out',out];
 const p=cli(...args);assert.equal(p.status,0,p.stderr);assert.equal(cli('check',paths[1],out).status,2);
 assert.notEqual(cli(...args).status,0);assert.deepEqual(JSON.parse(fs.readFileSync(paths[2])),map);
});
test('migrating accepted candidate evidence preserves candidate and incomplete-origin warnings',()=>{
 const g=copy(before),edge=g.relations.find(e=>e.kind==='call');edge.status='candidate';edge.evidence.valueOrigins={complete:false,truncated:true};
 let m=api.edit(g,map,{op:'mapping',id:'caller',featureId:'fixture',nodeId:map.mappings.find(m=>m.id==='caller').code.nodeId,
   role:'implementation',rationale:'Hand-built candidate provenance fixture',relationIds:[edge.id]},ctx());
 m=api.edit(g,m,{op:'review',id:'caller',decision:'accepted'},ctx(m));const target=copy(g);target.project.snapshot='c'.repeat(64);
 const out=migration.apply(g,target,m,request(g,target,m,[{id:'caller',action:'carry'}]),ctx(m));
 const record=api.assess(target,out).mappings.find(m=>m.mapping.id==='caller');
 assert.equal(record.mapping.decision,'proposed');assert.equal(record.mapping.evidence[0].status,'candidate');
 assert.ok(record.warnings.includes('incomplete-value-origins'));assert.ok(record.warnings.includes('truncated-value-origins'));
});
