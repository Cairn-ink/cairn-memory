# Product adapter: P2a–P2e

The independent [local Raw index](plans/raw-search-interface.md) does not enter
this product worker profile. Hosted Raw selection refuses until a separate
backend and durable accounting integration exist. The existing product read,
maintenance, broker and worker APIs described below are unchanged.

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

**Amendment v1: maintainer sidecar connection reuse.** A healthy writable
maintainer connection also serves observation, comparison and preparation reads.
Each read still uses an independent read transaction with `query_only` enabled;
the final observation still acquires its fresh post-commit canonical and sidecar
snapshots. Every reuse retains identity and companion checks, the stricter
applicable read/write journal rules, and the existing writable journal-mode
check. Writable preparation still rereads metadata and attestation. Integrity
checks (`quick_check` and `foreign_key_check`) run on every fresh writable open.
Any failed operation, unavailable observation or rollback on a writable connection
discards the cached connection after the operation releases its transactions;
subsequent writable use opens and checks again. Cutoff, termination and close
dispose the resident's connections. Any failure on an operation started on a
writable connection discards the cached connection; a read-only connection is
discarded only for native SQLite primary codes IOERR, CORRUPT, FULL or NOTADB
(including extended codes), or the
`storage_unavailable` reason, and otherwise keeps its handle, falling back to
discarding only for `storage_unavailable` when no native error code is present.
Reuse does not retain a read snapshot between operations.


**Amendment v2: lexical maintenance admission quanta (2026-11).** This
amendment applies only to the pump without `semanticConfig`. When a selected
resident or its writable sidecar connection needs fresh admission, one fully
reserved turn performs any required disposal, resident opening and an explicitly
authorized writable sidecar admission, including identity, companions, journal,
metadata, attestation, `quick_check` and `foreign_key_check`. A private dispatch
uses the existing service refresh authority; public refresh with `maxItems:0`
is not an admission protocol. The turn performs no refresh, corpus scan,
transformation, verification, publication or reclamation. Construction of a
standalone maintainer remains lazy, and its public refresh behavior is unchanged.
Admission certifies nothing and supplies no epoch observation. It releases its
transactions and lifecycle snapshot before returning, retaining the native handle.

A later fully reserved work turn reauthenticates the current grant and refreshes
on that admitted connection. The selected lane remains pending until work
actually dispatches; an admission-required yield retains the same lane too.
Identity, companion, journal, metadata and attestation checks on reuse remain
required. Lost, discarded, repaired or upgraded connections require an admission
turn before fresh writable opening: ordinary pump work yields before a hidden
writable admission, including a fallback after a caught writable failure.
The existing failure-mode disposal rule above is unchanged.

**Amendment v3: lexical pre-quantum turns (turn contract v1, 2026-11).**
This amendment implements the lexical portions of the
[maintenance turn contract](plans/context-read-maintenance-turn.md), only for
`renewContextMaintenancePump` without `semanticConfig`. The semantic pump is
not yet covered. An optional host scheduling ticket precedes each open-only
admission turn and each later work turn. The broker wait is outside the charged
quantum, reservation, watchdog, resident drain/open and writable admission.
Healthy resident idleness holds no ticket. Standalone maintainers and the
existing dynamic authority and storage checks retain their behavior.

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

**Amendment v1: protected replacement DELETE journals.** For both guards, a
replacement journal that passes the original protection predicate and one final
identity/protection check is retryable `storage_busy`; in the product sidecar,
the outcome changes from `index_unavailable` with reason `storage_unavailable`
to `storage_busy`. Unsafe or
repeatedly replaced journals, changed main/directory proofs, opened-inode swaps,
and WAL/SHM companions retain their refusals; no retry, read-through, adoption or
recovery is added, and hosts retain their bounded busy rule.
For this product-sidecar case, busy propagation replaces the unavailable status
DTO and the private maintenance record's index reason `storage_unavailable`.

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

**Amendment v3: lexical admission port.** Supply the optional top-level
`preQuantum` port, separate from `host.configuration`:

```js
preQuantum: {
  version: 1,
  maxWaitMs: 1000, // integer 1..5000, independent of the quantum
  createTurn(request) {
    return {
      enter({signal, untilMonoMs}) { /* "admitted" | "defer", or native Promise */ },
      release(outcome, reason) { /* synchronous, idempotent, no throw */ }
    };
  }
}
```

**Amendment v3: optional wait budget.** Omitting `maxWaitMs` uses 2,000 ms.
When present, it must be a data property containing an integer from 1 through
5,000; an accessor or an explicit `undefined` refuses `invalid_input`. Presence
uses the same descriptor-chain capture as the other port fields.

Validation captures data descriptors and method receivers without invoking
accessors or Proxy traps. Invalid activation refuses `invalid_input`; adding,
removing or replacing the port object on an existing pump refuses renewal with
`invalid_input` before any state change. Every renewal uses the same object.
Each ticket must be a plain non-Proxy object with own data-function `enter`
and `release` properties; both are captured before entry. A non-native thenable
is never awaited. A frozen request contains only primitive `version:1`,
`pumpId`, `windowId`, integer projection `lane`, `family:'lexical'`,
`kind:'lexical'`, `phase:'admission'|'work'`, lane `intent` and `maxMs:Q`.
It carries no owner identity, credential, path, query or error payload.

