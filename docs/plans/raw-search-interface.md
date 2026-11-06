# Optional local Raw search interface

Version: `raw-search-v1`. This trusted engine API is independent of context
representations and Raw saving. Existing constructors never select it.

`await openRawSearch(options)` is exported from `core/index.mjs`. Omitted options
or `{ enabled: false }` return `null` before imports, probes, clocks or ports.
Selection requires `version: 'raw-search-v1'`, `enabled: true`, `backend: 'local'`,
canonical `path`, private `directory`, `ownerId`, `readSet`, `authority` and a
`raw-seal-v1` `crypto` port. Hosted selection refuses. Up to 32 exact namespaces
belong to one owner. Handles are trusted host configuration, never tool inputs.
Maintenance selection and read selection are independent.
Select the service before admitting Memory reads; drain existing reads before
changing selection so their preflight vectors have been released.

The selected handle provides:

- `search({ query, intent?, queryVector? }, token)` returns a Promise of
  `{ version, publication, candidates, coverage, semantic }`. Intent defaults to
  `current`; `history` includes retained historical sources. At most 24
  candidates contain `{ id, namespace, conversationId, messageId, ordinal, role,
  occurredAt, ranges, score, centerId, neighbor, currentness, classification,
  rangeClassifications, publication, proof }`, with no prose. Each range is an
  authenticated canonical Raw ref. `proof` is an opaque, service-local binding
  to the complete ranking dependency manifest. Do not modify candidates.
- Each classification is `{ kind, reason }`. Kinds are `denied`,
  `current-eligible-bare`, `current-eligible-linked`, and `history-only`.
  Demonstrably bare sources have complete privacy checks and no Memory link;
  their currentness is unknown. Render them as attributed past-conversation
  evidence that may be outdated, never adopted/current truth. Linked current
  sources have resolved current Memory links. Retired links, current/history
  overlaps and unresolved structural currentness are history-only, with a
  reason. `rangeClassifications` preserves each child's policy. Unknown privacy
  ancestry or missing required authority denies both intents.
- `classify(candidate, { intent? }, token)` returns a fresh classification.
  A denied/stale/foreign candidate returns only
  `{ kind: 'denied', reason: 'source-or-authority-unavailable' }`, with no identity,
  score, range or text. Search omits denied candidates entirely; it never exposes
  their identifiers. This distinction prevents denial diagnostics becoming a
  second result channel.
- `prepare(candidate, { intent? }, token)` returns a private prepared handle
  `{ value, ticket, validate() }`. `value` contains source metadata,
  classification and separate `{ source, text, classification }` ranges,
  materialized from canonical sealed parts outside transactions. It never
  joins across gaps. Preparation retains every lexical corpus, semantic chunk,
  session, center and neighbor dependency, including contributors outside the
  final 24. A permitted sibling cannot carry a denied contributor's score.
- `prepareSource(rawRef, { intent? }, token)` prepares an authenticated exact
  canonical Raw ref without requiring an independent search hit. The later
  allocator can use this with refs resolved from canonical Memory receipt
  lineage through its existing source adapter. It applies the same policy,
  per-port guards and final ticket contract, and never uses receipt text as Raw.
- `revalidate(handlesOrTickets)` synchronously establishes a fresh final
  canonical snapshot and returns prepared values, or throws the fixed
  `raw_search_unavailable` error without prepared content. `validate` is an alias;
  a handle's `validate()` validates that handle. Run this after all preparation,
  serialization, counters and host awaits, immediately before returning or
  dispatching. No callback or await may follow before that boundary. Call it
  before each source-bearing counter/callback too. All retained dependencies,
  exact identities, currentness, exclusions, actual terminal fences, suppression
  and access bindings are rechecked. A mismatch refuses the whole preparation.
  No stale-envelope survivor filtering is allowed.
  Inventory metadata is read in bounded snapshots; native SQLite change
  detection must prove it unchanged across those reads and at final validation.
  A changed cache key refuses the prepared result. It never substitutes for
  the actual per-source denial checks at protected ports.
- Opaque tickets can be passed back to the same owning service after an IPC/host
  wait; the consumer must request fresh validation there before its dispatch.
  They expire after five seconds, cannot cross service instances/restarts, and
  are bounded to 72 preparations for the typed candidate pool. Search proofs are bounded to four searches
  with the same expiry. Refused/expired handles require fresh preparation.
  This API guarantees engine snapshot linearization. It provides no automatic
  worker/transport hook or atomic wire-send-versus-forget guarantee. A later
  consumer must install and test its own call to `revalidate`.
- `maintain({ maxItems?, maxMs?, embeddings? }, token)` runs one explicit quantum
  under the existing version-1 `maintenanceTurn` broker. No timer/pump is made.
  The host owns scheduling, renewal, supervision and joined disposal. Denial
  reconciliation precedes positive refresh. Each Raw opener and actual provider
  `beforeDispatch` checks canonical denials and access after waits. Embeddings
  use only the selected existing port and shared process budget.
- `status()` and maintenance acknowledgements expose eligible/indexed/embedded
  counts as `null` and coverage as `unknown`, or state `unavailable`. Physical
  stale population, source-bearing checkpoints and provider errors never cross
  this boundary. `purge()` deletes derived rows and vacuums; `close()` joins
  active work and disposes connections. Neither changes canonical data.

Authority follows the existing private-read protocol: synchronous
`authorize(request, token)` / `isCurrent(grant, request)`. Requests bind exact
namespace, `method`, `actionClass: 'read'`, null action/target/revision,
`payloadBinding` and input. Dedicated methods are `rawSearch`, `rawSearchSource`
and `rawSearchMaintenance`. Memory-only grants cannot confer Raw access. Each
protected port checks again after authority callbacks, including callbacks
that throw or return invalid values.

The internal owner-segment backend supports bounded snapshot/search, immutable
staging, compare-and-publish, invalidation, checkpoints, owner drop and close.
Bindings include canonical store/file identity, owner, read-set, tokenizer,
projection, policy, manifests and generation. Index records remain private
hints. Coverage concerns retained eligible evidence, never complete conversation
retention or recapture of skipped gaps. The local backend is plaintext, including vocabulary and vectors. There
is no index export, upload or hosted backend. Main files, rollback journals,
inactive generations and host backups belong to the host's retention/erasure
inventory. Restores never confer source authority and must reconcile before
claiming coverage. Decommissioning requires explicit owner purge. Secure page
or backup erasure is not promised.

Bounds: 256 expanded turns / 50,000 work / 24 final turns; canonical source
batches retain 16 anchors / 64,000 bytes / 1,024 rows. Semantic chunks preserve
code points and exact source offsets, with at most 4,000 UTF-16 units / 8,000
input bytes plus adapter framing. The 512 MiB owner index quota is separate
from Raw retention; the 20,000-vector / 128 MiB resident ceiling is shared.
Missing/partial embeddings yield explicit BM25-only. Sidecar snapshots admit at
most 8 MiB of compact encoded hints before decoding, with separately bounded
fp32 vector BLOBs. Exact refs bind the complete canonical manifest; omitted
manifest hints are refetched canonically. Exhausting either bound reports
partial coverage. Native SQLite changes invalidate the search-eligibility
cache; actual per-port and final source checks remain independent of that cache. Public coverage reports
partial causes with unknown scan/expansion counts. The later allocator owns
Memory-first floor, excerpt counting, coalescing and rendering.
