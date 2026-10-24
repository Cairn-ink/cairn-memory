# Qualified duplicate evidence: bounded automatic capture policy

Status: combined offline acceptance passed; committed review/CI pending,
2026-10-21.
Initial dependent base: bf495181570487f2aa6f92c522a841d4a6a5da37,
the retained Raw MCP candidate. Integrate any reviewed parent correction before
freezing this packet. Worktree: raw-qualified-duplicates;
branch: feat/raw-qualified-duplicates. Main remains cd6d1ad; no merge is implied.

## Outcome and authorization

The explicit local capture host should be able to encounter the same qualified
Memory in another source without turning otherwise valid capture into
interpretation_incomplete merely because the new receipt has different IDs.
Keep one Memory, append eligible evidence, retain its original qualification,
and preserve correction, forgetting, source deletion and replay fences.

This is a deliberately opt-in mechanical policy, not semantic deduplication,
new truth, reaffirmation judgment, qualification re-inference, automatic Card
creation, a vector/MOC change or a benchmark score improvement. Source attribution
and matching labels do not prove agreement or truth. Existing confidence/state
rules are unchanged; do not advertise stronger certainty from this policy.

Only synthetic local code, tests, dependent branch/commit/push/PR and named
product coordination remain authorized. No paid calls, real transcripts,
operational stores/configurations, migrations, merges, release/deployment,
product pins/flags or actual client activation. Preserve every historical red.

## Observed cause and chosen boundary

Current qualificationStorage.bind compares the complete qualification including
original receipt IDs, digests and anchors. An identical canonical assertion with
the same seven labels but a different source therefore fails
qualification_conflict. The enclosing admission rolls back; already registered
Raw remains and the local adapter honestly reports incomplete interpretation.
Do not conceal that failure, count saved Raw as admitted Memory, or reset a
closed event to retry it under the new policy.

Add trusted constructor option
`captureQualifiedDuplicates: 'append-matching-evidence-v1'`.
Omission retains the exact existing strict behavior. An explicitly present
undefined/null/unknown value, inherited property, proxy or getter refuses before
SQLite creation/migration or model work. The policy requires
captureQualification:'source-bound-v2'. It is not a wire/model/request field.
Reject combination with sessionEpisodes for this initial policy version.

Apply only to the private ordinary capture finish seam, including eligible
non-episode staged capture. Do not infer permission from the existing
projection.automatic flag, which also serves manual finish and episode keep.
Pass the validated policy through finishCapturedAdmission's private hook to
admissionStorage.finishAdmission and its admitMutation projection. Public
finishAdmission, explicit remember/admit, legacy writes, ordered/causal capture
and episode keep remain strict. Ordered capture still uses its existing separate
finish path; enabling this constructor option does not alter that path. Document
that limitation rather than claiming every capture mode supports the exception.

## What may be appended

For a deduplicated automatic item under this policy:

1. Require exact canonical content equality, not only the case-folded fingerprint.
2. Require both an existing intact qualification and a fully valid incoming one.
   Compare subject, property, scope, applies, value, attribution and commitment
   exactly, including null/unknown. A different label is a conflict, not an update.
3. Validate all incoming receipt/anchor structure, source identity, exact spans,
   field coverage and incoming source fences using the existing checks.
4. Inspect and validate the authoritative original qualification and its original
   anchor receipts, then prove those sources still eligible as described below.
5. Keep the original qualification row, boundRevision and anchors unchanged.
   Append eligible new receipts through the existing attach/lineage path only.
   No new qualification provenance is silently substituted for old provenance.

All checks and receipt attachment share the existing admission transaction.
Failure leaves no partial receipt, qualification, admission completion, revision
or index mutation. Already committed Raw registration is a separate boundary.
Missing incoming qualification, an unqualified target, or damaged original
qualification cannot use the exception. Existing validation errors retain their
meaning; do not turn source exclusion or deletion into an undifferentiated
storage_error by catching them inside qualification inspection.

