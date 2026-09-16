# Cold-neighborhood comparison: one interrupted synthetic run

The [sanitized record](cold-neighborhood-comparison-results.json) preserves all
four frozen cases and eight planned arms. Three cases produced six source-only
answers; the final case's two arms were not run. The operator globally halted
during its third capture batch, so **neither mode passes a promotion gate**.
Six `generated-unassessed` statuses describe valid completion envelopes, not
six correct answers. This was a selected, nonblind synthetic development run,
not a reliability estimate or a real-user result.

The record gives each delivered original excerpt once in a case-local catalog,
then lists answer-request source groups in their actual order. A group is marked
`selected-root` or `linked-neighborhood`; repeated fixture IDs represent
distinct retained receipt/source appearances, not extra original messages.
The six `answerText` values are the exact generated texts. Four UUID citations
in the greenhouse neighborhood answer are ephemeral synthetic receipt IDs;
`citationReceiptToFixture` maps each to the original fixture message. No
namespace, account, private path, campaign run ID, provider request ID, key or
ledger row is published. The retained private report is bound by its SHA-256
pin, as are the frozen source fixture, evaluator rubric, operator, reader and
installed artifact.

## Evidence and answer review

All nine completed capture batches and the first two workshop batches reported
nonduplicate admission, applied classification and reviewed rationale, with no
suppressed candidates or capture coverage warning. That mechanical stage status
does not prove that extraction retained every relevant message or that proposed
relationships were correct. Retained receipt mapping was completed for the
first three cases only. For workshop, two captures completed, but the third
started and was interrupted before the operator wrote its capture result or
performed a cold retained-source inventory. Its `not_run` capture slot is a
stale report state, **not** proof that the third batch was never attempted.

The frozen [rubric](cold-neighborhood-rubric.json) contains exact passage
anchors. In the JSON record, `missingExactAnchorIds` reports literal anchor
coverage; `sourceSufficiency` and `answerSupport` are separate qualitative
judgments. An absent exact anchor need not mean the actual answer lacked source
support: another delivered original passage may support a narrower claim.
Two independent AI-agent reviewers—primary and independent reviewer—agreed
on these nonblind judgments without a separate paid judge call:

| Case | Ordinary source arm | Neighborhood arm |
| --- | --- | --- |
| Cart choice and changed premise | Three roots delivered the original choice, its two stated reasons, a later note that battery swapping needs review, and no replacement. The explicit retrofit passage and canopy recheck were absent. The historical demonstration and current battery-loss rubric obligations are partial, though the actual cautious answer is supported by delivered sources. | The same three roots plus two linked sources delivered the retrofit's explicit loss of swapping and the canopy recheck. Only the separate historical demonstration obligation remains partial; the answer's reconfirmation wording is source-supported. |
| Newsletter adoption | Two roots delivered the Spruce vote, both reasons and explicit non-selection of Quartz. The optional earlier Lantern choice has partial source support from the vote's “replaced Lantern” wording, but its bilingual reason was unavailable and the answer omitted that historical detail. The full Quartz rubric obligation is partial because the proposal passage was not delivered, but the actual “never adopted” answer is supported. | Two roots delivered the same choice and reasons plus a discount/non-switch aside. The answer does mention replacing Lantern, supported by the vote, but omits the optional old bilingual reason. The proposal passage remains absent, so the full Quartz obligation is partial. The aside is supported; this is not evidence that adding a link caused better judgment. |
| Greenhouse late import | Three roots delivered the May East update, the June old-document import and West's unchanged 05:30 schedule. All four required claims in the answer are semantically supported, although three exact rubric anchor messages were not delivered. | Four roots and two linked sources delivered extra March/import evidence. All four required claims are supported; the West obligation still lacks one literal anchor but has a sufficient West passage. The four generated receipt citations resolve to delivered synthetic sources. |
| Workshop exception and unknown July hour | Not run. No answer or cold retained-source inventory exists. | Not run. No answer or cold retained-source inventory exists. |

No definite forbidden inference was identified in the six answers. That narrow
finding does not turn partial obligations or unrun arms into successes. The
optional historical obligations are not penalized for omission; a volunteered
historical claim would still require support. The fourth case's known May 9
time and unknown July schedule were never tested in an answer, so universal
refusal cannot be credited as abstention. Source submission, retention, root
selection, linked-source expansion, delivered evidence and answer judgment
remain separate stages in the record.

## Halt, accounting and limits

The one-shot operator attempted 122 HTTP requests: 116 core count/generation
requests and six host answer requests. Request 121 was a successful
`cairn_qualifyCandidates` input-token count (3,657 input tokens); request 122
was the corresponding generation call and ended as `request_aborted`, with no
provider response retained. Its ledger reservation was terminally recorded with
unknown outcome and unknown cost, not left unsettled. The roughly 30-second count-to-abort interval is
consistent with the core's existing deadline covering count plus generation;
it does **not** establish the remote latency or root cause. The operator
latched a global halt, did not retry, and did not start either remaining arm.

The run reserved 880,000 micro-USD ($0.88) conservatively, not as a measured
bill. The shared ledger checkpoint moved from 2,273 to 2,395 requests and
25,442,000 to 26,322,000 reserved micro-USD; all reservations settled. The
increase in known usage estimates was 55,808 micro-USD ($0.055808), while 59
requests have unknown cost. These aggregate deltas do not expose campaign rows
and cannot establish actual provider spend. The six completed arms' full
pre-/post-read source and graph snapshots matched their respective cold case
baselines. No read-path write or cold persistence mismatch was observed in
those arms; the interrupted workshop arms have no such evidence.

The two modes can select different roots and sources, so these results compare
whole read paths, not a same-input causal ablation of graph edges. They do not
establish relationship correctness, answer reliability, statistical advantage,
user benefit, readiness for default use, or a reason to relax limits. No
fixture, rubric, prompt, model, runtime, provider configuration or budget was
changed for this publication, and no rerun is authorized by it.
