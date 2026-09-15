# Same-source answer accounting: retained results

**Decision: do not promote the accounting record to a product default.**
All24 once-only host requests returned a response;23 passed their structural
contract. That is not a semantic success rate. Source-linked records sometimes
make an error easier to inspect, but also introduce unsupported motives, temporal
claims, approval denials and disagreements between the record and its prose.

The [frozen protocol](answer-accounting-comparison.md) was executed on
2026-09-16 (Asia/Taipei), using six fresh synthetic histories and the pinned
`gpt-4.1-mini-2025-04-14`. This is host interpretation only: no capture, database,
MOC selection/ranking, installed MCP or natural-host session was exercised.
Complete and deliberately omitted source views are not observed retrieval results.

## Design and structural outcomes

Three provisional/confirmed pairs cover knitting yarn, temporary bread storage
and Traditional Chinese recipe organization. Every complete view contains eight
original statements; its paired diagnostic view removes one fixed reason-changing
statement but retains the decisive commitment. Each arm receives identical
question/source values within a view. Only instruction and answer representation
change. Arm order alternates by history/view. The oracle rubric is never input.

There are12 ordinary and12 accounting requests, with one generation per request,
the same1024 output-token cap and no repair, extra prose, judge or retry calls.
All24 source/request/response slots remain retained, including the rejected one.
No count endpoint or source-model generation is used.

| Arm | Requests / available responses | Structurally accepted | Failed | Not run |
| --- | --- | --- | --- | --- |
| Ordinary | 12 /12 | 12 | 0 | 0 |
| Accounting | 12 /12 | 11 | 1 | 0 |

The h01b complete accounting response (slot4) contains **five source IDs in one
current claim**, exceeding the four-ID limit. The response finished normally and
uses555 local/output tokens and2236 UTF-8 bytes, so this is not output truncation
or a token-limit failure. A zero-HTTP replay through the unchanged compiler
reproduces `invalid_model_output`. Its raw prose is substantively useful, but the
result remains rejected; no references were removed and no limit was relaxed.

The remaining11 records are structurally valid, not verified interpretations.
For example, a valid reference to an assistant suggestion can still be attached
to an unsupported claim that the user did not adopt it. Source existence is not
claim-level citation support or execution authority.

## Independent content review

The DRI and two separately working agents read every actual source view, all24
raw responses, and all available records and final prose against the frozen rubric.
Accepted records match their raw JSON; the failed record is reviewed as retained
evidence, not accepted output. Review is nonblind and from the same model family,
not an independent human benchmark. One reviewer authored fixtures/rubric,
compiler, rehearsals and analyzer; the other authored fixture/control tests.
Neither authored the provider responses, and neither consulted the other's
judgment before completing their review. The DRI independently read all24.

Below, “omitted” means a constructed input with one unavailable update. The model
is not expected to discover that hidden statement. The error is asserting an
unsupported current fact, not failing to quote evidence it never received.

