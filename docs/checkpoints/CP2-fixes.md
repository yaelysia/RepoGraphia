# CP2 — Static-evidence fixes (2026-10-19)

Preceding checkpoint: `eaf1c91a7f60e17ada4d6a8666b4c4d6cf802b47` (CP1 audit).

## Implemented in this commit

- Preserve candidate status for mutable/indirect superclass expressions; distinguish class extends from type-only interface extends/implements.
- Share transparent-expression handling including `satisfies` across value resolution and readable function labels. Mutable aliases stay candidates; callback passing stays separate from invocation.
- Attribute computed method/accessor name expressions to the enclosing definition context in BOTH symbol-parent indexing and relation extraction. Method-body calls remain owned by the method.
- Add `ANALYSIS_REVISION=2` to snapshot input and optional `project.analysisRevision` metadata. Old schema-v1 reports can lack this field; do not assume the new rules for them.
- Add 15 adversarial regression cases with positive controls, uncertainty-preservation negatives, parent/owner consistency and source-evidence checks.

## Actual validation so far

Local Node 22.16.0 / TypeScript 5.8.3: `npm test` passes **57/57**, no skips or failures. The previous 42 tests also passed before changes. The new test file had 12 expected failing assertions against the old code, then all 15 passed after the fixes.

This is NOT final locked-dependency validation. TypeScript 5.9.3 Windows/Linux CI and the pinned real-sample/browser checks must be checked against the commit that contains these fixes. Do not reuse successful CP0/CP1 CI as proof.

## Remaining before delivery

1. Check new CI and repair any regressions rather than loosening assertions.
2. Update architecture/README/AGENTS and the latest `docs/CHECKPOINT.md` entry with source-revision semantics and resume workflow.
3. Save exact passing head and run IDs, verify the report artifact, then mark PR #2 ready for review.

No target-project writes, runtime tracing, AI calls or incremental-analysis claims were added.
