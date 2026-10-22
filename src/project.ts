import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import type { AnalysisDiagnostic, Location } from './model.js';

const SKIP = new Set(['.git', 'node_modules', 'dist', 'out', 'build', 'coverage', '.next', '.repographia', 'release', 'vendor']);
export const isSource = (file: string): boolean => /\.[cm]?[jt]sx?$/.test(file) && !/\.d\.[cm]?ts$/.test(file);
export const normalize = (file: string): string => file.split(path.sep).join('/');
/** TypeScript emits slash paths even on Windows; inventory uses native separators. */
export function fileKey(file: string, flavor: 'win32' | 'posix' = process.platform === 'win32' ? 'win32' : 'posix'): string {
  const api = path[flavor], key = api.resolve(file).split(api.sep).join('/');
  return flavor === 'win32' ? key.toLowerCase() : key;
}
export const isDependency = (file: string): boolean => fileKey(file).includes('/node_modules/');
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

/** Captured compiler inputs, including unsuccessful resolution queries. No source text. */
export interface AnalysisInputs {
  schemaVersion: 1;
  root: string;
  inventory: ReturnType<typeof inventory>;
  reads: { path: string; hash: string | null }[];
  /** Paths requested during config parsing, including extends/package metadata; absent in older captures. */
  configReads?: string[];
  files: { path: string; exists: boolean }[];
  directories: { path: string; exists: boolean }[];
  realpaths: { path: string; resolved: string | null }[];
  directoryNames: { path: string; names: string[] }[];
  directoryQueries: { path: string; extensions?: string[]; excludes?: string[]; includes?: string[]; depth?: number; files: string[] }[];
}

function realPath(file: string): string | null {
  try { return fs.realpathSync(file); } catch { return null; }
}
function observedText(root: string, file: string, resolved: string | null): string | undefined {
  // Preserve the source-symlink boundary. External declarations/configs may be read,
  // but an in-repository source link cannot smuggle an external implementation in.
  if (!resolved || inside(root, file) && !isDependency(file) && !inside(root, resolved)) return undefined;
  return ts.sys.readFile(file);
}
const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/** Reconcile observations with disk; this is not a filesystem-atomic snapshot. */
export function checkAnalysisInputs(inputs: AnalysisInputs): { current: boolean; changed: string[] } {
  if (inputs.schemaVersion !== 1) throw new Error('Unsupported analysis input capture');
  const changed = new Set<string>();
  try {
    const found = inventory(inputs.root);
    if (!sameList(found.files, inputs.inventory.files) || !sameList(found.symlinks, inputs.inventory.symlinks)
      || !sameList(found.ignored, inputs.inventory.ignored)) changed.add(inputs.root);
  } catch { changed.add(inputs.root); }
  const resolutions = new Map<string, string | null>();
  const resolve = (file: string) => {
    const key = fileKey(file);
    if (!resolutions.has(key)) resolutions.set(key, realPath(file));
    return resolutions.get(key)!;
  };
  for (const item of inputs.realpaths) if (resolve(item.path) !== item.resolved) changed.add(item.path);
  for (const item of inputs.reads) {
    const text = observedText(inputs.root, item.path, resolve(item.path));
    if ((text === undefined ? null : hash(text)) !== item.hash) changed.add(item.path);
  }
  for (const item of inputs.files) if (ts.sys.fileExists(item.path) !== item.exists) changed.add(item.path);
  for (const item of inputs.directories) if (ts.sys.directoryExists(item.path) !== item.exists) changed.add(item.path);
  for (const item of inputs.directoryNames) {
    try { if (!sameList(ts.sys.getDirectories(item.path).sort(), item.names)) changed.add(item.path); }
    catch { changed.add(item.path); }
  }
  for (const item of inputs.directoryQueries) {
    try {
      const files = ts.sys.readDirectory(item.path, item.extensions, item.excludes, item.includes, item.depth).sort();
      if (!sameList(files, item.files)) changed.add(item.path);
    } catch { changed.add(item.path); }
  }
  return { current: !changed.size, changed: [...changed].sort() };
}

