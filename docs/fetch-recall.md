# Fetch and recall preview — S2c

The same public SQLite core now supports revision-checked content fetch and a
bounded recall workflow through an injected model adapter. No local MCP server,
bundled model provider, hosted migration or network fallback is added.

## Fetch current evidence

```js
const page = core.fetch({
  namespace: { ownerId: 'local-user', scope: 'personal', projectId: null },
  refs: [{ memoryId: saved.id, revision: saved.revision }],
  tokenBudget: 4000,
});
```

Use the revision from a current memory reference, not a group snapshot. Missing,
foreign and forgotten IDs return `not_found`; changed revisions return `stale`.
Invalid refs never carry content or receipts. A valid item includes the current
Memory, a bounded receipt page and total `receiptCount`.

Each response handles one requested ref and at most 100 receipts. When receipts
overflow, the next page repeats that memory with the next receipts. Merge receipts
by ID, not by treating repeated Memory IDs as duplicate pages to discard. Then
the cursor advances to the next ref. Pass the same ordered refs, namespace and
budget with `nextCursor` as `cursor`. Only `exhausted:true` means all requested
refs and receipts were examined; a single item's receipts can span many pages.

The entire serialized success envelope fits the configured token budget. A
memory plus one receipt that cannot fit fails `context_item_too_large`; no
truncation silently discards its evidence. The cursor is authenticated and binds
store, operation, ordered refs, namespace, budget and epoch. Mutations stale it;
reopen preserves it. Fetch requires the local counter but makes no model call.

## Explicit historical evidence

An application can deliberately inspect retained superseded records without
changing the automatic current-memory recall path:

```js
const listed = core.list({ namespace, states: ['historical'], limit: 20 });
if (!listed.ok) throw new Error(listed.error.code);
const record = listed.value.memories[0];
if (record) {
  const historical = core.fetch({ namespace, view: 'historical',
    refs: [{ memoryId: record.id, revision: record.revision }], tokenBudget: 4000 });
  // Inspect historical.value only after checking historical.ok.
}
```

`list.states` accepts a nonempty unique subset of `active` and `historical`.
Absent or both states preserves the existing all-state inspection listing;
`['active']` restricts it to current records. Filters apply before pagination.
Use the same state/status filters and limit on subsequent list pages. Default
`get` remains an explicit all-state inspection operation.

`fetch.view` is `current` by default, or explicitly `historical`. Wrong-view,
forgotten and foreign refs return `not_found` without content; a matching-view
ref with an outdated revision returns `stale`. Historical items additionally
carry the same `supersession` metadata as `get`, included in token accounting.
Cursor view/filter bindings prevent using a current page cursor to fetch history
or vice versa. Follow receipt pages with the same view, refs and token budget.
Deletion or other namespace mutations invalidate pages, including changes made
during the token counter callback. No generative model port is needed.

This view means **records currently retained as superseded**, not "what was true
at a requested date." Receipt timestamps record ingestion; memory timestamps
include mutations. `correct` does not retain every overwritten body, so this is
not full revision history. An active record may itself contain a qualified
historical statement; these filters do not classify its temporal meaning.

Supersession links identify recorded transitions, not their psychological or
causal reasons. Inspect actual sources before explaining a change. If a successor
was forgotten or its original receipts are unavailable, the existing metadata
reports missing evidence; do not substitute its newer receipts as an old reason.
Explicitly forgotten records remain inaccessible. Supersession's own fingerprint
suppression prevents recapture, but does not erase the deliberately retained
historical evidence. See [retention limits](supersession.md).

MCP, current map/recall and legacy reads are unchanged by this local API addition.
No `asOf` date, history-aware semantic search or historical answer generator is
provided. Run `npm run demo:history` for a synthetic list-to-fetch walkthrough.

## Recall over authorized namespaces

```js
const result = await core.recall({
  readSet: [{ ownerId: 'local-user', scope: 'personal', projectId: null }],
  query: 'How should I review this protocol?',
  limit: 6,
});
```

The trusted embedding application selects `readSet`: one personal/project scope,
or personal plus one project of the same owner. Model output cannot choose an
owner, project or arbitrary namespace. There is no caller authentication inside
the library; do not expose arbitrary read sets to untrusted clients.

