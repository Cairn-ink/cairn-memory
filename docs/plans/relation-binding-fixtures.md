# Relation-binding fixture packet

Status: primary-inspected local candidate ready; one scoped local commit
authorized, no push. No paid execution, model outputs or semantic scores.
Fixed dependency base:
`47a4eb14db3fc69d8538222f55a4b29c8ab4ec12`. Worktree:
`/home/chichieh/Github/cairn-memory-worktrees/relation-binding-corpus`; branch:
`fixtures/relation-binding-probe`. The prospective primary RB1–RB9 contract was
read before authoring in the separate `relation-binding-probe` worktree.

The author is an independent GPT-6.1 Sol/high worker. No candidate answer
instruction implementation, old case answers or paid outputs were inspected.
All people, organizations and records here are synthetic. Recorded user and
assistant roles are untrusted submitted role text, not authenticated memories
or proof of source truth. Questions ask the tested relation directly. The
source JSON contains only the fixed case schema; required propositions,
answerability and error criteria appear exclusively in evaluator files.

Manual required-proposition review: complete for all twelve cases. Unit numbers
below are positions in each case's full submitted source array, starting at 1;
they are an evaluator-only explanation, not source identifiers. Each required
proposition was checked against all submitted units, including qualifications
and potentially conflicting neighboring assignments.

| Case | Answerability | Family and full-source support for required propositions |
| --- | --- | --- |
| R01 | known | Supported join: unit 1 assigns packing → SC-482; unit 2 maps SC-482 → Vela V12; unit 3 assigns Vela V12 → Keel Calibration Ltd.; unit 4 preserves the contracts. Receiving-scale and printer assignments do not change this chain. |
| R02 | uncertain | Missing kit-to-shipment link: unit 1 names OK-36 but lacks dispatch/carrier; unit 2 names DP-36/DP-82 carriers but omits contents; unit 3 confirms kit arrival without a shipping label. Matching digits are insufficient to connect the records. |
| R03 | uncertain | Explicit unknown: units 1 and 3 say no accessibility budget approver has been appointed. Unit 2 is a conditional suggestion of Mira, while venue, volunteer and spreadsheet roles are separate. |
| R04 | known | Explicit alias: unit 1 equates Blue Orchard and Orchard Lane Foods Ltd. and distinguishes the packaging supplier; unit 2 names Saira Haddad for that legal entity; unit 3 reaffirms her tea-supplier role. |
| R05 | known | Transfer and event time: unit 1 establishes Niko's custody from July 28; unit 2 says he retained it until the August 15 handover, filed August 20. Thus August 12 predates the transfer. Units 3–4 distinguish location and later custody. |
| R06 | uncertain | Unresolved conflict: units 1–2 assign different coordinators to the same autumn route and effective date; unit 3 explicitly gives equal authority and denies time precedence; unit 4 leaves both assignments unreconciled. Naming either sole coordinator is unsupported. |
| R07 | uncertain | Organization collision: unit 1 establishes independent staff directories; unit 2 assigns Iris only within Seabrook; unit 3 leaves Hillcrest's contact blank despite matching Beacon/BC-4 labels and records no shared staffing. |
| R08 | known | Environment-specific join: unit 1 assigns production AL-17 → production Q-RED, separate from staging; unit 2 assigns production Q-RED → Asha Lim; unit 3 retains that production assignment while changing staging only. |
| R09 | known | Accountability and performance: unit 1 names Rhea as accountable for closure and Devon as inspecting technician, with Tomas as secretary. Units 2–3 distinguish authorship/appointment naming and preserve accountability after rescheduling. Both requested relations are required. |
| R10 | uncertain | Inapplicable dates: units 1–2 provide only September 1–10 and September 20–30 key assignments, explicitly bounded; unit 3 confirms a missing log for September 11–19. September 12 is in neither range, and no-holder status is also unproven. |
| R11 | uncertain | Proposal versus adoption: unit 1 ends the previous term without carryover and requires a vote; unit 2 proposes the committee/Luca arrangement; unit 3 explicitly denies a vote or adoption and says current responsibility remains unassigned. Both nonadoption and the missing current owner are required. |
| R12 | known | CJK alias and join: unit 1 explicitly equates 青嶺農場／山霧合作社, distinct from 青林農場; unit 2 routes the former's refrigerated delivery to 北門; unit 3 assigns 北門 → 周怡安 through September; unit 4 preserves this delivery/rotation, distinct from 南門／周以安. |

The six known cases are R01, R04, R05, R08, R09 and R12. Each alternating
first-arm position contains three known and three uncertain cases. R01, R04,
R08 and R12 explicitly require supported multi-source joins or aliases, so
blanket abstention cannot satisfy their required propositions. All source units
are submitted; none are selected or omitted to favor a particular instruction.

The rubric requires the requested answer, not narration of the evidence chain.
A correct name alone suffices when the question asks only for that name; the
scope/time are inherited from the question unless the answer contradicts them.
Explanation, alias names and intermediate identifiers are optional. For R09 the
answer must distinguish the accountable person and technician; for R11 it must
state both nonadoption and unassigned current responsibility. Uncertainty cases
can be answered concisely without listing every missing link or alternative.

