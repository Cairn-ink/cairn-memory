# Selective rationale correction: offline diagnostic

This fixed three-case diagnostic tests whether the embedded replacement write
path can retain a valid proposed challenge while withdrawing a scripted
mistaken one. It uses fresh synthetic SQLite files, the public core and an
injected relation port. All judgments here are scripted; no provider, key,
network, natural MCP tool choice, answer model or human validation is involved.
The old graphs are deliberately seeded with the append-only API, not evidence
that a real model previously made those errors. The replacement model receives
only the canonical retained excerpts and submitted roles, **not** the old graph,
seed labels or expected results. This tests fresh relation inference plus
replacement mechanics, not a model's awareness of its previous verdict.

The [source fixture](../evaluation/architecture/rationale-correction-fixture.json)
contains only dated source statements and explicit arrival order. The
[separate rubric](../evaluation/architecture/rationale-correction-rubric.json)
holds scripted seed and expected receipt-backed links. The three histories are:

- An explicitly retracted offline-editing failure report. Removing its wrong
  challenge must leave the original choice, source record and support link.
- A Traditional Chinese dated retest that genuinely reports loss of offline
  PNG export. Its challenge must remain visible; no replacement product is
  chosen.
- Two separately sourced reasons for one choice: a false local-draft loss
  report is retracted, while encrypted export really stops working. The
  original June 1 encryption observation arrives last, after the June 4 update.
  Arrival order is not event chronology, and neither the old premise nor the
  later import reverses the dated update.

Every case stays within six current refs and the existing proposal/token
bounds. The runner manually admits each original statement, scripts an old
graph through default `reviewRationale`, then calls replacement exactly once.
It retains source records, full incident views for **every** ref, default views,
the review envelope and a fresh keyless child-process reread. This matters
because default decision context can hide orphan proposals; prior pilot
evidence counted eight proposed tuples but only four exposed support links.
Source receipts remain even when a proposal is withdrawn. A result of
`unassessed` after removal is not confirmation; a surviving support/challenge
path yields `reconfirmation-suggested`, not a changed decision.

The pure assessor reports `structuralSuccess` separately from
`syntheticFixturePass`. Correct scripted output passes both; clearing every
edge or preserving the known mistake can be structurally valid but fails this
fixture's expected links. Malformed output and provider failure retain a failed
envelope and unchanged graph, never an empty successful proposal. The scorer
cannot decide whether every alternative real-model edge is semantically wrong:
a retraction may itself support a decision, and whole-receipt or role/scope
ambiguity still needs independent source review. Exact tuple checks are for the
frozen synthetic controls, not a universal graph-accuracy metric.

Prior [rationale pilot](rationale-pilot-results.md),
[model control](rationale-model-control-results.md),
[source-basis comparison](source-basis-comparison-results.md) and
[answer accounting](answer-accounting-results.md) remain failed or limited
evidence. This diagnostic neither reruns their paid cases nor repairs their
representational, retrieval or answer-stage failures.

## Future paid gate, not authorized here

A separately approved once-only comparison could use these three fresh cases
with one source-only model re-review each: at most three relation generations
plus three input-count calls, six guarded HTTP attempts total, no answer/judge
calls and no retry. At the existing baseline guard's 5,000-microUSD reservation
per request, the proposed reservation ceiling is 30,000 microUSD; unknown
input-count costs are not zero and reservation is not an invoice. This document
does not grant those requests or renew a ledger.

Before any paid call, freeze and independently review an operator, the fixture
and rubric hashes, source/artifact/model pins and the exact guard policy. Require
a new exclusive one-shot intent, the existing settled shared ledger with enough
headroom, a narrowly authorized capability, and fake-HTTP rehearsal including
failures, budget exhaustion and no-retry behavior. Confirm the paid candidate's
dependency baseline: this offline branch includes the embedded/MCP correction
slices but does not silently include separate pending filing/direct-challenge
changes. Integrating such changes would require new pins, verification and
review before interpreting a model result.

Independent reviewers should inspect every source and every proposed tuple,
including all failed/not-run cases, false adoption/replacement, challenge
direction, temporal applicability and alternative source-supported edges. Even
three clean cases would justify only a larger fresh held-out test. They would
not establish general reliability, downstream answer accuracy, natural host
tool selection, a default capture policy or execution authority.
