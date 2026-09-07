# 1b — capture orchestration acceptance (prepared, not implemented)

Planning base: `44ece1479f4048a8a95f895baa6e674ec9a1c0a1` (merged roadmap).
Implementation prerequisite: package 1a must be merged and its actual merge SHA
recorded in the implementation PR. This document does not supply capture code,
claim that extraction works, or authorize a stacked implementation/self-merge.
Its purpose is independent preparation while admission delivery awaits review/merge.

## Planning acceptance

- P1: Freeze the public capture and model-port shapes, evidence binding, digest
  identity and bounded inputs without widening the host's trusted authority.
- P2: Specify success/processing/duplicate and pre-/post-admission failure paths,
  including classification failure that must not undo committed memory.
- P3: Supply observable synthetic cases and worker file boundaries; distinguish
  future implementation/model-quality gates from verification of this document.

## Public operation and trusted input

Proposed additive async method:

```js
core.capture({
  namespace, client, eventId, sessionId,
  messages: [{ id, role: 'user', content }],
})
```

Exact allowlists at every level. Namespace is selected by a trusted host, using
the existing exact personal/project contract. Client, session, capture-event and
message IDs use existing opaque identifier bounds. Message IDs must be unique
within the batch. Roles are user or assistant only; files/tool output/paths and
system instructions are not separate accepted fields. Ordinary conversation
text can still contain sensitive material; redaction is best-effort, not a
claim that all PII or secrets are removed.

Messages must be a dense ordered array of 1..24. Each content value uses the
existing normalization/redaction and nonempty validation, at most 4000 UTF-16
units. Sum of resulting content lengths must be <=20000 units. Oversized or
invalid input rejects before claim/model/storage mutation; never silently discard
a message, crop content to fit or construct a digest from only a prefix.