These are prospective manual verdict controls, not measured model outputs.
The fixture suite verifies their presence and corresponding rubric clauses;
the integrated evaluator's controls must verify the actual verdict behavior.

- R01 accepted concise: `Keel Calibration Ltd.`
- R04 accepted concise: `Saira Haddad.`
- R05 accepted concise: `Niko Chen.`
- R08 accepted concise: `Asha Lim.`
- R09 accepted concise: `Rhea Bell is accountable; Devon Price carries out the inspection.`
- R12 accepted concise: `周怡安。`

An always-abstain answer fails all six known cases because it omits their
supported requested names; for example, `I cannot determine this from the
supplied records.` supplies none of the required answers. It is not severe
merely for abstaining. In R02/R07/R10 a concise `The supplied records do not
identify that person or company.` satisfies uncertainty without a derivation;
R03's concise `No approver has been appointed.` and R06's `The assignment is
unresolved.` also satisfy their requested relation. R11 needs both components:
`The transfer was not adopted, and current responsibility is unassigned.`

Severe error is a narrow affirmative failure class: confidently supplying the
requested identity/value through an unsupported cross-entity, environment or
role-to-responsibility binding, or confidently inventing an appointment/adoption
despite explicit nonappointment. Thus R02's neighboring-shipment carrier, R07's
other organization's contact, and R03/R11's invented appointment/adoption are
prospectively severe. Equivalent confident neighboring-entity substitutions in
R01/R04/R05/R08/R09/R12 use the same class. Ordinary omissions, terse correct
answers, qualified possibilities, abstention and explicit uncertainty are not
severe under this rule. A temporal mistake in R05/R10 or prematurely choosing
among R06's actual conflicting assignments still fails correctness and/or
stale/unsupported criteria; it is not automatically this severe binding class.
These definitions were set before any paid answer, and apply to either arm.

Three planned rejectable ambiguities for later independent evaluator controls:

1. In R02, a confident Slate Couriers answer based only on OK-36/DP-36's shared
   digits must fail the requested relation, even though that courier appears in
   a real submitted unit. Arrival itself remains supported.
2. In R08, a confident Cora/Lennox answer that crosses the staging/production
   boundary must fail the requested relation. Asha is positively supported by
   the production chain; abstaining also fails the known required proposition.
3. In R04, replacing the explicit trading-name bridge with an unresolved
   relationship would make the current known rubric inapplicable. The standalone
   test rejects that mutated packet through its reviewed support anchor. This
   is an authoring freeze alarm, not a model answer judgment. The intact packet
   supports Saira; importing Ben from the packaging supplier does not.

Fixture validation is not model QA. Tests check exact schemas, roster,
calendar/timestamp validity, source-unit minimum/maximum, well-formed Unicode,
the 4,000-code-point source bound, evaluator/source separation, six/six balance,
counterbalance suitability and preservation of manually reviewed anchors. Their
scripted negative controls prove those checks reject corrupted fixtures, not
that either instruction arm succeeds on natural answers. No causal claim,
holdout claim, Stage 2 acceptance or authorization to spend follows.

The focused suite uses only these fixture files and Node standard-library
modules through the existing owned runner. Primary integration owns the full
repository gates, evaluator answer controls, independent reviews, hashes and
any later immutable launch manifest. The initial worker handoff stopped before
commit/push; primary acceptance subsequently authorized the local candidate
commit only.

Verification after the pre-freeze rubric clarification:

- `env -i PATH=/home/chichieh/.nvm/versions/node/v22.16.0/bin:/usr/bin:/bin NODE_DISABLE_COMPILE_CACHE=1 /home/chichieh/.nvm/versions/node/v22.16.0/bin/node tools/testing/run.mjs evaluation/algorithm-development/test/relation-binding-corpus.test.mjs`: exit 0; seven tests passed, zero failed/skipped.
- `env -i PATH=/home/chichieh/.nvm/versions/node/v24.15.0/bin:/usr/bin:/bin NODE_DISABLE_COMPILE_CACHE=1 /home/chichieh/.nvm/versions/node/v24.15.0/bin/node tools/testing/run.mjs evaluation/algorithm-development/test/relation-binding-corpus.test.mjs`: exit 0; seven tests passed, zero failed/skipped.
- Per-case source code points, R01–R12: 681, 464, 530, 496, 514, 607, 516, 551, 550, 522, 620, 205. Maximum: 681, below the 4,000 bound.
- `git diff --check`: exit 0. At that precommit checkpoint, intent-to-add entries made all four new files inspectable in the diff; no content had been staged or committed.
- Independent inventory routes were `git diff --name-only 47a4eb14db3fc69d8538222f55a4b29c8ab4ec12` and `find evaluation/algorithm-development docs/plans -type f -name 'relation-binding-*'`. Sorted comparison with Node strict assertions: exit 0, equal, count 4. The inventory includes both JSON files, the standalone test, and this note.

The source/question packet was unchanged during the rubric clarification. The
new concise-answer and severe-class checks verify documented fixture contracts,
not an evaluator's ability to judge free-form text. Actual verdict controls and
the final combined runtime gates remain primary integration work.
