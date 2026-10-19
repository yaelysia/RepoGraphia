import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'repographia-cli-'));
const root=path.join(temp,'input'); fs.mkdirSync(root);
fs.writeFileSync(path.join(root,'main.ts'),'export function leaf(){} export function entry(){leaf()}');
const cli=path.resolve('dist/cli.js');
const run=(...args)=>spawnSync(process.execPath,[cli,...args],{encoding:'utf8',timeout:20000});
after(()=>fs.rmSync(temp,{recursive:true,force:true}));
test('CLI creates portable HTML and machine-readable graph without modifying input',()=>{
  const before=fs.readdirSync(root); const out=path.join(temp,'report');
  const result=run('analyze',root,'--out',out); assert.equal(result.status,0,result.stderr);
  assert.ok(fs.existsSync(path.join(out,'index.html'))); assert.deepEqual(fs.readdirSync(root),before);
  const query=run('query',path.join(out,'graph.json'),'callees','entry'); assert.equal(query.status,0,query.stderr);
  assert.ok(JSON.parse(query.stdout).nodes.some(n=>n.name==='leaf'));
});
test('CLI rejects output in source directory',()=>{
  const result=run('analyze',root,'--out',path.join(root,'reports')); assert.equal(result.status,1);
  assert.match(result.stderr,/outside/); assert.ok(!fs.existsSync(path.join(root,'reports')));
});
test('CLI requires explicit output path and validates commands',()=>{
  assert.equal(run('analyze',root).status,1);
  assert.equal(run('not-a-command').status,1);
  assert.equal(run('--help').status,0);
});
test('CLI preserves pre-existing symlink output', {skip: process.platform==='win32' ? 'requires symlink privilege' : false},()=>{
  const out=path.join(temp,'unsafe'); fs.mkdirSync(out);
  const victim=path.join(temp,'victim.txt'); fs.writeFileSync(victim,'preserve me');
  fs.symlinkSync(victim,path.join(out,'graph.json'));
  assert.equal(run('analyze',root,'--out',out).status,1); assert.equal(fs.readFileSync(victim,'utf8'),'preserve me');
});
