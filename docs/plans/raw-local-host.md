# B4c: explicit local host permission bridge

Status at candidate freeze: revised final matrix42/42 passed on both runtimes.
The first matrix's static namespace-owner failure is retained below. Primary
committed-candidate acceptance, independent dual review and latest-head CI are
delivery gates; their final SHA/results belong in the accompanying PR evidence.
Fixed base: 96fd4c64e719427e594b7600702294f7313e88e2 (B4b candidate).
Worktree: /home/chichieh/Github/cairn-memory-worktrees/raw-local-host.
Branch: feat/raw-local-host. This is a dependent branch; B4b must pass final
review/CI before this packet is delivered. No merge is authorized.

## Goal and boundaries

Keep one lightweight Raw / Memory / authored Card engine. Turn the B4b trusted
worker into a foreground, explicitly owner-operated private-artifact entrypoint
which checks actual durable capture permission before opening a transcript.
This is part of step3 in raw-local-v1-completion.md, not finished V1 or automatic
Claude/Codex hook installation. Product still owns presentation, not this engine.

Only synthetic local development/tests, isolated commits/push/PR are authorized.
No user transcripts, live home/config/DBs, provider calls, operational migration,
merges, publication, deployment, product pins/flags or real client activation.
No hosted entrypoint rewrite, new usage ledger, schema change, automatic Cards,
detached daemon, polling, hidden retries or reset of old state.

## Foreground entry and trusted binding

Expose status, prepare, initialize and run through a private installed CLI and
an importable host API. Derive Node executable from process.execPath and runtime
root from installed module location; a profile or hook input may not override
them. Do not borrow the hosted62.5-second launcher for B4b's155-second work.

The owner supplies one private, closed versioned profile, binding:

- configPath plus exact SHA256 configDigest;
- stateRoot, identityKeyPath and private home;
- client-specific installation metadata: Claude pluginRoot or the existing
  Codex qualification-cache configuration location.

The existing digest-bound B3 configuration alone determines store, target,
namespace, client, generations, provider and usage. No JSON can grant source
authority, override executable/argv, inject test dependencies or bypass consent.
Initialize/run accept only an explicit owner-selected absolute source path and
session. Initialize defaults to verified EOF without historical backfill; any
explicit beginning option must be named and documented as owner-selected import.
No stdin hook/MCP input or native-hook attestation is implied by this CLI.

Status must not open a transcript, discover sessions, call a model, write SQL,
generate qualification or create/repair state. It may report content-free
readiness/refusal based on the explicit profile and installation.

Prepare alone creates new owner-only installation key/state and a durable
preparation marker. Repetition succeeds only for the complete unchanged identity.
Partial creation, missing established key/root/marker, foreign binding and
changed authority refuse. It grants no SQL capture consent or Raw notice, and
never repairs existing B4b cursor/session state. Serialize competing preparation;
freeze creation/publication ordering and interruption behavior before code.

Installation key validation is necessary; a model-provider key MUST NOT become
a new up-front requirement. Preserve B3 lazy credentials and completed/keyless
replay. Synthetic tests provide fake HTTP only and never read owner credentials.

## Consent before source access

Validate the profile, runtime and digest-bound configuration. Open only an
existing permission-safe schema29 SQLite store in read-only mode. Under one
read snapshot, check application/schema/store/cap and current local authority
with createLocalAuthorityStorage(db).check(config.authority, namespace, client).
Close without setters, writer reservation, migration or openMemoryCore adoption.
B3 structural preflight alone is insufficient because it does not check consent.

The successful snapshot must precede every first transcript/header read. Recheck
authority immediately before invoking B4b, then retain B3 transactional checks
at registration/publication. A later in-flight revocation wins those fences;
SQLite and filesystem reads are not one atomic operation and already-read bytes
cannot be unread. Permission to capture and permission to read retained Raw are
different: this packet introduces only the capture-side bridge.

No unavailable prerequisite should be bypassed by falling back to the hosted
pipeline, a writable core, new identity or caller-supplied permission flag.

## Client qualification

Codex: reuse detectRunningHost, boundBinary and cachedQualification. Do not call
currentHost wholesale: it writes observations and may launch detached probes.
Missing qualification or exec/automation remains unavailable. After permission,
use bounded verified session-header metadata to derive exact B4b formatAuthority.
Existing sessionSource returns source/interactive only: add a compatible helper
instead of trusting a caller's creatorVersion. Preserve hasQualifiedCreator
semantics and recheck the worker's independently opened source.

