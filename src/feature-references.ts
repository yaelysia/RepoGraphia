import { createHash } from 'node:crypto';
import path from 'node:path';
import { createFeatureMapApi } from './feature-map.js';
import type { FeatureBasis, FeatureMap, FeatureMapping, ReviewDecision } from './feature-map.js';
import type { CodeGraph, CodeNode, Relation } from './model.js';
import type { AnalysisInputs } from './project.js';

export interface FeatureReferenceVersion { graph: CodeGraph; inputs?: AnalysisInputs }
export type FeatureReferenceStatus = 'matched' | 'needs-review' | 'unmatched' | 'unverified';
export interface FeatureReferenceRow {
  id: string; featureId: string; originalBasis: FeatureBasis; decision: ReviewDecision;
  status: FeatureReferenceStatus; reasons: string[]; warnings: string[];
  /** A read-only correspondence into this report's snapshot, never rewritten annotation anchors. */
  current?: { nodeId: string; relationIds: string[] };
}
export interface FeatureReferenceFeature {
  id: string; status: FeatureReferenceStatus | 'unmapped'; mappingIds: string[]; reasons: string[];
}
export interface FeatureReferenceReport {
  referenceVersion: 1; snapshot: string; featureDigest: string; revision: number;
  mappings: FeatureReferenceRow[]; features: FeatureReferenceFeature[];
  unassignedNodes: { id: string; file: string; name: string; kind: CodeNode['kind'] }[];
  summary: { features: number; mappings: number; matched: number; needsReview: number; unmatched: number;
    unverified: number; mappedNodes: number; unassignedNodes: number; proposed: number; accepted: number; rejected: number };
  limitations: string[];
}

const api = createFeatureMapApi();
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key =>
    JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}';
  return JSON.stringify(value) ?? 'undefined';
};
const unique = <T>(items: T[]): T[] => [...new Set(items)];
const fileKey = (value: string): string => {
  const key = path.resolve(value).split(path.sep).join('/');
  return process.platform === 'win32' ? key.toLowerCase() : key;
};
const require = (condition: unknown, message: string): void => {
  if (!condition) throw new Error('Feature references: ' + message);
};

/** Complete static records with temporary structural keys, not persistent cross-snapshot IDs. */
function index(graph: CodeGraph) {
  api.assess(graph, api.create(graph)); // Retain the graph/schema/unique-ID checks of the existing API.
  const files = new Map(graph.files.map(file => [file.path, file]));
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const relations = new Map(graph.relations.map(relation => [relation.id, relation]));
  const byFile = new Map<string, CodeNode[]>(), incident = new Map<string, Relation[]>();
  for (const node of graph.nodes) {
    const list = byFile.get(node.location.file) ?? []; list.push(node); byFile.set(node.location.file, list);
  }
  for (const relation of graph.relations) for (const id of unique([relation.from, ...relation.targets])) {
    const list = incident.get(id) ?? []; list.push(relation); incident.set(id, list);
  }
  const nodeKeys = new Map<string, string>(), relationKeys = new Map<string, string>();
  const descriptor = (node: CodeNode) => {
    const { id: _id, parent: _parent, ...record } = node;
    return { ...record, fileHash: files.get(node.location.file)?.hash ?? null };
  };
  const parents = (node: CodeNode): CodeNode[] => {
    const result: CodeNode[] = [], seen = new Set([node.id]); let parent = node.parent;
    while (parent) {
      require(!seen.has(parent), 'cyclic parent index'); seen.add(parent);
      const item = nodes.get(parent); require(item, 'missing parent index');
      result.push(item!); parent = item!.parent;
    }
    return result;
  };
  const nodeKey = (id: string): string => {
    const cached = nodeKeys.get(id); if (cached !== undefined) return cached;
    const node = nodes.get(id); require(node, 'missing relation endpoint');
    require(files.has(node!.location.file), 'missing indexed source for relation endpoint');
    const key = hash(canonical({ node: descriptor(node!), parents: parents(node!).map(descriptor) }));
    nodeKeys.set(id, key); return key;
  };
  const relationKey = (relation: Relation): string => {
    const cached = relationKeys.get(relation.id); if (cached !== undefined) return cached;
    const { id: _id, from, targets, evidence, ...record } = relation;
    const origins = evidence.valueOrigins;
    const key = hash(canonical({ ...record, from: nodeKey(from), targets: targets.map(nodeKey).sort(),
      evidence: { ...evidence, ...(origins ? { valueOrigins: { ...origins,
        sources: origins.sources.map(source => ({ ...source, target: nodeKey(source.target) })) } } : {}) } }));
    relationKeys.set(relation.id, key); return key;
  };
  const byRelationKey = new Map<string, Relation[]>();
  for (const relation of graph.relations) {
    const key = relationKey(relation), list = byRelationKey.get(key) ?? [];
    list.push(relation); byRelationKey.set(key, list);
  }
  const shapes = new Map<string, { signature: string; warnings: string[] }>();
  const neighborhood = (node: CodeNode) => {
    const cached = shapes.get(node.id); if (cached) return cached;
    const members = (byFile.get(node.location.file) ?? []).filter(item => node.kind === 'file' ||
      item.location.start >= node.location.start && item.location.end <= node.location.end);
    const edges = new Map<string, Relation>();
    for (const member of members) for (const edge of incident.get(member.id) ?? []) edges.set(edge.id, edge);
    const warnings: string[] = [];
    for (const edge of edges.values()) {
      if (edge.status !== 'bound') warnings.push('neighborhood-' + edge.status);
      if (edge.typeOnly) warnings.push('type-only-neighborhood');
      if (!['call', 'construct', 'tag'].includes(edge.kind)) warnings.push('non-call-neighborhood');
      if (edge.evidence.valueOrigins) {
        warnings.push('incomplete-value-origins');
        if (edge.evidence.valueOrigins.truncated) warnings.push('truncated-value-origins');
      }
    }
    const result = { signature: hash(canonical({ members: members.map(item => nodeKey(item.id)).sort(),
      parents: parents(node).map(item => nodeKey(item.id)),
      // Keep duplicate structural records; a Set of signatures would hide an added callsite.
      relations: [...edges.values()].map(relationKey).sort() })), warnings: unique(warnings) };
    shapes.set(node.id, result); return result;
  };
  return { graph, files, nodes, relations, byFile, nodeKey, relationKey, byRelationKey, neighborhood };
}
type GraphIndex = ReturnType<typeof index>;

