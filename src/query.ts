import type { CodeGraph, RelationKind } from './model.js';
import { CALL_KINDS } from './model.js';

export function findNode(graph: CodeGraph, selector: string): string {
  const exact = graph.nodes.find(n => n.id === selector);
  if (exact) return exact.id;
  const matches = graph.nodes.filter(n => n.name === selector);
  if (matches.length !== 1) throw new Error(matches.length
    ? `Ambiguous name "${selector}". Use a node ID from search.` : `Node not found: ${selector}`);
  return matches[0]!.id;
}
export function neighborhood(graph: CodeGraph, id: string, options: {
  direction?: 'in' | 'out' | 'both'; depth?: number; limit?: number;
  includeCandidates?: boolean; kinds?: RelationKind[];
} = {}) {
  if (!graph.nodes.some(n => n.id === id)) throw new Error('Unknown node ID');
  const direction = options.direction ?? 'both', depth = options.depth ?? 1, limit = options.limit ?? 100;
  if (!Number.isInteger(depth) || depth < 0 || depth > 8 || !Number.isInteger(limit) || limit < 1 || limit > 10000)
    throw new Error('depth must be 0..8 and limit must be 1..10000');
  const kinds = options.kinds ? new Set(options.kinds) : CALL_KINDS;
  const all = graph.relations.filter(e => kinds.has(e.kind));
  const admissible = all.filter(e => e.status === 'bound' || options.includeCandidates && e.status === 'candidate');
  const seen = new Set([id]), edgeIds = new Set<string>();
  let frontier = [id], truncated = false;
  for (let level = 0; level < depth && frontier.length; level++) {
    const active = new Set(frontier), next: string[] = [];
    for (const edge of admissible) {
      const neighbors: string[] = [];
      if (direction !== 'in' && active.has(edge.from)) neighbors.push(...edge.targets);
      if (direction !== 'out' && edge.targets.some(t => active.has(t))) neighbors.push(edge.from);
      if (!neighbors.length) continue;
      for (const target of neighbors) {
        if (!seen.has(target)) {
          if (seen.size >= limit) { truncated = true; continue; }
          seen.add(target); next.push(target);
        }
        edgeIds.add(edge.id);
      }
    }
    frontier = next;
  }
  const omitted = all.filter(e => e.status !== 'bound' &&
    !(options.includeCandidates && e.status === 'candidate') &&
    (direction !== 'in' && seen.has(e.from) || direction !== 'out' && e.targets.some(t => seen.has(t))));
  const hasMore = admissible.some(e => direction !== 'in' && seen.has(e.from) && e.targets.some(t => !seen.has(t)) ||
    direction !== 'out' && !seen.has(e.from) && e.targets.some(t => seen.has(t)));
  const selectedEdges = admissible.filter(e => edgeIds.has(e.id));
  const outsideNodeIds = [...new Set(selectedEdges.flatMap(e => [e.from, ...e.targets]).filter(t => !seen.has(t)))];
  return { focus: id, nodes: graph.nodes.filter(n => seen.has(n.id)),
    relations: selectedEdges, omittedRelations: omitted,
    boundary: { depth, limit, truncated, hasMore, outsideNodeIds, includesCandidates: !!options.includeCandidates,
      explanation: 'Only selected static relation kinds are traversed. Empty results do not establish runtime absence.' } };
}
