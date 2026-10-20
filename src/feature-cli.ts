import fs from 'node:fs';
import path from 'node:path';
import { createFeatureMigrationApi } from './feature-migration.js';
import { createFeatureMapApi } from './feature-map.js';
import { renderHtml } from './report.js';
import type { CodeGraph } from './model.js';
import type { FeatureEdit } from './feature-map.js';

/** Sidecar-only operations: never overwrite an input, existing file or symlink. */
export function runFeatureCli(args: string[], flags: Record<string, string | boolean | undefined>): number {
  const [op, graphFile] = args;
  const migration = op === 'plan' || op === 'migrate', mapFile = args[migration ? 3 : 2];
  if (!graphFile || !['init','check','edit','render','plan','migrate'].includes(op!) || args.length !== (migration ? 4 : op === 'init' ? 2 : 3))
    throw new Error('features init <graph> | check|edit|render <graph> <features.json> | plan|migrate <old-graph> <new-graph> <features.json>');
  const allowed = new Set(op === 'check' ? [] : (op === 'edit' || op === 'migrate') ? ['out','patch','author','actor-kind','expected-revision'] : ['out']);
  for (const k of Object.keys(flags)) if (!allowed.has(k)) throw new Error('Unsupported features option: --' + k);
  const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));
  const graph = read(graphFile) as CodeGraph, api = createFeatureMapApi();
  if (graph.schemaVersion !== 1 || !Array.isArray(graph.nodes) || !Array.isArray(graph.files) || !Array.isArray(graph.relations))
    throw new Error('Unsupported graph schema');
  const write = (value: string) => {
    if (typeof flags.out !== 'string') throw new Error('--out is required');
    const dest = path.resolve(flags.out);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, value, {encoding:'utf8', flag:'wx'});
    console.log(JSON.stringify({output:dest, overwroteExisting:false}));
  };
  if (op === 'init') { write(JSON.stringify(api.create(graph),null,2)); return 0; }
  const map = api.validate(read(mapFile!));
  if (migration) {
    const next = read(args[2]!) as CodeGraph, migrationApi = createFeatureMigrationApi(api);
    if (op === 'plan') { write(JSON.stringify(migrationApi.plan(graph,next,map),null,2)); return 0; }
    if (typeof flags.patch !== 'string' || typeof flags.author !== 'string' || flags['actor-kind'] !== 'manual' ||
        typeof flags['expected-revision'] !== 'string' || !/^\d+$/.test(flags['expected-revision']))
      throw new Error('migrate requires --patch, --author, --actor-kind manual and --expected-revision');
    const patch = read(flags.patch);
    if (!patch || typeof patch.reason !== 'string' || Object.keys(patch).some(k=>!['reason','sourceRevision','from','to','actions'].includes(k)))
      throw new Error('Migration patch requires reason, sourceRevision, from, to and actions');
    const {reason, ...request} = patch;
    const updated = migrationApi.apply(graph,next,map,request,{expectedRevision:Number(flags['expected-revision']),
      actor:flags.author,actorKind:'manual',at:new Date().toISOString(),reason});
    write(JSON.stringify(updated,null,2)); return 0;
  }
  if (op === 'check') {
    const result=api.assess(graph,map); console.log(JSON.stringify(result,null,2));
    return result.summary.stale || result.globalIssues.length ? 2 : 0;
  }
  if (op === 'render') { write(renderHtml(graph,map)); return 0; }
  if (typeof flags.patch !== 'string' || typeof flags.author !== 'string' || typeof flags['expected-revision'] !== 'string' ||
      !['manual','agent'].includes(String(flags['actor-kind'])))
    throw new Error('edit requires --patch, --author, --actor-kind manual|agent and --expected-revision');
  const patch=read(flags.patch);
  if (!patch || typeof patch.reason !== 'string' || !patch.operation || Object.keys(patch).some(k=>!['reason','operation'].includes(k)))
    throw new Error('Patch must contain reason and operation only');
  const updated=api.edit(graph,map,patch.operation as FeatureEdit,{expectedRevision:Number(flags['expected-revision']),
    actor:flags.author,actorKind:flags['actor-kind'] as 'manual'|'agent',at:new Date().toISOString(),reason:patch.reason});
  write(JSON.stringify(updated,null,2));return 0;
}
