# Staged index rebuild

`core.rebuildIndex({namespace, expectedIndexRevision, limit:500, cursor?})`
validates existing organization without a model or token counter. Each call
visits at most 1–500 nodes/references, including invalid ones. It does not infer
new topics, regenerate source-derived titles or change memory content/revisions.

Success is `{state, indexRevision, nextCursor, exhausted, invalidRefs}`. Continue
using the same namespace, expected revision and limit with `nextCursor` until
`state:'published', exhausted:true, nextCursor:null`. Only that combination means
the complete staged generation became authoritative. Publication advances the
namespace revision once; intermediate pages do not. Cursors survive restart,
but cannot be reused after consumption or moved to another store/scope/limit.

A concurrent same-namespace mutation causes `stale_rebuild`; reread the current
revision and start without a cursor. An unrelated namespace change or exact
no-op does not stale the build. Wrong initial revision returns
`index_revision_conflict`. Malformed, mismatched or consumed cursors return
`invalid_cursor`. Failed pages leave their progress and prior authority intact.

New projection rows are invisible until the final atomic pointer switch. During
the first unfinished rebuild, map/classification return `index_unavailable`
because no previously published generation exists. Direct inspection remains
usable and never reads staged rows. Later rebuilds continue serving the prior
published projection, with current namespace/revision checks. Ordinary writes
update that active projection in their existing transactions; no second engine
or whole-namespace rebuild runs on each write.

Invalid refs are reported as `{parentId, childType, childId, reason}` and excluded.
Reasons are `not_found` (including foreign namespace), `invalid_level`, or `stale`.
No foreign content or title is returned. A title with any missing/stale source
remains null, even if other sources are valid. A memory whose last valid
membership was excluded stays navigable as effectively unfiled without rewriting
its stored lifecycle revision. Fully orphaned corrupt refs with no surviving
namespace-owned endpoint cannot be assigned to a namespace and are not guessed.

Schema v7 atomically preserves supported v1/v3/v4/v5/v6 data and cursor identity.
Back up meaningful databases with writers closed before upgrading. There is no
downgrade, production migration or automatic cleanup. Abandoned/old generations
retain metadata/reference rows; bounded garbage collection is future work.

Run `npm run demo:rebuild` for a temporary SQLite demonstration. Synthetic tests
and this demo prove bounded control, publication and lifecycle behavior, not
semantic-quality or resource-performance thresholds. See the
[frozen acceptance](plans/index-rebuild.md) for exact boundaries.
