# Multi-window fidelity: first installed experiment

The longer memory path completed, but reliable reason/currentness handling did
**not** pass. All six histories reached fifteen active admitted memories after
three captures. Ordinary recall returned24 of32 required source passages; the
six decisive qualifiers were all present. Some answers nevertheless preserved
obsolete reasons, including answers given the complete canonical history.

This is three authored matched pairs, not six independent samples, an external
benchmark or a population accuracy estimate. Earlier failed experiments remain
unchanged. No prompt, source history or sampled answer was repaired or rerun.

## Frozen installed execution

The [protocol](multi-window-fidelity.md) uses six histories, eighteen capture
windows and twelve answer slots. Source processing and answer generation used
the unchanged `gpt-4.1-mini-2025-04-14`. Both answer arms used identical baseline
instructions, question and flat source format, with1,024 maximum completion
tokens, no tools and `store: false` (not a zero-retention guarantee).

The source-built archive ran through actual stdio MCP clients, separate synthetic
project namespaces, and close/reopen between capture and inspection. This proves
explicit installed calls, not a natural agent deciding when to invoke memory.
The full eighteen-message answer control is constructed canonical source input,
not ordinary recall, a fabricated Cairn receipt or a rescue of missing evidence.

| Frozen item | SHA-256 / commit |
| --- | --- |
| Source commit | `dafe0158ef4d63f13bd697db77ad8af97fcbdff1` |
| Installed archive | `87f1d8bd23c23ddc9452f47a6f236e4fb98b616dcd624b91739f6f943f8c695a` |
| Operator | `98f2dad21831ea53ec3d672125b19d803b161ebabcc737299a1ff62c3412172e` |
| Fixture | `c54ee3ce66ba4ac7ea7fab4a19895a5a5ec8db8d545c3c87099dc515a3850dcb` |
| Source-ID / semantic rubric JSON | `2d7ed6764b30b2c8e02d2b8a30fbffe54a1002f6ef1bd2913367ebc276e9f44f` |
| Protocol explanation | `5eba3edf9f98e46e95d9a2859d950c8adc9dfb8661303246925591398c3d203e` |
| Driver | `7f7f141ce6f9a6e6f3f8454cfa567804851b6a1983664afc7cdc414f224c3625` |
| Retained private raw report | `343dcfed1397d06f6e1678efa74bfc2355ee33c423cfe84b2bb28e4825917f21` |

PR112 passed all seventeen CI checks before merge and paid execution. The operator
had two independent source reviews and six successful offline rehearsal verdicts:
normal execution, malformed source output, source transport failure, malformed
answer, answer transport failure and cleanup failure. Intentional failure modes
retain failed/not-run slots; a passing rehearsal verdict does not turn them into
successful memory outcomes.

The first offline operator attempt failed because its reused scripted extractor
emitted six items, including an assistant suggestion, above the existing five-item
cap. Its script, preparation and failed report remain retained. A minimal replay
through the actual capture validator failed with six items and passed with five
user-backed items. A separate operator changed only the offline mock and private
artifact directory, then completed all six rehearsals. Neither product limits,
frozen cases nor live extraction were changed; no paid attempt was repeated.

## Mechanical findings

All18 captures and classifications, cold inspections and6 recall calls completed;
all12 answer slots completed. No transport halt, operational error, retry or
cleanup failure occurred. The machine report still leaves semantics unassessed.

Staged views retained108 submitted messages. Final admitted receipts retained all
90 user-message identities, not the18 assistant suggestions. Required-source
coverage was32/32 in admitted receipts and24/32 in ordinary recall. All six
decisive qualifiers were recalled, showing why quote presence alone is not an
answer-fidelity score.

Each history grew5 →10 →15 active memories. All six explicitly requested
small-set snapshots correctly rejected the over-cap set without partial source
output. This demonstrates a safety boundary, not useful retrieval or a fix for
large histories. Ordinary recall remained a separate operation.

| History | Required recalled | First observed omission |
| --- | --- | --- |
| s01a, provisional railway layout |4/5| Wider bridge (`w2m1`): visible in navigation, not selected. |
| s01b, firm railway layout |3/5| Wider bridge (`w2m1`): not selected. Assembly comparison (`w2m2`): reached rank candidates, not ranked. |
| s02a, conditional costume fastening |4/5| Continuing quick-change advantage (`w2m2`): visible, not selected. |
| s02b, committed fastening |4/5| Same continuing advantage (`w2m2`): visible, not selected. |
| s03a, rehearsal-only singing |3/6| Piano loss, continuing learning advantage and pitch pipe (`w2m1`–`w2m3`): visible, not selected. |
| s03b, committed festival singing |6/6| None of the required passages missing. |

Seven of eight observed omissions first occur at selection; one occurs at
ranking. Actual request/response traces support these stage labels, not a claim
about the model's internal reasoning. No rubric-labelled irrelevant passage was
returned; that labelled subset is not a universal relevance guarantee.

## Answer review

