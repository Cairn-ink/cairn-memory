# Small-candidate retention inside ordinary MOC: results

Status: once-only synthetic comparison completed. **No default promotion.**
Both arms retrieved23 of36 required source passages. No required passage was
lost after selection in either arm; the remaining omissions were upstream of
ranking. Skipping small-set ranking reduced calls but did not establish better
memory fidelity. Complete-source answers also retained obsolete reasons or
strengthened tentative choices.

## Frozen scope and execution

The [protocol](retention-moc-comparison.md) used six fresh histories, three
matched pairs, three capture windows each, including Traditional Chinese.
Source HEAD was `a4d7571956db7394d179cd42375a4fca93c55c10` (PR129).
Capture, candidate qualification, classification and selection were ordinary
source-built MCP operations. Only the candidate rank port changed. There was
no trusted admission, forced candidate size, transcript-to-recall substitution
or replay of one arm's selection into the other.

All18 captures,16 recalls and22 answer slots completed: six baseline, six
candidate, six separately labelled complete-canonical controls and four negative
answers. All52 MCP children closed normally;32 complete ordered before/after
store snapshots matched their final cold snapshots. Final pins matched,
cleanup failures were empty, and no request remained unsettled. These are
execution checks, **not22 accurate answers**.

Root verification included19 fake-provider failure/success scenarios on each of
Node22.16 and24.15, actual MCP child processes, independent operator reviews,
credential/replay VM tests and all17 source-PR CI checks. Offline faults and
test-harness fixes preceded the paid run; no scored response was regenerated.
The final raw report SHA256 is
`6933b6570bba5de737457f3b4a18456989f477ae2e65160bd18bd36777f61b61`.
Its frozen live manifest SHA256 is
`9ad2911b2a98db0b90bf068f849f566b33130d3d7026bcbc2d6ba93906562be7`.

## Where evidence was lost

All108 submitted messages were staged. Every history reached15 admitted
memories with receipts for its15 user messages; all36 required passages were
admitted. The12-memory complete-source snapshot correctly rejected these larger
sets with `context_item_too_large`; it did not silently return a partial set.
Controls used explicitly constructed canonical sources, not that failed snapshot.

Both arms' navigation maps exposed references to all15 memories per history,
including all required passages. **Reference visibility is not full-text
visibility:** the selector saw bounded navigation labels. For example, the
`r01a-w2m2` label ended at “the metal stand's package”, before the decisive
longer-than comparison. This is an observed information boundary, not proof
that label clipping alone caused every omission.

Each history required six source IDs. The following counts are exact source
membership, not semantic scores:

| History | Rank candidates baseline / candidate | Required selected → final, baseline / candidate | Ordered rank inputs |
| --- | --- | --- | --- |
| r01a | 3 /4 | 3→3 /4→4 | Different membership |
| r01b | 4 /3 | 4→4 /3→3 | Different membership |
| r02a | 4 /4 | 4→4 /4→4 | Identical |
| r02b | 3 /3 | 3→3 /3→3 | Identical |
| r03a | 6 /6 | 5→5 /5→5 | Different order |
| r03b | 5 /5 | 4→4 /4→4 | Identical |

Thus both arms missed13 required passages before ranking. All decisive choice
qualifiers were retrieved, but the English histories omitted the premise-changing
`w2m2`; both lantern histories and both Chinese histories also omitted the later
reaffirmation `w3m2`. No baseline regular rank removed an already-selected
required passage. The r01a gain and r01b loss of `w3m5` came from different
selection outputs, not evidence of the rank policy helping or harming retention.

Each history admitted and exposed six explicitly rubric-labelled irrelevant
user passages; none reached either regular arm's final answer input. Other
unlabelled passages, such as earlier separate-actor context, are not automatically
relevant or irrelevant. The candidate was applicable to all eight actual recall
sets (limit6); larger-set fallback was exercised offline, not in this paid run.

## Content review of all22 answers

The root and two additional reviewers read every actual input and answer against
the frozen history/rubric. They distinguished an answer's support in its supplied
evidence from omissions or contradictions relative to the complete history.
The main findings agreed; smaller wording concerns remain qualified below.

