# B4b: durable local-v2 producer progress

Status: milestone1-3, primary acceptance and all38 final affected gates passed
locally; committed independent review and latest-head CI remain pending.
Fixed base: c76196e8ca0d08f6efee8919e7167d6c684bfc33 (PR #461).
Worktree: /home/chichieh/Github/cairn-memory-worktrees/raw-local-worker.
Branch: feat/raw-local-worker.
B4a is ready/unmerged: 31 latest-head checks, four workflows all success,
independent Standards/Spec zero findings, primary committed21+installed2 cases
per runtime actual0. Merge833c06d has identical cdbc56b tree.
Keep the same engine, source-bound-v2 qualification and per-model-port usage;
no hosted/v1 rewrite, new model, schema change or automatic client enablement.

## Outcome

A local host can supply one freshly authorized transcript and existing private
configuration, then repeatedly run bounded work against the B4a transport.
Restart preserves exact event/part identity and source progress. This packet
joins the existing streaming selection/redaction/planner with durable progress;
it does not invent another memory pipeline or claim semantic quality.

Separate later delivery connects actual Claude/Codex entrypoints, setup,
pause/resume and the final installed Raw/Memory/Card lifecycle. Do not declare
V1 complete until those real flows pass. No user data, paid API, merge, release,
deployment or product pin/flag change is authorized here.

## Identity and state ownership

- Use a new explicitly versioned local-v2 state namespace, not either old
  capture cursor. A fresh setup operation initializes it; a normal worker never
  silently adopts old hosted pending work or starts at ordinal one after loss.
- One preexisting private32-byte installation key is supplied by local setup.
  Normal work may not generate/repair it. Bind the state root to its commitment;
  mismatching/missing/corrupt key blocks. Purpose-separated HMACs bind exact
  store/target/namespace/client/raw-session. Wire session and cursor identity
  exclude consent generation, source epoch, path and credential.
- Use an immutable per-session claim next to mutable cursor state so a missing
  established cursor cannot masquerade as first use. Creation is exclusive,
  read back and synchronized using existing private-state helpers. A crash
  between claim and initial cursor refuses visibly, not silent reinitialization.
  Deleting all owner state is not a malicious-owner protection claim.
- Persist only keyed/opaque identities, versions, finite counters/status,
  byte ranges, issued-ordinal high-water, part position, exact pending projection,
  notBefore and Claude's ownSkillTurn boolean. Never source text, raw session ID,
  transcript/plugin path, provider key, complete request or raw error prose.
- The planner's pending object includes raw sessionId, messageId, projectId and
  occurredAt: omit all four from persistence, reconstruct them only from fresh
  trusted invocation and prepared source metadata, then use restoreRawBatch to
  verify the entire canonical identity. The existing eventId commits the whole
  tuple. Do not
  replace recomputation with trusting stored content/source commitments.
- Keep issuedOrdinal independent of completed scan offset and source epoch.
  Reserve it durably before the first part is dispatched; a partially sent
  message consumes that ordinal even after a later authorized barrier.

## One locked state machine

Hold the existing process-owned stateLock through prepare, pending publication,
child dispatch, acknowledgement and state publication. The current cursor
writer's in-memory previous value is not disk CAS. Concurrent workers either
serialize or report busy without dispatch; no new claim/lease protocol.

Fresh trusted context supplies client/session, normalized source path, complete
expected local authority, Claude plugin root or Codex qualified format authority.
Detach data-only bindings before awaits. Open only that authorized source with
the existing verified Linux source opener; no enumeration or cursor-owned path.
Native Windows/macOS source capture remains unavailable until separately proved.

First explicit initialization chooses a verified complete-record boundary. Hook
setup defaults to an EOF boundary with no historical backfill. Synthetic/import
callers can explicitly choose zero. A partial EOF cannot become the start of a
new JSON record; initial partial-tail handling must be specified before freeze.

Prepare records through scanRawRecordRanges and prepareRawRecord. Freeze pending
before any capture call. First nonfinal complete acknowledgement advances only
the part; final complete advances source offset and post-record selection state.
Excluded records do not consume a message ordinal. They may advance only after
a new bounded source commitment/recheck proves the selected exclusion is stable.
The narrow producer addition must preserve the selected-path post-redaction
recheck and avoid retaining excluded text in metadata.

Fresh processes reopen and reconstruct a frozen pending source range before
dispatch. Appending beyond that range is allowed; replacement/truncation or
changed bytes within it block without progress or a replacement identity.
Recheck the source publication boundary after response before moving progress.
Historical accepted Raw is immutable evidence, not a live mirror of a mutable
transcript; do not promise to detect every arbitrary earlier file edit.

A top-level source precondition refusal does not mutate or poison the cursor:
if a later trusted invocation restores the original inode, completed anchor
and exact pending commitment, it can resume that SAME event/ordinal/cooldown.
Identical bytes on a replacement inode do not establish that authority.
An in-progress proved pending-range mutation instead persists source_changed
and is not automatically cleared by restoration or reinitialization. This
distinction is recovery of unchanged authority, not a new reset/rearm interface.

Use one bounded host deadline including preparation and process work. B4a's
budget must be the remaining budget, not a fresh155seconds per part. Preserve
its teardown reserve and actual reaping. Do not charge another host-side usage
permit: only B3's existing per-model-port accounting can consume model usage.
The frozen final contract will select a finite record/part cap and whether one
prepared message is reused for several parts during an invocation.

## Outcomes and bounded recovery

| Observation | Durable effect / next work |
| --- | --- |
| Matching complete reply and normal child exit | Advance only that exact part; advance record/selection only at final part. Preserve explicit Raw skipped dispositions rather than claiming saved coverage. |
| Processing202 | Keep pending and offset; no immediate retry loop. A later eligible invocation can observe only the identical event under the policy below. |
| Uncertain abnormal/lost reply | Keep exact pending; never allocate replacement event/session or advance. A returned B4a call reaps its child; parent-crash recovery cannot assert that and uses the exact-event policy below. |
| Known no-PID/not-started error | Keep the same pending; surface unavailable. A later invocation may attempt that same pending after environmental repair. |
| Confirmed interpretation_incomplete | Mark visible blocked interpretation, keep Raw receipt and pending identity; no automatic reinterpretation, credential-based retry, quota reset or replacement ID. |
| Confirmed quota/authority/deletion refusal or source mutation | Preserve pending and finite content-free reason. No silent skips, reset or treating normal exit as completion. Malformed/mismatching replies follow the uncertain transport row, because B4a cannot distinguish them from lost replies. |

Recovery policy: only on a new external invocation with the same pending
identity; at most one recovery submission per invocation and three recovery
submissions for that event after its original dispatch. Persist count and
eligibility before dispatch so a crash cannot erase them. Before dispatch use
startedAt+280000ms (155000 work budget plus125000 core lease); after observed
child close use max(lastAttemptAt,closedAt)+125000ms. A wall-clock rollback never
makes eligibility earlier. No wake-up timers, polling or internal retry.
These times are conservative cooldowns, NOT proof an orphan has terminated.
Safety after parent death depends on the core's exact-event transactional
registration/admission fence: an already registered event only observes
completed/processing/incomplete; it cannot reacquire interpretation. If no
registration ever committed, recovery may acquire the first interpretation.
Do not falsely claim every same-ID submission is observation-only or keyless.
After the cap, remain visibly blocked. Confirmed interpretation_incomplete is
not retried. Test both parent-death cases and an orphan whose claim is still
live; never infer its death from a timestamp or generate a replacement ID.

Changed supplied authority/generation alone may not clear pending. The current
engine closes old tails only on a real capture barrier/tool-off; Raw notice
changes are different. Minimum B4b behavior is a visible authority block with
high-water/pending retained. Explicit rearm under verified engine barrier plus
preserved ordinal is required in the later host/control integration, not an
automatic setter hidden inside the worker.

## Required acceptance before delivery

1. Two actual client layouts, long Unicode and secrets crossing part boundaries:
   exact whole-message redaction and source reconstruction through real core.
2. Fresh-process restarts before dispatch, after server commit/lost ACK, and
   after partial/final publication: exact identities, once-only progress and no
   duplicate Memory or extra provider usage on replay/continuation.
3. Actual concurrent workers: one pending publisher/dispatcher; killed owner
   recovery uses unchanged pending and known liveness, not guessed expiry.
4. Complete, processing, quota, incomplete, malformed, abnormal-exit and
   no-PID outcomes produce the exact state table; recovery cadence/cap survives
   restart and never resets usage or reinterprets a registered failed event.
5. Key/cursor loss, foreign binding, stale authority, inode replacement,
   truncation, in-place pending mutation and malformed state refuse without
   invented session/ordinal reset. Append-only growth remains usable.
6. Claude own-skill state survives excluded records and interrupted long parts;
   stable exclusion commitments reject a concurrent source rewrite. Codex
   qualified creator/header checks remain authoritative on every invocation.
7. Every persisted state/claim/lock/error is inspected for content/path/raw
   session/key sentinels. Strict permissions, symlinks, malformed structures,
   cancellation and all failure paths leave only expected durable state and no
   temporary plaintext/process residue.
8. Installed archive includes independently derived producer/worker closure
   and executes fresh processes with no source-tree fallback. Both supported
   runtimes pass affected gates and primary acceptance; Node20 pure import and
   unchanged hosted defaults are tested separately. Independent fixed-SHA dual
   review and latest-head CI gate ready/unmerged delivery.

## DRI choices to carry into the frozen contract

Use two explicit operations: initialize a session at an authorized boundary,
then run bounded work for that initialized session. Both require fresh trusted
context; ordinary run never initializes, repairs or resets established state.
Normal initialization chooses EOF and requires either an empty file or a final
newline. A partial EOF returns waiting-for-boundary without claiming armed or
captured; no parsing of a later suffix as a fresh record. Explicit synthetic or
import initialization may choose zero, never implicitly from missing state.

One invocation processes at most64 complete records and32 transport parts under
one155000ms wall-work budget including lock/preparation/reaping. Reuse the
prepared whole-message handle while sending its next parts within that budget;
restart reconstructs it. Stop before dispatch if less than B4a's3000ms minimum
remains. Expose bounded remaining-work, not an unbounded drain/background loop.

Keep the cursor below65536 serialized bytes with a closed DTO and finite enums.
The root key commitment is established/read under a short root lock before
per-session work; never hold the root lock during capture. The immutable
session claim is created before its first mutable cursor and includes no raw
identity. Hold one per-session lock across all work and use the existing atomic
private writer. Do not infer CAS from a caller-supplied previous state.

Scope B4b to source continuity, not source-reset recovery: same opened inode,
nonshrinking frozen range and the pending source commitment must match. Appends
are allowed. After each response, verify the same authorized source still
matches the publication boundary before advancing. This is intentionally
conservative; failed proof preserves pending for replay, never drops data.
Already completed historical prefix is not rehashed on every hook. A bounded
keyed anchor near completed offset detects ordinary replacement/truncation;
limits and stronger pending-range checks must be explicit in the final API.

Use wall-clock timestamps only for persisted recovery eligibility, and monotonic
time for one invocation's deadline. Backward wall-clock movement never makes an
attempt eligible early. Tests may control time in an owned test process, but
production must not gain a bypass/instant-retry option. Three observation
or first-acquisition recovery attempts after the original uncertain/processing
dispatch is the maximum;
counter publication precedes each observation and is not reset by credentials,
restart, new source appends or a changed config path.

Closed field names and source-byte bounds below are frozen against the actual
imports and read-only author preflight before implementation dispatch.
These are DRI engineering choices within the agreed scope, not requests for
new user permission. Pause/resume barrier rearm and operator recovery remain
explicit downstream work rather than an undocumented B4b reset escape hatch.

Read-only independent preflight: GPT6.1Sol/high, committed B3 base5817869,
confirmed raw-journal excludes epoch from conversation identity and requires
strict ordinal continuity. Existing Codex boundary(newEpoch) must not be copied:
it resets initialCursor and would conflict with local Raw high-water. Both
primary and independent audit agree on visible blocking rather than inventing
recovery for lost state, changed source or confirmed interpretation failure.

Primary pre-implementation evidence: `next-exclusion-red.test.mjs` runs through
the actual existing parser/selector, not a mocked planner. Node22.16 owned
runner exits1 with0/2 passing: a stable excluded record has no sourceIdentity,
and a changed same-length ignored record is not rechecked before returning
excluded. This is a missing prerequisite for future durable progress, not a
failure of B4a's frozen transport contract. No producer/runtime file is changed
in B4a to fix it; retain this expected-red roster for B4b's narrow addition.

Final preflight refinements from actual imports:

- An EOF initialization of Claude cannot assume the previous turn was not the
  plugin's own skill. Start with selection ownSkillTurn=true and an explicit
  awaitingUserBoundary flag. The existing policy clears it at the next
  non-machine user boundary, including an empty-text user record; that empty
  record remains excluded rather than captured. Excluded assistant/machine records can advance
  with verified commitments but cannot become captured conversation. Explicit
  from-start initialization begins with ownSkillTurn=false. State and result
  must explain the initial boundary, not pretend a known own-skill history.
- Bind source inode/device with a keyed fingerprint, not a path or unkeyed raw
  identity. Keep a keyed anchor for at most4096 bytes immediately preceding the
  completed offset; empty offset has a distinct empty anchor. Verify it after
  reopening, and re-open the freshly authorized path before publication to
  detect replacement of the open inode. Changes earlier than that anchor are
  outside the historical-prefix promise. Pending ranges still require their
  complete source commitment on restoration and before advancing.
- Fixed work limits:64 completed records,32 dispatched parts,155000ms total;
  at most32MiB scanned source span per invocation and32MiB per record,128MiB
  total source bytes read including repeated commitment/header checks. Use
  existing bounded streaming/scratch helpers, never readFile for transcripts.
  Exhausted budget preserves pending/progress and reports bounded work remaining;
  a single record beyond the record ceiling reports a visible record-limit block,
  never silently skips or loops claiming progress. Partial actual EOF waits for
  a newline. Test exact limits and avoid confusing a budget slice with real EOF.
  These are ceilings, not a guarantee32 parts fit. Before dispatch reserve at
  least the full range length plus65537 Codex-header bytes when applicable and
  8192 anchor bytes for publication proof. If it cannot fit, persist prepared
  pending and return work remaining BEFORE dispatch. A fresh pending invocation
  skips scanning and reconstructs that one range. Never spend an attempt merely
  because the ACK's required proof was predictably over budget.

## Frozen API/state decisions to transfer to the tracked plan

New internal-library entry `createLocalRawWorker(options)` in
`integrations/client/raw/local-worker.mjs`. Closed trusted constructor options:
`stateRoot`, `identityKeyPath`, and B4a's `nodeExecutable`, `runtimeRoot`,
`configPath`, `expectedAuthority`, `home`, optional `env`. No transport injection,
clock bypass, caller-selected work limits or arbitrary subprocess argv. Native
signal handling and data-only detachment follow the existing local boundary.
All roots/config/runtime paths are explicit, not discovered from HOME.

Return two operations: `initialize(context,{signal}={})` and
`run(context,{signal}={})`. Context always has `sessionId`, `sourcePath`,
`pluginRoot`, `formatAuthority`; initialize alone also permits `start`, either
`eof` (default) or explicit `beginning`. Client comes from the frozen authority.
Claude requires a normalized absolute pluginRoot and null formatAuthority;
Codex requires null pluginRoot and the existing exact qualified format DTO with
the same sessionId. Validation is required even when the source is empty.
Codex header qualification runs every invocation, including EOF/no-work runs.

The source is freshly authorized by the trusted caller, not by a path found in
cursor state. Check the private config snapshot/full expected authority before
opening it. This library does not independently turn on capture or query a new
permission database. B3 still enforces durable controls before provider/write;
later host entrypoints must obtain fresh local-control authorization before
supplying a transcript. No automatic client is enabled by this packet.

The dedicated private stateRoot and identityKeyPath must already exist. Key file
is exactly64 lowercase hex characters, optionally one trailing newline, mode0600,
representing32 setup-generated bytes; never repair/generate it here. Explicit
initialize may establish `root.json` exclusively under `.root.lock`; run requires
it. Root DTO is `{version:'local-raw-state-v1',keyCommitment}`. Use a private
`sessions` directory with opaque HMAC basenames for claim/cursor/lock. Claim DTO:
`{version:'local-raw-claim-v1',sessionKey,wireSessionId,keyCommitment}`. Claim is
immutable. A present claim with missing cursor, or orphan cursor without claim,
blocks; initialization cannot reset it. Repeated identical initialization only
returns existing state, never moves offset to a newer EOF.
If that existing cursor has a persisted blockedReason, initialize reports the
same visible block without rewriting it; idempotent setup cannot imply repair.
If root.json is absent while the private sessions directory is nonempty,
initialize refuses state_invalid rather than rebuilding root ownership. A
bounded one-entry probe is sufficient; this is not a transcript/history scan.
Replacing the key together with deleting only root.json cannot manufacture a
new wire identity over an established state directory.

Cursor DTO has exactly: `version:'local-raw-cursor-v1'`, `sessionKey`,
`wireSessionId`, `authorityCommitment`, `epoch` (zero in this packet), `offset`,
`issuedOrdinal`, `source`, `selection`, `pending`, `blockedReason`.
Source is `{identity,anchor:{start,end,commitment}}`; identity is keyed over
sessionKey and decimal device/inode, not mtime/ctime. Claude selection is
`{ownSkillTurn,awaitingUserBoundary}`; Codex selection is `{}`. No source path,
raw session/message/project identifier, event time or key is persisted.

Pending is null or `{projection,attempts,nextEligibleAt,lastAttemptAt,state}`.
Projection is the existing planner pending tuple minus exactly sessionId,
messageId,projectId,occurredAt. Reconstruct those from current trusted context
and prepared metadata before restoreRawBatch. Attempts are0..4, published before
every submission and never refunded. `state` is prepared, dispatched, processing,
uncertain, unavailable or blocked. Initial part is prepared/attempts0; each
successfully acknowledged next part is a new exact event/attempts0 on the same
reserved messageOrdinal. A known no-PID error may be tried on the next external
invocation without the uncertainty cooldown, still under the four-attempt cap.
No additional attempt occurs within that invocation after any refusal/uncertainty.
For a recovery of an existing attempt, stop after that one submission even if
it completes; the next external invocation can process subsequent work.

Validate persisted cross-field combinations before any new source dispatch:
prepared means attempts0 and null timestamps (a visible pre-dispatch source
block is legal); dispatched/processing/uncertain mean attempts1..4, finite
lastAttemptAt and nextEligibleAt at least125000ms later, without blockedReason;
unavailable has attempts1..4, finite lastAttemptAt, null nextEligibleAt and no
blockedReason. Blocked has attempts1..4 and a non-null blockedReason; its
nextEligibleAt is null after a known unavailable result or obeys that same
minimum interval. A dispatched state may already contain the observed-close
125000ms interval before classification/source proof, even though the initial
prelaunch reservation uses280000ms. Impossible combinations return state_invalid
without dispatch or cursor mutation. This is corruption validation, not protection
against an owner deliberately rolling back all private state.

Persist fixed finite block reasons, never exception prose or the whole response.
Confirmed incomplete interpretation keeps the engine's Raw receipt and local
pending identity; the cursor does not store a second response/Raw history.
Return a bounded frozen summary with version, status/reason, completedRecords,
completedParts, dispatchedParts, bytesAdvanced, hasPending, remainingWork,
nextEligibleAt and per-invocation savedParts/skippedParts. These last counts are
acknowledgements observed in this call, not new unique stored rows or model
accuracy. Source/config/state errors remain distinct visible fixed-code outcomes.

Summary version is `local-raw-worker-v1`. Closed statuses are ready, progress,
waiting, busy and blocked; successful initialize uses ready, unavailable uses
blocked. Reasons are null or initialized, awaiting_user_boundary, partial_record,
work_limit, state_invalid, key_invalid, authority_changed, source_changed,
source_unavailable, record_limit, processing, uncertain, unavailable,
interpretation_incomplete, quota_reached, recovery_exhausted, cancelled,
invalid_input, platform_unavailable, config_invalid, state_busy, capture_refused.
Invalid constructor options may throw one fixed content-free configuration code;
method input/source/state refusals return bounded blocked summaries. Never use
arbitrary exception.message as a reason. Other confirmed refusals (including
quota/authority/deletion) retain pending and visible block; automatic recovery
is only the exact-event uncertain/processing/no-PID policy frozen above. Later
host/operator recovery remains required, not an undocumented cursor reset.

B4a deliberately collapses malformed/mismatched replies, abnormal exits and
lost acknowledgements into one uncertain transport error after capture starts.
B4b cannot distinguish those causes and must not claim it can: all keep the
exact pending event and use the bounded uncertainty policy above. A confirmed
non2xx refusal with a validated fixed reason is different and remains blocked.
No B4a API expansion is part of this packet.
The invocation's own cancellation/deadline remains separately observable: use
its operation state for the returned cancelled/work_limit reason while keeping
the pending delivery uncertainty. Transport's fixed error alone cannot explain
whether the user cancelled, a deadline elapsed or the environment failed.

For publication verification add one narrow shared source-commitment helper,
`verifyRawRecordSource(input, options, expectedSourceIdentity)`, to the existing
producer, using its canonical snapshot/key/binding and bounded reader. It does
not parse/extract twice or retain content. Selected preparation keeps its current
post-redaction recheck; excluded preparation gains the same commitment/recheck
and returns sourceIdentity. Worker reopens the authorized source and uses the
helper before publishing advancement; all contexts and source bytes must still
match. This is the only intended semantic change in the existing producer.
  Use the PRE-record selection/plugin/format bindings for every verification;
  publish post-record selection only with final-record advancement. A changed
  ownSkillTurn must not accidentally change the HMAC used to verify the old range.

## Ownership and permitted files

Primary owns this plan, decisions, independently authored acceptance, final
integration, delivery and supervision. One implementation worker, actual GPT6.1
Sol/high, owns code/tests/docs below. Two independent nonauthor GPT6.1Sol/high
reviewers later inspect the same final fixed-base committed diff. No commit or
push by worker. Do not change primary worktrees or existing sibling candidates.

Allowed new modules: integrations/client/raw/local-worker.mjs and small adjacent
local-worker-*.mjs helpers. Approved existing producer edits: message.mjs for
the shared source commitment/recheck only, index.mjs for its explicit export;
existing raw tests only where this newly added excluded-source metadata affects
their assertions. Add dedicated local-worker tests/fixtures under the shared
client, and installed-worker tests/fixtures under packaging. Narrow shared edits:
packaging/artifact-files.json, package.json, .github/workflows/ci.yml,
integrations/client/test/fixtures/local-transport-import.mjs (also fence the
new worker's pure import), CHANGELOG.md, docs/limitations.md,
docs/raw-local-journal.md. Do not edit this root-owned plan without coordination.

No core/schema/provider/usage ledger/B3 CLI or B4a transport changes, no existing
hosted/v1 worker/cursor or parser policy rewrite, no bundle/setup manifests,
product source/config/pins, real transcripts or operational commands. Reuse
existing verified source opener/private state/locks. A needed shared-file or
permission expansion must be raised before editing, not silently implemented.

Explicit root-approved narrow exception (2026-10-21): shared
integrations/client/file-lock.mjs acquisition time must use monotonic elapsed
time. Existing Date.now-based250ms acquisition can become unbounded after wall
clock rollback/freeze, violating this worker's bounded deadline. First retain a
bounded owned-child reproduction with actual termination/reaping, then change
only the acquisition deadline/comparison to node:perf_hooks performance.now.
No ownership/liveness/reaper semantics, stale-age recovery, extra lock algorithm
or production clock injection changes. Do not Promise.race an uncancelled lock
that could later acquire and write. The initial requirement to keep the generated
Claude lock unchanged was superseded by the explicit reproducibility correction
recorded below; no hosted capture/recall policy changes are permitted.
New regressions must have an explicit package/CI roster; additionally exercise
shared/pairing/golden, Codex and setup consistency on the final candidate.
Retained reproduction: author-lock-monotonic-red22.log contains3 cases,
normal-clock control1pass and frozen/rollback2fail, actual exit1; outer12025
reaped. Each unsuccessful owned probe exceeded its50ms acquisition window under
500ms supervision, then was terminated/reaped before scratch cleanup. Primary
read the test and log before accepting the three-line monotonic correction.
The affected pairing roster then reported three explained test-contract
failures: its virtual lock clock mocked Date.now but not the new monotonic
clock, and its audited-owner guard did not yet recognize the new private worker
state module. Root approved ONLY test-side alignment in
integrations/client/testing/lock-contention.mjs (advance/restore mocked
performance.now with the same logical elapsed time, retaining20/30ms assertions)
and integrations/client/test/pairing-guards.test.mjs (one exact audited owner,
not a broad directory or weakened matcher). Old Claude cursor behavior stays
unchanged. Preserve these red logs and rerun the affected roster.

Root's direct integration inspection found that the setup package also keeps a
tracked generated copy of the shared lock and rejects stale copies at prepack.
An explicit two-file exception therefore permits synchronizing ONLY
packages/setup/runtime/integrations/client/file-lock.mjs and its one digest in
packages/setup/runtime/manifest.json. Retain the focused build-runtime --check
failure, then require the full inventory check to pass. This does not add Raw
to the released setup bundle, change a package version/launcher/hook, update the
separate Claude lock, publish a package or enable any client. Include both paths
in final delivery inventory and rerun setup/hosted compatibility checks.

Final-matrix correction: the first five gates passed, but generic gate6 on
Node22 exited1 (635 tests,634 pass,1 failure). The sole failure was
client_bundle_stale:file-lock.mjs. Root reproduced it with the minimum command
`node tools/testing/run.mjs --script integrations/client/bundle.mjs --check`,
actual exit1, and inspected the generator and exact source/copy diff. This is a
deterministic generated-file mismatch; broad hypothesis/instrumentation loops
are unnecessary. The required generated output is the unchanged banner plus
the shared module's three-line monotonic correction. Root authorizes ONLY that
synchronization in plugins/cairn-memory/lib/file-lock.mjs, superseding the earlier
copy exclusion. Do not weaken the bundler, add an exemption, change versions,
change module inventory or alter capture/recall/pause algorithms. Correct stale
documentation claims, preserve the failed matrix and create a new frozen
candidate/verification record. The actual outer failure was reaped with exit1;
inner/outer owned roots were removed and the original source snapshot remained
unchanged. Nothing was pushed or released from the failed candidate.

An additional actual-held-root/session-lock cancellation reproduction failed
0/2, actual1: the worker returned busy after its own signal had cancelled.
The approved worker-only correction checks its operation state in the outer
catch before choosing the fixed result reason; focused correction passes2/2,
actual0. This is not cancellation or expiry of someone else's lock.

## Verification sequence

1. Trace actual callers/imports and state transitions; record the proposed
   focused test roster before running it. Reproduce the retained excluded-source
   two-case red through the actual parser. No invented semantic quality claims.
2. Implement in bounded milestones: state/identity/initialization plus exclusion
   proof; then dispatch/progress/recovery; then installed closure/docs/CI. Report
   each meaningful milestone with actual changed files and remaining risks.
3. Focused tests exercise both real client formats, public worker state, actual
   subprocesses and the real Raw/core admission path with fake HTTP. Frozen
   crash/recovery time manipulation is allowed only in an owned test process,
   never an exported production clock or bypass. Inspect all persisted metadata.
4. Before a final matrix, freeze exact changed-file inventory with two independent
   routes, complete source hashes, dependency identity and an exact command roster.
   Primary approves the risk-proportional matrix. No source edits while it runs;
   stop on failure, keep logs, diagnose before another correction.
5. Both Node22.16/24.15: focused worker/producer, B4a transport/B3 adapter,
   artifact, Codex/client regression, generic validation, owned-workspace
   lifecycle and bundle/setup consistency. Existing core/MCP/provider bytes are
   unchanged; retain their accepted evidence only after proving source/dependency
   identity, and exercise real core through new integrated/installed cases.
   Current CONTRIBUTING/CI may require an affected additional gate; identify it
   before final freeze. No full paid or semantic benchmark.
6. Primary personally inspects the entire diff, runs its separately authored
   final acceptance and the installed worker on the final candidate, checks
   content identity after commit, then requests fixed-SHA independent dual review.
   Latest-head CI, actual Node20 pure import, clean exact merge preview and
   consistent remote metadata gate ready/unmerged delivery. Do not merge.
7. Success/failure/interruption fixtures clean only their newly owned scratch.
   Keep expected durable test state until assertions, then close children,
   handles and workspace; report actual exit codes. No historical /tmp sweep.

## Preimplementation evidence and continuation record

Evidence directory: /tmp/cairn-raw-b4b-evidence.bCGvYn.
The prior expected-red exclusion probe and planning history remain at
/tmp/cairn-raw-b4a-evidence.s8eoux/next-exclusion-red.test.mjs and its recorded
actual exit1 (0/2). This is a missing B4b prerequisite, not a B4a regression.
The initial contract preceded implementation. No live API spend.

Primary independently froze a separate12-case initialization acceptance roster
before accepting the author's first milestone. It covers both client formats,
explicit beginning/EOF, idempotent init without skipping new appends, missing
established cursor, Claude's user boundary, partial EOF, rotated identity key,
authority mismatch, proxy/pre-abort and real Codex header validation. Evidence:
`primary-init.test.mjs`, SHA256
`b8387864a74236ad8a5abc8ba8ffec0e6784eb63716a1aa240b1d720650ce821`.
Syntax check actual exit0; no behavioral result is claimed at this point.

Milestone1 acceptance (2026-10-21): actual GPT6.1Sol/high implementer completed
identity/state/initialization and the excluded-source commitment/recheck. The
public run operation still had an explicit placeholder at this checkpoint;
none of these results establish dispatch, recovery, installed delivery or V1.
The retained exclusion baseline failed0/2 before the producer addition, then
passed2/2. A newly found missing-root/nonempty-sessions case was recorded red
before the smallest fail-closed correction; no root/key repair is introduced.

Author focused28/28 checks on each Node22.16/24.15 exit0. Primary personally ran
the separately frozen12 initialization cases on each runtime: both actual0,
null signals; outer runner94660 exit0. All1806 source hashes/modes were unchanged
before/after; the owned workspace is absent. Evidence:
`author-milestone1-freeze.json`, author9-path aggregate
`2a421d0f1ffb8a92d6aef48a66a4761dbf7ec50e3c2206e92df369f0f4e27554`,
and `primary-milestone1-init-report.json`. Author inventory cross-check agrees
on9 code/test paths (10 including this primary-owned plan). Dependency identity
remains the accepted18-entry B4a set. No active test process remains.

Primary also froze8 independent progress cases in `primary-progress.test.mjs`
before M2 implementation: both real client formats, whole-message redaction and
parts through actual local/core storage, fresh-process no-op/append, committed
Raw+Memory with lost ACK and keyless identical-event recovery, incomplete
interpretation without retry, pending source mutation, no-PID repair preserving
identity, authority drift and two actual concurrent workers. These use synthetic
private fixtures and blocked network/fake HTTP, not live provider calls. Syntax
check actual0; they have not yet been run against a dispatch implementation.
Before the first progress run, primary changed only its test harness to wrap
each fresh invocation in the existing owned runner, so failure cleanup reaps
descendants before removing fixture files. The eight acceptance scenarios are
unchanged. Current test SHA256:
`2658dbf56e8031d7ee5b9a8f2ab0e923a807ddfbfc1ed1595add70056474b888`.

Primary inspection also identified an uncertain-publication hazard to test:
privateWrite may publish a new cursor and then report a failure. A catch path
must not overwrite that disk state with the older in-memory cursor, refund a
reserved ordinal/attempt or resurrect completed pending work. The local worker
must refuse further writes after an unverified publication outcome, or reread
and validate the actual state under its existing lock. This does not authorize
changes to the shared private-state helper. A zero-attempt prepared pending
must also admit a visible source block without making its closed DTO invalid.
Primary froze three separately authored cases using the existing postpublication
observer, `primary-publication.test.mjs`, SHA256
`51acf5918f2c1e5bbc647bc1f62933d359794c324d94c0182f1b534b480ce4be`.
Syntax check exit0; behavioral validation remains pending. Their fake CLI tests
state publication only, and will not be counted as real-core storage evidence.

Milestone2 basic acceptance (2026-10-21): author10/10 focused cases pass on each
Node22.16/24.15, actual0; the owned-descendant runner also passes10/10 on each.
Temporary frozen author12-path aggregate:
`3202ab41b8ba1b1cd8ab79534575d915ee879e35baad1f8eccff233cf15f718a`.
All1809 source hashes/modes and the18 dependency identities remained fixed.
This is an intermediate checkpoint, not the final code/packaging matrix.

Milestone2 converged acceptance (2026-10-21): author71/71 focused cases pass on
each Node22.16/24.15, both actual exit0/null signal; sessions39845/34212 were
reaped with exit0. Author19 changed paths were cross-checked through Git status
and an independent full base/current blob-and-mode comparison; aggregate SHA256
`32dd39ed050c1645df380b5fc29289c7754ed79ae95e0f30d4269d8a9d5e241f`.
The normalized1812-file source snapshot excludes both primary-owned plan files;
its aggregate is
`6a5744bf19fcd5a704df1289181b87428f69ffd7cbd961dc30cd1e995f178545`.
Before/after source identities and18 dependency identities match; no owned
runner/fixture scratch directories remain. Packaging/import/CI verification is
the next milestone, not covered by this result.

The focused roster includes actual core/storage, lost acknowledgement/keyless
recovery, stopped parents and a live registered orphan, concurrent invocation,
source-mutation checks, cursor-publication faults and resource bounds. The
processing/quota/malformed-reply policies also include synthetic reply-only
fixtures; these are not additional real-core or semantic-quality evidence.
Seven malformed persisted-state cases plus one legal control first returned
1/8, actual exit1; the corrected cross-field validator now rejects impossible
pending states before any dispatch and keeps valid blocked/prepared states.

Milestone3 focused installed acceptance (2026-10-21): author2/2 on EACH runtime,
actual exit0/null signal; sessions78689/51153 reaped0. Each client exercises six
fresh worker invocations (initialize, lost acknowledgement, early cooldown,
keyless same-event recovery, continuation and no-op), exact three-part Unicode/
redaction reconstruction, one Memory and three model-port usage reservations
consumed with none outstanding. The153-file static module/asset closure equals
the independently observed installed import/read closure. Pure-import checks
also exit0 on both local runtimes; Node20 is CI-only. All provider responses are
synthetic; this does not establish semantic quality. The setup-copy check first
exited1 on the stale lock; the approved exact two-file synchronization makes the
full generated inventory check exit0 on both runtimes. Final affected matrix,
primary reruns and committed independent dual review remain required.

Final precommit candidate freeze: author30 paths (32 including both primary
plans), SHA256
`6d17ac91a0b6f85d7f83a8b21a51161f5a779f551ccb95d8e05c6850fe130c19`;
source1814 files, SHA256
`a7dde9a44a85fd910844b4cb6369753b73e911a443905d18440293cfbbfbb10d`;
18 dependency identities retain
`2dd9ce0eac23ef27043d2495234848fd2846a715a3779c9c22f4190beb0c1fe0`.
Primary personally reran independently authored initialization12, progress8 and
publication3 cases, plus the author's installed2 and monotonic-lock3 cases,
on BOTH runtimes. All ten commands returned actual0/null signal, all five
owned roots were absent afterward, and full source path sets/hashes/modes stayed
fixed. Reports are primary-final-{init,progress,publication,installed,lock}-report.json
under the evidence directory. The last two suites are personally executed, not
independently authored. No new red occurred in these final primary runs.

Corrected V2 precommit freeze after the generated Claude lock synchronization:
author31 paths (33 including both primary plans), SHA256
`7a5288aa668996b94cb773feaad822c2dd28c013f1818dd6414d240ca5610335`;
source1814 files, SHA256
`825bce971eb42158c7d95edd7fffddec0e1dc794e562be4b29131997f9766685`.
The18 dependency identities are unchanged. Primary reran all five acceptance
kinds on this exact V2 source: initialization12, progress8, publication3,
installed2 and monotonic-lock3 on EACH runtime. All ten commands returned
actual exit0/null signal, all five owned roots were removed, source inventories,
hashes and modes remained fixed, and all outer processes were reaped with exit0.
Reports: `primary-final-v2-{init,progress,publication,installed,lock}-report.json`.
The corrected38-gate serial matrix is separately supervised; these primary
results do not predeclare that matrix or committed reviews complete.

Supervisor recovery (2026-10-21 18:23 UTC): the agent daemon restarted and its
previous author/reviewer sessions disappeared. Primary inspected the still-live
outer45823/matrix45864 processes, original command identities and continuing
gate35 log. The matrix itself was not restarted;34 completed gate receipts had
actual exit0/null signal. A fresh full snapshot exactly matched V2 source and
dependencies. Primary took over direct observation of progress, completion and
owned cleanup. The old tool session47481 cannot be reattached, so its final
tool-level exit must not be fabricated; actual child exits and the supervisor's
durable final reports will be recorded separately. New independent reviewers
will receive the exact committed candidate after the matrix finishes.

Final V2 matrix completion (2026-10-21): all38 frozen gates completed in their
original order,19 on each Node22.16.0/24.15.0, actual exit0/null signal. Required
counts per runtime: worker59, transport34, local30, generic635, workspace25,
Codex198, shared client5, Raw producer38, pairing270 and setup398 all passed;
artifact107 comprised106 passes and one explicit native-Windows skip on Linux.
The pure import, validators, demo, bundle/setup checks, golden comparison and
52-file setup archive checks also returned0. Node20 remains latest-head CI work.
Inner and outer durable supervisors both report code0, the inner child's actual
close was0/null and no interruption was recorded. Both owned workspace roots
are absent and the original45823/45864 processes are absent. The lost pre-restart
tool session's exit is still unavailable, not inferred from those reports.
Primary checked every gate against the frozen roster and rederived the entire
1814-file source/dependency snapshot: exact V2 hashes above, unchanged. The
33-file delivery inventory agrees between Git diff plus untracked, Git status,
and the independently derived31 author paths plus two primary plans. Evidence:
author-matrix-v2-{results.jsonl,report.json,outer-report.json,outer.log}.
No matrix gate was rerun after daemon recovery. Local candidate commit, primary
committed key-path reruns and two fresh nonauthor reviews follow this checkpoint.

Root inspected and approved author-matrix-plan.json:38 serial gates,19 per
runtime, with actual exit/signal/TAP counts,30-second progress observation,
20-minute child/90-minute overall ceilings, stop on first failure, and exact
source/dependency comparison. Inner deliberately retained scratch must never
be erased by an outer supervisor. The setup-pack harness's initial wrong npm
path failed before package behavior; the retained tooling correction resolves
the pinned npm executable and its focused check exits0, comparing all52 files
through package manifest traversal, npm JSON and tar inventory with prepack
enabled. This correction does not change candidate source.

Primary's initial progress run was6/8, actual1. Both failures were SECOND
independent messages after a successful long-message write, keyless no-op and
append. Two bounded diagnostic runs retained0/2, actual1 each. Actual fake-HTTP
wire showed the fixture always extracted identical content for different source
receipts; this triggers the EXISTING qualification_conflict guard in
core/claim-qualification-storage.mjs, also specified by the core's qualified
dedup tests. It was not a missing provider port and no runtime code was changed.
Primary corrected the synthetic extraction to return the second independent
content and strengthened acceptance to require two stored memories. The original
failures/logs remain; do not present this as a product dedup fix.

Corrected primary progress8/8 and publication3/3 pass on BOTH runtimes, all four
actual exit0/null signal; outer progress session53260 reaped0. Workspace removal
was verified. Evidence: primary-milestone2-progress-corrected-report.json,
primary-milestone2-publication-report.json. Corrected progress test SHA256:
`3e34640d94839266b7ea13fd1faf8228f24c0cdcc8bcbad3bb6a3b14b0036b72`.
Publication tests retain the above frozen SHA. The publication fixes preserve
newly published pending/progress after a postpublication failure, forbid stale
corrective overwrite and allow a visible block on zero-attempt prepared state.
Cancellation reports its actual operation reason while retaining uncertainty.
The temporary freeze was released only after source identity and cleanup checks.

Known separate product limitation: identical qualified content from different
source evidence currently refuses the later admission instead of silently
replacing its original anchors. In local capture this is visible incomplete
interpretation with retained Raw. A coherent future duplicate-evidence policy
is required before claiming repeated user facts are handled smoothly; do not
weaken provenance checks or change core/schema inside B4b to hide this limitation.
Likewise actual B3 per-model quota denial currently surfaces503 incomplete;
a synthetic429 test only establishes reply handling, not actual quota behavior.

An independent read-only GPT6.1Sol/high core preflight confirmed that S3
deliberately prohibits different qualified evidence through exact dedup. It
identified an existing ordinary-receipt attachment path that preserves original
qualification and lineage. Candidate direction for a SEPARATE core follow-up:
explicit opt-in policy, exact content plus all seven descriptor values equal,
incoming anchors fully validated, only ordinary receipts added while original
qualification/anchors/revision remain unchanged. Conflicting descriptors,
case-only fingerprint collisions and unqualified targets still refuse. No new
field-level qualification verdict or adoption authority is implied. Default S3
tests/behavior remain; no code for this follow-up is in B4b. Existing deletion
conservatively clears qualification after any supporting receipt removal and
must be reflected in that follow-up's deletion/forget/replay/concurrency tests.

Next-packet read-only preflight (actual independent GPT6.1Sol/high) found two
concrete integration constraints. Released setup copies only flat client/Codex
modules, not the nested Raw/core/adapter closure; the existing Codex installed
worker also applies a hosted-specific62.5-second guard, shorter than this
worker's155-second budget. Do not silently branch local work through those
released hosted entrypoints. A separate opt-in private-artifact foreground
host/setup entry is the next coherent subdelivery, not completed automatic
Claude/Codex hooks or the installed lifecycle. Actual owned host configuration
and launcher integration remain required after that seam is accepted.

The next host must check durable consent BEFORE opening a transcript, including
before Codex sessionSource reads its header. B3 configuration preflight verifies
file/app/schema/store/cap but not current consent. Its read-only SQLite handle
can reuse createLocalAuthorityStorage(db).check under one read snapshot, with
the existing canonical authority validator. Do not authorize source reads by
opening a writable/migrating core. Claude captureEvent is tuple parsing, not
source authority; installation fixes pluginRoot and a trusted registered caller
supplies the one source grant. Reuse qualified Codex host/session checks.

Explicit rearm remains a real missing primitive, not a refreshed JSON config.
It must preserve immutable claim/issued-ordinal high-water and prove an actual
SQL capture barrier before discarding an old tail. Raw journal order is strictly
increasing, not necessarily gap-free; a closed capture_barrier/tool_off tail
permits a new higher ordinal, whereas a merely changed notice does not establish
that permission. No new rearm/reset code is implemented by this B4b packet.

A second independent read-only preflight narrowed that future rearm further:
the public conversation's aggregate reasons cannot prove the exact pending
message's closure. Trusted engine-local inspection must check the bound
raw_messages row, its closed capture_barrier/tool_off reason and released
reservation. Session deletion/fenceSession is not a rearm mechanism because it
permanently fences future capture for that session. Raw closure also does not
prove interpretation completion: the minimum later subset must refuse unresolved
first-part/processing/incomplete interpretation, not silently abandon it. Preserve
claim/wire identity and ordinal; a bounded content-free rearm intent must freeze
the original chosen EOF so a crash/retry cannot skip a newer suffix. These are
follow-up requirements, not implemented or passed B4b capabilities.

Step4 preflight also found a real Raw-enabled MCP/read-review seam, not just a
missing end-to-end test. Current private-card MCP and terminal review openers do
not enable Raw conversation reads; their source/draft schemas cover ordinary
receipts/notes and Memory references. SDK Raw lineage tests therefore cannot be
claimed as installed full-Raw Card/MCP proof, and excerpt-only Cards cannot
substitute for the agreed full-Raw requirement.

The bounded follow-up is a shared, explicit local-config read opener for MCP
and terminal review: existing schema29/store/namespace validation, disclosed
local plaintext Raw reads with readPolicy, no capture/cap administration,
provider calls or migration. Retained-source read permission is distinct from
capture consent. Reject conflicting database/owner/project configuration; add
bounded Raw anchor/reference schemas, scoped resolveSourceReferences and paging,
and truthful source/capability reporting. Terminal approval must bind the same
store/scope/policy and exact revision payload; MCP confirmation still requires
that independent approval.

Installed lifecycle acceptance will reuse, not substitute for, the actual
worker: Raw plus qualified Memory without automatic Cards; whole-message Raw
resolution and an explicitly authored Card (also a bare Raw source with zero
Memory/model calls); terminal approval; fresh MCP reads; isolated correction,
forget and Raw-deletion branches followed by cold reopen. Invalidated drafts
must disappear, unsupported confirmed content must remain historical only,
current reads and old source/snapshot references must fail safely, and foreign
scopes must reveal nothing. Verify replay, usage stability, archive closure and
owned cleanup. This supplies functional lifecycle evidence, not semantic
T01-T03 results or actual installed Claude/Codex host activation. The parallel
readTopicOverview packet currently supports schema18/20-23 only; its schema24-29
compatibility is another explicit integration gap before claiming a combined V1.

Maintain the agreed checkpoint window: this continuous work segment resumed at
2026-10-21 14:00 UTC; the owner's12–18-hour discussion window begins
2026-10-22 02:00 UTC and ends08:00 UTC. Do not leave unmonitored processes when
pausing. Routine progress updates do not end the turn or wait for user decisions.
