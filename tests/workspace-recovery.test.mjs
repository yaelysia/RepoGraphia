import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { analyze } from '../dist/analyze.js';
import { checkAnalysisInputs } from '../dist/project.js';
import { ContinuousWorkspace } from '../dist/workspace.js';

function capture(root, project) {
  let inputs;
  const graph=analyze(root,{project,includeSource:true,onInputs:value=>{inputs=value;}});
  return {graph,inputs};
}
function fixture(t) {
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'repographia-recovery-'));
  const root=path.join(temporary,'project'),directory=path.join(temporary,'workspace');
  const config='selected.tsconfig.json',opened=[];
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root,config),JSON.stringify({compilerOptions:{noLib:true},include:['*.ts']}));
  fs.writeFileSync(path.join(root,'entry.ts'),'export function run() { return 1; }\n');
  const options={root,directory,project:config,watch:false,reconcileMs:0,debounceMs:0};
  const open=(dependencies={})=>{
    const workspace=new ContinuousWorkspace(options,{analyze:async(root,project)=>capture(root,project),...dependencies});
    opened.push(workspace);return workspace;
  };
  t.after(async()=>{for(const workspace of opened)await workspace.close();fs.rmSync(temporary,{recursive:true,force:true});});
  return {root,directory,config,open,options,manifest:path.join(directory,'workspace.json'),lock:path.join(directory,'workspace.lock'),guard:path.join(directory,'workspace-acquire.lock')};
}
const missingProcess=()=>Object.assign(new Error('fixture process has exited'),{code:'ESRCH'});

test('a deleted selected config does not prevent reopening saved maps; refresh reports the missing input',async t=>{
  const setup=fixture(t),workspace=setup.open();
  const original=await workspace.refresh(true);
  const manifest=fs.readFileSync(setup.manifest,'utf8');
  const graph=workspace.getGraph(original.id);
  await workspace.close();
  fs.unlinkSync(path.join(setup.root,setup.config));
  const reopened=setup.open();
  assert.deepEqual(reopened.getGraph(original.id),graph);
  await assert.rejects(reopened.refresh(),/ENOENT|no such file|config/i);
  assert.equal(reopened.state().status,'error');assert.equal(reopened.state().latestSnapshot,original.id);
  assert.deepEqual(reopened.getGraph(original.id),graph);
  assert.equal(fs.readFileSync(setup.manifest,'utf8'),manifest);
});

test('a damaged published snapshot cannot be marked current by refresh or overwritten during rebuild',async t=>{
  const setup=fixture(t),workspace=setup.open();
  const original=await workspace.refresh(true),file=path.join(setup.directory,'snapshots',original.id+'.json');
  const manifest=fs.readFileSync(setup.manifest,'utf8'),stored=JSON.parse(fs.readFileSync(file,'utf8'));
  stored.graph.nodes[0].name='damaged-record';
  const damaged=JSON.stringify(stored);fs.writeFileSync(file,damaged);
  assert.throws(()=>workspace.getGraph(original.id),/damaged/);
  await assert.rejects(workspace.refresh(),/damaged/);
  assert.equal(workspace.state().status,'error');
  await assert.rejects(workspace.refresh(true),/damaged/);
  assert.equal(workspace.state().status,'error');
  assert.equal(fs.readFileSync(file,'utf8'),damaged);assert.equal(fs.readFileSync(setup.manifest,'utf8'),manifest);
  await workspace.close();
  assert.throws(()=>setup.open(),/damaged/);
  assert.equal(fs.existsSync(setup.lock),false,'a failed reopen must release its own acquisition');
  assert.equal(fs.existsSync(setup.guard),false);
  assert.equal(fs.readFileSync(file,'utf8'),damaged);assert.equal(fs.readFileSync(setup.manifest,'utf8'),manifest);
});

test('a dead PID lock can be recovered while retaining the saved workspace and replacing its owner',async t=>{
  const setup=fixture(t),workspace=setup.open();
  const original=await workspace.refresh(true);await workspace.close();
  const deadPid=2_147_483_000,stale=JSON.stringify({pid:deadPid,nonce:'exited-owner'}),kill=process.kill;
  fs.writeFileSync(setup.lock,stale);
  let inspected=0,reopened;
  try {
    process.kill=(pid,signal)=>{if(pid===deadPid&&signal===0){inspected++;throw missingProcess();}return kill(pid,signal);};
    reopened=setup.open();
  } finally {process.kill=kill;}
  assert.equal(inspected,1);assert.equal(reopened.state().latestSnapshot,original.id);
  const owner=JSON.parse(fs.readFileSync(setup.lock,'utf8'));
  assert.equal(owner.pid,process.pid);assert.notEqual(owner.nonce,'exited-owner');
  assert.equal(fs.existsSync(setup.guard),false);
  assert.equal(reopened.getGraph(original.id).project.snapshot,original.id);
});

