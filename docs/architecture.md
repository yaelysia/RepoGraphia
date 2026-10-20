# R1 architecture and interpretation

## Pipeline

`loadProject → TypeScript Program/TypeChecker → nodes + typed relations + evidence → JSON/query/HTML`

There is one graph dataset. The file graph is a projection of symbol-level relations, not a second persisted graph. The viewer consumes the exact same dataset as CLI queries. No AI participates in static extraction.

## Source model

A selected tsconfig defines one compiler program. Without a config, an inventory supplies TS/JS roots. Generated/dependency/dot directories and symlinks are excluded from index roots; exclusions are reported. Dependencies and declarations can still supply compiler type information. A directory merely omitted from roots is not an isolation boundary for compiler reads.

Filesystem and compiler paths are reconciled using platform-aware canonical keys. Source locations keep readable repository-relative paths and case. Coordinates are 1-based; offsets are UTF-16 and the end is exclusive. Hashes describe text as decoded by the compiler.

Each indexed executable declaration, class, interface or signature gets a snapshot-local node and lexical parent. Nested callback bodies own their internal callsites; their calls are not attributed to the enclosing registration function. Initializer calls without an enclosing executable body may belong to a class/file entity, and must not be mistaken for observed execution order.

Computed method/accessor names belong to the enclosing definition context, not to the method body. This rule is shared by node-parent indexing and relation extraction, including nested functions in the computed expression. Calls inside the actual method body remain owned by that method; the graph does not infer execution order.

## Relations, not a fabricated total call graph

The implementation records explicit call/new/tag sites and their declaration evidence. Import aliases and reexports are resolved by compiler symbols. Overload signatures normalize to implementation bodies when available. Explicit construction points to the explicit constructor body; implicit constructor chaining is outside scope.

Transparent value wrappers (parentheses, assertions, non-null and `satisfies`) are unwrapped for declaration resolution and readable function labels. Their types are not treated as runtime proofs: wrapping a mutable alias preserves its candidate status, and wrapping a passed callback does not create an invocation edge.

Member bindings, interface contracts and indirect values stay candidates. Function parameters and unbound values can remain unresolved. Candidate targets are declaration candidates, not a complete points-to set. No speculative same-name matching or automatic enumeration of all interface implementations is used.

Class `extends` follows the superclass VALUE binding: indirect/mutable expressions retain candidate or unresolved status. Interface `extends` and `implements` instead record explicit type relationships, marked `typeOnly=true`; a bound type relationship is not a runtime dispatch result.

Explicit function initializers on object properties/class fields and finite property aliases may now provide declaration candidates. Property mutation/receiver flow remains unmodeled; never upgrade these values to bound merely because an initializer is present. A getter or an alias of its result is not the implementation of a subsequently invoked returned callable.

Direct compiler symbols located entirely in dependencies/standard libraries are external declaration boundaries even when declared with var or property signatures. Local parameters, shadowed names and mutable local aliases cannot use that shortcut. The boundary denotes type/declaration provenance, not runtime target identity or immutability.

An external declaration is an explicit boundary, not an analyzed implementation. Missing dependencies generate diagnostics. Callback-passing, JSX references and heritage do not imply call edges. IPC/event channels/HTTP/subprocess boundaries are not linked automatically in R1.

## Snapshot and freshness

`schemaVersion=1` includes project metadata, files, nodes, relations, diagnostics and coverage. The snapshot incorporates compiler-read content hashes, effective options, selected configuration and compiler version, plus the extraction-rule revision. `ANALYSIS_REVISION=4` is emitted as `project.analysisRevision`; this additive schema-v1 field is absent in old reports, which must be shown as unversioned rather than assigned the current revision. Bump the constant whenever extraction semantics change so identical source inputs under different rules cannot share an analysis identity. Regenerate old graphs to use the new rules. Node and edge offsets can change across edits; consumers must not mix graphs from different snapshots.

HEAD is only a version baseline. Worktree dirty detection is intentionally omitted (`dirty=null`) to avoid Git status helpers. This version reads a live working directory, not an atomic filesystem snapshot. For reproducible analysis use a fixed, idle checkout and the same dependencies. No filesystem watch or incremental invalidation exists yet.

## Resolution diagnostics (revision 3)

Every unresolved explicit call/new/tag record carries `evidence.reason`. The finite categories describe parameter/binding-pattern/mutable/property values, returned callables, out-of-scope declarations, import syntax, missing symbols, unmapped declarations or complex expressions. No probabilistic confidence or heuristic name matching is used. For a repository declaration outside the implementation index, optional `evidence.declaration` records the first applicable declaration's exact location and content hash; it is not a complete implementation candidate set.

`src/diagnostics.ts` derives summaries and bounded reason pages from actual relations, not cached counts. The HTML embeds this same summary and navigates to original evidence by relation ID. Non-call module/callback/JSX/heritage records do not enter the explicit-call denominator. Counts include test paths; examples prefer non-test paths by an explicit filename rule, not inferred production importance. Missing or unfamiliar reason codes in old graphs stay unclassified. Paging retains total/offset/limit/nextOffset and source evidence.

