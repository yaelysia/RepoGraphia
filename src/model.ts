/** Bump when extraction semantics change; this participates in snapshot identity. */
export const ANALYSIS_REVISION = 4;

/** Stable schema; coordinates are 1-based, offsets are UTF-16, end is exclusive. */
export interface Location {
  file: string; start: number; end: number; line: number; column: number;
  endLine: number; endColumn: number;
}
export type Status = 'bound' | 'candidate' | 'unresolved' | 'external';
export type NodeKind = 'file' | 'function' | 'method' | 'constructor' | 'class' | 'interface' | 'signature';
export type RelationKind = 'call' | 'construct' | 'tag' | 'jsx' | 'callback' | 'import' | 'reexport' | 'extends' | 'implements';
export interface CodeNode {
  id: string; name: string; kind: NodeKind; parent: string | null;
  location: Location; snippet: string; hasBody: boolean;
}
export type UnresolvedReason = 'parameter-value' | 'binding-pattern' | 'mutable-value' |
  'property-value' | 'returned-callable' | 'out-of-scope-declaration' | 'dynamic-import' |
  'missing-symbol' | 'unmapped-declaration' | 'complex-expression';
/** Bounded syntactic provenance, not a feasible or exhaustive runtime value set. */
export interface OriginPoint {
  location: Location; fileHash: string; excerpt: string;
}
export interface ValueOrigins {
  complete: false;
  truncated: boolean;
  visited: number;
  limits: { maxDepth: number; maxSteps: number; maxSources: number; maxStops: number; maxCallsites: number };
  sources: { target: string; path: (OriginPoint & { kind: string })[] }[];
  stops: (OriginPoint & { reason: string })[];
}
export interface Evidence {
  valueOrigins?: ValueOrigins;
  rule: string; explanation: string; location: Location; excerpt: string;
  fileHash: string;
  /** Additive in analysis revision 3; absence in old reports means unclassified. */
  reason?: UnresolvedReason;
  /** First compiler-bound repository declaration outside the implementation index. */
  declaration?: { location: Location; fileHash: string };
}
/** targets are declaration bindings/candidates, NEVER a complete runtime target set. */
export interface Relation {
  id: string; from: string; targets: string[]; targetLabel: string;
  kind: RelationKind; status: Status; typeOnly?: boolean; evidence: Evidence;
}
export interface AnalysisDiagnostic {
  category: 'error' | 'warning' | 'message'; code: string; message: string;
  file?: string; line?: number;
}
export interface CodeGraph {
  schemaVersion: 1;
  project: {
    name: string; commit: string | null; dirty: boolean | null; snapshot: string;
    /** Absent in older schema-v1 reports; do not assume current extraction rules. */
    analysisRevision?: number;
    compilerVersion: string; config: string | null; createdAt: string;
  };
  files: { path: string; hash: string; lines: number; source?: string }[];
  nodes: CodeNode[]; relations: Relation[]; diagnostics: AnalysisDiagnostic[];
  coverage: {
    indexedFiles: number; inventorySourceFiles: number;
    unindexed: { path: string; reason: string }[];
    skippedSymlinks: string[]; ignoredDirectories: string[];
    syntaxCalls: number; callsByStatus: Record<Status, number>;
    limitations: string[];
  };
}
export const CALL_KINDS = new Set<RelationKind>(['call', 'construct', 'tag']);
