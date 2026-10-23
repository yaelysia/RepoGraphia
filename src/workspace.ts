import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import type { CodeGraph } from './model.js';
import { createFeatureMapApi } from './feature-map.js';
import type { FeatureMap } from './feature-map.js';
import { analysisInputDigest, checkAnalysisInputs, fileKey, hash, inside } from './project.js';
import type { AnalysisInputs } from './project.js';
import { AgentError, digest as contentDigest } from './agent.js';
import { createFeatureTask, validateFeatureTaskBundle, checkFeatureRevision } from './feature-tasks.js';
import type { FeatureTaskBundle, FeatureRevision, FeatureRevisionReview } from './feature-tasks.js';
import { checkFeatureReferences } from './feature-references.js';
import type { FeatureReferenceVersion } from './feature-references.js';
import { emptyFeatureWork, validFeatureWork, featureTaskScope, featureExploration, appliedInDocument, proposalExploration } from './workspace-feature-store.js';
import type { FeatureWorkState, TaskMeta, ProposalMeta, PrepareFeatureTask, DecideFeatureProposal, ExplorationRecord } from './workspace-feature-store.js';
import { compareDevelopmentReview, developmentReviewDigest } from './development-review.js';
import type { DevelopmentIntent, DevelopmentReviewReport } from './development-review.js';
import { DevelopmentReviewError, emptyDevelopmentReview, prepareDevelopmentIntent, prepareDevelopmentRecord,
  validDevelopmentIntent, validDevelopmentReviewState, validateDevelopmentRecordRequest } from './development-review-store.js';
import type { DevelopmentReviewState, DevelopmentReportMeta, DevelopmentRecord, DevelopmentReviewResponse, RecordDevelopmentReview } from './development-review-store.js';

