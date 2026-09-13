# Bounded recall continuation

`core.recall({readSet,query,limit})` follows up to two private candidate pages per
authorized namespace. Each selection round accepts only memory references
visible in that round; a model cannot select another namespace or invent IDs.
Candidates repeated through multiple parents/pages are fetched once.
Candidates are distinct memories scored before packing by full-body literal query
token overlap, then stable ID, from one raw namespace scan of at most 1,024 rows
plus a sentinel. History and tombstones consume the allowance. Valid existing
placement refs are preserved; memories without one use the public map's unfiled
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
empty recall. At the scan ceiling `nextCursor:null` ends traversal without claiming
complete coverage. Private authenticated cursors bind namespace, epoch, query
digest, both navigation policies, the 1,024-row allowance and candidate offset.

Each map/fetch response retains its 4,000 counted-token ceiling. Every model call
still has the stricter 6,000 input / 1,024 output limits and existing deadline.
Large combined maps or evidence can therefore return context_budget_exceeded;
the engine does not silently discard evidence to make a ranking request fit.
The worst-case aggregate storage-response ceiling is 304,000 counted tokens, not
a target token cost or measured performance claim. Tighter packing awaits
provider-backed resource evaluation.

After all model and tokenizer callbacks, the same authoritative final read checks
every fetched candidate, including candidates not ranked for output, and rereads
selected contents and accumulated receipt prefixes. Correction/forget committed
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
