# Cairn.ink Memory for Claude Code

Cross-session memory that keeps receipts. This plugin recalls relevant private context before a
prompt and captures durable user/assistant conversation context after a turn. It reads the
Claude-provided transcript path and working directory only to process the transcript and derive an
opaque project id. It does not read arbitrary project files and excludes tool-result/tool-use
blocks. Ordinary conversation text, including pasted files, terminal output, paths, or repository
names, can still be sent to the configured service.

## Install

With Node ≥22.16 and the Claude Code CLI:

```sh
npx @cairn-ink/memory setup
```

This checkout prepares installer **0.5.0**; publication is a separate step.
Try it with `node packages/setup/bin/memory.mjs setup`. The plugin stays 0.3.2.
Setup asks about new tools, updates connected tools, and uses one browser sign-in
when connecting both. The default server is cairn.ink. Conflicting servers or
memory IDs present a choice; non-interactive conflicts change nothing.
Automated `codex exec` runs skip capture and prompt recall by default; opt in with
`npx @cairn-ink/memory config --codex-capture-exec on`.
Setup never reads or imports Claude Code's native secrets.
Claude first, Codex added later: one new browser approval in the same account.
Codex first: reuse its installer-owned sign-in when adding Claude.
Use `--client claude` to
restrict setup to this plugin. Setup prints the plugin and installer versions
separately and saves credentials through stdin. Enter the displayed code on
`/device`; use `--no-browser` to open it yourself or `--client claude --manual-token`
for hidden PAT paste. Existing credentials and endpoints stay unless
`--reauthorize` is specified; that run reports replacement. A kept credential plus
`--endpoint` requires `--reauthorize`, while `setup --dry-run --endpoint X` remains
a read-only preview. Legacy MCP removal requires confirmation after
configuration. `setup --dry-run` previews locally; unscoped `status` reports both
tools. Non-TTY unscoped setup never auto-consents or installs.
[Installer details](../../packages/setup/README.md)

Manual fallback inside Claude Code:

```text
/plugin marketplace add Cairn-ink/cairn-memory
/plugin install cairn-memory@cairn-memory
```

1. Create a personal access token in Cairn.ink settings.
2. Add the `Cairn-ink/cairn-memory` marketplace.
3. Install `cairn-memory@cairn-memory` and supply the endpoint and token when prompted.

See the repository README for exact commands, privacy guarantees, and local development.

The plugin has no npm dependencies. It needs the Node.js runtime already required by Claude Code.
The bundled Cairn MCP server also exposes explicit `remember_memory`, `recall_memory`, and
`forget_memory` tools.

## Privacy controls

- Automatic capture starts only after explicit plugin installation and is on by default.
- Only textual user and assistant message blocks are allowlisted. From 0.1.1, user-role records that
  Claude Code writes itself are not sent. That covers meta records (local-command caveats,
  image-source notes), compaction summaries, records carrying a tool result, and text that starts
  with a Claude Code wrapper (slash-command, local-command or bash-mode output, and similar). This
  includes retries of a window 0.1.0 had queued before the upgrade. Anything 0.1.0 already delivered
  stays with the service. Assistant text is unchanged. Details and limits are in the repository's
  `docs/privacy.md`.
- Supported credential shapes are replaced locally with `[REDACTED]` in capture text and automatic
  recall queries before transmission; unrecognized secrets may remain.
- Automatic recall sends the redacted current prompt, bounded to the protocol query limit, to the
  configured service.
- Project paths are hashed locally into an opaque scope id.
- Prompt recall sends the host's `session_id` only when it matches the 1–200
  character ASCII allowlist (`A–Z`, `a–z`, `0–9`, `.`, `_`, `:`, `-`). Invalid or
  unavailable ids are omitted. The server stores only an owner-scoped SHA-256
  hash. Models never supply this id, and it is never logged or sent in telemetry.
  Only the exact old recall schema rejection permits one retry without the field.
