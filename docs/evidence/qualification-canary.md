# Fresh synthetic six-batch qualification canary

Status: one-shot technical evidence, not a LongMemEval score, matched quality
comparison, or release gate. The public runtime was
`31c9f183aacb28fea83e94418b6b862f4ba854da`, containing the dependent
diagnostic and qualification-wire-guidance candidates; the canary did not
isolate either change's effect. Its source and evaluator were frozen
separately before the attempt, and its one question was new rather than a
replay of S3 or N1.

## Observed path

The fictional source contained one question over six dated sessions and 24
turns. Cairn completed all six planned capture batches and retained 24 memories.
Its answer used one recalled source receipt. The matched Mem0 arm completed.
Both arms produced a nonempty answer, and each was judged correct against the
separately frozen **synthetic** reference: Cairn 1/1 correct, 0 incorrect,
0 unresolved; Mem0 1/1 correct, 0 incorrect, 0 unresolved. The common resolved
denominator is 1/1. These are per-arm facts, not a measured advantage, parity
estimate or evidence that every retained assertion is semantically supported.
Operational six-batch completion and answer scoreability are separate from
semantic reliability, source fidelity, temporal reasoning and useful recall.

N1 remains a failed one-case diagnostic: after three completed Cairn capture
batches, its fourth qualification returned a finite output-shape failure.
The earlier fixed-30 S3 attempt remains 30/30 Cairn ingestion-unresolved.
Neither was replayed or reclassified. This fresh canary does not prove that
the prompt correction caused N2's completion or would repair N1 or S3.

## Bounded accounting

This attempt used 63 guarded requests and added 420,352 micro-USD of
**conservative reservation**, not a bill. Independent aggregate ledger review
confirmed that the pre-attempt history prefix was unchanged, all 63 new
request rows settled, and the cumulative checkpoint is 17,552 requests and
114,414,670 micro-USD reserved under the unchanged 200,000,000-micro-USD
limit, with zero pending. Of the new rows, 43 have known usage estimates
totaling 47,154 micro-USD and 20 have unknown cost; known estimates are not
the total spend. No budget was replenished and this record grants no further
requests.

## Next proposed checkpoint, not yet authorized

Before another paid comparison, independently select and seal **six new
official LongMemEval cases**, one per official question-type label. Selection
must be deterministic from ID and type only, after excluding *all* previously
frozen IDs—including unexecuted holdouts—and must not use history length,
answers, evaluator labels, prior outcomes or observed cost. Freeze source and
evaluator separately; keep the same paired arms, answering model, judge,
scorer and source-only/guarded resource protocol. A new prospective resource
projection and primary-owned, reviewed one-shot launch decision under the
existing campaign authorization are prerequisites, not consequences of this
canary. This document itself grants no launch.

Retain every scheduled case and report completed capture/answer, correct,
incorrect and unresolved judgments by arm and common resolved denominator.
Six-of-six operational completion and scoreability would establish feasibility
for a larger comparison, **not** 100% accuracy or parity. Any mechanical
failure should first become an offline regression and reviewed repair, with no
replacement of the consumed case. Only after feasibility should a separate
fresh fixed-30 paired cohort be proposed under its predeclared at-least-29
per-arm and common scoreability rule; statistical, semantic, invariant and
resource gates remain distinct. Installed Hermes reliability, MOC candidate
visibility, source-supported updates/answers, and lightweight latency and
cost remain subsequent product gates.
