# Recall-observation pilot: retained six-case result

On 2026-09-22, the one-shot pilot completed six generation and six scoring
wrappers. That does **not** mean every arm succeeded or answered correctly:
Cairn has one unresolved arm and three wrong answers among five resolved arms.
The figures below come from a metadata-only audit whose independent replay
passed. No private source or model content is published.

## Frozen cohort and selection

The cohort contains six new cases, one from each of the six official question
types. It is disjoint from 40 previously frozen case slots, including earlier
failed and unexecuted slots. One selected case is the naturally occurring
abstention case typed `single-session-user`; it was not injected or substituted
after outcomes were known. The future exclusion set therefore contains 46
slots.

Selection was answer-blind and deterministic. For each candidate, SHA-256 ranks
the string formed by salt `cairn-recall-observation-pilot-2026-09-22:` followed
by the question ID; question type is a grouping field, not hash input. Within a
type, order is hash then ID. The first candidate from each type is taken in
fixed priority: `user`, `assistant`, `preference`, `temporal`, `update`, then
`multisession`. The monetary-prefix check applies only to those six selected
entries, with no remaining-candidate fallback or replacement. All six
fit, and execution follows prepared source order rather than rank order. No
cost- or outcome-driven substitution occurred.

The prepared input covers 287 ingestion batches, 279 represented sessions and
2,892 turns. These are workload counts, not relevant-fact coverage.

## Frozen implementation and scoring

The source bytes have SHA-256
`d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442`.
The declared upstream revision is
`98d7416c24c778c2fee6e6f3006e7a073259d48f`; this declaration and a byte hash
do not authenticate external corpus provenance.

