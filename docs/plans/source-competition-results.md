# Source competition: retained result delivery

Status: closed synthetic result, **do not advance**. The acceptance contract
below was fixed before result-document implementation. Delivery gates and
independent candidate reviews remain primary-owned and pending.

Base: `cbaffce15b1c119fa6d93d82641d93a5ed4077ef`.
Branch: `docs/source-competition-results`.
Dependent PR target: `feat/source-competition-study`.

## Result (2026-10-09)

Smaller whole-message batches did not satisfy the frozen fidelity/safety gate.
All 24 batch slots and 16 logical arms completed, but completion is not semantic
correctness. Agreement-based anchor retention rose from 12/16 to 14/16;
individual reviewer gains were +2 and +1, not unanimous evidence of at least
two additional anchors per reviewer.
Candidate safety findings and reviewer disagreements independently block
advancement. No threshold, corpus, prompt, cap or product default changed.
The agreement-rule gain condition passes; it cannot erase those other failures.

The [aggregate record](../../evaluation/source-competition/results-20261009.json)
retains ordinal-only outcomes, independent judgments, disagreements, a synthetic
failure example and evidence hashes. Method was frozen in the
[study plan](source-competition-study.md) and
[review protocol](../../evaluation/source-competition/protocol.md).

| Observation | Control | Candidate |
| --- | ---: | ---: |
| Completed batch slots | 8/8 | 16/16 |
| Completed logical arms | 8/8 | 8/8 |
| Extracted items, not admitted memories | 38 | 59 |
| Mechanical supporting-receipt coverage | 14/16 | 15/16 |
| Semantic anchors retained by both reviewers | 12/16 | 14/16 |
| Reviewer A / B semantic retention | 12 / 13 | 14 / 14 |
| Required assistant anchors retained by both | 2/2 | 2/2 |
| Items both reviewers judged unsupported | 10/38 | 8/59 |
| Reviewer A / B unsupported items | 11 / 10 | 9 / 8 |
| Support-status disagreements | 1 | 1 |
| Error-category disagreements | 7 | 7 |
| Anchor-credit disagreements | 1 | 0 |

Error categories can overlap and disagreements are not additive totals.
Mechanical coverage means the required source passages occur somewhere among
the arm's receipts. Semantic credit additionally requires one item's claim and
its own receipts to preserve the full material meaning. All 32 arm/anchor
positions were reviewed; there were zero missing/null judgments. General
world-truth and unresolved absolute-date notes are limitations, not missing
judgments. Case 8's five-window relationship is excluded from the 16-anchor
denominator, but all its items remain in safety review.

### What failed

Case 7's four-window lookup relationship was not retained as one supported
complete-chain item in either arm, despite separately retained valid links and
mechanical receipt coverage. Combining those links does not earn credit under
the frozen rule. For its separate authorization anchor, reviewer A rejected
control wording that omitted the user as authorizer; reviewer B accepted it.
That one control-anchor disagreement is preserved, not resolved favorably.

Candidate case 7, batch 1, item 5 compressed six assistant instructions into one:
label distinction, recording unresolved links, dating photographs, keeping tags
readable, stable shelf names, and purpose-assigned empty cases. Its four attached
receipts support only the first four. The last two occur in the full batch but
are uncited. Both reviewers flagged citation insufficiency. The aggregate
record includes the exact synthetic claim, four attached excerpts and two
unattached supporting excerpts. This is a concrete per-item support gap, not
fabrication relative to the whole input or proof of downstream admission.

Advice classified as a fact or preference also produced reviewer-sensitive
promotion/attribution judgments. Those are reported separately from the hard
missing-excerpt example; the reviewers disagreed on seven items' error
categories in each arm. These judgments do not establish that the underlying
advice is false or that user reports are independently verified.

### Method, execution and accounting

