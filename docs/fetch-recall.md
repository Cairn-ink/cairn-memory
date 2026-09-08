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

Recall reads at most two bounded map pages per namespace and two receipt pages
per candidate. Each selection round can use only refs visible in that round;
finished namespaces are skipped without renumbering them. `namespaces` reports
`mapExhausted` and `fetchExhausted`; any truncated
input yields `coverage:'budget_exhausted'`, including empty results. `complete`
means these bounded inputs were fully examined, not proof of relevance or perfect
recall. Large candidate bodies can exceed model input limits and fail explicitly.
Adaptive hierarchy traversal and paging beyond these ceilings are not implemented.
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
