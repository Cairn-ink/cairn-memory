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
