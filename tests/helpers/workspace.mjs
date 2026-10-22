// Local browser fixture only: observe these authored source files; never execute them.
import {ContinuousWorkspace} from '../../dist/workspace.js';
import {startWorkspaceServer} from '../../dist/workspace-server.js';

const [root, directory] = process.argv.slice(2);
if (!root || !directory) throw new Error('Expected fixture repository and workspace directory');
const workspace = new ContinuousWorkspace({root,directory,debounceMs:70,reconcileMs:1000});
const app = await startWorkspaceServer(workspace);
process.stdout.write(JSON.stringify({url:app.url})+'\n');
let stopping = false;
const stop = () => {if (stopping) return;stopping=true;void app.close().catch(error=>{console.error(error);process.exitCode=1;});};
process.stdin.resume();process.stdin.once('end',stop);
process.once('SIGINT',stop);process.once('SIGTERM',stop);