CI runs the pinned rule-3 analyzer against the same sample directory and dependency installation as the current analyzer. `compare-resolution.mjs` requires identical indexed source hashes, compiler version and explicit callsite coordinates before reporting status transitions. Snapshot-local node/edge IDs are not compared across revisions. This is a controlled regression comparison, not a measurement of precision or recall; external reclassification does not constitute a new project implementation target.

## Bounded value origins (revision 4)

`src/value-origins.ts` is a small syntax-origin engine, not a whole-program value-flow solver. The analyzer invokes it only for explicit call/new/tag sites that the base resolver leaves unresolved as `binding-pattern` or `parameter-value` (including aliases with those diagnostic reasons). Existing bound/member/contract/external relations are not broadened by this pass.

The engine shares compiler symbol lookup, wrapper unwrapping, source coordinates and base lexical resolution with the analyzer. It indexes only direct calls or explicit constructions whose base target is a single lexical binding. It follows const initializers, finite object/array literals, supported destructuring projections and known actual arguments. Overloads reuse implementation binding; the TypeScript-only `this` parameter does not consume an actual argument. Constructor parameter properties can carry the origins of arguments from indexed constructions, not a proof of which instance is being accessed.

All discovered implementation targets remain `candidate`. Every source carries a path of exact locations, snippets and content hashes; `evidence.valueOrigins` also retains stops and budgets even when no target is found. Parameter origins always record an `open-callers` boundary. Initializer projections record an unmodeled heap-state boundary: a const object binding does not make its properties/iterator immutable. These are syntactic declaration/argument provenance paths, NOT asserted feasible runtime paths or exhaustive points-to sets. Combining arguments from several callsites is context-insensitive and does not prove a specific invocation used them.

Rest/default destructuring, spreads, dynamic computed keys, getter/call returns, mutable bindings, parameter writes, rebound callees and unsupported member/framework callers stop explicitly. No framework-specific inference or implicit callback-invocation edges are added. Ordinary parameter defaults are considered only at a known direct call with the corresponding argument absent; explicit undefined and arbitrary maybe-undefined values are not solved.

Per trace, budgets are 12 recursive levels, 64 explored nodes, 16 source paths and 16 stop records. Direct-callsite storage retains at most 16 sites per target and the total count; extra sites set a caller-budget boundary. Cycles terminate using a node/projection stack. `complete=false` is unconditional. `truncated=true` separately indicates a budget-limited result; a nontruncated trace is still incomplete. Paths can include several evidence steps per recursive level. These budgets do not bound the cost of the initial compiler program or full AST indexing.

The viewer exposes paths and stopping locations without rerunning analysis. CLI graph queries preserve the evidence unchanged; candidate traversal remains opt-in. Older schema-v1 graphs with no origin metadata do not gain inferred evidence at presentation time. Analysis revision participates in snapshot identity; regenerate reports to apply these rules.

## Query budget

Default traversal admits only statically bound explicit call kinds. Candidates are opt-in. Callback/JSX/module edges are excluded unless a library caller explicitly supplies relation kinds. The query response retains omitted evidence, budget/depth boundaries, and endpoint IDs not loaded because of the node cap. Cycles terminate via a visited set.

For an incoming query, filtered candidate callers are disclosed just as outgoing unknowns are. An empty result is absence of evidence under the selected rules, not evidence of runtime absence. Multi-hop static reachability is not proof that the full path is feasible in one execution.

## Presentation and privacy

Reports are single-file, offline snapshots with a bounded one-hop SVG view. Each side shows at most seven distinct neighboring targets and the complete matching relation list is separately paginated. A displayed connection can stand for the first of several records; the UI explicitly states this aggregation. Large source excerpts are bounded; embedded full files are optional.

The renderer uses textContent for repository-derived text; JSON escapes script delimiters and a SHA-256 CSP authorizes only the bundled viewer. Reports include code and should be handled accordingly. There is no remote telemetry or executable target-code preview.

## Validation and next scope

Unit fixtures should pair successful resolution with adversarial cases: aliases vs shadowing, interfaces vs concrete methods, callback passing vs execution, mutable indirection, invalid configuration, missing types, platform paths, graph budgets and source text injection. CI separately evaluates the pinned Codex-Monitor sample and real Chromium interaction. These checks establish selected behavior, not a universal accuracy metric.

Before adding AI functional summarization, expand labeled static-analysis fixtures and assess unresolved categories on more than one project. Incremental invalidation, callback value flow, project-reference traversal and framework bridges require separate correctness contracts and explicit evidence rules. Dynamic execution remains deferred.

## Resuming development

`docs/CHECKPOINT.md` is the current handoff entry. Historical checkpoint notes record what was true at each milestone, not the latest validation. Every report check must identify the tested head and CI run; a later documentation-only commit is not silently substituted for that tested head. CI also archives its exact tested Git tree as `checkpoint-source` for 30 days. Permanent recovery uses Git commits and this handoff record, not expiring artifacts or chat history. Pull-request CI may test a synthetic merge commit; the archive preserves that exact tree and the PR records the associated branch head.

Primary interface references:
- TypeScript Compiler API: https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API
- Project references: https://www.typescriptlang.org/docs/handbook/project-references.html
- allowJs: https://www.typescriptlang.org/tsconfig/allowJs.html
