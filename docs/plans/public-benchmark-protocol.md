# Public LongMemEval-S benchmark protocol — DESIGN v1

Status: frozen **design**, not an executable run manifest, approved budget, result,
or permission to call a model. Baseline for this design is
`83a10c3b7664b1f67485a19e7d84d24dcb3041a5`. The primary dataset is the
public **cleaned LongMemEval-S full-history** variant for continuity with the
existing preparer. Original, cleaned, oracle, and V2 are distinct experiments;
never pool them or silently substitute one for another. The official repository
currently points readers toward V2; that does not change this v1 target.

## Inventory at the baseline (BP1)

| Existing entry point | What it establishes | Missing for a public score |
| --- | --- | --- |
| [`prepare:longmemeval`](../../evaluation/longmemeval/prepare.mjs), [`cli.mjs`](../../evaluation/longmemeval/cli.mjs) | Local, digest-checked, explicit-ID preparation; private, answer-blind `history.jsonl`/`questions.jsonl` separated from `evaluator.jsonl`/manifest. Six question types, original session order and source dates are retained. | No corpus acquisition, pilot selector, official scorer or live runner. The declared variant/revision is not upstream authentication. |
| [`planLongMemEvalCase` / `ingestLongMemEvalCase`](../../evaluation/longmemeval/ingestion.mjs) | Splits/normalizes turns into bounded sequential `core.capture` batches and maps derived messages back to source session, turn, offset and **session-level source date**. Stops on incomplete/unknown outcomes. | Date is source-map metadata, not an engine-visible event timestamp or a per-turn timestamp. Engine write/admission time may differ; expose both. No live provider orchestration or cost ledger for this benchmark. |
| [`runLongMemEvalComparison`](../../evaluation/longmemeval/comparison.mjs) | Offline Cairn + lexical + no-memory comparison, common answer callback/template/limits, whole-item packing and per-arm failure records. Cairn uses programmatic capture/legacy memory summary plus bounded receipt excerpt; this is not the installed MCP's explicit opt-in source-evidence startup default. | **No direct full-history arm**. Lexical is only an optional diagnostic, not its substitute. No full-context fit check against an actual provider, isolated-case lifecycle owner, or guarded live runner. The primary Cairn evidence mode must be chosen and implemented explicitly. |
| [`scoreLongMemEvalComparison`](../../evaluation/longmemeval/scoring.mjs) | Evaluator-only exact-match diagnostic and optional `{correct,incorrect,unknown}` judge; reference-session retrieved/packed coverage and unknown outcomes are retained. | Neither diagnostic nor custom judge is official LongMemEval accuracy. Its judge input lacks `question_type`/`_abs` identity required by the upstream rubric. No official-compatibility adapter, aggregate bounds or reviewed judge transport. |
| [`evaluation/experiment-budget`](../../evaluation/experiment-budget/index.mjs) and [`request-guard.mjs`](../../evaluation/experiment-budget/request-guard.mjs) | General reservation/reconciliation mechanisms exist. | Not bound to all LongMemEval ingestion, maintenance, retrieval, answer and judge calls. The comparison's reported usage is **answer callback only** (`comparison.mjs`); it is not whole-pipeline cost. |

The existing [preparation](benchmark-preparation.md),
[ingestion](../longmemeval-ingestion.md), and
[comparison](../longmemeval-comparison.md) records include successful **offline
synthetic** tests/demos and a prior seven-case format inspection of real S data.
They contain no live seven-case pilot, full-500 answer run or benchmark score.
The prior first-in-source-order format subset is not the selection rule below.

## Frozen target and pre-call pins (BP2)

