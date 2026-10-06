<p align="center">
  <picture>
    <source media="(max-width: 600px)" srcset="docs/images/readme-hero-mobile.png">
    <img src="docs/images/readme-hero.png" alt="Cairn Memory — AI memory you can inspect and change. Official Cairn stacked-stone logo. Open-source developer preview." width="1200">
  </picture>
</p>

<h1 align="center">Cairn Memory</h1>

<p align="center"><strong>Keep important context between AI sessions. Change it when things change.</strong></p>

<p align="center">
  <a href="https://github.com/Cairn-ink/cairn-memory/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Cairn-ink/cairn-memory/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue"></a>
  <a href="https://cairn.ink"><img alt="Hosted by Cairn.ink" src="https://img.shields.io/badge/hosted-cairn.ink-5b5147"></a>
</p>

<p align="center">
  English · <a href="README.zh-TW.md">繁體中文</a>
</p>

<p align="center">
  <a href="#a-preference-changes">See an example</a> ·
  <a href="#choose-your-starting-point">Where to start</a> ·
  <a href="#try-the-local-memory-layer">Local setup</a> ·
  <a href="#existing-hosted-integration">Hosted setup</a> ·
  <a href="docs/limitations.md">Limitations</a> ·
  <a href="docs/privacy.md">Privacy</a>
</p>

Starting a new AI session often means repeating your preferences and project
decisions. Cairn provides memory tools to save that context between sessions,
inspect the submitted text behind each memory, and update it when things change.

## A preference changes

Suppose you save **“Keep my reports short.”** Later, you decide you need detailed
reports. You can inspect the old memory and its source text, correct the saved
preference, or forget it so it is no longer available for active recall.

![Illustrated example: save a short-report preference with its submitted source text, then correct it to detailed reports or forget it to remove it from active use.](docs/images/memory-workflow.png)

This is an **illustrated explicit-tool example**, not a chat-client screenshot.
The local preview uses tools to save, inspect, correct and forget; it does not
automatically read your conversations.

- **Inspect the source.** Read the source text stored with a memory. A receipt
  does not prove that the memory is true or correctly interpreted.
