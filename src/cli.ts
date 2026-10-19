#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { analyze } from './analyze.js';
import { renderHtml } from './report.js';
import { findNode, neighborhood } from './query.js';
import { inside } from './project.js';
import type { CodeGraph } from './model.js';

const help = `RepoGraphia 0.1.0 — evidence-grounded static code explorer

  node dist/cli.js analyze <repository> --out <report-directory> [--project tsconfig.json] [--include-source]
  node dist/cli.js query <graph.json> search <text>
  node dist/cli.js query <graph.json> callers|callees <node-id-or-unique-name> [--depth 1] [--include-candidates]

No target code, build scripts, tests or AI are executed. Dependencies are never auto-installed.
The report contains source excerpts; --include-source also embeds complete indexed files.
Output must be outside the analyzed repository. Diagnostics/unindexed regions remain visible.
`;
try {
  const { positionals: args, values } = parseArgs({ allowPositionals: true, options: {
    out: { type: 'string' }, project: { type: 'string' }, depth: { type: 'string' },
    'include-source': { type: 'boolean' }, 'include-candidates': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  } });
  if (values.help || !args.length) console.log(help);
  else if (args[0] === 'analyze') {
    if (!args[1] || !values.out || args.length !== 2) throw new Error('analyze requires one repository and --out directory');
    const root = fs.realpathSync(path.resolve(args[1])), out = path.resolve(values.out);
    // Resolve existing ancestor to reject output symlinks leading back into the input.
    let existing = out;
    while (!fs.existsSync(existing)) existing = path.dirname(existing);
    if (inside(root, path.resolve(fs.realpathSync(existing), path.relative(existing, out))))
      throw new Error('Output must be outside the analyzed repository to keep source read-only');
    const started = performance.now();
    const graph = analyze(root, { project: values.project, includeSource: values['include-source'] });
    fs.mkdirSync(out, { recursive: true });
    for (const [name, text] of [['graph.json', JSON.stringify(graph, null, 2)], ['index.html', renderHtml(graph)]]) {
      const destination = path.join(out, name!);
      if (fs.existsSync(destination) && fs.lstatSync(destination).isSymbolicLink()) throw new Error('Refusing symlink output: ' + destination);
      fs.writeFileSync(destination, text!, 'utf8');
    }
    console.log(JSON.stringify({ report: path.join(out, 'index.html'), snapshot: graph.project.snapshot,
      indexedFiles: graph.files.length, symbols: graph.nodes.filter(n => n.kind !== 'file').length,
      calls: graph.coverage.callsByStatus, unindexedFiles: graph.coverage.unindexed.length,
      diagnostics: graph.diagnostics.length, elapsedMs: Math.round(performance.now() - started) }, null, 2));
  } else if (args[0] === 'query') {
    if (args.length !== 4) throw new Error('query requires graph.json, operation, and selector');
    const graph: CodeGraph = JSON.parse(fs.readFileSync(args[1]!, 'utf8'));
    if (graph.schemaVersion !== 1 || !Array.isArray(graph.nodes) || !Array.isArray(graph.relations)) throw new Error('Unsupported graph schema');
    if (args[2] === 'search') {
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