Claude: profile-bound plugin installation metadata plus explicit owner source
selection supplies the trusted caller boundary. captureEvent is only parsing,
not proof a native hook selected that source. Mismatches refuse. An untrusted
automatic-hook entry remains unavailable until a separately reviewed selector.

Synthetic ancestry/cache/source seams are code-only dependencies, not CLI or
profile options. Tests must never traverse real /proc client ancestry, user home,
client state or qualification cache. No source discovery or directory scan.

## Finite results and lifetime

Use a closed content-free host envelope with finite reason codes; successful
dispatch contains the unchanged B4b summary, not a fabricated saved/complete
claim. Distinguish invalid profile/preparation, absent runtime/permission,
changed authority, unavailable/unqualified host or source, busy/waiting, and
unexpected sanitized failure. Never serialize paths, session IDs, provider keys,
source text or raw exception prose. Freeze exact DTO/CLI exit mapping before code.

Set one finite invocation deadline covering host preflight and worker dispatch.
Cancellation/deadline must await owned child teardown and preserve B4b pending
identity/cooldown. No same-invocation recovery loop. B4b's confirmed incomplete
interpretation and authority blocks remain visible; this bridge does not rearm.

## Observable acceptance

| ID | Required evidence |
| --- | --- |
| H1 | Disabled/absent/mismatched store/target/namespace/client/generation, invalid private files or unsupported runtime refuse with actual source-opener and dispatch counts zero. Do not infer this from return status alone. |
| H2 | Status is nonmutating; prepare is serialized and idempotent only for a complete valid identity. Interruptions, missing established files and foreign bindings refuse without repair, SQL consent or notice. Inspect persisted content and permissions. |
| H3 | Both clients use the actual installed host, B4b worker, B4a transport and B3/core in fresh processes. Whole Unicode/redaction, continuation, lost ACK and keyless same-event replay retain their existing meaning. No automatic Card. |
| H4 | Separately prove revocation visible before header/source open denies reads, and later in-flight revocation prevents registration/publication. Retained Raw prefix is not completed interpretation. |
| H5 | Synthetic Codex ancestry/cache/header/exec and Claude installation mismatch refuse. No actual host/user-state access; existing released hosted behavior stays unchanged. |
| H6 | Deadline/signals await owned descendants; preserve pending/cooldown and report waiting/busy honestly. Successful and failed invocations remove only owned scratch after teardown. |
| H7 | Independently derive and observe installed import/asset closure; fresh processes run without source-tree fallback. Inventory/archive counts agree by two routes. |
| H8 | Affected generic/client/setup/artifact gates on both Node22.16/24.15 with actual exits; primary independent permission/installed acceptance plus exact-SHA nonauthor Standards/Spec reviews and latest-head CI before ready/unmerged delivery. |

## Ownership and staged work

Primary owns this plan, contracts, integration, independent acceptance and
delivery. One bounded GPT6.1Sol/high author owns implementation and its focused
tests. First propose exact DTO/preparation transitions/CLI mapping/file roster;
primary freezes them here before implementation. Then implement H1/H2/H5 before
installed H3/H4/H6/H7; freeze source/dependencies and the finite affected command
roster before the final matrix. Stop at the first red, retain evidence, diagnose
the smallest cause, and avoid repeating unrelated full matrices.

Tentative scope: focused local-host/profile/permission/preparation/CLI modules
under integrations/client/raw, a compatible Codex verified-header helper,
focused tests/fixtures, installed test/fixture, private packaging list and
associated docs/scripts/CI. No core/schema/provider/MCP implementation changes.
Any need to change shared behavior must be reported before expanding this scope.
Author may not edit this primary-owned plan, commit, push, create PR or merge.

Rearm, qualified duplicate-source usability, retained Raw MCP/terminal review,
combined source-to-Card/correction/forget/delete lifecycle, schema29 overview
compatibility and actual automatic client activation remain separate packets.
Do not call those already complete or fix them by silently weakening contracts.

Independent read-only preflight completed before this contract: reuse readonly
local authority storage; never use currentHost's observation/probe side effects;
extend verified metadata rather than trusting input; do not require provider keys
before replay. These are design constraints, not passed behavioral evidence.

## Frozen author contract (2026-10-21)

