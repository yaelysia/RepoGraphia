#!/usr/bin/env node
import fs from 'node:fs';
import { runAgentCli } from './agent-cli.js';
import { runWorkspaceCli } from './workspace-cli.js';
import { requireNewDirectory, writeNewBundle } from './output.js';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { analyze } from './analyze.js';
import { renderHtml } from './report.js';
import { findNode, neighborhood } from './query.js';
import { inside } from './project.js';
import { resolutionSummary, diagnosticRecords } from './diagnostics.js';
import { createProjectMapApi } from './project-map.js';
import { runFeatureCli } from './feature-cli.js';
import type { MapSelection } from './project-map.js';
import type { CodeGraph, RelationKind, Status } from './model.js';

const help = `RepoGraphia 0.1.0 — evidence-grounded static code explorer

  node dist/cli.js agent --help
  node dist/cli.js workspace <repository> --out <workspace-directory> [--project tsconfig.json] [--port 0]

  node dist/cli.js analyze <repository> --out <report-directory> [--project tsconfig.json] [--include-source]
  node dist/cli.js query <graph.json> search <text>
  node dist/cli.js query <graph.json> callers|callees <node-id-or-unique-name> [--depth 1] [--include-candidates]

  node dist/cli.js query <graph.json> diagnostics [reason] [--offset 0] [--limit 25]
  node dist/cli.js query <graph.json> map [directory] [--show-tests] [--kind call|import|all] [--status candidate|all] [--max-nodes 12] [--max-links 24]
  node dist/cli.js query <graph.json> map-records [directory] [--group path | --from path --to path] [--category outside|internal|all] [--offset 0] [--limit 25]

  node dist/cli.js features init <graph.json> --out <new-features.json>
  node dist/cli.js features check <graph.json> <features.json>
  node dist/cli.js features render <graph.json> <features.json> --out <new-report.html>
  node dist/cli.js features edit <graph.json> <features.json> --patch <edit.json> --expected-revision <n> --author <name> --actor-kind manual|agent --out <new-features.json>

  node dist/cli.js features plan <old-graph.json> <new-graph.json> <features.json> --out <plan.json>
  node dist/cli.js features migrate <old-graph.json> <new-graph.json> <features.json> --patch <migration.json> --expected-revision <n> --author <name> --actor-kind manual --out <new-features.json>

Feature commands never overwrite existing files; check exits 2 for stale evidence. Semantic labels are proposals, not code facts.
No target code, build scripts, tests or AI are executed. Dependencies are never auto-installed.
The report contains source excerpts; --include-source also embeds complete indexed files.
Analyze writes a NEW directory outside the repository; existing reports are never overwritten.
Diagnostics/unindexed regions remain visible. Use a new --out path for each snapshot.
`;
if (process.argv[2] === 'workspace') {
  try { await runWorkspaceCli(process.argv.slice(3)); }
  catch (error) { console.error('RepoGraphia: ' + (error instanceof Error ? error.message : String(error))); process.exitCode = 1; }
}
else if (process.argv[2] === 'agent') process.exitCode = runAgentCli(process.argv.slice(3));
else try {
  const { positionals: args, values } = parseArgs({ allowPositionals: true, options: {
    features: { type: 'string' }, patch: { type: 'string' }, author: { type: 'string' },
    'actor-kind': { type: 'string' }, 'expected-revision': { type: 'string' },
    out: { type: 'string' }, project: { type: 'string' }, depth: { type: 'string' },
    offset: { type: 'string' }, limit: { type: 'string' },
    kind: { type: 'string' }, status: { type: 'string' }, group: { type: 'string' },
    from: { type: 'string' }, to: { type: 'string' }, category: { type: 'string' },
    'show-tests': { type: 'boolean' }, 'max-nodes': { type: 'string' }, 'max-links': { type: 'string' },
    'include-source': { type: 'boolean' }, 'include-candidates': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  } });
  if (values.help || !args.length) console.log(help);
  else if (args[0] === 'features') process.exitCode = runFeatureCli(args.slice(1), values);
  else if (args[0] === 'analyze') {
    if (!args[1] || !values.out || args.length !== 2) throw new Error('analyze requires one repository and --out directory');
    const root = fs.realpathSync(path.resolve(args[1])), out = path.resolve(values.out);
    // Resolve existing ancestor to reject output symlinks leading back into the input.
    let existing = out;
    while (!fs.existsSync(existing)) existing = path.dirname(existing);
    if (inside(root, path.resolve(fs.realpathSync(existing), path.relative(existing, out))))
      throw new Error('Output must be outside the analyzed repository to keep source read-only');
    requireNewDirectory(out);
    const started = performance.now();
    const graph = analyze(root, { project: values.project, includeSource: values['include-source'] });
    // Render before creating anything: an invalid sidecar cannot leave a half-new report.
    const bundle = { 'graph.json': JSON.stringify(graph, null, 2),
      'index.html': renderHtml(graph, values.features ? JSON.parse(fs.readFileSync(values.features, 'utf8')) : undefined) };
    writeNewBundle(out, bundle);
    console.log(JSON.stringify({ report: path.join(out, 'index.html'), snapshot: graph.project.snapshot,
      indexedFiles: graph.files.length, symbols: graph.nodes.filter(n => n.kind !== 'file').length,
      calls: graph.coverage.callsByStatus, unindexedFiles: graph.coverage.unindexed.length,
      diagnostics: graph.diagnostics.length, elapsedMs: Math.round(performance.now() - started) }, null, 2));
  } else if (args[0] === 'query') {
    if (args.length !== 4 && !(args.length === 3 && ['diagnostics','map','map-records'].includes(args[2]!)))
      throw new Error('query requires graph.json, operation, and selector (optional for diagnostics)');
    const graph: CodeGraph = JSON.parse(fs.readFileSync(args[1]!, 'utf8'));
    if (graph.schemaVersion !== 1 || !Array.isArray(graph.nodes) || !Array.isArray(graph.relations)) throw new Error('Unsupported graph schema');
    if (args[2] === 'map' || args[2] === 'map-records') {
      const api = createProjectMapApi(), data = api.index(graph);
      const options = { scope: args[3], showTests: values['show-tests'],
        kinds: !values.kind || values.kind === 'all' ? undefined :
          (values.kind === 'call' ? ['call','construct','tag'] : values.kind === 'import' ? ['import','reexport'] : [values.kind]) as RelationKind[],
        statuses: !values.status || values.status === 'all' ? undefined : [values.status as Status],
        maxNodes: values['max-nodes'] === undefined ? undefined : Number(values['max-nodes']),
        maxLinks: values['max-links'] === undefined ? undefined : Number(values['max-links']),
      };
      console.log(JSON.stringify(args[2] === 'map' ? api.project(data, options) : api.records(data, options,
        { group: values.group, from: values.from, to: values.to, category: values.category as MapSelection['category'] },
        { offset: values.offset === undefined ? undefined : Number(values.offset), limit: values.limit === undefined ? undefined : Number(values.limit) }), null, 2));
    } else if (args[2] === 'diagnostics') {
      if (!args[3] && (values.limit !== undefined || values.offset !== undefined))
        throw new Error('Select a diagnostic reason when using --limit or --offset');
      console.log(JSON.stringify(args[3] ? diagnosticRecords(graph, args[3], {
        offset: values.offset === undefined ? undefined : Number(values.offset),
        limit: values.limit === undefined ? undefined : Number(values.limit),
      }) : resolutionSummary(graph), null, 2));
    } else if (args[2] === 'search') {
      const matches = graph.nodes.filter(n => `${n.name} ${n.location.file}`.toLowerCase().includes(args[3]!.toLowerCase()));
      console.log(JSON.stringify({ total: matches.length, truncated: matches.length > 100, nodes: matches.slice(0, 100) }, null, 2));
    } else {
      if (!['callers', 'callees'].includes(args[2]!)) throw new Error('Unknown query operation');
      console.log(JSON.stringify(neighborhood(graph, findNode(graph, args[3]!), {
        direction: args[2] === 'callers' ? 'in' : 'out', depth: values.depth === undefined ? 1 : Number(values.depth),
        includeCandidates: values['include-candidates'],
      }), null, 2));
    }
  } else throw new Error('Unknown command. Use --help.');
} catch (error) {
  console.error('RepoGraphia: ' + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
}
