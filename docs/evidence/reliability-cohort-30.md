# Reliability cohort: 30-case result

**Status: completed and audited.** The one-time, user-authorized startup
exception finished at 2026-09-24 10:48:56 UTC on the same 30 frozen,
previously unattempted cases. The live wrapper exited 1 with
`postrun_accounting_anomaly`; this was not a clean wrapper exit. The separate,
hash-pinned private-artifact auditor v4 exited 0 with `cohort_audit_ok` and
produced redacted aggregate results. The successful audit does not change the
wrapper's exit status.

## Frozen cohort and runtime

The cohort contains 30 fixed cases, balanced at five cases in each of the six
LongMemEval question types. It was selected from 36 candidates after excluding
the prior 46 frozen case slots. The same roster and source order are used for
this execution; no outcome-driven replacement or reordering is allowed. The
selection SHA-256 is
`14852ef098f9533eb1ff2c458755dcce084e5de0ea3d0fce6a54f240773510e2`, and the
prepared manifest SHA-256 is
`6f2f06eea2d6d51c4d3d6059c535239febb3d8028cd545600a308c089c0911ae`. The
frozen source file SHA-256 is
`d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442`. These
digests identify checked bytes; they do not authenticate corpus provenance or
model judgments. No dataset IDs, source text, questions or answers are
published here.

