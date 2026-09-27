# Qualification output-shape diagnostics (dependent candidate)

Status: implementation contract. Base `ce5342f458f45fd809d69edf2f86fc7f57f82aee`; this is a dependent diagnostics-only change, not a replay or amendment to the completed N1 result. The N1 finite report located a `qualifyCandidates` adapter `output_shape` event but did not retain a provider body or identify the malformed field. These criteria do not claim which new category would have described that historical response.

## Q1 — Closed diagnostic split

For `qualifyCandidates` only, keep a parsed JSON array/primitive root as the existing `output_shape`. A parsed record whose evidence-pool wire object or named member shape is invalid emits `qualification_wire_shape`. Invalid item-index or pool membership, range or uniqueness emits `qualification_pool_mapping`. Duplicate, noninteger or out-of-pool `evidenceSlots` emits `qualification_slot_mapping`. A successfully decoded pool whose values fail the existing inline schema emits `qualification_value_shape`. Each category is an allowlisted, fixed diagnostic reason; it contains no response value, ID, index, source, key or arbitrary error string. Other adapter stages retain their existing codes.

## Q2 — No behavior change

Every rejected output continues to raise the same `invalid_model_output` error and the core still emits its existing `adapter_output_invalid` event. The decoder's direct no-observer API retains its `invalid_pool_output` failure shape. Accepted wire outputs decode identically. No prompt, schema, decode acceptance, budget, request, retry, model, default, scorer or provider transport changes are authorized. A throwing, rejecting or absent diagnostic observer cannot change the result, count, or operation order.

## Q3 — Offline red-capable feedback loop

Before implementation, fake HTTP through the real OpenAI adapter and `callModel` must make a tight test fail on the current shared `output_shape`: valid synthetic request, two HTTP calls (count then generation), no retry, `invalid_model_output`, and the exact adapter/core finite-event pair. The matrix must distinguish JSON root, wire/member, pool, slot and decoded-value failures. It must never read operational data or call a provider. Retain the RED command/output and then verify GREEN on both Node 22.16 and 24.15.

## Q4 — Real capture boundary

With a fresh synthetic store and fake HTTP, one qualification-shape failure must return the existing failed capture response, emit the exact new adapter reason plus unchanged core reason, make no admission and no classification request, and retain no accepted memory. A valid synthetic qualification mapping must continue to capture successfully. No actual N1 case, provider body or source is replayed.

## Q5 — Privacy and interpretation

Update `docs/protocol.md` for the finite observer threat boundary and `docs/limitations.md` for the historical N1 uncertainty: a future category is an observation of local validation, not proof of provider fault, source truth, model quality or a fix. Diagnostics do not enter model prompts, scoring, hosted telemetry or operational credentials.

## Q6 — Delivery evidence

Keep the diff to the adapter/decoder, finite vocabulary, their tests, the two boundary docs,
and downstream installed-launch assertions that consume the changed diagnostic category.
The existing `{qualifications:{}}` installed fixture is a wire/member-shape failure,
so it must assert `qualification_wire_shape`, while retaining its separate
core-validation, arm-isolation and refused-generation assertions. The
public-pilot runner's current capture path does not enable candidate
qualification; its separate finite observer filter is not broadened for an
unreached path. Run applicable OpenAI, core, generic, validation, demo,
LongMemEval and qualification-wire installed offline gates, including the full
artifact suite, on both pinned Node versions with synthetic data only. Freeze
one local candidate commit against the stated base for primary acceptance and
independent Standards/Spec reviews; do not push or merge before that handoff.

## Verification record

Implementation routing: GPT-6 Sol/high; fixed dependent base
`ce5342f458f45fd809d69edf2f86fc7f57f82aee`. The Q3 test was added
before implementation. On Node 22.16, `node --test
adapters/openai/test/qualification-candidates.test.mjs` failed 1/10 on the
unchanged adapter: the new assertion expected `qualification_wire_shape` but
observed `output_shape`; the other nine tests passed. This is the retained RED
tool-transcript excerpt, not a reconstructed raw log. With the implementation,
focused adapter/decoder/core diagnostics passed 34/34 on each pinned Node.

Both Node 22.16 and 24.15 passed: generic tests 112/112, OpenAI tests
228/228, LongMemEval tests 185/185, `validate`, `demo:store`, `demo:capture`,
`demo:openai-offline`, and the ingestion, public and mixed LongMemEval demos.
The opt-in installed rationale gate passed 4/4 on each Node using fake HTTP.
Full core passed 728/728 on each Node with `node --test --test-concurrency=1
core/test/*.test.mjs`.

One earlier default-parallel Node 22 full-core run passed 727/728: the
time-sensitive D3/D4 rationale test's intended SQL delay hook was not reached
within its 600 ms setup window (`reached=0`, expected 1). The unchanged base
and candidate each passed that full test file alone (~17.5 s); the serial
whole-core gates passed. This is retained as a scheduling-sensitive failed
precondition, not described as a product fix or erased by a green rerun. No
paid call, original N1 replay, credential or operational data was used.

CI exposed a downstream assertion omitted from the first Q candidate: the
installed-launch fixture intentionally returns `{qualifications:{}}`, but two
O2/O4 assertions still expected the old shared `output_shape` reason. The
initial artifact matrix therefore passed 82/84. The exact two cases were
reproduced locally with `node --test --test-name-pattern='O2/O4 installed
adapter|O4 failed-arm diagnostics'
packaging/test/qualified-source-pair-launch.test.mjs` (0/2), then passed
(2/2) after asserting the new `qualification_wire_shape` and unchanged
`adapter_output_invalid` pair. The full `npm run test:artifact` matrix then
passed 84/84 on each pinned Node runtime. This was a downstream expectation
correction, not a runtime decoder, observer or launch behavior change.
