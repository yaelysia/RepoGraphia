import { createHash } from 'node:crypto';
import { createFeatureMapApi } from './feature-map.js';
import type { Feature, FeatureMap, FeatureMapping, ReviewDecision } from './feature-map.js';
import { checkFeatureReferences } from './feature-references.js';
import type { FeatureReferenceVersion, FeatureReferenceReport, FeatureReferenceRow } from './feature-references.js';
import { compareWorkspaceGraphs } from './workspace-diff.js';
import type { WorkspaceGraphComparison, WorkspaceFileChange } from './workspace-diff.js';
import type { CodeNode } from './model.js';

/** User/Agent declaration, never an inferred intention or an authenticated identity. */
export interface DevelopmentIntent {
  goal: string; author: string; source: 'manual' | 'agent'; featureIds: string[];
  checks: { id: string; text: string }[];
}
export interface DevelopmentTask { id: string; title: string; intent?: DevelopmentIntent }
export interface DevelopmentReviewInput {
  task: DevelopmentTask;
  before: FeatureReferenceVersion & { features: FeatureMap | null };
  after: FeatureReferenceVersion & { features: FeatureMap | null };
  history: Map<string, FeatureReferenceVersion>;
}
export interface DevelopmentReviewVersion {
  snapshot: string; featureDigest: string | null; featureRevision: number | null;
}
export interface DevelopmentDescriptionChange {
  field: 'title' | 'summary' | 'description' | 'parentId' | 'questions';
  before: string | string[] | null; after: string | string[] | null;
}
export interface DevelopmentMappingChange {
  id: string; kind: 'added' | 'removed' | 'modified' | 'review'; fields: string[];
  before: FeatureMapping | null; after: FeatureMapping | null;
}
export interface DevelopmentReferenceChange {
  mappingId: string; kind: 'newly-pending' | 'resolved' | 'changed';
  before: FeatureReferenceRow; after: FeatureReferenceRow;
}
export interface DevelopmentChangedFile {
  path: string; kind: WorkspaceFileChange['kind'];
  /** File-path intersections with each side's saved annotation records, not verified current entity matches. */
  beforeMappingIds: string[]; afterMappingIds: string[];
}
export interface DevelopmentFeatureReview {
  id: string; before: Feature | null; after: Feature | null;
  change: 'added' | 'removed' | 'modified' | 'unchanged';
  descriptionChanges: DevelopmentDescriptionChange[];
  mappingChanges: DevelopmentMappingChange[];
  reviewChanges: { mappingId: string; before: ReviewDecision; after: ReviewDecision }[];
  references: { before: FeatureReferenceRow[]; baselineAtAfter: FeatureReferenceRow[]; after: FeatureReferenceRow[] };
  referenceChanges: DevelopmentReferenceChange[];
  /** Pending at the task starting point; not presented as newly introduced by this task. */
  preexistingPending: FeatureReferenceRow[];
  changedFiles: DevelopmentChangedFile[];
  scope: 'declared' | 'outside-declared' | 'undeclared';
  /** Something in these records changed; this does not assert a changed runtime capability. */
  affected: boolean;
}
export interface DevelopmentUnassignedNode {
  id: string; name: string; kind: CodeNode['kind']; file: string; start: number; end: number; snapshot: string;
}
export interface DevelopmentUnassignedFile {
  path: string; kind: WorkspaceFileChange['kind'];
  beforeNodes: DevelopmentUnassignedNode[]; afterNodes: DevelopmentUnassignedNode[];
  /** No declarations cannot demonstrate that the changed source has a feature owner. */
  beforeWithoutEntities: boolean; afterWithoutEntities: boolean;
}
export interface DevelopmentReviewReport {
  reviewVersion: 1; comparisonDigest: string; task: DevelopmentTask;
  before: DevelopmentReviewVersion; after: DevelopmentReviewVersion;
  code: WorkspaceGraphComparison; features: DevelopmentFeatureReview[];
  /** Full M2 reports preserve original bases, status reasons, candidates and unknowns. */
  references: { before: FeatureReferenceReport; baselineAtAfter: FeatureReferenceReport; after: FeatureReferenceReport };
  unassigned: DevelopmentUnassignedFile[];
  summary: {
    changedFiles: number; affectedFeatures: number; addedFeatures: number; removedFeatures: number;
    changedDescriptions: number; changedMappings: number; changedReviewDecisions: number;
    newlyPendingReferences: number; preexistingPendingReferences: number;
    declaredFeatures: number; declaredWithoutObservedChanges: number; outsideDeclaredFeatures: number;
    unassignedFiles: number; unassignedBeforeNodes: number; unassignedAfterNodes: number;
  };
  limitations: string[];
}

