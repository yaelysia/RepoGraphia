import type { CodeGraph, Relation, RelationKind, Status } from './model.js';

export interface MapOptions {
  scope?: string; showTests?: boolean; kinds?: RelationKind[]; statuses?: Status[];
  maxNodes?: number; maxLinks?: number;
}
export interface MapSelection {
  group?: string; from?: string; to?: string;
  category?: 'all' | 'internal' | 'between' | 'outside' | 'targetless' | 'missing' | 'hiddenTargets';
}
type Category = NonNullable<MapSelection['category']>;
type FileEntry = { path: string; indexed: boolean; reason?: string; nodeId?: string; symbols: number };
type MapIndex = { graph: CodeGraph; files: Map<string, FileEntry>; nodeFiles: Map<string, string> };
type Breakdown = { kind: RelationKind; status: Status; typeOnly: boolean; count: number };
type Group = {
  path: string; name: string; kind: 'directory' | 'file'; nodeId?: string;
  indexedFiles: number; unindexedFiles: number; symbols: number;
  unindexedReasons: Record<string, number>;
  counts: Record<Category, number>;
};
type Link = { from: string; to: string; count: number; breakdown: Breakdown[] };

/** Self-contained pure factory: compiled once, shared verbatim by CLI and offline HTML. */
export function createProjectMapApi() {
  const revision = 1;
  const categories: Category[] = ['all', 'internal', 'between', 'outside', 'targetless', 'missing', 'hiddenTargets'];
  const relationKinds = ['call', 'construct', 'tag', 'jsx', 'callback', 'import', 'reexport', 'extends', 'implements'];
  const statuses = ['bound', 'candidate', 'unresolved', 'external'];
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  const testPath = (p: string) => /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$/.test(p);
  const within = (p: string, scope: string) => !scope || p.startsWith(scope + '/');
  function validPath(p: string) {
    if (typeof p !== 'string' || !p || p.includes('\\') || p.includes('\0') ||
        /^[A-Za-z]:/.test(p) || p.split('/').some(s => !s || s === '.' || s === '..'))
      throw new Error('Expected a repository-relative snapshot path: ' + p);
    return p;
  }
  function integer(n: number | undefined, fallback: number, min: number, max: number) {
    const value = n ?? fallback;
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Budget must be an integer in ${min}..${max}`);
    return value;
  }
  const emptyCounts = (): Record<Category, number> => ({ all: 0, internal: 0, between: 0, outside: 0, targetless: 0, missing: 0, hiddenTargets: 0 });
  function index(graph: CodeGraph): MapIndex {
    const files = new Map<string, FileEntry>(), nodeFiles = new Map<string, string>();
    for (const file of graph.files) {
      const p = validPath(file.path);
      if (files.has(p)) throw new Error('Duplicate indexed file: ' + p);
      files.set(p, { path: p, indexed: true, symbols: 0 });
    }
    for (const file of graph.coverage.unindexed) {
      const p = validPath(file.path);
      // The implementation index wins over stale inventory counters.
      if (!files.has(p)) files.set(p, { path: p, indexed: false, reason: file.reason, symbols: 0 });
    }
    for (const node of graph.nodes) {
      if (nodeFiles.has(node.id)) throw new Error('Duplicate node ID: ' + node.id);
      const p = validPath(node.location.file); nodeFiles.set(node.id, p);
      const file = files.get(p);
      if (file) {
        if (node.kind === 'file') file.nodeId = node.id;
        else file.symbols++;
      }
    }
    const ids = new Set<string>();
    for (const edge of graph.relations) {
      if (ids.has(edge.id)) throw new Error('Duplicate relation ID: ' + edge.id);
      ids.add(edge.id);
    }
    return { graph, files, nodeFiles };
  }
  function scan(data: MapIndex, options: MapOptions) {
    const scope = !options.scope || options.scope === '.' ? '' : validPath(options.scope);
    if (scope && ![...data.files.keys()].some(p => within(p, scope))) throw new Error('No recorded directory: ' + scope);
    if (options.kinds?.some(k => !relationKinds.includes(k)) || options.statuses?.some(s => !statuses.includes(s)))
      throw new Error('Unknown relation kind or status');
    const isVisible = (p: string) => options.showTests || !testPath(p);
    const child = (p: string) => within(p, scope) ? (scope ? scope + '/' : '') + p.slice(scope ? scope.length + 1 : 0).split('/')[0] : null;
    const groups = new Map<string, Group>();
    let hiddenFiles = 0;
    for (const file of data.files.values()) {
      const key = child(file.path); if (key === null) continue;
      if (!isVisible(file.path)) { hiddenFiles++; continue; }
      let group = groups.get(key);
      if (!group) {
        group = { path: key, name: key.slice(scope ? scope.length + 1 : 0), kind: key === file.path ? 'file' : 'directory',
          ...(key === file.path && file.nodeId ? { nodeId: file.nodeId } : {}),
          indexedFiles: 0, unindexedFiles: 0, symbols: 0, unindexedReasons: {}, counts: emptyCounts() };
        groups.set(key, group);
      }
      if (file.indexed) group.indexedFiles++;
      else { group.unindexedFiles++; const reason = file.reason || 'unspecified';
        Object.defineProperty(group.unindexedReasons, reason, { value: (Object.hasOwn(group.unindexedReasons, reason) ? group.unindexedReasons[reason]! : 0) + 1, enumerable: true, configurable: true }); }
      group.symbols += file.symbols;
    }
    const linkMap = new Map<string, Link>(), counts = emptyCounts();
    const entries: { relation: Relation; from: string | null; to: Set<string>; tags: Set<Category>; groupTags: Map<string, Set<Category>> }[] = [];
    let filteredRelations = 0, hiddenTestRelations = 0, missingOwners = 0;
    for (const relation of data.graph.relations) {
      // An absent owner is retained using its callsite file, never silently discarded.
      const ownerMissing = !data.nodeFiles.has(relation.from);
      const fromFile = data.nodeFiles.get(relation.from) ?? relation.evidence.location.file;
      const targetFiles = [...new Set(relation.targets)].map(id => data.nodeFiles.get(id));
      if (!within(fromFile, scope) && !targetFiles.some(p => p !== undefined && within(p, scope))) continue;
      if (options.kinds && !options.kinds.includes(relation.kind) || options.statuses && !options.statuses.includes(relation.status)) { filteredRelations++; continue; }
      if (!isVisible(fromFile)) { hiddenTestRelations++; continue; }
      const from = child(fromFile), to = new Set<string>();
      const groupTags = new Map<string, Set<Category>>();
      const tags = new Set<Category>();
      const touch = (g: string | null, tag: Category) => {
        if (g === null || !groups.has(g)) return;
        if (!groupTags.has(g)) groupTags.set(g, new Set(['all']));
        groupTags.get(g)!.add(tag); tags.add(tag);
      };
      if (from !== null) touch(from, 'all');
      for (const p of targetFiles) {
        if (p === undefined || !data.files.has(p)) { touch(from, 'missing'); continue; }
        if (!isVisible(p)) { touch(from, 'hiddenTargets'); continue; }
        const target = child(p);
        if (target !== null) { to.add(target); touch(target, 'all'); }
        if (from !== null && target !== null) {
          const category = from === target ? 'internal' : 'between';
          touch(from, category); touch(target, category);
          if (category === 'between') {
            const key = JSON.stringify([from, target]);
            let link = linkMap.get(key);
            if (!link) { link = { from, to: target, count: 0, breakdown: [] }; linkMap.set(key, link); }
            // Several candidate targets in the same child group count as ONE original relation.
          }
        } else { touch(from, 'outside'); touch(target, 'outside'); }
      }
      if (ownerMissing) { touch(from, 'missing'); for (const target of to) touch(target, 'missing'); }
      if (!relation.targets.length) touch(from, 'targetless');
      if (!groupTags.size) { hiddenTestRelations++; continue; }
      if (ownerMissing) missingOwners++;
      for (const [key, set] of groupTags) for (const tag of set) groups.get(key)!.counts[tag]++;
      for (const tag of tags) counts[tag]++;
      if (from !== null) for (const target of to) {
        if (from === target) continue;
        const link = linkMap.get(JSON.stringify([from, target]))!; link.count++;
        let b = link.breakdown.find(b => b.kind === relation.kind && b.status === relation.status && b.typeOnly === !!relation.typeOnly);
        if (!b) { b = { kind: relation.kind, status: relation.status, typeOnly: !!relation.typeOnly, count: 0 }; link.breakdown.push(b); }
        b.count++;
      }
      entries.push({ relation, from, to, tags, groupTags });
    }
    const links = [...linkMap.values()].sort((a,b) => compare(a.from,b.from) || compare(a.to,b.to));
    for (const link of links) link.breakdown.sort((a,b) => compare(JSON.stringify([a.kind,a.status,a.typeOnly]),JSON.stringify([b.kind,b.status,b.typeOnly])));
    return { scope, groups: [...groups.values()].sort((a,b) => compare(a.path,b.path)), links, entries, counts,
      hiddenFiles, hiddenTestRelations, filteredRelations, missingOwners };
  }
  function project(data: MapIndex, options: MapOptions = {}) {
    const maxNodes = integer(options.maxNodes, 12, 1, 1000), maxLinks = integer(options.maxLinks, 24, 0, 5000);
    const result = scan(data, options), groups = result.groups.slice(0, maxNodes), shown = new Set(groups.map(g => g.path));
    const links = result.links.filter(l => shown.has(l.from) && shown.has(l.to)).slice(0, maxLinks);
    return { projectionRevision: revision, snapshot: data.graph.project.snapshot, scope: result.scope,
      grouping: 'directory-children' as const, groups, links,
      summary: { groups: result.groups.length, links: result.links.length, relations: result.entries.length,
        indexedFiles: result.groups.reduce((n,g) => n + g.indexedFiles, 0),
        unindexedFiles: result.groups.reduce((n,g) => n + g.unindexedFiles, 0), counts: result.counts },
      boundary: { hiddenFiles: result.hiddenFiles, hiddenTestRelations: result.hiddenTestRelations,
        filteredRelations: result.filteredRelations, missingOwners: result.missingOwners,
        omittedGroups: result.groups.length - groups.length, omittedLinks: result.links.length - links.length,
        truncated: result.groups.length > groups.length || result.links.length > links.length,
        maxNodes, maxLinks },
      interpretation: 'Path groups are not inferred business modules. Counts deduplicate relation IDs per bucket/pair; multi-target relations can occur in several buckets/pairs. Links are recorded static relations, not execution or transitive reachability.' };
  }
  function records(data: MapIndex, options: MapOptions = {}, selection: MapSelection = {}, paging: { offset?: number; limit?: number } = {}) {
    const offset = integer(paging.offset, 0, 0, Number.MAX_SAFE_INTEGER), limit = integer(paging.limit, 25, 1, 200);
    const result = scan(data, options), known = new Set(result.groups.map(g => g.path));
    if (selection.group !== undefined && (selection.from !== undefined || selection.to !== undefined)) throw new Error('Choose a group OR a directed pair');
    if ((selection.from === undefined) !== (selection.to === undefined)) throw new Error('A directed pair requires from AND to');
    for (const p of [selection.group, selection.from, selection.to]) if (p !== undefined && !known.has(p)) throw new Error('Not a visible child group: ' + p);
    const category = selection.category ?? 'all';
    if (!categories.includes(category)) throw new Error('Unknown map category: ' + category);
    const matches = result.entries.filter(e => {
      if (selection.group !== undefined) return e.groupTags.get(selection.group)?.has(category);
      if (selection.from !== undefined && (e.from !== selection.from || !e.to.has(selection.to!))) return false;
      return e.tags.has(category);
    }).map(e => e.relation).sort((a,b) => compare(a.evidence.location.file,b.evidence.location.file) ||
      a.evidence.location.start - b.evidence.location.start || compare(a.id,b.id));
    return { snapshot: data.graph.project.snapshot, total: matches.length, offset, limit,
      nextOffset: offset + limit < matches.length ? offset + limit : null,
      relations: matches.slice(offset, offset + limit) };
  }
  return { revision, index, project, records };
}
