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
- A search whose commitment cannot be confirmed within its deadline returns
  this exact constant result, including after its bounded version retry or
  exhausted canonical busy backoff:

  ```json
  {"version":"raw-search-v1","publication":null,"candidates":[],"coverage":{"status":"partial","scanned":null,"expanded":null,"causes":["deadline"]},"semantic":{"state":"unknown","reason":null}}
  ```

  The single owner-neutral cause also covers contention and version movement;
  it never identifies another owner's write. No count, identity, score, hint,
  proof or ticket comes from interrupted work. Nothing from a torn or interrupted rebuild is admitted. Vector reservations
  from interrupted searches are released. A complete rebuild verified at both
  ends may retain its commitment after a later deadline, and eligibility checks
  may remain reusable after their bounded unit verifies an unchanged version.
  Both are keyed by the canonical version and invalidated before reuse after
  any commit, including a forget or suppression. A version retry starts the
  rebuild from zero.
  Consumers must render this as incomplete and count it as unavailable, never
  as a successful search with no matches. When the source population bound
  instead prevents a commitment, the existing full dependency validation path
  may still return declared partial candidates within the same deadline.
  Earlier tickets still require confirmation and refuse if it cannot finish.
  Synchronous ticket validation may spend one bounded, snapshot-free busy
  backoff before refusing. No read snapshot spans an await or a backoff.
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
  Delivered ranges, coalesced siblings, centres and neighbours feeding returned
  candidates rerun the full canonical predicate in that final snapshot.
  Corpus size, lengths and document frequencies, ranking competition, semantic
  readiness and coverage use the snapshot's eligible set and a complete source
  commitment. That commitment binds receipt text/integrity, all inbound ancestry
  edges and each endpoint's own owner/namespace, including unresolved endpoints.
  Its comparison precedes release of any row, score, hint or status. When the
  inventory bound prevents a commitment, all dependencies receive full predicates
  and coverage remains declared partial.
  No stale-envelope survivor filtering is allowed.
  Inventory metadata is read in bounded snapshots; native SQLite change
  detection must prove it unchanged across those reads and at final validation.
  A retained proof keeps its original message population, so unrelated appended
  messages do not invalidate it. A fresh search observes the new inventory.
  A changed cache key refuses that search result. It never substitutes for
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
  under the existing version-1 `maintenanceTurn` broker. No index timer/pump is made.
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

A reader with the selected `local` embedding policy privately retains verified
fp32 blocks and bounded decoded hints. Other policies never retain this cache.
It supplies ranking hints only; exact canonical delivery and protected dispatch
validation remain mandatory. The key binds owner/read set, sidecar generation
and publication, native sidecar revision, full provider/model identity, owner
suppression epoch, namespace exclusion clocks and scoped session-fence digests.
All canonical components are read together in one snapshot and compared again
inside the final delivery snapshot. Native canonical changes also invalidate it.
Coverage is read freshly from the sidecar, and status, diagnostics and errors
contain no cache state. The cache never holds source prose or supplies openings.

The private cache rechecks its key every second, on the existing maintenance
cadence, including while searches and host maintenance calls are idle. A failed
check drops it. Five seconds without use also drops it at the next cadence tick;
close and purge drop it immediately. Timers are unreferenced and cancelled on
disposal. The bound is subject to the running reader's event-loop scheduling;
a terminated Worker owns no surviving blocks. A borrow already in an operation
keeps its shared reservation until that operation settles. Blocks are never
handed to another reader or successor. There is no cache persistence or privacy
mutation callback. Encoded hint overhead (reserved at four times its size) and
block indexing share the 128 MiB ceiling with fp32 vectors and Memory; the joint
vector count remains 20,000. Admission failure leaves the operation uncached.
