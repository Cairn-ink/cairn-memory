# Privacy and threat model

The main risk in automatic memory is not bad retrieval. It is silently collecting more than the user intended or presenting an inference as trusted fact. Cairn Memory treats capture as a narrow, inspectable boundary.

## Data flow

After explicit installation, automatic capture and content-free telemetry default on. The plugin reads only the newly appended range of a Claude Code transcript. It selects textual blocks whose top-level role is `user` or `assistant`, redacts likely credentials, batches at most 24 messages, and sends them to the configured service.

The service may retain durable Memory text and bounded redacted Source Receipts. It does not need the raw transcript. The hosted service soft-deletes a Memory immediately from recall when the owner invokes `forget_memory`; backup erasure timing is an operational policy and is not claimed by this repository.

## Local state

By default the plugin stores control state under `~/.cairn-memory/`:

- `install-id`: random id used only for anonymous lifecycle telemetry;
- `project-key`: separate random secret used to derive opaque project ids and never transmitted;
- `paused`: presence means capture and recall are paused;
- `sessions/*.json`: byte cursors keyed by a hash of the Claude session id;
- short-lived lock files preventing overlapping capture for one session.

Stop and PreCompact pipe only session id, transcript path, and working directory directly to the detached worker. The plugin does not write a capture queue to disk or add the handoff to the worker environment, and assistant text present elsewhere in the raw hook event is discarded before handoff.

The API token is supplied by Claude Code plugin configuration and is not written by this plugin.

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
