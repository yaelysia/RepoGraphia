import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Format/routing lint is not a measurement of real skill-trigger behavior.
test('Skill has bounded routing metadata and complete relative references',()=>{
 const root='skills/repographia-function-map',skill=fs.readFileSync(path.join(root,'SKILL.md'),'utf8');
 const header=/^---\r?\nname: repographia-function-map\r?\ndescription: [^\r\n]+/;
 assert.match(skill,header);
 const lf=skill.replace(/\r\n/g,'\n');
 assert.match(lf,header);assert.match(lf.replace(/\n/g,'\r\n'),header);
 assert.ok(!header.test(lf.replace('name: repographia-function-map','name: another-skill')));
 assert.ok(!header.test(lf.replace('description: ', 'wrong-field: ')));
 assert.match(skill,/version: "1.1"/);assert.ok(skill.split('\n').length<500);
 for(const [,ref] of skill.matchAll(/\]\((references\/[^)]+)\)/g)) assert.ok(fs.existsSync(path.join(root,ref)));
 for(const required of ['claim table','counterexample','TRIAL.md','not independent','nextOffset','agent submit'])
   assert.ok(skill.includes(required),required);
});
test('frozen self-trial preserves original proposal and concrete revisions rather than self-approval',()=>{
 const dir='docs/trials/agent-notification',a=JSON.parse(fs.readFileSync(path.join(dir,'proposal-v1.json'))),b=JSON.parse(fs.readFileSync(path.join(dir,'proposal-v2.json')));
 assert.deepEqual(a.basis,b.basis);assert.equal(a.baseDigest,b.baseDigest);
 assert.equal(a.features.length,2);assert.equal(b.features.length,2);assert.equal(a.mappings.length,5);assert.equal(b.mappings.length,7);
 assert.equal(a.checks.length,4);assert.equal(b.checks.length,13);
 assert.ok(b.features[0].description.includes('第0个动作按钮')&&b.features[0].description.includes('正文点击'));
 assert.ok(b.features[1].description.includes('抛出异常时放行'));
 assert.ok(b.mappings.every(m=>!('decision' in m)&&!('actorKind' in m)));
});
test('self-trial manifest includes actual bounded queries, failed-free validation and explicit submission',()=>{
 const {runs}=JSON.parse(fs.readFileSync('docs/trials/agent-notification/commands.json'));
 assert.equal(runs.length,25);assert.ok(runs.every(r=>r.exitCode===0&&/^[a-f0-9]{64}$/.test(r.stdoutSha256)));
 assert.ok(runs.some(r=>r.args[0]==='relation'&&r.args.includes('--offset')));
 assert.equal(runs.filter(r=>r.args[0]==='check').length,2);assert.equal(runs.filter(r=>r.args[0]==='submit').length,1);
});
