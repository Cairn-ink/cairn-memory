# Source-context adapter: explicit transport over the shared core

## Scope and fixed base

Worktree `source-context-adapter`, branch `feat/source-context-adapter`, fixed
dependency base `7e212ec1d5a8dca9b2afbae2c9481b974475f423` (PR169). BCU passed
independent Standards/Spec review and17/17 latest-head CI jobs before this slice
started. Fetched main remains `3c7b9ee322a52b6af12ac169eddf1e75eea0a1f9`.
Deliver a dependent PR against main; no merge/release/deployment or paid run.

Primary decision: this explicit source-assessment method uses the existing
configured `basisModel` profile, not a new model/default/configuration field.
Its larger output ceiling is method-specific. Existing profile reservations and
paid method allowlists remain unchanged and must not authorize this method.
No new schema/partition/storage engine, automatic capture, MCP or hosted path.

## Acceptance

SCA1. Add `createOpenAIModel().reviewSourceContext(request)` for the exact BCU
request: `system`, source-only CU `input`, CU `responseSchema`,
`maxOutputTokens:3072`, and an AbortSignal. Use the selected existing basisModel
profile. Existing methods retain their1024 ceiling, model routing, request bytes
and response behavior. Do not add the method to the exported static `schemas`
paid-method allowlist or reuse its1024-based reservations.

SCA2. Before any HTTP or host callback, validate and detach new-method input and
schema. Accept only canonical CU prepared source-local indices/roles/passages.
Reconstruct original receipt text from ordered passages, then reuse actual
`prepareSourceContextUnits` to compare exact canonical input and schema. Do not
silently repair gaps, indices, ordering or text. Reject unknown metadata,
swapped schema, cycles, sparse/custom/accessor/non-JSON fields, oversized input
and malformed options before HTTP. Do not maintain a second schema/partitioner.
No namespace, memory/revision/receipt IDs, generated content, fake edges or
client/session/event metadata enter the provider payload.

SCA3. Snapshot count/generation payloads before asynchronous callbacks; use
identical instructions, source input and exact schema. Count the full local
request including schema within6000 tokens; require provider input_tokens<=6000
and provider input+3072 within selected contextWindow for this method only.
Generation explicitly sets max_output_tokens3072, store:false, stream:false,
truncation:disabled. Preserve the existing cancellation signal, bounded reads,
sanitized failures and no retry. Failed counts make no generation call.

SCA4. New-method responses must be completed, exact selected-model envelopes,
with valid usage arithmetic, output<=3072 and input<=6000/reserved-window bounds.
Preserve existing response-body and40000-character text bounds. Reject refusal,
incomplete/framing/JSON/usage failures. The existing generic schema checker does
not handle CU nullable union types: use actual `compileSourceContextUnits`
against reconstructed raw receipts for this method's structural validation,
then return its detached original proposal for BCU identity binding. No silent
unit dropping, quote repair, schema relaxation or claimed semantic verification.

SCA5. Public synthetic tests cover exact count/generation bodies/schema and model
routing; nullable fields; input/schema mutation; malformed input/schema with zero
HTTP; source-only wire;3072 inclusive/3073 rejection; provider input/window/usage;
count failure; cancellation and malformed/oversized response. Assert unchanged
old reviewBasis/relate request bytes and1024 failure boundaries. Exercise actual
temporary core→adapter→fake HTTP, including correction while assessment is in
flight. Actual offline installed artifact must open a synthetic store, then a
fresh child process imports the installed core/adapter and reviews current refs.
No checkout/private import substitution or provider key. Verify the existing
paid harness/guard does not authorize this new method.

SCA6. On both Node22.16.0 and24.15.0 run generic/JSON/strict plugin validation,
full core+demo:store, full OpenAI+demo:openai-offline, full artifact and opt-in
installed rationale gate. No TypeScript gate exists. Narrow provider/protocol
docs and unreleased changelog state the limits and basisModel reuse; no marketing
claim/version bump. Primary inspects actual changes, reruns integrated paths,
freezes a scoped commit, obtains separate Standards/Spec review, then verifies
latest-head CI and mergeability before acceptance.

## Ownership and boundaries

One Sol/high implementation worker owns adapters/openai/index.mjs,
adapters/openai/schemas.mjs, new adapters/openai/test/source-context.test.mjs,
new packaging/test/source-context-adapter.test.mjs, docs/openai-provider.md,
docs/bound-source-context.md, docs/protocol.md and CHANGELOG.md. Existing tests
may be read but not rewritten to weaken their gates. Report if another path is
necessary; do not alter core, profiles, paid harness/ledger, API credentials,
fixtures from private experiments, package versions, other branches or user files.
Primary owns this plan, setup, acceptance and delivery. No worker commits/pushes,
paid calls or live probes. Unknown cost/elapsed/model telemetry stays unknown.

