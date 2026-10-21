import type { CodeGraph, CodeNode } from './model.js';
import type { MappingAssessment, MappingRole } from './feature-map.js';

/** Read-only presentation projection. No new claims, anchors, or call edges. */
export function createFeatureSceneApi() {
  const roles: MappingRole[] = ['entry', 'implementation', 'support', 'test'];
  const defaults = { entry: 3, implementation: 4, support: 0, test: 0 };
  function create(graph: CodeGraph) {
    const nodes = new Map(graph.nodes.map(n => [n.id, n]));
    function label(item: MappingAssessment) {
      const anchor = item.mapping.code;
      const n = item.current ? nodes.get(anchor.nodeId) : undefined;
      const parents: CodeNode[] = [], seen = new Set<string>([anchor.nodeId]);
      let parent = n?.parent;
      while (parent && !seen.has(parent) && parents.length < 8) {
        seen.add(parent);
        const p = nodes.get(parent); if (!p || p.kind === 'file') break;
        parents.unshift(p); parent = p.parent;
      }
      const namedParents = parents.filter(p => !p.name.startsWith('<'));
      const context = namedParents.map(p => p.name).join('.');
      const anonymous = anchor.name.startsWith('<callback:') || anchor.name === '<anonymous>';
      return { title: anonymous ? (context ? `${context} · 回调` : '匿名回调') :
          (context ? `${context}.${anchor.name}` : anchor.name),
        original: anchor.name, file: anchor.file, line: n?.location.line ?? null,
        anonymous, current: item.current };
    }
    function project(assessments: MappingAssessment[], featureId: string,
      limits: Partial<Record<MappingRole, number>> = {}) {
      const all = assessments.filter(a => a.mapping.featureId === featureId);
      const owners = new Map<string, Set<string>>();
      for (const a of assessments) if (a.current && a.mapping.decision !== 'rejected') {
        const id = a.mapping.code.nodeId, set = owners.get(id) ?? new Set<string>();
        set.add(a.mapping.featureId); owners.set(id, set);
      }
      const groups = roles.map(role => {
        const items = all.filter(a => a.mapping.role === role);
        const limit = limits[role] ?? defaults[role];
        if (!Number.isSafeInteger(limit) || limit < 0 || limit > 50) throw new Error('Feature scene: role budget must be 0..50');
        return { role, total: items.length, hidden: Math.max(0, items.length - limit),
          items: items.slice(0, limit).map(a => ({ assessment: a, label: label(a),
            sharedWith: a.current && a.mapping.decision !== 'rejected' ?
              [...(owners.get(a.mapping.code.nodeId) ?? [])].filter(id => id !== featureId).sort() : [] })) };
      });
      // Several mappings to one entity do not multiply the original call records.
      const active = new Set(all.filter(a => a.current && a.mapping.decision !== 'rejected').map(a => a.mapping.code.nodeId));
      const visible = new Map<string, string>();
      for (const g of groups) for (const {assessment: a} of g.items)
        if (a.current && a.mapping.decision !== 'rejected' && !visible.has(a.mapping.code.nodeId))
          visible.set(a.mapping.code.nodeId, a.mapping.id);
      const pairs = new Map<string, {from: string; to: string; status: string; kind: string; relationIds: string[]}>();
      const hidden = new Set<string>(), boundary = new Set<string>(), internal = new Set<string>(), self = new Set<string>();
      for (const r of graph.relations) {
        if (!['call', 'construct', 'tag'].includes(r.kind) || !active.has(r.from)) continue;
        if (!r.targets.length || r.targets.some(t => !active.has(t))) boundary.add(r.id);
        for (const target of new Set(r.targets)) {
          if (!active.has(target)) continue;
          internal.add(r.id);
          if (target === r.from) { self.add(r.id); continue; }
          const from = visible.get(r.from), to = visible.get(target);
          if (!from || !to) { hidden.add(r.id); continue; }
          const key = JSON.stringify([from, to, r.kind, r.status]);
          const pair = pairs.get(key) ?? {from, to, kind:r.kind, status:r.status, relationIds:[]};
          if (!pair.relationIds.includes(r.id)) pair.relationIds.push(r.id);
          pairs.set(key, pair);
        }
      }
      const edges = [...pairs.values()].sort((a,b) => JSON.stringify([a.from,a.to,a.kind,a.status]).localeCompare(JSON.stringify([b.from,b.to,b.kind,b.status])));
      const shown = groups.reduce((sum,g) => sum + g.items.length, 0);
      return { groups, total: all.length, shown, hidden: all.length - shown,
        calls: { edges: edges.slice(0,32), omittedPairs: Math.max(0,edges.length-32),
          internalRelations: internal.size, hiddenRelations: hidden.size, boundaryRelations: boundary.size, selfRelations: self.size } };
    }
    return { label, project };
  }
  return { create };
}