The reviewed runtime is
[`ca9c15c68e4078e8478877bece44d6e83f6a2ad1`](https://github.com/Cairn-ink/cairn-memory/commit/ca9c15c68e4078e8478877bece44d6e83f6a2ad1)
([PR #203](https://github.com/Cairn-ink/cairn-memory/pull/203)). At the review
snapshot, the PR was open with 17 green checks and had not been merged. Its
runtime is not copied into this documentation branch.

The user authorized exactly one zero-request startup exception on 2026-09-24,
limited to these same 30 previously unattempted cases and preserving the
original failed launch's marker, cap and claim state. The exception drew on
the existing shared cumulative US$100 ceiling; it is not a new US$100 budget.
No further retry or relaunch is authorized or implied here.

Memory and answer generation use `gpt-4.1-mini-2025-04-14`; judging uses
`gpt-4o-2024-08-06`. The answer template remains
`cairn-longmemeval-public-answer-v2`, with a 123,000-token context limit, 512
output tokens, recall limit 6 and the unchanged 30-second core model deadline.
The official scorer's upstream revision is
`9e0b455f4ef0e2ab8f2e582289761153549043fc`, as pinned in the reviewed runtime's
[`official-scoring.mjs`](https://github.com/Cairn-ink/cairn-memory/blob/ca9c15c68e4078e8478877bece44d6e83f6a2ad1/evaluation/longmemeval/official-scoring.mjs).
The `case-deadline-v1` policy is unchanged. These settings are held fixed
across the three arms.

The fixed generation order is Cairn, full history, then no memory. A generation
timeout prevents later arms for that case from running; those arms remain not
run in fixed N. Cairn recall is capped at six results. Extracted memories help
select candidates for recall, but their prose is not sent as answer evidence.
The Cairn answer input contains memory IDs/revisions and validated source
receipts; each receipt exposes at most the first 800 UTF-16 units of normalized
source text. The full-history arm serializes raw source turns under its own
evidence format, while no memory receives empty evidence. These arms therefore
differ in evidence representation as well as evidence source; their outcomes
do not isolate retrieval alone. This contract is visible in the reviewed
[`public-comparison.mjs`](https://github.com/Cairn-ink/cairn-memory/blob/ca9c15c68e4078e8478877bece44d6e83f6a2ad1/evaluation/longmemeval/public-comparison.mjs)
and the [ingestion guide](../longmemeval-ingestion.md).

## Preserved startup failure and audit path

The first launch exited with `unsafe_output` before any API request. Its
operator/output-setup cause was independently reproduced; it was not a model
or product-memory quality result. That failed marker, cap and claim remain
preserved for the one explicitly authorized exception.

Synthetic offline checks showed that the initial launcher's final predicate
and read-only auditor v2 would falsely reject a recognized timeout outcome,
although pre-run Gate 4 explicitly allowed its full reservation while
continuing the other fixed cases. The live wrapper later exited 1 with
`postrun_accounting_anomaly`; auditor v2 did not audit that run. The reviewed
runtime and live wrapper were preserved. Auditor v4 corrects the read-only
comparison to match the unchanged writer's five-field baseline. The primary
reports 17/17 offline checks passing on both Node 22 and Node 24, including a
synthetic 30-case run through the actual public CLI with fake HTTP and real
core/SQLite, followed by audit. Two independent GPT-6 reviews of auditor v4
passed. This is operator and audit evidence only; it is not a result for the
frozen cohort.

## Outcomes

The fixed denominator is 30 per arm. Counts and both accuracy denominators
below come from the successful private-artifact audit with redacted results; no
case IDs or answer content are published.

| Arm | Fixed N | Resolved | Correct | Wrong | Unresolved | Correct / fixed N | Accuracy among resolved |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Cairn | 30 | 23 | 15 | 8 | 7 | 15/30 (50.0%) | 15/23 (65.2%) |
| Full history | 30 | 27 | 19 | 8 | 3 | 19/30 (63.3%) | 19/27 (70.4%) |
| No memory | 30 | 27 | 2 | 25 | 3 | 2/30 (6.7%) | 2/27 (7.4%) |

`Resolved` is correct plus wrong. `Correct / fixed N` treats unresolved cases
as not correct in the fixed-cohort view; accuracy among resolved
(`correct / resolved`) is a separate conditional measure.

On the 23 cases resolved by all three arms, Cairn was correct on 15 (65.2%),
full history on 16 (69.6%) and no memory on 2 (8.7%). Unresolved and not-run
outcomes remain in fixed N and are not successful skips.

The per-type counts below are descriptive observations from five cases per
type, not type-level or population reliability estimates. Each cell is
correct / wrong / unresolved.

| Question type (N=5) | Cairn | Full history | No memory |
| --- | ---: | ---: | ---: |
| Single-session user | 2 / 2 / 1 | 4 / 0 / 1 | 0 / 4 / 1 |
| Single-session assistant | 2 / 0 / 3 | 4 / 0 / 1 | 0 / 4 / 1 |
| Single-session preference | 1 / 3 / 1 | 1 / 4 / 0 | 1 / 4 / 0 |
| Temporal reasoning | 3 / 1 / 1 | 3 / 2 / 0 | 0 / 5 / 0 |
| Knowledge update | 5 / 0 / 0 | 4 / 1 / 0 | 0 / 5 / 0 |
| Multi-session | 2 / 2 / 1 | 3 / 1 / 1 | 1 / 3 / 1 |

## Completion and unresolved outcomes

The generation wrapper produced 27 completed case records and 3
`core_deadline` failures. A completed wrapper record does not mean every arm
answered: four of the 27 records include a Cairn `ingestion_incomplete`
outcome. The scoring wrapper completed 27 cases and blocked 3 after the core
deadlines; there were no scoring timeouts.

Cairn has seven unresolved outcomes: three capture-stage `model_timeout`
deadlines and four `ingestion_incomplete` outcomes. Of the latter, three were
capture-stage `invalid_model_output`; one was classification-stage
`invalid_model_output` with a partial batch. Later batches for these ingestion
failures were `not_run`. These are observed error labels, not explanations of
the underlying cause. In the three deadline cases, later arms were not run and
their scores were blocked.

Across the 23 completed Cairn recall runs, retrieval coverage was
`budget_exhausted` in all 23. This refers to the core traversal budget, not the
monetary ledger. The 23 rank calls received 64 input candidates in total.
Returned-rank, accepted-candidate and packed evidence-candidate counts matched
case by case: zero in five runs, one in thirteen and two in five, for 23
returned/packed candidates overall and no additional context-packing loss.
Source-session coverage was 20/40 before packing and remained 20/40 after
packing; that is not fact-level completeness. These observations do not
establish why the eight Cairn answers scored wrong.

Next work should reproduce the invalid-output boundaries offline, examine
deadline handling separately, and inspect traversal, candidate selection and
ranking bottlenecks. These are investigation priorities, not fixes or causal
findings. No further model calls are authorized by this report.

## Shared budget and final reconciliation

The prelaunch cumulative checkpoint was 6,099 requests and 48,635,560
micro-USD reserved under the shared 100,000,000-micro-USD ceiling. The frozen
30-case launch envelope was capped at 6,236 requests and 35,789,800 micro-USD
reserved. The envelope was a bound for this cohort within the existing shared
ceiling, not a separate or reset allowance.

The run added 5,362 requests and 30,753,940 micro-USD ($30.753940) reserved.
Known reported usage was 5,215,840 micro-USD ($5.215840); 2,607 requests had
null actual price and remain reserved. There were 3 newly unknown outcomes and
0 unsettled attempts. Unknown price is not a free request, and unknown outcome
count is distinct from null-price count.

The cumulative ledger checkpoint moved from 6,099 requests and 48,635,560
micro-USD before launch to 11,461 requests and 79,389,500 micro-USD after the
run, under the same 100,000,000-micro-USD ceiling. The actual reservation
remained within the cohort envelope. The v4 audit verified the original
6,051-row prefix, the prelaunch 6,099-row ledger prefix and all 55 preserved
controls remained unchanged. Reported token-priced usage is not a
provider-invoice audit.

The wrapper's exit 1 for `postrun_accounting_anomaly` is recorded separately
from the successful v4 audit exit 0, `cohort_audit_ok`. No clean wrapper exit is
claimed.

## Interpretation limits

This is a fixed 30-case, five-per-type evaluation, not a representative sample
of the 500-case benchmark. It does not establish full-benchmark accuracy,
competitor performance, broad reliability, real-user benefit, or promotion
readiness. It does not show improvement over the separate disjoint six-case
recall-observation result or revise the 12-case source-ranking screen. The
evaluator's judgments are not independent human truth, and byte hashes
establish identity rather than truth or external provenance.
