# Public LongMemEval-S benchmark protocol — DESIGN v1

Status: reviewed **design draft**, not yet frozen; it is not an executable run
manifest, approved budget, result, or permission to call a model. The B1
identifier leak and the other preflight gates below must be resolved before a
live freeze. Baseline for this design is
`83a10c3b7664b1f67485a19e7d84d24dcb3041a5`. The primary dataset is the
public **cleaned LongMemEval-S full-history** variant for continuity with the
existing preparer. Original, cleaned, oracle, and V2 are distinct experiments;
never pool them or silently substitute one for another. The official repository
currently points readers toward V2; that does not change this v1 target.

## Inventory at the baseline (BP1)

| Existing entry point | What it establishes | Missing for a public score |
| --- | --- | --- |
| [`prepare:longmemeval`](../../evaluation/longmemeval/prepare.mjs), [`cli.mjs`](../../evaluation/longmemeval/cli.mjs) | Local, digest-checked, explicit-ID preparation; `history.jsonl`/`questions.jsonl` separated from `evaluator.jsonl`/manifest. Six question types, original session order and source dates are retained. | **Raw session IDs are currently model-facing and may encode answer labels**; the prepared history is not yet answer-blind. No corpus acquisition, frozen stratified selector or official scorer. The declared variant/revision is not upstream authentication. |
| [`planLongMemEvalCase` / `ingestLongMemEvalCase`](../../evaluation/longmemeval/ingestion.mjs) | Splits/normalizes turns into bounded sequential `core.capture` batches and maps derived messages back to source session, turn, offset and **session-level source date**. Stops on incomplete/unknown outcomes. | Date is source-map metadata, not an engine-visible event timestamp or a per-turn timestamp. Engine write/admission time may differ; expose both. No benchmark-specific all-stage cost ledger. |
| [`runLongMemEvalComparison`](../../evaluation/longmemeval/comparison.mjs) | Offline Cairn + **mandatory lexical** + no-memory comparison, common answer callback/template/limits, whole-item packing and per-arm failure records. Cairn uses programmatic capture/legacy memory summary plus bounded receipt excerpt; this is not the installed MCP's explicit opt-in source-evidence startup default. | **No direct full-history arm**. Lexical must become optional or remain a separately labeled mandatory diagnostic in a new harness; it is not the full-history substitute. No protocol-compliant full-context preflight or new three-primary-arm runner. The primary Cairn evidence mode must be chosen and implemented explicitly. |
| [`scoreLongMemEvalComparison`](../../evaluation/longmemeval/scoring.mjs) | Evaluator-only exact-match diagnostic and optional `{correct,incorrect,unknown}` judge; reference-session retrieved/packed coverage and unknown outcomes are retained. | Neither diagnostic nor custom judge is official LongMemEval accuracy. Its judge input lacks `question_type`/`_abs` identity required by the upstream rubric. No official-compatibility adapter, aggregate bounds or reviewed judge transport. |
| [`evaluation/live/pilot.mjs`](../../evaluation/live/pilot.mjs) and [retained first live evidence](../evidence/first-live-evidence.md) | A strict prepared-pilot reader, per-case stores, checkpointed generation then judging, and Cairn/lexical/no-memory orchestration exist. A different, unchanged seven-case pilot ran on 2026-09-09: Cairn completed 3/7 and failed ingestion on 4/7, with two observed judge false positives. | No direct full-history primary arm; mandatory lexical and concurrent generation. The legacy pilot is not a protocol-compliant three-primary-arm guarded benchmark or an official score. Its strict prepared-artifact reader must be migrated when session IDs are blinded; its seven source IDs belong in the exposure registry. |
| [`evaluation/experiment-budget`](../../evaluation/experiment-budget/index.mjs) and [`request-guard.mjs`](../../evaluation/experiment-budget/request-guard.mjs) | General reservation/reconciliation mechanisms exist and the legacy pilot had a guarded session. | Not bound to this new protocol's all-stage, distinct-model channels. The comparison's reported usage is **answer callback only** (`comparison.mjs`); it is not whole-pipeline cost. |

