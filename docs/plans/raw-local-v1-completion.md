# Local Raw V1 completion

Status: authorized implementation, not completed acceptance.
Base: `cd6d1ad32ac3d6f5926c6846e8c6d27645bb7c9a`.
Owner approval: 2026-10-21, local synthetic development/tests/PRs may proceed
before production G1/G2 receipts. Default-off; no real-user data, paid calls,
publication, deployment or operational database migration.

## What "V1 done" means

The goal remains one lightweight, reliable memory engine for MCP and harnesses.
Raw, Memory and private Knowledge Cards belong to the engine; the product
renders and authorizes access to it rather than maintaining a second engine.

The four remaining workstreams complete **standalone local V1** only after
their integrated acceptance passes. Product production readiness is separate.
They do not prove competitive semantic scores, complete automatic knowledge
consolidation, or general real-world reliability. Existing fixed benchmark
results and budgets are unchanged.

| Step | Deliverable | Exit evidence |
| --- | --- | --- |
| 1 | Exact selected/redacted Raw storage, bounded paged reads and usage, then atomic capture integration | Long Unicode messages reconstruct exactly; restart/replay do not duplicate or charge twice; partial sources remain visibly partial; failures leave no partial transaction or leaked text. |
| 2 | Raw source resolution for Memory/Card plus invalidation/deletion/exclusion | Bare Raw can support a Card without inventing a Memory; changing/forgetting support blocks stale current evidence; deletion preserves genuinely independent support; forgotten spans cannot return under new event IDs. |
| 3 | Claude Code/Codex continuation and local setup | Whole-message redaction precedes splitting; interrupted/lost-ack retries preserve identity and finish exactly once; first-part extraction retains existing budgets; unsupported hosts report unavailable, not full capture. |
| 4 | Installed system lifecycle | Actual package plus stdio/new process executes source → Memory/Card → read → correction/forget/deletion; source links, controls and fences survive restart. Product adapter gets the tested revision and its separate joint acceptance. |

Map final evidence to the three-layer contract's T01–T18 and Raw RL-1–RL-3
rosters, including clearly unimplemented capabilities and semantic vs mechanical
evidence. No checkbox is passed merely by another similarly named unit test.
T01–T03 semantic outcomes require separate model evidence; this packet makes
none. Generated summaries/vectors remain unavailable unless separately shipped.

## First packet: P1 internal Raw journal

This is the storage/read foundation **within step 1**, not the whole of RL-1.
Implement in the existing core SQLite store. Do not create another store or
wire a partially protected archive into current capture/MCP/hooks.

Allowed runtime seams: new `core/raw-*.mjs` modules, additive schema opening
in `core/database.mjs`, and an internal attachment in `core/runtime.mjs` if
needed by synthetic integration tests. No new public `openMemoryCore` mutation
or installed raw capability in P1. Its registration primitive is internal and
model-free; it cannot by itself create a Memory or Card. Later P2 integrates it
with capture/admission/episode/control transactions before exposing capture v2.

The internal primitive accepts a trusted exact namespace plus validated v2
message parts and host policy snapshot. Follow the Raw contract for immutable
identity, session HMAC, source text, usage and read DTOs. It must support joining
an enclosing synchronous transaction; no provider/crypto callback runs inside a
write transaction. Async preparation and final control/revision checks remain
separate. A trusted recheck callback is not a model-supplied permission flag.
Use the existing core error types, validation conventions, namespace identity,
owned workspace and file-permission behavior.

| ID | Observable P1 acceptance |
| --- | --- |
| P1-01 | Default open is unchanged. Explicit internal opt-in creates empty v24 records atomically from supported existing stores without fake backfill; option-off new openers preserve them and old openers reject v24. Injected migration failure rolls back. |
| P1-02 | Both supported clients preserve exact selected/redacted text, whitespace, escaping and Unicode over multiple >4,000-unit / >20,000-unit messages. Invalid Unicode/NUL, oversized parts, inconsistent metadata, duplicate ordinal, missing predecessor and wrong final totals fail with fixed errors and no partial transaction. |
| P1-03 | Exact event/part retry, overlapping retransmission and close/reopen return stable identities, consume zero extra bytes and cannot change recorded content/policy. Changed same-identity payload refuses, including when Raw was skipped. |
| P1-04 | Reserve the whole declared message bytes first; concurrent connections/processes cannot overspend an owner-wide cap across namespaces/clients. Over-cap messages are wholly skipped, with no eviction/backfill. Pending reservations survive restart. Existing reservations survive a cap decrease; only new admissions use the smaller cap. |
| P1-05 | Paged reads return whole parts in ordinal/part order within 65,536 serialized bytes. Cursors bind store/scope/conversation/revision/limit/epoch; foreign/malformed/stale cases refuse; missing/foreign content uses the same null shape. Unknown time and incomplete coverage stay explicit. |
| P1-06 | Sealing/opening validates exact AAD and decoded length/bytes; callback failure produces fixed errors without plaintext fallback or exception prose. Snapshot and commit/read-publication fences catch concurrent mutation. Callback inspection proves no write transaction is held. |
| P1-07 | Usage counts saved and reserved UTF-8 bytes, not SQL allocation; reads/duplicate retries do not mutate usage revision. Policy skips persist content-free dispositions and cannot be filled after policy changes. Pending-attempt closure releases reservations exactly once and keeps accepted parts. |
| P1-08 | A forced failure in an enclosing registration transaction rolls back Raw, ledger and usage together. No admission/episode atomicity claim until P2 actually joins those components. |
| P1-09 | Owner/scope isolation, no raw session IDs or text in metadata/error output, and read-untrusted markers hold. Only explicit `local-plain-v1` fixtures are used; no hosted encryption claim. No network, extraction, qualification or model invocation occurs. |
| P1-10 | Synthetic success and failure fixtures clean up via owned test workspaces. Core/generic validation and affected packaging/import gates pass with actual exit codes; key new paths run on Node 22.16 and 24.15. |

