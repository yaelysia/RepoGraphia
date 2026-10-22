import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import type { CodeGraph } from './model.js';
import { createFeatureMapApi } from './feature-map.js';
import type { FeatureMap } from './feature-map.js';
import { analysisInputDigest, checkAnalysisInputs, fileKey, hash, inside } from './project.js';
import type { AnalysisInputs } from './project.js';

export interface WorkspaceSnapshot { id: string; storageDigest: string; createdAt: string; verifiedAt: string; indexedFiles: number }
export interface WorkspaceFeature { digest: string; basisSnapshot: string; revision: number; savedAt: string }
export interface WorkspaceTask { id: string; title: string; createdAt: string; snapshot: string; featureDigest: string | null }
export interface WorkspaceView { snapshot: string | null; taskId: string | null; featureDigest?: string | null; readOnly?: boolean }
interface Manifest {
  schemaVersion: 1; root: string; project: string | null; createdAt: string;
  snapshots: WorkspaceSnapshot[]; latestSnapshot: string | null;
  featureVersions: WorkspaceFeature[]; featureHead: string | null;
  tasks: WorkspaceTask[]; activeTaskId: string | null; view: WorkspaceView;
}
export interface WorkspaceAnalysis { graph: CodeGraph; inputs: AnalysisInputs }
export interface WorkspaceOptions {
  root: string; directory: string; project?: string; features?: unknown;
  /** Scheduling controls also allow deterministic tests without a background observer. */
  reconcileMs?: number; debounceMs?: number; watch?: boolean;
}
export interface WorkspaceDependencies {
  analyze?: (root: string, project: string | undefined, signal: AbortSignal) => Promise<WorkspaceAnalysis>;
  checkInputs?: typeof checkAnalysisInputs;
}
type Phase = 'starting' | 'checking' | 'analyzing' | 'current' | 'changed' | 'error' | 'closed';
export class WorkspaceError extends Error {
  constructor(message: string, public statusCode = 400) { super(message); }
}
const digestPattern = /^[a-f0-9]{64}$/;
const taskPattern = /^[a-f0-9-]{36}$/;
const featureApi = createFeatureMapApi();

function canonicalDestination(directory: string): string {
  const absolute = path.resolve(directory);
  let parent = absolute;
  while (!fs.existsSync(parent)) parent = path.dirname(parent);
  return path.resolve(fs.realpathSync(parent), path.relative(parent, absolute));
}

/** Only runs this tool's analyzer module; never target scripts, build commands or dependencies. */
function analyzeInWorker(root: string, project: string | undefined, signal: AbortSignal): Promise<WorkspaceAnalysis> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('Workspace closed')); return; }
    const worker = new Worker(new URL('./workspace-worker.js', import.meta.url), { workerData: { root, project } });
    let settled = false;
    const finish = (error?: Error, result?: WorkspaceAnalysis) => {
      if (settled) return;
      settled = true; clearTimeout(timeout); signal.removeEventListener('abort', abort);
      void worker.terminate();
      if (error) reject(error); else resolve(result!);
    };
    const abort = () => finish(new Error('Workspace closed'));
    const timeout = setTimeout(() => finish(new Error('Analysis exceeded 180 seconds; the previous verified map is retained')), 180_000);
    signal.addEventListener('abort', abort, { once: true });
    worker.once('message', message => {
      if (message.error) finish(new Error(message.error));
      else if (!message.graph || !message.inputs) finish(new Error('Analyzer returned incomplete input evidence'));
      else finish(undefined, message);
    });
    worker.once('error', error => finish(error));
    worker.once('exit', code => { if (!settled) finish(new Error(`Analyzer exited before returning a result (${code})`)); });
  });
}