| History | Baseline and candidate | Complete-source control |
| --- | --- | --- |
| r01a | Both preserve provisional choice and Owen's separate ownership, but assert that shorter packing still applies. Neither received the reversal or renewed steadiness test. | Receives both updates yet says both old reasons still apply, using a steadiness retest to support packing length too. “Provisional but seems fairly settled” amplifies the qualifier. |
| r01b | Both preserve firm choice and actor separation but incorrectly carry shorter packing forward. | Still says shorter packing is an applicable reason despite the contrary supplied measurement. |
| r02a | Both receive identical sources and say original reasons remain valid, although tray-fit failure is absent. Clean detachment alone does not confirm tray fit. | Correctly separates lost tray fit from reaffirmed clean detachment and retains tentative choice. “Supporting continued use” is reasonable synthesis, not a separately recorded new motive. |
| r02b | Baseline accurately dates the original reasons but leaves current changes unanswered. Candidate, with the same source view, instead says the reasons “remain unchanged.” This answer difference is not a retrieved-source improvement. | Correctly describes tray-fit loss and firm choice but omits the supplied clean-detachment reaffirmation. |
| r03a | Both describe lost bag fit, but strengthen 暫定 with “確定度較高” or “確定性較高.” Both lack the renewed non-sliding test. Candidate adds advice about reconsidering transport; that is not a recorded user decision. | Still strengthens 暫定 despite complete input. It correctly distinguishes failed fit and renewed fixation, but broadens projector nonadoption to other suggestions. |
| r03b | Both preserve the confirmed choice but say original reasons still hold, missing the bag-fit reversal and renewed fixation evidence. | Describes lost fit but omits explicit fixation reaffirmation. “沒有受宜蓁的安排影響” is broader than the evidence that she did not choose the user's tool. |

The r03b baseline's “固定使用” could sound habitual, but its opening event scope
does not establish a clear permanent-use claim. The r03a control's generalized
testing language must not be reported as universal proof. These narrower wording
concerns are not an invented binary accuracy metric.

For both negative queries, ordered one-item rank inputs matched. Baseline ranking
returned empty; candidate retention returned one passage. The electrical query
received a lantern-choice passage; the procurement query received the caution
that equipment choice does not establish approval. Neither supplies an approver
or numerical limit. All four answers appropriately left those details unknown,
without declaring permission granted or denied. Two successful negative cases
do not establish general safety of additional source exposure.

## Context, calls and cost

Source payload sizes are UTF-8 bytes and local tokenizer counts of serialized
source arrays, not the complete provider prompt or a bill:

| Answer inputs | Slots | Bytes | Tokens |
| --- | ---: | ---: | ---: |
| Baseline regular | 6 | 4,011 | 1,189 |
| Candidate regular | 6 | 4,011 | 1,189 |
| Canonical controls | 6 | 13,530 | 4,055 |
| Negative baseline | 2 | 4 | 2 |
| Negative candidate | 2 | 399 | 111 |

Equal regular totals hide the opposing r01a/r01b membership changes. Negative
candidate exposure added395 bytes and109 tokens. All eight candidate calls
bypassed provider ranking, avoiding eight rank generations and their eight
input-count requests. Recall-only baseline used32 HTTP requests; candidate used16.
These calls include negative recalls, but exclude capture and answer generation.

Observed recall HTTP-duration sums were70.692s baseline and39.074s candidate;
all178 HTTP durations summed595.980s. These exclude complete orchestration
latency and are not speed guarantees or repeated-run benchmarks.

Total provider requests were178:78 counts,78 source-model generations and22
host completions. Generations comprised18 extraction,18 qualification,
18 classification,16 selection and8 baseline ranking calls. Known recall-only
usage estimates were US$0.013300 baseline andUS$0.008885 candidate; count costs
remain separately unknown. The fixed provider model was
`gpt-4.1-mini-2025-04-14`; pricing assumptions remain those of the guarded
protocol, not an invoice or a comparison against current alternative models.

| Existing US$50 campaign | Before | After | This run |
| --- | ---: | ---: | ---: |
| Requests | 1,827 | 2,005 | 178 |
| Conservatively reserved | US$22.346 | US$24.226 | US$1.880 |
| Known usage estimate | US$1.216239 | US$1.328611 | US$0.112372 |
| Unknown-cost requests | 850 | 928 | 78 |
| Unsettled requests | 0 | 0 | 0 |

Conservative headroom is US$25.774. No grant was created, budget reset, failed
slot replenished, or unknown request treated as free.

## Decision and next work

Do not promote retention as a fidelity fix from this result. It saves rank calls
on these small sets, but none of the13 missing required passages per arm reached
ranking. The [earlier fixed-candidate recovery](small-candidate-results.md)
remains a valid narrow observation, not a general benefit established here.

Next separate navigation information loss from answer-host interpretation.
Inspect complete-versus-clipped label visibility before adding another MOC
wrapper. A separately frozen, fresh crossed source-view/answer-host diagnostic
should hold source text, order and questions fixed across hosts, include complete
and incomplete evidence, and retain every failure. It must not rerun these
scored cases or assume a different model is more faithful. Complete-source
failure alone cannot establish a MOC architecture ceiling.

This remains an authored synthetic, nonblind, same-family evaluation. One
additional reviewer authored the fixtures/rubric and comparison helper; the
other authored the operator. There was no independent human study, general
benchmark, installed-artifact test or natural chat-client interaction in this
experiment. The source-built MCP engine works operationally here; reliable
changed-decision interpretation and product onboarding remain open. No default,
release, deployment, private-service integration or promotion changed.
