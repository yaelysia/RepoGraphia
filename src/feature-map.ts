import type { CodeGraph, CodeNode, Relation } from './model.js';

export type ReviewDecision = 'proposed' | 'accepted' | 'rejected';
export type MappingRole = 'entry' | 'implementation' | 'support' | 'test';
export interface Feature {
  id: string; title: string; description: string; questions: string[];
  /** Author-declared short explanation and containment; neither is inferred from code. */
  summary?: string; parentId?: string;
}
export interface CodeAnchor {
  nodeId: string; file: string; fileHash: string; start: number; end: number;
  name: string; kind: CodeNode['kind'];
}
export interface RelationAnchor {
  relationId: string; file: string; fileHash: string; start: number; end: number;
  kind: Relation['kind']; status: Relation['status']; typeOnly: boolean;
  from: string; targets: string[]; rule: string;
}
export interface FeatureBasis {
  snapshot: string; analysisRevision: number | null; compilerVersion: string; config: string | null;
}
export interface FeatureMapping {
  id: string; featureId: string; code: CodeAnchor; role: MappingRole;
  rationale: string; evidence: RelationAnchor[]; decision: ReviewDecision;
  /** Required in schemas 2/3: deferred annotations retain their original snapshot. */
  basis?: FeatureBasis;
}
export interface FeatureMap {
  schemaVersion: 1 | 2 | 3; revision: number;
  basis: FeatureBasis;
  features: Feature[]; mappings: FeatureMapping[];
  /** User-declared local history, NOT authenticated identity or a tamper-proof audit log. */
  history: { revision: number; actor: string; actorKind: 'manual' | 'agent'; at: string;
    reason: string; operation: string; subject: string; before: unknown; after: unknown }[];
}
export type FeatureEdit =
  | { op: 'feature'; feature: Feature }
  | { op: 'mapping'; id: string; featureId: string; nodeId: string; role: MappingRole; rationale: string; relationIds: string[] }
  | { op: 'review'; id: string; decision: ReviewDecision };
export interface EditContext {
  expectedRevision: number; actor: string; actorKind: 'manual' | 'agent'; at: string; reason: string;
}
export interface MappingAssessment {
  mapping: FeatureMapping; current: boolean; issues: string[]; warnings: string[];
}