const api = createFeatureMapApi();
const clone = <T>(value: T): T => structuredClone(value);
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().filter(key =>
    (value as Record<string, unknown>)[key] !== undefined).map(key =>
    JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}';
  return JSON.stringify(value) ?? 'null';
};
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const unique = <T>(items: T[]) => [...new Set(items)];
const require = (condition: unknown, message: string): void => {
  if (!condition) throw new Error('Development review: ' + message);
};

/** Canonical report identity; separate from the SHA-256 of its stored JSON bytes. */
export function developmentReviewDigest(report: Omit<DevelopmentReviewReport, 'comparisonDigest'>): string {
  const { comparisonDigest: _ignored, ...facts } = report as DevelopmentReviewReport;
  return hash(canonical(facts));
}

function validateTask(input: DevelopmentTask, before: FeatureMap | null): DevelopmentTask {
  const text = (value: unknown, max: number) => typeof value === 'string' && !!value.trim() && value.length <= max;
  const object = (value: unknown, keys: string[]) => !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every(key => keys.includes(key));
  const id = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;
  require(input && text(input.id, 200) && text(input.title, 200), 'invalid task');
  if (input.intent === undefined) return { id: input.id, title: input.title };
  const intent = input.intent;
  require(object(intent, ['goal', 'author', 'source', 'featureIds', 'checks']) && text(intent.goal, 2000) && text(intent.author, 200) &&
    ['manual', 'agent'].includes(intent.source), 'invalid declared goal or source');
  require(Array.isArray(intent.featureIds) && intent.featureIds.length <= 1000 &&
    intent.featureIds.every(value => text(value, 200) && id.test(value)) && new Set(intent.featureIds).size === intent.featureIds.length,
    'invalid declared feature scope');
  require(intent.featureIds.every(id => before?.features.some(feature => feature.id === id)),
    'declared scope must name features present at the task starting point');
  require(Array.isArray(intent.checks) && intent.checks.length <= 50 &&
    intent.checks.every(check => object(check, ['id', 'text']) && text(check.id, 200) && id.test(check.id) && text(check.text, 2000)) &&
    new Set(intent.checks.map(check => check.id)).size === intent.checks.length, 'invalid declared checks');
  return { id: input.id, title: input.title, intent: clone(intent) };
}

function version(input: DevelopmentReviewInput['before'], document: FeatureMap | null): DevelopmentReviewVersion {
  return { snapshot: input.graph.project.snapshot,
    // The workspace uses validated JSON bytes, not a canonical object hash, for annotation identity.
    featureDigest: document === null ? null : hash(JSON.stringify(document)),
    featureRevision: document?.revision ?? null };
}

function descriptionChanges(before: Feature | null, after: Feature | null): DevelopmentDescriptionChange[] {
  const result: DevelopmentDescriptionChange[] = [];
  for (const field of ['title', 'summary', 'description', 'parentId', 'questions'] as const) {
    const left = before?.[field] ?? null, right = after?.[field] ?? null;
    if (canonical(left) !== canonical(right)) result.push({ field, before: clone(left), after: clone(right) });
  }
  return result;
}

function mappingChanges(before: FeatureMap | null, after: FeatureMap | null): DevelopmentMappingChange[] {
  const old = new Map(before?.mappings.map(mapping => [mapping.id, mapping]) ?? []);
  const current = new Map(after?.mappings.map(mapping => [mapping.id, mapping]) ?? []);
  const changes: DevelopmentMappingChange[] = [];
  for (const id of unique([...old.keys(), ...current.keys()])) {
    const left = old.get(id) ?? null, right = current.get(id) ?? null;
    if (!left || !right) {
      changes.push({ id, kind: left ? 'removed' : 'added', fields: [], before: clone(left), after: clone(right) });
      continue;
    }
    const fields = ['featureId', 'code', 'role', 'rationale', 'evidence', 'basis', 'decision'].filter(field => {
      const read = (mapping: FeatureMapping, document: FeatureMap | null) => field === 'basis'
        ? mapping.basis ?? document!.basis : mapping[field as keyof FeatureMapping];
      return canonical(read(left, before)) !== canonical(read(right, after));
    });
    if (fields.length) changes.push({ id, kind: fields.every(field => field === 'decision') ? 'review' : 'modified',
      fields, before: clone(left), after: clone(right) });
  }
  return changes;
}