- `/cairn-memory:pause` and `/cairn-memory:resume` control automatic capture and recall.
- `/cairn-memory:status` reports state without printing the credential.
- Remote endpoints require HTTPS; plain HTTP is accepted only on explicit loopback hosts for local
  development.
- Content-free telemetry can be disabled in plugin configuration. Its schema accepts only event
  name, plugin version, platform, and a random installation id.

Hooks fail open: timeouts, auth errors, and service outages never block normal Claude Code work.
Explicit pause/resume commands report control failures rather than claiming success. After resume,
each session's first capture hook skips its current unprocessed history; later complete messages are
eligible. Requests already started before pause may still finish.

Capture is handed to a detached worker so it survives both interactive sessions and `claude -p`
teardown without delaying Claude's response. The launcher pipes only session id, transcript path,
working directory, and a content-free control generation directly to the worker, without a queue
file. The worker environment adds `CAIRN_MEMORY_STATE_DIR` and, when supplied by the launcher, the
pairing-record option; it does not carry conversation text. See the repository security policy
before reporting a possible privacy issue. Unpaired hooks ignore that state-directory value; only
paired launcher handoffs validate it.

## Explicit pairing (0.1.2)

Standalone Claude keeps its existing key and root. Leave `pairing_record` unset unless you have
explicitly adopted a shared Cairn root. Set it to the absolute
`~/.cairn-memory-clients/pairing.json` path in plugin configuration after both clients/workers are
stopped and the shared binding is prepared. The option reaches hooks as
`CLAUDE_PLUGIN_OPTION_PAIRING_RECORD`; setup tooling is not shipped here. Both clients must be
configured before the shared binding becomes active.

`pairing_needed` means a newcomer is disabled, or an established client retains its own key while
sharing awaits confirmation. `paired_key_missing` disables both clients' memory without blocking
host work. Do not generate a replacement key: restore the original 0600 backup with both clients
stopped, then verify project IDs. An explicitly confirmed identity reset changes scope and requires
fresh adoption.

Paired pause/resume uses one shared generation and discards paused history at EOF. Old workers must
be stopped during pairing. Shared state across PID namespaces is unsupported. Pairing supports Linux
within one PID namespace and macOS; native macOS host behavior and Claude configuration on real
hosts remain to verify. See [privacy](../../docs/privacy.md) and the
[shared API](../../integrations/client/README.md) for state and recovery details.

Distinct Claude plugin-data roots keep separate keys and pause state. With `CLAUDE_PLUGIN_DATA`
unset, Claude uses the default root as 0.1.1 did and can share its key and pause. A different
profile from the registered one runs as `standalone_unregistered`; it does not adopt that
registration. Only when no active or retired Claude registration exists may a keyless profile use
evidence of pre-0.1.2 Claude use in the legacy default root.

macOS setup-lock boot estimates tolerate two seconds of sampling drift. A wall clock step larger
than two seconds while a lock is held can make a live owner look stale; setup lock holds are short,
and native host verification is pending.

An explicitly delivered record for another profile fails with `pairing_record_mismatch`. Hooks still
exit successfully without memory requests; status and explicit controls report the mismatch.

Reset retains Claude's profile ownership even when Codex is primary. With Codex as primary, that
Claude remains disabled with `pairing_needed` until explicit re-adoption; a stale delivered record
reports `pairing_record_missing`. Setup profile conflicts report `claude_profile_mismatch`, distinct
from wrong-record delivery.

Every binding operation also writes private `<profileRoot>/.cairn-memory-profile/binding.json` (0600
inside a 0700 directory), containing version, profile root, bound root and a non-secret identity
fingerprint. It contains no key or conversation data and is never transmitted. Both reset primaries
rewrite it to the new root. Clearing an option does not remove it; CX-2 has no leave API. With
binding history, missing, empty or untrusted coordination disables memory with
`pairing_record_missing`, with no key creation or requests. Invalid binding history also refuses.
If both the key and coordination are lost,
explicitly call `resetIdentity` with the affected `claudeProfileRoot`, a new durable `root`,
`primaryClient`, `confirmIdentityReset: true`, and `hostsStopped: true`. This knowingly starts
new project scope; it requires valid binding history and rewrites that history.
Trusted coordination with a different identity reports `binding_identity_mismatch`.

