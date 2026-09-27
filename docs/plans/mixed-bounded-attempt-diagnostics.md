# Bounded attempt diagnostics for mixed evaluation reports

Primary DRI2026-09-27. Baseecfe68c66622a35d726f6b868c9b523c940951b8,
branchfix/mixed-bounded-attempt-diagnostics. Worker owns mixed-generation.mjs,
focused tests under evaluation/longmemeval/test and this plan. No other runtime,
model/source/prompt/scorer policy changes; no operational ledger/corpus/key/HTTP.
Primary integrates into the evaluation resource correction only after gates.
Scoped local commit, no push; same combined candidate needs dual independent
review. G6Sol/high selected for evaluation/persistence behavior.

## Problem and scope

runMixedGeneration currently appends every per-arm physical attempt to
diagnostics.attempts.stages, then snapshots the complete report at return.
reportSnapshot's500000nodes/32MiB bounds fail by50000 attempts (each stageobject
costs10nodes). The fixed30 conditional ceiling is394629generation requests,
so successful paid work could be lost before scoring. Existing ledger and guard
already retain the full attempttrail; duplicating it unboundedly in the report
is unnecessary. Do not widen the global report envelope or introduce replay.

## Acceptance

D1. Keep per-arm total requests, reservedMicroUsd, knownActualMicroUsd and
unknownActualCount over ALL attempts. Retain at most the FIRST64 chronological
detail entries in existing stages shape, and add explicit retainedStageCount
and omittedStageCount (or equivalently named documented fields). Never imply
the sample is complete. For<=64 requests preserve every detail as before.
Full ledger/guard attempt trail remains authoritative; no data deletion there.

D2. Extract a small pure named aggregation helper if needed for real testability,
used by actual generation, not a test-only copy. Scope order/filtering by ordinal
must stay unchanged. No answer/retrieval/scoring/timeout/guard semantics change.
No change to reportSnapshot500k/32MiB limits or public denominator.

D3. Synthetic394629 attempts distributed over60arms produce all-correct numeric
aggregate totals and at most64 detailed records perarm, explicit omittedcounts.
Build the actual report shape and verify public reportSnapshot + real scorer
report validation accepts it, without bypassing validators or providers.
Test0,1,64,65 and mixed failed/unknown/succeeded/unknownpriced cases, exactfirst64
ordering and allattempt totals. Include sentinel lateattempt proving it changes
aggregate totals despite notappearing in sample. No large operational data.

D4. Trace all consumers/tests for diagnostics.attempts.stages and record any
compatibility consequences. Document bounded sample in thisplan; primary owns
combined limitations edit. Contributor generic/validate/strict andLME suite+
ingestion/comparison/public demos onNode22.16/24.15; affectedmixednativegate if
actualrunner behavior coverage needs it. Coordinateheavy slot (capauthor owns
now): source edits+light syntax only until primary grantsheavy. Install locked
isolatedadapter dependencies when needed. Primaryrerun and independentSpec/
Standards required on finalcombined SHA, notauthor selfreview.

## Diagnostic contract and compatibility

`diagnostics.attempts.stages` is now the first 64 chronological attempts for
that arm, retaining each entry's existing `{stage,outcome,reservedMicroUsd,
actualMicroUsd}` shape. `retainedStageCount` equals `stages.length` and
`omittedStageCount` equals `requests - retainedStageCount`. `requests`,
`reservedMicroUsd`, `knownActualMicroUsd`, and `unknownActualCount` cover every
matching ordinal, including attempts omitted from `stages`. A report consumer
must use those aggregate fields for totals; the guard and ledger carry the full
attempt trail. For zero through 64 attempts the sample is complete.

Consumer trace: `runMixedGeneration` alone constructs this diagnostic object.
`scoreMixedGeneration` accepts diagnostics as a generic JSON object through
`reportSnapshot` but does not read `attempts` or `stages`; it validates arm,
scope, roster, and answer fields separately. The comparison and public demo
paths consume scored summaries rather than these stage entries. The existing
mixed native integration test checks guard attempt trails and selected arm
diagnostics, but does not assume `diagnostics.attempts.stages` is complete.
Repository search found no other direct reader of this field. Consumers that
previously inferred a full trail from `stages.length` would need to use
`requests` and `omittedStageCount`; no in-repository reader does so.

The focused synthetic test builds 394,629 records across 60 ordinals, checks
each full aggregate and exact first 64 in order, includes a late priced
sentinel absent from the sample, and passes the resulting 30-case report through
both `reportSnapshot` and `scoreMixedGeneration` validation. This is a halted
report fixture that exercises the real scorer's generation-report validation;
it does not claim a successful 394,629-request provider or judge run. A separate
test confirms that a 50,001-entry unbounded stage array fails the unchanged
report envelope. These tests use no live provider, key, operational ledger, or
external corpus.

## Scoped verification and handoff

The bounded diagnostics worker used the assigned `fix/mixed-bounded-attempt-diagnostics`
worktree from `ecfe68c66622a35d726f6b868c9b523c940951b8`. The selected
runtime was Sol/high. No correction round was needed after the primary's diff
inspection; the primary requested aggregate-total and old-envelope assertions,
which were added before tests. The worktree's locked `adapters/openai` and
`tools/plugin-validation` dependencies were installed for local checks only.

Node 22.16.0 and 24.15.0 each passed the 178-test LongMemEval suite and the
112-test generic suite. Node 22's focused mixed generation file passed 10/10,
including the 394,629-attempt fixture and unchanged-envelope rejection. Both
runtimes passed JSON validation, marketplace validation, strict plugin
validation, and the ingestion, comparison, public, and mixed synthetic demos.
The exact commands were the package scripts' Node entrypoints invoked with
`/home/chichieh/.nvm/versions/node/v22.16.0/bin/node` and the corresponding
`v24.15.0` binary. The pinned Claude validator's native CLI was invoked via
its `cli-wrapper.cjs` with each Node version; both marketplace and strict plugin
checks reported `Validation passed`. `node --check` on both edited `.mjs` files
and `git diff --check` also passed.

The primary owns the final combined-candidate rerun, the affected mixed native
gate on both runtimes, and independent Standards/Spec reviews. This scoped
worker test result does not substitute for those integration gates.
