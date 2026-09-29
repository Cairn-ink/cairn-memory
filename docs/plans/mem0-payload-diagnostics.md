# Distinguish rejected Mem0 payloads without retaining their contents

Prospective offline contract, 2026-09-29. Fixed base
`0fe007f26e89a968bec1f9a741431bbe206dfc7d` (N7 results, PR #293), isolated
branch `fix/mem0-payload-diagnostics`. The consumed N7 runtime, operator,
corpus, results and original ledger remain immutable.

## Decision

N7 failed its paired completion gate. Its first native Mem0 case ended with
priced usage and `invalid_payload`, but no causal response was retained.
Different fake responses reproduce the same failure and accounting outcome.
This does not prove a false rejection, native-engine defect or model defect.
Do not relax the validator or retry that case. Repair the narrower diagnostic
gap: future rejected responses should identify the local validator category
without storing their text. This is not a memory-quality improvement or
permission for another paid cohort. Cairn capture timeout and retained-source
coverage remain separate unresolved findings.

## Acceptance

- **D1 — Preserve validation.** Keep every existing accepted/rejected response,
  normalized forwarded body, request/profile/model/price/limit, failure code
  and failure precedence unchanged. Missing/falsy `memory` retains its existing
  behavior. Malformed envelope/usage/model exceptions retain their old behavior.
  A valid response must retain its exact result and attempt field shape.
- **D2 — Closed observation.** For a parsed/priced response whose final failure
  code is `invalid_payload`, add one finite `payloadFailureReason` value
  selected only by trusted validator branches. Distinguish outer safety,
  chat envelope/choice, content JSON/shape, memory collection shape/count,
  fact shape/text/token bound, embedding payload and normalized-size rejection
  where the existing predicates permit it. No arbitrary field name/value,
  error message, content, identifier, source hash or provider response is copied.
  Other failure codes and successful results omit the field. Document the
  exact closed vocabulary; no callback or unbounded event stream.
- **D3 — Real guard retention.** Copy the finite value to the existing private
  mixed guard attempt before settlement freezes that record. Preserve usage,
  reservation, settlement outcome, case sealing, global halt, cancellation,
  no-retry and subsequent-scope behavior. No new ledger field/schema or change
  to the original historical-row comparison. A failed settlement must still
  fail closed and must not look durably recorded. No public core/MCP/plugin/
  HTTP/hosted telemetry field or host behavior changes.
- **D4 — Red/green at the real seam.** First demonstrate that two fake HTTP
  responses (`chat_content_json`, `chat_memory_shape`) are currently rejected
  with indistinguishable attempt diagnostics, alongside a successful control.
  Test the actual wire-to-mixed-guard-to-ledger path, not just a classifier.
  After the change, distinguish the two while retaining one dispatch, identical
  accounting and rejection. Exercise the remaining categories, simultaneous
  usage/payload failure precedence, valid/falsy-memory controls, source-marker
  nonleakage, detached snapshots, local continuation and settlement failure.
  Keep all existing assertions; no invented historical root-cause claim.
- **D5 — Verification and delivery.** Use fresh owned synthetic workspaces and
  the canonical runner, no keys/corpus/operational ledger/provider calls. Run
  focused regressions, generic tests, JSON/strict plugin validation, budget
  suite/demo, request-guard suite/demo, native gateway and LongMemEval suites
  on Node 22.16.0 and 24.15.0. Run the pinned native local gateway and mixed
  native local gates on both versions for this changed gateway acceptance path.
  Primary inspects the diff and personally reruns integrated key paths.
  Independent nonauthor Standards and Spec review the same final candidate;
  exact-head CI and mergeability precede delivery. No merge/release/deployment.

## Ownership and boundaries

Primary owns this contract, scope decisions and acceptance. One GPT-6 Sol/high
worker implements runtime/tests/docs. Allowed files: `mem0-wire.mjs` and
`request-guard.mjs` under `evaluation/experiment-budget/`, their focused tests
and a new diagnostic test if needed; this plan, `docs/protocol.md`, the bounded
mixed-source section of `docs/experiment-request-guard.md`, and a narrow addition
to `docs/limitations.md`. Report any needed expansion first. No core, model,
prompt, scorer, capability/profile/ledger format, native Python, dependencies,
CLI/defaults, frozen results or existing private operator changes.

Trace the wire inspector, mixed Mem0 chat/embedding send path, attempt getter,
native gateway and mixed accounting consumers. Existing test owners remain
worker full gates and primary acceptance. No browser/UI flow is affected.
Retain the diagnostic's limitation: it identifies a local rejection category,
not which actor caused malformed output or whether the rejected interpretation
would have been semantically correct. The original N7 failure stays unresolved.

## Verification record

Before implementation, the actual mixed guard/ledger fake-HTTP scratch regression
`regression.mjs` was red on Node 22.16.0 and 24.15.0: valid chat completed with
no reason, while malformed content JSON and memory shape both failed as
`invalid_payload` with identical 3-microUSD cost and no distinguishing reason.
The candidate made that same regression green on both Node versions. These synthetic
usage fields do not reconstruct the N7 provider response.

The primary's independent bounded differential `check.mjs` compared the frozen
inspector with the candidate on 296 synthetic inputs on both Node versions:
17 accepted, 195 rejected and 84 thrown; 189 carried a closed new diagnostic.
After removing only that field, existing result, exception, body and profile
behavior matched. This is strong regression evidence, not exhaustive proof for
every possible JSON input. The primary also reran five indexed Cairn deadline
controls on each Node version; their core 30-second budget includes count and
generation and does not isolate a 30-second generation limit.

The worker traced both Mem0 chat and embedding through
`inspectMem0WireResponse` into the mixed guard's `send`, where only the final
`invalid_payload` category is attached to the mutable attempt before `settle`
freezes it. The `attempts()` getter returns a detached snapshot; the ledger
projection remains channel/reservation/outcome/cost only. The native gateway
uses those guarded routes. Mixed generation calls the native gateway and its
per-case `summarizeAttemptsForOrdinal` deliberately projects only stage,
outcome, reservation and actual cost. No consumer assumes the new field in a
successful attempt or changes an HTTP, core or host entrypoint.

All commands below ran from the isolated worktree with OpenAI and Anthropic
provider keys explicitly removed from the child environment.
`npm ci --prefix adapters/openai` installed the locked isolated tokenizer
dependency. For Node 24, the command used the pinned v24.15.0 `node` first in
`PATH`; Node 22 used v22.16.0. The strict plugin command used the existing
pinned validator binary from the `source-window-coverage` checkout in `PATH`.

| Offline command | Node 22.16.0 | Node 24.15.0 |
| --- | --- | --- |
| `npm test` | 143/143 | 143/143 |
| `npm run validate` and strict plugin validation | pass/pass | pass/pass |
| `npm run test:experiment-budget` | 65/65 | 65/65 |
| `npm run test:experiment-request-guard` | 297/297 | 297/297 |
| `npm run test:mem0-native-gateway` | 45/45 | 45/45 |
| `npm run test:longmemeval` | 200/200 | 200/200 |
| `npm run test:mem0-native-local` | 9/9 | 9/9 |
| `npm run test:mixed-native-local` | 29/29 | 29/29 |
| `npm run demo:experiment-budget`, `demo:experiment-request-guard`, `demo:longmemeval-mixed` | pass/pass/pass | pass/pass/pass |
| `node tools/testing/run.mjs --script regression.mjs` | red before, green after | red before, green after |

The local native gates used pinned Mem0 2.2.0 and CPython 3.11.12 via the
documented `CAIRN_MEM0_NATIVE_VENV_ROOT` and
`CAIRN_MEM0_NATIVE_PYTHON_ROOT` environment variables.
They used only fake HTTP and fresh synthetic ledgers. No provider call, corpus
read or operational state write was made. Initial test setup failed before the
red assertion because this new worktree lacked `tiktoken`; the locked install
resolved it. During test authoring, an invalid regex and a test attempt to
read a guard handle after expected settlement failure were corrected; all final
focused and full gates passed. The latter test now inspects only its owned
synthetic SQLite outcome row and confirms it remains pending.

Primary acceptance on the final unchanged runtime independently reran focused
wire and mixed-guard tests (38/38 on each Node version), generic tests (143/143
on each), JSON and strict plugin validation (pass on each), and the full
actual-core mixed-native-local gate (29/29 with zero skips on each; Node 22
about 181,628 ms, Node 24 about 179,860 ms). The 296-input differential on
both Node versions is recorded above. These checks do not identify the
historical N7 response or its root cause.
