# Agent protocol 1

All commands start with `node <tool>/dist/cli.js agent`. `--features <sidecar>` selects the same base for overview, queries, check and submit. Omit it only when deliberately creating an independent empty annotation document.

| Operation | Arguments | Output |
| --- | --- | --- |
| overview | graph [--scope directory] | Fixed basis/revision/digest, path projection, paged feature/diagnostic inventory, proposalHeader |
| search | graph text [--scope directory] | Paged exact node IDs and source positions |
| inspect | graph exact-node-id | Source slice, paged related edges and memberships |
| relation | graph exact-relation-id | Original edge and paged value-origin sources/stops |
| check | graph proposal.json --author agent-name | Validation receipt and mapping warnings; no sidecar changes |
| submit | graph proposal.json --author agent-name --out NEW-DIRECTORY | New proposal/sidecar/assessment/receipt/index.html bundle |

Queries/check may use `--out NEW-FILE`; stdout then contains the artifact path, so read that file. Otherwise stdout is `{ok:true,data:...}`. Errors are `{ok:false,error:{code,message,hint}}` on stderr with exit code 1. `--limit` is 1..50, default 25 (relation defaults 3). `--source-limit` is 1..16000 UTF-16 characters, default 6000. All output is bounded at 96 KiB: reduce limit/scope on OUTPUT_BUDGET, never assume missing output means empty evidence. The graph input is at most 128 MiB, sidecar/proposal at most 5 MiB.

A proposal is NOT a FeatureMap. Start with `data.proposalHeader`, preserving its exact basis, expectedRevision and baseDigest. Replace the empty content with:

```json
{
  "batchId": "capability-first-pass-1",
  "scope": "A bounded behavior, not the whole repository",
  "unexplored": ["Adjacent behavior not yet examined"],
  "features": [{"id":"capability-id","title":"Observable capability","description":"Trigger, outcome, constraints and exclusions.","questions":["A real unresolved question"]}],
  "mappings": [{"op":"mapping","id":"capability-entry","featureId":"capability-id","nodeId":"COPY EXACT ID","role":"entry","rationale":"Why this implementation supports this bounded claim.","relationIds":[]}],
  "checks": [
    {"featureId":"capability-id","nodeId":"COPY EXACT ID","kind":"support","quote":"COPY UNIQUE EXACT SOURCE","explanation":"The limited claim this branch supports."},
    {"featureId":"capability-id","nodeId":"COPY EXACT ID","kind":"limit","quote":"COPY UNIQUE EXACT SOURCE","explanation":"When the claim does not hold or is narrower."}
  ]
}
```

The example is only the semantic part; merging it with the header is required. Write JSON with a file tool or serializer rather than long shell-escaped inline arguments. Quoting an exact ID as one argument is necessary for shell safety. A small artifact-writing script is fine; rebuilding call resolution or fabricating snapshot metadata is not.

## Explicit feature hierarchy

Protocol/proposal `schemaVersion` stays **1**. Each feature may additionally contain `summary` (nonempty, at most 200 characters) and `parentId` (the exact ID of an existing or same-batch feature):

```json
{
  "id": "guard-request",
  "title": "Check whether the request is enabled",
  "summary": "Allow enabled requests to reach the sender.",
  "parentId": "capability-id",
  "description": "Checks the enabled flag before calling the supplied sender; this does not prove delivery.",
  "questions": []
}
```

Omit optional fields when unused; do not supply `null` or an empty string. Parent/child order within the batch does not matter. The receiver validates all parent references and cycles before applying parents first. Titles must be unique within the same parent; feature IDs remain unique across the document. Each new parent and child still needs its own mapping, support check and limit check. A parent cannot borrow a child's checks.

`parentId` means containment only, not a call, dependency or execution order. Do not infer it from shared entities, directories or mapping roles. Existing features cannot be reparented through this append-only channel. A successful proposal using the new optional fields yields **FeatureMap schema 3**, with original mapping bases retained; legacy proposals remain supported. The proposal schema and the resulting sidecar schema are separate contracts.

SNAPSHOT_CONFLICT means re-explore that snapshot, not edit a hash. REVISION_CONFLICT means reread the intended sidecar and reconcile. EXISTING_MAPPING includes rejected pairs; it cannot be bypassed with a different ID/role. SOURCE_REQUIRED means source is missing, not an invitation to invent a quote. QUOTE_MISMATCH means choose a unique original excerpt. A valid reference or quote is not proof that an agent read it or that its explanation is correct.
