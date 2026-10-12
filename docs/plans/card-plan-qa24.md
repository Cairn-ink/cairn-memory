# Fresh card-plan QA24 corpus — prospective offline contract

Primary decision 2026-10-12. This is a new independently authored mechanism
diagnostic, not an old-cohort repair, benchmark score, live runner or grant.
Freeze content and source-anchored rubric before any evaluated-model call.

Fixed initial base30f297c204249e3940383b40a7e58261abfccdef,
worktree /home/chichieh/Github/cairn-memory-worktrees/card-plan-qa24,
branch experiment/card-plan-qa24. Dependency wiring may be integrated by the
primary before final acceptance; final full base and exact bytes are recorded.
The source author does not implement or read new invocation/runner/scorer code.

Allowed six paths only:
- evaluation/algorithm-development/card-plan-cases.json (new)
- evaluation/algorithm-development/card-plan-rubric.json (new)
- evaluation/algorithm-development/card-plan-profile.mjs (new)
- evaluation/algorithm-development/test/card-plan-corpus.test.mjs (new)
- docs/plans/card-plan-qa24.md (new; preserve this contract verbatim as prefix)
- docs/limitations.md (append only; primary serializes other appends)

CQ1 — Author24 new cases CQ01–CQ24 in that fixed order; twelve sessions/cards
each with one message. First18 are answerable; last6 qualified. Interleave six
families by ordinal modulo6: prerequisite-chain, evolving-decision,
scope-exception, proposal-quotation, entity-link, compositional-set. Every family
has three answerable and one qualified case. New inert names/scenarios and
direct source relations; no consulting closed source-bundle/complementary
cases, their rubrics/results/answers, official holdouts, first-judge payloads,
or adapting previous failures into these cases. Author may read schemas and
generic validation/preparation utilities, not old test fixture contents.

CQ2 — Source-facing schema is exactly an array of {id,family,question,sessions};
question:{text,date}; session:{id,eventTime,messages}; message:{role,content}.
IDs CQnn-S01 through S12; real ISO UTC eventTime strictly increasing per case
and no later than question date. Dates YYYY-MM-DD for questions. English source
content40–360 UTF16 and question1–400, well-formed/no control chars or secrets;
roles user/assistant. Each card has a meaningful unique proposition; no labels
like gold, required evidence, family or evaluator hints in its text. Distractors
must be plausible topical alternatives with different subjects/scopes/times,
not trivial unrelated filler. Original role is attribution, not authentication.
Do not equate a suggested/quoted preference with an adopted decision.

CQ3 — Separate rubric version card-plan-qa24-rubric-v1 with {version,cases}.
Each row has exactly id,answerability,expectedProposition,
acceptableQualifiedAnswer,unanswerabilityReason,factualClaims,anchors,
requiredEvidenceSets,unsupportedConclusions,staleUse,severeConditions,
provenance,ambiguity,optionalContextClaims. factualClaims,
unsupportedConclusions,severeConditions are nonempty arrays of strings;
severeConditions1–8. unanswerabilityReason null for answerable, explicit missing
link/scope/confirmation for qualified. Other prose fields nonempty strings.
anchors:{id,sessionId,messageIndex:0,start,end,text}, nonempty exact UTF16 source
slices. requiredEvidenceSets:{name,anchorIds}; optionalContextClaims:
{claim,anchorIds}. Each referenced anchor must exist, IDs unique and no duplicate
refs. Required sets are minimal sufficient supports for exactly the requested
proposition, not every related sentence. Any independently sufficient shortcut
must be included as an alternative or removed from the source before freeze.

Answerable cases have one or more complete necessary alternatives of3–6
distinct cards; target sizes for CQ01–18 are
[3,4,5,6,3,4,4,5,6,3,4,5,5,6,3,4,5,6]. Do not pad a minimal set to hit a target;
make the question genuinely request that information. Qualified sets instead
use their honest minimal1–6cards, never penalize an adequate explicit unknown
for failing to retrieve irrelevant context. A qualification answer must state
what is known and what unresolved relation prevents a definitive answer,
without turning uncertainty into a universal prohibition or permission.
Document a per-required-card necessity rationale and inspect every distractor
for unintended shortcuts. This is author justification, not independent truth;
independent semantic review is still required before freeze.

CQ4 — Pure source-only profile exports CARD_PLAN_QA_VERSION='card-plan-qa24-v1',
cardPlanQaRoster, cardPlanQaLimits, validateCardPlanQaCases,
loadCardPlanQaCases, prepareCardPlanQaCase(input,caseId). Frozen constants and
detached frozen descriptor-only validated JSON. Reject proxies/accessors,
custom prototypes, inherited toJSON hooks, cycles, sparse/oversized data without
executing hooks. Reuse narrow accepted data utilities where appropriate; do
not modify prior profiles or add policy/schema/model ports. Bounded loader
checks exact raw-file and validated-value SHA256; preparation also binds value
hash, rejects drift, and imports only existing pure source preparation utilities.
Do not import rubric, SQLite, provider adapter, transport, runner or scorer.

Prepare via unchanged prepareMixedSourceCase(...,'indexed-evidence-v1') with
namespace ownerId card-plan-offline-owner and lme-case hash of version:caseId;
hash session/turn identifiers. Return {version,id,plan,question,sourceProvenance}
where question preserves original text/canonical date, provenance maps original
session/time/role to rendered hashed IDs. Assert12 windows/turns/batches,
1 message/window each,0 excluded future,window<=800chars. Family/evaluator IDs,
rubric/gold/anchors/required sets/severe labels must not enter model-facing
query, content, source windows or capture calls. IDs may remain external
provenance only. Limits remain6000 full local request,7024 provider input,
1024 rank output,512 answer output; no enlargement and no paid runtime here.

CQ5 — Tests first. Independently check exact raw-source anchors, actual minimal
set reference counts, all24 roster/family/role/date/bounds, raw/value hashes,
all24 actual pure preparations and normalization/source span round trips,
no evaluator/gold leakage into model-facing artifacts. Do not call production
helper to produce its own expected oracle. Reject shape/text/date/roster/hash
drift, extra fields, malformed Unicode, getters/proxies/toJSON, sparse/cyclic
input and limits with no hook side effects. Loading/cleanup tests use owned
workspaces including expected failure. No golden answer is ever model input.