Materialize one canonical trusted snapshot and use it for both model evidence
and digest. Define digest bytes precisely as UTF-8 JSON.stringify of this fixed
array structure (not the caller's arbitrary object property order):

```js
[
  'cairn.capture.v1',
  [namespace.ownerId, namespace.scope, namespace.projectId],
  client, eventId, sessionId,
  messages.map(({id, role, content}) => [id, role, content]),
]
```

Here personal projectId is null and every content string is already normalized/
redacted. SHA-256 yields the lowercase hex payloadDigest used by 1a. Order and
all bound identity/content fields matter; receipt truncation occurs later.
Hashing gives replay identity, not secrecy or evidence authorization. Changes
that alter only removed secret values may normalize to the same redacted payload;
this is expected, not a promise of raw-transcript identity.

## Injected extraction port

`openMemoryCore({path,model})` reuses the existing model configuration; add
`model.extract({system,input,maxOutputTokens,signal})`. Independently author the
extraction prompt as Markdown. Extraction input is exactly:

```js
{ messages: [{ index: 0, role: 'user', content: 'Validated/redacted text' }] }
```

Do not send capture tokens, digests, owner/project/client/session/message IDs
to the extractor. Existing downstream classification retains its documented
input contract; this narrower extraction shape does not silently change it.
All supplied messages are untrusted evidence, not instructions to execute tools,
invent facts or change scope. Prefer durable information grounded in evidence;
general semantic accuracy must be measured in stage 2, not inferred from schema.

Extraction output is exactly:

```js
{ items: [{
  content, kind, confidence,
  sourceIndices: [0],
}] }
```

Items are dense, 0..5; each content is normalized/redacted and <=600 UTF-16
units, with existing kind enum and required finite confidence in 0..1. Each
sourceIndices is dense, unique, 1..4 integers in range of the original snapshot.
No arbitrary receipt, origin, namespace, ID or conflict fields are accepted.
An invalid member or source index rejects the WHOLE extraction, not just the
bad candidate. Valid zero extraction must finish the admission claim.

Build each receipt from the trusted index: client/sessionId from capture input,
eventId from the referenced message.id, role from that message and excerpt from
its normalized/redacted content bounded to 800 without splitting code points.
The model never writes receipt text or identity. Structural source binding proves
that receipts correspond to supplied messages; it does not prove entailment.

Reuse the shared bounded model-call helper with extraction_failed for unexpected
adapter failure: context >=8192, counted input <=6000, counted output <=1024,
maxOutputTokens 1024, framing reserve 1024, 30-second AbortSignal deadline.
No bundled provider or heuristic production counter. Payload size validation
does not guarantee token fit; unavailable counter/context overflow is an explicit
failure, not permission to silently drop source evidence.

## Lifecycle and exact output values

All operations use the existing success/error envelope.

1. Canonicalize/validate, then claim with fixed leaseMs 125000. Do not expose
   caller/model overrides for the internal lease or extraction limits.
2. Processing returns `{processing:true}` immediately; completed replay returns
   `{duplicate:true,memoryIds,suppressedCount}`. Both use the stored claim result,
   make zero model calls and do not require a model/counter to be configured.
3. A fresh claim invokes extraction outside transactions, validates output and
   binds receipts before calling finishAdmission atomically. Never infer claims
   or successful writes from a model's response alone.
4. Extraction/validation/finish failure returns its explicit error and attempts
   to abandon only that matching live claim. Cleanup failure does not replace
   the original error; the lease can expire. No hidden retry or lease takeover.
   Stale owners never commit under a successor's token.
5. Successful finish is durable before classification. Read each returned ID
   with its expected admission revision. If fresh, select only currently unfiled
   memories for the existing classifyPlacement → applyPlacement path. An exact
   admission no-op must not reclassify already-filed memories.
6. Changed/forgotten revisions or classification/model/apply failure produce
   an explicit failed-classification status, not rollback or an overall failed
   capture that encourages duplicate extraction. The caller can inspect/retry
   classification explicitly using fresh reads; automatic replay does not do so.

New completion returns:

```js
{
  duplicate: false,
  admission: { memories: [{id, revision}], suppressedCount, indexRevision },
  classification,
}
```

`admission` is the finish snapshot, not a claim that its revisions remain current
after filing. `classification` is exactly one of:

```js
{ status: 'skipped', reason: 'empty' | 'already_filed' }
{ status: 'applied', memoryRevisions: [{memoryId, revision}], indexRevision }
{ status: 'failed', error: {code, retryable} }
```

Applied revisions come from actual placement output, including any filing bumps.
On failed classification, previously committed memory stays inspectable; an
external correction/deletion is never undone. Missing model.extract on a fresh
claim is model_not_configured plus best-effort abandon. Missing model.classify
after finish is a failed classification, not failed admission. At most one extract
and one classify call occur; no model/tokenizer callback runs in a SQLite transaction.

## Frozen synthetic acceptance matrix for implementation

| ID | Setup / action | Required observation |
| --- | --- | --- |
| C01 | One user fact; successful extraction/classification | Inferred memory and trusted receipt commit, placement uses actual source/revision, applied filing revisions reported |
| C02 | One synthesis selecting 2–4 input messages | Receipts match those exact message IDs/roles/excerpts; no model-authored receipt payload |
| C03 | Extractor returns no items, or all items suppressed | Claim completes; empty admission and skipped/empty classification; replay makes zero model calls |
| C04 | Unknown, duplicate, fractional or out-of-range source index | Entire batch rejects, no partial memory; matching live claim abandoned |
| C05 | Invented receipt/namespace/origin/ID/conflict keys | invalid_model_output; no cross-scope reads/writes or caller-field widening |
| C06 | Sparse/oversized input or output, invalid kind/confidence, context overrun | Exact validation/model-budget error; no silent dropping; input errors create no claim |
| C07 | Reordered object keys versus changed canonical field/order | Same canonical snapshot yields same digest; each changed bound value/order changes digest; reused event with different digest conflicts |
| C08 | Secret-shaped content before extraction | Digest/model request use normalized/redacted snapshot; excerpt truncation does not change payload identity |
| C09 | Completed or processing claim without configured model | Exact duplicate/processing response, no counter/model invocation; no lost stored outcome |
| C10 | Extractor timeout/cancel/failure or invalid output; then retry | Explicit error and safe abandonment; retry can acquire new token; no incomplete batch |
| C11 | Expire/take over claim during model work; old result arrives | stale_admission and no write; old cleanup cannot abandon successor; no automatic re-extraction |
| C12 | Classification unavailable/fails, or memory changes between finish/classify | Admission remains durable, failed classification explicit; no stale placement or content resurrection |
| C13 | Admission exact no-op matches an already-filed memory | No classifier call; unchanged membership/revisions, skipped/already_filed |

Run these against real temporary SQLite with scripted extraction/classification
adapters, including another connection/process for the stale-owner/revision cases.
Retain existing core/plugin tests, both Node versions, migration coverage and all
demos. Add a source-checkout capture demo to both core CI jobs. Real-model quality
and actual client compatibility remain stage 2/3 gates, not this mock matrix.

## Work assignment after prerequisite merge

- Primary: pin actual 1a merge/base; finalize any dependency-driven spec change
  before code, own facade integration/docs and verification evidence.
- Orchestration worker: new capture input/digest/evidence mapping module, capture
  orchestrator and Markdown prompt; no storage engine duplication or HTTP host.
- Independent test worker: C01–C13, separate synthetic fixtures and concurrency
  evidence; does not alter expected values merely to make implementation pass.
- Fresh Standards/Spec reviewers: same final committed diff, no implementer
  reviewing their own patch. Primary reruns failures and affected gates.

Prepared only: no implementation owner has delivered these features and no
semantic/capture success is claimed by merging this acceptance document.
