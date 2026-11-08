# Local Raw search interface

Version: `raw-search-v1`. Raw search is available by default when a host configures
its Raw store. `openRawSearch(options)` is exported from `core/index.mjs`;
`enabled` may be omitted. `{ enabled: false }` (or `false`) is the explicit off
switch and returns `null` before imports, probes, clocks or ports. Omitted store
options also return `null`. Hosts exposing `rawSearch:false` should map that
setting to the off switch.

Configuration requires `version: 'raw-search-v1'`, `backend: 'local'`, canonical
`path`, private `directory`, `ownerId`, `readSet`, `authority` and a `raw-seal-v1`
`crypto` port. Hosted backends refuse. Up to 32 exact namespaces belong to one
owner. These are trusted host options, never tool inputs. Select Raw before
admitting Memory reads; drain reads before changing shared vector ownership.

Two safety requirements apply:

1. Forgotten, suppressed, excluded, session-fenced or otherwise denied Raw text
   is never returned or rendered, even when that message ranks first.
2. Owner and namespace isolation holds before scoring: another owner's or
   namespace's rows never enter the caller's retrieval corpus or results.

Search ranks the caller's published rows using BM25 and semantic retrieval when
vectors are ready. It then walks candidates in rank order, applying the complete
canonical predicate for the requested intent to each candidate and its returned
segments and center. Denied candidates are skipped until the page fills or the
bounded candidate pool runs out. Returned candidates receive a final predicate
check in one fresh canonical snapshot; a newly denied candidate is dropped.
Search performs no full-store canonical census, commitment rebuild or eligibility
memo pass. A stale index remains usable for sources that still pass these checks.

Corpus statistics, ranking competition, session terms and vector readiness may
include ineligible rows from the caller's namespace. Their scores can influence
allowed results. Statistic isolation, an eligible-only corpus, population-wide
commitment validation and retained eligibility progress are not guarantees.
Ineligible text and identifiers are never returned as search hits. Maintenance
may retain commitment checks for publishing; search does not depend on them.

The handle provides the following unchanged methods and result fields:

- `search({query, intent?, queryVector?}, token)` returns
  `{version, publication, candidates, coverage, semantic}`. Intent defaults to
  `current`; `history` also permits known historical lineage. At most 24 candidates
  contain `{id, namespace, conversationId, messageId, ordinal, role, occurredAt,
  ranges, score, centerId, neighbor, currentness, classification,
  rangeClassifications, publication, proof}` with no prose. Each range is an
  authenticated canonical Raw ref. Do not modify candidates.
- `classify(candidate, {intent?}, token)` rechecks that candidate's canonical
  sources. Denied, stale or foreign candidates return only
  `{kind:'denied', reason:'source-or-authority-unavailable'}`.
- `prepare(candidate, {intent?}, token)` returns a private handle
  `{value, ticket, validate()}`. Value contains source metadata, classification
  and separate `{source, text, classification}` ranges opened from canonical
  sealed parts. No gap is joined. Only that candidate's direct source and center
  dependencies are retained; unrelated corpus rows cannot invalidate a preparation.
  Preparation uses retained authenticated refs and a publication header check,
  without decoding the entire ranking index again for each hit.
- `prepareSource(rawRef, {intent?}, token)` prepares an exact authenticated Raw
  ref without an independent index hit. Memory source expansion can use it with
  canonical receipt lineage; receipt text never substitutes for Raw.
- `revalidate(handlesOrTickets)` synchronously checks prepared values in a fresh
  final canonical snapshot, returning values or throwing `raw_search_unavailable`.
  `validate` is an alias. Call after all preparation, counters, serialization and
  host awaits, immediately before delivery, and before source-bearing callbacks.
  No callback or await may follow that boundary. A mismatch refuses the preparation.
- `maintain({maxItems?, maxMs?, embeddings?}, token)` runs one bounded quantum
  under the existing version-1 `maintenanceTurn` broker. The host owns scheduling,
  supervision and joined disposal; no indexing timer or pump is created. Denial
  reconciliation precedes positive refresh. Canonical denials and access are
  checked at Raw openers and provider `beforeDispatch`, including after waits.