After pure eligibility and lane selection, the engine latches a pending request
and waits before stamping the quantum start or advancing the lane. The wait
ends at `min(now+maxWaitMs, min(windowEnd,renewedUntil)-Q)`. On a grant, it
synchronously rechecks stop/error, admission generation, full authority/window
horizon, quota and floors, minimum spacing, lane and resident epoch, and the
sidecar's open-only hold/quarantine. All amounts come from current state.
A failed check releases `declined` with one closed reason: `stopped`,
`renewal_expired`, `generation_changed`, `budget_exhausted`, `spacing`,
`lane_changed` or `admission_held`. Dynamic authorization and currentness,
ledger binding, price, budgets, purge and enablement checks stay inside the turn.

**Amendment v3: wait-expiry decline.** This package extends the turn contract's
§6 closed lexical decline reasons with `wait_expired`: the broker granted after
the engine's wait deadline. A grant racing that deadline remains owned and is
released with `release('declined', 'wait_expired')`, starting nothing. Existing
pump-state checks run first and retain their reasons. The decline adds no
deferral or failure, leaves public status `active` with `error:null`, and retries
through the existing retry-not-before time at normal spacing. Decline reasons
stay informational for the host. A broker may keep an owner's position (for
example its ring slot) across `wait_expired`, so a late owner retries without
losing its place.

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


**Amendment v2: cold admission and observation duty.** The warm bound remains
`N*S+Q<=5000`, where `Q=quantum.maxMs`. Cold admission additionally requires
`(N+C)*S+Q<=5000`. `C` is the maximum number of fresh resident admissions in
any rotation of a complete observation sweep, starting with an empty resident
cache. Simulate the existing writer cache by physical selection and constructor
identity: each cache miss consumes one admission slot before that lane's work.
Compatible intents share a resident. One selection has `N=2,C=1`; two independent
residents have `N=4,C=2`; two incompatible constructor identities replacing one
writer can require `C=3` in a rotated sweep. Do not assume `C=1` globally.
The host registers one pump per owner with one projection (`types:["memory"]`).
That one selection expands to current and history lanes sharing one resident:
`N=2,C=1`. With `pollMs=25`, one selection per pump at Q=1,000 remains accepted:
`(2+1)*1000+1000=4000`, leaving a 1,000 ms margin. For one selection,
Q≤1,250 is accepted; Q=1,251, 1,500 and 1,600 refuse `invalid_input`.
Several selections in one pump are refused at Q=1,000. For example, two
independent residents (`N=4,C=2`) with `pollMs=25` accept only Q≤714:
Q=714 is accepted and Q=715 or 1,000 is refused. The full newly refused class is
`N*S+Q<=5000 && (N+C)*S+Q>5000`.
This supersedes the preceding same-turn opening-headroom description.

Deadline lookahead includes actual non-observing admission slots and preserves
minimum start spacing. Admission completion runs cadence accounting, retaining
observation timestamps and missed flags. It never resets duty or clears a miss.
Continuous window handoff retains admitted handles and deadlines. An opening
failure earns no observation; actual missed duties remain visible. The extra
slot commonly delays first work by one spacing interval, with no commit-to-ready
latency guarantee at window or authority boundaries.

**Amendment v3: waiting, cadence and handoff.** Close, supervisor stop,
accepted same-window renewal or window handoff, authority/window cutoff and the
wait deadline abort the queued ticket. Rejected renewal does not cancel it.
A queued cancellation or `defer` releases `withdrawn` exactly once, with no
quantum, reservation, charge/refund, failure, ordinal, sample, observation,
cursor advance or pending-usage acknowledgement. Withdrawal is final; a late
grant is ignored without another callback. A grant already observed in the
abort race remains owned until declined or settled. Late results dispatch
nothing. Deferral alone keeps public status `active` with `error:null` and
completion pending; real stop, expiry or exhaustion keeps its existing outcome.
A separate retry-not-before clock preserves normal pacing without overdue
zero-delay spin. The selected lane remains pending.

While waiting, the turn holds only its pump's lifetime supervisor live record
(and any already-resident maintainer), with no lock, transaction, reservation
or new open, so a longer wait delays only that owner's own turn.

Cadence is checked before admission, after waiting/deferral/cancellation,
before accepted renewal replaces duty, and at settlement. Waiting earns no
observation, clears no missed flag, resets no duty and extends no authority or
window. Each real overdue observation interval counts once. Prompt window
succession retains the resident; cancelling its old queued request forces no
reopen. An inactive succession increments the resident epoch, but predecessor
drain and successor open wait for the next granted turn. Renewal does not abort
executing work merely to cancel a queue wait.

Warm and cold admission arithmetic remains unchanged. For observation duty,
broker waits add to the cold bound: `sum(waits)+(N+C)*S+Q<=5000`. One selection
at Q=S=1000 has N=2 and C=1, leaving 1000 ms of conservative wait headroom per
sweep. Deployment scheduling and disposal capacity require separate
qualification; waiting can cause honest cadence misses without pump failure.

At the 2,000-ms default, one lexical sweep's worst case is
`Σ waits + (N+C)·S + Q` against the 5,000-ms duty. With one pump per owner,
two lanes and one resident, N=2, C=1 and Q=S=1,000: two full warm waits give
`4,000+2,000+1,000=7,000 ms`; three full cold waits give
`6,000+3,000+1,000=10,000 ms`. Thus even one owner has no worst-case duty
guarantee if every wait consumes the default. For owners sharing one core under
a one-quantum-at-a-time broker, three owners can each wait 2,000 ms behind two
full 1,000-ms turns; their six warm lexical work turns alone take 6,000 ms,
so at three owners the 5,000-ms duty is knowingly missed under full occupancy.
Cold admission adds three more turns (9,000 ms total); even two cold owners
need six turns (6,000 ms). These are capacity facts, not contract violations
(§7); shorter waits and turns can support more owners.

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

