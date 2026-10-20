// Deterministic replay of an authored proposal: verifies CLI and evidence, NOT model quality.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createAgentApi } from '../dist/agent.js';

const dir = path.resolve(process.argv[2] ?? '');
assert.ok(process.argv[2], 'Pass the existing pinned-sample report directory');
const graphPath = path.join(dir, 'graph.json'), featurePath = path.join(dir, 'features.json');
const raw = fs.readFileSync(graphPath), baseRaw = fs.readFileSync(featurePath);
const graph = JSON.parse(raw), base = JSON.parse(baseRaw);
assert.equal(graph.project.commit, '490d822a9593d8d4b78a9188dd0daa0ae791eaf6');
assert.equal(graph.project.analysisRevision, 4);
// Match the actual self-trial source files, not just a same-named function.
for (const [file, hash] of Object.entries({
  'electron/desktop-notifications.ts': '2e6a2381441fdc32feebd50f4dc1ff8bab606a2ebe86c933c7896afc14a4516a',
  'electron/main.ts': '277e6902106743e17e931b8eae5b475cc6bf9adcf2a1701af417cbe036d2d924',
  'src/shared/foreground-notification.ts': '334ed02db8fd9c8856472aec0af6f4394933911bc7b3c2c4ae66344a26747408',
})) assert.equal(graph.files.find(f => f.path === file)?.hash, hash, file);
const out = path.join(dir, 'agent-replay'); fs.mkdirSync(out);
const api = createAgentApi(graph, base), frozen = JSON.parse(fs.readFileSync('docs/trials/agent-notification/proposal-v2.json', 'utf8'));
// This re-basing is exclusively for this fixed-input test; production proposals cannot do it.
const proposal = { ...frozen, ...api.overview().proposalHeader, features: frozen.features,
  mappings: frozen.mappings, checks: frozen.checks, unexplored: frozen.unexplored, scope: frozen.scope, batchId: 'ci-frozen-author-replay' };
const proposalPath = path.join(out, 'proposal.json');fs.writeFileSync(proposalPath,JSON.stringify(proposal,null,2));
const runs = [];
function cli(name, args, expected = 0) {
  const argv = ['dist/cli.js', 'agent', ...args, '--features', featurePath];
  const r = spawnSync(process.execPath, argv, {encoding:'utf8',timeout:30000});
  fs.writeFileSync(path.join(out, name + '.stdout.json'), r.stdout);
  fs.writeFileSync(path.join(out, name + '.stderr.json'), r.stderr);
  runs.push({name,argv,status:r.status});
  assert.equal(r.status, expected, r.stderr);
  return JSON.parse(expected === 0 ? r.stdout : r.stderr);
}
const overview = cli('overview',['overview',graphPath]);assert.equal(overview.data.baseDigest,api.overview().baseDigest);
for(const mapping of frozen.mappings) {
  const r=cli(mapping.id,['inspect',graphPath,mapping.nodeId,'--limit','5']);
  assert.equal(r.data.node.id,mapping.nodeId);assert.equal(r.data.source.available,true);
}
const checked=cli('check',['check',graphPath,proposalPath,'--author','ci-frozen-replay']);assert.equal(checked.data.valid,true);
const submitted=path.join(out,'submission');
cli('submit',['submit',graphPath,proposalPath,'--author','ci-frozen-replay','--out',submitted]);
cli('repeat-output',['submit',graphPath,proposalPath,'--author','ci-frozen-replay','--out',submitted],1);
const result=JSON.parse(fs.readFileSync(path.join(submitted,'features.json'),'utf8'));
assert.deepEqual(result.features.slice(0,base.features.length),base.features);
assert.deepEqual(result.mappings.slice(0,base.mappings.length),base.mappings);
assert.deepEqual(result.history.slice(0,base.history.length),base.history);
assert.ok(result.mappings.slice(base.mappings.length).every(m=>m.decision==='proposed'));
assert.equal(result.features.length,5);assert.equal(result.mappings.length,13);
assert.deepEqual(fs.readFileSync(graphPath),raw);assert.deepEqual(fs.readFileSync(featurePath),baseRaw);
const sha=b=>createHash('sha256').update(b).digest('hex');
const summary={protocolVersion:1,kind:'deterministic-frozen-author-replay',modelInvoked:false,addedFeatures:2,addedMappings:7,
  checks:13,graphSha256:sha(raw),baseSha256:sha(baseRaw),preservedBase:true,unchangedGraph:true,runs};
fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(summary,null,2));
console.log(JSON.stringify({...summary,runs:runs.length}));
