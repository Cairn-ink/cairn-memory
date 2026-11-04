# Local Raw journal, capture, lineage, deletion and sources

These are the local mechanisms in
[the V1 plan](plans/raw-local-v1-completion.md), not completed installed-client/hosted
Raw V1. They are default-off and authorized only for pure-local synthetic
development and tests. P2 joins the existing bounded capture engine; P3c adds
explicit Raw references and authored Cards through the same private engine.
The explicit public constructor and private artifact now compose those same
mechanisms. The separate opt-in retained profile now exposes bounded MCP
inspection and authored Raw-backed Cards, as described below; the constructor
alone adds no MCP tool, client hook, hosted encryption or production enablement.
Ordinary public capture keeps its existing wire contract.

## Explicit standalone foreground setup preview

The private archive has a separate default-off `cairn-memory local` operator
path for Claude Code or qualified Codex, initially Linux/WSL + Node >=22.16.
It leaves released hosted hooks and `packages/setup` defaults unchanged.
SessionStart initializes verified EOF; Stop/PreCompact may hold the foreground
hook for up to 160 seconds (existing host 155 seconds plus teardown). Codex also
gets an idempotent UserPromptSubmit first-observation fallback: it does not reset
existing cursors on every prompt. No long SessionEnd hook, detached worker,
daemon or retry queue is installed. Hook stdout is empty even on refusal;
internal status objects are never model context.

```sh
cairn-memory local init --database /absolute/private/new-memory.sqlite
cairn-memory local setup --request /absolute/private/setup-request.json
cairn-memory local status --installation /absolute/private/claude-installation
cairn-memory local activate --installation /absolute/private/claude-installation
cairn-memory local disable --installation /absolute/private/claude-installation
```

These are explicit operator actions. `init` exclusively creates a new 0600 file
under an existing private 0700 parent and opens the public Raw-off core to create
schema 29. Every existing file, empty file or symlink refuses unchanged; it never
migrates an old database. A failed init can leave its owned incomplete new file,
not permission to overwrite/retry. Init creates no owner usage row, capture grant,
conversation or synthetic event. The selected owner's cap persists on its first
real capture. Setup itself remains existing-schema-29-only.

The 0600 request is bounded UTF-8 JSON (64 KiB) with exactly these fields:

```json
{
  "version": "local-raw-setup-request-v1",
  "installationDirectory": "/absolute/private/claude-installation",
  "databasePath": "/absolute/private/new-memory.sqlite",
  "namespace": {"ownerId":"chosen-owner","scope":"personal","projectId":null},
  "client": "claude-code",
  "sourceRoot": "/absolute/approved-transcript-root",
  "clientConfigPath": "/absolute/private-native-settings/settings.json",
  "usageRoot": "/absolute/private-shared-usage",
  "installation": {"pluginRoot":"/absolute/selected-claude-plugin-root"},
  "rawMode": "local-plain-v1",
  "rawCapBytes": 1000000,
  "dailyCap": 20,
  "providerApiKeyEnv": "OPENAI_API_KEY",
  "interpretationConsent": true,
  "plaintextRawConsent": true,
  "foregroundConsent": true
}
```

For Codex select `client:"codex"`, its explicit native `hooks.json`, a different
installation directory, and `installation:{"qualificationConfigPath":
"/absolute/private-codex/installation.json"}` instead of pluginRoot. Select an
already-qualified private profile/cache. Setup does not launch or auto-qualify
a native binary. The existing installed operator API is explicit:

```js
// Use the selected supported Node. First create the chosen private parent and
// 0600 installation.json separately; do not borrow the active user's HOME.
const q = await import('/absolute/offline/node_modules/cairn-memory-local-preview/integrations/codex/qualification.mjs');
const configPath = '/absolute/private-codex/installation.json';
const binaryPath = '/absolute/chosen/bin/codex';
const host = { binaryPath, identity:await q.binaryIdentity(binaryPath), kind:'cli' };
const verdict = await q.qualifyBinary(configPath, host);
console.log(verdict.status); // Proceed only with an actually qualified verdict.
```

That probes schema/format, not a capture turn or provider request. Actual hooks
still bind the running ancestor binary, cached identity, interactive source
header/session and qualified creator; exec sessions refuse. Missing evidence
reports `qualification_required`, not fabricated support.

Paths must be explicit normalized absolute selections. Source root, native
settings parent, database parent and shared usage directory must already exist;
private parents are 0700. Sources cannot overlap database, installation, native
configuration, qualification/plugin metadata or usage state. Symlink/foreign
paths and forged events refuse. Activation and fresh SQL permission precede
source contents. Native turn/agent/task/cron metadata is inert, not execution
or consent authority. Only the selected session/source fields reach the host.

Interpretation/provider-processing consent, plaintext Raw consent and foreground
latency consent are separate. For explicitly consented interpretation without
plaintext retention choose `rawMode:"off"`, `plaintextRawConsent:false`.
Declining required consent creates no installation or grant. Only an environment
slot name (`OPENAI_API_KEY` or `CAIRN_*_API_KEY`) is stored, never a credential.
Setup/status/disable and acknowledged replay need no key. Real new interpretation
reads that slot in the native process. Child HOME is the installation-owned
`installationDirectory/home`, never inferred from active HOME or hook payload.

Both clients for the same store/namespace must share one existing private
`usageRoot`, daily cap and Raw cap. Its `local-setup-budget.json` binds the actual
store/namespace, one target and both limits; cooperative DB-adjacent/shared-root
locks serialize installers. Foreign sibling targets, changed caps or a new
usage root for already-bound controls refuse rather than fork a quota. Daily cap
counts model-port invocations, not USD. Counters, thresholds and uncertain-call
no-refund behavior are unchanged.

Setup journals intent, grants through actual public SQL controls, prepares the
existing host identity and remains inactive. Activation preserves unrelated
native JSON values/handlers, refuses hosted Cairn conflicts/concurrent edits,
then publishes active last. It changes no trust, managed policy, global switch,
credential or shell startup file. Ambiguous partial state reports
`recovery_required`, never silent identity regeneration. Status is read-only;
it does not take a setup lock or repair state. Disable revokes SQL first, then
removes only exact owned registrations; cleanup failure cannot authorize stale
hooks. Data, keys and cursors remain.

An active observation or unchanged repeat setup/activation requires every owned
registration to retain its unconditional foreground shape: the owned group has
only `hooks`, and its owned command hook has exactly `type:"command"`, the fixed
`command`, and `timeout:160`. A matcher or extra group/hook modifier refuses with
`configuration_changed`, without repair, a new grant or identity changes.
Unrelated hooks in that array and unrelated groups keep their own options.

Activating after disable may grant fresh SQL consent but stays
`rearm_required`, not active capture. Use the existing explicit host rearm for
each admissible selected session, then activate again:

```sh
node /absolute/offline/node_modules/cairn-memory-local-preview/integrations/client/raw/local-host-cli.mjs --profile /absolute/private/claude-installation/host-profile.json rearm-status
node /absolute/offline/node_modules/cairn-memory-local-preview/integrations/client/raw/local-host-cli.mjs --profile /absolute/private/claude-installation/host-profile.json rearm --expected-revision 0 --action-id aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa --session CHOSEN_SESSION --source /absolute/approved-transcript-root/selected.jsonl
```

For Codex, the actual `rearm` command must run beneath a currently running,
qualified, non-exec native Codex CLI/app-server process. A normal terminal plus
a cached qualification does not supply that ancestry and refuses; the shell
examples above do not bypass it. `rearm-status` only observes action metadata and
does not require native ancestry. If native-owned command execution is unavailable,
leave rearm refused rather than disguising the host or replacing identity.

Rearm preserves key/session/ordinal, skips its frozen complete paused EOF and
refuses deleted/incomplete/unknown boundaries. Zero-history recovery may remain
unsupported; do not delete/recreate identity to bypass it. Existing bounded
predecessor/exact-action replay limits remain. Synthetic installed evidence
separates exact quiet/keyless generated-command execution from provider capture
through trusted test-only HTTP/ancestry instrumentation. Neither claims real
native provider-backed hook execution or semantic quality; native, paid/model
and product gates remain separate.

The isolated pinned Claude Code 2.1.260 `--init-only` probe dispatches the real
installed SessionStart hook before its transcript exists; quiet exit 0 is not
EOF initialization proof. A separate normal interactive, keyless/network-isolated
probe exited 1 at the native Anthropic connectivity preflight, before any hook,
transcript or cursor. Normal interactive transcript timing therefore remains
unverified; neither result authorizes an authentication/network workaround.

