# Checklist selection: evidence gain, reliability still open

The once-only [fresh comparison](checklist-selection-comparison.md) completed
all eighteen capture windows and eighteen answers. Checklist selection retained
25 of32 required passages versus21 for baseline, without losing a passage that
baseline retained. The gain was confined to the exhibit-label pair. Seven
required passages still disappeared during selection, and a candidate answer
strengthened a tentative decision despite receiving all required evidence.

The candidate is **not promoted to a production default**. These are three
authored matched pairs, not independent population samples, a benchmark score
or proof of general improvement. Earlier failed experiments remain unchanged.

## Frozen execution and boundaries

The source-based experimental launcher used actual stdio MCP clients and the
existing server/core factories, with the candidate model wrapper injected only
for its recall. Each history had one synthetic store shared between its two
recall arms. Capture, classification, ranking, question, source-evidence mode,
limit6, model and baseline answer instructions stayed fixed. Baseline/checklist
order alternated; the unchanged multi-window driver retained baseline and
canonical-control outputs, with a separate six-slot candidate sidecar.

All calls used `gpt-4.1-mini-2025-04-14`. Answer requests allowed1,024 completion
tokens, no tools and `store: false`, which is not a zero-retention guarantee.
The complete eighteen-message control is constructed diagnostic input, not
ordinary recall or a rescue of missing evidence. This is not a published
package, an installed CLI selector option or a natural host choosing its tools.

| Frozen item | SHA-256 / commit |
| --- | --- |
| Source commit | `5ffcbd477e9d1d4009c377086779d7b1b9a63037` |
| Fixture | `a3c9b323bd456e2736995ccac5026513f1b5e844845de3dd204142280a13f702` |
| Rubric JSON | `1f4a5ba7d0c00fbca0537615115fbc3127b436e75ecb0f9d7e553f0bab23cf63` |
| Protocol | `473cb24f5328b01e2b209b1d73f2a59aa62df580c6daeceebab0ec471f259ad6` |
| Unchanged driver | `7f7f141ce6f9a6e6f3f8454cfa567804851b6a1983664afc7cdc414f224c3625` |
| Operator | `92b3cfe4c894e423345a7de1850bcb06be5ea0c365e6600f872a667116d48630` |
| Experimental launcher | `e39792350a70eeccd367c2be5f455296e1a85ba35579ed8c32bce7f1b1372e1c` |
| Comparison helper | `df9921ed5ca808e118f3823f67b83757fac9f380060c09898b3a3157df70247f` |
| Checklist-only grant | `18252ff4aba124a547c6378285339da18e13d4235a986bef699ce52180b6157c` |
| Retained private raw report | `b429fbefdf0aea8e67264a3ac89502f80a0f54746418d6fd99e76cdd9189f7a9` |

PR117 passed all seventeen CI checks before merge and execution. The operator
passed separate Spec and Standards source reviews, followed by six full fake-
service rehearsals: success, invalid checklist, malformed source output,
transport halt, malformed answer and cleanup failure. All retained their
expected failed/not-run slots and ended with zero unsettled attempts. Additional
helper tests rejected foreign namespaces, stale revisions and altered receipts.
These are mechanical gates, not semantic evidence. No paid attempt was retried.

The reviewed parent-only control issued the new capability after those gates;
older grants and ledger state remained unchanged. The operator pinned source
and dependency bytes, credentials remained in the parent, and child processes
received only authenticated loopback tokens. All48 child processes opened and
closed; no live transport halt or cleanup failure occurred.

## Where evidence was lost

All18 captures and classifications completed. Staging retained108 submitted
messages; final admitted receipts retained all90 user-message identities, not
the18 assistant suggestions. Required-source admission was32/32. Every history
grew5 →10 →15 active memories; all six small-set snapshot requests correctly
rejected the over-cap set without partial output.

| History | Required | Baseline recalled | Checklist recalled | Remaining checklist omission |
| --- | ---: | ---: | ---: | --- |
| c01a, provisional games |5|3|3| Detailed longer-round trial and teaching reaffirmation (`w2m1`, `w2m2`). |
| c01b, committed games |5|3|3| Same two passages. |
| c02a, tentative room exception |6|5|5| Original upstairs quiet/table rationale (`w1m1`). |
| c02b, confirmed room exception |6|5|5| Same original rationale. |
| c03a, tentative label mounts |5|3|5| None required missing. |
| c03b, decided label mounts |5|2|4| Successful adhesive-mount trial (`w2m2`). |
| Total |32|21|25| Seven required occurrences missing. |

All eleven baseline omissions and seven candidate omissions occurred at
selection. Every selection input exposed all fifteen active memory references.
Exact reference reconstruction matched the downstream rank candidates; ranking
retained every selected candidate. There were only two to five candidates per
arm, below the six-memory result limit. Neither a hidden map page nor a binding
rank cap explains these observed losses.

The checklist regained the obstruction and successful-mount trial in c03a, and
the obstruction and decisive mounting choice in c03b. It lost no required source
retained by baseline. Decisive qualifier presence rose from5/6 to6/6. Both arms
returned zero *pre-labelled* irrelevant passages; the labelled subset is not an
exhaustive relevance judgment. Required-source counts are not answer accuracy:
for example, the retained game-choice qualifier itself mentions longer rounds,
even when the separate detailed trial is missing.

The purported question decomposition also has an important limitation. The six
proposals used `[1,1,1,1,2,3]` spans, with reference-occurrence counts
`[3,3,5,5,5,5]` and accepted unique unions `[3,3,5,5,5,4]`. Mechanically valid
offsets selected fragments such as `ober 9 co` and `ations?`, including cuts
inside words. This satisfies the frozen compiler's UTF-16 boundary contract,
but does **not** demonstrate meaningful question decomposition. The observed
gain cannot be credited to a proven planning mechanism. Compiler acceptance
and semantic coverage remain separate, as the original protocol specified.