| History / view | Ordinary answer | Accounting record and prose |
| --- | --- | --- |
| h01a complete: provisional cotton | Preserves provisional choice, reversed price advantage, reaffirmed washing performance and Mira's separate scarf. | Prose largely faithful; commitment record adds that uncertainty is “especially given price changes,” although the reason for provisionality was not stated. |
| h01a omitted price update | Says both original reasons still hold and uses a wash test to confirm price as well as shape retention. | Repeats unsupported continuing cheapness. “Confirmed March14” is inferred from nonadoption of wool, but wording still says provisional; retain this ambiguity rather than call it an unequivocal firm-choice reversal. |
| h01b complete: firm cotton | Preserves firm choice, failed price advantage, surviving shape reason and separate actor. | Rejected for five IDs in one claim. Raw prose preserves the main distinctions; this does not rescue the failed contract. |
| h01b omitted price update | Again treats the wash test as confirming continuing cheapness. | Same persistence error. A claim of nonadoption cites only the assistant's suggestion, not the separate user source establishing nonadoption. |
| h02a complete: tentative temporary box | Preserves August5–7 scope, tentative plan, humid-trial challenge and planned return, but omits reaffirmed shelf fit. Causal motivation is plausible, not expressly recorded. | Restores shelf fit but invents that cleaning a spare tin was preparation for the plan; sources do not establish that purpose or equate the tin with the lidded box. |
| h02a omitted humid trial | Says the usual reasons “presumably do not hold,” including shelf fit despite an explicit fit reaffirmation. | Better distinguishes fit and the unknown reason/effectiveness of the temporary change. Record nevertheless turns “not reporting” a return into an assertion that return has not happened. Prose about normal crispness can reasonably be historical, not verified humid-condition performance. |
| h02b complete: confirmed temporary box | Preserves confirmed-but-temporary plan, trial challenge and future return; omits surviving shelf fit. | Introduces a post-August7 status: “have not returned ... after the humid spell,” based on a July16 nonreport. Fit is present in the record but missing from prose. Some causal statements cite only the plan, not its asserted cause. |
| h02b omitted humid trial | Preserves confirmation, scope and planned return. Humidity as motivation is contextual inference, not supplied proof of the omitted trial. | Record isolates reaffirmed fit, but prose broadens it to “reasons ... remain valid.” An unknown framed as “beyond crust preservation” itself presupposes an unestablished motive. |
| h03a complete: tentative binder | Correctly separates lost drawer fit from continuing readability and leaves approver unknown, but invents that uncertainty follows from nonadoption/approval language. | Record and prose change approval non-entailment into categorical nonapproval. Scope also assigns absence of approval authority to 若晴 without sufficient evidence. One current claim cites readability evidence alone for both readability and failed drawer fit. |
| h03a omitted drawer update | Strengthens tentative choice to “確定性較高,” asserts continuing drawer fit, and says procurement was not approved. | Keeps tentative wording but asserts current drawer fit. Record says procurement was not approved; prose more cautiously says no approval record exists. The distinction matters even though the same response contains both. |
| h03b complete: confirmed binder | Mostly faithful; “partly hold” implicitly retains readability without explicitly naming its retest. Approval wording denies inference from choice. | Explains changed/reaffirmed reasons. Record uses cautious “未必,” but prose's “並非已獲核准” sounds stronger before returning to “不代表.” Preserve the ambiguity; do not force a categorical error judgment. |
| h03b omitted drawer update | Asserts both reasons still hold and converts non-entailment into nonapproval. | Repeats current drawer-fit certainty in scope/current/prose, but handles the approver as unknown. Incidental divider storage is placed among reasons, adding structure without answering the requested reasoning question. |

Several records combine distinct reasons, or place decisions, other actors,
unadopted suggestions and incidental actions in the `reasons` collection.
Extra unknown fields often concern unrequested details. These are not evidence
of a more complete decision history. A correct headline does not excuse an
unsupported stored interpretation elsewhere in its record.

Some local improvements are real: accounting recovers shelf-fit information in
h02a complete, avoids the ordinary answer's broad doubt about fit in h02a omitted,
and avoids categorical nonapproval in h03b omitted. These do not offset the
new failures sufficiently to justify promotion. No aggregate accuracy or general
reliability score is assigned to three authored pairs.

## Resource and accounting evidence

| Metric, including failed slot | Ordinary,12 requests | Accounting,12 requests |
| --- | --- | --- |
| Supplied source bytes, summed | 12,772 | 12,772 |
| Serialized request bytes, summed | 25,840 | 43,528 |
| Reported input tokens | 5,726 | 9,242 |
| Reported output tokens | 1,626 | 7,155 |
| Largest reported output | 220 | 769 |
| Guarded wall duration range | 1.500–4.944s | 4.055–7.588s |
| Sum of guarded durations | 29.680s | 76.125s |
| Known usage estimate | US$0.004902 | US$0.015154 |

Accounting adds293 reported input tokens for each matched request and materially
more output. Timing includes guarded local checks and network/provider work;
these few interleaved observations are not a throughput benchmark. All24
responses include usable usage; their sum is14,968 input and8,781 output tokens.

The unchanged guard reserves US$0.05 per host attempt: **US$1.20 this run**, under
its US$2/24-request ceiling. Known usage estimate is US$0.020056, not an invoice.
No new unknown-cost or unsettled requests remain. Cleanup of guard and ledger
completed without error. Dispatch-intent counters alone do not prove HTTP sends;
this run additionally retains24 returned responses and24 guarded reservations.