P1 does not claim capture-v2 registration, first-part extraction, legacy episode
deletion routing, Raw → Card, installed hooks, hosted encryption, notices,
account erasure or product launch. Those remain required before their capability
can be advertised. The journal must not be used with real data to bypass them.

## Subsequent packet boundaries

- P2: integrate prepared parts with the existing capture/admission and episode
  registration transaction; authoritative pause/project/client controls and
  deletion fences; preserve bounded first-part-only model work.
- P3: source refs/offset mapping and Raw → Card; D5 independent-source deletion,
  D6 forgotten-span exclusions, option-off mutation safety and durable effects.
- P4: both clients, schema/conformance/local setup, then installed lifecycle.
  Complete each packet's independent review before the next dependent delivery.

These are implementation subdivisions of steps 1–4, not additional launch
conditions. Re-scope with evidence if integration reveals a material conflict;
do not silently relax source deletion, permissions or test denominators.

### Next packet's integration checks

P2 must join the real existing registration seams, not call `register()` in a
separate transaction before or after capture and call that atomic:

- Ordinary capture: admission registration in `core/admission-storage.mjs`.
  Exercise no-staging and staged paths; preserve existing payload conflict,
  lease, overlap and ordered-capture behavior.
- Episode capture: reservation in `core/episode-storage.mjs`. Raw and the
  first-part admission reservation/episode observation share one commit; a
  forced failure after either side rolls everything back.
- Preserve Raw after successfully registered input later fails extraction,
  qualification or staging retention. That is different from rolling back a
  failed registration. Report incomplete interpretation separately from saved
  Raw coverage; a saved source is not proof that a Memory was extracted.
- Continuation-only batches invoke zero extractor/qualifier/classifier/episode
  interpretation calls and do not advance the accepted-batch debounce counter.
  Mixed batches process only their new first parts within existing budgets.
- A pause, project stop, client switch or session deletion during asynchronous
  sealing must win before commit. Test restart, replay, lost acknowledgement,
  existing reservations and an abandoned long-message suffix.

Use deterministic scripted models, actual SQLite transactions and independent
new processes first. Keep the internal path unavailable to real capture clients
until source invalidation/deletion/exclusion and installed-client acceptance
are integrated. Public capabilities cannot lead their protection mechanisms.

## Work and verification record

### P2 contract: join real capture registration

Fixed dependency: P1 `0be04cdcc9e5a88b3702bf915510da810d5e797a` (PR #449,
not merged when this packet started). Worktree `raw-local-v1-capture`, branch
`feat/raw-local-v1-capture`. Main remains `cd6d1ad`; this is an explicitly
dependent delivery, not permission to merge either PR.

P2 is an internal local integration, default-off and synthetic-only. Reuse the
actual capture/admission/episode implementation; do not create a test-only
parallel algorithm or add a host/product store. Public constructor inputs,
legacy capture request/response fields and advertised capabilities remain
unchanged. A narrowly scoped internal construction seam may connect the new
journal to the existing core; document it and keep the usable Raw entrypoint
out of the installed runtime until P3/P4. Never accept transaction callbacks,
trusted controls or permissions from a wire/model input.