The primary review below is separate from machine coverage. Two independent
agent reviewers verified the retained report hash and all twelve actual answer
inputs/outputs against the frozen sources. Both reviews are complete; the
quality gate fails. Review is nonblind and same-family, not a human-use study.

| History | Retrieved answer | Complete-source control |
| --- | --- | --- |
| s01a | Calls the provisional choice “currently firm” and preserves the obsolete narrow-bridge reason; the bridge update was absent. | Says “fairly firm” while also retaining “for now.” Acknowledges the wider bridge but still says the original reasons apply. |
| s01b | Correct firm choice and actor, but says the narrow-bridge reason still applies without the update. | Same obsolete-reason claim despite the supplied bridge update; commitment and actor are preserved. |
| s02a | Preserves the noise condition, date and separate banner actor; does not restate the later continuing quick-change advantage. | Preserves condition and changed quietness reason; omits explicit reaffirmation of the continuing speed advantage. |
| s02b | Preserves unconditional commitment, date, changed noise and separate actor; does not restate continuing speed advantage. | Preserves commitment, obsolete quietness and continuing speed advantage, with separate actor. |
| s03a | Preserves rehearsal-only scope and Dena's separate set, but falsely says the piano still supplies the starting note; the update and replacement source were absent. | Preserves piano loss, pitch-pipe replacement, continued learning advantage, rehearsal-only scope and separate actor. |
| s03b | Preserves committed scope, changed piano premise, pitch-pipe replacement, continuing learning advantage and separate actor. | Same main distinctions preserved. |

An old source stating a reason does not establish that the reason still holds
after an explicitly requested change audit. Missing updates and unsupported
currentness claims must be distinguished: supplied old evidence may explain a
mistake without justifying present-tense certainty. Complete-source railway
failures additionally show that retrieval repair alone cannot solve the observed
reasoning problem. No aggregate semantic pass rate is assigned here.

Reviewers also retained narrower ambiguities: s01a's control mixes “fairly firm”
with an explicit provisional qualifier rather than deleting that qualifier;
s02a's control describes originally perceived quietness more categorically;
and some otherwise faithful answers synthesize motivation from a continuing
advantage. Missing reaffirmation is incompleteness, not automatically a
contradiction. These distinctions should not be collapsed into keyword scoring.

## Context, latency and accounting

Retrieved answers received3–6 source messages versus18 in the canonical control.
Serialized source arrays were454–959 UTF-8 bytes versus2,152–2,248 bytes. Provider
reported prompt tokens, including baseline instructions and framing, were289–420
versus775–795. These smaller inputs did not preserve all necessary evidence.

Observed answer-request guarded round trips were about1.22–2.29 seconds. This
includes operator/guard work around the provider request; it is not isolated
provider latency or whole memory-workflow latency. One sample per answer arm does
not establish a performance advantage.

The run made144 HTTP requests:66 source input counts,66 source generations and12
answer generations. Conservative reservations increased US$1.26, and known usage
estimates increased US$0.094571;66 additional requests have unknown cost. All
requests are settled. Estimates are not an invoice and unknown costs are not free.

The unchanged US$50 campaign now records1,440 requests /US$17.396 conservatively
reserved /US$0.973737 known estimated usage /690 unknown-cost requests /zero
unsettled requests. Conservative remaining headroom is US$32.604. The earlier
US$20 campaign is separate and was not reset.

## Next gate

The result requires two separate investigations: preserving necessary selected
evidence through navigation/ranking, and faithful handling of changed premises
when evidence is already present. Do not simply increase a limit or add a
qualifier keyword list to these cases. Candidate changes must preserve namespace,
revision, correction/forget and aggregate context bounds, and be measured on a
separately frozen comparison. Existing failures remain controls, not answers to
regenerate into a passing result.

The omitted navigation labels already conveyed the relevant premise changes.
Therefore this run does not support blaming summary wording alone. Removing
ranking could recover at most the one observed rank omission, not the seven
selection omissions. The next candidate must address evidence coverage as well
as interpretation, without assuming either change alone is sufficient.

Two research leads inform that candidate, not a shipped design or borrowed
accuracy claim. [StateMem](https://arxiv.org/html/2608.19652v1) separates state
tracking from recall and tests a question-scoped answer-time trace against a
matched control; its wrapper also receives the transcript, so its reported
benefit is not evidence that a small retrieved subset suffices. Its dependency
propagation ablation warns about excessive invalidation.
[RD-Forget](https://arxiv.org/html/2609.10263v1) distinguishes retained history
from question-conditioned evidence use, with scoped replacements. For Cairn,
the testable direction is bounded, source-linked handling of decisions and
their changed premises, preserving provisional scope and explicitly unresolved
status. A failed reason must not silently become a changed user decision.
Existing rationale/state mechanisms must be inspected before adding another
representation. These papers do not establish Cairn's reliability.

This report does not ship a new retrieval algorithm, answer repair, default
model, npm release, deployment, promotion or private-service migration.
