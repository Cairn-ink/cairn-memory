# Fresh disposition comparison rubric

This evaluator-only rubric is not model input. Its companion fixture contains
six new synthetic source histories and hand-seeded, unverified old tuples. They
exercise known failure categories, not six independent users, a blind benchmark,
repeatability, or a general reliability estimate. The control and candidate
prompts were frozen before these cases; no scored provider call has used them.
Review all raw outputs and structural failures before any aggregate judgment.

An old tuple's expectation is a source-grounded disposition, not a claim that
the source is true. `keep` retains a supported historical relationship;
`withdraw` removes an unsupported or wrongly directed proposal; `unknown`
retains an unresolved proposal without confirming it. A historical reason can
remain correctly linked after its premise stops applying now. A challenge to
present applicability does not imply that the original dated observation was
false, cancel a recorded decision, or adopt a different choice.

For each arm, separately record every old-tuple treatment, every genuine
challenge, independently supported historical reasons, unsupported additions,
malformed output, and complete disposition coverage. Candidate `unknown` and
control omission may both be defensible for a missing antecedent; report that
protocol difference without scoring either as a verified relationship. Do not
hide a definite wrong direction, scope mismatch, or explicit non-adoption in
`unknown`. False withdrawal of a valid old edge, retention of a definitely
wrong one, loss of a genuine current challenge, malformed output, or incomplete
old-edge coverage blocks consideration of any write path. A source-supported
extra link is assessed from its cited receipts, not rejected just because it is
not listed here. No post-response repair or exact-tuple-only semantic scorer is
authorized by this rubric.

## Scenario 01 — press K

| Old tuple | Expected | Source-bound reason |
| --- | --- | --- |
| 0 → 2 support | keep | July 1 offline queuing was an explicit premise of the July 3 selection. The later firmware change does not erase that historical reason. |
| 1 → 2 support | keep | The July 2 six-year parts contract was the second, independently stated July 3 reason; July 10 says it is unchanged. |
| 0 → 3 challenge | withdraw | The July 1 observation cannot challenge the July 10 loss on the same press; it is earlier and the source explicitly limits its applicability. |

Require the July 10 firmware loss to challenge the offline premise in memory 0.
Memory 2 explicitly contains that same offline premise, so a cited 3 → 2
challenge may also be semantically defensible; report exact original-premise
node 0 coverage separately. Do not infer a replacement press or drop the
parts-contract reason. Press K remains the last recorded selection, but its
offline reason now needs reconfirmation.

## Scenario 02 — logger N

| Old tuple | Expected | Source-bound reason |
| --- | --- | --- |
| 0 → 1 support | keep | The June 4 firmware-1 CSV constraint was the explicit reason for the June 6 manual-export choice. It was historically applicable. |
| 0 → 2 challenge | withdraw | The June observation does not reverse the August firmware-2 test. The September import is expressly of the June report, not a new test. |

Require the August 2 test to challenge the June operational constraint's
*continued applicability* in memory 0. A cited 2 → 1 challenge may also be
defensible because memory 1 explicitly repeats the CSV premise; report whether
original premise node 0 was covered. Do not call the June observation false,
infer a new export-workflow decision, or treat the September import as a later
contrary test. The June choice is historical; present workflow selection is
not established by these sources.

## Scenario 03 — department and plan scope

| Old tuple | Expected | Source-bound reason |
| --- | --- | --- |
| 0 → 1 support | keep | Design's annual unlimited-export premise was the recorded reason for its annual-plan selection, even though later corrected. |
| 2 → 0 challenge | withdraw | Finance's monthly 20-export limit concerns a different department and plan, and is explicitly limited to that scope. |
| 3 → 0 challenge | keep | The supplier's correction to Design's same annual plan directly challenges unlimited current exports. |

The genuine Design correction is already represented by old tuple 3 → 0; do
not lose it. A separately cited 3 → 1 challenge can be source-grounded because
memory 1 states the unlimited premise, but it does not excuse withdrawal of
the valid old 3 → 0 edge. Design's annual plan was selected; no changed plan
selection is evidenced.

## Scenario 04 — consideration is not adoption

| Old tuple | Expected | Source-bound reason |
| --- | --- | --- |
| 0 → 1 support | withdraw | A sponsored P license explains consideration, but memory 1 explicitly says no switch was approved. It is not a supports-decision link. |
| 2 → 2 support | keep | The Q receipt itself explicitly records the prior Q choice and its working local-rendering reason. Same-memory support is allowed. |

Require the later Q rendering failure in memory 3 to challenge the explicit
local-rendering premise in memory 2. Q is still the recorded choice; P remains
unadopted despite the sponsorship. Do not remove the P consideration source or
invent a P decision.

## Scenario 05 — corrected assistant inference

| Old tuple | Expected | Source-bound reason |
| --- | --- | --- |
| 0 → 1 support | withdraw | The team explicitly says price was **not** a reason for choosing V. The quote alone is not an adopted motive. |
| 4 → 1 support | keep | The contract confirms cargo insurance, which the team explicitly named as its V-choice reason. |
| 2 → 1 support | withdraw | The assistant's price guess is not team adoption and is expressly corrected by the team. |

Require the team correction in memory 3 to challenge the assistant's guessed
price motive in memory 2. It does not challenge the quoted price as a fact;
the wrong claim is its causal role in the decision. Memory 1 itself may also
support its explicit V choice and insurance reason, but it does not replace
coverage of independently recorded insurance evidence in memory 4. V remains
the recorded choice.

## Scenario 06 — missing antecedent

| Old tuple | Expected | Source-bound reason |
| --- | --- | --- |
| 0 → 1 support | unknown | The fragment does not identify what “that” or “the thing discussed earlier” refers to; the prior notes are unavailable. Neither source proves the proposed encrypted-archives reason nor proves it false. |

Candidate `unknown` retains this old proposal as unresolved, not confirmed.
Control omission is a defensible source-only abstention, but its lack of an
explicit disposition is a separate protocol-coverage fact. A confident keep
or withdrawal would overstate these receipts. The fragment cannot establish
which supplier was selected or why.

Across all six scenarios there are 14 old tuples (7 keep, 6 withdraw, 1
unknown). Five source-grounded challenge obligations are present: the four
new challenges in scenarios 01, 02, 04 and 05, plus the valid old challenge
in scenario 03. The six independent historical-support obligations are the
two press-K reasons and one each in scenarios 02–05. Count original-premise
node coverage separately from semantically defensible decision-card targets.
These counts organize human review; they are not a probability or a score of
product memory, retrieval, host behavior, answer utility, or model reliability.
