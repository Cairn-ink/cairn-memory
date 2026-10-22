# Standalone local V1 closeout

Started 2026-10-22 15:51 UTC. Scope checkpoint by 19:51 UTC (four hours),
not a promise that every V1 acceptance gate completes by then.

Fixed dependent base: `3f6590584e746cc596c7859c9b0a00ae808941b6` (#468).
Worktree/branch: `local-v1-closeout` / `feat/local-v1-closeout`.
The user asked this session to finish V1 while another session explores new
algorithms. Do not grow this packet into a new retrieval/consolidation design.

## Delivery boundary

One local engine owns Raw, Memory and authored Knowledge Cards; MCP, client hooks
and the product use that engine. The product is not a second memory engine.
The [completion contract](raw-local-v1-completion.md) remains authoritative.
This packet closes local setup/activation gaps, not all model-quality or product
production acceptance. Defaults remain off; no real client configuration,
transcripts, provider credentials, paid request, merge, publication, deployment
or operational database migration is authorized by this local test packet.

Primary confirmed the existing candidate before extending it:

- #468 is a coherent dependent candidate: 32 commits / 257 paths from main;
  `git diff` and independent complete-tree blob/mode enumeration agree.
- Heads of #449–453, #455–456, #458–468 are contained (18 PRs).
- #448's content is already in main even though GitHub's list reports it open.
  Do not attempt another merge based on that UI state.
- #457 is selectively ported, not ancestry-merged; its five reader modules and
  six original test/fixture files are preserved. #454 is a separate hosted
  recall change, not part of this local candidate.
- Primary rebuilt the unchanged baseline artifact: 184 archive members,
  348891 bytes, SHA-256
  `48e4562315fc965660e0778c001ddc27393d9b4b701a9de78b7580b951ad1aea`.
  This is baseline packaging evidence, not acceptance of the new setup code.

Raw audit evidence: `/tmp/cairn-v1-closeout-evidence.NwASmh/primary-stack-audit.json`.
Both audit and baseline build exited 0. No PR state was changed by that audit.

## Packet A: explicit preview activation

The existing host already prepares installation identity, checks SQL permission,
initializes at EOF, captures through the installed worker and supports explicit
rearm. The missing part is a usable operator entrypoint and native hook wiring.
Leave released hosted plugins, `packages/setup` and hosted Codex defaults alone.

Implement a small `cairn-memory local` CLI in the private artifact, with setup,
status, activation and disable operations, plus one closed local hook adapter.
The exact flags may be simplified by the worker but must satisfy these contracts:

1. Setup selects explicit installation directory, existing local database,
   namespace, client, approved source root, shared usage root and client
   configuration path. It
   requires explicit interpretation/provider-processing consent, distinct
   plaintext Raw consent, finite storage/daily usage limits, and acknowledgement
   of foreground capture latency. Never store or print a provider key; only
   record the validated environment-variable name. Daily limits count existing
   model-port invocations, not dollars. Do not require a key for
   setup/status/disable/fully acknowledged replay.
2. Setup uses public core controls and their actual store/revision/generation
   results. Do not invent an authority JSON grant. Validate all inputs and
   configuration conflicts before any consent write; use exclusive private
   installation paths. An ambiguous partial setup must remain inactive and
   report a finite recovery requirement, never regenerate identity or auto-retry.
3. Bind profiles to the current installed runtime and exact namespace/client.
   Activation is published last, after preparation and explicit consent.
   Repeated setup/activation must not change installation key, namespace,
   target, session IDs or ordinal. Runtime HOME is an installation-owned private
   child directory, never the user's inferred active home. Existing prepared installations use the
   existing explicit rearm mechanism rather than profile rewriting.
4. Configuration updates are confined to an explicitly selected native JSON
   settings/hooks file and installer-owned entries. Preserve unrelated values
   and handlers; compare-and-check concurrent changes. Refuse an existing Cairn
   hosted capture or ambiguous conflicting registration, do not remove it.
   Do not modify Codex trust approval, managed policy, global hook switches,
   credential stores, user shell startup files or unrelated configuration.
5. Preview hooks are explicitly foreground, not detached: SessionStart (and a
   qualified Codex pre-prompt first-observation fallback if required) initializes
   verified EOF; Stop/PreCompact invoke the real existing host. They must allow
   its existing 155-second outer lifetime plus bounded teardown, not inherit
   the hosted one-second hook limit. Do not register SessionEnd for long work.
   Initialization is not repeated at every prompt in a way that skips captured
   or pending new content. Never silently backfill history at Stop.
6. This deliberate preview latency tradeoff is exposed before activation and
   in help/docs/status. Native host-managed async may be a later bounded change;
   this packet adds no daemon, detached worker or unsupervised retry queue.
7. Hook input is untrusted event data, not installation or execution authority.
   Accept only supported native events and a bounded session/source selection;
   ignore neither malformed nor conflicting event names. Bind the selected
   transcript beneath the explicitly approved source root, reject symlink/root
   escape and private-state overlap. No payload-provided executable, profile,
   namespace, provider or consent override. Check activation and SQL permission
   before opening source contents. Preserve Codex actual-host ancestry, cached
   format qualification, session/header binding and exec refusal.
8. Reuse fixed installed paths and the configured key slot only; sanitize child
   environments. Cancellation awaits every owned child and returns bounded,
   content-free status. Hook stdout must not turn internal DTOs into model
   instructions. Diagnostics cannot include transcript, secret or arbitrary
   exception text.
9. Disable revokes SQL capture first and removes/deactivates only this install's
   registration; retain data and identity. Stale hook invocations must fail
   before source access even if config cleanup fails. Enabling again cannot
   bypass the existing explicit rearm and paused-EOF rules. Unsupported recovery
   remains visibly blocked rather than deleting and recreating state.
10. Codex format qualification remains separate from hook payloads. Use an
    explicitly selected already-qualified cache/profile for this first packet;
    do not pretend generated JSON proves a native binary is supported. The
    operator guide must identify this prerequisite and the existing qualification
    command/path. If no usable operator route exists, escalate that specific
    gap to primary instead of manufacturing a passing cache.

### First-install and shared-budget clarification (before candidate freeze)

Primary's source inspection found two gaps in the initial setup-only proposal:

- An ordinary MCP-created store is not automatically schema29. Add a small
  separate explicit `local init --database ABS` route for a brand-new store
  only. Validate before creation, use exclusive 0600 file creation in a checked
  private parent, then the existing public `openMemoryCore` with Raw mode off. No
  capture consent, source read, provider key, hook, migration of an existing
  path or overwrite. Any existing path (including an empty file or old store)
  refuses without byte changes. An interrupted creation stays visibly incomplete,
  not automatically deleted/recreated. Setup still requires an existing verified
  schema29 store, so it cannot silently migrate user data. Init makes no durable
  owner-cap claim: the existing core creates an owner usage row on first actual
  registration, not `getRawUsage`. Setup's shared descriptor/configurations bind
  the requested cap before that first capture. Do not seed SQL usage rows from
  the adapter or fabricate an event to initialize accounting.
- Per-client installation directories must not fork the shared invocation
  quota. Require an explicit existing owner-private `usageRoot`. Under a stable
  database-adjacent cooperative setup lock and a shared-root lock, exclusively
  bind a private descriptor with version, actual store ID, exact namespace,
  stable target ID, daily invocation cap and Raw byte cap. Both clients reuse
  that descriptor/target. Inspect sibling client controls; mismatched established
  targets, missing descriptors for bound controls or different caps refuse.
  Disable/rearm preserves the descriptor and ledger. This serializes our own
  installers, not malicious same-user arbitrary database/filesystem writes.

All new private paths/locks participate in source-root and path-overlap checks.
This is first-install usability and existing-budget preservation, not another
memory engine or new accounting model.

## Frozen acceptance

| ID | Required observation |
| --- | --- |
| A1 | Help/status/decline/invalid input need no model key or provider/network call; declined or malformed setup creates no grant or hook. Exact error output excludes canaries. |
| A2 | Both client configuration formats preserve unrelated handlers and values; conflicting hosted capture, unsafe paths and concurrent config edits refuse without active publication. |
| A3 | Installed setup uses real core controls, private files and one stable installation identity. Missing/partial/corrupted preparation cannot enable capture or silently regenerate state. |
| A4 | Check the exact generated command's installed CLI routing/quiet output/keyless behavior, and separately execute that same installed CLI entry/arguments → host → worker → transport → core with trusted test-only fake HTTP/ancestry instrumentation. EOF skips historical records; later long Unicode and redacted content is preserved; replay/restart keeps IDs and adds no model work. Instrumented capture is not exact native provider-backed hook proof. |
| A5 | Forged event, foreign/outside/symlink source, wrong namespace/client, missing grant, unqualified/exec Codex and disabled installation perform zero source-content/model reads. Synthetic ancestry is explicitly labelled, not native proof. |
| A6 | Disable, stale hooks, paused interval, explicit rearm, identity loss and source deletion retain the existing no-backfill/deletion semantics. Config cleanup failure cannot restore permission. |
| A7 | Timeout and cancellation await owned work and leave no unexpected test scratch on success/failure. Foreground hook budget covers the host; no detached child, hidden retry or SessionEnd long job is installed. |
| A8 | Existing MCP invocation/help/check/stdout and released hosted defaults remain unchanged. Artifact allowlist/import closure covers the actual installed new path without source-tree fallback. |
| A9 | New-store init → setup works using only the installed public CLI; first real capture stores its selected cap normally. Existing/old/symlink paths and invalid input refuse without changing their bytes; empty creation enables no automatic capture or fabricated usage/event. |
| A10 | Both clients on the same store/scope share the descriptor, target and usage accounting; second-client setup does not reset usage. Conflicting caps/roots/targets refuse, including coordinated concurrent setup. |

Run focused source and installed cases on Node 22.16 and 24.15. Primary writes
and reruns independent observable acceptance, inspects the actual diff, and
checks inventories by two routes. Follow CONTRIBUTING's affected regression
matrix, actual exit codes, cleanup and fixed-SHA independent Standards/Spec
reviews. Only after these gates may the scoped branch be pushed as a PR.

## After Packet A

1. Verify the real native client's configuration loading/trust/event lifecycle
   in an isolated synthetic home, without altering the user's active session.
   Qualification and fake native headers do not prove this by themselves.
2. Run the installed cross-session remember → retrieve → correct/reason →
   forget lifecycle. Keep mechanical no-model and semantic model evidence
   separate. Before paid work, inspect the exact active authority and remaining
   ledger; do not assume a historical budget reset or inspect a new key here.
3. Publish one candidate handoff and accurate remaining acceptance in wiki
   #453. Product integration/production gates remain product-team work; do not
   hold safe standalone work idle waiting for product CI.

At the four-hour checkpoint report delivered behavior, exact remaining gates,
actual elapsed time and whether any user decision is needed. Do not replace
this with a new multi-day research plan or silently declare all V1 done.

## Ownership and evidence

| Packet | Owner/model/effort | Fixed base | Evidence/next step |
| --- | --- | --- | --- |
| Scope, PR consolidation, integration acceptance | Primary | `3f659058…` | Stack audit, independent installed v3 acceptance on both runtimes, original drift reproduction and actual native lifecycle observations exit0; final matrix/review next. |
| Activation runtime/CLI, source and installed tests, scoped docs | `retained_raw_bridge_impl61`, actual GPT-6.1 Sol/high | `3f659058…` | Frozen v4:47 source/10 installed cases pass each runtime; retained correction history below. No core/algorithm/schema changes. |
| Standards / Spec | `raw_worker_standards61` / `raw_local_host_spec61`, both actual GPT-6.1 Sol/high, nonauthors | Initial `00107e7…`; correction candidate to freeze | Initial Standards0 / Spec1P2; correction and renewed independent review required, not self-review. |

### Primary prerequisites completed

- Installed baseline artifact independently passed archive-vs-filesystem
  inventory (184 paths / 182 source hashes), keyless help/config check without
  DB creation, and actual stdio remember → cold reopen → correct → stale-CAS
  refusal → cold reopen → forget. Node22.16 and24.15 scripts both exited0;
  owned workspaces were removed. No semantic inference or model call was tested.
- Native installed Codex0.163.0 passed the existing `qualifyBinary` route in an
  empty disposable home/cache; the identity-bound cached verdict matched.
  Native configuration loading then read four synthetic foreground160s hooks as
  enabled/untrusted, with network isolated and no trust edits or `turn/start`.
  Native process and both supervisors exited0; owned scratch was removed.
  This does not prove native hook execution or the new setup implementation.
- Evidence is retained in the same primary evidence directory as the stack
  audit (`baseline-install-22.16.0.json`, `baseline-install-24.15.0.json`,
  `native-qualification-probe.json`, `native-hook-config-probe.json`).

Official configuration references checked on 2026-10-22:
[Codex hooks](https://learn.chatgpt.com/docs/hooks) and
[Claude Code hooks](https://code.claude.com/docs/en/hooks).
In particular, long capture must not be attached to Codex's short SessionEnd
budget. Native background lifecycle semantics differ, so this preview does not
assume background execution from a JSON field alone.

### Corrections before freeze

- Native complete Codex payloads exposed missing inert `turn_id` / agent
  metadata fields; the source regression first failed 29/30, then passed after
  the closed decoder was corrected. Claude complete metadata received its own
  red/green case. These fields never supply execution or capture authority.
- The installed cancellation test made two incorrect fixture assumptions:
  immediate removal of a killed provider's started reservation, then removal by
  `guard.status()`. Both actual failing runs are retained. After the second
  correction attempt, primary took over only that test paragraph and removed
  its erroneous `recover-usage` fixture action. Source inspection confirms
  `runtime-usage.mjs` recovers dead owners on explicit reserve/resume, not status;
  `adapters/local/test/oneshot.test.mjs` already tests later recovery without
  refund. A7 requires actual owned-child closure, a retained pending attempt,
  the original started debit and a proven-dead owner, followed by removal of
  owned synthetic test scratch. Durable usage state is not unexpected scratch.
  This does not change runtime accounting, introduce work/retry or erase a
  failed result. Primary will independently rerun this installed check.
- Separate regressions caught transient status-lock writes and missing SIGHUP
  cancellation handling. The worker owns those narrow runtime corrections;
  their retained red evidence is in `/tmp/cairn-local-setup-author.njcfwd`.

### Frozen v2 implementation and primary acceptance

The worker's17 author paths and18 dependency entries are frozen; all1885
non-planning source entries match before/after focused tests. Both Node22.16
and24.15 pass33 source cases and6 installed cases, actual child0/null and
supervisor0, with owned scratch removed. The source A10 barrier overlaps both
installation intents before either grant. The installed A10 case begins with
real synthetic capture usage, then proves second-client setup preserves the
same target, descriptor and exact ledger bytes in both client directions.

Primary found the advertised installed operator guide was missing. Its new
installed regression first failed4/6; the existing guide is now included in the
archive and the CLI/README name its actual package-relative path. No second
specification or source-checkout runtime fallback was added.

Primary independently rebuilt v2:191 archive members/189 source hashes,
386740 bytes, SHA-256
`fdfee5c6b1b1784a5479cd6fbee1084890c5117e6d8aadcdc8dee0f773de1534`.
The standalone acceptance script uses no author setup fixture. On both runtime
versions it independently matches archive/installed inventories and hashes,
uses the public installed CLI to init/setup/activate/status/disable both clients,
checks real SQL controls, immutable usage target, key preservation, read-only
status and stale-hook refusal. Actual generated commands strip preload options
and emit no model context. The actual qualified Codex0.163 native app-server
loads those generated four hooks as enabled/untrusted under network isolation;
no turn or trust change occurs. Both scripts/supervisors exited0 and cleaned all
owned scratch. This remains configuration-loading proof, not native execution
of the provider-backed hook or semantic accuracy.

Primary evidence: `installed-setup-{22.16.0,24.15.0}-v2.json` and matching
`independent-installed-*-v2.json` in the primary evidence directory above.
Worker evidence: `author-freeze-v2.json`, matching post-freeze and
`final-readback-v2.json` in its evidence directory. All previous reds are kept.

The v2 affected26-command matrix completed under two supervised runtime lanes,
actual matrix exit0 and all26 child exits0/null. It records2432 passing cases
and2 explicit native-Windows skips on WSL, not Windows passes. All26 owned
workspace paths are absent and scratch-before-cleanup inventories are empty;
primary independently verified every raw log hash. Its test inventories use
independent directory enumeration and `rg --files`; all1885 source hashes/modes
matched before/after every command. The first supervisor
preflight failed before any test because `/usr/bin/rg` was not present; using
the actual discovered installed executable fixed only that harness assumption.
The red is retained in `matrix-start-red.md`. This is v2 regression evidence;
the configuration-drift correction below still requires affected verification,
fixed-candidate review and remote CI before delivery.

### Primary configuration-drift correction, v3

Primary independently reproduced a misleading repeat-setup result for both
clients: removing the owned Stop registration makes `status` correctly return
`blocked/configuration_changed`, but repeat `setup` still returns `active`.
The external probe exited1 with owned scratch removed; the raw result and
supervisor receipt are `repeated-setup-probe.json` and `repeated-setup-red.json`
in the primary evidence directory. This is an A2/A3 reporting defect, not an
authorization bypass. The author implemented a narrow correction to check the
existing native registration before reporting an active repeat setup, without
repairing settings, changing consent or replacing identity. Source and installed
regressions prove configuration drift refuses and unchanged repeats remain
idempotent. Repository edits waited until the v2 matrix finished. Retained new
source and installed reds exited1 (33/37 and6/8); both final runtime lanes now
pass37/37 source and8/8 installed, actual0/null, owned scratch removed. Primary
reran its original independent reproduction: both clients now return
`configuration_changed`, actual0/null with cleanup verified. The v3 freeze keeps
17 author paths /1885 source entries; only5 paths differ from v2 (the narrow
runtime check, source/installed tests+fixture, and explicit Codex rearm-ancestry
clarification in the operator guide). All18 dependency entries are unchanged.

Primary rebuilt v3 with191 members/189 source hashes,387136 bytes, SHA-256
`26e59ee79b6847231acf0661382811f42c6e79bd2d85a7abd683aa369fe4e173`.
The independent installed acceptance now additionally removes an owned hook,
checks repeat-setup refusal without settings/identity/SQL changes, restores only
its own synthetic fixture, and proves an unchanged repeat remains active. Both
Node versions passed this complete CLI/archive/native-discovery path, actual
child/supervisor0 and owned scratch removed. Evidence is
`installed-setup-*-v3.json` / `independent-installed-*-v3.json`. The full26-command
v3 matrix completed at17:15UTC, actual outer0 and all26 child exits0/null.
Across both Node versions it records2444 passing cases,0 failures/cancellations
and2 explicit native-Windows skips. All26 scratch inventories were empty and
their owned paths are absent. Primary independently checked raw stdout/stderr
hashes, all1885 source hashes/modes and18 dependencies, actual audit exit0;
`primary-v3-audit.json` records that verification. This JavaScript repository
has no TypeScript/typecheck gate. The19 incremental paths match via git's
tracked/untracked inventory and an independent full filesystem/blob/mode
comparison against the fixed base. Fixed-commit independent review and CI
remain pending at this pre-commit checkpoint; their exact SHA/results belong
in the delivery PR rather than a self-referential commit edit.

### Native lifecycle observations (not complete capture or semantic acceptance)

The author and primary separately ran actual pinned Claude Code2.1.260
`--init-only` using an offline-installed artifact and its unchanged generated
SessionStart command. Restricted filesystem mounts, a fresh private HOME and
network/PID namespaces exclude real settings, transcripts and credentials.
Native process and the actual installed Node hook exited0. The OS trace confirms
the native payload has accepted fields and selects the approved source root;
the transcript is not yet present in this no-conversation mode. Therefore no
cursor or usage ledger is created, and quiet fail-open exit0 is not EOF proof.
Do not infer ordinary interactive-session behavior from this mode.

Primary v3 reproduction: `/tmp/cairn-native-claude-primary.HF7h4w/result.json`,
actual supervisor0, all owned scratch removed and17 source/18 dependency entries
unchanged. Only two localhost DNS port53 connection attempts were observed
inside the isolated namespace; no provider HTTP connection, turn, key or paid
request occurred. Native Stop capture and normal Claude interactive
initialization remain distinct gates.

For Codex, the author then ran the genuine pinned0.163.0 interactive TUI,
not an app-server with a synthetic originator. Its native transcript identifies
`source:cli` and `originator:codex-tui`. An isolated test-owned profile uses the
unchanged installed hooks plus a separately reviewed UserPromptSubmit blocker;
the documented one-invocation vetted-hook trust option is confined to that
disposable test. The installer and real-user trust/settings are unchanged.
The original deliberate Ctrl-C exit130 is retained, not counted as successful
native shutdown. The bounded harness correction uses orderly Ctrl-D instead;
native0/null and outer0 now establish actual native dispatch and one EOF cursor.

Primary read the complete external script and independently repeated it against
the same immutable v3 archive. All six install/qualification/init/setup/activate/
native commands exited0/null, with no timeout; native SessionStart and
UserPromptSubmit payloads reached the actual installed hook. Exactly one cursor
and one claim exist. Cursor35086 is a native record boundary, ordinal0 and no
pending batch; the final35391-byte transcript adds only task completion after it.
The synthetic blocked prompt is absent on both sides of the cursor, so this is
**not** accepted-prompt retention, Stop capture or model-quality evidence.
No provider key/server or usage ledger exists; the two observed IPv4 attempts
are loopback, not the configured unreachable provider endpoint. Their internal
purpose is not asserted. All owned scratch was removed; source/dependency
identities remained unchanged.

Primary raw evidence: `/tmp/cairn-native-codex-primary.hkG7ob/result.json`,
SHA-256 `2020ce2c9cd2f3754a376632f6a182c8c0225d8b81804bcba7df559b602c76f9`,
plus `independent-native-codex-v3.json` in the primary evidence directory.
The reproducible external script is
`/tmp/cairn-native-codex-tui-author.qaxuMj/codex-tui.mjs`, SHA-256
`93bf41d760b83c552af23b35431b4b666dbc381162fa8e40285ffd7e2c2e3bda`.
Neither isolated native observation uses a paid model request or the user's data.

### First fixed-candidate review and correction

Candidate `00107e7ff1ffaece4526a01623342f521824a28a` contains one incremental
commit/19 paths. Its189 packaged source hashes match the committed blobs;
independent complete-tree comparison confirms33 commits/269 paths against
current main, including the dependent stack rather than33 new work items.
Primary's six exact-commit source/installed/black-box commands passed on both
runtimes, actual0/null; all raw-log hashes and owned cleanup were verified.

Independent GPT-6.1 Sol/high nonauthor reviews on that exact diff report:

- Standards (`raw_worker_standards61`): zero actionable documented-rule or
  significant heuristic findings.
- Spec (`raw_local_host_spec61`): one P2. Owned registration validation ignores
  the group's matcher. A `SessionStart` group restricted to `resume` can still
  report active for new sessions. This violates unconditional initialization
  and drift reporting, not the SQL authorization boundary.

Primary reproduced actual status, repeated setup and repeated activation for
both clients: all three incorrectly report active after that matcher change.
`matcher-drift-red.json` and its supervisor record actual exit1 with settings/
SQL preserved and owned scratch removed. The reviewer's earlier stdin-harness
failure occurred before fixture execution and is not the reproduction.
The candidate was not pushed. The author owns the bounded correction: accept
only the generated unconditional owned group/foreground hook semantics, reject
unsupported modifiers without repair, preserve unrelated groups/handlers, and
add source/installed drift regressions. Affected checks, primary reproduction
and both independent axes must pass a new fixed candidate before delivery.

The separate genuine Claude2.1.260 interactive probe also completed, but not as
a native lifecycle pass: isolated keyless startup exits1/null with
`api.anthropic.com:ETIMEOUT` before any hook or auth UI. No transcript, cursor,
claim or usage is created. The probe/verification exits0 merely record that
bounded unavailable result. Five preparation commands passed; all1885 source/
18 dependency entries were unchanged and owned scratch was removed. Native
normal-startup transcript timing remains unknown. Primary inspected the entire
script and evidence at `/tmp/cairn-native-claude-tui-author.o0F9gY`; no auth or
network workaround, provider server or paid call was attempted.

### Corrected owned-registration semantics, v4

The only v4 runtime change retains the owning group alongside each exact owned
command and validates the closed generated shape: group has only `hooks`, and
the owned hook has exactly command/type/160-second timeout. Conditional matchers
and extra modifiers refuse all three active observations. Unrelated hooks can
share the same array; unrelated matched groups retain their settings. No repair,
SQL grant, identity rewrite, host/worker/core/provider or disable change is added.

The worker's source47/installed10 cases pass on each runtime, all four child
and supervisor exits0/null, no leftover scratch. Pre-fix source39/47 and
installed8/10 reds are retained with actual exit1. Primary checked all raw log
hashes and before/after freezes:1885 source entries,18 unchanged dependencies,
and exactly five changed non-planning paths from v3 (predicate, two tests,
guide and limitations). See `final-readback-v4.json` in the author evidence.

Primary's unchanged actual matcher reproduction now exits0 for both clients,
with all status/setup/activate observations refusing and cleanup verified.
The new independent installed modifier check first failed against the immutable
v3 archive (`modifier-installed-red-supervisor.json`, actual1), then passed
against the rebuilt v4 archive on both Node versions. It exercises matcher and
owned-hook modifier drift through every public CLI action, checks unchanged
settings/identity/SQL, restores only synthetic fixture settings, and verifies
the original positive lifecycle. Each inner/supervisor exit0 and owned scratch
is removed. Results: `installed-setup-v4-*.json` /
`independent-installed-v4-*.json` in the primary evidence directory.

The final retained preview archive has191 members/189 source hashes,387633bytes,
SHA-256 `63d99613b1d2aa120b153d13e09fe87462f50c85029536827f039e7f010db772`.
Its archive and independent installed-filesystem inventories match. It is a
private build output, not a registry publication.

The supervised v4 affected matrix contains12 commands: full local-host, full
artifact, workspace lifecycle, validation and both host/transport import gates
on both Node versions. This targets the changed registration predicate, all
installed callers/closure and cleanup. The earlier full26-command v3 baseline
is retained separately; it is not relabelled v4. The broader final-head CI will
also run before delivery. The original native TUI observation belongs to the
v3 archive and unchanged hook path; current v4 black-box acceptance independently
checks native discovery, not a new native accepted-turn/Stop claim.

The v4 affected matrix completed at17:32UTC: all12 child exits0/null and outer0,
636 passing cases,0 failures/cancellations and2 explicit native-Windows skips.
Primary's separate audit exited0 after verifying every raw log hash, the12
absent owned workspace paths and empty scratch inventories, all1885 frozen
source entries and18 dependencies, both independent installed acceptances and
the original matcher reproduction. `primary-v4-audit.json` records that audit.
The final correction candidate is now frozen for exact-commit primary reruns,
renewed Standards/Spec review and remote CI; their final SHA/results will be
recorded in the PR. No candidate has been pushed at this checkpoint.
