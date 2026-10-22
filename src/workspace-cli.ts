import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { ContinuousWorkspace } from './workspace.js';
import { startWorkspaceServer } from './workspace-server.js';

const help = `RepoGraphia — continuous local workspace

  node dist/cli.js workspace <repository> --out <workspace-directory> [--project tsconfig.json] [--port 0]
  node dist/cli.js workspace <repository> --out <new-workspace-directory> --features <matching-features.json>

Open the printed local URL in your browser. Repeat the same command to reopen saved versions and reviews.
The workspace directory must be outside the analyzed project. It stores full indexed source snapshots.
Only saved files are observed. The analyzer performs checked full rebuilds; it never runs target code or AI.
The current reading version stays pinned until you choose to switch. Ctrl+C closes this local service.
`;

export async function runWorkspaceCli(args: string[]): Promise<void> {
  const { positionals, values } = parseArgs({ args, allowPositionals: true, options: {
    out: { type: 'string' }, project: { type: 'string' }, features: { type: 'string' }, port: { type: 'string' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) { console.log(help); return; }
  if (positionals.length !== 1 || !values.out) throw new Error('workspace requires one repository and --out workspace-directory');
  const port = values.port === undefined ? 0 : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('--port must be an integer between 0 and 65535');
  const workspace = new ContinuousWorkspace({ root: positionals[0]!, directory: values.out, project: values.project,
    features: values.features ? JSON.parse(fs.readFileSync(values.features, 'utf8')) : undefined });
  try {
    const app = await startWorkspaceServer(workspace, { port });
    console.log(`RepoGraphia 持续工作区\n${app.url}\n\n已绑定：${workspace.root}\n保存位置：${workspace.directory}\n只观察已保存文件；按 Ctrl+C 关闭。`);
    let stopping = false;
    const close = () => { if (stopping) return; stopping = true; void app.close().catch(error => { console.error(String(error)); process.exitCode = 1; }); };
    process.once('SIGINT', close); process.once('SIGTERM', close);
  } catch (error) { await workspace.close(); throw error; }
}
