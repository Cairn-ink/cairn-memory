# 1d — bounded staged index rebuild

Fixed parent: `c9295f4ad9533fdf91d299703a85f3a4b2af94e4`,
`feat/conflict-lifecycle`, [PR #13](https://github.com/Cairn-ink/cairn-memory/pull/13).
Stacked delivery is owner-authorized; no self-merge, release or deployment.

## Contract

Add only synchronous model-free `rebuildIndex({namespace,expectedIndexRevision,
limit=500,cursor?})` to the existing envelope facade. Closed input shape, exact
trusted namespace, positive safe expected revision, integer limit 1–500.
Success value is exactly `{state:'staged'|'published',indexRevision,nextCursor,
exhausted,invalidRefs}`. A staged page returns the captured epoch and a cursor;
only published + exhausted + null cursor indicates completion. Publication
advances the namespace epoch once. Staging does not change that epoch.

Rebuild validates existing declarations; it does not rediscover classifications,
generate titles, call a model/counter, change memory revisions/content/receipts,
rewrite conflicts or manufacture source evidence. Invalid relationships are
reported and excluded from the new organization projection, not silently repaired.

## Generation authority and ordinary writes

Persist a namespace active-generation pointer and generation-owned validated
Memory/MOC node references and organization/source references. Stage rows must
not be read as authority. Publication switches only bounded pointer/progress
metadata, never copies or revalidates the entire generation at the end.

Raw declaration tables remain the write source. After publication, map,
placement inspection and classification read the active projection through
read-only SQL views/seams, still joining current authoritative memories and
checking exact namespace, active state and revisions. Never serve cached content.
Before any rebuild exists, retain the current validated live-query behavior.
During a first unfinished rebuild with no published generation, index-dependent
map/classification reads return `index_unavailable`; get retains its independently
validated live placement read until first publication, never stage rows. Fetch/list,
correct/forget and explicit admissions remain usable. Reopen preserves this
state. When a published generation exists it remains readable during staging.

Normal mutations must remain immediately visible after publication. Maintain
only the active projection transactionally with existing insert/update/delete
operations, using per-row SQL triggers or equivalent shared seams. Never update
staged generations or rebuild the whole namespace during a mutation. Projection
rows must not cascade from mutable raw rows, which would silently alter staging.
The existing
epoch change fences any in-progress build. Exact no-ops preserve the epoch.
New explicitly written valid nodes/refs become visible; previously excluded raw
refs do not reappear just because an unrelated row changed. All projected reads
retain current endpoint/revision validation even if raw data is corrupt.

Title safety requires checking ALL original title bindings against current
memories: dropping an invalid source from a projected list must not make a
partially stale title appear valid. No-source or any invalid source means null
title. Rebuild reports invalid source bindings and cannot rebase them. Nodes may
retain null titles. For map navigation, a filed memory with no surviving valid
membership must remain reachable as effectively unfiled; do not mutate its stored
filing status or revision merely to repair navigation.

## Bounded execution, cursor and failure

Each call visits at most limit (maximum 500) nodes/references total, including
invalid records. Page Memory nodes, MOC nodes, title-source refs, L1→Memory refs
and L2→L1 refs in deterministic indexed keyset phases. No OFFSET, full-store array,
unbounded source fanout per node, final whole-generation validation/copy or bulk
old-generation cleanup. A bounded lookahead may determine whether work remains.
Track source validity incrementally if needed, never load all sources per node
inside the rebuild loop. Existing ordinary read budgets are unchanged.

Persist generation identity, captured epoch, phase and keyset/progress atomically
with each page under the existing transaction lock. Continuation survives process
restart. HMAC cursor binds store, namespace, operation, expected epoch, limit,
generation and exact persisted progress. Consumed/forged/mismatched cursors return
`invalid_cursor`; wrong initial epoch returns `index_revision_conflict`. Any real
same-namespace mutation since capture returns `stale_rebuild`, including another
publication; unrelated namespaces and no-op operations do not stale it. A fresh
call without cursor starts a new generation; it does not delete old rows.

Use existing InvalidMapRef shape `{parentId,childType:'memory'|'moc',childId,
reason:'not_found'|'invalid_level'|'stale'}`. Missing/foreign endpoint takes
precedence, then wrong level, then deleted/revision-mismatched endpoint. Report
only IDs/reason, never foreign text. Attribute corrupt refs to a namespace only
when at least one surviving endpoint belongs to it; fully orphaned rows are not
namespace-owned and are excluded, not guessed. Source bindings use childType
memory. A structurally invalid MOC node may report itself as parent/child.

Errors during staging/publication roll back progress, projection and pointer
changes. Retry uses the same valid cursor; no partial generation becomes live.
Abandoned/old generations are retained metadata/reference-only rows; bounded
garbage collection and a public status/cancel API are intentionally not included.

## Migration and acceptance

Schema v7 adds generation metadata/projections and required maintenance seams.
Atomically upgrade supported v1/v3/v4/v5/v6 and new databases, preserving all
existing rows, IDs, claims, conflict links, epochs and cursor identity. No eager
unbounded projection backfill on open. Unsupported/future formats stay rejected.

- R01: empty, exact-boundary, limit1 and >500-node/ref builds obey per-call work
  limits, require no model/counter, and publish once with exact response shapes.
- R02: two-process/reopen continuation works; forged/wrong store/scope/limit,
  consumed and malformed progress cursors cannot write or publish.
- R03: same-namespace mutation or competing publication stales a build; unrelated
  mutation/no-op does not. Staging leaves epochs and original data unchanged.
- R04: missing/foreign/stale/wrong-level refs and invalid title sources report
  bounded errors and stay out of published authority with no content leakage.
  High title-source fanout still obeys the work bound; partly stale titles stay null.
- R05: readers never see staged rows; first-build unavailable and prior-published
  generation behavior survive interruption/restart. Publication changes actual
  map/get/classification reads, not just a metadata flag.
- R06: normal admit/receipt/correct/forget/placement/link and legacy mutations
  remain coherent with active authority, invalidate unsafe sources/revisions and
  stale rebuilds. Orphan filed memories remain navigable without revision rewrite.
- R07: injected page and final-pointer failures restore progress, data and prior
  authority; retry/restart observes only the last committed complete state.
- R08: v6 upgrade preserves all state/cursors and rolls back collision/lock
  failures; older migrations and all prior core contracts still pass.
- R09: all core tests and seven demos on Node22.16/24, plugin tests, JSON and
  isolated plugin validation pass. Independent fixed-commit two-axis review.

Ownership: engine worker owns index-storage/index-schema (new), database/runtime/
MOC storage seams. Test worker owns new rebuild/migration tests and public v6
fixture, plus older latest-schema assertions. Primary owns facade/cursors,
docs/demo/CI and integration. Runtime seam `rebuildIndex(ns,{expectedIndexRevision,
limit,progress?})` returns public fields except raw `progress` replaces nextCursor;
primary signs it. Progress is an opaque plain object to the facade and validated
exactly by storage. Runtime returns null progress only on publication.
