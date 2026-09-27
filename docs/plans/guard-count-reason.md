# Benchmark count diagnostic preservation

Status: implementation candidate on fixed base
`34aa29dd8b4ea3c7a940d5070f9b8de8063940aa`; offline fake-HTTP evidence only.

## Decision

The benchmark request guard, and only that guard, records a finite structured
diagnostic when an HTTP-2xx count response reaches bounded body parsing:

- `within_limit` and `input_limit_exceeded` include the exact validated
  `observedInputTokens` and the configured `configuredInputLimit`;
- `invalid_count_response` includes only the configured limit;
- answer and generation attempts have no count diagnostic.

The diagnostic is a trusted local observation of a structurally validated
count response. It is not reconstructed from request bytes, the local tokenizer,
the historical database or the failed pilot. The OpenAI token-counting guide
documents the response fields `object: "response.input_tokens"` and integer
`input_tokens`; this supports field provenance, not billing semantics or a claim
that the guard's strict exact-key response shape is future-proof:
<https://developers.openai.com/api/docs/guides/token-counting>.

No public adapter contract or core error is changed. In particular, the core may
still return `classification_failed`; the more specific reason lives in the
benchmark attempt artifact. The ordinary adapter still independently returns
`context_budget_exceeded` for a valid direct count above 7,024.

## Acceptance

- G1: the real core → OpenAI adapter → benchmark guard path accepts a fake exact
  count of 7,024, records `within_limit`, and proceeds. A fake exact count of
  7,025 records `input_limit_exceeded` with observed 7,025, settles `unknown`
  with null actual cost, sends no generation request and halts later paid work.
- G2: invalid JSON, duplicate top-level keys, extra fields, strings, negative
  numbers and non-integers record `invalid_count_response` without an observed
  count. They are not mislabeled as over-limit and retain no response body,
  header, status text or arbitrary value.
- G3: the ledger schema, reservations and settlement meanings are unchanged.
  Successful count cost stays null. A failed settlement keeps a validated count
  in the process-local attempt record while its outcome remains null and the
  guard halts. Returned attempt snapshots remain detached and deeply frozen.
- G4: the public pilot's private per-case `accounting.json` preserves the new
  diagnostic. It adds no key, request/response body, header or provider text.
- G5: ordinary adapter and general request-guard behavior are unchanged. The
  existing top-level `classification_failed` may remain because the trusted
  private attempt artifact now contains the bounded reason.

## Threat model

The new retained data is one provider-reported non-negative safe integer and a
configured public limit. Token count can reveal a coarse property of request
size, so it remains inside the already-private benchmark attempt/accounting
artifact; it is not added to the aggregate report, public adapter, core result,
ledger schema or telemetry.

Provider bytes are untrusted. The observed value is retained only after valid
UTF-8/JSON, an exact two-field object, the fixed object discriminator, one
non-negative safe integer, and no duplicate top-level key. All other responses
receive the finite `invalid_count_response` reason with no candidate count.
Nothing copies a raw response, field value from an invalid shape, header,
credential, status text or thrown provider string into the diagnostic.

The diagnostic grants no authority. It cannot widen the 7,024 limit, settle an
unknown cost, refund a reservation, retry a request or clear the run-wide halt.
The attempt API returns a structured clone with recursive freezing, so callers
cannot mutate the guard's retained observation. Process-local records still do
not make the ledger a response archive; the public pilot explicitly copies its
scoped attempts into mode-0600 private accounting.

## Verification

All commands use synthetic temporary stores/ledgers and injected fake HTTP:

```sh
node --test evaluation/live/test/classification-count-diagnostics.test.mjs
node --test evaluation/experiment-budget/test/benchmark-guard.test.mjs
node --test evaluation/live/test/public-pilot.test.mjs
CAIRN_EXPECT_COUNT_OVERFLOW_DIAGNOSTIC=1 \
  node --test evaluation/live/test/classification-count-diagnostics.test.mjs
npm run test:experiment-request-guard
npm run test:live-evidence-offline
```

No command above reads a provider key or authorizes a paid request. No new pilot
score is produced. The historical failed response remains absent, so its count
and cause remain unknown.

## Delivery record

| Work item | Owner/model | Base | Evidence | Status |
| --- | --- | --- | --- | --- |
| Diagnostic implementation, tests and docs | `guard_reason_impl`; requested/actual `gpt-5.6-sol`, high effort, fork none | `34aa29dd8b4ea3c7a940d5070f9b8de8063940aa` | Red 7,024 assertion before the fix; focused classification, benchmark-guard and public-pilot fake-HTTP tests after the fix | ready for primary freeze |
| Integrated dual-runtime acceptance | primary | candidate worktree before freeze | Node 22.16 and 24.15 generic, validation, budget/demo, guard/demo and live-offline gates; 290 live tests: 260 pass and 30 existing opt-in skips per runtime | passed |
| Fixed-diff Standards and Spec review | independent reviewers | frozen candidate SHA pending | Same committed base-to-candidate diff and this acceptance plan | pending |

The implementation worker had no correction round on the production path. The
primary clarified documentation scope and the boundary for transport/non-2xx
attempts; those records correctly retain no fabricated count diagnostic.
