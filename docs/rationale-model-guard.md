# Relation-only model experiment transport

`evaluation/experiment-budget/request-guard.mjs` exports a separate explicit
`authorizeRationaleModelsExtension({ledger, policy, authorizationId})` action.
It binds `experiment-rationale-models-extension.json` to the existing settled
ledger and baseline policy without modifying older grants or spending history.
Keep the returned frozen token as the trusted expected record.

`createRationaleModelsExperimentRequestGuard({ledger, policy,
rationaleModelsExtension, fetchImpl})` requires that token. Only `cairn_relate`
Responses count/generation is permitted. Unlike the older rationale pipeline
grant, this guard rejects host completions and every other Cairn method.
Factories do not discover capabilities from file presence. The old rationale
factory still rejects nonbaseline relate, even if this new grant also exists.

Fixed model controls and conservative reservations per HTTP attempt:

| Model | microUSD reservation | Input/output microUSD per token |
| --- | ---: | --- |
| gpt-4.1-mini-2025-04-14 | 5,000 | 0.4 / 1.6 |
| gpt-5.6-luna | 3,000 | 0.25 / 1.2 |
| gpt-5.6-sol | 56,000 | 5 / 20 |

Count requests reserve the same maximum as generation; unavailable usage is
unknown, never zero or refunded. Luna/Sol input estimates include the cache-write
premium, so recorded usage-priced estimates are not invoices. Pricing provenance
and undated-model limitations are in [model controls](rationale-model-controls.md).
Existing byte/timeout bounds, 6,000 local and 7,024 provider input tokens, 1,024
output tokens, exact schemas/models, nonstreaming framing, cancellation and
durable pre-send accounting apply. Alternate models require reasoning `none`.

This is operator-controlled spending protection, not a sandbox against hostile
same-user code or a cryptographic authorization system. Supply a one-attempt
transport without hidden retries. Missing, modified or partial bindings fail
closed; construction does not repair them, initialize a budget or discover keys.

No live operator or paid run is included. A subsequent experiment must freeze
fresh fixtures and rubric, exact installed artifact/source hashes, model/input
arms, a smaller cumulative run cap and an exclusive durable one-shot intent.
Preserve failed/not-run arms and old experiment evidence. Passing fake HTTP
proves transport mechanics, not model access or memory quality.

## Additional fixed comparison cap

`createRationaleModelLiveSession({ledger, rationaleModelsExtension, apiKey,
fetchImpl})` in `evaluation/live/qualification-session.mjs` exposes only the
three relation-model routes above. The caller supplies the existing capability,
key and single-attempt transport explicitly; it discovers or provisions none.

`createRationaleModelAttempt` in `evaluation/live/qualification-pilot-attempt.mjs`
adds a closed 96-request / 2,048,000-microUSD cap. That covers eight cases ×
three models × two input modes × count/generation in a balanced design. It is
not permission to retry or refill a run. Excess expensive-model calls can hit
the cost ceiling before the request count. Full headroom is required upfront.

The serialized attempt persists local reservation evidence before sending,
checks source pins and settled shared-ledger deltas, and permanently halts on
transport, accounting or persistence failure. It does not replace the durable
guard or itself acquire a one-shot intent. Wire every send through the parent
session and freeze the operator, cases and artifact before actual use. These
tests are synthetic plumbing checks; the proposed comparison has not run.
