# Source-bundle QA24 corpus — prospective offline contract

Primary decision 2026-10-11. Short-term target is supported first-answer quality
for a lightweight, reliable source-backed memory layer, not authored-score
inflation. This packet creates new source-only fixtures and an independently
checkable rubric before any model result. It does not implement or authorize a
paid runner, change a closed cohort, clear D12, pass original Stage 2/3, or ship
a product/default behavior. No merge, release, deploy, historical cleanup,
credential discovery or operational-ledger access.

## Scope and integration

Authoring base: be7ab7ac4afca9007461bbf64ca1596a7ce10aca. Author works in an
isolated sibling worktree while QT's transport is independently implemented.
Primary may integrate this isolated five-file change on the exact accepted QT
candidate before final combined gates/reviews; record that final base and SHA.
No author changes outside these five paths:

- evaluation/algorithm-development/source-bundle-cases.json (new)
- evaluation/algorithm-development/source-bundle-rubric.json (new)
- evaluation/algorithm-development/source-bundle-profile.mjs (new)
- evaluation/algorithm-development/test/source-bundle-corpus.test.mjs (new)
- docs/plans/source-bundle-qa24.md (new; preserve this contract as exact prefix)

Do not modify/import/execute old cohort-specific scorers or run modes, read old
model answers, access official holdout data, or expand transport allowlists.
Generic pure preparation/validation utilities may be imported. No package/CI,
dependency, core, public adapter, schema, default, old result or fixture changes.

## CF1–CF8 acceptance

CF1 — Freeze exactly 24 newly authored synthetic cases, IDs BQ01 through BQ24.
Roster: six answerable two-card joins, six answerable three-card joins, four
missing-prerequisite cases, four scope/time traps, four proposal/quotation/
uncertainty traps. Interleave families and relevant-source positions by a
predeclared deterministic schedule, not after retrieval results. Every case
uses a distinct scenario and entities; no recycled old case merely renamed.
Include realistic distractors, not only blatantly unrelated filler. Do not
optimize text, label ordering or phrasing after any paid result.

CF2 — Source-only schema is exactly {id,family,question:{text,date},sessions}.
Exactly 12 sessions/case, each {id,eventTime,messages:[{role,content}]} containing
one short original message; role user or assistant. Use new BQ session IDs,
valid strictly increasing ISO UTC timestamps not later than question date,
and a YYYY-MM-DD question date. Content 40–360 UTF-16 chars, well-formed and
without secrets/control characters; rendered source remains one <=800-char
window. Question 1–400 chars and contains no answer/gold hints. Each original
message is independently interpretable about its stated object/scope/time;
required joins are across two or three distinct sources, never secretly packed
into one terminal source. Six known two-card and six known three-card answers
cannot be justified without their identity/scope/time prerequisite set.
Source fixture contains no expected answer, anchor, target-card flag, severity,
evaluator hint or runtime policy selection. Family is report metadata only,
never supplied to model ports. All uncertainty, quotation and submitted roles
remain explicit rather than upgraded into facts/adoptions/permissions.

CF3 — Separate evaluator-only rubric gives each case its expected proposition,
acceptable qualified answer, unanswerability reason where relevant, exact
support anchor spans (sessionId/messageIndex/start/end/text on original UTF-16
source), named required evidence sets, tempting-but-unsupported conclusions,
stale-use definition and predefined severe conditions. Anchors must slice
exactly from actual source text and required sets must reference real anchors.
No global absent-evidence assertion is licensed merely by an empty packed
context. A missing-link answer may state that the supplied evidence cannot
establish the requested association, not fabricate a link or claim it never
existed. Cases with changed premises must not automatically infer a replacement
decision; a tentative/proposed option must not become adoption or authority.
Document which cases are answerable/qualified and the factual claims needed;
semantic correctness is reviewed by humans/agents, not asserted by a string
validator. All rubric provenance and ambiguity must be independently reviewable.

