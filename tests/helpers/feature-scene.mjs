// Hand-authored UI fixture. It describes indexed source; it never executes target code.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {graph as seed} from './report-line-endings.mjs';
import {createFeatureMapApi} from '../../dist/feature-map.js';
import {renderHtml} from '../../dist/report.js';
export function fixture() {
 const graph=structuredClone(seed),hash=text=>createHash('sha256').update(text).digest('hex');
 const source='export class WindowController {\n show() { return true; }\n hide() { return false; }\n}\n';
 graph.files.push({path:'ui/window.ts',source,hash:hash(source),lines:5});
 const location={file:'ui/window.ts',start:0,end:source.length,line:1,column:1,endLine:5,endColumn:1};
 graph.nodes.push({id:'file:ui/window.ts',name:'ui/window.ts',kind:'file',parent:null,location,snippet:source,hasBody:true},
  {id:'class:window',name:'WindowController',kind:'class',parent:'file:ui/window.ts',location,snippet:source,hasBody:false});
 for(let i=0;i<34;i++)graph.nodes.push({id:'scene:'+i,name:i===0?'show':i===1?'<callback:2:4>':'part'+i,
  kind:i===1?'function':'method',parent:i===1?'scene:0':'class:window',location,snippet:source,hasBody:true});
 graph.relations.push({...graph.relations[0],id:'scene:call',from:'scene:0',targets:['scene:4'],status:'candidate'},
  {...graph.relations[0],id:'scene:callback-only',from:'scene:0',targets:['scene:5'],kind:'callback'});
 const api=createFeatureMapApi();let doc=api.create(graph);
 const edit=op=>{doc=api.edit(graph,doc,op,{expectedRevision:doc.revision,actor:'fixture',actorKind:'agent',reason:'Explicit UI test fixture',at:'2026-10-21T00:00:00.000Z'});};
 edit({op:'feature',feature:{id:'window',title:'窗口显示、停靠与异常恢复的可审阅功能提案',description:'先满足可见条件再请求显示。隐藏或退出时不自动恢复。完整说明仅在阅读区出现。'.repeat(8),questions:['回调执行顺序未由静态关系证明。']}});
 edit({op:'feature',feature:{id:'shared',title:'共享代码的另一项功能',description:'共享实体不表示功能调用。',questions:[]}});
 for(let i=0;i<34;i++)edit({op:'mapping',id:'m'+i,featureId:'window',nodeId:'scene:'+i,
  role:i<4?'entry':i<11?'implementation':i<32?'support':'test',rationale:'这是映射 '+i+' 的完整关联理由。',relationIds:i===0?['scene:call']:[]});
 edit({op:'mapping',id:'shared-code',featureId:'shared',nodeId:'scene:0',role:'support',rationale:'明确共享同一实体，不添加功能依赖。',relationIds:[]});
 doc=api.edit(graph,doc,{op:'review',id:'m10',decision:'rejected'},{expectedRevision:doc.revision,actor:'fixture-reviewer',actorKind:'manual',reason:'Test rejection',at:'2026-10-21T00:00:00.000Z'});
 return {graph,doc};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
 const root=process.argv[2];if(!root)throw new Error('Expected new fixture directory');fs.mkdirSync(root,{recursive:true});
 const {graph,doc}=fixture(),write=(name,g,d)=>fs.writeFileSync(path.join(root,name),renderHtml(g,d));
 write('features.html',graph,doc);write('empty.html',graph);
 const stale=structuredClone(graph);stale.project.snapshot='0'.repeat(64);write('stale.html',stale,doc);
 const hostile=structuredClone(doc);hostile.features[0].title='<img src=x onerror="globalThis.featureInjected=1">';write('hostile.html',graph,hostile);
 fs.writeFileSync(path.join(root,'features.json'),JSON.stringify(doc,null,2));
}
