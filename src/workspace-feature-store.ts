import { createFeatureMapApi } from './feature-map.js';
import type { FeatureMap } from './feature-map.js';
import type { FeatureTask, FeatureTaskKind, FeatureRevision } from './feature-tasks.js';
import type { FeatureReferenceReport } from './feature-references.js';
import type { CodeGraph } from './model.js';

/** Mutable status lives in the manifest; the referenced task/proposal content never changes. */
export interface TaskMeta extends FeatureTask { taskDigest: string; bundleDigest: string }
export interface ProposalMeta {
  id: string; contentDigest: string; taskId: string; batchId: string; summary: string;
  author: string; createdAt: string; status: 'pending' | 'applied' | 'rejected';
  decision?: { decision: 'apply' | 'reject'; actor: string; actorKind: 'manual'; reason: string; at: string;
    batchId: string; featureDigest?: string };
}
export interface FeatureWorkState { schemaVersion: 1; tasks: TaskMeta[]; proposals: ProposalMeta[] }
export interface PrepareFeatureTask {
  kind: FeatureTaskKind; featureId?: string; goal: string; expectedSnapshot: string; expectedFeatureDigest: string;
}
export interface DecideFeatureProposal {
  decision: 'apply' | 'reject'; actor: string; reason: string; expectedSnapshot: string; expectedFeatureDigest: string;
}
export interface ExplorationRecord {
  path: string; hash: string; proposalId: string; taskId: string; snapshot: string;
  author: string; appliedAt: string;
}
export interface FeatureExploration {
  files: { path: string; hash: string; status: 'declared' | 'changed' | 'unexplored'; records: ExplorationRecord[] }[];
  summary: { indexed: number; declared: number; changed: number; unexplored: number; limitations: string[] };
}
export const emptyFeatureWork = (): FeatureWorkState => ({ schemaVersion: 1, tasks: [], proposals: [] });
const api = createFeatureMapApi();
const digestPattern = /^[a-f0-9]{64}$/;
const taskPattern = /^[a-f0-9-]{36}$/;
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;
const text = (value: unknown, max: number) => typeof value === 'string' && !!value.trim() && value.length <= max;
const date = (value: unknown) => text(value, 40) && Number.isFinite(Date.parse(value as string));
const object = (value: unknown, keys: string[]) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).every(key => keys.includes(key));
const strings = (value: unknown, max: number) => Array.isArray(value) && value.length <= max &&
  value.every(item => text(item, 2000)) && new Set(value).size === value.length;

/** Manifest validation never repairs, upgrades, or discards stored task decisions. */
export function validFeatureWork(value: unknown): value is FeatureWorkState {
  if (!object(value, ['schemaVersion', 'tasks', 'proposals'])) return false;
  const work = value as FeatureWorkState;
  if (work.schemaVersion !== 1 || !Array.isArray(work.tasks) || !Array.isArray(work.proposals) ||
    new Set(work.tasks.map(task => task?.id)).size !== work.tasks.length ||
    new Set(work.proposals.map(proposal => proposal?.id)).size !== work.proposals.length) return false;
  for (const task of work.tasks) {
    if (!object(task, ['taskVersion','id','kind','goal','createdAt','basis','graphDigest','featureDigest','featureRevision','allowed','taskDigest','bundleDigest']) ||
      task.taskVersion !== 1 || !taskPattern.test(task.id) || !['overview','feature','changes'].includes(task.kind) ||
      !text(task.goal, 2000) || !date(task.createdAt) || !digestPattern.test(task.graphDigest) ||
      !digestPattern.test(task.featureDigest) || !digestPattern.test(task.taskDigest) || !digestPattern.test(task.bundleDigest) ||
      !Number.isSafeInteger(task.featureRevision) || task.featureRevision < 0 || !task.basis || !digestPattern.test(task.basis.snapshot) ||
      !object(task.allowed, ['files','featureIds','mappingIds','newFeatures','parentId']) ||
      !strings(task.allowed.files, 100000) || !strings(task.allowed.featureIds, 1000) || !strings(task.allowed.mappingIds, 10000) ||
      typeof task.allowed.newFeatures !== 'boolean' ||
      task.allowed.parentId !== null && !task.allowed.featureIds.includes(task.allowed.parentId) ||
      task.kind === 'feature' && task.allowed.parentId === null) return false;
  }
  for (const proposal of work.proposals) {
    if (!object(proposal, ['id','contentDigest','taskId','batchId','summary','author','createdAt','status','decision']) ||
      !digestPattern.test(proposal.id) || proposal.id !== proposal.contentDigest ||
      !work.tasks.some(task => task.id === proposal.taskId) || !text(proposal.batchId, 200) || !idPattern.test(proposal.batchId) ||
      !text(proposal.summary, 2000) || !text(proposal.author, 200) || !date(proposal.createdAt) ||
      !['pending','applied','rejected'].includes(proposal.status)) return false;
    const decision = proposal.decision;
    if (proposal.status === 'pending') { if (decision !== undefined) return false; continue; }
    if (!object(decision, ['decision','actor','actorKind','reason','at','batchId','featureDigest']) || !decision ||
      decision.actorKind !== 'manual' || !text(decision.actor, 200) || !text(decision.reason, 8000) || !date(decision.at) ||
      decision.batchId !== proposal.batchId || decision.decision !== (proposal.status === 'applied' ? 'apply' : 'reject') ||
      (proposal.status === 'applied' ? !digestPattern.test(decision.featureDigest ?? '') : decision.featureDigest !== undefined)) return false;
  }
  return true;
}

