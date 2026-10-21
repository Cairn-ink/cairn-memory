# Explicit local Raw rearm — next bounded packet

Status: implementation frozen; independent source/recovery/installed acceptance
and all28 affected contributor commands passed on Node22.16/24.15. Exact-commit
acceptance, final-candidate reviews and CI remain pending at this checkpoint.
Base: 363c1da01296e892fed94a1074edd774ede37733, ready/unmerged parent PR #465.
Worktree: /home/chichieh/Github/cairn-memory-worktrees/raw-local-rearm.
Branch: feat/raw-local-rearm. This packet has no PR yet.
Main owns this contract and independent acceptance. One actual GPT6.1Sol/high
worker owns implementation; separate nonauthor Standards/Spec review follows.

## Outcome and limits

After an operator has already re-enabled the existing authoritative controls,
explicitly adopt the new authority for one established local session and start
at one frozen complete EOF. Keep the same store, target, namespace, client,
installation key, session/wire identity and issued ordinal. Do not interpret
paused content, resend a closed suffix, reset identity or retry failed first-part
interpretation. This operation is model-free and never enables controls itself.

Authorization remains synthetic local implementation/tests/commits/push/PR and
named product coordination only. No real transcripts, operational configuration
or stores, provider calls, merges, release/deployment, product pins/flags or
actual client activation. This is not complete local V1 or semantic evidence.

## Trusted API and preserved configuration

Add separate trusted host methods `rearmStatus()` and
`rearm({expectedRevision, actionId, sessionId, sourcePath})`, with fixed CLI
grammar. The new methods have their own closed versioned result DTOs; existing
host status/prepare/initialize/run envelopes remain unchanged. Status exposes
the bounded action revision and whether the latest action is pending; no source
text, raw session identifier, source path, key or provider details in output.

Use a nonnegative safe-integer global rearm revision as a CAS precondition and a
strict UUID action ID. The first revision is zero. A successful action advances
it exactly once. A superseded request is stale, never a new EOF selection.
An interrupted action may be resumed only with its exact request binding.
The two new response DTOs have exactly `{version,status,reason,revision,pending}`.
Versions are `local-raw-rearm-status-v1` and `local-raw-rearm-result-v1`.
Status is ready/waiting/blocked/busy. Revision is the last completed nonnegative
safe integer, or null when validated state cannot be established; pending is a
boolean or null on invalid/unknown state. No record plus valid preparation means
revision0, not a failure to read the record. This is an observation that no global
action record exists, not proof that no rearm ever occurred and not authorization
for a selected session. Do not add a sentinel or enumerate sessions to prove that
historical absence. A pending action reports the prior
completed revision, never the reserved successor as completed.

Status reasons are null or rearm_pending; successful action reasons are rearmed
or replayed. New fixed refusal codes are stale_revision, action_conflict,
rearm_invalid, rearm_refused and revision_exhausted, plus applicable existing
host reasons. Existing cancellation/work_limit and fixed failure discipline
remain. Never return exception prose. A canonical lowercase UUIDv4 and a safe
integer expectedRevision are required; an exhausted new increment refuses
after recognizing a valid terminal replay, not by overflowing the counter.

CLI grammar is exactly `--profile PATH rearm-status` or
`--profile PATH rearm --expected-revision N --action-id UUID --session ID --source PATH`.
Require exact order/count and canonical decimal N (no signs or leading zeros).
Emit one JSON line; existing exit convention applies: ready0, blocked2,
waiting/busy3, unexpected_failure1, caught signals retain their existing codes.
API call options use the existing closed optional native signal convention.
Strict own-data validation rejects getters, proxies and extra fields.

Read fresh enabled authority from the same read-only schema29 store. Preserve
all non-authority configuration values and optional-field presence, including
duplicate policy, provider, usage, database, Raw mode/cap and timeouts. Preserve
profile installation/home/key/root/config paths. Only the authority and its
exact configuration/profile/preparation bindings may advance. The ordinary
prepare operation still cannot repair or adopt changed established state.

## Admissible cursor states

