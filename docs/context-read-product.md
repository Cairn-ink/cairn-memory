# Product adapter: P2a–P2e

Select `profile:'context-read-product-v1.1'` and `version:'context-read-v1'`
with `openContextProductReader` from the core entry. P2a releases capabilities
and canonical exact evidence fetch for DELETE stores: Memories on physical
v18/v20–v33 and Cards on v23–v33. P2b adds lexical candidates,
representation-v2 assembly, index status and explicit service maintenance.
P2c extends that path to one owner with up to 32 selected namespaces: at most
one personal namespace and 31 projects. Reader requests use certified product
indexes only. Defaults remain lexical and construct no provider. P2e adds
explicit hosted semantic configuration, described below. P2d adds explicitly opted-in WAL handling for the same owner-wide
selection, subject to deployment qualification below. The legacy profile and
sidecar remain unchanged.

The product authenticates and resolves ACLs before opening. It supplies:

- A process/service-owned `createContextReadSupervisor()` before any open.
- The canonical `path`, fixed `readSet` and complete `ownerCoverage` descriptor.
- Trusted `requestControl:{requestId,handleId,credentialBindingId,
  credentialExpiresUtcMs,requestMaxMs}`. The three identifiers must be freshly
  minted unguessable ASCII strings of at most 64 bytes. Actual authenticated
  expiry is a UTC millisecond integer, or `null` for no independent expiry.
  Request duration is 1–5,000 ms. The parent stamps admission and converts
  expiry once; opening and every call consume this same window.
- One bounded opaque own-data credential, passed separately to each read/status call.
- A local-file `host:{moduleUrl,configuration}`. Its module exports
  `createContextReadHost(configuration)`, returning synchronous
  `authorize(request,credential)` and `isCurrent(grant,request)` functions.
  These functions run in the engine Worker. `isCurrent` returns literal `true`
  only when published credential-revocation/erasure state is current and any
  configured ownerGeneration still equals the issued value. Unknown,
  asynchronous or throwing checks fail closed. Authentication never runs here.
- An optional disconnect `AbortSignal` in the separate `{signal}` argument
  to opening and calls. `diagnostics:true` selects supervisor-only native
  telemetry. Opening `deadlineMs` defaults to 5,000; fetch defaults to 1,000.

The trusted configuration also supplies `requestReservation`, one fresh fixed
four-byte SharedArrayBuffer initialized to zero for this issuance. The parent
atomically consumes it once. Its backing storage must remain bound to these
request/handle/credential IDs in trusted issuance state; clones share it. Never
reset it or replace it to retry the same issuance. This prevents replay after
the bounded registry has forgotten completed IDs, including null-expiry
credentials. Missing/already consumed reservations refuse `authority_required`.

The engine's concrete trusted issuance handoff is
`configuration.requestBinding`:

```js
{
  kind: 'request', requestId, handleId, credentialBindingId,
  credentialExpiresUtcMs,
  credentialDigest, // base64url SHA-256 of canonical own-data credential JSON
  ownerId, namespaces: { readSet, ownerCoverage }, issuedAt,
  // ownerGeneration: positive safe integer, only when configured
}
```

Canonical credential JSON recursively sorts object keys by UTF-8 bytes and
preserves array order. `credentialDigest` is available internally from
`core/context-product-control.mjs` for adapter wiring. Keep this configuration,
the credential and requestControl out of model fields, public diagnostics and
logs. The parent checks issuance IDs, expiry, selected mapping and credential
digest before dispatch; it consumes the request/handle reservation once.
A `kind:'service'` issuance cannot open this reader. Service maintenance uses the separate issuance below.

`authorize` must verify its trusted issuance state, allowed method and **entire**
`request.input`, including fetch fences/deadline, before returning the exact
requestBinding as its method grant. The request also includes owner/namespaces,
the parent-stamped requestControl and credentialBindingId. Returning a snapshot
without verifying the complete operation binding is not a valid adapter.
Additional trusted configuration can carry bounded SharedArrayBuffers for
Worker-local publication checks. No raw bearer or function crosses IPC.

If bootstrap acquires outer resource attribution or independent child/provider
capacity, register its disposer **before acquisition** with the injected
`configuration.resourceOwner.register('lease'|'provider', disposer)`. This is
resource accounting, not an authority lease. Disposers must be idempotent and
resolve only after actual release. They run even when host construction throws;
unconfirmed release keeps a process-wide failed quarantine. Optional
`host.close()` is registered as outer attribution and runs on graceful shutdown. Native Worker termination alone
cannot release registered external attribution.

```js
const supervisor = createContextReadSupervisor(); // service-owned
let reader;
try {
  reader = await openContextProductReader({
    supervisor, path, version: 'context-read-v1',
    profile: 'context-read-product-v1.1', readSet, ownerCoverage,
    requestControl, host: { moduleUrl, configuration }, diagnostics: true
  }, { signal });
  const capabilities = await reader.getContextReadCapabilities();
  const evidence = await reader.fetchCandidateEvidence({
    readSet, refs, intent: 'current', deadlineMs: 1000
  }, requestCredential, { signal });
  // evidence is {ok:true,value:{items,snapshot}} or a sanitized error envelope.
} catch (error) {
  if (error.cleanupId) await supervisor.drain(error.cleanupId);
  throw error;
} finally {
  await reader?.close();
}
// On service shutdown, also covers constructors that returned no handle:
await supervisor.close();
```

Fetch accepts full refs with optional aligned internal fences, or a host-only
snapshot, under the existing mutual exclusions and exact evidence semantics.
Snapshots bind the product profile and stable owner generation rather than a
request credential; a fresh authenticated request may refetch them. Compact tool
refs must first be expanded against the product's immutable namespace mapping.

## Owner-wide selection and coverage

