# CP1 — Static-evidence audit (2026-10-19)

## Baseline and reproducibility

- R1 implementation base: `3987fb218bdcff4973329c0d13fcc1ea9a341b52`.
- Checkpoint branch head before this note: `0984f2635f7da86b7841bd1cb836f09c29f8b810`.
- GitHub Verify #6: run `39270279142`; the Ubuntu unit job produced artifact `checkpoint-source` (ID `12194262983`). This is a Git archive of the tested PR merge tree, not an untracked work directory or a credential-bearing `.git` copy.
- The assistant container cannot resolve external GitHub/npm hosts. Source was recovered through the GitHub artifact connector, not recreated from memory.
- Local baseline: Node 22.16.0, available TypeScript 5.8.3, 42 tests passed. Local compiler is NOT the pinned 5.9.3; final locked-version CI is still required.
- First archive attempt (#5) passed all unit tests but failed artifact upload because `../` patterns are rejected. Fixed by using the absolute runner-temp path; do not reintroduce parent-relative upload patterns.

## Reproduced defects

### 1. Runtime superclass candidates incorrectly promoted to bound

```ts
class Base {} class Other {}
let Parent = Base; Parent = Other;
const Saved = Parent;
class A extends Parent {}
class B extends Saved {}
```

Both extends records currently point to Base with status `bound`. `resolve()` already marks the value indirection as a candidate, but the heritage extractor overwrites that status whenever a target exists. Preserve uncertainty for class extends. Keep interface extension/implementation as separate type-only declaration relationships. Do not enumerate Other as a proven runtime target.

### 2. Computed names attributed to the method body

```ts
function key() { return 'run' as const; }
function work() {}
class C { [key()]() { work(); } }
```

Both calls currently belong to `[key()]`. The key expression belongs to the enclosing definition context; only work belongs to the method body. Fix BOTH node-parent indexing and relation-owner traversal, including nested functions in a computed name. Test object methods and accessors, not just class methods.

### 3. `satisfies` loses value bindings

```ts
function leaf() { return 1; }
const wrapped = (() => leaf()) satisfies () => number;
const forwarded = leaf satisfies () => number;
wrapped(); forwarded();
```

These currently remain unresolved even though the value expression is recoverable. Reuse the transparent-expression unwrapping logic for declarations, aliases, names and callback arguments. Negative case: wrapping a mutable callable must not upgrade it to bound.

## Related snapshot contract

The snapshot currently hashes source/config/compiler inputs but not the extraction-rule revision. Changed analysis rules must not produce a graph with the same claimed analysis identity. Add an explicit rule revision to snapshot input and project metadata; distinguish old reports that lack that metadata. No stable cross-edit IDs or runtime guarantees are implied.

## Work state at CP1

A local 15-case adversarial test file reproduces the defects and specifies the additive metadata contract (3 pass, 12 fail on the old implementation; these are assertions, NOT 12 independent defects). The fixes and test file are not yet committed at this checkpoint. Next: implement the narrow fixes, persist tests with source changes, rerun all local tests, then validate the pinned TypeScript 5.9.3 on Windows/Linux plus the read-only real sample and offline browser checks.

Do not merge this continuation based only on the baseline tests or on this audit note.