/** Source-only changes are evaluated by static neighborhoods; other captured inputs are conservative gates. */
function environment(version: FeatureReferenceVersion, sourcePaths: Set<string>) {
  const inputs = version.inputs!;
  require(inputs.schemaVersion === 1, 'unsupported analysis input capture');
  const source = (name: string) => sourcePaths.has(fileKey(name));
  const byPath = <T extends { path: string }>(items: T[]) => items.map(item => ({ ...item, path: fileKey(item.path) }))
    .sort((a, b) => canonical(a).localeCompare(canonical(b)));
  return canonical({ root: fileKey(inputs.root),
    configReads: inputs.configReads!.map(fileKey).sort(),
    reads: byPath(inputs.reads.filter(item => !source(item.path))),
    files: byPath(inputs.files.filter(item => !source(item.path))),
    realpaths: byPath(inputs.realpaths.filter(item => !source(item.path)).map(item => ({ ...item,
      resolved: item.resolved === null ? null : fileKey(item.resolved) }))),
    directories: byPath(inputs.directories),
    directoryNames: byPath(inputs.directoryNames.map(item => ({ ...item, names: [...item.names].sort() }))),
    directoryQueries: byPath(inputs.directoryQueries.map(item => ({ ...item,
      files: item.files.filter(name => !source(name)).map(fileKey).sort() }))),
  });
}
function environmentState(before: FeatureReferenceVersion, after: FeatureReferenceVersion): 'same' | 'changed' | 'unknown' {
  if (before.graph.project.snapshot === after.graph.project.snapshot) return 'same';
  if (!before.inputs || !after.inputs) return 'unknown';
  for (const version of [before, after]) {
    const inputs = version.inputs!, configs = inputs.configReads;
    // Earlier captures recorded bytes but not whether an indexed file also acted as
    // configuration. Its extension or the root config alone cannot recover that role.
    if (!Array.isArray(configs)) return 'unknown';
    const reads = new Set(inputs.reads.map(item => fileKey(item.path)));
    if (configs.some(file => typeof file !== 'string' || !reads.has(fileKey(file)))) return 'unknown';
    if (version.graph.project.config !== null && !configs.some(file => fileKey(file) ===
      fileKey(path.resolve(inputs.root, version.graph.project.config!)))) return 'unknown';
  }
  const configs = new Set([before, after].flatMap(version => version.inputs!.configReads!.map(fileKey)));
  const sources = new Set([before, after].flatMap(version => version.graph.files.map(file =>
    fileKey(path.resolve(version.inputs!.root, file.path)))).filter(file => !configs.has(file)));
  return environment(before, sources) === environment(after, sources) ? 'same' : 'changed';
}
function contractReasons(before: CodeGraph, after: CodeGraph): string[] {
  const from = api.basis(before), to = api.basis(after), reasons: string[] = [];
  for (const key of ['analysisRevision', 'compilerVersion', 'config'] as const)
    if (from[key] !== to[key]) reasons.push('changed-' + key);
  if (before.project.name !== after.project.name) reasons.push('changed-project-name');
  if (from.analysisRevision === null || to.analysisRevision === null) reasons.push('unversioned-analysis');
  return reasons;
}

