# Cloud mode in detail

Most people should run `npx @cairn-ink/memory setup --cloud`.
The [installer guide](../packages/setup/README.md) is the reference for options.
This page keeps the manual connection paths and the plugin's privacy contract.

## Existing hosted integration

The hosted plugin connects to cairn.ink, automatically captures allowlisted
conversation text and has its own telemetry defaults. Its service has not been
migrated to the local engine.

See the [changelog](../CHANGELOG.md) for hosted protocol changes and the
[installer guide](../packages/setup/README.md) for current client compatibility.
Matching server support remains a separate requirement; installing the client
does not deploy a server.

## Install for Claude Code (automatic memory)

Run the published installer from your terminal:

```sh
npx @cairn-ink/memory setup
```

See the [installer guide](../packages/setup/README.md) for release status and
setup options. To run this checkout instead, use `node packages/setup/bin/memory.mjs setup`.

Without `--client`, setup finds both tools and asks only about new connections.
It updates connected tools. Close both tools and wait for background work before
confirming shared memory. The sign-in line shows the server (default cairn.ink).
There is no endpoint or daily-cap question; `--endpoint` remains available.

Conversations are saved after best-effort local masking. Each prompt sends a
masked, length-limited copy for recall. Claude usage stats are on by default and
can be turned off. Codex's sign-in is stored in an unencrypted user-only file.
See [privacy and controls](https://cairn.ink/memory/privacy).

A memory ID connects the same project across tools. Existing IDs are retained.
Server conflicts offer two choices; unsafe Codex credential migrations require
logout first. When two independent IDs exist, choose one; the other key is backed
up only after successful sign-in and validation, never deleted. Old projects may
no longer automatically match the old ID. Non-interactive conflicts write nothing.
Setup never reads Claude native secret files. Adding Claude after Codex validates
and reuses the installer credential; adding Codex after Claude needs one browser
sign-in using the same account. Claude's existing sign-in is kept.

Automated `codex exec` runs skip both automatic capture and prompt recall by
default. Opt in with `npx @cairn-ink/memory config --codex-capture-exec on`;
use `off` to restore the default. This setting enables both capture and recall
for exec. `status` shows it only when enabled; rerunning setup preserves it.
The hooks read the transcript's session-bound `session_meta.payload.source`,
and also detect a native exec ancestor for `exec resume` of an older CLI thread.
If the header is missing or cannot be verified, they skip capture and injection.
Interactive sessions with verified CLI headers continue normally. Threads on the
Codex app-server (the TUI since 0.160, the VS Code extension and the desktop app)
count as interactive only when their `originator` is one of those three clients;
other app-server clients are treated like exec and need the same opt-in. Older frozen
runtimes must first be updated with setup; config prints the exact command.

To stop prompt recall while keeping automatic capture, run
`npx @cairn-ink/memory prompt-recall-off --client codex`.
Use `prompt-recall-on --client codex` to enable it again. This does not change MCP.

Codex defaults to 200 automatic captures per day; reruns keep an existing cap.
Change it with `setup --codex-daily-cap N` or `config --codex-daily-cap N`.
Status shows today's count and cap. Unscoped `pause` and `resume` select installed
Codex, and pause both tools when paired. Uninstall preserves keys and memories.

```sh
npx @cairn-ink/memory status
npx @cairn-ink/memory prompt-recall-off --client codex
npx @cairn-ink/memory pause
npx @cairn-ink/memory config --codex-daily-cap 300
node packages/setup/bin/memory.mjs setup --dry-run
```

`status` reads local state without testing remote service or hooks. `--verbose`
shows technical diagnostics. Review and allow the four Cairn entries in Codex
`/hooks` after installation. `--client claude|codex` restricts the run.
`--no-browser` allows sign-in on another device. Legacy MCP removal requires
confirmation. Unqualified Codex alone may offer manual MCP tools.

[Setup options and credential handling](../packages/setup/README.md) ·
[chichi's release checklist](npx-setup-release.md)

**Manual fallback:** from your terminal, run:

```sh
claude plugin marketplace add Cairn-ink/cairn-memory
claude plugin install cairn-memory@cairn-memory
```

Or use the slash-command form inside Claude Code:

```text
/plugin marketplace add Cairn-ink/cairn-memory
/plugin install cairn-memory@cairn-memory
```

Create a personal access token at `https://cairn.ink/settings/tokens`, then run
`/plugin configure cairn-memory@cairn-memory` in Claude Code and enter it there.
Start a new session after installation.

`/cairn-memory:status` reads content-free credential observations written by the
hooks, because Claude Code's Bash tool does not inherit sensitive plugin options.
`configured (verified <time>)` reports the last accepted authenticated request;
`rejected` links to the configured endpoint's token page. `configured (not
verified yet)` or `configured (unreachable <time>; not verified)` does not claim
successful authentication; `server answered: busy/error` reports an HTTP refusal.
SessionStart clears the old verdict so token rotation requires new verification.
`not seen yet` asks you to restart Claude Code and
send one message; `missing` means a hook actually observed no configured token.
Status makes no network request and never reads the token from secure storage.

Agents: ask the user before installing. The hosted plugin captures allowlisted
conversation text by default, and the user creates and enters the token themselves.
See the [hosted plugin privacy contract](#hosted-plugin-privacy-contract).

For local development:

```bash
git clone https://github.com/Cairn-ink/cairn-memory.git
cd cairn-memory
claude --plugin-dir ./plugins/cairn-memory
```

### Hosted explicit MCP for Claude Code

For explicit memory tools without automatic capture, add the remote MCP server:

```sh
claude mcp add --transport http --scope user cairn https://cairn.ink/api/mcp
```

Then sign in from `/mcp` in Claude Code using browser OAuth.

## Connect from Codex (explicit MCP memory)

Codex connects through the hosted MCP tools. Keep the token in your shell or
secret manager, not in a repository or committed config file:

```bash
export CAIRN_MCP_TOKEN='your-token-from-cairn.ink'
codex mcp add cairn \
  --url https://cairn.ink/api/mcp \
  --bearer-token-env-var CAIRN_MCP_TOKEN
```

Restart Codex, then use `/mcp` or `codex mcp list` to confirm the connection.
The hosted tools support explicit remember, recall and forget operations.
For automatic Codex capture and prompt recall, including format qualification
and default controls, see the [installer guide](../packages/setup/README.md)
and [Codex setup guide](codex-setup.md).

## Hosted plugin loop

```text
User prompt
  └─ recall relevant personal + project-private memories
       └─ inject a short, explicitly untrusted context block

Assistant turn ends
  └─ hand capture to a detached worker without delaying Claude
       └─ read only new user/assistant transcript text
            └─ redact likely credentials locally
                 └─ send an idempotent capture batch
                      └─ store durable memories with Source Receipts
```

The bundled MCP connection also exposes explicit `remember_memory`, `recall_memory`, and `forget_memory` tools. Clients without lifecycle hooks can use those tools manually; passive capture is never claimed where the host does not expose a hook.

## Hosted plugin privacy contract

- Installation is explicit. Automatic capture begins only after installation and is on by default.
- Only textual user and assistant message blocks are allowlisted.
- Tool-result and tool-use blocks are excluded; the plugin does not read arbitrary project files. Ordinary user/assistant text can still contain pasted file contents, terminal output, paths, or repository names and is eligible for processing.
- Supported credential shapes are replaced with `[REDACTED]` locally in both capture text and automatic recall queries before transmission. Redaction is best-effort, not a guarantee that every secret is recognized. The hosted service redacts again as defense in depth.
- Automatic recall sends a redacted, bounded version of the current prompt to the configured service. This occurs before capture and is a separate processing path.
- Prompt recall sends the host conversation id when it matches the 1–200 character
  ASCII allowlist (`A–Z`, `a–z`, `0–9`, `.`, `_`, `:`, `-`). Trusted hooks supply
  it, never model text; the server stores only an owner-scoped SHA-256 hash.
  An older strict server gets one exact-schema retry without the optional field.
- Project scope is a keyed opaque identifier. Its derivation key never leaves the device and is separate from the anonymous telemetry id.
- Automatically inferred memories remain personal or project-private. They cannot publish into a team or community.
- Product telemetry is content-free, defaults on, and can be disabled. Its schema accepts only lifecycle event, client version, platform, and a random installation id.
- Hooks fail open: Cairn outages and timeouts do not block normal Claude Code work.
- Capture workers are detached so headless `claude -p` sessions cannot cancel them during teardown; the allowlisted handoff is piped directly to the worker and is not written to a queue file.

Use `/cairn-memory:pause`, `/cairn-memory:resume`, and `/cairn-memory:status` to control capture and recall.

Paused text is not automatically backfilled. After resume, each session's first
capture hook skips its current unprocessed history (including any early resumed
text); later complete messages are captured. Requests already started before
pause may finish. See the detailed pause boundaries in the privacy guide.

Read the full [privacy and threat model](privacy.md). Security reports belong in the private channel described in [SECURITY.md](../SECURITY.md), not a public issue.
