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
Until the local index has caught up with newly saved conversations, search reports
partial coverage.

Coverage is `complete` only when ranking stays within its limits and the published
checkpoint proves a completed inventory cycle at the current canonical fence.
Search reuses that fence only while its cached store version is current; a missing
or stale cached fence conservatively reports `partial` without rebuilding it.
The fixed cause `index_incomplete` indicates that this inventory proof is missing;
it contains no counts, identifiers or source text. Validated hits found so far are
still returned, and context reads retain that evidence with Raw coverage `partial`.
Existing causes remain `work_limit`, `turn_limit`, `partial_turn`, `inventory_limit`,
`snapshot_byte_limit`, `vector_byte_limit` and `deadline`. Partial coverage must
never be interpreted as proof that no matching saved source exists.

Recent saves have an independent journal lane before full inventory proof or
embedding work. Each recent turn examines at most 64 physical discovery/drain
headers and attempts at most four saved part keys. Row positions are decimal
strings with HMAC identity anchors bound to the store, file and read set. A
signed checkpoint commits cursor offsets together with publications. Save
transactions gain no SQL, schema objects or synchronous indexing. The journal is
a discovery hint; every recent source receives live admission, guarded canonical
opening and final source-scoped batch validation. Unrelated appends do not
invalidate that batch. One of every four busy admitted turns is reserved for
independent denial cleanup and full reconciliation; unused recent turns also
serve background work. Provider waits do not block the recent lexical lane.

Namespace pause or disable refuses publication, search, opening and final
validation. Cleanup and inventory retain an existing publication when pause is
its only refusal, so resume restores visibility without a full walk. Forgotten,
excluded, fenced, suppressed and deleted sources are still removed during pause.
Turning off future automatic capture alone retains readable saved prefixes.

Search reads one authenticated sidecar transaction: up to 256 newest
publications, capped at 4 MiB of hints, followed by ordinary oldest-first rows.
The union is deduplicated and shares the existing 8 MiB hint, 128 MiB vector and
50,000-row limits. Cache shape uses the identical selection policy. Recent rows
receive visibility without a ranking boost. They can age out of the recent
window and fall outside the ordinary slice; large hints can end visibility even
sooner. These limits and incomplete reconciliation continue to report `partial`.

Anchor loss, identity mismatch, a regressed tip or incompatible cursor starts
recovery from at most 64 newest physical journal headers. Live arrivals take
priority. Sources older than that tail rely on the full walk, which has no
eventual guarantee while saves continue. This weaker recovery guarantee is
separate from normal live-feed service. Direct parts-only writes also rely on
full reconciliation. On a stable store with a sustained recent backlog, cleanup
revisits may take approximately four times as many admitted turns; empty recent
turns can improve that rate. Deadlines, contention and host admission make this
conditional, not a time bound.

Before manual canonical VACUUM, an in-place restore, explicit-rowid imports or
other journal rewrites, stop readers and maintenance and discard the derived
Raw search sidecar using the host's owner purge, then reopen to bootstrap the
newest tail and rebuild. Purge clears the signed checkpoint and publications;
canonical data and permanent denials remain. Anchor checks alone cannot detect
every in-place rewrite that preserves a surviving identity. No new DDL, sidecar
format or canonical migration is introduced. Older supported engines may ignore
the new checkpoint fields and keep their original freshness and source-control
semantics; reopening validates continuity again. Existing older-engine layout
restrictions still apply.

“About a minute” is an operational target requiring a supervised host, admitted
recent turns, bounded aggregate journal traffic and available crypto, storage and
quota. This mechanism is not a measured latency promise. At 50k or more parts
there is no finite full-reconciliation guarantee. Save and read latency under
contention, including the host's service interval, must be requalified before
advertising the target; that measurement is separate from this implementation.

Corpus statistics, ranking competition, session terms and vector readiness may
include ineligible rows from the caller's namespace. Their scores can influence
allowed results. Statistic isolation, an eligible-only corpus, population-wide
commitment validation and retained eligibility progress are not guarantees.
Ineligible text and identifiers are never returned as search hits. Maintenance
retains commitment checks for publishing; search uses only a current cached
fence to certify complete inventory coverage.

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
  supervision and joined disposal; no indexing timer or pump is created. Recent
  lexical work precedes reserved reconciliation and optional embedding refresh.
  Canonical denials and access are checked at Raw openers and provider
  `beforeDispatch`, including after waits.
- `status()` and maintenance acknowledgements expose eligible/indexed/embedded
  counts as `null`, coverage as `unknown`, and fixed errors. `purge()` deletes
  derived owner rows and vacuums. `close()` joins active work and disposes connections.

Classifications are `{kind, reason}`: `denied`, `current-eligible-bare`,
`current-eligible-linked` or `history-only`. Both `classification.kind` and
`classification.reason` are diagnostics, not privacy or fencing signals.
Engine-only bare Raw has complete engine privacy ancestry and no Memory link.
An unmapped host source can instead report `host-session-ancestry`: the engine
cannot see which Memories derive from the message. A session that mixes host and
engine modes can report an engine reason, including `complete-privacy-no-memory-link`,
after a later engine capture creates maps for a host-archived message. Bare kind
or an engine reason does not prove complete privacy ancestry for any session ever
archived through `captureRaw` in host mode.

The host's fencing obligation covers every session it has ever archived through
`captureRaw` in host mode, whatever kind or reason a later search reports.
Before acknowledging any Memory forget or correction, fence every source session,
on every forget path. Do not enable host Raw search for an owner until that
fencing is live. See the
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
