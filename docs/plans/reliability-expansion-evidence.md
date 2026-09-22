# Reliability-expansion evidence: public result contract

## Scope and fixed points

This documentation-only continuation records two already attempted, disjoint
activities: a completed 12-case public synthetic source-ranking screen and a
30-case fresh LongMemEval launch that stopped before any API request. The
reviewed runtime is
[`ca9c15c68e4078e8478877bece44d6e83f6a2ad1`](https://github.com/Cairn-ink/cairn-memory/commit/ca9c15c68e4078e8478877bece44d6e83f6a2ad1)
(PR #203); its code is not copied into this documentation branch. The public
fixture checkout is pinned separately at local unpublished candidate
`1174206acda370e184984a280f03b6751f7ae414`. The report links to the byte-identical
public cases and rubric at the reviewed runtime commit, not to the local commit.

No paid call, private-corpus access, environment/credential access, ledger
access, runtime change, retry, relaunch, push or merge is authorized by this
document. The earlier six-case evidence and roadmap gates remain unchanged.

## Acceptance

- **E1 — Preserve the completed screen.** Report the fixed 12 cases, two arms,
  24 completed arm outcomes and 48 guarded count/generation requests. Identify
  the frozen runtime, fixture, baseline, candidate and rubric hashes, pinned
  model, counterbalanced order, unchanged schemas/bounds, true core
  `callModel(rank)` path, and absence of answer/judge calls or retries.
- **E2 — State the outcome without promotion.** Report 23/23 required source
  groups, zero irrelevant selections and zero redundant selections for each
  arm. State prominently that the candidate tied the baseline and showed no
  improvement. Equality met only the predeclared provisional-benchmark gate;
  it is not evidence of better ranking, answer quality or broad reliability.
- **E3 — Reconcile accounting honestly.** Record 48 new requests, 240,000
  micro-USD reserved and 9,068 micro-USD known actual usage. The 24 successful
  count calls with null actual cost remain reserved rather than becoming free.
  Report the unchanged 6,051-row prefix and 55 old controls, then the 6,099-row,
  48,635,560-micro-USD cumulative checkpoint under the 100,000,000-micro-USD
  ceiling. These are ledger facts, not a provider-invoice audit.
- **E4 — Preserve the failed 30-case launch.** Record the balanced five-per-type
  frozen cohort selected from 36 candidates after excluding the prior 46 slots,
  and its 6,236-request/35,789,800-micro-USD envelope. State that `unsafe_output`
  occurred before any API request; all 30 cases are not run and no score exists.
  Record the independently reproduced operator/output-setup cause without
  misattributing the failure to model or product-memory quality.
- **E5 — Retain consumed state and no-call facts.** Report zero API calls, zero
  new reservations, unchanged ledger hash, and preserved marker/cap/claim state.
  Do not imply that the launch can be retried: a zero-call relaunch exception is
  awaiting explicit authorization and is not granted here.
- **E6 — Keep the public boundary.** Publish no raw dataset IDs, source prose,
  questions, reference answers, model answers, provider failures, credentials,
  private paths or private artifact contents. Hashes establish checked byte
  identity only; they do not authenticate truth, model execution or corpus
  provenance.
- **E7 — Deliver only the bounded documentation.** Add one concise evidence
  report, append one limitations link and brief nonclaims, and keep this plan.
  Do not edit the existing six-case numbers, ROADMAP gates, runtime, fixtures,
  ledger, prior evidence or package metadata. Run `npm test` and
  `npm run validate` on Node 22.16 and 24, plus a clean diff/link check.

## Ownership and next gate

The primary agent owns reconciliation, independent review, candidate commit and
delivery. This bounded worker owns only the three documentation files named in
E7. The primary's integration-only addition records the separately verified
private preflight repair: 20 combined tests passed on both Node runtimes, with
an independent non-author review. No public runtime changed. The remaining
gate is an explicit relaunch decision; neither offline verification nor that
decision establishes or promises a scored rerun.