**Amendment v1: lexical maintenance window handoff.** For the lexical
maintenance pump, a new window accepted within one quantum (`quantum.maxMs`)
after every previous ledger's end also preserves observation deadlines, order
and the resident. Authority expiry and settled spent quota still start a new
interval, as does a longer window gap; the next reserved quantum drains and
reopens the resident. A resident whose observation has been idle for 60,000 ms
may already be disposed and also requires reopening. Same-window renewal and
rejection of overlapping windows are unchanged. The embedding-enabled pump's
renewal rule is unchanged.

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


**Amendment v2: private admission diagnostics.** Lane phase counters append
`admission`; `open` measures resident opening and `refreshCall` measures work
turns. First/latest quantum samples include `turn:'admission'|'work'`, their
own quantum number and dispatch/opening ordinals. Admission turns record no
`refreshCall` or `epochObservation` sample. The stall vocabulary appends
`admission=12`, and the closed failure vocabulary appends
`open_exceeds_quantum`; existing numeric values remain unchanged. Admission
is distinct from incremental work and COMMIT; failure stages also admit
`admission`. Older private consumers may
treat unknown kinds as unavailable. Dispatch, RPC, delivery and settlement
intervals overlap and must not be added as an elapsed breakdown.

**Amendment v2.1: pump factory host seams.** The internal
`createMaintenancePumpRuntime` factory accepts the dependency options below.
These do not add public renewal options.

| Dependency option | Contract | Purpose |
| --- | --- | --- |
| `open` | Supported host seam | Open the maintainer for a reserved turn. |
| `admit` | Supported host seam | Dispatch non-observing lexical admission. |
| `work` | Supported host seam | Dispatch lexical refresh work. |
| `observedAt` | Supported host seam | Read the native observation timestamp from the work result. |
| `stallOf` | Supported host seam | Read private stall diagnostics from a handle, control or result. |
| `setTimer` | Supported host seam | Schedule pump turns and watchdogs. |
| `clearTimer` | Supported host seam | Cancel the corresponding scheduled timer. |
| `now` | Supported host seam | Supply monotonic milliseconds in the observation clock domain. |
| `receiptOf` | Test-only | Inject private admission receipts. |
| `admissionIdentity` | Test-only | Inject admission-domain identities. |
| `phasesOf` | Test-only | Inject private phase diagnostics. |
| `cutoffQualified` | Test-only | Exercise gated cutoff recovery. |

The default `admit` and `work` look up private dispatch by the engine's native
maintainer identity. The default `open` returns that native handle. A host that
returns a wrapper must inject **both** `admit` and `work` and unwrap to the native
maintainer in each bridge. Both injected bridges are trusted to do so. If only
one is injected, the remaining default still requires a native handle: a
non-native handle is rejected on the first open before either dispatch runs.
Preserve lazy close descriptors and the original close function's identity so
the existing disposal and timeout-disposal rules continue to apply.

Lexical pump turns call `admit` and `work`, not `refreshContextIndex`. A host
observes refresh input (including `intent` and `readSet`) and results through
`work`, then reads observation timing through `observedAt`. Pass the same result
object through both seams to retain its native observation metadata. Admission
earns no observation. The semantic pump does not use these dispatch seams.

When either dispatch remains default and `open` returns a non-native maintainer,
the lexical pump fails terminally on its first open with public
`error:'invalid_input'` and private cause `maintainer_identity_unrecognized`.
This cause is appended to the private failure vocabulary; existing failure and
stall numbers remain unchanged. The opened handle follows existing disposal
rules, with no admission retry, hold or backoff, and no subsequent open or
observation. Only the existing opening reservation is charged. No public code,
state or option is added.

**Amendment v2.1 addendum: semantic turn dispatch.** With a `preQuantum` port,
the semantic pump now honours the same `admit` and `work` host bridges for
turn-bearing reader dispatch. Status uses `admit`; refresh uses `work`. Native
maintainers accept default dispatch. A host wrapper requires **both** trusted
bridges, each unwrapping to its native maintainer through the host's mapping.
If either bridge remains default, an unrecognised wrapper fails on the first
open, before dispatch, with public `invalid_input` and private
`maintainer_identity_unrecognized`, exactly as in the lexical pump. Preserve
the lazy original close descriptor for the existing disposal proof. Without a
port the semantic pump retains its existing public-method dispatch.

**Amendment v3: private turn diagnostics.** The lexical private diagnostic
adds saturating `deferredTurns`, `turnWaitMs` (including a pending wait),
`declinedTurns` keyed by the seven closed reasons, `turnPhase` (`idle`,
`waiting`, `running`, `settling`, `poisoned`), `missedObservations` and
`admissionHold:{held,attempts}`. These have fixed cells and no growing history.
The existing public status/completion DTO and cadence-miss meaning are unchanged.
Waiting stays outside quantum histograms, ledger elapsed time and stall markers.
Consumers may treat unfamiliar diagnostic fields as unavailable.

**Amendment v3: wait-expiry diagnostics.** `declinedTurns` also includes the
fixed `wait_expired` cell. Saturating `admittedTurns` counts granted turns that
pass the local recheck and start, including open-only admissions; declined
grants do not increment it. The stall signature is
`declinedTurns.wait_expired` rising while admitted turns stay flat. A lexical
lane's gap over 5,000 ms still increments `missedObservations` and the existing
`cadenceMisses` once until a real observation. Repeated expired grants never
call the injected `observedAt`, so the host's freshness signal goes stale while
public status stays `active` with `error:null`.

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