- `status()` and maintenance acknowledgements expose eligible/indexed/embedded
  counts as `null`, coverage as `unknown`, and fixed errors. `purge()` deletes
  derived owner rows and vacuums. `close()` joins active work and disposes connections.

Classifications are `{kind, reason}`: `denied`, `current-eligible-bare`,
`current-eligible-linked` or `history-only`. Engine-interpreted bare Raw has complete
privacy ancestry and no Memory link. Host registration instead uses reason
`host-session-ancestry`: the engine cannot see which Memories derive from the
message, and the host must fence every source session before acknowledging any
Memory forget or correction, on every forget path. Do not enable host Raw search
for an owner until that fencing is live. See the
[host registration contract](raw-layer-contract.md#host-interpreted-registration-addendum).
Render bare Raw as attributed past conversation evidence whose currentness is
unknown. Retired links, current/history overlaps and unresolved
linked currentness are history-only. Missing privacy ancestry denies both intents.
Each range retains its own classification. Exclusions and terminal session fences
deny both intents. Canonical manifest refs bind immutable message/part content;
unrelated captures or suppression facts do not invalidate allowed sources.

Each search has a 1,000 ms operation deadline. Expiry or exhausted canonical busy
backoff returns the constant unavailable partial below. Native statement and row
boundaries check deadlines; interrupted operations release snapshots and vectors.
The next search can use the same connection. No canonical snapshot spans an await
or backoff. Synchronous ticket validation has bounded snapshot-free busy backoff.

```json
{"version":"raw-search-v1","publication":null,"candidates":[],"coverage":{"status":"partial","scanned":null,"expanded":null,"causes":["deadline"]},"semantic":{"state":"unknown","reason":null}}
```

Render this as incomplete and unavailable, never a successful search with no
matches. Coverage describes the bounded published snapshot, not complete Raw
retention or a fresh canonical inventory. Scan and expansion counts remain unknown.

Authority uses synchronous `authorize(request, token)` / `isCurrent(grant, request)`
with exact namespace, method, `actionClass:'read'`, null action/target/revision,
payload binding and input. Dedicated methods are `rawSearch`, `rawSearchSource`
and `rawSearchMaintenance`. Memory-only grants do not confer Raw access. Protected
ports check after authority callbacks. Prepared tickets expire after five seconds,
are service-local and bounded to 72 preparations; search proofs retain four searches.
Restart refuses old tickets. Consumers must install their own final dispatch
validation; there is no atomic wire-send-versus-forget guarantee.

Bounds remain 256 expanded turns, 50,000 work, 24 returned turns, 16 source anchors,
64,000 source bytes and 1,024 source rows. Chunks preserve code points and exact
source offsets, at most 4,000 UTF-16 units / 8,000 input bytes plus adapter framing.
The 512 MiB owner index quota is separate from Raw retention. Snapshots admit at
most 8 MiB compact hints and 128 MiB fp32 vector BLOBs. Missing or partial vectors
yield explicit BM25-only retrieval. Raw and Memory share 20,000 resident vectors
and 128 MiB including conservative hint and block-index overhead.

Local embedding policy may retain immutable signed hints and verified vector
blocks keyed by store/file, owner/read set, sidecar generation/publication/revision
and provider identity. Canonical writes do not invalidate this ranking cache;
every returned source still receives current canonical predicates. Its one-second
cadence drops changed publications or unavailable keys; five idle seconds drops
unused data. Timers are unreferenced and cancelled on close/purge. Borrowed blocks
retain their reservation until the operation settles. Other embedding policies
retain no cache. No source prose, opening or authority is cached.

The local sidecar is plaintext: vocabulary, metadata and vectors, including its
journals and host backups. There is no export, upload or hosted backend. Bindings
include canonical store/file identity, one owner and exact read set. Changing a
read set requires explicit rebuild. Hosts own inactive generations, restore
reconciliation and decommissioning purge; secure page or backup erasure is not
promised. The backend uses private POSIX paths and authenticated format-3 schema
and file seals; incompatible sidecars refuse attachment without mutation.
