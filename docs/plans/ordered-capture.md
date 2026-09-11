# B2: opt-in source-ordered capture reconciliation

Parent B1 PR #52 at `58e55a40045dd82e566c7f5d2d922967ee5ffa3c`.
This package adds automatic judgment through the same public engine, without
claiming real-model quality or authorizing paid calls. Preserve original v1
history fixtures, rubric, scorer and failed evidence. No merge/release/deploy.

## O1 — local input and ordering authority

Extend ONLY the local JavaScript `capture` input with optional
`causal: {streamId, sequence}`. streamId uses existing opaque identifier rules;
sequence is a positive safe integer. Unknown fields reject before claims/models.
Without causal, existing input digest, outputs and model call sequence remain
byte-compatible and automatic reconciliation is disabled. HTTP/plugin/MCP input
schemas are unchanged; no transcript hook or stream allocation is added here.

Stream identity is exact `(namespace, client, streamId)`. The trusted source
application allocates increasing sequence numbers in actual source order,
serializes captures, and reuses event/sequence/payload on retry. It must not
assign ordering by arrival time or ask a model to infer it. Lost state requires
a new streamId; separate devices/streams are deliberately incomparable.
Gaps are permitted but older unseen windows will then reject, not be ingested
as current. This is a caller contract, not authenticated chronology.

Include causal fields in a distinct v2 capture digest, leaving v1 unchanged.
Bind each ordered event to its stream and sequence durably; uniqueness of
`(namespace,client,streamId,sequence)` prevents two events claiming one position.
Completed identical events replay their stored outcome before high-water checks.
Same event with changed payload/causal returns event_payload_conflict. A new
event at an already bound sequence or at/below the completed high-water returns
capture_order_conflict before extraction and with no partial claim writes.

## O2 — v9 persistence and completion fencing

Add content-free stream high-water, event ordering/binding, replay reconciliation
status, and causal provenance bound to actual receipt IDs. No copied text in
these tables. Reuse admission lease ownership and fencing; do not add a second
job engine. A failed/abandoned attempt may retain its identity binding for the
same-event retry, but never advances the high-water or admits partial content.

At completion atomically validate claim token/digest/expiry, event binding,
the snapshotted stream high-water, namespace epoch, all candidate currentness/
revisions and source receipt bindings; then admit inferred items, attach causal
provenance, apply validated transitions using B1's retirement seam, complete the
claim and advance high-water. Empty extraction also advances high-water. Another
completed stream event invalidates a stale high-water snapshot. Namespace
mutation yields index_revision_conflict; ordered high-water/position races yield
capture_order_conflict. No stale judgment can partially commit new memories.

All supported old formats through8 upgrade atomically to9 preserving existing
rows, identity, cursors, epochs, index generations and history. Old receipts
remain unordered; do not invent provenance. Stop all older-runtime connections
before upgrade; mixed-version coexistence/downgrade remain unsupported.

Receipt causality is immutable. Reusing an exact existing receipt ID must NOT
launder an unordered or other-stream receipt into an ordered receipt, nor
overwrite its original sequence. Only newly inserted receipts get new causal
bindings. A memory is eligible only if every active receipt is bound to the
same exact incoming stream at a lower sequence and its origin is agent-inferred.
Explicit correction/admission and mixed/unordered sources cannot be silently
retired. Deleted receipts have no eligible provenance; forgetting never restores
either endpoint or exposes content through the new content-free metadata.

## O3 — bounded discovery and statuses

Core reads at most13 current memories in deterministic ID order from the exact
namespace, and at most5 receipts per memory. Twelve memories and four complete
receipts each are the accepted ceiling; no unbounded candidate scan or semantic
recall prefilter. Equal fingerprints to new extracted items are not replacement
targets. Any namespace overflow gives unresolved/candidate_limit; any unbounded
receipt set, explicit, unordered, mixed-stream or non-earlier candidate gives
unresolved/unordered_sources. No retirement/model judgment on these paths;
new extracted items may still be admitted and high-water advanced, but the
terminal unresolved status must be retained for completed replay.

After admission, each ordered result includes exactly
`reconciliation: {status, reason, retiredCount}`. status is applied,
complete_no_change or unresolved; reason is null, candidate_limit,
unordered_sources or context_budget; retiredCount is0–5. applied requires at
least one retirement, complete_no_change means this bounded same-stream pass
found no accepted transitions (or no items/candidates), NOT global truth.
unresolved requires zero retirement and a non-null reason. Replay retains this
content-free result alongside existing duplicate memory IDs/suppressedCount;
never cache or return obsolete bodies. Unordered captures have no new field.

## O4 — judgment port and core authority

