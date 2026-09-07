# Privacy and threat model

This page describes the hosted plugin path. The separate, source-runnable local
storage preview has no outbound processing or telemetry; its database contents,
trust boundaries, and deletion limits are documented in [Local store](local-store.md).

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
