# Source-bundle QA24 — closed first-result report

2026-10-12. The accounted first run is **not promising** under the frozen gate:
ordinary has 15/24 supported-correct first answers and source-bundle has 12/24.
The paired result is 3 wins, 6 losses and 15 ties, net -3 with bounds [-3, -3]
and zero uncertain pairs. These bounds describe field-judgment uncertainty, not
a statistical confidence interval or generalization beyond this small 24-case
cohort. Ten source-bundle slots failed before answering, and
source-bundle introduced the predefined severe BQ08 error. No accuracy
improvement, D12 repair or original Stage 2/3 clearance follows.

## Scope and denominator

This closes the prospective [corpus](source-bundle-qa24.md),
[paired runner](source-bundle-comparison.md) and
[first-answer scoring](source-bundle-scoring.md) contracts. The evaluated model
was `gpt-4.1-mini-2025-04-14`, with unchanged answer instruction/model between
arms. Query-independent scripted capture created twelve literal one-receipt
cards per case; both QA arms saw the complete authored map, used bounded source
scan and source-evidence context, and had a six-card selection limit. Ordinary
rank was compared with the [query-local bundle planner](query-local-evidence-bundles.md)
and its [transport](source-bundle-plan-rank-transport.md).

There was one attempt: 24 fixed pairs (18 answerable, 6 qualified), 48 QA slots
and 24 separate later navigation probes. Failures remain in all denominators;
there are no replacement answers, retries, rejudgments or adjudication. This is
an authored complete-map/scripted-capture mechanism diagnostic. It is not an
official LongMemEval/Mem0 comparison, natural long-history MOC evaluation,
measured lightweight fit, product/default release or deployment acceptance.

## First-score outcomes

All metrics below derive from the immutable `first-score-report.json`, whose
file SHA256 appears below. Correctness uses full-source judgments; support uses
only the passages actually packed for answering. Supported-correct requires an
actual first answer, first fieldwise agreement on correctness **and** support,
and retention of at least one complete necessary source set in actual packed
evidence. Correctness alone earns no supported-correct credit.

| Metric | Ordinary | Source-bundle |
| --- | --- | --- |
| Completed first answers | 24/24 | 14/24 |
| Consumed before-answer failures | 0/24 | 10/24 |
| Not-run QA slots | 0/24 | 0/24 |
| Agreed correct | 21/24 | 12/24 |
| Agreed incorrect among actual answers | 3 | 2 |
| Agreed supported | 17/24 | 12/24 |
| Supported-correct | 15/24 | 12/24 |
| Supported-correct false / unknown | 9 / 0 | 12 / 0 |
| Correctness / support unknown among actual answers | 0 / 0 | 0 / 0 |
| Complete necessary source set in actual packed evidence | 16/24 | 14/24 |
| Unsupported questions / claims among actual answers | 7 / 7 | 2 / 2 |
| Stale questions / claims among actual answers | 0 / 0 | 0 / 0 |

The ten absent answers have no semantic judgment and receive no correct or
supported-correct credit. Zero judgment unknowns describes the 24 ordinary and
14 source-bundle actual answers, not ten successful abstentions. The conditional
12/14 among returned source-bundle answers is not the experiment's outcome.
The observed unsupported-count difference (-5 questions, -5 claims) does not
establish safer answering: treatment returned ten fewer answers.

| Subset | Arm | Completed | Correct | Supported | Supported-correct | Complete packed set |
| --- | --- | --- | --- | --- | --- | --- |
| Answerable (18) | Ordinary | 18/18 | 17/18 | 13/18 | 12/18 | 12/18 |
| Answerable (18) | Source-bundle | 12/18 | 12/18 | 12/18 | 12/18 | 12/18 |
| Qualified (6) | Ordinary | 6/6 | 4/6 | 4/6 | 3/6 | 4/6 |
| Qualified (6) | Source-bundle | 2/6 | 0/6 | 0/6 | 0/6 | 2/6 |

Capture and QA rank visibility retained complete necessary sets in 24/24 cases
per arm. Selection, prepared packing and actual packing each retained 16/24
ordinary and 14/24 source-bundle complete sets. Missing treatment stages remain
unreached, not repaired by the full-source rubric. All 24 navigation probes
completed separately: complete sets were visible in 24/24 maps and 16/24
selected/post-fetch rank inputs. Their scripted rank returned empty refs, so
final probe recall retained 0/24 complete sets by design. These probes supplied
no QA recovery, answer or supported-correct credit.

### All 24 paired supported-correct rows

`No answer` is a consumed failure and supported-correct false. Other `No`
entries are actual answers that do not satisfy the complete supported-correct
criterion, including answers judged correct without the necessary packed set.

