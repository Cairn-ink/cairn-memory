<h1 align="center">Cairn Memory</h1>

<p align="center"><strong>Lightweight cross-session memory for AI agents, with receipts.</strong></p>

<p align="center">
  <a href="https://github.com/Cairn-ink/cairn-memory/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Cairn-ink/cairn-memory/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue"></a>
  <a href="https://cairn.ink"><img alt="Hosted by Cairn.ink" src="https://img.shields.io/badge/hosted-cairn.ink-5b5147"></a>
</p>

Cairn Memory is an open-source memory layer for agents: keep memories in a local
SQLite file, retrieve them across sessions, and inspect the Source Receipts that
explain where they came from. Correct a memory at its current revision or forget
it without letting a later automatic capture silently restore it.

The local developer preview runs without a Cairn account. Its thin MCP server
uses the same public core as the JavaScript API: no separate memory engine per
client. MOC organization, bounded model-guided recall and capture orchestration
are in the core; the five MCP tools provide explicit memory operations, not
automatic transcript capture.

**Preview, not a quality guarantee.** An installed subprocess has passed a real
model-backed remember → restart → sourced recall → forget loop. The frozen
semantic evaluation still fails source support: an extractor sometimes turns
“uses a language” into “is implemented using it.” [All retained results](https://github.com/Cairn-ink/cairn-memory/pull/23)
remain visible. This is synthetic evidence, not a competitor benchmark or a
claim that real users save a measured amount of time.

An explicitly selected [experimental extraction profile](docs/plans/extraction-model-profile.md)
passed the frozen synthetic gate after independent agent review. The default
model's failure remains; MCP does not automatically enable the experimental
profile, which is a programmatic adapter option.

## Try the local memory layer

Prerequisites: Node >=22.16, npm and `tar`. Model-free remember/inspect/correct/
forget need no key; semantic recall needs your explicitly supplied OpenAI key
and sends the query and selected memory context to that provider. A real fully
local model path is not yet verified.

```sh
git clone https://github.com/Cairn-ink/cairn-memory.git
cd cairn-memory
git switch --detach a23b84d81851a9a864f6f48501a28a5da3cb2f5e
npm run build:artifact
```

The builder prints a temporary archive path and SHA-256. Follow the
[isolated installation instructions](packaging/README.md) for that archive,
then configure a stdio client to run the installed executable with an explicit
database path and owner. Keep the database outside `node_modules`.
The archive is **not published to npm**; there is no registry `npx` shortcut yet.
The command pins the inspected core plus runnable walkthrough candidate
because the older released tag does not contain this preview; it is not a claim
that this candidate has merged or been released.

No chat-client setup is needed for a first synthetic check. From this source
checkout, install the isolated SDK client and point the walkthrough at your
installed executable (replace the absolute placeholder path):

```sh
npm ci --prefix adapters/mcp
node adapters/mcp/walkthrough.mjs --executable /absolute/install/node_modules/.bin/cairn-memory
```

This default path makes **no model calls**, even if the parent shell has a key.
It checks persistence, receipts, revision safety and forgetting; recall must
report `model_not_configured`. To exercise paid semantic recall, explicitly
supply `OPENAI_API_KEY` through your secret environment and add `--with-recall`.
The walkthrough does not impose a provider account spending limit.

| Tool | Purpose |
| --- | --- |
| `remember_memory` | Explicitly save one memory and its receipt |
| `recall_memory` | Model-guided retrieval of current memories and receipts |
| `inspect_memory` | List memories or inspect an ID and current revision |
| `correct_memory` | Replace content at the revision you inspected |
| `forget_memory` | Logically delete at the revision you inspected |

Try the [cross-session walkthrough](docs/local-memory-demo.md). See the
[tested client matrix](docs/install-artifact.md#verification-and-compatibility)
before assuming a named client works: SDK stdio and Hermes MCP discovery have
evidence. The separate [Hermes native-provider candidate](https://github.com/Cairn-ink/cairn-memory/pull/25)
also passed actual MemoryManager two-session sourced recall on Linux CLI;
interactive chat tool selection and remote HTTP connectors remain separate gates.

## Local privacy and control

- Memory, receipts and organization persist in your selected SQLite database.
  No Cairn account, hosted service or hidden core telemetry is required.
- MCP does not read transcripts or save whole conversations automatically.
  Receipt text records a tool assertion; it is not proof of authenticated human intent.
- Model processing is cloud processing when configured. Redaction is best-effort,
  not a guarantee that all secrets are removed. Retrieved text is untrusted data,
  never instructions to follow.
- Forgetting prevents active recall and automatic re-admission. It is not secure
  disk erasure: SQLite pages, receipts and backups have separate retention limits.
  Stop all writers before copying the database and sidecars for backup.
- Uninstalling the executable preserves the external database. See
  [backup, upgrade and deletion boundaries](packaging/README.md),
  [architecture](docs/architecture.md), [dependency notices](packaging/THIRD_PARTY_NOTICES.md)
  and [security reporting](SECURITY.md).

## Existing hosted integration

The released v0.1 Claude Code plugin below is a **different installation mode**:
it connects to a compatible hosted service, automatically captures allowlisted
conversation text, and has its own telemetry defaults. It has not been migrated
to the local engine. Existing hosted users can keep using these instructions.

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
- a local SQLite core with receipts, namespace isolation, capture orchestration,
  MOC organization, model-guided recall, correction and deletion suppression;
- an optional OpenAI adapter, thin local MCP host and inspected install artifact;
- conformance tests and self-host implementation guidance.

The Cairn.ink hosted extraction service, user database, auth, billing, abuse controls, and production operations live in a separate private repository. See [Architecture](docs/architecture.md) for the boundary and [Self-hosting](docs/self-hosting.md) for what is—and is not—available in v0.1.

## Status

The released hosted plugin and local developer preview have different readiness
levels. The local install lifecycle is verified, but source-support quality still
fails; broad promotion is not yet cleared. No first-ten-user result or star
target is presented as achieved. See [ROADMAP.md](ROADMAP.md) and the
[proposed adoption experiment](docs/plans/local-memory-plg.md).

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

Contributions are welcome after reading [CONTRIBUTING.md](CONTRIBUTING.md) and the privacy invariants in [docs/protocol.md](docs/protocol.md).
