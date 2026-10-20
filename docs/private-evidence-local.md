# Exact-namespace local evidence reads

The optional local `privateCards` facade now exposes `selectEvidence`,
`fetchEvidence` and `revalidateEvidence` in the same SQLite runtime. Every call
takes `(input, opaqueAuthority)` and returns the existing success/error envelope.
Use the trusted host construction described in [private Cards](private-cards-local.md).
No new store, model, network call, vector search or product integration exists.
Typed Card MOC/mapping is a subsequent organization packet.

## Reviewed applicability

`editKnowledgeCard` accepts `applicability:'current'|'historical'|'conflict'|'unknown'`
with its existing exact `expectedRevision`, authored content, bindings and action ID.
The review applies to the resulting Card revision. An invalidation that changes
that revision makes effective applicability `unknown`, with
`support.applicabilityReviewedRevision:null`. Existing unknown-only edits remain
valid. An explicit `current` label cannot override unavailable required sources.

`confirmCardDraft` accepts the same optional applicability field so a trusted host
can confirm and review an exact draft in one atomic action. Omission defaults to
unknown. Supplying the field requires an independently approved exact payload,
including that choice; a model flag or ordinary confirmation is insufficient.
Neither confirmation nor current applicability establishes adoption or truth.

## Selection

```js
core.selectEvidence({
  namespace, query: 'tea timing', types: ['memory', 'card'], intent: 'current',
  limit: 12, scanRows: 128, scanBodyUnits: 256000, deadlineMs: 1000,
  // cursor: previous.nextCursor,
}, authority);
```

`query` is 1–4,000 UTF-16 units. `types` is a nonempty unique subset of memory
and card; `intent` is current or history. The shown budgets are defaults. Maxima
are 24 items, 1,024 scanned rows, 2,000,000 scanned body units and a 5,000 ms scan
deadline. Each continuation page receives that same one shared allowance.

Canonical Memory and confirmed Card streams alternate before applying the shared
budget. Both filed and unfiled Memories participate. Query/record words are
lowercased Unicode letter/number/underscore runs. Score counts distinct literal
word overlap; no normalization, stemming, semantic relevance or model judgment
is claimed. Matching stops at the page item limit. Matches in that bounded scan
are sorted by score, then Memory before Card, then stable ID. This is not a
global ranking over all retained records.

The value is `{items,coverage,nextCursor,snapshot}`. Items contain a typed exact
`ref`, state and qualification metadata plus `score`; selection contains no
authored title/body or Memory content. `coverage.byType[type]` contains
`{scanned,included,partial}`. Aggregate coverage reports scanned rows/body units,
complete/budget-exhausted status, and item-limit/row-budget/body-budget/deadline
reason. Complete means the requested canonical streams were enumerated, never
complete semantic recall. Ineligible records consume scan allowance too.

A record that cannot fit the remaining body allowance is not partially searched.
Other types can still progress. A body budget smaller than the next whole record
may yield a continuation without progress for that type; start a new selection
with a larger budget. Continuations bind the exact query, types, intent, budgets,
store, namespace, Memory/Card generations and read access generation. Changing a
setting refuses `invalid_cursor`; a mutation or grant-generation change refuses
`cursor_stale`. Do not treat a bounded prefix as complete recall.

Current intent includes visible active Memories and confirmed Cards whose
canonical support is eligible and whose exact revision was explicitly reviewed
current. It excludes awaiting/historical/forgotten Memories and drafts or
unsupported/unknown/historical/conflict Cards. History includes retained
nondeleted Memories, including awaiting and historical records, and confirmed
authored Cards with explicit qualifications. It cannot recover purged bodies.

## Fetch and final revalidation

```js
const selected = core.selectEvidence({namespace, query: 'tea',
  types: ['memory', 'card'], intent: 'current'}, readAuthority);
// Obtain a separately approved exact read grant for each next call.
core.fetchEvidence({namespace, intent: 'current', refs: [
  {type: 'memory', namespace, memoryId, revision},
  {type: 'card', namespace, cardId, revision, bodyRevision},
], responseByteLimit: 65536}, fetchAuthority);
core.revalidateEvidence({namespace, snapshot,
  responseByteLimit: 65536}, revalidationAuthority);
```

Fetch accepts 1–24 unique exact same-namespace refs. Card revision and body
revision must both match. Each whole success envelope fits the optional
`responseByteLimit`, default/max 65,536 UTF-8 bytes. Fetch and revalidation return
all requested whole items or `context_item_too_large`; no truncated body or mixed
version result is returned. The value is `{items,snapshot}`.

Memory items have `type:'memory'`, exact `ref`, state/review/filing/kind/origin/
confidence metadata, `content`, canonical `qualification` or null, and
`provenance`. Qualification anchors retain actual receipt IDs and ranges; their
text is omitted and `sourceText:'read-separately'` is explicit. Card items have
`type:'card'`, exact `ref`, state/support/origin, `title`, `body`, unassessed
qualification, source/interpretation `bindings`, `triggerMemoryRefs`, and
`provenance`. Source availability does not make attributed words adopted facts.

Provenance identifies actual sources, reports `meaning:'unassessed'`,
`corroboration:'not-assessed'` and `conversationCoverage:'unknown'`. Receipt-based
coverage is excerpt-only; copied receipt bindings do not become independent
corroboration. Memory receipt metadata is bounded to 16 entries, with an explicit
partial marker and unknown omitted count when more exist. Fetch returns no
receipt excerpts or submitted-note text. Source text uses the separately bounded
`getSource` API. Historical/awaiting Memory provenance retains bounded actual
receipt IDs but has `sourceAccess:'unavailable-for-noncurrent-memory'` and no
readable source refs, because this bounded source resolver requires current
visible Memories. An unsupported historical Card returns its retained authored
body and unavailable support without returning missing source text.

The opaque snapshot is a bounded signed token with typed refs, content/source
HMAC fences and namespace/access generations; it contains no Memory/Card/source
body. No snapshot private content is persisted in operations/effects. Treat tokens
as opaque; signing is not encryption. Tokens survive a process restart in the
same store when the host's read generation and canonical state are unchanged.

Revalidation first performs both host authority checks, then synchronously
rereads canonical eligibility, exact versions, sources and generations in the
shared transaction. A changed snapshot returns `snapshot_stale`; foreign store,
scope or tampering returns `invalid_snapshot`. Exact fetch revision mismatches
return `revision_conflict`; ineligible or deleted evidence returns
`evidence_unavailable`. Revoked authority returns `authority_required` initially
or `scope_changed` at the final grant check. Errors contain no stale body.

## Storage boundary and synthetic gate

Opting in migrates v18/v20/v21 additively to v22; feature-off reopening preserves
the retained schema and source invalidation triggers. The v22 addition stores
only applicability/reviewed-revision metadata. Stop mixed-version writers before
deployment; no user-store or production migration is authorized by these tests.

Run `node tools/testing/run.mjs core/test/private-evidence.test.mjs` on Node
22.16 and 24.15. The suite uses owned synthetic workspaces, no model/provider
calls, and a fresh child process for restart evidence. Passing it establishes
bounded traversal and lifecycle behavior, not semantic quality, full Raw,
hosted safety, typed Card MOC, product integration or deployment readiness.