/** One persistent project, immutable versions, and a serialized, input-checked rebuild queue. */
export class ContinuousWorkspace {
  readonly root: string;
  readonly directory: string;
  readonly project: string | undefined;
  readonly reconcileMs: number;
  private manifest: Manifest;
  private readonly lockNonce = randomUUID();
  private readonly runAnalysis: NonNullable<WorkspaceDependencies['analyze']>;
  private readonly checkInputs: typeof checkAnalysisInputs;
  private readonly options: WorkspaceOptions;
  private readonly abort = new AbortController();
  private initialFeatures: unknown;
  private latestInputs: AnalysisInputs | null = null;
  private phase: Phase = 'starting';
  private message = '正在准备工作区';
  private error: string | null = null;
  private lastCheckedAt: string | null = null;
  private watcher: fs.FSWatcher | null = null;
  private watchActive = false;
  private interval: ReturnType<typeof setInterval> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private sequence = 0;
  private pending = false;
  private force = false;
  private started = false;
  private stopped = false;
  private establishing = false;
  private waiters: { sequence: number; resolve: (entry: WorkspaceSnapshot) => void; reject: (error: Error) => void }[] = [];

  constructor(options: WorkspaceOptions, dependencies: WorkspaceDependencies = {}) {
    this.options = options;
    this.root = fs.realpathSync(path.resolve(options.root));
    if (!fs.statSync(this.root).isDirectory()) throw new WorkspaceError('Project path must be a directory');
    this.directory = canonicalDestination(options.directory);
    if (inside(this.root, this.directory)) throw new WorkspaceError('Workspace data must be outside the analyzed project');
    this.project = options.project ? path.resolve(this.root, options.project) : undefined;
    // A missing/replaced config must not prevent opening the last saved graph. The analyzer checks real paths before reading it.
    if (this.project && !inside(this.root, this.project)) throw new WorkspaceError('Project config must be inside the repository');
    this.reconcileMs = options.reconcileMs ?? 10_000;
    if (this.reconcileMs !== 0 && this.reconcileMs < 100) throw new WorkspaceError('Reconciliation interval must be at least 100 ms');
    this.runAnalysis = dependencies.analyze ?? analyzeInWorker;
    this.checkInputs = dependencies.checkInputs ?? checkAnalysisInputs;
    this.initialFeatures = options.features;
    fs.mkdirSync(this.directory, { recursive: true });
    if (fs.lstatSync(this.directory).isSymbolicLink()) throw new WorkspaceError('Workspace directory cannot be a symlink');
    const statePath = path.join(this.directory, 'workspace.json');
    if (!fs.existsSync(statePath) && fs.readdirSync(this.directory).some(name => name !== 'workspace.lock'))
      throw new WorkspaceError('Choose an empty directory or an existing RepoGraphia workspace');
    this.acquireLock();
    try {
      if (fs.existsSync(statePath)) {
        this.manifest = this.readManifest();
        if (fileKey(this.manifest.root) !== fileKey(this.root) || this.manifest.project !== (this.project ?? null))
          throw new WorkspaceError('This workspace belongs to a different project or tsconfig');
        if (options.features !== undefined) throw new WorkspaceError('Existing workspace: import annotations in the page instead of passing --features');
        if (this.manifest.latestSnapshot) this.latestInputs = this.readSnapshot(this.manifest.latestSnapshot).inputs;
        if (this.manifest.featureHead) this.getFeatures(this.manifest.featureHead);
      } else {
        this.manifest = { schemaVersion: 1, root: this.root, project: this.project ?? null, createdAt: new Date().toISOString(),
          snapshots: [], latestSnapshot: null, featureVersions: [], featureHead: null, tasks: [], activeTaskId: null,
          view: { snapshot: null, taskId: null, featureDigest: null, readOnly: false } };
        this.commit(this.manifest);
      }
      for (const name of ['snapshots', 'features']) this.ensureDirectory(name);
    } catch (error) { this.releaseLock(); throw error; }
  }

