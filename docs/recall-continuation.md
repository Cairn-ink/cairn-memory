# Bounded recall continuation

`core.recall({readSet,query,limit})` follows up to two private candidate pages per
authorized namespace. Each selection round accepts only memory references
visible in that round; a model cannot select another namespace or invent IDs.
Candidates repeated through multiple parents/pages are fetched once.
Candidates are distinct memories scored before packing by full-body literal
query overlap, then stable ID. Every recall mode scans newest first with the
existing `namespace_memories` index and `updated_at DESC, id ASC` keyset.
A 1,024-row floor precedes the fixed 400 ms budget; the hard cap is 20,000
physical nondeleted rows. History, awaiting review and projection denials count
toward that work without contributing text. At most 1,024 candidates survive
score/ID ordering. Deferred pages release SHARED after at most 256 rows or
25 ms, checked per row. Valid
existing placement refs are preserved; memories without one use the public map's unfiled
fallback. Group headers and hierarchy edges are omitted from this private input,
reducing group context; public maps and classification are unchanged.

The fixed ceilings are two selection calls plus one ranking call, four map pages,
36 distinct candidate memories and two fetch pages per candidate (72 fetch calls,
at most 200 receipts per candidate). Selection input includes `maxRefs`; the
existing 12-per-namespace cap applies to each round. No extra traversal/model
tools or user-controlled authority fields are added.

Receipt continuation preserves a unique ordered prefix. If more receipts or map
pages remain, the namespace's fetchExhausted/mapExhausted flag stays false and
coverage is budget_exhausted, including when no relevant candidate was selected.
Complete means those examined ranges were exhausted, not that semantic relevance
has been proven. A candidate requiring a third receipt page remains incomplete.
An unscanned sentinel also keeps `mapExhausted:false`, including successful or
empty recall. Once all candidates within the scan allowance have been paged,
`nextCursor:null` ends traversal without claiming complete coverage. Private
authenticated cursors bind namespace, epoch, query
digest, navigation policies, the cap/top/page bounds and candidate offset.
The signed scan boundary includes rows visited, last recency key and stop cause;
a continuation rescans exactly that prefix without applying a fresh time budget,
and a changed namespace or suppression epoch yields `cursor_stale`.
The candidate-policy binding is `literal-recency-keyset-overlap-v3`; older
cursors fail once instead of silently paging a different list. A missing
recency index fails closed without a full scan or migration. One epoch change
restarts the pass with its floor and the original scan clock; a repeated change
leaves incomplete coverage. Budget exhaustion is ordinary incompleteness.

Each map/fetch response retains its 4,000 counted-token ceiling. Every model call
still has the stricter 6,000 input / 1,024 output limits and existing deadline.
Large combined maps or evidence are packed to fit: map items and candidates are
left out, and candidate text is shortened, only in the model's view. This is
never silent: `recallTruncated` counts it and coverage is `budget_exhausted`.
Returned evidence is not shortened. See
[fitting the model budget](fetch-recall.md#fitting-the-model-budget).
The worst-case aggregate storage-response ceiling is 304,000 counted tokens, not
a target token cost or measured performance claim. Tighter storage-response
packing awaits provider-backed resource evaluation.

After all model and tokenizer callbacks, the same authoritative final read checks
every fetched candidate, including candidates not ranked for output, and rereads
selected contents and accumulated receipt prefixes, or the capped most-recent
receipt list a candidate was ranked with. Correction/forget committed
before this read cannot escape as cached evidence. Intermediate stale cursors
fail explicitly. Namespace epochs and index availability are also checked around
model callbacks and in the final transaction, even for empty selections; mutations
of navigation evidence cannot silently produce a current-looking empty result.
See [fetch/recall](fetch-recall.md) for literal-token limitations and the distinction
between returned rows/bytes scored and SQLite/projection lookup costs.

Run `npm run demo:continuation` for a source-runnable synthetic example. See
[acceptance](plans/recall-continuation.md) and the
[operation inventory](plans/core-contract-inventory.md) for implemented controls
and the provider/MCP/client/migration work that remains.
