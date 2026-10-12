# Card-plan QA24 — closed first-result report

2026-10-12. **Reject candidate.** Ordinary A completed 24/24 and scored
20 correct / 4 incorrect / 0 unresolved. Card-plan B and diagnostic C each
completed 3/24 and scored 2 correct / 1 incorrect / 21 unresolved.
B−A supported-correct gain is -18 and complete-required-evidence gain is -20.
Stage 2/3, default advancement and D12 remain uncleared. The run completed
with actual exit 0; that is neither an infrastructure abort nor a 24/24
answer-quality pass. Older cohorts, thresholds and results remain unchanged.

## Fixed scope and first judgments

This closes the independently authored [synthetic corpus](card-plan-qa24.md),
[matched projection](card-plan-comparison-projection.md),
[first-answer runtime](card-plan-first-answer-runtime.md) and
[scoring contract](card-plan-first-answer-scoring.md): 24 fixed questions,
18 answerable / 6 qualified, 288 source messages and 102 required anchors.
Preparation used scripted exact-window extraction and unfiled classification
with complete candidate visibility. This is a development cohort, not
LongMemEval, competitor parity, natural long-history MOC, Hermes or product
acceptance. Do not pool it with older cohorts.

The evaluated model was `gpt-4.1-mini-2025-04-14`. A used ordinary rank plus
flat sources; B used card-plan rank plus the same flat source projection;
C reused B's selection with unverified grouping. C is diagnostic only and
made no third selection. Selection and answer denominators remain 48 and 72.
Four distinct actual GPT-6.1 Sol/high first judges evaluated 27/27 eligible
A/B items and 3/3 eligible C items respectively. All four first responses
were valid. There was no replacement, rejudge, rescore or response repair.
These judges are separate from the evaluated model.

## Outcomes and retained evidence

| Metric, fixed denominator | A ordinary | B card-plan | C grouped diagnostic |
| --- | --- | --- | --- |
| Completed first answers / 24 | 24 | 3 | 3 |
| Correct / incorrect / unresolved | 20 / 4 / 0 | 2 / 1 / 21 | 2 / 1 / 21 |
| Supported-correct / 24 | 20 | 2 | 2 |
| Complete required evidence / 24 | 22 | 2 | 2 |
| Required anchors present / absent / unknown, of 102 | 98 / 4 / 0 | 11 / 1 / 90 | 11 / 1 / 90 |
| Qualified supported-correct / 6 | 4 | 0 | 0 |
| Unsupported questions / known claims among actual answers | 2 / 6 | 0 / 0 | 0 / 0 |
| Stale / severe questions among actual answers | 0 / 0 | 0 / 0 | 0 / 0 |
| Safety-unobserved questions / 24 | 0 | 21 | 21 |

Unanswered cases remain **unresolved** in QA and fail supported-correct.
Zero observed harms among three B/C answers does not prove safety across 24;
the remaining 21 are unobserved, not successful abstentions. The known zero
claim counts are not full-cohort totals. Complete evidence and answer support
are distinct: A CQ18/CQ22 retained complete evidence but were unsupported;
A CQ03/CQ24 and B/C CQ24 were incorrect with incomplete required evidence.

