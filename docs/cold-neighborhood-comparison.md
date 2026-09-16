# Fresh cold-session source-utility packet

The [source fixture](../evaluation/live/cold-neighborhood-fixture.json) contains
four modest synthetic histories. Each has three ordered capture batches of
ordinary `{id, role, content}` messages followed by one user question. Batch
`capturedOn` dates schedule submission; event dates and applicability must be
read from attributed message content, not inferred from arrival order. The
separate [rubric](cold-neighborhood-rubric.json) is evaluator-only. Neither its
answer obligations nor its distractor labels enter capture, retrieval, or an
answer request. These are selected development scenarios, not a blind or
long-horizon benchmark.

## Later scored protocol—not run by this packet

For each case, submit the three batches through ordinary capture in order,
without manually admitting an ideal memory, seeding a relationship graph,
forcing an oracle root, injecting missing gold sources, or replacing a failed
case. Record each capture response and retained receipt coverage. Close the
store, perform a separate keyless cold-reopen persistence inspection, and close
that reader. Then use a fresh, explicitly guarded installed provider-equipped
host against the unchanged captured checkpoint for actual MOC selection,
ranking and the final question. A keyless inspection process is not asked to
make model calls. The two arms share the same captured
checkpoint, answer model, instruction bytes, output cap and sampling settings;
only the explicit recall context mode differs:

- `source-evidence`: original retained receipts associated with selected roots.
- `rationale-neighborhood-evidence`: original retained receipts from the
  selected roots and their bounded root neighborhoods.

Both answer requests receive **source text only**—no `rationale` edges, basis
units, rationale status labels, summaries, expected answers or evaluator
metadata. Source DTO provenance/coverage markers may remain, but they are not
relationship interpretations or semantic truth. An
answer builder must remove those interpretations from the neighborhood result
while preserving attributable original receipts. Locally generated citation
handles may identify which retained receipt supports an answer; they must not
be oracle references or labels. More returned evidence in the neighborhood arm
means this is a read-path utility comparison, not an equal-context causal
ablation. Root discovery remains a separate limitation.

For each arm, separately record (1) submitted source-message IDs, (2) source
receipts retained after capture, (3) roots actually selected, (4) receipts
available after linked-source expansion, (5) source passages delivered in the
final answer request, and (6) the answer's source support and correctness.
A source lost earlier cannot be credited because it appears in a gold rubric.
Count missing evidence, partial traversal, more than six distinct returned
sources, overflow, capture/retrieval/answer failure and unrun slots as failures
or unavailable—not as correct abstentions. Keep the existing source, edge,
token and serialized limits unchanged; never silently truncate a neighborhood.

The evaluator checks each required obligation's `state` and `supportLevel`
against its exact cited passages. An obligation with `required: false` is
optional historical context: omission alone does not fail a concise answer to
the actual question, but a volunteered claim about it must be source-correct.
Absent `required` means required. `full` means the cited original messages jointly support
the stated positive answer; `partial` means they justify only a bounded answer
or abstention, not a missing value. Passage anchors demonstrate provenance,
not semantic entailment or speaker authority. The rubric also lists forbidden
inferences; a fluent answer with one of those errors fails independently of
positive coverage. Case 4 requires both the known May pickup time and a
qualified non-answer for unconfirmed July hours, so universal refusal cannot
pass. A future scored comparison needs its own frozen operator, offline
rehearsals, independent review, cumulative-budget preflight and exclusive
one-shot intent. This packet makes no provider call and grants no paid use.
