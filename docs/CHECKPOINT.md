# RepoGraphia checkpoint

This file is the entry point for resuming work. Read `AGENTS.md` and `docs/architecture.md` before changing code. Update this file at every validated milestone; do not replace actual results with planned checks.

## Current state — CP0: recovery baseline (2026-10-19)

- Repository: `yaelysia/RepoGraphia` (independent tool).
- Working branch: `fix/r1-evidence-checkpoints`.
- Base: `3987fb218bdcff4973329c0d13fcc1ea9a341b52` (`master`, merged PR #1).
- Previous R1 implementation: `ccd2acbed9764ab10a5f7cf06c6d422295497e8e`.
- R1 is already merged. Do NOT restart implementation or treat the earlier missing chat reply as lost code.
- This checkpoint introduces no application behavior change.

## Recovered capabilities

TypeScript Compiler API indexing, typed relations with source evidence, bounded graph queries and offline HTML exploration are implemented. Dynamic analysis, AI feature summarization, whole-program callback flow and incremental analysis remain outside R1.

The previous PR records Linux 42 passing tests; Windows 39 passing and 3 symlink-permission skips; a pinned Codex-Monitor sample and 12 Chromium interaction checks. These are PREVIOUS-run results, not a rerun of this branch.

## This continuation

1. CP0 — Recover the merged baseline and persist this handoff entry. Complete.
2. CP1 — Review static binding/query semantics and reproduce concrete accuracy failures with adversarial fixtures. In progress.
3. CP2 — Fix reproduced failures, run locked-dependency Windows/Linux CI and pinned-sample/browser checks. Pending.
4. CP3 — Record exact validation commit/run IDs, package reviewable output, and create a PR with an explicit remaining-work list. Pending.

Do not broaden this round into dynamic execution or a new UI/AI architecture. Codex-Monitor is a read-only sample, never a write target.

## Resume commands

```sh
git fetch origin
git switch fix/r1-evidence-checkpoints
npm ci
npm test
```

Node 22+ is required. `npm test` builds first. For the sample, follow `scripts/verify-sample.mjs` and use a SEPARATE checkout pinned to `490d822a9593d8d4b78a9188dd0daa0ae791eaf6`. Do not reset an existing user checkout or execute the sample app.

## Environment and validation status

The current assistant container cannot resolve GitHub/npm hosts. GitHub connector reads/writes work. No target dependencies have been installed and no application tests have been run in this continuation yet. Use GitHub Actions for authoritative locked-version validation if network access remains unavailable. Never report locally available TypeScript 5.8.x as the pinned 5.9.3 validation.

## Open work / blockers

No new code fixes are committed at CP0. Core review, fresh tests and a continuation PR are still required. Read branch commits after this file's latest update to recover work performed between checkpoints.