CQ6 — Repository test:algorithm-development already includes its test/*.test.mjs
glob in both CI runtimes: prove discovery rather than changing CI/package.json.
Focused corpus+existing source preparation checks, test:algorithm-development,
npm test and validate on Nodes22.16/24.15, actual exits/counts and no unexpected
owned scratch on success/failure. Primary reruns final combined paths and both
validators, cross-checks Git diff and full filesystem/base-blob inventory,
commits exact candidate, then fresh independent Standards and Spec. Spec
explicitly audits all24 source/rubric rows for entailment/minimal supports/
shortcuts/qualified fairness, not just tests. Exact-head CI and mergeability
before delivery. No worker commit/push, no main merge/release/deploy.

CQ7 — Record no paid calls, mock semantic score or retention/default change.
Source-only authored complete-candidate/scripted-capture scope, not natural
extraction, long-history navigation, official LongMemEval/Mem0, lightweight-fit
or product reliability evidence. Future sole promotion comparison is new
card-plan selection versus ordinary selection with IDENTICAL identity-bearing
flat whole-card answer context; matched grouping control is diagnostic only,
not a posthoc winner. The grouped projection/coordinator/scorer/store setup,
prepared-artifact reviews and budget preflight remain separate future gates.
Original cumulative400USD/protected30USD unchanged. No operational ledger,
credentials, internet/provider, closed-run artifact reads or writes in this task.

Checkpoints: (1) interfaces plus a six-case semantic blueprint, one per family,
and behavioral red BEFORE filling24; wait for primary. (2) all24 draft source/
rubric necessity audit and focused checks, wait for primary. (3) fixed-byte full
gates and six-path inventory, then stop writing. Retain failed diagnostics;
after two unsuccessful corrections on the same issue stop and escalate.

## Primary dependency integration

After the primary's all24 semantic checkpoint and pre-evaluation fairness
corrections, the task branch was fast-forwarded from its initial CP dependency
to the fixed CW candidate fcdc99dbce182bf9f63880dd86dc780e7d376ad7 on2026-10-12.
This is the final full review base unless explicitly superseded after CW review.
CW independent review/CI remain separate delivery gates; no live run follows.
The six owned paths were retained in named backup stash
109b99c8b013493185f8fdbe6133d8272ea65eb2 before integration; it is not dropped.
The sole conflict was two append-only docs/limitations.md sections. Primary
preserved both in order using the conflict-resolution workflow; no source,
rubric, profile or test byte was changed by the integration. Final gates run
against this combined dependency tree, not the initial pre-integration state.

## Checkpoint 1: prospective interfaces and semantic blueprint

No corpus rows have been filled and no evaluated model has been invoked.
The author works at base30f297c204249e3940383b40a7e58261abfccdef in
experiment/card-plan-qa24. Primary owns commit, independent review and delivery.
This plan retains the immutable contract above verbatim.

The source profile will export the exact CQ4 names. validateCardPlanQaCases
accepts the complete source array, copies only own enumerable data descriptors,
rejects proxies before reflection via node:util types.isProxy, bounds traversal
before allocation, validates shape/roster/text/calendar/chronology, and returns
a detached deeply frozen array. loadCardPlanQaCases(file?) performs a bounded
regular-file read and verifies exact raw and validated-value hashes.
prepareCardPlanQaCase(input,caseId) revalidates and binds the value hash before
calling only unchanged pure prepareMixedSourceCase with indexed-evidence-v1.
It returns the external version/id, pure plan, original question text with
canonical date, and original-to-hashed source provenance. Provenance will include
rendered session and turn IDs as well as original session/time/message/role.
Frozen limits retain 6000/7024/1024/512 tokens; no provider or scoring port exists.

Rubric rows use the exact CQ3 field list; anchors are literal source slices.
Each support set is minimal for the entire explicit question. Individual cards
need not state a full answer. Optional related claims are separately anchored.
The raw source file will have no labels, answers, required-set metadata or
evaluator markers.

| Initial case/family | Requested proposition and planned support | Necessity rationale |
| --- | --- | --- |
| CQ01 prerequisite-chain (3) | For Orin's paper exhibit, state the ordered prerequisites for releasing a viewing lens: mount bracket before badge stamping; stamped badge before tray claim; claimed tray before lens release. | Each card supplies one separate ordered prerequisite; removing any card leaves a requested step ungrounded. No other card describes the whole route. |
| CQ02 evolving-decision (4) | For Luma's archive pickup, identify the original copper choice, replacement cedar choice, recorded revision reason and pickup time. | Initial adoption, explicit replacement, decision-linked reason and current pickup time live on different cards. The question requests all four facts, so a current-choice summary is insufficient. |
| CQ03 scope-exception (5) | Determine the applicable lane and badge requirement for a particular chilled crate under a baseline, chilled exception, exception condition, lane rule and crate classification. | Each rule constrains a separate part of the requested conclusion; crate classification connects the rules to this shipment. No manifest repeats the resulting lane or authorization. |
| CQ04 proposal-quotation (6) | For Ivo's display ribbon, give the original and current adopted choices, Rhea's quoted preference, the assistant's proposal, Ivo's considered option and his rejection rationale. | Six distinct requested facts use six cards. Explicit quoting, proposing, considering and rejecting remain separate from adoption. A current adoption does not substitute for the requested historical choice or other claimants' positions. |
| CQ05 entity-link (3) | Resolve a nickname on an atelier parcel to its stable carton and report its assigned shelf. | Nickname-to-tag mapping, tag-to-carton mapping and carton-to-shelf mapping are separate necessary links. Similar names, another carton's shelf and another room's tag are topical distractors. |
| CQ06 compositional-set (4) | Enumerate the desk tokens eligible for the afternoon display using the adopted intersection-minus-exclusion rule. | One card supplies the exact roster, one the seal subset, one the withdrawn subset and one the adopted combination rule. None repeats the resulting set. |

The next answerable waves retain the six families in order and introduce fresh
subjects and direct source relations with target support sizes
4,5,6,3,4,5 then 5,6,3,4,5,6. Qualified cases CQ19–24 will ask
what is known and what prevents a definitive answer. Their honest minimal
supports will be justified individually; missing facts will never be inferred
from silence, an unrelated scope, another entity, a quote or a proposal.
A qualified answer naming the known facts and exact missing relation will not
be penalized for omitting optional background.

All twelve planned cards per case must carry distinct topical propositions.
Each distractor will be inspected for same-subject/scope/time shortcuts.
Questions will state every requested component plainly rather than requiring
arbitrary background to reach a size target. Any independent complete support
will be represented as an alternative set or removed before freeze.

### Retained first red

The checkpoint profile is an importable placeholder. The first roster assertion
expects all24 fixed IDs; its empty actual roster is a behavioral failure.
The malicious-descriptor assertion also fails because the placeholder accepts
invalid inputs. Syntax and imports succeed. On Node22.16.0,
`node tools/testing/run.mjs evaluation/algorithm-development/test/card-plan-corpus.test.mjs`
exited1:3 tests,1 pass,2 assertion failures (roster mismatch and missing expected
TypeError). The owned runner completed; no source fill has occurred.
Waiting for primary acceptance before source fill.

## Checkpoint 2: authored draft semantic audit

All24 sources are new inert contexts, ordered by the frozen six-family cycle.
Required supports are spread across twelve card positions and are not a first-N
prefix. The author inspected all288 propositions; the table below records every
necessary card and enumerates every distractor. This is author justification,
not independent semantic judgment. No evaluated model or scorer was run.
CQ04 is a six-part stance/provenance completeness request, not a six-hop claim.
Qualified support sizes1–6 follow their concrete requested known facts and
explicit gaps; they are not padded with optional background. Every minimal
set has one anchor per distinct necessary card. No independent sufficient
shortcut was authored, so there is no omitted alternative complete support.

### CQ01: prerequisite-chain, answerable, 3 cards

Question: For Orin's paper exhibit, what are the ordered prerequisites leading to release of the viewing lens?

| Required card | Requested fact | Why removal leaves an unsupported requested component |
| --- | --- | --- |
| CQ01-S02 | Mount the bracket before stamping the badge. | Provides the first ordering edge; no other card states bracket-to-badge. |
| CQ01-S07 | Stamp the badge before claiming the tray. | Provides the middle edge; removing it leaves tray access disconnected. |
| CQ01-S11 | Claim the viewing tray before lens release. | Provides the terminal edge that connects the route to the requested lens. |

These cards jointly answer the complete question. No individual card or distractor repeats all requested components.

Distractor inspection:

- CQ01-S01: The clay exhibit next door stamps its visitor badges before mounting a display bracket.
- CQ01-S03: Orin's paper exhibit keeps spare visitor badges in the narrow drawer beneath the desk.
- CQ01-S04: The paper exhibit's closing inventory counts each viewing lens in a separate padded sleeve.
- CQ01-S05: Visitors at the paper exhibit may look at the wall map while waiting for a badge stamp.
- CQ01-S06: Orin's practice tray is for the rehearsal desk and does not enter the visitor lens queue.
- CQ01-S08: The clay exhibit releases its large lens when the display cloth has been folded away.
- CQ01-S09: The paper exhibit desk prints replacement badge cards on cream stock each Wednesday.
- CQ01-S10: Orin's tray transport box has four shallow slots for moving trays between rehearsal rooms.
- CQ01-S12: The paper exhibit lends a reading mirror through a separate queue after the visitor signs a slip.

Every listed distractor contributes its own topical proposition about another subject, time, scope, physical feature or unadopted suggestion. None supplies a missing requested fact for the target under the stated scope. Source-only preparations contain no row from this audit.

### CQ02: evolving-decision, answerable, 4 cards

Question: For Luma's archive pickup, what were the original and replacement material choices, the recorded reason for that revision, and the pickup time?

| Required card | Requested fact | Why removal leaves an unsupported requested component |
| --- | --- | --- |
| CQ02-S01 | The original adopted material was copper. | Sole original adoption; replacement source does not restate the old value. |
| CQ02-S04 | Cedar replaced the previous adopted material. | Sole replacement and current material; leaves earlier value to its own card. |
| CQ02-S07 | The recorded revision reason was a lighter stairway carrying load. | Sole explicit reason link; does not mention either material. |
| CQ02-S09 | The confirmed pickup time is 14:20. | Only appointment time for this pickup; requested separately. |

These cards jointly answer the complete question. No individual card or distractor repeats all requested components.

Distractor inspection:

- CQ02-S02: Luma's archive return uses birch packing, which was chosen independently of the pickup material.
- CQ02-S03: The archive visitor desk opens its afternoon waiting room at 13:40 on this review day.
- CQ02-S05: Luma considered adding a second carrying strap to the archive pickup bag but has not adopted it.
- CQ02-S06: Neris adopted copper for her map-room pickup, whose route has no stairway.
- CQ02-S08: The archive's stairway sign recommends keeping the right hand free when carrying a parcel.
- CQ02-S10: Luma's spring archive pickup used an oak box and was completed several months ago.
- CQ02-S11: The archive librarian proposed a later visitor-desk closing time for next month's schedule.
- CQ02-S12: The visitor desk stores spare cedar samples in a labeled drawer for material demonstrations.

Every listed distractor contributes its own topical proposition about another subject, time, scope, physical feature or unadopted suggestion. None supplies a missing requested fact for the target under the stated scope. Source-only preparations contain no row from this audit.

### CQ03: scope-exception, answerable, 5 cards

Question: For crate Tavi in the current workshop handling cycle, what classification and latch, wrapping, badge and lane requirements follow from the notes?

| Required card | Requested fact | Why removal leaves an unsupported requested component |
| --- | --- | --- |
| CQ03-S10 | A closed latch remains mandatory. | Only baseline latch rule; the exception replaces only wrapping. |
| CQ03-S03 | Use an insulated sleeve rather than the baseline cloth wrap. | Only wrapping replacement; cannot remove the independent latch rule. |
| CQ03-S08 | The insulated sleeve handling requires a cobalt badge. | Only badge condition on this exception. |
| CQ03-S01 | Chilled crates use the south lane. | Only lane rule for chilled crates. |
| CQ03-S06 | Tavi is chilled in the applicable cycle. | Only subject-to-classification link, needed to apply all exception rules. |

These cards jointly answer the complete question. No individual card or distractor repeats all requested components.

Distractor inspection:

- CQ03-S02: The workshop sends dry crates through the north handling lane during the same handling cycle.
- CQ03-S04: Crate Selvo is classified as dry in the workshop manifest and carries a violet desk sticker.
- CQ03-S05: The cloth wrapping shelf contains amber rolls for the workshop's ordinary dry-crate work.
- CQ03-S07: The repair annex uses open latches for empty crates awaiting hinge inspection.
- CQ03-S09: Yesterday's manifest listed crate Tavi as dry before the current handling cycle began.
- CQ03-S11: The workshop's cobalt badge storage rack is beside the south wall, away from the lane gate.
- CQ03-S12: A trial note proposes a silver handling badge for next season's insulated sleeves.

Every listed distractor contributes its own topical proposition about another subject, time, scope, physical feature or unadopted suggestion. None supplies a missing requested fact for the target under the stated scope. Source-only preparations contain no row from this audit.

### CQ04: proposal-quotation, answerable, 6 cards

Question: For Ivo's display ribbon, give the original and current adopted colors, Rhea's quoted preference, the assistant's proposal, Ivo's considered option, and his recorded rejection reason.

| Required card | Requested fact | Why removal leaves an unsupported requested component |
| --- | --- | --- |
| CQ04-S02 | Ivo initially adopted green. | Sole initial adoption; current choice source does not identify predecessor. |
| CQ04-S04 | Rhea's quoted preference was amber for her own ribbon. | Only quoted claimant/value attribution; does not establish Ivo adoption. |
| CQ04-S06 | The assistant proposed violet. | Only assistant proposal; attributed role is assistant. |
| CQ04-S08 | Ivo considered amber without adopting it. | Only explicit consideration stance for Ivo. |
| CQ04-S10 | Ivo rejected his considered option because it blended into the backdrop. | Only recorded rejection reason; value linked through consideration card. |
| CQ04-S12 | Ivo's current adopted color is teal. | Only current adoption; history and other claimants remain separate. |

These cards jointly answer the complete question. No individual card or distractor repeats all requested components.

Distractor inspection:

- CQ04-S01: Rhea's earlier stage ribbon was navy during the winter installation at another gallery.
- CQ04-S03: Ivo's gallery lighting plan uses warm white bulbs in the small display alcove.
- CQ04-S05: The gallery shop stocks amber sample cards for visitors choosing their own ribbon colors.
- CQ04-S07: A separate rehearsal uses violet flags, chosen by the rehearsal coordinator instead of Ivo.
- CQ04-S09: Ivo's ribbon spool for the travel case remains cream and is outside the gallery installation.
- CQ04-S11: The gallery backdrop was cleaned before the ribbon review and kept its existing texture.

Every listed distractor contributes its own topical proposition about another subject, time, scope, physical feature or unadopted suggestion. None supplies a missing requested fact for the target under the stated scope. Source-only preparations contain no row from this audit.

### CQ05: entity-link, answerable, 3 cards

Question: For the atelier parcel marked Wisp, give the current nickname-to-tag-to-carton mapping path and its assigned shelf.

| Required card | Requested fact | Why removal leaves an unsupported requested component |
| --- | --- | --- |
| CQ05-S09 | Wisp maps to routing tag fern. | First unique identity link from the question subject. |
| CQ05-S03 | Routing tag fern identifies carton Beryl. | Second identity link; tag alone carries no shelf. |
| CQ05-S07 | Carton Beryl is assigned shelf Juniper. | Only requested property at the resolved terminal identity. |

These cards jointly answer the complete question. No individual card or distractor repeats all requested components.

Distractor inspection:

- CQ05-S01: The atelier parcel nickname Flicker maps to routing tag willow in the same parcel ledger.
- CQ05-S02: Routing tag willow identifies carton Sable for the atelier's current parcel sorting cycle.
- CQ05-S04: The atelier assigns carton Sable to shelf Alder during the current sorting cycle.
- CQ05-S05: The neighboring studio uses routing tag fern for its paint trolley, separate from atelier parcels.
- CQ05-S06: The atelier's Juniper shelf has a felt liner to protect the carton bases during sorting.
- CQ05-S08: Last month's ledger mapped Wisp to routing tag moss before the current parcel ledger took effect.
- CQ05-S10: The atelier assigns carton Opal to shelf Birch for today's packing supplies.
- CQ05-S11: Carton Beryl carries a blue transport handle, which is not a routing tag.
- CQ05-S12: The atelier parcel nickname Glint maps to routing tag reed for the label-printing queue.

Every listed distractor contributes its own topical proposition about another subject, time, scope, physical feature or unadopted suggestion. None supplies a missing requested fact for the target under the stated scope. Source-only preparations contain no row from this audit.

### CQ06: compositional-set, answerable, 4 cards

Question: Under the adopted afternoon display rule, which desk tokens are eligible? Show how the roster, seal list and withdrawal list combine.

| Required card | Requested fact | Why removal leaves an unsupported requested component |
| --- | --- | --- |
| CQ06-S12 | The roster is Vela, Nook, Pavo and Daro. | Bounds the universe; spare Zeno occurs on seal list but is outside roster. |
| CQ06-S05 | The blue-seal list is Vela, Nook, Pavo and Zeno. | Excludes roster member Daro; omission changes eligibility. |
| CQ06-S02 | Nook alone is withdrawn. | Removes an otherwise eligible item, separate from its seal. |
| CQ06-S09 | The adopted rule is roster intersect blue seals minus withdrawals; Vela and Pavo qualify. | Defines actual composition; alternate rules cannot be presumed. |

These cards jointly answer the complete question. No individual card or distractor repeats all requested components.

Distractor inspection:

- CQ06-S01: The morning display selected Daro and Nook under a rule that used yellow seals.
- CQ06-S03: The spare cabinet holds Zeno with the other overflow tokens outside the afternoon desk roster.
- CQ06-S04: Pavo's token has a shallow round rim for easier lifting from the display tray.
- CQ06-S06: The desk coordinator proposed keeping withdrawn tokens visible on a separate demonstration board.
- CQ06-S07: The yellow-seal list for the afternoon desk contains Vela and Daro for a different activity.
- CQ06-S08: The evening desk roster will be decided after the afternoon display has ended.
- CQ06-S10: A replacement blue seal for Nook is stored in the lower desk drawer.
- CQ06-S11: The afternoon display tray has six recesses, including two kept empty for handling space.

Every listed distractor contributes its own topical proposition about another subject, time, scope, physical feature or unadopted suggestion. None supplies a missing requested fact for the target under the stated scope. Source-only preparations contain no row from this audit.

### CQ07: prerequisite-chain, answerable, 4 cards

Question: For Soren's lantern stand, what is the full ordered prerequisite route from fastening the foot to displaying the lantern?

| Required card | Requested fact | Why removal leaves an unsupported requested component |
| --- | --- | --- |
| CQ07-S03 | Fasten the foot before inserting the rod. | Sole foot-to-rod prerequisite. |
| CQ07-S11 | Insert the rod before fitting the shade ring. | Sole rod-to-ring prerequisite. |
| CQ07-S06 | Fit the shade ring before attaching the lantern. | Sole ring-to-lantern prerequisite. |
| CQ07-S01 | Attach the lantern before entering the display bay. | Sole terminal prerequisite for display. |

These cards jointly answer the complete question. No individual card or distractor repeats all requested components.

Distractor inspection:

- CQ07-S02: The practice lantern stand inserts its rod before fastening its detachable foot.
- CQ07-S04: Soren's lantern shade is stored in a square sleeve when the stand is not on display.
- CQ07-S05: The display bay's afternoon inspection checks for loose floor tiles along the entrance.
- CQ07-S07: Soren's spare foot has a padded base for demonstrations on the rehearsal table.
- CQ07-S08: The lantern transport trolley is parked beside the storage curtain before setup begins.
- CQ07-S09: The canopy stand may enter the display bay before its fabric has been attached.
- CQ07-S10: Soren's lantern uses a paper shade with an unprinted rim for this installation.
- CQ07-S12: The display bay clerk records each stand's exit time on a separate inventory slip.

Every listed distractor contributes its own topical proposition about another subject, time, scope, physical feature or unadopted suggestion. None supplies a missing requested fact for the target under the stated scope. Source-only preparations contain no row from this audit.

### CQ08: evolving-decision, answerable, 5 cards

Question: For Emina's reading alcove, give her initial and replacement seating choices, the recorded change reason, the opening time and the chosen lamp setting.

| Required card | Requested fact | Why removal leaves an unsupported requested component |
| --- | --- | --- |
| CQ08-S02 | Emina initially adopted a bench. | Only initial seating adoption. |
| CQ08-S04 | Emina now adopts a stool. | Only explicit seating replacement. |
| CQ08-S07 | The recorded reason was easier lower-shelf access. | Only reason tied to revision, no choice values restated. |
| CQ08-S08 | The opening time is 09:35. | Only alcove-specific opening time. |
| CQ08-S12 | The adopted lamp setting is diffuse. | Only requested current lamp setting. |

These cards jointly answer the complete question. No individual card or distractor repeats all requested components.

Distractor inspection:

- CQ08-S01: The neighboring writing alcove opens at 10:10 and uses a high-backed chair.
- CQ08-S03: Emina's travel reading kit includes a folding bench for outdoor breaks.
- CQ08-S05: The alcove librarian proposed a focused lamp beam but Emina did not adopt the proposal.
- CQ08-S06: The lower shelf in the writing alcove was moved upward after a separate review.
- CQ08-S09: Emina's reading-alcove window shade remains rolled halfway for the current arrangement.
- CQ08-S10: The diffuse lamp setting in the map room was selected by Halden, not Emina.
- CQ08-S11: The daily room schedule lists the main corridor opening before any alcove opens.

Every listed distractor contributes its own topical proposition about another subject, time, scope, physical feature or unadopted suggestion. None supplies a missing requested fact for the target under the stated scope. Source-only preparations contain no row from this audit.

### CQ09: scope-exception, answerable, 6 cards

Question: For sample Mira in the current sample-room handling cycle, what classification, room, cap, wrapping, label and lane requirements follow from the notes, and what limits the wrapping exception's scope?

| Required card | Requested fact | Why removal leaves an unsupported requested component |
| --- | --- | --- |
| CQ09-S05 | Mira still requires a closed cap. | Sole retained baseline cap requirement. |
| CQ09-S10 | Chalk under the exception uses a soft pouch instead of plain wrap. | Only wrapping exception mechanism. |
| CQ09-S01 | The pouch exception is limited to the east room. | Only scope restriction, needed alongside sample type. |
| CQ09-S07 | The exception requires an ivory label. | Only additional label condition. |
| CQ09-S03 | Mira uses the inner lane. | Only type/scope-specific lane rule. |
| CQ09-S12 | Mira is chalk and in the east room. | Only connects target sample to type and room. |

These cards jointly answer the complete question. No individual card or distractor repeats all requested components.

Distractor inspection:

- CQ09-S02: Chalk sample Ero is in the west room, which uses its ordinary wrapping rule.
- CQ09-S04: The east room's clay samples use the outer lane during the same handling cycle.
- CQ09-S06: The sample-room ivory label stock is counted every Friday before restocking.
- CQ09-S08: A draft proposal would extend the chalk pouch exception to the west room next season.
- CQ09-S09: Last cycle, sample Mira was assigned to the north room before this cycle's reassignment.
- CQ09-S11: The repair desk leaves empty display tubes uncapped while their hinges are being cleaned.

Every listed distractor contributes its own topical proposition about another subject, time, scope, physical feature or unadopted suggestion. None supplies a missing requested fact for the target under the stated scope. Source-only preparations contain no row from this audit.

### CQ10: proposal-quotation, answerable, 3 cards

Question: For Nalia's keepsake folder, what color did she adopt, whose preference was quoted and what was its value, and what did the assistant merely suggest?

| Required card | Requested fact | Why removal leaves an unsupported requested component |
| --- | --- | --- |
| CQ10-S02 | Nalia adopted rust. | Sole adoption by actual decision maker. |
| CQ10-S08 | Oren's quoted personal preference was lilac. | Sole quoted claimant and value. |
| CQ10-S11 | The assistant suggested jade as an alternative. | Sole attributed assistant proposal, not adoption. |

These cards jointly answer the complete question. No individual card or distractor repeats all requested components.

Distractor inspection:

- CQ10-S01: Nalia's old travel folder was tan during last year's keepsake sorting trip.
- CQ10-S03: Oren adopted a navy envelope for a separate letters project on another desk.
- CQ10-S04: The desk shop stocks lilac card samples for people considering keepsake folders.
- CQ10-S05: Nalia's folder divider tabs carry month names in black pencil lettering.
- CQ10-S06: The rehearsal desk uses a jade cover for a demonstration folder owned by the coordinator.
- CQ10-S07: A catalog lists rust folders in two sizes without recording Nalia's chosen size.
- CQ10-S09: The assistant suggested a wider desk lamp for Oren's separate letters project.
- CQ10-S10: The keepsake room's cabinet contains unused white folders for future visitors.
- CQ10-S12: Nalia's drawer label is orange and serves a storage task separate from the folder color.

Every listed distractor contributes its own topical proposition about another subject, time, scope, physical feature or unadopted suggestion. None supplies a missing requested fact for the target under the stated scope. Source-only preparations contain no row from this audit.

### CQ11: entity-link, answerable, 4 cards

Question: Resolve the workshop bundle nickname Drift through the current mappings and identify the final assigned cabinet.

| Required card | Requested fact | Why removal leaves an unsupported requested component |
| --- | --- | --- |
| CQ11-S04 | Drift maps to label sorrel. | Only question-subject-to-label mapping. |
| CQ11-S09 | Label sorrel maps to ticket Bellfin. | Only label-to-ticket link. |
| CQ11-S02 | Ticket Bellfin identifies bundle Corin. | Only ticket-to-bundle link. |
| CQ11-S12 | Bundle Corin is assigned cabinet Linden. | Only terminal cabinet property. |

These cards jointly answer the complete question. No individual card or distractor repeats all requested components.

Distractor inspection:

- CQ11-S01: Workshop bundle nickname Eddy maps to label tansy for the current sorting cycle.
- CQ11-S03: Label tansy maps to ticket Wrenlet in the workshop's current bundle register.
- CQ11-S05: Ticket Wrenlet identifies bundle Meris in the current workshop sorting cycle.
- CQ11-S06: The workshop assigns bundle Meris to cabinet Rowan during the current cycle.
- CQ11-S07: The neighboring tool room uses label sorrel for its cleaning cart, outside the bundle register.
- CQ11-S08: Last cycle, Drift mapped to label thyme before the current register replaced that mapping.
- CQ11-S10: Cabinet Linden has two deep shelves for bundles and a shallow shelf for empty tags.
- CQ11-S11: Bundle Corin's transport sleeve is gray and bears a separate handling pictogram.

Every listed distractor contributes its own topical proposition about another subject, time, scope, physical feature or unadopted suggestion. None supplies a missing requested fact for the target under the stated scope. Source-only preparations contain no row from this audit.

### CQ12: compositional-set, answerable, 5 cards

Question: Which tray markers qualify under the adopted evening rule, and how do the roster, round-edge list, stamped list and withdrawal list determine that set?

| Required card | Requested fact | Why removal leaves an unsupported requested component |
| --- | --- | --- |
| CQ12-S07 | The roster is Aster, Bina, Cero, Dune and Evi. | Excludes spare Fenn even though both positive lists include it. |
| CQ12-S01 | The round-edge list is Aster, Bina, Cero, Dune and Fenn. | Excludes Evi, which would otherwise qualify. |
| CQ12-S10 | The stamped list is Aster, Bina, Cero, Evi and Fenn. | Excludes Dune, which would otherwise qualify. |
| CQ12-S04 | Cero alone is withdrawn. | Removes an otherwise eligible member. |
| CQ12-S12 | The rule intersects roster, round-edge and stamped sets, then subtracts Cero; Aster and Bina qualify. | Sole adopted combination rule. |

These cards jointly answer the complete question. No individual card or distractor repeats all requested components.

Distractor inspection:

- CQ12-S02: The morning tray display used Evi and Dune under a different edge-only rule.
- CQ12-S03: The spare marker Fenn stays in the side cabinet outside the evening tray roster.
- CQ12-S05: Bina's marker has a dark center dot for visitors handling it during demonstrations.
- CQ12-S06: The coordinator proposed displaying withdrawn Cero on a separate explanatory board.
- CQ12-S08: The square-edge list includes Cero and Evi for the evening packing exercise.
- CQ12-S09: The tray has seven marker recesses, two of which are used only during cleaning.
- CQ12-S11: Tomorrow's marker roster will be posted after the evening display closes.

Every listed distractor contributes its own topical proposition about another subject, time, scope, physical feature or unadopted suggestion. None supplies a missing requested fact for the target under the stated scope. Source-only preparations contain no row from this audit.

### CQ13: prerequisite-chain, answerable, 5 cards

Question: For Vero's model boat exhibit, give the full ordered prerequisite route from setting the keel block to opening the visitor barrier.

| Required card | Requested fact | Why removal leaves an unsupported requested component |
| --- | --- | --- |
| CQ13-S06 | Set the keel block before fitting the support rail. | Sole first prerequisite edge. |
| CQ13-S12 | Fit the support rail before placing the hull. | Sole rail-to-hull prerequisite. |
| CQ13-S03 | Place the hull before inserting the mast pin. | Sole hull-to-pin prerequisite. |
| CQ13-S09 | Insert the mast pin before hanging the sail card. | Sole pin-to-card prerequisite. |
| CQ13-S01 | Hang the sail card before opening the visitor barrier. | Sole terminal link to visitor access. |

These cards jointly answer the complete question. No individual card or distractor repeats all requested components.

Distractor inspection:

- CQ13-S02: The rehearsal boat stand places its hull before fitting a detachable support rail.
- CQ13-S04: Vero's spare keel block is kept in a felt pouch beside the supply drawer.
- CQ13-S05: The exhibit's exit barrier is closed separately when the floor is being cleaned.
- CQ13-S07: The model boat cabin card hangs on a different display peg from the sail card.
- CQ13-S08: Vero's boat transport box contains a spare mast pin in a padded corner slot.
- CQ13-S10: The neighboring glider exhibit opens its visitor barrier after the wing card is placed.
- CQ13-S11: The boat exhibit's sail card is printed on cream stock with a blue border.

Every listed distractor contributes its own topical proposition about another subject, time, scope, physical feature or unadopted suggestion. None supplies a missing requested fact for the target under the stated scope. Source-only preparations contain no row from this audit.

### CQ14: evolving-decision, answerable, 6 cards

Question: For Saela's sketching station, state the original and replacement surface choices, the recorded reason, the opening time, the adopted stool height and the chosen shade position.

| Required card | Requested fact | Why removal leaves an unsupported requested component |
| --- | --- | --- |
| CQ14-S01 | Saela initially adopted slate. | Sole initial surface adoption. |
| CQ14-S03 | Saela now adopts cork instead of the previous selection. | Sole replacement adoption; earlier value separate. |
| CQ14-S05 | The recorded revision reason was reduced reflected glare. | Sole linked rationale; does not restate choices. |
| CQ14-S08 | The opening time is 11:15. | Only target opening time. |
| CQ14-S10 | The adopted stool height is middle. | Sole target stool-height adoption. |
| CQ14-S12 | The chosen shade position is half-lowered. | Sole target shade position. |

These cards jointly answer the complete question. No individual card or distractor repeats all requested components.

Distractor inspection:

- CQ14-S02: The neighboring tracing station opens at 10:45 and uses a polished timber surface.
- CQ14-S04: Saela's outdoor travel kit still uses a slate board for drawing away from the studio.
- CQ14-S06: The studio coordinator suggested the tallest stool setting but Saela did not adopt it.
- CQ14-S07: The west studio's window shade is fully lowered for a separate tracing activity.
- CQ14-S09: The cork sample drawer contains two unused thicknesses for later demonstrations.
- CQ14-S11: Saela's sketching-station paper tray remains square and sits on the lower shelf.

Every listed distractor contributes its own topical proposition about another subject, time, scope, physical feature or unadopted suggestion. None supplies a missing requested fact for the target under the stated scope. Source-only preparations contain no row from this audit.

### CQ15: scope-exception, answerable, 3 cards

Question: For parcel Keslo in the current handling cycle, what route, lid and buffer requirements follow from the parcel-room notes?

| Required card | Requested fact | Why removal leaves an unsupported requested component |
| --- | --- | --- |
| CQ15-S08 | Keslo requires a closed lid. | Only baseline lid rule. |
| CQ15-S02 | Overnight parcels also require a cloth buffer. | Only additive route exception, preserving lid necessity. |
| CQ15-S11 | Keslo is on the overnight route. | Only subject-to-route link. |

These cards jointly answer the complete question. No individual card or distractor repeats all requested components.

Distractor inspection:

- CQ15-S01: Parcel Vesna is on the daytime route and uses the ordinary handling sequence.
- CQ15-S03: The repair desk leaves empty parcel cases open while replacing their small hinges.
- CQ15-S04: Keslo used the daytime route last month before its current route assignment.
- CQ15-S05: The cloth buffer shelf holds unprinted white sheets beside the parcel-room door.
- CQ15-S06: The parcel-room team proposed removing buffers from next year's overnight procedure.
- CQ15-S07: The daytime-route trolley has a blue handle to distinguish it from the overnight trolley.
- CQ15-S09: Parcel Noro is on the overnight route but has its own separate manifest entry.
- CQ15-S10: The parcel-room west cabinet stores spare lids in descending size order.
- CQ15-S12: A transport label for Keslo gives a red corner mark rather than a handling instruction.

Every listed distractor contributes its own topical proposition about another subject, time, scope, physical feature or unadopted suggestion. None supplies a missing requested fact for the target under the stated scope. Source-only preparations contain no row from this audit.

### CQ16: proposal-quotation, answerable, 4 cards

Question: For Bram's paper lantern, state his adopted shape, Leto's quoted preference, the assistant's proposal and Bram's unadopted considered alternative.

| Required card | Requested fact | Why removal leaves an unsupported requested component |
| --- | --- | --- |
| CQ16-S01 | Bram adopted hexagonal. | Only committed target choice. |
| CQ16-S03 | Leto's quoted preference was oval for his own lantern. | Only quote and claimant. |
| CQ16-S07 | The assistant proposed square. | Only assistant proposal; source role assistant. |
| CQ16-S09 | Bram considered triangular without adopting it. | Only target consideration and nonadoption. |

These cards jointly answer the complete question. No individual card or distractor repeats all requested components.

Distractor inspection:

- CQ16-S02: Bram's travel lantern from last year was round and is stored outside this installation.
- CQ16-S04: Leto adopted a rectangular cover for a separate shade project in another room.
- CQ16-S05: The room shop stocks oval frame samples for visitors making their own lanterns.
- CQ16-S06: The rehearsal room uses square placards chosen by a different installation coordinator.
- CQ16-S08: Bram's lantern hook remains brass under the current room arrangement.
- CQ16-S10: The assistant suggested a wider wall hook for Leto's separate shade project.
- CQ16-S11: The triangular frame sample drawer is labeled in pencil to avoid ink transfer.
- CQ16-S12: The room lighting schedule alternates warm and neutral lamps at fixed visiting times.

Every listed distractor contributes its own topical proposition about another subject, time, scope, physical feature or unadopted suggestion. None supplies a missing requested fact for the target under the stated scope. Source-only preparations contain no row from this audit.

### CQ17: entity-link, answerable, 5 cards

Question: Resolve the cabinet-note nickname Quill through the current archive mappings and give the final assigned drawer.

| Required card | Requested fact | Why removal leaves an unsupported requested component |
| --- | --- | --- |
| CQ17-S12 | Quill maps to label heather. | Sole starting identity link. |
| CQ17-S04 | Label heather maps to ticket Solin. | Sole label-to-ticket link. |
| CQ17-S08 | Ticket Solin maps to bundle Neris. | Sole ticket-to-bundle link. |
| CQ17-S02 | Bundle Neris maps to storage case Halvo. | Sole bundle-to-case link. |
| CQ17-S10 | Case Halvo is assigned drawer Mallow. | Sole terminal property, available only after four identity links. |

These cards jointly answer the complete question. No individual card or distractor repeats all requested components.

Distractor inspection:

- CQ17-S01: Archive cabinet-note nickname Plume maps to label clover in the current register.
- CQ17-S03: Label clover maps to ticket Edrin in the archive's current cabinet-note cycle.
- CQ17-S05: Ticket Edrin maps to bundle Tovin, which has its own separate sorting path.
- CQ17-S06: Bundle Tovin maps to storage case Rovik in the current archive register.
- CQ17-S07: Storage case Rovik is assigned drawer Fern in the archive's cabinet-note cycle.
- CQ17-S09: The neighboring reading room uses label heather for a lamp cart, not an archive bundle.
- CQ17-S11: Last cycle, Quill mapped to label nettle before the current cabinet-note register took effect.

Every listed distractor contributes its own topical proposition about another subject, time, scope, physical feature or unadopted suggestion. None supplies a missing requested fact for the target under the stated scope. Source-only preparations contain no row from this audit.

### CQ18: compositional-set, answerable, 6 cards

Question: Which gallery counters qualify under the adopted closing display rule? Explain the roster, smooth list, stamped list, withdrawal list and narrow-fit list used in that calculation.

| Required card | Requested fact | Why removal leaves an unsupported requested component |
| --- | --- | --- |
| CQ18-S02 | The roster is Arlo, Bex, Cadi, Dema, Eno and Fira. | Excludes spare Gavo, present in all positive lists. |
| CQ18-S11 | The smooth list excludes Fira. | Removes Fira, otherwise on stamped and narrow-fit lists. |
| CQ18-S05 | The stamped list excludes Eno. | Removes Eno, otherwise smooth and narrow-fit. |
| CQ18-S09 | Cadi alone is withdrawn. | Removes an otherwise qualifying member. |
| CQ18-S01 | The narrow-fit list excludes Bex and Dema. | Removes Bex and Dema, otherwise smooth and stamped. |
| CQ18-S07 | The adopted four-way intersection minus withdrawals leaves Arlo alone. | Sole explicit combination rule; none of the membership sources repeats result. |

These cards jointly answer the complete question. No individual card or distractor repeats all requested components.

Distractor inspection:

- CQ18-S03: The opening gallery display used Dema and Fira under a different stamped-only rule.
- CQ18-S04: Spare counter Gavo stays in a side cabinet outside the closing gallery roster.
- CQ18-S06: The coordinator proposed placing withdrawn Cadi on a separate explanation board.
- CQ18-S08: Bex's gallery counter has a deep center mark for the packing team's inventory work.
- CQ18-S10: The closing display tray has eight recesses, including two kept clear for visitors.
- CQ18-S12: Tomorrow's gallery-counter roster will be posted after the closing display ends.

Every listed distractor contributes its own topical proposition about another subject, time, scope, physical feature or unadopted suggestion. None supplies a missing requested fact for the target under the stated scope. Source-only preparations contain no row from this audit.

### CQ19: prerequisite-chain, qualified, 1 cards

Question: For Elvo's viewing prism, what release prerequisite is known, and has that prerequisite been established as completed?

| Required card | Requested fact | Why removal leaves an unsupported requested component |
| --- | --- | --- |
| CQ19-S08 | Seal validation is the release prerequisite; its completion is unconfirmed. | One card states both the requested prerequisite and explicit status gap; other context is unnecessary. |

Explicit unresolved relation: The note explicitly leaves the seal validation status unconfirmed; it does not establish completion or failure. These are only the known facts explicitly requested; optional context is not required.

Distractor inspection:

- CQ19-S01: Elvo's prism transport pouch is padded to avoid scratches when the stand is being moved.
- CQ19-S02: The neighboring display validates its stamp before releasing a different viewing prism.
- CQ19-S03: The viewing stand uses a narrow base so visitors can approach from either side.
- CQ19-S04: Elvo's spare prism remains in the supply cupboard and is outside this release note.
- CQ19-S05: The afternoon stand supervisor proposed using a ribbon check for next season's prism release.
- CQ19-S06: Yesterday's practice display completed a seal check for a rehearsal lens, not Elvo's prism.
- CQ19-S07: The seal inspection desk opens its queue at 08:30 on the current room schedule.
- CQ19-S09: The room's red stamp is used for storage inventory rather than prism release.
- CQ19-S10: The display coordinator keeps blank seal slips in the upper inspection drawer.
- CQ19-S11: Elvo's prism has a clear square base recorded on its separate equipment card.
- CQ19-S12: The viewing stand closes its visitor queue before the room's final floor inspection.

Every listed distractor contributes its own topical proposition about another subject, time, scope, physical feature or unadopted suggestion. None supplies a missing requested fact for the target under the stated scope. Source-only preparations contain no row from this audit.

### CQ20: evolving-decision, qualified, 2 cards

Question: For Ruvan's poster board, what is the last committed finish and what later proposal remains unresolved? Has the proposal replaced the commitment?

| Required card | Requested fact | Why removal leaves an unsupported requested component |
| --- | --- | --- |
| CQ20-S04 | The last committed finish is matte. | Only actual adoption, necessary to state known current commitment. |
| CQ20-S11 | Gloss is proposed with adoption confirmation pending; replacement is not established. | Only later proposal and explicit missing confirmation; cannot supersede the adoption. |

Explicit unresolved relation: The later statement is explicitly a proposal with adoption confirmation pending; no replacement commitment is established. These are only the known facts explicitly requested; optional context is not required.

Distractor inspection:

- CQ20-S01: Ruvan's travel poster board used a satin finish in last year's outdoor show.
- CQ20-S02: The neighboring studio adopted gloss for its visitor notice board after a separate review.
- CQ20-S03: The studio coordinator stocks matte sample sheets in the tall supply drawer.
- CQ20-S05: The poster board's current frame is cedar and does not determine its finish.
- CQ20-S06: Ruvan proposed a wider wall hook for the board under a separate mounting discussion.
- CQ20-S07: The rehearsal board uses gloss for testing the overhead studio lighting.
- CQ20-S08: The supply desk opens its finish-sample cabinet at 09:10 on the daily schedule.
- CQ20-S09: Ruvan's spare poster board is unmounted and stored outside the current arrangement.
- CQ20-S10: The studio cleaner recommends a soft cloth for all display-board frames.
- CQ20-S12: A satin sample card is marked for next month's materials demonstration.

Every listed distractor contributes its own topical proposition about another subject, time, scope, physical feature or unadopted suggestion. None supplies a missing requested fact for the target under the stated scope. Source-only preparations contain no row from this audit.

### CQ21: scope-exception, qualified, 3 cards

Question: For crate Nelo, state the baseline latch rule and chilled-crate wrapping exception, and say whether the recorded classification establishes that the exception applies.

| Required card | Requested fact | Why removal leaves an unsupported requested component |
| --- | --- | --- |
| CQ21-S07 | Nelo requires a closed latch under the baseline. | Only universal baseline applies even with classification unresolved. |
| CQ21-S02 | The chilled exception adds an insulated sleeve. | Only exception content; does not classify Nelo. |
| CQ21-S10 | Nelo's chilled-or-dry classification is unconfirmed; sleeve applicability is unresolved. | Only explicit classification gap connecting subject to unknown exception applicability. |

Explicit unresolved relation: Nelo's classification is explicitly awaiting confirmation, so the chilled-specific wrapping exception cannot be assigned or ruled out. These are only the known facts explicitly requested; optional context is not required.

Distractor inspection:

- CQ21-S01: Crate Varo is confirmed chilled in its separate entry for the same packing-room cycle.
- CQ21-S03: The repair desk leaves empty crates unlatched while replacing damaged hinge pins.
- CQ21-S04: Last month's packing entry classified Nelo as dry before the current review began.
- CQ21-S05: The packing-room insulated sleeves are stacked by size beside the supply cabinet.
- CQ21-S06: The dry-crate transport trolley has a pale wooden handle for easy recognition.
- CQ21-S08: The team proposed a cotton sleeve for future dry-crate handling but has not adopted it.
- CQ21-S09: The packing-room latch inspection queue starts at 08:45 on the daily schedule.
- CQ21-S11: Crate Semo is confirmed dry in a separate entry during the current handling cycle.
- CQ21-S12: Nelo's transport sticker has a circle mark used for parcel counting, not temperature class.

Every listed distractor contributes its own topical proposition about another subject, time, scope, physical feature or unadopted suggestion. None supplies a missing requested fact for the target under the stated scope. Source-only preparations contain no row from this audit.

### CQ22: proposal-quotation, qualified, 4 cards

Question: For Yara's display tile, distinguish Dalen's quoted preference, the assistant's proposal, Yara's considered option and her adoption status. Can any color be reported as her committed choice?

| Required card | Requested fact | Why removal leaves an unsupported requested component |
| --- | --- | --- |
| CQ22-S01 | Dalen's quoted preference is peach for his own tile. | Only quote and actual claimant; relevant requested known stance. |
| CQ22-S04 | The assistant proposes indigo. | Only requested assistant proposal; source role assistant. |
| CQ22-S09 | Yara considers pearl without adoption. | Only requested own considered option. |
| CQ22-S12 | Yara remains undecided; no committed color is established. | Only explicit adoption status, so uncertainty is evidence-based rather than inferred silence. |

Explicit unresolved relation: Yara explicitly remains undecided; neither another person's quote, assistant advice nor her own considered option supplies adoption evidence. These are only the known facts explicitly requested; optional context is not required.

Distractor inspection:

- CQ22-S02: Dalen's older travel tile was brown during a show in another town last year.
- CQ22-S03: The gallery shop stocks peach sample tiles for visitors choosing their own colors.
- CQ22-S05: Yara's display tile uses a square backing that is independent of its color choice.
- CQ22-S06: The rehearsal gallery adopted indigo for a different coordinator's direction placards.
- CQ22-S07: The pearl sample drawer has a removable felt liner for protecting unused tiles.
- CQ22-S08: The assistant suggested a larger mounting bracket for Dalen's separate display.
- CQ22-S10: Yara's spare tile remains in the storage cupboard outside this gallery review.
- CQ22-S11: The gallery lighting schedule alternates warm and neutral bulbs at visiting intervals.

Every listed distractor contributes its own topical proposition about another subject, time, scope, physical feature or unadopted suggestion. None supplies a missing requested fact for the target under the stated scope. Source-only preparations contain no row from this audit.

### CQ23: entity-link, qualified, 5 cards

Question: For the studio packet nicknamed Fable, give the known label-to-ticket-to-bundle-to-carton chain and say whether its final shelf can be determined.

| Required card | Requested fact | Why removal leaves an unsupported requested component |
| --- | --- | --- |
| CQ23-S06 | Fable maps to routing label violet. | Only initial subject-to-label identity link. |
| CQ23-S02 | Routing label violet maps to ticket Nerlo. | Only label-to-ticket identity link. |
| CQ23-S11 | Ticket Nerlo identifies bundle Orva. | Only ticket-to-bundle identity link. |
| CQ23-S04 | Bundle Orva maps to carton Selin. | Only bundle-to-carton identity link. |
| CQ23-S09 | Selin's shelf assignment is pending; the final shelf is unknown. | Only terminal explicit property gap; all earlier links identify whose gap matters. |

Explicit unresolved relation: The terminal carton is identified, but its shelf assignment is explicitly still pending; another carton's shelf cannot close that link. These are only the known facts explicitly requested; optional context is not required.

Distractor inspection:

- CQ23-S01: Studio packet nickname Gleam maps to routing label saffron in the current register.
- CQ23-S03: Routing label saffron maps to ticket Belin for the current studio sorting cycle.
- CQ23-S05: Ticket Belin identifies bundle Havo in the studio's current packet register.
- CQ23-S07: Bundle Havo maps to carton Tero in the current studio packet cycle.
- CQ23-S08: Carton Tero is assigned shelf Alder during the current studio sorting cycle.
- CQ23-S10: The neighboring paint room uses routing label violet for a brush cart, not a packet.
- CQ23-S12: Last cycle, Fable mapped to label flax before the current packet register replaced it.

Every listed distractor contributes its own topical proposition about another subject, time, scope, physical feature or unadopted suggestion. None supplies a missing requested fact for the target under the stated scope. Source-only preparations contain no row from this audit.

### CQ24: compositional-set, qualified, 6 cards

Question: Under the adopted noon counter rule, which counters are established as eligible, and why is Nira's eligibility unresolved? Explain the recorded sets and the pending check.

| Required card | Requested fact | Why removal leaves an unsupported requested component |
| --- | --- | --- |
| CQ24-S10 | The initial roster is Aven, Boro, Celi, Dovi and Ema. | Excludes spare Faro, which appears in both positive lists; later note adds Nira. |
| CQ24-S03 | The initial smooth list excludes Ema. | Removes Ema, otherwise stamped; later note adds Nira. |
| CQ24-S12 | The stamped list includes Aven, Boro, Celi, Ema and Faro, and excludes Dovi. | Removes Dovi; explicitly incomplete for later Nira, as separately stated. |
| CQ24-S05 | Celi alone is withdrawn. | Removes an otherwise established qualifying counter; confirms Nira not withdrawn. |
| CQ24-S01 | The adopted rule is roster intersect smooth intersect stamped minus withdrawn. | Defines actual composition rather than assuming keyword membership sufficient. |
| CQ24-S08 | Aven and Boro are established eligible; Nira's stamped membership and eligibility remain unresolved. | Adds subject to two relevant sets and expressly states missing third membership, no unknown-by-silence. |

Explicit unresolved relation: Nira has joined the roster and smooth list, but its stamped membership explicitly remains unchecked; that missing membership prevents a definitive eligibility decision for Nira. These are only the known facts explicitly requested; optional context is not required.

Distractor inspection:

- CQ24-S02: The morning counter display used Dovi and Ema under a different smooth-only rule.
- CQ24-S04: Spare counter Faro stays in the side cabinet outside the noon counter roster.
- CQ24-S06: The coordinator proposed displaying withdrawn Celi on a separate explanation board.
- CQ24-S07: Boro's counter has a deep center mark for the packing team's inventory work.
- CQ24-S09: The noon counter tray has eight recesses, including two kept clear for handling.
- CQ24-S11: Tomorrow's counter roster will be posted after the noon display has ended.

Every listed distractor contributes its own topical proposition about another subject, time, scope, physical feature or unadopted suggestion. None supplies a missing requested fact for the target under the stated scope. Source-only preparations contain no row from this audit.

### Focused draft evidence

Exact source SHA256: f3376054323dc91e7ebf342ede0038d4a8e838c48029fdf138df74fc748f083d.
Validated-value SHA256: 678647478f0399ff3d6eda84642099b4addb97c4f1da6c894264aaf0bbccd2cb.
Exact rubric SHA256: 74d97744525724595023e9332e89da5c954eb8dc28065673be37cbaf89ffe94f.
Parsed-rubric-value SHA256: 5456932ad620ea9fbda67ef863d29793b2be3e45af013b753e90ce6bd594359e.
The9 corpus tests pass on Node22.16.0 and24.15.0 (actual exit0 each).
The combined owned-runner command
`node tools/testing/run.mjs evaluation/algorithm-development/test/card-plan-corpus.test.mjs evaluation/longmemeval/test/mixed-source.test.mjs`
passes26/26 on each runtime (actual exit0,0 skipped). Expected loader failures
clean their newly owned workspaces; the tests verify absence and an empty owned
parent after success and failure. The original behavioral red remains recorded
above. The patch tool initially rejected a same-path delete/add format; the
update-only correction succeeded before any test ran and changed no source data.
Broad gates have not run. Awaiting primary inspection of all24 source/rubric
rows, required-card rationales and all distractors before final gates.

### Prospective checkpoint 2 correction

Primary read all 24 source/rubric rows and every card. That review found a
classification-card fairness defect in CQ03, CQ09 and CQ15: the question itself
supplied a classification that the rubric counted as necessary evidence.
Before any evaluated call, the questions were changed to request the current
classification and handling from the notes, preserving genuine necessity of
the source classification card. CQ05 now explicitly requests the mapping path
along with the shelf. CQ10 explicitly requests the quoted preference's value
as well as its claimant. CQ17's unsupported conclusion now says reading-room,
matching the actual distractor. Supports, counts and all 288 source cards are
unchanged. The earlier draft hashes/evidence above are retained, not silently
relabeled as evidence for these corrected bytes.

Corrected source raw SHA256:
9a426a536efd97c8b61a7aed9890a399f7e6f8cb72758cc2c1fbc2c78605a48f.
Corrected source value SHA256:
09ecd9710ea980d8ac228ad55858e4a757de4dc006eb8451a30707142b102cb5.
Corrected rubric raw SHA256:
c0aea913f90bd8437a455f5d9048dfd26364120b15822dccd0ff452ed4447d8c.
Corrected rubric value SHA256:
58ba116268bac50ce69bd8ca4598a31e1c3bcd9eaa6836345c86da6845f840c8.

## Author final-gate handoff on the integrated base

Final review base: fcdc99dbce182bf9f63880dd86dc780e7d376ad7.
The primary's serialized CW integration preserved the corrected source,
rubric, profile and test bytes. No evaluated model, provider, operational
ledger or credential was used. This is offline preparation evidence only.

The final focused command was
`node tools/testing/run.mjs evaluation/algorithm-development/test/card-plan-corpus.test.mjs evaluation/longmemeval/test/mixed-source.test.mjs`.
It passed 26/26 on both Node22.16.0 and Node24.15.0, actual exit0 each, no
skipped tests. Each owned parent had no residual entries and was removed.

An initial sanitized npm dispatch supplied `/dev/null` for both userconfig
and globalconfig. Both npm processes exited1 before any algorithm test ran:
`double-loading config "/dev/null" as "global", previously loaded as "user"`.
Only the command environment was corrected to distinct nonexistent private
config paths; no repository source correction occurred. Exact failed commands
and diagnostics are retained in the intentionally owned local log
`/tmp/card-plan-gate-failure.BenpcvBw/npm-config-failure.log`. Both setup-failure
owned parents were removed with no residual entries.

The corrected final command was `npm run test:algorithm-development`, through
an isolated sequential harness using the runtime's PATH, owned standard temp
paths, disabled Node compile cache and private npm configuration/cache paths.
Node22.16.0 exited1 after 862023ms:217 tests,201 pass,16 fail,0 skipped.
Node24.15.0 also exited1; the combined-output budget truncated its count header,
so its exact counts are not inferred here. Visible failures in both runtimes
are existing fixture setup calls reporting ENOENT for
`adapters/openai/node_modules`. The root `node_modules/tiktoken` symlink exists,
but that adapter installation directory is absent (`ls -ld` actual exit2).
All 9 new corpus tests were discovered and passed within both full suites.
Their result does not substitute for the failed repository gate.

The harness stopped after that failure: generic `npm test` and `npm run validate`
were not dispatched. Both algorithm-owned parents were removed; their only
remaining pre-cleanup entries were the expected npm caches. No unexpected
owned test scratch remained. Exact commands and retained prerequisite
diagnostics are in
`/tmp/card-plan-gate-failure.BenpcvBw/algorithm-prerequisite-failure.log`.
That private failure-log directory is intentional retained evidence, not
abandoned test scratch. No test was retried, no dependency was installed or
cleaned, and no source/rubric hash changed. Primary owns prerequisite handling,
the remaining final matrix, exact-candidate review and delivery. All author
subprocesses have completed; writing stops after this evidence append.

## Primary prerequisite diagnosis and acceptance takeover

The initial full-suite raw stdout was held only in the author harness's memory,
then printed through truncated tool output. The retained files above contain
commands and reconstructed diagnostics, not complete original raw logs. Node24
totals remain unknown; exhausted-session retrieval could not recover them.
This evidence-retention gap is not repaired by inventing a log or a rerun.

Primary verified the missing adapter-directory symptom with a minimal real
`cpSync` prerequisite control: the adapter path exited1 with the same ENOENT,
while the root `node_modules` path copied successfully, actual exit0. Both
owned scratch directories were removed. Module resolution still found the
existing tiktoken1.0.22 through the root link; successful pure corpus checks
had never established the explicit adapter fixture path. The adapter parent's
mtime/ctime matched creation and no worker had touched dependencies. There is
no observed test deletion to blame; the primary setup had prepared only the
root path and incorrectly recorded the adapter prerequisite as ready.

Primary's narrow environment correction created only the absent ignored
`adapters/openai/node_modules` directory and one `tiktoken` symlink to the same
already installed1.0.22 package. No package download, shared install change,
historical cleanup, source or rubric change occurred. The original adapter
copy control then exited0 and removed all owned scratch. These controls are
retained as `diagnose-card-corpus-dependency.mjs` in the primary acceptance
workspace, not a product regression test: the defect was worktree setup, not
tracked runtime code. The two-route inventory still matches exactly6paths,
1597source files,119relative links,288cards and102anchors.

Primary owns the remaining complete acceptance matrix after this explained
prerequisite correction, with full raw per-command logs persisted outside test
scratch, exact actual exits and source snapshots. The original failed gates
remain failed. No test criteria or semantic promotion threshold changed.