## Answer review

The primary reviewer and two other agent reviewers checked all eighteen actual
answer inputs/outputs against the frozen histories. Both agent reviews are
complete and non-blind, same-family analyses, not independent human validation;
one reviewer authored the operator but not the provider answers. Inputs matched
canonical source statements and reported answers matched raw provider responses.

| History | Baseline | Checklist | Complete-source control |
| --- | --- | --- | --- |
| c01a | Preserves provisionality and Sora, but says short rounds still hold despite a supplied longer-round concern. | Same stale-reason error and same supplied sources. | Distinguishes quick learning from doubled duration; loose collective wording is explained by that contrast. |
| c01b | Preserves firm choice despite longer rounds; lacks the explicit teaching reaffirmation and detailed trial. | Preserves commitment and longer rounds, but only loosely says reasons partly hold. | Clearly separates continuing teaching ease from longer duration, without reversing the choice. |
| c02a | Preserves tentative November8-only change and downstairs suitability; omits supplied clearance detail. | Preserves tentative scope, clearance and Rami separation; omits supplied downstairs suitability. | Preserves temporary scope, but omits original and replacement quiet/table reasoning despite full input. |
| c02b | Preserves confirmed November8 exception and November15 return; omits supplied suitability evidence. | Same main distinctions, explicitly confirmed for that date; same explanatory omission. | Preserves firm-but-temporary choice; omits quiet/table reasoning. |
| c03a | Preserves tentative mounts and unknown approver, but lacks obstruction/test evidence and states functionality more confidently than its input establishes. | Explains obstruction and tested remedy, but says tentative **but seems settled**, strengthening the supplied qualifier. | Preserves tested physical explanation and unknown approval; tentatively settled is awkward but remains explicitly qualified. |
| c03b | Omits the later mount decision and obstacle/remedy entirely. | Recovers decided mounts and obstruction, but asserts successful avoidance without receiving the successful test. | Preserves decision and tested remedy; subtly changes Neri not arranging the user's labels into Neri not using them. |

No translation approver was invented. Neither a challenged reason nor another
person's choice was treated as an explicit replacement decision in these answers.
The clearest defects are c01a's stale-reason assertion in both retrieved arms and
c03a's strengthened commitment despite complete relevant candidate evidence.

Reviewers retained rather than flattened narrower ambiguities. For c03b baseline,
one treats arrangement is settled as insufficiently grounded in the missing
later decision; another reasonably reads it as describing the original printed-
label choice. Both agree that the later mounting choice was not recovered.
Likewise, a missing explanatory detail is not automatically a contradiction;
the control's tentatively settled is not equivalent to the candidate's contrasting
but seems settled. No aggregate semantic pass rate is assigned.

## Resources and cumulative accounting

Across six answers per arm:

| Arm | Source-message range | Total source UTF-8 bytes | Total provider prompt tokens | Total completion tokens |
| --- | ---: | ---: | ---: | ---: |
| Baseline |2–5|3,596|1,938|571|
| Checklist |3–5|4,252|2,100|586|
| Canonical control |18|13,642|4,753|750|

Guarded answer round trips ranged1.96–3.45 seconds for baseline,1.54–2.22 for
checklist and1.93–4.22 for controls. Selection round trips including input counts
totaled18.743 seconds baseline and23.651 checklist. These observations include
guarding/pinning overhead and stochastic requests; they are not isolated provider
latency, a product benchmark or a general speed advantage.

The run used174 HTTP requests:78 input counts,78 source generations and18 answer
generations. Source generations comprise18 each for extraction, qualification
and classification, six each for baseline/checklist selection and twelve for
ranking. All generation usage totaled170,979 input/prompt and24,025 output/
completion tokens; input-count responses are separate.

The run reserved US$1.680 conservatively, below its US$3 /400 HTTP /18-answer
ceilings. Known estimated usage was US$0.106905, with78 additional unknown-cost
requests. The unchanged US$50 campaign moved from1,440 requests /US$17.396 reserved
to1,614 /US$19.076 reserved, with zero unsettled attempts. Cumulative known
estimates are US$1.080642;768 requests have unknown costs, and conservative
headroom is US$30.924. Unknown is not free; estimates and reservations are not
invoices or renewed allowance.

## Decision and next work

This candidate shows a narrow source-retention gain without a required-source
regression, but not reliable query planning or answer fidelity. It stays
experimental; production defaults, installed CLI behavior and older failed
results remain unchanged. A single stochastic comparison cannot establish a
causal population-level gain from its output format.

Next retrieval work should test a simpler bounded candidate-broadening strategy
over the existing query-aware map order: preserve the selector's valid choices,
consider additional visible references within the same namespace/reference/token
limits, and keep the existing ranker. This is an offline hypothesis, not a new
engine, changed cap or established improvement. Added irrelevant model exposure,
rank displacement of previously retained evidence, multilingual/paraphrase limits
and resource costs must remain visible. The earlier
[small complete-map scan](source-scan-ablation-results.md) supports investigating
prefilter loss, but does not prove this larger-map candidate works.

Separately, test a single-call source-linked answer audit that distinguishes the
recorded choice, original reasons, later changes and separately evidenced adoption.
Reuse existing complete receipts and source-binding helpers before adding any
new persistent graph. Neither citations nor valid structure prove those semantic
judgments. Fresh frozen cases and comparisons are required; these answers will
not be regenerated to obtain a cleaner result. Productization and natural-host
acceptance remain separate gates.
