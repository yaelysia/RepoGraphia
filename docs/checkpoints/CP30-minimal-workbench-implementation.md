# CP30 — Minimal function workbench implemented and locally verified

2026-10-22. Branch: `feat/minimal-function-workbench`. Previous checkpoints: CP28 plan and CP29 hierarchy contract. Master baseline is `d277ab5d6cdf03e40f7d6fdfafc810ae51e5c939`.

## Implemented

- The approved minimal design is connected to the real offline renderer: neutral light/dark surfaces, capsule titles and one-line explanations, graph on the left and reading pane on the right. Long descriptions and document tools are folded; explanation, evidence and review have separate reading tabs.
- The graph uses the explicit schema-3 containment forest. Selection and entering a feature are separate actions. Navigation has no extra depth cap; leaves can open their own code associations. Old schema 1/2 sidecars remain flat roots and are not rewritten or given invented child features.
- Global search, the on-demand feature navigator, breadcrumbs and parent navigation preserve context. Cameras, display budgets and code expansion/list/call/selection/scroll state are retained by scope. Searching beyond the first 12 siblings materializes and locates the requested node.
- Initial text remains at 100% scale; users may pan, zoom or fit explicitly. Later columns route containment lines through clear gutters. Enter/return uses finite 460 ms spatial motion; code expansion/collapse uses 330/280 ms transitions. Reduced-motion, rapid reversal and animation cleanup are handled.
- Source and evidence return to the exact selected mapping and reading state. Explicit reparenting validates the selection against its current scope. The feature editor exposes summary and parent, excludes self/descendants from parent choices and preserves the original full description/questions.
- Corrected an existing semantic-equality issue exposed by the new fields: reordering object keys during a no-op edit must not revoke accepted mappings. Only actual authored-field changes do so. Source reverse links and target selectors include hierarchy paths to distinguish same-titled children.
- The underlying analyzer and CodeGraph are unchanged. Feature containment, role-group membership and optional original call arrows remain distinct. Candidate, unknown, stale and rejected constraints remain visible.

## Actual local validation

Environment: Node 24.19.0, locked TypeScript 5.9.3, Python 3.12, Playwright 1.55.0, local Chromium 131. Reports were opened with real `file://`, not `set_content`.

| Check | Result |
| --- | --- |
| Build and full Node suite | 332 pass / 0 fail / 0 skip |
| New workbench browser checks | 48 pass |
| Existing feature-scene browser checks | 41 pass |
| Feature editing/review compatibility | 32 pass |
| Cross-snapshot migration compatibility | 25 pass |
| Saved Agent proposal report compatibility | 14 pass |
| Startup / CSP | LF, CRLF, CR, mixed pass; wrong-hash and tampered blocked as expected |

The 160 browser assertions include five successive child levels, the 20th sibling reached by search, no-op acceptance retention, reparent return behavior, exact source/evidence return, unmodified browsing/export, cyclic import rejection, inert HTML-shaped text, motion/reduced-motion, and 1024/736/430px layouts. All had zero browser exceptions and zero external requests. These are implementation regressions, not independent usability or semantic-accuracy measurements.

Compatibility checks reused existing JSON from CP27 Verify #42 (`39558742742`), artifact `12327290955`, ZIP SHA-256 `88c4fbd34499e4136acd51cecb417efd6ee260322874004c4a6452b38a9bbb0c`. Only the HTML was regenerated. No Agent was rerun, no target project was scanned/executed, and no uploaded user trial/source/report was committed. Generated artifacts stay under ignored `reports/`.

## Remaining gate and resume

Implementation and local verification are complete; the pull-request Windows/Linux Node 22 CI and pinned sample gate still need to finish. The final checked SHA, run IDs and merge status must be recorded separately rather than claiming local tests cover those platforms.

Read `docs/feature-map-visual.md` for interaction and paired-input rerendering. Reproduce the new browser check with:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
node tests/helpers/feature-workbench.mjs reports/feature-workbench
python scripts/check-feature-workbench.py reports/feature-workbench
```

Use a new output directory. The CI workflow also retains the existing feature, migration, Agent, project and CSP checks. Continue from this branch's latest commits; do not repeat the design selection or treat committed work as missing.