/** One reader is shared by config parsing and the CompilerHost for this rebuild. */
function inputReader(root: string, found: ReturnType<typeof inventory>) {
  const reads = new Map<string, { path: string; text: string | undefined }>();
  const configReads = new Map<string, string>();
  const files = new Map<string, { path: string; exists: boolean }>();
  const directories = new Map<string, { path: string; exists: boolean }>();
  const realpaths = new Map<string, { path: string; resolved: string | null }>();
  const directoryNames = new Map<string, { path: string; names: string[] }>();
  const directoryQueries = new Map<string, AnalysisInputs['directoryQueries'][number]>();
  const readHashes = new Map<string, string>();
  const resolve = (file: string) => {
    const absolute = path.resolve(file), key = fileKey(absolute);
    if (!realpaths.has(key)) realpaths.set(key, { path: absolute, resolved: realPath(absolute) });
    return realpaths.get(key)!.resolved;
  };
  const reader = {
    readFile(file: string): string | undefined {
      const absolute = path.resolve(file), key = fileKey(absolute);
      if (!reads.has(key)) {
        const text = observedText(root, absolute, resolve(absolute));
        reads.set(key, { path: absolute, text });
        if (text !== undefined) readHashes.set(normalize(path.relative(root, absolute)), hash(text));
      }
      return reads.get(key)!.text;
    },
    fileExists(file: string): boolean {
      const absolute = path.resolve(file), key = fileKey(absolute);
      if (!files.has(key)) files.set(key, { path: absolute, exists: ts.sys.fileExists(absolute) });
      return files.get(key)!.exists;
    },
    directoryExists(directory: string): boolean {
      const absolute = path.resolve(directory), key = fileKey(absolute);
      if (!directories.has(key)) directories.set(key, { path: absolute, exists: ts.sys.directoryExists(absolute) });
      return directories.get(key)!.exists;
    },
    realpath(file: string): string { return resolve(file) ?? path.resolve(file); },
    getDirectories(directory: string): string[] {
      const absolute = path.resolve(directory), key = fileKey(absolute);
      if (!directoryNames.has(key)) directoryNames.set(key, { path: absolute, names: ts.sys.getDirectories(absolute) });
      return [...directoryNames.get(key)!.names];
    },
    readDirectory(directory: string, extensions?: readonly string[], excludes?: readonly string[], includes?: readonly string[], depth?: number): string[] {
      const absolute = path.resolve(directory);
      const args = { path: absolute, ...(extensions ? { extensions: [...extensions] } : {}),
        ...(excludes ? { excludes: [...excludes] } : {}), ...(includes ? { includes: [...includes] } : {}),
        ...(depth === undefined ? {} : { depth }) };
      const key = JSON.stringify({ ...args, path: fileKey(absolute) });
      if (!directoryQueries.has(key)) directoryQueries.set(key, { ...args,
        files: ts.sys.readDirectory(absolute, extensions, excludes, includes, depth) });
      return [...directoryQueries.get(key)!.files];
    },
  };
  const readConfigFile = (file: string): string | undefined => {
    const absolute = path.resolve(file);
    configReads.set(fileKey(absolute), absolute);
    // Attribute the read's purpose without rereading a path or changing cached bytes.
    return reader.readFile(absolute);
  };
  const capture = (): AnalysisInputs => ({ schemaVersion: 1, root,
    inventory: { files: [...found.files], symlinks: [...found.symlinks], ignored: [...found.ignored] },
    reads: [...reads.values()].map(item => ({ path: item.path, hash: item.text === undefined ? null : hash(item.text) })),
    configReads: [...configReads.values()].sort(),
    files: [...files.values()].map(item => ({ ...item })), directories: [...directories.values()].map(item => ({ ...item })),
    realpaths: [...realpaths.values()].map(item => ({ ...item })),
    // Canonicalize captured sets without changing compiler traversal or which
    // callsites the existing bounded origin analysis encounters first.
    directoryNames: [...directoryNames.values()].map(item => ({ ...item, names: [...item.names].sort() })),
    directoryQueries: [...directoryQueries.values()].map(item => ({ ...item, files: [...item.files].sort(),
      ...(item.extensions ? { extensions: [...item.extensions] } : {}), ...(item.excludes ? { excludes: [...item.excludes] } : {}),
      ...(item.includes ? { includes: [...item.includes] } : {}) })),
  });
  return { reader, readConfigFile, capture, readHashes };
}

