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

## What is protected

The supported request subset is deliberately narrow: nonstreaming Chat
Completions text/function-tool messages for the host, and the existing Cairn
adapter's Responses count/generation payloads. Wrong endpoints, models, shapes,
limits and redirect behavior fail before sending. Request retries have separate
reservations. A timeout or lost process does not refund a potentially sent call.

Payload fields were checked against the official [Chat Completions reference](https://developers.openai.com/api/reference/typescript/resources/chat/subresources/completions/methods/create)
and [Responses reference](https://developers.openai.com/api/reference/cli/resources/responses/methods/create).
The accepted subset is not a claim to support every API option or every host's
request shape. Existing application/provider defaults are unchanged.

## Limits that must remain visible

The invariant is a cap on reserved, declared upper bounds, not a guarantee about
the provider invoice. The operator must audit model identity, pricing, token
framing and output bounds before any live use. Prices in synthetic tests are
test inputs, not current vendor quotes. Unknown usage is not zero, and counted
input tokens do not by themselves establish a count endpoint's charge.

All potentially paid routes must actually use this guard. Independent host
connections, background jobs or a retrying injected transport can bypass its
accounting. Inject a one-attempt transport, disable hidden SDK retries, and
verify the pinned host's complete route before treating the experiment as
protected. The guard cannot sandbox hostile callbacks or another same-user
process that replaces its files.

Never create a new ledger to replenish an existing experiment. Historical
spending authority is not renewed by a merge, passing tests or this policy.
There are no paid runs, user profiles, production writes, release or deployment
changes in this slice. V05 remains incomplete until the remaining host/budget
gates pass. See [acceptance and verification](plans/experiment-request-guard.md).
