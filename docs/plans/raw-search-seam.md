# Local Raw search seam

The trusted `openRawSearch` API is described in
[raw-search-interface.md](raw-search-interface.md). A configured Raw store enables
search by default; `enabled:false` explicitly disables the service. Hosts may
expose that as `rawSearch:false`. No store configuration returns `null`.

Retrieval ranks published rows only within the caller's owner and exact read set.
BM25 and ready semantic vectors may include ineligible rows in corpus statistics.
Candidates and their direct segments/centers receive the complete current
canonical predicate in rank order. Denied candidates are skipped to fill the page.
Final validation checks returned candidates in a fresh canonical snapshot and
drops newly denied hits. Search has no full-store commitment rebuild, canonical
version census or retained eligibility memo. Maintenance retains its own bounded
publication checks and denial reconciliation.

The two safety requirements are that forgotten, suppressed, excluded, fenced or
otherwise denied text never reaches results or rendering, and that owners and
namespaces remain isolated before scoring. Eligible-only statistics and ranking
competition are no longer promised. Allowed scores can reflect denied rows in
the same namespace; those rows provide no returned text or identity.

Exact refs authenticate canonical message/part manifests. Preparation retains the
candidate's direct sources and center, opens canonical sealed parts, and rechecks
denials at protected ports. Final ticket validation checks fresh facts and current
ancestry after all host callbacks. An unrelated capture or suppression fact does
not invalidate allowed sources. Missing privacy ancestry denies both intents;
known historical lineage requires history intent. Bare sources remain attributed
past evidence with unknown currentness.

Search deadlines stay at 1,000 ms and return the fixed `reason:'deadline'` partial
shape documented by the interface. Expiry releases snapshots and reservations;
the same connection remains available to subsequent operations. No SQLite snapshot
spans an await, provider call or busy backoff. The host owns explicit maintenance
scheduling, supervision and joined disposal under the existing maintenance broker.

The local cache contains signed immutable hints and verified fp32 blocks, keyed
by owner/read set, publication/revision and provider metadata. It does not cache
canonical eligibility. Its cadence handles publication invalidation and idle
expiry; returned sources are independently checked against current canonical
state on every search. Raw and Memory share resident vector and byte limits.

The format-3 sidecar remains private plaintext with authenticated schema and
file-bound seals. Vocabulary and vectors can remain in journals, inactive files
and backups. Hosts own retention, restore reconciliation and explicit owner purge.
There is no hosted backend, upload, export or secure-erasure promise. No canonical
schema, capture callback or privacy mutation statement is introduced by search.

Public `search`, `prepare`, `classify`, `maintain` input and output shapes remain
stable. The allocator owns Memory floors, aggregate opening/counting limits and
rendering, and must call `revalidate` immediately before its delivery boundary.
There is no automatic transport hook or atomic wire-send-versus-forget guarantee.
