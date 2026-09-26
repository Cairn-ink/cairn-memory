# Shared request guard — offline verified experiment transport

The [persistent budget ledger](experiment-budget.md) survives restarts, but a
ledger alone cannot stop outbound requests. This guard reserves allowance before
an explicitly injected HTTP transport is called. Host completions and Cairn's
input-count and generation calls use the same run, request cap and ceiling.
It is experimental test-spending protection, not Stripe or customer billing.

## Run the synthetic check

From a source checkout with Node 22.16 or 24:

```sh
npm ci --prefix adapters/openai
npm run test:experiment-request-guard
npm run demo:experiment-request-guard
```

The dependency installation contacts the package registry. Tests and the demo
use fake HTTP and new synthetic private ledgers. They do not contact a model.

## Programmatic contract

Import `createExperimentRequestGuard` from
`evaluation/experiment-budget/request-guard.mjs`. Its exact constructor object
is `{ledger, policy, fetchImpl}`. `ledger` is the existing ledger configuration
`{directory, runId, limitMicroUsd, requestCap}`; construct that ledger separately
only for a newly authorized experiment. Reopening never resets its counters.

The frozen handle exposes `hostFetch(url, options)`, `cairnFetch(url, options)`,
`getState()`, `close()` and the detached deeply frozen `policy` snapshot.
`getState()` returns the existing ledger snapshot, including every reservation
and terminal/unknown outcome. `close()` is idempotent but rejects while requests
are in flight. Both fetch functions share the same ledger; inject `cairnFetch`
as the existing `createOpenAIModel` adapter's `fetchImpl`. `hostFetch` must be
explicitly wired by the experiment host, not merely constructed alongside it.

Policy version 1 is exactly `{version: 1, hostCompletion, cairnCount,
cairnGeneration}`. Each channel has the following closed fields:

| Fields | Meaning |
| --- | --- |
| `endpoint`, `model` | Exact allowed URL and pinned supported model ID |
| `reservedMicroUsd` | Positive fixed reservation per attempted HTTP call |
| `maxRequestBytes`, `maxResponseBytes`, `timeoutMs` | Request, buffered response and elapsed-time bounds |
| `maxInputTokens`, `maxOutputTokens`, `inputTokenFraming` | Declared token bounds and framing allowance; count output cap is zero |
| `inputPrice`, `outputPrice` | Each exactly `{microUsdNumerator, tokenDenominator}`; integer rational microUSD per token |

Numeric fields are bounded integers, not floating-point dollar amounts.
Generation reservations must cover the declared maximum input/output priced
cost, rounding input and output up separately. Host input checking conservatively
uses serialized UTF-8 request bytes plus declared framing, not a byte/4 estimate.
Cairn uses its existing local tokenizer and 1,024-token framing allowance.
These bounds are still subject to the live audit described below.

The same policy is bound durably beside the ledger in
`experiment-request-policy.json` (mode 0600). First binding requires an unused
ledger. Reopening requires a matching binding; missing, unsafe or partial files
fail closed rather than reset. Policy binding stores model/endpoint identities
and numbers, not headers, keys or dialogue. Keep this directory controlled and
do not replace its files while handles are open. POSIX checks target Linux and
do not establish Windows ACL protection.

Version 1 pins one model per channel from the existing adapter's supported
snapshot IDs. A mixed extraction profile that changes models between methods
must not be assumed compatible with a single channel policy: an unlisted model
is rejected. The synthetic integrated demonstration uses the baseline profile.

### Explicit extraction-model extension

After separate owner authorization, `authorizeExtractionModelExtension({ledger,
policy, authorizationId})` provisions `experiment-extraction-extension.json`
(0600) alongside the existing binding. It never edits that binding, the ledger
schema, total allowance or historical reservations. Setup requires a baseline
policy, the fixed Cairn 7,024-input/1,024-output bounds, an open settled ledger,
and the same SQLite writer lock used to exclude concurrent reservation changes.
The fsynced file records the exact original policy/configuration, a bounded
authorization identifier, creation counters and deterministic candidate channels.
It contains no key or conversation. Keep the returned frozen extension token
separately as the trusted caller's expected authorization record.

`createExtendedExperimentRequestGuard({ledger, policy, extension, fetchImpl})`
requires that explicit token and verifies it against the private file and original
binding on construction and every request. The original constructor does not
implicitly opt in. Changed, missing, unsafe or mismatched authorization fails
closed; retained files are not a defense against a caller who can replace both
the expected token and all local state. This is an operator-controlled spending
guard, not a cryptographic user-authorization service.