**Amendment v2: bounded admission failure.** An opening or writable admission
that cannot settle inside its original reserved cutoff is classified privately
as `open_exceeds_quantum`, with no observation or refund. The attempt terminates
with the existing `read_timeout` mapping and drains under the disposal bound
and proof rules above. Failed proof takes `reader_failed` precedence and retains
quarantine. No replacement is admitted before confirmed disposal. This grants
no work-cutoff recovery authority; the qualified-patch gate remains empty.

After confirmed disposal, ordinary authorized renewal may attempt admission
again, subject to a process-memory gate per physical sidecar and capacity/cache
epoch: an initial attempt has at most two automatic retries, waiting 5,000 ms
and then 30,000 ms after confirmed disposal. Exhaustion holds admission until
Q, the physical cache identity or its file length changes; row updates alone
do not recharge the allowance. Physical identity includes file birth identity
so recycled inodes do not inherit a removed cache’s hold. Owner, selection, pump ID, renewal and window
replacement cannot recharge it. Unproven disposal cannot be cleared by a
capacity change. Fresh admissions serialize per physical sidecar through settled completion.
State has fixed cells with 1,024-location and 1,024-capacity-record caps; held or quarantined
entries are never evicted to make room. Distinct Q values keep separate retry
counters while sharing physical admission ownership and quarantine; inspecting
another capacity never recharges a previously held capacity. No sidecar DDL, format 3, `user_version`
or other on-disk state changes. Existing sidecars continue to open unchanged.

`maintenancePumpDiagnostic(status).admission` exposes a bounded per-lane private
snapshot with `{cause:'open_exceeds_quantum',attempts,state,retryAtMonoMs}`;
`state` is `disposing`, `backoff`, `held` or `quarantined`, and a lane with no
failure has null. Thus a held owner is visible to product logging and monitoring
without a new public code or DTO field. The gate survives pump replacement in
the same process. Process replacement loses this memory; a host must preserve
its conservative admission hold with its own ledger rather than recharge retries
through process restarts.

**Amendment v3: settlement, release and poison.** A granted ticket is held
through observation, original-ledger settlement and bookkeeping, or through the
open-only zero-work settlement. Failure/timeout/stop joins shutdown disposal
before `release('settled')`. Replacement holds the same grant across predecessor
drain, successor open and writable admission. Late opens and opening-error
cleanup IDs remain owned through their disposal join. A cutoff response,
termination request or proof deadline is not proof. The production lexical
recovery gate remains disabled; internal qualified test paths use this same
release barrier. A healthy cached resident need not be disposed after success.

A factory throw, malformed ticket or changed port shape is terminal
`authority_required`; no malformed ticket is invoked or released. Entry throw,
rejection or malformed outcome is also terminal `authority_required` and calls
the captured `release('withdrawn')` once. A changed port with a validated ticket
still uses its captured release after the applicable settlement/disposal join.
Caller error codes, names and text are never inspected or propagated. Each
release attempt is recorded before invocation. A release throw takes terminal
`reader_failed` precedence and poisons the claim; no second attempt occurs.
Failed or unproven required disposal withholds release and poisons the claim.

