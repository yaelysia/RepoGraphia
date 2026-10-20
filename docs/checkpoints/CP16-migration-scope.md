# CP16 — Explicit feature migration scope (2026-10-20)

Resume branch: `feat/feature-migration-r1`; base CP15 `206dd363dcc023a8ab88590878cdabb62b44fcd8` (PR #4). PR #4 is still open on PR #3. Do not merge or overwrite upstream branches as part of this round. Codex-Monitor remains read-only.

## Contract for this round

1. Compare OLD CodeGraph, NEW CodeGraph and the existing feature sidecar. Produce a non-mutating migration plan: reusable anchors, needs-review, unmatched. These categories describe static reference continuity, not unchanged business behavior.
2. No same-name matching, fuzzy symbol relocation, silent migration or carrying human acceptance into a changed snapshot. Exact unchanged anchors may be carried only by an explicit action. Accepted mappings reset to proposed; rejected decisions remain rejected until a separate review.
3. A user may explicitly replace an anchor or defer it. Deferred mappings must keep their old basis and remain visibly stale, including when snapshot-local IDs happen to collide. Preserve old evidence/decisions in migration history.
4. Shared pure APIs, CLI plan/apply with optimistic revision and source/target basis checks, and an offline browser workflow. Recompute the plan at apply time instead of trusting edited plan output.
5. Preserve old schema-v1 inputs; migrated documents use a versioned schema with per-mapping provenance. Never silently claim old readers support new documents.
6. Pair carry/rebind/defer with independent positive and adversarial fixtures: source edits, dependency/context changes, rule/config changes, missing and same-name symbols, rejected/accepted decisions, stale plans, partial migration and repeated migration. Keep existing static data unchanged.

## Milestones and validation boundary

- CP16: scope saved. No new application behavior or fresh tests yet.
- CP17: core + CLI + offline migration review + tests committed; record actual local validation, then run locked CI.
- CP18: inspect Windows/Linux/sample/browser results, package a clearly labelled migration example, update `docs/CHECKPOINT.md` and PR.

The restored container has Node 22.16.0 and available TypeScript 5.8.3. DNS to GitHub/npm is unavailable; GitHub connector and Actions work. The existing CP15 source archive was restored and its Git tree verified as `6c4c1dbf4d6ac121499fabff8b32ca556c93e3b6`. Local auxiliary tests are not a substitute for pinned TypeScript 5.9.3 CI.

Keep this historical scope unchanged. The latest checkpoint entry and branch commits, not this plan, determine completion status.