Suppressed inputs retain the existing skip-item/suppressedCount behavior.
Do not replace suppression with a new fatal result or revive a historical state.
Preserve existing kind, confidence, review-state, revision, classification,
conflict/MOC invalidation and dedup result semantics; no special new score or
currentness promotion is part of this policy.

## Original source eligibility

A narrow internal rawLineage.assertStoredReceipts(namespace, authoritativeRows)
may serve only the new exception. Deduplicate the original qualification's
at most four anchor receipt IDs after existing inspection proves membership,
receipt key, digest, content binding and exact slices. The caller owns the same
transaction. This is not a new public resolve API or a generic integrity scan.

When Raw lineage/deletion tables exist, inspect authoritative stored lineage,
not just a receipt DTO's client/session fields. Validate namespace, conversation,
message, role and valid stored spans; foreign/orphaned lineage refuses. Check
each actual root's session fence and source exclusions. Use stored lineage spans;
do not mistake offsets inside a normalized receipt excerpt for Raw offsets.

For legacy episode keep receipts, source IDs can prove a different original
client/session from the consumer stamped on the receipt. Resolve that recorded
origin through sourceRoots.receipt; require an unambiguous live origin episode
and check the actual origin's session/exclusions. Missing or ambiguous source
IDs refuse; do not fall back to consumer identity or infer origin from text.
Known independent ordinary receipts remain eligible with their own session
fence checked. Proven episode/job sources and policy-skipped Raw need not have
saved/decryptable Raw parts. Unknown provenance in a Raw-enabled store is not
independence. Partial lineage schema without deletion authority refuses the
exception instead of querying missing tables or silently repairing the store.
An ordinary store without Raw retains its existing structural source checks.

Do not call excludeMemory as a read guard: it mutates exclusions and Cards.
Do not call Card Raw resolution as a guard: it wrongly requires retained Raw
bytes for valid policy-skipped/episode evidence. Use indexed metadata lookups,
not decrypting, loading complete conversations or rewriting historical records.

## Replay, deletion and local adapter

Add the optional policy to Raw's frozen interpretation profile only when present;
the omitted profile's bytes remain unchanged. A changed policy on an already
registered Raw event refuses its binding. Completed same-profile replay is
model-free; incomplete same-profile replay remains incomplete/processing without
reacquiring interpretation. A new event ID containing already registered message
first parts cannot bypass this. No event/session reset or automatic backfill.

Do not change ordinary captureSnapshot hashing: completed ordinary replay is
already model-free; existing failed unstaged retry and staged closed/expiry guards
remain as before. This policy is an admission-time exception, not a new frozen
model payload. Manual finishing never gains this exception.

Deleting either attached conversation keeps the existing source-removal behavior.
If another proven live source remains, preserve Memory without deleted receipts;
the existing qualification-clearing behavior stays unchanged, with no automatic
rebinding. Removing the last support forgets/suppresses it. Correction/forgetting
must exclude all attached Raw origins and prevent reintroduction under new IDs.

The private B3 local-capture-config-v1 may carry the same optional exact-value
field, omitted by default. Forward only that validated trusted value to the core;
do not change the capture-v2 wire, provider prompts/models, usage limits, schema,
reply shape or transport retry policy. The config digest/preparation bindings
remain exact. Altering an established host profile is not permission to rearm:
the old config digest or preparation marker must refuse. A newly prepared owned
synthetic host may explicitly choose the policy. Rearm is a separate packet.

## Observable acceptance

