# Classification request-local wire aliases

Status: implementation accepted; offline repair evidence and a separately
frozen five-case development pilot retained.

This repair is based on `b43f7308c6d7cad2c3affc0e09ac26fe3f7bbdae`.
It responds to measured UUID repetition in the classification transport, not to
a retained provider count. The interrupted pilot's historical provider count
and failure cause remain unknown, so this change cannot establish that the
pilot is fixed or supply a benchmark score.

The reviewed candidate is PR 189 at exact commit
`8132c552bcf88df5d0f539475ef13b683baf480c`. Its 17 remote CI checks are green,
and independent Standards and Spec reviews report PASS with zero findings.
Those gates cover the bounded alias-only implementation; they do not establish
unlimited catalog scale or semantic correctness. A later fixed development
pilot is reported separately below; it does not turn those engineering gates
into a quality claim.

## Scope and invariants

Only the optional OpenAI adapter's `classify` wire format changes. Core
classification input, MOC catalog selection, recall, durable IDs, policies,
limits, reservations, approvals and every other adapter method remain
unchanged. The adapter continues to check the original core request against the
6,000-local-token bound, uses one count and at most one generation request,
enforces the 7,024-provider-input and 1,024-output limits, disables truncation,
storage and streaming, and never retries or repairs output.

Classification aliases are transport compression, not anonymization. The same
untrusted card text, MOC titles and metadata cross the same provider boundary.
The request-local reverse maps exist only in process memory for the duration of
one invocation; they are not placed in the request, persisted or emitted in
diagnostics/telemetry.

## Acceptance contract

- **CWA1 — Lossless request-local encoding.** Before provider serialization,
  deterministically replace only `memories[*].id` and catalog
  `map[*].moc.id` with short, injective, role-separated aliases. Preserve
  ordering, counts, card/MOC content, titles, revisions, map entry shapes and
  `mapExhausted` byte-for-byte modulo those explicitly mapped identifier
  fields. Never replace identifier-looking text in content or titles, and do
  not send a reverse UUID table. Do not mutate caller input. Freeze the encoded
  snapshot, schema, count body and generation body before the first async host
  callback so caller mutation and concurrent/interleaved calls cannot change a
  request's mapping.

- **CWA2 — Fail-closed decode and validation.** Build `schemasFor('classify',
  wireInput)` from the encoded snapshot, so provider output enums contain only
  aliases. Validate the parsed provider object against that exact wire schema,
  then decode the authoritative role-specific fields `memoryId`, `parentIds`
  and `newL1.parentL2Ids`. Reject malformed output, unknown aliases,
  memory/MOC cross-role aliases and raw original-ID injection as
  `invalid_model_output`; no alias may escape the adapter. Preserve valid empty
  catalogs, L1/L2 parents, new-L1/new-L2 proposals and both
  `mapExhausted:true/false`. Core performs its existing semantic/correlation
  validation on decoded original IDs, and durable storage sees only original
  IDs.

- **CWA3 — Actual persistence seam.** A synthetic actual-core -> adapter ->
  fake-HTTP regression returns existing and new parent proposals in wire
  aliases, receives original IDs from the adapter, runs the existing
  `applyPlacement` guards and verifies the intended original links were
  persisted. A provider output containing an unknown or cross-role alias fails
  closed and cannot write.

- **CWA4 — Guard and policy compatibility.** An actual core -> adapter ->
  benchmark-request-guard fake-HTTP regression passes the existing stage
  policy with semantically matching count/generation payloads. The count and
  generation bodies share the frozen encoded input and schema. No guard
  authorization, reservation, model policy, approval file, cap, retry,
  truncation or callback changes are permitted. Existing qualification wire
  behavior and all adapter methods other than `classify` stay unchanged.

