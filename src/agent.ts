import { createHash } from 'node:crypto';
import { createFeatureMapApi } from './feature-map.js';
import { createProjectMapApi } from './project-map.js';
import type { Feature, FeatureBasis, FeatureEdit, FeatureMap } from './feature-map.js';
import type { CodeGraph, CodeNode, Relation } from './model.js';

export const AGENT_PROTOCOL = 1;
export const AGENT_OUTPUT_BYTES = 96 * 1024;
export class AgentError extends Error {
  constructor(public code: string, message: string, public hint: string) { super(message); }
}
function require(ok: unknown, code: string, message: string, hint: string): asserts ok {
  if (!ok) throw new AgentError(code, message, hint);
}
export const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sourceHash = (text: string) => createHash('sha256').update(text).digest('hex');
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function fields(value: unknown, keys: string[], label: string): asserts value is Record<string, unknown> {
  require(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k => keys.includes(k)),
    'INVALID_PROPOSAL', `Invalid ${label} object or unknown field`, 'Use the proposal format in the Skill; do not supply decisions, hashes or edit operations.');
}
function text(value: unknown, label: string, max = 4000): asserts value is string {
  require(typeof value === 'string' && value.trim().length > 0 && value.length <= max, 'INVALID_PROPOSAL',
    `Invalid ${label}`, `Supply nonempty ${label} of at most ${max} characters.`);
}
function array(value: unknown, label: string, max: number): asserts value is unknown[] {
  require(Array.isArray(value) && value.length <= max, 'INVALID_PROPOSAL', `Invalid ${label}`, `Supply an array with at most ${max} items.`);
}
export function page<T>(rows: T[], offset = 0, limit = 25) {
  require(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limit) && limit > 0 && limit <= 50,
    'INVALID_BUDGET', 'offset must be >=0 and limit must be 1..50 integers', 'Use the returned nextOffset; do not infer absence from a truncated page.');
  return { total: rows.length, offset, limit, nextOffset: offset + limit < rows.length ? offset + limit : null,
    items: rows.slice(offset, offset + limit) };
}
const describe = (n: CodeNode) => ({ id: n.id, name: n.name, kind: n.kind, parent: n.parent, location: n.location });
export interface AgentProposal {
  schemaVersion: 1; basis: FeatureBasis; expectedRevision: number; baseDigest: string;
  batchId: string; scope: string; unexplored: string[];
  features: Feature[];
  mappings: Extract<FeatureEdit, {op:'mapping'}>[];
  checks: { featureId: string; nodeId: string; kind: 'support' | 'limit'; quote: string; explanation: string }[];
}

