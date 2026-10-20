# CP19 — Agent CLI + functional-mapping Skill

2026-10-20. Base: CP18 `801c47d70e045ce4b6e70c410b70f4a03b440725`, PR #5. Branch: `feat/agent-cli-skill-r1`. Read AGENTS.md and docs/CHECKPOINT.md before continuing. Upstream PRs are not merged or rewritten in this round; Codex-Monitor remains a read-only sample.

## Authorized work

Add bounded, structured Agent-facing CLI operations for project orientation, exact-code evidence, and append-only functional proposals. Reuse current graph/projection/FeatureMap validation and report rendering. Add one reusable Skill that teaches functional decomposition, evidence exploration, negative-case checks, stopping and recovery—not merely command syntax. No MCP server, model API, target execution, automatic acceptance or replacement of human decisions.

## Acceptance declared before trial

- Programmatic: exact snapshot and annotation revision; source/relationship references; bounded/paged output; explicit unknown/truncated/source-missing states; structured actionable errors; rejected/accepted annotations cannot be overwritten through the proposal channel; new output never overwrites existing files. Malformed mixed submissions fail without partial output.
- Semantic: each proposed feature explains an observable capability (trigger, behavior/result, exclusions), not just a directory or function name. Each mapping has a specific role and reason. Inspect at least one real limiting/negative branch per feature; distinguish unsupported interpretation from observed code facts. Do not invent test execution, runtime IPC edges or complete coverage.
- Self-use: freeze an initial Skill, follow it on a real region not copied from the three previous collection examples, retain actual CLI query outputs and raw proposal, review quality against an explicit rubric, revise Skill on concrete defects and rerun the affected steps. Report this as author self-use, not an independent model evaluation or measured improvement from a controlled A/B experiment.
- Delivery: locked TypeScript 5.9.3 Linux/Windows CI, existing browser regression, new proposal-generated offline report checks, code invariance against the pinned sample, reproducible trial artifacts and final handoff.

## Checkpoints

CP19: scope and initial rubric saved; no implementation or new test result claimed.
CP20: implementation, Skill and actual self-trial saved; exact results and gaps to be recorded.
CP21: final CI/artifact verification and handoff.

## Environment

Container Node 22.16.0. GitHub/npm DNS unavailable; `npm ci --offline` failed with ENOTCACHED. Source recovered from the verified CP18 GitHub Actions archive (run 39384866209, artifact 12246987023; ZIP SHA-256 982e0c190c744056929c627ca68799bb373efcb341dcf01e1972e317ef10bde4). Local fallback compiler, if used, must not be reported as pinned-dependency validation. Long-term recovery is through committed source and these checkpoints.