Profile exact keys: version:'local-raw-host-profile-v1', configPath, configDigest,
stateRoot, identityKeyPath, home, installation. Installation exact union:
{client:'claude-code',pluginRoot} or {client:'codex',qualificationConfigPath}.
Client equals the B3 authority client. Profile/home/key parents are private;
files0600, newly owned directories0700. State root and key are distinct,
nonoverlapping leaves under preexisting private parents. These exact paths may
not collide with the profile, intent/marker, lock or each other's parent trees.

API: createLocalRawHost({profilePath}) returns status({signal?}),
prepare({signal?}), initialize({sessionId,sourcePath,start?},{signal?}),
run({sessionId,sourcePath},{signal?}). Closed own-data DTOs, native AbortSignal,
EOF default and explicitly named beginning import. CLI fixed grammar:
--profile ABS status|prepare; --profile ABS initialize|run --session ID
--source ABS [--start beginning|eof], with start allowed only for initialize.
No stdin, arbitrary args, executable/runtime/authority or environment overrides.

Result exact keys: version:'local-raw-host-v1', status, reason, worker. Statuses
ready/progress/waiting/blocked/busy; worker null or unchanged B4b summary. Host
reasons: null, prepared, preparation_required, preparation_invalid,
profile_invalid, config_invalid, store_invalid, authority_changed,
capture_disabled, runtime_unavailable, host_unavailable, host_unqualified,
source_unqualified, invalid_input, cancelled, work_limit, unexpected_failure.
Delegated reasons must belong to B4b's existing closed enum. Exit0 ready/progress,
3 waiting/busy,2 blocked,1 unexpected failure. Caught INT/TERM/HUP use130/143/129
after owned teardown. Emit one content-free JSON result, never raw errors.

Preparation holds profilePath+'.prepare.lock'; durable intent/marker lives at
profilePath+'.prepared.json', OUTSIDE key/state. All absent: publish exclusive
synced creating/profileDigest intent first, then new root/key and compatible
B4b root commitment, then ready marker bound to profile/config/authority/key
commitment and root dev+ino. Any partial combination/creating marker refuses
with no repair. A ready marker plus complete matching identity is idempotent.
Verify unknown publication outcomes from disk before any next write; never
delete intent or overwrite an established key after an ambiguous failure.
All-deleted owner state is not detectable malicious-owner protection.

Status/preparation inspect config and read-only authority without capture/source
or qualification work. Initialize/run obtain qualification only after prerequisites;
permission check precedes header open and is repeated before worker dispatch.
Use a155-second nominal foreground work/teardown budget, initiate cancellation
with reserve for B4a teardown, and await actual child close even if teardown
overruns the nominal cap. It is a cancellation deadline, not an impossible
guaranteed hard wall-clock kill bound. Signal/deadline tests assert actual child
closure and retained state, never merely a returned timeout.

Claude profile binding plus explicit owner selection is the entire authorized
source-selector boundary here. Validate the installation path and marker/profile
binding, but do not add an invented native-hook attestation or new manifest
qualification policy. A supplied source/session cannot override pluginRoot;
changed profile metadata after preparation refuses. Document that automatic
native-hook selection is a future separate entrypoint.

Codex helper preserves existing sessionSource projection and hosted behavior.
SQLite imports remain lazy after supported-runtime checks, preserving Node20
pure-import behavior. The installed host uses real production helpers; test
dependency seams must not leak into profile/CLI or make installed evidence a
stubbed host call. Explicitly label synthetic host ancestry/cache in evidence.

Allowed author paths: local-host/profile/permission/preparation/CLI modules,
optional additive raw/index export, Codex session-source compatible helper,
focused test/fixture/CLI driver, installed packaging test/fixture,
packaging/artifact-files.json, package.json, .github/workflows/ci.yml,
packaging/README.md, docs/limitations.md, docs/raw-local-journal.md, CHANGELOG.md.
No core/B4b/shared private-state/setup runtime behavior edits. Generated copies
may need an exact later synchronization if a known gate demonstrates that need;
report it before changing them. Do not skip/relax existing validation guards.

Author milestone1 is H1/H2/H5 implementation and focused proof, then checkpoint
for primary inspection before broad matrix. Primary independently freezes
permission/no-source and preparation acceptance before seeing author tests.
Missing dependencies may use the exact18 identity-checked parent dependency
links; no install, package/lock changes or real owner configuration. Record every
test command and actual exit, keep red receipts, reap children and verify owned
cleanup. Worktree source stays frozen during each approved final matrix.

