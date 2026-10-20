// Build explicitly authored, partial proposals. No semantic inference or target execution.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createFeatureMapApi} from '../dist/feature-map.js';
import {renderHtml} from '../dist/report.js';
const [reportDir]=process.argv.slice(2);
if(!reportDir)throw new Error('Expected a generated report directory');
const graph=JSON.parse(fs.readFileSync(path.join(reportDir,'graph.json'),'utf8'));
const plan=JSON.parse(fs.readFileSync(new URL('../examples/codex-monitor-feature-plan.json',import.meta.url),'utf8'));
assert.equal(graph.project.commit,plan.sampleCommit);
const before=JSON.stringify(graph),api=createFeatureMapApi();let map=api.create(graph);
const edit=operation=>{map=api.edit(graph,map,operation,{expectedRevision:map.revision,actor:plan.author,actorKind:'agent',
 at:'2026-10-20T00:00:00.000Z',reason:'Explicit illustrative annotation of pinned source, not human acceptance'});};
for(const feature of plan.features)edit({op:'feature',feature});
for(const item of plan.mappings){
 const matches=graph.nodes.filter(n=>n.location.file===item.file&&n.name===item.name&&n.kind==='function');
 assert.equal(matches.length,1,`Exact sample anchor: ${item.file}:${item.name}`);const node=matches[0];
 const relations=item.callLabel?graph.relations.filter(e=>e.from===node.id&&e.kind==='call'&&e.targetLabel===item.callLabel):[];
 if(item.callLabel)assert.equal(relations.length,1);
 edit({op:'mapping',id:item.id,featureId:item.featureId,nodeId:node.id,role:item.role,rationale:item.rationale,relationIds:relations.map(e=>e.id)});
}
const result=api.assess(graph,map);
assert.equal(result.summary.features,3);assert.equal(result.summary.mappings,6);assert.equal(result.summary.current,6);
assert.equal(result.summary.accepted,0);assert.equal(result.summary.mappedNodes,4);
assert.ok(result.mappings.find(m=>m.mapping.id==='result-wrapper').warnings.includes('evidence-candidate'));
assert.equal(api.forNode(graph,map,map.mappings[0].code.nodeId).length,2);
assert.equal(JSON.stringify(graph),before,'Mapping must never mutate the static graph');
fs.writeFileSync(path.join(reportDir,'features.json'),JSON.stringify(map,null,2));
fs.writeFileSync(path.join(reportDir,'feature-assessment.json'),JSON.stringify(result,null,2));
fs.writeFileSync(path.join(reportDir,'features.html'),renderHtml(graph,map));
fs.writeFileSync(path.join(reportDir,'features-empty-test.html'),renderHtml(graph));
const stale=structuredClone(graph);stale.project.snapshot='0'.repeat(64);
assert.equal(api.assess(stale,map).summary.stale,6);
fs.writeFileSync(path.join(reportDir,'features-stale-test.html'),renderHtml(stale,map));
console.log(JSON.stringify({featureMappingSchema:1,summary:result.summary,unchangedGraph:true,allProposals:true,staleFixture:6}));
