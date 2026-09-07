# Architecture and repository boundary

See the [delivery roadmap](plans/delivery-roadmap.md) for remaining work,
delegation, acceptance gates and the public-core/hosted migration sequence.

Cairn Memory is moving toward a shared open-source memory core. The public
repository now includes the local storage foundation (`core/`); extraction and
the deployed service remain private until separately staged migrations.

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

`core/` is the target reusable persistence implementation for the upcoming OSS
engine and host adapters. It contains no account system, model client, HTTP/MCP
server, or telemetry. Its exact-namespace JavaScript API is documented in
[Local store](local-store.md); it is not the hosted wire contract. Public source
is authored independently of private application code and reuses the already
public redactor. The hosted implementation is unchanged in this milestone;
extraction/model integration and a behavior-tested hosted migration are separate
steps, not a permanent second engine per host.

The [S2a contract facade](storage-contract.md) shares this store's transactions
and mutation helpers; it adds model-free lifecycle/inspection contracts, not a
second database engine. [S2b](moc-placement.md) adds persisted MOC organization,
bounded maps and an injected classification port over that same runtime. No model
provider or MCP adapter is bundled. No private source, prompt or fixture contents
are copied into these slices.

[S2c](fetch-recall.md) adds bounded fetch/recall to that same runtime. Recall
uses injected selection/ranking adapters and an authoritative final read;
no model provider or network host is bundled. The released plugin is unchanged.

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

## Why there is no npm install

The plugin uses Node.js built-ins and Claude Code native plugin distribution. An npm wrapper would add a second update channel without reducing setup. The repository has a `package.json` only to provide familiar contributor test commands; it is marked private and is not a published package.