Supply an adapter to `openMemoryCore({path,model})` with `contextWindow`, exact
synchronous `countTokens(text)`, and async `select` and `rank` methods. Both
receive `{system,input,maxOutputTokens,signal}`. Selection input contains query
and maps tagged with `namespaceIndex`; ranking input contains query, limit and
current memory/receipt candidates with that same index. Both return only:

```js
{ refs: [{ namespaceIndex: 0, memoryId: 'an-input-memory-id', revision: 1 }] }
```

Selection must use visible memory refs; ranking must use a unique subset of
fetched candidates. Empty arrays are valid. Forged IDs, revisions, extra fields
and group IDs fail validation. All query/content/receipt/label text is untrusted
data. Structural validation does not prove that a model judges relevance well.

Recall's private `literal-current-memory-overlap-v2` candidate policy first scans
at most 1,024 current, nondeleted memory rows plus one current sentinel in
exact-namespace ID order using the existing `capture_current_memories` partial
index. Deleted and historical rows are absent from that index and do not consume
the allowance. Current rows rejected by the active index projection still consume
it; only projected current records can become candidates. The scan requires this
index and fails closed if it is missing, without a full-scan fallback. No schema
migration is added. The snapshot is reused across both pages in one recall.
Full bodies are scored by the number of distinct
literal query tokens they contain, then sorted by descending score and stable ID.
Zero-overlap records remain eligible: absence of a literal match does not prove
absence of evidence. This is bounded literal candidate generation, not semantic
search or a measured improvement in model quality.

This supersedes v1's raw-row allowance: retained history can no longer crowd out
current candidates. The private cursor policy binding changes with it, so v1
cursors cannot resume under v2. The [frozen v1 evidence](evidence/query-candidates.md)
remains evidence for that earlier policy, not a v2 model-quality result.

Each memory occupies one candidate slot, using its first valid current placement
reference in canonical parent-title/ID order, or the existing unfiled fallback
when it has no valid projected placement. Multiparent memories are deduplicated.
Private candidate pages omit group headers and group-to-group edges, so selection
loses that group context. Public map ordering, classification catalogs and stored
organization are unchanged. Topic routing remains separate future work.

Recall's internal navigation uses query-aware excerpts, still at most 120
Unicode code points per memory. It chooses a contiguous slice of current stored
content containing the most distinct literal query words, with an earliest-window
tie break. Excerpts do not alter the full-body score or add model calls.
Public `core.map` keeps its original prefix labels; the classification catalog
is unchanged.
Internal continuation cursors bind namespace, epoch, a keyed query digest,
excerpt/candidate policy versions, scan allowance and position;
the raw query is not embedded in them. Excerpts are counted before page packing.

This is navigation evidence, not a summary or semantic search fallback. Matching
uses case-insensitive whole Unicode letter/number runs without additional
normalization, stemming, stopword removal or language-specific segmentation.
Existing input sanitation still applies. A longer CJK run cannot match a substring
word; synonyms and facts spread over distant sentences may still be missed.
The excerpt need not contain a complete sentence or answer: current content and
receipts still come from revision-checked fetch and authoritative final reads.
See the [fixed real-model diagnostic and follow-up](evidence/recall-label-visibility.md).

