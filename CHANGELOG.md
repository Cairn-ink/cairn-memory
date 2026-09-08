# Changelog

All notable changes follow semantic versioning.

## Unreleased

- Constrain optional OpenAI classification/recall references to their immutable
  request snapshot and clarify cold-start topic creation for clear subjects.
  Preserve genuinely unfiled outcomes, existing core authority checks and all
  token/framing limits. A two-fact real-provider filing probe passed; general
  semantic quality still requires the separate frozen evaluation.

- Add an explicitly opt-in, budget-guarded synthetic live-provider lifecycle
  runner with sanitized reports and offline safety tests. Ordinary tests/CI
  never make paid requests. General semantic quality and standalone MCP remain
  separate acceptance gates.

- Add an optional pinned OpenAI adapter with a real local tokenizer, provider
  count preflight, bounded transport and strict output schemas. Offline fixtures
  only: live provider acceptance and quality evaluation remain pending. Preserve
  narrow trusted adapter budget/output errors through the shared model port.

- Extend recall to two bounded root-map rounds and two receipt pages per
  candidate, with explicit incomplete coverage and the same final authoritative
  snapshot. Cap three model calls and 36 unique fetched memories; large combined
  evidence retains explicit context errors. Add a core operation/test inventory.

- Add bounded model-free index rebuild with persisted continuation, validated
  generation authority and atomic publication. Ordinary mutations maintain the
  active projection transactionally. Schema v7 retains existing data; no topic
  discovery, automatic cleanup or production migration is included.

- Add optional revision-bound contradiction hints to explicit/inferred admission,
  symmetric attributed inspection and atomic invalidation on memory revision
  changes. Schema v6 preserves existing state; bounded links do not claim
  semantic conflict detection or change the capture model output contract.

- Add `core.capture` with bounded injected extraction, trusted source binding,
  digest-bound replay and post-admission classification. No provider, passive
  hook, local MCP server, hosted migration or schema change is included.

- Add package 1a admission leases and atomic inferred-memory commits over the
  shared runtime, with fenced takeover, digest-bound replay, suppression and
  abandonment. Completed outcomes retain IDs/counts, never cached memory content.
  Upgrade v1/v3/v4 databases atomically to v5. This does not yet add extraction,
  automatic capture, conflict hints, a model provider or a local MCP server.

- Add S2c revision-safe fetch with receipt continuation and bounded recall over
  explicitly authorized namespaces. A final authoritative read prevents deleted
  or changed candidates from escaping after model work. Injected selector/ranker
  adapters share bounded-call enforcement with classification. Synthetic tests
  and a runnable mock demo verify controls, not semantic quality. No local MCP
  server or hosted migration is included; schema remains v4.

- Add S2b persisted L2/L1 MOC organization, guarded multi-membership placement,
  bounded maps and read-only classification through an injected model port.
  Corrections/deletions invalidate memberships and source-derived titles in the
  shared runtime. Upgrade v1/v3 data atomically to v4. Synthetic SQLite/mock tests
  and a runnable demo verify controls, not real-model classification quality.
  Semantic recall, a local MCP server and hosted migration remain separate work.

- Add the model-free S2a core contract over the existing SQLite store: explicit
  receipt batches, metadata/source pagination, stable source IDs, persistent
  namespace epochs and signed cursors shared with legacy mutations. Upgrade v1
  storage atomically to v3; unmerged draft-v2 databases remain unsupported.
  This is not yet the MOC/classification/recall engine or a local MCP service.

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