Primary independently froze the following20-case permission/preparation roster
before seeing author test source. Evidence directory:
/tmp/cairn-raw-b4c-evidence.lpfzkz. It uses actual core-created synthetic schema29
stores and the public host API. Instrument actual filesystem source-open calls,
forbid subprocess dispatch/model/network, and inspect SQL for mutations; a
positive permitted initialize proves the source-opener instrument is live.

1. Status on a fresh profile changes no files and opens no source.
2. Preparation is idempotent, preserves key/root/marker and changes no SQL.
3. Concurrent preparation produces one complete identity, no temporary residue.
4. Missing established key refuses without regeneration.
5. Missing established root refuses without recreation.
6. Fault after durable creating intent leaves visible refusal, no retry repair.
7. Fault after ready publication never overwrites identity; a fresh validated
   retry observes that same complete identity.
8. Changed prepared profile installation metadata refuses without source reads.
9. Pre-aborted operation reads no source and writes no state.
10. Proxy/accessor/unknown authority-bearing input is rejected without invoking
    traps or accepting caller-supplied source authority.
11. Revoked Claude capture after preparation denies initialize/run source opens.
12. Revoked Codex capture denies header reads and actual host-ancestry probes.
13. Missing durable control cannot be inferred as consent.
14. Namespace pause after preparation denies source reads.
15. Stopped project capture after preparation denies source reads.
16. Changed raw-control revision fails before source access.
17. Changed consent/authority generation is not adopted by an initialized host.
18. Permitted Claude EOF initialization, then empty run, opens the source but
    neither dispatches nor requires a provider key; Memory/Raw remain empty.
19. Changed digest-bound configuration refuses without source reads/repair.
20. Unsafe private profile permissions refuse with state and source untouched.

Each test uses its own immediate-teardown workspace; lost-file tests move only
their owned synthetic leaf to a known backup instead of deleting user data.
This roster proves host permission/preparation, not installed Codex qualification,
semantic recall or actual automatic hooks. Those require their separate H3-H8
evidence. Behavioral results are not yet claimed; freeze test hashes before run.

Primary test frozen before reading author test source: primary-permission.test.mjs,
SHA2565044f83f9ab6ac070aeb320a67d636b307cec2afacc5b7df491accbbefa7a769.
Syntax validation actual exit0; mechanically counted20 distinct P01–P20 IDs.
No behavioral result yet. Instrumentation also observes write-open attempts so
an identical rewrite or transient lock cannot masquerade as nonmutating status.

## Milestone1 evidence

Actual GPT6.1Sol/high author implemented9 paths, independently cross-checked
against Git status and complete base/current blob/mode differences. Ten paths
including this primary-owned plan. Full source1824 files (excluding this plan)
SHA25683fd3c94cd7d5d58b8ce4544d0e200b17b3db29aa1332e31d5ad3a14e7ca3ec2;
no adapter/tool dependencies installed. Snapshot: primary-milestone1-freeze.json.

Author focused38 host plus4 existing Codex source checks pass42/42 on each
Node22.16.0/24.15.0, actual exits0. Earlier red receipts retain three distinct
causes: author fixture missing home; host public-null vs storage-empty personal
namespace normalization; derived runtime root's trailing slash. Corrections are
limited to the fixture/new host bridge; no core/shared-worker change.

Primary's first independently authored20 cases returned19/20, actual1. Its
Codex fixture omitted the required existing private installation configuration
file/parent and failed before exercising revocation. Primary corrected only that
synthetic fixture, preserving the original exact file and log. Test SHA now
834bdcdab5dc7bd7271f218c1d08d2fb1b7f14e3cce33e1da2f424339725cab6.
The same20 cases then pass on BOTH runtimes, actual0/null signal; outer43986
reaped exit0, owned workspace removed,1824-file source hashes/modes unchanged.
Reports: primary-milestone1-permission{,-corrected}-report.json. The original
fixture is primary-permission-original.test.mjs; no product failure was hidden.

Primary inspected all five host modules, the Codex helper diff and actual
filesystem observer. Next narrow correction before installed work is canonical
DB/usage overlap validation, including ancestor aliases; demonstrate red then
green without altering shared path helpers. Source freeze is released only after
the above checks. Installed H3/H4/H6/H7 remain unproved by this milestone.

