# CP22 — Audit findings, fixes and validation boundary

Date: 2026-10-20. Reviewed baseline: `f3c7b4318c70e9188fe2231261d187bb4836e759` (cumulative PRs #2–#6). Authorization and merge plan: CP22-audit-scope.md; remote scope checkpoint `cc70119d8bcd238ac4620819bc65a19101f4d799`.

## Review and reproduced findings

Reviewed static extraction and value-origin stopping rules, query/project projections, FeatureMap and migration reference validation, Agent append-only proposals and quote checks, offline rendering/DOM construction, CLI output handling and installation instructions. This is a targeted author review, not an independent formal accuracy audit or a guarantee of zero defects.

1. **Source overwrite through a hard-linked analysis output (blocking).** In an isolated temporary directory, link report/graph.json to source/main.ts and run the old analyze command. It exited 0 and replaced main.ts with JSON. The existing symlink guard did not detect hard links. The same truncation applied to index.html and ordinary previous reports.
2. **Output directory created before sidecar validation/rendering.** An invalid sidecar could leave a new, incomplete directory. Rendering is now done before output creation.

Both are fixed by sharing a small exclusive bundle writer between analyze and Agent submit. Analyze requires a NEW directory, validates/renders first, creates the directory non-recursively at the final component and writes each file with wx. Existing files, directories and links are rejected. Agent receipt remains last. This protects against pre-existing links and competing directory creation; it is not OS-level isolation against an attacker who can rewrite arbitrary parent directories concurrently.

No extraction rule, graph schema, projection or semantic acceptance rule was changed. Source graph counts are not repurposed as an accuracy metric.

## Tests actually run before this commit

Local auxiliary environment: Node 22.16.0 / TypeScript 5.8.3 (not pinned 5.9.3). Build passes. New output-safety suite: 7/7 pass. Agent/Skill suite: 40/40 pass. Baseline CLI/Skill smoke: 7/7 pass. A full parallel npm test baseline exceeded the 60-second container call limit; that is NOT reported as a passing full run, and no assertion/time limit was relaxed to hide it.

New tests exercise graph/HTML hard links, pre-existing ordinary and empty report directories, invalid sidecar before creation, paths with spaces and unrelated cwd, generated source/query/Agent overview/sidecar initialization, exclusive bundle publication, and invalid bundle paths. Fresh locked Linux/Windows CI and the real-sample/browser checks are still required on the resulting commit.

## README

Replaced the accumulated checkpoint chronology with master clone/build, first offline report, target types/tsconfig, direct Skill invocation and optional Codex user-skill installation, annotation save/migration, upgrades from old branches and actionable errors. No npm publishing, global configuration change or target application execution is needed. Skill directory reference was checked against current official Codex docs; automatic trigger quality remains unverified.

Next: inspect new CI, verify exact uploaded blobs, then merge #2–#6 in order using merge commits and expected head SHAs. Verify final master source tree and push CI, and record CP23. Do not claim merge success merely from a created Git tree.