function referenceChanges(before: FeatureReferenceReport, after: FeatureReferenceReport): DevelopmentReferenceChange[] {
  const byId = new Map(after.mappings.map(row => [row.id, row]));
  const shape = (row: FeatureReferenceRow) => canonical({ status: row.status,
    reasons: [...row.reasons].sort(), warnings: [...row.warnings].sort() });
  const result: DevelopmentReferenceChange[] = [];
  for (const left of before.mappings) {
    const right = byId.get(left.id);
    if (left.decision === 'rejected' || !right || shape(left) === shape(right)) continue;
    result.push({ mappingId: left.id, kind: left.status === 'matched' && right.status !== 'matched' ? 'newly-pending'
      : left.status !== 'matched' && right.status === 'matched' ? 'resolved' : 'changed',
      before: clone(left), after: clone(right) });
  }
  return result;
}

function changedMappingFiles(featureId: string, before: FeatureMap | null, after: FeatureMap | null,
  files: WorkspaceFileChange[]): DevelopmentChangedFile[] {
  const matching = (map: FeatureMap | null, path: string) => (map?.mappings ?? [])
    .filter(mapping => mapping.featureId === featureId && mapping.decision !== 'rejected' &&
      (mapping.code.file === path || mapping.evidence.some(evidence => evidence.file === path)))
    .map(mapping => mapping.id);
  return files.flatMap(file => {
    const beforeMappingIds = matching(before, file.path), afterMappingIds = matching(after, file.path);
    return beforeMappingIds.length || afterMappingIds.length ? [{ path: file.path, kind: file.kind,
      beforeMappingIds, afterMappingIds }] : [];
  });
}

function unassignedFiles(input: DevelopmentReviewInput, files: WorkspaceFileChange[],
  before: FeatureReferenceReport, after: FeatureReferenceReport): DevelopmentUnassignedFile[] {
  const oldUnassigned = new Set(before.unassignedNodes.map(node => node.id));
  const newUnassigned = new Set(after.unassignedNodes.map(node => node.id));
  const nodes = (data: DevelopmentReviewInput['before'], file: string, unassigned: Set<string>) =>
    data.graph.nodes.filter(node => node.location.file === file && unassigned.has(node.id)).map(node => ({
      id: node.id, name: node.name, kind: node.kind, file, start: node.location.start, end: node.location.end,
      snapshot: data.graph.project.snapshot })).sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id));
  return files.flatMap(file => {
    const beforeNodes = nodes(input.before, file.path, oldUnassigned), afterNodes = nodes(input.after, file.path, newUnassigned);
    const beforeWithoutEntities = file.before !== null && !input.before.graph.nodes.some(node =>
      node.location.file === file.path && node.kind !== 'file');
    const afterWithoutEntities = file.after !== null && !input.after.graph.nodes.some(node =>
      node.location.file === file.path && node.kind !== 'file');
    return beforeNodes.length || afterNodes.length || beforeWithoutEntities || afterWithoutEntities ? [{
      path: file.path, kind: file.kind, beforeNodes, afterNodes, beforeWithoutEntities, afterWithoutEntities }] : [];
  });
}