Both cases require intact claims/root/key, exact source identity and old anchor,
fresh permission, no session deletion fence, and a cursor authority different
from the newly adopted authority. Partial EOF, source replacement/truncation,
unknown authority or corrupt state refuses without resetting anything.

A. `pending:null`, unblocked: require authoritative SQL high-water ownership.
An issued ordinal of zero requires no SQL message; absence of a conversation
is legitimate after EOF initialization or excluded records. A positive ordinal
requires the exact namespace/client conversation and highest ordinal equal to
the cursor's issued ordinal. Prove its first-event/part/capture binding and
managed store/target ownership, completed transport totals and zero reservation.
Eligible first-part interpretation must have matching completed admission;
otherwise prove the recorded no-eligible-first-part path. A previously closed
boundary requires a recognized committed receipt proving its deliberate discard.
Do not infer safety merely because someone cleared a pending field.

B. Pending continuation with part.index > 0: reconstruct the bounded old record
and canonical planner projection using its exact old authority/generation.
Require the authoritative same message to be closed specifically by
capture_barrier or tool_off, with zero reservation and matching conversation,
ordinal, role, declared totals and first-part ownership. Prove completed eligible
first-part interpretation or the explicit no-eligible-first-part binding; absence
of admission alone is insufficient. Discard the closed suffix, never resend it.
Only an unblocked cursor or its known authority-change block is eligible.

Refuse pending first parts, processing/incomplete interpretation, exhaustion,
quota or other blocks, deletion, orphaned bindings and unexplained states. Do not
scan all historical admissions or claim historical source-file attestation.

For either case freeze one complete EOF at or beyond the old offset, with its
verified inode/source identity and anchor. Preserve issuedOrdinal and epoch0;
set pending:null and use the existing Claude EOF awaiting-user-boundary selection
rule (Codex retains its empty selection). Future genuine messages use higher
ordinals. No whole paused-content scan for A. B keeps existing 32 MiB record,
128 MiB aggregate-read, bounded scratch and operation-deadline limits. Same-action
recovery/replay never refreshes EOF when the file has since grown.

## Bounded metadata and crash protocol

Keep one fixed-size global rearm record and one latest per-session receipt,
not an unbounded action/history map. The global record retains one exact
predecessor authority pair and unchanged non-authority configuration commitment.
Another session may explicitly adopt only that retained predecessor; it gets
its own SQL/source eligibility check and frozen EOF. A later authority transition
replaces the predecessor. Sessions older than that refuse rather than inventing
their previous authority. No global cursor enumeration or blanket migration.

Rearm takes the existing global preparation lock, then the selected session's
lock (root validation uses the established brief root lock in a consistent
order). Ordinary runs never hold the global lock for their entire execution.
Global pending intent gates new host starts. Existing other-session operations
may finish or be fenced under their old snapshots; their cursors are not adopted.
Never acquire the global lock while holding a worker session lock.

Before changing a selected cursor, durably publish its pending receipt. Direct
workers must inspect session rearm state under the session lock before opening
the source; the host gate alone cannot protect them. Publish an exact replacement
cursor only from its expected old digest, or recognize the exact replacement
already published. An unexplained third state fails closed.

A rearmed cursor has an optional positive `rearmRevision`. Validation is
bidirectional: any pending receipt refuses regardless of cursor format; a
committed receipt requires the exact cursor revision, and a positive revision
requires its committed receipt. Omission is legacy-compatible only when no
session rearm artifact exists. Before source access or publication, selected
rearm must refuse a missing global record when that session has a receipt or
positive rearmRevision, and refuse a present global completed revision older
than the selected committed receipt/cursor revision. Never reuse or lower a
session's known revision after global-record loss or restoration of an older
genuine record. Ordinary direct workers may continue an intact committed session
under current permission; rearm does not repair lost global history. Bind receipt
to session/wire/key/root identity,
adopted authority, source identity and frozen offset/ordinal floors. Valid later
progress may exceed those floors. Missing/mismatched artifacts are not repaired.

After verified cursor publication, durably publish a terminal session receipt
before activating the new ready preparation. Once terminal, recovery or replay
must NEVER write that cursor again—even if global/config/profile/ready publication
was interrupted, or a direct worker has subsequently advanced it. Remaining
publications accept only frozen old/new bindings and exact CAS continuations.
An ambiguous durable write stops; recovery inspects actual state, not an assumed
write failure. No rollback of a possibly published cursor or changed accounting.