| ID | Required result |
| --- | --- |
| QD-01 | Constructor and B3 config validation is closed; malformed/accessor/inherited options refuse before DB/model work. Omitted behavior, raw profile bytes and incompatible episode/evidence-only combinations are tested. |
| QD-02 | Default same-content/new-receipt capture still conflicts. Opt-in capture of two distinct eligible sources creates one Memory with both receipts and byte-identical original qualification/anchors. Actual cold reopen and completed replay use zero model calls. |
| QD-03 | Change each of seven labels separately, exact-content case, original integrity, incoming anchors, missing incoming qualification and unqualified target. Every refusal is atomic and does not opportunistically replace the original qualification. |
| QD-04 | Live/excluded/disjoint original spans; original session fence and deleted episode; foreign/orphaned lineage; known-independent versus unknown provenance; policy-skipped Raw are distinguished. A real legacy cross-client keep fixture validates the true source origin, missing/ambiguous source IDs refuse. |
| QD-05 | Suppression, mixed batch rollback, existing revision/state/confidence rules and classification/relationship/MOC invalidation remain intact. Manual finish, explicit writes and ordered capture retain strict behavior even when the option exists on the core. |
| QD-06 | Both orders of deleting the two source conversations preserve only genuinely independent surviving support; then last-support deletion suppresses. Correction/forget excludes all attached origins and blocks replay under new event IDs. No qualification rebinding. |
| QD-07 | Changed Raw profile blocks old complete/incomplete events without model work; unchanged replay remains unchanged. New event over old message parts cannot retry interpretation. Ordinary and staged retry/closed contracts stay unchanged. |
| QD-08 | Actual local one-shot plus installed foreground host use fake HTTP only, each supported client, distinct messages yielding the same qualified assertion, cold restart and stable IDs. Default strict control still returns interpretation_incomplete. Config alteration cannot silently rearm old preparation. |
| QD-09 | Owned success, assertion-failure and cancellation fixtures clean up; no ambient key/config/source access. Focused cases run on Node22.16/24.15; final affected contributor gates, primary independent acceptance, both nonauthor final-SHA reviews and latest-head CI pass before ready/unmerged delivery. |

## Delivery order and ownership

Main owns this contract, integration and independently authored acceptance.
One GPT6.1Sol/high worker owns implementation/tests, with separate nonauthor
Standards and Spec reviewers. No fallback or token/cost figures are inferred.
First freeze the proposed private hook/source-guard signatures and exact new
test roster; implement the core milestone, then obtain primary acceptance.
Only then add the bounded local adapter/installed coverage and user-facing docs.

Core runtime roster: core/contract.mjs, core/runtime.mjs,
core/admission-storage.mjs, core/claim-qualification-storage.mjs,
core/raw-lineage-storage.mjs, core/raw-composition.mjs.
New focused tests should live in core/test/qualified-duplicate-capture.test.mjs
and core/test/qualified-duplicate-sources.test.mjs, with a small shared fixture
only if needed. Existing targeted tests may be adjusted only for demonstrated
compatibility assertions, with primary approval of the exact extra path.

Later bounded adapter roster: adapters/local/configuration.mjs,
adapters/local/capture.mjs, focused adapters/local/test and packaging/test cases,
plus docs/capture.md, docs/raw-local-journal.md, docs/limitations.md, CHANGELOG.md.
The documentation paths were checked against the actual inventory. Confirm exact
documentation/test paths before freezing this stage. No new runtime file is
planned, so no artifact manifest edit should be necessary. No package versions,
dependencies, CI, setup, automatic hooks or product changes in this packet.

Before final freeze, integrate any reviewed parent corrections and record the
actual base. Run the full affected core/local/worker/host/artifact/generic checks,
relevant capture/admission/episode/MOC demos and JSON/native validators on both
supported runtimes, with the exact finite roster frozen first. Do not rerun
unrelated full suites at every small edit. Retain focused reds and diagnose them;
passing a rerun alone is not a resolution. Commit only independently inventoried
scoped files. Primary checks actual diff, commands, exits, manifests and cleanup.
No real transcript, paid semantic result, full V1 or production-ready claim.

## Core implementation checkpoint

The parent is now PR#464 at bf495181570487f2aa6f92c522a841d4a6a5da37.
All48 local gates and both independent reviews passed. At2026-10-21T21:28Z,
all31 latest-head checks across4 workflow runs passed; primary verified the
merge-preview parents and exact candidate tree. PR#464 is ready/unmerged,
with actual exit0 and immutable primary-ready-proof.json under
/tmp/cairn-raw-retained-evidence.SDfDOf/. No parent correction was required.
This dependent core work proceeds in its separate worktree; any later parent
correction must still be integrated before acceptance/delivery.

