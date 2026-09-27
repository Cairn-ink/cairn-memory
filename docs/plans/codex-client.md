# Codex hooks client contract (C2)

Status: proposed implementation contract; no Codex client is shipped by this
packet. Written against `codex-cli 0.157.1` on 2026-09-27 and repository base
`b8af5cda1820fd0bb385aca784c2d2ee8c036b36`. This packet changes documentation
only. Requirements below describe future behavior, not verified capabilities.

The user switches between Codex and Claude Code on one machine. Both clients
must feed one owner-scoped memory target and derive the same project identity
for the same project path. A receipt remains submitted evidence, not an
authenticated human statement, adoption, semantic truth or execution permission.

Boundaries come from [architecture](../architecture.md),
[protocol](../protocol.md), [capture](../capture.md),
[delivery roadmap](delivery-roadmap.md), [vocabulary](../../CONTEXT.md),
[roadmap](../../ROADMAP.md) and [contributing](../../CONTRIBUTING.md).
Session-start context and session-end semantics belong to the sibling contract
`docs/plans/session-episodes.md` on `docs/session-episodes-contract`, referenced
by name only. This document reserves integration points without defining episode
storage, next-step/habit selection, or their wire shapes.

## Evidence and version boundary

The [official OpenAI hooks documentation](https://learn.chatgpt.com/docs/hooks)
was fetched during drafting. It is unversioned documentation, not proof of every
behavior in 0.157.1. The following summarizes its verified claims:

| Claim | Evidence and qualification |
| --- | --- |
| `SessionStart`, `UserPromptSubmit`, `Stop`, `PreCompact` exist | Verified in current official documentation. **To verify:** introduction in CLI 0.150 and compatibility across every later version. |
| Hook input is JSON on stdin | Verified; common fields include `session_id`, `cwd`, `hook_event_name` and nullable `transcript_path`. |
| Hooks return `additionalContext` | Verified for `SessionStart` and `UserPromptSubmit` through `hookSpecificOutput`; do not assume every event accepts it. |
| User hook locations | Verified: `~/.codex/hooks.json` or inline `[hooks]` in `config.toml`; matching sources merge. |
| Trust review | Verified: `/hooks` reviews definitions; new/changed hashes require trust before execution. This is per definition, not once forever. |
| End versus turn completion | Verified: `SessionEnd` exists separately; `Stop` is turn-level. **To verify:** installed-version lifecycle delivery. |
| Transcript stability | Official documentation explicitly disclaims a stable transcript interface. |

Offline `codex --version` returned `codex-cli 0.157.1`.
`codex --help` and `codex exec --help` both expose
`--dangerously-bypass-hook-trust`; this integration must never use it.
Exec help documents `--ephemeral` and JSONL **stdout** via `--json`; that does
not verify an on-disk session format. Top-level help also lists migration from
legacy rollouts to paginated thread history. **To verify (0.157.1):** which
storage modes supply a readable transcript, its precise schema, flushing and
replacement behavior, and hook execution during headless exit. No actual
conversation, credential config or user session directory was inspected.

All Codex storage examples below are explicitly provisional synthetic shapes.
Do not label their field names or semantics verified from these help pages.
Before enabling capture, package C2-3 must pin primary format documentation or
official versioned schema evidence and exercise a synthetic host fixture.
Unsupported/missing format means capture unavailable, not permissive parsing.
The supported-version matrix must list exact verified versions; do not advertise
“Codex >=0.150” from this evidence.

## Architecture decision

Recommend **extracting a shared client library**, with `integrations/codex/`
as the thin Codex host adapter. A standalone Codex implementation copying the
Claude plugin would be initially smaller, but duplicate redactors, generation
fences, identity creation and cursor fixes would make privacy guarantees drift.

Proposed source ownership:

- `integrations/client/`: dependency-free client policy and mechanisms extracted
  from the plugin: redaction, query preparation, identity, controls, file locks,
  cursor/batching, worker supervision and the transport port.
- `integrations/codex/`: Codex event validation, versioned transcript parser,
  hook output formatting, launcher entry points and installation/control UX.
- `plugins/cairn-memory/`: Claude event/parser glue and native distribution.
  Keep existing imports compatible during extraction. A reproducible generated
  bundle of shared modules must travel inside the plugin installation; installed
  hooks cannot import sibling repository directories that are absent there.
- `core/`: the sole storage, extraction/admission, organization and recall engine.
  Shared client code contains none of those algorithms and no model prompts.

Generated distribution copies are never independently edited implementations.
Require source-to-bundle equality checks and installed-artifact tests. The
Claude plugin retains Node built-ins and native distribution; no new runtime
npm dependency or registry channel is implied. Its current redactor is also
imported by core/MCP/evaluation code and included in the local artifact allowlist;
the extraction owner must preserve those paths through a compatibility export
and update packaging together. Do not silently break the local archive.

The current architecture text says only the plugin may read Claude transcripts.
The intended extension is one allowlisted reader per host: Codex reads only its
supplied transcript; Claude reads only its own. Record that boundary change in
the implementation review. It does not authorize a shared history crawler.

## Shared identity and state

### One derivation key, including simultaneous first use

Use one per-OS-user, machine-local state root for both upgraded clients:
`~/.cairn-memory` by default, or one explicitly configured absolute
`CAIRN_MEMORY_STATE_DIR` used by both. This name is a proposed Cairn setting,
not an existing Codex option. Do not derive its location from the current
project, host plugin cache, or a transcript field. Do not fall back to a temporary
directory when durable state is unavailable.

Preserve the existing derivation exactly:

```text
project-key = persistent UUID v4 string (trimmed, kept local)
project_id = lowercase hex HMAC-SHA256(project-key, UTF8(cwd))
```

Both adapters pass the same host-provided absolute working-directory string.
No host/client name, telemetry installation ID, session ID or target enters this
HMAC. No git-root discovery, filesystem traversal, case folding, realpath or
symlink canonicalization is added: those would change existing project scopes.
Identical paths share identity; aliases, subdirectories, separate worktrees and
different paths remain separate for now. A local configuration mismatch is an
installation failure, not a reason to manufacture another project key.

Reuse the algorithm in the existing
[identity module](../../plugins/cairn-memory/lib/identity.mjs), strengthened with
ownership/type checks in the shared library:

1. Create the state root with mode 0700 if absent, then validate that it is owned
   by this OS user and private (0700 on POSIX).
   Reject symlink state/key paths, wrong owners, nonregular keys and unsafe
   permissions; do not follow a project-controlled redirect. Platform equivalents
   require tests before support is claimed.
2. Read and validate an existing `project-key` (0600 on POSIX). Invalid or
   unreadable state disables memory for this invocation; never overwrite it,
   return a transient key, or fall back to unscoped personal capture.
3. On `ENOENT`, create a unique private temporary file in that same root using
   exclusive creation. Write the full UUID plus newline, flush and close it.
4. Publish with a same-filesystem hard link to `project-key`. This must not
   replace an existing destination. On `EEXIST`, discard the losing candidate
   and read/validate the winner. Both clients derive only from the published
   winner, never their tentative values. Sync the directory before reporting
   durable creation; clean up only the caller's temporary file.
5. Unsupported atomic-publication or permission semantics fail closed for memory
   and open for the host. Never substitute overwriting rename or a partially
   written final file. Crash leftovers do not become authority.

The key is distinct from `install-id`; it never enters a network body, diagnostic,
worker argument, environment handoff or telemetry. Only opaque project IDs leave
the machine. Opaque IDs enable correlation; they are not encryption or anonymity.
An attacker with the key can test guessed paths.

### Existing Claude installations

At this base, Claude uses `CLAUDE_PLUGIN_DATA` when set, otherwise
`~/.cairn-memory`. Merely giving Codex a new default root would fork identities.
Before enabling a second client, explicitly pair the installations and verify
both roots and derivation versions locally, without printing key material.

Prefer adopting the existing private Claude data directory as the configured
shared root, preserving its `project-key`, control generation and cursors. It
must remain stable across plugin upgrades/uninstall. If it is an ephemeral host
directory, a separate pairing operation may migrate state to the default root:
stop both clients/workers, pause old capture, hold an exclusive migration lock,
copy the validated key with no-clobber publication, retain restrictive modes,
and configure both clients to the new root before resuming. Existing different
keys are a conflict requiring the primary owner's identity/history decision;
never choose silently or overwrite either key. Do not search host directories
for candidate keys. Accept only the explicitly selected legacy Cairn state path.

Migration rotates a shared control generation and takes fresh EOF boundaries;
it must not replay old history under a new batch profile. Preserve old state for
rollback, but never run old and new roots concurrently. Old unupgraded workers
do not understand shared controls: two-client support requires the upgraded
Claude adapter and stopped old workers. Moving an existing key does not itself
migrate memories between accounts, endpoints or local stores.

## Hook contract

These are **Cairn budgets**, not Codex defaults. Enforce an internal deadline
before the host's configured `timeout` (seconds). Register absolute, safely
quoted installed command paths; never interpolate transcript fields into shell
commands. Use one registration source to avoid duplicate launches.

| Event | Work and timeout | Failure and forbidden behavior |
| --- | --- | --- |
| `SessionStart` | At startup/resume/clear/compact, establish applicable cursor barriers from file metadata and a one-byte EOF check; call the optional sibling session-context read. Total internal 2.5 s; hook timeout 3 s; context request <=2 s. Return bounded `additionalContext` for this event. | Missing capability, credentials, path or state yields no context and exit 0. Never upload transcript history, infer habits locally, block startup or treat context as instructions. |
| `UserPromptSubmit` | Prepare/redact current `prompt`, bound it to 4,000 UTF-16 units without splitting code points, then recall with project ID and limit 6; request <=2 s, total 2.5 s, hook timeout 3 s. Recheck control generation immediately before injecting `additionalContext`. | Empty query, timeout, outage, auth failure or malformed reply: no context, exit 0. Never send the raw prompt, inspect a transcript for recall, emit a blocking decision or request continuation. |
| `Stop` | Launch incremental capture via a direct stdin pipe. Internal launch <=750 ms; hook timeout 1 s. Return `{}` and exit 0. | Failure drops this launch; retry eligible bytes at a later event. Discard `last_assistant_message`. Never equate a turn ending with session end, return `decision: block`, hold the user for HTTP, or emit plain-text output. |
| `PreCompact` | Same capture launch and 750 ms/1 s budgets. Snapshot the eligible pre-compaction byte boundary when safely available. | Race/replacement can lose uncaptured text; report a content-free gap. Never postpone or prevent compaction, read its summary as conversation, or assume this is session end. |
| `SessionEnd` | If supported by the pinned host, hand off final capture and the optional sibling session-end signal to the same serialized worker. Internal launch <=750 ms; hook timeout 1 s. | Best effort, no blocking/continuation. Never invent an episode payload, wait for model work or report complete capture if bytes remain. Missing event/capability must be visible in status. |

`SessionEnd` is an additional documented integration point, not an assumption
that the four original events contain a session-close notification. **To verify
(0.157.1):** exact delivery during normal/headless shutdown, resume, archive,
delete, interruption and crashes; transcript lifetime after handoff; process
survival under each supported platform/sandbox. Do not synthesize session end
at every `Stop`. Until verified, offer no guaranteed end delivery. Any inactivity
fallback belongs to the sibling contract.

Expose optional internal ports called `readSessionContext` and
`signalSessionEnd`. Their existence/cancellation/deadline handling is owned here;
their request/response semantics and remote availability are owned by
`docs/plans/session-episodes.md`. Pass a trusted owner/target binding, client,
opaque session/project identity and generation through the agreed adapter.
Validate returned context before injection. If absent, no-op with a capability
status; do not invent a hosted endpoint or append episode fields to capture.
Serialize final capture before end notification when capture completes within
budget. End-with-incomplete-capture semantics must be settled by that sibling;
otherwise omit the signal and record `end_pending`, without a content queue.

Every automatic handler fails open to Codex and closed to memory exposure:
catch failures, emit no diagnostics containing input, exit 0, use `{}` for Stop.
Never emit exit 2, `continue: false`, or a blocking/continuation decision. A hard
kill by Codex may still be reported by the host; the adapter cannot guarantee a
silent exit if its runtime never starts. Explicit human control commands instead
return a nonzero status when a requested state change fails.

Bound input to 64 KiB and the event's deadline; stop reading oversized/stalled
stdin. Validate session IDs (1–200 units), nonempty absolute `cwd` and transcript
path (each <=8,192 units), event name and primitive types. Null transcript means
no capture, not a guessed path. The capture handoff allowlist is client/parser
version, session ID, supplied transcript path, cwd, launch generation, project
and client generations, target binding, optional byte end and end-signal intent.
This is local stdin metadata only; discard all other hook fields before launching.

No hook or worker may enumerate session directories, open paths found inside
conversation records, fetch image URLs, read project files, follow transcript
references, or load Codex/Claude credential config. The sole conversation read
is the host-supplied transcript, opened as a regular file with bounded reads;
reject symlinks, devices and FIFOs. Access to explicitly configured Cairn state,
its installed runtime and target settings is separate from conversation access.
No conversation text in queue files, arguments, new environment variables,
logs or crash reports. Detached worker stdout/stderr are ignored; stdin is closed
after the bounded handoff. Use absolute spawn arguments, no shell.

Workers have a 60 s total lifetime, including locks and parsing; per-request
capture timeout <=25 s; session-lock wait <=250 ms and control-lock wait <=250 ms.
Before each batch require enough remaining budget, otherwise leave a retryable
cursor and exit. Parent launch, process supervision and cancellation must be
tested; detachment is not permission for an unbounded background daemon.

## Transcript allowlist and incremental progress

### Provisional format adapter — to verify against 0.157.1

Do not confuse `codex exec --json` event output with session storage. This
contract can support an append-only UTF-8 JSONL rollout only after C2-3 verifies
it. Paginated history, missing transcripts, forks and changed encodings are
unsupported until separately pinned. The following are authored fixture shapes,
**not verified records from a real user session**:

```jsonl
{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"For this project, use concise release notes."}]}}
{"type":"response_item","payload":{"type":"message","role":"assistant","channel":"final","content":[{"type":"output_text","text":"I will keep the notes concise."}]}}
{"type":"response_item","payload":{"type":"function_call_output","output":"EXCLUDED_TOOL_OUTPUT"}}
{"type":"response_item","payload":{"type":"reasoning","summary":[{"text":"EXCLUDED_REASONING"}]}}
```

Proposed parser rules, conditional on primary evidence confirming the format:

- Select one canonical representation of each visible message. Candidate:
  outer `response_item`, payload `message`, exact role `user`/`assistant` and
  approved text block type (`input_text`/`output_text` respectively). Require
  visible assistant channel `final` or a separately verified visible commentary
  channel. Missing/unknown channels are rejected unless the pinned schema proves
  them to mean ordinary visible text. No recursive search for a `text` field.
- Only actual conversational records are eligible. Session instructions,
  environment bootstrap text, compaction replacements and synthetic continuation
  prompts must not pass merely because their encoded role is `user`. **To verify:**
  source discriminators separating these from user input. If indistinguishable,
  disable that format instead of heuristic stripping or claiming compliance.
- Reject reasoning/analysis, encrypted reasoning, summaries, tools/functions,
  tool results, execution output, images/audio, attachments, file references,
  system/developer messages, sandbox/permission metadata, session metadata and
  unknown outer types. Ignore duplicate `event_msg`-style mirrors; do not capture
  both representations. Those candidate type names remain **to verify**.
- Within an eligible message, copy only approved string text blocks into a fresh
  value. Drop nontext blocks without dereferencing them. Redact each complete
  block and the joined text **before** truncation, message DTO construction,
  payload serialization or transport. Reuse and test the same redactor as Claude.
- Capture bounds for the new common profile: <=24 messages, <=4,000 UTF-16 units
  per message, <=20,000 units total, <=64 KiB serialized request. Truncate only
  after redaction and on code-point boundaries. Batch boundaries are deterministic;
  report content-free truncation counts. These tighter bounds fit local core as
  well as hosted limits; they are a proposed change from the Claude plugin's
  current 20,000-unit per-message limit, not a claim about existing behavior.

“No file contents” means no file/attachment/tool-content ingestion. As in the
released plugin, a user can paste a file or an assistant can quote tool output in
ordinary visible text. That remains conversational text and may be sent after
best-effort redaction. The parser cannot infer its origin reliably. Do not promise
that all paths, repository names, personal data or unrecognized secrets disappear.

### Cursor contract shared with Claude

The current [capture worker](../../plugins/cairn-memory/scripts/hook.mjs) freezes
`pendingEnd`, retries deterministic batches, advances after all batches, and
uses [content-free cursors](../../plugins/cairn-memory/lib/capture-cursor.mjs).
Reuse its byte offsets, newline framing, generation fences and process-owned
locks. Do not interpret offsets as characters or JSON record counts.

For the bounded shared worker, version the cursor to additionally persist
acknowledged batch progress. Otherwise a large frozen range can repeatedly replay
its first batches and exhaust every 60 s budget without reaching later bytes.
Store only: version/profile, opaque session/target binding, file identity/epoch,
global/project/client generations, acknowledged offset, frozen `pendingEnd`,
next batch boundary, range integrity digest, discard-until-newline flag and
finite status counters.
No transcript path, raw session ID or conversation text belongs in cursor files.
Namespace cursor/lock filenames by client and target plus hashed session ID;
Claude and Codex may use identical raw session IDs without colliding.

1. Acquire the per-session lock. A live owner never loses its lock just because
   it is old; recover only demonstrably dead owners with token-specific cleanup.
   Read control state again. Reject stale launch generations before reading text.
2. Open/fstat the one supplied file and read at most a 1 MiB window per attempt.
   Process complete newline-terminated lines, using absolute byte locations.
   Defer an unfinished tail. Stream-skip lines exceeding 256 KiB through their
   next newline, with an exclusion count; persist the discard flag and byte
   progress if the line exceeds one read window. Never capture a truncated JSON prefix.
   Invalid UTF-8/JSON lines are excluded and may advance only through their known
   newline. A new unsupported envelope/version disables capture for that format.
3. Freeze the read end, parser/batch profile, target and boundaries before the
   first send. Derive opaque message IDs from client, session, file epoch and
   absolute record/block positions, not range-relative line numbers. Derive event
   IDs from that stable ordered message-ID batch plus profile/target binding.
   Retry identical bytes with identical IDs. Do not reparse a pending window with
   an upgraded policy; drain the old supported profile or explicitly discard it
   at a fresh generation boundary.
4. Start each request under the shared control lock only if global/project/client
   generations still match and that operation remains enabled. Release the lock
   before waiting for HTTP. A validated terminal acknowledgement (including
   duplicate or zero memories) advances that
   batch atomically. `processing: true`, timeout, non-2xx, invalid response or
   uncertain delivery does not advance it. On restart retry the unresolved batch;
   server idempotency covers accepted requests whose local acknowledgement was lost.
5. Never include later appends in the frozen pending window. After all batches
   succeed, advance to `pendingEnd` and clear it. Excluded-only complete ranges
   can advance without a request. Retain acknowledged earlier batch progress
   through a later failure, so repeated bounded invocations eventually progress.
6. A file replacement, truncation, path change or changed pending-range digest
   invalidates the old range. Establish a new EOF boundary and file epoch, record
   a gap, and send nothing from that replacement invocation. Never reset to zero
   and upload a compacted summary or a replayed history. **To verify:** sufficient
   file identity and append-only guarantees on every supported storage mode.

### Required synthetic fixtures

Keep fixtures authored, small and credential-free except for clearly fake
canaries. Each allowed field needs primary schema provenance before the parser
ships; negative fixtures may intentionally use unsupported shapes.

| Fixture family | Required assertion |
| --- | --- |
| User/final assistant and mixed content | Only eligible visible strings survive; distinct clients retain distinct receipt attribution. |
| Tool calls, outputs, nested text, file contents | Unique canaries absent from body, state, logs and hook output; no referenced file opened. |
| Reasoning, analysis, encrypted content | No text or summaries copied, even when nested under an assistant item. |
| Images, URLs, attachments and sandbox metadata | No dereference, base64, path, permission or environment leakage through metadata. |
| Compaction, bootstrap instructions, mirrors | No generated summary/instruction replay; one canonical message captured once. |
| Malformed/truncated/oversized/unknown lines | Bounded resources, safe newline progress, partial tails deferred, unsupported format unavailable. |
| Unicode and credentials at limits/block joins | Redact before truncation; no split surrogate or secret fragment at truncation boundaries. |
| Growth, rewrite, duplicate IDs, fork/resume | Stable absolute IDs, no cross-client cursor collision, EOF boundary on unsupported replacement. Fork history deduplication is **to verify**; disable capture for unverified fork layouts. |

## Transport and target ownership

### Hosted target first

At the fixed base the Claude plugin sends bearer-authenticated requests to
`/api/memory/recall` and `/api/memory/capture`, using the public
[wire contract](../protocol.md). The local SQLite core is not connected to its
automatic hooks. Explicit local MCP submitted capture is a different path.

Codex must use that same hosted wire shape with `client: "codex"`, stable
`event_id`, `session_id`, shared `project_id`, and only redacted message DTOs.
For the new common profile, derive wire session IDs from a versioned hash of
client and host session ID; do not serialize arbitrary host identifier text.
This preserves distinct source sessions while project identity stays shared.
Recall uses `query`, `project_id`, `limit`; it has no client field today. Use the
same endpoint/account in both clients; equal project IDs do not cross owner
boundaries or join two different services.

**Blocking compatibility dependency:** the current
[capture schema](../../schemas/capture-request.schema.json) restricts `client`
to `"claude-code"`. C2-4 must add `"codex"` with public schema/conformance/privacy
review; a compatible hosted deployment must support it before enabling sends.
Never masquerade as Claude to evade validation. **To verify:** hosted Codex
acceptance; no service request was made in this packet. Do not infer deployment
from a schema merge. Session context/end need their sibling's separate capability.

Use existing endpoint validation (HTTPS; HTTP only on explicit loopback hosts),
reject URL credentials/query/fragment, and reject redirects rather than forwarding
conversation data elsewhere. Get only the explicitly configured Cairn token,
never a model/host credential. Status reports configured/missing, not its value.
Disable Codex telemetry initially; no new telemetry endpoint or schema expansion
is required. Preserve Claude's independent telemetry control.

### Small shared port and the local automatic-capture dependency

Define one injected `MemoryTransport` used by both client workers:

```text
recall(redactedQuery, trustedProjectBinding, limits, signal)
capture(redactedBatch, trustedSessionProjectBinding, eventId, signal)
optional readSessionContext / signalSessionEnd (sibling-owned shapes)
```

The port validates bounded replies and distinguishes terminal acknowledgement,
processing, unavailable and failure. Targets advertise capabilities through trusted
installation configuration, not model arguments. The hook path never selects an
owner, endpoint or filesystem target from conversation text. Keep target binding
in replay/cursor identity. Switching target establishes fresh EOF boundaries;
do not silently backfill old history, dual-write, or fall back from local to hosted.

**Dependency L1 — shared local automatic capture** is a separately reviewable
package delivered at `adapters/local-capture/`, with common-port wiring in
`integrations/client/` and installed-artifact support. It delivers local automatic
capture for **both** clients; neither the Codex parser package nor the session
episodes package owns it.

L1's smallest transport is a local one-shot Node subprocess with bounded JSON
stdin/stdout, launched by the same shared worker, not a new HTTP service or a
second database. The subprocess imports the installed public core and configured
model adapter. It maps common capture to `core.capture`, and common recall to
core recall using startup-bound owner and exact personal/project read sets. The
input cannot override the owner, store path, extractor, scope policy or read set.
Project capture remains project-private; no project ID means explicitly selected
personal scope, never a fallback for failed identity derivation.

Map local camelCase DTOs and processing/duplicate results at this boundary;
do not pretend the JavaScript API is the hosted HTTP schema. Reuse the common
4,000-unit/20,000-total batch profile and 64 KiB request cap, with <=256 KiB replies.
Requests have the same 25 s cancellation and 60 s worker lifetime limits; timed-out
core work may finish or hold its lease, so retry the same event and honor
`processing` rather than inventing success. L1 must test child termination,
transaction recovery and eventual lease expiry. No durable text queue is needed.

An installed model-capable capture configuration and explicit automatic-capture
consent are prerequisites; a keyless store does not imply extraction capability.
“Local target” describes storage/transport, not necessarily offline inference.
Configured provider calls may transmit text and incur costs. Staged retention,
causal ordering, qualification and automatic retirement remain separately explicit
core options; this client does not enable them by analogy with hosted capture.

## Controls and pause boundaries

Choose **shared pause/resume**. A person pausing memory while switching tools
should not leave the other client collecting the same project's conversation.
The shared root holds the existing global `control.json`/`control.lock` protocol
and compatibility `paused` marker. Global pause suppresses automatic capture,
recall injection, session context and end notification in both clients. It does
not delete memories or prevent separately invoked explicit memory tools.

Reuse [control-state semantics](../../plugins/cairn-memory/lib/control-state.mjs):
pause rotates the generation; resume preserves that barrier; invalid state is
paused. Workers retain their launch generation. Check under the same control
lock before every network/local dispatch and before emitting recall/context.
Do not hold that lock over a network/model wait. Requests started before pause
may finish; later requests and stale response injection cannot cross the barrier.

For each session whose cursor generation differs (including missing cursors after
restart), the first eligible hook after resume records current EOF and sends
nothing. If EOF bisects a line, discard through its next newline. This deliberately
skips unprocessed pre-pause, paused and early resumed text. Do not guess a pause
timestamp or replay a hidden session. SessionStart may establish this boundary
earlier; workers still enforce it when SessionStart did not run.

Add an explicit project capture switch keyed by opaque project ID in shared
state. `project disable` stops capture/end signals in that project across both
clients and rotates a project generation under the same control lock. Recall
may remain active; status must say so. `project enable` preserves the barrier
and establishes fresh session EOF boundaries before capturing again. Global
pause takes precedence. Do not use a repository marker file or a project name
in state. Commands are proposed Cairn controls, not shipped CLI syntax.

| Operation | Required installation/control behavior |
| --- | --- |
| Install | From a reviewed local artifact, pair shared identity/state and target, show text/receipt retention and provider boundaries, then install only named Cairn hook entries with explicit timeouts. Preserve other hooks/config. Enable capture only after parser, hosted/local capability and user trust gates pass. No registry publication is part of this package. |
| Trust | The person uses `/hooks` to inspect command paths, sources, events, budgets and privacy behavior, then trusts the current definitions. Updates can require another review. The installer never edits Codex's trust store or bypasses review. |
| Pause/resume | Same durable global state from either host; explicit failures return nonzero and do not claim success. Show the conservative EOF skip after resume. |
| Disable this client | Under the shared control lock, persist client-enabled=false and rotate its client generation; check both at launch, dispatch and injection. Stop its workers, then disable its Cairn hook registrations. Re-enabling preserves that barrier and creates a fresh EOF boundary; stale workers cannot revive. Other client controls remain effective. Removing hooks alone cannot recall an in-flight request. |
| Stop project capture | Use the shared project switch described above. Do not mislabel it as deleting memory or disabling recall. Global pause stops both if desired. |
| Status | Report adapter/CLI/parser version, target/capabilities, identity pairing, global/client/project controls, credentials present/missing, pending/acknowledged progress and finite failure/gap counters. Do not read conversation text or print tokens/keys/raw paths/session IDs. Hook trust is “unknown/to verify” unless an installed-version interface actually verifies it. |
| Uninstall | Disable/fence this client, stop workers, remove only its installed Cairn hooks/runtime. Retain the shared key, controls and other client's data. Explicit separate cleanup/forget is required for stored memories; uninstall cannot erase prior service/provider copies. |

## Threat-model deltas

Codex's unstable storage and potential duplicate message representations widen
the risk of unintended ingestion. Reasoning items, summaries and machine-injected
instructions require explicit exclusion; visible role labels alone are insufficient.
Version mismatches must reduce availability, never broaden the allowlist.

Hook inputs may include permissions, sandbox metadata, model names and assistant
text outside the transcript. None is memory evidence. Do not interpret sandbox
settings as authority to read more files or use other credentials. **To verify
(0.157.1):** actual hook process privileges; do not assume Codex's tool sandbox
confines the hook process or a detached child. Bound reads and state access in
the adapter regardless.

Recalled memories enter host context but remain untrusted source-attributed data.
Validate, size-limit (<=8,000 UTF-16 units and <=32 KiB including framing) and
label them; include receipts and prefer the current user message on conflict.
Drop complete excess entries rather than stripping their provenance to fit.
Redact returned text defensively before output. Never execute recalled commands,
infer current approval from historical text or capture injected context as user
speech. Host retention of injected context is a separate privacy exposure.

Shared keys/controls intentionally link both clients for one OS user. A malicious
same-user process can tamper with transcripts or state; this is not a security
boundary against account compromise. Lock metadata, opaque identifiers and
digests can still reveal linkage. Shared permissions must exclude other OS users;
do not place the state directory in a synced repository. No remote key sync,
new telemetry, recursive scanning or complete-history retention is introduced.

## Acceptance gates

Implementation acceptance runs offline on **Node 22.16 and Node 24**, using
temporary synthetic state, fake credentials, loopback HTTP and scripted model
ports only. Record exact runtime/platform/artifact versions and exit codes.
Passing these tests is not a semantic-quality or real-host interoperability claim.

| Gate | Observable evidence |
| --- | --- |
| A1 — Delivered-body privacy | Launch the real adapter/worker subprocess against a local HTTP server. Assert the **received body**, for capture and recall, contains redacted canaries and no raw secret/tool/reasoning/image/metadata canaries. Also inspect temporary state and captured stderr/stdout for leaks. A mocked redactor or serializer is insufficient. |
| A2 — Shared pause and restart | Pause from Claude while Codex waits and vice versa; resume, restart both, append a split line, include a previously unseen session and delay a pre-pause recall reply. Assert stale workers dispatch nothing, stale replies inject nothing, first resumed capture records EOF only and subsequent complete messages work. Already-started requests may finish, but no next batch starts. Repeat for project disable/enable and client re-enable. |
| A3 — Concurrent identity | Launch at least 16 mixed Claude/Codex processes on an empty shared root at once. Assert one persisted key and identical same-path project IDs, including restart; different paths differ. Kill a creator before/after publication; test invalid keys, symlinks, unsafe permissions, unavailable filesystem and migration conflicts. No transient identity, lost winner or transmitted key. |
| A4 — Cursor liveness/replay | Use >24 messages, frozen tails, Unicode byte offsets and appends between retries. Inject first/middle/last-batch timeout, `processing`, invalid replies, server acceptance followed by lost response, and crash after acknowledgement before cursor write. Verify stable replay IDs, no premature advancement, no duplicates at the idempotent receiver and eventual later-batch progress under repeated worker budgets. |
| A5 — Fail-open and bounds | Test stalled stdin, malformed event, absent/null path, auth failure, offline service, spawn failure, dead/live lock, corrupt state, response overflow and unsupported format. All handlers finish within internal budgets with exit 0/no blocking output; Stop returns valid JSON. Controls fail explicitly when persistence fails. Test detached child survival and termination in synthetic launcher fixtures. |
| A6 — Installed sharing | Install the actual generated artifacts in temporary prefixes, with no repository-relative imports. Both use one state root and same hosted stub or L1 core store. Preserve Claude compatibility exports, existing gates, independent session cursors and cross-client private recall. Local L1 tests use actual core with scripted models and verify namespace isolation, correction/forget freshness and no hosted fallback. |
| A7 — Lifecycle capability | Synthetic host/schema evidence proves SessionStart/context mapping and end-signal ordering, duplication handling and incomplete-capture behavior against the settled sibling contract. No false episode-complete status when capability or final bytes are missing. |

Later, a **person** performs a separately authorized two-client check; do not
perform it in this packet. In a disposable project, use the same reviewed state
root, exact cwd and memory target/account. Confirm matching opaque project IDs
locally without exposing the key. In Codex state a unique harmless project-only
preference and wait for capture acknowledgement. Start Claude Code in that same
path and ask a relevant question without restating the preference. Verify recall
contains the same project memory and its Codex source receipt. Repeat the reverse
direction, verify a different project does not receive that project memory, then
pause from one client and verify the other stops automatic requests. Record
versions, sanitized receipt IDs, outcomes and any unsupported lifecycle behavior;
forget the synthetic memories afterward. No real transcripts enter test evidence.

## Ordered implementation packages and ownership

These are future review units, not permission for this docs-only worker to edit
their files. Each package gets a fixed base and its own verification. Owners are
roles for the primary agent to assign; no parallel editing of shared files.

| Order/package | Allowed files and exclusive shared-file owner | Dependencies and completion boundary |
| --- | --- | --- |
| C2-1 — Shared client extraction | Shared-client owner: `integrations/client/**`; compatibility modules and consumers in `plugins/cairn-memory/lib/**`, `scripts/**`, `test/**`; `packaging/**`; necessary import-compatibility tests. Keep core/adapters imports working without engine changes. | Extract existing behavior first; source/bundle parity and installed Claude regressions pass. No Codex enablement or distribution-channel change. |
| C2-2 — Paired state and controls | Same shared-client owner: `integrations/client/**`, Claude `scripts/**`, `skills/**`, `lib/**`, `test/**`, plugin README; pairing/control documentation. | C2-1; shared key, migration, generation and project/client fences; A2/A3 pass. No real key/config migration during development. |
| C2-3 — Codex format and hook adapter | Codex owner: `integrations/codex/**` with synthetic fixtures/tests and README. Shared-client owner alone edits shared cursor/worker files for agreed parser metadata and acknowledged-batch progress. | C2-1/2; resolve primary format evidence and 0.157.1 host matrix, A1/A4/A5 against stubs. Unknown formats remain disabled. |
| C2-4 — Hosted compatibility | Protocol owner: `schemas/capture-request.schema.json`, dependent response/receipt schemas only if required by their client discriminator, protocol/conformance tests, `docs/protocol.md`, `docs/privacy.md`, `docs/architecture.md`; shared-client owner owns hosted serializer. | C2-3; truthful Codex client discriminator, strict allowlist and receiver conformance. Hosted deployment acceptance is an external dependency, never part of this public code package. |
| L1 — Local automatic capture for both clients | Local-host owner: `adapters/local-capture/**`, local-host tests/docs and `packaging/**`; shared-client owner owns common local transport. Existing core API only; any required engine change is a separately scoped package. | C2-1/2/3 and installed core/model configuration; A6 with actual core/scripted models. Both adapters use one port. Does not depend on hosted rollout or authorize model spending. |
| C2-5 — Install and lifecycle wiring | Codex owner: `integrations/codex/**` installer/control entry points; Claude owner: plugin hooks/skills/docs/tests; sibling owner: episode/context adapter. Packaging owner serializes `packaging/**` edits after L1. | Hosted capability or L1, parser/identity gates and settled sibling ports; offline install/disable/uninstall, A7. Context/end remain visibly unavailable where unsupported. |
| C2-6 — Acceptance and documentation | Verification owner: integration tests/fixtures and sanitized docs evidence; documentation owner: this plan, architecture/privacy/contributor guidance, `docs/limitations.md`, roadmap if a gate changes. | A1–A7 on both runtimes; later human check separately recorded. No release/publication claim from mocks. |

The primary integrator exclusively owns root `package.json`, CI workflows,
cross-package file lists and version/release metadata throughout. Shared file
changes land serially or as an explicit handoff, never as competing worker edits.
C2-1 packaging may preserve the old redactor path via a shim and include its new
dependency; this avoids an unscheduled core refactor. L1 cannot introduce a
second extractor, ranker or store to avoid coordinating with core ownership.

## Open questions and non-goals

Open questions are release gates where indicated, not assumptions to fill with
private transcript inspection:

1. **To verify (0.157.1, blocking capture):** primary session format/schema and
   discriminators for actual user text, visible assistant channels, bootstrap and
   compaction text; legacy versus paginated storage and fork/resume identity.
2. **To verify (0.150/0.157.1):** minimum hook version, exact installed lifecycle
   coverage, transcript flush/lifetime, sandbox privileges and detached-process
   behavior. Current docs alone do not establish them.
3. **Blocking hosted capture:** will the compatible service accept `codex` and
   supply conforming receipts/idempotent acknowledgements? The current strict
   schema and public-before-hosted rollout rule forbid sending it today. The
   product choice is preserved as a dependency, not silently contradicted.
4. **Blocking shared identity rollout:** which existing Claude state root is
   durable, and how should already-divergent keys/history be reconciled? The
   primary owner decides conflicts. Path aliases/subdirectories/worktrees remain
   separate until a versioned identity migration is approved.
5. **Blocking lifecycle claims:** the sibling contract must settle end-signal
   idempotency, incomplete capture, resumed sessions and any inactivity fallback.
   It also owns context payloads and availability; no exact shape is assumed here.
6. **Boundary review:** update the plugin-only transcript-reader wording for the
   additional thin host adapter, and approve shared-source bundling while retaining
   Claude's native distribution/no-dependency boundary. Local automatic capture
   stays L1's responsibility; MCP connection alone is never automatic capture.
7. **To verify before platform support:** atomic publication, permission checks,
   process locks and process termination on Windows/non-POSIX filesystems. The
   default design targets a private local filesystem, not network/shared volumes.

Non-goals: implementing or migrating the hosted service; UI; ChatGPT or other
chat clients; publishing to any registry; team/community sharing; cross-machine
key sync; arbitrary transcript import or complete-history backup; source-file,
tool-output, reasoning or image ingestion; a second memory engine; guaranteed
semantic extraction, adoption or currentness; episode implementation; paid model
experiments; real-user transcript collection; production deployment or PR creation.

## Draft verification

On the available Node `v22.16.0`, `npm test` exited 0 (106 passed, none failed or
skipped), and `npm run validate` exited 0 (JSON and version consistency). These
are existing repository gates, not implementation acceptance for the proposed
Codex client. No Node 24 claim or human two-client check is made by this packet.
CLI version/help commands exited 0, with a read-only PATH-alias warning.
The optional isolated Claude validator was not installed in this worktree
(availability check exited 1); no dependency installation was performed.
All 13 relative Markdown links resolve (checker exited 0). `git diff --check`
and the staged equivalent must exit 0 before the local commit.