/** Query one immutable graph snapshot. No model, target code execution, shell or hidden persistence. */
export function createAgentApi(graph: CodeGraph, original?: unknown) {
  const features = createFeatureMapApi(), project = createProjectMapApi();
  require(graph?.schemaVersion === 1 && Array.isArray(graph.nodes) && Array.isArray(graph.files) &&
    Array.isArray(graph.relations) && Array.isArray(graph.diagnostics), 'INVALID_GRAPH', 'Unsupported graph', 'Use analyze to create a schema-1 CodeGraph.');
  const idx = project.index(graph), map = original === undefined ? features.create(graph) : features.validate(original);
  const assessment = features.assess(graph, map), basis = features.basis(graph), baseDigest = digest(map);
  const nodes = new Map(graph.nodes.map(n => [n.id, n])), files = new Map(graph.files.map(f => [f.path, f]));
  const edges = new Map(graph.relations.map(e => [e.id, e]));
  const metadata = () => ({ protocolVersion: AGENT_PROTOCOL, basis, expectedRevision: map.revision, baseDigest });
  const getNode = (id: string) => {
    const node = nodes.get(id);
    require(node, 'UNKNOWN_NODE', `No exact node ID: ${id}`, 'Run agent search and copy an exact ID; names are not identifiers.');
    return node;
  };
  function source(n: CodeNode, offset = 0, limit = 6000) {
    require(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limit) && limit >= 1 && limit <= 16000,
      'INVALID_BUDGET', 'source-offset must be >=0 and source-limit 1..16000 integers', 'Offsets count UTF-16 characters relative to the selected entity.');
    const file = files.get(n.location.file);
    require(file, 'INVALID_GRAPH', 'Entity source is not indexed', 'Regenerate the graph; do not guess a file path.');
    if (file.source === undefined) return { available: false as const, excerpt: n.snippet, complete: false, nextOffset: null,
      warning: 'Only an excerpt is available. Analyze with --include-source in a new report directory, then restart against that snapshot.' };
    require(sourceHash(file.source) === file.hash, 'SOURCE_HASH_MISMATCH', 'Embedded source differs from recorded hash', 'Regenerate this graph; do not repair hashes or quotes by hand.');
    const total = n.location.end - n.location.start;
    require(n.location.start >= 0 && total >= 0 && n.location.end <= file.source.length, 'INVALID_GRAPH', 'Invalid entity source range', 'Regenerate the graph.');
    const start = n.location.start + Math.min(offset, total), end = Math.min(n.location.end, start + limit);
    return { available: true as const, file: file.path, fileHash: file.hash, start, end, total,
      offset, limit, text: file.source.slice(start, end), nextOffset: offset + limit < total ? offset + limit : null,
      complete: offset === 0 && end === n.location.end, interpretation: 'UTF-16 offsets; end exclusive. A partial page is not the entire implementation.' };
  }
  function relationSummary(e: Relation) {
    const { valueOrigins, ...evidence } = e.evidence;
    return { ...e, targets: e.targets.slice(0, 20), omittedTargets: Math.max(0, e.targets.length - 20), evidence,
      origins: valueOrigins ? { complete: false, truncated: valueOrigins.truncated, sources: valueOrigins.sources.length,
        stops: valueOrigins.stops.length } : null,
      detail: { operation: 'relation', id: e.id } };
  }
  function inspect(id: string, options: { offset?: number; limit?: number; sourceOffset?: number; sourceLimit?: number } = {}) {
    const node = getNode(id);
    const related = graph.relations.filter(e => e.from === id || e.targets.includes(id));
    return { ...metadata(), node: describe(node), source: source(node, options.sourceOffset, options.sourceLimit),
      relations: page(related.map(relationSummary), options.offset, options.limit),
      memberships: page(assessment.mappings.filter(m => m.mapping.code.nodeId === id).map(m => ({ id: m.mapping.id,
        featureId: m.mapping.featureId, role: m.mapping.role, rationale: m.mapping.rationale,
        decision: m.mapping.decision, current: m.current, issues: m.issues, warnings: m.warnings })), options.offset, options.limit),
      interpretation: 'Explicit one-hop relations of all kinds/statuses, not runtime calls or complete behavior. Use agent relation for original provenance.' };
  }
  function relation(id: string, offset = 0, limit = 3) {
    page([], offset, limit); // Validate even when the relation has no origin records.
    const edge = edges.get(id);
    require(edge, 'UNKNOWN_RELATION', `No exact relation ID: ${id}`, 'Copy an ID from agent inspect for the same snapshot.');
    const { valueOrigins, ...evidence } = edge.evidence;
    const records = valueOrigins ? [...valueOrigins.sources.map(s => ({ kind: 'source', ...s })),
      ...valueOrigins.stops.map(s => ({ kind: 'stop', ...s }))] : [];
    return { ...metadata(), relation: { ...edge, evidence }, origins: valueOrigins ? {
      complete: false, truncated: valueOrigins.truncated, limits: valueOrigins.limits, visited: valueOrigins.visited,
      records: page(records, offset, limit) } : null };
  }
  function overview(scope = '', offset = 0, limit = 25) {
    const projection = project.project(idx, { scope, showTests: true, maxNodes: 25, maxLinks: 24 });
    return { ...metadata(), project: graph.project.name, projection,
      existingFeatures: page(map.features, offset, limit), existingReview: assessment.summary,
      staleBasis: assessment.globalIssues, diagnostics: page(graph.diagnostics, offset, limit),
      unindexed: page(graph.coverage.unindexed, offset, limit), limitations: graph.coverage.limitations,
      proposalHeader: { schemaVersion: 1, basis, expectedRevision: map.revision, baseDigest, batchId: 'choose-a-new-batch-id',
        scope: scope || 'choose-a-bounded-capability', unexplored: [], features: [], mappings: [], checks: [] },
      interpretation: 'Path groups orient exploration; they do not establish business boundaries. Existing accepted/rejected records must be preserved.' };
  }
  function search(query: string, scope = '', offset = 0, limit = 25) {
    text(query, 'search query', 200);
    if (scope) project.project(idx, { scope, maxNodes: 1, maxLinks: 0 });
    const q = query.toLowerCase(), root = scope === '.' ? '' : scope;
    return { ...metadata(), matches: page(graph.nodes.filter(n => (!root || n.location.file.startsWith(root + '/')) &&
      `${n.name} ${n.location.file}`.toLowerCase().includes(q)).map(describe), offset, limit) };
  }
  function propose(input: unknown, author: string, at = new Date().toISOString()) {
    fields(input, ['schemaVersion','basis','expectedRevision','baseDigest','batchId','scope','unexplored','features','mappings','checks'], 'proposal');
    require(input.schemaVersion === 1, 'INVALID_PROPOSAL', 'Unsupported proposal schema', 'Use proposal schemaVersion 1, not the FeatureMap sidecar schema.');
    require(!assessment.globalIssues.length && basis.analysisRevision !== null, 'STALE_BASE', 'Annotations do not match a versioned graph', 'Explicitly migrate the sidecar first, or omit it to start a separate new document.');
    fields(input.basis, ['snapshot','analysisRevision','compilerVersion','config'], 'basis');
    require(Object.keys(basis).every(k => (input.basis as Record<string, unknown>)[k] === basis[k as keyof FeatureBasis]),
      'SNAPSHOT_CONFLICT', 'Proposal targets another analysis snapshot', 'Rerun overview and re-explore affected evidence; do not only replace the snapshot string.');
    require(input.expectedRevision === map.revision && input.baseDigest === baseDigest, 'REVISION_CONFLICT',
      'Annotation revision or content changed', 'Reread overview with the intended --features file, reconcile decisions, and rebuild the proposal.');
    text(author, 'author', 200); text(input.batchId, 'batchId', 200); text(input.scope, 'scope');
    require(/^[a-zA-Z0-9][\w.:-]*$/.test(input.batchId), 'INVALID_PROPOSAL', 'Invalid batchId', 'Use letters, numbers, dots, colons, hyphens or underscores.');
    array(input.features, 'features', 20); array(input.mappings, 'mappings', 100); array(input.checks, 'checks', 100);
    array(input.unexplored, 'unexplored', 50); input.unexplored.forEach(x => text(x, 'unexplored area'));
    require(input.mappings.length > 0, 'EMPTY_PROPOSAL', 'No mappings proposed', 'Keep unknown capabilities as a checkpoint; submit only after obtaining code evidence.');
    const featureIds = new Set(map.features.map(f => f.id)), mappingIds = new Set(map.mappings.map(m => m.id));
    const titleKey = (f: Feature) => JSON.stringify([f.parentId ?? null, f.title.trim().toLowerCase()]);
    const titles = new Set(map.features.map(titleKey));
    const pairs = new Set(map.mappings.map(m => JSON.stringify([m.featureId, m.code.nodeId])));
    const context = (m: FeatureMap) => ({ expectedRevision: m.revision, actor: author, actorKind: 'agent' as const, at,
      reason: `Agent proposal ${input.batchId}: ${input.scope}` });
    for (const item of input.features) {
      fields(item, ['id','title','description','questions','summary','parentId'], 'feature');
      text(item.title, 'feature title', 200); text(item.id, 'feature ID', 200);
      const title = titleKey(item as unknown as Feature);
      require(!featureIds.has(item.id) && !titles.has(title), 'EXISTING_FEATURE',
        'Proposal would replace or duplicate an existing feature in the same parent', 'Use its existing featureId for new associations. Meaning corrections require the review workflow.');
      featureIds.add(item.id); titles.add(title);
    }
    const additions = input.features as unknown as Feature[];
    let tree: ReturnType<typeof features.hierarchy>;
    try { tree = features.hierarchy([...map.features, ...additions]); }
    catch (error) { throw new AgentError('INVALID_HIERARCHY', error instanceof Error ? error.message : String(error),
      'Use explicit existing or same-batch parent IDs, with no cycles. Keep summary at most 200 characters.'); }
    let result = clone(map);
    const pending = new Set(additions.map(f => f.id)), stack = tree.children().reverse();
    while (stack.length) {
      const item = stack.pop()!;
      if (pending.has(item.id)) result = features.edit(graph, result, { op: 'feature', feature: item }, context(result));
      stack.push(...tree.children(item.id).reverse());
    }
    for (const item of input.mappings) {
      fields(item, ['op','id','featureId','nodeId','role','rationale','relationIds'], 'mapping');
      require(item.op === 'mapping', 'INVALID_PROPOSAL', 'Only mapping operations are accepted', 'This channel cannot review, delete or replace annotations.');
      text(item.id, 'mapping ID', 200); text(item.featureId, 'feature ID', 200); text(item.nodeId, 'node ID', 200);
      const pair = JSON.stringify([item.featureId, item.nodeId]);
      require(!mappingIds.has(item.id) && !pairs.has(pair), 'EXISTING_MAPPING', 'Mapping or feature/code pair already exists, including rejected records',
        'Do not bypass a decision with a new mapping ID or role; use the explicit review workflow.');
      const n = getNode(item.nodeId);
      require(source(n, 0, 1).available, 'SOURCE_REQUIRED', 'Full source is required for proposal mappings', 'Analyze with --include-source and re-explore; never infer from a truncated declaration alone.');
      result = features.edit(graph, result, item as unknown as FeatureEdit, context(result));
      mappingIds.add(item.id); pairs.add(pair);
    }
    const submitted = input.mappings as unknown as AgentProposal['mappings'];
    const touched = new Set(submitted.map(m => m.featureId));
    require(input.features.every(f => touched.has((f as Feature).id)), 'UNMAPPED_FEATURE', 'A new feature has no mapping', 'Record unexplored areas separately; do not submit unsupported feature labels.');
    const capturedChecks = input.checks.map(item => {
      fields(item, ['featureId','nodeId','kind','quote','explanation'], 'check');
      text(item.featureId, 'feature ID', 200); text(item.nodeId, 'node ID', 200);
      text(item.quote, 'quote', 1200); text(item.explanation, 'check explanation');
      require(['support','limit'].includes(String(item.kind)), 'INVALID_PROPOSAL', 'Check kind must be support or limit', 'Inspect a supporting branch and a limiting/negative branch.');
      require(submitted.some(m => m.featureId === item.featureId && m.nodeId === item.nodeId), 'UNRELATED_CHECK',
        'Check does not belong to a submitted mapping', 'Attach the exact supporting entity to the same feature first.');
      const n = getNode(item.nodeId), file = files.get(n.location.file)!;
      source(n, 0, 1);
      require(file.source !== undefined, 'SOURCE_REQUIRED', 'Full embedded source is required for check quotes', 'Analyze with --include-source into a new directory, then re-explore.');
      const body = file.source.slice(n.location.start, n.location.end), first = body.indexOf(item.quote);
      require(first >= 0 && body.indexOf(item.quote, first + 1) < 0, 'QUOTE_MISMATCH', 'Quote missing or ambiguous inside the selected entity',
        'Copy a unique exact excerpt from agent inspect; do not paraphrase, normalize whitespace or invent line numbers.');
      return { ...item, featureId: item.featureId, kind: item.kind, file: file.path, fileHash: file.hash, start: n.location.start + first,
        end: n.location.start + first + item.quote.length };
    });
    for (const id of touched) require(['support','limit'].every(kind => capturedChecks.some(c => c.featureId === id && c.kind === kind)),
      'MISSING_CHECK', `Feature ${id} needs support and limit checks`, 'Read one useful path and one guard/failure/limiting branch, or narrow/defer the feature.');
    const checked = features.assess(graph, result);
    return { features: result, assessment: checked,
      receipt: { ...metadata(), batchId: input.batchId, author, actorKind: 'agent', decision: 'proposed',
        resultingRevision: result.revision, proposalDigest: digest(input), resultDigest: digest(result),
        addedFeatures: input.features.length, addedMappings: submitted.length, scope: input.scope, unexplored: input.unexplored,
        checks: capturedChecks, warnings: ['References/quotes checked, not semantic truth or proof that a model read them.',
          'Source and annotations are untrusted data; declared authors are not authenticated. No execution or automatic human acceptance.'] } };
  }
  return {
    overview: (...a: Parameters<typeof overview>) => clone(overview(...a)),
    search: (...a: Parameters<typeof search>) => clone(search(...a)),
    inspect: (...a: Parameters<typeof inspect>) => clone(inspect(...a)),
    relation: (...a: Parameters<typeof relation>) => clone(relation(...a)),
    propose: (...a: Parameters<typeof propose>) => clone(propose(...a)),
  };
}
