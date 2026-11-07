# Bounded source-first candidate selection

Base `1d25c0da23980dafe6ca53c0adf482a7ac6e41b0` (#75).
The frozen Chinese rationale pilot exposed both the old no-registration reason
and the later login requirement in each arm's MOC map. `select` chose only the
old reason; `rank` never received the correction. This is a prefilter omission,
not absent storage or proof that final ranking will succeed with both sources.

## Acceptance

1. Core and MCP recall accept optional `selectionMode: 'bounded-source-scan'`
   only with explicit `source-evidence` or `rationale-evidence` context. Unknown,
   null or incompatible modes fail before model calls. Omitted mode retains the
   exact previous selection path and response shape.
2. In this opt-in mode, if the first map page for every namespace is exhausted
   and all eligible unique memory references fit existing selection bounds
   (12 per namespace, 24 total), fetch every eligible reference directly and
   skip model `select`. Rank actual retained sources through the existing path.
   Do not infer relevance from labels or promote proposals into confirmed facts.
3. If complete maps do not fit, use the original bounded select/fetch/rank path.
   Never silently truncate to qualify for the fast path. Preserve all existing
   map, fetch, rank, output, scope, freshness and token limits; overflow fails
   through existing envelopes. No schema change, vector index or second engine.
4. Opt-in output reports requested mode, actual strategy (`complete-map` or
   `model-selected`) and `semanticCoverage: 'unassessed'`. It does not claim a
   relevant answer, complete history or perfect contradiction detection.
5. Scripted tests establish that both Chinese conflicting source receipts reach
   rank when old select would omit one, plus empty maps, two namespaces, fallback
   at bounds, invalid mode, correction/forget freshness and no default change.
   Actual MCP SDK and installed artifact exercise forwarding. Both Node versions
   run contributor gates, core/recall demo, MCP and artifact tests; dual review
   and CI precede merge.

This is an opt-in architectural ablation, not a measured semantic improvement.
Do not rerun the immutable rationale-pilot-v1 experiment. A separately frozen
fresh comparison must test accuracy, irrelevant-source cost and failure rates.
Fine-grained claim binding and relation direction remain separate open work.

## Research cross-check

[StateMem, sections 3 and 5](https://arxiv.org/html/2608.19652v1) separates
retrieval omissions from using stale state despite having evidence. This change
targets the former only. Its synthetic benchmark and substantial per-turn
encoding costs do not establish lightweight production reliability for Cairn.

[RD-Forget, section 3](https://arxiv.org/html/2609.10263v1) separates retained
sources from query-dependent evidence views and scopes replacement to individual
relations. Our inference: fixing the prefilter should be evaluated separately
from fine-grained claim/state interpretation; sending more sources is not itself
a state-tracking solution. Neither paper's reported scores are Cairn scores.