## Explicit public constructor (P4b-B1)

`openMemoryCore({path, model?, privateCards?, rawConversations})` accepts the
closed option `{mode:'raw-v1'|'off', port?, capBytes?, configureCap?, readPolicy, localAuthority?}`. Omission
keeps the ordinary facade. Explicit undefined/null, unknown properties, symbols
and accessors refuse before opening or migrating SQLite. Enabled mode requires
an explicit positive safe-integer cap and a `raw-seal-v1` port with both
`sealRaw` and `openRaw`. Off mode may omit cap/port; an explicitly undefined
cap/port is invalid. Omitting the cap when reopening preserves durable usage/cap.
The optional own-data boolean `configureCap:false` also preserves every existing
owner cap when an explicit initial cap is supplied. A new owner still receives
that initial cap; another connection's stored cap decrease remains authoritative.
Omission or true retains existing explicit-cap administrative reconfiguration.
An explicitly undefined/nonboolean value refuses before database open.

The trusted synchronous `readPolicy({namespace,client})` returns
`{generation,reason}` at registration preparation/commit. Constructor validation
establishes callability, not callback purity; invalid/Promise results refuse at
the existing registration boundary. Class port methods retain their original
receiver and opaque host state; validated method references/configuration are
snapshotted without invoking accessors or copying key material. Both capture
and retained reads sanitize port failures; no decoder is guessed when absent.

The selected facade adds `captureRaw`, `listRawConversations`, `getConversation`, `getRawUsage`,
`getRawCaptureControl`, `setRawCaptureControl`, `fenceSession`,
`previewDeleteConversation`, `deleteConversation` and `listRawEffects`, using
the camel-case core DTOs below and the existing result envelopes. This is not
an HTTP v2 acknowledgement. Raw saving and Memory interpretation remain
separate; continuation-only capture invokes no model. Retained reads/deletion
work in off mode and do not ask capture policy or invoke a model.