B4b dependency is now ready/unmerged PR462 at this fixed base:31 exact-head checks
and four workflows succeeded; independent Standards/Spec0 findings, primary
committed progress8/installed2 per runtime actual0. Merge9d915bd5a3bafcfc9c6855b2073fd3b60a8e95c1
has identical tree407a412768f4da8a44d1b8a1598f0d91f49d16a8. No merge occurred.

Continuous segment resumed2026-10-21 14:00UTC; owner discussion checkpoint is
2026-10-22 02:00–08:00UTC. Routine updates do not end work; no task is handed off
running without a supported supervision/continuation mechanism.

## Installed milestone: frozen acceptance and test-only boundary

Primary froze J1–J3 before reading the author's installed tests. J1 invokes the
actual installed CLI with malformed/override arguments, and observes no source,
subprocess, model or application writes. J2 explicitly prepares and initializes
at EOF, appends a new redacted Unicode message, captures through a fresh CLI,
then inspects the cold SQLite Raw/Memory lineage and absence of automatic Cards;
a further keyless invocation must do no work or additional usage. J3 revokes
capture after initialization and before a new appended message, then observes
capture_disabled with zero source reads, capture subprocesses or model calls,
and unchanged cursor. These are independent primary-authored tests, not semantic
recall evidence or native client activation.

The author's separately frozen eight installed cases cover both clients with
beginning import, multipart Unicode/redaction, committed-but-lost ACK, cooldown,
keyless same-event recovery and continuations; both clients' in-flight revocation;
actual child teardown after INT/TERM/HUP; and a shortened code-only deadline.
Each runs the real installed host/worker/transport/core in fresh processes.
Codex ancestry is synthetic while production qualification/cache/header helpers
are real. Exact process.execPath plus installed B3 CLI argv may receive only a
test fake-HTTP preload; no executable/profile/production environment bypass is
added. Other subprocess shapes and real network are forbidden. Observe actual
installed imports/assets and independently compare their closure and archive.

Narrow canonical-path regression was red2/2 (actual1), then green2/2 (actual0):
an ancestor alias may no longer hide state underneath DB/usage locations; source
aliases into private state now refuse before the actual worker/opener. Previously
the latter still refused safely at Linux traversal; the regression strengthens
the earlier bridge boundary, not a claim of previous source disclosure.

Installed first Claude case passed actual0 with161 observed/derived closure
files and173 archive files. First full Node22 run passed5/8, actual1. Retain this
red: two assertions incorrectly equated saved Raw with accepted worker progress;
the third exposed outer deadline reported as waiting/uncertain instead of the
host's work_limit. Only fixture assertions and new host reporting may change.
After awaited dispatch, an observed outer cancel/deadline with a waiting/busy/
blocked worker becomes blocked cancelled/work_limit with the UNCHANGED nested
worker summary. Confirmed ready/progress remains confirmed if a late stop races
the return; caught CLI signals still retain their documented exit code. Test
both uncertain teardown and confirmed-result race. Never erase accepted counts,
pending identity or conservative uncertainty. No core/B4b change is authorized.

## Milestone2 acceptance checkpoint

Source frozen at1828 files (excluding this plan), SHA256
de3b1da7fb101be55eb11805139bff1e575f98ebe11f9f8ea66979d47b5830a2.
Author22 paths plus primary plan1:23 changed paths agree between Git diff plus
untracked discovery and an independent complete base/current blob-and-mode
comparison. Eighteen dependency realpaths/package hashes match the B4b freeze.
Record: primary-milestone2-freeze.json in the same external evidence directory.

Author's failed I3/I4/I8 passed targeted3/3 after the stated corrections; all8
then passed on both runtimes, actual0. Late completed-replay TERM returns143 but
retains confirmed progress and zero additional usage. INT/TERM/HUP/deadline
cases wait for real child closure. Derived and observed installed closure161
files agree; the actual private archive contains173 files.

Only two generated paths were separately authorized after a demonstrated stale
gate: setup runtime session-source.mjs and manifest.json. The32-file generated
inventory is unchanged; all source/copy bytes and manifest hashes agree.
Corrected setup --check and diff --check exit0. No hosted behavior is rewritten.

