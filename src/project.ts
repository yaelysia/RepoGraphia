import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import type { AnalysisDiagnostic, Location } from './model.js';

const SKIP = new Set(['.git', 'node_modules', 'dist', 'out', 'build', 'coverage', '.next', '.repographia', 'release', 'vendor']);
export const isSource = (file: string): boolean => /\.[cm]?[jt]sx?$/.test(file) && !/\.d\.[cm]?ts$/.test(file);
export const normalize = (file: string): string => file.split(path.sep).join('/');
export const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
export const inside = (root: string, file: string): boolean => {
  const rel = path.relative(root, file);
  return rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
};
export function locate(node: ts.Node, root: string): Location {
  const sf = node.getSourceFile(), start = node.getStart(sf), end = node.getEnd();
  const a = sf.getLineAndCharacterOfPosition(start), b = sf.getLineAndCharacterOfPosition(end);
  return { file: normalize(path.relative(root, sf.fileName)), start, end,
    line: a.line + 1, column: a.character + 1, endLine: b.line + 1, endColumn: b.character + 1 };
}
export function inventory(root: string) {
  const files: string[] = [], symlinks: string[] = [], ignored: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name), rel = normalize(path.relative(root, full));
      if (entry.isSymbolicLink()) { symlinks.push(rel); continue; }
      if (entry.isDirectory()) {
        if (SKIP.has(entry.name) || entry.name.startsWith('.')) ignored.push(rel);
        else walk(full);
      } else if (entry.isFile()) files.push(full);
    }
  };
  walk(root);
  return { files, symlinks, ignored };
}
export function loadProject(input: string, configName?: string) {
  const root = fs.realpathSync(path.resolve(input));
  if (!fs.statSync(root).isDirectory()) throw new Error('Repository path must be a directory');
  const found = inventory(root);
  const configPath = configName ? path.resolve(root, configName)
    : fs.existsSync(path.join(root, 'tsconfig.json')) ? path.join(root, 'tsconfig.json') : undefined;
  if (configPath && !inside(root, fs.realpathSync(configPath))) throw new Error('Project config must be inside the repository');
  const defaults: ts.CompilerOptions = { allowJs: true, checkJs: false, noEmit: true,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX, skipLibCheck: true };
  let options = defaults, roots = found.files.filter(isSource);
  const diagnostics: AnalysisDiagnostic[] = [];
  if (configPath) {
    const raw = ts.readConfigFile(configPath, ts.sys.readFile);
    if (raw.error) throw new Error(ts.flattenDiagnosticMessageText(raw.error.messageText, '\n'));
    const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, path.dirname(configPath), { noEmit: true }, configPath);
    const fatal = parsed.errors.filter(d => d.code !== 18003);
    if (fatal.length) throw new Error(fatal.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'));
    options = { ...defaults, ...parsed.options, noEmit: true, incremental: false };
    roots = parsed.fileNames.filter(f => inside(root, f));
    if (parsed.projectReferences?.length) diagnostics.push({ category: 'warning', code: 'project-references',
      message: 'Project references are not recursively analyzed. Select a leaf tsconfig with --project. Unindexed files are listed.' });
  }
  // Analyze only source files in the inventory; declarations may still supply type facts.
  const permitted = new Set(found.files);
  roots = roots.filter(f => permitted.has(f));
  const host = ts.createCompilerHost(options);
  const originalRead = host.readFile;
  const readHashes = new Map<string, string>();
  host.readFile = file => {
    // Dependencies/configuration may be read, never executed or emitted.
    if (inside(root, file) && !file.includes(`${path.sep}node_modules${path.sep}`)) {
      try { if (!inside(root, fs.realpathSync(file))) return undefined; } catch { return undefined; }
    }
    const text = originalRead(file);
    if (text !== undefined) readHashes.set(normalize(path.relative(root, file)), hash(text));
    return text;
  };
  const program = ts.createProgram({ rootNames: roots, options, host });
  const sources = program.getSourceFiles().filter(sf => !sf.isDeclarationFile && permitted.has(sf.fileName) && isSource(sf.fileName));
  return { root, configPath, found, options, program, sources, diagnostics, readHashes };
}
export function gitState(root: string): { commit: string | null; dirty: boolean | null } {
  try {
    const run = (...args: string[]) => execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    }).trim();
    return { commit: run('rev-parse', 'HEAD'), dirty: run('status', '--porcelain', '--untracked-files=normal') !== '' };
  } catch { return { commit: null, dirty: null }; }
}
