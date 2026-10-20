// Read-only real-sample relocation plus a separate, genuinely edited tiny source fixture.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createFeatureMapApi} from '../dist/feature-map.js';
import {createFeatureMigrationApi} from '../dist/feature-migration.js';
import {renderHtml} from '../dist/report.js';
import {migrationFixture} from '../tests/helpers/migration-fixture.mjs';
const [oldDir,out]=process.argv.slice(2);if(!oldDir||!out)throw new Error('Expected baseline report and current report directories');
const read=(dir,name)=>JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));
const write=(name,data)=>fs.writeFileSync(path.join(out,name),typeof data==='string'?data:JSON.stringify(data,null,2));
execFileSync(process.execPath,['scripts/verify-feature-map.mjs',oldDir],{stdio:'pipe'});
const old=read(oldDir,'graph.json'),current=read(out,'graph.json'),map=read(oldDir,'features.json');
const oldBytes=JSON.stringify(old),newBytes=JSON.stringify(current),mapBytes=JSON.stringify(map);
const api=createFeatureMapApi(),migration=createFeatureMigrationApi(api),plan=migration.plan(old,current,map);
assert.deepEqual(plan.summary,{reusable:6,needsReview:0,unmatched:0});
assert.equal(api.assess(current,map).summary.stale,6);
write('migration.html',renderHtml(current,map));write('migration-old-graph.json',old);write('migration-old-features.json',map);write('migration-plan.json',plan);
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'repographia-migration-example-'));
try {
 const fixture=migrationFixture(path.join(temp,'source')),p=migration.plan(fixture.before,fixture.after,fixture.map);
 assert.deepEqual(p.summary,{reusable:1,needsReview:2,unmatched:1});
 assert.ok(p.rows.find(r=>r.id==='caller').reasons.includes('changed-static-neighborhood'));
 write('migration-fixture.html',renderHtml(fixture.after,fixture.map));write('migration-fixture-old.json',fixture.before);
 write('migration-fixture-new.json',fixture.after);write('migration-fixture-features.json',fixture.map);write('migration-fixture-plan.json',p);
 write('migration-summary.json',{migrationVersion:1,outputSchema:2,realSample:{scenario:'same indexed sources; analyzer installation paths changed snapshot',...plan.summary},
   editedFixture:{scenario:'separate miniature source: actual edit and removal, never a Codex-Monitor edit',...p.summary},unchangedGraphs:true});
} finally {fs.rmSync(temp,{recursive:true,force:true});}
assert.equal(JSON.stringify(old),oldBytes);assert.equal(JSON.stringify(current),newBytes);assert.equal(JSON.stringify(map),mapBytes);
console.log(JSON.stringify(read(out,'migration-summary.json')));
