# Bounded asynchronous Memory topic overview

`openMemoryReader` reads Memory MOC metadata from the existing local SQLite
store without a model, tokenizer, Memory body or receipt scan. Native SQLite
work runs in a fixed internal Worker. It does not change model-facing `map`
or enable a product feature. The trusted host authenticates the owner.

```js
import { openMemoryReader } from './core/index.mjs';

const reader = openMemoryReader({ path: '/private/existing-memory.sqlite', ownerId: 'local-user' });
try {
  const namespace = { ownerId: 'local-user', scope: 'personal', projectId: null };
  let cursor;
  do {
    const result = await reader.readTopicOverview({ namespace, ...(cursor ? { cursor } : {}) });
    if (!result.ok) throw new Error(result.error.code);
    const page = result.value;
    if (page.coverage.countsComplete) console.log(page.items, page.totals);
    if (!page.coverage.complete && !page.nextCursor) {
      throw new Error(`Overview incomplete: ${page.coverage.reason}`);
    }
    cursor = page.nextCursor;
  } while (cursor);
} finally {
  await reader.close();
}
```

The constructor validates own-data options synchronously and opens no file or
Worker. The first asynchronous read opens an existing permission-safe regular
file with native `readOnly`, `query_only` and `trusted_schema=OFF`. DELETE
keeps a zero busy timeout. WAL uses one Worker-owned native lock-wait budget:
the remaining request deadline capped at 1000ms, minus a 20ms reply reserve
(at most 980ms configured native waiting, floored at zero); each
prepare/execution refreshes the remaining budget, including opening and fences. It rejects symlinks, missing files, unsupported application/layouts and
missing or malformed required indexes. Supported existing schemas are exactly
18, 20, 21, 22, 23, 29, 30, 31, 32 and 33; intermediate Raw layouts 24–28 are not accepted.
It never creates, migrates or changes journal mode. Validation covers consumed
Memory/index metadata and access paths, not the integrity of every Raw, Card or
local-authority table. The ordinary write opener and its migration behavior
remain unchanged.

Schema 29 uses the same Memory MOC authority when public Raw capture has created
the Memories and receipts. It does not read Raw text, receipt excerpts or Card
bodies, grant retained-source access, or interpret capture consent. Correction,
forget and source deletion affect the resulting Memory revisions/visibility and
invalidate old overview cursors. A Memory with surviving independent support
may remain visible after one conversation is deleted; this does not expose the
removed source or establish semantic corroboration.

