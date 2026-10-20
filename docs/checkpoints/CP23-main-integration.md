# CP23 — Reviewed stack integrated into master

Date: 2026-10-20. The user authorized review, fixes, merging and a usable installation README. All work below is complete; earlier checkpoints retain their original historical states.

## Review and fix identity

Reviewed cumulative CP21 head `f3c7b4318c70e9188fe2231261d187bb4836e759`. Scope saved at `cc70119d8bcd238ac4620819bc65a19101f4d799`. Fix/README head: `568fe7d3333299605f26db344ec6a8f83f604fec`; tree `7fec4ff3d20dcd078df47f01042c409079aca82f`.

CP22-audit-results.md records the reproduced hard-link truncation of target source via reused analyze output, the new-directory/exclusive-write fix, validation before publication, seven regression cases and the local auxiliary environment limitations. This was a targeted author review of static evidence, graph projection, mappings/migration, Agent proposals, HTML and filesystem output, not a formal independent correctness proof.

The README now provides master clone/build/update, first offline report, selected tsconfig/dependencies, direct Skill use and optional installation, annotation export/migration and common errors. No model service, npm publication, licensing change or target execution was introduced.

## Actual merges, in order

All used GitHub merge commits with the expected head SHA; downstream PRs were retargeted to master before their merge. No force update, squash/rebase or branch deletion was used.

| PR | Merged head | Resulting master commit |
| --- | --- | --- |
| #2 | `3e70ed49d3e79414d7274f824552a3883661b6f8` | `68f1c8c418d5e8060c18f6172c844f8986f858d4` |
| #3 | `a64c67bb7e111a2a8c2e2f1f7a30677e2a1051ea` | `78430e684a0c1aeb7257d44815d3ea4a1ad3e05a` |
| #4 | `206dd363dcc023a8ab88590878cdabb62b44fcd8` | `913a8be6a0afb0ad09fecae40c2ab148c1a3ff87` |
| #5 | `801c47d70e045ce4b6e70c410b70f4a03b440725` | `7be8aa701fb71812e4f048033b464272a711df83` |
| #6 | `568fe7d3333299605f26db344ec6a8f83f604fec` | `24e01def5cf6eae3c16f0a5748c9d4502d875742` |

After each downstream merge, comparison with its source head showed no file differences. Final master was additionally fetched through Git data: its tree is exactly `7fec4ff3d20dcd078df47f01042c409079aca82f`, identical to the reviewed, tested fix/README tree. The compare shows only the added merge history, not missing or rewritten code.

## Fresh validation, before and after merge

Before merge: Verify #33 run `39428746942` at head `568fe7d3333299605f26db344ec6a8f83f604fec`, completed/success. Jobs: Windows `118647913488`, Linux `118647913781`, sample `118647913807`.

After merge: **master push Verify #38**, run `39430111403`. All three jobs were checked completed/success; actual checkout is `24e01def5cf6eae3c16f0a5748c9d4502d875742`, not a synthetic pull-request merge ref.

| Job | ID | Verified result |
| --- | --- | --- |
| unit (ubuntu-latest) | `118652637169` | Standard npm test: 279 pass, 0 fail, 0 skip; viewer syntax checks pass |
| unit (windows-latest) | `118652637557` | Standard npm test: 276 pass, 0 fail, 3 existing symlink-privilege skips; viewer syntax checks pass |
| sample | `118652636745` | Sample analysis, same-input comparison, projection, features/migration, Agent replay and all five offline browser scripts pass |

Both unit logs were read to verify counts and the checkout SHA. CI installed locked dependencies with npm ci --ignore-scripts; Node 22.23.3 and TypeScript 5.9.3. The seven new tests ran on both systems, including the hard-link regressions. No new skip or weakened assertion was used to pass the review.

Sample stays pinned to Codex-Monitor `490d822a9593d8d4b78a9188dd0daa0ae791eaf6`. It is never a write target or executed app. Fixed Agent replay is protocol/UI regression, not a new model trial. Static extraction rules and graph data were not changed by the output fix.

Run #38 also archived its exact tested Git source tree as checkpoint-source, artifact `12268245318`. CI log reports ZIP SHA-256 `94123e9fe1ec6ff0afd04e3c622c72aefe2ca50f45bc7ee223a7c86f2385120b`; this integration checkpoint does not claim the archive was independently downloaded and rehashed. Git commits, not expiring artifacts, are the durable recovery mechanism.

## Final documentation checkpoint

This CP23 commit only replaces docs/CHECKPOINT.md and adds this integration record. Its resulting SHA and own push CI are recorded in the already merged PR #6 conversation, avoiding recursive commits merely to quote the latest documentation SHA. Do not silently substitute this doc commit for the exact #38 test object above.

Use master for installation and next work. README contains commands and the new output-directory requirement. No unfinished source implementation or unmerged dependency remains from this stack; preserve local user changes and do not use reset/clean to switch versions.
