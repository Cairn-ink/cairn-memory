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
- Rationale runs after placement through the opt-in port in Addendum 6.
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
6. **Recall scores and the lexical fallback.** `MemoryService.recall` may return `scores?: number[]`.
   - When present, `scores` has the same length and order as `items` after hydration and the visibility fence: one score per returned memory. Hybrid recall returns the hosted preset's fused scores, lexical-only recall returns store relevance, and blank-query recall returns zeros. Hosts may project the scores onto their wire items. Consumers that read only `items` and `nextCursor` stay valid.
   - When a first page cannot rank semantically, recall ranks lexical-only instead of failing, and emits one content-free `DiagnosticEvent` `{ stage: "recall", layer: "core_retrieval", reason }` through the service `diagnostics` observer. `reason` is one of `semantic_unavailable`, `dispatch_closed`, `embed_failed` or `coverage_incomplete`. This is a declared difference from hosted, whose hybrid search fails on an embedding error.
   - A cursor binds the ranking path of its first page. A hybrid continuation that cannot rank semantically is `cursor_stale`, and a lexical continuation never embeds.
   - It supersedes nothing.
7. **SuppressionFact ids up to 512.** SuppressionFact identity `memoryId` and `sourceMemory.id` accept up to 512 characters (was 128), so a forget never fails on an id the store already holds. Stores refuse ids over 512 at import. It supersedes the 128 bound.
8. **Retrieval scope window and memory clients (2026-11-24).** The optional `window` is a half-open range `[sinceMs, untilMs)` over store-entry time. It uses memory `createdAtMs`, card creation time, and raw `occurredAtMs`. Either bound may be omitted. A raw segment with null `occurredAtMs` is excluded whenever a window is set. With no window, time is unrestricted.
   - When `clients` is set, memories must have a matching `source.client`. A null memory client never matches. Raw keeps its client filter.
   - Adapters must apply the window and client filters inside the lexical, vector, recent, and raw candidate queries before any depth or pool cut. State tokens bind the window as they bind clients.
9. **Capture admission, status and Raw import.** The four new port methods are optional. Core raises `capability_unavailable` when a needed method is missing.
   - `CaptureClaim.admit(tx, key, messages)` stores the prepared messages as the admission row, which is the outbox. It runs under the pause lock without taking a lease. It returns `admitted`, `duplicate`, `processing`, or `rawReplay` with the stored `FinishResult`. The dedupe identity is `(owner, client, eventId)` across namespaces. The same `payloadDigest` replays the first admission. A different digest throws `event_payload_conflict`. Core never falls back to `claim` for admission.
   - Admission validates 1–24 messages, with ids of 1–200 UTF-16 units and content of 1–20,000 UTF-16 units per message before preparation. Core normalizes content and applies union redaction before computing the payload digest. Inside the pause-locked write, core checks source eligibility with the message times and matches the suppression snapshot's text facts. Each withheld message keeps its original position as `{ id, role, content: "", occurredAtMs }` in both the outbox and the lineage call. An all-withheld batch still gets an admission row so `runCapture` can finish it with no items and clear the pending event.
   - `CaptureClaim.load(tx, { scope, client, sessionId, eventId })` returns the stored `{ key, messages }` for the runner, or null if absent.
   - `CaptureClaim.status(tx, scope, eventId, client?)` reads a single event without writing. It returns `unknown` for an absent event. With no client, any pending row yields `pending`, otherwise any failed row yields `failed` with its code, otherwise the event is `done`. Failures expose only codes. `MemoryService.captureStatus(scope, eventId, options?)` accepts an optional `{ client?: string }`.
   - `RawCapture.importArchive(tx, scope, { client, sessionId }, messages)` returns `{ archived, existing, withheld }`. It checks session, window, lineage and text eligibility internally and fails closed. It counts refusals per message without storing them. Existing message ids are conflict-ignored.
   - It supersedes nothing.

   The conformance kit adds cases for these methods; the reference adapter implements them.
10. **Import progress and creation times.** A paused `MemoryService.importMemories` returns `{ status: "paused" }` with all four `ImportResult` counts from the batches that committed and any invalid-only batches already processed. The batch that stopped contributes no counts.
   - `InsertRow.createdAtMs` is optional and supplied only on import. An insert validates that a supplied creation time is an integer in milliseconds at or before `nowMs` and stores it as the creation time. If omitted, creation time defaults to `nowMs`. The update time uses `nowMs` in both cases. Core counts a future creation time as an invalid import item.