| ID | Required observable result |
| --- | --- |
| P2-01 | The real ordinary and staged admission paths commit Raw parts, content-free event/part identities, usage and admission reservation atomically; the real episode path also includes its event and observation. Force a failure after either side and observe no partial state from a fresh connection. No crypto/model callback runs in the write transaction. |
| P2-02 | Only newly registered first parts contribute to the existing bounded, normalized model projection. A batch of continuations makes zero extract/qualify/classify/episode calls and creates no admission or accepted-batch increment. A mixed batch contributes only its fresh first parts and counts once. Exact replay, overlapping parts with a new event and cold restart do not repeat completed first-part interpretation or charge bytes twice. Bind the projection to the frozen Raw identity; caller mutation cannot swap it. |
| P2-03 | Successful Raw registration survives subsequent extraction/qualification failure, staging release/expiry and capacity bypass. Report source saving separately from interpretation. Preserve legacy capacity refusal; the internal new path may bypass full staging without claiming staged evidence. Existing model input and time budgets are unchanged. |
| P2-04 | Real namespace pause/project-stop and owner/client Raw-off controls close affected pending assemblies and release only their unused reservations in the same control transaction, including with episode mode off. Resume/re-enable never backfills closed attempts. Other namespaces, clients and owners are unchanged. |
| P2-05 | Pause/project/client-control changes or a session deletion fence during asynchronous sealing refuse the prepared registration before any model work and leave no new partial writes. After successful registration, a later pause/project stop/deletion cannot publish new stale Memory from the in-flight model result. Do not claim the later P3 source cascade is implemented merely by this fence. |
| P2-06 | Ordered-capture proofs are taken after Raw's registration epoch advance so normal capture does not conflict with itself; an actual concurrent change still refuses stale admission. Episode registration precedes interpretation for the new path, including lazy work and early duplicate/overlap/processing branches. Preserve all legacy behavior when internal Raw is absent. |
| P2-07 | Replay after a lost acknowledgement returns recorded Raw dispositions and correct processing/completion status without resealing or recharging. Raw-off/quota/notice skips still permit eligible first-part Memory capture; crypto failure permits neither registration nor interpretation. Changed same-event/part payload refuses without echoing source or callback errors. |
| P2-08 | Exercise both supported client identities, episodes on/off, staged/unstaged and ordered configurations with real SQLite and new processes. Retain explicit failures; fixtures clean up on success and failure. Run core on Node 22.16/24.15, generic validation, affected demos, public/installed compatibility and independent Standards/Spec review on one final committed diff. |

Full D5 deletion/cascade, D6 source-span exclusions, Raw-to-Card resolution,
client producers/setup, wire v2 schemas and installed Raw lifecycle remain P3/P4.
No real transcripts, paid calls, production migration, publication, deployment
or automatic merge. The product team keeps its previously validated pin.

Primary owns this contract, shared-file coordination and independent acceptance.
One GPT 6.1 Sol/high worker owns bounded implementation and tests; separate
non-author GPT 6.1 Sol/high reviewers own Standards and Spec after the candidate
is frozen. Record actual model fallback, correction rounds and exit codes below.

P2 construction decision: keep the strict public `openMemoryCore` wrapper and
add a trusted internal builder for the uninstalled Raw factory. The builder
must reuse the same capture/runtime functions; request/model fields cannot
select or inject its trusted hooks. A separately opted additive schema v25
(`rawCapture:true` internally) records the content-free event-to-first-part
projection binding and capture generation. P1-only opening still uses v24;
ordinary/private opening still uses v18/v23. Current option-off openers preserve
v25 and old openers refuse it. Verify migration rollback, not just the version
number. Only the import closure necessary for legacy installed operation is
packaged; the usable Raw factory stays uninstalled.

Registration precedes staging clock/expiry maintenance, with ordered proof
acquisition after both. Invalid first-part registration must roll back inside
the transaction, not commit Raw and throw an admission error afterward. Raw-off
after successful registration does not cancel Memory processing: its scope is
Raw saving only. Namespace pause/project-stop/session deletion do fence later
Memory publication. A newly enabled client may submit a new higher-ordinal
message after a closed old suffix, but must never reopen/backfill that suffix.

The internal result separates saved-source outcome from the existing
interpretation success/error envelope. It is not the public v2 wire
acknowledgement and cannot authorize a future client to advance its cursor
merely because the outer operation registered Raw successfully. Valid exact
Raw with a whitespace-only first part remains saveable; an empty normalized
projection performs no model work and reports that limitation, without a
placeholder or pulling later continuation text into first-part extraction.

P2 control closure is through the internal Raw factory. Arbitrary option-off
v25 writers still need P3's mutation-safety integration before any real Raw
capability is exposed. The durable admission guard already rejects publication
after namespace/session fences; that is not a claim that all option-off control
writers release pending Raw reservations. The product pin stays unchanged.

Legacy episode coverage must not be silently backfilled into Raw. A first Raw
projection colliding with a legacy-owned message or event refuses the whole
registration transaction with `event_payload_conflict`, including a mixed
legacy/fresh batch. The legacy event and its original interpretation remain
unchanged. This is a safe protocol boundary, not cross-protocol replay support.

### P2 first-candidate verification and correction record, 2026-10-21

Implementation worker: `/root/raw_p2_capture_impl61`, actual requested model
`gpt-6.1-sol`, high effort, no fallback. Primary owns the separate acceptance
suite and integration. Reviewers and final committed candidate are recorded in
the PR after the verification gate; no author self-review counts as independent.
Agent token/cost data is unavailable; no live memory-provider calls or paid API
experiments were made.

Two defects were detected before candidate freeze and retained as evidence:

- A legacy episode/new Raw identity collision saved Raw but did not establish
  the claimed new admission ownership. Four regression cases first exited 1,
  then all four passed after rejection moved inside the registration transaction.
  Completed, active, mixed and same-event legacy cases are covered.
- The initial full Node 22 run (1,311/1,313 passed, two failures, actual exit 1)
  exposed two regressions from the same eager optional-schema probe:
  an eager optional-schema probe required `prepare()` from an existing `exec()`
  failure-classification seam, and an episode-off path made an extra query.
  Deferring the probe until actual episode publication restored both seams;
  the two focused existing cases passed with exit 0 on Node 22. That
  initial full run is not presented as verification of the corrected candidate.

The frozen actual P1 database opener was independently compared with
`git show 0be04cd:core/database.mjs`: one file, 19,853 bytes, identical after
removing its explanatory header and relocating imports. The first comparison
found one extra trailing newline, which was removed before the exact match.

Primary acceptance uses its own request construction/splitter, not the worker's
fixture implementation. Twenty tests pass on both Node 22.16 and 24.15 (actual
exit 0 each): long Unicode reconstruction across a real new process, stable
replay/usage, live overlap, blank first parts, rollback from a fresh connection
including failure at the final episode observation update, pause during model
work, durable session fences and same-owner namespace/client isolation. These
are mechanical scripted-model results, not semantic accuracy evidence.

Additional completed gates: P2's three checked-in suites pass 73/73 on both
Node versions (exit 0 each); generic `npm test` passes 635/635 on Node 24
(exit 0); `npm run validate` and maintainer plugin validation each exit 0.
`demo:store`, `demo:admission`, `demo:capture`, and `demo:episodes` each exit 0
on both versions (eight invocations). `NODE_DISABLE_COMPILE_CACHE=1 npm run
test:workspace-lifecycle` passes 25/25 on each version, exit 0, including
subprocess success/failure/catchable-termination cleanup. Demos retain their
documented synthetic artifacts; no historical scratch sweep is performed.

Corrected full `npm run test:core` passes 1,317/1,317 on each Node version,
zero failures/skips, actual exit 0 (22.16: 395.2 seconds; 24.15: 420.5 seconds).
Serial `npm run test:mcp` passes 125/125 on each version, exit 0. Serial
`npm run test:artifact` passes 94 tests on each version, zero failures, one
native Windows-only skip on WSL, exit 0. These exercise the existing installed
surface, not an installed Raw capability. No fixture deadlines were enlarged.

Primary cross-checks the P2 file inventory using `git diff --name-only` plus
untracked files and independently Git porcelain status: 20 files agree,
including tests, fixtures and both docs. The 18 changed core files retain the
same path/content SHA-256 before and after final full-core validation:
`ba9af8de5ceb8cf5fb02aa390b09237353b15bb9b35695d1c9210e60687ed14c`.
The candidate is committed only after these gates. Independent review and
latest-head CI are not claimed by this pre-commit record; their final SHA,
separate Standards/Spec reports and outcomes are recorded in the delivery PR.
Local full logs and primary acceptance are in
`/tmp/cairn-raw-p2-evidence.xAB4IQ`, not a portable test dependency. No outstanding
worker process remains at this checkpoint. No two unsuccessful correction
rounds on the same defect or model fallback occurred.

### P2 independent-review correction checkpoint

The first candidate was `05f4a94f4073a9ca986e73fefa7f48be22201941`,
reviewed against fixed P1 base `0be04cdcc9e5a88b3702bf915510da810d5e797a`.
Separate non-author GPT 6.1 Sol/high reviewers found two documented-standard
violations and one P2-07 defect. These findings block delivery of that candidate:

- Secondary SQLite/core handles at nine test sites were registered with
  `t.after` after workspace cleanup. They must use `workspace.defer` so handles
  close before removal. Passing Linux tests alone did not establish that order.
- P2 retained failures and limitations also belong in `docs/limitations.md`,
  as required by `CONTRIBUTING.md`, not only in this detailed plan.
- An exact staged replay after interpretation failure or staging expiry lost
  the already saved Raw acknowledgement. The independent primary added six
  selected red cases: all six failed, actual exit 1, on Node 22.16. The cases
  also exposed that ordinary failed replay could attempt interpretation again.
  Neither behavior satisfies observable replay of the original saved event.

Correction design: exact existing eligible event replay revalidates identity,
policy and namespace/session generation inside the existing Raw journal
transaction, then observes durable admission state. It never reacquires work,
renews a lease, reseals source or invokes a model. Completed work reports a
duplicate completion, live work reports processing, and failed/expired work
reports incomplete. Fresh events keep the original atomic registration path;
pause/project/session fences and payload mismatch refusals remain in force.