The selected-session terminal record must be recognized even if the global
record still says pending. Otherwise a crash between those publications could
rewind later direct-worker progress. Reject a new unrelated action while the
latest global action remains incomplete. Only that exact action can resume.

Recheck fresh authority and source anchors before publication/recovery. SQL and
filesystem cannot share a transaction; a changed authority while an intent is
pending leaves a visible refusal, not automatic adoption of yet another snapshot.
Normal provider/admission/Raw fences remain active. Raw-only controls do not
retroactively cancel already-admitted interpretation; already-read bytes and
dispatched cost cannot be undone. No hostile same-owner tamper defense is claimed.

Private metadata remains owned 0600 under canonical private 0700 directories,
strictly below 64 KiB per record; reject oversized intent before any publication.
Include rearm sidecars in source/config/DB/usage overlap protection. No raw source
text/session identifier/path in rearm records; use existing opaque identities.
Source files retain the existing Linux-owned regular/no-symlink contract, not
an invented requirement that every native transcript be mode0600.

Frozen global record keys: version, phase, revision, transition, action.
Version is local-raw-rearm-state-v1, phase pending/ready, revision is the last
fully completed action. Pending action.revision equals revision+1; ready equals
revision. Transition keys: revision, predecessorAuthority, authority,
nonAuthorityConfigCommitment, installationCommitment. Authority objects use the
existing closed DTO; transition.revision identifies when this authority pair was
established and stays unchanged while another session adopts the same pair.
The installation commitment covers immutable paths/installation/home/key/root
without serializing their paths. A concrete fresh-authority reader is required;
ignoring a failed check of the stale snapshot does not produce fresh authority.

The global action embeds the complete frozen session record so recovery after
global intent but before session intent never needs to choose another EOF.
Session record keys: version, phase, expectedRevision, revision, actionId,
requestCommitment, transitionRevision, sessionKey, wireSessionId, keyCommitment,
rootDevice, rootInode, oldAuthorityCommitment, authorityCommitment,
nonAuthorityConfigCommitment, oldCursorDigest, replacementCursorDigest,
replacementCursor, files. Version is local-raw-session-rearm-v1, phase is
pending/committed. Request commitment is keyed over the complete validated
request including exact source/session spelling, never their plaintext.
Root identifiers are canonical decimal strings; digests are lowercase64-hex.
Replacement is the exact existing cursor shape plus positive rearmRevision,
pending:null and blockedReason:null, with its normal client/source/anchor shapes.
Files keys: oldConfigDigest, configDigest, oldProfileDigest, profileDigest,
oldPreparationDigest, preparationDigest. Corresponding digests may be equal
for a second stale session adopting an already-current global authority.

Publication order: global pending → session pending → cursor CAS → verified
session committed → frozen config/profile/preparation publications → global
ready with completed revision advanced. The existing preparation marker shape
stays unchanged. Both sidecar state and actual file digests must be checked;
the phase name alone is not proof that a previous write happened.

## Direct worker boundary

Under its session lock, refresh configuration equality and actual read-only SQL
permission before source access. Reuse the concrete permission helper, not a
generic callback seam. Map capture_disabled/authority_changed to authority_changed,
store_invalid to config_invalid, unexpected validation/storage errors to
state_invalid; preserve cancellation/work_limit and existing fixed worker reasons.
Do not add rearm historical SQL reconciliation to normal worker runs: their
existing synthetic transport policy tests deliberately have no Raw SQL rows.

Untouched legacy cursor encoding and eligible normal behavior remain unchanged.
After real permission revocation, even a no-work direct invocation now refuses
before reading source; document and test that intentional tightening instead
of claiming revoked-state behavior is unchanged.

## Frozen bounded file ownership

Author: six existing runtime files under integrations/client/raw:
local-host.mjs, local-host-cli.mjs, local-host-profile.mjs,
local-host-permission.mjs, local-worker.mjs, local-worker-state.mjs.
Two new cohesive modules: local-host-rearm.mjs (orchestration and read-only SQL
coordination) and local-rearm-state.mjs (strict bounded receipt/state helpers).
The latter must not import worker/host constructors or worker-state, avoiding
a rearm/worker-state module cycle. Update packaging/artifact-files.json for both.

