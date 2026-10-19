/** Validation-only comparison. Both graph files must come from the SAME source/type setup. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { CALL_KINDS } from '../dist/model.js';
const [beforePath, afterPath, out] = process.argv.slice(2);
if (!beforePath || !afterPath || !out) throw new Error('Expected baseline.json current.json output.json');
const before = JSON.parse(fs.readFileSync(beforePath, 'utf8'));
const after = JSON.parse(fs.readFileSync(afterPath, 'utf8'));
assert.equal(before.project.compilerVersion, after.project.compilerVersion, 'Compiler versions must match');
const inputs = g => g.files.map(f => [f.path,f.hash]).sort(([a],[b])=>a.localeCompare(b));
assert.deepEqual(inputs(before), inputs(after), 'Indexed source snapshots must match');
const ledger = g => new Map(g.relations.filter(e => CALL_KINDS.has(e.kind)).map(e => {
  const l=e.evidence.location; return [`${e.kind}:${l.file}:${l.start}:${l.end}`, e];
}));
const old = ledger(before), next = ledger(after);
assert.equal(old.size,before.coverage.syntaxCalls,'Baseline callsite ledger must not collapse entries');
assert.equal(next.size,after.coverage.syntaxCalls,'Current callsite ledger must not collapse entries');
assert.deepEqual([...old.keys()].sort(),[...next.keys()].sort(),'Explicit callsites must not disappear to improve counts');
const transitions=new Map();
for (const [key,e] of next) {
  const previous=old.get(key);if(previous.status===e.status) continue;
  const transition=`${previous.status} -> ${e.status}`;
  const entry=transitions.get(transition)??{transition,count:0,examples:[]};entry.count++;
  if(entry.examples.length<5) entry.examples.push({location:e.evidence.location,label:e.targetLabel,
    beforeRule:previous.evidence.rule,afterRule:e.evidence.rule,reason:e.evidence.reason??null});
  transitions.set(transition,entry);
}
const result={sourceCommit:after.project.commit,compiler:after.project.compilerVersion,
  beforeAnalysisRevision:before.project.analysisRevision??null,afterAnalysisRevision:after.project.analysisRevision??null,
  beforeSnapshot:before.project.snapshot,afterSnapshot:after.project.snapshot,
  identicalIndexedSources:true,identicalExplicitCallsites:true,totalCallsites:next.size,
  before:before.coverage.callsByStatus,after:after.coverage.callsByStatus,
  transitions:[...transitions.values()].map(g=>({...g,omittedExamples:Math.max(0,g.count-g.examples.length)})),
  limitation:'Same CI sample directory and installed type dependencies; declaration provenance is not runtime proof. External reclassification is not a new project implementation target or measured precision gain.'};
fs.writeFileSync(out,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
