# Privacy and threat model

This page describes the hosted plugin path and explicitly marked proposed local
changes below. Current local storage and deletion boundaries are documented in
[Local store](local-store.md); local model/MCP data exposure is documented in
[Protocol](protocol.md). Core has no network client or telemetry, but a configured
injected model adapter can send source text to its provider. Local storage alone
is not a promise of offline interpretation.

The main risk in automatic memory is not bad retrieval. It is silently collecting more than the user intended or presenting an inference as trusted fact. Cairn Memory treats capture as a narrow, inspectable boundary.

## Data flow

After explicit installation, automatic capture and content-free telemetry default on. The plugin reads only the newly appended range of a Claude Code transcript. It selects textual blocks whose top-level role is `user` or `assistant`, redacts likely credentials, batches at most 24 messages, and sends them to the configured service.

Automatic recall separately sends the current prompt after local credential
redaction and truncation to at most 4,000 UTF-16 units without splitting Unicode
code points (also within the public schema's 4,000-character limit). Redaction runs
before truncation so a credential crossing that boundary is not partially sent.
Empty queries are skipped. Neither path can guarantee detection of every secret.
Tool blocks are excluded from capture, but ordinary conversation can include
pasted files, terminal output, paths, and repository names.

The service may retain durable Memory text and bounded redacted Source Receipts. It does not need the raw transcript. The hosted service soft-deletes a Memory immediately from recall when the owner invokes `forget_memory`; backup erasure timing is an operational policy and is not claimed by this repository.

## Local state

By default the plugin stores control state under `~/.cairn-memory/`:

- `install-id`: random id used only for anonymous lifecycle telemetry;
- `project-key`: separate random secret used to derive opaque project ids and never transmitted;
- `control.json`: content-free pause state and generation barrier;
- `paused`: compatibility marker also honored as a pause;
- `sessions/*.json`: byte cursors, pending retry bounds, generation, and incomplete-line discard state,
  keyed by a hash of the Claude session id;
- process-owned lock files coordinating control changes and session capture.

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
permission. Disabled groups contribute no content. A final atomic reread fences
changed epochs, identities, tags and sources after counting. A host forwarding
this response to a provider must reserve its own framing headroom and treat all
content as data. Read budgets do not establish relevance or semantic support.

Explicit step closure retains only content-free action/identity replay markers
in the existing journal, with action IDs HMAC-bound using the private episode
key. Replays cannot close a different step or advance a read epoch. Descriptive
closure evidence remains source-bound and is cleared by source invalidation or
conversation deletion. Schema v17 adds read indexes only; these indexes add no
new source text or retention policy. Existing file, journal and backup limits apply.