Three new suites: integrations/client/test/local-host-rearm.test.mjs,
integrations/client/test/local-host-rearm-crash.test.mjs, and
packaging/test/local-host-rearm.test.mjs. Reuse existing owned host/worker and
installed CLI drivers; request a bounded roster update if a fixture change is
actually necessary. Add package.json only to expand test:local-host from its
single literal test file to local-host*.test.mjs; the existing CI command must
actually discover both new suites. No workflow policy changes. Author docs:
docs/raw-local-journal.md, docs/limitations.md and CHANGELOG.md. Sixteen author
paths are authorized, plus this main-owned plan and the main-owned completion
checkpoint: eighteen total,
to be independently derived rather than assumed.

No core schema/provider/wire/dependency/version/CI-workflow changes, control setters,
source/parser/planner edits or native installation activation. The exact
roster, API/CLI DTOs and state transitions are frozen here before implementation.

## Observable acceptance

| ID | Required observation |
| --- | --- |
| RR-01 | Strict trusted inputs/status/CAS, runtime and private-path validation; malformed inputs and unrelated configuration changes make no source/model call and no state mutation. |
| RR-02 | Both clients: genuine enabled-control transition plus established clean cursor adopts one frozen EOF, keeps identity/ordinal, skips paused records and captures only later eligible messages after cold restart. |
| RR-03 | Actual accepted first part plus authoritative closed continuation: completed interpretation and no-eligible-first-part variants can discard only the closed suffix. Incomplete/unknown/first-part/other-block variants refuse. |
| RR-04 | SQL high-water, binding, namespace, managed-target, deletion and original source checks reject inconsistent cursors. Ordinary worker policy fixtures keep their intentional SQL-free transport seam. |
| RR-05 | Same-action replay after append and after successful later capture does no cursor write, no rewind, no new EOF choice, no provider call and no second revision increment. Superseded action and revision reject. |
| RR-06 | Inject failure/termination around every durable publication, including rename/fsync ambiguity. A new process either resumes the exact pending action or refuses; terminal receipt always prevents cursor rewrite. No normal host/direct-worker bypass of a pending session. |
| RR-07 | Preserve eligible other-session concurrency; same-session exclusion and lock ordering hold. A second stale session can adopt the one retained predecessor with its own EOF. Older/unknown authority refuses without bulk migration. |
| RR-08 | Bidirectional receipt/revision validation, missing root/key/claim/receipt, legacy downgrade, corrupt third states, authority changes mid-operation, partial EOF, replacement/truncation and append races fail closed or preserve the frozen successful boundary. |
| RR-09 | No paid HTTP, provider-key loading, ledger change or Raw/Memory/Card mutation during rearm/status; bounded reads and private metadata, source/key omission in diagnostics, cleanup on success/failure/cancellation. |
| RR-10 | Actual installed CLI and cold-process host/worker/core exercise the successful boundary and refusals on Node22.16/24.15. Main-authored acceptance, affected contributor gates, final-SHA nonauthor double review and latest-head CI precede ready/unmerged delivery. |

## Execution order

First freeze the contract/DTOs and implement only state/permission/host/worker
behavior plus focused source suites. Main authors separate behavioral acceptance
before reading new tests. Then install the actual archive for end-to-end tests
and update user-facing limits. Freeze a finite affected gate roster before the
combined run; no full unrelated suites at every small edit. Keep all reds with
their diagnoses and actual exits. Mechanically cross-check changed-file and
artifact inventories by two routes. No full V1 or production-readiness claim.

## Exact implementation roster

The worker owns only these sixteen paths; additional files require a bounded
primary-approved contract update before editing. Primary acceptance is external.

