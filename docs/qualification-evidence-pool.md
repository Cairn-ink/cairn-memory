# Candidate qualification evidence-pool wire

`qualifyCandidates` now asks the OpenAI adapter for a named, versioned
`evidence-pool-v1` response. This is a provider transport format only. The core
still receives its original per-field `evidenceIndices` and applies the same
source-bound qualification compiler and admission rules.

For each required `item_N` entry, `pool` lists one to four distinct original
candidate indices supplied for that item. A field's `evidenceSlots` refers to
zero-based positions in that item's pool, not to original candidate indices:

```json
{"wireVersion":"evidence-pool-v1","qualifications":{"item_0":{"itemIndex":0,"pool":[7],"subject":{"value":null,"evidenceSlots":[]},"property":{"value":null,"evidenceSlots":[]},"scope":{"value":null,"evidenceSlots":[]},"applies":{"value":null,"evidenceSlots":[]},"value":{"value":null,"evidenceSlots":[0]},"attribution":{"value":"unknown","evidenceSlots":[]},"commitment":{"value":"unknown","evidenceSlots":[]}}}}
```

That example assumes the request actually supplied candidate index 7 for item
0; it is only a shape illustration, not a factual qualification. All seven
fields and every requested item are required. A nonempty pool does not itself
cite anything: at least one field must reference a slot, including when every
value is null or unknown. Known values need their own field citation. Unused
pool members create no anchor. Duplicate, foreign or out-of-range IDs/slots,
accessors, unknown keys and incomplete coverage fail rather than being repaired.

The strict provider schema shares common field definitions through `$defs`,
but the adapter also validates the decoded result against the unchanged inline
candidate-ID schema. The core alone compiles exact retained excerpt offsets,
canonical labels and source anchors. No evidence is selected for the model,
truncated, or inferred by this conversion. The old one-count/one-generation
qualification schedule, model, 6,000-token local bounds and provider/guard
limits remain unchanged.

Synthetic fake-HTTP tests show a fixed five-item, one-323-unit-receipt-each
fixture now fits the complete request and compiles. The maximum-size
unique-source synthetic fixture (five items × four 800-unit receipts) remains
above the local budget and fails before HTTP.
These are transport controls, not real-provider schema compatibility, semantic
quality, or a successful benchmark comparison. Finite source-free diagnostics
can distinguish citation budget/integrity, label canonicality and downstream
binding failures while preserving the public `invalid_model_output` result.

## Optional repeated-text input catalog

`qualificationInputMode: 'adaptive-text-catalog-v1'` is an explicit OpenAI
adapter opt-in. Core first checks its unchanged inline candidate request. If
that request cannot fit, it may try `inputMode: 'text-catalog-v1'`: `texts` is
an exact, first-occurrence dictionary and each candidate retains its original
`candidateIndex` and `role` with a `textIndex`. Expansion restores the original
model-facing candidate bytes and does not combine receipts or source identities.
The provider instruction resolves each text index and treats that source as
untrusted data. The evidence-pool-v1 response, inline validator, core compiler,
stored receipts and source anchors are unchanged.

The opt-in fit is synchronous and local. It checks core logical tokens and the
adapter's complete count-body tokens using the same qualifier serializer used
for dispatch. A fitting inline request stays inline; a fitting catalog gets
one count and one generation request, never a retry. Neither representation
fitting fails before transport or admission. The opt-in may do extra local
serialization and tokenization; it does not promise lower CPU work. The
6,000-token local, 7,024-token provider and 1,024-token output limits remain.
Default adapter configuration has no fit callback and keeps the inline route.
The optional fit is accepted only as an explicit own-data callable on the
model. An inherited getter or function fails locally without invocation;
genuine absence alone retains legacy inline behavior.
Existing v1 paid request guards reject catalog mode before forwarding or
reserving; no old grant is implicitly upgraded.

The separate adaptive qualified source-pair guard grants this mode only through
an explicit `qualified-source-pair-adaptive-case-v1` capability. Its binding
records a declared installed artifact hash, declared non-secret adapter
configuration hash, the `adaptive-text-catalog-v1` profile and an outer digest
over those fields plus the complete normalized two-arm roster. The new guard
accepts inline qualification as well as the strict catalog, while the old
source-pair guard continues to reject catalog requests. Both modes keep the
same source-bound compiler, one count/one generation schedule, 6,000-token
logical and equivalent count-body bounds, 7,024-token provider bound and
1,024-token output bound. The grant records declarations; a later installed
helper must verify actual artifact and configuration bytes before paid use.

The fixed repeated-source synthetic five-item × four-receipt × 800-unit fixture
fits this catalog route in fake HTTP and compiles exact original anchors. The
all-unique fixture still refuses locally. A surrogate-safe split can produce
five candidates per 800-unit receipt, so catalog validation allows up to 100
candidates across the five items without changing the four-cited-anchor cap.
These local controls do not establish real-provider interpretation, strict-schema
compatibility or benchmark resolution. A frozen one-shot installed compatibility
plan and budget audit are still required before any paid call.