A `paired-root` entry prevents every ordinary key-creation path from replacing a lost key, including
standalone access to that same root. Only explicit original-backup repair may restore it. An
unset-plugin-data profile still shares an existing default-root key and pause when it has no
conflicting binding history. A never-paired profile whose own root differs from the pair root cannot
use that identity or change its pause. For state carrying 0.1.2 history, these invariants take
precedence over standalone parity.

Cursor-based legacy adoption requires a valid `project-key`, Claude-only cursor evidence, no active
or retired Claude registration, and no `paired-root` entry. Garbage keys and directories named
`project-key` do not qualify.

For profiles without 0.1.2 binding or legacy history, absent coordination preserves normal 0.1.1
first use, including an unusable HOME, a missing path, ENOTDIR, or a non-directory/foreign
coordination entry. Degraded means an owned coordination directory cannot be listed, or its existing
records cannot be read or trusted. It never creates a project key or infers adoption from Claude
cursors. Without a delivered record, it uses an existing profile key, or a validated profile-local
adoption record naming an existing default-root key. An eligible unretired root remains active as
`standalone_unregistered`, with separate detail `coordination unreadable`. Otherwise memory is
disabled with `pairing_needed`; a lost locally recorded standalone key in an unmarked root reports
`standalone_key_missing`, never `paired_key_missing`.

Explicit setup records adopted scope in the private profile-local `binding.json`.
Binding history contains the root and a non-secret fingerprint,
never a key or conversation. With absent or degraded coordination it refuses with
`pairing_record_missing` until repair or an explicit reset to a new root.
Initialization, adoption, completion, reset destinations and repair publish
a private `paired-root` marker in the shared root. Its positive presence, valid or invalid,
permanently excludes cursor-based legacy adoption of that root, including after coordination loss.
It does not pause or disable an otherwise entitled client. A fresh profile gets its own key after
loss; an explicitly delivered missing record still reports `pairing_record_missing`. An existing
profile key takes precedence. With readable coordination, only the registered profile follows its
binding; another profile stays standalone. Standalone on Windows adds no unregistered
status note. An unrelated damaged default root does not affect another profile or add a status note.
Only explicit setup registers absolute plugin-data profiles, storing their resolved real paths.
Relative, empty or invalid paths retain standalone behavior without registration. Every install
record is validated before publication.

Reset pauses the old shared root, rotates its generation, and writes a private `retired` marker
there. Retirement is checked only at the selected root. A present `retired` entry, valid or invalid,
disables that root with `pairing_needed`; resume refuses to unpause it. Missing or inaccessible
entries, non-directory roots and roots owned by another user are not retirement evidence. An
unrelated default root cannot disable an unpaired plugin-data profile. Setup refuses a marked
destination with `retired_root`, including an implicit default destination, and requires another
unmarked root. Status remains a single token; explanations are separate details. Disabled hooks exit
0 without requests, while explicit controls fail visibly.

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

Creator evidence and publication recovery follow the canonical
[local-state policy](../../docs/privacy.md#identity-creation-and-crash-recovery).

Interrupted setup is retried with the same explicit call. Pending initialization
reuses its winner without demanding adoption; pending reset to the same root skips
the fresh-destination test. A matching reset receipt permits a zero-write retry,
returning `identity_reset`, `alreadyComplete: true`, `writes: 0`, and the disclosure.
Later setup operations supersede it atomically with their install-record write;
reset to the current root then refuses with `identity_reset_requires_new_root`.
Initialization retains the original pause flag across its barrier.
Unreadable key probes refuse with `state_unreadable`, rather than treating the key
as absent or skipping retirement.