/** Compare fixed source and annotation versions; no writes, target execution, or automatic acceptance. */
export function compareDevelopmentReview(input: DevelopmentReviewInput): DevelopmentReviewReport {
  const beforeMap = input.before.features === null ? null : api.validate(input.before.features);
  const afterMap = input.after.features === null ? null : api.validate(input.after.features);
  const task = validateTask(input.task, beforeMap);
  const history = new Map(input.history);
  history.set(input.before.graph.project.snapshot, input.before);
  history.set(input.after.graph.project.snapshot, input.after);
  const references = {
    before: checkFeatureReferences(input.before, beforeMap ?? api.create(input.before.graph), history),
    baselineAtAfter: checkFeatureReferences(input.after, beforeMap ?? api.create(input.before.graph), history),
    after: checkFeatureReferences(input.after, afterMap ?? api.create(input.after.graph), history),
  };
  const code = compareWorkspaceGraphs(input.before.graph, input.after.graph);
  const allMappingChanges = mappingChanges(beforeMap, afterMap);
  const allReferenceChanges = referenceChanges(references.before, references.baselineAtAfter);
  const oldFeatures = new Map(beforeMap?.features.map(feature => [feature.id, feature]) ?? []);
  const newFeatures = new Map(afterMap?.features.map(feature => [feature.id, feature]) ?? []);
  const declared = new Set(task.intent?.featureIds ?? []);
  const byFeature = (report: FeatureReferenceReport, id: string) => clone(report.mappings.filter(row => row.featureId === id));
  const features: DevelopmentFeatureReview[] = unique([...oldFeatures.keys(), ...newFeatures.keys()]).map(id => {
    const before = oldFeatures.get(id) ?? null, after = newFeatures.get(id) ?? null;
    const descriptions = descriptionChanges(before, after);
    const mappings = allMappingChanges.filter(change => change.before?.featureId === id || change.after?.featureId === id);
    const referenceRows = allReferenceChanges.filter(change => change.before.featureId === id);
    const changedFiles = changedMappingFiles(id, beforeMap, afterMap, code.files);
    const beforeReferences = byFeature(references.before, id);
    return { id, before: clone(before), after: clone(after),
      change: !before ? 'added' : !after ? 'removed' : descriptions.length ? 'modified' : 'unchanged',
      descriptionChanges: descriptions, mappingChanges: clone(mappings),
      reviewChanges: mappings.filter(change => change.before && change.after && change.before.decision !== change.after.decision)
        .map(change => ({ mappingId: change.id, before: change.before!.decision, after: change.after!.decision })),
      references: { before: beforeReferences, baselineAtAfter: byFeature(references.baselineAtAfter, id), after: byFeature(references.after, id) },
      referenceChanges: clone(referenceRows),
      preexistingPending: beforeReferences.filter(row => row.status !== 'matched' && row.decision !== 'rejected'),
      changedFiles, scope: !declared.size ? 'undeclared' : declared.has(id) ? 'declared' : 'outside-declared',
      affected: descriptions.length > 0 || mappings.length > 0 || referenceRows.length > 0 || changedFiles.length > 0 };
  });
  const unassigned = unassignedFiles(input, code.files, references.before, references.after);
  const facts: Omit<DevelopmentReviewReport, 'comparisonDigest'> = {
    reviewVersion: 1, task, before: version(input.before, beforeMap), after: version(input.after, afterMap),
    code, features, references, unassigned,
    summary: {
      changedFiles: code.files.length, affectedFeatures: features.filter(feature => feature.affected).length,
      addedFeatures: features.filter(feature => feature.change === 'added').length,
      removedFeatures: features.filter(feature => feature.change === 'removed').length,
      changedDescriptions: features.filter(feature => feature.descriptionChanges.length > 0).length,
      changedMappings: allMappingChanges.filter(change => change.kind !== 'review').length,
      changedReviewDecisions: allMappingChanges.filter(change => change.before && change.after && change.before.decision !== change.after.decision).length,
      newlyPendingReferences: allReferenceChanges.filter(change => change.kind === 'newly-pending').length,
      preexistingPendingReferences: references.before.mappings.filter(row => row.status !== 'matched' && row.decision !== 'rejected').length,
      declaredFeatures: declared.size,
      declaredWithoutObservedChanges: features.filter(feature => feature.scope === 'declared' && !feature.affected).length,
      outsideDeclaredFeatures: features.filter(feature => feature.scope === 'outside-declared' && feature.affected).length,
      unassignedFiles: unassigned.length,
      unassignedBeforeNodes: unassigned.reduce((sum, file) => sum + file.beforeNodes.length, 0),
      unassignedAfterNodes: unassigned.reduce((sum, file) => sum + file.afterNodes.length, 0),
    },
    limitations: [
      '本报告固定比较本轮起点与所选终点的代码、标注版本；以后出现的改动不在本次审阅范围内。',
      '功能说明变化来自显式标注差异；关联文件或静态引用变化仅提示核对，不证明业务行为改变、目标完成或代码正确。',
      '目标和验收点是标明来源的声明；范围仅包含开始时明确选择的功能，不推断文本意图，不自动包含子功能或共享代码的其他功能。',
      '功能关联的人工决定、代码改动审阅和测试/运行验证是不同记录；本工具未执行目标项目或测试。',
      '起点已经待复核的引用单独保留；本轮新增待复核只计算原先匹配、到终点不再匹配的引用。',
      '原标注涉及的变化文件只按记录中的文件路径列出，包括以前已经陈旧的关联；当前实体是否仍对应须查看引用核对，不能按路径重用旧身份。',
      '变化文件中的未归属列表完整检查各侧实体；不表示每个列出的实体都被修改，也不把文件映射传递给子实体。没有声明实体的源码变化仍需人工核对。',
      '文件及关系预览可受显示预算限制；未归属检查使用完整图和引用记录，不用截断预览证明全部代码已经归属。',
      '引用匹配保留候选、未知、类型及不完整来源边界，不推导功能依赖或执行顺序；未索引区域另见前后分析范围。',
      '任务期间观察到变化不能证明修改者身份、Agent 正在执行的步骤或任务已经完成。',
    ],
  };
  return { ...facts, comparisonDigest: developmentReviewDigest(facts) };
}