11. **Visibility fence read intent (2026-11-24).** `VisibilityFence.assertVisible` accepts an optional fourth argument `"read"` to include historical memories. The fence still drops forgotten, suppressed, and out-of-scope rows. With the argument omitted, the fence drops historical memories.
   - `MemoryService.read` supplies `"read"` to the fence in the same snapshot as delivery hydration. Recall, find, recent, and export omit the argument.
   - Adapters that ignore the argument still satisfy the default cases.
12. **Raw import withheld positions.** `RawCapture.importArchive` accepts an optional fifth argument `options?: { withheld?: readonly number[] }`. The zero-based positions identify messages Core has already withheld in the full prepared batch. All text at the port uses Core's usual normalization and redaction.
   - The adapter computes lineage and fork proofs over the entire batch, including the withheld positions. It never stores, indexes or returns a message at a withheld position. It counts that position once in `withheld` and applies the ordinary eligibility rules to the other positions, including fencing a proven fork.
   - It supersedes nothing.

### Topics addendum 4 — Cards in topics

The `placement` port files visible document cards into up to three existing L1 topics in the
same owner and namespace. Card placement never creates topics. It uses the memory classifier's
prompt, packer, and wire format with `title + "\n\n" + body`, in separate batches of at most five
cards. Requests set `mapExhausted` to false and core discards any proposed new topics.

- `pendingCards` selects the oldest unhidden, untombstoned cards without an outcome at their
  current content hash. Cards in other scopes stay in their own queues. Failure receipts
  follow the memory retry policy and are bound to the current hash.
- Before model dispatch, the host's `VisibilityFence` checks card refs in the read snapshot.
  The host uses `documentCardVisible` for the card and its sources, including the source-less
  import and manual rules. A card excluded by the fence gets a `source_excluded` receipt.
  Core rechecks hashes, visibility, and the catalog revision before and after the model call.
- `applyCardPlacement` atomically replaces memberships. A changed index revision, missing
  or invisible card, changed hash, noncurrent source memory, or parent outside the scope's
  existing L1 topics fails with `revision_conflict` before any writes. An unchanged placement
  is idempotent. An unfiled outcome alone leaves the index revision unchanged. A membership
  change advances the owner index once.
- Topic membership applies only at the recorded card content hash. Replacement makes the
  card eligible for placement again. Hidden and tombstoned cards, and cards whose recorded
  source revisions are historical, missing, or suppressed, are excluded from membership.
- In the forget step `dependents.invalidate`, hosts must use `dropCard` as part of every
  card hide or tombstone, in the same transaction. `forCard` returns an empty list immediately
  after the hide in that transaction.
- `members` mixes memory and card refs by placement time descending, then UTF-8 ID descending,
  with memory before card when both keys tie. `list` includes topics with either kind of
  visible member. `memberCount` and `newestMemberIds` count memories. `cardCount` is present
  only with `documentCards` enabled and counts distinct visible cards across the L1 children
  for an L2 topic. `pendingCards` returns an empty list without `documentCards`.

The optional `forCards` batch lookup annotates placed cards with L1 topic IDs and titles.
It copies the scope once at entry and snapshots 1–100 caller IDs before reading state.
Duplicates count toward the limit, and other batch sizes raise `invalid_input`. Rows follow
first occurrence and include only cards visible under `forCard` and `members` at the
placement's recorded hash. A visible outcome without topics returns `topics: []`. Topic
order follows `forCard`. A title is null when a title source is no longer current at its
recorded revision.

The memory adapter has no Raw archive. Its source-message predicate uses the capture session
resolver (plain session ID by default or the configured session hash resolver) and the shared
fact matcher. It withholds a message when an applicable session or window fact matches the
stored source, a text fact matches the retained card text, or an identity fact matches a
linked memory. An ineligible comparison with applicable evidence also withholds the source.

## Change requests

Send the core lead the port, the method, and the reason. A request is
accepted only if it keeps every adapter able to implement it, or it adds a capability flag.

## Addendum 3a: TopicStore.forMemories

The optional `forMemories(tx, scope, memoryIds)` returns L1 topic annotations as
`Array<{ memoryId: string; topics: Array<{ id: string; title: string | null }> }>` in one query.
Callers skip annotations when the adapter omits the method.

- A row requires a placement outcome and a memory that is current and visible in scope at the
  outcome's recorded revision, using the same rule as `forMemory` and `list`. A qualifying filed
  or unfiled outcome with no topics yields `topics: []`.
- Unknown ids and ids from other owners or namespaces yield no row. A duplicate yields at most
  one row, and the rows follow the first occurrence of each id in the input.