1. integrations/client/raw/local-host.mjs
2. integrations/client/raw/local-host-cli.mjs
3. integrations/client/raw/local-host-profile.mjs
4. integrations/client/raw/local-host-permission.mjs
5. integrations/client/raw/local-worker.mjs
6. integrations/client/raw/local-worker-state.mjs
7. integrations/client/raw/local-host-rearm.mjs
8. integrations/client/raw/local-rearm-state.mjs
9. packaging/artifact-files.json
10. package.json (only test:local-host test discovery)
11. integrations/client/test/local-host-rearm.test.mjs
12. integrations/client/test/local-host-rearm-crash.test.mjs
13. packaging/test/local-host-rearm.test.mjs
14. docs/raw-local-journal.md
15. docs/limitations.md
16. CHANGELOG.md

Primary owns this plan and docs/plans/raw-local-v1-completion.md. The 18-path
expectation must be cross-checked against actual diff and tree inventories.

## Execution record

2026-10-21: parent #465 ready/unmerged at exact base above. All31 CI checks and
4 workflow runs succeeded, exact merge-preview tree matched; final ready-proof
exit0. Product checkpoint: cairn-wiki#453 comment6328258163. No activation or
merge. New isolated dependent worktree created with actual exit0; primary dirty
worktrees preserved. Independent acceptance directory:
/tmp/cairn-raw-rearm-evidence.xrYSLT. No rearm acceptance has run yet.

Primary baseline before implementation: both clients remain blocked by
authority_changed after disable/re-enable, preserving cursor/key/ledger and
making no model calls. Node22.16/24.15 each2/2, actual child exits0/null and outer0;
owned scratch removed and1847 frozen source files unchanged. Both changed plan
paths were cross-checked using diff and independent complete tree comparison.
Receipt: primary-baseline-v1-report.json in the evidence directory above.

Main independently authored13 source acceptance cases and5 actual-installed
cases without reading the worker's new tests. Syntax checks exit0 only; these
are not yet behavioral passes. Frozen test SHA256 values:
source3c028f9aad1fc318892dbf760d199b4acfed753dfde7b277a18b40278f120992;
installed428c0353d42069fa2a2f7e56466b13b68b0dbdad9c628faca4ebd6a8823cfc07.
They cover closed DTOs, zero-issued EOF adoption, unrelated config/partial EOF
refusal, one-predecessor multisession behavior, direct-worker permission and
receipt guards, and installed capture→pause→resume→capture→read-only replay.
The installed tests will inspect actual SQLite source bytes and ordinals and
require proof that paused text was not retained. They remain synthetic and
offline; no native client or paid-provider evidence is claimed.

Final affected local gate roster is frozen before execution: on each of
Node22.16/24.15, artifact, generic, JSON validate, local adapter, local transport,
local worker, local host (including both new suites), host import, transport
import, Raw producer, workspace lifecycle, capture demo, private Card demo and
pinned native plugin validator. Fourteen gates per runtime,28 commands total;
expand test globs mechanically and cross-check with an independent enumeration.
Primary source13 and installed5 remain separate acceptance. Core/MCP/provider
implementations are unchanged; their complete CI matrices still run against
the final PR head, without rerunning every unrelated local suite per edit.
Any expansion of actual code scope requires reassessing this finite roster.

Primary additionally froze two independent publication-interruption cases
(not OS-hard-kill claims): recovery after durable global intent must retain its
original EOF despite append; recovery after terminal-session/config publication
must never rewrite a cursor genuinely advanced by a direct worker through a
non-conversation record. Recovery suite SHA256:
88557451bc99fcd337023c45daa20e510b3cdc8859e782a3e16e56238d5704d4.
An ambiguous write's immediate error may correctly report unknown null state;
the subsequent status/durable inspection must report the actual prior completed
revision and pending action. No behavioral result is claimed before execution.

Phase1 author checkpoint: ten runtime/test files frozen at SHA256
8aeb868d00cf28932a96007c4089da2e6e6633e41920803a38b8e176c3f1bc6b;
focused source/crash42/42 on both Node versions, actual exits0/null and owned
scratch removed. Receipt: /tmp/cairn-raw-rearm-author.rNFWyV/phase1-final-receipt.json.
The first2/14 and expanded38/40 reds and diagnoses are retained there; author
success is not independent acceptance. Ten author paths plus two primary plans
were cross-checked by git and complete blob/mode inventory;18 dependency entries
unchanged. The bounded missing/older-global-history decision above is tested by
actual removal and restoration, not only malformed JSON. Primary noted a source
close-failure cleanup concern before acceptance; a narrowly scoped correction and
new source freeze are required before primary behavioral execution.