CF4 — New source-facing profile only exports closed version/roster/limits/order,
descriptor-safe source validation, source loading and preparation. No rubric
import, evaluator anchor lookup or old closed-case imports. Pin file/value
hashes after fixture authoring; loading rejects drift. Reject unknown fields,
malformed IDs/dates/roles, duplicates, count/size overflow, sparse/inherited/
accessor/toJSON/prototype hazards without invoking them. Reuse pure mixed-source
preparation; canonical question for both future arms is exactly the plan's
originalQuestion.text plus canonicalQuestionDate. Source provenance stays
original; never substitute ingestion time for event time. Avoid static SQLite
or optional adapter imports so generic discovery remains dependency-free.

CF5 — Future experiment is fixed here, not executed: actual core scripted,
query-independent capture creates one literal source-backed card per window,
all unfiled, once/case. Exactly 12 one-receipt cards, one authorized namespace,
one exhausted complete map page, unchanged cold state. Both QA arms use existing
selectionMode:'bounded-source-scan', contextMode:'source-evidence', limit6 and
bounded-keyset-v1. Unexpected select is a failure, not fallback. Ordinary paid
rank versus paid source-bundle planner; same evaluated model
gpt-4.1-mini-2025-04-14 and unchanged answer model/instruction. Same candidate
IDs/revisions/roles/excerpts/order must reach both rank inputs with zero core
pack omissions. Actual complete provider input <=6000 local tokens, provider
count<=7024, rank/planner output<=1024, answer output<=512. No shortlist from
rubric/gold, invented relations or source shortening. Alternate QA arm order
by odd/even ordinal. After both QA slots settle for a case, run exactly one
separate natural-selection-only probe on its unchanged cold store: ordinary
select, selectionMode omitted, scripted rank records input then returns empty
refs. No paid rank or answer for that probe. Probe output never alters QA slots.

CF6 — Future metrics preserve all24 questions/arm and24 probes including failures
and not-run. Compare first answers and full-source truth separately from factual
support against only actual packed evidence. Primary outcome is supported-
correct gain over24 pairs; also report ordinary correctness, completion,
known-answer usefulness, correct qualification/abstention, complete required-
set retention, unsupported/stale question and claim counts, severe errors,
unknown/disagreed judgments and resources. A correct terminal value without
its required association evidence earns no supported-correct credit. Two
independent nonauthor judges use opaque randomized labels and retain FIRST
fieldwise agreement only; no rejudging/adjudication or favorable picking.
Unknown safety blocks advancement. Require at least three net additional
supported-correct answers, improved packed prerequisite-set retention, no
increased unsupported/stale claims, no newly failing predefined severe case,
and accepted resource ceilings before calling the candidate promising. This
is a small-pool scripted-capture mechanism diagnostic, not natural end-to-end,
large-scale MOC efficacy, official benchmark/Mem0 parity, D12 repair or original
Stage2/3 clearance. Original Stage2/3 gates remain unchanged.

CF7 — Future maximum is192 physical model requests: percase ordinary rank
count+generation plus answer, bundle count+generation plus answer, one ordinary
select count+generation probe. At5000microUSD/reservation this is960000microUSD
excluding any paid judging; a later runner freezes complete scope/ceilings and
checks current affordability including judge calls if any. Never infer current
budget from this plan. Original cumulative400USD/protected30USD ledger, unknown
reservations, inherited ordinary-transport10USD/1968request preflight and one
ledger owner remain unchanged. Coordinator must enforce global caps/deadlines
across close/rebind; no local counter reset as authority to retry. All preflight
stores/schemas/wire sizes must be verified offline before any live launch.
The natural-only probe localizes upstream loss; it does not measure recovery QA.

CF8 — Pure/offline tests verify complete24-case roster/counts, all source schemas,
exact original anchor slices and required-set references, source/evaluator
separation, hash drift, malformed/poisoned inputs, canonical question binding,
one-window preparation and preserved dates/roles. Independent literal assertions
must check representative semantic fixtures; a validator agreeing with itself
does not prove truth. Do not mark actual-capture/map/rank/wire preconditions
complete in this corpus-only packet: they belong to the subsequent executable
runner and must block paid launch if absent. Primary directly reads every case
and rubric, runs focused/generic/validation plus both Claude validators on pinned
Nodes22.16/24.15, re-derives changed inventory via Git and independent tree route,
and freezes tested bytes. Separate nonauthor Standards/Spec review full exact
integrated diff. No push until primary and both reviews pass; latest-head CI and
mergeability before delivery. Preserve actual failures/corrections and owned
scratch cleanup; no API key, network/model call or operational ledger write.

