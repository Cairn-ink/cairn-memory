# Architecture and repository boundary

See the [delivery roadmap](plans/delivery-roadmap.md) for remaining work,
delegation, acceptance gates and the public-core/hosted migration sequence.

Cairn Memory is moving toward a shared open-source memory core. The public
repository now includes local storage and injected capture/recall orchestration
(`core/`). The deployed service remains unchanged until a separately staged migration.

```text
Claude Code
  ├─ UserPromptSubmit hook ── POST /api/memory/recall ─────┐
  ├─ Stop / PreCompact ───── direct stdin pipe             │
  │                           └─ detached worker            ├─ compatible service
  │                                └─ POST /api/memory/capture
  └─ MCP tools ───────────── /api/mcp ─────────────────────┘

This public repository                    Cairn.ink private application
  plugin + marketplace                      authentication
  transcript allowlist                      extraction and ranking
  local redaction                           persistence and quotas
  project identity                          billing and operations
  protocol schemas                          hosted UI
  conformance tests
  local SQLite store (not yet connected to the plugin or hosted service)
```

## Source-of-truth rule

This repository owns plugin behavior, marketplace packaging, public wire schemas, and compatibility documentation. The private Cairn.ink application owns its implementation of those contracts and runs its own conformance tests; it does not maintain a second plugin copy.

`core/` is the reusable public memory implementation used by the local host
adapters. It contains no account system, model client, HTTP/MCP
server, or telemetry. Its exact-namespace JavaScript API is documented in
[Local store](local-store.md); it is not the hosted wire contract. Public source
is authored independently of private application code and reuses the already
public redactor. The hosted implementation is unchanged in this milestone;
the optional model and local MCP adapters now use this same core. A
behavior-tested hosted migration remains a separate step, not a permanent second
engine per host.

The [S2a contract facade](storage-contract.md) shares this store's transactions
and mutation helpers; it adds model-free lifecycle/inspection contracts, not a
second database engine. [S2b](moc-placement.md) adds persisted MOC organization,
bounded maps and an injected classification port over that same runtime. No model
provider or MCP adapter is bundled. No private source, prompt or fixture contents
are copied into these slices.

[S2c](fetch-recall.md) adds bounded fetch/recall to that same runtime. Recall
uses injected selection/ranking adapters and an authoritative final read;
no model provider or network host is bundled. The released plugin is unchanged.

[Admission claims](admission-claims.md) add guarded inferred commits and replay
coordination to the same transaction runtime. Extraction orchestration remains
separate from storage transactions. [Capture](capture.md) now composes these
methods with an injected extractor and trusted receipt construction. No private
source or hosted path is migrated by these methods.

[Conflict hints](conflicts.md) add revision-bound, attributed assertions to that
same admission transaction. Every memory revision mutation invalidates incident
links, including the legacy facade and filing transitions. No second engine or
semantic contradiction detector is introduced.

[Index rebuild](index-rebuild.md) stages bounded validated organization
projections and atomically switches their authority. Normal mutations maintain
the active projection in the shared transaction; readers still validate current
memory identity and revisions. Rebuilding is not a second classification engine.

[Recall continuation](recall-continuation.md) adds bounded next-page traversal
and receipt prefixes without changing the final authoritative snapshot. The
[operation inventory](plans/core-contract-inventory.md) distinguishes tested
source contracts from provider, standalone MCP and commercial migration gates.

The [optional OpenAI adapter](openai-provider.md) lives outside core with isolated
dependencies. It supplies the existing model ports, local tokenization and
provider framing checks, not a second engine. Alongside offline HTTP fixtures,
an opt-in [synthetic live lifecycle](plans/live-provider.md) has passed. The
isolated [local MCP host](standalone-mcp.md) and [install artifact](install-artifact.md)
also use this same core. Installed stdio acceptance includes an actual-provider
recall after a fresh process restart, with source verification and forgetting.
General semantic quality remains a separate gate: the frozen full suite still
fails source support. These protocol/lifecycle results do not establish release
readiness or universal client compatibility.

A public protocol change lands here first with a schema and test. Hosted support can ship before or with the corresponding public release, never after a client begins depending on it.

## Trust boundaries

The plugin is the only component allowed to read a Claude Code transcript. It parses an incremental byte range and emits only allowlisted user/assistant text. It redacts locally before constructing the network payload.

Stop and PreCompact synchronously pipe session id, transcript path, working
directory, and a content-free control generation to a detached worker, close
the pipe, then return. Assistant text present elsewhere in the hook event is
discarded. The handoff is never written to a queue file or added to the worker
environment. This keeps response latency low and lets capture finish when a
headless `claude -p` process tears down. Before starting each request, the worker
checks the pause generation under the control lock; waiting workers cannot
cross a pause/resume boundary and upload the previous generation's history.

The service authenticates the user, applies defense-in-depth validation and redaction, extracts durable memories, and enforces ownership on every recall or deletion. An inferred Memory and its Source Receipt commit atomically.

Private Memories and governed shared knowledge are different aggregates. Automatic capture has no team/community scope. Sharing is a future explicit human action, not a hidden side effect of recall or capture.

## Distribution boundaries

The hosted Claude Code plugin still uses Node.js built-ins and native plugin
distribution; it has no additional npm distribution channel. Its behavior and
release channel are unchanged.

The local core/MCP preview has a separately generated, npm-installable archive.
Its explicit file allowlist copies the checked-in runtime into temporary staging;
that generated artifact is not a second maintained engine. The preview manifest
and root contributor package remain private, and nothing is published to npm.
Installation retrieves pinned dependencies; no public `npx` command, remote
connector or named-client chat integration is implied. The third-party
[Hermes native provider preview](hermes-memory-provider.md) now has actual
MemoryManager lifecycle and model-backed sourced-recall evidence. Interactive
agent tool selection, other host versions and general semantic quality remain
separate gates; no upstream listing or endorsement is implied.
