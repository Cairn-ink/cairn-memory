# Phase 0: frozen interfaces

Every team starts from these types. Nobody invents a port: a missing method is a Phase 0
change request to the core lead, answered on the same day.

## What is frozen

| File | Contents |
|---|---|
| `packages/core/src/errors.mjs` | `ErrorKind` (9 kinds), `ErrorCode` → kind table, `CoreError` (message = code only), `toCoreError` |
| `packages/core/src/capabilities.mjs` | Capability flags; `capabilities()` and `requireCapability()` |
| `packages/core/src/suppression-fact.mjs` | One `SuppressionFact` union (`identity`, `text`, `session`, `window`), `validateSuppressionFact` |
| `packages/core/src/decisions.mjs` | Pinned numbers and policies (below) |
| `packages/core/src/utf8.mjs` | `compareUtf8` (canonical id/namespace order, no Buffer), `compareSortKey` (exact µs keys) |
| `packages/core/src/ports/*.d.ts` | `UnitOfWork`, capture, memory store, retrieval, privacy, model and host ports; `StorageAdapter` |
| `packages/core/src/extraction/` | Plain extraction prompt/spec, candidate validation, embedding decode (carried from the engine package), with the engine parity fixtures |

## Pinned decisions

| Decision | Value | Source |
|---|---|---|
| Near-duplicate threshold | cosine distance 0.08, both stores | Product decision |
| Forget rules | Same everywhere. With a fingerprint key: exact, HMAC, shingles, vector, lineage. Without a key: exact + lineage only. The local switch ships only after a measured impact check. | Product decision |
| Hosted lineage | Session-level, message-MAC fork fences with keyed content proofs until after the cutover; span receipts come later | Product decision |
| Ranking | Hosted cuts over on the `hosted` preset (k 60, lexical 0.5, vector 1, pool 50; ties `updatedAt` desc then `id` desc on the exact µs key, in both channels and the fused order; offset paging over the fused union ≤ 100). Engine keeps `rrf-k60-d12` (weights 0.45/0.45, union 24, canonical tie). Any change waits for the benchmark. | Product decision |
| Ordering keys | All ordering uses `updatedAtUs` (bigint µs) and `compareUtf8` for ids/namespaces; ms fields are display only | Interface review |
| Origin | `explicit` (mcp, web, import) / `inferred` (capture, plugin); duplicate merge `{confidence, kind?, origin?}`; review state parked | Interface review |
| Hash | The cloud normalizer is the core text hash; the engine's legacy fingerprint is a lookup | Design decision (privacy module confirms the suppression key) |
| Edits | Identical text → `unchanged`, no revision bump; text colliding with another memory → `memory_conflict` | Design decision |
| Export / import | `MemoryService` has `exportMemories`, `listRawMessages`, `importMemories`, `importRawMessages`; imports run the full capture suppression and pause check | Design decision |
| Test hooks | Kit-owned `TestHarness` (in the conformance package, test builds only); production ports stay clean | Design decision |
| Vector-only floor | 0.45, plugin recall only, applied after fusion; a row in the lexical pool is always kept | Shipped hosted behaviour |
| Suppression distance / containment | 0.20 / 60% of 4-char shingles | Shipped hosted behaviour |
| Lineage closure bound | 1,000 sessions / 20,000 vertices; over the bound → `lineage_closure_limit`, full rollback, never partial | New specification (hosted lineage closure); not yet in the shipped hosted service |
| Extraction slice | 24 messages per model call | Engine and plugin wire today; NEW policy for hosted extraction (it extracts up to 500 messages in one call today); on the shadow-comparison list |
| Tool response cap | 262,144 bytes, refused not truncated | Engine contract |
| Parked, not in core | Method packages, assets, role profiles, episodes | Product decision |
| Cloud launch-only heuristics | May be deleted with the cloud owner's sign-off | Product decision |

## Rules every adapter follows (checked by the conformance kit)

