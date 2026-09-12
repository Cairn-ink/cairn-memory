# Paired update reliability: retained failures, not promotion evidence

Neither candidate meets the frozen reliability gate. Both follow the direction
of the two explicit adopted updates, but baseline loses one update's scope and
both also retire still-valid memories. Requiring
the model to declare a relation, changed value and explicit adoption did not
prevent incorrect retirement in this attempt. Do not promote that mechanism as
reliably understanding whose belief changed, what changed or why.

This concerns experimental source-ordered `core.capture` reconciliation. The
five MCP tools provide explicit remember/correct/forget operations, not automatic
transcript capture. These results neither invalidate their mechanical persistence
gates nor certify model-guided recall or real-user value.

## What was actually tested

- Baseline: `08b566fc6949f65148460e23919e49fcfb188fef`.
- Qualified reconciliation: `cb5d31d32a62532d36663613cbb3451956259d6d`.
- Pre-call reviewed harness: `fb80667dc0725cd1550bb0f07e73d59019cd707e`.
- Eight new synthetic cases, four English/four Mandarin, each with two source
  windows and one current-state question. Per language: an adopted update,
  historical material plus reaffirmation, an uncertain/rejected proposal, and
  another speaker/subject/scope. Two positive cases prevent blanket abstention
  from satisfying the gate; these are four category pairs, not eight independent
  failure families.
- One attempt per case/version. Q01..Q08 order, baseline first on odd cases and
  qualified first on even cases: balanced deterministic scheduling, not randomized.
  There were no retries, replacements, prompt changes or model tuning during the
  experiment. The earlier failed C6 was not rerun.
- Each arm used its own pinned core, adapter, prompt, output schema and HTTP guard,
  sharing the original durable campaign ledger. Extraction used
  `gpt-5.4-mini-2026-03-17`; classification/reconciliation/recall/answer used
  `gpt-4.1-mini-2025-04-14`. This does not change product defaults.
- Separate local SQLite stores, actual ordered captures, closed/reopened snapshots
  after each window, a fresh recall, then one answer with only the query and
  retrieved evidence. No paid judge. Case author, implementation authors and
  post-run reviewers had separate roles; the rubric never entered model input.

The [pre-call contract](../plans/qualified-comparison.md),
[frozen sources](../../evaluations/results/qualified-paired-v1-sources.json),
[frozen rubric](../../evaluations/results/qualified-paired-v1-rubric.json),
[raw synthetic evidence and model observations](../../evaluations/results/qualified-paired-v1.json),
[English review](../../evaluations/results/qualified-paired-v1-english-review.json)
and [Mandarin review](../../evaluations/results/qualified-paired-v1-chinese-review.json)
are retained. Private authoritative reports also preserve HTTP envelopes and
incremental checkpoints; the export omits local paths, operational bindings and
host-provider envelope IDs, not failed outcomes.

## Independent outcomes, with denominators

| Gate | Baseline English | Qualified English | Baseline Mandarin | Qualified Mandarin |
| --- | ---: | ---: | ---: | ---: |
| Mechanical completion | 4/4 | 3/4 | 4/4 | 4/4 |
| Source-supported persisted claims | 14/14 | 12/12 | 10/12 | 13/13 |
| Fully justified retirement pairs | 1/2 | 1/2 | 0/2 | 1/3 |
| Correct final current propositions | 4/4 | 2/4 | 3/4 | 4/4 |
| Required retrieval | 2/4 | 2/4 | 3/4 | 3/4 |
| Supported correct answers | 4/4 | 2/4 | 4/4 | 4/4 |
| Fully qualified positive updates | 1/1 | 1/1 | 0/1 | 1/1 |
| Full frozen gate | 1/4 | 2/4 | 1/4 | 1/4 |

Qualified English includes one missing capture/recall/answer outcome, counted in
the four-case denominator, not as a pass. Claims are distinct stored ID/content
pairs across both windows, including retained history. A source-supported claim
does not prove its currentness or justify its retirement. Final-current-proposition
checks are separate from change-history correctness: unchanged values may remain
correct despite an unjustified retirement. A fully justified retirement pair
requires both legitimate retirement and a source-supported, properly scoped
successor; baseline Q05 fails that full-pair criterion even though the update's
direction is legitimate.

Thus baseline passes 2/8 complete cases and qualified 3/8, but neither passes the
gate. Baseline answers all eight correctly despite its state/history defects;
qualified answers six correctly, one incorrectly and has one missing answer.
These descriptive counts are not an improvement percentage or a model ranking.

## Concrete failures

- **Different subject, wrong state and answer:** qualified Q04 correctly stores
  a housemate's white-noise preference, then wrongly retires the user's own
  spoken-story preference. Recall returns the housemate's memory and the answer
  attributes white noise to the user. A user-authored message is not necessarily
  a claim about that user.
