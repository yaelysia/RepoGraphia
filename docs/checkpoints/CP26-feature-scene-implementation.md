# CP26 — Readable feature-scene implementation (2026-10-21)

- Branch: `feat/readable-feature-map`; base master `470be6c73654991e0d43090a30f27ac428a7e8fc`.
- CP25 design checkpoint: `402ff924019b1876e3071e988b64913e4ef4b8b7`.
- Compact feature nodes; role-grouped code graph; collapsed support/test counts; complete list; opt-in original-call arrows and evidence records; lexical labels; layered inspector; source-return retains view state.
- No graph/schema/rule changes, AI calls, inferred feature dependencies, user decision changes, or writes to Codex-Monitor. User trial ZIPs remain outside Git.
- README explains re-rendering the existing graph/sidecar without rerunning Agent or changing its snapshot.

## Actual local validation

Local Node 22.16.0 / available TS 5.8.3 / @types/node 25.1.0: **308 pass / 0 fail / 0 skip**, including 24 new independent projection tests. These versions are auxiliary, NOT the lockfile validation.

Independent browser fixture: **41 checks passed**. Existing code explorer/project/feature/migration/Agent checks: **30 + 24 + 32 + 25 + 14 passed**. Tests now explicitly expand evidence and review folds; semantic assertions are retained, not removed. Reproduced a missing source-return button during development and added a return path, then reran the browser suite.

Actual user trial re-render: **21 checks passed**, 3 features / 39 mappings / all original decisions, descriptions, graph data and history preserved. Wide and 430px screenshots inspected. Full data is not committed. Readability improved by removing long paragraphs from the canvas, compacting redundant page headers, and keeping complete descriptions in the inspector; no automatic title/semantic rewrite.

Local Chromium runs use byte-preserving set_content because file:// is blocked by container policy. CI must still execute Windows/Linux file:// with the locked TS 5.9.3 dependencies before merge. No claim of independent user usability testing or model evaluation.

## Next

Open PR; check Windows/Linux unit + new scene/startup browsers + pinned real-sample job. Save exact SHA/run and verify artifacts. Update docs/CHECKPOINT.md to CP27 after success; merge to master only after review/tests so the user does not need the feature branch. Never replace a pending CI result with the local/compiler-fallback results above.
