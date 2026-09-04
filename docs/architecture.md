# Architecture and repository boundary

Cairn Memory is one product split across a public client contract and a hosted implementation.

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
```

## Source-of-truth rule

This repository owns plugin behavior, marketplace packaging, public wire schemas, and compatibility documentation. The private Cairn.ink application owns its implementation of those contracts and runs its own conformance tests; it does not maintain a second plugin copy.

A public protocol change lands here first with a schema and test. Hosted support can ship before or with the corresponding public release, never after a client begins depending on it.

## Trust boundaries

The plugin is the only component allowed to read a Claude Code transcript. It parses an incremental byte range and emits only allowlisted user/assistant text. It redacts locally before constructing the network payload.

Stop and PreCompact synchronously pipe only an allowlist of session id, transcript path, and working directory to a detached worker, close the pipe, then return. Assistant text present elsewhere in the hook event is discarded. The handoff is never written to a queue file or added to the worker environment. This keeps response latency low and lets capture finish when a headless `claude -p` process tears down.

The service authenticates the user, applies defense-in-depth validation and redaction, extracts durable memories, and enforces ownership on every recall or deletion. An inferred Memory and its Source Receipt commit atomically.

Private Memories and governed shared knowledge are different aggregates. Automatic capture has no team/community scope. Sharing is a future explicit human action, not a hidden side effect of recall or capture.

## Why there is no npm install

The plugin uses Node.js built-ins and Claude Code native plugin distribution. An npm wrapper would add a second update channel without reducing setup. The repository has a `package.json` only to provide familiar contributor test commands; it is marked private and is not a published package.