The following 24 rows reproduce the literal closed result record. Each arm
cell gives QA outcome / complete required evidence. `unresolved / unobserved`
means the dependent answer did not run and earns no complete-evidence credit
(the record's `completeRequired` is false). Every `invalid_model_output` cell
is a B selection failure; C shares that failed selection.

| Case | Type | A outcome / complete evidence | B outcome / complete evidence | C outcome / complete evidence | B selection |
| --- | --- | --- | --- | --- | --- |
| CQ01 | answerable | correct / yes | unresolved / unobserved | unresolved / unobserved | invalid_model_output |
| CQ02 | answerable | correct / yes | unresolved / unobserved | unresolved / unobserved | invalid_model_output |
| CQ03 | answerable | incorrect / no | unresolved / unobserved | unresolved / unobserved | invalid_model_output |
| CQ04 | answerable | correct / yes | unresolved / unobserved | unresolved / unobserved | invalid_model_output |
| CQ05 | answerable | correct / yes | correct / yes | correct / yes | completed |
| CQ06 | answerable | correct / yes | unresolved / unobserved | unresolved / unobserved | invalid_model_output |
| CQ07 | answerable | correct / yes | unresolved / unobserved | unresolved / unobserved | invalid_model_output |
| CQ08 | answerable | correct / yes | unresolved / unobserved | unresolved / unobserved | invalid_model_output |
| CQ09 | answerable | correct / yes | unresolved / unobserved | unresolved / unobserved | invalid_model_output |
| CQ10 | answerable | correct / yes | unresolved / unobserved | unresolved / unobserved | invalid_model_output |
| CQ11 | answerable | correct / yes | unresolved / unobserved | unresolved / unobserved | invalid_model_output |
| CQ12 | answerable | correct / yes | unresolved / unobserved | unresolved / unobserved | invalid_model_output |
| CQ13 | answerable | correct / yes | unresolved / unobserved | unresolved / unobserved | invalid_model_output |
| CQ14 | answerable | correct / yes | unresolved / unobserved | unresolved / unobserved | invalid_model_output |
| CQ15 | answerable | correct / yes | correct / yes | correct / yes | completed |
| CQ16 | answerable | correct / yes | unresolved / unobserved | unresolved / unobserved | invalid_model_output |
| CQ17 | answerable | correct / yes | unresolved / unobserved | unresolved / unobserved | invalid_model_output |
| CQ18 | answerable | incorrect / yes | unresolved / unobserved | unresolved / unobserved | invalid_model_output |
| CQ19 | qualified | correct / yes | unresolved / unobserved | unresolved / unobserved | invalid_model_output |
| CQ20 | qualified | correct / yes | unresolved / unobserved | unresolved / unobserved | invalid_model_output |
| CQ21 | qualified | correct / yes | unresolved / unobserved | unresolved / unobserved | invalid_model_output |
| CQ22 | qualified | incorrect / yes | unresolved / unobserved | unresolved / unobserved | invalid_model_output |
| CQ23 | qualified | correct / yes | unresolved / unobserved | unresolved / unobserved | invalid_model_output |
| CQ24 | qualified | incorrect / no | incorrect / no | incorrect / no | completed |

B−A has 0 wins / 18 losses / 6 ties, supported-correct bounds [-18, -18],
and complete-required net -20. These are closed field-judgment bounds, not a
statistical confidence interval. Diagnostic C−B gain and complete-required
net are both 0. Qualified CQ19/CQ20/CQ21/CQ23 regress from A supported-correct
to dependent unanswered slots. The frozen gate failures are exactly:
B completion <23; supported-correct gain <3; complete-required gain <1;
qualified regression; A/B safety unobserved. No default advancement follows.

## Bounded compiler diagnosis

Detached pure probes retained literal responses unchanged and made zero
model calls. For CQ01, only changing candidate indices to selected-slot
indices cleared rejection. For CQ03, only removing uncovered selected cards
cleared rejection. For CQ02, duplicate correction alone was insufficient:
the terminal was also invalid. CQ05 was an unchanged positive control.
These establish concrete compiler constraints in the inspected examples,
not the model's internal reasons or a general cause for all 21 failures.
Detached diagnostic copies are not repaired formal outputs; no new answer
or quality credit is attributed to them.

## Accounting and provenance

The closure records 126 physical requests and US$0.63 reservations. Known
subtotal is US$0.066248, with 48 unknown-cost calls: it is not full cost or an
invoice. All 78 recorded known-cost attempts have retained usage proof; that
coverage excludes unknown-cost calls. The original prefix was retained,
with zero pending calls at closure: 57,963 cumulative requests,
US$334.152281 reserved and US$65.847719 remaining. The US$400 limit and
US$30 protection are unchanged; no refund or reset occurred. This historical
balance is not new dispatch authority or a claim of future affordability.

Runtime latency was 523459.500516 ms; 24 stores occupied 14,057,472 bytes.
Peak RSS, preparation latency and service cost are unknown. This record does
not establish lightweight acceptance or comparable end-to-end resource fit.

Source commit: `c7a487abc2471ac997ed44dc6a7e41d49cc59640`;
executed runtime: `4309ff396834f60c237910493c2dc837e11de4dc`.
Retained SHA256 provenance (no private raw artifacts or paths are published):

| Record | SHA256 |
| --- | --- |
| Full first-score report | `a99284502a5e9a2dbfb687246f2ad223b0fa21c51a639b7195e69c52e42241e2` |
| Source-free closed result | `298dbabc945ce53765685e56d8036a041b8698155f22cd769435355189ec8d59` |
| Source-free primary postrun audit | `e4d7c36c52bd6d73deef13d31e2a531e2acfa885052e74376033abc0084829e7` |
| Source-free detached diagnosis | `6df77ed27d1e750adc65157c2dd0924d651743951f44983d5b3fb84c43a61c22` |
| Frozen sources | `09ecd9710ea980d8ac228ad55858e4a757de4dc006eb8451a30707142b102cb5` |
| Frozen rubric | `58ba116268bac50ce69bd8ca4598a31e1c3bcd9eaa6836345c86da6845f840c8` |
| Preparation manifest | `43c4514b6ce087ada700e0fea353dee644039f4a096ebb1fd9a932c587b5b09b` |
| Run manifest | `7b72291345867ae38bd307d5ac6f738de28469845b08a7f78b61641f0269e97a` |
| Retained runtime result | `b94cd2468a1a2c8a3bf5a2ffabe0bda42194702bfb61d1c93c316f87b60fd2fa` |

Hashes identify retained bytes; they do not prove semantic truth, authenticated
source identity, absence of wholesale fabrication or cryptographic judge
independence. Firstness, execution, deadlines and judge independence require
the separately reviewed external provenance. Submitted roles are attributable
source receipts, not authenticated subjects or execution instructions.

## P4 review and next checkpoint

Two successive planning-format candidates are now rejected: the
[source-bundle first result](source-bundle-qa24-results.md) and this card-plan
result. Stop that paid sequence and review the representation under P4.
Primary selects a separately versioned receipt-ID group design for **offline
feasibility** next. It is prospective, not implemented or shown to work.
No repair, changed old threshold, consumed CQ/BQ rerun or new paid authority
follows. The [main reliability plan](reliability-three-stage.md) remains the
single tracker. The goal is lightweight, source-backed reliable memory;
completion, QA, safety, a fresh paired comparator, installed Hermes use in a
new session and resource fit remain separate uncleared acceptance gates.