test('an exclusive acquisition guard blocks a second opener at the stale-lock removal boundary',async t=>{
  const setup=fixture(t),seed=setup.open();await seed.close();
  const deadPid=2_147_483_001,stale=JSON.stringify({pid:deadPid,nonce:'exited-owner'});
  fs.writeFileSync(setup.lock,stale);
  const unlink=fs.unlinkSync,kill=process.kill;
  let attempts=0,first;
  try {
    process.kill=(pid,signal)=>{if(pid===deadPid&&signal===0)throw missingProcess();return kill(pid,signal);};
    fs.unlinkSync=file=>{
      if(file===setup.lock&&attempts===0){
        attempts++;
        const guard=fs.readFileSync(setup.guard,'utf8');
        assert.throws(()=>setup.open(),error=>error.statusCode===409&&/being opened/.test(error.message));
        assert.equal(fs.readFileSync(setup.guard,'utf8'),guard,'the rejected opener must not remove the first opener guard');
        assert.equal(fs.readFileSync(setup.lock,'utf8'),stale,'the rejected opener must not replace the stale lock itself');
      }
      return unlink(file);
    };
    first=setup.open();
  } finally {fs.unlinkSync=unlink;process.kill=kill;}
  assert.equal(attempts,1);assert.equal(fs.existsSync(setup.guard),false);
  const owner=fs.readFileSync(setup.lock,'utf8');
  assert.equal(JSON.parse(owner).pid,process.pid);
  assert.throws(()=>setup.open(),error=>error.statusCode===409&&/already open/.test(error.message));
  assert.equal(fs.readFileSync(setup.lock,'utf8'),owner);
  await first.close();assert.equal(fs.existsSync(setup.lock),false);
});

test('an interrupted acquisition guard fails closed without deleting either owner record',async t=>{
  const setup=fixture(t),seed=setup.open();await seed.close();
  const lock=JSON.stringify({pid:2_147_483_002,nonce:'old'}),guard=JSON.stringify({pid:2_147_483_003,nonce:'interrupted-recovery'});
  fs.writeFileSync(setup.lock,lock);fs.writeFileSync(setup.guard,guard);
  assert.throws(()=>setup.open(),error=>error.statusCode===409&&/workspace-acquire.lock/.test(error.message));
  assert.equal(fs.readFileSync(setup.lock,'utf8'),lock);assert.equal(fs.readFileSync(setup.guard,'utf8'),guard);
});

test('a closed instance cannot save a view over the next owner task history',async t=>{
  const setup=fixture(t),closed=setup.open();await closed.refresh(true);await closed.close();
  const current=setup.open(),task=await current.beginTask('重开后的任务',current.featureDigest);
  const manifest=fs.readFileSync(setup.manifest,'utf8'),lock=fs.readFileSync(setup.lock,'utf8');
  assert.throws(()=>closed.saveView({snapshot:null,taskId:null}),error=>error.statusCode===409&&/closed/.test(error.message));
  assert.equal(fs.readFileSync(setup.manifest,'utf8'),manifest);assert.equal(fs.readFileSync(setup.lock,'utf8'),lock);
  assert.equal(current.getTask(task.id).title,'重开后的任务');
});

async function unpublished(t) {
  const setup=fixture(t);let checks=0;
  const workspace=setup.open({checkInputs:inputs=>{
    const result=checkAnalysisInputs(inputs);
    return ++checks===2?{current:false,changed:['fixture late edit before publication']}:result;
  }});
  const manifest=fs.readFileSync(setup.manifest,'utf8');
  await assert.rejects(workspace.refresh(true),error=>error.statusCode===409);
  assert.equal(workspace.state().latestSnapshot,null);assert.equal(workspace.state().snapshots.length,0);
  assert.equal(fs.readFileSync(setup.manifest,'utf8'),manifest);
  const files=fs.readdirSync(path.join(setup.directory,'snapshots')).filter(name=>name.endsWith('.json'));
  assert.equal(files.length,1,'the immutable result exists but is not a published version');
  return {...setup,workspace,file:path.join(setup.directory,'snapshots',files[0]),manifestContent:manifest};
}

test('an equivalent complete orphan result is checked before reuse and published once',async t=>{
  const setup=await unpublished(t),content=fs.readFileSync(setup.file,'utf8');
  const original=JSON.parse(content),snapshot=await setup.workspace.refresh(true);
  assert.equal(snapshot.id,original.graph.project.snapshot);assert.equal(setup.workspace.state().status,'current');
  assert.equal(setup.workspace.state().snapshots.length,1);
  assert.equal(fs.readFileSync(setup.file,'utf8'),content,'valid orphan data stays immutable');
  assert.deepEqual(setup.workspace.getGraph(snapshot.id),original.graph);
  assert.match(snapshot.storageDigest,/^[a-f0-9]{64}$/);
});

test('a damaged orphan result is rejected without publishing or replacing its contents',async t=>{
  const setup=await unpublished(t),orphan=JSON.parse(fs.readFileSync(setup.file,'utf8'));
  orphan.graph.files[0].source='tampered unpublished source';
  const damaged=JSON.stringify(orphan);fs.writeFileSync(setup.file,damaged);
  await assert.rejects(setup.workspace.refresh(true),/incomplete|damaged/);
  assert.equal(setup.workspace.state().status,'error');assert.equal(setup.workspace.state().latestSnapshot,null);
  assert.equal(setup.workspace.state().snapshots.length,0);assert.equal(setup.workspace.featureDigest,null);
  assert.equal(fs.readFileSync(setup.file,'utf8'),damaged);
  assert.equal(fs.readFileSync(setup.manifest,'utf8'),setup.manifestContent);
});
