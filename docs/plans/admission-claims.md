# 1a — fenced admission claims and atomic inferred commits

Base: `44ece1479f4048a8a95f895baa6e674ec9a1c0a1` (merged delivery plan).
Public code and synthetic fixtures are independently authored. Same SQLite
runtime; no extractor/model/network/MCP/hosted/Moss implementation in this slice.

## Acceptance

- A1: Add synchronous envelope methods `claimAdmission`, `finishAdmission`,
  `abandonAdmission` to openMemoryCore. All inputs use exact field allowlists and
  existing exact namespace/opaque identifier validation. Constructor unchanged.
  No model or token counter is needed. Conflict hints remain unsupported until 1c.
- A2: Claim input `{namespace,client,eventId,payloadDigest,leaseMs}`. Digest is
  exactly 64 lowercase hex characters (SHA-256 of complete validated/redacted
  payload, computed by trusted orchestration); leaseMs safe integer 1..125000.
  Key is exact namespace+client+eventId. Results are exactly `{token}` for a new
  or expired claim, `{processing:true}` for an unexpired owner, or
  `{duplicate:true,memoryIds,suppressedCount}` for completed work. Different digest
  on ANY existing key, even expired/abandoned/completed, is event_payload_conflict.
  Tokens are fresh unpredictable opaque identifiers; lease uses trusted local
  wall clock. Claim/abandon do not change memory/index epochs or stale cursors.
- A3: Finish input `{namespace,client,eventId,payloadDigest,token,items}`. Missing,
  expired, completed, replaced or mismatched token/digest/key is stale_admission.
  Transaction validates the live claim before writes; expiry checked after lock
  acquisition. No stale owner can commit after takeover. All 0..5 items and job
  completion commit in one transaction, including valid zero extraction.
  Result `{duplicate:false,memories:[{id,revision}],suppressedCount,indexRevision}`.
- A4: Each trusted item is `{content,kind,confidence,receipts}`; content normalized/
  redacted max600 UTF-16 units without splitting Unicode points; kind existing enum;
  required finite confidence in 0..1; 1..4 existing-shape source receipts, redacted
  bounded excerpts. Core assigns IDs, origin agent-inferred and namespace. Reject
  sparse arrays, unknown fields, caller/model origin/IDs and invalid batch members
  before ANY writes. Source-event evidence checking belongs to the future trusted
  extractor (1b); finish is NOT a direct untrusted-model-output endpoint.
- A5: Reuse the same admission mutation helper as explicit/legacy writes, with no
  second engine or nested transaction commits. Exact active content deduplicates;
  novel receipts merge and invalidate filing/titles/revisions through existing
  rules. Inferred input cannot change explicit content/kind/origin/confidence.
  Same-batch exact matches coalesce to unique IDs and final revisions in first
  occurrence order. Suppressed items skip writes and increment suppressedCount
  per input item; successful non-suppressed items still commit. Suppression is
  checked before deduplication, so corrected/forgotten content never resurrects.
  Changed/new memories stay inspectable unfiled; exact no-op retains filing.
  Epoch increments retain the existing per-material-admission rule, not a new
  promise of exactly one increment per multi-item batch.
- A6: Completed claims store only bounded outcome IDs/count and key/digest state,
  not input transcript, memory body, receipt excerpts or cached result content.
  Re-claim returns recorded IDs/count after restart/correction/forget, not fresh
  content; duplicate IDs may refer to forgotten memories. Finish cannot replay a
  completed claim. A new event with old suppressed content completes with a
  suppression count, never restored memory. Digest hashes are not encryption.
- A7: Abandon input `{namespace,client,eventId,payloadDigest,token}`. Return
  `{abandoned:true}` only for a matching live pending claim, expiring that owner.
  Otherwise `{abandoned:false}` without changing a successor or completed state.
  After abandon a same-digest claimant can acquire a fresh token immediately.
- A8: Schema v4→v5 upgrade is atomic; v1/v3 upgrade through existing migrations
  plus v5. v2/foreign/future versions still reject. Preserve memories, receipts,
  suppression, MOC/index data, store/cursor identity and epochs. Existing cursors
  survive upgrade if namespace content is unchanged. Mid-DDL failure rolls back
  all changes/version; older v1/v3/v4 binaries cannot open v5. No downgrade tool.
- A9: Real temporary SQLite tests cover new/processing/completed claims, digest
  conflict, abandonment, expired takeover/stale finish, two-process claim/finish
  races, restart replay, empty extraction, same-batch dedup/final revisions,
  explicit precedence, MOC invalidation, partial-batch and completion-write
  rollback, suppression replay, migration and content-free persistent outcome.
  Synthetic expiry can be set in the test database; also exercise a real short
  wall-clock expiry. No public clock override or production data/script use.
  Required gates: core tests on Node22.16/24, plugin tests/JSON/plugin validation,
  existing store/MOC/recall demos and new admission demo on both CI versions.

## Implementation ownership

Primary owns facade validation, migration compatibility test expectations, public
docs/demo/CI and integration. Engine worker owns core/database.mjs,
core/runtime.mjs and optional core/admission-storage.mjs only. Independent test
worker owns new admission tests/fixtures only. Final reviewers are neither worker.

Runtime seam: `claimAdmission(ns,{client,eventId,payloadDigest,leaseMs})`,
`finishAdmission(ns,{client,eventId,payloadDigest,token,items})`,
`abandonAdmission(ns,{client,eventId,payloadDigest,token})`. Validated items carry
content/kind/confidence/receipts plus origin agent-inferred and public fingerprint.
Runtime returns the public-shaped values above; facade wraps stable errors.
