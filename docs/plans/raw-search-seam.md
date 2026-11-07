# Local Raw search seam

`openRawSearch` is the only new export from `core/index.mjs`. Its asynchronous
factory and complete handle contract are frozen in
[raw-search-interface.md](raw-search-interface.md). Existing engine constructors,
methods, options, results, errors, capabilities, tool schemas and transports
retain their signatures. No new context representation or output is installed.

Absent selection and `{ enabled: false }` return `null` before configuration,
SQLite imports, clocks, ports, files or maintenance. Existing constructors do
not call the factory. No canonical schema, trigger, capture callback, outbox or
privacy-mutation statement was added. A separately selected maintainer is an
on-path service even when context reads remain disabled.

The local service accepts the existing private-read authority protocol with
dedicated Raw methods, the existing Raw opening port, and the existing
maintenance-turn broker protocol. Broker requests use the lexical family and
`pumpId: 'raw-search'`. Hosts must include this lane in their existing physical
store cadence/fairness authority. There is no additional index timer or pump. Calls
are explicit, bounded and joined by `close`; public status exposes unknown counts and fixed errors; internal maintenance
state tracks actual progress and retries. The host owns recurring supervision.

Memory's internal semantic cache participates in the shared vector residency
ceiling only while a Raw service is selected in the same process. This can
degrade a selected semantic channel to partial coverage when the joint limit is
reached. The old unselected branch uses its existing cache path. Process-local
embedding request/concurrency/spend accounting is shared by exact provider
identity; it is not durable owner accounting across processes.
Select the Raw service before admitting Memory reads. A host changing this
selection must first drain existing Memory reads and their preflight caches;
caches created while Raw was unselected retain their legacy ownership until
released. No off-path registry is introduced to retroactively seize them.

The local path does not call product-profile workers, coordinators, pumps or
the durable hosted semantic ledger. Those modules and their public signatures
are unchanged. A hosted Raw backend is unavailable and fails closed; durable
hosted accounting and sealed segments remain reserved behind the owner segment
interface. A local host may explicitly select an existing remote embedding
port, with the existing shared process budget and its normal disclosure duties.
No remote fallback, model download or key custody is added.

The sidecar is plaintext. It reveals vocabulary, frequencies, source metadata
and vectors through its database, journal and backups. It is scoped to one
canonical store/file identity, owner and exact read set. It stores no source
prose or durable excerpt/provider job. `purge` removes derived rows and vacuums
the file; it does not erase canonical Raw or promise secure page/backup erasure.
The host must inventory and remove inactive owner files and backup copies when
decommissioning the feature. Restart reconciles durable canonical denials;
physical cleanup cannot run while every service is stopped. Canonical delivery
checks do not wait for cleanup.
The local backend requires POSIX absolute paths and private owner/mode checks;
other platforms have not been qualified.
The host supplies one managed index directory per owner. Within that directory
there is one active file per canonical store/file and owner; selecting a
different read set refuses the existing binding and requires an explicit
rebuild, instead of allocating a second full quota.

Canonical inventory hashing uses keyset pages of at most 32 metadata rows per
read snapshot, with serialization outside those snapshots. SQLite's native
`data_version` on the permanently read-only connection must stay unchanged
throughout a build. It invalidates the in-memory inventory and search-eligibility caches for every
other-writer commit, including direct facts with no application epoch change.
That connection-local cache key is never a durable publication authority.
Final validation compares the complete source commitment inside the fresh
canonical snapshot. It binds canonical part metadata/bytes, maps, exclusions,
session fences, receipt text and integrity, Memory eligibility, all inbound
ancestry edges and their endpoints' own scopes, suppression facts and schema
identity. Each proof retains its original message population; unrelated appended
messages leave those source inputs unchanged. Fresh inventory still observes
new messages. Every delivered range, coalesced sibling, centre and neighbouring
source feeding a returned candidate also receives the full predicate there.
Population-wide corpus statistics, ranking competition, semantic readiness and
coverage rely on that complete commitment and the snapshot's eligible set. If
the inventory bound prevents it, full dependency predicates remain mandatory
and coverage is partial. Protected openers and document
provider dispatches still read actual denial facts independently. Concurrent
source movement discards a maintenance quantum and leaves the next host turn
available; it does not mark maintenance permanently failed. Inventory descriptions
use one source per canonical snapshot; maintenance prepares at most four sources
per quantum. The selected canonical connection uses a zero busy timeout. A
pending writer causes a 25 ms read backoff and a deferred host turn, rather than
a permanently failed maintenance lane. No provider call retains a canonical or
sidecar transaction or a broker grant.

