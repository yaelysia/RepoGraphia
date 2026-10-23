# Workspace task revisions — protocol 1

Use this contract for an exported workspace task bundle. Keep the standalone, append-only proposal contract in [protocol.md](protocol.md) separate.

## Contents

- [Frozen inputs and scope](#frozen-inputs-and-scope)
- [Commands and output](#commands-and-output)
- [Revision fields](#revision-fields)
- [Operations and evidence](#operations-and-evidence)
- [Review, history and conflicts](#review-history-and-conflicts)
- [Limits and recovery](#limits-and-recovery)

## Frozen inputs and scope

The workspace prepares a `bundleVersion: 1` object containing `task`, `taskDigest`, `graph`, `features`, and optional reference-status context. The task fixes its identity, kind, goal, creation date, code basis, graph digest, annotation digest/revision and permitted scope. Its kind is `overview`, `feature` or `changes`; these describe a bounded exploration request, not a claim that the whole repository was examined.

Run `node <tool>/dist/cli.js agent task overview <task-bundle.json>`. Copy the top-level `data.proposalHeader` and retain the bundle unchanged. Follow the separately paginated `scopeFiles`, `editableFeatures` and `editableMappings`, plus `newFeatures` and `parentId`. Do not assume one list's exhausted cursor applies to the others.

| Permission | Meaning |
| --- | --- |
| Scope files | Exact indexed paths that may supply changed mappings, check quotes and exploration records |
| Editable feature IDs | Existing features whose meaning or associations may be revised |
| Editable mapping IDs | Existing mappings eligible for replacement or retraction |
| `newFeatures` | Whether new feature IDs may be introduced |
| `parentId` | Selected feature for a `feature` task; proposed/revised features must remain inside its final subtree |

Parents must be authorized existing features or new features from the same batch. The selected subtree root may retain its original outside parent; that parent does not become editable, and the root cannot be moved out of that parent by this task. Files excluded from the code index cannot be added to `exploredFiles`; describe unsupported/unexamined areas in `unexplored`. Evidence navigation can inspect surrounding code outside the edit scope, but that does not grant permission to change its annotations.

A task may intentionally pair current code with older annotation bases. The receiver retains each untouched mapping's original basis. Do not manually migrate these old references or run the append-only protocol against them. A successful quote check is evidence of an exact reference, not confirmation that an old human decision applies to new code.

## Commands and output

Prefix every command below with `node <tool>/dist/cli.js agent task`. Use the same bundle throughout. There is no `--features` option on this route.

| Operation | Arguments | Result |
| --- | --- | --- |
| `overview` | bundle | Frozen proposal header, permitted scope, existing annotations and graph overview |
| `search` | bundle text `[--scope directory]` | Paged exact node IDs |
| `inspect` | bundle exact-node-id | Source and separately paged relation/membership lists |
| `relation` | bundle exact-relation-id | Original relation and paged origin source/stop records |
| `check` | bundle revision.json `--author name` | Validated change preview/receipt, `applied: false`; no annotation file written |
| `submit` | bundle revision.json `--author name --out NEW-DIRECTORY` | `revision.json`, `review.json`, `receipt.json` for human import; no application |

Read-only queries/check accept `--out NEW-FILE`. Stdout then gives that path; otherwise it contains `{ "ok": true, "data": ... }`. Help contains `ok` and `help`. Failure returns `{ "ok": false, "error": { "code", "message", "hint" } }` on stderr with exit status 1.

Use `--offset`/`--limit` for list pages, and `--source-offset`/`--source-limit` for source pages. Follow each `nextOffset` independently. `--scope` narrows search only; it cannot widen task permissions.

## Revision fields

A revision is a proposal, not a FeatureMap or a generic edit patch. Copy these six fields from `data.proposalHeader` without modification:

```text
revisionProtocol, taskId, taskDigest, snapshot, baseDigest, expectedRevision
```

`revisionProtocol` is 1. `baseDigest` and `expectedRevision` identify the task's exact annotation input, including same-revision content differences. `taskDigest` covers the task metadata and scope; the graph and annotation digests remain fixed inside that task.

Merge the copied header with a semantic payload such as:

```json
{
  "batchId": "guarded-send-01",
  "summary": "Explain the enabled guard and supplied sender callsite.",
  "features": [
    {
      "action": "add",
      "feature": {
        "id": "guarded-send",
        "title": "Send when enabled",
        "summary": "Allow enabled requests to reach the supplied sender.",
        "description": "Disabled requests return before the sender callsite; the observed call does not prove delivery.",
        "questions": ["Which external mechanism confirms delivery?"]
      },
      "reason": "Describe a separately explainable guarded capability."
    }
  ],
  "mappings": [
    {
      "action": "add",
      "id": "guarded-send-entry",
      "featureId": "guarded-send",
      "nodeId": "COPY EXACT NODE ID",
      "role": "entry",
      "rationale": "The guard precedes the supplied sender callsite.",
      "relationIds": [],
      "reason": "Tie this claim to its exact implementation."
    }
  ],
  "retractions": [],
  "checks": [
    {"featureId":"guarded-send","nodeId":"COPY EXACT NODE ID","kind":"support","quote":"COPY UNIQUE ORIGINAL SOURCE","explanation":"The bounded behavior this branch supports."},
    {"featureId":"guarded-send","nodeId":"COPY EXACT NODE ID","kind":"limit","quote":"COPY UNIQUE ORIGINAL SOURCE","explanation":"The restriction or unestablished outcome."}
  ],
  "exploredFiles": ["COPY A PERMITTED PATH ACTUALLY EXAMINED"],
  "unexplored": ["Delivery confirmation beyond the inspected code."]
}
```

This example omits the copied header and uses placeholders for evidence. Replace them using actual queries. For a selected-feature task, set each new feature's `parentId` to an authorized parent or a same-batch ancestor inside the selected subtree. Omit optional `summary`/`parentId` when unused; do not supply `null` or empty values. Always supply all six arrays, even when some are empty.

Write JSON with a file tool or serializer. Preserve quotes, backslashes and source whitespace through JSON encoding; do not alter the excerpt to make it convenient for a shell argument. Quote each file path and exact ID as one command argument.

## Operations and evidence

| Operation | Required behavior |
| --- | --- |
| Feature `add` | Use a fresh ID, allowed new-feature permission, full feature fields and a reason |
| Feature `revise` | Use an editable existing ID and its complete intended feature content, not a partial field patch |
| Mapping `add` | Use a fresh mapping ID, an authorized feature, an exact node in permitted files, role/rationale/relation IDs and a reason |
| Mapping `replace` | Retain an editable mapping's ID and feature ID; supply the full replacement association and reason |
| Retraction | Supply `{ "mappingId": "EXISTING EDITABLE ID", "reason": "Specific reason to withdraw this association." }` |

Use one operation per feature ID and one mapping/retraction operation per mapping ID. Replacement cannot move an existing mapping into a different feature. New IDs or different roles do not bypass an existing feature/code pair, including a rejected record. Node IDs are snapshot-local: cross-snapshot duplicate checks use the complete exact source anchor, so a different current entity that happens to reuse an old ID is not treated as the same pair. A previously rejected mapping is already inactive and cannot be retracted again.

The complete final hierarchy is checked before edits are previewed, so children may precede parents in the input. Cycles, missing parents, self-parenting, duplicate sibling titles and escape from a selected feature's subtree are rejected. Containment expresses authored decomposition only; it does not create execution order, dependencies, inherited mappings or inherited approval. Depth follows the data, within the batch/document budgets.

Use a feature operation's existing `reason` to explain why a changed boundary or a new child helps answer the current layer's question. Keep the layer question and broader construction notes in `TRIAL.md`, not additional revision fields. The workspace groups changes and support/limit checks by `featureId` for reading; those checks remain evidence of this fixed proposal and are not promoted into permanent proof for the current feature. Batch-wide `unexplored` stays outside that grouping.

For each feature in a feature or mapping operation, provide both a `support` and a `limit` check. Each check must reference a non-rejected, current mapping for that same feature and an exact source entity in permitted files. The quote must occur exactly once inside that entity. Parent checks do not cover children. The receiver captures file hash and range; do not supply them yourself. Retraction-only operations require a reason and do not require fabricated source checks.

Retain candidate/unknown/external classifications and bounded-origin uncertainty when interpreting `relationIds`. The receiver checks relation relevance and exact anchors; it does not prove the business interpretation or confirm that any target code or tests ran.

Use `exploredFiles` only for allowed files actually examined. The receiver attaches their frozen hashes, but this is an Agent self-report, not proof of complete understanding or whole-feature coverage. An exploration-only revision can have empty operation/check arrays. Put real gaps in `unexplored`; do not manufacture mappings to make an exploration record look productive.

## Review, history and conflicts

`check` constructs a review preview from the frozen inputs without changing them. `submit` writes the original revision, the preview and a receipt into a new directory. The task submission contains **no replacement features.json and no applied workspace state**. Check `receipt.valid`, `receipt.applied: false`, the proposal digest, expected operation counts and warnings. Do not expect the append-only route's HTML bundle here.

Hand the output `revision.json` to the person for workspace import. They inspect and apply the whole batch or leave it unapplied. Applying a batch does not accept its new/replaced mappings. Those remain `proposed`; changing a feature's authored meaning also returns its previously accepted mappings to `proposed`, listed as `review-reset` changes. Unchanged content does not silently revoke or upgrade a decision. A retraction retains its old anchors and history with an inactive/rejected decision after application. Human mapping review remains a separate action. Importing the same content is idempotent; a task's existing batch ID cannot be reused for different content. Use a fresh batch ID for a revised proposal.

Old untouched mapping bases and decisions remain historical even when the annotation document gains a current context. Do not report an old accepted mapping as current merely because its feature still exists or its symbol name looks similar.

`TASK_CONFLICT` means the revision header does not match the supplied frozen task. A successful local check does not consult live workspace state: human import/application may still reject a task because code, annotation head or task status changed since export. Preserve the old bundle, revision and receipt, then use a newly prepared task. Never replace header hashes, manually raise `expectedRevision` or copy old node IDs into a new snapshot to force a late batch through.

## Limits and recovery

- Task bundle: at most 192 MiB. Revision input: at most 5 MiB.
- One batch: at most 20 feature operations, 100 mapping operations, 100 retractions, 200 checks, 1,000 explored files and 100 unexplored items.
- Quote: nonempty, at most 1,200 characters; check explanation: at most 4,000. Operation reasons: nonempty, at most 8,000. Batch summary: at most 2,000.
- IDs use letters/digits plus `.`, `_`, `:`, `-`, beginning with a letter or digit. Feature IDs are unique across the document. Graph node/relation IDs must be copied exactly.
- Query `--limit`: 1–50, default 25; relation default 3. `--source-limit`: 1–16,000 UTF-16 characters, default 6,000. Query/check JSON output: at most 96 KiB.

Unknown fields are rejected. In particular, do not add `op`, `decision`, `actorKind`, generic review commands, authored hashes/ranges or append-only `basis`/`scope` fields to a task revision. Use the task's `summary`, `exploredFiles` and `unexplored` fields instead.

For output-budget errors, narrow pagination/source limits or use `submit` for a larger review artifact. For missing/tampered source or a damaged task, obtain the original/fresh export rather than inventing evidence. Keep invalid proposals and their error output for diagnosis. Never overwrite an existing output; a bundle without a receipt is incomplete and needs a fresh destination. Report unfinished work honestly in `TRIAL.md`.
