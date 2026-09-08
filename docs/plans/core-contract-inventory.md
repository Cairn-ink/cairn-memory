# Public core operation and evidence inventory

This inventory accompanies package 1e. It describes source-level implementation
and synthetic acceptance, not a release or proof of real-model quality. Exact
candidate SHA, gate results and independent reviews belong to the delivery PR.
The owner decides merge/release; a listed source operation is not a deployed API.

All envelope methods come from `openMemoryCore` in `core/contract.mjs` and use
the same `core/runtime.mjs` as the legacy `openMemoryStore` facade. There is no
separate storage/classification engine for each host.

| Operation / obligation | Implementation seam | Observable test evidence |
| --- | --- | --- |
| `admit`: explicit identity, receipts, dedup, suppression | contract → runtime admission mutation | `core/test/contract.test.mjs`, `store.test.mjs`: trusted fields, atomic receipt rollback, explicit precedence |
| `list`: exact namespace, bounded metadata, signed continuation | runtime listPage + facade cursor | `contract.test.mjs`: restart cursors, isolation, metadata-only pages |
| `get`: content, paged receipts, placements, attributed conflicts | runtime getPage + MOC/conflict inspection | `contract.test.mjs`, `conflict.test.mjs`: source paging, symmetric assertions, stale/foreign filtering |
| `correct` / `forget`: CAS, suppression, invalidation | shared runtime mutations | `store.test.mjs`, `contract.test.mjs`, `conflict.test.mjs`: two-process CAS, rollback, both endpoints, legacy mutation paths |
| `claimAdmission` / `finishAdmission` / `abandonAdmission` | admission-storage + shared admission mutation | `admission.test.mjs`: active leases, expiry/takeover, old-token fencing, atomic completion, replay after restart/forget |
| `capture`: bounded extraction and trusted evidence | capture + capture-input + injected model-call | `capture.test.mjs` C01–C13: digest identity, forged sources, deadlines, model-free replay, durable classification failure |
| Inline `conflictHints` and attributed inspection | conflict-storage + admission/MOC invalidation | `conflict.test.mjs` K01–K08: source variants, target revisions, incident caps, full-batch rollback |
| `classifyPlacement` / `applyPlacement` | injected classification + MOC storage | `classification.test.mjs`, `moc.test.mjs`: proposal allowlists, memory/index CAS, derived titles, incomplete catalogs |
| `linkMocs` | MOC storage hierarchy mutation | `moc.test.mjs`, `index-rebuild.test.mjs`: exact-level hierarchy, revisions, duplicate no-op, active projection maintenance |
| `map`: bounded root/parent navigation | MOC storage + generation read authority | `moc.test.mjs`, `index-rebuild.test.mjs`: token/page limits, source-title withholding, invalid refs, orphan visibility |
| `fetch`: bounded current memory/receipt pages | fetch + runtime fetchPage | `fetch.test.mjs`: cursor binding, ordered receipt continuation, stale/missing refs, token packing |
| `recall`: federated selection, continuation, ranking, final authority | recall + facade finalizer + runtime recallSnapshot | `recall.test.mjs`, `recall-continuation.test.mjs` T01–T06: second-page targets, call/fetch ceilings, incomplete empty, all-candidate final revision checks |
| `rebuildIndex`: staged bounded validation and atomic authority | index-storage/schema + active read views/triggers | `index-rebuild.test.mjs` R01–R07: physical-row limits including skipped refs, process continuation, private progress, pointer rollback, ordinary/legacy writes |
| Store identity, upgrades, restart | database + frozen public schema fixtures | `migration.test.mjs`, `moc-migration.test.mjs`, `admission-migration.test.mjs`, `conflict-migration.test.mjs`, `index-migration.test.mjs` |
| `close`: explicit resource lifecycle | runtime close + envelope | `store.test.mjs`, `contract.test.mjs`: idempotent close and closed-store errors |

The test paths after the first entry are relative to `core/test/`. Acceptance
details remain in their package specs, not just the inventory's short labels.
Admission replay is performed with the same event/digest claim; it is not a
second public `replayAdmission` implementation that could bypass suppression.

## Limits that remain explicit

- Model ports are injected; byte/fixed counters in tests are not production
  tokenizers. One real provider/tokenizer and frozen semantic/resource evaluation
  remain stage 2 gates. Passing mocks does not establish relevance or cost.
- Recall examines at most two root-map pages per namespace and two receipt pages
  per candidate. It can return budget_exhausted or a context error; it does not
  promise exhaustive search of arbitrary stores.
- Contradiction hints are caller assertions, not general semantic contradiction
  detection. No automatic conflict resolution, merge or truth replacement exists.
- All currently created topic titles require current source bindings. A separate
  explicitly authored title exemption and public retired-MOC management API are
  not exposed. Rebuild validates declarations; it does not recreate lost topics.
- Old index generations retain reference metadata; bounded garbage collection,
  cancellation/status APIs and secure physical erasure are not implemented.
- Namespace selection belongs to a trusted host; core is not an authentication,
  billing, quota, team-sharing or telemetry service. Moss remains out of scope.
- The released plugin still talks to its configured hosted service. Standalone
  MCP distribution, real client tests, an ecosystem listing, PLG launch and the
  commercial pinned-core migration are separate uncompleted roadmap stages.

These boundaries prevent “core source is tested” from being presented as “the
standalone product is ready” or “the commercial service already uses this engine.”
