// Authored browser fixture: analyze source text and seed explicit proposals; never execute the target.
import {ContinuousWorkspace} from '../../dist/workspace.js';
import {startWorkspaceServer} from '../../dist/workspace-server.js';
import {createFeatureMapApi} from '../../dist/feature-map.js';

const [root, directory] = process.argv.slice(2);
if (!root || !directory) throw new Error('Expected fixture project and external workspace directory');
const workspace = new ContinuousWorkspace({root, directory, watch:false, reconcileMs:0, debounceMs:10});
await workspace.refresh(true);
const graph = workspace.getGraph(workspace.state().latestSnapshot), api = createFeatureMapApi();
let document = workspace.getFeatures();
for (const [name, title] of [['entry','调度候选回调'], ['support','准备辅助内容']]) {
  const node = graph.nodes.find(item => item.kind === 'function' && item.name === name);
  if (!node) throw new Error('Missing fixture declaration: '+name);
  const edit = operation => {document = api.edit(graph, document, operation, {
    expectedRevision:document.revision, actor:'browser fixture', actorKind:'agent',
    reason:'Explicit source fixture; runtime behavior remains unverified.', at:'2026-10-23T00:00:00Z',
  });};
  edit({op:'feature', feature:{id:'f-'+name, title, summary:'仅解释固定源码中的声明与候选依据。',
    description:'测试夹具的有限功能提案，调用和实际运行结果仍需人工核对。', questions:['未运行目标程序。']}});
  const relationIds = graph.relations.filter(item => item.from === node.id).map(item => item.id);
  if (name === 'entry' && !graph.relations.some(item => item.from === node.id && item.status === 'candidate'))
    throw new Error('The real analyzer fixture must retain a candidate call.');
  edit({op:'mapping', id:'m-'+name, featureId:'f-'+name, nodeId:node.id, role:'entry',
    rationale:'明确关联此声明；候选调用不会被升级为确定运行。', relationIds});
  // The second mapped feature must land beyond the first twelve-card page.
  if (name === 'entry') for (let index=1; index<=11; index++) edit({op:'feature', feature:{
    id:'f-unmapped-'+index, title:'待建立依据 '+index, description:'分页显示夹具；没有关联代码，不推测实现。', questions:[],
  }});
}
workspace.saveFeatures(document, workspace.featureDigest);
const app = await startWorkspaceServer(workspace, {start:false});
process.stdout.write(JSON.stringify({url:app.url})+'\n');
let stopping = false;
const stop = () => {if (stopping) return;stopping=true;void app.close().catch(error=>{console.error(error);process.exitCode=1;});};
process.stdin.resume();process.stdin.once('end',stop);
process.once('SIGINT',stop);process.once('SIGTERM',stop);