Accepted author's read-only proposal: pass the validated option only through
ordinary capture's private finish closure, into finishCapturedAdmission hooks
and admitMutation projection. Extend qualification bind with that explicit
private policy; factor inspectStored to return the existing validated view plus
authoritative anchor receipts without changing inspect's existing response.
Inject the source guard and call it outside inspection's storage_error catch.
No new runtime/support module is needed. The exact author roster is the six
core runtime files and two new focused tests listed above. Use actual legacy
keep fixture legacyFixture(...,true), not hand-stamped consumer/source identities.
First core implementation checkpoint runs focused tests on both Nodes and freezes
all eight file hashes/modes before primary acceptance. No adapter/docs/package
edits, dependency changes, commits, pushes or PRs by the author in this phase.

Main independently authored13 public-core acceptance cases before reading any
new implementation tests, in /tmp/cairn-qualified-duplicates-evidence.7niFI9/
primary-core.test.mjs. Syntax check on Node22.16 exits0; behavioral acceptance
has not yet run. They cover baseline strict refusal, closed options, cold replay,
seven-label/content mismatches, manual/ordered isolation, both Raw clients,
original session/exclusion fences, both deletion orders, forgetting, old-profile
replay closure, unqualified cases and original qualification corruption. More
complex legacy/staged and installed cases still require the author's evidence
and primary direct inspection; these13 are not a substitute for the whole spec.

Independent test SHA256:
9dc1888778cefe957a1b302a5cb0c1f4ee6572e2e880cd7a3f3b7d7bdcee7293.
Before author implementation, the baseline-only Q00 selector passed1/1 with
actual exit0 on Node22.16 through tools/testing/run.mjs. It observes the expected
default qualification_conflict on a new source and unchanged original Memory;
this does not pass any proposed opt-in behavior. The full13-case test remains
frozen for postimplementation acceptance. Its external runner freezes source,
independently cross-checks file rosters, captures both runtime exits/logs, stops
on the first red and verifies owned cleanup; syntax check exits0.

## Primary core acceptance checkpoint

The frozen eight author files add 51 focused cases; both Node22.16 and24.15
passed with actual exit0/null and owned workspace removal. Primary inspected
all six runtime diffs and both tests, then ran the independently authored13
cases on both runtimes: 13/13 each, exit0/null, outer exit0, no skips. Source
hash remained 1de7e35ea85c3f66672f006e568eea1ddba31049f573c2f43e6b0df251223e31.
The independent diff/tree inventories both contain nine paths: author eight
plus this primary-owned plan. Logs and primary-core-v1-report.json are in
/tmp/cairn-qualified-duplicates-evidence.7niFI9/; primary separately reparsed
both logs and verified the owned workspace no longer exists.

One primary launch-order error preceded behavioral testing: the run was started
before the asynchronous freeze finished, so its missing freeze file caused
exit1/ENOENT without executing tests. Waiting for and checking freeze exit0
resolved that orchestration error; the separate receipt is retained. Author
fixture reds and the first29-suite timeout remain separate evidence, not passes.
The existing affected-suite checkpoint then passed771/771 on both runtimes,
actual exit0/null, with owned cleanup independently checked. Its actual392-second
duration is consistent with the parent's425-second full-core runs; the initial
180-second harness cap was insufficient. No runtime workaround was made.

Primary also authored five installed acceptance cases before adapter changes,
at the same evidence directory's primary-installed.test.mjs (SHA256
150a8b550d92c76a39f1c72f53818a11b8dc3165c81662c27bef16682658fcab).
Syntax check exits0; behavior has not run. They independently compare archive,
installed and manifest inventories; exercise both clients through the actual
installed foreground host/worker/adapter/core with fake HTTP only; verify one
Memory/two sources, unchanged original qualification and cold model-free runs;
retain the default incomplete outcome; and reject both stale config digests
and changed preparation bindings. Existing test-only host ancestry/HTTP drivers
are reused as instrumentation, not as the source of acceptance assertions.

