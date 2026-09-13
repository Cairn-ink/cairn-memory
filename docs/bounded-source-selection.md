# Bounded source-first recall

The optional recall setting `selectionMode: 'bounded-source-scan'` avoids an
extra model prefilter when the complete visible MOC fits the existing candidate
bounds. It requires an explicit `source-evidence` or `rationale-evidence` context.

```json
{
  "query": "What did I choose, why, and what evidence changed?",
  "contextMode": "source-evidence",
  "selectionMode": "bounded-source-scan",
  "limit": 6
}
```

Use this with the MCP `recall_memory` tool, or add the same fields to core
`recall({ readSet, ... })`. It is not a CLI configuration or default change.

If every namespace's first map page is complete and has no more than twelve
unique eligible memory references (twenty-four total), the core fetches all of
them and skips model selection over routing labels. Existing source ranking
still decides what to return. An empty complete map makes no model calls.
Larger or incomplete maps use the existing model-selected path, without taking
an arbitrary first twelve. The optional result includes:

```json
{"selection":{"mode":"bounded-source-scan","strategy":"complete-map","semanticCoverage":"unassessed"}}
```

`strategy` is `model-selected` when the original path is used. Map completeness
only describes navigation over current stored references, not complete history,
all facts, correct extraction or semantic sufficiency. A ranker can still omit
important evidence, and stored rationale links remain model proposals.

## Tradeoffs and safety

This mode can forward more retained source text to the configured model,
including irrelevant text within the authorized read set. It may reduce one
selection call but increase rank input and latency. Existing 4000-token map and
fetch limits, 6000-token rank input, output limits and freshness checks remain;
an oversized request fails explicitly rather than silently dropping evidence.
The response limit is not an input privacy bound. Do not enable it expecting
only the eventual answer's sources to leave the local store.

No vector database, new persistence engine or automatic decision change is
introduced. This is an opt-in architectural comparison motivated by a recorded
Chinese prefilter omission, not a measured improvement in model accuracy.
Scripted tests prove candidate preservation and isolation only. The immutable
pilot is not rerun; a fresh frozen comparison must evaluate quality and cost.