- **CWA5 — Material deterministic reduction without coverage loss.** A fixed
  synthetic fixture with five target cards and 52 visible MOCs, with realistic
  roughly 1,000-local-token target-memory component, measures the old uncoded request
  locally and compares it with the encoded request. The encoded input/schema
  must retain exactly the same visible candidate order, count and non-ID data,
  and materially reduce local transport/schema tokens by a robust relative
  bound rather than relying on random UUID tokenization. These are local pinned
  tokenizer measurements, not provider counts or a benchmark score. The
  adapter retains the original core 6,000-token and original adapter 6,000-token
  preflight checks on caller input as before, while sending the smaller encoded
  snapshot to the provider.

- **CWA6 — Honest documentation and limits.** Document the classification-only
  wire transformation, ephemeral reverse maps, unchanged provider trust/data
  boundary and unchanged caps/policy. Record that aliases do not anonymize the
  payload, do not prove the historical failure's cause or a successful future
  pilot, and do not solve arbitrary catalog growth or source-support quality.
  Update the provider guide, privacy/threat model, changelog, roadmap and
  limitations. Freeze and independently review this candidate before any paid
  evaluation.

## Red/green evidence plan

The first regression must exercise the actual adapter request seam and fail on
the uncoded production implementation by observing raw IDs and insufficient
wire/schema reduction. Adapter unit cases then cover deterministic aliases,
role separation, lossless fields, caller immutability, async mutation,
interleaved requests, schema-honoring decoded output, all parent/new-topic
forms and fail-closed output. The integration regression uses a fresh synthetic
SQLite store, literal fake key, injected fake HTTP and a temporary synthetic
ledger only; it reads no environment key, corpus, paid ledger or production
state.

Required verification includes the scoped adapter tests, OpenAI offline demo,
affected classification count diagnostic and applicable live-evidence offline
tests with isolated OpenAI/MCP dependencies on Node 22.16 and Node 24. No paid
or real-provider command is authorized.

## Offline measured checkpoint

On separate database copies of the retained public LongMemEval pilot case, the
candidate preserved the five-target/52-MOC order/count and byte-identical non-ID
JSON. The replay used fake fetch, made no provider call and did not invoke
`applyPlacement`; the original artifact remained read-only while core opened the
copies normally. With the pinned local tokenizer, the whole serialized
count-request projection decreased from 7,349 to 3,803 tokens and the strict
schema from 2,939 to 575 tokens; serialized bytes decreased from 20,093 to
14,327. The unchanged original adapter preflight was 4,284 tokens. The smaller
3,102-token encoded equivalent is not the enforced local preflight. These
measurements are local, not provider counts, and do not establish the interrupted
pilot's cause or a future score. The original and both database copies retained
the same `8546cf...` SHA-256 after the replay.

## Delivery record

| Work item | Owner/model/effort | Base | Evidence | Status |
| --- | --- | --- | --- | --- |
| Implementation and scoped verification | `classification_alias_impl`, requested/actual GPT-5.6 Sol high | `b43f7308` | uncoded regression red; adapter 200/200, targeted guarded core 2/2, installed round-trip 1/1 and offline demo green on Node 22.16 | complete |
| Primary candidate acceptance and PR189 gates | primary | `8132c552` / PR 189 | all 17 remote CI checks green; independent Standards and Spec reviews PASS (0 findings) | complete |
| Fixed five-case development pilot | primary | `8132c552` | [Final evidence report](../public-pilot-results.md), report SHA-256 `6dd0f102f6032756f0bd97be3b2c9ea212217d174e8a145d391d46e629fe3b5b`; generated/scored 5, paired common result Cairn 1/4, full-history 1/4, no-memory 0/4; one Cairn `ingestion_incomplete`; attempt, cost and ordering audit PASS | complete |
| Evidence documentation | requested Luna max scaffold; Sol high final after runtime spawning limit | `8132c552` | four-file evidence update; primary read-only source-boundary trace verified; primary verification and two independent fixed-diff reviews remain required before delivery | implementation handoff |