Primary acceptance then reproduced two additional scheduling boundaries before
the correction was frozen: a still-pending staging row whose expiry has elapsed
could incorrectly look like live processing (two cases, actual exit 1), and
two same-event calls racing asynchronous sealing could still fall back into the
original claim path (two cases, actual exit 1). These are retained separately
from the six original red cases, which already passed after the first fix.
The observer must use effective staging expiry without mutating its clock.
Authoritative replay detection also belongs inside the actual admission/episode
registration transaction, not only in a pre-transaction Boolean. The private
registration hook can return an observation short-circuit to the shared capture
orchestrator before any lease or provider work; legacy calls without this trusted
hook remain unchanged. Primary approved this bounded shared-orchestrator change.

The same implementation worker owns this correction packet. Primary adds
independent acceptance for both clients, cold replay after staging expiry,
ordinary/staged failure, live/expired leases and racing duplicate registration.
A final candidate requires
affected gates and both independent review axes again. The prior green counts
above are evidence for the first candidate, not substitutes for these checks.
The optional four-line recursive-freeze duplication heuristic is deferred:
it is not a documented violation, and sharing it would add packaging/import
coordination unrelated to this correctness correction.

### P2 corrected-source verification checkpoint

The correction's four checked-in Raw capture suites pass 106/106 on both
Node 22.16 and 24.15, zero failures/skips, actual exit 0 each. Primary's
independently constructed suite passes 32/32 on both versions, actual exit 0,
including the cold/replay, effective-expiry and competing-writer cases above.
`npm run validate` and maintainer plugin validation each exit 0; all eight
`demo:store` / `demo:admission` / `demo:capture` / `demo:episodes` invocations
also exit 0 on this corrected source. Full core and installed compatibility
are rerun before the corrected candidate is committed.

Both full core runs on that unchanged atomic-replay source completed with
1,350/1,350 passed, zero failures/skips, actual exit 0 each (396.3 seconds each).
These full runs precede one final internal-only selection correction: a winner
can register while the original call awaits sealing, so selection must recheck
the durable binding after that await instead of unnecessarily reaching model
preflight. A held-seal/over-budget counter probe reproduced the omission; the
primary's two selected regression cases failed with actual exit 1. The existing
atomic transaction hook remains necessary for later cross-process races.

Do not label those 1,350-case runs as verification of this final selection
change. Both-runtime focused suites and primary acceptance are rerun on the
last source, and the final reviewed PR head must pass the full CI matrix before
delivery. The selection change does not alter the installed/shared capture
orchestrator already exercised by the full runs. Installed compatibility is
still rerun serially to avoid the documented P1 load-sensitive deadlines.

The 20 changed core files have path/content SHA-256
`75a754723fc3f747f8fb4881217574b7761339e6c5d9cced8bc389bc430ed594`.
Primary cross-checked the complete 23-file P2 inventory by two independent
routes: base diff plus untracked paths, and committed path history plus Git
porcelain status. Both agree, including the new replay suite and limitations
record. The actual frozen P1 opener remains byte-identical after its documented
header/import normalization (one file, 19,853 bytes, actual exit 0).

After the last selection correction, all four checked-in P2 suites pass 108/108
on each runtime, actual exit 0. Primary acceptance passes 34/34 on each runtime,
actual exit 0. The final 20-core-file path/content digest is
`8a7ec326012487f92cb6ee9d926cf7cfb131c32fbc1c0024c28ecfbf77ede9c6`;
the 23-file P2 inventory is unchanged. The owned-workspace lifecycle gate was
also rerun: 25/25 passed on each runtime, actual exit 0, including subprocess
success, assertion/setup failure and catchable-interruption cleanup. No
historical-directory cleanup or user-data access was performed.

Final serial compatibility reruns on the last source: MCP passes 125/125 on
each runtime, actual exit 0; artifact installation passes 94 tests with zero
failures and one native Windows-only skip on each runtime, actual exit 0
(22.16: 77.1 seconds; 24.15: 87.1 seconds). The native Windows CI job remains
required. These gates exercise existing installed behavior, not installed Raw.
No test deadline was enlarged. No worker or primary test process remains at
candidate freeze. Separate final-head independent reviews and latest-head CI
are recorded in the delivery PR, rather than retroactively claiming them here.

Primary: plan/integration/acceptance. Implementation: one bounded GPT 6.1 Sol
worker, high effort. Independent Standards and Spec reviewers: separate
non-authors on one fixed committed candidate. Requested/actual model and
commands/results will be recorded when known; no model cost is inferred.

### P2 final-observation correction checkpoint

The second frozen candidate was `1433a296721208cc4ab2a988e7ed8b440ef9327f`.
Standards review found zero documented violations and the same optional low
freeze-helper duplication. Spec review found one remaining moderate P2-07
boundary: a competing process can save the identical event during model-budget
preflight, then that preflight refuses before the atomic claim hook is reached.
The slower request reports only `context_budget_exceeded`, omitting the saved
Raw and its durable interpretation state. The earlier post-sealing check does
not cover this later schedule. No source loss was demonstrated; the error is
an incomplete response about already committed state.

