# H6 routing × ranking diagnostic: no demonstrated quality benefit

The one-shot run closed on 2026-10-18 at 20:02:46 UTC with actual exit 0.
Primary closure audit passed with actual exit 0 at 20:05:19 UTC: both writes
and all eight first read/answer outcomes completed, canonical snapshots stayed
unchanged, and the exact owned workspaces were absent. This is mechanical
completion, not quality success. Two independent masked grading passes and
primary adjudication were frozen before arm unmasking: H6-1's four outcomes
are not ratable because of a source/question-date conflict; H6-2's four are
incorrect, although their abstentions are justified by missing time anchors
in the delivered context. No quality benefit or winner is demonstrated. The
separate exact-path necessary-source trace is complete and distinguishes
source-time loss from complementary-source selection loss.

The [frozen public contract](../plans/routing-idf-diagnostic.md) records D1-D5,
the private contract bindings and reviewed runtime
`d46f7d0aef7b0011e982da8e10f1f26e90706767`. The comparison uses two frozen
fresh cases, one ordinary indexed-evidence ingestion per case and four first reads
of each case's unchanged same-process, cold-reopened MemoryCore store:
A flat/literal, B v2/literal, C flat/IDF
and D v2/IDF. There is no keyset treatment or reference/history fallback.

| Case | Frozen arm order | Complete write | First read/answer outcomes | Masked grades/adjudication |
| --- | --- | --- | --- | --- |
| H6-1 | A, B, C, D | Completed: 51 batches, 239 memories | 4/4 completed | All four not ratable |
| H6-2 | D, C, B, A | Completed: 48 batches, 225 memories | 4/4 completed | All four incorrect; justified abstentions |

N=2 distinct cases with eight correlated arm outcomes, not eight independent
benchmark cases. Not-ratable outcomes are not counted as correct or incorrect;
justified abstention is not correctness. There was no live retry or case
replacement.

## Observed mechanics

Actual model stages were 99 extraction, 99 classification, six group selects,
16 flat selects, eight ranks and eight answers: 236 stages and 472 physical
count/generation requests. Source/runtime bindings and every per-arm canonical
snapshot were unchanged. Independent closure inventories agreed on 1,545
private evidence records. All eight rows recorded zero packing omissions;
that does not prove necessary evidence was retained, visible or supported the
answer. The exact-path source-loss observations are reported below.

Calls below are group/flat/rank/answer counts. Returned/packed means returned
memories and source passages packed for answering, not correctness counts.
Elapsed seconds are instrumented operator row durations.

| Case | Arm | Calls | Returned/packed | HTTP requests | Elapsed s | Semantic judgment |
| --- | --- | --- | --- | ---: | ---: | --- |
| H6-1 | A | 0/2/1/1 | 2/2 | 8 | 31.237 | Not ratable |
| H6-1 | B | 2/2/1/1 | 2/2 | 12 | 47.659 | Not ratable |
| H6-1 | C | 0/2/1/1 | 1/1 | 8 | 33.730 | Not ratable |
| H6-1 | D | 2/2/1/1 | 1/1 | 12 | 48.750 | Not ratable |
| H6-2 | D | 1/2/1/1 | 2/3 | 10 | 40.622 | Incorrect; justified abstention |
| H6-2 | C | 0/2/1/1 | 1/1 | 8 | 33.581 | Incorrect; justified abstention |
| H6-2 | B | 1/2/1/1 | 2/2 | 10 | 42.007 | Incorrect; justified abstention |
| H6-2 | A | 0/2/1/1 | 2/2 | 8 | 34.053 | Incorrect; justified abstention |

## Frozen semantic judgments

Both independent reviewers used GPT-6.1 Sol/high. Correctness was frozen before
delivered-context disclosure; both passes and primary adjudication were frozen
before arm unmasking. The primary verified 143 exact second-pass citations.
The authorized sanitized semantic projection SHA256 is
`18d41296665aa3c9ec1cb99803c52fe00b42bc6e0a9b159334b64d53f1a1e286`.
The public JSON preserves sanitized per-reviewer classifications, flags and
disagreement/resolution summaries. Original full source-cited reviewer reports
remain private and hash-bound; frozen first-pass grades were not rewritten.

For H6-1, the recorded transaction and later question anchor the same relative
weekday expression to different dates. Target-day truth cannot be established;
a reference-number match cannot resolve that conflict. All four outcomes are
not ratable, not successes. A and B make unsupported, stale attributions with
unjustified certainty. C abstains without those flags. D abstains but still
makes an unsupported, stale attribution; its abstention is also not ratable.

