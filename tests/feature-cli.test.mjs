import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {analyze} from '../dist/analyze.js';
import {createFeatureMapApi} from '../dist/feature-map.js';
import {renderHtml,safeJson} from '../dist/report.js';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'repographia-feature-cli-'));after(()=>fs.rmSync(dir,{recursive:true,force:true}));
const source=path.join(dir,'src');fs.mkdirSync(source);fs.writeFileSync(path.join(source,'a.ts'),'export function f(){return 1;}');
const graph=analyze(source),file=path.join(dir,'graph.json'),mapFile=path.join(dir,'features.json');fs.writeFileSync(file,JSON.stringify(graph));
const cli=(...args)=>spawnSync(process.execPath,['dist/cli.js','features',...args],{encoding:'utf8'});
const api=createFeatureMapApi();let map=api.create(graph);
const ctx={expectedRevision:0,actor:'fixture',actorKind:'agent',at:'2026-10-20T00:00:00Z',reason:'fixture'};
map=api.edit(graph,map,{op:'feature',feature:{id:'f',title:'</script><script>globalThis.pwned=1</script>',description:'test',questions:[]}},ctx);
map=api.edit(graph,map,{op:'mapping',id:'m',featureId:'f',nodeId:graph.nodes.find(n=>n.name==='f').id,role:'implementation',rationale:'source evidence',relationIds:[]},{...ctx,expectedRevision:1});
fs.writeFileSync(mapFile,JSON.stringify(map));
test('features CLI creates an empty sidecar and refuses to overwrite it',()=>{
 const dest=path.join(dir,'empty.json');assert.equal(cli('init',file,'--out',dest).status,0);
 assert.equal(JSON.parse(fs.readFileSync(dest)).features.length,0);assert.notEqual(cli('init',file,'--out',dest).status,0);
});
test('features check returns nonzero for stale evidence rather than silent success',()=>{
 assert.equal(cli('check',file,mapFile).status,0);
 const changed=structuredClone(graph);changed.project.snapshot='f'.repeat(64);const bad=path.join(dir,'changed.json');fs.writeFileSync(bad,JSON.stringify(changed));
 assert.equal(cli('check',bad,mapFile).status,2);
});
test('features edit records a human correction and enforces the optimistic revision',()=>{
 const patch=path.join(dir,'patch.json'),out=path.join(dir,'edited.json');fs.writeFileSync(patch,JSON.stringify({reason:'Not relevant',operation:{op:'review',id:'m',decision:'rejected'}}));
 const args=['edit',file,mapFile,'--patch',patch,'--author','reviewer','--actor-kind','manual','--out',out];
 assert.notEqual(cli(...args,'--expected-revision','0').status,0);assert.ok(!fs.existsSync(out));
 assert.equal(cli(...args,'--expected-revision','2').status,0);
 assert.equal(JSON.parse(fs.readFileSync(out)).history.at(-1).actorKind,'manual');assert.equal(JSON.parse(fs.readFileSync(mapFile)).revision,2);
});
test('HTML safely embeds proposed semantics and old graphs do not receive invented annotations',()=>{
 const html=renderHtml(graph,map);assert.ok(html.includes(safeJson(map)));
 assert.ok(!html.includes('<script>globalThis.pwned=1</script>'));
 assert.ok(renderHtml(graph).includes('id="feature-data" type="application/json">null</script>'));
});
test('features render writes one offline report, not a modified source graph',()=>{
 const before=fs.readFileSync(file,'utf8'),out=path.join(dir,'features.html');assert.equal(cli('render',file,mapFile,'--out',out).status,0);
 assert.ok(fs.readFileSync(out,'utf8').includes('feature-view'));assert.equal(fs.readFileSync(file,'utf8'),before);
 assert.notEqual(cli('render',file,mapFile,'--out',file).status,0);assert.equal(fs.readFileSync(file,'utf8'),before);
});