Phase1 correction accepted: final source close now runs inside a nested
try/finally so a close rejection cannot skip key zeroing. The new regression
first failed0/1, actual1/null, then passed with the correction; the pre-fix red
is retained. The existing outer fixed unexpected_failure DTO is preserved;
subsequent status and read-only replay report actual durable completion.
New ten-file SHA256 bf724b097a85233220cb6176718f1417081daf3e1b9292ee7390c169ac57c1df;
author43/43 on both runtimes, actual0/null with owned cleanup and18 dependencies
unchanged. Receipt: phase1-close-final-receipt.json in the author directory above.

Primary source13/13 and separate recovery2/2 now pass on each Node22.16/24.15,
all child exits0/null and both supervisors exit0. Their owned workspaces were
removed and1851 source files stayed unchanged at SHA256
b5a1f02b987856fc4f713fd7e4d5a5aaf52d4002ae008a3acb112ab6c3e8e421.
Both independent inventory routes agree on12 changed regular paths. Receipts:
primary-source-v1-report.json and primary-recovery-v1-report.json in the primary
evidence directory. Phase2 is now assigned to the same worker for the six
remaining manifest/discovery/installed-test/documentation paths only; runtime
changes require coordination. Installed acceptance and final gates remain open.

Primary actual-installed acceptance is now5/5 on each Node runtime, all exits
0/null and supervisor0; archive/manifest/installed inventories agree. Both
clients used cold installed host/worker/core processes for real synthetic
capture→pause→rearm→capture. SQL inspection verified one session, ordinals1/2,
unchanged key/qualification, preserved existing Memory with two receipts, no
paused text and exact future text. Status/rearm/replay required no provider key,
spawned no provider child and changed no model-call count or usage ledger;
replay after progress left cursor bytes unchanged. Malformed CLI refused.
Receipt: primary-installed-v1-report.json, source1852 SHA256
aec1bd47dca10774367fbceddc11f5bc13d2ef62d6940043310cd03e599e9dae,
all18 changed regular paths independently cross-checked. Owned scratch removed.
The frozen28-command affected matrix is running against those exact source
bytes and18 unchanged dependency entries. No final-gate/CI acceptance yet.

Author's final16-file freeze is9e71addbba3fa6f48113e4955a7a423cc4a8931cad9267d19aa60acc48c0658c;
all accepted Phase1 paths stayed byte/mode identical. Author source43/43 and
installed4/4 passed on each runtime, all child/outer exits0, actual cleanup and
18 unchanged dependency entries checked. Artifact/manifest/filesystem agree on
179 files; installed import observations and static closure agree on165 paths.
Only the two intended artifact modules and local-host test-discovery glob changed
in packaging/configuration. Receipt: author-final-receipt.json in the author
evidence directory. Primary separately inspected the implementation, source
tests, installed test and all documentation/manifest/discovery diffs.

The frozen combined matrix completed28/28 commands with actual child exits0/null
and supervisor exit0. On each Node22.16/24.15: generic635/635, local37/37,
local-transport34/34, local-worker59/59, local-host84/84, Raw-producer38/38 and
workspace-lifecycle25/25. Artifact125 total had124 passes and the one declared
native-Windows-only skip on Linux; no failures or cancellations. JSON validation,
both pure-import probes, capture/private-Card demos and both pinned native plugin
validations also exited0. No real client activation or provider request occurred.

Primary independently parsed all28 logs/exit records against the frozen command
manifest and checked source/tool/dependency hashes and actual scratch removal;
verification exit0. Receipt: primary-combined-v1-verification.json. Both inventory
routes agree on18 changed regular files;1852 frozen source files and18 dependency
entries stayed unchanged during execution. Only the two main-owned planning
records are updated after this gate; all16 author paths, including runtime/tests,
remain at the accepted final author freeze. Exact committed-content proof and
repeated key source/recovery/installed acceptance precede independent review.
