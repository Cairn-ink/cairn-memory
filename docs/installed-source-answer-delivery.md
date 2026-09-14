# Installed source-to-answer delivery

The evaluation-only
[`deliverInstalledSourceAnswer`](../evaluation/live/installed-source-answer-delivery.mjs)
joins a successful source-context MCP result to one injected completion. The
installed regression uses the generated installer command, actual SDK stdio and
local SQLite: capture submitted messages, close/restart, MOC select/rank, then
pass that exact cold recall result into the consumer. Model HTTP and the final
answer are scripted; **this verifies wiring, not answer quality or a named host's
autonomous tool choice**.

Use an explicitly requested `recall_memory` call with
`contextMode: "source-evidence"` and `limit: 6`. Pass the unmodified SDK tool
result as `toolResult`, the question, and an already-authorized guarded
`complete(body)` callback that returns parsed completion JSON. The helper never
discovers credentials, chooses endpoints or falls back to global fetch. A paid
callback still needs the caller's existing durable budget, request/response
bounds, timeout, authorization and evidence retention. This helper is not that
transport guard, does not run or retry MCP itself, and is not shipped as a new
MCP tool/default or automatically installed host plugin.

The request preserves each memory ID/revision/currentness and complete retained
receipt IDs, submitted roles and original excerpts, in returned order. It rejects
summary, qualification or basis fields rather than interpreting them. Namespace,
private source identity and MCP transport metadata are not sent. Instructions
distinguish evidence from authority and recorded storage currentness from truth
or effective date. Prompt text alone is not a security boundary or proof a model
will obey it; the request has no tools and this consumer executes no actions.

Input bounds are six memories, 100 receipts per memory, 800 UTF-16 units per
excerpt, 4,000 per question, 262,144 incoming MCP-text bytes and 24,000 serialized
request bytes. Overflow, incomplete receipt pages, budget-exhausted recall,
wrong-context output and malformed results reject before completion; no truncation
rescues a partial result. `coverage: complete` only describes bounded traversal,
not semantic completeness or reliable selection. Empty successful recall remains
valid evidence for ignorance, not an infrastructure failure. Users with partial
evidence need an explicit separate workflow; this bounded diagnostic does not
silently answer from it.

The answer request pins `gpt-4.1-mini-2025-04-14`, 1,024 output tokens,
nonstreaming, `store:false`, one completion and no tools. Outcomes distinguish:

- `invalid-source`: no completion call.
- `completion-failed`: injected transport threw; one call, no retry.
- `invalid-output`: malformed, wrong-model, truncated, refused or tool-bearing
  response; one call and any answer text retained.
- `generated-unassessed`: structurally completed text, not certified truth.

Returned answer text is private, untrusted model output, **not publication-safe**.
The helper deliberately preserves invalid text for evaluation; do not execute it
or use this object as a general public-log exporter. Response-size enforcement
belongs to the injected guard; the helper only accepts well-formed answer text
up to 16,000 UTF-16 units as structurally completed.

The installed test deliberately uses incorrect generated summaries and adoption
qualification while preserving real original source excerpts. It confirms those
interpretations cannot leak into the source-only answer request. Four additional
offline tests cover data shapes, retained provenance, bounds, missing evidence,
invalid answers and failure/no-retry behavior. Existing legacy/default tests are
unchanged and run in the full artifact suite.

This follows the [observed answer utility](source-answer-utility.md) finding that
original receipts helped while an additional basis did not demonstrate a gain.
Fresh long histories, named real-host consumption and independent user trials
remain pending. No further live requests, package publication or deployment are
part of this change.