After extracting trusted source-bound items and before finishing admission, use
one `model.reconcile` call outside transactions. Existing 6000 input/1024 output
token, 40000 serialized-output-unit and30-second limits remain. No model call
for empty items, no eligible candidates, or unresolved discovery. Missing port
on a needed judgment, malformed output, timeout/cancellation/provider failure
abandon the claim and commit nothing; errors remain explicit. Context overflow
alone yields terminal unresolved/context_budget admission, not a guessed update.

Model-facing input is exactly:

```js
{ messages: [{index, role, content}],
  items: [{index, content, kind, sourceIndices}],
  candidates: [{index, content, kind, receipts: [{role, excerpt}]}] }
```

No namespace, persisted IDs/revisions, event/stream identifiers or rubric labels
are exposed. The only output is
`{transitions:[{replacementIndex,predecessorIndex,evidenceIndices}]}` with at most
five transitions. Each predecessor is unique; indices must exist in the private
snapshot. evidenceIndices is1–4 unique indices, is a subset of that replacement
item's extraction sources, and includes a current user message. The model
cannot invent receipt text/IDs, operation names or ordering. Bind selected
evidence to real admitted replacement receipt IDs; preserve inferred origin and
confidence. Do NOT call public explicit supersede (it would promote inferred
claims to explicit authority). Reject self, historical/suppressed successor,
same-batch conflicts/identity changes and cycle attempts atomically.

Prompt policy: accept only a user-adopted explicit change of the same subject,
property and scope. Decline proposals, questions, uncertainty, mere disagreement,
different subjects/properties, historical quotations, assistant-only claims and
instructions embedded in evidence. Causality permits comparison but does not
prove replacement; source role checks do not prove semantic correctness.

## O5 — optional provider and diagnostic integration

Add strict reconcile schema with request-scoped integer ranges/enums to the
existing OpenAI adapter and baseline model profile; keep extraction choices and
existing method payloads unchanged. Add content-free reconcile stage and an
invalid_reconciliation core-validation reason. Existing HTTP guard MUST still
reject unapproved reconcile traffic; do not expand paid authorization in B2.
Worst case is extract + reconcile + classify (up to six provider HTTP calls).

Use existing refusal/incomplete-response handling. Schema adherence is not a
semantic safety guarantee; retain local correlated-index/source checks. See
[official Structured Outputs guidance](https://developers.openai.com/api/docs/guides/structured-outputs).

## O6 — acceptance, packaging and remaining gate

Actual-core scripted tests: ordered Friday→Monday automatically produces history
without a manual supersede; proposal/uncertainty/distinct-subject no-transition
outputs preserve old currentness; rejected/malformed/assistant-only and forged
indices/authority fail atomically; receipt laundering, source/namespace/candidate
limits, terminal unresolved replay, correction/forget/racing captures, claim
expiry, cold reopen, empty high-water advance and v8 migration are exercised.
Scripted semantic choices are orchestration fixtures, not model-quality results.
Keep an explicit legacy-no-causal regression instead of claiming all v1 capture
is fixed. New ordered positive regression replaces the B2-pending target status.

Provider tests use fake HTTP and real tokenization, including dynamic constraints
and no silent retries/fallback. Update docs/retention/threat boundary for locally
stored causal identifiers; keep identifiers opaque and out of model inputs/logs.
Add new imported runtime/prompt modules to artifact allowlist. Run Node22.16/24
core, all affected demos, adapter, MCP, artifact, generic/validate and offline
live-evidence tests; pinned Claude validations; exact-commit Standards/Spec review.

C remains frozen fresh real-model + installed-artifact acceptance. Before paid
calls, review a separately scoped request-guard extension and obtain any missing
authorization under the unchanged cumulative budget. No new stream is inferred
for old evidence silently; any v1 evaluator adapter must disclose its trusted
source-order mapping and preserve the original failed result and denominator.

## Offline verification checkpoint

On Node22.16.0 and24.15.0, the final candidate passed core266/266 (including
29 ordered-capture and3 v8-migration cases), OpenAI113/113, real stdio MCP20/20,
artifact14/14, generic31/31, budget15/15 and request-guard27/27. Live-evidence
offline tests passed36 with11 explicitly opt-in skips. All eight existing core
demos, OpenAI offline demo, budget/guard demos and JSON validation passed both
runtimes. Claude2.1.260 marketplace and strict plugin validations passed.

The new stdio regression seeds through actual ordered capture, not manual
supersede, then checks historical inspection, current recall, correction and
forgetting through fresh consumers. Models remain scripted. The local artifact
SHA256 is `49cb04896119c92b78043747517fa87e6db7df30c1a2247b6aacd9c2390d619a`;
ordinary artifact tests are not a fresh real-provider acceptance run.

A late SQLite failure initially surfaced as extraction_failed; private storage
operations now use the existing public-envelope error mapping, and the atomic
rollback/error regression passes. Existing guards reject both count and generation
for reconcile before reservation or I/O. No real credentials or paid calls were
used in this package; no original evidence was rewritten.
