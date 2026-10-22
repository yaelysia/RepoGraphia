// Explicitly authored hierarchy and code associations; no sample program is executed.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {fixture as sceneFixture} from './feature-scene.mjs';
import {createFeatureMapApi} from '../../dist/feature-map.js';
import {renderHtml} from '../../dist/report.js';

export const chain = [
  {id:'window',title:'窗口显示、停靠与异常恢复的可审阅功能提案'},
  {id:'open',title:'检查显示请求',summary:'核对本次请求是否可以继续'},
  {id:'prepare',title:'准备恢复界面',summary:'整理此次恢复需要的条件'},
  {id:'restore',title:'恢复可见界面',summary:'在允许的范围内恢复界面'},
  {id:'notify',title:'通知本次恢复结果',summary:'将已知结果交给上层查看'},
  {id:'final',title:'最终确认这次可见请求是否仍然有效以及是否需要继续恢复界面',summary:'保留最后确认的边界与疑问'},
];
export const wideTarget = {id:'wide-17',title:'靠后的搜索目标'};

export function fixture() {
  const {graph,doc:base}=sceneFixture(),api=createFeatureMapApi();let doc=base;
  const edit=operation=>{doc=api.edit(graph,doc,operation,{expectedRevision:doc.revision,
    actor:'workbench-fixture',actorKind:'agent',reason:'Hand-authored UI hierarchy, not a runtime trace',at:'2026-10-22T00:00:00.000Z'});};
  edit({op:'feature',feature:{...doc.features[0],summary:'按明确条件处理窗口的显示与恢复'}});
  for(let i=1;i<chain.length;i++) {
    const f=chain[i];
    edit({op:'feature',feature:{...f,parentId:chain[i-1].id,
      description:f.title+'。这是人工编写的层级夹具；父子关系只表示功能包含，不证明运行顺序。',
      questions:i===chain.length-1?['静态关系没有证明这些功能的运行顺序。']:[]}});
    edit({op:'mapping',id:'level-'+f.id,featureId:f.id,nodeId:'scene:0',role:'entry',
      rationale:f.title+'显式关联同一个已索引声明；共享声明不表示这些功能相互调用。',relationIds:['scene:call']});
    edit({op:'mapping',id:'support-'+f.id,featureId:f.id,nodeId:'scene:4',role:'support',
      rationale:'当前层的辅助代码，由夹具明确指定，未自动纳入任何下级调用。',relationIds:[]});
  }
  edit({op:'feature',feature:{id:'skip',parentId:'window',title:'暂不恢复界面',summary:'保留没有实现映射的同级功能',
    description:'这是显式的同级功能，当前还没有关联代码。',questions:[]}});
  return {graph,doc};
}

if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const output=process.argv[2];if(!output)throw new Error('Expected a new workbench fixture directory');
  fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.mkdirSync(output);
  const {graph,doc}=fixture(),write=(name,value)=>fs.writeFileSync(path.join(output,name),value,{flag:'wx'});
  write('workbench.html',renderHtml(graph,doc));
  write('features.json',JSON.stringify(doc,null,2));
  write('fixture.json',JSON.stringify({chain,rootIds:['window','shared'],windowChildren:['open','skip'],wideTarget},null,2));
  const invalid=structuredClone(doc);invalid.features.find(f=>f.id==='window').parentId='final';
  write('invalid-cycle.json',JSON.stringify(invalid));
  const hostile=structuredClone(doc);hostile.features.find(f=>f.id==='window').summary='<img src=x onerror="globalThis.workbenchInjected=1">';
  write('hostile.html',renderHtml(graph,hostile));
  // Keep the wide sibling case separate so it cannot dilute the recursive-navigation fixture.
  const api=createFeatureMapApi();let wide=structuredClone(doc);
  for(let i=0;i<18;i++)wide=api.edit(graph,wide,{op:'feature',feature:{id:'wide-'+i,parentId:'window',
    title:i===17?wideTarget.title:'同层功能 '+String(i+1).padStart(2,'0'),summary:'每个节点都是明确编写的独立同级功能',
    description:'这组夹具检查分页之外的节点能否通过全局搜索定位，不推测功能顺序。',questions:[]}},
    {expectedRevision:wide.revision,actor:'workbench-fixture',actorKind:'agent',reason:'Explicit wide hierarchy search fixture',at:'2026-10-22T00:00:00.000Z'});
  write('wide-hierarchy.html',renderHtml(graph,wide));
}