For H6-2, the original history supports the requested elapsed interval, but
all four answers omit it: minimal and full correctness are false for each.
Their actual answer requests lack the needed source-time anchors, so all four
interval abstentions are justified by the delivered context. D also substitutes
the question date for an event date, an unsupported assertion with unjustified
certainty. A, B and C have no adjudicated flags. Context support therefore
does not repair first-pass incorrectness.

The reviewers agreed on every correctness classification and every second-pass
recoverability/abstention classification. First-pass flags differed on three
answers, six flag cells: for H6-1 D, the primary retains reviewer B's
unsupported/stale flags; for H6-2 A and C, the primary retains reviewer A's
conservative interpretation that abbreviated endpoint wording in a negative
availability statement does not unambiguously assert completed installation.
Reviewer B's unsupported/proposal-upgrade dissent remains visible. These
reviewer labels are separate from arm labels.

Second-pass support descriptions also differed: for H6-1 A/B, the primary
treats unconditional temporal linkage as unsupported (reviewer A), retaining
reviewer B's ambiguous classification; conditional arithmetic is supported,
but target truth stays not ratable. For H6-1 D, the primary retains reviewer
B's additional temporal-link limitation alongside supported expense and
missing-rate descriptions. For H6-2 A/C, the conservative endpoint reading and
reviewer B's dissent both remain; no first-pass grade changes.

The decision is no default promotion or automatic paired24/fresh30 expansion.
The accepted trace below identifies the time-provenance boundary to address
with offline regression first. This closed diagnostic authorizes no paid
rerun, replacement or rescoring.

## Exact-path source-loss trace

The primary accepted the worker's trace and independently rejoined all 16
original-source paths, with actual exit 0 and matching independent inventories.
The sanitized trace projection SHA256 is
`71060dea1e2cb458a3e2bc77660f986ab431c9728905d80488dae4c1b424b052`.
Every original statement was captured. References were actually visible on
16/16 original-statement/arm paths; 12/16 such paths reached the answer
context. The denominator is four unique original statements × four arms,
not 16 unique facts, additional cases or a new accuracy denominator.

| Case | Arm | Original-statement paths visible | Original-statement paths rank-visible | Original-statement paths answer-packed | First content loss |
| --- | --- | ---: | ---: | ---: | --- |
| H6-1 | A | 2/2 | 2/2 | 2/2 | None |
| H6-1 | B | 2/2 | 2/2 | 2/2 | None |
| H6-1 | C | 2/2 | 2/2 | 1/2 | Purchase statement dropped by rank |
| H6-1 | D | 2/2 | 2/2 | 1/2 | Rate statement restored by hierarchy, then dropped by rank |
| H6-2 | D | 2/2 | 1/2 | 1/2 | Original earlier-event/repair statement unselected before rank |
| H6-2 | C | 2/2 | 1/2 | 1/2 | Original earlier-event/repair statement unselected before rank |
| H6-2 | B | 2/2 | 2/2 | 2/2 | None |
| H6-2 | A | 2/2 | 2/2 | 2/2 | None |

A/B preserve both original statements in each case. C/D each lose one
complementary original source: at rank output in H6-1, before rank in H6-2.
H6-2 D returns an assistant acknowledgment substitute, not the original repair
statement. There are zero answer-token-packing omissions; returned passage
counts do not make that substitute the original source. These single outcomes
do not causally attribute loss to IDF or hierarchy.

Original source-time metadata is missing across all 16 statement/arm paths:
one shared transport limitation, not 16 independent semantic failures. Dates
survive only in the operator's source-map/audit sidecar, not persisted
canonical receipts or model-facing source context. Ordinary capture messages
have no source-time field and reject extra message fields; receipt `createdAt`
is ingestion time, not the original source clock. Rank/final source context
therefore lacks those dates. The H6 answer serializer also projects only
role/content even though its audit bindings retain source dates. Both the
shared engine boundary and consumer transport need an explicit source-time
contract; this report implements no such fix. Missing dates independently
prevent the ratable temporal answer even when both event statements arrive.

The next stage is shared-engine and consumer source-time transport with
offline regressions, followed by bounded complementary-evidence selection.
No answer regeneration, paid H6 rerun, automatic paired24 or default promotion
is authorized. One ambiguous case prevents a new accuracy-percentage claim.