Only `cairn_extract` count/generation may select `gpt-5.6-luna` or the existing
`gpt-5.4-mini-2026-03-17`, with reasoning `none`. Other methods and host completion
retain the original model; endpoints, request/response limits and deadlines do
not widen. Candidate reservations are the greater of the original reservation
and the model-priced upper bound, with input/output rounded up separately.
Thus the current campaign still reserves 5,000 microUSD for Luna count/generation,
while its separate local adapter guard reserves 2,985; these are not two budgets
or an invoice. GPT-5.4 mini count/generation reserve 5,268/9,876 respectively
under that original policy. All share the original atomic cumulative ledger.
Luna input accounting conservatively includes the documented cache-write premium;
see [profile pricing and limitations](openai-provider.md).

Additional fixed errors are `invalid_extension` and `extension_busy`; existing
binding/ledger errors also apply. Merely provisioning or passing offline tests
does not establish provider access, source fidelity or a product default.

### Separately authorized reconciliation capability

The optional local capture judgment port is **not** enabled by either constructor
above. After specific owner authorization, a trusted operator may call
`authorizeReconciliationExtension({ledger, policy, extension, authorizationId})`.
`extension` is the existing expected extraction-extension token, not a discovered
file. Setup verifies it under the reservation writer lock, requires an open fully
settled ledger, and exclusively writes a separate fsynced mode0600
`experiment-reconciliation-extension.json`. The new record binds the exact
original ledger, policy, extraction token and creation checkpoint; it never
rewrites their files, allowance or historical reservations. Identical setup is
idempotent; mismatched or partial state is not overwritten or repaired.

Explicitly inject the returned expected token into
`createReconciliationExperimentRequestGuard({ledger, policy, extension,
reconciliationExtension, fetchImpl})`. Both tokens, their files, original binding
and settled historical prefixes are checked at construction and before each
request. No file alone enables a method. Existing baseline/extraction-only
guards remain unchanged even when the new file exists.

The combined guard adds only `cairn_reconcile` on the original baseline model and
fixed Responses count/generation endpoints, with strict request-scoped schema,
7024 input/1024 generation-output ceilings and unchanged baseline reservations,
prices and timeouts. Alternate model selection remains extraction-only. All
methods share the original cumulative ledger; there is no second allowance,
automatic retry, fallback or default transport.

These local records contain identifiers/configuration/counters, not keys or
conversations. They protect against mismatched operator state, not a malicious
same-user process that can replace both files and expected tokens. Provisioning
is a real local mutation requiring operator authority; constructing a reviewed
primitive, passing tests or merging its PR does not supply human consent.
Before any paid run, freeze fixtures/code, state the attempt/request/reservation
cap, inspect actual remaining settled budget, and obtain the missing method grant.
Never create a ledger or new allowance to replenish an existing campaign.
See [the offline acceptance](plans/reconciliation-guard.md).

Fetch options are exactly `{method, redirect, signal, headers, body}`. Headers
allow only JSON content type and Bearer authorization. Host messages allow text
and function-tool history; media, streaming, multiple completions and unknown
options are rejected. An explicit `max_completion_tokens` is required. The
guard's successful return means the bounded transport and usage checks passed,
not that the model's answer is correct or its chosen tools are safe to execute.
The existing Cairn adapter still validates its model output separately.

Guard errors are `ExperimentRequestGuardError` with a fixed `code` and identical
message. Configuration/binding codes include `invalid_options`, `invalid_policy`,
`unsafe_policy_binding`, `policy_binding_missing`, and `policy_mismatch`.
Request/response codes include `invalid_request`, `unsupported_request`,
`request_too_large`, `input_bound_exceeded`, `request_aborted`, `request_timeout`,
`response_too_large`, `transport_failed`, `http_failed`, `invalid_response`, and
`usage_bound_exceeded`. Lifecycle errors are `guard_closed` and `guard_busy`.
Existing fixed `ExperimentBudgetError` codes can also propagate; storage failure
never grants permission to send. No error message contains a raw provider body.

Valid priced usage beyond the bound is retained before rejecting the response.
A cost overrun puts the shared ledger in its blocking state. Malformed usage,
unknown model identity, timeout or transport loss retain a conservative
reservation with unknown cost. A successful count response likewise has null
actual cost: count token totals do not establish a billable charge. Inspect
`getState()` rather than summing nulls as if they were zero.

No API key or transport is discovered. There is no default fetch and no live
command. The caller provides an existing ledger, a fixed policy and the only
transport this guard will use. It does not patch global networking or intercept
an arbitrary Python host. Pinned Hermes routing remains to be verified before a
real chat experiment; a JavaScript transport test is not that host verification.

## Separate qualification capability