| Case | Subset | Ordinary | Source-bundle | Paired outcome |
| --- | --- | --- | --- | --- |
| BQ01 | Answerable | No | Yes | Win |
| BQ02 | Answerable | No | Yes | Win |
| BQ03 | Qualified | No | No answer | Tie |
| BQ04 | Answerable | Yes | Yes | Tie |
| BQ05 | Answerable | Yes | Yes | Tie |
| BQ06 | Answerable | No | No answer | Tie |
| BQ07 | Answerable | No | Yes | Win |
| BQ08 | Qualified | No | No | Tie |
| BQ09 | Qualified | No | No answer | Tie |
| BQ10 | Answerable | Yes | Yes | Tie |
| BQ11 | Answerable | Yes | Yes | Tie |
| BQ12 | Answerable | Yes | Yes | Tie |
| BQ13 | Qualified | Yes | No answer | Loss |
| BQ14 | Answerable | Yes | Yes | Tie |
| BQ15 | Answerable | Yes | Yes | Tie |
| BQ16 | Answerable | Yes | Yes | Tie |
| BQ17 | Answerable | Yes | No answer | Loss |
| BQ18 | Qualified | Yes | No | Loss |
| BQ19 | Answerable | Yes | No answer | Loss |
| BQ20 | Qualified | Yes | No answer | Loss |
| BQ21 | Answerable | Yes | Yes | Tie |
| BQ22 | Answerable | Yes | No answer | Loss |
| BQ23 | Answerable | No | No answer | Tie |
| BQ24 | Answerable | No | No answer | Tie |

## Retained failures and diagnosis

All ten before-answer failures are `invalid_model_output`: BQ03, BQ06, BQ09,
BQ13, BQ17, BQ19, BQ20, BQ22, BQ23 and BQ24. The retained deterministic
diagnostic reproduces the original compiler rejections:

| Case | Cards per proposed bundle | Distinct total | Violated limit |
| --- | --- | --- | --- |
| BQ03 | 3, 2, 2 | 7 | Total >6 |
| BQ06 | 4 | 4 | Bundle >3 |
| BQ09 | 4 | 4 | Bundle >3 |
| BQ13 | 3, 3, 6 | 12 | Bundle >3 and total >6 |
| BQ17 | 6 | 6 | Bundle >3 |
| BQ19 | 4 | 4 | Bundle >3 |
| BQ20 | 4 | 4 | Bundle >3 |
| BQ22 | 5 | 5 | Bundle >3 |
| BQ23 | 4 | 4 | Bundle >3 |
| BQ24 | 6 | 6 | Bundle >3 |

Nine outputs exceeded three cards in a bundle; BQ03 exceeded the six-card
total, and BQ13 exceeded both. All 24 recorded planner outputs passed strict
JSON, supplied schema and completed-envelope checks. The prompt stated both
card limits, but the schema allowed these over-budget shapes; the compiler
enforced its contract and failed closed. This does not establish why the model
ignored the written limits, or a network, token-truncation or capture failure.
Offline edited proposals that compile are diagnostics, not recovered retrieval,
replacement plans, answers or newly scored slots.

The two returned qualified treatment answers were incorrect and unsupported.
BQ08 invented a missing batch-to-tray association and assigned a tray temperature
to Mina: this is the newly positive predefined severe condition, despite a
complete packed required set. BQ18 made a wrong interview attribution despite
the missing identity link; its agreed predefined severe flag remained negative.
The causal effect of grouping on either answer remains unknown; these two
outputs do not establish a grouping cause or solution. Ordinary's BQ03 severe
condition also remains visible; an absent treatment answer is not its repair.

## Gate and resources

The run closed `accounted`, integrity was `valid`, resource compliance was
`satisfied`, and `promising` was `false`. Its three exact rejection reasons are
`paired-lower-below-three`, `no-complete-set-case-gain` and
`new-severe-condition`. The negative paired gain, 14 versus 16 retained complete
sets, and new BQ08 severe condition independently fail those requirements.

| Closed-run resource observation | Value |
| --- | --- |
| Physical / dispatched / final-record / delta-confirmed settled intents | 182 / 182 / 182 / 182 |
| Reserved microUSD | 910000 |
| Known model-price microUSD | 70610, PARTIAL known-only; not an invoice or total cost |
| Unknown-usage calls / reserved microUSD | 72 / 360000 |
| Pending / missing final records | 0 / 0 |
| Prepared store bytes | 14057472 |
| Elapsed milliseconds | 631058.9355710001 |
| Transport latency milliseconds | 253423.7579299995 |
| Peak RSS / agent service cost | Unknown / unknown |

