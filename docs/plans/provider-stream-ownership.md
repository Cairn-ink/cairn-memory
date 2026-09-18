# Provider stream chunk ownership

Fixed base: `3c7b9ee322a52b6af12ac169eddf1e75eea0a1f9` (origin/main).
Branch: `fix/provider-stream-ownership`; isolated sibling worktree of the same name.

This is a bounded data-integrity correction, not a memory-semantic improvement.
An earlier private diagnostic identified retained stream views in public readers;
first reproduce the suspected mutation through actual exported entrypoints.
No model call, credential, user store, release, merge or deployment is authorized
by this plan. Existing one-shot experiments and their evidence remain unchanged.

## Acceptance

PSO1. A deterministic offline regression exercises the actual OpenAI adapter with
an injected transport whose reader reuses a Uint8Array backing buffer between
reads. The adapter must parse the bytes as they were delivered, not the buffer's
later contents. Record RED before fixing, and unchanged-buffers control. Include
Buffer/subarray with nonzero offset, split multibyte UTF-8, and EOF-time mutation.
Do not claim this proves the native fetch implementation normally reuses buffers.

PSO2. After reproduction/minimization, identify and test the same pattern in the
existing public experiment request guard and live-harness bounded reader. Preserve
exact captured body evidence and guard settlement semantics. No new public export,
reader abstraction, transport option, permission, model prompt or request is added.
Copy only a validated delivered view and only after existing byte-limit checks.
Keep cancellation, timeouts, malformed-body rejection and limits unchanged.

PSO3. Negative tests retain over-limit and malformed response rejection and
reader cancellation/release behavior. Fake transports and fresh synthetic ledgers
only. Test through existing entrypoints rather than exporting a private reader for
tests. Existing stable buffers and multi-chunk responses remain compatible.

PSO4. Narrow CHANGELOG note and this verification record explain ownership cause,
limits and affected callers. No broad reliability score or semantic claim.
Generic test/validate, isolated OpenAI full tests and offline demo, request guard
tests/demo, and affected installed artifact gates run on both Node22.16/24.15 per
CONTRIBUTING. No TypeScript gate exists. Primary independently reruns key real
entrypoint cases. Freeze a scoped candidate, separate Standards and Spec review,
then push/open PR against main and verify latest-head CI; do not merge.

## Ownership

Primary owns contract, acceptance and delivery. Existing Sol/high worker
source_rank_first_impl owns bounded reproduction first, then implementation after
primary diagnosis review. Allowed production files: adapters/openai/index.mjs,
adapters/openai/live-harness.mjs, evaluation/experiment-budget/request-guard.mjs.
Allowed tests: their existing test directories; CHANGELOG.md and this record.
No other product paths, private consumed scripts, credentials or actual ledger.
Separate Sol reviewers did not implement this candidate.

## Reproduction checkpoint (test-only; no production fix yet)

The tight feedback loops use injected fake HTTP through existing exported
entrypoints. On the fixed base, both Node 22.16 and 24.15 return RED for:

- `node --test --test-name-pattern 'PSO1:' adapters/openai/test/transport.test.mjs` — 0/3: reused Uint8Array count chunks, a nonzero-offset Buffer whose split crosses a UTF-8 code point in generation, and mutation on EOF. An ordinary Response and the same synthetic reader with unchanged split views pass before the first mutation case.
- `node --test --test-name-pattern 'PSO2:' adapters/openai/test/live-harness.test.mjs` — 0/1 through `createBudgetedFetch` and an actual `createOpenAIModel().extract()` call.
- `node --test --test-name-pattern 'PSO2: exported experiment guard' evaluation/experiment-budget/test/request-guard.test.mjs` — 0/1 `invalid_response` through `createExperimentRequestGuard().hostFetch()` with a real Response instance and injected reusing reader. An earlier plain-object fixture failed at the guard's Response-type gate (`transport_failed`) and is not counted as bug evidence.

The minimal trigger is two delivered views of one backing store with a write
between reads; the first view's bytes change after delivery. Stable same-shape
split views succeed, excluding malformed reader shape and split math. A sole
delivered view rewritten when the reader reports EOF also fails. These tests
establish a possible injected-transport integrity fault, not that native fetch
normally reuses buffers. No public reader, policy, or permission was changed.

Ranked, falsifiable hypotheses before a production fix: (1) retaining borrowed
`value` views until final assembly causes corruption; owning each admitted view
before the next read should turn all five cases green. (2) the synthetic reader
violates the consumer contract independent of reuse; stable same-shape views
would fail (they do not). (3) split reconstruction or UTF-8 decoding alone is
wrong; unchanged split views would fail (they do not). (4) request/schema/token
preflight is at fault; an ordinary unchanged Response would fail (it does not).
At the reproduction checkpoint, the first hypothesis awaited a scoped fix and
the existing byte ceilings and abort/cancel/settlement paths had to remain.

## Implementation checkpoint

Primary confirmed the test-only RED evidence and authorized the minimal fix.
Each of the three existing readers now stores `new Uint8Array(value)` after
its existing byte-limit check; there is no new reader export or abstraction.
The five previously RED reused-view assertions are GREEN on Node 22.16 and
24.15. The unchanged-buffer controls use the same injected-reader interfaces;
one test at each of the three reader paths also checks cancellation and lock
release. A focused
negative subset covering adapter malformed/oversized/abort paths, live-harness
malformed/timeout paths and guard unknown-settlement/overflow/caller-cancel
paths passed 6/3/5 cases on each Node version. Full repository and installed
artifact gates remain pending; this checkpoint is not delivery acceptance.

Affected exported callers and checks: `createOpenAIModel` methods use the
adapter reader for both count and generation; `createBudgetedFetch` wraps that
transport in `runLiveLifecycle`; `createExperimentRequestGuard` and its
authorized variants use the guard's bounded reader before response parsing and
durable settlement. Core and installed consumers inherit these paths but no
core schema, prompt, or entrypoint changed. Existing tests in the three files
exercise the exact exported seams; their full suites plus offline demos and
installed artifact gates must still be run before candidate freeze.

## Author verification in progress

The following commands passed on both Node 22.16.0 and 24.15.0 using fake
transport and synthetic temporary ledgers: `npm test` (106/106),
`npm run validate`, `npm run test:openai` (194/194),
`npm run demo:openai-offline`, `npm run test:experiment-budget` (15/15),
`npm run demo:experiment-budget`, `npm run test:experiment-request-guard`
(91/91), and `npm run demo:experiment-request-guard`. An additional focused
negative matrix passed 6 adapter, 3 live-harness and 5 request-guard cases on
each version, including overflow, malformed response, abort and settlement.
The isolated maintainer tooling passed marketplace and strict-plugin validation
on both versions. It was installed with ignored lifecycle scripts; the pinned
local native-binary installer was inspected and run after the expected initial
`native binary not installed` failure. No plugin package or version changed.
The isolated MCP dependency installation and explicit public metadata-cache
preparation passed. `npm run test:artifact` then passed 66/66 on Node 22.16
(62.36 s) and 66/66 on Node 24.15 (57.00 s), with no skips. These full
installed-artifact gates were serialized after another worker's suite. The
optional `test:live-evidence-offline` processes exited, but their final
session status was lost by the command wrapper; their result is UNKNOWN and
is not counted as a gate or substituted for installed evidence.