/** Snapshot identity includes inventory/failed queries, not just successfully read files. */
export function analysisInputDigest(inputs: AnalysisInputs): string {
  const relative = (file: string) => normalize(path.relative(inputs.root, file));
  const byPath = <T extends { path: string }>(items: T[]) => items.map(item => ({ ...item, path: relative(item.path) }))
    .sort((a, b) => a.path.localeCompare(b.path) || JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return hash(JSON.stringify({ schemaVersion: inputs.schemaVersion,
    inventory: { ...inputs.inventory, files: inputs.inventory.files.map(relative) },
    reads: byPath(inputs.reads), files: byPath(inputs.files), directories: byPath(inputs.directories),
    ...(inputs.configReads === undefined ? {} : { configReads: inputs.configReads.map(relative).sort() }),
    realpaths: byPath(inputs.realpaths.map(item => ({ ...item, resolved: item.resolved === null ? null : relative(item.resolved) }))),
    directoryNames: byPath(inputs.directoryNames),
    directoryQueries: byPath(inputs.directoryQueries.map(item => ({ ...item, files: item.files.map(relative) }))),
  }));
}

export function loadProject(input: string, configName?: string) {
  const root = fs.realpathSync(path.resolve(input));
  if (!fs.statSync(root).isDirectory()) throw new Error('Repository path must be a directory');
  const found = inventory(root);
  const inputs = inputReader(root, found), reader = inputs.reader;
  const configPath = configName ? path.resolve(root, configName)
    : reader.fileExists(path.join(root, 'tsconfig.json')) ? path.join(root, 'tsconfig.json') : undefined;
  if (configPath && !inside(root, reader.realpath(configPath))) throw new Error('Project config must be inside the repository');
  const defaults: ts.CompilerOptions = { allowJs: true, checkJs: false, noEmit: true,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX, skipLibCheck: true };
  let options = defaults, roots = found.files.filter(isSource);
  const diagnostics: AnalysisDiagnostic[] = [];
  if (configPath) {
    const raw = ts.readConfigFile(configPath, inputs.readConfigFile);
    if (raw.error) throw new Error(ts.flattenDiagnosticMessageText(raw.error.messageText, '\n'));
    const parsed = ts.parseJsonConfigFileContent(raw.config, { ...ts.sys, ...reader, readFile: inputs.readConfigFile },
      path.dirname(configPath), { noEmit: true }, configPath);
    const fatal = parsed.errors.filter(d => d.code !== 18003);
    if (fatal.length) throw new Error(fatal.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'));
    options = { ...defaults, allowJs: false, ...parsed.options, noEmit: true, incremental: false };
    roots = parsed.fileNames.filter(f => inside(root, f));
    if (parsed.projectReferences?.length) diagnostics.push({ category: 'warning', code: 'project-references',
      message: 'Project references are not recursively analyzed. Select a leaf tsconfig with --project. Unindexed files are listed.' });
  }
  // Analyze only source files in the inventory; declarations may still supply type facts.
  const permitted = new Set(found.files.map(f => fileKey(f)));
  roots = roots.filter(f => permitted.has(fileKey(f)));
  const host = ts.createCompilerHost(options);
  Object.assign(host, reader);
  const program = ts.createProgram({ rootNames: roots, options, host });
  const sources = program.getSourceFiles().filter(sf => !sf.isDeclarationFile && permitted.has(fileKey(sf.fileName)) && isSource(sf.fileName));
  return { root, configPath, found, options, program, sources, diagnostics, readHashes: inputs.readHashes,
    inputReader: reader, captureInputs: inputs.capture };
}
export function gitState(root: string): { commit: string | null; dirty: boolean | null } {
  try {
    const run = (...args: string[]) => execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    }).trim();
    // Do not run git status: repository-configured fsmonitor/clean helpers may execute.
    // The commit is a baseline only; content hashes describe the analyzed working copy.
    return { commit: run('rev-parse', '--verify', 'HEAD'), dirty: null };
  } catch { return { commit: null, dirty: null }; }
}