Usability boundary retained deliberately: deletion may clear the surviving
Memory's qualification under existing semantics. A later qualified duplicate
then refuses rather than re-inferring or replacing that qualification. Passing
this packet does not claim every later repeated assertion will be admissible.
Any selective preservation/requalification policy needs a separate contract.

## Bounded local adapter implementation

Core milestone accepted; the same GPT6.1Sol/high author is assigned exactly
eight additional paths: adapters/local/configuration.mjs,
adapters/local/capture.mjs, new adapters/local/test/qualified-duplicates.test.mjs,
new packaging/test/qualified-duplicates.test.mjs, docs/capture.md,
docs/raw-local-journal.md, docs/limitations.md and CHANGELOG.md.
The first eight core paths remain frozen. Main alone updates this plan and the
parent completion checkpoint, prepares dependency links and owns independent
installed acceptance. No other fixture, runtime, manifest, CI, version, provider,
wire, host or product changes are authorized in this phase.

The author reuses unchanged synthetic HTTP/host/installed-import drivers.
Both-client source local tests plus actual installed host/worker/adapter/core
must exercise the chosen policy and strict default, source preservation, cold
replay and config/preparation refusal. The targeted existing local suites and
installed local one-shot/transport/worker/host checks run on both Nodes before
the final combined gate. Final author freeze covers all sixteen owned paths.
Core receives no extra intermediate full-suite rerun. Source model dependency
links are worktree-local only; primary prechecked all eighteen package hashes
against the previous pinned receipts, with no install or shared package edits.

## Installed acceptance and existing deadline diagnostic

The sixteen author paths were frozen at authorSha256
47abadfe507f4f23ead543d08645f6001afb8e5f716545fb1054848436fff42b;
the first eight core paths remain unchanged. Primary independently cross-checked
all eighteen changed regular files against both diff/untracked enumeration and
the complete base/current blob-mode inventories. The combined source freeze is
1846 entries, SHA256
81abe9a497d986b5eae13454a8a78da23b1119dde6e1c5d28e18ffff6c98bc46;
all eighteen pinned dependency package identities were rechecked.

Primary's independently authored installed acceptance passed5/5 on each
Node22.16/24.15, actual exit0/null, outer exit0. The full source remained
unchanged and the owned scratch directory was removed; primary separately
reparsed both logs and checked filesystem absence. Evidence is
primary-installed-v1-{freeze,report}.json under the primary evidence directory.
The author's six installed suites also passed21/21 on both versions, exit0/null.
The initial installed5 red was3/5 because its Codex synthetic header omitted
history_mode:'paginated'; only the header fixture was corrected. No parser or
qualification rule was weakened.

Delivery is not yet green. Both existing local affected-suite runs passed35/36,
actual exit1/null: the B3 process-deadline test expected exit124 but observed0.
Those reds and owned-cleanup receipts remain in adapter-final-22.16.0.json and
adapter-final-24.15.0.json in the author evidence directory. The full48-gate
manifest was prepared but not executed while this failure is being diagnosed.
Primary uses the diagnosing-bugs workflow: minimize the actual process path,
observe provider-entry and ledger preconditions, and compare the unchanged
parent against this candidate before authorizing a correction. A low-load
single-case pass on both parent runtimes does not resolve either original red.
The separate parent diagnostic outer exit is0, individual exits0/null, source
unchanged and owned scratch removed; its primary-parent-deadline-report.json
is retained. No production timeout, retry or safety policy has been relaxed.