## Execution ownership

Primary owns this design, source/rubric acceptance, later integration and all
paid gating. One actual GPT-6.1 Sol/high worker authors these five paths only;
the QT transport worker is independent. Report changed entrypoints/dependent
callers and evidence, meaningful checkpoints, and uncertainty. Stop after two
unsuccessful correction rounds on one defect for primary re-scope. Keep source
and evaluator truth separate throughout; no achievement claims from test counts.

## Primary scope amendment before limitation-note implementation

CF9 — CONTRIBUTING.md requires evaluation evidence boundaries in
`docs/limitations.md`. Add that as the SIXTH allowed path, append-only, for a
short corpus-only boundary: authored source/rubric integrity is not semantic
QA improvement or proof of actual capture/map/rank/wire preconditions. No
ROADMAP gate changes. The original five-path contract above remains preserved
as history; this explicit preimplementation amendment supersedes only that
file-count restriction. Primary integration must preserve the accepted QT
limitations text and append the corpus note after it. Include all six paths
in fixed-diff review and independently derived final inventory.

## Authored corpus and source-facing entrypoints

Author worktree: `/home/chichieh/Github/cairn-memory-worktrees/source-bundle-corpus`.
Branch: `experiment/source-bundle-corpus`; fixed author base
`be7ab7ac4afca9007461bbf64ca1596a7ce10aca`. Actual assigned author is GPT-6.1
Sol with high effort. No candidate commit, integration SHA, review, push or
paid result is established by this author packet; primary records those later.

The source file is a dense array of the exact CF2 objects, with 24 cases,
288 sessions and 288 original messages. The family sequence is the five-family
cycle (two-card, three-card, missing-link, scope-time, proposal-uncertainty)
repeated four times, then two-card, three-card, two-card, three-card.
For zero-based case ordinal i, base slot is (5*i) mod 12. Two-source scenario
passages use offsets 0 and 5; three-source and scope/proposal passages use
offsets 0, 4 and 8. Sort those zero-based slots ascending, then place the logical
passage sequence in them. Place independently authored same-scenario distractors
in remaining slots. This schedule was declared and accepted before authoring,
without retrieval results. Extra negative-record anchors in missing-link cases
identify existing distractor positions rather than changing that schedule.

All source times are October 10, 2026, from 08:00 through 09:50 UTC in ten-minute
increments; every question date is October 12, 2026. Explicit effective dates,
past assignments and future proposals remain in the original source messages.
The question date binds to 23:59 UTC, rendered by pure mixed-source preparation
as `2026-10-12 23:59`. A prepared question is exactly
`{text: plan.originalQuestion.text, date: plan.canonicalQuestionDate}` for
both future QA arms; no family or evaluator data enters the prepared plan.

| Case | Family | Scenario | Scheduled source slots |
| --- | --- | --- | --- |
| BQ01 | two-card | Quilt crate and handling sleeve | 1, 6 |
| BQ02 | three-card | Observatory badge, controller and cadence | 2, 6, 10 |
| BQ03 | missing-link | Bakery booking and unassociated receipt | 4, 11 |
| BQ04 | scope-time | Municipal western-shaft pressure revision | 4, 8, 12 |
| BQ05 | proposal-uncertainty | Adopted theatre wash and unadopted proposal | 1, 5, 9 |
| BQ06 | two-card | Lake-survey recorder and connector | 2, 7 |
| BQ07 | three-card | Seed checkout, lot and soaking interval | 3, 7, 11 |
| BQ08 | missing-link | Ceramic tray and unassociated kiln batch | 5, 12 |
| BQ09 | scope-time | Orchard sensor failure and unreconfirmed plan | 1, 5, 9 |
| BQ10 | proposal-uncertainty | V31 courier commitment and quoted draft | 2, 6, 10 |
| BQ11 | two-card | Festival choir set and score edition | 3, 8 |
| BQ12 | three-card | Aquarium shift, tank pump and gasket | 4, 8, 12 |
| BQ13 | missing-link | Pantry Saturday shift and unassigned route | 1, 6 |
| BQ14 | scope-time | Museum annex night price and effective date | 2, 6, 10 |
| BQ15 | proposal-uncertainty | Sailing gate approval and assistant advice | 3, 7, 11 |
| BQ16 | two-card | Rescue locker and respirator stock size | 4, 9 |
| BQ17 | three-card | Fair booth, shift invoice and prepaid deposit | 1, 5, 9 |
| BQ18 | missing-link | Interview booking and unassociated guest alias | 2, 7 |
| BQ19 | scope-time | Winter protocol and spring-only revision | 3, 7, 11 |
| BQ20 | proposal-uncertainty | Garden premise failure and considered interval | 4, 8, 12 |
| BQ21 | two-card | Repair appliance card and fuse rating | 5, 10 |
| BQ22 | three-card | Rowing boat, berth and posted launch time | 2, 6, 10 |
| BQ23 | two-card | Library return pouch and deposit desk | 3, 8 |
| BQ24 | three-card | Mural permit, paint batch and curing period | 4, 8, 12 |

