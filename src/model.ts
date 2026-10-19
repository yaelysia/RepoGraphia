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
export interface Evidence {
  rule: string; explanation: string; location: Location; excerpt: string;
  fileHash: string;
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
