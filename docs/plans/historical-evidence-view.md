# Explicit historical evidence view

Fixed parent: qualified-reconciliation `cb5d31d32a62532d36663613cbb3451956259d6d`.
Part of the memory reliability contract; no paid calls or self-merge/release/deploy.

## Acceptance

- H1: add optional `states` to local core `list`: a nonempty unique dense subset
  of public states `active`, `historical`. Absent or both states preserves prior
  all-state behavior and cursor bindings; normalize subset ordering. Reject
  invalid input before reads. Filter in the existing namespace-bounded SQL query
  before page limits, not after pagination. Bind nondefault filters into cursors.
- H2: add optional `view` to local core `fetch`: `current` (default) or
  `historical`. Historical means retained superseded records, NOT assertions valid
  at a date. Historical fetch returns existing state/revision, paged receipts and
  existing supersession inspection metadata. Default current fetch retains exact
  prior output and cursor semantics; cross-view cursor reuse rejects. Reuse the
  same store and bounded fetch implementation, no model generation or migration.
- H3: exact namespace, undeleted state and revision guards apply to both views.
  Retired fingerprint suppression does not hide permitted history; explicit
  forgetting does. Foreign, deleted or wrong-view refs expose no body/receipts.
  Include supersession metadata in token accounting; retain epoch checks after
  tokenizer callbacks. Deleted or corrected successor evidence must never be
  substituted as an old rationale. Reuse existing safe supersession inspection.
- H4: current map, recall, legacy reads and defaults stay current-only where
  already so. List/get inspection defaults stay all-state. No `asOf`, validity
  intervals, historical semantic search, automatic rationale generation, MCP
  widening or complete revision-history promise. Receipt ingestion timestamps
  and memory mutation timestamps are not real-world event times.
- H5: actual SQLite tests exercise active/historical filtering and pagination,
  defaults, A-to-B-to-C links, receipt token/pagination limits, wrong namespace/
  view/cursor/revision, corruption-safe links, forgotten predecessor/successor,
  corrected successor, cold reopen and deletion during tokenizer callbacks.
  Demonstrate explicit list-to-fetch history with no generative model port.
- H6: run core + relevant fetch/recall/store demos, generic/JSON gates on Node
  22.16 and24, adapter/MCP and artifact regressions for shared runtime packaging,
  pinned plugin validation; final committed Standards/Spec review before push.

This adds an explicit evidence access path. Rationale can only be reported from
source text that actually states it; supersession edges alone are not motives.
User-facing query interpretation and historical MCP access follow their own
reviewed slices, rather than changing automatic current recall here.
