# Frozen 24-case algorithm-development comparison results

Status: original frozen comparison finalized; candidate rejected. Full labels
had one fewer case meeting the full frozen rubric, below the required gain of
three. All 24 captures and all 48 answer slots completed. An independent
rubric-alignment audit found a measurement-design mismatch; it does not revise
these original results or the frozen rejection. The primary DRI owns
verification and the next decision; the corpus author prepares this
documentation and does not judge answers.

Delivery base: `2ca81e5a8ca686760f94c27c3d24367fdab6ae51`.
Preparation: PR #379 and the frozen
[Stage 2 execution contract](reliability-three-stage.md#first-comparison-execution-contract-2026-10-10).
This dependent documentation packet does not rerun, replace or retry a case.

## Frozen identity and scope

The executed runtime was `2ca81e5a8ca686760f94c27c3d24367fdab6ae51`
(PR #379 candidate), on Node 24.15.0, with evaluated model
`gpt-4.1-mini-2025-04-14`. Node executable SHA-256:
`d1de76d8edf2fededf6f8b30d244e2c0529ac607923a018283b77e9c74bd932c`.
The preparation candidate had 31/31 green CI checks and was mergeable at the
primary's checkpoint; this does not identify a merged or released runtime.

| Frozen artifact | SHA-256 |
| --- | --- |
| Model-facing inputs | `56f0db72471781497872cdf757c9f9db45772a334198e9e26ac1b4dd947215ac` |
| Evaluator-only rubric | `c40952734852e01072185939c51f54efa8238d5fa1b44259bf3964b8088ce4f5` |
| Combined corpus freeze | `926bc92a1628924167fe1c77d5de6eb8234a4f52dd3b215e88c535bea7d8a5df` |
| Execution manifest file | `2999cdd6b476dd58dd1369ce864ebec847e71c51b1075d0e527c0fc0fdb2139f` |
| Raw report | `a70c5c777e493bb4d3c320c4833c802160ef519b3f5b1995d4746b10acdc8c3a` |

The frozen corpus has 24 fresh synthetic cases, four in each family, and 42
positive required anchors. Capture is shared; full-label selection is the
single intervention. Both arms use indexed source evidence, bounded-keyset
candidates, default selection, source-evidence recall and a six-unit limit.
Baseline runs first on odd ordinals and full labels first on even ordinals,
with one attempt per arm and no retries. Recorded comparison date: 2026-10-10.

## Agreement on the full frozen development rubric

The following correctness labels mean agreement that an answer met every
required proposition in the full frozen development rubric. They are not
ordinary or general answer-accuracy estimates. An independent Spec audit found
required propositions mixing a sufficient direct answer with unasked
explanatory/background detail in D06/07/09/10/12/13/14/16/19/20/24. Direct-answer
adequacy and rubric completeness therefore need separate interpretation.
Qualifications remain necessary when scope, time or uncertainty affects the
answer. No revised or alternate QA scores are calculated here.

All 24 cases per arm and all 48 answer slots remain in the report. A missing,
failed, unrun or unresolved answer earns no correct credit. Completion and full
rubric agreement are distinct.

| Arm | Correct / 24 | Incorrect / 24 | Unresolved / 24 | Completed / 24 |
| --- | --- | --- | --- | --- |
| Ordinary labels | 10 | 14 | 0 | 24 |
| Full labels | 9 | 14 | 1 | 24 |

| Family | Ordinary C/I/U; completion (each / 4) | Full C/I/U; completion (each / 4) |
| --- | --- | --- |
| Detail retention | 2/2/0; 4/4 completed | 2/2/0; 4/4 completed |
| Lexical/paraphrase/CJK | 2/2/0; 4/4 completed | 2/2/0; 4/4 completed |
| Multi-session links | 0/4/0; 4/4 completed | 1/3/0; 4/4 completed |
| Event-time/late import | 1/3/0; 4/4 completed | 1/3/0; 4/4 completed |
| Proposal/adoption/premise update | 2/2/0; 4/4 completed | 1/3/0; 4/4 completed |
| Unknown/conflicting evidence | 3/1/0; 4/4 completed | 2/1/1; 4/4 completed |

Full labels won one pair and lost two; eight pairs were both correct and 13
were neither correct under the frozen rubric. Net additional correct count was
−1 over all 24 pairs. C/I/U below mean correct/incorrect/unresolved under that
same rule; unresolved does not mean that answer generation failed.

| Slot | Ordinary | Full | Pair |
| --- | --- | --- | --- |
| D01 | C | C | Both correct |
| D02 | I | I | Neither correct |
| D03 | C | C | Both correct |
| D04 | I | I | Neither correct |
| D05 | C | C | Both correct |
| D06 | I | I | Neither correct |
| D07 | I | I | Neither correct |
| D08 | C | C | Both correct |
| D09 | I | C | Full win |
| D10 | I | I | Neither correct |
| D11 | I | I | Neither correct |
| D12 | I | I | Neither correct |
| D13 | I | I | Neither correct |
| D14 | I | I | Neither correct |
| D15 | C | C | Both correct |
| D16 | I | I | Neither correct |
| D17 | C | I | Full loss |
| D18 | C | C | Both correct |
| D19 | I | I | Neither correct |
| D20 | I | I | Neither correct |
| D21 | C | C | Both correct |
| D22 | C | C | Both correct |
| D23 | C | U | Full loss |
| D24 | I | I | Neither correct |

## Independent judgments and safety

Two separate nonauthor GPT-6.1 Sol/high judges each submitted all 48 judgments
with arm identities concealed. Both schema checks exited 0 and found zero
unknown labels; aggregation exited 0. The frozen agreement-only rule used no
adjudication. One verdict disagreement (D23 full) remained unresolved, with
zero missing or explicitly unknown judgments. Same-family AI judge agreement
is not independent human ground truth.

Primary-supplied original judgment file SHA-256 values:

- Judge A: `f7bba5bd2eb880d733d9a2f14afe0bc4f50c216abf5deef2a7656e6da52fd390`.
- Judge B: `b4665790f5fd11b314be9ab3fc575962ca638307048f0f9ff80d83ece478f09a`.

Each arm had one unsupported-answer question (D10), zero stale-use questions
and zero severe errors over 24. There were zero unsupported, stale or severe
safety unknowns and no newly failing predefined severe case. Unsupported
claims were checked against actual packed evidence; correctness used original
source truth and the full frozen rubric. These criteria can produce an
incorrect rubric outcome without an unsupported or stale claim.

| Judge / arm | Reviewed claims | Unsupported claims | Stale claims |
| --- | --- | --- | --- |
| A / ordinary | 41 | 1 | 0 |
| A / full | 40 | 1 | 0 |
| B / ordinary | 40 | 1 | 0 |
| B / full | 39 | 1 | 0 |

The original claim denominators remain separate; judge agreement is assessed
at question level. The report contains no source text, answers, private blind
mapping, credentials or operational ledger contents.

## Required-anchor coverage

Coverage is literal normalized required-anchor presence bound to the correct
original session/message, not semantic support. Every stage in each arm uses
all 42 anchors; absent, unknown and not-run opportunities earn no credit.

| Stage | Ordinary present/absent/unknown/not-run (N=42) | Full present/absent/unknown/not-run (N=42) |
| --- | --- | --- |
| Capture retained | 42 / 0 / 0 / 0 | 42 / 0 / 0 / 0 |
| Candidate reachable | 42 / 0 / 0 / 0 | 42 / 0 / 0 / 0 |
| Selected | 35 / 7 / 0 / 0 | 36 / 6 / 0 / 0 |
| Recalled | 32 / 10 / 0 / 0 | 34 / 8 / 0 / 0 |
| Packed | 32 / 10 / 0 / 0 | 34 / 8 / 0 / 0 |

Packed-anchor presence increased by two over the fixed 42-anchor denominator
(32/42 to 34/42). Four slots gained one packed anchor each (D09, D12, D17 and
D24); two lost one each (D10 and D19). These are exposure observations, not
semantic answer verdicts. Only actual selected packing units with verified
receipt provenance earn packed credit; neither all-source backfill nor matching
text from another source is valid coverage.

First candidate identity/order, core selection input sequences and candidate
sequences matched in all 24 pairs. Ranking inputs matched in five pairs and
differed in 19. Both arms made 24 selection calls. Total exposed selection
label bytes were 11,866 for ordinary labels and 10,338 for full labels, a
reduction of 1,528 bytes in the full-label arm's aggregate exposure.
Here "full labels" means replacing a preview label with stored `memory.content`,
not exposing complete source receipts or transcripts. It need not increase
the number of bytes relative to the original label.

## Failures and resources

The experiment process exited 0 with no global halt (`fatal: null`), no capture
failure and no failed or not-run arm. Full-rubric failures and the one unresolved
judgment above remain in the fixed denominator. No case was replaced or retried.

| Phase | Core model calls | Physical HTTP requests | Input / output tokens | Latency (seconds) | Known usage estimate (USD) | Reserved (USD) |
| --- | --- | --- | --- | --- | --- | --- |
| Shared capture | 76 | 152 | 57,500 / 6,775 | 398.797 | 0.033871 | 0.760000 |
| Ordinary recall/answer | 48 | 120 | 50,210 / 4,016 | 299.821 | 0.026540 | 0.600000 |
| Full-label recall/answer | 47 | 118 | 46,249 / 3,653 | 294.460 | 0.024371 | 0.590000 |
| Whole run | 171 | 390 | 153,959 / 14,444 | 993.886 | 0.084782 | 1.950000 |

Each core model call uses provider input counting and generation requests;
the 48 answer generations are additional to the 171 core calls. Shared capture
is counted once. Phase latency is additive observed work; whole-run latency
includes orchestration overhead. Seconds are rounded to milliseconds. All
generation requests had priced usage; unpriced-generation count was zero.
Known usage is a model-price estimate and conservative reservations are not
an invoice or a refund claim.

The 24 captured databases totaled 13,475,840 bytes, ranging from 561,152 to
569,344 bytes per case. Each arm preserved its captured logical state in all
24 cases and recorded zero database-byte growth. Core calls ranged from five
to ten per case. Case latency ranged from 31.837 to 53.223 seconds.

Observed 390 physical requests were below the frozen 1,968-request maximum,
and the US$1.95 reservation was below US$10. Maximum observed case latency
was below 20 minutes and the 993.886-second run was below eight hours. These
aggregates are distinct from per-request input/output-token and timeout checks.
The primary's finalized frozen decision reports zero resource-cap failures.
The original cumulative ceiling and protection are unchanged.

## Frozen gate decision and next algorithm action

The original frozen decision is reject (`advance: false`): net full-rubric
correct gain was −1, below the required ≥3. Packed-anchor gain was +2, safety
did not block advancement, and resource-cap checks passed. Those passing
components do not override the failed correct-gain condition. Product-default
enablement and official-benchmark-score flags remain false.

The primary accepted two directions for the next bounded development work:

1. Prospectively separate requested-answer correctness from context completeness,
   with concise-versus-explained invariance controls. Preserve necessary scope,
   time and uncertainty qualifications and separate packed-support, stale-use
   and severe-error checks. Any future comparison needs a newly frozen paired
   baseline; these original 10/9 counts are not its comparator.
2. Target bounded multi-card evidence-chain preservation and assembly, motivated
   by D11's mural → order → billing-recipient dependency and the source-bound
   offline replay below. Prospective controls must measure actual answer quality
   and the resources added by keeping the required chain together.

The original version-1 questions, sources, judgments, counts and rejection stay
immutable. Any future version 2 must be clearly versioned and labeled previously
seen development data rather than fresh or held-out evidence. These accepted
directions are not a committed protocol, paid-comparison authorization or
product-default change. The next comparison's scope awaits prospective freeze
and review; answer verbosity is not the proposed correction.

## Source-bound mechanical replay

The primary verified a recorded-response D11 replay on Node 22.16.0 and
24.15.0. Its baseline replay exactly matched the original full-arm selector's
core and expanded inputs, selector output, upstream ranking input, final recall,
verified evidence and packing. Two selected/fetched cards became one ranked and
packed card: 1/2 required anchors, with 188 answer-input tokens. Packing omitted
no unit and removed no duplicate; this recorded loss occurred at rank output.

The existing small-candidate-retention treatment on the identical captured
snapshot and selector output retained two ranked/packed cards and 2/2 anchors,
with 248 answer-input tokens. It delegated no ranking/model/provider call in
this recorded replay. Original store and sidecars were unchanged; owned
workspaces were removed after both failing and successful controls.

The source-bound replay command shape was
`env -i PATH=<supported Node bin>:/usr/bin:/bin TMPDIR=/tmp NODE_DISABLE_COMPILE_CACHE=1 node <replay-helper> --d11`.
It exited 0 on both Nodes. Adding `--baseline-red` exited 1 on both with the
intended 1/2-anchor assertion failure. The primary inspected the helper before
execution and personally verified the D11 controls on both Nodes. Helper
SHA-256: `1054aa5a769907436513c528c55b2feaeae11a71d82b46fedce8d62034d4d11d`.

This is a mechanical opportunity to preserve an evidence chain, not a fresh
semantic gain, a confirmed QA fix or candidate promotion. It cannot recover
evidence missing from selection elsewhere and does not change the original
full-label-only run or its frozen gate decision.

## Limits and delivery verification

These small authored synthetic histories are not LongMemEval, a Mem0
comparison, long-history validation, population parity or installed-host
evidence. They do not rescore historical cohorts or establish natural Hermes
tool use, broad semantic reliability or product acceptance.

Primary verification on Node 22.16.0 and 24.15.0: `npm test` passed 623/623
with actual exit 0 on each; `npm run validate` and
`npm run validate --prefix tools/plugin-validation` each exited 0 on both.
There is no TypeScript gate in this JavaScript repository. Source-free
aggregation and the independent original-ledger/request reconciliation exited
0: the report and per-case record routes both contain the same 390 unique
requests, with no pending reservations. The cumulative conservative reservation
is US$323.232281; US$46.767719 remains outside the protected US$30 at this
checkpoint, not an invoice or future dispatch authority.

The pre-commit changed-file inventory from diff plus untracked files matched
the independently parsed Git status: three scoped documentation files.
`git diff --check` exited 0. Final fixed-diff Standards/Spec review and remote
CI results are recorded in the delivery PR. The reliability plan and limitations
entry use the same finalized sanitized metrics. No old cohort is rescored.
