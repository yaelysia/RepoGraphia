import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { analyze } from '../dist/analyze.js';
import { createAgentApi, digest, page } from '../dist/agent.js';
import { createFeatureMapApi } from '../dist/feature-map.js';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'repographia-agent-'));
after(()=>fs.rmSync(dir,{recursive:true,force:true}));
const repo=path.join(dir,'src');fs.mkdirSync(repo);
fs.writeFileSync(path.join(repo,'a.ts'),`export function notify(enabled:boolean, send:()=>void){
  if (!enabled) return false;
  send();
  return true;
}
export function deliver() { return 1; }
notify(true, deliver);
export function unrelated() { return 2; }
`);
const g=analyze(repo,{includeSource:true}), fapi=createFeatureMapApi(), empty=fapi.create(g);
const n=g.nodes.find(n=>n.name==='notify'), delivery=g.nodes.find(n=>n.name==='deliver');
const edge=g.relations.find(e=>e.targetLabel==='send');
const unrelated=g.nodes.find(n=>n.name==='unrelated');
const api=createAgentApi(g), fixed='2026-10-20T00:00:00Z';
const draft=()=>({...api.overview().proposalHeader,batchId:'batch-1',scope:'Sending a notification when enabled',unexplored:['Transport delivery and UI are outside this fixture.'],
 features:[{id:'notify',title:'Conditional notification',description:'When enabled, invokes send; disabled requests return false. No delivery guarantee.',questions:[]}],
 mappings:[{op:'mapping',id:'notify-entry',featureId:'notify',nodeId:n.id,role:'entry',rationale:'Checks enabled before invoking a supplied sender.',relationIds:[edge.id]}],
 checks:[{featureId:'notify',nodeId:n.id,kind:'support',quote:'send();',explanation:'A callsite for the supplied sender.'},
 {featureId:'notify',nodeId:n.id,kind:'limit',quote:'if (!enabled) return false;',explanation:'Disabled requests do not reach send.'}]});
const expectCode=(fn,code)=>assert.throws(fn,e=>e.code===code);
const gf=path.join(dir,'graph.json'), pf=path.join(dir,'proposal.json');
fs.writeFileSync(gf,JSON.stringify(g));fs.writeFileSync(pf,JSON.stringify(draft()));
const cli=(...a)=>spawnSync(process.execPath,['dist/cli.js','agent',...a],{encoding:'utf8',timeout:20000});
const change=(m,operation,kind='manual')=>fapi.edit(g,m,operation,{expectedRevision:m.revision,actor:'fixture',actorKind:kind,at:fixed,reason:'Explicit fixture decision'});