The retained closed-run ledger snapshot reserved 333522281 microUSD against
the original 400000000 ceiling, leaving 66477719 microUSD, or 36477719 above
the protected 30000000. These are the closed-run snapshot, not new current
account reads or authority to spend. Unknown usage remains conservatively
reserved; the partial known-price estimate excludes unmeasured agent service
costs. Accounting compliance does not establish whole-process lightweight fit.

## Reproducibility and judgment boundary

Executed source SHA: `d7c02f3f8e6913155bebfa7de9515268b084a794`.
Accepted runner/runtime SHA: `6abed0ccdfe3815d42b25db04adb159483ded156`.
Private retained artifacts remain unchanged; public documentation records only
bindings and summarized synthetic outcomes, without operational paths or source
transcripts. Value hashes and exact-file hashes below are explicitly distinct.

| Binding | SHA256 |
| --- | --- |
| Sources value | `74c3664e31d1d35a74a614345c273faa2c7f1845811030fd0868141c74a44e7c` |
| Rubric value | `d3e34c207c927831c31e446e59f900d65c284cb29fc11ca242bc1302b896c8f3` |
| Preparation manifest | `4c2aaacaa37ebab94a2fc23ca661dfee200619dead7030be13af8559a8b8a6f2` |
| Preparation observation file | `c17c0946f6ca3accf45921597f2ed2adb6e90af7adca60430573ebfef09c4075` |
| Run manifest | `a4a118b53ce35125a72224edfb140f48b4c10906c93c231ec6ce4bab98fce349` |
| Result value | `7da4b08dc250650d51be6f75cec7d542529e8fcbf9db3fc9241f321da3388949` |
| Result file | `e6239495e092c39a289213df9a41da2753371f91d12cd5824c6294fdeda564db` |
| First-score report file | `8c68ea60d4eb1625e77fc88c4c6208d7eaab15ad069276e06cb16a0a3c3f44ab` |
| First-judgment provenance file | `582c721e380a3342ba8677fe418a3d405e5409005bbb83e1473f50ac5ab41e99` |
| Sole first raw judge A file | `27a2f5b0760372f14131890d5ffa99789fa0821df5387bd1a9262112b5915d94` |
| Sole first raw judge B file | `e8f6b20fdbd01346774d4fd7290ab375c4c430b48672a1f3cebdf80f3741a25d` |
| Retained deterministic diagnostic file | `4a2710694f8a2a5bd3556015aafdc571825bf6af696c76c40922aca71cfa5011` |

Both nonauthor judges actually ran `gpt-6.1-sol`, effort `high`, in separate
fresh `forkTurns: none` contexts. Each received only its neutral payload and
instructions, without arm mapping, aggregate results, diagnostics or the other
judgment. Sole first raw responses were retained unchanged, with first fieldwise
consensus only; there was no rejudge or adjudication. Service cost is unknown.
Separate execution and same-family agreement are not independent semantic
truth; firstness is externally attested, not cryptographically proven. Source
and answer clues also limit blinding.

Artifact consistency does not prove an entire transcript authentic. Original
history-prefix preservation, absolute deadlines and local token measurements
rely on the pinned accepted runtime and external execution provenance; token
measurements were not independently retokenized by this result packet.

## Next checkpoint

The primary will freeze a prospective algorithm design before code authoring:
represent the selected-card budget in planner output structure while continuing
to reject invalid references without silent dropping; separately test retrieval
selection versus answer-context grouping for missing-link and qualification
errors. No solution is established yet. This is an algorithm diagnosis and
correction checkpoint, not another guard-only increment or automatic promotion.

After offline gates, independent review and exact-head CI, any separately
authorized experiment needs independently frozen **new** source-only cases and
first judgments. This result packet authorizes no paid invocation, current-cohort
rerun/reanswer/rescore, raised resource cap, main merge, release or deployment.
The original D12 and Stage 2/3 gates remain uncleared.

## Documentation consumers and delivery checks

The changed reader entrypoints are [ROADMAP](../../ROADMAP.md) and
[limitations](../limitations.md), which now link to this result. Existing
[README](../../README.md) links route readers to both; the
[contributor evidence rule](../../CONTRIBUTING.md) requires these destinations.
The prospective corpus/runner/scorer and bundle/transport links above resolve
to their preserved contracts. This packet changes documentation only and
introduces no runtime caller, browser flow or redirected URL.

Mechanical review reads the closed report without executing its scorer: all
24 paired rows, stage/probe aggregates and public hash bindings are checked
against retained fields/files. Git inventory is cross-checked against an
independent baseline tree/blob comparison and documentation-tree traversal.
The primary owns final two-runtime generic gates, both Claude validators,
candidate freeze, independent full-base Standards/Spec reviews and exact-head
CI/mergeability checks. This author packet makes no commit or push.
