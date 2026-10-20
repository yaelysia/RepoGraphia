/** CI-only read-only comparison. Does not run target code or reinterpret snapshot IDs. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createProjectMapApi } from '../dist/project-map.js';
const [beforeFile,afterFile,out] = process.argv.slice(2);
if(!beforeFile||!afterFile||!out)throw new Error('Expected baseline graph, current graph and output path');
const before=JSON.parse(fs.readFileSync(beforeFile,'utf8')),after=JSON.parse(fs.readFileSync(afterFile,'utf8'));
for(const key of ['files','nodes','relations','coverage','diagnostics'])assert.deepEqual(after[key],before[key],key+' must not change for a presentation-only release');
for(const key of ['analysisRevision','compilerVersion','commit','config'])assert.equal(after.project[key],before.project[key]);
// Compiler files live under different analyzer checkout directories, so the
// compiler-input-path-sensitive snapshot IDs need not be equal across checkouts.
const api=createProjectMapApi(),index=api.index(after),original=JSON.stringify(after);
const maps=[{}, {showTests:true}, {scope:'src'}, {scope:'src/renderer'}, {scope:'electron'}, {scope:'collector'}]
  .map(options=>api.project(index,options));
for(const map of maps){assert.equal(map.snapshot,after.project.snapshot);assert.ok(map.groups.length<=12);assert.ok(map.links.length<=24);}
assert.equal(JSON.stringify(after),original);
const result={projectionRevision:api.revision,analysisRevision:after.project.analysisRevision,
  identicalFiles:true,identicalNodes:true,identicalRelations:true,identicalCoverage:true,identicalDiagnostics:true,
  beforeSnapshot:before.project.snapshot,afterSnapshot:after.project.snapshot,maps};
fs.writeFileSync(out,JSON.stringify(result,null,2));
console.log(JSON.stringify({projectionRevision:api.revision,unchangedAnalysis:true,rootGroups:maps[0].summary.groups,rootLinks:maps[0].summary.links},null,2));