Read-only means no engine data mutation, not immutable SQLite coordination
bytes. Main database and existing WAL bytes remain unchanged during a quiescent
read. A first native read-only WAL reader may maintain SHM read marks at byte
offsets 100–119, as documented in [SQLite's WAL format](https://sqlite.org/walformat.html).
Focused tests compare a bare native control with the public reader, constrain
changes to that region and require warmed whole-file equality. Do not restore
SHM bytes, change journal mode or use SQLite's immutable flag on a live store.

## Input bounds and output

Each request accepts one exact namespace matching the reader's owner. Project
scope requires its nonempty `projectId`; personal scope requires `null`.
Unknown fields, symbols, accessors and non-plain objects are rejected without
invoking property getters.

| Option | Default | Allowed |
| --- | ---: | ---: |
| `nodeLimit` | 100 | 1–100 |
| `maxBytes` | 65536 | 4096–262144 |
| `workLimit` | 5000 | 16–50000 |
| `memberLimit` | 0 | 0–10 |

`maxBytes` covers the complete UTF-8 success envelope, including its cursor.
Work limits constrain traversal, not only returned rows. Each success contains
`snapshot:{indexRevision,generation}`, `items`, `totals`, `coverage` and
`nextCursor`.

While aggregation is incomplete, `items` is empty, `totals` is `null` and
coverage is `{complete:false,countsComplete:false,reason:'work_limit'}`.
Continue with the opaque cursor and unchanged bounds. Once aggregation finishes,
nodes have exact counts; node/byte limits may still require multiple pages.
`coverage.complete` becomes true only on the final page. A wholly empty namespace
has exact zero totals. A state-budget refusal has `reason:'state_limit'`, unknown
counts and no continuation; restarting cannot turn it into exact zero.

Items are ordered L2 then L1, then binary ID. Each contains `id`, `revision`,
`level`, nullable `title`, valid L2 `parentIds`, `directCounts`,
`descendantCounts`, `latestMemberCreatedAt`, `lastMemberAddedAt:null` and
`addedAtCoverage:'not_recorded'`. Counts contain `total` and `byKind` for `fact`,
`preference`, `decision`, `instruction` and `context`.

L1 direct/descendant Memory counts match. L2 direct Memory counts are zero;
descendants deduplicate Memories filed under several child L1s. Namespace totals
contain unique and unfiled Memory counts. Unfiled means no valid projected L1
placement, even when a stale stored filing flag says otherwise. Empty projected
MOCs remain metadata nodes and may have null titles.

`memberRefs` is absent by default. When requested, it contains the first K unique
visible members in ascending Memory ID as `{memoryId,revision}`. This bounded
sample is not a member-list pagination API.

`latestMemberCreatedAt` is the largest creation time of currently visible members,
or null when there are none. It is neither edit time nor placement time. The
existing schema records no placement-added timestamp, so `lastMemberAddedAt`
remains explicitly unavailable.

## Visibility, progress and lifecycle

Only current, nondeleted, non-awaiting exact-namespace revisions contribute.
Reads respect active generation membership and valid revision-bound edges/refs.
Every original title-source binding must remain eligible and at its bound
revision; incomplete validation never releases a provisional title. Declared
unavailable, missing, foreign or unpublished generations return
`index_unavailable`.

One work unit visits an indexed physical keyset row or EOF, with at most three
indexed point validations, or performs one bounded in-memory ancestor/count
step. Physical visits are charged before eligibility filtering. Per-Memory L2
ancestors are deduplicated and then discarded; no per-topic all-Memory set is
retained. Each deferred read transaction stops after at most 64 units or 5ms
between units and commits before yielding. Sorting and envelope construction
happen outside that transaction. Indexed native operations may exceed a quantum
under OS contention; the Worker keeps them off the host main loop.

The reader retains one ephemeral traversal, with an 8MiB logical metadata budget
and a 64MiB Worker old-generation limit. A fresh request invalidates older
cursors. Cursors bind the store identity, owner/namespace, epoch/generation and
all bounds. Last-page replay on an unchanged snapshot is idempotent. Changed or
lost state gives `cursor_stale`; malformed cursors give `invalid_cursor`.

These bounds apply per reader handle, not to host-wide capacity or total RSS.
The trusted host owns authentication, the number of handles, concurrent work
and lifecycle. Aggregation incrementally scans namespace metadata; the reader
does not promise sublinear lookup or persisted materialized counts.

Only one read may be in flight per reader; another returns `read_in_progress`
without a queue. This does not gate other readers or writers. A request has a
five-second deadline (`read_timeout`). After sixty idle seconds the unref'ed
expiry timer terminates the Worker and invalidates its continuation. `close()`
settles pending work immediately with `store_closed`, makes future reads return
`store_closed`, and itself waits for native resources to be released. A native
SQLite call cannot be pre-empted, so this cleanup can lag public cancellation.
Worker failures return `reader_failed`, without source text,
paths, SQL or native error details. There is no hidden retry.

This is Memory MOC metadata, not Card MOCs, episode headers, a complete member
export, semantic relevance or truth validation. Product adoption and production
re-enablement are separate integration work. See the
[original E1 acceptance](plans/topic-overview-read.md),
[schema 29 compatibility contract](plans/topic-overview-raw29.md) and
[retained limitations](limitations.md).

## Exact bounded member pages (E1-M)

`reader.readTopicMembers` enumerates refs in one exact namespace. Select a
Memory MOC with `{type:'moc',mocId,revision,level:'L1'|'L2'}`, or select the
namespace's `{type:'unfiled'}` set. L2 pages deduplicate shared children and
attribute each Memory to the smallest valid L1 ID in unsigned UTF-8 order.
Unfiled means no valid L1 placement anywhere in that namespace.

```js
const issued = await reader.readTopicOverview({
  namespace, snapshotVersion: 'topic-snapshot-v1',
});
if (!issued.ok) throw new Error(issued.error.code);
// Finish overview continuations with the same snapshotVersion for exact counts.
const expectedSnapshot = JSON.parse(JSON.stringify(issued.value.snapshot));
const input = {
  namespace, selection: { type: 'unfiled' }, accessRevision: 'host-access-4',
  expectedSnapshot, limit: 100,
};
let cursor;
do {
  const result = await reader.readTopicMembers({ ...input, ...(cursor ? { cursor } : {}) });
  if (!result.ok) throw new Error(result.error.code);
  const page = result.value;
  console.log(page.items);
  if (!page.nextCursor && !page.coverage.complete) throw new Error(page.coverage.reason);
  cursor = page.nextCursor;
} while (cursor);
```

`accessRevision` is a required host-supplied identifier for effective access
configuration. It is a fence, not a credential. The host authenticates callers,
changes this revision when access changes, and closes the reader on revocation.
One pending call is shared across overview/member methods; independent handles
and writers remain independent. Member and overview traversals are retained
separately. A fresh traversal replaces only that method's cursor state.

| Member option | Default | Allowed |
| --- | --- | --- |
| `kind` | `null` (all) | `fact`, `preference`, `decision`, `instruction`, `context`, or `null` |
| `order` | `id_asc` | `id_asc` only |
| `limit` | 100 | 1–100 |
| `workLimit` | 5000 | 16–50000 |
| `maxBytes` | 65536 | 4096–262144 |
| `deadlineMs` | 1000 | 50–5000 |

Every success has `version:'topic-members-v1'`, `status`, `namespace`,
`selection`, `snapshot`, `kind`, `order`, `items`, `coverage` and `nextCursor`.
The snapshot contains `indexRevision`, `generation`, `originToken`,
`accessRevision`, and `configuration:'topic-members-v1'`. Each item is exactly
`{type:'memory',namespace,id,revision,kind,label:{text:id,source:'identifier'},reportedUnder}`.
`reportedUnder` is `{type:'l1',mocId,revision}` for filed selections and `null`
for unfiled. No body, preview, semantic label, total or token packing is read
or returned. Existing overview samples retain `{memoryId,revision}`.

`status:'page'` with `coverage:{complete:true,reason:null}` and a null cursor
proves EOF. A nonfinal normal page has reason `limit`, with charged lookahead
proving another eligible ref. `status:'partial'` has reason `work_limit`,
`byte_limit`, or `deadline` and a continuation; empty items mean bounded
progress, not exact zero. Terminal `state_limit` returns no items or cursor
and never claims completion. Bounds cover complete UTF-8 envelopes and
physical validation work. Native SQLite operations can overrun a quantum;
the watchdog cancels requests that cannot safely validate within their budget.

Overview requests opt into transportable snapshot provenance with exactly
`snapshotVersion:'topic-snapshot-v1'`; omission/undefined retains the legacy
two-field snapshot. Repeat the version with overview continuations. Pass all
three issued fields as member `expectedSnapshot` to pair counts and lists.
JSON copies and structured clones preserve validity. A member snapshot can be
reused by selecting only its three common fields. Omission captures a new
member snapshot without asserting consistency with earlier overview counts.

Origin tokens and member cursors are opaque, signed with ephemeral Worker
keys, and bound to the store/file, namespace, schema and snapshot. Origin
tokens expire absolutely after 60 seconds, even on an active reader; reads
and replay do not renew them. Continuations repeat every normalized input.
Latest continuation replay is byte-identical after fence validation; older
sequences are stale. On `cursor_stale`, discard paired caches, issue a fresh
opt-in overview and restart. Changed placement invalidates even when a Memory
revision is unchanged. Close, idle expiry, Worker restart and file replacement
also invalidate tokens. Missing/foreign/Card MOCs return `moc_not_found`;
visible revision mismatches return `revision_conflict`, wrong levels `invalid_ref`.
Default failures contain only `{ok:false,error:{code}}`. The explicit
`diagnostics:true` reader option adds the storage metadata described below.

Member reads use the existing read-only opener and E1-C lock policy without
another retry layer. Lock refusal is `storage_busy`; deadline cancellation is
`read_timeout`. Retry busy explicitly with the same acknowledged cursor.
Deferred transactions commit between bounded quanta and before emission.
No writer slot or migration is used, including on physical schema 18.
Supported layouts are 18, 20, 21, 22, 23, 29, 30, 31, 32 and 33.
See the [frozen member contract](plans/topic-overview-member-pages.md).

Performance/overlap measurements are opt-in: `npm run measure:topic-members`.
The primary schedules them serially on Node 22.16.0 and 24.15.0 and records
E1-C's chosen lock policy and thresholds before performance acceptance.


Member and opt-in snapshot reads require UTF-8 database encoding and BINARY
comparison semantics on the consumed namespace and identifier columns. Other
encodings or comparison collations return `unsupported_database`; legacy
overview opening is unchanged. Initialization walks schema metadata with a
bounded keyset checkpoint and checks column declarations through direct result
metadata, without scanning a table's column inventory. Index metadata uses
capped batches whose entire row cost is charged before reading, followed by
bounded in-memory checks under `workLimit`. A work-only page can therefore
represent initialization progress before member enumeration begins. It never
implies an empty selection.

Initialization also verifies the declared primary-key columns and order for
every consumed table. It reads table declarations in indexed, 256-byte schema
fragments and charges each read and bounded parser step. A UNIQUE constraint
does not substitute for the required primary key.

Default overview requests retain main's legacy error classification, including
`unsupported_database` for statement-construction failures. Member and opt-in
requests retain their specified error codes and storage-busy behavior.

Cached member replay must finish its fence and delivery checks within the
call deadline. A call that cannot advance a checkpoint before its deadline
returns `read_timeout` instead of minting another unchanged deadline cursor.


## E1-C2 v1: opt-in storage diagnostics and WAL waits

Use `openMemoryReader({ path, ownerId, diagnostics: true })` to attach
`error.diagnostics` to native SQLite failures. This handle-level boolean covers
both overview modes and members, including connection opening, and travels in
Worker data; environment variables and `execArgv` are unnecessary. Omission,
`false` and `undefined` retain the exact existing serialized error envelopes.
Successful pages and validation/deadline/close errors gain no fields.

```js
{ ok: false, error: { code: 'storage_busy', diagnostics: {
  stage: 'execute', statement: 'application_id',
  sqlite: { code: 5, extendedCode: 5 }
} } }
```

`stage` is one of `open`, `configure`, `prepare`, `execute`, `begin`, `commit`,
`rollback`, `close`. `statement` is one of `connection`,
`reader_configuration`, `application_id`, `user_version`, `schema_version`,
`encoding`, `schema_metadata`, `snapshot_metadata`, `topic_metadata`,
`transaction`. Codes are numeric: `code` is SQLite's primary byte and
`extendedCode` is its original extended result code. No SQL text, native
messages, paths, identifiers, owner/namespace values or content are emitted.
Existing legacy statement-construction classification stays unchanged.

The WAL budget is shared across the request, never restarted per statement or
transaction. Native SQLite BUSY remains `storage_busy` when the permitted wait
runs out; the existing host watchdog/Worker termination still returns
`read_timeout` if cancellation wins. Public cancellation does not await
termination; `close()` itself waits for native resource cleanup.
There is no application retry or sleep and no host-thread SQLite wait.
DELETE gains no wait. Context reads and candidate evidence are unaffected.

Before native SQLite access, the reader requires the complete 100-byte main-file header:
SQLite format-3 signature and read/write version bytes 18/19 equal to 2/2 select
WAL; every other header keeps zero wait and normal SQLite validation. The file
is opened read-only without following a final symlink and checked against the
safe-file device/inode. This avoids a journal-mode PRAGMA requiring the very
lock being diagnosed. No mode is changed, no `immutable` connection is used,
and schema18 needs no migration. Concurrent external journal-mode switching
is not supported by this per-connection detection; normal writers keep the
mode fixed.

`npm run measure:topic-reader-wal -- --smoke --report PATH` exercises fresh
public readers against a separate-process retained or fresh writer, including
physical schema18/current, WAL/DELETE, paired no-reader baselines and an
instrumented zero-wait control. Full runs pre-register five 30s repetitions and
all latency/throughput/loop gates in the script header. Smoke is observational;
the primary runs full acceptance under the machine-wide queue.


### E1-C2 review corrections and measurement protocol v2

The native wrappers preserve statement constructor identity and absent iterator
methods, so delegating-generator cancellation releases the cursor normally.
Timeout-installation failures are labelled `configure/reader_configuration`;
rollback refreshes the remaining WAL budget, including zero after expiry.

Measurement protocol v2 counts diagnostic SQLite primary 5/6 independently of
public classification, retains a separate public `storage_busy` counter, counts
permitted `cursor_stale` separately, and fails unexpected reader outcomes.
Every full WAL reader-load cell needs at least 20 write-overlapping reader
attempts, 10 per-write-close-overlapping attempts for fresh writers, and 100
successful native commits inside public write calls and the fixed window, in
both cell and baseline. Insufficient exposure is `invalid`; no attempts are
removed. Retained shutdown close never substitutes for fresh per-write close.
These are fixed full-window minima; smoke remains observational.

Every reader-load cell reports public-write-call latency p95/max separately
from the full writer open/write/close lifecycle latency. Public-write p95 keeps
the 250ms gate; max is reported without inventing a new threshold. The original
0.90 throughput ratio remains a reported engine reference and is excluded from
product acceptance. The current wait policy is v1.1 below. The script header
and saved protocol v2 pre-register these criteria before measurement.


### E1-C2 v1.1: deadline-bounded WAL waiting

This replaces v1's fixed 100ms WAL budget. At Worker request start, set one
absolute cutoff to min(request deadline, now + 1000ms) - 20ms. Before native
prepare/execution, cached statements, iterator steps and rollback, install the
floored nonnegative time left until that cutoff. Worker startup and SQL work
consume the request deadline; statements never restart the budget.

Members use their deadlineMs deadline; legacy and opt-in overview use the
existing 5000ms watchdog deadline. The 20ms reserve provides four normal 5ms
quanta for cleanup, the small failure result and delivery, leaving at most
980ms of configured native lock waiting. If only the reserve remains, there is
no wait. These bounds apply to timeout parameters, not synchronous completion.
The reserve is headroom; the host watchdog settles read_timeout when it fires
without waiting for SQLite or thread termination.

The wait stays in the reader Worker. DELETE keeps zero wait;
header-based WAL detection, diagnostics and existing error classification stay
unchanged. Busy exhaustion remains storage_busy; watchdog cancellation is
read_timeout. Measurement thresholds, exposure minima, latency reporting and
throughput's reported-only role remain unchanged.


#### v1.1 public cancellation and native cleanup

The host watchdog settles the pending result with read_timeout in its timer
callback, with no await of native completion. close() settles pending work with
store_closed before awaiting cleanup. Normal host timer scheduling applies;
waiting in SQLite never blocks the host event loop.

Cancellation detaches the Worker before requesting termination. Late replies,
errors and exit events from that Worker cannot reach any pending or replacement
request. Termination runs in the background on a tracked cleanup promise.
A synchronous SQLite wait or step cannot be pre-empted: native release can lag
until that call returns and the Worker exits. close() itself resolves only after
resources are released and can take the remaining active native wait or step
plus termination; the cancelled request result does not wait for it.

A new request on the same handle waits for the previous cleanup before launching
a replacement, inside its own existing deadline. There is at most one live
Worker per handle. Timeout or close while waiting settles promptly and prevents
a later launch. Another concurrent read still returns read_in_progress. This
avoids accumulating live Workers after repeated deadlines and adds no read retry.