## Resource and accounting observations

The run retained US$2.36 of reservation. Its US$0.373619 known generation
usage-rate estimate is not an invoice: count-route billing remains unknown
and unrefunded, and discounts may be omitted. Known generation usage totals
738,682 input and 48,788 output tokens; count-route work is separate.

| Write group | HTTP requests | Instrumented elapsed s | Reservation US$ | Generation estimate US$ |
| --- | ---: | ---: | ---: | ---: |
| H6-1: 51 batches | 204 | 903.974 | 1.02 | 0.161790 |
| H6-2: 48 batches | 192 | 888.110 | 0.96 | 0.156946 |

| Case | Arm | Generation input/output tokens | Reservation US$ | Generation estimate US$ | Request timers s |
| --- | --- | --- | ---: | ---: | ---: |
| H6-1 | A | 11,564/252 | 0.04 | 0.005030 | 9.705 |
| H6-1 | B | 19,975/338 | 0.06 | 0.008534 | 16.462 |
| H6-1 | C | 10,935/187 | 0.04 | 0.004675 | 10.931 |
| H6-1 | D | 19,704/283 | 0.06 | 0.008338 | 15.001 |
| H6-2 | D | 21,176/385 | 0.05 | 0.009087 | 13.963 |
| H6-2 | C | 11,794/234 | 0.04 | 0.005093 | 10.377 |
| H6-2 | B | 21,261/359 | 0.05 | 0.009080 | 14.021 |
| H6-2 | A | 11,518/273 | 0.04 | 0.005046 | 11.122 |

Overall operator duration was 2,122.008 seconds; summed physical-request timers
were 834.077 seconds. Both include diagnostic overhead: frozen artifact/runtime
checks, source/ledger validation and durable evidence recording. The request
timer starts before HTTP-intent persistence and the frozen fetch check.
Neither metric is pure provider latency or normal product latency. Reads
reopened MemoryCore in one operator process; they were not fresh-process or
OS-cold-cache measurements. V2's additional group allowance and actual extra
requests remain part of the comparison, not an equal-cost routing claim.

At closure, cumulative retained reservation was US$344.522281 across 60,037
requests. Protecting US$30 below the unchanged US$400 ceiling left
US$25.477719. There were zero new pending or unknown outcomes; 23 historical
unknown outcomes remain. This is a closure snapshot, not a current balance
or authorization for further calls.

## Provenance and acceptance boundary

The [public metadata projection](../../evaluation/architecture/routing-idf-diagnostic-results-20261018.json)
was built from the authorized mechanical projection, SHA256
`2e1b16d869162731f5305306148a0a8909cdfb6c17b3d16bb07bac80a807ad71`,
and closure audit. The retained private report SHA256 is
`96e6ad9afc60ab12fd5e66a8e9f57a486e07e2935fb42dc2cc38be1cb8d3c8c7`.
Only H6-1/H6-2 and arm labels are public outcome identities; private run,
session and attempt IDs are omitted. No raw history, reference/model answers,
credentials or operational-ledger records are included. These hashes and
metadata do not make the private authentic trace publicly replayable or
establish anonymization.

The first primary offline closure checker compared full historical accounting
with a compact aggregate/owned-tail object and was terminated with exit 143
while rendering a large assertion. The corrected comparison scope passed
with exit 0. No frozen artifact, ledger or result changed and the live run was
not retried. This was a post-run acceptance-checker incident, not a product
or paid-run failure.

The accepted source trace keeps candidate visibility, selected identity,
whole-source packing, original source time and answer support distinct. It
does not change the frozen grades or establish a runtime fix.

## Interpretation limits retained

This diagnoses the two implemented read changes, standalone-L1-aware
`moc-hierarchy-v2` routing and literal `bounded-idf-v1` source ranking. It does
not implement or validate the full Raw/Memory/Card, relationships or vector
architecture. V2 has extra model-call allowance, so an observed difference
would not establish equal-cost routing efficiency; single stochastic outcomes
cannot by themselves separate model variance from the changes.

The earlier H3 miss and original H5 resource failure remain recorded and were
not replayed by this diagnostic. No official LongMemEval score, same-batch Mem0
comparison, broad accuracy, reliability certification, default promotion or
paired24/fresh30 advancement is claimed. Later frozen gates remain separate;
there is no automatic expansion, merge, release or deployment.
