# Archify tree geometry reference

The source file in this directory is an unmodified reference fixture, not a runtime dependency or a runnable bundled Archify application.

- Upstream: <https://github.com/tt-a1i/archify>
- Fixed commit: `25cf37080fc8b1dbe758a4efc3935b55f3327083`
- Original renderer: [`archify/renderers/tree/render-tree.mjs`](https://github.com/tt-a1i/archify/blob/25cf37080fc8b1dbe758a4efc3935b55f3327083/archify/renderers/tree/render-tree.mjs)
- Original license: [`LICENSE`](https://github.com/tt-a1i/archify/blob/25cf37080fc8b1dbe758a4efc3935b55f3327083/LICENSE)
- Retrieved through the GitHub file connector on 2026-10-23, without installing or executing Archify.

| Local file | Bytes | Git blob SHA-1 | SHA-256 |
| --- | ---: | --- | --- |
| `render-tree.upstream.mjs` | 30,666 | `2fd00e1e0570674be2298aed1f72c86cfee38b12` | `4e2ba7d4a3f567760c3801e7439bd18fa28acfe51e581479bd56ad549e240b68` |
| `LICENSE` | 1,102 | `0f9f9397a0496ef63c7d555d36b40c3f932aff84` | `b799ab081703e7821ae5096d2c1abdf14bbdc75e8ea1c4045998c36ed6db9706` |

`src/feature-tree.ts` adapts only the rightward layout and edge geometry. `tests/feature-tree.test.mjs` pins the source digest and evaluates the original pure geometry block with supplied measurements for a direct comparison. It does not import this module, call its loader, generate its SVG, or execute any analyzed project.

The complete MIT license is retained in `LICENSE` and inside `createFeatureTreeApi()`, so an offline HTML report embedding the factory also carries both copyright notices and the permission/warranty text. No upstream fonts, icons, assets, CLI code, source-verification semantics or interactive viewer are bundled into the report by this slice.

See [`docs/archify-tree-reuse.md`](../../docs/archify-tree-reuse.md) for the API, intentional differences and current validation limits.