OpenAI Docs was used for interface research before adapter planning. Official
pages fetched2026-09-17: [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
and [input token counts](https://developers.openai.com/api/reference/typescript/resources/responses/subresources/input_tokens/methods/count).
Schema conformance is not semantic correctness. Passing this slice enables later
fresh semantic evaluation; it does not complete the reliable-memory product goal.

## Supervision and verification record

Implementation: `source_rank_first_impl`, configured Sol/high for transport,
token accounting and cancellation boundaries. Primary owned the SCA contract,
isolated dependency/cache setup and actual diff inspection. No worker commits,
keys, paid calls or changes outside the eight assigned paths. Provider key
provisioning tooling was unavailable; synthetic HTTP needs no real key.

Primary interventions before freeze: keep malformed requests asynchronously
rejected like existing ports; add fixed-base old-wire byte checks rather than
only comparing two potentially changed bodies; prove schema-inclusive local
count overflow with an under-budget no-schema control; prove local3072/3073
output limits using structurally valid CU proposals and valid provider usage.
Positive fixtures distinguish considered choices from pending reconfirmation.
Primary independently reproduced all four fixed-base wire hashes and ran four
draft integration probes, including three existing profiles/two old ports against
the unchanged dependency adapter. Final-tree repetition remains required.

Author test-fixture corrections are not runtime-failure claims: changed canonical
source text is valid input, the synthetic ledger field is `reservedMicroUsd`,
and correction during token count does not promise cancellation of generation.
The final source fence still rejects stale results after the two-phase call.
The existing diagnostic allowlist does not include this method, so no diagnostic
callback evidence is claimed and core was not expanded for it.

An initial full runner was stopped after Node22 core/demo when primary identified
coverage gaps; its partial output is provisional, not final acceptance. Revised
focused adapter/installed tests passed12/12 on both runtimes. Final author gates,
primary reruns, independent committed-diff review and remote CI are recorded
separately as each completes. No model escalation or new paid experiment occurred.

Author final-content full gates passed on both Node22.16.0 and24.15.0:
generic106, JSON, strict plugin/marketplace validation, core644, store demo,
OpenAI201, OpenAI offline demo, artifact70 and installed rationale4. Eight scoped
file hashes were frozen and independently matched by primary before starting
the separate final-tree primary gate run. No edits occurred during final author
gates. Command output is retained in the author task transcript.

Primary final-content reruns independently passed on both Node22.16.0 and24.15.0:
generic106, JSON, strict plugin/marketplace validation, core644, store demo,
four independent integration probes, OpenAI201, OpenAI offline demo, artifact70
and installed rationale4. Logs are retained locally at
`/tmp/cairn-sca-primary-gates-6qXxwb/`; all commands exited0 without retries.
Exact commands per runtime: `npm test`, `npm run validate`,
`npm run validate --prefix tools/plugin-validation`, `npm run test:core`,
`npm run demo:store`, `node --test /tmp/cairn-relation-audit-design-dRTKXX/primary-source-context-adapter.test.mjs`,
`npm run test:openai`, `npm run demo:openai-offline`, `npm run test:artifact`,
and `CAIRN_RATIONALE_INSTALLED_OFFLINE=1 node --test evaluation/live/test/rationale-pilot.test.mjs`.
The private probes exercise frozen request ownership, old cap/guard isolation,
actual reopened core binding and stale-source rejection, and byte-for-byte old
port equivalence against the fixed dependency for all three existing profiles.
They supplement, rather than replace, public synthetic and installed tests.
Runtime and test files stayed frozen throughout these reruns. Independent
committed-diff reviews and remote CI remain separate delivery gates.

### Remote timing failure and bounded correction

Candidate `bab4a307c6fd9d0c028b14f09aa6702fd92cc324` passed both independent
review axes but CI35242814796 failed the existing Node22 tokenizer performance
guard: its child exceeded5000ms (5027ms), with200/201 adapter tests passing.
PR170 was returned to draft; this failure is not discarded or called a clean run.
Primary's unchanged isolated A01 test passed in1743ms. Worker reproduced the
same timeout with four exact A01 processes restricted to one CPU; isolated and
unconstrained runs passed. The new SCA3 budget fixture used repeated BPE searches
over long unbroken strings and took26800ms in that CI job. A fixed separated-token
candidate instead has5057 tokens without schema and6586 with schema, measured
independently by primary in14ms for the two counts. These assertions establish
the same schema-budget precondition without a costly search for an exact boundary
that this test does not require.

Correction acceptance: preserve both explicit <=6000/>6000 preconditions,
the actual adapter rejection and zero HTTP assertion. Do not modify runtime,
tokenizer, existing A01 test, its5000ms process guard or suite concurrency.
Record bounded diagnostic comparisons, rerun affected full adapter suites on both
versions, freeze new candidate and repeat both independent review axes and CI.
The exact CI scheduler state cannot be recreated; local contention demonstrates
the failure mechanism, not an assertion that all CI host conditions are known.

Worker correction changed only the new test fixture. Same-core paired SCA/A01
comparison: original SCA3 about18.6s and A01 4.866s; corrected complete source
test1.035s and A01 2.165s. Both pairs passed, so they establish avoided load, not
a paired red-before/green-after claim. Separate fixed-base/current measurements
were import168/145ms and whitespace counting1568/1546ms (same313 tokens); no
counting regression was measured. Commands used Node22.16 with `taskset -c 0`
for the existing source-context and tokenizer-performance test files. The
four-process same-core reproduction above independently showed the guard's
contention sensitivity. Worker full OpenAI201 and offline demo passed on both
runtimes after correction. Primary inspected the exact diff and matched test
SHA256 `c221044be113bf31f92e0bb05818055a2a415e1e12d8f699b676bbc3a0c9f983`.

Primary correction reruns passed on both runtimes without retries: generic106,
JSON, strict plugin/marketplace, full OpenAI201, offline demo, independent4 probes
and actual installed source-context child1. Commands were the corresponding
commands above, with `node --test packaging/test/source-context-adapter.test.mjs`
for the focused installed gate. Logs: `/tmp/cairn-sca-correction-gates-q9ViqP/`.
Runtime and installed-test hashes remained identical to the fully tested earlier
candidate; only the new fixture and this evidence record changed. Complete core,
artifact and rationale suites from the earlier runtime-identical candidate are
not represented as rerun locally after this test-only correction. Final CI runs
those complete suites again. Both independent axes must review the new commit.