The evaluator rubric contains 67 exact original UTF-16 spans, each pointing to
a real session's sole message. Full short messages are the anchor passages.
Every known two-/three-card answer needs its complete subject-to-terminal chain.
For trap and qualified cases, `requiredEvidenceSets` are alternative minimal
sets for the requested proposition. They do not require optional context merely
because it appears in `acceptableQualifiedAnswer`. `optionalContextClaims`
bind those extra claims to their own anchors if an answer states them. A
missing-link qualification concerns the complete supplied evidence only; absence
from an incomplete packed context does not prove no association ever existed.
Literal integrity checks expose authored claims for review; they do not decide
semantic correctness or supported-answer efficacy.

Source hashes frozen after primary's prospective semantic inspection:

| Artifact | SHA-256 |
| --- | --- |
| Source file bytes | 90bf9a3e294db114a0a2e264940221d7971a4e41c51af25b43e7453422de4cf9 |
| Source JSON value | 74c3664e31d1d35a74a614345c273faa2c7f1845811030fd0868141c74a44e7c |
| Rubric file bytes | 16720244e6c20cb5c9228bbf595d6a8413d2fe16d2156e855e77776a267bf59d |
| Rubric JSON value | d3e34c207c927831c31e446e59f900d65c284cb29fc11ca242bc1302b896c8f3 |

Value digests use SHA-256 of UTF-8 `JSON.stringify` in checked-in field order.
Loading pins exact source bytes and value; preparation also rejects value drift.
The source profile exports only version, roster, limits, arm order, source
validation, loading and preparation. No existing product entrypoint or caller
changes. The new test file calls the three source functions. Future runner
integration is primary-owned and absent here. Preparation lazily imports
`longmemeval/mixed-source.mjs`, which statically reaches `ingestion.mjs`, pure
capture/source-window validation, core validation and redaction. This dependency
graph contains no SQLite store, old cohort runner/scorer or optional adapter.

## Prospective corrections and author evidence

Primary inspected all 24 sources and evaluator records before any model result.
Corrections clarified BQ10's V31 question and handover date, clarified BQ13's
Saturday reference, and removed BQ24's incidental mural identity from the
terminal permit card so all three links are needed. Earlier author inspection
also removed duplicated identity bridges from seed and repair distractors.
Required trap sets were reduced to minimal requested support; proposal,
quotation and other-scope details now have separate optional claim bindings.
Missing-link cases accept an independent negative-record anchor as an
alternative to the original booking/intake anchor. The BQ22 weather note is
optional context and is absent from its requested proposition. These are
prospective semantic-review corrections, not tuning against model answers.

Focused command, separately under each pinned Node 22.16.0 and 24.15.0:
`node tools/testing/run.mjs evaluation/algorithm-development/test/source-bundle-corpus.test.mjs`.
Initial runs each exited 1 (10 pass, 1 fail): the metadata-leak assertion
searched the ordinary word `family`, which legitimately occurs in a source
message about protocol families. It now checks the serialized property key
`"family":`. Corrected runs each exited 0 (11 pass, 0 fail, 0 skip).
`npm run validate` exited 0 under both Nodes. The ordinary validator checks
existing protocol/plugin JSON; the new test independently parses and hashes
the two new fixture files.