  private assertStorage() {
    if (fs.lstatSync(this.directory).isSymbolicLink() || fileKey(fs.realpathSync(this.directory)) !== fileKey(this.directory) || inside(this.root, fs.realpathSync(this.directory)))
      throw new WorkspaceError('Workspace directory changed; refusing to write', 500);
  }
  private ensureDirectory(name: string) {
    this.assertStorage();
    const directory = path.join(this.directory, name);
    if (!fs.existsSync(directory)) fs.mkdirSync(directory);
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new WorkspaceError('Workspace storage must use real directories', 500);
    return directory;
  }
  private regularFile(file: string) {
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    if (stat && (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)) throw new WorkspaceError('Workspace storage must use regular, unlinked files', 500);
    return stat;
  }
  private acquireLock() {
    const file = path.join(this.directory, 'workspace.lock');
    const guard = path.join(this.directory, 'workspace-acquire.lock');
    this.regularFile(guard);
    try { fs.writeFileSync(guard, JSON.stringify({ pid: process.pid, nonce: this.lockNonce }), { flag: 'wx', mode: 0o600 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new WorkspaceError('Workspace is being opened; retry. If its owner exited during recovery, inspect workspace-acquire.lock before removing it', 409);
      throw error;
    }
    try {
      this.regularFile(file);
      if (fs.existsSync(file)) {
        let pid: number;
        try { pid = JSON.parse(fs.readFileSync(file, 'utf8')).pid; } catch { throw new WorkspaceError('Workspace lock is invalid; inspect workspace.lock before reopening'); }
        if (!Number.isSafeInteger(pid) || pid <= 0) throw new WorkspaceError('Workspace lock has an invalid process ID');
        let alive = true;
        try { process.kill(pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false; }
        if (alive) throw new WorkspaceError('This workspace is already open in another process', 409);
        // All acquisition/recovery is serialized by the exclusive guard; no second opener can replace this path here.
        fs.unlinkSync(file);
      }
      fs.writeFileSync(file, JSON.stringify({ pid: process.pid, nonce: this.lockNonce }), { flag: 'wx', mode: 0o600 });
    } finally { fs.unlinkSync(guard); }
  }
  private releaseLock() {
    const file = path.join(this.directory, 'workspace.lock');
    try { if (JSON.parse(fs.readFileSync(file, 'utf8')).nonce === this.lockNonce) fs.unlinkSync(file); } catch { /* A failed cleanup must not remove another process's lock. */ }
  }
  private readManifest(): Manifest {
    const file = path.join(this.directory, 'workspace.json'); this.regularFile(file);
    const value = JSON.parse(fs.readFileSync(file, 'utf8')) as Manifest;
    if (value.schemaVersion !== 1 || typeof value.root !== 'string' || !(value.project === null || typeof value.project === 'string') ||
      !Array.isArray(value.snapshots) || !Array.isArray(value.featureVersions) || !Array.isArray(value.tasks) || !value.view ||
      value.snapshots.some(entry => !digestPattern.test(entry.id) || !digestPattern.test(entry.storageDigest)) || value.featureVersions.some(entry => !digestPattern.test(entry.digest) || !digestPattern.test(entry.basisSnapshot)) ||
      value.tasks.some(task => !taskPattern.test(task.id) || !value.snapshots.some(entry => entry.id === task.snapshot) || task.featureDigest !== null && !value.featureVersions.some(entry => entry.digest === task.featureDigest)) ||
      value.latestSnapshot !== null && !value.snapshots.some(entry => entry.id === value.latestSnapshot) ||
      value.featureHead !== null && !value.featureVersions.some(entry => entry.digest === value.featureHead) ||
      value.activeTaskId !== null && !value.tasks.some(task => task.id === value.activeTaskId) ||
      value.view.snapshot !== null && !value.snapshots.some(entry => entry.id === value.view.snapshot) ||
      value.view.taskId !== null && !value.tasks.some(task => task.id === value.view.taskId) ||
      value.view.featureDigest !== undefined && value.view.featureDigest !== null && !value.featureVersions.some(entry => entry.digest === value.view.featureDigest) ||
      value.view.readOnly !== undefined && typeof value.view.readOnly !== 'boolean')
      throw new WorkspaceError('Unsupported or damaged workspace manifest; existing data was not replaced', 500);
    return value;
  }
  private writeDurable(file: string, content: string) {
    const fd = fs.openSync(file, 'wx', 0o600);
    try { fs.writeFileSync(fd, content, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
  private commit(next: Manifest) {
    this.assertStorage();
    const file = path.join(this.directory, 'workspace.json'); this.regularFile(file);
    const temporary = path.join(this.directory, `state-${randomUUID()}.tmp`);
    try {
      this.writeDurable(temporary, JSON.stringify(next, null, 2));
      fs.renameSync(temporary, file);
      this.manifest = next;
    } finally { try { fs.unlinkSync(temporary); } catch { /* Rename already removed it, or the failed write never created it. */ } }
  }
  private immutable(directory: 'snapshots' | 'features', id: string, value: unknown) {
    if (!digestPattern.test(id)) throw new WorkspaceError('Invalid version identifier');
    const file = path.join(this.ensureDirectory(directory), id + '.json');
    if (this.regularFile(file)) {
      const raw = fs.readFileSync(file, 'utf8'), digest = hash(raw);
      if (directory === 'features') {
        if (hash(JSON.stringify(featureApi.validate(JSON.parse(raw)))) !== id) throw new WorkspaceError('Stored annotation version is damaged', 500);
      } else {
        const entry = this.manifest.snapshots.find(entry => entry.id === id);
        if (entry) {
          if (entry.storageDigest !== digest) throw new WorkspaceError('Stored code version is damaged', 500);
        } else {
          // A failed publication may leave an orphan. Reuse only a complete, equivalent result; auxiliary timestamps/Git metadata can differ.
          const previous = JSON.parse(raw) as WorkspaceAnalysis, current = value as WorkspaceAnalysis;
          const stableGraph = (graph: CodeGraph) => ({ ...graph, project: { ...graph.project, createdAt: '', commit: null, dirty: null } });
          if (!previous.graph || !previous.inputs || previous.inputs.root !== this.root ||
            JSON.stringify(stableGraph(previous.graph)) !== JSON.stringify(stableGraph(current.graph)) ||
            analysisInputDigest(previous.inputs) !== analysisInputDigest(current.inputs))
            throw new WorkspaceError('An incomplete or damaged unpublished code version exists; it was not reused', 500);
        }
      }
      return digest;
    }
    const temporary = path.join(this.ensureDirectory(directory), `${id}-${randomUUID()}.tmp`);
    const content = JSON.stringify(value);
    try { this.writeDurable(temporary, content); fs.renameSync(temporary, file); }
    finally { try { fs.unlinkSync(temporary); } catch { /* Already renamed. */ } }
    return hash(content);
  }
  private readSnapshot(id: string): WorkspaceAnalysis {
    if (!digestPattern.test(id) || !this.manifest.snapshots.some(entry => entry.id === id)) throw new WorkspaceError('Unknown code version', 404);
    const file = path.join(this.ensureDirectory('snapshots'), id + '.json'); this.regularFile(file);
    const raw = fs.readFileSync(file, 'utf8');
    if (hash(raw) !== this.manifest.snapshots.find(entry => entry.id === id)!.storageDigest) throw new WorkspaceError('Stored code version is damaged', 500);
    const result = JSON.parse(raw) as WorkspaceAnalysis;
    if (result.graph?.schemaVersion !== 1 || result.graph.project.snapshot !== id || !Array.isArray(result.graph.nodes) || !result.inputs || result.inputs.schemaVersion !== 1 || fileKey(result.inputs.root) !== fileKey(this.root))
      throw new WorkspaceError('Stored code version is damaged', 500);
    return result;
  }
  getGraph(id: string): CodeGraph { return this.readSnapshot(id).graph; }
  getFeatures(digest: string | null = this.manifest.featureHead): FeatureMap | undefined {
    if (digest === null) return undefined;
    if (!digestPattern.test(digest) || !this.manifest.featureVersions.some(entry => entry.digest === digest)) throw new WorkspaceError('Unknown annotation version', 404);
    const file = path.join(this.ensureDirectory('features'), digest + '.json'); this.regularFile(file);
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const document = featureApi.validate(raw);
    if (hash(JSON.stringify(document)) !== digest) throw new WorkspaceError('Stored annotation version is damaged', 500);
    return document;
  }
  get featureDigest(): string | null { return this.manifest.featureHead; }
  getTask(id: string): WorkspaceTask {
    const task = this.manifest.tasks.find(task => task.id === id);
    if (!task) throw new WorkspaceError('Unknown task starting point', 404);
    return { ...task };
  }
  state() {
    return { schemaVersion: 1, workspace: { name: path.basename(this.root), root: this.root, directory: this.directory, project: this.project ?? null, createdAt: this.manifest.createdAt },
      status: this.phase, statusMessage: this.establishing ? '正在核对文件并建立本轮起点' : this.message, error: this.error,
      lastCheckedAt: this.lastCheckedAt, latestSnapshot: this.manifest.latestSnapshot,
      snapshots: this.manifest.snapshots.map(entry => ({ ...entry })),
      feature: this.manifest.featureVersions.find(entry => entry.digest === this.manifest.featureHead) ?? null,
      tasks: this.manifest.tasks.map(task => ({ ...task })), activeTaskId: this.manifest.activeTaskId,
      view: { ...this.manifest.view, featureDigest: this.manifest.view.featureDigest === undefined ? this.manifest.featureHead : this.manifest.view.featureDigest, readOnly: this.manifest.view.readOnly ?? false },
      watch: { active: this.watchActive, reconciliationMs: this.reconcileMs, scope: 'saved-files' } };
  }
  start() {
    if (this.started || this.stopped) return; this.started = true;
    if (this.options.watch !== false) {
      try {
        this.watcher = fs.watch(this.root, { recursive: true }, () => this.scheduleObservation());
        this.watchActive = true;
        this.watcher.on('error', () => { this.watchActive = false; this.watcher?.close(); this.watcher = null; this.scheduleObservation(); });
      } catch { this.watchActive = false; }
    }
    if (this.reconcileMs) this.interval = setInterval(() => this.scheduleObservation(), this.reconcileMs);
    void this.refresh(true).catch(() => undefined);
  }
  private scheduleObservation() {
    if (this.stopped) return;
    this.pending = true;
    if (!this.running) { this.phase = 'changed'; this.message = '检测到文件活动，正在核对已保存内容'; }
    this.schedule();
  }
  private schedule() {
    if (this.timer || this.running || this.stopped) return;
    this.timer = setTimeout(() => { this.timer = null; this.running = this.run().finally(() => {
      this.running = null; if (this.pending && !this.stopped) this.schedule();
    }); }, this.options.debounceMs ?? 300);
  }
  refresh(force = false): Promise<WorkspaceSnapshot> {
    if (this.stopped) return Promise.reject(new WorkspaceError('Workspace is closed', 409));
    const sequence = ++this.sequence; this.pending = true; this.force ||= force;
    const result = new Promise<WorkspaceSnapshot>((resolve, reject) => this.waiters.push({ sequence, resolve, reject }));
    this.schedule(); return result;
  }
  private async run() {
    const sequence = this.sequence, force = this.force;
    this.pending = false; this.force = false; this.error = null;
    const finish = (entry?: WorkspaceSnapshot, error?: Error) => {
      const waiting = this.waiters.filter(waiter => waiter.sequence <= sequence);
      this.waiters = this.waiters.filter(waiter => waiter.sequence > sequence);
      for (const waiter of waiting) { if (error) waiter.reject(error); else waiter.resolve(entry!); }
    };
    try {
      this.phase = 'checking'; this.message = '正在核对源文件、配置和解析输入';
      if (this.manifest.latestSnapshot) this.readSnapshot(this.manifest.latestSnapshot);
      if (!force && this.latestInputs && this.checkInputs(this.latestInputs).current && this.manifest.latestSnapshot) {
        this.lastCheckedAt = new Date().toISOString(); this.phase = 'current'; this.message = '已核对已保存文件';
        finish(this.manifest.snapshots.find(entry => entry.id === this.manifest.latestSnapshot)!); return;
      }
      this.phase = 'analyzing'; this.message = '正在重建代码图，当前阅读版本保持不变';
      const result = await this.runAnalysis(this.root, this.project, this.abort.signal);
      if (this.stopped) { finish(undefined, new WorkspaceError('Workspace is closed', 409)); return; }
      const checked = this.checkInputs(result.inputs);
      if (!checked.current) throw new WorkspaceError('分析期间文件仍在变化；保留上一份图，稍后重新核对', 409);
      const now = new Date().toISOString(), id = result.graph.project.snapshot;
      let entry = this.manifest.snapshots.find(entry => entry.id === id);
      const storageDigest = this.immutable('snapshots', id, result);
      let next = { ...this.manifest };
      if (!entry) {
        entry = { id, storageDigest, createdAt: result.graph.project.createdAt, verifiedAt: now, indexedFiles: result.graph.files.length };
        next.snapshots = [...next.snapshots, entry];
      }
      if (!next.featureHead) {
        const document = this.initialFeatures === undefined ? featureApi.create(result.graph) : featureApi.validate(this.initialFeatures);
        if (featureApi.assess(result.graph, document).globalIssues.length) throw new WorkspaceError('Initial annotations must match the analyzed code version; use the original paired report or migrate explicitly');
        const digest = hash(JSON.stringify(document)); this.immutable('features', digest, document);
        next.featureHead = digest; next.featureVersions = [{ digest, basisSnapshot: document.basis.snapshot, revision: document.revision, savedAt: now }];
      }
      // Immutable files can be written before publication; a late edit must not move the current pointer.
      if (!this.checkInputs(result.inputs).current) throw new WorkspaceError('发布前发现新的文件变化；继续保留上一份图', 409);
      next.latestSnapshot = id;
      if (!next.view.snapshot) next.view = { ...next.view, snapshot: id, featureDigest: next.featureHead, readOnly: false };
      if (next.latestSnapshot !== this.manifest.latestSnapshot || next.featureHead !== this.manifest.featureHead || next.snapshots !== this.manifest.snapshots)
        this.commit(next);
      this.latestInputs = result.inputs; this.initialFeatures = undefined;
      this.lastCheckedAt = now; this.phase = 'current'; this.message = '已核对已保存文件';
      finish(entry);
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      this.phase = this.stopped ? 'closed' : failure instanceof WorkspaceError && failure.statusCode === 409 ? 'changed' : 'error';
      this.error = failure.message; this.message = this.stopped ? '工作区已关闭' : failure.message;
      finish(undefined, failure);
      // Continuous edits remain visible as pending; retry on the next watch event/reconciliation instead of blocking the UI.
    }
  }
  saveFeatures(document: unknown, expectedDigest: string | null): WorkspaceFeature {
    if (this.stopped) throw new WorkspaceError('Workspace is closed', 409);
    if (expectedDigest !== this.manifest.featureHead) throw new WorkspaceError('标注已在其他页面更新；当前草稿已保留，请先导出并核对版本', 409);
    const validated = featureApi.validate(document);
    const basis = this.getGraph(validated.basis.snapshot);
    if (featureApi.assess(basis, validated).globalIssues.length) throw new WorkspaceError('Annotation basis does not match its stored code version');
    const digest = hash(JSON.stringify(validated));
    const previous = this.manifest.featureVersions.find(entry => entry.digest === digest);
    if (digest === this.manifest.featureHead) return { ...previous! };
    const entry = previous ?? { digest, basisSnapshot: validated.basis.snapshot, revision: validated.revision, savedAt: new Date().toISOString() };
    this.immutable('features', digest, validated);
    const view = !this.manifest.view.readOnly && (this.manifest.view.featureDigest === undefined || this.manifest.view.featureDigest === expectedDigest)
      ? { ...this.manifest.view, featureDigest: digest } : this.manifest.view;
    this.commit({ ...this.manifest, view, featureHead: digest, featureVersions: previous ? this.manifest.featureVersions : [...this.manifest.featureVersions, entry] });
    return { ...entry };
  }
  async beginTask(title: string, expectedFeatureDigest: string | null): Promise<WorkspaceTask> {
    if (this.establishing) throw new WorkspaceError('A task starting point is already being established', 409);
    if (typeof title !== 'string' || title.trim().length > 200) throw new WorkspaceError('Task title must be at most 200 characters');
    if (expectedFeatureDigest !== this.manifest.featureHead) throw new WorkspaceError('Annotations changed before the task started; refresh the saved version', 409);
    this.establishing = true;
    try {
      // Always request a fresh run after this action, including when an older run is already in flight.
      const snapshot = await this.refresh(true);
      if (expectedFeatureDigest !== this.manifest.featureHead) throw new WorkspaceError('Annotations changed while establishing the task; retry with the saved version', 409);
      if (!this.latestInputs || !this.checkInputs(this.latestInputs).current || snapshot.id !== this.manifest.latestSnapshot)
        throw new WorkspaceError('Files changed while establishing the task; retry after saving', 409);
      const task: WorkspaceTask = { id: randomUUID(), title: title.trim() || '本轮开发', createdAt: new Date().toISOString(), snapshot: snapshot.id, featureDigest: expectedFeatureDigest };
      this.commit({ ...this.manifest, tasks: [...this.manifest.tasks, task], activeTaskId: task.id, view: { ...this.manifest.view, taskId: task.id } });
      return { ...task };
    } finally { this.establishing = false; }
  }
  saveView(view: WorkspaceView) {
    if (this.stopped) throw new WorkspaceError('Workspace is closed', 409);
    if (view.snapshot !== null && !this.manifest.snapshots.some(entry => entry.id === view.snapshot)) throw new WorkspaceError('Unknown viewed code version');
    if (view.taskId !== null && !this.manifest.tasks.some(task => task.id === view.taskId)) throw new WorkspaceError('Unknown selected task');
    const featureDigest = view.featureDigest === undefined ? this.manifest.featureHead : view.featureDigest;
    if (featureDigest !== null && !this.manifest.featureVersions.some(entry => entry.digest === featureDigest)) throw new WorkspaceError('Unknown viewed annotation version');
    const readOnly = view.readOnly === true || featureDigest !== this.manifest.featureHead;
    const next = { snapshot: view.snapshot, taskId: view.taskId, featureDigest, readOnly };
    if (JSON.stringify(next) === JSON.stringify(this.manifest.view)) return;
    this.commit({ ...this.manifest, view: next });
  }
  async close() {
    if (this.stopped) return;
    this.stopped = true; this.abort.abort();
    if (this.interval) clearInterval(this.interval);
    if (this.timer) clearTimeout(this.timer);
    this.watcher?.close(); this.watchActive = false;
    for (const waiter of this.waiters) waiter.reject(new WorkspaceError('Workspace is closed', 409));
    this.waiters = [];
    if (this.running) await this.running;
    this.phase = 'closed'; this.message = '工作区已关闭'; this.releaseLock();
  }
}