Exclusions, correction and forgetting deny current and history. Search also
withholds terminally fenced sessions in both intents. Known historical lineage
is history-only, including overlapping current/historical bindings. Demonstrably bare
Raw is current-eligible as attributed unknown-currentness evidence. Missing
privacy ancestry denies both intents; unresolved linked currentness is history-only. An exclusion intersecting a retained part conservatively
omits that part; disjoint retained parts remain independently eligible. Existing
inspection readers keep their own behavior and bounds.

This seam contains no Card authority, automatic Card work, Memory-first floor,
context allocator or authored-lineage claim. A later allocator must preserve its
Memory floor, apply aggregate opening/counting limits, retain prepared handles,
and call `revalidate` after all callbacks immediately before delivery, and before
each source-bearing counter or callback. Tickets expire after five seconds and
are service-local; restart refuses old tickets. A later worker/transport must
call this entry point at its own dispatch boundary. Only engine-snapshot
semantics are advertised here. It must
treat an unavailable Raw channel as optional and preserve the Memory result.

No online export or hosted upload is installed. Sidecar main files, rollback
journals, inactive generations and host backups fall under existing retention/
erasure and non-serving restore policy. Stale generations cannot grant source
authority. Explicit owner purge is required on decommissioning. Capture-only
controls, including local automatic-capture disable and notice withdrawal, do
not delete earlier saved ranges or authorize recapture of skipped gaps.

The existing public `contextRead` and semantic refresh/status paths constructed
through `openContextReader` or `openMemoryCore` retain their request and response
signatures. While a Raw service participates in the same process, their
semantic preflight can report partial coverage when the shared vector ceiling
is exhausted. When no Raw service participates, the existing branch is used.
The product worker has its own existing cache path and is unchanged.

Bounded sidecar snapshots admit at most 8 MiB of encoded hints before decoding.
Compact tuples retain exact source refs and a binding to the complete canonical
manifest; repeated manifest fields are refetched from canonical storage instead
of duplicated in each hint. Vectors are authenticated fp32 BLOBs outside that
hint allowance, bounded by 128 MiB. Semantic scans load contiguous typed-array
blocks, then score without per-vector objects or JSON decoding. The shared
20,000-vector / 128 MiB residency reservation still applies; insufficient or
incomplete coverage is explicitly BM25-only. The main-file page cap reserves
rollback-journal space within the owner quota.

The internal sidecar format is version 3. Opening authenticates its schema and
file-bound integrity seal with the shared sidecar attestation helpers. Each
logical write updates the seal in its transaction; vacuum retains that seal.
Older unsealed DELETE caches and other incompatible sidecars refuse attachment
without mutation; the host must explicitly replace them. This avoids an
unbounded reset or whole-file scan during opening. Canonical storage is never
migrated by this service.
Factory opening has one 1,000 ms deadline across the canonical and sidecar
connections, checked before native statements. Reads also check their original
operation deadline before prepared and reused sidecar statements. Rollback and
disposal remain available after expiry. Raw maintenance requests work turns;
the product pump's optional admission capacity does not extend its quantum.

The selected handle also exposes `prepareSource` for an authenticated exact Raw
ref resolved by the allocator from canonical Memory lineage. It permits Memory
source expansion without an independent index hit. It uses the same source
authority and ticket revalidation, and adds no legacy constructor method.

The general core entry already loads SQLite and also evaluates the Raw
implementation modules to preserve the installed module inventory. Their
evaluation defines functions only and performs no probes, statements, clocks,
ports or scheduling. The directly imported Raw factory retains its deferred
SQLite dependencies and disabled selection returns before loading them.

Only a reader selecting the local embedding policy owns a verified vector/hint
cache. Its one-second invalidation timer performs no indexing, provider calls
or canonical writes. It runs without host maintenance calls, drops on any
unavailable/key-changed authority, expires after five idle seconds at the next
tick, and is cancelled on close/purge. Each reader has its own owner-bound
cache, including readers in a Worker; forced termination discards its blocks.
No cache is persisted, shared between owners, or transferred across restart.

Cache keys read all canonical suppression, exclusion and session-fence facts in
one snapshot. The final canonical delivery snapshot repeats that key read as
well as existing source validation. Generation/publication and native sidecar
revision are checked on each search; warm coverage is freshly read independently
of cache residency. No public signature, status field, diagnostic, coverage
counter or error changes according to cache state. Privacy mutations gain no
statements or synchronous purge. The shared byte reservation includes fp32
payload, conservatively reserved hints and block indexing. Existing reads can
therefore report semantic partial coverage while a selected local reader holds
a reservation; readers with other embedding policies retain no such cache.
