# Fresh official-six v3: halted generation, no score

Status: terminal generation halt, incomplete accounting settlement, and failed
mechanical and paired-scoreability gates. The [source-free aggregate artifact](../../evaluation/official-six-v3/results.json)
retains six planned cases and twelve arms on public runtime
`26a7221ec82134306ef2dfeffe11ce46fab3e6be`. Scoring never ran: there is no
`scoring.json`, resolved judgment, new correctness score or leaderboard accuracy.
An unjudged answer, mechanical failure or blocked arm is not an incorrect answer.

## Frozen method

Six new LongMemEval-S cases, one per question type, were frozen after excluding
previously frozen IDs and before cost or quality observation. Alternating first
arms gave three starts to each arm. Cairn had 295 planned capture batches.
Evaluator content was not read for generation. Memory and answer models were
`gpt-4.1-mini-2025-04-14`; the planned `gpt-4o-2024-08-06` judge was never called.
Native Mem0 2.2.0 used inferred adds, `text-embedding-3-small`, top-k 6 and
threshold 0, with graph, reranking and vision off. Cairn used `source-bound-v2`
qualification, `indexed-windows-v1`, `bounded-keyset-v1`,
`adaptive-text-catalog-v1`, and source-evidence recall with
`bounded-source-scan` selection and limit 6. These settings establish neither
MOC navigation quality nor semantic preservation.

## Retained generation observations

The global halt reason is `scope_execution_failed`; operator status is `halted`
with reason `generation_halted`. One arm completed, five failed and six were
blocked. Every scheduled position remains in the fixed six-case roster.

| Case index | Planned Cairn batches | Completed Cairn batches | Cairn outcome | Mem0 outcome |
| --- | --- | --- | --- | --- |
| 1 | 47 | 10 | Failed ingestion | Completed, answer present |
| 2 | 43 | 8 | Failed ingestion | Failed: `invalid_payload`, known-priced |
| 3 | 51 | 3 | Failed ingestion | Failed: `scope_execution_failed`, pending settlement |
| 4 | 52 | Not executed | Blocked | Blocked |
| 5 | 48 | Not executed | Blocked | Blocked |
| 6 | 54 | Not executed | Blocked | Blocked |

All three executed Cairn cases ended `ingestion_incomplete`. The first two
retain `qualification_label_canonicality`; the third retains
`qualification_slot_mapping` and `adapter_output_invalid`. These finite
diagnostics locate validation boundaries, not an exact unretained model response
or a proven root cause. Diagnosis remains ongoing. The prior prompt and
repeated-slot fixes do not establish that these failures are resolved, nor that
they share the earlier duplicate-slot defect.

No evaluator content was needed after the halt. This reporting packet performs
no oracle access or retrospective grading. The earlier
[official pilot](qualification-official-pilot.md) and
[short meaning probe](qualification-meaning-probe.md), whose full-six semantic
success was 13/24, remain separate observations with unchanged results.

## Original accounting checkpoint

The new tail contains 510 requests and 2,730,879 micro-USD of conservative
reservation. The retained prefix is 18,768 requests and 121,064,614 micro-USD;
the final checkpoint is 19,278 requests and 123,795,493 micro-USD reserved,
leaving 76,204,507 under the unchanged 200,000,000-micro-USD cap. Independent
accounting review checked the pinned prefix, exact new tail and all caps.

Only 509 requests are durably settled: 508 succeeded and one failed. Known
costs cover 403 requests and total 710,086 micro-USD. Another 106 settled count
requests have unknown costs. One embedding request remains pending with a
10-micro-USD reservation and an observed cost of 10, input usage 470 tokens and
output usage zero; its durable outcome and cost are both null. Unknown costs
therefore number 107 when the pending request is included. Observed usage does
not constitute durable settlement; reservation is not an invoice.

The ledger's `open` state supplies no permission to resume while settlement is
pending. This packet does not repair, refund, reset or otherwise alter accounting.

## Interpretation and next gates

The public artifact contains only the public runtime hash, indexed outcomes,
finite reasons and integer aggregates. It omits question, source, answer and
reference text; provider bodies and headers; IDs, namespaces, credentials,
private paths and native database contents. Integrity checks enforce exact
closed field allowlists, fixed denominators, accounting arithmetic and the
absence of fabricated scoring.

First complete offline settlement diagnosis while preserving the pending row.
The independent opt-in indexed-evidence core slice was planned before this
terminal observation: it is an experiment, not an adopted remedy or prediction
of improvement. Review any future protocol, resource projection and fresh cases
separately, only after accounting is safe. No paid dispatch, replay, replacement,
old-run resume, package publication or deployment follows from this evidence.

Source fidelity, long-history capacity, factual updates, MOC visibility,
installed Hermes/MCP behavior and lightweight latency/request/cost acceptance
remain unresolved or separate gates. Neither this halted observation nor an
offline engineering candidate permits expansion to a scored fixed-30 comparison.