Primary independently authored J1–J3 actual-CLI tests. First run1/3, actual1,
exposed a test observer fault: direct-path matching did not observe the real
Linux fd-relative source leaf. Its positive-open assertion caught this; it was
not weakened. Correct only the observer to recognize /proc/self/fd traversal,
retain original preload SHA2568e55c267e6bb8f083fca84af6cb94c1399d9b123647f0eb4f63a60eda103aefc,
and rerun the SAME three cases on both runtimes:3/3, actual0/null. Test SHA
4bd6dcd5685fab9e45b4bc1099c43afc56610de988da769d7a2f9fe790aa2f27;
corrected observer SHA4132d78c7cf5c5c7f3f5fd09090352c11bc6ed8af093d4dc206a9e2d2d2da6d9.
The frozen20 primary permission cases also pass again on both runtimes, actual0.
All four corrected commands preserve1828 source hashes/modes, remove owned
scratch and reap their actual children. Outer sessions11511 and16186 exit0.

The final affected roster is21 gates per runtime (42 total): B4b's19 gate
classes plus local-host and local-host-import. Include the actual installed8,
generic validation, client/Codex/pairing/golden, native plugin validation,
producer/worker/transport/local, setup/archive, workspace lifecycle, generated
checks and capture demo. Source stays frozen; first red stops, no unrelated
automatic retries. Only native Windows-on-Linux skip is expected. Node20 pure
import is a latest-head CI gate, not a locally installed runtime claim.

## Final matrix v1: retained static-audit failure

The supervised first matrix stopped after command8/42: generic Node22 returned
actual1/null with634/635 tests passing. The seven preceding commands exited0;
artifact115 includes114 passes and the one declared native-Windows-on-Linux
skip. No later commands ran. Source1828 and18 dependency identities stayed
unchanged; the owned matrix workspace was removed and all children reaped.
Keep author-final-report.json, author-final-matrix.log and the generic log.

The failing existing namespace guard exhaustively scans integrations/plugins
for sessions/capture-cursor references and permits only exact audited owners.
The new preparer legitimately initializes/validates the dedicated B4b state
root, but its path was absent from that owner roster. Primary read the complete
preparer and guard before authorizing one additional test-only path:
integrations/client/test/pairing-guards.test.mjs. Add that exact owner, assert
its sessions references remain the two profile.stateRoot inspection/creation
sites, and prohibit legacy cursor imports/helpers. Do not weaken the exhaustive
scan, read-only pairing guard or packaged-feasibility exclusion. No runtime fix
is implicated by this failure.

Run the exact failing guard on both runtimes, preserve the first red receipts,
then freeze the revised source/dependency inventory and execute a separately
named v2 matrix. Do not overwrite the first matrix evidence or count its seven
passes as verification of the new snapshot. This adds one author test path;
re-derive both independent inventories before claiming the new count.

## Final matrix v2: candidate freeze

All42 commands completed with actual exit0/null signal on Node22.16.0/24.15.0;
the supervisor's outer tool session42028 exited0 and PID43464 was reaped. Each
runtime passed host41, worker59, transport34, local30, generic635, workspace25,
Codex198, client5, producer38, pairing270 and setup398. Artifact115 includes114
passes and exactly one declared native-Windows-on-Linux skip per runtime.
Import, JSON/native plugin validation, capture demo, generated bundle/setup
checks, golden parity and enabled-prepack archive cross-check also exit0.

Source1828 files, SHA256
bbc93369f3a271ec0d0840f860fb9c284d3be48a73f90927d5ab4c641beee0d2,
matches the original v2 freeze, every command boundary and primary's independent
precommit snapshot. Eighteen dependency realpaths/package hashes are unchanged.
Author23 paths plus this primary plan=24 changed paths; Git diff/untracked and
independent complete base/current blob/mode inventories agree. Compared with
the prior milestone, only the narrowly authorized namespace-owner test changed.

Primary personally parsed all42 durable results, checked actual exits and the
frozen source, and verified the owned workspace /tmp/b4c-final-matrix-0Dj2eY and
supervisor were absent. No historical cleanup occurred. Reports are
author-final-v2-{report,audit,command-manifest,source-freeze}.json and
author-final-v2-results.jsonl under the same external evidence directory;
primary-precommit-final-freeze.json independently records the24-file inventory.
Keep the v1 failure report/logs and all earlier focused failures unchanged.

Next: commit exactly this scoped candidate, personally rerun the frozen20
permission and3 installed acceptance cases on each runtime, then receive
nonauthor Standards/Spec reports on that exact commit before push. No merge,
release, deployment, actual-client activation or new semantic score is claimed.
