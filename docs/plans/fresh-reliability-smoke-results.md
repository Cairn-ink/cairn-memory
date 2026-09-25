# Fresh development smoke evidence delivery

Fixed base: `45eca22639836e8035c3ccbbe6403a9f5c076b1d` (PR #217).
Primary owns read-only acceptance of the already-running one-shot smoke;
GPT-6 Sol/high owns the bounded documentation implementation after the result
is independently audited. This packet makes no model call or runtime change.

## Frozen acceptance

- R1 Publish only audited aggregate observations from the existing fixed-six
  run at this base, without corpus text, source/case IDs, answers, private paths
  or credentials. Preserve historical 30-case results unchanged. Each arm's
  correct/wrong/unresolved counts must sum to six; distinguish generated
  answers, judged answers, completion and accuracy. Do not silently drop cases.
- R2 State the predeclared completion gate: at least 95% in every arm means
  6/6 judged in this tiny run. Report its actual outcome without making it a
  semantic-quality, improvement, competitor-parity or installed-host gate.
  Include failure stages, candidate-to-packed counts, receipt truncation,
  known/unknown costs, conservative reservation and request accounting. Mark
  unobserved causes unknown; this is not an invoice or a full benchmark.
- R3 Preserve the runtime/model/scorer identity and all limitations from
  `fresh-reliability-smoke.md`: development cohort, fixed arm order, paired
  blocking, embedded default core, no native opt-in recovery/deadline flow.
  Do not retest, relabel, replace or tune on these six. Link the frozen F1–F6
  contract and actual runner PR. State candidate versus merged/released status.
- R4 Update only this plan, a new `docs/evidence/fresh-reliability-smoke.md`,
  the current smoke entry in `docs/limitations.md`, `ROADMAP.md`'s smoke gate,
  and a concise dated result pointer in `docs/plans/fresh-reliability-smoke.md`.
  Keep older checkpoint text explicitly historical. No claim that S2–S5 passed.
  If completion fails, block paid scale-up but keep read-only diagnosis and
  separately frozen synthetic repair/preflight work moving. If it passes,
  comparator fairness/guard prerequisites still block a scored Mem0 run.
- R5 Worker and primary run generic tests, JSON and strict plugin validation
  on Node 22.16 and 24.15, inspect the full diff, and record exact evidence.
  Independent Standards and Spec inspect the same committed original-base diff;
  fix/reverify/rereview before a dependent PR and exact-head CI. No merge,
  release, deployment or modification to the running experiment worktree.

## Resume

The paid smoke was already launched once. Missing reports do not authorize a
restart. Primary must inspect its durable marker and ledger, await terminal
output, audit it independently and supply a redacted evidence packet before
documentation implementation begins. Private audit artifacts remain outside
the repository. No new user decision is needed for this scoped delivery.

## Evidence

The one-shot development run reached a terminal six-case scored result without
a global halt. Primary and an independent read-only audit checked the redacted
aggregate. All three arms generated and judged 6/6 answers, so the predeclared
95% completion checkpoint passed. Judged correct/wrong/unresolved were Cairn
2/4/0, full history 3/3/0, and no memory 0/6/0. This is a development smoke,
not semantic promotion, a matched competitor comparison, or an installed-host
result. The prior 30-case outcomes remain unchanged.

The [redacted aggregate evidence](../evidence/fresh-reliability-smoke.md)
records stage counts, bounded recall coverage, source truncation, and
conservative request and cost accounting. Its execution used runtime
`45eca22639836e8035c3ccbbe6403a9f5c076b1d`, an unmerged PR #217
candidate. Completion permits the separately gated next investigation; S2–S5
and comparator fairness/guard prerequisites remain open. No case was rerun,
replaced, or relabeled, and no paid scale-up is authorized by this packet.

## Worker verification — 2026-09-25

GPT-6 Sol/high inspected the five-file documentation diff. `npm test` (112/112),
`npm run validate`, and `npm run validate --prefix tools/plugin-validation`
passed on both Node 22.16 and 24.15. Node 24 strict plugin validation required the
installed `claude` executable on `PATH`; its earlier missing-executable failure
was environmental, and the corrected rerun passed. Primary acceptance and the
independent fixed-base Standards/Spec reviews remain separate gates.
