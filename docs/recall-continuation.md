# Bounded recall continuation

`core.recall({readSet,query,limit})` now follows up to two root-map pages per
authorized namespace. Each selection round accepts only memory references
visible in that round; a model cannot select another namespace or invent IDs.
Candidates repeated through multiple parents/pages are fetched once.

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
fail explicitly, and no hidden cloud/lexical fallback changes the semantics.

Run `npm run demo:continuation` for a source-runnable synthetic example. See
[acceptance](plans/recall-continuation.md) and the
[operation inventory](plans/core-contract-inventory.md) for implemented controls
and the provider/MCP/client/migration work that remains.