Public selection installs lineage, deletion, source prerequisites and local
control storage (additive schema 29). It exposes Raw source resolution only with
valid `privateCards`. Its existing opaque per-call authority still gates Raw source
reads and explicitly authored Cards; Raw alone adds no Card authority or
automatic promotion. With no Raw option, existing capabilities remain unchanged.
The private archive contains this public import closure, but not the internal
compatibility wrapper. Installed programmatic synthetic lifecycle tests are
not installed Claude/Codex capture, setup, transport, cursor or MCP acceptance.
The [bounded skipped-tail correction](limitations.md#public-raw-constructor-p4b-b1)
covers ordinary pause/resume with known identities; lost-client-state recovery
and complete installed-hook acceptance remain separate.

## Existing-store discovery and retained MCP

The optional `existingStore:{version:'schema29-existing-v1',storeId}` selects an
actual existing-only SQLite connection: no missing-file creation, initialization
or schema migration. It requires the exact application/schema 29/store identity
and necessary structural metadata. Ordinary construction remains unchanged;
this option is not blanket read-only access or full hostile-DDL attestation.
Explicit trusted SDK cap configuration remains explicit. The retained MCP host
instead supplies `mode:'off',configureCap:false` and no cap, changing no quota.

The synchronous public `listRawConversations({namespace,client,limit?,cursor?})`
needs no Card capability. It selects an exact namespace and `claude-code` or
`codex`, defaults to 20 and permits at most 50 items. Existing session-key index
order, not chronological order, uses keyset pagination and at most 51 SQL rows;
there is no history count or join. The signed cursor binds store, namespace,
client, limit and deletion epoch. Reuse all bindings, or start a new listing
after a stale cursor. Results include metadata, `nextCursor`, `complete`,
`budget_exhausted` and `evidenceTrust`; metadata is not saving/completion coverage.
`getConversation` still computes aggregates: bounded output is not a constant-time
large-history read guarantee.

The separate [retained-profile MCP and terminal guide](private-card-terminal-review.md#retained-raw-profile)
shows the closed private profile and public list/read/resolve/draft/review/cold-read
workflow. It uses the existing Raw/Memory/Card engine without fake Memory,
automatic Cards, capture or a provider. The owner-selected profile is retained
read authority, not B3 capture configuration or a capture `readPolicy` grant.
Only Linux/WSL and Node >=22.16 are supported initially. Ordinary MCP and the
B4c capture host keep their independent defaults and authority boundaries.

## Durable local authority (B2b)

The explicitly Raw-enabled trusted facade adds these synchronous model-free
operations, with existing success/error envelopes:

```js
core.getLocalCaptureControl({ namespace, client });
core.setLocalCaptureControl({ namespace, client, targetId, expectedStoreId,
  expectedRevision, automaticCaptureEnabled, rawNoticeVersion });
```

`client` is `claude-code` or `codex`; notice is null or `local-plain-v1`.
Values are `{storeId,targetId,client,revision,automaticCaptureEnabled,
consentGeneration,rawNoticeVersion}`. Absent state is disabled, revision zero,
target null, consent generation `initial` and notice null; reading creates no
row. Explicit first mutation binds the opaque target ID and generates a real
consent generation, even for a declined grant. Exact CAS no-ops preserve both
revision and generation. Real mutations advance revision; consent changes
rotate generation, notice-only changes do not. Store/revision/target mismatch
returns `revision_conflict`; target replacement is unsupported in this packet.
Controls affect only the supplied exact namespace/client, even when another
boundary uses the same target label. The trusted host authenticates the owner.

Managed workers select this additional constructor option:

```js
rawConversations: { mode: 'raw-v1', port, capBytes, readPolicy,
  localAuthority: { version: 'local-capture-authority-v1', targetId, storeId,
    namespace, client, expectedControlRevision, expectedConsentGeneration,
    expectedNamespaceGeneration, expectedRawRevision } }
```

The snapshot and its canonical namespace are copied/frozen before opening the
database. Explicit undefined/null, unknown fields, symbols, proxies and
accessors refuse `invalid_input` without invoking getters. Managed capture
also checks its nested request/context/message/part DTOs as own-data values.
The snapshot must match current SQL authority before host policy/sealing,
after asynchronous sealing and in registration's transaction. Missing/disabled
consent is `capture_disabled`; stale bindings/revisions are `revision_conflict`.
The worker never adopts a newer snapshot implicitly. Omission preserves trusted
unmanaged library behavior; an installer must never use omission as fallback.

Managed event identity binds exact target/store/boundary/client and consent
generation while preserving legacy unmanaged digest bytes. Admission/replay
and episode attempt start/commit enforce the stored binding; a later unmanaged
facade cannot drop it. Consent revocation or disable/re-enable ABA fences late
Memory/episode publication with `capture_evidence_closed`. The episode fence
uses the attempt's recorded watermark event rather than a newer grant.
Revocation preserves previously completed evidence and makes no cancellation
or provider-refund promise.

Raw notice and Raw saving remain independent of interpretation consent.
Notice revocation closes exact-target pending saving reservations once with
`notice_required`, retaining saved prefixes and immutable receipts. Received
suffixes remain gaps after re-acknowledgement and must advance normally before
a later ordinal; notice is not EOF. Consent revocation closes that namespace/
client's pending and policy-skipped tails with `capture_barrier`. These saving
closures include existing unmanaged tails under the same boundary, while only
managed Memory work acquires a consent publication guard. Raw switch changes
retain the existing owner/client scope and `tool_off` behavior. Neither notice
nor Raw-only off cancels independently eligible admitted Memory/episode work.

Explicit public Raw construction transactionally creates/upgrades supported
stores through optional schema 29, including schema28 prerequisites even when
Card methods remain disabled. Missing/partial claimed layouts refuse and failed
upgrades roll back. Feature-off current writers validate and preserve29 without
granting consent or exposing controls/Card/source operations. Internal synthetic
constructors retain their separately selected24–28 layouts. B2b by itself adds no actual
installer, hook, transport, credential/provider policy, cursor or operational
migration. Synthetic programmatic installed tests do not complete local V1.

## Explicit local host (B4c)

On Linux with Node >=22.16, the private artifact includes
`integrations/client/raw/local-host-cli.mjs`. This foreground entry uses one
existing schema29 store and explicitly owner-selected source/session. It grants
no SQL consent, Raw notice, provider access or native-hook attestation. The
digest-bound B3 configuration remains the only store/target/namespace/client,
generation, provider and usage configuration. Runtime and Node come from the
installed module and running process; a profile cannot override either.

The private0600 profile has exactly these fields:

```js
{ version:'local-raw-host-profile-v1',configPath,configDigest,stateRoot,
  identityKeyPath,home,installation }
// installation is exactly one of:
{ client:'claude-code',pluginRoot }
{ client:'codex',qualificationConfigPath }
```

All paths are normalized absolute paths. Profile/config/key/state parents and
home must already be private0700 directories. State/key must be separate new
leaves and may not overlap configuration, preparation/rearm sidecars, database or usage paths,
including through ancestor aliases. `configDigest` is SHA256 of the exact UTF-8
configuration text read by the bounded private reader. Codex's existing private
qualification configuration/cache location and Claude's owned installation
directory must exist. No provider credential is read by status, preparation or
initialization; the existing one-shot adapter looks up its selected environment
credential only when eligible model work is required. Completed replay can remain
keyless. An installation key is always required for established state.

From the installed package directory, the complete CLI grammar is:

```sh
node integrations/client/raw/local-host-cli.mjs --profile /private/profile.json status
node integrations/client/raw/local-host-cli.mjs --profile /private/profile.json prepare
node integrations/client/raw/local-host-cli.mjs --profile /private/profile.json initialize --session SESSION --source /private/source.jsonl
node integrations/client/raw/local-host-cli.mjs --profile /private/profile.json run --session SESSION --source /private/source.jsonl
node integrations/client/raw/local-host-cli.mjs --profile /private/profile.json rearm-status
node integrations/client/raw/local-host-cli.mjs --profile /private/profile.json rearm --expected-revision 0 --action-id 00000000-0000-4000-8000-000000000001 --session SESSION --source /private/source.jsonl
```

Initialization defaults to a verified complete-record EOF, with no historical
backfill. Only initialize accepts `--start beginning` or `--start eof`; beginning
is an explicit owner-selected import. Each run is a separate bounded invocation,
never an internal drain/retry loop. No stdin hook/MCP payload is accepted. Claude
uses the profile-bound plugin root and explicit owner selector. Codex checks the
running host, bound binary and existing qualification cache, then its permitted
source header/creator; missing qualification and automation refuse without a
probe or hosted fallback.

Status is nonmutating and never reads a transcript or qualifies a host. Prepare
serializes on `profilePath+'.prepare.lock'`, publishes a durable creating intent
at `profilePath+'.prepared.json'` before creating any identity, then creates a
new0700 state root,0600 random installation key and compatible B4b root/sessions.
The ready marker binds the profile/config/authority/key and root inode. Complete
unchanged preparation is idempotent; creating/partial/lost/foreign state refuses
without repair. The marker lives outside key/state so their loss stays visible.
Ordinary preparation/initialization/run never clears blocked sessions or refreshes
authority. The separately explicit rearm operation below has a narrower boundary.

Programmatic trusted callers import `createLocalRawHost` from
`integrations/client/raw/local-host.mjs` with `{profilePath}`. It exposes
`status({signal?})`, `prepare({signal?})`,
`initialize({sessionId,sourcePath,start?},{signal?})` and
`run({sessionId,sourcePath},{signal?})`; DTOs are closed own-data objects and
signals must be native AbortSignals. Results have exactly
`{version:'local-raw-host-v1',status,reason,worker}`. `worker` is null or the
unchanged B4b summary. Host readiness is not saved coverage or completed Memory.
Raw retention and Memory interpretation remain separately observable.

### Explicit authority-only rearm

After an operator has already re-enabled the authoritative controls, a trusted
caller may invoke `rearmStatus({signal?})` and
`rearm({expectedRevision,actionId,sessionId,sourcePath},{signal?})`. The CLI tokens
above are fixed and ordered; revision is a canonical nonnegative safe integer,
and action ID is a canonical lowercase UUIDv4. These operations never set controls,
look up a provider key, grant retained-read authority or enable automatic hooks.

Codex actual rearm (including replay/recovery) rechecks its real native process
ancestry, identity-bound qualification and interactive source header. It cannot
be authorized from an unrelated ordinary shell merely by selecting the profile;
metadata-only `rearmStatus` remains usable without that host. No host substitution
or automatic qualification is implied by the CLI grammar.

Both new result DTOs have exactly `{version,status,reason,revision,pending}`.
Versions are `local-raw-rearm-status-v1` and `local-raw-rearm-result-v1`;
status is ready/waiting/blocked/busy. Revision is the last completed global action,
not a pending successor; revision/pending may be null when state is unknown.
Success reports rearmed/replayed. A pending status reports rearm_pending and the
prior completed revision. Existing host DTOs and CLI exit conventions are unchanged.
Rearm status reports action metadata readiness only: it does not refresh SQL
permission or prove controls are currently enabled. Ordinary host status and an
actual rearm invocation check permission separately.

Revision 0 observes no global action record alongside valid preparation. It is
not proof that rearm never happened: the unchanged preparation marker has no
historical sentinel, and status does not enumerate sessions. A selected session
with a committed receipt/positive revision refuses if global history is missing
or older. Rearm cannot repair lost history or lower/reuse that known revision.

Rearm requires the same store, target, namespace, client, installation key/root,
session/wire identity and issued ordinal, with genuinely changed enabled authority.
All non-authority configuration values and optional-field presence stay unchanged,
including duplicate policy, provider, usage, database, Raw settings and timeouts.
Changing configuration/policy by hand is not rearm. Partial preparation or lost
claims/keys/root/cursors still refuses without identity regeneration.

An unblocked pending-null cursor needs exact authoritative SQL high-water and
first-part/event/admission ownership. A pending continuation is eligible only
after its original bounded source/planner binding is proved and SQL records its
message closed by capture_barrier/tool_off, with zero reservation and a completed
first interpretation or explicit no-eligible-first-part result. Missing admission
alone is not success. First-part, incomplete/processing, unknown/deleted, quota,
exhausted and other blocked work refuses; no closed suffix or old interpretation
is retried. Earlier deliberate discards require their recognized committed receipt.

Each action freezes one complete EOF, verifies the same source inode/old anchor,
and skips to that exact boundary without scanning paused content for case A.
Claude waits for a fresh user boundary, as at EOF initialization. Same-action
recovery/replay never selects a newer EOF after append; after later capture it
does no cursor/config publication or additional model work. Superseded requests
refuse. Keep the action ID and expected revision to resume that exact action.

One global predecessor authority pair permits separately selecting another
one-generation-behind session with its own SQL/source proof and frozen EOF.
A later authority transition replaces that predecessor; older or unknown
authority refuses. There is no bulk cursor migration or unbounded history map.

Global pending intent gates new host starts. Per-session pending receipts also
gate direct workers under their session lock before source access; committed
receipts bind positive cursor rearmRevision in both directions. Omitted revisions
remain valid only for untouched sessions without rearm artifacts. A terminal
session receipt is durable before config/profile/preparation activation and
permanently forbids that action from rewriting its cursor, even if a direct
worker subsequently progresses while global recovery is pending. Unknown third
states refuse; ambiguous writes are inspected, never rolled back blindly.
Normal runs do not hold the global preparation lock across their execution.

Every actual rearm, recovery and completed-action replay checks the exact selected
session's SQL deletion fence, independently of capture-control versions. The
shared publication proof checks it after awaited source verification, including
terminal-session/global-pending recovery; fresh intent publication also rechecks.
A deleted/fenced session returns rearm_refused without another cursor or activation
publication. An interrupted action stays visibly pending: no cancellation, rollback
or repair is inferred. Metadata-only status may still report that pending action,
or an earlier completed revision; it does not authorize resuming deleted work.
Historical admission/high-water checks are not repeated against a legitimately
progressed terminal cursor. SQL checks and subsequent filesystem writes are still
separate operations, not an atomic deletion/publication transaction.

Direct workers now refresh configuration and actual SQL permission under their
session lock before source access. Even a no-work invocation refuses after real
revocation; eligible legacy cursor encoding remains unchanged. Normal runs do
not acquire the rearm historical SQL ownership checks.

Sidecars remain private files below 64 KiB in owned 0700 directories. Source
opening retains Linux owned-regular/no-symlink checks, not a new transcript 0600
requirement. Case A uses content-free stored ownership consistency, not Raw
decoding or historical source-file attestation. Case B retains the 32 MiB record,
128 MiB aggregate-read, scratch and deadline ceilings. SQL and filesystem reads
cannot form one transaction; already-read bytes/dispatched costs cannot be undone.
The 4 KiB source anchor does not authenticate every historical byte. This is
synthetic-tested infrastructure, not native client activation or completed V1.

CLI exits are0 for ready/progress,3 for waiting/busy,2 for blocked and1 for an
unexpected sanitized failure. Caught INT/TERM/HUP exit130/143/129 after child
teardown. The nominal155-second budget includes preflight and reserves teardown;
actual child close is awaited even after the deadline. Confirmed ready/progress
is preserved if cancellation races its return. Other worker outcomes may carry
an outer work_limit/cancelled reason with unchanged nested pending/progress.
Content-free reasons distinguish profile/config/store/preparation failures,
capture_disabled, authority_changed, unavailable/unqualified runtime/host/source,
invalid_input and the existing worker reasons. No path, session ID, source text,
credential or raw exception prose is returned.

This is synthetic private-artifact capture integration, not automatic client
installation, a retained-source MCP/Card review interface or completed V1.

## Durable local worker (B4b)

Trusted local callers may explicitly import `createLocalRawWorker` from
`integrations/client/raw/local-worker.mjs`. Closed options are `stateRoot`,
`identityKeyPath`, B4a's explicit `nodeExecutable`, `runtimeRoot`, `configPath`,
`expectedAuthority`, `home`, and optional `env`. No automatic host imports it.
The caller supplies freshly authorized `sessionId`, `sourcePath`, `pluginRoot`
and `formatAuthority` to both `initialize(context,{signal})` and
`run(context,{signal})`. Claude requires its trusted absolute plugin root and
null format authority; Codex requires null plugin root and its existing exact
qualified format DTO. Config/full authority is checked before opening source;
this library does not independently grant consent or discover transcripts.
Future hooks must establish current permission before supplying a source.

The private state root and0600 key file must already exist. The key is exactly
32 bytes encoded as64 lowercase hex characters, optionally one newline. Explicit
initialize binds `root.json`, an immutable per-session claim and a separate
closed cursor under existing process-owned locks. Normal run never initializes
or repairs them. Lost established cursor/key/root refuses rather than starting
over; missing root with nonempty sessions cannot be adopted. Purpose-separated
HMACs bind target/store/namespace/client/session without exposing raw identities.
Shared and generated lock acquisition uses monotonic time; ownership still
depends on process liveness, never elapsed lock age.
The persisted pending projection omits raw sessionId, messageId, projectId and
occurredAt; fresh preparation reconstructs all four and verifies the complete
planner identity. Wire identity and issued ordinal do not rotate with a source
path, credential or supplied generation change.

Initialize defaults to verified LF-terminated EOF (or an empty file); explicit
`start:'beginning'` is for authorized synthetic/import use. Partial EOF waits
without arming. Claude's EOF state excludes assistant output until a non-machine
user boundary, including an empty user record. Reinitialization preserves the
existing offset and any visible block. Run streams existing selection and whole
message redaction, reserves an ordinal/pending before dispatch, and advances a
part only on a strict completed reply plus fresh source proof. Final part alone
advances record/selection. Excluded records require the same stable commitment
proof and consume no ordinal. Complete200 Raw skips advance with skipped counts,
not saved-coverage claims; incomplete interpretation never advances.

Each invocation is bounded by155000ms including teardown,64 completed records,
32 transport parts,32MiB scan span/record and128MiB total source reads. The
remaining budget is passed to B4a, not restarted per part. Full-range proof plus
8192 anchor bytes and, for Codex,65537 header bytes is reserved before dispatch.
Insufficient budget leaves prepared pending without spending an attempt; these
are ceilings, not a guarantee every allowed record or32 parts fit one run.
Appends are allowed. Reopened inode/device, a keyed4096-byte completed-offset
anchor and the complete pending range must still match before advancement.

Processing or uncertain delivery preserves the same event. Recovery occurs
only on a new invocation, at most one submission in that call and four total
submissions per event. Persisted eligibility is startedAt+280000ms before call,
or max(lastAttemptAt,observedClose)+125000ms after observed close; rollback never
makes it earlier. These cooldowns do NOT prove an orphan died. Registered core
events observe completed/processing/incomplete without reacquiring interpretation;
an event never registered may acquire its first interpretation. Known no-PID
failure can retry the same pending next invocation under the same cap. Confirmed
refusals/source mutation stay blocked; the host's explicit rearm above accepts
only its proved authority-transition cases, not generic worker recovery/reset.

Results are frozen `local-raw-worker-v1` summaries with ready/progress/waiting/
busy/blocked status, fixed content-free reason, completed/dispatched record/part
counts, bytesAdvanced, hasPending, remainingWork, nextEligibleAt and per-call
savedParts/skippedParts. Counts describe observed acknowledgements, not unique
rows or semantic truth. The private archive runs this explicit worker through
B4a and B3; existing automatic Claude/Codex capture remains v1.

## Local process transport (B4a)

Trusted hosts may explicitly import `createLocalCaptureTransport` from
`integrations/client/raw/local-transport.mjs`; no automatic entrypoint imports it.
Its closed options select normalized absolute `nodeExecutable`, `runtimeRoot`,
`configPath`, `home`, a complete `expectedAuthority`, and optional `env` and
`deadlineMs` (3000–155000, default155000). `capture(request, {signal})` detaches
strict capture-v2 input before asynchronous work and returns only `{status,body}`.
Both clients and personal/project scopes use the same authority checks.

The transport snapshots private configuration, compares full canonical authority,
then runs only the selected executable's `--version` and fixed
`<runtimeRoot>/adapters/local/cli.mjs --config <path> --config-digest <sha256>`.
The child compares the digest before parsing or writable-store/key access.
The existing standalone `--config <path>` form remains valid. This commitment
hashes the private reader's UTF-8 text; it is not arbitrary raw-byte equivalence
or protection against same-user executable replacement. Pure transport/config
import does not load SQLite. Capture still needs an explicit stable supported
Node >=22.16, with no PATH fallback, runtime download or install-time search.

Each child gets only explicit existing owned HOME (0755 is allowed), fixed
PATH=/usr/bin:/bin, LANG=C.UTF-8, and, for capture only, the selected own-data
OPENAI_API_KEY or CAIRN_[A-Z0-9_]{1,96}_API_KEY value. The value is snapshotted
once after configuration selects its name, not at construction. Unrelated
environment properties are neither read nor forwarded. Missing keys permit
the existing keyless replay/continuation paths; unsafe names/accessors refuse.
HOME permissions are not modified; private config/usage validation is unchanged.

One monotonic deadline includes preparation and the <=2000ms version probe,
reserving2000ms for SIGTERM, escalation after1000ms and observed actual close.
Stdin is one bounded frozen JSON record plus EOF; stdout is strict UTF-8 and
exactly one JSON line (262144-byte limit). Stderr is drained without retaining
prose (65536-byte limit). Success requires stdin completion and actual exit0
before the work deadline. Valid bytes followed by a hang/nonzero exit refuse.
200/202/429 and incomplete Raw receipts use the existing strict acknowledgement
classifier. Only completed acknowledgements may support a future cursor advance;
processing, quota, incomplete interpretation and fixed-code transport errors
cannot. Errors expose only `local_capture_transport_failed` and `uncertain`:
false before capture launches, true once a capture PID may have performed work.
No cursor, retries, usage writes, alternate provider or host enablement is added.

## Local one-shot adapter (B3)

The private archive includes the opt-in POSIX entrypoint
`adapters/local/cli.mjs --config <absolute-private-file>`. It accepts exactly one
already selected/redacted strict capture-v2 JSON request on stdin followed by
EOF (65,536 bytes maximum). It reads no transcript and grants no consent. Both
`claude-code` and `codex` use the same managed engine; hosted/v1 paths, defaults,
hooks, setup and producer/cursor persistence are unchanged. Native Windows is
unavailable for this private-state adapter.

The closed configuration requires all of these fields:

```js
{
  version: 'local-capture-config-v1',
  databasePath: '/absolute/private/existing.sqlite',
  authority: { /* complete local-capture-authority-v1 snapshot above */ },
  raw: { mode: 'local-plain-v1', capBytes: 1000000 }, // or mode: 'off'
  provider: { profile: 'openai-baseline-v1', apiKeyEnv: 'EXPLICIT_KEY_ENV' },
  usage: { root: '/absolute/private/existing-usage', dailyCap: 20, concurrency: 1 },
  timeouts: { captureMs: 120000, processMs: 150000 }
}
```

The only additional optional top-level policy is
`captureQualifiedDuplicates:'append-matching-evidence-v1'`. Omission preserves
the existing configuration shape and strict qualified-source conflict behavior.
Explicit undefined/null, inherited/accessor options and other values refuse;
all seven fields above remain required. The adapter forwards only this validated
trusted value to the same v2 core, without changing producer wire, replies,
provider/model, usage caps or transport retry policy.

The [matching qualified evidence policy](capture.md#optional-matching-qualified-evidence)
allows ordinary automatic capture to append a new receipt only for exact
canonical content, matching seven labels and intact eligible original/incoming
sources. It keeps the original qualification and anchors, not a re-inference or
truth/reaffirmation judgment. Explicit/manual/ordered/episode writes remain
strict. Suppression, correction/forgetting and source deletion retain their
existing behavior; deletion can clear qualification so a later duplicate refuses
without implicit requalification. Already registered Raw events are not reopened.

Select the policy before preparing a fresh owned synthetic host. Adding/removing
it changes the exact configuration digest: an old profile refuses that config,
and refreshing its digest still cannot adopt the old preparation marker. No
rearm, historical backfill or state-reset permission is implied. This optional
policy is unrelated to the retained-read MCP profile, which enables no capture.

Paths must be absolute and normalized; config/store are owner-only regular
0600 files without symlink leaves, and the existing usage root is 0700. Config
is bounded to 64 KiB. Caps are positive safe integers, concurrency is 1–32,
captureMs is 1–120000, processMs is 1–150000, and captureMs cannot exceed
processMs. No arbitrary endpoint, model/profile, module, command or inline key
is accepted. The API-key environment variable is looked up only at the first
actual remote model port, never for planning, replay or continuation. The
existing OpenAI baseline/token/output bounds are unchanged.

After strict input validation and runtime module loading, a read-only preflight
checks private file identity across open, Cairn app ID, schema29, exact store ID
and the bound owner's existing cap. An unrelated owner's cap does not block the
target. Wrong/old/missing stores refuse without creation or migration. Writable
capture passes `configureCap:false`, avoiding implicit cap administration even
if another connection lowers a stored cap after preflight. These checks are
not a same-user filesystem lock: replacement after validation remains outside
that guarantee. The adapter never silently refreshes frozen authority.

Plain Raw preserves exact selected/redacted bytes; it is not encryption.
Notice may skip Raw while independently authorized Memory interpretation
continues. Each actual remote model-port invocation uses one durable api-key
runtime permit covering its count and generation HTTP calls. The usage target
is SHA256 of the JSON tuple `['local-capture-budget-v1', storeId, targetId]`;
both clients/restarts must use the same private usage root. Counts do not reset
with a new credential or consent generation. Daily limits count invocations,
not dollars, and do not protect against the local owner deleting their ledger.
Corrupt state or uncertain process liveness refuses dispatch; calls are not
refunded or automatically retried. No network result is awaited under the lock.

Consent/store/target/namespace generation are rechecked at actual dispatch and
before every HTTP request. The combined core/process AbortSignal does not prove
termination: the slot remains owned until the underlying invocation actually
settles, or existing dead-owner recovery confirms the process died. One
monotonic startup deadline covers configuration, stdin, capture and stdout.
Deadline exit124 emits only a fixed diagnostic, never completion; catchable
termination closes owned handles. Kernel/filesystem hangs and the later host's
independent outer watchdog are not solved by this Node-process boundary.

Stdout is one bounded `{status,body}` JSON line (262,144 bytes maximum, body at
most 65,536). All 200/202 replies pass the existing strict acknowledgement
classifier. A 200 means completed durable admission/replay/covered overlap or
durable continuation, not semantic truth; memoryCount uses committed IDs.
202/processing never permits cursor advancement. Saved Raw plus incomplete
interpretation yields non-2xx `interpretation_incomplete`, including on replay;
resetting a quota does not retry that event. Later optional filing failure does
not erase already completed admission. Exit0 means a well-formed request was
handled and can accompany a non-2xx refusal; malformed input/config/internal
process errors exit1 with a fixed content-free diagnostic. Consumers require
both a valid reply and normal exit, not partial stdout. This is synthetic
offline integration, not full conversation coverage, automatic Card creation,
installed hooks or completed local V1.

## Internal producer foundation (P4a)

`integrations/client/raw/index.mjs` remains an internal producer entry, not an
automatic client hook. B4b's private archive includes the primitives its explicit
worker needs. They prepare an exact authorized JSONL record from an already-open
positional source handle. It does not enumerate transcripts, acquire permission,
publish a cursor, install a hook or add an HTTP route. Existing Claude/Codex
capture remains v1; full installed-host lifecycle work remains separate.

The helper exports are:

- `scanRawRecordRanges({source,start,end}, {limits?,signal?})`: yield complete LF
  record byte ranges one at a time; an unfinished tail refuses.
- `prepareRawRecord(input, {identityKey,limits?,signal?})`: stream and validate
  the complete record, apply the layout's privacy/turn policy, redact the whole
  joined message, then return an excluded disposition with keyed sourceIdentity
  or a private handle. Both paths recheck the complete source commitment.
- `verifyRawRecordSource(input, options, expectedSourceIdentity)`: prove the
  current bounded source against canonical PRE-record bindings without parsing
  or retaining its text again; used on the freshly reopened publication source.
- `planRawBatch({message,projectId,position})`: produce one frozen v2 part/body,
  content-free pending manifest and proposed next position. Only a completed,
  matching acknowledgement permits the host to adopt that next position.
- `restoreRawBatch({message,projectId,pending})`: validate closed pending metadata
  against freshly prepared identities and reconstruct the same canonical body.
- `validateRawRequest(body)` and `classifyRawAcknowledgement(status,value,body)`:
  enforce closed transport and exact matching part dispositions. Processing,
  model quota and HTTP failure do not authorize advancement. A durable Raw skip
  is distinct from daily model quota. The internal core envelope needs an
  explicit host adapter and is not itself an acknowledgement.

The private handle exposes frozen bounded metadata, `readPart({start,maxUnits})`
and asynchronous idempotent `close()`; no path or full-text getter. Close it in
`finally`. Parts contain at most 4,000 UTF-16 units with code-point-safe bounds.
Trusted bindings/key material are copied before asynchronous work, and the
caller retains ownership of its source handle. Schemas describe structural
limits; code additionally checks Unicode/calendar validity, UTF-16/serialized
byte budgets, increasing ordinals, canonical parts and frozen identities.

Source buffers default to 16,384 bytes, selectable from 1 through 65,536.
Scratch I/O uses separate fixed 16,384-byte buffers and decoded chunks of at
most 8,193 UTF-16 units, including a boundary surrogate pair. There is no
whole-record AST or selected-text accumulation. Nesting defaults to/maxes at 64,
retained metadata at 65,536 bytes. Actual simultaneous owned scratch defaults to
512 MiB, with an explicit maximum 1 GiB. Each preparation, read/plan/restore or
scanner next-record operation gets an active deadline, default 30 seconds/max 300.
Nested reads share their outer operation's allowance. Caller idle/ack time does
not expire a prepared handle; cancellation remains effective. An uncooperative
filesystem operation cannot be forcibly preempted.

### Internal producer threat model

Before redaction, candidate selected text can exist in transient private
UTF-16LE scratch while trailing metadata is being validated. This sensitive
plaintext is separate from retained redacted Raw. Invocation-owned directories/
files use 0700/0600 permissions and exclusive creation; at most the active input/
output stage files coexist. All eight legacy redaction patterns run in order;
unresolved candidates are file offsets. Source/content HMACs detect observed
changes, not an atomic filesystem snapshot or change-and-restore attacks.

Cleanup verifies path identities before unlinking. One-shot creation, I/O and
cancellation failures clean their owned resources. If ownership checks fail or
another inode replaces a path, the helper refuses instead of removing an
unverified replacement. This can retain scratch requiring operator inspection;
there is no historical sweep. Logical unlink is not guaranteed physical erasure,
and SIGKILL/host crashes cannot guarantee cleanup.

Claude machine/skill/control exclusions and qualified Codex layout checks are
selection boundaries, not authenticated speaker identity or semantic truth.
The trusted caller supplies loaded-plugin and previously authorized source/format
context. Transcript text, request booleans, pending HMACs and schemas grant no
retention, read, Card or publication authority. Notice, hosted encryption and
production activation gates remain separate.

## Internal boundary

`openDatabase(path, { rawConversations: true })` atomically upgrades a compatible
store to schema 24, including the compatible private-engine schema through 23.
Raw tables start empty; no transcript or legacy evidence is backfilled. Ordinary
new stores remain schema 18, or 23 with the existing private-engine option.
Current option-off openers preserve a genuine schema 24 store. Pre-Raw openers
reject it; stop old writers before any future migration. This packet migrates
only owned synthetic fixtures, never an operational database.

`createRawJournal({ db, mode, port, capBytes, readPolicy })` is a private module
packaged as a dependency of the explicit public composition. It is not a public
core export or a second capture engine. The underlying journal provides:

- `prepareRegistration(input)`: validate exact namespace and camel-case message
  parts, snapshot host policy/control/namespace/conversation state, then seal
  eligible parts outside a transaction. It returns an opaque token bound to that
  journal instance; caller changes cannot change the prepared input or AAD.
- `commitRegistration(token)`: synchronously recheck state and join an existing
  transaction. A savepoint rolls back that registration on failure. The caller's
  eventual rollback also removes all journal, ledger and usage effects.
- `register(input)`: prepare, then run that commit in its own transaction.
- `getConversation`, `getRawUsage`, internal CAS raw controls and pending-attempt
  closure. Public opt-in delegates to these through the shared capture pipeline;
  ordinary `openMemoryCore`/`openMemoryStore` gain no implicit Raw methods.

The trusted `readPolicy` callback is synchronous and receives exact namespace and
client, returning `{generation,reason}`. A null reason permits prospective saving;
`tool_off`, `notice_required` and `raw_disabled` are content-free policy skips.
Existing durable namespace capture controls and session-deletion state are also
checked. The P2 factory below joins authoritative capture controls, admission
and episode registration. The standalone P1 journal remains model-free and does
not make an ordinary public opener perform this integration automatically.

## Internal P2 factory

`openRawCaptureCore(coreOptions, rawOptions)` in `core/raw-capture.mjs` is an
internal, synthetic-only construction seam. `coreOptions` uses unchanged strict
`openMemoryCore` options. `rawOptions` supplies the journal's explicit mode, port,
cap and trusted synchronous `readPolicy`. Public `openMemoryCore` accepts only
the closed option above, not these internal flags or construction extensions.
Both factories use `raw-composition.mjs`; the compatibility wrapper alone
remains absent from the installed artifact manifest.
No capabilities, MCP tools, client producers or HTTP wire versions are added.

Without the separate lineage selection below, this construction opts into schema **25**. Genuine P1
schema 24 stores migrate transactionally; the new capture ownership and session
fence records start empty, with no inferred backfill. `rawConversations:true`
alone still creates schema 24. Option-off current openers preserve schema 25;
the actual frozen P1 opener refuses it. As before, stop/drain older writers
before any future operational migration; this packet migrates synthetic stores
only.

`captureRaw` takes the journal's camel-case message-part request, plus ordinary
`causal` or episode-mode `episodeContext` at the top level. It validates and
detaches identity, context, profile and bounded normalized first-part projection
before asynchronous sealing. The durable, content-free ownership mapping records
first-part and eligible-projection message IDs, projection/profile digests, the
HMAC session identity, namespace generation and staging disposition. It does not
store another transcript or implement a second admission engine.

The prepared registration joins the real `claimAdmission` transaction for
ordinary, staged and ordered capture, or `reserveEpisodeBatch` for episodes.
Raw, usage, immutable event/part identities and required admission/episode
observation either commit together or roll back together. Raw commits before
staging expiry can advance the namespace epoch; the ordered proof is acquired
after both. Episode registration precedes duplicate/processing branches and lazy
interpretation of another session. Provider and sealing/opening callbacks run
outside the write transaction.

Only initially fresh index-zero messages enter the existing model projection.
Continuations make no extractor, qualifier, classifier or episode calls and do
not create admission claims or advance episode debounce counts. A mixed batch
uses only its fresh first parts. Blank or otherwise ineligible canonical first
parts retain exact Raw and explicitly report `no-eligible-first-part`; a later
continuation cannot become substitute model input. Exact replay and new-event
overlap retain original ownership. A live original claim reports processing;
failed/expired interpretation remains explicitly incomplete without a retry.
Exact durable replay observes the existing claim after revalidating source
identity, profile and current namespace/session fences. It never renews a lease,
restages text, touches staging expiry or invokes a provider. Completed admission
stays completed even after its staging expires; failed/expired ownership stays
incomplete while the original Raw disposition remains available. Ordered replay
returns its recorded reconciliation. An intentionally absent interpretation does
not invent a pending job.
The admission/episode registration transaction repeats the durable-binding check,
so another process winning during sealing or before the claim turns the slower
identical request into an observation. A different-event stale registration still
refuses. This private short-circuit is never accepted from request/model fields.
If interpretation fails before accepting its own registration, finalization also
checks for an identical durable winner, including one committed during token
counting. This observation requires both the binding and its Raw receipt inside
one transaction, revalidates the same identity and authority fences, and never
registers or repairs source. Without a recorded winner, the original refusal
remains unchanged and preflight still writes nothing. An already accepted
attempt retains its own interpretation failure rather than hiding it as replay.
New Raw first parts that collide with an already covered legacy episode message
(including a mixed batch) refuse atomically instead of backfilling that source
without its own admission reservation. Frozen legacy batches keep their legacy
path; only fresh post-upgrade ranges are eligible for future client adoption.

The internal result separates source saving from interpretation:

```js
{ ok: true, value: {
  raw: { conversationId, revision, parts },
  interpretation: /* existing core success/error envelope */
} }
```

Registration failure returns the existing error envelope with no successful Raw
result. After successful registration, extraction/qualification failure, staging
release/expiry or capacity bypass leaves Raw intact. Internal staged capture may
bypass full staging and records `not-staged`; ordinary legacy capture still
refuses capacity. This internal split is **not the future public v2 wire
acknowledgement**. An interpretation error/incomplete/processing result is not
permission for a future client to advance its capture cursor as completed.

Through this internal factory, namespace pause/project-stop setters close affected
pending Raw assemblies and incomplete quota/notice/Raw-disabled tails in their
control transaction, including through a feature-off writer. Completed messages
and already tool-off/capture-barrier tails stay unchanged. The
owner/client Raw-off setter closes only that owner/client's pending assemblies.
Saved pending attempts preserve accepted parts and release unused reservations
once. Resume/on permits fresh messages after those closures but never backfills
a closed suffix. Historical part/event receipts retain their original reasons;
later unreceived parts remain capture-barrier gaps. Raw-only off/on does not
establish a namespace/project barrier for policy-skipped tails. Sealing rechecks
these controls and session fences before commit. Namespace generation and
session deletion are checked again inside admission publication, including
unstaged and ordered capture. Raw-off after registration permits Memory work to
finish. Episode prose publication is also fenced for the new path.

`fenceSession({namespace,client,sessionId})` is a trusted tombstone seam, shared
by the internal factory and explicit public selection. Existing episode deletion tombstones also
fence registration and publication. This is not `deleteConversation`: full D5
source cascades and host withdrawal effects remain P3b; P3a's separately selected
D6 mechanics are described below. The factory must remain unavailable to real capture clients until those
protections and installed-client acceptance are complete. Arbitrary option-off
v25 writers do not yet join Raw reservation closure to their control changes;
that mutation-safety work remains P3. The durable admission guard already checks
namespace/session fences for existing Raw admissions, but does not establish all
option-off control or source mutations as complete.

## Internal P3a lineage and exclusions

The same uninstalled factory accepts the separate own boolean option
`rawOptions.lineage:true`, transactionally selecting additive schema **26**.
Omission/false does not upgrade the internal P2 selection's schema 25. Public
selection always enables lineage/deletion. Current option-off writers preserve an existing 26 store and enforce
its exclusions, including a connection opened before another current connection
selects lineage. The frozen P2 opener refuses 26; this is not mixed-version writer
support or authorization to migrate user data.

Core prepares source maps before asynchronous sealing/model work and commits them
with the original first-part registration. Stored metadata contains keyed receipt
identities, conversation/message IDs and half-open UTF-16 spans, not source text
or a raw session ID. Whitespace-only normalization has validated exact offsets;
NFKC changes, redaction and ambiguous historical projection use whole-message
precision. The mapping follows the existing twice-normalized bounded projection,
including cuts exposed by normalization expansion. Repeated equal windows bind
all matching positions conservatively; substring search never guesses an offset.
The entire retained prefix/window is covered, not only a fact's selected wording.
Provenance also exists for policy-skipped Raw, without inventing a saved anchor.

Receipt insertion and dedup attachment share the same resolver across capture,
ordered/manual finish, explicit admission and episode keep. Keep uses each
source's origin episode client/session, not its new action identity. Existing
v25 evidence can resolve only from a unique exact scoped client/session/message
tuple; without a historical position map it covers the whole message. No source
content or precise historical positions are backfilled. Per-receipt origins
distinguish proven independent explicit evidence, derived sources and unknown
evidence. Missing legacy origin is unknown, not independent; explicit promotion
of a Memory or duplicate receipt cannot launder that uncertainty. Known Raw
identity remains derived even when supplied through an explicit API.

Forget/correction persist exclusions before removing receipts or invalidating
episode sources, in the same transaction. Failure rolls both changes back.
Exclusions retain only source identities/spans and a scoped fence generation;
Raw text and its usage remain unchanged. Extraction filters excluded provider
windows, preserving original message provenance after reindexing. Trusted
freshness checks run after token counting, in the actual invocation microtask
and after response; admission rechecks current anchors inside its transaction.
Any overlapping source refuses with `source_excluded`, even under a new event
ID or paraphrased assertion. Disjoint windows and genuinely unrelated explicit
receipts remain eligible; ordinary fingerprint suppression still applies.
Exact replay continues to observe its recorded outcome without model work.

P3a alone is **not completed P3 or Raw V1**. The separately selected P3b
packet below adds D5's live-source cascade, conversation deletion,
reservation/control closure and withdrawal effects. P3a/P3b alone do not include
the asynchronous Raw resolution and bare Raw-to-Card support described below
in the internal P3c section. No public Raw anchors,
installed Raw capability or re-extraction job is introduced here; RL-9 owns the
later explicit re-extraction workflow.

## Internal P3b source deletion

The uninstalled `openRawCaptureCore(coreOptions, { ...rawOptions, deletion: true })`
selects additive schema 27 and implies lineage. Only an own boolean option is
accepted by the internal wrapper; the public selector always includes deletion. New ordinary stores remain
schema 18. Omission/false preserves earlier Raw selection behavior. A current
option-off connection, including one opened before this migration, honors the
persisted deletion rules once 27 is selected. This is not permission for old
binary writers: the frozen actual v26 opener refuses 27. No text or synthetic
receipt provenance is backfilled during migration.

The internal model-free methods use existing success/error envelopes:

- `previewDeleteConversation({ namespace, conversationId, expectedRevision })`
  returns `{ conversationId, revision, forgottenMemories, retainedMemories,
  removedReceipts, invalidatedEpisodes }` without writing.
- `deleteConversation({ namespace, conversationId, expectedRevision, actionId })`
  returns the same counts plus `{ actionId, effectCount }`. Its revision is the
  committed tombstone revision. Exact action replay returns the original result
  after restart, without new effects or usage changes; changed arguments refuse.
- `listRawEffects({ namespace, limit?, cursor? })` returns finite content-free
  `withdraw_pending` effects, coverage and a continuation cursor. Default limit
  is 20, maximum 50, with a 65,536-byte whole-envelope ceiling and a signed,
  scoped immutable high-watermark. It does not deliver or acknowledge effects.

Preview and delete share one transactional live-receipt plan. Current and
historical source-only Memory is forgotten through ordinary suppression. A
Memory with actual independent explicit or other-conversation support retains
its interpretation and currentness; only the deleted source's receipts are
removed, with normal revision/evidence/index/episode/Card invalidation. Neither
an explicit alias nor a keep action manufactures independent support. Unknown
legacy surviving receipt provenance refuses `raw_lineage_unavailable` before
mutation. Unlinked provenance is not assumed independent.

Pre-P3a keep receipts can contain the consumer's client/session, not the source's.
For these receipts the shared authority resolver follows the actual receipt ID,
episode Memory link and scoped keep action's recorded source IDs to the original
source episode before considering a consumer tuple. It never matches prose or
substitutes current passages for missing IDs. Missing or ambiguous keep proof
that cannot exclude the target refuses `raw_lineage_unavailable` across the exact
namespace, including other clients; known unrelated roots do not block. Such
legacy state needs repair, not inferred independence or Raw backfill.

Receipt/provenance changes advance only source roots reached from the affected
Memory. One DB-only before/after authority guard covers Raw registration,
episode reservation and trusted job binding that resolves an old duplicate
receipt, including registration whose extractor produces no new Memory.
Episode source additions, replacements and invalidation also advance reached
origin conversation/episode revisions, including zero-Memory consumers. The same
transaction preserves before/after authority for exact keep-linked receipts:
losing a keep proof invalidates other actual support roots on that Memory even
without receipt SQL changes. Unrelated conversation revisions are untouched.
This invalidates stale deletion CAS even without a Raw append. The immutable
`captureRaw` receipt retains its registration-time revision; refresh
`getConversation` before obtaining the preview/delete revision.

One transaction fences the source session, closes known pending consumers
(including cross-client keep origins), purges retained staging and obsolete job
bindings, mutates Memory, invalidates dependent episode prose, releases saved
and reserved bytes once, purges Raw rows/maps/exclusions, and records replay and
withdrawal metadata. Existing `forgetEpisode` delegates to this same cascade on
27, even for actual pre-Raw/empty episodes and option-off writers. It retains its
old DTO and compares the episode revision, not the conversation revision.
Confirmed authored Card bodies remain retained in canonical storage, and host
records stay in the host's own store under its retention policy, but Cards with
suppressed contributors are withheld from inspection and current and history
reads, and bound drafts are cancelled.

Real ordinary/staged/ordered/episode/keep transactions persist core-owned source
session bindings before provider dispatch. Tombstones refuse late legacy and Raw
interpretation/publication. Old pending work without provable source metadata
blocks deletion only in the exact target namespace/client when it retains payload
or publication authority, even when that payload has expired. Repair is required;
no text matching, guessed session or broad deletion is attempted. Terminal,
payload-free unbound jobs do not block. Pause/project-stop and client-off share
DB-only reservation closure; accepted parts remain and late suffixes never
backfill. Namespace pause/project stop also closes incomplete quota/notice/Raw-off
tails, permitting a fresh higher ordinal after resume while preserving original
receipts. Raw-only off/on does not establish that barrier for policy-skipped
tails. Lost-client-state recovery remains a
[separate limit](limitations.md#public-raw-constructor-p4b-b1).

Historically P3b exposed only internal synthetic D5/D6 mechanics; P3c added
resolution and bare Raw-to-Card support below. B1 now promotes their shared
composition through the explicit pure-local programmatic facade/private archive,
not the internal compatibility wrapper. Installed client hooks/MCP/terminal
lifecycle, host effect consumption and production gates remain separate.

## Internal P3c source references and authored Cards

The internal factory's own boolean `sources:true` selects schema 28,
implying deletion and lineage, with the existing trusted private-Card authority.
Public Raw plus privateCards selects the same protection. Ordinary capabilities
and synchronous note/receipt methods remain unchanged. The actual frozen v27 opener refuses 28. Migration
adds metadata bindings and an indexed Raw part start lookup, not source backfill.
`core/testing/raw-v27-database.mjs` freezes the actual opener from
`50230c0390a0e035b8d15f0cdeb9c335f97e3ffb`: 22,229 bytes after removing its
header and undoing only relative-import relocation.

`resolveSourceReferences({namespace,anchors,budgets?},authority)` is asynchronous.
It resolves all 1–16 explicit `{rawAnchor,expectedConversationRevision}` entries
or returns an error without partial references. An anchor is the existing
`{conversationId,messageId,start,end,precision}` on original redacted UTF-16 text,
with code-point boundaries and contiguous saved coverage. Whole-message precision
requires the entire saved message, not a bounded receipt/prefix. No substring or
normalized-offset inference occurs. Success is `{sources,coverage}`; coverage is
`{status:'complete',included:<anchor count>,omitted:0,conversationCoverage:'unknown'}`.

A reference is exactly `{type:'raw',namespace,conversationId,messageId,
span:{start,end,precision},contentIdentity}`. Its opaque core-keyed identity binds
the store/scope, span, immutable source metadata, keyed content digests, sealed
fingerprints and format/key version. It excludes assembly state, conversation
revision and locator Memory filing. Unchanged saved prefixes survive completion
and unrelated append; re-encryption requires explicit re-resolution. Only verified
asynchronous decoding mints a reference. Later authored Card writes synchronously
recompute its bounded canonical manifest and D5/D6 authority, without a crypto
port or host callback under the write lock. No Memory, note, model call or stored
Raw text copy is manufactured for source-only Cards.

Raw-only `getSource({namespace,source,limit?,cursor?,budgets?},authority)` is async;
note/receipt variants remain synchronous and reject `budgets`. Limit defaults to
20/max 50. Parts are `{start,end,text}` with absolute original offsets, no extra
surrounding text and at most 4,000 units. Coverage is
`{status:'complete'|'budget_exhausted',completeness:'selected-raw-span',
conversationCoverage:'unknown',included:<part count>,omitted:0|null}`.
Source cursors bind the exact reference, normalized budgets, limit and trusted
access generation. A changed budget is `invalid_cursor`; a revoked generation
is `cursor_stale`. Unrelated append does not invalidate an unchanged reference.

The budgets allowlist is `sourceByteLimit,scanRowLimit,deadlineMs,responseByteLimit`:
defaults 16,000/128/1,000/65,536; maxima 64,000/1,024/5,000/65,536. Anchors share
one allowance, reusing cached covered intervals and unique enclosing parts.
Metadata and `length(sealed)` are checked before BLOB loading/opening; only the
two existing formats and their exact payload sizes are accepted. Port opening
occurs outside transactions, followed by host-generation and final canonical
rechecks without callbacks afterward. A deadline cannot preempt an uncooperative
port; its late output is discarded. Preparation errors are nonretryable
`source_budget_exceeded`, `source_timeout`, or `context_item_too_large` for an
indivisible response. Missing/foreign/deleted/skipped sources are unavailable.

Every Raw source page authenticates its **complete selected reference** within
the caller's byte/row budgets, charging each unique enclosing part once across
snapshot, recheck and opening. Paging bounds returned/opened plaintext, not
whole-reference authentication work: a reference larger than 16,000 bytes needs
an explicit larger budget even for `limit:1`. There is no cheap-pagination claim
or hidden fixed-64k bypass. Current Card writes retain the aggregate 64,000-byte
source ceiling, conservatively counting enclosing parts and deduplicating only
identical canonical parts, not equal text. At most 128 live draft/confirmed Cards
may depend on one conversation across all spans; cancellation/deletion frees room.

D5/D6 source mutations invalidate bound Cards in the same transaction, including
already-open option-off writers. Drafts purge body/bindings; confirmed authored
bodies remain in canonical storage, but deleted or excluded contributors withhold
the Card from inspection and current and history reads. Multiple affected spans
do not multiply Card invalidation. Exact create replay remains its original content-free receipt, not a resurrected draft.
The shared canonical checks also cover evidence, snapshots and typed Card MOCs.
Raw-only provenance uses `selected-raw-span`; mixed sources including Raw use
`mixed-sources`, with `corroboration:'not-assessed'`. Old note/receipt output and
note-only usage remain unchanged; `getRawUsage` remains separate.

An ordinary private-Card facade encountering required Raw bindings fails
`source_unavailable` for get/list/evidence/organization/source-consuming writes,
rather than returning an unsupported DTO or silently claiming complete results.
Cancellation, deletion and content-free action inspection remain available by ID.
This mixed-store browsing limitation is deliberate; only explicit public Raw
selection supplies the installed programmatic reader. Capture pause/raw-off do not revoke separately authorized retained
source reads, and missing read crypto never enables capture or a decoder fallback.

## Storage and reads

The same SQLite file holds conversations, immutable keyed event/part identities,
content-free message progress, dispositions, raw parts and owner usage. Session
identity uses the existing `s1:` episode HMAC; raw session IDs are not retained.
Parts preserve exact selected/redacted whitespace and Unicode. No normalization,
redaction or whole-message truncation is applied by the journal. Hosts must
redact the entire logical message before splitting it in the later client packet.

The first part reserves the entire declared UTF-8 message size. The owner counter
covers clients and personal/project namespaces in this store. Saving converts
reserved bytes to saved bytes; replay and reads charge nothing. Cap decreases
leave existing reservations intact, and skipped or closed messages cannot be
backfilled after a policy/cap change. Closing a pending attempt releases its
unused reservation once and retains accepted parts. An omitted cap on a reader
preserves the durable configured cap.

The port is explicitly versioned `raw-seal-v1`; seal/open run without a database
transaction. Associated data follows the exact field order in
[the Raw contract](plans/raw-layer-contract.md). Tests use only explicit
`local-plain-v1`, which provides no encryption. The journal validates port
descriptors, local sealed bytes and decoded text's units/bytes/keyed identity.
Failures expose the fixed `raw_crypto_unavailable` code, never port exception
prose or a plaintext fallback. This does not establish the hosted construction,
key lifecycle, backup erasure or production privacy gates.

Reads return whole parts in ordinal/index order, with explicit unknown time and
incomplete coverage. They include `evidenceTrust:'untrusted-data-not-instructions'`
and fit within 65,536 bytes including the success envelope and signed cursor.
Cursors bind store, exact namespace, operation, conversation/revision, part limit,
namespace epoch and position. Publication rechecks revision, epoch and exact
stored part/message metadata after opening. Owner usage uses one SQLite read
snapshot and counts plaintext bytes, not ciphertext or file allocation.

## Verification boundary

`core/test/raw-journal.test.mjs` and `core/test/raw-boundaries.test.mjs` use the
owned test runner and synthetic workspaces, including two real child processes.
The frozen `core/testing/raw-v23-database.mjs` is the actual pre-Raw opener from
`cd6d1ad32ac3d6f5926c6846e8c6d27645bb7c9a`, with only relative imports relocated,
so old-opener refusal remains testable in shallow CI checkouts.

The four `core/test/raw-capture*.test.mjs` suites additionally exercise actual
P2 admission/episode transactions, controls/fences, bounded model projections,
ordered proofs, staged bypass, replay, migration and independent child processes.
`core/testing/raw-v24-database.mjs` freezes the actual P1 opener from
`0be04cdcc9e5a88b3702bf915510da810d5e797a`, with only an explanatory header and
relative import relocation. All fixtures use synthetic owned workspaces.

`core/test/raw-lineage.test.mjs` adds actual P3a mutation/admission, mapping,
legacy/option-off, cold-process, migration and exclusion-race fixtures.
Episode drafting uses the same exclusion authority before batch/precompact,
end and lazy interpretation, including retained passages with no Memory link.
Filtered messages keep their original omission positions; inherited passages
retain their origin episode's client/session/message identity. Freshness checks
validate the actual prepared input after token counting, at dispatch and after
the response. Publication repeats source checks inside its transaction, including
sources reattached for pinned fields or step closure. An excluded reattachment
fails rather than publishing new prose. The immediate episode error can report
`source_excluded`; the existing finite durable attempt outcome remains
`episode_failed`, preserving consumed-attempt/debounce and closed replay rules.
`core/test/raw-lineage-episodes.test.mjs` covers provider input, cold published
state, zero-Memory passages, inherited origins, concurrency and rollback.
`core/testing/raw-v25-database.mjs` freezes the P2 opener from
`9a7bbe59c9c0ec72227310cece43fce7ac589c6e`, with only an explanatory header and
relative import relocation.

The three `core/test/raw-deletion*.test.mjs` suites additionally cover the P3b
shared cascade, legacy and cross-client episode/keep consumers, durable job and
control fences, migration rollback, usage, actual receipt-backed Cards, competing
processes, asynchronous reads, CAS and bounded effects. The actual v26 opener in
`core/testing/raw-v26-database.mjs` is frozen from
`99b09855358176786d86765d009faba4777867f6` (21,414 bytes after removing its header
and undoing only relative-import relocation).

These establish P1/P2/P3a/P3b/P3c mechanics. `raw-public.test.mjs` and the installed
`packaging/test/raw-conversations.test.mjs` add explicit public construction and
fresh-process programmatic Raw/Card/deletion checks. Their independently derived
import/asset closure matches actual installed module resolution/reads. Installed
client/MCP lifecycle, production controls/encryption and semantic quality remain
later acceptance gates; programmatic tests do not complete those gates.
