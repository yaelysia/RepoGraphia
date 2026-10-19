# RepoGraphia development contract

## Product boundary
Independent static exploration tool. Codex-Monitor is a read-only fixture, never a destination for changes. R1 focuses on programmatic evidence and an offline code map. Do not silently add model calls, dynamic execution, background monitoring or target dependency installation.

## Non-negotiable semantics
- A compiler declaration binding is not runtime execution or proof of target uniqueness.
- Keep call, construct, tag, callback-passing, JSX, imports and heritage relations distinct.
- Do not resolve names by textual similarity when symbol binding fails.
- Every relation needs an owner, exact source range, rule, explanation and file hash.
- Unknown/candidate/unsupported/truncated information must survive queries and presentation.
- Never present relation counts as precision, recall, coverage of runtime behavior or correctness.
- IDs are snapshot-local; do not promise stable identity across edits or incremental correctness.

## Workflow
Start with `docs/CHECKPOINT.md`; read branch commits after the recorded checkpoint before resuming. After each validated milestone, commit the work and update the latest checkpoint with the branch, tested commit/run, actual environment/results, remaining tasks and exact resume commands. Keep historical notes in `docs/checkpoints/` unchanged. A missing chat reply is not evidence that committed work was lost.

Use the locked dependencies with Node 22+, then `npm run build` and `npm test`. Add a minimal positive AND negative fixture for new resolution rules. Both Windows and Linux CI must pass. Preserve selected tsconfig scope and report project-reference/unsupported-language gaps.

A real sample is pinned in scripts/verify-sample.mjs. Use a separate checkout at that exact revision, never reset a user's working checkout. Sample validation must not execute the sample application. Browser smoke checks are in scripts/check-viewer.py.

## Implementation
Reuse TypeScript compiler APIs; avoid duplicating a compiler or introducing graph databases and frameworks without a demonstrated need. Keep core analysis reusable separately from HTML. Source-derived strings must never enter executable HTML; no network resources or arbitrary commands in the viewer. Outputs must stay outside the analyzed source tree. Do not run git status in the analyzer because configured helper programs may execute.

Keep reason codes tied to compiler/declaration evidence, never guessed runtime causes. Lowering unresolved counts must distinguish external-boundary reclassification from project-target candidates; use the same-input baseline comparison and never discard callsites to improve counts.

Bump `ANALYSIS_REVISION` in src/model.ts when extraction semantics change; it participates in snapshot identity. Old reports without a rule revision must remain explicitly unversioned.

When changing schema or unsupported cases, update README and docs/architecture.md. Report actual test results and platform skips, not planned validation.
