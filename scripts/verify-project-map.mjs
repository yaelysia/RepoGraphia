/** CI-only read-only comparison. Does not run target code or reinterpret snapshot IDs. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { createProjectMapApi } from '../dist/project-map.js';
const [beforeFile,afterFile,out] = process.argv.slice(2);
if(!beforeFile||!afterFile||!out)throw new Error('Expected baseline graph, current graph and output path');
const before=JSON.parse(fs.readFileSync(beforeFile,'utf8')),after=JSON.parse(fs.readFileSync(afterFile,'utf8'));
for(const key of ['files','nodes','coverage','diagnostics'])assert.deepEqual(after[key],before[key],key+' must not change in this same-source analysis comparison');
for(const key of ['analysisRevision','compilerVersion','commit','config'])assert.equal(after.project[key],before.project[key]);
// Input capture revision 1 also records failed lookups/configuration queries,
// changing snapshot hashes. Relation IDs include the compiler traversal's global
// sequence, so another traversal can change IDs/order without changing facts.
// These IDs are snapshot-local, not source facts. Keep EVERY other field and
// duplicate record; equality here is not a cross-snapshot identity mapping.
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)
  ?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const relationFacts=graph=>graph.relations.map(({id,...facts})=>({key:canonical(facts),facts}))
  .sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0).map(item=>item.facts);
assert.deepEqual(relationFacts(after),relationFacts(before),'Full relation facts and multiplicity must not change');
// Compiler paths also differ between analyzer checkouts. Preserve both actual
// snapshot references; never rewrite either one to make this comparison pass.
const api=createProjectMapApi(),index=api.index(after),original=JSON.stringify(after);
api.index(before); // Both inputs must retain valid, unique snapshot-local IDs.
const maps=[{}, {showTests:true}, {scope:'src'}, {scope:'src/renderer'}, {scope:'electron'}, {scope:'collector'}]
  .map(options=>api.project(index,options));
for(const map of maps){assert.equal(map.snapshot,after.project.snapshot);assert.ok(map.groups.length<=12);assert.ok(map.links.length<=24);}
assert.equal(JSON.stringify(after),original);
const result={projectionRevision:api.revision,analysisRevision:after.project.analysisRevision,
  identicalFiles:true,identicalNodes:true,identicalRelations:isDeepStrictEqual(after.relations,before.relations),
  identicalRelationFacts:true,relationComparison:'All fields except snapshot-local relation ID; array order ignored; duplicate records retained.',
  identicalCoverage:true,identicalDiagnostics:true,
  beforeSnapshot:before.project.snapshot,afterSnapshot:after.project.snapshot,maps};
fs.writeFileSync(out,JSON.stringify(result,null,2));
console.log(JSON.stringify({projectionRevision:api.revision,unchangedAnalysis:true,rootGroups:maps[0].summary.groups,rootLinks:maps[0].summary.links},null,2));
