# Contradiction hints

The same local core now accepts optional `conflictHints` on explicit `admit`
and each trusted `finishAdmission` item:

```js
conflictHints: [{ memoryId: target.id, expectedRevision: target.revision,
  relation: 'contradicts' }]
```

Hints record a caller's assertion, not model-verified contradiction detection.
They never replace, merge or delete memory content. Capture model output still
cannot include hints. IDs and revisions must refer to active memories in the
same exact namespace. Missing/foreign, stale and self references fail atomically.
The entire admission or finish rolls back if any accepted item's hint fails.

Each call/item accepts zero to five unique targets. Core stores symmetric,
revision-bound links and assigns `explicit-hint` or `inferred-hint` according to
the admission operation, not the resulting memory's origin. Both assertion
sources may coexist without overwriting each other. Exact duplicate links are
no-ops; new links advance the namespace index revision.

Inspect either endpoint with `get`. Its complete `conflicts` array contains
`{memoryId, revision, relation, source}` for each other endpoint, sorted by ID
then source. To keep this output bounded, at most five incident links per memory
are allowed, including incoming links and both source variants. Overflow returns
`conflict_limit` and rolls back the whole admission; nothing is silently dropped.

Any actual memory revision change invalidates its incident links atomically:
correction, forgetting, a new receipt, metadata promotion or filed/unfiled
transition. Same-revision placement changes and exact no-op admission preserve
links. Filing after admission may therefore invalidate hints; core does not
silently retarget an assertion to a new revision.

Batch finish binds final source revisions after all admissions. If another item
changes a hinted target's expected revision, the whole finish fails. Suppressed
inferred items skip semantic hint resolution, but malformed hint shapes still
reject the batch. Completed replay never restores forgotten content or links.

Schema v6 adds only relation metadata and upgrades supported v1/v3/v4/v5 stores
atomically. Back up local data before upgrading; no down-migration is supplied.
The synthetic `npm run demo:conflicts` demonstrates inspection and invalidation,
not semantic quality. See [acceptance](plans/conflict-lifecycle.md) for exact
failure ordering, bounds and migration requirements.
