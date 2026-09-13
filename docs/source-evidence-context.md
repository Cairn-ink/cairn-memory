# Source evidence context

The opt-in `contextMode: 'source-evidence'` on core fetch/recall and local MCP
recall separates retained source passages from model interpretations. It is
useful when a generated summary or qualification may have changed the meaning.
It does not make source claims true or authenticate submitted speakers.

```js
await core.recall({ readSet: [namespace], query: 'What did I ask about?',
  contextMode: 'source-evidence' });
core.fetch({ namespace, refs: [{ memoryId, revision }],
  contextMode: 'source-evidence', tokenBudget: 4000 });
```

Each returned item and rank candidate contains only:

```js
{
  memory: { id, revision, currentness },
  receipts: [{ id: receiptId, role: 'user', excerpt: 'Did you check that?' }],
  receiptCount: 1,
  interpretationStatus: 'omitted',
  sourceSelectionCoverage: 'unassessed'
}
```

`currentness` describes the store's current/historical lifecycle, not whether
the assertion is true now. Excerpts are exact canonical retained text, not the
original complete conversation. Roles are supplied claims. A question remains
a question in this context; an assistant proposal is not replaced with the
model's adopted label. Explicit remember receipts contain submitted memory
text and do not prove an earlier human conversation happened.

The generated content, kind, confidence and qualification remain available via
normal inspection, including `get.includeQualification` or
`inspect_memory.includeQualification`. Source mode does not rewrite or delete
them. `includeQualification:true` conflicts with source mode; false is allowed.
For configured MCP capture, omitted qualification does not turn its normal true
default back on when source mode is selected. Without contextMode, all existing
qualified and unqualified behavior remains unchanged.

## Completeness and budgets

Fetch returns every retained receipt for one memory or fails; it does not slice
an excerpt or silently return an incomplete receipt set. The existing 101-row
sentinel supports at most 100 receipts, still within the <=4000-token response
budget. Excess sources or inability to fit returns `context_item_too_large`.
Fetch pagination can continue across requested memory references, not within
their source sets. Cursors bind mode, references, view, budget and epoch.

Rank receives only these source DTOs, within the existing 6000-token input and
1024-output bounds. Full source sets may therefore cause an explicit budget
failure where the old summary-based path fitted. No candidate or condition is
dropped to force success. Final recall rereads every fetched candidate, even
unselected ones, under the existing namespace/revision/epoch transaction rules.
Source correspondence and available qualification bindings are checked before
return; no model or tokenizer runs after that authoritative read.

## What this does not solve

MOC selection still routes using unverified generated labels and can miss
relevant memories. Only previously retained sources are available; a missing
antecedent is not repaired from a neighboring message or another memory. The
`unassessed` marker explicitly does not claim sufficient selected evidence.
Source-mode rank can still choose poorly, and a downstream answer model can
still misunderstand a question or attribute it incorrectly.

The [frozen real pilot](../evaluations/results/source-support-v1.json) had eight
structural completions and ten recalled records, but material semantic errors.
It is not eight semantic passes; this new context mode was not used in that run.
Existing results remain unchanged. No automatic identity, rationale linkage,
state resolution, execution permission or new host compatibility is claimed.