export interface WorkspaceSnapshot { id: string; storageDigest: string; createdAt: string; verifiedAt: string; indexedFiles: number }
export interface WorkspaceFeature { digest: string; basisSnapshot: string; revision: number; savedAt: string }
export interface WorkspaceTask { id: string; title: string; createdAt: string; snapshot: string; featureDigest: string | null; intent?: DevelopmentIntent }
export interface WorkspaceView { snapshot: string | null; taskId: string | null; featureDigest?: string | null; readOnly?: boolean }
interface Manifest {
  schemaVersion: 1; root: string; project: string | null; createdAt: string;
  snapshots: WorkspaceSnapshot[]; latestSnapshot: string | null;
  featureVersions: WorkspaceFeature[]; featureHead: string | null;
  tasks: WorkspaceTask[]; activeTaskId: string | null; view: WorkspaceView;
  /** Absent on M1 workspaces. Adding feature tasks never rewrites the older development-task contract. */
  featureWork?: FeatureWorkState;
  /** Optional M3 records. They never stand in for feature-mapping decisions or executed tests. */
  developmentReview?: DevelopmentReviewState;
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
      value.tasks.some(task => !taskPattern.test(task.id) || !value.snapshots.some(entry => entry.id === task.snapshot) || task.featureDigest !== null && !value.featureVersions.some(entry => entry.digest === task.featureDigest) ||
        task.intent !== undefined && !validDevelopmentIntent(task.intent)) ||
      value.latestSnapshot !== null && !value.snapshots.some(entry => entry.id === value.latestSnapshot) ||
      value.featureHead !== null && !value.featureVersions.some(entry => entry.digest === value.featureHead) ||
      value.activeTaskId !== null && !value.tasks.some(task => task.id === value.activeTaskId) ||
      value.view.snapshot !== null && !value.snapshots.some(entry => entry.id === value.view.snapshot) ||
      value.view.taskId !== null && !value.tasks.some(task => task.id === value.view.taskId) ||
      value.view.featureDigest !== undefined && value.view.featureDigest !== null && !value.featureVersions.some(entry => entry.digest === value.view.featureDigest) ||
      value.view.readOnly !== undefined && typeof value.view.readOnly !== 'boolean' ||
      value.featureWork !== undefined && (!validFeatureWork(value.featureWork) ||
        value.featureWork.tasks.some(task => !value.snapshots.some(entry => entry.id === task.basis.snapshot) ||
          !value.featureVersions.some(entry => entry.digest === task.featureDigest)) ||
        value.featureWork.proposals.some(proposal => proposal.status === 'applied' &&
          !value.featureVersions.some(entry => entry.digest === proposal.decision!.featureDigest))) ||
      value.developmentReview !== undefined && (!validDevelopmentReviewState(value.developmentReview) ||
        value.developmentReview.reports.some(report => {
          const task = value.tasks.find(task => task.id === report.taskId);
          return !task || task.snapshot !== report.before.snapshot || task.featureDigest !== report.before.featureDigest ||
            !value.snapshots.some(entry => entry.id === report.after.snapshot) ||
            [report.before, report.after].some(version => version.featureDigest !== null &&
              !value.featureVersions.some(entry => entry.digest === version.featureDigest && entry.revision === version.featureRevision));
        })))
      throw new WorkspaceError('Unsupported or damaged workspace manifest; existing data was not replaced', 500);
    return value;
  }
  private writeDurable(file: string, content: string) {
    const fd = fs.openSync(file, 'wx', 0o600);
    try { fs.writeFileSync(fd, content, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
  private commit(next: Manifest, beforePublish?: () => void) {
    this.assertStorage();
    const file = path.join(this.directory, 'workspace.json'); this.regularFile(file);
    const temporary = path.join(this.directory, `state-${randomUUID()}.tmp`);
    try {
      this.writeDurable(temporary, JSON.stringify(next, null, 2));
      beforePublish?.();
      fs.renameSync(temporary, file);
      this.manifest = next;
    } finally { try { fs.unlinkSync(temporary); } catch { /* Rename already removed it, or the failed write never created it. */ } }
  }
  private immutable(directory: 'snapshots' | 'features' | 'feature-tasks' | 'feature-proposals' | 'development-reviews', id: string, value: unknown) {
    if (!digestPattern.test(id)) throw new WorkspaceError('Invalid version identifier');
    if (directory !== 'snapshots' && hash(JSON.stringify(value)) !== id) throw new WorkspaceError('Content does not match its immutable identifier', 500);
    const file = path.join(this.ensureDirectory(directory), id + '.json');
    if (this.regularFile(file)) {
      const raw = fs.readFileSync(file, 'utf8'), digest = hash(raw);
      if (directory === 'features') {
        if (hash(JSON.stringify(featureApi.validate(JSON.parse(raw)))) !== id) throw new WorkspaceError('Stored annotation version is damaged', 500);
      } else if (directory === 'snapshots') {
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
      } else if (digest !== id) throw new WorkspaceError('Stored feature task or proposal is damaged', 500);
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

  private featureOperation<T>(operation: () => T): T {
    try { return operation(); }
    catch (error) {
      if (error instanceof WorkspaceError) throw error;
      if (error instanceof DevelopmentReviewError) throw new WorkspaceError(error.message, error.statusCode);
      if (error instanceof AgentError) throw new WorkspaceError(error.message, error.code === 'TASK_CONFLICT' ? 409 : 400);
      throw new WorkspaceError(error instanceof Error ? error.message : String(error),
        error && typeof error === 'object' && 'code' in error ? 500 : 400);
    }
  }
  private featureObject(value: unknown, keys: string[]) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key)))
      throw new WorkspaceError('Invalid feature-work input or unknown field');
  }
  private assertOpen() {
    if (this.stopped) throw new WorkspaceError('Workspace is closed', 409);
  }
  private checkedFeatureBaseline(snapshot: string, digest: string): WorkspaceAnalysis {
    this.assertOpen();
    if (typeof snapshot !== 'string' || !digestPattern.test(snapshot) || typeof digest !== 'string' || !digestPattern.test(digest))
      throw new WorkspaceError('An explicit code snapshot and annotation digest are required');
    if (snapshot !== this.manifest.latestSnapshot || digest !== this.manifest.featureHead)
      throw new WorkspaceError('代码或标注基线已变化；请核对当前版本后重新准备任务', 409);
    const version = this.readSnapshot(snapshot);
    if (!this.checkInputs(version.inputs).current) throw new WorkspaceError('已保存的代码输入发生变化；请先刷新代码图', 409);
    return version;
  }
  private featureWorkState(): FeatureWorkState { return this.manifest.featureWork ?? emptyFeatureWork(); }
  private featureTaskMeta(id: string): TaskMeta {
    const task = this.featureWorkState().tasks.find(task => task.id === id);
    if (!task) throw new WorkspaceError('Unknown feature analysis task', 404);
    return task;
  }
  private featureProposalMeta(id: string): ProposalMeta {
    const proposal = this.featureWorkState().proposals.find(proposal => proposal.id === id);
    if (!proposal) throw new WorkspaceError('Unknown feature proposal', 404);
    return proposal;
  }
  private readFeatureBlob(directory: 'feature-tasks' | 'feature-proposals', digest: string): unknown {
    if (!digestPattern.test(digest)) throw new WorkspaceError('Invalid stored feature-work identifier', 500);
    const file = path.join(this.ensureDirectory(directory), digest + '.json'), stat = this.regularFile(file);
    if (!stat || stat.size > (directory === 'feature-tasks' ? 192 : 5) * 1024 * 1024)
      throw new WorkspaceError('Stored feature task or proposal is missing or exceeds its budget', 500);
    const raw = fs.readFileSync(file, 'utf8');
    if (hash(raw) !== digest) throw new WorkspaceError('Stored feature task or proposal is damaged', 500);
    try { return JSON.parse(raw); } catch { throw new WorkspaceError('Stored feature task or proposal is damaged', 500); }
  }
  featureTaskBundle(id: string): FeatureTaskBundle {
    return this.featureOperation(() => {
      const metadata = this.featureTaskMeta(id), raw = this.readFeatureBlob('feature-tasks', metadata.bundleDigest);
      const bundle = validateFeatureTaskBundle(raw), { taskDigest, bundleDigest: _, ...task } = metadata;
      if (contentDigest(bundle.task) !== contentDigest(task) || bundle.taskDigest !== taskDigest)
        throw new WorkspaceError('Stored task metadata does not match its immutable bundle', 500);
      return bundle;
    });
  }
  private storedFeatureProposal(metadata: ProposalMeta): FeatureRevision {
    const raw = this.readFeatureBlob('feature-proposals', metadata.contentDigest) as FeatureRevision;
    if (raw?.taskId !== metadata.taskId || raw.batchId !== metadata.batchId || raw.summary !== metadata.summary)
      throw new WorkspaceError('Stored proposal metadata does not match its immutable content', 500);
    return raw;
  }
  private referenceHistory(map: FeatureMap): Map<string, FeatureReferenceVersion> {
    const history = new Map<string, FeatureReferenceVersion>();
    const ids = new Set(map.mappings.map(mapping => (mapping.basis ?? map.basis).snapshot));
    for (const id of ids) if (this.manifest.snapshots.some(version => version.id === id)) history.set(id, this.readSnapshot(id));
    return history;
  }
  private explorationRecords(map: FeatureMap): ExplorationRecord[] {
    const records: ExplorationRecord[] = [], bundles = new Map<string, FeatureTaskBundle>();
    for (const metadata of this.featureWorkState().proposals) {
      if (!appliedInDocument(map, metadata)) continue;
      let bundle = bundles.get(metadata.taskId);
      if (!bundle) { bundle = this.featureTaskBundle(metadata.taskId); bundles.set(metadata.taskId, bundle); }
      const proposal = this.storedFeatureProposal(metadata);
      records.push(...proposalExploration(metadata, proposal, bundle.task, bundle.graph));
    }
    return records;
  }
  featureWork(snapshot?: string, featureDigest?: string) {
    return this.featureOperation(() => {
      const selected = snapshot ?? this.manifest.latestSnapshot, digest = featureDigest ?? this.manifest.featureHead;
      if (!selected || !digest) throw new WorkspaceError('Code and annotations are not ready; refresh the workspace first', 409);
      const current = this.readSnapshot(selected), map = this.getFeatures(digest)!;
      const references = checkFeatureReferences(current, map, this.referenceHistory(map));
      const exploration = featureExploration(current.graph, this.explorationRecords(map));
      const work = this.featureWorkState();
      return { snapshot: selected, featureDigest: digest, features: structuredClone(map.features),
        tasks: structuredClone(work.tasks), proposals: structuredClone(work.proposals), references, exploration,
        coverage: structuredClone(current.graph.coverage) };
    });
  }
  prepareFeatureTask(input: PrepareFeatureTask): TaskMeta {
    return this.featureOperation(() => {
      this.assertOpen(); this.featureObject(input, ['kind','featureId','goal','expectedSnapshot','expectedFeatureDigest']);
      if (!['overview','feature','changes'].includes(input.kind) || typeof input.goal !== 'string' || !input.goal.trim() || input.goal.length > 2000 ||
        input.kind !== 'feature' && input.featureId !== undefined) throw new WorkspaceError('Invalid feature task kind, target, or goal');
      const current = this.checkedFeatureBaseline(input.expectedSnapshot, input.expectedFeatureDigest);
      const map = this.getFeatures(input.expectedFeatureDigest)!;
      if (input.kind === 'feature' && !map.features.some(feature => feature.id === input.featureId)) throw new WorkspaceError('Unknown selected feature', 404);
      const work = this.featureWork(input.expectedSnapshot, input.expectedFeatureDigest);
      const allowed = featureTaskScope(current.graph, map, work.references, work.exploration, input.kind, input.featureId);
      const bundle = createFeatureTask(current.graph, map, input.kind, input.goal, allowed);
      bundle.references = { references: work.references, exploration: work.exploration, coverage: work.coverage };
      if (Buffer.byteLength(JSON.stringify(bundle)) > 192 * 1024 * 1024) throw new WorkspaceError('Task bundle exceeds 192 MiB; narrow the indexed project');
      const metadata: TaskMeta = { ...bundle.task, taskDigest: bundle.taskDigest, bundleDigest: contentDigest(bundle) };
      this.immutable('feature-tasks', metadata.bundleDigest, bundle);
      const state = this.featureWorkState();
      this.commit({ ...this.manifest, featureWork: { ...state, tasks: [...state.tasks, metadata] } },
        () => { this.checkedFeatureBaseline(input.expectedSnapshot, input.expectedFeatureDigest); });
      return structuredClone(metadata);
    });
  }
  importFeatureProposal(input: { proposal: unknown; author: string }): ProposalMeta {
    return this.featureOperation(() => {
      this.assertOpen(); this.featureObject(input, ['proposal','author']);
      this.featureObject(input.proposal, ['revisionProtocol','taskId','taskDigest','snapshot','baseDigest','expectedRevision','batchId','summary','features','mappings','retractions','checks','exploredFiles','unexplored']);
      const proposal = input.proposal as FeatureRevision, bundle = this.featureTaskBundle(proposal.taskId), now = new Date().toISOString();
      checkFeatureRevision(bundle, proposal, input.author, now);
      if (Buffer.byteLength(JSON.stringify(proposal)) > 5 * 1024 * 1024) throw new WorkspaceError('Proposal exceeds 5 MiB');
      const id = contentDigest(proposal), state = this.featureWorkState(), previous = state.proposals.find(item => item.id === id);
      if (previous) { this.storedFeatureProposal(previous); return structuredClone(previous); }
      if (state.proposals.some(item => item.taskId === proposal.taskId && item.batchId === proposal.batchId))
        throw new WorkspaceError('This task batch ID already identifies different proposal content; use a new batch ID', 409);
      const metadata: ProposalMeta = { id, contentDigest: id, taskId: proposal.taskId, batchId: proposal.batchId, summary: proposal.summary,
        author: input.author, createdAt: now, status: 'pending' };
      this.immutable('feature-proposals', id, proposal);
      this.assertOpen(); this.commit({ ...this.manifest, featureWork: { ...state, proposals: [...state.proposals, metadata] } });
      return structuredClone(metadata);
    });
  }
  private featureProposalReview(metadata: ProposalMeta, task: TaskMeta, result: FeatureRevisionReview) {
    const { document: _, ...review } = result, reasons: string[] = [];
    if (metadata.status !== 'pending') return { ...review, status: metadata.status, reasons };
    if (this.stopped) reasons.push('workspace-closed');
    if (task.basis.snapshot !== this.manifest.latestSnapshot) reasons.push('snapshot-conflict');
    if (task.featureDigest !== this.manifest.featureHead) reasons.push('feature-conflict');
    if (!reasons.length && !this.checkInputs(this.readSnapshot(task.basis.snapshot).inputs).current) reasons.push('saved-inputs-changed');
    return { ...review, status: reasons.length ? 'stale' : 'ready', reasons };
  }
  featureProposal(id: string) {
    return this.featureOperation(() => {
      const metadata = this.featureProposalMeta(id), task = this.featureTaskMeta(metadata.taskId), bundle = this.featureTaskBundle(task.id);
      const proposal = this.storedFeatureProposal(metadata), result = checkFeatureRevision(bundle, proposal, metadata.author, metadata.createdAt);
      return { proposal, metadata: structuredClone(metadata), task: structuredClone(task), review: this.featureProposalReview(metadata, task, result) };
    });
  }
  decideFeatureProposal(id: string, input: DecideFeatureProposal): { proposal: ProposalMeta; feature?: WorkspaceFeature } {
    return this.featureOperation(() => {
      this.assertOpen(); this.featureObject(input, ['decision','actor','reason','expectedSnapshot','expectedFeatureDigest']);
      if (!['apply','reject'].includes(input.decision) || typeof input.actor !== 'string' || !input.actor.trim() || input.actor.length > 200 ||
        typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 8000 ||
        typeof input.expectedSnapshot !== 'string' || !digestPattern.test(input.expectedSnapshot) ||
        typeof input.expectedFeatureDigest !== 'string' || !digestPattern.test(input.expectedFeatureDigest)) throw new WorkspaceError('Invalid proposal decision, reviewer, reason, or explicit baseline');
      const metadata = this.featureProposalMeta(id);
      if (metadata.status !== 'pending') throw new WorkspaceError('This proposal already has a recorded decision', 409);
      const task = this.featureTaskMeta(metadata.taskId), bundle = this.featureTaskBundle(task.id), proposal = this.storedFeatureProposal(metadata);
      const result = checkFeatureRevision(bundle, proposal, metadata.author, metadata.createdAt), now = new Date().toISOString();
      const decided: ProposalMeta = { ...metadata, status: input.decision === 'apply' ? 'applied' : 'rejected',
        decision: { decision: input.decision, actor: input.actor, actorKind: 'manual', reason: input.reason, at: now, batchId: proposal.batchId } };
      let feature: WorkspaceFeature | undefined, next: Manifest = { ...this.manifest };
      if (input.decision === 'apply') {
        this.checkedFeatureBaseline(input.expectedSnapshot, input.expectedFeatureDigest);
        if (task.basis.snapshot !== input.expectedSnapshot || task.featureDigest !== input.expectedFeatureDigest)
          throw new WorkspaceError('This proposal belongs to an older baseline; keep it for review and prepare a current task', 409);
        const document = result.document;
        document.revision++;
        document.history.push({ revision: document.revision, actor: input.actor, actorKind: 'manual', at: now, reason: input.reason,
          operation: 'migration', subject: metadata.id,
          before: { featureDigest: task.featureDigest, revision: bundle.features.revision },
          after: { kind: 'feature-task-apply', taskId: task.id, proposalDigest: metadata.contentDigest, batchId: proposal.batchId, author: metadata.author, snapshot: task.basis.snapshot } });
        const validated = featureApi.validate(document), digest = contentDigest(validated);
        const previous = this.manifest.featureVersions.find(entry => entry.digest === digest);
        feature = previous ?? { digest, basisSnapshot: validated.basis.snapshot, revision: validated.revision, savedAt: now };
        this.immutable('features', digest, validated);
        decided.decision!.featureDigest = digest;
        next.featureHead = digest; next.featureVersions = previous ? next.featureVersions : [...next.featureVersions, feature];
        if (!next.view.readOnly && (next.view.featureDigest === undefined || next.view.featureDigest === input.expectedFeatureDigest))
          next.view = { ...next.view, featureDigest: digest };
      }
      const state = this.featureWorkState();
      next.featureWork = { ...state, proposals: state.proposals.map(item => item.id === id ? decided : item) };
      // Check after immutable writes AND the durable manifest temporary, immediately before the sole publication rename.
      this.assertOpen(); this.commit(next, input.decision === 'apply'
        ? () => { this.checkedFeatureBaseline(input.expectedSnapshot, input.expectedFeatureDigest); } : undefined);
      return { proposal: structuredClone(decided), ...(feature ? { feature: { ...feature } } : {}) };
    });
  }
  getTask(id: string): WorkspaceTask {
    const task = this.manifest.tasks.find(task => task.id === id);
    if (!task) throw new WorkspaceError('Unknown task starting point', 404);
    return structuredClone(task);
  }

  private developmentState(): DevelopmentReviewState { return this.manifest.developmentReview ?? emptyDevelopmentReview(); }
  private developmentCurrent(snapshot: string, featureDigest: string | null) {
    const reasons: string[] = [];
    if (this.stopped) reasons.push('工作区已关闭，当前记录只读');
    if (snapshot !== this.manifest.latestSnapshot) reasons.push('代码已有新版本，这份比较保留原版本');
    if (featureDigest !== this.manifest.featureHead) reasons.push('功能标注已有新版本，这份比较保留原标注');
    if (!reasons.length && !this.checkInputs(this.readSnapshot(snapshot).inputs).current)
      reasons.push('已保存代码发生变化，请先更新代码图再审阅');
    return { writable: !reasons.length, reasons };
  }
  private assertDevelopmentCurrent(snapshot: string, featureDigest: string | null) {
    const current = this.developmentCurrent(snapshot, featureDigest);
    if (!current.writable) throw new WorkspaceError(current.reasons.join('；'), 409);
  }
  private readDevelopmentReport(metadata: DevelopmentReportMeta): DevelopmentReviewReport {
    const file = path.join(this.ensureDirectory('development-reviews'), metadata.storageDigest + '.json'), stat = this.regularFile(file);
    if (!stat || stat.size > 192 * 1024 * 1024) throw new WorkspaceError('已保存的开发比较缺失或超出读取预算', 500);
    const raw = fs.readFileSync(file, 'utf8');
    if (hash(raw) !== metadata.storageDigest) throw new WorkspaceError('已保存的开发比较内容损坏，原记录未被替换', 500);
    let report: DevelopmentReviewReport;
    try { report = JSON.parse(raw); } catch { throw new WorkspaceError('已保存的开发比较不是完整 JSON', 500); }
    if (report.reviewVersion !== 1 || report.comparisonDigest !== metadata.comparisonDigest ||
      developmentReviewDigest(report) !== metadata.comparisonDigest || report.task?.id !== metadata.taskId ||
      contentDigest(report.before) !== contentDigest(metadata.before) || contentDigest(report.after) !== contentDigest(metadata.after))
      throw new WorkspaceError('开发比较内容与固定版本记录不符', 500);
    const task = this.getTask(metadata.taskId);
    if (contentDigest(report.task) !== contentDigest({ id: task.id, title: task.title, ...(task.intent ? { intent: task.intent } : {}) }))
      throw new WorkspaceError('已保存比较的目标与原任务声明不一致，记录未被重写', 500);
    return report;
  }
  private developmentResponse(report: DevelopmentReviewReport, historical = false): DevelopmentReviewResponse {
    const state = this.developmentState(), counts = new Map<string, number>();
    for (const record of state.records) counts.set(record.comparisonDigest, (counts.get(record.comparisonDigest) ?? 0) + 1);
    const records = state.records.filter(record => record.comparisonDigest === report.comparisonDigest);
    // Validate lazily against the fixed report; opening a workspace need not read every historical source bundle.
    for (const { id: _, comparisonDigest: _digest, sequence: _sequence, at: _at, ...record } of records) {
      try { prepareDevelopmentRecord(record, report); }
      catch { throw new WorkspaceError('已保存的审阅对象或内容与固定比较不一致，原记录未被替换', 500); }
    }
    return { report, revision: records.length, records: structuredClone(records),
      history: state.reports.filter(item => item.taskId === report.task.id).map(({ storageDigest: _, ...item }) =>
        ({ ...structuredClone(item), recordCount: counts.get(item.comparisonDigest) ?? 0 })),
      current: historical ? { writable: false, reasons: ['正在查看已保存的历史比较，记录保持只读'] }
        : this.developmentCurrent(report.after.snapshot, report.after.featureDigest) };
  }
  /** A fixed comparison is read-only until a separate review record is explicitly appended. */
  developmentReview(taskId: string, snapshot?: string, featureDigest?: string | null): DevelopmentReviewResponse {
    return this.featureOperation(() => {
      const task = this.getTask(taskId), selected = snapshot ?? this.manifest.latestSnapshot;
      if (!selected) throw new WorkspaceError('代码图尚未准备好，请先检查更新', 409);
      const selectedDigest = featureDigest === undefined ? this.manifest.featureHead : featureDigest;
      const before = this.readSnapshot(task.snapshot), after = this.readSnapshot(selected);
      const beforeFeatures = this.getFeatures(task.featureDigest) ?? null, afterFeatures = this.getFeatures(selectedDigest) ?? null;
      const history = new Map<string, FeatureReferenceVersion>();
      for (const map of [beforeFeatures, afterFeatures]) if (map)
        for (const [id, version] of this.referenceHistory(map)) history.set(id, version);
      const report = compareDevelopmentReview({ task: { id: task.id, title: task.title, ...(task.intent ? { intent: structuredClone(task.intent) } : {}) },
        before: { ...before, features: beforeFeatures }, after: { ...after, features: afterFeatures }, history });
      const stored = this.developmentState().reports.find(item => item.comparisonDigest === report.comparisonDigest);
      return this.developmentResponse(stored ? this.readDevelopmentReport(stored) : report);
    });
  }
  savedDevelopmentReview(comparisonDigest: string): DevelopmentReviewResponse {
    return this.featureOperation(() => {
      const metadata = this.developmentState().reports.find(item => item.comparisonDigest === comparisonDigest);
      if (!metadata) throw new WorkspaceError('没有这份已保存的开发比较', 404);
      return this.developmentResponse(this.readDevelopmentReport(metadata), true);
    });
  }
  /** One manifest publication freezes the report and appends one version-specific declaration. */
  recordDevelopmentReview(input: RecordDevelopmentReview): DevelopmentReviewResponse {
    return this.featureOperation(() => {
      this.assertOpen(); validateDevelopmentRecordRequest(input);
      this.assertDevelopmentCurrent(input.snapshot, input.featureDigest);
      const response = this.developmentReview(input.taskId, input.snapshot, input.featureDigest), report = response.report;
      if (report.comparisonDigest !== input.comparisonDigest) throw new WorkspaceError('比较内容与刚才查看的版本不符，请重新核对，草稿仍可保留', 409);
      if (response.revision !== input.expectedRevision) throw new WorkspaceError('其他页面已记录新的审阅，请先核对记录后重试，草稿仍可保留', 409);
      const record = prepareDevelopmentRecord(input.record, report), state = this.developmentState();
      if (state.records.length >= 100000) throw new WorkspaceError('审阅记录已达到工作区预算，请导出记录后使用新的工作区');
      const now = new Date().toISOString(), storageDigest = contentDigest(report);
      let metadata = state.reports.find(item => item.comparisonDigest === report.comparisonDigest);
      if (!metadata && state.reports.length >= 10000) throw new WorkspaceError('固定比较已达到工作区预算，请导出记录后使用新的工作区');
      if (Buffer.byteLength(JSON.stringify(report)) > 192 * 1024 * 1024) throw new WorkspaceError('开发比较超出 192 MiB，请缩小所选项目范围');
      if (metadata && metadata.storageDigest !== storageDigest) throw new WorkspaceError('已有固定比较与当前内容不一致', 500);
      this.immutable('development-reviews', storageDigest, report);
      const entry: DevelopmentRecord = { ...record, id: randomUUID(), comparisonDigest: report.comparisonDigest,
        sequence: input.expectedRevision + 1, at: now };
      metadata ??= { comparisonDigest: report.comparisonDigest, storageDigest, taskId: input.taskId, createdAt: now,
        before: structuredClone(report.before), after: structuredClone(report.after) };
      const next: DevelopmentReviewState = { ...state,
        reports: state.reports.some(item => item.comparisonDigest === metadata!.comparisonDigest) ? state.reports : [...state.reports, metadata],
        records: [...state.records, entry] };
      this.commit({ ...this.manifest, developmentReview: next }, () => {
        this.assertOpen(); this.assertDevelopmentCurrent(input.snapshot, input.featureDigest);
        if (this.developmentState().records.filter(row => row.comparisonDigest === input.comparisonDigest).length !== input.expectedRevision)
          throw new WorkspaceError('审阅记录在保存期间变化，请核对后重试', 409);
      });
      return this.developmentResponse(report);
    });
  }
  state() {
    return { schemaVersion: 1, workspace: { name: path.basename(this.root), root: this.root, directory: this.directory, project: this.project ?? null, createdAt: this.manifest.createdAt },
      status: this.phase, statusMessage: this.establishing ? '正在核对文件并建立本轮起点' : this.message, error: this.error,
      lastCheckedAt: this.lastCheckedAt, latestSnapshot: this.manifest.latestSnapshot,
      snapshots: this.manifest.snapshots.map(entry => ({ ...entry })),
      feature: this.manifest.featureVersions.find(entry => entry.digest === this.manifest.featureHead) ?? null,
      tasks: structuredClone(this.manifest.tasks), activeTaskId: this.manifest.activeTaskId,
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
  async beginTask(title: string, expectedFeatureDigest: string | null, intent?: unknown): Promise<WorkspaceTask> {
    if (this.stopped) throw new WorkspaceError('Workspace is closed', 409);
    if (this.establishing) throw new WorkspaceError('A task starting point is already being established', 409);
    if (typeof title !== 'string' || title.trim().length > 200) throw new WorkspaceError('Task title must be at most 200 characters');
    if (expectedFeatureDigest !== this.manifest.featureHead) throw new WorkspaceError('Annotations changed before the task started; refresh the saved version', 409);
    const declaration = intent === undefined ? undefined : this.featureOperation(() => prepareDevelopmentIntent(intent, this.getFeatures(expectedFeatureDigest)));
    this.establishing = true;
    try {
      // Always request a fresh run after this action, including when an older run is already in flight.
      const snapshot = await this.refresh(true);
      if (expectedFeatureDigest !== this.manifest.featureHead) throw new WorkspaceError('Annotations changed while establishing the task; retry with the saved version', 409);
      if (!this.latestInputs || !this.checkInputs(this.latestInputs).current || snapshot.id !== this.manifest.latestSnapshot)
        throw new WorkspaceError('Files changed while establishing the task; retry after saving', 409);
      const task: WorkspaceTask = { id: randomUUID(), title: title.trim() || '本轮开发', createdAt: new Date().toISOString(), snapshot: snapshot.id, featureDigest: expectedFeatureDigest,
        ...(declaration ? { intent: declaration } : {}) };
      this.commit({ ...this.manifest, tasks: [...this.manifest.tasks, task], activeTaskId: task.id, view: { ...this.manifest.view, taskId: task.id } }, () => {
        this.assertOpen(); this.assertDevelopmentCurrent(snapshot.id, expectedFeatureDigest);
      });
      return structuredClone(task);
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
