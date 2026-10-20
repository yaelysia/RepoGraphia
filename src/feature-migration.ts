import type { CodeGraph, CodeNode, Relation } from './model.js';
import type { CodeAnchor, EditContext, FeatureBasis, FeatureMap, MappingRole } from './feature-map.js';
import type { createFeatureMapApi } from './feature-map.js';

export type MigrationAction =
  | { id: string; action: 'carry' | 'defer' }
  | { id: string; action: 'replace'; nodeId: string; relationIds: string[]; role: MappingRole; rationale: string };
export interface MigrationRequest {
  sourceRevision: number; from: FeatureBasis; to: FeatureBasis; actions: MigrationAction[];
}
export interface MigrationRow {
  id: string; featureId: string; code: CodeAnchor; decision: string;
  status: 'reusable' | 'needs-review' | 'unmatched'; reasons: string[];
}

/** Explicit reference migration, NOT semantic equivalence or a symbol-rename detector. */
export function createFeatureMigrationApi(api: ReturnType<typeof createFeatureMapApi>) {
  function require(ok: unknown, message: string): asserts ok { if (!ok) throw new Error('Feature migration: ' + message); }
  const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
  const canonical = (x: unknown): string => {
    if (Array.isArray(x)) return '[' + x.map(canonical).join(',') + ']';
    if (x && typeof x === 'object') return '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canonical((x as Record<string, unknown>)[k])).join(',') + '}';
    return JSON.stringify(x) ?? 'undefined';
  };
  function shape(g: CodeGraph) {
    const cache = new Map<string,string>();
    const files = new Map(g.files.map(f => [f.path, f.hash]));
    const nodes = new Map(g.nodes.map(n => [n.id, n]));
    const byFile = new Map<string, CodeNode[]>(), incident = new Map<string, Relation[]>();
    for (const n of g.nodes) { const list = byFile.get(n.location.file) ?? []; list.push(n); byFile.set(n.location.file, list); }
    for (const e of g.relations) for (const id of new Set([e.from, ...e.targets])) {
      const list = incident.get(id) ?? []; list.push(e); incident.set(id, list);
    }
    // Include nested bodies, incoming/outgoing records, endpoint content hashes and complete origin metadata.
    // This is only a bounded static neighborhood, never a proof that distant behavior is unchanged.
    return (anchor: CodeAnchor) => {
      const key=canonical(anchor),cached=cache.get(key);if(cached!==undefined)return cached;
      const members = (byFile.get(anchor.file) ?? []).filter(n => anchor.kind === 'file' ||
        (n.location.start >= anchor.start && n.location.end <= anchor.end));
      const edges = new Map<string, Relation>();
      for (const n of members) for (const e of incident.get(n.id) ?? []) edges.set(e.id, e);
      const endpoints = [...new Set([...edges.values()].flatMap(e => [e.from, ...e.targets]))].sort();
      const parents: CodeNode[] = [], seen = new Set<string>();
      let parent = nodes.get(anchor.nodeId)?.parent;
      while (parent) { require(!seen.has(parent), 'cyclic parent index'); seen.add(parent);
        const n = nodes.get(parent); require(n, 'missing parent index'); parents.push(n); parent = n.parent; }
      const result=canonical({ members: members.sort((a,b) => a.id.localeCompare(b.id)), parents,
        edges: [...edges.values()].sort((a,b) => a.id.localeCompare(b.id)),
        endpoints: endpoints.map(id => { const n = nodes.get(id); return {id, node:n ?? null, hash:n ? files.get(n.location.file) ?? null : null}; }) });
      cache.set(key,result);return result;
    };
  }
  function plan(oldGraph: CodeGraph, newGraph: CodeGraph, input: unknown) {
    const old = api.assess(oldGraph, input), current = api.assess(newGraph, input);
    require(!old.globalIssues.length, 'old graph does not match the document basis');
    const from = api.basis(oldGraph), to = api.basis(newGraph);
    require(canonical(from) !== canonical(to), 'same basis; migration is unnecessary');
    const contract = (['analysisRevision','compilerVersion','config'] as const).filter(k => from[k] !== to[k]).map(k => 'changed-' + k);
    if (oldGraph.project.name !== newGraph.project.name) contract.push('changed-project-name');
    const beforeShape = shape(oldGraph), afterShape = shape(newGraph);
    const rows: MigrationRow[] = old.mappings.map((item,i) => {
      const next = current.mappings[i]!, reasons: string[] = [];
      if (!item.current) reasons.push('old-reference-unverified', ...item.issues);
      reasons.push(...contract, ...next.issues.filter(x => x !== 'changed-snapshot'));
      // Only identical exact anchors may be compared. Never search by name or source similarity.
      if (!reasons.length && beforeShape(item.mapping.code) !== afterShape(item.mapping.code)) reasons.push('changed-static-neighborhood');
      const missing = reasons.some(x => ['missing-file','missing-node','missing-relation'].includes(x));
      return { id:item.mapping.id, featureId:item.mapping.featureId, code:clone(item.mapping.code), decision:item.mapping.decision,
        status:missing ? 'unmatched' : reasons.length ? 'needs-review' : 'reusable', reasons:[...new Set(reasons)] };
    });
    return { migrationVersion:1 as const, sourceRevision:old.map.revision, from, to, rows,
      summary: {reusable:rows.filter(x=>x.status==='reusable').length, needsReview:rows.filter(x=>x.status==='needs-review').length,
        unmatched:rows.filter(x=>x.status==='unmatched').length},
      limitations:['Reusable means exact static references and their recorded neighborhood still match, not unchanged business behavior.',
        'Migration is explicit. Accepted decisions reset to proposed; rejected decisions are retained.',
        'Deferred records retain their old basis and remain stale. No same-name or fuzzy reanchoring.'] };
  }
  function apply(oldGraph: CodeGraph, newGraph: CodeGraph, input: unknown, request: MigrationRequest, context: EditContext): FeatureMap {
    const map = api.validate(input), ctxKeys = ['expectedRevision','actor','actorKind','at','reason'];
    require(context && Object.keys(context).every(k=>ctxKeys.includes(k)), 'invalid edit context');
    require(context.expectedRevision === map.revision && request?.sourceRevision === map.revision, 'revision conflict');
    require(context.actorKind === 'manual', 'explicit manual migration required (identity is self-declared)');
    require(typeof context.actor === 'string' && !!context.actor.trim() && typeof context.reason === 'string' && !!context.reason.trim(), 'author and reason required');
    require(request && Object.keys(request).every(k=>['sourceRevision','from','to','actions'].includes(k)), 'unknown request field');
    const p = plan(oldGraph, newGraph, map); // Recompute, never trust plan classifications supplied by a caller.
    require(canonical(request.from) === canonical(p.from) && canonical(request.to) === canonical(p.to), 'source/target basis conflict');
    require(Array.isArray(request.actions) && request.actions.length <= 10000, 'invalid actions/budget');
    const actions = new Map<string, MigrationAction>(), rows = new Map(p.rows.map(r=>[r.id,r]));
    for (const a of request.actions) {
      require(a && typeof a === 'object' && rows.has(a.id), 'unknown mapping');
      require(!actions.has(a.id), 'duplicate action');
      require(['carry','defer','replace'].includes(a.action), 'unknown action');
      require(Object.keys(a).every(k=>(a.action === 'replace' ? ['id','action','nodeId','relationIds','role','rationale'] : ['id','action']).includes(k)), 'unknown action field');
      require(a.action !== 'carry' || rows.get(a.id)!.status === 'reusable', 'cannot carry changed or unverified references');
      actions.set(a.id,a);
    }
    require([...actions.values()].some(a=>a.action !== 'defer'), 'select at least one carry or replacement');
    const result = clone(map), capture = api.anchors(newGraph);
    result.schemaVersion = 2; result.basis = clone(p.to);
    result.mappings = map.mappings.map(m => {
      const a = actions.get(m.id);
      if (!a || a.action === 'defer') return {...clone(m), basis:clone(m.basis ?? map.basis)};
      const refs = a.action === 'replace' ? capture(a.nodeId,a.relationIds) : capture(m.code.nodeId,m.evidence.map(e=>e.relationId));
      return {...clone(m), ...refs, basis:clone(p.to), decision:m.decision === 'rejected' ? 'rejected' : 'proposed',
        ...(a.action === 'replace' ? {role:a.role,rationale:a.rationale} : {})};
    });
    result.revision++;
    result.history.push({revision:result.revision,actor:context.actor,actorKind:context.actorKind,at:context.at,reason:context.reason,
      operation:'migration',subject:'document',before:{basis:map.basis,mappings:map.mappings},
      after:{basis:result.basis,mappings:result.mappings,actions:request.actions,from:p.from,to:p.to}});
    const checked = api.assess(newGraph,result);
    for (const item of checked.mappings) {
      const a = actions.get(item.mapping.id);
      if (a && a.action !== 'defer') require(item.current, 'invalid replacement: ' + item.issues.join(', '));
      else require(!item.current, 'deferred mapping must remain stale');
    }
    return checked.map;
  }
  return {plan,apply};
}
