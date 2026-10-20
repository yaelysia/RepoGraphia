# CP22 — Pre-merge code review and installation handoff

Start: CP21 `f3c7b4318c70e9188fe2231261d187bb4836e759`, tree `305fb67fa42493efbec203bcad62a7cc3ab8d7d1`. Date: 2026-10-20.

The user explicitly requested code review, fixes where needed, merging to master after validation, and a usable README. Continue on PR #6's head; do not add product scope or another model service. Preserve all earlier checkpoint history and read-only sample boundaries.

Review scope: aggregate changes in stacked PRs #2–#6; static evidence and query semantics, annotation/agent validation and snapshot provenance, output integrity and filesystem boundaries, HTML injection/navigation, installation commands and Skill instructions. Existing green CI is a baseline, not proof that no bugs remain.

Initial code inspection identified a candidate defect to reproduce: analyze currently truncates pre-existing ordinary output files after checking only for symlinks. A hard link from an output file to a target source file could violate the promised read-only analysis. Reproduce with isolated fixtures, fix without changing extraction semantics, and add a negative regression. This is not yet a confirmed test result at CP22 scope.

Acceptance: fresh locked TypeScript 5.9.3 Linux/Windows tests, pinned sample graph invariance, existing browser checks and a clean installation/quick-start smoke check. Document actual failures and fixes, not just test totals. Test installation examples with spaces and external output directories. No need to publish to npm or change licensing to deliver a clone-and-build installation.

Merge plan: preserve commit history and use expected head SHA, merge #2 then retarget #3 onto master; repeat through #6. Check the resulting merge tree so retargeting cannot discard work, and verify the final master push run. If a head/base moved, re-read before writing. Do not force-update master or close PRs in place of actual merges.

Final record should include reviewed head, fixes, actual validation environments/run IDs, merged PRs/master identity, resume command, and what remains unimplemented. Keep README focused on install/use/update, not a chronology of CP milestones.
