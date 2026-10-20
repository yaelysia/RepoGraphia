// Real edited-source fixture, not a modified Codex-Monitor or a fabricated runtime trace.
import fs from 'node:fs';
import path from 'node:path';
import {analyze} from '../../dist/analyze.js';
import {createFeatureMapApi} from '../../dist/feature-map.js';
export function migrationFixture(root) {
  fs.mkdirSync(root,{recursive:true});
  const sources = {'stable.ts':'export function keep() { return 1; }\n',
    'changed.ts':'export function change() { return 1; }\n',
    'removed.ts':'export function removed() { return 3; }\n',
    'caller.ts':"import {change} from './changed'; export function caller() { return change(); }\n"};
  for (const [name,text] of Object.entries(sources)) fs.writeFileSync(path.join(root,name),text);
  const before = analyze(root,{includeSource:true}), api=createFeatureMapApi(); let map=api.create(before);
  const ctx = () => ({expectedRevision:map.revision,actor:'authored-migration-fixture',actorKind:'agent',
    at:'2026-10-20T00:00:00Z',reason:'Finite test proposal; not user acceptance'});
  map=api.edit(before,map,{op:'feature',feature:{id:'fixture',title:'迁移验证样例',description:'独立小型源码夹具，包含未改、改动、删除和依赖改动；不是实际项目功能。',questions:[]}},ctx());
  for(const name of ['keep','change','removed','caller']) {
    const n=before.nodes.find(n=>n.name===name&&n.kind==='function');
    map=api.edit(before,map,{op:'mapping',id:name,featureId:'fixture',nodeId:n.id,role:'implementation',
      rationale:'Explicit '+name+' declaration in an independent source fixture',relationIds:before.relations.filter(e=>e.from===n.id).map(e=>e.id)},ctx());
  }
  fs.writeFileSync(path.join(root,'changed.ts'),sources['changed.ts'].replace('return 1','return 2'));
  fs.unlinkSync(path.join(root,'removed.ts'));
  const after=analyze(root,{includeSource:true});
  return {before,after,map};
}
