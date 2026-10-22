import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { AgentError, AGENT_OUTPUT_BYTES, createAgentApi, digest, page } from './agent.js';
import { checkFeatureRevision, featureRevisionHeader, validateFeatureTaskBundle } from './feature-tasks.js';
import { writeNewBundle } from './output.js';

const help = `Feature task revision protocol 1 (separate from append-only agent protocol 1)
  agent task overview <task-bundle.json> [--offset 0 --limit 25]
  agent task search <task-bundle.json> <text> [--scope directory] [--offset 0 --limit 25]
  agent task inspect <task-bundle.json> <exact-node-id> [--offset 0 --limit 25] [--source-offset 0 --source-limit 6000]
  agent task relation <task-bundle.json> <exact-relation-id> [--offset 0 --limit 3]
  agent task check <task-bundle.json> <revision.json> --author name
  agent task submit <task-bundle.json> <revision.json> --author name --out NEW-DIRECTORY
Queries/check optionally accept --out NEW-FILE. Each paginated list has its own nextOffset.
The task is prepared in the workspace. Only its enumerated scope may be revised.
submit writes revision.json, review.json and receipt.json for human import; it never applies or accepts a change.
`;

export function runFeatureTaskCli(argv: string[]): number {
  try {
    const { positionals: args, values } = parseArgs({ args: argv, allowPositionals: true, options: {
      scope: { type: 'string' }, offset: { type: 'string' }, limit: { type: 'string' }, 'source-offset': { type: 'string' },
      'source-limit': { type: 'string' }, author: { type: 'string' }, out: { type: 'string' }, help: { type: 'boolean', short: 'h' },
    } });
    if (values.help || !args.length) { console.log(JSON.stringify({ ok: true, help })); return 0; }
    const [operation, file, selector] = args, writing = operation === 'submit', checking = writing || operation === 'check';
    if (!['overview','search','inspect','relation','check','submit'].includes(operation!) || !file || args.length !== (operation === 'overview' ? 2 : 3))
      throw new AgentError('USAGE', 'Invalid task operation or arguments', help);
    const allowed = ['out', ...(checking ? ['author'] : ['offset','limit']), ...(operation === 'search' ? ['scope'] : []),
      ...(operation === 'inspect' ? ['source-offset','source-limit'] : [])];
    for (const key of Object.keys(values)) if (!allowed.includes(key)) throw new AgentError('USAGE', `Unsupported --${key}`, help);
    const read = (file: string, max: number) => {
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.size > max) throw new AgentError('INPUT_LIMIT', 'Input exceeds the file budget', 'Task bundles: 192 MiB; revisions: 5 MiB. Use the original exported task.');
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    };
    const bundle = validateFeatureTaskBundle(read(file, 192 * 1024 * 1024)), api = createAgentApi(bundle.graph, bundle.features);
    const number = (key: 'offset' | 'limit' | 'source-offset' | 'source-limit') => {
      if (values[key] === undefined) return undefined;
      if (!/^\d+$/.test(values[key]!)) throw new AgentError('INVALID_BUDGET', `Invalid --${key}`, help);
      return Number(values[key]);
    };
    let data: unknown;
    if (operation === 'overview') {
      const { allowed, ...task } = bundle.task;
      data = { task, taskDigest: bundle.taskDigest, proposalHeader: featureRevisionHeader(bundle),
        scopeFiles: page(allowed.files.map(file => ({ path: file, hash: bundle.graph.files.find(f => f.path === file)!.hash })), number('offset'), number('limit')),
        editableFeatures: page(bundle.features.features.filter(f => allowed.featureIds.includes(f.id)), number('offset'), number('limit')),
        editableMappings: page(bundle.features.mappings.filter(m => allowed.mappingIds.includes(m.id)), number('offset'), number('limit')),
        newFeatures: allowed.newFeatures, parentId: allowed.parentId, overview: api.overview(undefined, number('offset'), number('limit')),
        interpretation: 'The task scope controls edits, not evidence navigation. Existing decisions are historical. Exploration is your declared file-version record, not proof of complete understanding.' };
      // The legacy header must not compete with this task's revision protocol.
      delete (data as { overview: { proposalHeader?: unknown } }).overview.proposalHeader;
    } else if (operation === 'search') data = api.search(selector!, values.scope, number('offset'), number('limit'));
    else if (operation === 'inspect') data = api.inspect(selector!, { offset: number('offset'), limit: number('limit'), sourceOffset: number('source-offset'), sourceLimit: number('source-limit') });
    else if (operation === 'relation') data = api.relation(selector!, number('offset'), number('limit'));
    else {
      const revision = read(selector!, 5 * 1024 * 1024), author = values.author ?? '';
      const result = checkFeatureRevision(bundle, revision, author);
      const { document: _, ...review } = result;
      const receipt = { revisionProtocol: 1, taskId: bundle.task.id, taskDigest: bundle.taskDigest,
        proposalDigest: digest(revision), batchId: revision.batchId, author, valid: true, applied: false, decision: 'proposed',
        summary: result.summary, warnings: result.warnings };
      if (writing) {
        if (!values.out) throw new AgentError('USAGE', 'submit requires --out NEW-DIRECTORY', help);
        const output = writeNewBundle(values.out, { 'revision.json': JSON.stringify(revision, null, 2),
          'review.json': JSON.stringify(review, null, 2), 'receipt.json': JSON.stringify(receipt, null, 2) });
        console.log(JSON.stringify({ ok: true, output, revision: path.join(output, 'revision.json'), receipt: path.join(output, 'receipt.json'), applied: false }));
        return 0;
      }
      data = { ...receipt, changes: review.changes, checks: review.checks, exploredFiles: review.exploredFiles, unexplored: review.unexplored };
    }
    const output = JSON.stringify({ ok: true, data });
    if (Buffer.byteLength(output) > AGENT_OUTPUT_BYTES) throw new AgentError('OUTPUT_BUDGET', 'Query exceeds 96 KiB', 'Reduce --limit/--source-limit; use submit for a large review artifact.');
    if (values.out) {
      const file = path.resolve(values.out); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, output + '\n', { flag: 'wx' });
      console.log(JSON.stringify({ ok: true, output: file, bytes: Buffer.byteLength(output) }));
    } else console.log(output);
    return 0;
  } catch (error) {
    const known = error instanceof AgentError, value = error as NodeJS.ErrnoException;
    console.error(JSON.stringify({ ok: false, error: { code: known ? error.code : value.code ?? 'INVALID_INPUT', message: value.message,
      hint: known ? error.hint : 'Keep the original task and failed revision. Correct the error; use a new output path without overwriting files.' } }));
    return 1;
  }
}