function checkMapping(mapping: FeatureMapping, originalBasis: FeatureBasis, previous: GraphIndex, current: GraphIndex,
  sourceIssues: string[], sourceWarnings: string[], inputs: 'same' | 'changed' | 'unknown'): FeatureReferenceRow {
  const reasons = [...sourceIssues], warnings = [...sourceWarnings, 'reference-check-not-semantic-review'];
  const result: FeatureReferenceRow = { id: mapping.id, featureId: mapping.featureId, originalBasis: clone(originalBasis),
    decision: mapping.decision, status: 'unverified', reasons, warnings };
  if (sourceIssues.length) { reasons.unshift('original-reference-unverified'); return result; }
  const original = previous.nodes.get(mapping.code.nodeId)!;
  const before = previous.neighborhood(original); warnings.push(...before.warnings);
  reasons.push(...contractReasons(previous.graph, current.graph));
  if (inputs === 'changed') reasons.push('changed-analysis-inputs');
  if (inputs === 'unknown') reasons.push('analysis-inputs-unavailable');
  const file = current.files.get(mapping.code.file);
  if (!file) { result.status = 'unmatched'; reasons.push('missing-indexed-file'); return result; }
  if (file.hash !== mapping.code.fileHash) {
    result.status = 'needs-review'; reasons.push('changed-source', 'exact-anchor-recheck-required'); return result;
  }
  const matches = (current.byFile.get(mapping.code.file) ?? []).filter(node => node.location.start === mapping.code.start &&
    node.location.end === mapping.code.end && node.kind === mapping.code.kind && node.name === mapping.code.name);
  if (matches.length !== 1) {
    result.status = matches.length ? 'needs-review' : 'unmatched';
    reasons.push(matches.length ? 'ambiguous-node-anchor' : 'missing-node-anchor'); return result;
  }
  const node = matches[0]!, after = current.neighborhood(node); warnings.push(...after.warnings);
  if (previous.nodeKey(original.id) !== current.nodeKey(node.id)) reasons.push('changed-node-context');
  if (before.signature !== after.signature) reasons.push('changed-static-neighborhood');
  const relationIds: string[] = [];
  for (const evidence of mapping.evidence) {
    const edge = previous.relations.get(evidence.relationId)!;
    const matches = current.byRelationKey.get(previous.relationKey(edge)) ?? [];
    if (matches.length !== 1) reasons.push(matches.length ? 'ambiguous-relation-anchor' : 'changed-relation-evidence');
    else relationIds.push(matches[0]!.id);
  }
  result.status = reasons.some(reason => reason !== 'analysis-inputs-unavailable' && reason !== 'unversioned-analysis')
    ? 'needs-review' : reasons.length ? 'unverified' : 'matched';
  if (result.status === 'matched') result.current = { nodeId: node.id, relationIds };
  return result;
}

/**
 * Pure local reference assessment. Neither the FeatureMap nor its decisions/bases are migrated.
 * Report featureDigest/revision identify the preserved annotation version; originalBasis identifies each reference version.
 */
