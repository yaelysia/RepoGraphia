import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { AGENT_OUTPUT_BYTES, AgentError, createAgentApi } from './agent.js';
import { renderHtml } from './report.js';
import { writeNewBundle } from './output.js';
import type { CodeGraph } from './model.js';
import { runFeatureTaskCli } from './feature-task-cli.js';

const help = `Agent protocol 1 (JSON output; errors are JSON on stderr)
  agent task --help  (workspace task bundles and reviewable revisions)
  agent overview <graph.json> [--features sidecar.json] [--scope directory] [--offset 0 --limit 25]
  agent search <graph.json> <text> [--features sidecar.json] [--scope directory] [--offset 0 --limit 25]
  agent inspect <graph.json> <exact-node-id> [--features sidecar.json] [--offset 0 --limit 25] [--source-offset 0 --source-limit 6000]
  agent relation <graph.json> <exact-relation-id> [--features sidecar.json] [--offset 0 --limit 3]
  agent check <graph.json> <proposal.json> [--features sidecar.json] --author name
  agent submit <graph.json> <proposal.json> [--features sidecar.json] --author name --out NEW-DIRECTORY
Queries/check optionally accept --out NEW-FILE. No existing output is overwritten.
A submit adds proposed annotations only; it cannot review, replace or migrate decisions.
Use skills/repographia-function-map/SKILL.md for exploration, decomposition and recovery.
`;
export function runAgentCli(argv: string[]): number {
  if (argv[0] === 'task') return runFeatureTaskCli(argv.slice(1));
  try {
    const { positionals: a, values: v } = parseArgs({ args: argv, allowPositionals: true, options: {
      features: {type:'string'}, scope: {type:'string'}, offset: {type:'string'}, limit: {type:'string'},
      'source-offset': {type:'string'}, 'source-limit': {type:'string'}, author: {type:'string'},
      out: {type:'string'}, help: {type:'boolean',short:'h'},
    } });
    if (v.help || !a.length) { console.log(JSON.stringify({ok:true,help})); return 0; }
    const [op, graphFile, selector] = a;
    const writing = op === 'submit', proposing = writing || op === 'check';
    if (!['overview','search','inspect','relation','check','submit'].includes(op!) || !graphFile || a.length !== (op === 'overview' ? 2 : 3))
      throw new AgentError('USAGE', 'Invalid agent operation or arguments', help);
    const allowed = ['features','out', ...(proposing ? ['author'] : ['offset','limit']),
      ...(['overview','search'].includes(op!) ? ['scope'] : []), ...(op === 'inspect' ? ['source-offset','source-limit'] : [])];
    for (const k of Object.keys(v)) if (!allowed.includes(k)) throw new AgentError('USAGE', `Unsupported --${k} for ${op}`, help);
    const read = (file: string, max = 128 * 1024 * 1024) => {
      if (!fs.statSync(file).isFile() || fs.statSync(file).size > max) throw new AgentError('INPUT_LIMIT', 'Input is not a bounded regular file', 'Use a CodeGraph <=128 MiB; proposals and sidecars <=5 MiB.');
      return JSON.parse(fs.readFileSync(file,'utf8'));
    };
    const graph = read(graphFile) as CodeGraph;
    const api = createAgentApi(graph, v.features ? read(v.features, 5*1024*1024) : undefined);
    const num = (key: 'offset' | 'limit' | 'source-offset' | 'source-limit') => {
      if (v[key] === undefined) return undefined;
      if (!/^\d+$/.test(v[key]!)) throw new AgentError('INVALID_BUDGET', `Invalid --${key}`, 'Use a nonnegative integer; consult agent --help.');
      return Number(v[key]);
    };
    let data: unknown;
    if (op === 'overview') data = api.overview(v.scope, num('offset'), num('limit'));
    else if (op === 'search') data = api.search(selector!, v.scope, num('offset'), num('limit'));
    else if (op === 'inspect') data = api.inspect(selector!, {offset:num('offset'),limit:num('limit'),sourceOffset:num('source-offset'),sourceLimit:num('source-limit')});
    else if (op === 'relation') data = api.relation(selector!, num('offset'), num('limit'));
    else {
      const proposal = read(selector!,5*1024*1024);
      const result = api.propose(proposal, v.author ?? '');
      if (!writing) data = { ...result.receipt, valid:true,
        mappings: result.assessment.mappings.filter(m=>proposal.mappings.some((p:{id:string})=>p.id===m.mapping.id)).map(m=>({id:m.mapping.id,warnings:m.warnings})) };
      else {
        if (!v.out) throw new AgentError('USAGE', 'submit needs --out NEW-DIRECTORY', help);
        // Validate AND render everything before creating output. Never overwrite an existing directory.
        const bundle: Record<string,string> = { 'proposal.json': JSON.stringify(proposal,null,2),
          'features.json': JSON.stringify(result.features,null,2), 'assessment.json': JSON.stringify(result.assessment,null,2),
          'index.html': renderHtml(graph,result.features), 'receipt.json': JSON.stringify(result.receipt,null,2) };
        // receipt remains last: no receipt means incomplete output after an I/O failure.
        const dest = writeNewBundle(v.out, bundle);
        console.log(JSON.stringify({ok:true,output:dest,report:path.join(dest,'index.html'),receipt:path.join(dest,'receipt.json'),
          addedFeatures:result.receipt.addedFeatures,addedMappings:result.receipt.addedMappings,decision:'proposed',overwroteExisting:false}));
        return 0;
      }
    }
    const output = JSON.stringify({ok:true,data});
    if (Buffer.byteLength(output)>AGENT_OUTPUT_BYTES) throw new AgentError('OUTPUT_BUDGET', 'Query exceeds 96 KiB output budget',
      'Reduce --limit/--source-limit or narrow --scope. Use agent relation for paged provenance; no evidence was silently dropped.');
    if (v.out) { const dest=path.resolve(v.out);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,output+'\n',{encoding:'utf8',flag:'wx'});
      console.log(JSON.stringify({ok:true,output:dest,bytes:Buffer.byteLength(output)})); }
    else console.log(output);
    return 0;
  } catch (error) {
    const e=error as NodeJS.ErrnoException;
    const known=error instanceof AgentError;
    console.error(JSON.stringify({ok:false,error:{code:known?error.code:e.code??'INVALID_INPUT',message:e.message,
      hint:known?error.hint:e.code==='EEXIST'?'Choose a new output path; existing files and directories are never overwritten.':
        'Check input JSON and exact IDs. Retry after correcting the stated error; an incomplete output without receipt.json is not a saved submission.'}}));
    return 1;
  }
}