The evaluated candidate is immutable commit
[`4bc8892f3699e24191331f75c64483f42f45fde9`](https://github.com/Cairn-ink/cairn-memory/commit/4bc8892f3699e24191331f75c64483f42f45fde9),
reviewed separately in [PR #201](https://github.com/Cairn-ink/cairn-memory/pull/201).
That runtime stack is intentionally not copied into this main-based
documentation branch. Memory and answer calls use
`gpt-4.1-mini-2025-04-14`; judging uses `gpt-4o-2024-08-06`. The official scorer
is pinned at `9e0b455f4ef0e2ab8f2e582289761153549043fc`. The answer template is
`cairn-longmemeval-public-answer-v2`, with a 123,000-token context limit, 512
output tokens, recall limit 6 and the unchanged 30-second core model deadline.

The selection policy, selected roster and prepared manifest have respective
SHA-256 digests
`37775fec366c8977eb3ad128a818948b7ce21f8db81a43a36467e3156a91ae2c`,
`920773ff98d1a0b28bded3d6b97aa699af7a23b0acd9e400ae12ff2c2e425409`
and `44c4c0a79194741154e2fb254ca7d89433bfc367f4738a306a34ee786f459909`.
The final freeze and create-once launch approval are bound by
`2e1f75ab67a615b78fa729390bf84f2d0af777e970aee204bad33572f9ceb784`
and `5635b41d43ae053e64438d791e75b7cfc77ea2ba3e7fe1a54a783bc05d421462`.

## One-shot authority and accounting boundary

Before this run, the shared ledger retained 4,849 requests and
41,514,820 micro-USD reserved under the unchanged US$50 cumulative ceiling.
Those row values and 113 older artifact files were pinned for preservation.
The round was bounded above by 1,220 requests and 7,021,960 micro-USD. A finite
request cap of 6,546 was derived from the remaining monetary authority; it is
guard plumbing, not a new user-approved request-count ceiling. There is no
ledger reset, refund assumption, failed-case retry or outcome-based rerun.

The run added 1,202 requests and 6,880,740 micro-USD reserved, ending at 6,051
requests and 48,395,560 micro-USD reserved. The remaining monetary authority was
1,604,440 micro-USD; 495 derived guard slots remained below cap 6,546. New known
reported usage was 1,176,609 micro-USD, while 584 new requests retained unknown
cost and therefore remained reserved. These are not zero-cost calls. Reported
token-priced usage is not a provider invoice audit.

All 1,202 new attempts reconciled exactly between artifacts and ledger. There
were no new unknown outcomes, unsettled attempts, reported case timeouts or
global halt; three historical unknown outcomes were not rewritten. The ordered
five-field values of the original 4,849-row prefix matched their canonical
baseline, while all 52 original control files and 113 prior artifact files were
byte-identical. The database legitimately changed for the cap and new rows.

## Outcome denominators

| Arm | Fixed cases | Resolved | Correct | Wrong | Unresolved | Accuracy among resolved |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Cairn | 6 | 5 | 2 | 3 | 1 | 2/5 (40%) |
| Full history | 6 | 6 | 4 | 2 | 0 | 4/6 (66.7%) |
| No memory | 6 | 6 | 1 | 5 | 0 | 1/6 (16.7%) |

On the five cases resolved by every arm, Cairn was 2/5 (40%), full history was
3/5 (60%) and no memory was 0/5. These are pinned model-judge/scorer verdicts,
not independent human truth. The unresolved Cairn arm remains in fixed N=6 and
is not a free successful skip.

| Question type | Cairn | Full history | No memory |
| --- | --- | --- | --- |
| `single-session-user` | Unresolved: ingestion incomplete | Correct | Correct |
| `single-session-assistant` | Correct | Correct | Wrong |
| `single-session-preference` | Wrong | Wrong | Wrong |
| `temporal-reasoning` | Wrong | Wrong | Wrong |
| `knowledge-update` | Correct | Correct | Wrong |
| `multi-session` | Wrong | Correct | Wrong |

Each type has one case, so these are not type-level reliability estimates. The
no-memory success is the natural abstention case, not retrieval value. This
cohort must not be pooled with earlier packets or presented as improvement. The
[PR #198 result](https://github.com/Cairn-ink/cairn-memory/pull/198) remains a
separate experiment.

## Recall and answer-path observations

The retained metadata separates capture admission, bounded map visibility,
selector returns, accepted/fetched rank inputs, ranker returns, final core
recall and answer-context packing. Capture recorded 283 completed/applied, two
completed/skipped and one failed observation: 286 observations against 287
planned batches. The failure was one
`extract/core_validation/invalid_extraction`; this count does not establish that
all planned batches were attempted. The affected `single-session-user` Cairn
arm never reached recall.

The other five case arrays each record two completed selection rounds, one
completed ranking call and one completed recall. Their case-level handoffs were:

| Type | Rank input → returned → packed | Reference sessions represented | Result |
| --- | --- | --- | --- |
| Preference | 2 → 1 → 1 | 1/1 | Wrong |
| Multi-session | 2 → 1 → 1 | 1/2 | Wrong |
| Temporal | 4 → 1 → 1 | 1/3 | Wrong |
| Update | 4 → 3 → 3 | 1/2 | Correct |
| Assistant | 2 → 1 → 1 | 1/1 | Correct |

All five arrays report map traversal not exhausted, selected-candidate fetch
exhausted and zero answer-packing omissions. This means selected refs were fully
fetched, not that the corpus was fully traversed. Run-level invocation/drop/
overflow fields are last-case scalar overwrites, so no aggregate no-drop claim
is made.

The planned source-prefix exposure covers 2,892 turns and 2,901 normalized
chunks; 1,245 chunks exceeded the 800-UTF-16-unit prefix, with 1,499,085 source
UTF-16 units beyond it. These are plan fields and include unattempted chunks in
the failed case, not actual stored-receipt coverage. The five Cairn answers
packed 14 receipts, five from long chunks, with 5,256 associated source UTF-16
units beyond 800. This is neither measured lost-fact evidence nor actual
stored-byte count.

Reference-session representation is not fact coverage. Multi-session represented
1/2 reference sessions and temporal 1/3, but required facts may exist elsewhere;
the counts do not prove rank reduction caused either wrong answer. Preference
represented 1/1 and was still wrong, showing representation is insufficient for
correctness. Incomplete traversal also does not mean provider tokens or money
were exhausted.

The no-memory arm receives the same conditional-insufficiency instruction with
an empty evidence array; it is not forced to emit a constant answer. The natural
abstention case can therefore pass without memory. Its outcome cannot establish
retrieval value.

Seventeen answer and 17 judge requests returned; the CLI runtime was 2,029,887ms
(about 33.8 minutes), including 2,012,790ms generation and 15,615ms scoring.

The metadata-only audit result has SHA-256
`87be8c6c1ac51d7b93b12dea5a4e86d7e754ee083d2ab698ba35a1872b46dcb9`.
Its retained output hashes are manifest
`28d8f237110c9526092d435cf608273b94cf9e26689d7fbef2ed903a4a26f40c`,
checkpoint `ab2cbd24a350ea80150724b9dce0358df851bff67e7bce505ba2c038330e48d5`,
aggregate `d989d436a30751b854645b135754e39fda553a871653f21dee7a481a5f4b502a`
and report `40a197d39c75afd3083eee51879a3a371be269ab5abf0124aab1acab42696e94`.
These hashes establish checked byte identity, not the truth of model judgments.

## Interpretation and next gate

This automatic evaluation is not an interactive Hermes end-user trial or
certification of direct MCP `remember_memory` behavior. It is not the full
benchmark, a leaderboard entry, a confidence interval, competitor certification,
PLG evidence or promotion readiness. Hashes establish byte identity, not truth,
external provenance or model execution. Better observability is not a semantic
retrieval improvement.

Next, first reproduce the extraction-validation failure path offline and verify
that diagnostics distinguish it from other ingestion failures. Separately run a
bounded joined-evidence selection/ranking experiment for multi-session evidence.
Compare the frozen baseline with the same synthetic temporal and multi-session
cases, and require no new unsupported-fact, namespace-isolation, stale-revision
or forgetting regressions. Do not assume a prompt-only repair or force every
rank candidate through. Neither investigation authorizes a paid repeat of these
cases.
