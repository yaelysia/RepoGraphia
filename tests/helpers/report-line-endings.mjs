import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const variants = ['lf', 'crlf', 'cr', 'mixed'];
const root = fileURLToPath(new URL('../../', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const sources = [
  ['src/start.ts', 'start', "export function start() { return finish(); }\r\n// </script><script>globalThis.repoGraphiaInjected=1</script>\r\n"],
  ['lib/finish.ts', 'finish', "export function finish() { return 'evidence <&>'; }\r\n"],
];
const location = (file, text) => ({ file, start: 0, end: text.indexOf('\r'), line: 1, column: 1,
  endLine: 1, endColumn: text.indexOf('\r') + 1 });
// Hand-specified presentation fixture; target sources are data, never executed.
export const graph = {
  schemaVersion: 1,
  project: { name: 'newline-fixture', snapshot: hash('newline-fixture'), analysisRevision: 4,
    commit: null, dirty: null, compilerVersion: 'fixture', config: null, createdAt: 'fixture' },
  files: sources.map(([file, , source]) => ({ path: file, hash: hash(source), lines: source.split('\n').length, source })),
  nodes: sources.flatMap(([file, name, text]) => [
    { id: 'file:' + file, kind: 'file', name: file, parent: null, location: location(file, text), snippet: text, hasBody: true },
    { id: 'node:' + name, kind: 'function', name, parent: 'file:' + file, location: location(file, text), snippet: text, hasBody: true },
  ]),
  relations: [{ id: 'edge:start-finish', from: 'node:start', targets: ['node:finish'], kind: 'call', status: 'bound', targetLabel: 'finish',
    evidence: { rule: 'fixture', explanation: 'Hand-specified call', location: location(sources[0][0], sources[0][2]),
      fileHash: hash(sources[0][2]), excerpt: 'finish()' } }],
  diagnostics: [],
  coverage: { indexedFiles: 2, inventorySourceFiles: 2, syntaxCalls: 1,
    callsByStatus: { bound: 1, candidate: 0, unresolved: 0, external: 0 },
    unindexed: [], skippedSymlinks: [], ignoredDirectories: [], limitations: [] },
};

export function runtimeOf(html) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if (scripts.length !== 1) throw new Error('Expected exactly one executable script');
  return scripts[0][1];
}

export async function renderVariant(style) {
  if (!variants.includes(style)) throw new Error('Unknown line-ending fixture');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'repographia-report-eol-'));
  try {
    fs.writeFileSync(path.join(temp, 'package.json'), '{"type":"module"}');
    for (const dir of ['dist', 'viewer']) {
      fs.cpSync(path.join(root, dir), path.join(temp, dir), { recursive: true });
      for (const name of fs.readdirSync(path.join(temp, dir))) {
        if (!name.endsWith('.js')) continue;
        const file = path.join(temp, dir, name);
        let i = 0;
        const endings = style === 'mixed' ? ['\r\n', '\n', '\r'] :
          [style === 'crlf' ? '\r\n' : style === 'cr' ? '\r' : '\n'];
        const text = fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n')
          .replace(/\n/g, () => endings[i++ % endings.length]);
        fs.writeFileSync(file, text);
      }
    }
    const { renderHtml } = await import(pathToFileURL(path.join(temp, 'dist/report.js')).href);
    return renderHtml(graph);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

export function wrongHashReport(html) {
  // Reproduce the original bug deliberately. Browser tests must reject it even
  // in --set-content mode (Python read_text would silently normalize CRLF).
  const runtime = runtimeOf(html).replace(/\r\n?/g, '\n').replace(/\n/g, '\r\n');
  const digest = createHash('sha256').update(runtime).digest('base64');
  return html.replace(/<script>[\s\S]*?<\/script>/, () => `<script>${runtime}</script>`)
    .replace(/script-src 'sha256-[^']+'/, `script-src 'sha256-${digest}'`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const output = process.argv[2];
  if (!output) throw new Error('Usage: node tests/helpers/report-line-endings.mjs NEW-DIRECTORY');
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.mkdirSync(output); // Refuse to overwrite an existing bundle.
  for (const style of variants) fs.writeFileSync(path.join(output, style + '.html'), await renderVariant(style), { flag: 'wx' });
  const html = fs.readFileSync(path.join(output, 'lf.html'), 'utf8');
  fs.writeFileSync(path.join(output, 'wrong-hash.html'), wrongHashReport(html), { flag: 'wx' });
  fs.writeFileSync(path.join(output, 'tampered.html'), html.replace('</script></body>',
    '\nglobalThis.reportTampered = true;\n</script></body>'), { flag: 'wx' });
}