Both arms used the same eight fresh synthetic sources, baseline indexed
extraction prompt and `gpt-4.1-mini-2025-04-14`. Per batch: 6,000 input tokens,
1,024 output tokens, five items, four canonical windows/item and 600 content
units. The candidate partitions whole messages into at most ten windows per
batch without changing IDs, roles, text or order. Odd cases ran control first;
even cases candidate first. It doubled batches and count/generation calls
(16 versus 32 physical requests) and aggregate item capacity (40 versus 80).
Prepared input tokens rose from 5,114 to 6,706, a 31.1% increase.
This is not equal-budget accuracy.
Cross-batch corrections and relationships remain a hazard, not reconciled state.

Runtime was `cbaffce15b1c119fa6d93d82641d93a5ed4077ef` on Node 24.15.0.
Two independent, freshly contextualized GPT-6.1 Sol/high reviewers each inspected
all 16 shuffled logical arms and 97 items. Phase one froze per-item fidelity
before phase two supplied anchors. Labels were blinded, but batch structure may
reveal treatment. Same-model-family review is not human gold or statistical
certainty. The original phase hashes and all disagreements remain retained.

There were 48 succeeded requests, zero refused/not-run slots, zero pending or
unknown transport outcomes, and no retry or replacement. Primary observed the
outer process exit 0; the closure's `osExit` remains `unknown`. The identity,
24 slot journals, final report and closure form 27 hash-verified artifacts.
Journals preserve publication-time pending persistence; the final report records
completed persistence. Parsed extractor observations are bounded unmodified
JSON, not raw HTTP bytes. All 97 proposals bound to items; no rejected proposal
is omitted from this run's semantic review. Hashes identify bytes, not truth.

New conservative reservation was US$0.24 against the US$1 round ceiling;
cumulative reservation is US$321.282281 within US$400, with US$30 protected.
US$0.011321 is only the known actual-cost portion: 24 actual-cost entries remain
unknown. It is not the full bill, a refund or a budget reset. Retained history
prefix preservation is the launcher's ordered public-snapshot observation,
not an independent raw-rowid audit. Original history and closed artifacts stay
unchanged.

This extraction-only study executed no core qualification, admission, filing,
recall, answer/scoring pipeline or Mem0 arm. It adds no LongMemEval score and
does not pool or revise earlier results. It establishes neither default MOC
quality nor reliable/lightweight MCP/Hermes operation.
The existing indexed source-only answer pipeline excludes generated
interpretations, so these extraction-claim findings are not proven causes of
earlier benchmark answer errors.

### Product decision

Keep the ten-window batch policy experimental; do not promote it or tune and
rerun these cases as fresh evidence. Qualification examines already-selected
sources and cannot recover omitted windows. The next step is planning only:
a separately consented, bounded opt-in canonical-source staging mode independent
of extraction selection, reusing existing expiry, quotas, discard/replay fences
and exact MCP cold reads. First require fresh offline cold-session tests with
empty extraction, nonopening details, corrections, namespace isolation and
deletion. Existing staging retains prefixes, expires and is excluded from indexed
capture; compatibility and privacy require separate review, not silent enablement.
MCP does not currently expose the indexed source policy; the proposed source
mode and explicit host wiring are future work, not existing staged capability.
No new provider pass, default transcript retention, rollout or paid follow-up is
authorized here. Durable retention and Hermes wiring remain separate decisions.

## Acceptance

- R1 Publish the single closed synthetic extraction experiment, not a new
  LongMemEval or Mem0 score. Retain all eight cases, twenty-four batch slots,
  sixteen logical arms and both independent reviewers' complete coverage.
  Public summaries must distinguish receipt coverage from semantic anchor
  retention and structural execution completion from semantic correctness.
- R2 Apply the already-frozen protocol without changes. Preserve each reviewer's
  phase-one and phase-two results and hashes. Agreement is required for credit;
  any disagreement, unknown or safety failure blocks advancement. Do not resolve
  disagreement by choosing the favorable judgment or changing old scores.
- R3 Explain at least one concrete retained failure with synthetic claim and
  source evidence when failures are observed. Report both conditions, assistant
  anchors, the four-window relationship requirement, the separate excluded
  five-window boundary, and partial evidence without overstating it as success.