test('agent fixture is type-correct; overview has explicit scope, unknowns and empty template',()=>{
 assert.equal(g.diagnostics.length,0);const v=api.overview();assert.equal(v.protocolVersion,1);
 assert.equal(v.baseDigest,digest(empty));assert.equal(v.expectedRevision,0);assert.equal(v.proposalHeader.features.length,0);
 assert.ok(v.limitations.length);assert.equal(v.existingReview.accepted,0);
});
test('agent search is deterministic, segment-scoped and paginates without fabricated names',()=>{
 const first=api.search('a.ts','',0,2).matches, next=api.search('a.ts','',first.nextOffset,2).matches;
 assert.equal(first.items.length,2);assert.ok(!first.items.some(n=>next.items.some(m=>m.id===n.id)));
 assert.equal(api.search('does-not-exist').matches.total,0);
 assert.throws(()=>api.search('notify','bad'));expectCode(()=>api.inspect('notify'),'UNKNOWN_NODE');
});
test('source pages use exact UTF16 ranges and return a continuation instead of claiming completeness',()=>{
 const first=api.inspect(n.id,{sourceLimit:10}).source,next=api.inspect(n.id,{sourceOffset:10,sourceLimit:16000}).source;
 assert.equal(first.complete,false);assert.equal(first.nextOffset,10);assert.equal(next.complete,false);assert.equal(next.nextOffset,null);
 assert.equal(first.text+next.text,g.files[0].source.slice(n.location.start,n.location.end));
 assert.equal(first.start,n.location.start);assert.equal(next.end,n.location.end);
});
test('missing source is disclosed and blocks proposal publication',()=>{
 const missing=structuredClone(g);delete missing.files[0].source;const a=createAgentApi(missing);
 assert.equal(a.inspect(n.id).source.available,false);expectCode(()=>a.propose(draft(),'agent'),'SOURCE_REQUIRED');
});
test('tampered embedded source fails rather than silently reconstructing a new hash',()=>{
 const wrong=structuredClone(g);wrong.files[0].source+='// tampered';
 expectCode(()=>createAgentApi(wrong).inspect(n.id),'SOURCE_HASH_MISMATCH');
});
test('candidate relation and complete=false origin evidence survive query projection',()=>{
 const v=api.inspect(n.id);const r=v.relations.items.find(r=>r.id===edge.id);
 assert.equal(r.status,'candidate');assert.equal(r.origins.complete,false);
 const detail=api.relation(edge.id);assert.equal(detail.origins.complete,false);
 assert.equal(detail.relation.evidence.excerpt,edge.evidence.excerpt);assert.ok(detail.origins.records.total>0);
});
test('origin pagination is exhaustive and uses the same original source/stop records',()=>{
 const actual=[];let off=0;
 do{const p=api.relation(edge.id,off,1).origins.records;actual.push(...p.items);off=p.nextOffset;}while(off!==null);
 assert.equal(actual.length,edge.evidence.valueOrigins.sources.length+edge.evidence.valueOrigins.stops.length);
});
test('invalid query budgets and unknown relations fail explicitly',()=>{
 for(const value of [-1,0,51,NaN,Infinity,1.5]) expectCode(()=>api.search('notify','',0,value),'INVALID_BUDGET');
 expectCode(()=>api.inspect(n.id,{sourceLimit:16001}),'INVALID_BUDGET');expectCode(()=>page([],NaN),'INVALID_BUDGET');
 expectCode(()=>api.relation('edge:invented'),'UNKNOWN_RELATION');
});
test('returned query objects do not expose mutable source or annotation references',()=>{
 const before=JSON.stringify(g), out=api.inspect(n.id);out.node.location.start=999;out.basis.snapshot='f'.repeat(64);
 assert.equal(JSON.stringify(g),before);assert.equal(api.inspect(n.id).node.location.start,n.location.start);
 assert.equal(api.overview().basis.snapshot,g.project.snapshot);
});
test('a valid append captures exact quotes and only agent/proposed decisions without mutating inputs',()=>{
 const p=draft(), before=JSON.stringify([g,empty,p]),result=api.propose(p,'trial-author',fixed);
 assert.equal(JSON.stringify([g,empty,p]),before);assert.equal(result.receipt.addedMappings,1);assert.equal(result.receipt.addedFeatures,1);
 assert.equal(result.features.mappings[0].decision,'proposed');assert.ok(result.features.history.every(h=>h.actorKind==='agent'));
 assert.ok(result.assessment.mappings[0].warnings.includes('evidence-candidate'));
 for(const c of result.receipt.checks) assert.equal(g.files[0].source.slice(c.start,c.end),c.quote);
});
for(const [name,mutate,code] of [
 ['snapshot',p=>p.basis.snapshot='f'.repeat(64),'SNAPSHOT_CONFLICT'],
 ['revision',p=>p.expectedRevision++,'REVISION_CONFLICT'],
 ['same revision different base',p=>p.baseDigest='f'.repeat(64),'REVISION_CONFLICT'],
 ['self acceptance',p=>p.mappings[0].decision='accepted','INVALID_PROPOSAL'],
 ['actor spoof',p=>p.actorKind='manual','INVALID_PROPOSAL'],
 ['review operation',p=>p.mappings[0].op='review','INVALID_PROPOSAL'],
 ['no limiting check',p=>p.checks.pop(),'MISSING_CHECK'],
 ['invented quote',p=>p.checks[0].quote='sendAll();','QUOTE_MISMATCH'],
 ['ambiguous quote',p=>p.checks[0].quote='return','QUOTE_MISMATCH'],
 ['unrelated check',p=>p.checks[0].nodeId=unrelated.id,'UNRELATED_CHECK'],
 ['unknown code',p=>p.mappings[0].nodeId='node:invented','UNKNOWN_NODE'],
 ['duplicate mappings',p=>p.mappings.push({...p.mappings[0],id:'different-id',role:'support'}),'EXISTING_MAPPING'],
 ['empty mappings',p=>p.mappings=[],'EMPTY_PROPOSAL'],
 ['unsupported schema',p=>p.schemaVersion=2,'INVALID_PROPOSAL'],
 ['unmapped feature',p=>p.features.push({...p.features[0],id:'extra',title:'No code'}),'UNMAPPED_FEATURE'],
]) test(`proposal rejects ${name}`,()=>{const p=draft();mutate(p);expectCode(()=>api.propose(p,'agent',fixed),code);});

