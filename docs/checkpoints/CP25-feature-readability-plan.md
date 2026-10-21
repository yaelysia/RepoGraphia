# CP25 — Human-readable feature map (2026-10-21)

## Recovery

- Base master: `470be6c73654991e0d43090a30f27ac428a7e8fc` (merged Windows CSP fix, PR #7).
- Working branch: `feat/readable-feature-map`.
- Recovered exact source tree: `9c2f843d33ca6dd6052fcc3b8edaca16a19418e8`; archive SHA256 `1fb02409838ad435bded06a68fe10d3f5f894d09edbe63849295a5d250a21b96`.
- Read AGENTS.md and docs/CHECKPOINT.md. Old PRs #2–#7 are not pending implementation. This design checkpoint changes no application behavior.
- User trial ZIPs are local acceptance inputs only. Never commit their graph, source or annotations to the repository. The user's unpushed `codex/agent-trial-01` is not a remote dependency.

## Design contract

Priority: human readability, not adding more inference. Default path: compact feature overview → selected feature's role-grouped code nodes → original description, mapping rationale and source/relation evidence on demand.

- Overview nodes preserve original feature titles; no silently rewritten summaries or inferred feature dependencies. No long description paragraphs on the canvas.
- Entry and implementation nodes are initially visible with explicit budgets; support/test groups can expand with their total counts always visible. A complete, paginated list remains available.
- Feature-to-code links mean explicit semantic membership, not execution. Actual code-call arrows must come only from original call/construct/tag records; candidate status, hidden endpoints and truncation stay visible. No guessed IPC/event edges.
- Friendly labels add lexical parent/file context; original symbol, ID and position remain inspectable. Stale anchors must never bind by name to current entities.
- Inspector separates reading, evidence and editing. Full descriptions/questions are preserved verbatim, not replaced with plausible abbreviated claims. Review and freshness remain separate; editing, import/export, migration and source-return navigation must continue working.
- No analysis revision, CodeGraph or FeatureMap schema changes planned. No model calls, runtime target execution, new graph framework or remote resources.

## Planned acceptance

1. Pure presentation projection tests: role grouping, shared code, exact endpoints, multi-target candidates, stale/rejected isolation, deterministic budgets, same-name/anonymous labels, unchanged inputs.
2. Browser tests: keyboard selection, overview/subgraph/list, collapse/expand, source and evidence return, stale and rejected markings, long text, narrow viewport, draft edits and JSON round trip.
3. Existing unit/browser/migration/Agent suites and Windows CRLF startup remain enabled.
4. Re-render actual 3-feature/39-mapping user trial without changing graph or annotations; inspect wide and narrow screenshots and record limitations.
5. Locked TypeScript 5.9.3 Windows/Linux CI before merge; local compiler fallback must be disclosed separately.

## Environment / next step

Cloud container cannot resolve GitHub/npm. Connector reads/writes and CI artifacts work. Local Node is 22.16.0; installed compiler and Chromium versions must be checked before testing. No new implementation tests have run at this checkpoint.

Next: implement the bounded presentation projection and view, save CP26 implementation, then CP27 validation and installation instructions. Keep tested SHA/run IDs in the PR rather than recursively committing a document's own SHA. Update docs/CHECKPOINT.md with implementation milestone. Resume from branch commits after this note, not from chat alone.
