// Browser fixture only. Source files and recorded commands are never executed.
import fs from 'node:fs';
import path from 'node:path';
import {ContinuousWorkspace} from '../../dist/workspace.js';
import {startWorkspaceServer} from '../../dist/workspace-server.js';
import {createFeatureMapApi} from '../../dist/feature-map.js';

const [root, directory] = process.argv.slice(2);
if (!root || !directory) throw new Error('Expected a fixture project and an external workspace directory');
const fresh = !fs.existsSync(path.join(directory, 'workspace.json'));
const workspace = new ContinuousWorkspace({root, directory, debounceMs:70, reconcileMs:1000});
await workspace.refresh(true);
if (fresh) {
  const api = createFeatureMapApi(), graph = workspace.getGraph(workspace.state().latestSnapshot);
  let map = workspace.getFeatures();
  const edit = operation => {
    map = api.edit(graph, map, operation, {expectedRevision:map.revision, actor:'Authored browser fixture', actorKind:'manual',
      at:'2026-10-23T00:00:00Z', reason:'Explicit fixed source association; not a development approval or a runtime test.'});
  };
  for (const [id, name, title, summary] of [
    ['f-report','renderReport','导出报告','向调用者返回当前报告'],
    ['f-audit','auditLog','记录日志','构造一条日志内容'],
    ['f-clean','currentStatus','显示状态','返回当前的静态状态'],
  ]) {
    edit({op:'feature', feature:{id, title, summary, description:'浏览器验收夹具给出的功能说明，实际运行行为尚未验证。', questions:['尚无运行验证。']}});
    edit({op:'mapping', id:'m-'+id.slice(2), featureId:id, nodeId:graph.nodes.find(node=>node.kind==='function'&&node.name===name).id,
      role:'implementation', rationale:'人工夹具精确关联当前声明，不推断依赖或执行顺序。', relationIds:[]});
    edit({op:'review', id:'m-'+id.slice(2), decision:'accepted'});
  }
  workspace.saveFeatures(map, workspace.featureDigest);
}
const app = await startWorkspaceServer(workspace);
process.stdout.write(JSON.stringify({url:app.url})+'\n');
let stopping = false;
const stop = () => {if (stopping) return;stopping=true;void app.close().catch(error=>{console.error(error);process.exitCode=1;});};
process.stdin.resume();process.stdin.once('end',stop);
process.once('SIGINT',stop);process.once('SIGTERM',stop);