Primary independently reproduced this on the committed candidate with twelve
two-client cases: ten failed, two fresh-event controls passed, actual exit 1.
The cases cover failed/completed winners, session/pause/payload barriers and
absence of a winner. A separate process performs the competing capture; parent
model calls stay zero. The response must not erase a current authority barrier
or manufacture registration when no identical durable event exists.

The bounded correction moves the final observation decision to the internal
Raw factory/storage boundary for an interpretation failure before acceptance.
In one transaction, require an existing binding first, then revalidate exact
identity and current namespace/session/generation authority before observing it.
No new claim, registration, lease, staging change or model retry is permitted.
An ordinary fresh oversized request retains its zero-write preflight refusal.
The existing atomic claim observer remains necessary for successful preflight.
Both thrown failures and returned failure envelopes must reach the same guard.
This is not another early timing check and needs no public wire change.

The existing GPT 6.1 Sol/high worker owns the bounded runtime/test correction;
primary owns independent acceptance and this record. Both independent axes
must review the next committed candidate against the same P1 base. Earlier
full-core and focused results remain explicitly attached to their earlier
sources, not claimed for this correction. Full core starts only after the new
source is frozen, followed by latest-head CI; no push has occurred yet.

Final-observation focused verification passes all four P2 suites, 146/146 on
Node 22.16 and 24.15, zero failures/skips, actual exit 0 each (20.6 and 41.5
seconds). Primary's independently built suite passes 46/46 on each runtime,
actual exit 0, including separate-process failing-preflight races, completed and
failed winners, authority/payload refusals, and the unchanged zero-write control.
The checked-in suite also covers episode/staged profiles, throwing counters and
a deliberately corrupted orphan binding; that corruption fixture temporarily
disables foreign keys only in its owned synthetic database. No receipt repair
is allowed. All worker-owned test processes have finished.

Primary cross-checks 23 P2 paths by base diff plus untracked paths against
committed path history plus porcelain status; both lists agree. The frozen
20-core-file path/content digest is
`2e310e24cf7f3c4093408261eeef64ec5f2adfc5e00f0b8a10b2c97a49ab4bb0`.
Only the two internal, uninstalled Raw runtime modules changed after the prior
candidate; shared/public capture code did not. Generic JSON validation,
maintainer plugin validation and `git diff --check` each exited 0.

The subsequent unchanged-source full-core runs each finished 1,389/1,390, one
failure, zero skips, actual exit 1 (Node 22.16: 409.7 seconds; Node 24.15: 410.1
seconds). Both fail the existing D3 initial-classification journal rollback
case, returning an outer `model_timeout` instead of reaching its expected
post-admission failure envelope. These are failures, not full-suite passes.
All new Raw cases passed. The exact original D3 case then passes alone on both
versions, actual exit 0; this alone does not establish the cause or resolve the
failed full gate. Primary and the existing worker are isolating the deadline
precondition, against actual P1 where available, without changing runtime
deadlines or weakening assertions. Final independent review/push remains held.

The targeted feedback loop now distinguishes the deadline premise: the worker's
twelve controlled probes cover P1/current source, both runtimes and real-journal,
logical-journal and logical-pre-admission timing. All mechanism assertions exit
0. The real delayed journal hook executes once, not multiple times. Advancing
only pre-journal admission time to 601 ms reproduces the outer timeout with no
Memory/receipt/journal left and zero journal-hook hits; the original success
expectation is red (exit 1). Advancing only after the real journal UPDATE instead
retains admission and rolls its journal back to `not_started`. Primary separately
reproduces both states on actual clean P1 and current source: the original D3
success prerequisite fails with exit 2 in the early-expiry control, while the
intended journal-boundary assertions exit 0. This supports a baseline-shared
timing precondition problem; the original full logs cannot retrospectively prove
the exact historical expiry site. No shared-core behavior difference is shown.

Primary approved a test-only deterministic correction using an isolated child
clock at the real journal mutation, preserving the original 600 ms budget, plus
a transaction-post-work-check mutation control. Runtime deadlines and all Raw
runtime source stay frozen. The throwaway diagnostic harnesses live under the
local evidence `debug/` directory, not in production code. Initial diagnostic
harness errors (a proxy method binding and a too-specific SQL matcher) were
corrected there and are not classified as product failures.

The test-only correction now passes the full 19-case deadline file on each
runtime, actual exit 0. The intentionally broken transaction child exits 2 with
the specific journal-rollback assertion on both versions; the parent requires
that failure, checks cold database state and verifies its workspace is empty
after normal/control/assertion-failure children. Primary reran that parent on
both runtimes, actual exit 0. Only the D3 test and its new isolated helper changed;
runtime deadlines and the already verified Raw implementation remain unchanged.
The resulting 25-path P2 inventory agrees across the two independent routes;
22 changed core paths have SHA-256
`a935e0dcaaa2cbfbee3b2dbf8798b1a396b49f13ffe764e1491f0433720a9879`.
Final full-core runs are now serialized by runtime, with original failures
retained and no deadline enlargement. Their actual outcomes are recorded below
when complete, before candidate freeze and independent review.