/** Pure, self-contained factory shared by the CLI and the offline browser. No name guessing. */
export function createFeatureMapApi() {
  const roles = ['entry', 'implementation', 'support', 'test'];
  const decisions = ['proposed', 'accepted', 'rejected'];
  const nodeKinds = ['file','function','method','constructor','class','interface','signature'];
  const relationKinds = ['call','construct','tag','jsx','callback','import','reexport','extends','implements'];
  const statuses = ['bound','candidate','unresolved','external'];
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
  function require(ok: unknown, message: string): asserts ok { if (!ok) throw new Error('Feature map: ' + message); }
  function object(x: unknown, keys: string[]): Record<string, unknown> {
    require(x && typeof x === 'object' && !Array.isArray(x), 'expected object');
    const r = x as Record<string, unknown>;
    require(Object.keys(r).every(k => keys.includes(k)), 'unknown field');
    return r;
  }
  function text(x: unknown, name: string, max = 8000): asserts x is string {
    require(typeof x === 'string' && x.trim().length > 0 && x.length <= max, `invalid ${name}`);
  }
  function id(x: unknown): asserts x is string { text(x, 'id', 200); require(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(x), 'invalid id'); }
  function integer(x: unknown, name: string, min = 0) { require(Number.isSafeInteger(x) && Number(x) >= min, `invalid ${name}`); }
  function array(x: unknown, max = 10000): asserts x is unknown[] { require(Array.isArray(x) && x.length <= max, 'array limit/type'); }
  function member(x: unknown, values: string[], name: string) { require(typeof x === 'string' && values.includes(x), `invalid ${name}`); }
  function hash(x: unknown) { require(typeof x === 'string' && /^[a-f0-9]{64}$/.test(x), 'invalid SHA-256'); }
  function unique(items: string[]) { require(new Set(items).size === items.length, 'duplicate id/reference'); }
  function path(x: unknown) {
    text(x, 'relative path', 2000);
    require(!x.includes('\\') && !x.startsWith('/') && !/^[A-Za-z]:/.test(x) &&
      x.split('/').every(p => p && p !== '.' && p !== '..'), 'invalid relative path');
  }
  function feature(x: unknown, nested = false) {
    const f = object(x, ['id','title','description','questions', ...(nested ? ['summary','parentId'] : [])]); id(f.id); text(f.title, 'title', 200);
    text(f.description, 'description'); array(f.questions, 100); f.questions.forEach(q => text(q, 'question', 2000));
    if ('summary' in f) text(f.summary, 'summary', 200);
    if ('parentId' in f) id(f.parentId);
  }
  function sameFeatureMeaning(a: Feature, b: Feature) {
    return a.title === b.title && a.description === b.description && a.summary === b.summary && a.parentId === b.parentId &&
      a.questions.length === b.questions.length && a.questions.every((question, i) => question === b.questions[i]);
  }
  /** Explicit containment forest, shared by authoring and navigation. Depth follows the data. */
  function hierarchy(features: Feature[]) {
    array(features, 1000);
    const byId = new Map<string, Feature>(), groups = new Map<string | null, Feature[]>();
    for (const f of features) {
      feature(f, true); require(!byId.has(f.id), 'duplicate feature id'); byId.set(f.id, f);
      const key = f.parentId ?? null, children = groups.get(key) ?? [];
      children.push(f); groups.set(key, children);
    }
    for (const f of features) if (f.parentId !== undefined) {
      require(byId.has(f.parentId), 'unknown parent feature');
      require(f.parentId !== f.id, 'feature cannot contain itself');
    }
    const complete = new Set<string>();
    for (const f of features) {
      const visiting = new Set<string>(); let current: Feature | undefined = f;
      while (current && !complete.has(current.id)) {
        require(!visiting.has(current.id), 'cyclic feature hierarchy'); visiting.add(current.id);
        current = current.parentId === undefined ? undefined : byId.get(current.parentId);
      }
      for (const id of visiting) complete.add(id);
    }
    const children = (parentId: string | null = null): Feature[] => [...(groups.get(parentId) ?? [])];
    function path(id: string): Feature[] {
      require(byId.has(id), 'unknown feature');
      const result: Feature[] = []; let current = byId.get(id);
      while (current) { result.push(current); current = current.parentId === undefined ? undefined : byId.get(current.parentId); }
      return result.reverse();
    }
    function descendants(id: string): Feature[] {
      require(byId.has(id), 'unknown feature');
      const result: Feature[] = [], stack = children(id).reverse();
      while (stack.length) { const f = stack.pop()!; result.push(f); stack.push(...children(f.id).reverse()); }
      return result;
    }
    return { children, path, descendants };
  }
  function anchor(x: unknown, relation: boolean) {
    const r = object(x, relation ? ['relationId','file','fileHash','start','end','kind','status','typeOnly','from','targets','rule'] :
      ['nodeId','file','fileHash','start','end','name','kind']);
    text(relation ? r.relationId : r.nodeId, 'graph id'); path(r.file); hash(r.fileHash);
    integer(r.start, 'start'); integer(r.end, 'end'); require(Number(r.end) >= Number(r.start), 'reversed range');
    member(r.kind, relation ? relationKinds : nodeKinds, 'anchor kind');
    if (relation) { text(r.from, 'relation owner'); text(r.rule, 'rule'); array(r.targets, 1000); r.targets.forEach(t => text(t, 'target')); unique(r.targets as string[]); member(r.status, statuses, 'status'); require(typeof r.typeOnly === 'boolean', 'invalid typeOnly'); }
    else text(r.name, 'node name');
  }
  function validate(input: unknown): FeatureMap {
    require(JSON.stringify(input)?.length <= 5 * 1024 * 1024, 'document exceeds 5 MiB character budget');
    const m = object(input, ['schemaVersion','revision','basis','features','mappings','history']);
    require(m.schemaVersion === 1 || m.schemaVersion === 2 || m.schemaVersion === 3, 'unsupported schema'); integer(m.revision, 'revision');
    validateBasis(m.basis);
    array(m.features, 1000); m.features.forEach(f => feature(f, m.schemaVersion === 3));
    const features = m.features as Feature[]; unique(features.map(f => f.id));
    if (m.schemaVersion === 3) hierarchy(features);
    array(m.mappings);
    for (const item of m.mappings) {
      const r = object(item, ['id','featureId','code','role','rationale','evidence','decision', ...(m.schemaVersion !== 1 ? ['basis'] : [])]);
      if (m.schemaVersion !== 1) validateBasis(r.basis);
      id(r.id); require(features.some(f => f.id === r.featureId), 'unknown feature'); anchor(r.code, false);
      member(r.role, roles, 'role'); text(r.rationale, 'rationale'); member(r.decision, decisions, 'decision');
      array(r.evidence, 100); r.evidence.forEach(e => anchor(e, true));
      unique((r.evidence as RelationAnchor[]).map(e => e.relationId));
    }
    unique((m.mappings as FeatureMapping[]).map(r => r.id));
    array(m.history); require(m.history.length === m.revision, 'history/revision mismatch');
    m.history.forEach((item, i) => {
      const h = object(item, ['revision','actor','actorKind','at','reason','operation','subject','before','after']);
      require(h.revision === i + 1, 'nonsequential edit history'); text(h.actor, 'actor', 200);
      member(h.actorKind, ['manual','agent'], 'actorKind'); timestamp(h.at); text(h.reason, 'edit reason');
      member(h.operation, ['feature','mapping','review', ...(m.schemaVersion !== 1 ? ['migration'] : [])], 'operation'); id(h.subject);
      require('before' in h && 'after' in h, 'history values missing');
    });
    return clone(input as FeatureMap);
  }
  function validateBasis(input: unknown) {
    const b = object(input, ['snapshot','analysisRevision','compilerVersion','config']); hash(b.snapshot);
    if (b.analysisRevision !== null) integer(b.analysisRevision, 'analysisRevision', 1);
    text(b.compilerVersion, 'compilerVersion'); if (b.config !== null) path(b.config);
  }
  function basisIssues(current: FeatureBasis, original: FeatureBasis): string[] {
    const issues: string[] = [];
    for (const key of ['snapshot','analysisRevision','compilerVersion','config'] as const)
      if (current[key] !== original[key]) issues.push('changed-' + key);
    if (current.analysisRevision === null || original.analysisRevision === null) issues.push('unversioned-analysis');
    return issues;
  }
  function timestamp(x: unknown) { text(x, 'timestamp', 40); require(/^\d{4}-\d\d-\d\dT/.test(x) && Number.isFinite(Date.parse(x)), 'invalid timestamp'); }
  const basis = (g: CodeGraph): FeatureMap['basis'] => ({ snapshot: g.project.snapshot,
    analysisRevision: g.project.analysisRevision ?? null, compilerVersion: g.project.compilerVersion, config: g.project.config });
  const create = (g: CodeGraph): FeatureMap => validate({ schemaVersion: 1, revision: 0, basis: basis(g), features: [], mappings: [], history: [] });
  function indexes(g: CodeGraph) {
    require(g.schemaVersion === 1, 'unsupported graph');
    unique(g.nodes.map(n => n.id)); unique(g.relations.map(e => e.id)); unique(g.files.map(f => f.path));
    return { nodes: new Map(g.nodes.map(n => [n.id,n])), edges: new Map(g.relations.map(e => [e.id,e])), files: new Map(g.files.map(f => [f.path,f])) };
  }
  function assess(g: CodeGraph, input: unknown) {
    const map = validate(input), idx = indexes(g), current = basis(g);
    const globalIssues = basisIssues(current, map.basis);
    const mappings: MappingAssessment[] = map.mappings.map(mapping => {
      const issues = [...globalIssues, ...basisIssues(current, mapping.basis ?? map.basis)], warnings: string[] = ['semantic-claim-not-program-proof'];
      const a = mapping.code, n = idx.nodes.get(a.nodeId), file = idx.files.get(a.file);
      if (!file) issues.push('missing-file');
      else if (file.hash !== a.fileHash) issues.push('changed-source');
      if (!n) issues.push('missing-node');
      else if (n.location.file !== a.file || n.location.start !== a.start || n.location.end !== a.end || n.kind !== a.kind || n.name !== a.name)
        issues.push('changed-node-anchor');
      if (n?.kind === 'file') warnings.push('file-level-scope');
      if (n?.kind === 'interface' || n?.kind === 'signature') warnings.push('type-declaration-anchor');
      if (!mapping.evidence.length) warnings.push('declaration-only');
      for (const e of mapping.evidence) {
        const edge = idx.edges.get(e.relationId);
        if (!edge) { issues.push('missing-relation'); continue; }
        const p = edge.evidence;
        if (p.fileHash !== e.fileHash || p.location.file !== e.file || p.location.start !== e.start || p.location.end !== e.end ||
          edge.kind !== e.kind || edge.status !== e.status || !!edge.typeOnly !== e.typeOnly || idx.files.get(e.file)?.hash !== e.fileHash ||
          edge.from !== e.from || p.rule !== e.rule || JSON.stringify([...edge.targets].sort()) !== JSON.stringify([...e.targets].sort()))
          issues.push('changed-relation-anchor');
        const endpoints = [edge.from, ...edge.targets];
        if (!endpoints.every(x => idx.nodes.has(x))) issues.push('missing-relation-endpoint');
        if (!(n?.kind === 'file' ? endpoints.some(x => idx.nodes.get(x)?.location.file === n.location.file) : endpoints.includes(a.nodeId)))
          issues.push('unrelated-relation');
        if (edge.status !== 'bound') warnings.push('evidence-' + edge.status);
        if (edge.typeOnly) warnings.push('type-only-evidence');
        if (!['call','construct','tag'].includes(edge.kind)) warnings.push('non-call-evidence');
        if (p.valueOrigins) { warnings.push('incomplete-value-origins'); if (p.valueOrigins.truncated) warnings.push('truncated-value-origins'); }
      }
      return { mapping, current: !issues.length, issues: [...new Set(issues)], warnings: [...new Set(warnings)] };
    });
    return { map, mappings, globalIssues, features: map.features.map(f => ({ ...f,
      mappingIds: mappings.filter(m => m.mapping.featureId === f.id).map(m => m.mapping.id) })),
      summary: { features: map.features.length, mappings: mappings.length,
        current: mappings.filter(m => m.current).length, stale: mappings.filter(m => !m.current).length,
        proposed: mappings.filter(m => m.mapping.decision === 'proposed').length,
        accepted: mappings.filter(m => m.mapping.decision === 'accepted').length,
        rejected: mappings.filter(m => m.mapping.decision === 'rejected').length,
        mappedNodes: new Set(mappings.filter(m => m.current && m.mapping.decision !== 'rejected').map(m => m.mapping.code.nodeId)).size } };
  }
  /** Capture exact current references once per graph; callers still assess relation relevance. */
  function anchors(g: CodeGraph) {
    const idx = indexes(g);
    return (nodeId: string, relationIds: string[]): Pick<FeatureMapping, 'code' | 'evidence'> => {
      const n = idx.nodes.get(nodeId); require(n, 'unknown node; exact id required');
      const f = idx.files.get(n.location.file); require(f, 'unindexed source');
      array(relationIds, 100); unique(relationIds);
      return {
        code: { nodeId: n.id, file: n.location.file, fileHash: f.hash, start: n.location.start,
          end: n.location.end, name: n.name, kind: n.kind },
        evidence: relationIds.map(key => {
          const r = idx.edges.get(key); require(r, 'unknown relation'); const p = r.evidence;
          return { relationId: r.id, file: p.location.file, fileHash: p.fileHash, start: p.location.start, end: p.location.end,
            kind: r.kind, status: r.status, typeOnly: !!r.typeOnly, from: r.from, targets: [...r.targets], rule: p.rule };
        }),
      };
    };
  }
  function forNode(g: CodeGraph, input: unknown, nodeId: string) {
    return assess(g, input).mappings.filter(m => m.current && m.mapping.decision !== 'rejected' && m.mapping.code.nodeId === nodeId);
  }
  function edit(g: CodeGraph, input: unknown, operation: FeatureEdit, context: EditContext): FeatureMap {
    const map = validate(input), ctx = object(context, ['expectedRevision','actor','actorKind','at','reason']);
    require(ctx.expectedRevision === map.revision, 'revision conflict'); text(ctx.actor, 'actor', 200);
    member(ctx.actorKind, ['manual','agent'], 'actorKind'); timestamp(ctx.at); text(ctx.reason, 'edit reason');
    let subject: string, before: unknown = null, after: unknown;
    if (operation.op === 'feature') {
      object(operation, ['op','feature']); feature(operation.feature, true); subject = operation.feature.id;
      if (map.schemaVersion !== 3 && ('summary' in operation.feature || 'parentId' in operation.feature)) {
        map.schemaVersion = 3;
        map.mappings = map.mappings.map(m => ({ ...m, basis: clone(m.basis ?? map.basis) }));
      }
      const old = map.features.find(f => f.id === subject); before = old ?? null; after = clone(operation.feature);
      map.features = [...map.features.filter(f => f.id !== subject), after as Feature];
      // JSON object-key order is not a semantic edit; question order remains authored content.
      if (old && !sameFeatureMeaning(old, operation.feature))
        map.mappings = map.mappings.map(m => m.featureId === subject && m.decision === 'accepted' ? { ...m, decision: 'proposed' } : m);
    } else if (operation.op === 'mapping') {
      object(operation, ['op','id','featureId','nodeId','role','rationale','relationIds']);
      id(operation.id); member(operation.role, roles, 'role'); text(operation.rationale, 'rationale');
      require(map.features.some(f => f.id === operation.featureId), 'unknown feature');
      require(!assess(g, map).globalIssues.length, 'stale basis; create a new map for a new snapshot');
      const captured = anchors(g)(operation.nodeId, operation.relationIds);
      subject = operation.id; before = map.mappings.find(m => m.id === subject) ?? null;
      after = { id: subject, featureId: operation.featureId, role: operation.role, rationale: operation.rationale,
        ...captured, ...(map.schemaVersion !== 1 ? { basis: basis(g) } : {}), decision: 'proposed' } satisfies FeatureMapping;
      map.mappings = [...map.mappings.filter(m => m.id !== subject), after as FeatureMapping];
      const assessment = assess(g, map).mappings.find(m => m.mapping.id === subject)!;
      require(assessment.current, assessment.issues.join(', '));
    } else if (operation.op === 'review') {
      object(operation, ['op','id','decision']); member(operation.decision, decisions, 'decision'); subject = operation.id;
      const m = map.mappings.find(m => m.id === subject); require(m, 'unknown mapping'); before = clone(m);
      if (operation.decision === 'accepted') {
        require(context.actorKind === 'manual', 'agent proposals cannot self-accept');
        require(assess(g, map).mappings.find(m => m.mapping.id === subject)!.current, 'cannot accept stale mapping');
      }
      m.decision = operation.decision; after = clone(m);
    } else throw new Error('Feature map: unknown edit operation');
    map.revision++;
    map.history.push({ revision: map.revision, actor: context.actor, actorKind: context.actorKind, at: context.at,
      reason: context.reason, operation: operation.op, subject, before, after });
    return validate(map);
  }
  return { create, validate, assess, forNode, edit, anchors, basis, hierarchy };
}
