# Privacy and threat model

This page describes the hosted plugin path and explicitly marked proposed local
changes below. Current local storage and deletion boundaries are documented in
[Local store](local-store.md); local model/MCP data exposure is documented in
[Protocol](protocol.md). Core has no network client or telemetry, but a configured
injected model adapter can send source text to its provider. Local storage alone
is not a promise of offline interpretation.

The main risk in automatic memory is not bad retrieval. It is silently collecting more than the user intended or presenting an inference as trusted fact. Cairn Memory treats capture as a narrow, inspectable boundary.

## Data flow

The evaluation-only mixed generation report can retain an optional private
`diagnostics.nativeFailure` on a Mem0 execution exception. Its exact frozen
shape is `{version:1,layer,reason}`, with `runtime`/`gateway` and finite explicit
codes emitted by their existing typed native errors. Projection reads only an
own data code after rejecting proxies, forged plain objects and unknown error
classes; it never invokes code accessors or coercion. Unknown/malformed codes
and projection failures add no field. No exception message, stack, cause, key,
source text, response body, URL, ID, length or path is captured. This is local
evaluation metadata, with no public core/plugin/MCP/HTTP or telemetry schema
change. It is an observation, not causal proof or authority to retry, continue,
resolve an unknown, or change scoring. Historical reports stay unchanged. See
the [prospective contract](plans/mixed-native-failure-diagnostics.md).

After explicit installation, automatic capture and content-free telemetry default on. The plugin reads only the newly appended range of a Claude Code transcript. It selects textual blocks whose top-level role is `user` or `assistant`, redacts likely credentials, batches at most 24 messages, and sends them to the configured service.

