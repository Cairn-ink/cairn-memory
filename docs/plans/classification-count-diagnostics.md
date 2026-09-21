# Classification count-boundary diagnostic

Status: bounded offline diagnosis packet; no production change or paid rerun in this packet.

This packet is based on `a31f9d9b948f1e9d7c7371be4d7e115a7cb021a8`, the
intentional stacked public-pilot base for the interrupted run. At the time of
the diagnostic, `origin/main` was
`83a10c3b7664b1f67485a19e7d84d24dcb3041a5`. It does not reconstruct or alter
the original run artifacts.

## Question and boundary

The interrupted pilot stopped at a classification count request under the
7024-token provider-input ceiling. The retained evidence does not include that
request's count response, so its actual provider token count and historical
cause are unknown. In particular, there is no basis to claim that every stored
card was sent.

The runnable diagnostic uses the actual core `classifyPlacement` path, actual
OpenAI adapter and actual benchmark request guard. Only the provider HTTP
transport is fake. It creates a temporary synthetic store and temporary
ledger, uses a literal synthetic key, and makes no network or paid request.
It does not read credentials, the paid ledger, the failed-run database or any
original artifact.

## Acceptance evidence

- A1 — Bounded input: with 156 current stored cards and 101 stored MOCs, the
  loaded request exposes exactly five target cards and a token-packed subset of
  MOC catalog entries (72 in a representative run).
  The catalog is token-packed and incomplete; its source-card bodies and 50
  unrelated-card bodies are absent. At 0, 25 and 101 stored MOCs, with the
  target batch fixed at five, visible MOCs are respectively 0, 25 and a bounded
  subset at 101. The final count can vary with the randomly generated IDs.
- A2 — Exact synthetic mechanism: a fake count of 7024 completes classification.
  A fake count of 7025 under the benchmark guard stops before generation,
  settles the count attempt as `unknown` with null actual cost, marks the guard
  halted and prevents the next request from reaching fake HTTP. Core currently
  exposes `classification_failed`.
- A3 — Contrast and limitation: without the benchmark guard, the same actual
  adapter and fake count of 7025 reject before generation as
  `context_budget_exceeded`; a second caller attempt reaches count again because
  the ordinary adapter owns no run-wide ledger/guard state. This does not show
  that another provider accepts >7024, and does not establish that the
  historical response was 7025.
- A4 — Safety: all state lives below a fresh OS temporary directory and is
  removed by the test. The test imports no environment key and its fake
  transport is the only HTTP implementation.
- A5 — Decision value: the smallest demonstrated gap is loss of the specific
  over-limit diagnostic at the benchmark guard seam. Any fix must retain the
  7024 ceiling, stop before generation, preserve conservative unknown-cost
  accounting and retain the whole-run halt. Raising the cap or removing the
  halt is not authorized by this evidence.

## Representative component measurements

The test prints a fresh JSON diagnostic on every run. A representative Node
22.16 run at 101 stored MOCs measured:

| Component | Bytes | Local tokenizer tokens |
| --- | ---: | ---: |
| Instructions | 1,906 | 415 |
| Five target memories | 2,081 | about 665 |
| 72-item MOC catalog | 9,433 | about 3,708 |
| Request-scoped JSON schema | 3,369 | about 1,902 |
| Adapter local preflight | n/a | about 4,838 |
| Serialized provider count request | 18,823 | not asserted |

UUID token counts vary slightly because synthetic IDs are random; the packed
catalog length and its bytes can vary too. Structural assertions are stable.
The representative loaded schema contained 77
visible-ID literal occurrences (2,926 quoted bytes). Replacing those literals
with a short placeholder reduced the locally tokenized schema by about 1,500
tokens. At the smaller, exhausted 25-MOC catalog, 30 of 60 visible-ID
occurrences were repeated across output variants. These are request-component
diagnostics only: local component token counts must not be added together or
reported as an exact provider total.