/** A declaration of reading is specific to the applied proposal and its frozen file content. */
export function featureExploration(graph: CodeGraph, records: ExplorationRecord[]): FeatureExploration {
  const byPath = new Map<string, ExplorationRecord[]>();
  for (const record of records) { const list = byPath.get(record.path) ?? []; list.push(record); byPath.set(record.path, list); }
  const files: FeatureExploration['files'] = graph.files.map(file => {
    const previous = byPath.get(file.path) ?? [];
    return { path: file.path, hash: file.hash, status: previous.some(record => record.hash === file.hash) ? 'declared' : previous.length ? 'changed' : 'unexplored',
      records: structuredClone(previous) };
  });
  return { files, summary: { indexed: files.length, declared: files.filter(file => file.status === 'declared').length,
    changed: files.filter(file => file.status === 'changed').length, unexplored: files.filter(file => file.status === 'unexplored').length,
    limitations: [
      '探索记录仅来自已应用提案中的 Agent 自述；文件哈希相同不证明理解完整、功能解释正确或测试通过。',
      '待审、拒绝及未进入所选标注历史的提案不计入探索记录。旧内容的声明保留，但不会自动声明已阅读变化后的文件。',
      ...graph.coverage.limitations,
    ] } };
}

/** Scope authorizes edits. It never assigns a dependency, execution order, or cross-version identity. */
export function featureTaskScope(graph: CodeGraph, map: FeatureMap, references: FeatureReferenceReport,
  exploration: FeatureExploration, kind: FeatureTaskKind, featureId?: string): FeatureTask['allowed'] {
  const indexed = new Set(graph.files.map(file => file.path));
  const selected = new Set<string>();
  const files = new Set<string>();
  const includeFile = (file: string) => { if (indexed.has(file)) files.add(file); };
  const includeMappings = () => {
    for (const mapping of map.mappings) if (selected.has(mapping.featureId)) {
      includeFile(mapping.code.file); for (const evidence of mapping.evidence) includeFile(evidence.file);
    }
  };
  if (kind === 'overview') {
    map.features.forEach(feature => selected.add(feature.id)); graph.files.forEach(file => files.add(file.path));
  } else if (kind === 'feature') {
    if (!featureId || !map.features.some(feature => feature.id === featureId)) throw new Error('Unknown selected feature');
    selected.add(featureId); api.hierarchy(map.features).descendants(featureId).forEach(feature => selected.add(feature.id));
    includeMappings();
    // Missing old files cannot strand a selected feature in an empty scope. Discovery permission is explicit, without rebinding names.
    if (!files.size) graph.files.forEach(file => files.add(file.path));
    const initial = new Set(files), nodes = new Map(graph.nodes.map(node => [node.id, node]));
    for (const relation of graph.relations) {
      const endpoints = [relation.from, ...relation.targets].map(id => nodes.get(id)).filter(node => node !== undefined);
      if (initial.has(relation.evidence.location.file) || endpoints.some(node => initial.has(node.location.file))) {
        includeFile(relation.evidence.location.file); endpoints.forEach(node => includeFile(node.location.file));
      }
    }
  } else {
    for (const row of references.mappings) if (row.status !== 'matched' && row.decision !== 'rejected') selected.add(row.featureId);
    for (const node of references.unassignedNodes) includeFile(node.file);
    for (const file of exploration.files) if (file.status !== 'declared') includeFile(file.path);
    includeMappings();
    // A changed file may supply an additional association to an existing capability; this permission is explicit in the bundle.
    for (const mapping of map.mappings) if (files.has(mapping.code.file)) selected.add(mapping.featureId);
    includeMappings();
    // Existing parents are needed to preserve the complete feature content during revision.
    for (const id of [...selected]) api.hierarchy(map.features).path(id).forEach(feature => selected.add(feature.id));
    includeMappings();
  }
  return { files: [...files].sort(), featureIds: map.features.filter(feature => selected.has(feature.id)).map(feature => feature.id),
    mappingIds: map.mappings.filter(mapping => selected.has(mapping.featureId)).map(mapping => mapping.id),
    newFeatures: true, parentId: kind === 'feature' ? featureId! : null };
}

export function appliedInDocument(map: FeatureMap, metadata: ProposalMeta): boolean {
  return metadata.status === 'applied' && map.history.some(event => event.operation === 'migration' && event.subject === metadata.id &&
    event.actorKind === 'manual' && !!event.after && typeof event.after === 'object' &&
    (event.after as { kind?: string }).kind === 'feature-task-apply' &&
    (event.after as { proposalDigest?: string }).proposalDigest === metadata.contentDigest);
}

export function proposalExploration(metadata: ProposalMeta, proposal: FeatureRevision, task: FeatureTask, graph: CodeGraph): ExplorationRecord[] {
  return proposal.exploredFiles.map(file => {
    const indexed = graph.files.find(entry => entry.path === file);
    if (!indexed || !task.allowed.files.includes(file) || !metadata.decision) throw new Error('Damaged applied exploration record');
    return { path: file, hash: indexed.hash, proposalId: metadata.id, taskId: task.id, snapshot: task.basis.snapshot,
      author: metadata.author, appliedAt: metadata.decision.at };
  });
}
