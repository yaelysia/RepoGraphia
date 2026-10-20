import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { analyze } from '../dist/analyze.js';
import { createProjectMapApi } from '../dist/project-map.js';
import { renderHtml } from '../dist/report.js';
const graph=analyze(fileURLToPath(new URL('./fixtures/project-map',import.meta.url)),{includeSource:true});
const api=createProjectMapApi(), index=api.index(graph);

test('independent source fixture compiles, and map projection does not modify the code graph',()=>{
  const before=JSON.stringify(graph);assert.equal(graph.diagnostics.length,0);
  api.project(index);api.records(index);renderHtml(graph);assert.equal(JSON.stringify(graph),before);
});
test('source-to-project links match a hand-labelled complete directory matrix',()=>{
  const p=api.project(index);
  assert.deepEqual(p.links.map(l=>[l.from,l.to,l.count]),[
    ['core','types',2],['entry.ts','core',2],['entry.ts','types',1],['entry.ts','ui',2],['ui','core',2],['ui','types',1],
  ]);
  assert.equal(p.summary.relations,12); assert.equal(p.summary.counts.internal,2);
  assert.equal(p.summary.indexedFiles,6);assert.equal(p.summary.unindexedFiles,1);
});
test('source contract and type import cannot collapse into a certain implementation call',()=>{
  const edges=api.records(index,{}, {from:'core',to:'types'}).relations;
  assert.equal(edges.length,2);
  assert.equal(edges.find(e=>e.kind==='import').typeOnly,true);
  const e=edges.find(e=>e.kind==='call');assert.equal(e.status,'candidate');
  const target=graph.nodes.find(n=>n.id===e.targets[0]);assert.equal(target.kind,'signature');assert.equal(target.location.file,'types/job.ts');
});
test('same-named source declarations and unsupported language never acquire inferred links',()=>{
  const p=api.project(index);
  assert.ok(!p.links.some(l=>['idle','scripts'].includes(l.from)||['idle','scripts'].includes(l.to)));
  const record=api.records(index,{scope:'core'},{from:'core/run.ts',to:'core/leaf.ts'}).relations.find(e=>e.kind==='call');
  assert.equal(record.evidence.excerpt,'leaf()');assert.equal(record.evidence.location.line,3);
  assert.equal(graph.nodes.find(n=>n.id===record.targets[0]).location.file,'core/leaf.ts');
});