Native Promise entry uses the captured `Promise.prototype.then`, bypassing a
throwing `then` accessor. Constructor or species lookup can still throw; the
engine fails with `authority_required` and one withdrawal, without further
accessor calls on the returned value or another adoption attempt. No rejecting
wrapper is created. A host whose `enter` returns a rejected Promise with a
throwing `constructor` leaves its own rejection unhandled, which the engine
cannot observe; default Node rejection handling can terminate the process.
The same residual applies if species lookup throws before handlers attach.
[ECMAScript `then`](https://tc39.es/ecma262/2025/multipage/control-abstraction-objects.html#sec-promise.prototype.then)
steps 3–5 perform species lookup before handler attachment;
[`SpeciesConstructor`](https://tc39.es/ecma262/2025/multipage/abstract-operations.html#sec-speciesconstructor)
steps 1 and 4 read constructor and species. `Promise.resolve` and
[`await`](https://tc39.es/ecma262/2025/multipage/control-abstraction-objects.html#await)
(step 2) both use
[`PromiseResolve`](https://tc39.es/ecma262/2025/multipage/control-abstraction-objects.html#sec-promise-resolve),
whose step 1.a reads a native Promise's constructor;
combinators call the resolver and then invoke `then`. These provide no general
way to attach a rejection handler without constructor or `then` lookups.
Resolving a fresh wrapper with that value instead reads its `then` property
([Promise Resolve Functions](https://tc39.es/ecma262/2025/multipage/control-abstraction-objects.html#sec-promise-resolve-functions),
step 9); it does not bypass these lookups. A frozen
Promise can also prevent replacing its constructor. `PerformPromiseThen` is
an internal abstract operation, not an ordinary JavaScript API.

Poison is held in the JavaScript realm that loaded the engine (the main thread
or one Worker), like the reader supervisor's quarantine and the open-only
admission state. It is keyed by the port object and the physical sidecar
identity used by open-only admission, retaining location identity for missing
files and physical aliases as they become known. A host must keep all lexical
pumps for one sidecar in one realm; each pump uses the port of the realm that
calls its renewal, as specified in the turn contract. Admission-domain
retirement, quota/capacity changes, new windows and new pump IDs cannot clear
poison. There is no eviction, TTL, renewal or reset API. Restarting that realm,
or the process, clears poison. A host that sees `turnPhase:'poisoned'` should
restart the process. "Process memory" in the open-only package's Amendment v2
means this same realm scope.
A host must not hand an owner's sidecar to another realm while the first
realm's claim or fences are still live. It may hand it over only after the
original cleanup has completed, or by restarting.
Cross-process exclusion remains host-owned; a grant does not replace its
existing physical gate or change collision refusals.

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


**Amendment v2: zero-work settlement.** Lexical admission reserves the full
ordinary item/time quantum before any drain or open; insufficient quota or a
short authority/window tail cannot authorize a partial turn. Its private
zero-work receipt expects no observation and is not a refresh result. Only a
fully settled successful admission refunds all reserved items and unused
milliseconds to the original ledger, preserving old and renewed host floors.
Charge `ceil(disposal+open+admission+delivery+pump settlement)` milliseconds
from the common start/cutoff, never by summing overlapping diagnostic intervals.
Failure, interruption or uncertain settlement retains the full reservation.
The admission RPC receives only the remaining original cutoff; the following
work turn reserves its own full quantum. No fresh Q starts inside an admission
turn. The semantic-pump contract below is outside this lexical amendment.

**Amendment v3: lexical charging boundary.** Broker waiting, withdrawal,
deferral and post-grant decline consume no quantum allowance or quota. A grant
that passes the recheck starts a fresh full Q and the existing full reservation
before drain/open. Open-only and work turns each get their own ticket and
quantum. Zero-work settlement, original-window refunds, renewed cumulative
floors and conservative full charges for uncertain work remain as above. No
quantum policy, reserve arithmetic or disposal rule changes. This amendment
makes no semantic-pump turn or settlement guarantee.

A pump with `semanticConfig`, including `modes:['lexical']`, applies the same
five-second canonical selection/intent observation duty to lexical refreshes. Its private
`maintenancePumpDiagnostic` reuses `{cadenceMisses,worstGapMs,observation}`
with the lexical shape above; `projection` indexes the expanded intent/mode
lanes. Embedding, status and validation turns earn no observation credit.
It skips window/renewal tails that cannot fit its configured
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
Turn starts are separated by at least
`S = max(pollMs, quantum.maxMs, firstCoverageValidation.maxMs)`. Capacity pacing
spreads nominal full reservations over a minute, subject to lexical-deadline
lookahead through every intervening work slot. Startup status uses a finite
cursor interleaved with regular turns; validation gets one bounded batch per
sweep, retaining its durable coordinator cursor and `firstCoverageValidation.maxMs`.
Each overdue lexical duty counts one miss until a successful actual observation
resets that duty. Lateness is nonterminal; scheduling recovers at normal spacing.
A successful `rebuilding` turn advances the cursor and observation duty.
Coordinator controls share the selected turn deadline; a reply cannot start a
fresh quantum. Cold open remains inside the charged reserve-to-finish span.
Canonical selection/intent observation duty belongs to lexical refreshes only;
embedding, status and validation work use capacity without earning observation
credit. Semantic coverage lag concerns recall. Unsuccessful turns and genuine
semantic cutoffs remain terminal. The lexical cutoff exception stays disabled.
Coordinator close uses the reader's existing 10,000-ms graceful-disposal bound.
Pending coordinator calls settle as `store_closed`; after that bound the parent
terminates a Worker whose provider or host close has not settled and waits at
most another 1,000 ms (`TERMINATION_GRACE_MS`) for termination. Coordinator close
therefore waits at most 11,000 ms (10,000 ms grace + 1,000 ms termination), plus
event-loop scheduling delay. The termination allowance covers the engine's
980-ms maximum SQLite WAL busy wait with headroom; normal Worker termination
is much faster. Native statements and host code can still outlive this allowance.
A forced or unproven close rejects with `reader_failed` and retains the existing
quarantine; only the unchanged four-bit disposal proof permits successful
cleanup. This bounds delivery of close, not the lifetime of a thread stuck in
native code.
While that thread holds ownership, another process receives `storage_busy`.
Same-process reopening receives `reader_failed` without invoking the host's
`confirmDisposed` or acquiring ownership, including after the thread exits;
quarantine lasts until process restart.

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
accepted only at or after the previous one ends; the lexical handoff amendment
above defines when that succession retains the observation interval and resident.
Restarting a handle/pump within a
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
such proof. The engine calls `confirmDisposed` and performs recovery
compare-and-swap only while holding the owner's SQLite ownership transaction,
for both prepared anchors and outstanding reservations. A contended ownership
open refuses with `storage_busy` without calling `confirmDisposed`. Opening
failure after acquisition releases ownership through ordinary disposal. Failed
opening returns a supervised `cleanupId`; await its drain
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

An embedding refresh reuses the published, complete vector generation when its
publication evidence verifies and the lexical validation digest, vector identity
and owner purge epoch all match. The pointer and validation record must be valid
and bound to the expected owner, projection and generation.
It keeps the publication ID, generation sequence and checkpoint, creates no
new generation or validation record, and does not repeat certification.
Unpublished work and partial coverage retain their existing planning and
publication behaviour. Forget, correction and a new lexical publication change
the lexical validation digest; representation is part of that digest, while
embedder identity and owner purge epoch changes invalidate reuse directly.
On safety layouts v34, v38 and v48, S2h-2 product reads enforce suppression at
read time through the owner-epoch fence. Sequential and overlapping reads exclude
the suppressed target independently of vector publication rotation or reuse.
The required `overlapping suppression excludes the semantic-only target from
${method}` and `sequential suppression excludes the semantic-only
target from ${method}` tests cover `findCandidates` and
`contextRead` on cells 34 and 38. On unmigrated layouts v18, v23 and v33,
behaviour is unchanged from main `6d8ced65`: there is no suppression epoch or
read-time suppression fence. Canonical forget, correction and deletion checks
still apply; publication reuse does not add a suppression guarantee to those
layouts.

Public status and refresh DTOs expose lexical progress, not vector publication
IDs or vector generation checkpoints. Private vector pointers and validation
records retain their IDs and generation checkpoints on a no-op; provisional
coverage hints retain the corresponding certificate digest. Existing owner
coverage and purge checkpoints keep their separate meanings.

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

A semantic pump supplies `semanticConfig`, the separate
`semanticServiceCredential`, `firstCoverageValidation:{maxTargets,maxMs}`,
`projections[].modes:['lexical','embeddings']`, and `maxUsd` to budgets/quantum
plus `usedUsd` to its window. Arithmetic admission requires
`(N+1+2T) × S ≤ 5000`, where `N` is the expanded regular intent/mode lane
count, `T` is the initial target-descriptor count, and
`S = max(pollMs, quantum.maxMs, firstCoverageValidation.maxMs)`. This guard is
unchanged. The initial last lexical slot precedes validation; startup slots
retire as they complete, leaving observation headroom for the full lexical
quantum. A pump without `semanticConfig` instead requires `N*S + Q ≤ 5000`, with
`S = max(pollMs,Q)` and `Q = quantum.maxMs`; Amendment v2 additionally
requires `(N+C)*S+Q<=5000` for its non-observing cold admission slots.

For one selection with both intents and both modes, `N=4`, `T=1`: seven slots
allow `S=714` ms (`7 × 714 = 4998`); the next integer, 715 ms, is refused
(`7 × 715 = 5005`). An explicit admissible semantic pump configuration is:

```js
const pump = renewContextMaintenancePump({
  supervisor, id, serviceCredential: projectionServiceCredential,
  semanticConfig: { version: 'context-read-product-p2e-v1', coordinator },
  semanticServiceCredential: ownerSemanticCredential,
  projections: [{ options: maintainerOptions, types: ['memory'],
    modes: ['lexical', 'embeddings'] }],
  window: { id: windowId, endsAtMonoMs, usedItems: 0, usedMs: 0, usedUsd: '0' },
  budgets: { maxItems: 128, maxMs: 10000, maxUsd: '0.50' },
  quantum: { maxItems: 1, maxMs: 714, maxUsd: '0.01' },
  pollMs: 100, renewalMs: 60000,
  firstCoverageValidation: { maxTargets: 1, maxMs: 714 },
});
```

The two 1,000-ms examples above are standalone operations, not settings for
this pump. Arithmetic admission is not actual five-second cadence qualification:
measure fresh lexical observation gaps under deployment load, including cold
open, control transport, resident drain and delivery. A passing configuration
alone supplies no timing evidence. Late successful observations record misses
and continue; unsuccessful authority, storage and timeout results remain
terminal and retain their full reservation.

Validation retains time capacity after paid item/USD exhaustion; lexical turns continue when
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

## Suppression-aware progress (S2h-2, contract v1, 2026-10-31)

On safety layouts v34, v38 and v48, when the selected owner has a nonzero
suppression epoch, refresh returns `null` for each of
`progress.lexical`, `progress.transformed`, `progress.embeddingAttempts` and
`progress.embedded`; `coverage.stops.budget` and
`coverage.maintenance.progress` are also `null`. For every requested type,
`coverage.byType[type].embedded` and `embeddedFraction` are `null`. Status
returns `lexical.progress:null` and
`coverage.byType[type].embedded:null` (including semantic coverage's embedded
count when present). These rules apply even when the projection is `ready`,
refresh is `complete`, no hidden item matches the query, or the fact's cleanup
has completed. An owner epoch is retained after cleanup; it is not evidence
that physical cleanup finished or that a particular item remains hidden.

`eligible` and `indexed` count only visible items, after the serving predicate;
they never include suppressed items. If a bounded visibility proof cannot
establish a count, that count is `null`. Other existing reasons for unknown
counts and progress still apply. Owners with no suppression epoch keep the
ordinary progress contract; legacy layouts have no suppression epoch. These
rules describe permitted result DTOs; an erased owner or namespace still
refuses the request.

Null usage prevents hidden-population disclosure. The existing maintenance pump
cannot refund an unknown `progress.transformed`: it keeps the full item and time
reservation for that quantum, including an idle quantum. This contract changes
neither the pump nor its inputs. Reservation/refund policy is pending the
separate performance-track decision.


## Receipt event dates (addendum v1, 2026-11-03)

Select dates per call with the top-level field
`contextRead({ ...input, representation: 'representation-v2-dated' }, credential)`.
The default remains `representation-v2`; unknown ids refuse `invalid_input`.
`assembly.representations` advertises both ids, and assembly diagnostics report
the selected id. Candidate/index diagnostics and stored `candidate-text-v1`
content are unchanged.

Each dated Memory item may contain `date` immediately after `rank`, for example
`"rank":1,"date":"2023-05-22T05:54Z"`. The date is outside `ref`, whose keys and
bytes remain unchanged. It is the earliest non-null event time among exactly
the existing v2 source receipt rows: the first 16 in `created_at,id` order,
filtered through visible receipt metadata. A receipt outside that recorded-order
window never supplies the date. Source-access denials and Card omissions apply
unchanged; Cards do not receive dates.
Items are emitted in date order, earliest first; undated items follow in
relevance order. Date ties keep relevance order, and `rank` is relevance.
Selection still visits items and sources in relevance order. Every trial must
fit both the token budget in emitted date order and a reader-supplied upper
bound on the complete 65,536-byte response, including snapshots and diagnostics.
A trial over either budget is omitted and sets `stops.budget`; near-limit reads
may therefore select different sources or items than v2. Byte-only rejections
add no counter calls. The outer response-size gate remains defensive.
Old-layout stores without dates keep v2 item order.

Dates are UTC instants truncated to the minute, ending in `Z`. No time-zone
input or recorded-time fallback is supported. Null times or layouts without
the receipt event-time column omit the key and still report the dated id.
Selection adds no SQL, fence input or counter visit; the 16-receipt bound is
unchanged. Storage migration is separate. See contract §15.9 for the lifecycle
safety guarantee and the existing window limitation above 16 receipts.
## Lexical admission and physical binding (amendment v2.2, 2026-11-05)

Private lexical admission authenticates the stored publication and progress
certificates against the current physical identities of the canonical store
and sidecar. A copied or relocated cache with foreign bindings is replaced
through the existing lifecycle-checked replacement protocol. Admission reopens
the fresh, empty cache and completes its integrity checks before returning
`admitted`. Copied publications are never rebound or re-signed. Admission earns
no observation; later ordinary work turns rebuild the corpus and reuse an
admitted writable connection. All authority, companion, journal, lifecycle-lock
and original-cutoff checks still apply. A repair that cannot complete safely
within that cutoff fails explicitly. Unproven disposal remains quarantined
and cannot authorize a replacement.

Replacement drops all derived state in the shared sidecar, including vectors.
Re-embedding takes time and, with a hosted embedding service, incurs embedding
spend. Canonical content is retained.

The lexical pump counts admission-to-`required` cycles without an accepted
observing work turn, separately for each lane in the physical admission domain.
This process-memory count survives renewals, quota windows, capacity changes
and new pump IDs. Successful admission alone does not reset it; an accepted
observation for that lane does. After a `required` yield the cursor advances
fairly so other lanes continue receiving turns.

At three cycles the pump settles with public `state:'failed'` and
`error:'reader_failed'`. Its private failure cause is `admission_no_progress`,
with the zero-based `lane` and cycle `count` (three at failure). Before the
terminal failure, `maintenancePumpDiagnostic(status).admission[lane]` exposes
that same cause, lane and current count. Existing private disposal and admission
retry state remains present when applicable. The public status shape, options
and error vocabulary remain unchanged.

The `admission_no_progress` terminal state is held in process memory per canonical
store location and lane. A new pump for that store and lane in the same process
fails at its first dispatch with the same public `state:'failed'`,
`error:'reader_failed'` and private cause `admission_no_progress`; replacing or
discarding the sidecar in the running process does not clear it. Hosts must treat
this as terminal and must not reopen it in-process. To recover, restart the
process. If the failure recurs after a restart, stop every process holding the
store, close admissions, stop clients and maintenance, await all supervisor
drains, and use the host's explicit cache discard procedure to delete the
quiescent product sidecar together with its `-journal`, `-wal` and `-shm`
companions. Keep canonical storage and the lifecycle lock intact, then start
again with independently authorized maintenance and complete both intents before
exposing search. This costs a full lexical rebuild plus re-embedding of vectors:
time and, with a hosted embedding service, embedding spend. Never unlink a live
sidecar or its companions.

Replacement waits until no other connection for that store is open in the
process; each refusal counts as a no-progress admission cycle until those
handles close. The lifecycle lock excludes other processes’ active operations.


## Admission diagnostic shape (amendment v2.3, 2026-11-06)

`maintenancePumpDiagnostic(status).admission[lane]` keeps the admission retry
status unchanged at its top level when present, including its `cause`.
No-progress state appears only as `noProgress: {lane, count}`.
`admission_no_progress` remains the private failure cause; private failure
records and the failure vocabulary are unchanged.

## Lexical checkpoint admission (amendment v2.4, 2026-11-06)

Lexical work turns price the complete next checkpoint transaction before
starting it: begin, bounded page or reset work, freshness checks, signed save
and commit, followed by the final fresh canonical observation and delivery
tail. Handle-local wall-cost high-water marks start with conservative defaults;
a transaction that cannot fit with that tail yields the turn with its existing
progress. Selection, generation setup, verification, publication and cleanup
writes use the same admission gate. The final snapshot and publication proof
still run after a yield.

The host quantum and its existing reserve are unchanged. An unseen, indivisible
commit that alone takes longer than the quantum can still overrun it; pricing
cannot interrupt a native commit. SQLite durability, signed checkpoint semantics
and failure reservations remain unchanged.

Fix round 1: pricing may decline only additional checkpoint transactions in a
work turn. The first work transaction (page/comparison, verification, publication
or cleanup) is always admitted under the existing rules, even when its estimate
cannot fit; setup-only transactions, including selection retention and generation
initialization, do not consume its admission. An indivisible
slow first commit can therefore overrun exactly as before. For each complete
transaction, remaining transaction, commit and doubled observation-tail sample,
the handle-local estimate is the maximum of its seed, the new sample and half
its previous estimate (one-observation half-life). Seeds are respectively 100,
100, 50 and 50 ms. The combined transaction-plus-tail estimate is capped at the
turn's usable budget after its unchanged reserve. No estimate can refuse every
start, and normal observations recover from an outlier.

## Lexical admission turn budget (amendment v2.5, 2026-11-07)

The lexical maintenance pump accepts optional `admissionMs`, defaulting to
`quantum.maxMs`. It budgets an entire admission turn, including cold open,
admission, delivery and settlement. Work and refresh retain `quantum.maxMs`.
An explicit value must be a safe integer at least `quantum.maxMs`, no greater
than `budgets.maxMs` or any projection's maintainer `deadlineMs` (default
5,000 ms), and no greater than `DISPOSAL_GRACE_MS - 2000` (8,000 ms).
Invalid values fail with `invalid_input` at pump creation. The budget
is fixed across renewals of the same pump.

Admission reserves `admissionMs` and the usual quantum item allowance in the
window ledger before dispatch. Successful admission refunds the item allowance
and settles time to elapsed usage; uncertain or failed settlement retains the
full reservation under the existing rules. Admission must fit the remaining
window quota, window lifetime and renewal authority, including after a broker
wait. It earns no observation.

The five-second observation cadence still applies. Let `L` be the expanded
intent lane count, `C` the maximum cold resident replacements in a sweep,
`S = max(pollMs, quantum.maxMs)` and `A = max(pollMs, admissionMs)`.
Configuration requires `L*S + C*A + quantum.maxMs <= 5000`; scheduling prices
each admission slot at `A` and each work slot at `S`. With one projection
(two intents), one cold slot, a 1,000 ms work quantum and polling at most
1,000 ms, the largest feasible `admissionMs` is 2,000 ms. A 5,000 ms admission
budget is infeasible and fails with `invalid_input`. A host on a slower volume
can opt in within these bounds without extending its work quantum.

## Sidecar integrity attestation (amendment v2.6, 2026-11-07)

Writable admission and read-only opens verify a keyed attestation before using
an existing cache. Its HMAC key is derived from the store's cursor secret with
the `sidecar-attestation-v1` domain. The certificate binds device, inode, birth
identity, the sidecar format, engine profile, and an in-file monotonic stamp.
Size and modification time are excluded. Every parent logical sidecar write transaction
increments and signs the stamp before COMMIT, including lexical and vector
writes, verification resets, publication, garbage collection,
and explicit reset. A rollback restores the previous matching stamp and seal.

Bounded incremental vacuum retains its existing autocommit boundary. It changes
page placement and the freelist, leaving logical rows, the schema cookie, file
identity and seal unchanged. A crash after reclamation and before the next
logical write therefore leaves a matching seal. The next logical write advances
the stamp in its existing transaction. Vacuum adds no explicit BEGIN or COMMIT.

Standalone admission of a newly initialized cache has no projection write to
share: its first parent seal uses one initialization BEGIN/COMMIT pair. This is
a first-open cost, including after replacement; matched admissions and steady
maintenance turns add no transactions.

A second one-time exception is the first-open migration of an existing legacy
WAL cache. Standalone admission with a missing seal row uses 5 BEGINs, 4 COMMITs
and 1 write BEGIN; a missing seal table uses 6 BEGINs, 5 COMMITs and 1 write BEGIN.
Both compare with 4 BEGINs, 3 COMMITs and no write BEGIN before attestation.
These parent counts include canonical and lifecycle reads. Authenticating the
old bindings inside the sealing writer transaction adds one canonical read pair
for the missing-table case; it needs no separate sidecar read transaction.

A reader opened after a mismatch is detected never serves the untrusted file;
a reader opened before an out-of-band seal removal keeps serving until its next
reopen (content safety by delivery revalidation).
Invalidating serving handles on rejection is a planned follow-up.

DELETE-mode caches with a missing or invalid seal use the existing excluded
replacement protocol, then perform the normal bounded, checkpointed rebuild
before publication. WAL-mode hosts pay main's integrity check once on the first
open after upgrade; DELETE-mode caches rebuild once. A missing WAL seal means
no attestation table or no singleton row. A healthy host-configured WAL cache
runs `quick_check` and `foreign_key_check` inside the first write transaction,
before the DDL and the seal. A missing-table upgrade retires the old
schema-bound publication/progress records in 128-row slices in that transaction.
The aggregate migration cost scales with the number of legacy pointer and
certificate rows. On a direct refresh it may exceed one turn, including a turn
that performs no corpus work. Admission and readiness are separate: the
missing-table upgrade retires the old schema-bound publications, so lexical
reads are not ready until normal maintenance republishes. Missing-row upgrades
preserve publications. A bounded multi-transaction migration is a planned
follow-up.
A rollback leaves the seal missing, so the next open checks again. An attested
WAL open runs zero whole-file statements. A present but invalid WAL seal is
refused under the existing non-DELETE rule, without a whole-file check.
Under lifecycle exclusion the replacement child checks the parent's exact-row
SHA-256 verdict again; a changed row or file stamp refuses replacement with
ESTALE. This attestation verdict needs no whole-file integrity check. Other
corrupt verdicts retain the existing child integrity checks and foreign-binding
certificate recheck. Neither the cursor secret nor its derived key reaches the
child. The child initializes an unsigned empty cache; the parent seals its first
write transaction against the identity verified on its opened connection. A
crash before that write leaves an unavailable empty cache. Its next writable
open replaces it again in DELETE mode; a host-configured WAL cache follows the
missing-seal check described above. If the first-seal COMMIT keeps failing, each
admission attempt makes exactly one replacement, fails closed with `storage_error`
and serves nothing; the maintenance pump stops on that error and does not retry
by itself, so retries are paced by the host starting the next pump. The admission
quarantine does not apply to this failure.

Previously every writable cold open ran SQLite `quick_check` and
`foreign_key_check` over the entire cache. These audited database structure,
constraints, and referential consistency. The cache is derived data: candidates
are re-fetched from canonical storage and revalidated at delivery, and existing
`SQLITE_CORRUPT` classifications still route to repair. The keyed seal permits
bounded admission without repeating those whole-file statements. Status and
coverage from unverified files confer no readiness or serving authority.
