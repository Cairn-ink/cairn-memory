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
file with native `readOnly`, `query_only`, `trusted_schema=OFF` and zero busy
timeout. It rejects symlinks, missing files, unsupported application/layouts and
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
cancels pending work, waits for termination, and makes future reads return
`store_closed`. Worker failures return `reader_failed`, without source text,
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
Failures contain only `{ok:false,error:{code}}`.

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