The minimized current case and paired parent/current four- and eight-child
probes all entered the hanging provider and exited124. They did not reproduce
the original red and are not a resolution by rerun. A separate controlled
fake-input-token-response delay of350ms, longer than capture300ms but shorter
than process1200ms, produced the competing path on both parent/current and both
Nodes: process exit0/null, response503/interpretation_incomplete, planning1,
dispatch0, usage1 and no remaining reservation. Those four observations prove
the old test's unconditional hard-kill expectation lacked a provider-entry
precondition. The original two red runs lacked this trace, so their precise
timing path remains unproven. Preserve that distinction in the final report.

Primary authorized a two-file test-only correction, adding
adapters/local/test/oneshot.test.mjs and its fixtures/http.mjs to the author's
roster. The hard-kill case must use the existing hold-mode ready handshake,
never release it, and prove planning/dispatch and the charged reservation before
expecting exit124, no refund and dead-owner recovery. Its bounded synthetic
capture/process windows become5000/7000ms. A separate planning-delay fixture
and case use2000/7000ms with a2500ms fake count-response delay; prove planning
entry but no dispatch, response503 with process0, usage1 and released reservation.
No production limits, provider behavior, cancellation semantics or acceptance
assertions are weakened. The already-owned limitations doc records the evidence
and uncertainty. Expected author roster is now18 paths plus2 primary plans;
the actual diff/tree inventories must confirm20, not assume it. Run both focused
deadline cases on both Nodes, then the same five local affected suites. The
previously prepared48-command manifest remains unexecuted; freeze a new combined
source and manifest after this correction, retaining the original freeze.

The correction is now verified: both focused deadline cases passed2/2 and the
same five affected local suites passed37/37 on each supported runtime, all
actual exit0/null/error-null. Primary separately reparsed the four logs and
confirmed each owned workspace is absent. The final author eighteen-path freeze
is4964b83d72df06c7d570224aea4acdbc5d209db57d77358bfcb691cc4ac4be33,
all regular mode33188; original core8 and adapter2 runtime hashes are unchanged.
Both source inventories contain20 changed regular paths, with only the three
documented dependency links outside that count. All eighteen dependency package
identities remain unchanged. The external diagnostic scripts are deliberately
retained in the clearly named evidence directory; no debug instrumentation was
added to production files. Proceed to the new frozen combined48-command gate.

## Combined acceptance and candidate freeze

The final-v2 matrix completed all 48 predeclared commands on Node22.16/24.15,
with actual outer exit0, every child exit0/null, no interruption and no source
or dependency changes. Primary independently reparsed every complete log,
matched its command to the frozen manifest, verified all 1846 source hashes,
18 author paths and 18 pinned dependency identities, and confirmed the owned
workspace is absent. The independent verifier also exited0. Receipts are
primary-final-v2-{freeze,commands,report,verification}.json in
/tmp/cairn-qualified-duplicates-evidence.7niFI9/.

On each runtime the actual full-suite counts are: core1803/1803, MCP151/151,
generic635/635, local37/37, transport34/34, worker59/59, host41/41 and
workspace-lifecycle25/25. Artifact reports121 tests:120 pass, zero failures,
one explicitly native-Windows-only skip on Linux/WSL. JSON validation, host
import, twelve demos and the pinned native plugin validator all exit0. No
native-client activation or paid semantic experiment is represented by this.

The tested source aggregate is
0e472fdfa64d36a5b536af5bbf3ca86075f57b589dbf7eab2c355c0419b19daf;
dependency aggregate is
2dd9ce0eac23ef27043d2495234848fd2846a715a3779c9c22f4190beb0c1fe0.
Before committing, primary updates only this execution record and the parent
completion checkpoint to reflect the finished gate. A new delivery freeze must
prove that this is a documentation-only delta and all other source/dependency
bytes are unchanged. Re-derive both complete changed-file inventories, then
commit only the twenty scoped regular files. The three dependency links are
not delivery files. Repeat the independent core13 and installed5 cases on both
runtimes against the exact committed candidate. Separate nonauthor final-SHA
Standards/Spec reviews and latest-head CI are still required; their immutable
candidate and receipts belong in the PR, not a self-referential commit hash.