1. **Locks.** `UnitOfWork.run` holds one transaction. Local stores run it on an exclusive writer connection under an async mutex, with synchronous port bodies and a live-Tx check on every call. Lock order is the pause lock, then the owner write lock. No model or network call runs inside it: core embeds and extracts first, then re-checks inside the transaction.
2. **Errors.** Every failure crossing a port is a `CoreError` with a code from `ERROR_CODES` (own keys only). A message carries no text, hashes, keys, ids or SQL. Each adapter passes an explicit, tested native-code map to `toCoreError`; unmapped failures become `internal_error`.
3. **Fail closed.** Uncertain suppression state, a missing key where one is needed, or a lineage error refuses or hides. Nothing is ever inferred from absence.
4. **Visibility.** Candidate ports return rows already filtered by the visibility predicate in the same snapshot. `VisibilityFence` re-checks right before delivery.
5. **Optional ports.** An optional port is present exactly when its capability flag is true (`assertAdapterCapabilities` at registration, both directions). A missing capability degrades to a defined result: lexical-only, `index_unavailable`, or skipping the step. It is never an unhandled error.
6. **Facts.** Core passes an `incarnation` (digest of `factIncarnationBody`: `factBody` without a text fact's embedding, which providers do not reproduce bit for bit; stores keep the full `factBody`). The same incarnation in a fact slot returns the original fact; a different one throws `fact_conflict` and rolls back. A new fact advances the owner epoch by exactly 1. Text facts carry every digest variant (core, hosted-v1, engine-legacy) and match on any of them; passages that held a secret use `hmac` digests, never unkeyed ones. Local stores keep only hashed session keys.
   Stores without row shingles can set `rowShingles: false` to skip containment for full text facts. Paraphrases that miss both exact and vector matching stay visible on row reads, as with the hosted saved-memory predicate.
7. **Erasure.** Raw erasure covers exactly the proven closure or text-withheld rows, the same set forget erases. `eraseSessions` accepts only a `ProvenClosure` from `provenClosure` (type-level guard). Id-only and unknown fences hide but never delete.
8. **Forget's row step** makes the row permanently invisible and erases its content; adapters may delete or tombstone.
9. **Read sets.** Retrieval reads take one owner and a list of namespaces fused into one ranking; every `ItemRef` carries its namespace.
11. **Deterministic candidate order.** Vector candidates order by distance, then `updatedAtUs` desc, then `id` desc by UTF-8 bytes (SQL: `ORDER BY distance, updated_at DESC, id COLLATE "C" DESC` before `LIMIT`). Lexical candidates order by non-increasing store score with a store-defined tie order (the hosted SQL uses `relevance, updated_at DESC, id COLLATE "C" DESC`; the local store keeps canonical ties). Core re-sorts after fusion with its preset tie rule. Boundary ties that differ from the shipped hosted order are expected differences on the shadow-comparison list.
10. **Embeddings are optional at write.** `InsertRow.embedding` may be null; near matching then skips that row and counts it.

## Team map

| Team | Builds | Ports it implements or consumes |
|---|---|---|
| A, capture core | capture orchestration, qualification, reconcile | consumes `CaptureClaim`, `CaptureFinish`, `SourceFilter`, `RawCapture`, `ModelPort`, `ModelGate`, `CausalStream` |
| B, memory policy | dedupe, correct, supersede, conflict | consumes `MemoryStore`, `SupersessionStore`, `ConflictEdgeStore`, `SuppressionStore.snapshot` |
| C, retrieval core | tokenizer, BM25, fusion presets, floor, assembly, session start | consumes the retrieval ports; owns `FUSION_PRESETS` math |
| D, privacy core | fingerprint, redact (frozen v1 + current), withholds, forget order, pause | consumes `SuppressionStore`, `SessionLineageStore`, `SpanLineageStore`, `RawStore`, `PauseStore`, `FingerprintKeyProvider`; owns `privacy/redact.mjs` (frozen v1 + current), which replaces `extraction/redact.mjs` |
| E, memory adapter + conformance | reference adapter, invariants §5 | implements `StorageAdapter` in memory |
| F/J, wire + host adapters | hosted contract, MCP/plugin on the facade | consumes `MemoryService` |
| G/H, Postgres adapter + cloud switch | refactor of the hosted `src/memory` | implements `StorageAdapter` on Postgres |
| I, SQLite adapter + installer | wraps the engine storages | implements `StorageAdapter` on SQLite |

## Scope calls (core lead)

- Ordered capture (`CausalStream`) ships as the capture module's second slice, after the supersession port.
- The core capture modules replace `src/extraction/`; its fixtures stay as the old-versus-new extraction oracle.
- The capture rationale stage is not in core until a keep/drop decision; `ModelStage` reserves its name only.
- One id order in all of core: UTF-8 bytes (`compareUtf8`). Where the hosted service compares ids differently today (SQL collation, JS UTF-16 string order in in-batch ties), the difference is listed for the shadow comparison.

## Addenda

Each addendum is additive unless it says what it supersedes. Adapters written against an earlier version stay valid.

1. **`ModelPort.fits?` (optional).** `fits?(stage: ModelStage, request: ModelRequest): boolean`, synchronous and content-free. It reports whether the adapter's full provider request for this exact `request` fits the adapter's own limits, measured on the body it would actually send, including provider framing, model id and strict schema, none of which core can see.
   - Core consults `fits()` exactly where the engine consulted its adapter's hook: candidate qualification planning. There, core plans with its own count (sizing text ≤ 6000 tokens) AND `fits()` when the hook is present. When the hook is absent, core plans by its own count alone, as the engine does for an adapter without the hook. Other stages, including automatic qualification, plan by core's own count only.
   - A throw from `fits()` counts as `false`: that group is not sent and planning splits it smaller; smaller groups are sent only if they fit. This deliberately differs from the engine, which aborts planning with `token_count_unavailable` when its hook throws.
   - It supersedes nothing. The conformance kit must accept adapters without it.
   - Reason: core's sizing text undercounts the provider body. Five inline qualification items with four 180-character CJK excerpts each measured 5,857 tokens by core's sizing text and 7,512 by the serialized provider body. The engine rejects that group and accepts each item alone. Without the hook, a verbatim adapter would plan differently.
2. **Error code `model_cancelled`** (kind `unavailable`, not retryable). Raised only when the model adapter's call ends with an AbortError that is not the capture deadline, as the engine does today. The deadline path keeps `model_timeout`. It supersedes nothing.
3. **TopicStore** replaces PlacementJournal under the `placement` capability. Titles read as null when any
   source is gone, forgotten, or off its recorded revision. A classified-unfiled outcome is excluded from
   pending work until the memory revision changes. The new error code is `moc_title_conflict` (kind `conflict`).
   For privacy, `applyPlacement` binds every new topic title to all memory ids and guarded revisions in `basedOn.memoryRevisions`.
4. **`embeddingRequiredOnInsert`** (capability, default false). A store with this flag refuses an insert or content replacement with `embedding: null` as `invalid_input`.
   - The orchestrator never inserts a null embedding into a store with this flag. A missing vector is the retryable `embedding_failed`.
   - The conformance kit supplies fixture vectors when the flag is set.
   - It supersedes nothing.
   - The hosted schema requires an embedding through its `NOT NULL` vector column.
5. **Keyed row digests.** `DuplicateQuery`, `InsertRow`, and `FinishItem` accept optional `digests` from core's `allDigests(text, key)` under the owner's current key. Stores persist row digests.
   - For an HMAC-only text fact, a row or query without a digest under the fact's key ID is ineligible. Reads hide the row and writes deny the query.
   - The reference store can derive row digests from stored text. Stores with existing data backfill before switching and require the count of rows lacking a current-key digest to be zero.
   - Rotation stages the pending key's digest for every existing row while writes continue to use the retained key ring. Before publishing, rotation rechecks owners with active writes or changed committed state and refreshes the staged rows to include writes that committed during staging. It then publishes the refreshed rows and adds the pending key to the ring as current in one step. Rows keep digests under every retained key so earlier facts remain comparable.
   - A store with retained non-current keys refuses rotation while any live HMAC-only text fact holds a digest under one of those keys.
   - A key may be dropped only when no live fact holds a digest under it.
   - Core write paths fill query digests before core-backed writes. A query without digests is blocked while an HMAC-only text fact applies.
   - It supersedes nothing.

6. **Capture admission, status and Raw import.** The four new port methods are optional. Core raises `capability_unavailable` when a needed method is missing.
   - `CaptureClaim.admit(tx, key, messages)` stores the prepared messages as the admission row, which is the outbox. It runs under the pause lock without taking a lease. It returns `admitted`, `duplicate`, `processing`, or `rawReplay` with the stored `FinishResult`. The dedupe identity is `(owner, client, eventId)` across namespaces. The same `payloadDigest` replays the first admission. A different digest throws `event_payload_conflict`. Core never falls back to `claim` for admission.
   - Admission validates 1–24 messages, with ids of 1–200 UTF-16 units and content of 1–20,000 UTF-16 units per message before preparation. Core normalizes content and applies union redaction before computing the payload digest. Inside the pause-locked write, core checks source eligibility with the message times and matches the suppression snapshot's text facts. Each withheld message keeps its original position as `{ id, role, content: "", occurredAtMs }` in both the outbox and the lineage call. An all-withheld batch still gets an admission row so `runCapture` can finish it with no items and clear the pending event.
   - `CaptureClaim.load(tx, { scope, client, sessionId, eventId })` returns the stored `{ key, messages }` for the runner, or null if absent.
   - `CaptureClaim.status(tx, scope, eventId, client?)` reads a single event without writing. It returns `unknown` for an absent event. With no client, any pending row yields `pending`, otherwise any failed row yields `failed` with its code, otherwise the event is `done`. Failures expose only codes. `MemoryService.captureStatus(scope, eventId, options?)` accepts an optional `{ client?: string }`.
   - `RawCapture.importArchive(tx, scope, { client, sessionId }, messages)` returns `{ archived, existing, withheld }`. It checks session, window, lineage and text eligibility internally and fails closed. It counts refusals per message without storing them. Existing message ids are conflict-ignored.
   - It supersedes nothing.

   The conformance kit adds cases for these methods; the reference adapter implements them.

## Change requests

Send the core lead the port, the method, and the reason. A request is
accepted only if it keeps every adapter able to implement it, or it adds a capability flag.