- **Unchanged facts wrongly retired:** baseline Q02/Q06 and qualified Q06/Q07
  replace existing adopted facts with reaffirmations of the same values. Some
  final answers remain correct; this does not justify the recorded change.
- **Structurally valid but semantically wrong verdicts:** all three unjustified
  qualified retirements have `supersedes` / `changed` / `explicit` plus valid
  item-bound user-source indices. Structural and receipt checks cannot establish
  the truth of those model judgments. A separate independent retirement audit
  agrees on the full-pair criterion: baseline 1/4 retirement pairs justified,
  qualified 2/5 justified. Baseline Q05's legitimate update direction but
  unsupported successor scope is included as a failed pair.
- **Fail-closed capture, incomplete experience:** qualified Q02 returns a
  nonretiring reaffirmation whose evidence index is not among its selected item's
  source indices. Core validation rejects the whole second capture. Its previous
  state and cold snapshot remain unchanged; there is no recall or answer. This
  is one missing outcome, not a successful refusal or a transport retry.
- **Scope loss and retrieval gaps:** baseline Q05 drops the daytime restriction
  from successor assertions. Other cases omit rubric-required qualifications or
  companion facts during recall. The frozen rubric intentionally requires all
  listed current propositions, sometimes more than the minimum answer to the
  question; these stricter retrieval failures must not be confused with an
  incorrect final answer.

## Accounting and verification

All 16 scheduled arms are retained: 15 mechanically completed and Q02/qualified
incomplete. The one-shot finished the remaining scheduled arms without retrying
that failure. HTTP, persistence and campaign accounting stayed healthy.

| Conservative accounting | Before | After | This attempt |
| --- | ---: | ---: | ---: |
| Requests | 1,919 | 2,152 | 233 / 272 allowed |
| Reserved USD | 15.706048 | 17.710656 | 2.004608 / 2.30 allowed |
| Known usage USD | 0.995016 | 1.059954 | 0.064938 |
| Unknown-cost requests | 896 | 1,005 | 109 |

Known usage excludes unknown-cost calls and is not the total bill or the spend
authority. Reservations are never refunded here. The immutable USD20/4,000-request
campaign remains unchanged, with USD2.289344 conservative headroom and zero
unsettled requests. No new campaign or enlarged limit was created.

Before paid I/O, Node22.16/24 each passed the offline live-evidence gate (56 passed,
27 opt-in installed/host cases skipped), generic tests (31 passed), JSON validation
and pinned Claude plugin validation. The 19 new harness/cap tests all passed,
including real SQLite/cold reads and actual adapters over guarded fake HTTP.
Independent Standards and Spec reviews found zero blockers on the frozen harness
and operator. No new installed-client or autonomous-host certification is claimed.
Additional evidence consistency tests check exported hashes, every claim/retirement
label's coverage, missing outcomes and accounting; they do not rejudge semantics
or call a model. The final delivery reran both Node versions: 61 offline passes
with the same 27 opt-in skips, 31 generic passes, JSON and plugin validation;
the 24 new harness/cap/evidence tests passed without skips.

Final delivery review found and fixed two post-run harness/export gaps: a cold
snapshot integrity/read failure now stops all later arms (not merely the current
arm), and review exports replace private operational locators with public evidence
filenames. Regression tests cover both. No such snapshot failure occurred in the
retained run; its reviewed pre-call harness remains `fb80667`, and no paid evidence
was rerun or rewritten to use the subsequent harness fix.

## DRI decision and next development gate

Keep the update-reliability gate failed. These eight synthetic pairs cannot
establish a statistically reliable ranking, improvement percentage, competitor
advantage or real-user reliability. Extraction and subsequent model outputs vary
between arms; do not attribute every difference solely to the changed prompt.

The next work should address the decision boundary, not add marketing scores:

1. Define a source-backed same-subject, same-property and same-scope requirement
   for retirement, distinct from the role of the message author. A model label
   alone must not be presented as verification of that requirement.
2. Preserve reaffirmations and compatible relations without creating false change
   history. Handle rejected, quoted and uncertain material without turning it into
   adopted current state. Preserve qualifiers during extraction and retrieval.
3. Reduce avoidable invalid-output failures without weakening atomic source-binding
   checks. Keep the Q02 failure as a development regression, not a paid rerun.
4. Verify both valid updates and protected non-updates offline, independently
   review the candidate, then propose a separately frozen held-out experiment
   within separately agreed limits. This authorization does not cover another run.

This delivery changes evaluation tooling and evidence, not either tested runtime.
It does not merge PRs, release a package, publish to a registry or deploy a service.