Raw author logs are retained at `/tmp/cairn-source-bundle-evidence.9oaYyn/`.
The first attempted full algorithm suite exited 1 under both Nodes because the
author worktree lacked `tiktoken`; 17 existing test files failed module import.
This was a missing test prerequisite, not corpus-test failure. Its failure
logs remain retained. Full-suite verification with an existing compatible
ignored dependency and primary's integrated generic/Claude checks are recorded
below when available. No network install or model/API/operational-ledger call
was made by this packet.

The focused test creates only owned workspaces. Real child tests verify removal
after successful completion, assertion failure and setup failure, with the
owned outer runner active. Synthetic child failure exit 1 is asserted as the
expected cleanup control; it is not a successful model run or corpus failure.

Actual scripted core capture, one-card/one-receipt admission, exhausted complete
map, identical paid rank inputs, zero pack omissions, full provider wire ceilings,
unchanged cold state, and the separate post-answer select-only probe remain
unverified. They must block a later paid launch until the executable runner
establishes them offline. No paid runner, metric aggregator, judgment, supported-
correct gain, efficacy, parity, D12 repair or Stage 2/3 clearance is delivered.

Additional primary inspection clarified BQ19's question to ask explicitly
whether October winter exports are blinded or unblinded, removed BQ24's second
incidental permit identity from the sample-board distractor, and made BQ10's
optional quoted draft explicitly about V31. BQ15 now requires only gate B's
approval, supported by either the original approval or retained approval; gate
A's refusal is optional. BQ20 now requires only no new adoption, supported by
either the consideration note or independently recorded no-replacement note.
Old/east/daytime facts in BQ04/BQ14 are optional rather than requested claims.

Primary's immutable independent actual-consumer repro initially exited 1 on
both Nodes with `invalid_answer_question`: the source profile returned
`{question,date}` instead of the existing answer packer's `{text,date}`.
This was an author API defect missed by the original shape-only assertion.
The profile now returns the required keys. The focused test passes every
prepared question through the actual `packMixedAnswer` with an explicit
deterministic counter and independently checks the resulting `currentQuestion`.
That consumer check does not establish actual provider token ceilings.

The compatible existing test dependency is an ignored real directory at
`adapters/openai/node_modules`, with only a `tiktoken` symlink to the existing
`/home/chichieh/Github/cairn-memory-worktrees/relation-binding-probe/adapters/openai/node_modules/tiktoken`
install (version 1.0.22). Source and transport lockfiles compared equal; target
contents and lockfiles were unchanged. `git check-ignore` confirmed the link
is ignored. No installation or network request was made.

The full `npm run test:algorithm-development` command with that dependency
exited 0 on both Nodes (160 passed, 0 failed, 0 skipped, approximately 467
seconds each). This evidence predates the final semantic/API corrections and
is stale for the final bytes. Primary owns the required full algorithm,
generic and Claude validation gates on the integrated final candidate.

Author changed inventory was independently derived by Git diff plus untracked
enumeration and by a filesystem walk compared to base Git blob hashes. Both
routes matched exactly six paths, including the append-only limitations note.
The frozen contract prefix, including CF9, remained byte-identical at 11,007
bytes. The ignored test dependency is outside that six-path source inventory.

Final author closure: the focused owned-runner command exited 0 on Node
22.16.0 and 24.15.0, each with 11 passed, 0 failed, 0 skipped. The final
`npm run validate` also exited 0 on both. Primary's unchanged retained repro
`/tmp/cairn-complementary-qa-acceptance.7sG2vXdH/corpus-question-contract-repro.mjs`
exited 0 on both using the existing real token counter and actual answer
packer, after its earlier two failures. It performed no HTTP, SQLite or ledger
operation. Final logs end in `-final.log` in the author evidence directory.
All author writes stop for primary inspection, integration and mandatory final
full-suite/independent review gates. The complete six-file source inventory is
unchanged; no commit, push, network request or paid execution occurred.
