# Cairn.ink Memory for Claude Code

Cross-session memory that keeps receipts. This plugin recalls relevant private context before a
prompt and captures durable user/assistant conversation context after a turn. It reads the
Claude-provided transcript path and working directory only to process the transcript and derive an
opaque project id. It does not read arbitrary project files and excludes tool-result/tool-use
blocks. Ordinary conversation text, including pasted files, terminal output, paths, or repository
names, can still be sent to the configured service.

## Install

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

Registration of a genuine legacy-gap adoption first writes
`<profileRoot>/.cairn-memory-profile/legacy.json` (0600 inside a 0700 Cairn-owned subdirectory). It
records version, profile root and adopted default root, with no key or conversation content, and is
never transmitted. This validated local history preserves that adoption only in degraded mode. With
absent or empty coordination, local legacy history refuses with `pairing_record_missing`; it never
authorizes silently minting a different identity. With readable registration it does not bypass
profile ownership gates. Initialization, adoption, completion, reset destinations and repair publish
a private `paired-root` marker in the shared root. Its positive presence, valid or invalid,
permanently excludes cursor-based legacy adoption of that root, including after coordination loss.
It does not pause or disable an otherwise entitled client. A fresh profile gets its own key after
loss; an explicitly delivered missing record still reports `pairing_record_missing`. An existing
profile key takes precedence. With readable coordination, only the registered profile follows its
binding; another profile stays standalone. Unsupported registration on Windows adds no unregistered
status note. An unrelated damaged default root does not prevent registration or add a status note.
Only absolute plugin-data paths are registered, normalized with `path.resolve`; relative, empty or
invalid paths retain standalone behavior without registration. Every install record is validated
before publication.

Reset pauses the old shared root, rotates its generation, and writes a private `retired` marker
there. Retirement is checked only at the selected root. A present `retired` entry, valid or invalid,
disables that root with `pairing_needed`; resume refuses to unpause it. Missing or inaccessible
entries, non-directory roots and roots owned by another user are not retirement evidence. An
unrelated default root cannot disable an unpaired plugin-data profile. Setup refuses a marked
destination with `retired_root`, including an implicit default destination, and requires another
unmarked root. Status remains a single token; explanations are separate details. Disabled hooks exit
0 without requests, while explicit controls fail visibly.
