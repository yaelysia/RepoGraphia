import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileKey } from '../dist/project.js';
import { analyze } from '../dist/analyze.js';
import { neighborhood } from '../dist/query.js';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'repographia-regression-'));
after(()=>fs.rmSync(root,{recursive:true,force:true}));
function fixture(name, files) {
  const dir=path.join(root,name); fs.mkdirSync(dir);
  for(const [file,text] of Object.entries(files)) {
    const full=path.join(dir,file); fs.mkdirSync(path.dirname(full),{recursive:true}); fs.writeFileSync(full,text);
  }
  return dir;
}
test('path identities reconcile Windows separators and drive case without folding POSIX case',()=>{
  assert.equal(fileKey('C:\\Repo\\src\\main.ts','win32'),fileKey('c:/Repo/src/main.ts','win32'));
  assert.notEqual(fileKey('/repo/Main.ts','posix'),fileKey('/repo/main.ts','posix'));
});
test('slash paths from compiler configuration bind to native filesystem inventory',()=>{
  const input=fixture('config',{ 'tsconfig.json':JSON.stringify({files:['nested/main.ts']}),
    'nested/main.ts':'export function target() {} target();'});
  const result=analyze(input);
  assert.equal(result.files.length,1); assert.equal(result.coverage.syntaxCalls,1);
  assert.equal(result.coverage.unindexed.length,0);
});
test('indexed sources never appear again as unindexed inventory entries',()=>{
  const input=fixture('inventory',{'main.ts':'export function main() {} main();','worker.py':'print(1)'});
  const result=analyze(input), indexed=new Set(result.files.map(f=>f.path));
  assert.ok(indexed.size>0);
  assert.ok(result.coverage.unindexed.every(f=>!indexed.has(f.path)));
});
test('a tsconfig without allowJs does not silently enable JavaScript indexing',()=>{
  const input=fixture('allowjs',{'tsconfig.json':JSON.stringify({files:['main.ts']}),
    'main.ts':"import { helper } from './helper.js'; helper();",'helper.js':'export function helper(){}'});
  const result=analyze(input);
  assert.ok(!result.files.some(f=>f.path==='helper.js'));
  assert.ok(result.coverage.unindexed.some(f=>f.path==='helper.js'));
});
test('CLI rejects dangling output symlinks without creating their target', {skip: process.platform==='win32' ? 'requires symlink privilege' : false},()=>{
  const input=fixture('input',{'main.ts':'export const value=1'});
  const out=fixture('output',{}), victim=path.join(root,'must-not-be-created.txt');
  fs.symlinkSync(victim,path.join(out,'graph.json'));
  const result=spawnSync(process.execPath,[path.resolve('dist/cli.js'),'analyze',input,'--out',out],{encoding:'utf8',timeout:20000});
  assert.equal(result.status,1,result.stderr); assert.ok(!fs.existsSync(victim));
});

test('incoming queries disclose filtered candidate callers rather than imply absence',()=>{
  const graph={nodes:[{id:'a'},{id:'b'}],relations:[{id:'e',from:'a',targets:['b'],status:'candidate',kind:'call'}]};
  const result=neighborhood(graph,'b',{direction:'in'});
  assert.equal(result.relations.length,0); assert.equal(result.omittedRelations.length,1);
});
test('budgeted subgraphs explicitly disclose endpoints not returned in the node set',()=>{
  const graph={nodes:[{id:'a'},{id:'b'},{id:'c'}],relations:[{id:'e',from:'a',targets:['b','c'],status:'candidate',kind:'call'}]};
  const result=neighborhood(graph,'a',{direction:'out',includeCandidates:true,limit:2});
  assert.equal(result.nodes.length,2); assert.deepEqual(result.boundary.outsideNodeIds,['c']);
  assert.equal(result.boundary.truncated,true);
});
