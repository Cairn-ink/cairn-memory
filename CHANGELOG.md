# Changelog

All notable changes follow semantic versioning.

## Unreleased

- Add a source-runnable local SQLite storage preview with atomic memory/receipt
  writes, exact owner/project isolation, deduplication, revision-checked correction,
  deletion suppression, lexical lookup, and real-file/concurrent-process tests.
  Core requires Node >=22.16; existing plugin Node 20 support remains unchanged.
  Model extraction and a local MCP/HTTP service are not part of this milestone.

- Apply local credential redaction to automatic recall queries before bounding
  their length to the protocol limit; skip empty queries.
- Atomically initialize persistent project and telemetry identities so concurrent
  first use cannot overwrite a key or create unstable project scopes.
- Add a persistent pause generation and conservative resume cursor boundary to
  prevent paused history from being backfilled by subsequent automatic capture.
- Replace age-only capture lock expiry with process ownership and guarded cleanup.
- Clarify that ordinary conversation text may contain pasted files or paths and
  explain the separate automatic recall processing path.

## 0.1.0 — 2026-09-05

- Initial Claude Code auto-capture and auto-recall plugin.
- Detached in-memory capture handoff that survives interactive and headless Claude Code teardown.
- Explicit MCP remember, recall, and forget connection.
- Local transcript allowlisting, credential redaction, and opaque project scope.
- Public compatibility schemas and privacy contract.
- Documented Codex connection through the hosted MCP memory tools.
