# Classification batch cardinality

Status: implementation contract; synthetic offline verification only.

Base: `7c7e8b39212de6bb2188ebf6ca63d1a1cb4dc65a`, dependent on PR 204.
The fixed benchmark reported 15 correct, eight wrong and seven unresolved cases,
with one classification partial result. The observed malformed value `UNKNOWN`
does not establish why the provider produced it or whether item count was
involved. This change does not recover or replace that result.

## Failure signal

The optional OpenAI adapter currently sends `minItems: 1` for a two-target
classification request, although core requires one item for each target.
A fake-HTTP check against the outgoing request fails with `1 !== 2`.
An actual-core synthetic capture with invalid classifier output retains the
admitted memory as unfiled and reports nested classification failure. In
LongMemEval ingestion this becomes `partial`, and later batches remain
`not_run`; replaying the admitted event is a duplicate and does not retry.

## Acceptance

- C1: For every valid dense request with zero through five distinct target
  memory IDs, the outgoing classification schema requires exactly that many
  items. The schema uses the same detached snapshot for count and generation.
  Zero-target direct adapter requests still accept an empty response.
- C2: Duplicate target IDs and more than five targets fail before either
  HTTP request; malformed input cannot produce inconsistent schema bounds.
- C3: Existing target-ID, L1/L2, catalog-completeness and core exact-coverage
  fences remain. Even a schema-shaped duplicate-ID output is rejected by core.
  Failed filing preserves admission and receipts, leaves memory unfiled and
  never triggers automatic replay or retry.
- C4: Count and generation receive the same frozen input/schema if the caller
  mutates its object during the first asynchronous transport callback.
- C5: This changes no ingestion stop/accounting, frozen result, provider
  profile, prompt, privacy bound, budget, request ceiling or retry policy. It
  makes no claim that the historical failure was caused by item count or that
  model quality improved.

Verification: run the outbound fake-HTTP regression red before implementation;
then run focused adapter and actual-core capture regressions, the required
offline contributor gates on Node 22.16 and 24.15, and inspect the final diff.
No real provider or production request is permitted.

## Offline evidence

- Before the schema edit, the new fake-HTTP tests failed on `1 !== 2` for a
  two-target outgoing request and on a duplicate target request reaching HTTP.
  The new core C12 test passed on the base: omitted/repeated target outputs
  preserved two admitted memories as unfiled, with receipts and duplicate
  replay without model work.
- After the edit, the classification-wire tests pass 8/8 on Node 22.16. The
  full adapter suite passes 206/206 on Node 22.16 and 24.15; its
  reference-constraint fixtures now submit complete two-target outputs while
  retaining their negative ID, group and mutation assertions.
- Generic/plugin tests pass 110/110 and core tests 651/651 on each runtime.
  JSON validation, store/MOC/capture/offline-OpenAI demos, the focused
  LongMemEval I04 stop-condition test and the guarded classification-count
  diagnostic pass. All HTTP in these checks is fake and stores are synthetic.

The provider may still emit malformed or semantically poor classification.
The adapter and core continue to reject it; this candidate has no live-model
or benchmark score evidence.
