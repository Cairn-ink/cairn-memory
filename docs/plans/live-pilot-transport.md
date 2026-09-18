# Guarded benchmark transport (P1)

Base: `53eb6312e76937cf73f10033e6237dcfe8c506b3` (#184 head, which contains #183
and #182). Handoff: issue #180, comment of 2026-09-18T11:00:32Z, stage P1.
Scope: additive changes to `evaluation/experiment-budget/request-guard.mjs`,
a new offline test file, `package.json` test wiring, the guard guide and the
changelog. No ledger schema change, no core, adapter, MCP or legacy pilot
change, no live command, no key discovery, zero network in tests.

## Why the ledger channels stay as they are

The experiment ledger stores every attempt under one of three fixed channels
(`host-completion`, `cairn-count`, `cairn-generation`); the schema is checked
byte-for-byte on reopen, so it cannot gain stages without invalidating the
historical campaign ledger that this pilot must reuse. Answer and judge calls
are therefore reserved and settled under `host-completion`, while the new
benchmark extension binds each stage's own model, prices, bounds and
reservation, and the guard keeps a separate per-attempt stage record. The old
ledger, its history, reservations and request count are never modified,
reset or replaced.

## Acceptance BG1–BG8

- **BG1 Immutable benchmark authorization.**
  `authorizeBenchmarkExtension({ledger, policy, authorizationId, stages})`
  provisions `experiment-benchmark-extension.json` (mode 0600, canonical JSON,
  `checkpoint` = ledger `requestCount`/`reservedMicroUsd` at authorization)
  beside the existing policy binding, under the same SQLite writer lock the
  reservations use, only when the baseline policy is already bound, the ledger
  is `open` and every attempt is settled. `stages` has exactly `answer` and
  `judge`. Each stage has exactly the existing channel keys; `endpoint` must be
  `https://api.openai.com/v1/chat/completions`; closed model allowlists:
  `answer` ∈ {`gpt-4.1-mini-2025-04-14`}, `judge` ∈ {`gpt-4o-2024-08-06`};
  `maxOutputTokens ≥ 1`; `reservedMicroUsd ≥` the integer priced upper bound of
  `maxInputTokens`/`maxOutputTokens` at the stage prices. Re-authorizing with
  identical inputs returns the same frozen record; different inputs, a changed
  ledger prefix, a missing/tampered/insecure file or an unsettled ledger fail
  with the existing fixed codes (`invalid_extension`, `policy_mismatch`,
  `unsafe_policy_binding`, `extension_busy`).
- **BG2 Guard construction.**
  `createBenchmarkExperimentRequestGuard({ledger, policy, benchmarkExtension,
  fetchImpl})` reopens the ledger, verifies the baseline binding and the
  benchmark extension (bytes and checkpoint prefix) at construction and again
  before every reservation, and returns a frozen handle
  `{cairnFetch, answerFetch, judgeFetch, hostFetch, getState, attempts,
  isHalted, close, policy, stages}`. `hostFetch` always fails
  `unsupported_request`. `cairnFetch` accepts only the baseline Cairn methods
  (`cairn_extract`, `cairn_classify`, `cairn_select`, `cairn_rank`) on the
  baseline model, exactly as the baseline guard does. No other capability is
  granted, altered or inferred from a file's presence; the older guard
  constructors reject a benchmark token and never gain the stages.
- **BG3 Stage request allowlist.** `answerFetch`/`judgeFetch` accept exactly:
  POST to the stage endpoint; headers limited to `content-type:
  application/json` and a `Bearer` authorization; a JSON body with exactly the
  keys `model, messages, n, temperature, max_tokens, store, stream`; `model`
  equal to the stage model; `n === 1`; `temperature === 0`; `max_tokens` an
  integer in `1..stage.maxOutputTokens`; `store === false`; `stream === false`;
  `messages` an array of 1..128 entries, each exactly `{role, content}` with
  `role ∈ {system, user, assistant}` and string `content`. The local
  `o200k_base` count of `JSON.stringify(messages)` plus `inputTokenFraming`
  must not exceed `maxInputTokens`, and the body bytes must not exceed
  `maxRequestBytes`. Any other key, value or shape fails before reservation
  with the existing codes (`invalid_request`, `unsupported_request`,
  `request_too_large`, `input_bound_exceeded`). The guard never rewrites,
  adds or removes a field and never substitutes a model; the upstream judge
  kwargs (`n:1, temperature:0, max_tokens:10`) pass through unchanged, and
  the caller adds `store:false`/`stream:false` explicitly.
- **BG4 Reserve before every send.** Each accepted request reserves the stage's
  `reservedMicroUsd` (or the baseline Cairn channel amount) on the existing
  ledger before the injected transport is invoked, consuming the shared limit
  and request cap. Exhausted money (`budget_exceeded`), exhausted requests
  (`request_cap_exceeded`), an overrun ledger (`budget_blocked`) or a ledger
  lock failure sends nothing. There are no refunds and no retries inside the
  guard; an external retry is a new reservation.
- **BG5 Settlement and halt.** HTTP non-2xx → `failed` (null cost); transport
  error, stage timeout, oversized/malformed response, or missing/invalid usage
  → `unknown` (null cost); valid usage → `succeeded` with integer-priced actual
  cost at the stage rates; usage above bounds or above the reservation fails
  `usage_bound_exceeded` after settlement and the ledger overrun persists.
  After any `unknown` settlement or overrun observed by this guard,
  `isHalted()` is true and every further `answerFetch`, `judgeFetch` or
  `cairnFetch` fails `paid_work_halted` before reserving. At construction and
  before every reservation, a ledger attempt with a null outcome that this
  guard does not own also halts (an unsettled request from another process).
- **BG6 Accounting record.** `attempts()` returns a frozen array, in reservation
  order, of `{attemptId, stage, ledgerChannel, model, endpoint,
  reservedMicroUsd, rates, outcome, actualMicroUsd, usage, startedAt,
  settledAt, elapsedMs}` where `stage ∈ {answer, judge, cairn-count,
  cairn-generation}`, `rates` is `{inputPrice, outputPrice}` copied from the
  stage or channel, `usage` is `{inputTokens, outputTokens}` or null, and
  timestamps are epoch milliseconds. It never contains bodies, headers, keys, prompts or provider
  error text. Rate assumptions are the stage `inputPrice`/`outputPrice` as
  recorded in the extension file.
- **BG7 Offline tests** in `evaluation/experiment-budget/test/benchmark-guard.test.mjs`
  with synthetic private ledgers and fake HTTP only, passing on Node 22.16 and
  24: rejection before send (wrong model, wrong endpoint, extra key,
  `temperature` ≠ 0, missing `store`/`stream`, oversized input) with zero
  reservations; money and request-cap exhaustion send nothing; timeout →
  `unknown` and halt; malformed response and missing usage → `unknown` and
  halt; HTTP 500 → `failed` without halt; restart (reopen the same ledger,
  re-verify the extension, checkpoint prefix integrity, tampered/absent/insecure
  file rejected); reservation integrity (reservation exists before `fetchImpl`
  runs; nothing is refunded on any failure); `cairnFetch` still works through
  the actual OpenAI adapter with a fake upstream; `hostFetch` denied; the older
  guards reject the benchmark token and gain no stage; `attempts()` shape and
  redaction. Tests must not read the environment for keys.
- **BG8 Docs and gates.** `package.json` `test:experiment-request-guard` runs
  the new file; `docs/experiment-request-guard.md` gains a "Benchmark stages"
  section (channel mapping, allowlist, halt rule, the explicit `store`/`stream`
  addition, unknown count-call billing counted conservatively); `CHANGELOG.md`
  entry. `npm run test:experiment-request-guard`, `npm test` and `npm run
  validate` pass on both Node lines with `git diff --check` clean.

## Ownership and evidence

Implementation: one bounded worker (recorded in the PR with the actual
runtime model and effort). Primary: contract, diff inspection, gate reruns,
integration and independent-review coordination. Independent Standards and
Spec reviewers inspect the fixed base/candidate diff before push. This packet
authorizes no paid call and creates no ledger.
