# Feature tree construction

Use this guide when choosing a first capability overview, decomposing a selected feature, or revising a boundary. These are authoring decisions over inspected evidence, not instructions for arranging coordinates. The examples below are hypothetical; they supply no facts, IDs or quotes for the repository being analyzed.

## State the layer question

Record one question in `TRIAL.md` before drafting this layer:

- Overview: “What can a person accomplish with this project within the indexed scope?”
- Selected feature: “What useful parts, conditions and boundaries explain this capability?”
- Changes: “Which existing explanations or associations need revision after this bounded change?”

Use the frozen task's actual scope. A better question cannot expand permitted files, features or mappings. Do not reread the whole project merely because one selected feature needs detail.

## Choose useful siblings

Suppose inspected source separately supports previewing a report, choosing its contents and requesting a download. A layer answering “How can a person inspect and export a report?” could use the following names:

| Prefer | Avoid | Why |
| --- | --- | --- |
| “Preview report contents”, “Choose included sections”, “Request a report download” | `ReportPanel`, `serialize()`, `report.ts` | The preferred names describe comparable observable capabilities; the others mix a component, a helper and a file. |
| Keep a naming helper as supporting code of an evidenced capability | Add “Format the filename” only because a helper exists | A code boundary alone does not justify a feature boundary. |
| Add a deeper child when its separate conditions or result help answer the next layer's question | Give every branch the same depth or number of children | Real capabilities can be uneven. A shallow branch does not imply missing work. |

These sibling names do not establish execution order. Retain control, persistence or external-boundary distinctions when merging would hide a condition the reader needs. Do not rearrange existing accepted content for symmetry; a changed boundary still needs permission, evidence, a reason and human review.

## Explain each split

Record why each proposed child belongs under its parent and what it explains separately. For a task, use the existing feature operation's `reason`; for the standalone append route, keep the rationale in trial notes and the existing allowed semantic fields. Never invent a `decomposition`, `layerQuestion` or `claims` JSON field.

- Useful reason, **if supported by the inspected source**: “Separate section selection from the download request: selection changes which content is included, while the download request hands that selected content to an external save mechanism.”
- Insufficient reason: “This folder has many files, so it needs three child nodes.”
- Insufficient reason: “The parent looks too large in the diagram.”

Each new or revised parent and child needs its own mapped support and limit checks. Parent acceptance, a child's checks, shared helpers and a call chain do not establish another feature's meaning. Preserve the selected subtree root's parent and the task's allowed scope.

## Keep concise wording truthful

If inspected code requests a download only after content exists, prefer “Request a download when report content is available” to “Always saves the report.” Keep full conditions and exclusions in `description`; use `questions` for unestablished outcomes such as whether the external mechanism completed the save. Do not add such a question mechanically when it does not apply.

Use `summary` for the reader's short explanation. A missing summary may be displayed from the existing description, so do not rely on the viewer to infer a stronger or cleaner promise. Preserve exact source text in checks, even when the user-facing explanation is simpler.

## Keep gaps separate from structure

- A feature with no children has no recorded decomposition; it is not automatically fully analyzed or necessarily indivisible.
- `exploredFiles` records permitted file versions actually examined by the Agent. It is not a feature completion score.
- `unexplored` describes batch-wide gaps. It has no per-feature ownership and does not become speculative child nodes.
- `questions` records a particular feature's uncertainties. Do not make an empty feature merely to hold an unanswered question.
- Existing flat inputs stay flat until an explicit, permitted content revision is reviewed and applied.

Before handoff, read the names and summaries of each changed layer together. Can a person state the layer question, distinguish the children, find the relevant condition and locate the corresponding evidence? Record a concrete revision or defer the unsupported part when the answer is no. This author self-review does not replace human review or prove semantic accuracy.
