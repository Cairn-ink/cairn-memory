# MOC-only classification catalog

Parent: PR63, 5dbf73c78d8c4b4196dd016db39a766b25a7da39. The owner authorized
MOC architecture improvements and offline/paid verification within a separate
USD50 phase grant; this change needs no paid calls or production access.

## Acceptance

- C1: classifyPlacement uses a bounded current namespace MOC catalog, rather than
  spending its catalog budget on unrelated memory references/unfiled bodies.
  One or 101 unfiled memories with zero topics can both propose a first category.
  Many references to a small existing catalog do not prevent reuse/new proposals.
- C2: preserve visible-ID/level checks, full-batch atomic validation, revision and
  index freshness checks, and the ban on new topics when the TOPIC catalog itself
  is incomplete. Do not equate truncated catalog with absence or relax limits.
- C3: public map defaults/DTOs/cursors, recall ordering, schemas, model ports,
  databases/migrations and transport authority remain unchanged. Catalog-specific
  cursors, if any, cannot be consumed as ordinary map cursors. No second engine.
- C4: model catalog must expose no memory bodies/receipts beyond the explicitly
  selected classification batch; namespace/private boundaries and stale-title
  behavior remain enforced. Model proposal generation remains read-only.
- C5: actual SQLite regressions for empty/small/large catalogs, unfiled/reference
  pressure, malformed/foreign proposals, stale writes and token bounds. Existing
  core/classification/cursor tests and demo:moc pass. Any tests intentionally
  asserting old behavior are updated with an explicit compatibility explanation.
- C6: run generic/JSON/plugin, core/demo:store/demo:moc, OpenAI offline and MCP
  relevant gates on Node22.16/24. No semantic-quality or performance claim from
  mocks. Independent Standards/Spec review before PR; no merge/release/deploy.

The change removes an input-selection bottleneck, not the need to evaluate
classification quality, broad topic catalogs, topic maintenance or recall routing.