The existing [preparation](benchmark-preparation.md),
[ingestion](../longmemeval-ingestion.md), and
[comparison](../longmemeval-comparison.md) records include successful **offline
synthetic** tests/demos and a prior seven-case format inspection of real S data.
The separately retained [first live evidence](../evidence/first-live-evidence.md)
is a failed legacy seven-case pilot on an earlier engine/adapter; preserve its
outcomes, but do not reinterpret them as this baseline's protocol or a score.
No new live run on baseline `83a10c3b7664b1f67485a19e7d84d24dcb3041a5`,
full-500 answer run or official benchmark score is established here. The prior
first-in-source-order format subset is not the selection rule below.

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
parser and serialization policy, opaque-session-ID derivation and mapping scope;
provider and exact model IDs/revisions for
capture, classification, maintenance, retrieval/ranking, answering and judging;
all prompts, capture mode, tokenizer/version, context and output limits, exact
wire serialization, timeouts, prices, reservation ceilings, actual pilot,
development and evaluation IDs, and exposure registry. The actual provider
context window remains `unverified` until checked against the chosen model.
Unknown fields remain `unverified`, never guessed into a runnable value. Any
change to a pin requires a new manifest
and separate labeled run, not an in-place result edit.

Upstream reference to test against: immutable
[`src/evaluation/evaluate_qa.py` at `9e0b455f4ef0e2ab8f2e582289761153549043fc`](https://github.com/xiaowu0162/LongMemEval/blob/9e0b455f4ef0e2ab8f2e582289761153549043fc/src/evaluation/evaluate_qa.py).
Its typed prompts distinguish temporal, preference and knowledge-update cases.
Compatibility requires the exact upstream abstention predicate
`'_abs' in question_id` (substring, not suffix), and the yes parser
`'yes' in eval_response.lower()` (also substring). The specified judge is
`gpt-4o-2024-08-06` with `temperature=0`, `max_tokens=10`, and `n=1`;
pin availability and any deviation. The upstream aggregate script asserts
this model ID. With another model, label the result “official protocol,
substituted judge,” not official accuracy. Its reference/hypothesis formatting
uses Python `str()` on the source JSON value (for example `['a', 'b']` and
`3.0`), not JavaScript `JSON.stringify` or `String`. Test exact equivalence
for every answer type present in the pinned data. If preparation discarded a
numeric representation needed to reproduce that output, compatibility remains
`unverified` and blocks an official-style claim; do not invent the lost form.
Compare aggregate reporting with immutable
[`print_qa_metrics.py` at the same commit](https://github.com/xiaowu0162/LongMemEval/blob/9e0b455f4ef0e2ab8f2e582289761153549043fc/src/evaluation/print_qa_metrics.py):
overall micro, task macro and abstention overlay are different denominators;
question-type buckets include `_abs` cases, with abstention also reported as
an overlay. Upstream skips missing hypotheses, so its raw accuracy can use a
smaller submitted denominator. Do not insert a fake failure sentinel: on
abstention items that can be judged correct. Until every intended case has a
valid, resolved hypothesis/judgment and exact compatibility is proved, the
official complete-run figure is blocked; report only the conditional result
and the fixed-N bounds below.
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
maps. Serialize arms rather than running them concurrently for interpretable
per-arm latency, with the order pinned before calls. Lexical may run as a
fourth, explicitly diagnostic arm, never as the full-history control; the
baseline comparator currently requires it, so making it optional is future
harness work, not existing behavior.

The primary Cairn arm will use an explicit source-evidence mode in the later
harness, with exact core/MCP boundary, capture mode and prompt pinned; the
current legacy
summary/receipt path may be retained only as a labeled diagnostic. This is a
design choice, **not** behavior already implemented by the comparator. The
direct-history arm includes every original turn in source session order,
with roles and its session's **source date** (`haystack_dates`); LongMemEval-S
does not supply a separate timestamp for each turn. Use compact, versioned
**session-block** serialization (one dated block per session, ordered turns
inside it), not the baseline comparator's per-turn JSON-item framing; pin the
exact bytes, role/date separators and escaping in the run manifest. Preflight
the complete wire request with the exact answer-model tokenizer and its
verified provider context window, including framing and reserved output.
An unverified window blocks the manifest. If it does not fit, mark the
primary paired case **context blocked** and report that count as a headline
figure per arm next to the conditional score; do not silently truncate, select
oracle evidence, or call a shortened history
“full.” A context-blocked case remains in the fixed denominator, not removed
from the run. A separately named truncated-history sensitivity analysis may be
designed later, but cannot replace the primary arm. Record whether dataset
order and date strings agree chronologically using the pinned dataset's
`YYYY/MM/DD (Day) HH:MM` session-date representation; preserve MOC
admission/filing order, source occurrence indices, and any divergence. For v1,
**do not inject source dates into Cairn capture or recall as engine time**:
source dates are answer-evidence metadata only, while the question date is
included in the retrieval query as well as the common answer request. Thus
temporal cases measure a **source-time-unaware engine**, not native temporal
memory. The engine's stored write/admission timestamp is not the dataset's
source session date; disclose both and test the mismatch. Identical output caps
and model do
not imply matched input token counts, bytes, costs or latency; disclose them
by arm. Before a live freeze, replace each raw `haystack_session_id` in
model-facing prepared history, evidence, source catalogs and answer requests
with an opaque **per-occurrence** identifier derived from the opaque prepared
case identity and session index, not from a label-bearing raw ID; retain the
raw-ID mapping only
in evaluator-only artifacts. The same occurrence must have one consistent
opaque ID across arms and source maps. Test noninterference by changing only
raw label-bearing session IDs while keeping bodies, roles, dates and occurrence
positions fixed: every model-facing artifact and request must remain identical.
Also assert that raw session IDs never appear as metadata in these artifacts;
unchanged source prose may naturally spell an ID and must remain verbatim. Identifier
tests may check label substrings in identifiers, but must **not** ban ordinary
words such as “answer” from user/assistant content. Do not inject a question
into capture or pass evaluator labels, reference answers, raw session IDs,
answer-session IDs, `_abs`-bearing original IDs, or scoring artifacts to
generation. The current preparer/comparator does not satisfy this gate.

## Selection, reporting and scoring (BP4)

The plumbing pilot is exactly seven cases: one from each of the six non-abstention
question types (`single-session-user`, `single-session-assistant`,
`single-session-preference`, `temporal-reasoning`, `knowledge-update`,
`multi-session`) plus one abstention case. Use the original dataset
`question_id` (the preparer's evaluator-only `source_question_id`), **not** its
opaque model-facing `question_id`, for selection. Original IDs containing `_abs`
form the abstention stratum; exclude them from the six type strata. From the
pinned dataset's evaluator metadata only, within each stratum select the
minimum lexicographic `SHA-256(UTF-8(JSON.stringify([seed, source_question_id])))`,
with original `source_question_id` as tie-breaker and fixed seed
`cairn-lme-s-pilot-v1`, excluding **all content-inspected cases** in the
exposure registry, including the seven previously inspected format cases named
in the [preparation record](benchmark-preparation.md#verification-record). That
record also mentions 13 duplicate-session instances; their IDs and whether
their contents were inspected must be verified and registered before selection
is frozen. Register the seven prior live-pilot IDs from the retained evidence
as exposed, too. This document does not inspect the corpus to resolve the
duplicate-session scope. Before any model call, freeze three disjoint original-ID sets: the seven-case
pilot, a development set whose contents may be inspected/tuned against, and an
evaluation set never inspected/tuned against. Freeze the complete exposure
registry, selected IDs, strata, output order (the six types listed above, then
abstention), dataset digest and selection code at the same time. Incomplete
exposure accounting blocks the freeze. IDs are **not frozen here** because
this turn does not acquire/revalidate a corpus. No answer or outcome can
influence
selection. This is a plumbing pilot, neither an accuracy estimate nor a
pristine holdout; no score claim follows from it.

After a reviewed pilot and separate authorization, the fixed full-S run must
report all 500 cases, including pilot overlap flagged by ID; never hide failed
pilot cases or silently replace them. A full-500 run necessarily includes
pilot and previously exposed cases and is not a pristine holdout. Report its
figure and a separately denominated evaluation-only figure; evaluation-set
outcomes can be analyzed only after that set's frozen run, at which point it
is no longer untouched. Disclose possible training-data contamination by
public benchmark material; an uninspected local split does not establish
model pretraining independence. Any tuning after pilot must be versioned and
cannot be retrospectively applied to its
outcomes.

Use a tested official-compatibility adapter before an official-style accuracy
claim. The intended fixed N is seven for the pilot and 500 for the full run,
including blocked and failed cases; do not redefine eligibility after seeing
outcomes. Report conditional accuracy **only among resolved judge decisions** with
the numerator and denominator, plus coverage over every intended case. Count
`correct`, `incorrect`, judge `unknown`/failed/timeout, generation failed,
ingestion/retrieval failed, context blocked, and safety blocked separately for
each arm and question type, with `_abs` cases included in their type buckets
and also shown as a separate abstention overlay **for every arm**. The
no-memory abstention overlay may be trivially high under its “I do not know”
instruction; do not present it as evidence of memory quality. For fixed N,
report conservative bounds
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
distinguish provider usage from local estimates and null from zero. The
manifest needs separately guarded extract, classify, select, rank, maintenance,
answer (each arm), and judge channels, with each channel's actual model and
pricing; the existing three-channel guard cannot bind this benchmark's
different judge model and is **not** live authority. Before any pilot approval,
run an entirely offline manifest dry run with the local `o200k_base` tokenizer:
emit per-stage and per-arm request-count and input/output-token estimates,
including worst-case ceilings, with no provider call. These are estimates,
not observed usage or permission to spend. Reserve a priced worst-case amount
and request count **before each model call** under an
exact new cap and manifest. Stop on uncertain charge or missing reconciliation;
allow exactly **one attempt per stage call**, including one judge verdict,
with no upstream retry/backoff and the same policy across arms. Do not rerun a
failed case to improve its score. Disclose the answer and judge model identities
separately, including any self-judging overlap or bias. The historical US$50
ceiling
is **not** a fresh budget. This turn authorizes **zero paid calls**. Live work
remains blocked until the remaining budget, exact new cap, provider prices and
guard binding are independently checked and the manifest is reviewed.

Product semantic-decision tests (useful, source-supported answers, temporal
correctness and abstention) are separate from this public QA metric. Namespace
leak, unsourced promotion, deletion/forgetting failure and receipt mismatch are
hard safety gates, not errors averaged into accuracy. No arbitrary 100% QA
threshold or public superiority claim follows from this design. A successful
run could support only a claim about a **nondefault programmatic Cairn
configuration** with its exact capture mode and explicit source-evidence
retrieval; it does not establish the installed local client's default behavior.
The common answer instruction, evidence format and reading method differ from
the paper's generation setup, so even an official-compatible judge does not
make these arm scores directly comparable to the paper's tables.

Next deliver an offline comparator/scorer PR (opaque occurrence IDs and
noninterference test, full-history arm, explicit Cairn evidence mode/date
disclosure, official-compatibility adapter, and optional lexical arm) and verify
it
with fakes on both Node lines. A separate live-guard/accounting PR then proves
all-stage reservations and a manifest dry run without provider calls. Review
the actual manifest and only then authorize a seven-case pilot; a full run and
decision need their own approval. Claude #180 Track B reviews this pinned
design; independent cold Track A is a different task, not evidence supplied
by this packet. No provider, corpus or production action belongs to this PR.

## Packet acceptance and verification

Issue #180 Track B dispositions: B1 blocks freeze until opaque occurrence IDs
and noninterference pass; B2 fixes a source-time-unaware v1 rather than claiming
temporal memory; B3 fixes substring parsing, Python-format/model parity and
blocks complete-run official accuracy on unresolved cases (no fake sentinel);
B4 requires a complete exposure registry and disjoint pre-call partitions;
B5 requires new channels and an offline token/request dry run; B6 pins compact
session blocks and gates on a verified provider window; B7 pins capture mode
and limits product/paper claims; B8 makes one-shot calls and serialized arms
explicit while distinguishing current mandatory lexical from future optional
lexical. No finding is evidence that those implementation gates already pass.

BP1 is the code-linked inventory above; BP2 the pinned design versus missing
run manifest; BP3 the three primary arms and source-time/isolation rules; BP4
the preselected pilot and fixed-denominator reporting; BP5 the all-stage
fail-closed cost/safety gates; BP6 the staged delivery and separate Track A/B
reviews. Documentation owner: benchmark-protocol worker. The primary owns
upstream verification, diff acceptance and two independent fixed-base review
axes. The primary reran offline verification on this revised three-document
working-tree candidate on Node 22.16.0 and 24.15.0: `npm run
test:longmemeval` (40/40 each), `npm test` (106/106 each), `npm run
validate`, `npm run demo:longmemeval-ingestion`, `npm run
demo:longmemeval-comparison`, and strict plugin validation all passed. The
previous candidate's verification does not substitute for these reruns. The
demos retained only synthetic SQLite files under `/tmp`; no real corpus,
credentials or paid provider requests were used. None of these checks is a
benchmark score. Implementation routing: Sol/high worker
for this bounded documentation packet, with primary architecture and external
source verification; elapsed time and model token cost are not measured here.
