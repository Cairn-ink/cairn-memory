# Fresh six-type qualification pilot

Status: **terminal, non-halted, but mechanically incomplete and not scoreable
as a paired comparison**. Generation, scoring, and aggregate accounting were
reviewed after the one-shot run. This six-case observation is not a leaderboard
score, parity estimate, product reliability guarantee, or authorization for
another run.

## Frozen method

Six new official LongMemEval cases were selected, one per official question
type. Selection used question ID and type only, with every previously frozen ID
excluded, including unexecuted holdouts. The six-case roster and its future
exclusion union were sealed before source preparation or cost observation. The
source and evaluator were prepared separately; evaluator content was not used
to choose cases or generate answers. The public runtime was
`31c9f183aacb28fea83e94418b6b862f4ba854da`.

The comparison retains the Cairn and Mem0 arms, the frozen answer/judge
procedure, and official-style scorer. Cairn memory and both arms' answers use
`gpt-4.1-mini-2025-04-14`; the judge uses `gpt-4o-2024-08-06`. Native Mem0
2.2.0 uses the same memory-model ID, `text-embedding-3-small` embeddings,
inferred adds, top-k 6 and threshold 0, with graph, reranking and vision off.
Cairn uses `source-bound-v2` qualification, `indexed-windows-v1` capture,
`bounded-keyset-v1` source candidates, and source-evidence recall with
`bounded-source-scan` selection and limit 6. These settings do not prove MOC
navigation quality. First-arm order alternates by prepared-case index, three
starts per arm. All six scheduled cases remain in the denominator, with no
replacement or replay of a failed case. A completed capture, a nonempty
answer, a resolved judgment, and correctness are separate observations.

## Terminal observations

The runner completed without a global halt, but none of the six Cairn cases
completed ingestion or produced an answer. Mem0 completed all six and produced
six answers. The official-style scorer retained all six scheduled positions;
unresolved Cairn cases are **not** incorrect semantic judgments.

| Observation | Cairn | Mem0 |
| --- | --- | --- |
| Completed ingestion, out of six | 0 / 6 | 6 / 6 |
| Nonempty answers, out of six | 0 / 6 | 6 / 6 |
| Correct / incorrect / unresolved judgments | 0 / 0 / 6 | 4 / 2 / 0 |
| Resolved denominator | 0 / 6 | 6 / 6 |

The common resolved denominator is **0 / 6**. Mem0's four correct answers are
a fixed-small-pilot observation, not a general accuracy estimate or a matched
quality advantage over an unscoreable Cairn arm. Mechanical completion and
paired scoreability both failed.

All six Cairn cases ended `ingestion_incomplete`. Four reached
`context_budget_exceeded` at the `qualifyCandidates` core-call boundary:
three on their first capture batch and one after two completed batches. Two
reached `invalid_model_output` with the finite qualifier-adapter diagnostic
`qualification_slot_mapping`, followed by `adapter_output_invalid`, after
three and two completed batches respectively. Seven Cairn capture batches
completed in total, but no case completed its full ingestion. These are
observed boundaries, not the exact unretained provider response or a proven
underlying cause. No consumed case was retried or replaced.

## Bounded accounting

Independent aggregate review confirmed the unchanged prior ledger prefix and
the exact new tail: 976 new attempts, all settled with none pending. They
added 5,582,424 micro-USD of **conservative reservation**. Of those attempts,
947 have known usage estimates totaling 1,660,802 micro-USD; 29 have unknown
cost. The cumulative checkpoint is 18,528 requests and 119,997,094 micro-USD
reserved under the unchanged 200,000,000-micro-USD shared cap, leaving
80,002,906 micro-USD of reservation headroom. No cap or protected-floor breach
was found. Reservation is not an invoice, and known usage is not total spend
when some costs are unknown.

## Interpretation and next gate

The earlier [fixed-30 S3 and N1 failures](../limitations.md) remain unchanged;
the [N2 synthetic canary](qualification-canary.md) was a separate one-question
technical check, not a paired control for these six official cases. This
pilot's result cannot by itself establish semantic source support, useful
recall, installed Hermes reliability, MOC candidate visibility, or lightweight
latency/request/cost acceptance.

This mechanical failure blocks expansion to a fresh fixed-30 comparison.
First isolate the context-fit and qualification-slot boundaries with synthetic
offline falsifiers, then independently review any product correction before a
new, separately frozen probe. Do not retry or replace these consumed cases.
Only after both arms complete and become scoreable in a fresh feasibility
pilot should a separate fixed-30 comparison be assessed under its existing
at-least-29-per-arm and common scoreability rule. Statistical, semantic,
resource, and invariant gates remain distinct. This page supplies neither
that cohort nor launch authority.