Both serialized final-source full-core runs have now completed: 1,390/1,390
passed on Node 22.16 and 24.15, zero failures/skips, actual exit 0 each (401.9
and 388.1 seconds). The command captured each npm exit separately, and the
serial supervisor itself exited 0 after the second run. The 22-core-file digest
above is unchanged. Primary's independent inventory also agrees for the full
36-path diff against main `cd6d1ad`; no unrelated primary-worktree changes are
included. JSON validation and diff checks exit 0 after the full runs. All owned
worker and primary test processes have finished before candidate freeze. Both
review axes and all applicable latest-head CI remain required before delivery;
their final reports, exact head and remote results belong in the delivery PR.

### P1 verification, 2026-10-21

The first frozen candidate was `91846e650b8a66f443eec9bfcae5c86bdbd24188`.
The following evidence precedes the review correction recorded below; it is not
presented as verification of later changes. No completed public Raw capability
is claimed.

| Check | Observed result |
| --- | --- |
| Worker `npm run test:core`, Node 22.16 / 24.15 | Each 1,225 passed, zero failures/skips, actual exit 0. These runs loaded the code before the last barrier and explicit-null corrections; they are not represented as full-suite verification of those two changes. |
| Final `node tools/testing/run.mjs core/test/raw-journal.test.mjs core/test/raw-boundaries.test.mjs`, both versions | Each 27 passed, zero failures/skips, actual exit 0, including the two final corrections. |
| Primary new-process acceptance plus those two final suites, both versions | Each 28 passed, actual exit 0. An independent 47,600-unit / 64,600-byte Unicode message reconstructs exactly from pages after closing/reopening in a new process; retry usage is unchanged, ordinary Memory admission coexists, the actual old opener refuses v24, and the owned workspace is absent after cleanup. |
| Baseline full core, Node 24.15 | 1,200 passed, actual exit 0, at the prior integrated tree identical to fixed main. |
| Generic `npm test`, Node 24.15 | 635 passed, zero failures/skips, actual exit 0. |
| `npm run validate`; installed maintainer plugin validation | Each actual exit 0. The first plugin command exited 1 because dependencies installed with `--ignore-scripts` had no native tool; rebuilding that pinned maintainer dependency resolved setup without repository changes. |
| `npm run demo:store` and `npm run demo:private-cards`, both versions | Each actual exit 0. These retain their explicitly reported synthetic demo databases; they are not test-workspace residue. |
| Final serial `npm run test:mcp`, both versions | Each 125 passed, zero failures/skips, actual exit 0. |
| Final serial `npm run test:artifact`, both versions | Each 94 passed, zero failures, one native Windows-only skip on WSL, actual exit 0. This is the existing installed surface plus its new schema import, not installed Raw capture. |
| `NODE_DISABLE_COMPILE_CACHE=1 npm run test:workspace-lifecycle`, both versions | Each 25 passed, zero failures/skips, actual exit 0. Includes real successful/failed subprocess cleanup and preserves foreign/replaced roots. |

One actual P1 defect was reproduced before correction: a `capture_barrier`-closed
long-message suffix prevented a fresh higher message ordinal. The new regression
first exited 1 with `raw_part_out_of_order`; the fix permits the fresh message,
while late suffixes remain unsaved gaps and never regain reservations. Explicit
null cap/page-limit values now refuse rather than silently selecting defaults.

The first concurrent full MCP run on Node 24 exited 1 (124 pass, one H4 failure);
the first artifact run on Node 22 exited 1 (93 pass, one H5 failure, one native
Windows-only skip). Preserve both. An independent read-only GPT 6.1 Sol/high
diagnosis used actual stdio against baseline and candidate on both runtimes:
all four ordinary H4 runs exited 0, while a controlled 1,550 ms delay after
initial journal startup made all four reproduce the exact missing-classifier
failure with exit 1. The shared 1,500 ms deadline had already elapsed; an extra
stderr drain did not reveal a classifier call. The six relevant existing files
matched across trees. This establishes a sufficient mechanism on both versions,
not the unrecorded precise timing of the original failure.

H5's 1,000 ms budget similarly includes tokenization/token-count work before the
recorded extract request. A pre-model stdio probe reproduced its empty-stage
signature on both trees, but was not the installed H5 fixture. Serial full gates
follow the completed core load; no runtime or fixture deadlines were enlarged.

Local logs and independent acceptance are retained at
`/tmp/cairn-raw-p1-evidence.rktEiy`; the worker full-core records there are clearly
labelled final-console-summary excerpts, not full logs. Controlled diagnostic
logs are at `/tmp/cairn-mcp-h4-diagnosis.A2O1Rk`. No real data or model calls were
used. These local paths are reproducibility aids for this session, not portable
test dependencies; checked-in P1 tests use the owned-workspace runner.

