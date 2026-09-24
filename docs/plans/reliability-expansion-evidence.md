# Reliability-expansion evidence: result contract

## Scope and fixed points

This documentation-only continuation preserves the completed 12-case public
synthetic source-ranking screen and the original 30-case LongMemEval startup
failure, then records the completed, audited execution authorized as a single
startup exception for the same frozen 30-case cohort. The live wrapper exited
1 with `postrun_accounting_anomaly`; the separate private-artifact auditor v4
exited 0 with `cohort_audit_ok`. The report preserves these as distinct
outcomes. The reviewed runtime is
[`ca9c15c68e4078e8478877bece44d6e83f6a2ad1`](https://github.com/Cairn-ink/cairn-memory/commit/ca9c15c68e4078e8478877bece44d6e83f6a2ad1)
(PR #203); its code is not copied into this documentation branch. The public
fixture checkout is pinned separately at local unpublished candidate
`1174206acda370e184984a280f03b6751f7ae414`. The report links to the byte-identical
public cases and rubric at the reviewed runtime commit, not to the local commit.

No additional paid call, private-corpus access, environment/credential access,
ledger access, runtime change, retry, push or merge is authorized by this
document. The user separately authorized one zero-request startup exception on
2026-09-24, limited to the same 30 unattempted frozen cases. The earlier
six-case evidence and roadmap gates remain unchanged.

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
- **E4 — Preserve the original failed 30-case launch.** Record the frozen,
  balanced five-per-type cohort selected from 36 candidates after excluding the
  prior 46 slots, and its 6,236-request/35,789,800-micro-USD envelope. State
  that the first launch exited with `unsafe_output` before any API request and
  preserve its zero-call, zero-reservation and unchanged-ledger facts. Retain
  the independently reproduced operator/output-setup cause without
  misattributing it to model or product-memory quality.
- **E5 — Bound the subsequent exception.** Record that on 2026-09-24 the user
  authorized exactly one zero-request startup exception for those same 30
  previously unattempted cases, in the same five-per-type roster and order.
  Keep the original failed marker, cap and claim state intact. State that the
  exception uses the existing shared cumulative US$100 ceiling; it is not a
  new US$100 allowance, and no further retry or relaunch is included.
- **E6 — Report the audited cohort.** Report fixed N=30 for each of the three
  arms, correct/wrong/unresolved counts, resolved-case accuracy, and
  common-paired outcomes on the 23 cases resolved by every arm. Preserve all
  not-run outcomes in the fixed denominator. Report five cases per each of six
  types as descriptive counts, not population estimates. Give both
  correct/fixed-N and correct/resolved ratios. State the fixed
  Cairn/full-history/no-memory order,
  that a generation timeout prevents later arms for that case from running,
  and the distinct evidence serialization: full history uses raw turns; Cairn
  uses recalled memory IDs/revisions plus validated source receipts, but not
  extracted memory prose, with normalized receipt excerpts capped at 800
  UTF-16 units; no memory receives empty evidence. State Cairn's recall limit
  of six. Reconcile timeout and core failure categories, requests, reserved
  cost, known reported usage, unknown billing count and the shared cumulative
  checkpoint. Include retrieval traversal and candidate-count summaries with
  limits on causal interpretation. Record the wrapper exit 1 for
  `postrun_accounting_anomaly` separately from the v4 audit's exit 0 and
  `cohort_audit_ok`; do not claim a clean wrapper exit. The
  [cohort report](../evidence/reliability-cohort-30.md) contains the audited
  aggregates and preserves this distinction.
- **E7 — Keep the public boundary.** Publish no raw dataset IDs, source prose,
  questions, reference answers, model answers, provider failure text,
  credentials, private paths or private artifact contents. Hashes establish
  checked byte identity only; they do not authenticate truth, model execution
  or corpus provenance.
- **E8 — Deliver only the bounded documentation.** Update this plan, the
  existing source-ranking chronology, `docs/limitations.md`, and add
  `docs/evidence/reliability-cohort-30.md`. Do not revise the existing
  six-case result, the 12-case result, ROADMAP gates, runtime, fixtures, ledger,
  prior evidence or package metadata. The audited counts are now in the report;
  perform direct content/accounting inspection, clean diff and local-link
  checks, then the required repository checks and independent reviews before
  delivery.

## Ownership and next gate

The primary agent owns the live execution, final accounting reconciliation,
independent review, candidate commit and delivery. This bounded worker owns
only the documentation changes listed in E8. Offline synthetic checks showed
that the initial launcher's final predicate and auditor v2 would falsely
reject recognized timeout outcomes, although pre-run Gate 4 explicitly
allowed their full reservation while continuing the other fixed cases.
Auditor v2 did not audit the live run. The primary preserved the frozen
runtime and live wrapper; auditor v4 corrects the read-only comparison to
match the unchanged writer's five-field baseline. The primary reports 17/17
offline checks passing on both Node 22
and 24, including a synthetic 30-case public-CLI run through fake HTTP and
real core/SQLite followed by audit, plus two independent GPT-6 reviews of
auditor v4. These checks are operator/auditor evidence, not cohort results.
The single authorized exception completed; no further launch is authorized or
implied by this documentation. The report's next work is offline reproduction
of invalid-output boundaries, separate deadline-handling analysis, and
inspection of traversal, candidate-selection and ranking bottlenecks. No
additional model calls are authorized by this plan.
