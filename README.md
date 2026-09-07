<h1 align="center">Cairn Memory</h1>

<p align="center"><strong>Lightweight cross-session memory for AI agents, with receipts.</strong></p>

<p align="center">
  <a href="https://github.com/Cairn-ink/cairn-memory/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Cairn-ink/cairn-memory/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue"></a>
  <a href="https://cairn.ink"><img alt="Hosted by Cairn.ink" src="https://img.shields.io/badge/hosted-cairn.ink-5b5147"></a>
</p>

Cairn Memory gives AI coding agents private, inspectable memory across sessions. Claude Code gets automatic recall before a prompt and automatic capture after a turn. Codex and other MCP clients can use the same hosted memory explicitly through `remember_memory`, `recall_memory`, and `forget_memory`. Every stored memory carries its origin, confidence, scope, timestamps, and a redacted Source Receipt showing why it exists.

It is deliberately small: one Claude Code plugin, one remote MCP connection, no plugin runtime dependencies, and no generic notes UI.

**Developer preview:** the [local memory engine and stdio MCP](docs/local-engine.md)
now support model extraction, sourced recall, correction and forgetting over
SQLite, without a Cairn account. Node >=22.16 and an explicitly configured model
are required for inference. Deterministic mocks are included for contributors.
The plugin installation below still uses the existing hosted HTTP service;
it is not automatically redirected to this local engine.

## Install for Claude Code (automatic memory)

In Claude Code, run:

```text
/plugin marketplace add Cairn-ink/cairn-memory
/plugin install cairn-memory@cairn-memory
```

Create a personal access token at `https://cairn.ink/settings/tokens`, then provide it when Claude Code asks for plugin configuration. Start a new session after installation.

For local development:

```bash
git clone https://github.com/Cairn-ink/cairn-memory.git
cd cairn-memory
claude --plugin-dir ./plugins/cairn-memory
```

## Connect from Codex (explicit MCP memory)

Codex v0.1 support uses the hosted MCP tools. Keep the token in your shell or
secret manager, not in a repository or committed config file:

```bash
export CAIRN_MCP_TOKEN='your-token-from-cairn.ink'
codex mcp add cairn \
  --url https://cairn.ink/api/mcp \
  --bearer-token-env-var CAIRN_MCP_TOKEN
```

Restart Codex, then use `/mcp` or `codex mcp list` to confirm the connection.
Codex can now explicitly remember, recall, and forget private memory. The v0.1
release does not install automatic Codex lifecycle hooks; that compatibility
layer is next on the roadmap.

## The loop

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

## Privacy contract

- Installation is explicit. Automatic capture begins only after installation and is on by default.
- Only textual user and assistant message blocks are allowlisted.
- Tool-result and tool-use blocks are excluded; the plugin does not read arbitrary project files. Ordinary user/assistant text can still contain pasted file contents, terminal output, paths, or repository names and is eligible for processing.
- Supported credential shapes are replaced with `[REDACTED]` locally in both capture text and automatic recall queries before transmission. Redaction is best-effort, not a guarantee that every secret is recognized. The hosted service redacts again as defense in depth.
- Automatic recall sends a redacted, bounded version of the current prompt to the configured service. This occurs before capture and is a separate processing path.
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

Read the full [privacy and threat model](docs/privacy.md). Security reports belong in the private channel described in [SECURITY.md](SECURITY.md), not a public issue.

## What is open

This repository is the source of truth for:

- the Claude Code plugin and marketplace manifest;
- local transcript filtering, redaction, and project identity derivation;
- the public HTTP/MCP wire contract and JSON Schemas;
- a local SQLite persistence core with receipts, exact namespace isolation,
  deduplication, correction, deletion suppression, and lexical lookup;
- a shared extraction/recall engine, Ollama model adapter, deterministic mocks,
  and an optional local stdio MCP runtime;
- conformance tests and self-host implementation guidance.

The deployed Cairn.ink service still uses its previous private implementation.
Future hosted migration will consume the public engine; user data, auth, billing,
abuse controls and production operations remain private. See [Architecture](docs/architecture.md)
and [Self-hosting](docs/self-hosting.md) for the current boundary.

## Status

`v0.1.0` is a public alpha, not yet a promise of protocol stability. The hosted
two-session sourced-recall gate has passed. We are now recruiting the first 10
developers and measuring activation, useful second-session recalls, false
memories, and redaction misses in public. See [ROADMAP.md](ROADMAP.md).

## Development

The dependency-free plugin runtime and test suite require Node.js 20 or newer. Maintainer-only Claude plugin validation requires Node.js 22 and is isolated under `tools/plugin-validation` so it is never installed with the plugin.

```bash
npm test
npm run validate
npm ci --prefix tools/plugin-validation
npm run validate --prefix tools/plugin-validation
```

For the local store on Node >=22.16 (no dependency installation required):

```bash
npm run test:core
npm run demo:store
```

For local MCP integration tests (fake model HTTP, real MCP protocol and SQLite):

```bash
npm ci --prefix runtime --ignore-scripts
npm run test:mcp
```

Real-model results, setup and limitations are in [Local engine](docs/local-engine.md).

Contributions are welcome after reading [CONTRIBUTING.md](CONTRIBUTING.md) and the privacy invariants in [docs/protocol.md](docs/protocol.md).