- Topics follow `forMemory` order. A title is null when any title source is no longer current at
  its recorded revision, as in `list` and `catalog`.
- The input must contain 1–100 ids, counting duplicates. Other batch sizes throw `invalid_input`.

`dropMemory` advances the owner's index revision once when it drops at least one membership or
retires at least one title source. A title becoming null can reorder `list` and `catalog`, so
their earlier cursors become stale. Memory erase covers the same changes through its existing
index revision advance.

### Addendum 6: rationale edges

Rationale is opt-in and off by default. A host registers `StorageAdapter.rationale` with
`rationaleEdges` and invokes `relatePlaced` immediately after a placement batch commits. The
pass takes one to five distinct memory guards from that batch, plus the model, `ModelGate`,
retrieval ports, deadline, cancellation signal and diagnostic observer. It makes at most one
attempt. Its reviewed, failed or skipped report carries proposal and insert counts and, when
available, lexical discovery counts and truncation flags. A failure leaves placement intact.

Discovery joins the admitted source message texts in admission order, deduplicated by raw
message identity. The query uses the first 4,000 UTF-16 units and drops a trailing high
surrogate. A host supplies full visible text for local discovery through
`rationaleSourceText`. The lexical candidate port uses the admission's exact namespace.
Admitted guards come first and lexical candidates fill the batch to six unique refs. Scoring
uses the core retrieval tokenizer. The lexical query stays local.

`sourceEvidence` reads every receipt of each current memory through the host's Raw visibility
rules. It checks forget facts, session fences, text and window facts, retired receipts and
uncertain visibility at read time. It returns one to 100 receipts per memory. Each receipt
has a stable digest of `(client, sessionId, messageId)`, its role and up to 800 UTF-16 units
of the source message cut on a code-point boundary. The host applies text facts to that
excerpt with containment. If any applicable text fact is too short for containment or the
comparison is otherwise unavailable or uncertain, the host withholds the receipt. A missing,
withheld or uncertain excerpt, including one from a conflicted Raw message key, fails the
memory closed with `revision_conflict`. Excess
receipts or a snapshot over 24,000 serialized UTF-16 units fail before sending with
`context_item_too_large`. Core uses the whole evidence set with no packing. The
reference adapter's capture path retains receipt
metadata. Its test harness seeds synthetic raw text and passes reads through the shared
fact matcher.

Core sends the engine `relate` prompt with indexed receipt roles and excerpts only. The
`rationale` stage uses `cairn_relate`, a strict provider schema and a 1,024-token output
limit. The freshness reread finishes before the dispatch gate check. A closed `ModelGate`
stops the send. Provider failures use `rationale_failed`
(`unavailable`). The complete ordered evidence and owner index revision must match before
dispatch, after output and again in the write transaction. A change returns
`revision_conflict`. The diagnostic for invalid rationale is
`relate/core_validation/invalid_rationale`.

Core validates at most ten proposed edges. Supports may point to themselves and challenges
must have distinct endpoints. The store uses the directed endpoint ids, relation and two
receipt ids as its idempotency key. The write binds each endpoint revision and the unkeyed
`ClockAndHash.sha256Hex` digest of `{ id, role, excerpt }`. Degree counts at most ten edges
per memory and counts a self-support once. Overflow returns `rationale_limit` (`limit`) and
rolls back the whole batch. Any successful insert advances the owner index revision once per
batch. A duplicate or empty proposal leaves it unchanged. Core placement itself leaves
memory revisions unchanged, so no filing rebind is needed.

Hosts invalidate all incident rows in the same transaction as a revision, content,
currentness, namespace, erasure or receipt change. That includes adding, removing or
updating receipts and duplicate attaches at the same revision. Hosts also delete every
edge whose endpoint cites a receipt in a removed Raw message in the same transaction as
the Raw deletion or purge. Forget runs rationale invalidation at `dependents.invalidate`.
Every edge read also checks current endpoint revisions and each cited receipt's digest.

`decisionContext` follows incoming supports and challenges to the root and challenges to
its visible supporting premises. The walk deduplicates stored edge keys and is bounded at
ten edges and six sources. A suppressed or hidden linked endpoint removes its edges from
the view. The other paths remain visible. The result contains only refs
`{ id, revision, relation, direction }` and a status, `reconfirmation-suggested` when a
visible challenge exists or `unassessed` otherwise. It exposes no excerpts, counts or
markers for hidden evidence. FIND retains authority over text delivery. Edge persistence
and the incident-row port are available to hosts with the capability. Cloud enablement
depends on its Raw-aware receipt ledger.
