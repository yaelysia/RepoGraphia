# CP20c — CI portability correction

2026-10-20. Branch feat/agent-cli-skill-r1 / PR #6. Verify #29 (39408671262), head 95dccd4d03e2d6d067afca2514e3defe8de46228: Linux and sample succeeded; Windows job 118580758993 failed one test. Its raw log shows Skill header regexp required LF, whereas Windows checkout provided CRLF. Windows totals: 268 pass, 1 fail, 3 existing symlink skips out of 272. This was not a missing GitHub write interface or an agent proposal failure.

The metadata assertion now accepts LF and CRLF while explicitly rejecting incorrect skill names and missing description fields. The same 3 Skill tests pass locally after the correction; no tests were skipped or deleted, and exact source quote/hash validation is unchanged. This commit must receive its own locked-version CI before final CP21. All implementation and actual self-trial were already saved in preceding commits; latest handoff remains docs/CHECKPOINT.md plus this correction.