The numbers are consistent with dynamic schema/identifier framing being worth
investigating if a retained provider count later shows a legitimate payload
near the ceiling. A possible transport-only experiment would use request-local
aliases while preserving core IDs and authoritative enum/correlation
validation. Do not reduce candidate coverage, omit target cards, weaken schema
validation or implement aliases without a separate design and regression
review. The fake 7025 response reproduces the guard mechanism regardless of
payload size, so it cannot prove that schema overhead caused the historical
failure.

That separate experiment is specified in
[`classification-wire-aliases.md`](classification-wire-aliases.md). Its offline
candidate reduces repeated identifiers without changing coverage or caps. It
does not retroactively turn this representative diagnosis into a provider count,
recover the historical response or prove why the interrupted pilot stopped.

## Commands

Normal CI diagnostic (expected green):

```sh
node --test evaluation/live/test/classification-count-diagnostics.test.mjs
```

Opt-in observability gate for the benchmark attempt artifact:

```sh
CAIRN_EXPECT_COUNT_OVERFLOW_DIAGNOSTIC=1 \
  node --test evaluation/live/test/classification-count-diagnostics.test.mjs
```

On the diagnostic's fixed base under Node 22.16, the normal command passed 1/1
in about four seconds. The former red command failed 1/1 with expected
`context_budget_exceeded`, actual `classification_failed`; that historical red
observation remains versioned evidence of the original visibility gap. The
environment flag now checks the trusted attempt's finite `countDiagnostic`
instead of requiring a public error translation. It does not ask the adapter or
guard to accept 7025 or continue paid work after unknown settlement.

Existing relevant evidence remains in
`docs/plans/openai-framing-budget.md`: its earlier retained live diagnostic
measured local 4146/provider 5173/schema 1147 and fixed a false *relative*
cutoff while preserving the absolute 7024 ceiling. This packet must not regress
that result or relabel it as a new benchmark score.

## Next decision

No trustworthy final benchmark score can be produced from this offline packet.
Before resuming the paid benchmark, choose and separately review the smallest
error-preservation change at the guard/adapter boundary, rerun this diagnostic
on Node 22.16 and 24, then rerun the existing guarded adapter and catalog gates.
Only an explicitly authorized continuation using the retained campaign ledger
can produce the remaining real score; synthetic classifications are not score
evidence.

## Primary verification checkpoint

Primary independently ran `npm test` (106/106), `npm run validate`, and
`npm run test:live-evidence-offline` (289 tests: 259 pass, 30 existing opt-in
skips, zero failures) on Node 22.16.0 and 24.15.0. After tightening the diagnostic
assertions, the changed test was rerun on both runtimes. No production code
changed. Primary also reproduced the existing A03 adapter-boundary test,
classification-catalog tests (5/5), and C12 capture retention tests (2/2) on
Node 22.16. Primary integration edits only strengthened input identity/packing
assertions and corrected documentation/measurement qualifiers.

The paid ledger was checked read-only: 2,721 requests, USD29.287 reserved of
USD50, USD20.713 remaining. This packet added no paid requests and changed no
historical outcome. The exact failed-case artifact location has been requested
in issue #180; no original-request reconstruction is claimed while it is absent.

| Work item | Owner/model | Base | Evidence | Status |
| --- | --- | --- | --- | --- |
| Offline reproduction and report | `count_reproduction`, requested/actual gpt-5.6-sol, high | `a31f9d9b` | red and green commands above; fake HTTP only | complete |
| Product integration trace | `product_limit_trace`, requested/actual gpt-5.6-sol, high | `a31f9d9b` | capture 16/16, MCP configuration 6/6, ingestion/comparison 17/17; read-only | complete |
| Production fix choice | primary | candidate TBD | smallest justified fix within the agreed scope; no new product decision required merely to proceed | next packet |
| Dual-runtime acceptance and independent review | primary/reviewers | frozen candidate TBD | Node 22.16/24 plus fixed-diff review | pending |