This selection and coverage contract also applies with the [WAL deployment
opt-in](#explicit-wal-deployment-opt-in); WAL support does not establish qualification.

Authenticate and apply workspace ACLs before selecting scopes. The engine
accepts a nonempty project-only or personal-only subset, or personal plus up to
31 projects. Namespaces use the existing owner/project identifier rules. Raw
selected lists over 32, duplicates, mixed owners, more than 31 projects, sparse
arrays, accessors and unknown fields refuse `invalid_read_set` before storage.
The engine does not discover an owner's inventory.

For authorized inventories larger than the bound, use `recent-projects-v1`:
retain requested authorized personal scope, then select at most 31 projects by
descending host `lastActiveAt`, breaking ties by ascending UTF-8 project ID
bytes. Missing activity is 0. Activity must be a nonnegative safe-integer UTC
epoch millisecond value; explicit null/undefined, fractions and unsafe values
are invalid. The host supplies the metadata source and a frozen inventory /
activity snapshot revision; no content/index scan infers activity. Denied
projects do not enter requested or omitted counts.

The exported pure host utility `selectContextProductNamespaces` implements
this rule. Run it in host background work or a host Worker after ACL filtering;
HTTP admission consumes its cached bounded result. It scans the supplied
inventory and retains only 31 project winners. For a very large inventory, a
bounded indexed metadata query implementing the same ordering is also suitable.
Neither reader startup nor the pump enumerates inventory for the host.

```js
const { readSet, ownerCoverage } = selectContextProductNamespaces([
  { namespace: { ownerId, scope: 'personal', projectId: null } },
  { namespace: { ownerId, scope: 'project', projectId: 'a' }, lastActiveAt: activityA },
  { namespace: { ownerId, scope: 'project', projectId: 'b' } } // missing = 0
], inventoryRevision);
```

The exact trusted constructor field is:

```js
ownerCoverage: {
  policy: 'recent-projects-v1', selectionRevision,
  requestedNamespaces, selectedNamespaces, omittedNamespaces
}
```

`selectionRevision` is a nonempty well-formed string of at most 200 UTF-16
units. Counts are nonnegative safe integers: selected equals `readSet.length`,
requested equals selected plus omitted, and requested is at least one.
Nonzero omitted counts require 31 selected projects. The host verifies that
the set really includes requested personal scope and the first 31 authorized
projects; the engine checks consistency without excluded IDs/statistics. Bind
this exact descriptor into both request and service issuance. It is never a
model/tool input.

The fixed mapping sorts full namespace keys by UTF-8 bytes, preserving existing
one/two-namespace indices. Recency chooses membership; it gives no ranking
priority. Ranking pools every eligible selected Memory/Card for the exact
types/intent into one N, df and token-length universe, then uses frozen T1/BM25
and the existing fusion family. There is no per-namespace quota or top-k before
global ranking. Equal bodies retain distinct typed identities. Permuting the
readSet changes neither indices nor ranks. Semantic stays disabled, including
`semantic:true`; all product calls make zero provider calls in P2c.

When omitted is nonzero, ready candidate coverage is `partial` and its trace
includes exactly `namespaceSelection:{...ownerCoverage}`. Assembly reports the
same fields under `diagnostics.candidates.coverage` and
`diagnostics.candidates.trace`, outside metered text. Lifecycle coverage always
reports the descriptor in `coverage.namespaces`; ready status is partial on
overflow. An empty selected-projection match remains partial for the owner.
Missing/incomplete/stale projections remain unavailable even on overflow;
scope partial coverage never permits searching incomplete lexical statistics.
Every `unavailable` lexical status has a closed reason: `wrong_store`, `incompatible`, `corrupt`, `validation_missing`, `validation_invalid` or `storage_unavailable`; unrecognized storage failures use `storage_unavailable`, and progress is null.
Evidence keeps exactly `{items,snapshot}`; the product carries the selection
descriptor/partial status separately in HTTP/tool metadata outside model text.

A different selection needs a fresh handle and compact-ref mapping and an
explicitly maintained matching projection. Passing another well-formed set to
a live handle refuses `invalid_read_set`. Until its projection is certified,
the new handle returns `index_unavailable`; the product's reauthenticated
fallback is partial. Issuance IDs, activity and selectionRevision never enter
lexical statistics identity. A new revision with the same normalized selected
set can reuse its certificate, while exposing its new bound coverage descriptor.

## Authority sampling and cleanup

Every authority-bearing fetch takes one entry sample and one final sample
immediately before its authoritative canonical read. No authority callback
follows that read. A changed final sample returns bare `scope_changed`; a change
published later may still allow completion before the original cutoff. The
internal final-envelope guard also protects future data-bearing diagnostic
errors. Search and assembly diagnostic errors also take their final sample before
constructing a data-bearing error envelope. Status and maintenance take their
final sample immediately before a fresh canonical read transaction.

Opening operational failures reject with sanitized `code` and `cleanupId`;
validation errors create no Worker. Fetch/capabilities return Promise envelopes.
Timeout/cancellation settles independently of cleanup; late data is discarded.
Await close in the request's finally block and drain the supervisor on shutdown.
Do not treat timeout as proof of disposal or as fallback authority.

`getCleanupStatus(id)` returns the frozen contract metadata. `drain(id)` returns
that final metadata plus `diagnostics`; `drain()` snapshots cleanup records,
including completed operations, without stopping healthy handles. Concurrent
drains share one delivery promise. Record/export diagnostics promptly, then
`ackCleanup(id)` to release completed history. Unknown/expired IDs are
`invalid_input`, never evidence of zero native failures. Process-wide limits are
256 live records, 1,024 completed records, 1 MiB completed metadata, 16 MiB
completed diagnostics and a nonrenewing five-minute history lifetime. Pending
and failed safety records never expire. A new supervisor cannot bypass them.

Before erasure/restore, stop clients and new admissions, publish denial and drain
all owned resources. Restore invalidates old request bindings. The product owns
this integration and any separately reauthenticated fallback. Real +50 ms
settlement and deployment latency gates require the opt-in qualification runs;
ordinary tests use mock clocks and rendezvous.

## Optional engine-only reader prewarming

A service may opt in once at trusted startup:

```js
const pool = createContextReaderPool(); // service-owned, shared across requests
const supervisor = createContextReadSupervisor({ readerWorkerPool: pool }); // per request
await supervisor.close(); // settles this request; keeps the service pool warm
await pool.close(); // service shutdown, after stopping admission
```

This is an **interface change for adopters**. The service, not the request, owns
the pool. The public factory takes no options and returns a frozen handle with
only `close()`. Select it in trusted service construction, never from HTTP input
or reader request options. Only an authentic handle from the same engine module
instance is accepted; booleans, forged objects, proxies and foreign handles fail
`invalid_input`. Omitting `readerWorkerPool` or supplying `undefined` preserves the
cold path. Supervisor and reader DTOs are unchanged. Maintenance never borrows.

Each pool owns at most two ready Workers and one loading refill, however many
supervisors share it, with no request queue. A closed/loading/exhausted/incompatible pool falls back immediately to the
ordinary cold Worker using the same opening record, consumed reservation and
original cutoffs. Assignment follows issuance, reservation CAS and registration.
Every assigned Worker accepts one bootstrap, is never returned, and uses the
existing bounded graceful disposal and quarantine path at close/timeout.

Parked Workers have only engine code, engine/runtime policy, a service generation
and their private control channel. They have no credential, binding, reservation,
request IDs, readSet, host module/configuration, or application/database descriptor.
Only code-loader reads occur before bootstrap. The host is imported only after
Worker issuance verification and the parent identity acknowledgement, as before.
Empty env/execArgv isolation and the 192 MiB old-generation limit remain in force;
that heap limit is not an RSS cap. Imports/refill still consume CPU/native memory.

Pool compatibility binds the engine entry URL, bootstrap protocol, Node runtime,
192 MiB policy and pool generation. Engine upgrades require service restart;
there is no hot retargeting. Private aggregate hit/miss/startup-failure counters
are per pool, carry no authority/content and are not exported by the public core entry.
Startup failures/crashes are reaped with bounded retry/backoff, never assigned.
With `diagnostics:true`, the existing phase names remain request-scoped. On a hit,
spawn-to-first-statement covers lookup/bootstrap handoff; parked time is excluded.
Engine import intervals measure the cached imports during that same request.

Await each request's `supervisor.close()` to stop and await its own assigned
records. It neither closes the pool nor waits for idle Worker reaping. Idempotent
`pool.close()` stops refill and awaits idle/loading termination; assigned readers
remain owned by their supervisors. Service shutdown must await both pool close
and all request supervisors. Unconfirmed cleanup still rejects; the shared 256
live-record ceiling and cleanup IDs are unchanged. Before restore/erasure, deny
admission, publish revocation, close the service pool and close/drain every request
supervisor, then resume with fresh issuance, a new pool and new supervisors.
No native-host latency claim follows from enabling this option; qualification of
hits, misses, refill contention and bursts is a separate step.

## P2b service maintenance and prebuild

The product supplies independent authenticated service issuance in trusted
`host.configuration.serviceBinding`. It has this closed shape:

```js
{
  kind: 'service', serviceId, credentialBindingId,
  credentialExpiresUtcMs, credentialDigest,
  ownerId, namespaces: { readSet, ownerCoverage }, issuedAt,
  // ownerGeneration: positive safe integer, only when configured
}
```

Service IDs use the same 1–64 ASCII bounds as request IDs. Issuance time is a
nonnegative safe UTC millisecond integer; expiry is a nonnegative safe UTC
millisecond integer or null. The bounded opaque service credential is passed
separately to every maintenance/status call. The host validates it in its
Worker-local `authorize`, allowlists `refreshContextIndex` and
`getContextIndexStatus`, binds the whole input, and returns this exact binding.
Its synchronous `isCurrent` must consult service revocation/erasure state and
optional ownerGeneration. Setting a caller's `kind` cannot convert an HTTP
credential into service authority. Request credentials refuse at maintainer
construction and use, before index work.

```js
const maintainer = await openContextIndexMaintainer({
  supervisor, path: canonicalPath,
  version: 'context-read-v1', profile: 'context-read-product-v1.1',
  readSet, ownerCoverage, host: { moduleUrl, configuration },
  sidecarJournalMode: 'DELETE', diagnostics: true, deadlineMs: 5000
});
try {
  const result = await maintainer.refreshContextIndex({
    readSet, types: ['memory'], intent: 'current', mode: 'lexical',
    budget: { maxItems: 128, maxMs: 1000 }
  }, serviceCredential, { signal });
  const status = await maintainer.getContextIndexStatus({
    readSet, types: ['memory'], intent: 'current', deadlineMs: 1000
  }, serviceCredential, { signal });
} finally {
  await maintainer.close();
}
```

Each call receives a fresh parent-stamped service control window of at most
5,000 ms, shortened by that call's budget and authenticated service expiry.
Later quanta can use the still-valid service grant without borrowing or
extending an HTTP window. Opening has its own bounded supervised lifetime.
Use a service-owned supervisor before opening, await handle close, and close the
supervisor on shutdown, including failed constructor paths. Competing
maintainers for the same canonical identity and normalized selection refuse
`read_in_progress`; the reservation lasts through confirmed native disposal.
Coordinate maintenance across service processes through the product's service
ownership mechanism; one owned pump controls each active projection.

The canonical connection is read-only. Only the separate
`.context-read-product-v1.1.sqlite` cache is writable. Captured generations,
certificates and progress records use product-specific identities and HMAC
domains. Progress is a validated durable checkpoint, independent of whether a
Worker is alive. Fresh HTTP credentials with the same selected owner and
optional ownerGeneration reuse certificates. Issuance IDs and coverage selection
revision do not enter lexical statistics identity. A changed ownerGeneration
makes an old certificate access-stale for a newly valid credential.

When both canonical and cache databases use UTF-8, a canonical or dependency
fence change can retarget authenticated private work in place. Its generation sequence stays the same and its checkpoint advances;
the comparison phase/cursor can return to the first stream. Treat `phase` as a
resumable stage, not a monotonic completion percentage. The complete ordered
comparison reuses exact contributions and reconciles replacements and absences.
Verification resumes at its saved cursor when that comparison changes nothing,
and restarts on the first contribution change. Access changes or invalid work
records start a new generation. Verification commit batching exists behind a disabled
internal qualification gate; public options cannot enable it. With that gate off,
verification retains its page checkpoints and accounting. With it on, bounded
chunks share a transaction and one signed checkpoint; tentative state is copied,
and a fence race discards the entire open batch. FULL durability and publication's
certificate transaction are unchanged. Any progress or convergence benefit is a
**hypothesis** pending paired qualification. These preparation checkpoints do not certify
readiness; the usual fresh post-commit status check still controls it.

Other database encodings use the append-only builder and start a new generation
on a fence change. Both keyset predicates and ordering explicitly use BINARY.
IDs must reproduce their stored bytes when bound through SQLite on the same
connection; lossy decoding or native parameter conversion is refused as corrupt
before the ID is used as a cursor, identity, or body lookup. Cache inserts also
validate the ID and identity before their batch commits, refusing native
conversion that changes either value.

New generations carry an authenticated byte-safety marker in their existing
verification state. Unmarked work starts over, and unmarked bases are never
copied. An unmarked published certificate remains available under the existing
serving rules while maintenance builds a marked replacement from canonical
text. Maintenance does not treat that legacy certificate as a ready noop. Refresh
reports `rebuilding` until the marked publication is ready, while read channels
and coverage continue to describe the available legacy publication.
Until the first marked publication, a B0-era certificate on a store with lossy
or aliasing IDs is served as B0 served it. Invalid canonical IDs must be repaired
before a marked replacement can publish. The sidecar remains format 3 with the
same attested DDL.

### Product cache format 3 and sizing

The product cache now uses physical **format 3** (`PRAGMA user_version=3`),
under the same product profile and cache suffix. Validation certificates bind
`format:3`; signed progress binds the format in its sidecar identity digest.
Formats 1 and 2 are refused as `unavailable/incompatible`, including during refresh.
There is no in-place conversion. To rebuild, close admissions, stop clients and
maintenance, await all supervisor drains, and use the host's explicit cache
discard procedure on the quiescent product sidecar and its companions. Keep
canonical storage and the lifecycle lock intact. Reopen independently
authorized maintenance and complete both intents before exposing search.
Never unlink a live cache or its WAL/SHM to resolve this refusal.

Use **one owner-wide selection per intent**, with the exact physical type set:
personal plus the selected authorized projects, pooled in one projection.
Do not prebuild personal-plus-each-project combinations for owner-wide search.
Format 3 retains the most recently maintained selection for each owner/type
set/intent; maintaining a changed selection retires the previous selection for
that slot. Old handles may consequently report unavailable and require the
host's selection cutover. The other intent remains independent. Superseded
generations, abandoned work and retired selections are deleted in resumable
bounded maintenance slices; published generations and active staging bases
remain protected. Continue explicit maintenance after publication to finish
cleanup. Free pages are reused, with incremental vacuum returning tail pages.

The synthetic 1,642-Memory plus 164-Card measurement covers both owner-wide
intents and mixed Chinese/Japanese/English text. Its before/after table and
index page counts are in
[the footprint handoff](plans/context-read-sidecar-footprint.md). Treat the
measured ratio as sizing evidence for that corpus, rather than a universal
capacity guarantee. The merged format-3 run with semantics off uses 11,968,512 B
of sidecar against 5,197,824 B canonical storage: **2.3026×**, below the ≤5×
lexical sizing target. Budget additional room for staging, pending GC, pinned
reader snapshots and SQLite journals/WAL/SHM. Format 3 includes the vector
schema even when semantics is unconfigured; its exact tables and index SQL are
attested as one physical product format. Configuration is still required for
text egress. The lexical integer dictionary and positive document-key domain
remain unchanged. Vector generations have integer storage keys plus opaque IDs
for certificate bindings; vector rows and cached embeddings reference integer
document keys. Vector validation and signed progress bind format 3.

Each enabled 1,536-dimensional embedding contributes 6,144 raw float32 bytes.
The reusable cache and each published vector projection keep their own copy:
roughly 12,288 raw bytes per embedded item for one intent, or 18,432 across two
intents with cache reuse, before SQLite page/index/identity overhead. Reserve
additional space for immutable staging, superseded certificates and pending GC.
These are payload estimates, not measured total vector allocations. Measure the
host's representative text, enabled vectors and namespace selection before
setting volume limits.

`maxItems` is 1–1,024 transformation attempts and `maxMs` is 1–5,000 including
call overhead, scans, validation and publication. Batches contain at most 128
rows and 2,000,000 text units. Unchanged text is reused without tokenization;
metadata, support and verification work have separate internal accounting.
A successful quantum returns `{status,progress,coverage,channels}`. Only
`status:'complete'` certifies current readiness at its fresh post-commit
snapshot. `rebuilding` means unavailable, and a writer racing publication can
immediately make a valid captured certificate stale. Neither a durable commit
nor an earlier complete response authorizes a later search. `mode:'embeddings'`
performs no lexical build or inference and reports disabled semantic coverage.
`semantic:true` keeps the validated lexical result with a disabled semantic
channel; it cannot enable a provider. All these calls make zero provider calls.

A successful `rebuilding` or `partial` response is durable progress: schedule
another explicit quantum with the same service binding and projection. Stop
the initial prebuild loop only at `complete` for each intent. Time admission
uses the parent cutoff, including opening and dispatch overhead. It reserves
50–250 ms (15% of the quantum, clamped to that range) for checkpoint commit,
publication and final delivery, and stops admitting items when the remainder
cannot cover that reserve plus the conservative observed item cost. The
estimate for each kind of work starts at 10 ms and retains twice its largest
observed cost in that quantum; item work includes tokenization and posting
writes. Metadata batches have their own estimate so an expensive scan cannot
block a cheap first item forever. Verification and GC yield too. This is cooperative admission, so an unexpectedly expensive
indivisible operation can still reach the hard cutoff. The disabled verification-batching
gate preserves ordinary work admission. When enabled internally, verification can
raise its call-local reserve within the effective deadline; finalization spends
that reserve without applying ordinary work admission a second time.

On `read_timeout`, retain the cutoff outcome, await supervised cleanup and
inspect durable status on a later authorized call before resuming. Do not
assume rollback or completion, and do not let a timeout stop all future cron
renewals indefinitely. The host's bounded retry/reschedule policy should
distinguish a successful yield from an actual error; do not spin immediately on
storage/authority failures or extend an existing call's deadline. The owned
pump still stops and reports an error through its completion promise so the
host can apply that policy.

Without `wal:true`, `sidecarJournalMode:'WAL'` still refuses `index_unavailable`
before opening. Default capabilities retain `journals:['DELETE']`,
`sidecarJournals:['DELETE']` and
`wal:{available:false,reason:'deferred_to_p2d'}` byte-for-byte.

### Explicit WAL deployment opt-in

The host sets **`wal:true` on both product reader and maintainer constructors**
to permit SQLite's coordinated WAL/SHM creation and read marks. It is a boolean
constructor option, separate from authentication and from the maintainer's
required `sidecarJournalMode:'DELETE'|'WAL'`. The opt-in supports all four
canonical/sidecar journal combinations, including read-only readers. Opted-in
capabilities advertise both journal lists as `['DELETE','WAL']` and
`wal:{available:true}`; this means code support, not platform qualification.
Omitting the option or setting false preserves P2b refusal and capabilities.
The legacy `openContextReader`/`context-read-v1` defaults do not accept this option.

```js
const reader = await openContextProductReader({ ...requestOptions, wal: true });
const maintainer = await openContextIndexMaintainer({
  ...serviceOptions, wal: true, sidecarJournalMode: 'WAL'
});
```

Use an owner-controlled **0700 directory**, with canonical, product sidecar,
lifecycle lock and every existing/created companion protected **0600**, regular,
owner-owned and single-linked. Directory, file and companion symlinks refuse.
The owner must allow SQLite to create WAL/SHM and read marks even for a read-only
handle. Metadata-only identity checks precede SQLite access and repeat at
statement boundaries. Concurrent external journal-mode changes or uncoordinated
file replacement are unsupported. A protected active DELETE journal retains zero SQLite busy wait. Canonical connections
are read-only and refuse a hot journal requiring recovery. With the WAL SQLite
policy, explicit sidecar maintenance can recover its own rollback journal.
Without that policy, non-write canonical and sidecar checks refuse a protected
DELETE `-journal` alone with retryable `storage_busy`, including request and
status paths and maintenance's non-write checks; the engine neither reads through
it nor retries. Explicit writable sidecar maintenance retains SQLite's existing
hot-journal recovery behaviour. A read-only refusal remains busy until a
read-write writer recovers the journal, so hosts must bound retries. WAL/SHM companions,
WAL headers and unsafe files retain their existing non-retryable refusals.
The isolated header child uses the remaining operation cutoff, capped at 5,000 ms;
an expired cutoff or child timeout refuses with `read_timeout`, without retrying.
Its verdict is bound to the opened inode and rechecked main/directory metadata;
journal identity/protection and WAL/SHM absence are checked again afterward.
An in-place header change after that read remains a residual race: once the
journal disappears, a new sidecar connection refuses the WAL header or its
companions non-retryably. A warm sidecar connection reuses its handle
without that probe and can return `ready` after the unsupported mode switch,
creating WAL/SHM; no next-retry refusal is guaranteed for that cached handle.
The canonical guard checks the header again. The guard does not loop or admit
a read through a journal.
Detected unsafe/unusable WAL arrangements report `index_unavailable`;
there is no writable-canonical fallback.

The maintainer establishes the configured mode only while initializing a new
staged sidecar under exclusive lifecycle exclusion. It never switches an
existing sidecar's mode; a configured-mode mismatch refuses. A damaged WAL
sidecar, or one whose mode cannot be established, also refuses the legacy
replacement protocol. Stop clients and maintenance, verify native drain, then
use the host's explicit cache-discard/rebuild procedure. Never manually remove
live WAL/SHM, force a checkpoint, restore SHM bytes or use immutable live reads.
No canonical journal-mode change or migration is performed by this API.

One Worker operation shares the existing topic policy across canonical and
sidecar connections: `min(operation deadline, operation start + 1000 ms) - 20 ms`.
Every prepare, cached step, iterator step and transaction boundary refreshes
the remaining floored native timeout; connection/transaction/statement admission
does not restart it. Detected DELETE uses zero wait. Detection uses SQLite's
zero-wait opening `PRAGMA journal_mode`, companion hints and at most one bounded
opening fallback when BUSY occurs without a rollback journal. An exclusive
DELETE connection before its first journaled write may receive that fallback;
a stale rollback journal may suppress a WAL opening wait. Neither transactions
nor traversals retry. Native exhaustion remains `storage_busy`; parent cutoff
remains `read_timeout`. Public cancellation does not await native reaping.

**Must qualify:** Linux ext4 on the production volume and deployed Node patch.
**Should qualify separately:** WSL2 ext4 and macOS APFS. Network filesystems are
outside deployment scope. Deterministic tests on development runtimes do not
qualify any of these platforms or establish zero-busy, latency, freshness,
availability or writer-progress measurement gates. The separate qualification
packet must combine P2a/P2b/P2c/P2d and retain complete native writer/reader drain.
**Production stays DELETE until the owner explicitly switches after the baseline
re-run and production-volume qualification.** Setting `wal:true` grants companion
access; it does not switch a live canonical database.

Before enabling search, explicitly complete both `current` and `history` for
every planned normalized projection. Physical v18/v20–v22 use
`types:['memory']`; a deliberate v23+ rollout prebuilds
`types:['memory','card']`. Other type combinations are separate projections.
Card requests on Memory-only layouts refuse instead of silently downgrading.
Unregistered combinations stay unavailable until explicitly maintained.

A reader can then use `findCandidates`, `contextRead`, or
`getContextIndexStatus` with its fresh request credential. The same host module
may supply `counter:{id,countTokens}` for assembly; counting runs in the Worker
and must satisfy the existing exact synchronous counter contract. Missing
counter refuses `token_count_unavailable`. Assembly uses the frozen
representation-v2 serializer, whole bodies, receipt rules, metering, and
canonical final refetch. Preserve the two host-only `_meta` values outside model
input. Fallback on `index_unavailable` is product-owned and must reauthenticate,
reauthorize and mark partial. Authority or lifecycle failures confer no fallback
authority.

## Cron renewal and supervised pump

`renewContextMaintenancePump` starts explicit service work only when called by
the product. Reader startup and lookup never start or renew it. Supply:

```js
const pump = renewContextMaintenancePump({
  supervisor, id: stablePumpId,
  window: {
    id: hostMinuteId, endsAtMonoMs, usedItems: persistedItems, usedMs: persistedMs
  },
  budgets: { maxItems: minuteItems, maxMs: minuteMs },
  quantum: { maxItems: quantumItems, maxMs: quantumMs },
  pollMs, renewalMs,
  projections: [{ options: maintainerOptions, types: ['memory'] }],
  serviceCredential
});
const status = pump.getStatus();
// The service owns/awaits this notification between cron invocations.
const terminalObservation = await pump.completion;
// On service shutdown, also await supervisor.close().
await pump.close();
```

The host chooses all quotas, renewal and selection metadata; the engine
supplies no assumed production budgets. `id` and window ID are nonempty strings
of at most 200 units. `endsAtMonoMs` is a safe integer in the process hrtime
millisecond domain, strictly future and no more than 60,000 ms away. Supply
nonnegative safe `usedItems`/`usedMs` from the host's cumulative ledger.
Per-window items are a positive safe integer, milliseconds are 1–60,000;
quantum bounds are 1–1,024 and 1–5,000. `pollMs` is 1–5,000 and `renewalMs` is
1–60,000. Let `N = 2 * activeSelections` and
`S = max(pollMs, quantum.maxMs)`. Admission requires
`N * S + quantum.maxMs <= 5000`; otherwise it refuses `invalid_input` before
reserving quota or scheduling work. The additional quantum reserves headroom
for disposal, opening, Worker dispatch and the actual epoch observation.
A nominal five-second admission sweep alone cannot guarantee five-second reads.
Freeze these settings before qualification.

Dispatches are paced using the configured minute allowance and full quantum
sizes, with `S` as the minimum admission spacing. Each projection's next read
is due no later than 5,000 ms after its last actual epoch observation. The
scheduler looks ahead through the round-robin order and advances admissions
to leave a full quantum for the next observation and `S` for each intervening
turn. The Worker samples the monotonic clock at entry to the fresh final
canonical snapshot read (§6.1.2). This conservatively bounds the actual
observation time: acquisition/native-read costs cannot postpone its next
deadline. The parent retains this timing privately, outside public results.

The first sweep is due within five seconds of activation. Continuous renewal
preserves observation deadlines and order, including renewal exactly at an
authority/window boundary; renewal after an authority/quota gap starts a new
observation interval.

Late timer delivery or a successful observation beyond the five-second target
records a cadence miss and continues maintenance while authority and quota last.
The scheduler replans from actual observations, preserving round-robin order
and minimum spacing during recovery. Successful late settlements receive the
same known-usage refunds as punctual ones.

The closed public status/completion DTOs remain unchanged (`active`, no error
for an isolated cadence miss). Each status/completion observation has an
immutable fixed internal diagnostic, obtainable with
`maintenancePumpDiagnostic(observation)` from the internal pump module:
`{cadenceMisses,worstGapMs,observation}`. It counts each overdue projection
interval once and records the worst missed gap; `observation` is the latest
successful epoch observation's `{projection,atMonoMs,gapMs,cadenceMiss}` or
null before any success. This bounded process-local metadata contains no path
or credential, has no history buffer, and is absent from serialized DTOs and
the public entry point. Hosts must still provision and qualify timer delivery
and native capacity; recovery cannot undo a missed freshness target.

The internal `maintenancePumpPhaseDiagnostic(observation)` adds fixed per-lane
phase counters (`drain`, `open`, `dispatch`, `epochObservation`, `refreshCall`,
`settle`), elapsed histograms, first/latest quantum samples and work counts.
These overlapping intervals are diagnostic, never refund or timing proof.
For stall attribution, an external harness should log each quantum's numeric
`maintenancePhaseDiagnostic(result)` fields, quantum sequence/lane, process-wide dispatch `ordinal` and elapsed
time; include the lane's `lastStall` and `stallCounts` even on failure. The
Worker's private `maintenancePhases` transport and the reader's fixed allowlist
carry the fields below; `latest.attribution` retains the most recent returned
sample, and `attribution` holds saturating totals, maxima and fixed log2
histograms per field. A cutoff can lose all returned fields; it still captures
the shared operation marker before termination. No public DTO changes.

| Fields | Unit | Measurement |
| --- | --- | --- |
| `unitCount`, `scanUnits`, `itemUnits`, `verificationUnits`, `publicationUnits`, `gcUnits` | admitted units | Existing measured scans/items/verification/GC and admitted publication; counts include attempts rolled back later. Vacuum uses the existing GC admission unit. |
| `scanRows`, `itemRows`, `verificationRows`, `publicationRows`, `gcRows` | rows | Returned scan rows (including verification scans and gated length preflights), completed comparison rows, verified/reset rows, published generation, and SQLite deletion changes across GC tables. |
| `lastUnitKind`, `longestUnitKind` | enum | Last completed admitted unit and longest measured unit; ties choose the latest. |
| `lastUnitMs`, `longestUnitMs` | ms | Unit entry through return, including nested operations. |
| `beginWaitMaxMs`, `beginWaitSumMs` | ms | Sidecar `BEGIN IMMEDIATE` entry through return. |
| `commitMaxMs`, `commitSumMs` | ms | Sidecar `COMMIT` entry through return, including lock wait and sync; each actual COMMIT is measured separately. |
| `{verification,comparison,publication,setup,gc}CommitAttempts`, corresponding `Commits` and `Rollbacks` | counts | Private fixed saturating counters for explicit `write()` transactions (bootstrap-child and implicit-vacuum commits are outside this family): attempts count native COMMIT entry, successful commits count its normal return, rollbacks count outer ROLLBACK entry (including failed rollback). Setup includes selection/allocation/reset; savepoint rejection is not an outer rollback. Lost replies do not imply failure or authorize replay; cutoff can lose the sample. |
| `canonicalReadWaitMaxMs` | ms | Canonical transaction startup plus its first existing canonical statement step, excluding intervening sidecar connection/snapshot/schema work. The marker leaves canonical-read during that gap; no added query. |
| `saveSigningMs` | ms | Sum of progress incarnation/signing intervals in `save()`, excluding SQL updates. |
| `gcSliceMs`, `vacuumMs` | ms | Sum of existing GC deletion slice intervals and `incremental_vacuum` intervals, respectively. |
| `resultPreparationMs`, `serializationMs` | ms | Canonical result DTO assembly plus Worker envelope preparation, and envelope construction/`postMessage` cloning through return. DTO instrumentation uses the preallocated start/end slots inside its transaction, without an instrumentation callback or closure. Intervals overlap; do not sum. |
| `serializationComplete` | 0/1 | Whether the parent saw `postMessage` return; if 0, serialization time is a lower bound sampled at acceptance. No waiting or extra message. |
| `deliveryMs`, `returnMs` | ms | Parent acceptance minus Worker send timestamp, and call entry through parent acceptance, respectively; include validation, and delivery also includes serialization/IPC. |

A maintenance-only 56-byte shared marker contains seven unsigned 64-bit words:
operation/start (`hrtime` microseconds shifted left four bits, kind in the low
bits), admitted units, serialization start/end ns, parent active ordinal,
Worker writer ordinal and parent dispatch start ns. The parent binds the call
before arming its deadline; the Worker publishes its ordinal after resetting
its slots on receipt. A mismatch is `idle`, `pendingDispatch:1`, zero units,
and elapsed time since this dispatch, never previous-call data. Matching
snapshots have `pendingDispatch:0`. Kind/start publish in one atomic store per
transition; nested operations restore the caller's start. The parent samples
on its pump watchdog, reader cutoff or observed overrun without locks or waits.
An opening cutoff also carries its private snapshot on the thrown error into
the pump. `lastStall` includes `{number,ordinal,kind,runningMs,unitCount,
pendingDispatch}`; each lane counts a stalled quantum once per kind.
Ordinals are process-wide safe integers, unique across pumps and reader
instances. Exhaustion returns explicit `null` on the private call, disabling join
attribution only; maintenance admission, dispatch and accounting continue.
The marker uses the reserved all-ones ordinal for these calls and always reads
`{kind:0,runningMs:0,unitCount:0,unattributed:1}`, including before receipt and
after late previous-writer updates. No previous-call data or running time is
inferred. Such quantum samples and stall records omit the ordinal join keys;
they are ineligible for any policy requiring a dispatch join.
Each quantum sample carries its active dispatch ordinal and, when it opened a
reader, `openingOrdinal` for that separate dispatch. Ordinals are join keys,
not aggregate counters. The internal fixed marker and ordinal are excluded
from caller bootstrap/transport capacity accounting. Counter slots and maps
are preallocated; transaction-time instrumentation uses clocks, atomic stores
and numeric updates. The admission test uses a frozen 84-decision fixture,
generated once by evaluating the quantum implementation at `4559909f` over seven
budgets and four unit kinds at one millisecond before, at, and after each
admission boundary; tests need no Git executable or historical objects.
Unit durations reuse the admission clock samples;
materialization and pump aggregation happen outside SQLite transactions. Enum order is
`idle=0`, `scan=1`, `item=2`, `verify=3`, `publication=4`, `gc=5`, `vacuum=6`,
`begin=7`, `commit=8`, `save=9`, `canonical-read=10`, `serialize=11`. Idle at
cutoff can indicate dispatch/delivery delay; it does not claim a SQLite stall.
A counter sampled concurrently with a transition can include the next admitted
unit. Marker timestamps have microsecond resolution. Request readers allocate
no marker and send no additional transport.

Maintenance failures also have private latest-value diagnostics. Log
`maintenanceFailureDiagnostic(resultOrOpeningError)` and
`maintenanceReaderFailureDiagnostic(handleOrOpeningError)`, plus
`maintenancePumpDiagnostic(observation)` and the failed lane's
`maintenancePumpPhaseDiagnostic(observation).projections[lane]`. The reader and
pump diagnostics expose `lastFailure`, `failureCounts`, `secondaryFailure` and
`secondaryFailureCounts`. `lastFailure` retains the initiating failure through
disposal; a later cleanup, Worker exit after error, or registry rejection updates
only the bounded latest `secondaryFailure` and its separate saturated counts.
One rejected resident close is counted once across propagation and repeated
attempts, on the resident's owning lane, rather than its replacement's lane.

Each recorded failure has `cause` and `stage`. Pump records also have `lane`;
`number` is present when a quantum triggered the failure or disposal, and absent
for explicit idle disposal with no triggering quantum. `stage` is one of `open`,
`refresh`, `call`, `idle`, `close`, `observation`, `disposal`; a watchdog records
`open` while opening, `close` while draining an incompatible resident, and
`refresh` after opening. Log optional `ordinal` and
`stall` when captured from an active dispatch. Idle/close failures without an
active dispatch omit those fields, rather than accepting the last call's marker.
A primary captured during a call keeps its original step, ordinal, stall and
stage even if disposal later fails. Log optional `step` for captured failures,
`exitCode` for `worker_exit`, bounded constructor `errorName` for `worker_error`,
`spawn`, `dispatch` or `call_error`, and `engineCode` for a known `engine` failure.
`engineCode:index_unavailable` records also carry a closed private `reason`:
`storage_unavailable`, `auxiliary_file`, `unsafe_file`, `incompatible`,
`wrong_store`, `missing`, `corrupt`, `validation_missing`, `validation_invalid`,
`memory_store`, `replaced`, `stale_index`, `rebuilding` or `timeout`; other or
unavailable values become `other`. Protocol records carry private `protocolKind`:
`frame_conflict`, `identity_shape`, `result_bounds`, `result_clone`, `result_shape`
or `open_identity`; an unknown or unavailable sub-kind becomes `other`. These fields never enter
public DTOs or codes.
An exception mapped to `index_unavailable` keeps its original private exception
cause and captured step alongside the closed reason.
Secondary records have the same field optionality; their counts use the same
fixed cause-family buckets as primary counts, with no unbounded history.

The cause families are `worker_heap_limit` (Worker out-of-memory event),
`worker_exit`, `worker_error`, `protocol`, `unmapped:<code>`,
`exception:<ErrorName>`, `observation_timing`, `engine`, `spawn`, `dispatch`,
`call_error`, `identity`, `worker_state`, `cleanup`, and `disposal_proof`.
Codes match `^[a-z][a-z0-9_]{0,47}$`; constructor names match
`^[A-Za-z][A-Za-z0-9_]{0,47}$`; invalid values become `other`.
An uncoded exception caught inside the Worker also records numeric `step` using
the existing maintenance-kind enum above, sampled before unwinding the measured
operation. Resume/checkpoint validation outside an admitted unit can be `idle`.
Inner error-to-code conversions retain this metadata; existing public mappings,
including `storage_error` in the lexical catch, stay unchanged. Only sanitized
kind/name/code/reason/protocol-kind/step fields accompany a failed Worker envelope; none enter the
public result, serializers, public exports, or request-reader transport.

`lastFailure` is immutable and retained across later success; a new reader or
pump starts with `null`. Counts saturate and use fixed cause-family buckets:
parameterized `unmapped:*` and `exception:*` values count under `unmapped` and
`exception`, keeping labels bounded. Repeated observations never increment
counts. A call's initiating cause is primary; propagated copies do not add
counts. Distinct cleanup/proof failures retain their secondary cause and counts. Success has no result-level
failure record. No message, stack, path, content, credential, or error object is
retained in a diagnostic. These fields supply no admission, refund, cutoff
eligibility, or disposal proof.

A quantum is admitted only when both window and renewal time have at least
`quantum.maxMs` remaining. A shorter tail waits for expiry or authorized renewal,
without reserving items/ms, opening a maintainer or advancing round-robin position.
The window-tail utilization cost is less than one configured quantum per window;
skips charge zero budget. Cadence accounting continues, including nonterminal misses.
Opening/drain cost within an admitted turn still consumes its reservation.

A hard `read_timeout`, for maintenance or a request reader, detaches and settles
the call promptly. The parent first sends the existing close command, with up to
10,000 ms of grace, independently bounded in real monotonic time even when an
injected operation clock stops. A pump timeout uses this same disposal path even
if the reader already accepted a response before its own deadline. Ordinary idle
close, supervisor close (including an in-flight call), and idle expiry have the
same bound. Earlier cutoffs tighten only expedited-recovery
eligibility: proof must still arrive within 1,000 ms of the earliest cutoff.
Late confirmed disposal avoids quarantine but earns no expedited recovery.
The Worker stops accepting work, waits for bootstrap/current work to finish, then closes native
resources and registered host leases/providers before exiting. The writer claim
remains held until confirmed disposal. While disposal is pending, request-reader
opens and calls for the same store and host domain wait before admission,
including across owners and supervisors. Confirmed proof releases the hold after
a re-check; failed proof refuses `reader_failed`. The caller's original cutoff
ends the wait with `read_in_progress`, with no late dispatch. Waiting consumes
the existing live/request capacity; capacity refusal is immediate. A closed supervisor itself continues to return `store_closed`.
Late replies are rejected; an executing commit may finish, so existing
authenticated SQLite recovery decides durable state.
If grace expires, forced termination retains the existing cleanup/quarantine rules.
A host's `close()` should finish well inside this bound. A service's own shutdown
deadline must exceed it with margin, because supervisor close awaits confirmed
disposal of its readers. A failed close, exit or unbalanced resource count never clears quarantine; changing
supervisors does not bypass the process-wide registry. Confirmed disposal leaves
pump completion `read_timeout`, permitting ordinary authorized reopening after drain,
instead of the `reader_failed` caused by failed disposal, including failed opening
drains that returned no handle. Request calls retain their existing error DTO and terminal handle semantics. No public shapes or exports change.

A genuine quantum cutoff reports `failed` with `read_timeout`, stops scheduling
and drains. Missing or invalid internal observation timing reports
`reader_failed`; authority, storage, corruption and lifecycle failures also
stop and drain. Failed/uncertain work keeps its full reservation. A parent
deadline timer exposes failure even while disposal or refresh remains pending;
supervision continues to own the drain. No additional host input is needed.

An internal confirmed-disposal exception exists for owned lexical pump refreshes,
but is **disabled until a deployed Node patch is qualified**. The engine's private
qualified-patch set starts empty. No public option, credential, environment variable
or diagnostic marker can enable it. Tests use only the internal runtime factory's
dependency seam; passing a recovery flag to public renewal remains invalid input.
Functional tests alone do not qualify a patch: native recovery/resource settlement
and separate quiet-window disposal/open-tail and observation-gap evidence are required.

When enabled, an attested refresh cutoff keeps the pump alive while resident
`close()`/drain confirms Worker exit, both complete cleanup records, balanced
leases/providers and exclusive-writer release within 1,000 ms. Node environment
teardown closes isolate-owned `node:sqlite` connections; the derived `nativeDisposed`
bit is not independent evidence and does not prove disposal of arbitrary host resources.
Invalidate that resident's cached intents, wait a fixed 1,000-ms shared-domain
cooldown, then continue with unchanged observation baselines and round-robin position.
At most two expedited recoveries use the existing resolved-path/owner/host domain's
allowance per quota window. The breaker is process-local; restart resets it but
must restore cumulative usage floors. Failed quanta retain their full reservation;
every successor reserves anew, including open/recovery time. Writable SQLite recovery
precedes final status observation; no read-only status preflight is added.

Late proof cannot revive expedited recovery, but ordinary authorized renewal after
safe drain remains available. A failed/uncertain drain overrides public completion
with `reader_failed`; private diagnostics retain the cutoff. Opening, status,
standalone maintainers, request readers and semantic pumps retain terminal cutoffs.
The fixed numeric `maintenancePumpCutoffDiagnostic(observation)` in the internal
reader module records only the process-wide dispatch ordinal, lane/quantum/resident,
cutoff enum, charged items/ms, disposal ms/outcome, allowance and cooldown deadline.
Outcome enums are pending=0, recovered=1, proof-deadline=2, failed-proof=3, closed=4,
allowance-spent=5. No public DTO or serializer fields are added.

Quanta reserve their full item/time allowance before opening/dispatch. After a
successful settled quantum with a valid transformation-attempt count and known
elapsed time, unused items and milliseconds are returned to that minute window.
Elapsed time is rounded up and includes handle disposal/opening and result
delivery. Attempts in a rolled-back fence-race batch remain charged. Missing or
invalid usage, failure, timeout, crash or uncertain settlement retains the full
reservation. Host-supplied cumulative usage remains a conservative floor, even
if renewal occurs during dispatch; neither renewal nor restart erases charges.
Persist the full outstanding reservation before process replacement whenever
settlement is uncertain. Counters never refund unknown work.

The observation-cadence rules above remain lexical-only. An embedding-enabled
pump (below) also skips window/renewal tails that cannot fit its configured
quantum, without reserving or advancing round-robin position; validation uses
its own configured time bound. Its
resident cache includes constructor policy. Continuous renewal reuses
residents; inactive renewal retires them inside the next reserved turn,
draining before a replacement opens. Opening failures retain their cleanup IDs
even when accounting settlement also fails. Completion waits for opening
disposal; a failed or unproven drain makes completion `reader_failed`,
retaining the initiating cause privately. Late open, control and reservation
replies lose dispatch authority after close or renewal; a late handle is
drained. A parent watchdog bounds each turn, including coordinator control
overhead. A coordinator control timeout, including the turn watchdog and
validation’s own deadline, reports `timeout`. Hosts should retire and reopen
the coordinator on that code: the engine does not yet close a timed-out
coordinator. Reader cutoffs report `read_timeout`. Resident disposal and its
proof are unchanged by this public-code distinction. `ledger_unavailable` maps to `reader_failed`.
Existing coordinator codes (including `budget_denied`, `provider_error` and
`rate_limited`) and public reader codes stay unchanged. Unknown or missing
codes map to `reader_failed`. Bounded private initiating and secondary cause
counters use the existing sanitized failure records and valid process-wide
ordinals; public DTOs are unchanged.

Semantic accounting captures each reservation's window and pump generation.
Late replies cannot replace a renewed window or lower newly supplied cumulative
floors. Durable window floors are monotone; an old quantum settles only its own
window. New quantum records carry validated, versioned original item/time
reservations; legacy records without this metadata retain their full charge.
Repinning to an older engine and forward preserves existing charges and window
floors. New-format reservations settled by older finish or recovery code stay
fully charged and nonrefundable when opened again by the new engine.
Successful known lexical usage counts `transformed`; embedding usage counts
`embeddingAttempts`, including attempts yielding no committed vectors, never
`embedded`. Status and coverage validation count zero item attempts. Invalid,
missing, failed or uncertain usage retains the full reservation, and repeated
settlement cannot refund twice. Recognized rolled-back attempts stay charged.
Elapsed milliseconds round up from parent reserve entry through finish-receipt
delivery, including resident opening, drain and control overhead. A full-charge
finish receipt precedes item/ms reconciliation on the next reserved admission,
whose own span charges that reconciliation overhead. A refused admission keeps
the prior full charge and leaves reconciliation for a later reserved turn.
Duplicate standalone finishes preserve receipt eligibility and cannot consume
usage. The parent can report the known refund on receipt; until the next
admission the durable ledger retains the full charge. Losing the receipt or
acknowledgement retains that charge.
USD settlement is unchanged: success or zero committed vectors alone never
refunds unknown provider exposure. Owner, UTC-day and lifetime limits are
unchanged.

Admission derives durable UTC expiry from the parent's absolute monotonic
window deadline, subtracting transport and queue delay; an existing expiry can
only tighten. Expiry never releases old unknown charges. Authoritative pump
window exhaustion reports the existing `budget_exhausted` state with no error.
An exhausted admission still binds that window until its deadline.
An existing `budget_denied` error from a provider or policy remains unchanged.
It still schedules a nominal sweep from its own ticks. Actual-observation
cadence, spacing/pacing, miss accounting and startup/validation cursors remain
separate parity work.
Canonical selection/intent observation duty belongs to lexical refreshes only;
embedding, status and validation work use capacity without earning observation
credit. Semantic coverage lag concerns recall. Unsuccessful turns and genuine
semantic cutoffs remain terminal. The lexical cutoff exception stays disabled.
Bounded coordinator disposal also remains separate work.

A recognized canonical/dependency fence change during a batch rolls back that
batch and returns successful `rebuilding` progress. Earlier committed batches
survive. The pump schedules another quantum; storage, corruption, authority and
lifecycle refusals still fail and drain. This does not certify mixed generations
or make stale publications ready.

Renewal must remain valid through the next cron invocation and its handoff
margin. For a 60-second cron, a 10-second renewal leaves a 50-second authority
gap: renew more frequently, or arrange overlapping renewals within the existing
60-second renewal bound. Keep service credential authority valid as well.
Minute budgets are cumulative, not fresh per poll. An allowance of eight full
quanta cannot fund the minimum 24 observations per minute for two intents if
those quanta use their full reservations. Reconciliation helps cheap/no-op
work; pacing cannot create quota or guarantee freshness under insufficient
capacity. Provision for both intents, scanning, verification, races and writes,
then qualify the actual registered workload. Continuous writes may still
abandon staged work and require full-corpus catch-up.

Each of 1–32 active selections supplies validated maintainer options with the
same supervisor and explicit physical types. Both intents are included
sequentially in round-robin order. Renewal with the same ID and selection
returns the same owned pump and handles, with no overlapping dispatch. It
extends supervision only, never the quota window or counters. A new window is
accepted only after the previous one ends. Restarting a handle/pump within a
window reuses process-owned store/owner/host-domain charges, even with a new pump ID; a different window ID cannot evade an
unexpired window. The product persists cumulative charges before process
replacement, maps new-process monotonic windows, and controls cross-process
ownership. HTTP credentials cannot open the pump.

Status exposes `active`, `budget_exhausted`, `renewal_expired`, `failed` or
`stopped`, along with settled usage plus outstanding/unknown reservations and a
sanitized error code. The
completion promise reports exhaustion/renewal expiry or failure; the product
must observe the promise returned after each renewal, export cumulative
usage, and apply its configured reschedule/failure policy. Failure stops further
quanta and closes owned handles under supervision. Supervisor shutdown also
stops the timer and drains in-flight work and handles. No detached OS task or
log provides this ownership. The product must supply a service lifetime that
survives HTTP cron completion; if its host cannot do so, run the pump in an
explicitly owned maintenance service. No freshness or availability gate has
been measured by this package.

Prebuild every active owner selection, including overflow selections, for both
intents and the exact physical type combination before exposing search. A
selection or coverage revision change is not an in-place pump renewal: close
and await the old pump, supply a fresh pump/maintainer binding and build the
new selection (or register it separately before cutover). Changed coverage on
an existing pump ID refuses `read_in_progress`. Process-owned quota charges
survive replacement. Record selection churn in the product; never turn a
missing mixed projection into a Memory-only lookup or merge namespace results.

## Backup and restore

Back up canonical storage using the product's SQLite-consistent procedure or a
closed, quiescent database. Omit the derived product sidecar. A diagnostic
sidecar archive is non-restorable cache evidence.

For restore, close admissions, stop clients, revoke old request bindings and
drain reader/maintainer/pump supervisors. Validate the restored canonical
physical layout, schema, identity and logical content without migration.
Discard any copied product sidecar and its certificates before rebuilding;
never restore publication pointers in place, including a restore onto an
existing inode. Reopen maintenance with independent current service authority,
then complete all configured current/history projections before search
exposure. Copied canonical or sidecar file identities fail certificate
validation; explicit maintenance rebuilds rather than relabeling copied
certificates. Keep optional ownerGeneration in current host state.

Record the contract's separate backup, canonical verification, sidecar rebuild,
deep verification and fresh-reader verification times and disk sizes during
qualification. These are report-only outputs, with no invented time gate.

## Explicit hosted semantics (P2e)

The additive selection is `context-read-product-p2e-v1`; it keeps the profile,
version and representation above. Omit `semanticConfig` to retain the existing
lexical capabilities, status, serializer and execution paths. A provider alone
never enables an owner. A configured handle still defaults each read to
`semantic:false`. That flag performs no semantic RPC, preflight or provider
invocation and adds no semantic trace. Fetch and continuation never embed.

For the product, Revision 2 permits only this closed provider selection:

```js
const provider = {
  provider: 'openai', model: 'text-embedding-3-small',
  dimensions: 1536, normalization: 'l2',
  requestTimeoutMs: 3000, maxBatchDocuments: 64,
};
const coordinator = await openContextSemanticCoordinator({
  version: 'context-read-product-p2e-v1', supervisor,
  ledgerPath, ledgerIdentity, host: semanticServiceHost, provider,
  refreshCaps: {
    steady: { maxItemsPerUtcDay: 2000, maxUsdPerUtcDay: '0.05' },
    backfill: {
      maxItemsPerUtcDay: 20000, maxUsdPerUtcDay: '0.50', maxUsdTotal: '5',
    },
  },
  backfillTargets, priceTable, deadlineMs: 5000,
});
// Supply this only after the host's separately recorded owner approval.
await coordinator.setOwnerSemantic({
  ownerId, semantic: true, expectedRevision: 0,
}, ownerSemanticCredential);
```

`ledgerPath`, identities, host wiring, targets and the reviewed price table are
host inputs. No credential or provider key belongs in these configuration
objects. The Worker-local host factory constructs the injected
`contextEmbedding:{embedder,policy}` runtime port; the hosted policy retains
`maxRequests`, `maxConcurrent`, `maxUsd` and its hosted family. The engine
computes conservative token/cost bounds from the reviewed price table. The
optional transport at `adapters/openai/product-embedding.mjs` exposes
`createProductOpenAIEmbedder`; construct it inside that factory with a runtime
credential closure reading `process.env.CAIRN_CONTEXT_SEMANTIC_OPENAI_API_KEY`
and the validated selection. This is the only environment variable admitted to
the semantic service Worker, and only when it is a non-empty string. There is no
fallback to `OPENAI_API_KEY` or any other variable. The parent reads it at each
Worker start, so a rotated value applies to the next open. Ordinary product
Workers still receive an empty environment. The allowlist keeps the key out of
engine-owned outputs; it doesn't isolate the key from the trusted host module
and its dependencies, which run in that Worker and can read it.
The transport's endpoint is fixed, redirects are refused, requests are guarded,
and there are no retries or provider fallbacks.
The transport reports validated input-token usage through `settleInputTokens`.

Product-profile local selection and a local runtime with `localStatus` refuse
`invalid_input`; no product local observer or pack is invoked. Explicit local
`bge-m3` remains on the existing `context-read-v1` local engine and adapters under
frozen unified §20. P2e does not alter that path.

Attach the branded coordinator to maintainer options as
`semanticConfig:{version:'context-read-product-p2e-v1',coordinator}`. Reader options
also require `queryEmbeddingMaxMs` and `finalizeReserveMs`; both are positive,
their sum must fit `requestControl.requestMaxMs`, and the reserve is below 5,000.
Opening time and earlier request, method and credential cutoffs still count.
A covered read sends exactly one query string, within the earliest provider or
query deadline and with its finalization reserve retained. Pool the selected
namespaces in the engine; never fuse or merge per-project results in the host.
Hosted fusion is `rrf-k10`, depth24, equal lexical/semantic weights.

## Durable ledger and independent authorities

`ledgerIdentity:{accountingDomainId,ledgerId}` is a stable logical identity,
independent of path spelling. Bind all owners using the same hosted identity to
the same accounting ledger. The process refuses a second logical ledger for
that identity when shared enforcement cannot be established. A SQLite ownership
file beside the ledger serializes an owner's service incarnations across
processes; contention refuses admission. It contains no accounting state.

Before ordinary coordinator opening, the host's separate enrollment authority
must establish durable never-bound history and provision a zero owner row and
sequence-0 independent anchor. The internal control-plane helper
`provisionSemanticOwner` accepts that authority; it is not a request, set-owner,
projection-maintenance or MCP method. Keep the independent anchor registry and
its enrollment/tombstone history outside the accounting file and vector cache.
The runtime `semanticLedgerAuthority` supplies `load(ownerId)`,
`compareAndSwap(expected,next)` and `listOwners({accountingDomainId,ledgerId})`.
`listOwners` returns the complete, nonempty, duplicate-free array of owner IDs
enrolled in that accounting domain and ledger. It must come from the same
independently durable enrollment authority as the anchors, never from rows in
the accounting file: shared-identity limits are enforced over this inventory,
so a missing, restored or deleted owner row is detected instead of silently
dropping that owner's spent exposure. An inventory that is unavailable,
malformed or inconsistent with the ledger leaves semantic admission
unavailable. A host without `listOwners` is refused with `invalid_input`.
Its storage/transactions must obey the same
SQLite file safety and bounded native-wait rules; the host receives
`resourceOwner.sqlitePolicy` and registers owned resources for disposal.

Every mutation prepares the exact next digest in the registry, commits that
state in SQLite, then seals the anchor before dependent transmission or vector
publication. The digest binds the owner state and physical accounting file.
Missing anchors, empty/copied/replaced files, backward restores and mismatched
sequence/digests cannot initialize another allowance. Pending preparations bar
admission. After independently confirmed resource disposal, the trusted
`confirmDisposed` recovery decision may finish an exact committed preparation
or cancel an exact uncommitted one. A timeout or PID observation supplies no
such proof. Failed opening returns a supervised `cleanupId`; await its drain
before replacing the service. Loss/migration recovery requires the host's
separate authenticated reconciliation procedure, preserving or increasing
unknown/spent exposure, latch and epoch barriers and rotating binding/ledger
fences. Unknown history stays lexical. There is no allowance-reset API.

The host also supplies synchronous
`semanticPriceAuthority.current({authorityId,model,utcMs})`, returning the exact
reviewed revision, sequence, table digest and effective window. `PriceTable`
contains those revision/window fields and
`usdPerMillionInputTokens:{'text-embedding-3-small':Usd}`. Windows are at most one
UTC day and are exclusive at their end. Rates and monetary budgets are decimal
strings with at most 12 fractional digits; no live rate lookup or default rate
exists. Admission and the immediate transmission guard both check currentness.
Persisted authority high-water marks reject rollback. Reservations pin their
original rate; validated cheaper usage can settle only once after actual
execution ends. Missing/untrusted usage retains the full reservation. Over-bound
usage blocks that provider identity. Queries share identity limits but do not
consume the owner's refresh item/day/backfill USD pot.

The host must issue an independent owner-wide `semantic-service` binding,
allowlisting each coordinator method and binding its owner, logical ledger,
ledger epoch and binding revision. Request and projection service credentials
cannot read owner totals, validate first coverage, set policy or purge. Ordinary
projection status exposes only its selected semantic counts. Configured
capabilities require `getContextReadCapabilities({deadlineMs},credential)`;
legacy no-argument capabilities retain their old public shape.

## Coverage and refresh scheduling

First complete the exact lexical projection for both intents using the existing
explicit maintenance mode. Every fresh product cache creates the complete
format-3 schema, including vectors, regardless of semantic configuration.
Format-1 and format-2 caches require the stopped-client rebuild described above
in both DELETE and WAL modes; maintenance refuses an in-place format upgrade.
Readers never create or upgrade storage.

Then use explicit bounded quanta:

```js
await maintainer.refreshContextIndex({
  readSet, types, intent: 'current', mode: 'embeddings',
  budget: { maxItems: 64, maxMs: 1000, maxUsd: '0.01' },
}, projectionServiceCredential);
```

Items are 1–1,024, milliseconds 1–5,000, quantum USD 0–0.50. Zero USD permits
no paid dispatch. A provider batch is at most 64 whole documents, with the
configured tighter limit, UTF-8/token bounds and every applicable owner,
identity and window limit. Smaller final batches preserve canonical order.
Refresh never repairs missing lexical storage. Certificate publication is
checkpointed, independently HMAC-authenticated and bound to the complete
lexical publication, selected six-field vector identity and owner purge epoch.
Partial staging cannot authorize hybrid reads.

The initial 1–32 target descriptors expand into both intents. They freeze before
first dispatch and cannot be dropped to obtain completion. Every embedding
refresh records a provisional hint before its final sample. Once all targets
hint complete, the durable pending-validation barrier blocks further backfill
sends. Invoke the public owner-wide operation, even when item/USD budgets are
exhausted:

```js
const ownerStatus = await coordinator.getOwnerSemanticStatus(
  { ownerId }, ownerSemanticCredential,
);
await coordinator.validateOwnerSemanticCoverage({
  ownerId, expectedTargetDigest: ownerStatus.value.firstCoverage.targetSetDigest,
  budget: { maxTargets: 1, maxMs: 1000 },
}, ownerSemanticCredential);
```

Repeat bounded validation quanta until complete or an explicit invalid target
requires maintenance. Receipts survive restart; only a fresh final pass over
all targets can latch steady mode. Validation has no provider/item/USD charge.
Its final pass contains no callback or await; the prepared latch's anchor seal
occurs at the next service admission. Steady limits apply to all subsequent
work, counting the same day's earlier backfill exposure. UTC rollover cannot
release unknown old-day charges, undo the one-way latch or reset lifetime spend.

An embedding-enabled pump adds `semanticConfig`, the separate
`semanticServiceCredential`, `firstCoverageValidation:{maxTargets,maxMs}`,
`projections[].modes:['lexical','embeddings']`, and `maxUsd` to budgets/quantum
plus `usedUsd` to its window. The nominal full observation sweep, including
startup status and validation turns, must fit five seconds. This nominal sweep
is not the lexical pump's cadence guarantee (see the scope note above). Validation retains
time capacity after paid item/USD exhaustion; lexical turns continue when
embedding turns are skipped for off/block/USD constraints. Window reservations
are durable; another pump ID cannot recharge an unexpired window. Observe each
completion notification and await pump/coordinator/supervisor disposal.

## Off switch, purge and degradation

Disabling uses `setOwnerSemantic({ownerId,semantic:false,expectedRevision},...)`.
It durably increments the purge epoch, bars old vector publications and new
semantic sends, and cancels active work while preserving charges and ownership
until actual settlement. It queues deletion rather than deleting on a read.
While off, call `purgeOwnerVectors({ownerId,budget:{maxItems,maxMs}},...)` with
separate owner-wide purge authority. Bounded batches cover every cataloged
projection, intent, identity and staging/obsolete generation. Each batch commits
its authenticated progress with deletion and pointer invalidation, so retries
reconcile without double counting. Inaccessible entries cannot be declared
complete. Other owners, lexical certificates and canonical data remain intact.
Re-enable only after complete purge; refresh then restores missing vectors under
the existing phase/day/lifetime limits. Cache purge makes no claim about hosted
provider retention or physical media erasure.

Complete exact-projection coverage and resident capacity are prerequisites to a
query attempt. Missing/invalid/stale vectors cause zero query dispatches. With
ready lexical storage and sufficient finalization time, provider failures,
timeouts, price or budget denials preserve lexical identities, order, assembly
bytes and token accounting. `trace.semantic` records coverage, attempts0/1,
admitted query sub-budget, actual attempt time and a sanitized degradation enum.
Authority, canonical fences, native storage and the outer deadline retain their
existing errors. No provider body, input text, credential, vector or path enters
these diagnostics. Default, fetch, continuation and semantic:false paths gain no
new P2e trace. Projection status never includes refresh, purge or first-coverage
owner progress; retrieve those only from the owner-wide coordinator.

The host owns consent and privacy integration: **hosted embeddings need owner approval and the host's consent/privacy surface**. This code and fake-provider
tests authorize no transmission or rollout. E.9 registration, real hosted
quality/latency evidence, deployment gates and the owner's enablement decision
remain separate from implementation.