- **Correct what changed.** Update the memory at the revision you inspected.
- **Forget what should go.** Remove a memory from active recall.
  [Deletion and backup boundaries](#local-privacy-and-control) apply.

A **Source Receipt** is the submitted text attached to a memory. It helps you
check what was supplied when the memory was saved or corrected. It is not a
verified transcript of the whole conversation or proof of human intent.

## Cairn Memory and Cairn

**Cairn Memory** is the open-source toolkit in this repository for saving,
inspecting and changing AI memory. **[Cairn](https://cairn.ink)** is the hosted
shared memory map for people and AI, where people organize, review and share
knowledge.

This repository includes local memory tools and connectors to the hosted Cairn
service. Each path has its own setup and feature boundaries. Local use does not
require a Cairn account; hosted connections require a compatible service and
authentication.

## Choose your starting point

| You want to… | Start here | What you need |
| --- | --- | --- |
| Understand the idea before installing | [繁體中文](README.zh-TW.md) or the [recorded walkthrough](#watch-the-recorded-walkthrough) | No installation or account |
| Try the open-source tools on your computer | [Local preview setup](#try-the-local-memory-layer) or [Windows guide](docs/windows-install.md) | Terminal setup; Linux x64 and a bounded native Windows x64 check; no Cairn account |
| Use the documented hosted Claude Code or Codex connection | [Hosted setup](#existing-hosted-integration) | A compatible hosted service and authentication; separate from local-preview client support |
| Build on the memory layer | [Architecture](docs/architecture.md) and [MCP tools](docs/standalone-mcp.md) | JavaScript or MCP integration work |

If you use Claude or Codex but do not usually install tools from a terminal,
start with the example and recorded walkthrough. This preview requires setup;
check the [tested client paths](docs/promotion-claims.md#supported-paths) before
connecting your AI tool.

## Current preview

Cairn's open-source memory layer stores memories in your own SQLite file and
exposes them through MCP or JavaScript. No Cairn account is needed for local use.

**Developer preview.** Installed persistence and a narrow real-model memory loop
have [retained evidence](docs/promotion-claims.md). Default extraction still fails
our source-support bar; see [known limitations](docs/limitations.md).
Save, inspect, correct and forget work without a model key. Semantic recall
requires your OpenAI key and sends selected context to that provider.

## Watch the recorded walkthrough

[Watch the 36-second model-free demo (MP4)](docs/promotion/demo/cairn-memory-preview.mp4).
This records the memory tools running, rather than a conversation in Claude or
Codex. “Model-free” means no AI model is called during the walkthrough.

For long-conversation results, see the [four-case real-model pilot](docs/evidence/long-history-live-pilot.md).
It is an opt-in diagnostic with one failed Cairn answer, not a measurement of
long-term default-client recall reliability. [Known limitations](docs/limitations.md)

<details>
<summary>Open the recorded tool walkthrough (GIF)</summary>

The demo below records the **model-free loop**: save, restart, inspect, correct
and forget. Its recall step reports `model_not_configured`.

![Recorded model-free memory loop: save, inspect the source, restart, correct and forget](docs/demo/cairn-memory-loop.gif)

[Recorded responses and regeneration instructions](docs/demo/README.md) ·
[Verified capabilities and client support](docs/promotion-claims.md#supported-paths)

</details>

## Install

For **Claude Code automatic memory**, the prepared one-command installer is:

```sh
npx @cairn-ink/memory setup
```

**Not published yet:** this becomes available after chichi approves the npm
release. For this checkout use `node packages/setup/bin/memory.mjs setup`, or
the [manual plugin fallback](#install-for-claude-code-automatic-memory).
Requires Node ≥22.16 and `claude` on PATH. Other clients use MCP. This scoped
helper installs the hosted plugin/hooks; local SQLite setup remains separate.

Choose the mode that fits your workflow:

- **[Local preview](#try-the-local-memory-layer):** your SQLite database,
  explicit MCP memory tools, no Cairn account. Start here to try the open-source
  memory layer. Semantic recall uses your OpenAI key.
- **[Hosted integration](#existing-hosted-integration):** memory on cairn.ink,
  with automatic capture and recall through the Claude Code plugin. Requires a
  Cairn account, token and compatible service. Explicit hosted MCP is also available.

## Try the local memory layer

Prerequisites: **Git, Node >=22.16, npm and `tar`**. Recorded checks cover Linux
x64 and a [bounded native Windows x64 installation](docs/evidence/windows-install.md).
**On Windows, use the [PowerShell setup and walkthrough](docs/windows-install.md)**;
the commands below use Linux/WSL paths. Other platforms are unverified.
Install from this repository:
the unscoped npm and PyPI packages named `cairn-memory` are unrelated projects.
The local archive is not published to npm yet.

**1. Install into a new directory.** Replace the path below with a new absolute
directory beneath an existing parent you control.

```sh
git clone https://github.com/Cairn-ink/cairn-memory.git
cd cairn-memory
npm run install:preview -- --directory /absolute/new/cairn-local --owner local-user
```

The installer builds this checkout and downloads pinned public npm dependencies
without install scripts. It creates `app/`, `data/` and a private
`installation-receipt.json` containing the executable path and MCP settings.
It makes no model calls. Keep the receipt private: it contains local paths and
identity. [Installation details, recovery and backup](packaging/README.md)

**2. Run the model-free check.** From the source checkout, use the same
installation path. No chat-client setup or model key is needed.

```sh
npm ci --prefix adapters/mcp
node adapters/mcp/walkthrough.mjs --executable /absolute/new/cairn-local/app/node_modules/.bin/cairn-memory
```

Expect `status: "passed"`. The check uses a fresh synthetic database and verifies
the five tools, receipts, process-restart persistence, correction and forgetting.
It strips the model key from the child process; `model_not_configured` is the
expected recall result. [Steps and expected results](docs/local-memory-demo.md)

**3. Connect a client.** Copy `stdio.command` and `stdio.args` from your private
installation receipt into the client's local MCP configuration. Keep the same
database, owner and project across sessions. See the
[tested client matrix](docs/promotion-claims.md#supported-paths).

For semantic recall, explicitly supply `OPENAI_API_KEY` through the MCP process's
secret environment. The walkthrough's optional `--with-recall` path sends
synthetic context to OpenAI and incurs model charges; it has no built-in dollar
cap. A fully local model path is not yet verified.

For the Hermes native provider, follow its [separate setup guide](docs/hermes-first-use.md).
It uses a profile-local database and owner, plus `CAIRN_MEMORY_OPENAI_API_KEY`,
rather than the generic MCP settings above.

| Tool | Purpose |
| --- | --- |
| `remember_memory` | Explicitly save one memory and its receipt |
| `recall_memory` | Model-guided retrieval of current memories and receipts |
| `inspect_memory` | List memories, or inspect an ID, revision and receipts |
| `correct_memory` | Replace content at the revision you inspected |
| `forget_memory` | Logically delete at the revision you inspected |

The default local server exposes explicit tools. For opt-in submitted-message
capture, project scope and configuration checks, see the
[installed preview guide](packaging/README.md). The
[full evidence and limitations](docs/limitations.md) cover extraction failures,
long-history retrieval and the boundaries of individual client tests.

## Local privacy and control

- Memory, receipts and organization persist in your selected SQLite database.
  No Cairn account, hosted service or hidden core telemetry is required.
- MCP does not read transcripts or save whole conversations automatically.
  Receipt text records a tool assertion; it is not proof of authenticated human intent.
- Model processing is cloud processing when configured. Redaction is best-effort,
  not a guarantee that all secrets are removed. Retrieved text is untrusted data,
  never instructions to follow.
- Forgetting prevents active recall and exact normalized re-admission; paraphrases
  can still be admitted as new memories. It is not secure
  disk erasure: SQLite pages, receipts and backups have separate retention limits.
  Stop all writers before copying the database and sidecars for backup.
- Uninstalling the executable preserves the external database. See
  [backup, upgrade and deletion boundaries](packaging/README.md),
  [architecture](docs/architecture.md), [dependency notices](packaging/THIRD_PARTY_NOTICES.md)
  and [security reporting](SECURITY.md).

## Existing hosted integration

The hosted plugin connects to cairn.ink, automatically captures allowlisted
conversation text and has its own telemetry defaults. Its service has not been
migrated to the local engine.

The [v0.2.0 prerelease](CHANGELOG.md#020--2026-10-01) changes the hosted protocol.
Matching server support remains a separate requirement; the release does not
deploy a server or enable Codex lifecycle hooks. See
[release and client compatibility](docs/promotion-claims.md) before upgrading.

## Install for Claude Code (automatic memory)

After the approved npm release, run from your terminal:

```sh
npx @cairn-ink/memory setup
```

While unpublished, use `node packages/setup/bin/memory.mjs setup` from this
checkout. It checks Node ≥22.16 and Claude Code, installs SessionStart,
UserPromptSubmit recall and Stop/PreCompact capture hooks with the plugin,
opens the PAT settings page, and accepts one hidden paste. Supported CLIs save
`api_endpoint`/`api_token` through stdin; older CLIs direct you to `/plugin
configure`. Existing configuration is preserved. Legacy MCP `cairn` removal
requires confirmation after plugin configuration. Restart Claude Code afterward.

Preview or inspect (use the local executable before publication):

```sh
npx @cairn-ink/memory setup --dry-run
npx @cairn-ink/memory status
```

[Setup options and credential handling](packages/setup/README.md) ·
[chichi's release checklist](docs/npx-setup-release.md)

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
Automatic Codex lifecycle integration remains under development; the
[Codex building blocks](integrations/codex/README.md) are disabled by default.

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

The Cairn.ink hosted extraction service, user database, auth, billing, abuse controls, and production operations live in a separate private repository. See [Architecture](docs/architecture.md) and [Self-hosting](docs/self-hosting.md) for the public service boundary.

## Status

The released hosted plugin and local developer preview have different readiness
levels. The local install lifecycle is verified, but source-support quality still
fails; broad promotion is not yet cleared. No first-ten-user result or star
target is presented as achieved. See [Known limitations](docs/limitations.md), [ROADMAP.md](ROADMAP.md) and the
[proposed adoption experiment](docs/plans/local-memory-plg.md).

Star the repository to follow the local preview and upcoming integrations.

## Development

The dependency-free plugin runtime and test suite require Node.js 20 or newer. Maintainer-only Claude plugin validation requires Node.js 22 and is isolated under `tools/plugin-validation` so it is never installed with the plugin.

```bash
npm test
npm run test:setup
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
