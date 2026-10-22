# CP29 — Explicit feature hierarchy and compatibility

2026-10-22. Branch: `feat/minimal-function-workbench`. Previous milestone: CP28; master baseline remains `d277ab5d6cdf03e40f7d6fdfafc810ae51e5c939`.

## Validated scope

- FeatureMap schema 3 adds optional `summary` (200 characters) and `parentId`. Shared iterative hierarchy validation rejects missing parents, self-parenting and cycles, with no additional depth cap inside the existing 1,000-feature budget.
- Schema 1/2 reading, rendering and ordinary edits remain compatible. New-field edits upgrade the sidecar and retain each mapping's original evidence basis. Existing descriptions, review decisions unrelated to the edited feature, and history are preserved.
- Migration preserves schema 3 and hierarchy; deferred mappings retain their original basis. CodeGraph schema and analysis revision are unchanged.
- Agent proposal protocol remains 1. New parent/child features can appear in either input order, titles are scoped by parent, and every feature still requires its own explicit mapping and support/limit checks. Skill documentation is version 1.2.

## Verification

Locked TypeScript 5.9.3, local Node 24.19.0: build and 126 focused tests passed (feature-map 30, migration 34, new hierarchy 22, agent 37, skill 3). The full suite also passed: 330 / 330, no skips.

Restricted local subprocess creation initially returned `EPERM` with empty output; rerunning in an environment that permits the test subprocesses passed. No CLI behavior or assertions were weakened for the environment issue.

## In progress

The selected minimal workbench is being integrated with the real renderer. Browser validation, motion/return state checks, final UI documentation and Windows/Linux CI are not yet complete at this checkpoint. The new interface must use only explicit containment and existing code associations; the earlier fictional design prototype is not production behavior evidence.