`authorizeQualificationExtension({ledger,policy,authorizationId})` explicitly
provisions `experiment-qualification-extension.json` against an already bound
baseline policy and an open, settled ledger. It records the exact ledger/policy,
fixed `cairn_qualify` method and DEFAULT_MODEL, plus the settled creation
checkpoint. This independent capability requires neither extraction nor
reconciliation authorization and grants neither alternative models nor reconcile.

Construct `createQualificationExperimentRequestGuard({ledger,policy,
qualificationExtension,fetchImpl})` with the returned detached frozen token.
It adds qualification to the existing baseline methods through the same guard
engine, reservation ledger and settlement path. The original baseline,
extraction-extension and reconciliation-extension constructors still reject
qualification, even when the new file exists. Static adapter paid allowlists
are unchanged. The guard's schema equality and provider/token bounds remain
unchanged; valid source anchors do not prove model interpretation is correct.

Provisioning takes the existing SQLite writer lock, uses the shared exclusive
0600/fsynced binding writer and never initializes or replenishes a ledger.
Repeated identical authorization returns the same token; changed, partial or
unsafe bindings fail without overwrite or repair. Token, file, policy and
settled prefix are checked at construction and on every request, including
after caller-owned request accessors and before reservation. This protects
against accidental state mismatch, not a malicious same-user process replacing
both expected tokens and their files.

The separate `createQualificationLiveSession` uses this capability and the
existing baseline experiment policy. It permits only baseline extract, qualify
and classify Responses count/generation routes, with a mandatory injected
transport and key. The cumulative ledger may be at most US$50; no new allowance
is created. The real key stays with this parent session while the experiment
launcher receives only an authenticated loopback capability. The launcher can
pass `--capture-qualification source-bound-v1` to the installed MCP server.

Neither constructing this primitive nor passing offline tests authorizes a paid
run. The later pilot operator must separately enforce its US$1/100-HTTP delta,
freeze new synthetic cases/artifact/operator hashes, inspect remaining settled
budget, acquire an exclusive one-shot intent and retain failures without retries
or refunds. This preparation accesses no real key, ledger or model service.
See [acceptance](plans/qualification-experiment-guard.md).

## Separate candidate qualification capability

`authorizeCandidateQualificationExtension({ledger,policy,authorizationId})`
creates an independently bound, baseline-only grant for `cairn_qualifyCandidates`.
It uses `experiment-candidate-qualification-extension.json`, not the v1 file.
`createCandidateQualificationExperimentRequestGuard` requires the returned
`candidateQualificationExtension` explicitly. Old factories do not infer it
from a file's presence, and neither qualifier grant substitutes for the other.
The same settled ledger, immutable policy and reservation accounting apply.

`createCandidateQualificationLiveSession({ledger,apiKey,fetchImpl,
candidateQualificationExtension})` restricts that grant further to extract,
qualifyCandidates and classify count/generation routes. Credentials and the
one-attempt provider transport remain parent-only; construction discovers none.
It does not authorize host completion, reconciliation or a larger total budget.

The closed candidate pilot uses six newly authored cases and a 36-HTTP/US$0.18
additional reservation limit within the existing phase. It preserves an
exclusive ledger-scoped intent, all failed/not-run cases, bounded private
synthetic traces and diagnostic events. Cold inspection and replay are request
free. Full gates and independent review precede execution; passing structural
capture is not semantic/currentness accuracy. See
[the frozen acceptance](plans/candidate-qualification-pilot.md).

The separate source-support experiment reuses that exact existing candidate
capability, but a new closed session additionally permits baseline select/rank.
The old capture-only sessions and their caps are unchanged. A new fixed attempt
limits all eight cases to 96 HTTP/US$0.48 reservation, and its installed operator
enforces six requests per capture/recall phase. It never provisions a new grant,
resets the ledger or repeats old failures. See the
[fresh source-support contract](plans/fresh-source-support-pilot.md).

## What is protected

### Separate rationale pipeline capability

`authorizeRationaleExtension({ledger,policy,authorizationId})` exclusively binds
`experiment-rationale-extension.json` to the existing settled baseline ledger.
The returned `rationaleExtension` is required by
`createRationaleExperimentRequestGuard({ledger,policy,rationaleExtension,fetchImpl})`.
Its `method: 'cairn_relate'` identifies a closed pipeline grant: baseline extract,
qualifyCandidates, classify, relate, select and rank. It grants no alternate
model, legacy qualify or reconcile. None of the five older guards gains relate
from the file's presence, and their tokens cannot substitute for the new one.
The shared immutable-binding, checkpoint, accounting and response limits apply.
The underlying guard retains its existing baseline host channel; the narrower
parent session below does not expose it or authorize host calls for this pilot.