- R4 Disclose unchanged per-batch caps, increased aggregate item capacity and
  calls, reservations versus known actual cost, cumulative US$400 ceiling and
  US$30 protected reserve. Keep the original ledger and closed operation intact.
  No credential, machine-local path, private authorization or original ledger
  contents are published. Synthetic examples and aggregate evidence hashes are
  permitted. Label-blinding is not guaranteed treatment-blinding; two reviewers
  from the same model family are not human gold or a statistical guarantee.
- R5 Document the resulting product decision and a bounded next step. A failed
  study does not become a default capture-policy change. Even a passing study
  requires separate cold-session admission, filing, chronology and retrieval
  validation. No competitive-parity or product-reliability claim follows here.
- R6 Scope is exactly this plan, `docs/limitations.md`, and
  `evaluation/source-competition/results-20261009.json`. Source corpus, evaluator,
  protocol, runtime, manifests, dependencies and existing result files stay
  unchanged. Derive and independently cross-check the changed-file inventory.
- R7 Primary directly verifies aggregates against retained raw evidence and
  runs generic tests, JSON validation and maintainer validation on Node22.16
  and24.15. Fixed candidate receives independent Standards and Spec review,
  followed by latest-head CI and mergeability checks. No merge, release or
  deployment is authorized by this delivery.

## Ownership

Primary owns the frozen evidence, interpretation and direct acceptance.
Implementation is assigned separately to a bounded GPT-6.1 Sol worker.
Independent nonauthor reviewers inspect the same final committed diff.

## Evidence

Primary accepted the closed execution, artifact/accounting aggregates and both
two-phase result reviews before authoring. Actual GPT-6.1 Sol/high implements
only the three R6 files. Author JSON/arithmetic/hash checks and two-route scope
verification are recorded below after execution. Generic/JSON/maintainer gates
on both supported Nodes, fixed-candidate Standards/Spec reviews and latest-head
CI/mergeability remain pending under primary ownership. No TypeScript gate
applies to this JavaScript repository. No operation is reopened or rejudged.

Author verification used a read-only inline aggregate checker with
`env -i PATH=/usr/bin:/bin TMPDIR=/tmp NODE_DISABLE_COMPILE_CACHE=1` and exact
Node 22.16.0 and 24.15.0, both actual exit 0. It parsed the public JSON and
matched all eight cases/16 arms/97 items/32 anchor positions, reviewer counts,
disagreement locations, model/caps/order, accounting projections and the exact
synthetic failure to retained adjudication. All 27 execution-artifact hashes,
three public asset hashes and four phase-review hashes matched. It checked
that the JSON contains no private local paths or opaque execution labels.
No fixture, ledger write, provider call or temporary artifact was created.

`git diff --check` returned actual exit 0. Changed-path discovery through
`git diff --name-only -z` plus `git ls-files --others --exclude-standard -z`
is independently checked against `git status --porcelain=v1 -z` with full
untracked enumeration: exactly three R6 delivery files, excluding only the
three known read-only dependency setup symlinks. Primary will rerun the scope
check and required gates on the final candidate; these author checks do not
claim full-suite, independent candidate-review or CI success.

### Primary integrated acceptance checkpoint

After the three-file author freeze, primary completed eight integrated gate
commands on exact Node 22.16.0 and 24.15.0; all actual exits were 0. Each runtime
passed 581/581 generic tests and 12/12 study tests; JSON and maintainer
validation also exited 0. The three file hashes stayed unchanged throughout
those gates. Primary's separate raw-evidence check exited 0 and matched all
eight cases/16 arms/24 slots/97 items/32 anchor positions, four review hashes,
accounting, receipts and frozen assets. This supersedes the earlier pending
gate status, not the pending candidate reviews or CI.

Following gate closure, primary authorized only the plan's input-token wording
correction (31.1% increase, not doubling) and this acceptance append. Public
JSON, limitations, sources, thresholds and runtime remain unchanged. Primary
will recheck this doc-only delta before the candidate commit and independent
Standards/Spec reviews. No merge, release, deployment or paid follow-up.