The [preparation verification record](benchmark-preparation.md#verification-record)
pins cleaned S at upstream revision
`98d7416c24c778c2fee6e6f3006e7a073259d48f`, file SHA-256
`d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442`
and 277,383,467 bytes; its Hugging Face LFS metadata has been independently
rechecked. This is a pinned public snapshot, **not** a currently acquired or
locally rehashed run input. Before any paid request, review an executable run
manifest that rechecks the local file hash and names the exact dataset revision,
variant, preparation artifact hashes, case count/order and license/provenance
check. The manifest must also pin the official
scorer source commit, local compatibility-adapter commit, rubric/prompt hash,
parser and serialization policy; provider and exact model IDs/revisions for
capture, classification, maintenance, retrieval/ranking, answering and judging;
all prompts, tokenizer/version, context and output limits, timeouts, prices,
reservation ceilings, and actual pilot IDs. Unknown fields remain `unverified`,
never guessed into a runnable value. Any change to a pin requires a new manifest
and separate labeled run, not an in-place result edit.

Upstream reference to test against: immutable
[`src/evaluation/evaluate_qa.py` at `9e0b455f4ef0e2ab8f2e582289761153549043fc`](https://github.com/xiaowu0162/LongMemEval/blob/9e0b455f4ef0e2ab8f2e582289761153549043fc/src/evaluation/evaluate_qa.py).
Its typed prompts distinguish temporal, preference and knowledge-update cases
and `_abs` abstention; its answer serialization and yes/no parsing must be
reproduced in compatibility tests. Document model availability and any deviation
from its specified judge model/settings, including temperature and output cap.
Compare aggregate reporting with immutable
[`print_qa_metrics.py` at the same commit](https://github.com/xiaowu0162/LongMemEval/blob/9e0b455f4ef0e2ab8f2e582289761153549043fc/src/evaluation/print_qa_metrics.py):
overall micro, task macro and abstention overlay are different denominators.
Do **not** execute upstream retry/backoff behavior as-is: transport must be
bounded, guarded and fail closed. A self-authored semantic judge remains a
separate metric until equivalence is demonstrated; label deviations, never call
them official accuracy.

## Planned paired arms and isolation (BP3)

For each case run three primary arms: **Cairn**, **full session-dated source
history**, **no memory**. Use the same stateless answer model, frozen instruction
and question serialization, question date, output cap and provider parameters.
The evidence field is the only intended difference. Answer callback state,
conversation continuation, cached prior answers and case stores may not cross
arms/cases. Use fresh per-case namespaces and stores; retain source-to-receipt
maps. Lexical may run as a fourth, explicitly diagnostic arm, never as the
full-history control.

The primary Cairn arm will use an explicit source-evidence mode in the later
harness, with exact core/MCP boundary and prompt pinned; the current legacy
summary/receipt path may be retained only as a labeled diagnostic. This is a
design choice, **not** behavior already implemented by the comparator. The
direct-history arm includes every original turn in source session order,
with roles and its session's **source date** (`haystack_dates`); LongMemEval-S
does not supply a separate timestamp for each turn. Preflight its complete wire request with
the exact answer-model tokenizer and context window, including framing and
reserved output. If it does not fit, mark the primary paired case **blocked**;
do not silently truncate, select oracle evidence, or call a shortened history
“full.” A context-blocked case remains in the fixed denominator, not removed
from the run. A separately named truncated-history sensitivity analysis may be
designed later, but cannot replace the primary arm. Record whether dataset
order and date strings agree chronologically; preserve MOC admission/filing
order, source occurrence indices, and any divergence. The engine's stored
write/admission timestamp is not the dataset's source session date. Disclose both
and test temporal cases for that mismatch. Identical output caps and model do
not imply matched input token counts, bytes, costs or latency; disclose them
by arm. Do not inject a question into capture
or pass evaluator labels, reference answers, answer-session IDs, `_abs`-bearing
original IDs, or scoring artifacts to generation.

## Selection, reporting and scoring (BP4)

The plumbing pilot is exactly seven cases: one from each of the six non-abstention
question types (`single-session-user`, `single-session-assistant`,
`single-session-preference`, `temporal-reasoning`, `knowledge-update`,
`multi-session`) plus one abstention case. Use the original dataset
`question_id` (the preparer's evaluator-only `source_question_id`), **not** its
opaque model-facing `question_id`, for selection. Original IDs ending `_abs`
form the abstention stratum; exclude them from the six type strata. From the
pinned dataset's evaluator metadata only, within each stratum select the
minimum lexicographic `SHA-256(UTF-8(JSON.stringify([seed, source_question_id])))`,
with original `source_question_id` as tie-breaker and fixed seed
`cairn-lme-s-pilot-v1`,
excluding the seven previously inspected format cases named in the
[preparation record](benchmark-preparation.md#verification-record). Freeze an
exposure registry (including those IDs), selected original IDs, strata,
the output order (the six types listed above, then abstention), dataset digest
and selection code before calls. IDs are **not frozen
here** because this turn does not acquire/revalidate a corpus. No answer or outcome can influence
selection. This is a plumbing pilot, neither an accuracy estimate nor a
pristine holdout; no score claim follows from it.

After a reviewed pilot and separate authorization, the fixed full-S run must
report all 500 cases, including pilot overlap flagged by ID; never hide failed
pilot cases or silently replace them. Keep a separately identified untouched
analysis slice for exploratory error analysis, while disclosing that a full-500
run necessarily includes pilot and previously exposed cases and is not a
pristine holdout. Any tuning
after pilot must be versioned and cannot be retrospectively applied to its
outcomes.

Use a tested official-compatibility adapter before an official-style accuracy
claim. The intended fixed N is seven for the pilot and 500 for the full run,
including blocked and failed cases; do not redefine eligibility after seeing
outcomes. Report conditional accuracy **only among resolved judge decisions** with
the numerator and denominator, plus coverage over every intended case. Count
`correct`, `incorrect`, judge `unknown`/failed/timeout, generation failed,
ingestion/retrieval failed, context blocked, and safety blocked separately for
each arm and question type. For fixed N, report conservative bounds
`correct/N` and `(correct + unresolved)/N`, where unresolved includes every
non-resolved intended case; these are bounds, not a substitute for accuracy.
Do not silently exclude unknowns or automatically mark them incorrect. Report
retrieved and packed evidence-session coverage separately from answer quality.
Retain per-case status, attempts, source/answer hashes and blinded generation
artifacts; release only reviewed/redacted material permitted by dataset terms.

## Cost, safety and decision gates (BP5–BP6)

Estimate and observe time, tokens and money by stage: ingestion/extraction,
classification and MOC/maintenance, retrieval/ranking, answer generation for
each arm, and judging. Include failed/blocked calls and preflight overhead;
distinguish provider usage from local estimates and null from zero. Reserve a
priced worst-case amount and request count **before each model call** under an
exact new cap and manifest. Stop on uncertain charge or missing reconciliation;
do not rerun a failed case to improve its score. The historical US$50 ceiling
is **not** a fresh budget. This turn authorizes **zero paid calls**. Live work
remains blocked until the remaining budget, exact new cap, provider prices and
guard binding are independently checked and the manifest is reviewed.

Product semantic-decision tests (useful, source-supported answers, temporal
correctness and abstention) are separate from this public QA metric. Namespace
leak, unsourced promotion, deletion/forgetting failure and receipt mismatch are
hard safety gates, not errors averaged into accuracy. No arbitrary 100% QA
threshold or public superiority claim follows from this design.

Next deliver an offline comparator/scorer PR (full-history arm, explicit Cairn
evidence mode/date disclosure, official-compatibility adapter) and verify it
with fakes on both Node lines. A separate live-guard/accounting PR then proves
all-stage reservations and a manifest dry run without provider calls. Review
the actual manifest and only then authorize a seven-case pilot; a full run and
decision need their own approval. Claude #180 Track B reviews this pinned
design; independent cold Track A is a different task, not evidence supplied
by this packet. No provider, corpus or production action belongs to this PR.

## Packet acceptance and verification

BP1 is the code-linked inventory above; BP2 the pinned design versus missing
run manifest; BP3 the three primary arms and source-time/isolation rules; BP4
the preselected pilot and fixed-denominator reporting; BP5 the all-stage
fail-closed cost/safety gates; BP6 the staged delivery and separate Track A/B
reviews. Documentation owner: benchmark-protocol worker. The primary owns
upstream verification, diff acceptance and two independent fixed-base review
axes. Local verification is offline only: `npm run test:longmemeval`,
`npm test`, `npm run validate`, and both synthetic LongMemEval demos on Node
22.16.0 and 24.15.0. This candidate passed 40/40 LongMemEval tests and
106/106 generic tests on each runtime; JSON/version validation and both demos
also passed on each. The demos retained only synthetic SQLite files under
`/tmp`; no real corpus, credentials or paid provider requests were used. None
of these checks is a benchmark score. Implementation routing: Sol/high worker
for this bounded documentation packet, with primary architecture and external
source verification; elapsed time and model token cost are not measured here.