From plugin 0.1.1, a user-role record is not sent if any of these apply: Claude Code marks it as meta (local-command caveats, image-source notes); it is a compaction summary; it carries a tool result (the whole record is skipped); or its text starts with a Claude Code wrapper (slash-command and local-command output, bash-mode input and output, system reminders, prompt-submit hook output, task notifications). The wrapper check is skipped for a record Claude Code marks as a submitted prompt (`promptSource`), so such a prompt is sent whatever it starts with. This holds for every request 0.1.1 makes, including retries of a capture window 0.1.0 had queued before the upgrade. It does not remove anything 0.1.0 already delivered, and a request 0.1.0 had already sent may still complete. Assistant text is sent as before, including anything it quotes from those records. Only the record shapes and wrappers listed in the [plan](plans/codex-client.md#second-d1-exception-plugin-011-privacy-filter) are recognized; see [limitations](limitations.md#claude-plugin-011-filter-rests-on-narrow-evidence).

Automatic recall separately sends the current prompt after local credential
redaction and truncation to at most 4,000 UTF-16 units without splitting Unicode
code points (also within the public schema's 4,000-character limit). Redaction runs
before truncation so a credential crossing that boundary is not partially sent.
Empty queries are skipped. Neither path can guarantee detection of every secret.
Tool blocks are excluded from capture, but ordinary conversation can include
pasted files, terminal output, paths, and repository names.

The service may retain durable Memory text and bounded redacted Source Receipts. It does not need the raw transcript. The hosted service soft-deletes a Memory immediately from recall when the owner invokes `forget_memory`; backup erasure timing is an operational policy and is not claimed by this repository.

## Local state

Ordinary standalone use selects `CLAUDE_PLUGIN_DATA` when supplied, otherwise
`~/.cairn-memory/` (the released temporary fallback applies only to a falsy home).
The legacy-gap adoption described below retains the already-used default root.
An explicitly paired plugin uses the recorded durable shared root:

- `install-id`: random id used only for anonymous lifecycle telemetry;
- `project-key`: separate random secret used to derive opaque project ids and never transmitted;
- `created-by`: private client-creator record and non-secret identity fingerprint;
- `.project-key.pending`: private staged secret during crash-safe key publication;
- `.project-key.lock`: publication ownership and recovery files;
- `control.json`: content-free pause state and generation barrier;
- `paired-root`: private 0600 JSON (`{"version":1,"paired":true}`) recording shared
  root history, published with the same owner/symlink checks as other private state;
- `paused`: compatibility marker also honored as a pause;
- `sessions/*.json`: byte cursors, pending retry bounds, generation, and incomplete-line discard state,
  keyed by a hash of the Claude session id;
- process-owned lock files coordinating control changes and session capture.

Version 0.1.2 also stores coordination metadata under
`~/.cairn-memory-clients/`, independently of `CLAUDE_PLUGIN_DATA`:

- `install.json`: version, established/pending client/root bindings and the
  registered Claude profile root, initialization and configuration progress;
  explicit resets retain invalidated binding metadata and Claude profile ownership;
- `pairing.json`: version, absolute shared root, participating clients, record ID,
  initialize/adopt policy;
- `setup.lock` and token-specific owner/recovery files: process ownership for
  registration, key eligibility and pairing, including boot/PID-namespace identity.

The coordination directory is 0700 and its files are 0600. Owners, permissions
and symlinks of Cairn-owned components are validated; host-owned ancestors use
`realpath`, and owner checks are skipped without `getuid`. Metadata contains
local paths but no project keys, credentials or conversation text, and is never
included in telemetry. Standalone use retains the falsy-home temporary fallback
for these paths; setup and pairing require a specified absolute durable home.

Every binding operation also writes private
`<profileRoot>/.cairn-memory-profile/binding.json` (0600 inside a 0700 directory),
containing version, profile root, bound root and a non-secret identity fingerprint.
It contains no key or conversation data and is never transmitted. Both reset primaries
rewrite it to the new root. Clearing an option does not remove it; CX-2 has no leave API.
With binding history, missing, empty or untrusted coordination disables memory with
`pairing_record_missing`, with no key creation or requests. Invalid binding history also
refuses. Trusted coordination with a different identity reports `binding_identity_mismatch`.
If both the key and coordination are lost, explicitly call `resetIdentity` with the affected
`claudeProfileRoot`, a new durable `root`, `primaryClient`, `confirmIdentityReset: true`, and
`hostsStopped: true`. Valid binding history authorizes this intentional new scope.

A `paired-root` entry prevents every ordinary key-creation path from replacing a lost
key, including standalone access to that same root. Only explicit original-backup repair
may restore it. An unset-plugin-data profile still shares an existing default-root key
and pause when it has no conflicting binding history. A never-paired profile whose own
root differs from the pair root cannot use that identity or change its pause. For state
carrying 0.1.2 history, these invariants take precedence over standalone parity.

Cursor-based legacy adoption requires a valid `project-key`, Claude-only cursor
evidence, no active or retired Claude registration, and no `paired-root` entry.
Garbage keys and directories named `project-key` do not qualify.

For profiles without 0.1.2 binding or legacy history, absent coordination preserves
normal 0.1.1 first use, including an unusable HOME, a missing path, ENOTDIR, or a
non-directory/foreign coordination entry. Degraded means an
owned coordination directory cannot be listed, or its existing records cannot be read or
trusted. It never creates a project key or infers adoption from Claude cursors. Without
a delivered record, it uses an existing profile key, or a validated profile-local
adoption record naming an existing default-root key. An eligible unretired root remains
active as `standalone_unregistered`, with separate detail `coordination unreadable`.
Otherwise memory is disabled with `pairing_needed`; a lost locally recorded standalone
key in an unmarked root reports `standalone_key_missing`, never `paired_key_missing`.

Explicit setup records adopted scope in the private profile-local `binding.json`.
Binding history contains the root and a non-secret fingerprint,
never a key or conversation. With absent or degraded coordination it refuses with
`pairing_record_missing` until repair or an explicit reset to a new root.
Initialization, adoption, completion, reset destinations and repair publish a private
`paired-root` marker in the shared
root. Its positive presence, valid or invalid, permanently excludes cursor-based legacy
adoption of that root, including after coordination loss. It does not pause or disable
an otherwise entitled client. A fresh profile gets its own key after loss; an explicitly
delivered missing record still reports `pairing_record_missing`. An existing profile key
takes precedence. With readable coordination, only the registered profile follows its
binding; another profile stays standalone. Unsupported registration on Windows adds no
unregistered status note. An unrelated damaged default root does not prevent
registration or add a status note. Only explicit setup registers absolute plugin-data
profiles, storing resolved real paths; relative, empty or invalid paths retain standalone
behavior without registration. Every install record is validated before publication.

Retirement is checked only at the selected root. A present `retired` entry,
valid or invalid, disables that root with `pairing_needed`; resume refuses to
unpause it. Missing or inaccessible entries, non-directory roots and roots owned
by another user are not retirement evidence. An unrelated default root cannot
disable an unpaired plugin-data profile. Setup refuses a marked destination with
`retired_root`, including an implicit default destination, and requires another
unmarked root. Status remains a single token; explanations are separate details.
Disabled hooks exit 0 without requests, while explicit controls fail visibly.

Pairing supports Linux within one PID namespace and macOS; Windows pairing is
unsupported. Boot identity affects stale setup locks, never durable pair validity.
On macOS, a wall-clock step over two seconds during a lock hold can make a live
owner look stale; lock holds are short and native host behavior is still to verify.
Crash recovery may leave private temporary or lock-recovery files. Successful
key probes clean publication staging and recover dead publication locks; other
cleanup remains limited to a process's own temporary files.

Pairing requires consent and stopped hosts/workers. Newcomers remain disabled with
`pairing_needed`; established conflicting clients keep their own existing keys.
Only Claude writes `sessions/`. A bounded check of valid cursor metadata there can
establish prior Claude use of a shared default root only when no Claude
registration exists, active or retired; shared telemetry/key/control files cannot.
No host directory search or conversation read is involved.
A delivered pairing record selects the shared root and pause generation;
`CAIRN_MEMORY_STATE_DIR` is validated for paired worker handoffs, never an
override; standalone hooks ignore inherited values, as 0.1.1 did. With readable
coordination, a different Claude plugin-data profile remains unregistered with
its own key and pause; pairing applies only to the registered profile.
Paired key loss disables memory with `paired_key_missing`, while hooks still exit
successfully. Restore the original backup key with stopped workers to retain IDs.
An explicit identity reset retains old state, changes addressable project scope,
starts paused at a fresh EOF barrier and requires new adoption by the second client.
The retired shared root is also paused with a rotated generation and stores a
private 0600 `retired` marker (`{"version":1,"retired":true}`), validated for ownership,
permissions and symlinks on publication like other private state. Resolution
uses positive entry presence, not JSON contents, to recognize retirement.
There is no automatic key regeneration, history merge or paused backfill for a pair.

Stop and PreCompact pipe only session id, transcript path, working directory,
and a content-free control generation directly to the detached worker. The
plugin does not write a capture queue to disk or add the handoff to the worker
environment, and assistant text present elsewhere in the raw hook event is
discarded before handoff.

The API token is supplied by Claude Code plugin configuration and is not written by this plugin.

Identity files are atomically published using a hard link to a fully written
private temporary file. Concurrent callers reuse the winning key. The state
directory must support hard links; failures or malformed identity files stop the
affected operation rather than silently generating a new scope. A process crash
during initialization may leave an unreferenced `.*.tmp` file with mode `0600`;
it is not sent to the service. Do not delete or replace a valid `project-key`:
doing so changes the scope used to retrieve existing project memories.

At a marked root, a profile sharing its own existing key and pause never claims or changes
registration through hooks or reads; only explicit setup/pairing may register it. Readable
coordination also prevents minting at a recorded pair root when deletion removed its marker.
Codex's paired binding stores the same non-secret identity fingerprint in `install.json` and
refuses `binding_identity_mismatch` before sending if the key changed. Fingerprints are local
metadata and are never transmitted. Explicit setup validates its preconditions before durable
writes and rolls back caught failures; a failed operation preserves files, modes and markers.
Stopped-host original-backup repair checks the saved fingerprint inside the private key write.

Explicit setup owns registration for both clients. Hooks and resolve/status never write
`install.json`. Existing own-root sharing also leaves registration untouched. Readable pair
ownership includes fingerprint-bound client roots, reset destinations and retired roots;
a missing marker never makes these roots eligible for key creation. The shared mint gate
also protects identity-facade calls. Only original-backup repair may restore such a key.

Root identity uses real paths and device/inode, so symlink aliases cannot be new reset
identities. Reset accepts only a new path or an empty directory; otherwise it reports
`reset_destination_not_new`. Initialization at an existing key reports
`existing_key_requires_adoption` until the caller explicitly adopts it.

Private entry probes distinguish present, absent and unknown. ENOENT proves absence;
ENOTDIR does so only for a known controlled regular-file parent. Unknown selected state
refuses with a named status such as `state_unreadable`, keeping the system error in detail.
Unusable HOME and unrelated damaged paths keep history-free standalone parity. Invalid
repair history reports `binding_history_invalid`; invalid backup arguments report
`invalid_original_key`. Failed explicit operations restore files and modes, except for
legitimate setup-lock ownership and crashed-owner recovery artifacts.

Codex also keeps private non-secret binding history at
`<HOME>/.cairn-memory-profile/binding.json`. It retains current and retired pair roots,
so losing both coordination and a root cannot authorize a replacement key or legacy
adoption. Invalid history fails closed. Hooks and status never register either client.

### Identity creation and crash recovery

The key publisher records its creator in private `created-by` JSON (0600): version,
client (`claude` or `codex`) and a non-secret identity fingerprint. It is creation
evidence, not registration. A newcomer Claude beside a Codex-created standalone
root needs explicit pairing, with either set or unset plugin data; it sends nothing
and mints nothing. The established client reports `pairing_needed` when another
client is declared or detected; Codex-only use explicitly sets `usesClaude: false`
and stays `single`. Unreadable creator evidence reports `state_unreadable`.
Older keys without a creator record keep the legacy rules. Publication durably
stages the secret and creator intent before linking the key under `.project-key.lock`.
A retry keeps any published winner. A successful key probe or publication removes
leftover staging and recovers a dead publication owner; live publishers retain
ownership. A missing key is never restored from staging: creation must pass the
normal mint gate, or explicit repair must supply the original backup. Read paths
never write creator records or registration.

Interrupted setup is retried with the same explicit call. Pending initialization
reuses its winner without demanding adoption; pending reset to the same root skips
the fresh-destination test. A matching reset receipt permits a zero-write retry,
returning `identity_reset`, `alreadyComplete: true`, `writes: 0`, and the disclosure.
Later setup operations supersede it atomically with their install-record write;
reset to the current root then refuses with `identity_reset_requires_new_root`.
Initialization retains the original pause flag across its barrier.
Unreadable key probes refuse with `state_unreadable`, rather than treating the key
as absent or skipping retirement.

## Controls and residual risk

| Risk | Control | Residual risk |
|---|---|---|
| Tool or file data is uploaded | Parser allowlists user/assistant text blocks | A user or assistant may paste file contents into ordinary conversation text |
| Credential is retained | Deterministic local redaction plus service redaction | No regex recognizes every possible secret; revoke any credential suspected exposed |
| Common project path is reversed | HMAC with a separate never-transmitted local key | The service still sees a stable opaque id and access timing |
| Inference becomes shared truth | No shared scope in automatic capture | A private inference can still be wrong; origin, confidence, and receipt remain visible |
| Service outage disrupts work | Bounded timeouts and fail-open hooks | Capture may be delayed until a later hook retry |
| Telemetry reveals content | Strict content-free schema; disable switch | Service sees IP-level network metadata inherent to an HTTP request |

### Optional OpenAI classification transport

The source-runnable OpenAI adapter's classification method replaces only target
memory IDs and visible catalog-MOC IDs with short request-local aliases before
its provider count and generation calls. This reduces repeated wire literals; it
does not anonymize provider input or change the untrusted-source boundary. The
same memory content, MOC titles and metadata are sent, and identifier-looking
text inside content or titles is deliberately unchanged.

Memory and MOC aliases are role-separated and decoded only through maps closed
over one invocation. The reverse maps are not included in provider requests,
written to the local store or emitted in diagnostics/telemetry. Malformed,
unknown, cross-role and raw UUID output references fail closed before core can
persist a placement. The original durable IDs remain in core and SQLite. Other
model methods and the hosted plugin wire are unchanged. `store:false` and
ephemeral local maps do not guarantee provider-side zero retention; the provider
still receives the aliased request's personal text and ordinary network metadata.

## Disable automatic behavior

Run `/cairn-memory:pause` to pause both automatic capture and recall, and `/cairn-memory:resume` to restore them. Disable telemetry independently in plugin configuration. Uninstalling the plugin stops future local processing; use `forget_memory` or the hosted memory UI when available to remove already stored Memories.

Pause creates a persistent generation barrier. Workers from an earlier
generation cannot send later batches after the barrier. A request already
started before pause may finish; pause cannot retract transmitted content.

After resume, the first capture hook for each session establishes a new cursor
at its current transcript end and sends nothing. This deliberately skips all
unprocessed history at that boundary, including text written after resume but
before that first hook. Subsequent complete messages can be captured normally.
An incomplete line spanning the boundary is discarded through its newline.
This conservative rule also applies to sessions first encountered after a
pause and persists across process restarts. It prevents paused text from being
backfilled without retaining transcript paths or content in control state.

Malformed control state disables automatic processing. Session locks are not
stolen merely because they are old while their owning process is still alive.
Control and session state belong to one machine; sharing the state directory
between hosts or PID namespaces is unsupported.

Lock recovery leaves small token-specific `.reap-*` markers and owner files
containing only process ids and random tokens. These markers are deliberately
retained to prevent a delayed recovery attempt from deleting a successor's lock.
If a recovering process crashes before completing recovery, or an older client
left an empty/malformed lock, acquisition may time out until manual recovery.
First stop all Cairn workers and Claude sessions that use this state directory;
then inspect and remove only the affected stale lock and its matching recovery
artifacts. Keep `control.json`, `paused`, cursor files, and identity keys intact.
Automatic hooks remain fail-open; explicit control commands report failure if
they cannot acquire the control lock.

## Proposed session episodes (local core)

This is the explicit threat-model update for the proposed
[session-episode contract](plans/session-episodes.md), not shipped behavior.
Core opts in with `sessionEpisodes: {mode:'episode-v1'}` and v2 capture/staging;
`draftEveryBatches` defaults to 8 and accepts integers 2–16. The **one-brain
configuration** is the product setup in which one person's Claude Code, Codex and
chat tools share one memory. It enables episodes by default with automatic capture
and discloses their retention. Staging alone never enables durable episodes.
Hosted behavior/schemas and telemetry are unchanged.
Intentional diary entry is consent to organize an ordinary submitted source,
not permission to share personal content or authenticate its claimed roles.

| Added or expanded field | Threat, control and residual limit | Gates |
| --- | --- | --- |
| Session identity/key | Dedicated private-store HMAC over namespace/client/session, no new raw session or reverse map. Not reversible encoding, encryption or anonymity: stable linkage remains and key holders can test guesses; old receipts are unchanged. | E1 |
| Namespace/project, generation and origin/end signals | Cross-scope leakage or forged triggers can bypass entry controls or inflate call cost. Claude/Codex client contracts bind trusted metadata, stop/pause generations and real lifecycle signals. No thread IDs, personal fallback or shared scope; controls cannot stop other devices. | E1/E3/E6/E11 |
| Event/receipt/revision times, ordinals and draft markers | Reveal routines and may imply false chronology. Validate UTC, preserve unknown/partial time, keep scheduling counters and consumed-trigger markers local; submitted clocks are unauthenticated. | E3/E9 |
| Client key/display label | Reveals tool use or identifying prose. Bounded host-configured labels, no user/device/path/version data, exact namespace/client filtering; label is not authenticated identity. | E1/E2/E9 |
| Type/language, gist/outcome/step, correction pins and procedural tags | Sensitive diary/habit descriptions, unsupported claims or instruction injection. Bounded source-anchored interpretations and untrusted framing; no truth or execution authority. Only the freshly classified batch may skip extraction. Automatic tags require episode-v1; explicit remember tags work independently. Legacy automatic prompts/outputs/fields/digests remain unchanged without the option. | E2/E8/E10 |
| Retained source passages, anchors/digests and memory lineage | More personal text persists than memory extraction selects. Bounded selected passages survive temporary staging; conversation deletion suppresses derived memories and invalidates dependent episodes, including copied sources. Hashes are guessable and redaction is best-effort. | E4/E7 |
| Model/profile/prompt-version, policy, action IDs, gap and release/bypass status | Processing records may leak secrets or hide failure. Bounded nonsecret IDs/finite codes only, no raw errors/prompts/responses. Debounced attempts have durable caps. Capacity first releases oldest admitted episode-only backlog with explicit gaps, then bypasses new staging if needed; ordinary admission continues even under sustained interpretation failure. Content-free fences survive. | E1/E3/E4/E4a/E8 |
| Time/startup reads and tag revisions | May expose unrelated personal data or erase relationship evidence. Exact scope, hard budgets, group opt-outs, final freshness checks and untrusted-data framing; tag-only sidecar updates preserve conflict/rationale links. Host interpretation remains untrusted. | E9/E10/E11 |

The injected episode-interpretation port receives bounded redacted source text,
claimed roles, request-local references and untrusted prior editing context.
Metadata identities/timestamps/control tokens remain local; source text can still
contain personal information or undetected secrets. Drop oldest prior cited
sources first to fit the prompt, record exclusions, and never treat omitted
passages or prior prose as evidence. Additional configured-provider exposure is
bounded by the plan's per-session attempt formula. Reads use only a local exact
counter, with no generation. No paid call is authorized by this documentation.

Reuse the existing pause/cursor barrier above for all drafts, including lazy work.
Project stop fences unfinished work; entry producers must never backfill paused
text. Local controls cannot retract previously transmitted requests. Selected
passages have no automatic age TTL. Episode-mode staging's 24-hour deadline is an
upper bound on live payloads, not guaranteed retention: pressure can release
admitted-but-undrafted/failed interpretation evidence sooner. Normal release
still occurs atomically after admission and selected-passage disposition complete.
At capacity, release eligible episode-mode payloads oldest-first (staging time,
then client/event ID), record gaps and fence in-flight drafts; never reclaim
unadmitted or ordinary staged-v1 payloads. If space still fails, register the new
batch without episode staging and run normal extraction/admission, with a visible
gap. Releases, gaps and registration commit atomically; replay cannot repeat them
or restore text. No alternative source store or new model trigger is introduced.

Inspection distinguishes `released` from `not-staged`; both have null source views
and `expiresAt:null`, with content-free reason/admission/coverage metadata.
Completed replay survives release; deletion fences still win. Protected pending
admissions retain their lease/backpressure rules, and legacy staging is unchanged;
neither justifies rejecting a new episode-mode batch for episode staging pressure.
E4a requires >64 captures with N=16, two concurrent sessions, about 16 KiB payloads,
sustained interpreter failure, protected-capacity bypass and crash/restart tests.
Conversation deletion clears descriptive policy/correction metadata as well as
prose/sources, and conservatively forgets even multi-source derived memories.
Existing namespace-wide staged purges and source-consumer invalidation still apply.

No new field enters telemetry, payload logs or raw exception text. E1–E11 require
fake-provider payload and persisted-row inspection on Node 22.16 and 24. Private
filesystem and old-process migration precautions remain; SQLite free pages,
journals, snapshots, backups and provider/caller copies may retain bytes. No
secure-erasure, complete-history or semantic-fidelity guarantee follows.

### SE-1 implementation boundary

The episode persistence/inspection, correction/deletion and explicit
procedural-tag subset above is now implemented locally. Episode
capture/interpretation now uses an injected port; trusted producer integrations
remain separate work. Opening the store eagerly upgrades to v17 in either mode;
staging alone still never enables episodes. Hosts must stop/drain older
connections before upgrade; already-open old processes are not retroactively
fenced. Feature-off access retains deletion/source fences. New retained passages
are source evidence, not receipts for remembered assertions. Capacity release
and bypass leave content-free gaps and no active expiry, while conversation
deletion suppresses even multi-source/historical derived memories. Inspection
and tag writes invoke no model. Existing source/prompt/receipt contents remain
unchanged when neither opt-in is used.

### Durable message identity metadata

Schema v16 adds `episode_messages`: episode/message identity, first and coverage
event IDs, and an HMAC-SHA256 digest of `["m1", role, canonicalText,
eventTimeOrNull]`, using the existing private episode key. No message text or
role is stored in this ledger. It prevents reused IDs from silently changing
evidence after staging release. It remains content-free lineage/digest/fence
metadata after conversation deletion; key holders can still test guesses, and
identifiers retain correlation risk. Registration and capacity disposition are
atomic. Episode-off captures leave the ledger empty. Upgrades do not backfill
earlier messages, so overlap detection starts with post-upgrade registration.
Provider payloads receive no ledger IDs/digests. Batch rows also retain bounded
message-ID membership to fence superseded owners. Explicit keep records action
identity, creation ordinal/time, source IDs, source revision/fence and a
classified admission result in a separate keep-action table. It neither archives
additional transcript text nor turns interpretation into evidence.
E1/E3/E5/E7/E11 cover these boundaries.

### Local time reads and startup context

Range reads and session-start context perform no generation, capture, draft or
queue drain. They expose only one exact owner/namespace; client filters use exact
equality. Event bounds remain unauthenticated, unknown intervals stay excluded
with an explicit marker, and incomplete or partial coverage remains visible.
Metadata pages retain whole records within a 64-KiB success envelope. Signed
cursors correlate store, scope and page position; they are not encrypted credentials.
Mutations invalidate pagination through the namespace epoch.

Startup sources are sent only to the caller and its injected local exact token
counter. Procedures carry complete retained receipts; steps carry all supporting
passages. The response frames both as untrusted recollection without execution
permission. Opt-in background adds current facts and context from either origin,
including agent-inferred facts no one has reviewed. Awaiting rows remain
excluded; reviewing decisions does not certify these other kinds. Complete
receipts prove provenance, not truth. When background items are returned, the
framing retains the full episode interpretation and execution-permission
warnings and adds that background may be inferred and unverified. Without
background content, the original framing is used. Background items omit
procedural tag sidecars. The existing groups fill first; background and its
warning use remaining space and may be omitted. `backgroundOmitted: true` is
included only if it fits. A requested but absent background group always means
incomplete, even without that marker. No background text is sent when the group
is not requested. Disabled groups contribute no content. A final atomic reread
fences changed epochs, identities, tags and sources after counting, including
background rows when the group was omitted. A
concurrent forget of an omitted item can still fail the call with a conflict,
consistent with SE-3; a fresh retry drops the item without returning stale text.
A host forwarding this response to a provider must reserve its own framing
headroom and treat all content as data. Read budgets do not establish relevance
or semantic support.

Explicit step closure retains only content-free action/identity replay markers
in the existing journal, with action IDs HMAC-bound using the private episode
key. Replays cannot close a different step or advance a read epoch. Descriptive
closure evidence remains source-bound and is cleared by source invalidation or
conversation deletion. Schema v17 adds read indexes only; these indexes add no
new source text or retention policy. Existing file, journal and backup limits apply.

### Local MCP episode access and explicit tags (SE-5)

Local stdio exposes sensitive episode prose, retained passages, time/client
metadata, memory lineage and sourced startup context only in the exact startup
namespace. Tool arguments cannot change owner/scope/project, receipt client or
session authority. Optional read-client configuration restricts time ranges and
all episode-ID actions; per-call client only narrows it. Startup context retains
the core's namespace-wide cross-client groups; the read-client flag is not a
general memory access boundary. Process configuration and database-file access
remain trusted local authority, not authentication against the file owner.

Access-only startup enables no capture, retention, interpretation or telemetry.
Automatic tags can be proposed only through an explicit keep request. Reads use
local token counting and never invoke provider generation.
Selected passages already retained by a trusted producer can persist without an
age TTL. Explicit keep is the only episode-management request that sends retained
text through episode-mode extraction/qualification/admission to a separately
configured model, including source-anchored model-origin procedural proposals;
it may incur charges and cannot retract prior provider copies. Generation flags
are configuration only until trusted producer binding; submitted capture remains
in legacy mode, even with that configuration present.

Strict schemas and bounded UTC/page/cursor/core-envelope budgets prevent authority
injection and unbounded responses. Mutation-stale cursors and revision guards
preserve freshness; no-op replay is inert. Returned instructions, steps, roles and
background remain untrusted data, never execution permission. Read-only/closed-
world MCP hints describe read operations; hints themselves do not enforce trust.
Startup framing explicitly warns that episodes are interpretations, not verified
facts/current assertions; returned background adds its inferred/unverified warning.

Procedural remember is explicit intent independent of episode generation. Its
anchors address the canonical explicit text receipt and require preference or
instruction kind. Metadata alone is not evidence. Tag-only edits preserve
conflict/rationale/qualification links and memory revisions, but do not certify
recurrence or semantics. Episode corrections pin sourced prose without changing
source text/admitted memories. Conversation deletion clears descriptive fields,
retained passages and steps, tombstones/fences the session, suppresses all derived
live/historical memories including multi-source deduplication, and invalidates
source consumers. Unrelated admitted memories survive; existing namespace-wide
staged purges and content-free replay fences remain. Neither forgetting nor
redaction guarantees physical erasure of journals, free pages, backups or prior
provider/caller copies. Hosted schemas/defaults and paid-pilot boundaries are unchanged.


### Hosted 0.2.0 client boundary

The Codex discriminator identifies filtered user/assistant conversation text;
it admits no tools, credentials, metadata or transcript paths. Its reader remains
disabled pending installed-host/target acceptance. Telemetry stays disabled for
Codex. Session-start may return owner-bound episode sources, memory receipts and
accessible claimed commitment provenance, all untrusted and budgeted together.
These fields can contain personal text; clients must not log response bodies.
Publishing and parsing do not wire session-start or hosted pause into hooks.

Upgraded Claude honors the shared hosted quota gate as the explicit D1 exception.
The selected private root retains `hosted-quota/<target digest>.json` and its
process-owned lock/recovery files. The 0600 record contains only version, a finite
operation states, reset/null, cooldown deadline and resumed-attempt PID/token/
deadline; no conversation, raw error, credential or
session ID. The digest binds the configured endpoint within the owner-bound root (or an
installer-supplied target ID), is sensitive identity metadata, not anonymization.
Credential rotation does not reopen the gate. The fallback conservatively gates
all credentials for that endpoint within the root; account migration needs setup.
Paired clients must share both root and target identity. Recall and capture have
separate gates within that target. Only verified refusal closes an operation;
normal interrupted requests retain normal retries. Resumed probes carry an
owner PID, token and deadline; stale markers restore their prior refusal.
Unrecognized 429 persists a bounded per-operation cooldown (Retry-After capped
at 24 hours, otherwise five minutes), which expires automatically. Resume clears
cooldowns and repairs malformed regular owned state. Pending cursor/event identity
is preserved. Status shows validated quota reset or “reset unknown”, or the
cooldown deadline; Retry-After never supplies a quota reset.

Gate publication uses a flushed temporary file and atomic rename, consistent
with standalone creator files; it does not promise power-loss durability.
Linux/WSL gate leaves are 0700/0600 and creator-owned. Native Windows standalone
relies on host ACLs; no shared private-state API or directory-fsync rule is
changed, and Windows pairing remains unsupported. Platform shims do not prove
native Windows/macOS acceptance. H5's hosted pause publication and CX-5's
observation remain separate gates. See [protocol 0.2.0](protocol.md#hosted-protocol-020).