`createRationaleLiveSession({ledger,apiKey,fetchImpl,rationaleExtension})` permits
only those six methods on Responses generation/input-count paths. Keys and
transport are explicitly supplied by the parent; no environment discovery.
`createRationaleAttempt` adds a closed 384-request/US$1.92 reservation ceiling
inside the existing US$50 cumulative campaign. It serializes calls, verifies
pins/checkpoints around persistence and transport, and permanently halts on
failure or accounting drift. It does not itself create an exclusive persistent
run intent: the installed runner must do that before live calls. A caller cannot
configure additional methods or a larger cap. Unknown costs are not refunded.

This preparation does not provision a real capability or run an experiment.
The following installed runner must freeze cases, rubric and hashes, refuse a
previous intent, retain failed/not-run cases, and pass independent review before
execution. See [acceptance and sequence](plans/rationale-experiment.md).

The supported request subset is deliberately narrow: nonstreaming Chat
Completions text/function-tool messages for the host, and the existing Cairn
adapter's Responses count/generation payloads. Wrong endpoints, models, shapes,
limits and redirect behavior fail before sending. Request retries have separate
reservations. A timeout or lost process does not refund a potentially sent call.

Payload fields were checked against the official [Chat Completions reference](https://developers.openai.com/api/reference/typescript/resources/chat/subresources/completions/methods/create)
and [Responses reference](https://developers.openai.com/api/reference/cli/resources/responses/methods/create).
The accepted subset is not a claim to support every API option or every host's
request shape. Existing application/provider defaults are unchanged.

## Benchmark answer and judge stages

`authorizeBenchmarkExtension({ledger, policy, authorizationId, stages})`
provisions `experiment-benchmark-extension.json` (mode 0600) beside the bound
baseline policy, under the reservation writer lock, only while the ledger is
open and every attempt is settled. `stages` has exactly `answer` and `judge`;
each carries the same closed channel fields as a policy channel with the
endpoint fixed to Chat Completions, a closed model allowlist (`answer`:
`gpt-4.1-mini-2025-04-14`; `judge`: `gpt-4o-2024-08-06`), rational integer
prices and a reservation at least equal to the priced upper bound. Identical
re-authorization returns the same record; any other input fails
`policy_mismatch` or `invalid_extension`. It never resets, refills or
replaces the ledger.

The ledger's attempt channels are fixed by its checked schema, so answer and
judge requests are reserved and settled under `host-completion`, exactly like
a host chat completion, while the stage identity lives in this extension and
in the guard's own record. `createBenchmarkExperimentRequestGuard({ledger,
policy, benchmarkExtension, fetchImpl})` returns `{cairnFetch, answerFetch,
judgeFetch, hostFetch, getState, attempts, isHalted, close, policy, stages}`.
`hostFetch` always fails `unsupported_request`; `cairnFetch` accepts only the
baseline extract/classify/select/rank payloads on the baseline model. Older
guard constructors reject a benchmark token and never gain the stages.

A stage body must contain exactly `model, messages, n, temperature,
max_tokens, store, stream` with the stage model, `n: 1`, `temperature: 0`,
`store: false`, `stream: false`, an integer `max_tokens` within the stage
output cap, and 1–128 `{role, content}` string messages. The local
`o200k_base` count of the messages plus the stage framing must fit the stage
input bound. The guard never rewrites, adds, removes or translates a field
and never substitutes a model: the upstream LongMemEval judge kwargs
(`n: 1, temperature: 0, max_tokens: 10`) pass through unchanged, and the
caller adds `store: false`/`stream: false` explicitly as a documented
deviation from the upstream script. Every accepted request reserves the stage
amount before the injected transport runs; exhausted money or requests,
an overrun ledger or a lock failure sends nothing, and nothing is refunded.

Settlement follows the baseline rules: non-2xx → `failed`; transport failure,
stage timeout, external abort after reservation, oversized or malformed
response, or missing/invalid usage → `unknown` with null cost; valid usage →
`succeeded` with integer-priced cost at the stage rates. Two priced cases are
distinct: usage beyond the declared token bounds but within the reservation
fails `usage_bound_exceeded` while the ledger stays open and the guard does
not halt; cost above the reservation also fails `usage_bound_exceeded`, but
the ledger overrun persists and the guard halts. The unsettled-attempt check
runs at construction and again before every reservation: any ledger attempt
with a null outcome that is not currently in flight on this guard, including
this guard's own attempt whose settlement could not be persisted, halts new
paid work. The check and the reservation are two SQLite transactions, so a
foreign reservation landing between them is caught before the next
reservation rather than this one; that is acceptable for the documented
single-operator exclusive-intent use and must be revisited before any
multi-process use. After any `unknown` outcome, overrun or failed settlement,
`isHalted()` reports the cached halt flag and every further `answerFetch`,
`judgeFetch` or `cairnFetch` fails `paid_work_halted` before reserving.
Additional fixed error: `paid_work_halted`. A count call's provider billing
is unknown and remains reserved at the full channel amount with null actual
cost.

`attempts()` returns this guard's attempts in reservation order as
`{attemptId, stage, ledgerChannel, model, endpoint, reservedMicroUsd, rates,
outcome, actualMicroUsd, usage, startedAt, settledAt, elapsedMs}`, where
`stage` is `answer`, `judge`, `cairn-count` or `cairn-generation` and `rates`
copies the stage or channel `inputPrice`/`outputPrice`; it never contains
bodies, headers, keys or provider text. Rate assumptions are the stage prices
recorded in the extension file, not a provider invoice. If the settlement
write fails, the record keeps the parsed `usage` for manual settlement while
`outcome`, `actualMicroUsd`, `settledAt` and `elapsedMs` remain null and this
guard never re-settles the attempt; `outcome`/`settledAt`, never `usage`,
indicate settlement (a succeeded `cairn-count` also has null `usage`). This
record is process-local: the ledger persists only channel, reservation,
outcome and cost. Durable per-case stage records, checkpoint state and
no-replay-on-resume are the runner's responsibility, per the issue #180
handoff's P2 bullets ("persist … checkpoint state" and "checkpoint/no retry"),
delivered with P2 together with its plan. Constructing this guard or passing
its tests authorizes no paid run, and
`evaluation/experiment-budget/test/benchmark-guard.test.mjs` uses synthetic
ledgers with fake HTTP only. See [acceptance](plans/live-pilot-transport.md).

When an HTTP-2xx `cairn-count` response reaches bounded body parsing, its record
additionally has `countDiagnostic`. A structurally valid exact count object
records `{reason, observedInputTokens,
configuredInputLimit}`, where `reason` is `within_limit` or
`input_limit_exceeded`. Invalid JSON, duplicate top-level keys, the wrong or an
extra field, a wrong discriminator, or a non-integer/negative count records only
`{reason: "invalid_count_response", configuredInputLimit}`. No candidate value
from an invalid response is retained. The over-limit outcome remains `unknown`,
actual cost remains null and the guard remains halted; this observation neither
raises the limit nor changes the ledger schema. A validated count is assigned
before settlement so it remains available in the process-local record if the
ledger write fails. Returned attempt snapshots are detached and deeply frozen.

This count is potentially sensitive request-size metadata. It stays within the
already-private benchmark attempt record and the public pilot's mode-0600
per-case accounting artifact; it is not added to aggregate reports, telemetry,
the public adapter or the core result. The finite diagnostic never stores raw
response bytes, bodies, headers, credentials, status text or provider error
strings. See the full [decision and threat model](plans/guard-count-reason.md).
Transport failures, non-2xx responses and bodies rejected before JSON parsing
retain their existing outcome and do not fabricate a count diagnostic.

### Prospective case-deadline capability

`authorizeCaseDeadlineCapability({ledger, policy, benchmarkExtension,
authorizationId, executionId, checkpoint, schedule})` separately provisions
the explicit `case-deadline-v1` policy. It accepts only an open, fully settled
existing ledger and an exact current checkpoint. Its private mode-0600 binding
pins the original limits, policy, benchmark grant, ordered generation-then-
scoring schedule and a SHA-256 digest of every historical attempt's five
accounting fields. A terminal historical `unknown` remains fully charged and is
allowed in that pinned prefix; an unsettled attempt or overrun is refused.

`createCaseDeadlineExperimentRequestGuard` requires that returned detached
token and exclusively creates a durable execution-specific claim before it
returns. The claim is one-shot even when construction crashes or sends no
request. Identical authorization is idempotent only before consumption; no API
deletes, repairs, resets or reissues a claim. The frozen guard identity is
available as `caseDeadlineCapability` for runner artifact binding.

`withCaseScope({phase, caseId}, operation)` must follow the frozen schedule.
Generation scopes permit only Cairn and answer routes; scoring scopes permit
only judge. At most one scope and one paid request are active. Async-local
identity plus an explicit closed flag prevents a delayed callback from borrowing
a later scope. The operation includes the runner's own durable artifact and
checkpoint writes; only its normal completion, settled owned attempts and exact
ledger reconciliation advance the schedule. An uncaught operation error or
accounting/binding drift is a sticky global halt. `isHalted()` reports only that
global halt.

Only the guard's elapsed transport timer or the exact signal branded by core's
actual 30-second model timer seals a case. The first guard-observed termination
cause wins. Arbitrary abort reasons, error codes, diagnostics and later timer
events cannot forge or relabel a deadline. A sealed case retains its full
`unknown` reservation and cannot send again; its scheduled scoring callback may
still write a blocked artifact without provider access. `caseTimeouts()` and
`caseScopeSnapshot()` expose only fixed versions, opaque case IDs, phase/status
and termination enums. Opt-mode `attempts()` additionally records only case ID,
phase and the bounded termination enum. It never records raw errors or content.

This is live-process isolation, not provider cancellation proof. A transport
promise may complete physically after cancellation, but it cannot resettle the
attempt, reopen the case, change attribution or admit through the already
settled core operation. All rows must continue to equal the pinned prefix plus
this guard's exact owned rows. The same single-operator check/reserve race and
operator-controlled-file threat boundary as the benchmark guard remain: this
does not protect against a malicious same-user process replacing both expected
tokens and files. See the [frozen acceptance](plans/case-timeout-isolation.md).

The additional fixed codes are `invalid_capability`, `capability_busy`,
`capability_consumed`, `case_schedule_mismatch`, `case_scope_busy`,
`case_scope_required`, `case_scope_violation`, `case_timeout_halted` and
`case_deadline_exceeded`. Existing `guard_busy` and `paid_work_halted` retain
their fixed content-free form.

An optional `transportDiagnostics: 'bounded-v1'` is accepted only by
`createCaseDeadlineExperimentRequestGuard` (and its trusted live session).
Invalid or explicitly null values fail before the one-shot claim. Omission
adds no getter or observations. The enabled guard's read-only
`transportDiagnostics()` returns the current/latest schedule scope, with at
most the last 256 attempt rows and explicit total/dropped counts. Rows contain
only schedule/attempt ordinals, phase, closed route and validated method enums,
monotonic elapsed `fetchEnteredMs`, `responseAvailableMs`, `bodyCompleteMs`,
`settledMs` milestones (null if unreached), termination and accounting outcome.
`responseAvailableMs` means a valid `Response` reached the guard, not that a
provider completed work at that instant. `settledMs` marks the accounting
settlement attempt; `accountingOutcome: null` means settlement did not confirm
an outcome. An unavailable observation returns null rather than stale scope
data. No caller callback, raw request or provider text enters the collector.
This changes no deadline, retry, reservation or halt rule. See the
[bounded diagnostic plan](plans/transport-phase-diagnostics.md).

## Limits that must remain visible

The invariant is a cap on reserved, declared upper bounds, not a guarantee about
the provider invoice. The operator must audit model identity, pricing, token
framing and output bounds before any live use. Prices in synthetic tests are
test inputs, not current vendor quotes. Unknown usage is not zero, and counted
input tokens do not by themselves establish a count endpoint's charge.

### Benchmark request allowance

`authorizeBenchmarkRequestAllowance({oldLedger, policy, benchmarkExtension,
authorizationId, newRequestCap, expectedCheckpoint})` is a separate operator
transition for an existing benchmark grant. It accepts a strictly higher finite
request cap while keeping the ledger directory, run ID and micro-USD limit
identical. The original policy and benchmark files are not replaced. The new
`benchmark-request-allowance-v1` record embeds both ledger configurations, the
exact original benchmark grant and unchanged stage policy, the exact settled
checkpoint, and a SHA-256 digest of the ordered five-field historical attempt
prefix. Terminal unknown outcomes remain charged; unsettled or overrun history
is refused.

The derived file is private, create-only and singleton-scoped to the validated
original benchmark authorization. Under the ledger writer lock it is fsynced,
including the directory, before a conditional SQLite transaction changes only
`run_config.request_cap`. A complete durable record with the unchanged old cap
may finish that same interrupted metadata transition; a partial, unsafe or
mismatched record is retained and rejected. A committed identical transition is
idempotent. Equality, reduction, chaining, altered history or a different
authorization fails closed. This recovery is not a provider retry, refund or
case resume.

`loadBenchmarkRequestAllowance({ledger, policy, benchmarkAuthorizationId,
authorizationId, stages})` is read-only. It resolves exactly the deterministic
file for the named original benchmark authorization, verifies both grants and
the historical prefix, and returns the frozen derived token. Passing that token
to the benchmark or case-deadline guard grants only the original answer/judge
stages and their original models, rates, bounds and halt rules. Older handles
retain their old ledger configuration and fail before transport after the cap
transition. Old case capabilities remain cap-bound and consumed claims never
revive; a new case execution requires a fresh one-shot capability.

### Benchmark monetary-budget extension

`authorizeBenchmarkBudgetExtension({oldLedger, policy, requestAllowance,
authorizationId, newLimitMicroUsd, newRequestCap, expectedCheckpoint})` is a
second, narrow operator transition. It accepts explicit strictly higher positive
safe-integer monetary and request ceilings. This campaign's operator invocation
is separately pinned to the approved cumulative US$50 to US$100 change
(`50_000_000` to `100_000_000` micro-USD). The supplied
`benchmark-request-allowance-v1` record must be the exact current grant. Run ID,
directory, policy, stages, models, rates, deadlines and all accounting rows are
unchanged.

The operator path uses the same writer exclusion and create-only 0600/fsync
discipline as the request allowance. It verifies the settled exact checkpoint
and ordered-history digest before conditionally changing only
`run_config.limit_micro_usd` and `run_config.request_cap`. Exact durable metadata
can finish one interrupted transition; partial, different, chained, unsettled,
overrun or tampered state fails closed. Recovery is not case or provider retry.

`loadBenchmarkBudgetExtension({ledger, policy, benchmarkAuthorizationId,
requestAllowanceAuthorizationId, authorizationId, stages})` is read-only and
resolves only the deterministic file named by explicit validated identity. The
public-pilot CLI exposes the corresponding explicit loader flag but never calls
the operator transition. Old v1 handles and capabilities retain their old
ledger configuration and fail before transport. The operator must separately
freeze a disjoint roster before issuing any fresh one-shot case capability; the
budget grant is intentionally not a cross-execution case registry.

### Chained benchmark budget prerequisite (offline only)

`authorizeChainedBenchmarkBudgetExtension({oldLedger, policy,
parentBudgetExtension, authorizationId, newLimitMicroUsd, newRequestCap,
expectedCheckpoint})` accepts exactly one complete, file-bound
`benchmark-budget-extension-v1` parent at the historical 100,000,000-micro-USD
configuration and targets exactly 200,000,000 micro-USD with an explicit
strictly higher finite request cap. It is a separate immutable
`benchmark-budget-chain-v1` record, not a second invocation of the old
single-transition API. Its private create-only filename is keyed by the
validated parent authorization ID. Directory, run ID, policy, method and
answer/judge stages remain fixed; all attempt rows, unknown reservations,
actual-cost nulls and original authorization files remain intact.

The ledger-owned existing-only writer transaction verifies the settled
ordered checkpoint, syncs the complete 0600 record and directory before the
conditional two-cap update, and checks state and path identity again before
commit. A complete matching record can recover a rolled-back transition and
exact replay is idempotent. Partial, conflicting, unsafe, edited-prefix,
pending or overrun state fails closed without repair or refund. The separate
`loadChainedBenchmarkBudgetExtension({ledger, policy,
parentBudgetAuthorizationId, authorizationId, stages})` is read-only and
requires the entire bound parent chain, exact target configuration, unchanged
historical prefix and settled current rows. Later settled attempts remain
visible without changing the bound prefix.

This chain token is deliberately **not** accepted by the older benchmark or
case-deadline factories. Prior-configuration handles and capabilities remain
fenced. A generic baseline guard explicitly given the new configuration can
still use its unchanged original routes; it receives no benchmark, indexed
extraction or candidate-qualification grant from this metadata. No live
transport, new roster, provider price or retry policy is selected here.

### Qualified source-pair guarded transport (offline only)

`authorizeQualifiedSourcePairCapability` accepts an exact, independently
prepared 1–250-question roster, either the complete bound v1 budget grant at
US$100 or the complete chained grant at US$200, and an exact fully settled
ledger checkpoint. Each entry holds only the opaque question ID, expected
protocol digest, two-arm order and canonical derived scope IDs. It validates
and derives the generation-then-scoring schedule, binds the whole historical
prefix, and durably provisions a create-only private capability file under
the ledger writer lock. Replaying identical authorization does not consume a
claim. The launcher must separately verify the full expected N protocol;
the guard cannot reconstruct a protocol from its digest.

`createQualifiedSourcePairExperimentRequestGuard` validates that file and
parent chain, then creates and syncs one irrevocable claim while holding the
same existing-only ledger connection. Partial claims remain consumed, and two
constructors cannot both own the execution. The returned guard exposes the
existing case-scope snapshot contract and `qualifiedSourcePairCapability`,
not the old `caseDeadlineCapability`. A single instance follows every
generation scope in roster/arm order before every scoring scope. Its bound
ledger witness is checked inside reservation, including after request
snapshot callbacks, so an intervening foreign row cannot be silently charged
to this execution.

Only the active arm may send its source-policy extraction and the common
classify/select/rank/candidate-qualification Cairn wire shapes. Qualified
prefix extraction has no indexed input mode; indexed extraction requires
`indexed-windows-v1`; qualification has no input mode. Answer is restricted
to generation, judge to scoring, and hostFetch remains unsupported. The
existing model, schema, local-token, framed-input and output limits still
apply; model/protocol semantics are not attested by body shape. Recognized
core/transport deadlines isolate one scope; external abort, HTTP failure,
invalid response and accounting anomalies halt subsequent sends. There is no
hidden retry or per-arm ledger reset. This synthetic transport interface is
not an installed launcher, a fresh roster, a paid grant or proof of answer
quality; old factories and their denials are unchanged.

The separate installed-launch packet adds
`inspectQualifiedSourcePairParent({ledger, policy, benchmarkExtension})` for
read-only preflight. It reuses the same private US$100/US$200 parent validation
and ledger snapshot, requires an open fully settled ledger, and returns a
frozen state without creating a capability, claim, file, cap or writable
handle. See [installed qualified source-pair launch](qualified-source-pair-launch.md)
for the later one-shot CLI and its independent phase quota.

For that launcher only, `loadQualifiedSourcePairInstalledCoreDeadline({packageRoot})`
checks a fixed five-file installed core deadline dependency set against the
trusted checkout and returns an opaque local token. Only the pair guard factory
may receive it as optional `installedCoreDeadline`, validated before claim.
The source-checkout deadline recognizer remains active. Arbitrary callbacks,
cloned tokens, foreign-module signals and external aborts do not receive local
deadline treatment; older guard constructors are unchanged.

All potentially paid routes must actually use this guard. Independent host
connections, background jobs or a retrying injected transport can bypass its
accounting. Inject a one-attempt transport, disable hidden SDK retries, and
verify the pinned host's complete route before treating the experiment as
protected. The guard cannot sandbox hostile callbacks or another same-user
process that replaces its files.

The allowlist is evaluated on the parsed JSON while the raw text is forwarded
verbatim, so a body with duplicate JSON keys is validated on the last
occurrence and sent with both; this is identical to the baseline guard and
the accepted set is unchanged. The guard assumes the provider keeps the last
occurrence, as common JSON parsers do; this is not verified against the live
endpoint.

The separate `cairn-mem0-source-pair-v1` offline guard opens only an existing
bound-v2 ledger after a complete 200M parent and rowid-aware checkpoint match.
Its exact manifest binds protocol digests, declared Cairn/Mem0 artifact/config
identities and the full controlled Mem0 wire profile. One private durable claim
owns an ordered Cairn/Mem0 generation-then-scoring schedule. Six explicit
routes share four ledger channels; every physical fake-HTTP request is validated,
checked against finite phase and arm-case caps, reserved and settled without a
refund. Mem0 body forwarding uses the wire validator's canonical JSON, unlike
the legacy raw-body behavior above. A definite embedding batch 5xx can be
returned in sanitized form for individually reserved fallback; known-priced
invalid payload and trusted deadlines seal one case, while ambiguous transport,
unknown usage and ledger faults halt globally. Case snapshots contain only
bounded ordinals and closed statuses, not case IDs or source text. This guard
keeps a bounded `observedActualMicroUsd` and observed token counts in its
process-local attempt snapshot once a Mem0 response has been priced. If B4
settlement fails, those observations remain visible for diagnosis while
`outcome` and `actualMicroUsd` stay null because no durable settlement was
confirmed; the full reservation remains pending and paid work halts.
This observation is never substituted into the ledger or used to advance the
historical binding. The guard does not run or contain a native child, hold keys,
verify the declared artifact
hashes against an installation, grant a paid launch or measure quality. See
[its acceptance contract](plans/mixed-source-pair-guard.md).

The separate [contained native gateway](plans/mem0-native-gateway.md) now
inspects a pinned local Mem0/Python installation, rehashes before/after one
case, and runs actual Mem0 add/get/search in a fresh bwrap child behind a
private AF_UNIX listener. Only the current mixed generation/Mem0 scope can
dispatch its chat and embedding wire through this listener; X remains the
authoritative route and accounting guard. Its narrowly trusted `handle.halt()`
irreversibly closes paid work after a global native/cleanup fault even if a
local case was already sealed. A successful gateway return requires the child
and its owned process group to be gone, guarded attempts settled, and the
temporary listener closed. Tests use local fake provider responses only. This
does not own credentials, use an operator ledger, run a common scorer, or
grant a paid campaign; same-UID hostile host mutation and OS compromise are
outside its trusted-host boundary.

Never create a new ledger to replenish an existing experiment. Historical
spending authority is not renewed by a merge, passing tests or this policy.
There are no paid runs, user profiles, production writes, release or deployment
changes in this slice. V05 remains incomplete until the remaining host/budget
gates pass. See [acceptance and verification](plans/experiment-request-guard.md).
