# Luna extraction experiment

Fixed base: `4d417ccdadcc76d2b17950e979a608599ab40f5f` (PR46).
The user approved the Luna-first comparison with GPT-5.4 mini, retaining the
original cumulative USD20 allowance. This does not authorize a default switch,
merge, release, deployment, arbitrary model, or fresh/refilled ledger.

## Acceptance before implementation

- L1: Add explicit `gpt-5.6-luna` extraction-only profile, reasoning `none`.
  Classification, selection and ranking remain pinned GPT-4.1 mini, with unchanged
  request bytes. Existing default and GPT-5.4 mini profile remain unchanged.
  No prompt, corpus, scoring threshold, runtime storage or retry changes.
- L2: Count and generation share exact model, instructions, schema and reasoning.
  Preserve strict response-model matching, token/output/response bounds, timeout,
  cancellation and sanitized failures. Reject unsupported models before I/O.
  Official docs list no dated Luna snapshot: record the exact requested/returned
  model and this reproducibility limitation, never invent a snapshot.
- L3: Local budget guard uses integer reservations and verified model prices;
  Luna base text input USD0.20/output USD1.20 per million. Conservatively allow
  the documented 1.25x input cache-write premium in reservation/accounting upper
  bounds. Existing 7024 input/1024 output bounds stay far below long-context rates.
  All failed/count/unknown requests remain reserved; no refund or hidden fallback.
- L4: Extend the shared request guard through an explicit, private, durable,
  auditable opt-in extension tied to the original immutable policy and exact
  ledger identity/limits. Do not rewrite/delete the original binding or change
  ledger schema, total cap, reservations or request count. Allow only Luna and
  existing GPT-5.4 mini for `cairn_extract`; all other methods/host stay baseline.
  Plain old constructors retain their exact old policy behavior. An extension
  must not silently activate, widen endpoints/bounds, change baseline prices or
  permit model spoofing. Reopen preserves enforcement; malformed/mismatched/
  missing/unsafe/symlink extension fails closed before network or reservation.
  Concurrent guarded requests still use the same atomic ledger; extension setup
  requires no unsettled attempts and preserves all historical entries.
- L5: Offline tests cover per-method routing, reasoning, response mismatch,
  pricing/reservation, interrupted requests, quota exhaustion, extension opt-in,
  tampering/mismatch, reopen and mixed-model cumulative accounting. Native HTTP
  is forbidden in tests. Run contributor generic, OpenAI, budget/request-guard
  tests and demos on Node22.16 and24; validate pinned Claude plugin. No TS gate.
- L6: Primary alone conducts paid calls only after implementation verification
  and independent fixed-SHA Standards/Spec review. Read only OPENAI_API_KEY from
  the previously authorized local env; no keys/full env to workers or artifacts.
  Freeze a unique intent, source/corpus/scorer hashes and ledger checkpoint first.
  One Luna compatibility probe cap USD0.05 /8 requests; failed compatibility stops
  the suite and retains sanitized evidence, not retries. If compatible, one full
  unchanged 12-case x3 Luna suite cap USD1.50 /300 requests. Independent labels
  must cover every source-support/relevance observation. Require zero unsupported
  captures AND all24 required capture facts, plus existing scoring gates.
- L7: Only after Luna completes, a single same-source GPT-5.4 mini comparison may
  use at most USD1.50 /300 requests. Do not treat older-source historical results
  as a head-to-head comparison. Report total guarded reservations separately from
  observed usage estimates and unknown costs. Retain every failed/unrun result.
  Compare fidelity, omissions, recall, latency and cost; do not claim human value
  or large-history readiness from these fixtures. Product integration/real-host
  candidate loop is a subsequent gated PR, not an automatic default promotion.

Official OpenAI documentation fetched 2026-09-11:
https://developers.openai.com/api/docs/models/gpt-5.6-luna
Responses/structured outputs, reasoning none, 1050000 context; input0.20,
output1.20 per million; cache writes1.25x; long context surcharge above272K.
Account access and actual response compatibility are unverified before L6.

Campaign starting checkpoint from previous delivery: 1215 requests, USD11.970
reserved, USD0.861898 known estimates,544 unknown-cost,0 unsettled. Confirm the
durable checkpoint before writing an extension or making any paid request.

## Implementation verification (before paid calls)

Primary verified on Node22.16.0 and24.15.0:

- `npm ci --prefix adapters/openai`; `npm run test:openai`:96/96 each;
  `npm run demo:openai-offline`:passed each (scripted HTTP, real SQLite).
- `npm run test:experiment-budget`:15/15 each;
  `npm run demo:experiment-budget`:passed each.
- `npm run test:experiment-request-guard`:24/24 each;
  `npm run demo:experiment-request-guard`:passed each.
- `npm test`:31/31 each; `npm run validate`:passed each.
- Pinned Claude2.1.260 `plugin validate .` and
  `plugin validate plugins/cairn-memory --strict`:passed.
- `npm ci --prefix adapters/mcp`; `npm run test:live-evidence-offline`:
  30passed/8explicit pinned-host skips each. No claim of installed candidate
  compatibility is made by these generic offline checks.

The primary confirmed the actual old ledger checkpoint read-only:1215requests,
11970000microUSD reserved,0unsettled,original20000000microUSD total. No provider
request or actual campaign extension provisioning occurred during these checks.
L1-L5 implementation verification does not complete L6/L7 quality measurement.
The existing default source-faithfulness failure remains unresolved.
