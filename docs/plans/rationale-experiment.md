# Rationale experiment — R4

Base: `f88d09f04c934e830c29c9d972e06549ecde0f9e` (PR #72).
Purpose: measure whether automatically proposed rationale links preserve actual
choices and reveal changed reasons, rather than only demonstrating executable plumbing.

## Acceptance and delivery sequence

1. Add an explicit immutable rationale-pipeline capability, separate from every
   previous authorization file. It grants only baseline extract,
   qualifyCandidates, classify, relate, select and rank through the existing
   guarded Responses paths. Existing capabilities still deny relate, including
   after the new file exists. Do not grant legacy qualification, reconciliation,
   alternate models or arbitrary methods. Preserve ledger history and checks.
2. A closed parent-only session and one-shot attempt reuse shared durable budget
   accounting, checkpoint/pin verification, serialized requests and fail-stop
   persistence. At most 384 HTTP requests and US$1.92 reserved, inside the
   existing cumulative US$50 phase; callers cannot widen limits. Unknown costs
   remain reserved; no retries or resumption after failure.
3. Deliver and independently review the guard before provisioning a real
   capability. Offline actual-adapter tests prove count/generation framing,
   denial by old grants, immutable-file/checkpoint safety, failure costs and
   parent-session option/route restrictions. Test both supported Node runtimes.
4. Freeze eight fresh two-event synthetic cases and a source-based rubric before
   scored calls: positive reason changes, attributed third-party choices,
   compatible updates, tentative options and subjective uncertainty. Compare
   baseline source evidence against rationale evidence using the same pinned
   model and actual installed MCP artifact in fresh isolated namespaces/stores.
   Do not send the rubric or expected results to the model.
5. The following runner slice must pin source files, fixture, installed artifact,
   capability and ledger checkpoint; refuse existing attempt directories; keep
   provider keys only in the parent, with authenticated loopback transport for
   child MCP. Retain every case (including not-run and failed) in the denominator.
   Check cold keyless inspection, duplicate no-call behavior and forget.
6. After offline tests and independent review, run once within the cap. Record
   proposed links, returned evidence, false adoption/replacement, missed reasons,
   unsupported challenges, cost, latency and abstention. Independently judge
   sources versus output. Do not rerun failures as held-out improvements.

## Scope and interpretation

The first delivery covers acceptance 1–3 only. Fixture/installed runner and live
evidence (4–6) follow; this is not an authorization to call models immediately.
The comparison assesses memory context and proposed relationships, not host
answer generation, real-user success or overall memory-system reliability.
No publication, deployment, production data or old evaluation result mutation.

## Guard preparation verification

Node 22.16.0 and 24.15.0: `npm test`, `npm run validate`,
`npm run validate --prefix tools/plugin-validation`,
`npm run test:experiment-budget`, `npm run demo:experiment-budget`,
`npm run test:experiment-request-guard`, `npm run demo:experiment-request-guard`,
and `npm run test:live-evidence-offline` pass. Live-offline is 114 passed with
27 existing installed-gate skips per runtime; this slice adds no installed runner.
The final targeted rationale guard suite passes 10/10 per runtime, including
schema/framing widening denial. The five new attempt tests pass per runtime.
All ledgers and HTTP responses in these tests are synthetic; no provider key or
real campaign capability was read or created. Independent dual review and CI
remain required before autonomous merge.