Primary cross-checked the changed-file inventory by `git diff --name-only` plus
untracked files and independently by Git porcelain status: 17 files agree,
including plans, limitations, testing support and the packaging manifest.
The frozen old opener also matches the actual base byte-for-byte after removing
its two explanatory comments and relocating imports. An initial verifier
handled only single-quoted imports and exited 1; correcting the verifier to
handle both quote forms exited 0 without changing the fixture.

The reviewed candidate and independent Standards/Spec results will be recorded
in the delivery PR, followed by latest-head CI evidence. Local commands are not
a substitute for that final delivery gate.

### Review correction R1: legal mixed batch

Two non-author reviewers independently inspected `91846e6`, both configured
GPT 6.1 Sol/high with no reported fallback. Standards found no actionable
violation and one optional duplicated recursive-freeze helper. That minor
helper refactor is deferred; the intentional frozen old-opener copy remains
compatibility evidence.

Spec found one correctness blocker: preparation validated every part against
unchanged pre-batch state. A legal batch that finishes the previous message and
then starts a new message incorrectly failed `raw_part_out_of_order`. This
violates the permitted ordered multi-message batch in the Raw contract. The
Spec reviewer's probes confirmed it on both Node versions; primary independently
reproduced the rejection, then wrote an expected-success regression that exited
1 before the fix.
The earlier 27-test suite had missed this case, so its green result was not
sufficient for P1 acceptance.

Correction round 1 by the same bounded implementer projects the latest message
progress sequentially and validates the whole batch before the first seal
callback. Commit-time validation still checks real SQL state. Seventeen new
cases cover both clients, new/continuing complete and incomplete predecessors,
reversed/reused ordinals, completed overlap, four skipped dispositions followed
by an eligible message, later-seal rollback and stable replay/usage.

The corrected Raw suites passed 44/44 on each Node version, actual exit 0.
Primary independently reran those suites with its new-process and mixed-batch
acceptance: 46/46 on each version, actual exit 0. The same primary mixed-batch
test had exited 1 on the original candidate. Only the internal journal and its
Raw test file changed at runtime; packaged database/schema and public capture
files are unchanged from their serial MCP/artifact gates. Final-head CI will
repeat the full suites. Both independent reviews must inspect the corrected
fixed commit; do not ship the first candidate.

## Existing contract coverage, before this packet

This is an implementation coverage audit at the fixed base, not new test results.
The existing private engine evidence is in
[`private-engine-v1-completion.md`](private-engine-v1-completion.md) and PRs
#447/#448. Each remaining observation must be exercised again on the integrated
Raw candidate before marking that row complete.

| Three-layer rows | Existing bounded behavior | Remaining observation |
| --- | --- | --- |
| T01–T03 | Existing decision/relation/temporal primitives and retained evaluation results | End-to-end meaning and source-link accuracy; four engineering steps do not establish a new semantic score. |
| T04, T17 | Note/receipt identities exist, but no persistent Raw refs | Exact Raw spans survive unrelated append/filing, while exclusions invalidate the right source. |
| T05 | Exact-scope private Memory/Card access and mappings | Apply the same isolation tests to Raw, continuations and source resolution. |
| T06 | No generated topic-summary capability | Keep unavailable; never fabricate a tested summary cache. If added, source/version invalidation becomes mandatory. |
| T07, T09 | Memory revision invalidates dependent drafts/current evidence | D5 independent-source deletion and D6 retained-Raw exclusions, including changed event IDs and option-off writes. |
| T08, T10 | Local authored Card CAS, content-free replay, purge and effects | Re-run with Raw source loss/deletion; no claim about unimplemented asynchronous model drafting or hosted publication. |
| T11 | Typed organization and reversible mappings | Re-run against the combined candidate; MOC remains navigation, not permission. |
| T12 | Explicit submitted-note route and excerpt-backed drafting | Bare Raw → Card without a Memory or invented note, including exact source identity and exclusion checks. |
| T13 | Ordinary capture/Memory confirmation does not create Cards | Preserve this invariant through new capture v2 and both clients. |
| T14 | Installed bounded note/receipt Card lifecycle and terminal confirmation | Repeat with the completed Raw path in actual installed processes/new sessions. |
| T15 | Bounded typed reads and current-source revalidation | Long multipart Raw, cursor/byte bounds and sealing failures. |
| T16 | Owned temporary-workspace infrastructure | Every new success/failure fixture must participate; no historical cleanup. |
| T18 | Existing trusted-action/final-evidence fences | Add Raw prepare/open/commit races and eventual product-adapter checks. |

Product issue #453 now records this development exception at
https://github.com/wsxqaza12/cairn-wiki/issues/453#issuecomment-6298041894.
Product #490 is a separately owned local adapter, not approval to migrate or
deploy. Its capacity/import/multi-namespace and hosted gaps stay explicit;
completion of this journal does not close those product requirements.