There are at most three model calls, 36 unique candidates and 72 fetch operations
(two receipt pages per candidate). Each call needs a
context window of at least 8192, input at most 6000 counted tokens, output at most
1024 tokens and 1024 reserved for adapter framing. The shared classification/
recall call helper enforces a 30-second AbortSignal deadline. Counter absence,
overrun and model failure return explicit errors; no fallback engine runs.
Adapters must honor output/abort limits and account for provider framing, as in
the [model port contract](moc-placement.md#model-and-token-counting-port).

After ranking and output counting, the core validates every fetched candidate
and rereads the selected memories and their receipt prefixes in one SQLite
transaction. A deleted or changed candidate fails the whole recall with
`revision_conflict`, including when the ranker returned empty. Cached fetched
content is never the final response. No adapter runs inside or after this final
snapshot. A later mutation affects subsequent reads, not an already returned
snapshot.

## Honest coverage limits

### Source qualification on the read path

Pass `includeQualification:true` to `core.fetch` or `core.recall` to carry the
existing complete bounded qualification DTO with each item. Unqualified records
return `qualification:null`, meaning missing support, not confirmed truth. Absent
or false retains the legacy response shape. Only booleans are accepted; enabled
fetch cursors cannot be reused with disabled reads or vice versa.

Qualification, including every anchor, counts inside the 4,000-token fetch
envelope and the 6,000-token ranking input. It is never removed to fit a budget;
oversized items fail explicitly. Ranking receives source descriptions, and the
final transaction rereads validated qualification with current memory and receipt
prefixes. No model/counter runs after that read. MOC navigation is unchanged.

An anchor may cite a receipt outside the bounded receipt prefix. Its exact text,
receipt ID and digest remain present; use `get` receipt pagination to inspect the
full source record. Do not infer absent speaker context or antecedents. Submitted
roles and model labels are unverified: quoted, proposed, considered, unknown and
temporary applicability are not adopted global preferences. Even adopted is a
source interpretation, not proof of consent or current execution authorization.
Relevant rejected or considered evidence is not excluded merely by its label.

This does not infer identity, retire claims, resolve disagreement or establish a
decision's causal dependency. In particular, a challenged reason for choice A
does not establish choice B. The frozen [v2 pilot](../evaluations/results/candidate-qualification-pilot-v1.json)
shows five storage completions among six cases, not five semantic passes: null
descriptors, a rejected punctuation value and incomplete antecedent provenance
remain observed limitations. This read-path change does not rescore that run.

Recall reads at most two bounded candidate pages per namespace and two receipt pages
per candidate. Each selection round can use only refs visible in that round;
finished namespaces are skipped without renumbering them. `namespaces` reports
`mapExhausted` and `fetchExhausted`; any truncated
input yields `coverage:'budget_exhausted'`, including empty results. `complete`
means these bounded inputs were fully examined, not proof of relevance or perfect
recall. Large candidate bodies can exceed model input limits and fail explicitly.
Adaptive hierarchy traversal and paging beyond these ceilings are not implemented.
Reaching the current-row scan ceiling also keeps coverage incomplete, even when
a matching memory was returned or all eligible rows in the scanned range fit in
one page.
At that terminal ceiling the private page has no next cursor; recall stops without
repeating the scan or making an empty continuation call.

The indexed query returns at most 1,025 current, nondeleted rows. At most 1,024
projected bodies are scored, each bounded by the existing 4,000 UTF-16-unit input limit: at most
4,096,000 UTF-16 units or 12,288,000 UTF-8 bytes in total. The sentinel body is
returned but not scored. These are returned-row and JavaScript scoring bounds,
not bounds on SQLite page I/O. Index membership and canonical placement lookups
add auxiliary projection work; they are not included in the current-row allowance.
No latency claim follows from these ceilings.
On a fresh synthetic schema, `EXPLAIN QUERY PLAN` for the exact scan reports
`SEARCH memories USING INDEX capture_current_memories (owner_id=? AND scope=? AND project_id=?)`
with no temporary ordering B-tree. That verifies the scan access path, not total
page reads or the cost of auxiliary projection lookups.
Targets beyond the first 1,024 current rows, crowded score ties and literal
paraphrase/CJK misses remain limitations. These offline index and reachability
checks establish neither model-quality gains nor measured latency improvements.
See [recall continuation](recall-continuation.md) for exact budgets and coverage.

Run `npm run demo:recall` from a source checkout on Node >=22.16. The bundled
scripted mock uses byte-based test counting, not a production tokenizer. Tests
use synthetic SQLite files, including a second connection changing data while
ranking waits. This verifies control flow, isolation and revision safety, not
real-model semantic quality. The repository is not an npm-published package.

The [S2c acceptance plan](plans/s2-fetch-recall.md) records the original scope;
the [continuation plan](plans/recall-continuation.md) defines the current extension. Next:
real provider/tokenizer integration with quality evaluation and a thin MCP host
over this shared core. Existing [storage/retention limits](local-store.md) apply.