The existing US$50 campaign advances from1785 to1809 requests and fromUS$20.696
to**US$21.896 conservatively reserved**, leavingUS$28.104 headroom. Cumulative
known usage estimate isUS$1.211453, with845 older unknown-cost requests and0
unsettled requests. Unknown costs are not free, and older campaigns are not
renewed allowance.

## Verification and retained failures

The public compiler and protocol passed dual-runtime contributor gates,
independent fixed-point Spec/Standards review, and all17 required CI before
merging PR123/124. PR124's first CI attempt failed the existing tokenizer's
5-second child-process guard. The PR changes no adapter, dependencies or CI.
Root isolated testing passed in1.60s, the complete OpenAI suite passed190/190,
and four concurrent copies on one CPU reproduced the same timeout4/4. This
demonstrates resource sensitivity, not the precise CI host cause. One unchanged
failed-job rerun passed; the original failure remains. No model case was retried.

Root completed nine fake-HTTP/real-guard rehearsal scenarios on Node22.16 and24:
success, invalid JSON, foreign source reference, interrupted transport, budget
mismatch, pin mismatch, cleanup failure, cross-directory replay, and a pin change
after dispatch. Final control passed four VM tests on both runtimes and separate
independent reviews. All818 required source/dependency/operator entries were
checked against all18 rehearsal reports/manifests before live approval.

The root rehearsal collector initially rejected a dotted runtime filename;
only its filename formatting was repaired, followed by complete reruns.
Initial approval also stopped on a private rehearsal-test file's0644 mode;
permissions were narrowed to0600 without changing bytes before approval.
Neither preparation failure sent a provider request. The operator was repaired
before the frozen run to retain a received response even when post-send pin
checks halt processing. Analyzer review separately added an independently failing
regression for unavailable final accounting, then passed all8 tests on both
runtimes. Failed/unknown evidence is never dropped to improve the denominator.

## Frozen identities

| Artifact | SHA |
| --- | --- |
| Protocol source candidate | `5bed9e084e6097a956f971f98f5bbad95553afbb` |
| Protocol merge, PR124 | `2f9539e53b737f18fd4a6c59380eb05671aefd92` |
| Fixture | `6356248c4938a356028d3ad880c6faf7cd001a5bdb2a68b1a05cc39fd2838209` |
| Rubric | `a41ad470e181644077842d7d68fa05d38e81b4b94bf2184565c44c3ddc666f4d` |
| Accounting compiler | `110aadab7493600bdc3d8da3f06a37c3f0b07295a93df11cbf9a8557b14c025f` |
| Operator | `89fb609a118b4a5138781356bcaa37894751d6604aef3aaf3944eef1d583dbaf` |
| Parent control | `da30d828f89fe888578c0483a163ad4c1e6c5b55c55167d9e691bea4e073a1cb` |
| Live manifest | `5ce9bba6ce836483294a10b0933772e79058a38d6021d4b474f7ba8c1e7b33da` |
| Raw final report | `6daa9c8ec7b2f6ee1efd483c9a0268a2df729825fa21cc7757db4dad033e8367` |
| Offline verified artifacts | `6edd51b85ecc3df03e739c3195b42327b2753fc38e2b43936b129a32a073b16b` |
| Read-only analyzer | `6128da964f1ab1aa38ba1e3f60c412b6acc4a80a73806cce7ad52e8bfb5d2469` |

## Next decision

Keep the record evaluation-only. Do not solve this result by expanding its
reference limit or claiming that more instruction/structure establishes truth.
The record is inspectable, but it is not a verified memory interpretation.

Next separate the engine's responsibility for retaining already-selected evidence
from the host's interpretation. A bounded evaluation of preserving a complete
small candidate set can test avoidable post-selection losses without discovering
new semantic links or raising caps. It must include irrelevant candidates and
“none relevant” controls: ranking also provides useful rejection. Missing evidence
at navigation remains a different unresolved problem. Any engine policy requires
fresh revision/forget/budget tests and real comparative evidence before adoption.

The product goal remains one lightweight, MCP-first shared memory engine with
faithful sources and decisions. This diagnostic establishes neither that goal's
completion nor its impossibility. Natural-host integration, broader histories,
user usefulness and owner-approved distribution remain separate work.
