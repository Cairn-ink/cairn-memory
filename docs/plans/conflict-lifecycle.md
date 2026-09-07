# 1c — revision-bound contradiction hints

Parent: verified capture candidate `45bf62f801c340e82700780bc6c497b661452825`,
branch `feat/capture-orchestration`, [PR #12](https://github.com/Cairn-ink/cairn-memory/pull/12).
This stacked PR targets that branch until
the owner merges its parent. No agent merge, publication or deployment.

## Public contract

Keep one engine and existing APIs. Extend `admit` with optional `conflictHints`,
and each trusted `finishAdmission.items` element with the same field. Omitted
means empty; supplied arrays must be dense, length 0–5. Each closed-shape hint is
`{memoryId,expectedRevision,relation:'contradicts'}` with existing opaque ID and
positive safe revision validation. Duplicate target IDs reject `invalid_input`.
Do not accept model-produced hints in `capture` extraction output; semantic
conflict detection, a separate conflict-write API and provider work are excluded.

A stored symmetric relation binds both current revisions and contains no copied
content: `{leftMemoryId,leftRevision,rightMemoryId,rightRevision,relation,source}`.
Canonicalize endpoint IDs for deduplication. Core assigns `source` from the call:
`explicit-hint` for direct admission, `inferred-hint` for finish, regardless of
the deduplicated memory's origin. Both source variants coexist; identical links
are no-ops. Never rewrite either memory because of a hint.

`get().conflicts` is the complete sorted list of
`{memoryId,revision,relation:'contradicts',source}` for the other endpoint, ordered
by memory ID then source. Adding source to the inspection projection makes
attribution observable. Read both endpoints in the existing exact-namespace
inspection transaction; omit missing, deleted, foreign or stale links.
Enforce a maximum of five incident links per memory (including incoming links
and both source variants), rejecting overflow with `conflict_limit` atomically.
This explicit storage bound avoids an unbounded inspection response; no hidden
truncation or additional cursor is introduced.

## Transaction ordering and errors

1. Validate all item/hint shapes before writes. Finish checks its live claim under
   the existing transaction lock. Never weaken leases, replay or suppression.
2. Suppressed inferred items count and skip both admission and semantic hint
   checks; malformed hints still fail shape validation. Explicit suppression
   remains `memory_suppressed`.
3. Validate active target rows in the exact namespace before mutations:
   missing/foreign -> `memory_not_found`, stale -> `revision_conflict`.
4. Perform ordinary shared admissions. Any actual memory revision change
   invalidates its old incident relations in the same transaction.
5. After ALL batch admissions, bind each source's final revision and revalidate
   target expected revisions. A target changed by another batch item causes
   full rollback, not silent rebasing. Source equals target -> `invalid_ref`,
   including self-links discovered through exact-content deduplication.
6. Insert deduplicated final links, enforce degree limits, then complete the
   admission claim. Any late failure rolls back memories, receipts, relation
   invalidation/insertion, epochs and completion. Resolve returned references
   after the full batch as before.

New links advance the namespace epoch, including a link-only exact admission;
exact duplicate links without another mutation preserve it. Multiple links may
advance it once per link batch; no fixed increment is promised across admissions.
Invalidation happens on receipt attachment, metadata promotion/update, correct,
forget and filed/unfiled transitions. Placement changes preserving memory revision
preserve links. Filing can invalidate hints; never silently rebind them to a new
revision. Legacy facade mutations must use the same invalidation helpers.

## Schema and acceptance

Add schema v6 atomically from supported v1/v3/v4/v5 or new databases. Preserve
memory/receipt IDs and values, suppression, epochs, store identity/cursor secret,
MOCs and pending/completed claims. Reject unsupported/future stores unchanged.
DDL collision or writer contention leaves the old database intact and retryable.

- K01: explicit hints inspect symmetrically with assigned source, no content
  replacement; exact replay is a link/epoch no-op; reopen retains relations.
- K02: inferred hints cannot overwrite explicit memory metadata; both relation
  source variants remain separately inspectable without changing memory revision.
- K03: malformed, sparse, duplicate, oversized, foreign, missing, stale and self
  hints reject atomically; no partial memory or receipt writes.
- K04: multi-item finish binds final source revisions, supports exact source
  dedup, and rolls back when another item changes a hinted target.
- K05: suppression, completed replay, lease fencing and malformed suppressed
  items retain the stated behavior; replay cannot restore forgotten content.
- K06: correct/forget, receipt attachment, explicit promotion and filing revision
  transitions invalidate links atomically; no-op and same-revision placement
  preserve them; test both endpoints and the legacy mutation path.
- K07: incoming/outgoing degree bounds include both sources and roll back a
  batch that overflows. Link-only updates invalidate prior namespace cursors.
- K08: injected late relation/completion failure restores all previous state;
  current relation reads filter deliberately corrupt foreign/stale references.
- K09: v5 migration preserves the full preexisting state and cursors; migration
  DDL collision/lock failure rolls back. Existing older migration suites pass.
- K10: all core tests and six demos on Node22.16/24, plugin tests, JSON validation
  and isolated plugin validation pass. Independent Standards and Spec reviewers
  inspect the same frozen diff. Synthetic fixtures only; no semantic-quality claim.

Engine worker owns new conflict-storage module plus runtime, admission-storage,
moc-storage and database integration. Test worker owns new conflict tests and
v5 fixture, plus old migration assertions whose latest-version expectation must
change. Primary owns facade validation/projection, docs/demo/CI and integration.
Shared internal seam: values passed to runtime contain validated conflictHints;
legacy values may omit them. getPage returns conflicts. No nested transactions.
