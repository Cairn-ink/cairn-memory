# Capture admission observation

Fixed base: `7a80e088be7732e51250762d5badae9bad8064b6`.
Branch: `fix/capture-admission-observation`.

This is a bounded offline implementation packet. It authorizes no provider API
call, environment credential use, paid evaluation, production data, artifact
rewrite, merge, release or deployment.

## Acceptance contract (verbatim)

## CAO1 — Lifecycle evidence

Reuse staged/capture test infrastructure with a canonical490-UTF16 synthetic
assistant source. Demonstrate completed empty admission (0refs/0suppression),
completed suppression (0refs/1suppression), legacy fresh-source attachment to an
existing memory, qualified same-source dedup, and distinct malformed-extraction/
changed-source qualification failures. Stage state admitted does not imply a
nonempty memory set. Exact-event replay adds no model calls. No runtime policy
change is needed; preserve atomic rollback and unchanged memory/receipt/
qualification tables on conflicts. Old red private probe assumptions are
documented, not rewritten into a claimed product defect.

## CAO2 — Private counts, not new public core fields

Observe the actual runner-owned capture call/response without changing input,
returned response, exceptions, call order, request bodies, guards or scoring.
Add a separately versioned, optional bounded capture-admission subsection to
private diagnostics.json only. Record batch ordinal/status plus validated finite
admitted-reference count, suppressedCount, duplicate-event flag and bounded
classification status where available. Do not call this newly-created-memory
count: a ref can name a content-deduplicated memory. Do not call it retained
message coverage: partial extraction can omit messages even with nonzero refs.

Capture observation availability is independent of memory-model error callback
availability; legacy/custom sessions still use the runner's actual core. Unknown
or malformed response projections remain explicitly unavailable, not zero.
No silent retries, source archives, staging defaults or source-bound-v2 benchmark
switch. The public comparison/ingestion strict response contract remains intact.

## CAO3 — Bounds and privacy

At most64 records per case with explicit dropped-record counts. Only allowlisted
primitive categorical/numeric/boolean fields; no input/model/source/answer prose,
receipt/message/memory IDs, arbitrary errors, provider payloads, keys or headers.
Use per-case closure scope and close it before later cases; late/throwing
observations cannot change original behavior or cross into another case.
Snapshot primitive values once; do not invoke arbitrary coercions or repeated
stateful getters. Preserve private0600 files and write diagnostics only after
generation/accounting/timings so a write collision retains spent-work evidence.

## CAO4 — Compatibility and falsifiable regression

Before implementation, actual-session/core+runner fake-HTTP test is red because
successful-empty admission has no retained count observation. Afterward it must
distinguish empty/suppressed/ref/duplicate/failed/partial outcomes while proving
same generated requests, responses, scorer inputs, reservation counts and halt
behavior. Cover late calls, record overflow, snapshots, unavailable metadata,
hostile projection fields, diagnostics write refusal, resume of old artifacts
without this subsection, and aggregate invariance. Do not rerun the old paid
cases or change their artifacts. All fixtures synthetic, no benchmark corpus.

## CAO5 — Version and delivery boundaries

Document exact subsection version and legacy absence handling; do not bump
unrelated public run formats or alter ordinary core response fields just to add
an observation. Update threat-model/protocol, runner docs, limitations and
changelog. Source retention is prospective opt-in and qualification identity is
immutable under the existing contract; explain rather than weaken these rules.

## CAO6 — Gates

Primary Node22.16/24.15 focused and full live-offline, core (new lifecycle tests),
OpenAI, LongMemEval, generic/JSON/plugin checks, independent fixed-diff Standards
and Spec, exact-head CI and mergeability. No merge/release/deploy or paid calls.

## Ownership and routing

| Packet | Owner | Scope and evidence |
| --- | --- | --- |
| CAO1–CAO6 implementation and focused tests | Implementation worker, actual `gpt-5.6-sol`, high reasoning | Allowed files only; actual fake-HTTP RED before runner edits; focused GREEN and exact frozen diff/hashes |
| Acceptance, full dual-runtime gates, candidate commit, independent review and delivery | Primary agent | Inspect integrated diff; rerun required gates; commit/review/push/PR under the repository workflow |

One worker owns all shared files. Worker token/cost telemetry is unavailable and
will not be inferred. The primary owns any scope expansion and product decision.

## Allowed implementation boundary

Only `evaluation/live/public-pilot.mjs`,
`evaluation/live/test/public-pilot.test.mjs`,
`core/test/staged-capture-evidence.test.mjs`, `docs/public-pilot-runner.md`,
`docs/protocol.md`, `docs/limitations.md`, `CHANGELOG.md`, and this plan may
change. Core runtime policy/schema/capture output, APIs, guards, budgets, scorer,
old pilot artifacts and generated artifacts remain unchanged.

## Implementation evidence and handoff

The pre-implementation RED used the actual public-pilot runner, actual core and
fake HTTP. A successful empty extraction completed generation, but the private
diagnostics had no capture-admission observation; the assertion requiring that
subsection failed before runner code changed.

The runner now projects each actual core capture settlement into the private
`cairn-capture-admission-observation-v1` subsection. Projection is primitive-
only, capped at 64 records, snapshots untrusted getters once, validates dense
reference arrays and well-formed identifiers without retaining them, and maps
unknown or malformed shapes to unavailable. Per-case collectors preserve exact
responses and exceptions, close before later cases and ignore late settlements.
No new model, token-counter or user callback is injected. Diagnostics remain the
last fresh-case write and stay outside comparison runs, scoring, aggregates and
reports.

Focused GREEN evidence uses scripted model behavior around the actual core to
cover the canonical 490-UTF16 assistant source lifecycle (empty, suppression,
legacy fresh-source receipt attachment, qualified same-source deduplication,
changed-source conflict and malformed extraction), exact-event replay and
rollback. It proves those mechanics, not real-model extraction behavior or
semantic quality. Runner evidence covers empty,
suppressed, admitted, duplicate, failed and partial projections; hostile shapes,
stateful/throwing getters, overflow, late settlement, per-case isolation,
custom sessions, old-artifact resume and artifact-write refusal. The empty-case
compatibility control matches an unobserved direct comparison for every fake
HTTP pathname/body, generated response, score, answer request, attempt and
accounting result.

During implementation the primary required four boundary corrections before
freeze: valid mixed filed-content dedup plus fresh admission cannot require the
classification-reference count to equal admission references; dense arrays
must own every numeric index; hostile batch ordinals normalize to `null`; and
identifier validation includes Unicode well-formedness. Those corrections are
covered by focused tests. Core runtime, core capture responses, schemas,
provider requests, guards, budgets, scoring and benchmark configuration remain
unchanged. The implementation worker freezes the scoped diff without commit or
push; the primary owns dual-runtime/full gates, acceptance, commit, independent
review and delivery.