test('unrelated relationship evidence cannot legitimize a functional association',()=>{
 const p=draft();p.mappings[0].relationIds=[g.relations.find(e=>e.from!==n.id&&!e.targets.includes(n.id)).id];
 assert.throws(()=>api.propose(p,'agent'),/unrelated-relation/);
});
test('accepted and rejected mappings remain byte-identical after additions to a new capability',()=>{
 let base=api.propose(draft(),'fixture',fixed).features;
 base=change(base,{op:'review',id:'notify-entry',decision:'accepted'});
 const a=createAgentApi(g,base),p=draft();Object.assign(p,a.overview().proposalHeader);
 p.batchId='new';p.scope='Another partial capability';p.features=[{id:'other',title:'Delivery stub',description:'Only returns a value.',questions:[]}];
 p.mappings=[{op:'mapping',id:'other-map',featureId:'other',nodeId:delivery.id,role:'implementation',rationale:'Exact stub implementation, not transport.',relationIds:[]}];
 p.checks=['support','limit'].map(kind=>({featureId:'other',nodeId:delivery.id,kind,quote:'return 1;',explanation:'Only this fixed return is evidenced.'}));
 const result=a.propose(p,'agent',fixed);assert.deepEqual(result.features.mappings[0],base.mappings[0]);assert.deepEqual(result.features.features[0],base.features[0]);
 const rejected=change(base,{op:'review',id:'notify-entry',decision:'rejected'}),b=createAgentApi(g,rejected),bad=draft();
 Object.assign(bad,{...b.overview().proposalHeader,features:[],mappings:draft().mappings,checks:draft().checks});
 bad.batchId='try-again';bad.mappings[0].id='bypass';bad.mappings[0].role='support';
 expectCode(()=>b.propose(bad,'agent'),'EXISTING_MAPPING');assert.equal(rejected.mappings[0].decision,'rejected');
});
test('existing feature names/IDs cannot be overwritten or duplicated under a new ID',()=>{
 const base=api.propose(draft(),'fixture',fixed).features,a=createAgentApi(g,base),p=draft();
 p.expectedRevision=base.revision;p.baseDigest=digest(base);p.features[0].id='new-id';
 expectCode(()=>a.propose(p,'agent'),'EXISTING_FEATURE');
});
test('a stale or unversioned annotation basis must be migrated outside the proposal channel',()=>{
 const changed=structuredClone(g);changed.project.snapshot='f'.repeat(64);
 expectCode(()=>createAgentApi(changed,empty).propose(draft(),'agent'),'STALE_BASE');
 const legacy=structuredClone(g);delete legacy.project.analysisRevision;
 assert.equal(createAgentApi(legacy).overview().basis.analysisRevision,null);
 expectCode(()=>createAgentApi(legacy).propose(draft(),'agent'),'STALE_BASE');
});
test('CLI help and read output are machine readable with no target commands',()=>{
 assert.equal(cli('--help').status,0);const p=cli('inspect',gf,n.id,'--source-limit','10');
 assert.equal(p.status,0,p.stderr);assert.equal(JSON.parse(p.stdout).data.source.nextOffset,10);assert.equal(p.stderr,'');
});
test('CLI unknown flags, negative budgets and invalid JSON produce actionable JSON errors',()=>{
 for(const args of [['inspect',gf,n.id,'--limit','-1'],['overview',gf,'--actor-kind','manual'],['review',gf,'id']]){
  const r=cli(...args);assert.equal(r.status,1);assert.ok(JSON.parse(r.stderr).error.hint);assert.equal(r.stdout,'');
 }
});
test('CLI query output refuses files and symlinks already present',()=>{
 const before=fs.readFileSync(pf);const r=cli('overview',gf,'--out',pf);assert.equal(r.status,1);
 assert.equal(JSON.parse(r.stderr).error.code,'EEXIST');assert.deepEqual(fs.readFileSync(pf),before);
});
test('CLI submission is append-only, report-safe, repeat-output-safe and leaves input untouched',()=>{
 const input=fs.readFileSync(gf),p=draft();p.features[0].title='</script><script>globalThis.pwned=1</script>';
 const file=path.join(dir,'injection-proposal.json');fs.writeFileSync(file,JSON.stringify(p));const out=path.join(dir,'submit');
 const r=cli('submit',gf,file,'--author','agent trial','--out',out);assert.equal(r.status,0,r.stderr);
 assert.deepEqual(fs.readFileSync(gf),input);assert.equal(JSON.parse(fs.readFileSync(path.join(out,'features.json'))).mappings[0].decision,'proposed');
 assert.ok(!fs.readFileSync(path.join(out,'index.html'),'utf8').includes('<script>globalThis.pwned=1</script>'));
 assert.ok(fs.existsSync(path.join(out,'receipt.json')));assert.equal(cli('submit',gf,file,'--author','agent','--out',out).status,1);
});
test('a mixed valid/invalid batch never publishes partial output',()=>{
 const bad=draft();bad.checks[1].quote='invented';const file=path.join(dir,'bad.json'),out=path.join(dir,'bad-submission');fs.writeFileSync(file,JSON.stringify(bad));
 const r=cli('submit',gf,file,'--author','agent','--out',out);assert.equal(r.status,1);assert.ok(!fs.existsSync(out));
});
test('CLI check has the same programmatic validation as submit but writes no feature map',()=>{
 const r=cli('check',gf,pf,'--author','agent');assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).data.valid,true);
});

test('membership pagination is traversable rather than repeating the first page',()=>{
 let base=api.propose(draft(),'fixture',fixed).features;
 base=change(base,{op:'feature',feature:{id:'shared',title:'Shared capability',description:'An explicit second association.',questions:[]}});
 base=change(base,{op:'mapping',id:'shared-notify',featureId:'shared',nodeId:n.id,role:'support',rationale:'Shared guard.',relationIds:[]});
 const a=createAgentApi(g,base), first=a.inspect(n.id,{limit:1}).memberships;
 const next=a.inspect(n.id,{offset:first.nextOffset,limit:1}).memberships;
 assert.equal(first.total,2);assert.equal(first.nextOffset,1);assert.equal(next.nextOffset,null);
 assert.notEqual(first.items[0].id,next.items[0].id);
});
test('relations without origin records still reject invalid pagination',()=>{
 const plain=g.relations.find(e=>!e.evidence.valueOrigins);
 expectCode(()=>api.relation(plain.id,0,51),'INVALID_BUDGET');
});