export function checkFeatureReferences(current: FeatureReferenceVersion, input: FeatureMap,
  history: Map<string, FeatureReferenceVersion>): FeatureReferenceReport {
  const map = api.validate(input), target = index(current.graph), mappings: FeatureReferenceRow[] = [];
  const groups = new Map<string, { basis: FeatureBasis; mappings: FeatureMapping[] }>();
  for (const mapping of map.mappings) {
    const basis = mapping.basis ?? map.basis, key = canonical(basis), group = groups.get(key) ?? { basis, mappings: [] };
    group.mappings.push(mapping); groups.set(key, group);
  }
  const indexes = new Map<string, GraphIndex>([[current.graph.project.snapshot, target]]);
  for (const group of groups.values()) {
    const version = group.basis.snapshot === current.graph.project.snapshot ? current : history.get(group.basis.snapshot);
    const failure = !version ? 'missing-baseline-graph' : canonical(api.basis(version.graph)) !== canonical(group.basis)
      ? 'baseline-basis-mismatch' : undefined;
    if (failure) {
      for (const mapping of group.mappings) mappings.push({ id: mapping.id, featureId: mapping.featureId,
        originalBasis: clone(group.basis), decision: mapping.decision, status: 'unverified', reasons: [failure],
        warnings: ['reference-check-not-semantic-review'] });
      continue;
    }
    let previous = indexes.get(group.basis.snapshot);
    if (!previous) { previous = index(version!.graph); indexes.set(group.basis.snapshot, previous); }
    // This temporary per-basis view only validates references against their actual saved graph.
    // It is never returned as a FeatureMap, persisted, or passed to a migration/apply operation.
    const original = api.assess(version!.graph, { ...map, basis: group.basis, mappings: group.mappings });
    const inputs = environmentState(version!, current);
    for (const item of original.mappings) mappings.push(checkMapping(item.mapping, group.basis, previous, target,
      item.issues, item.warnings, inputs));
  }
  const positions = new Map(map.mappings.map((mapping, i) => [mapping.id, i]));
  mappings.sort((a, b) => positions.get(a.id)! - positions.get(b.id)!);
  for (const mapping of mappings) { mapping.reasons = unique(mapping.reasons); mapping.warnings = unique(mapping.warnings); }
  const features: FeatureReferenceFeature[] = map.features.map(feature => {
    const rows = mappings.filter(mapping => mapping.featureId === feature.id), statuses = unique(rows.map(row => row.status));
    return { id: feature.id, status: statuses.length === 0 ? 'unmapped' : statuses.length === 1 ? statuses[0]! : 'needs-review',
      mappingIds: rows.map(row => row.id), reasons: unique(rows.flatMap(row => row.reasons)) };
  });
  const mapped = new Set(mappings.filter(row => row.status === 'matched' && row.decision !== 'rejected').map(row => row.current!.nodeId));
  const unassignedNodes = current.graph.nodes.filter(node => !mapped.has(node.id)).sort((a, b) =>
    a.location.file.localeCompare(b.location.file) || a.location.start - b.location.start ||
    a.location.end - b.location.end || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)).map(node => ({
    id: node.id, file: node.location.file, name: node.name, kind: node.kind }));
  return { referenceVersion: 1, snapshot: current.graph.project.snapshot, featureDigest: hash(JSON.stringify(map)), revision: map.revision,
    mappings, features, unassignedNodes,
    summary: { features: features.length, mappings: mappings.length,
      matched: mappings.filter(row => row.status === 'matched').length,
      needsReview: mappings.filter(row => row.status === 'needs-review').length,
      unmatched: mappings.filter(row => row.status === 'unmatched').length,
      unverified: mappings.filter(row => row.status === 'unverified').length,
      mappedNodes: mapped.size, unassignedNodes: unassignedNodes.length,
      proposed: mappings.filter(row => row.decision === 'proposed').length,
      accepted: mappings.filter(row => row.decision === 'accepted').length,
      rejected: mappings.filter(row => row.decision === 'rejected').length },
    limitations: [
      '引用匹配只表示已记录的精确源码锚点与静态邻域匹配，不表示功能含义、当前代码或测试已经通过审阅。',
      '人工决定保留在原标注版本及依据快照中；本核对不会迁移标注、接受新代码或更改原决定。',
      '源码移位或改名需要重新定位；不按名称、节选或相似度重绑。配置、类型及无法收窄的解析输入变化保守要求复核。',
      '未归属指没有匹配且未被拒绝的显式实体关联；文件、父功能及调用关系不会自动覆盖子实体，也不证明尚未探索或业务遗漏。',
      '全部记录均保留；候选、未知、值来源不完整与预算截断不因引用匹配而消失。',
    ] };
}
