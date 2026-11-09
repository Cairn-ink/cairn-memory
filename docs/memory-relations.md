# Memory relations

Capture automatically links extracted facts to existing memories in the same
namespace. Both memories and their evidence remain stored. The graph contains
only memory-to-memory edges: `supersedes`, `contradicts`, `refines`, and `causes`.
It has no entity nodes and adds no stored current flag.

A newer value points to the value it supersedes. Current context reads follow
that direction to the newest available end and omit superseded values. A
contradiction keeps both values visible. History reads follow supersession and
refinement in both directions, up to eight edges, and order the chain by time.
Related memories use the existing item and token budgets. Reads use indexed
local SQL and never call a relation model. The compatibility source name
`relations-one-hop-v1` remains compatible; its existing explicit rationale and
Card-binding hops stay available, while typed memory edges are delivered directly
for every read, including when optional sources are narrowed.

## Capture model port

`relateMemories({system, input, maxOutputTokens, signal})` is an optional method
on the extraction model. Capture sends one additional relation request per batch:

```js
input: {
  facts: [{factIndex: 0, content: 'I stopped eating egg pancakes.', eventTime: null}],
  candidates: [[{id: 'older-memory', revision: 1,
    content: 'I like egg pancakes.', eventTime: '2026-01-01T00:00:00.000Z'}]]
}
// Result:
{facts: [{factIndex: 0, eventTime: null, edges: [
  {candidateId: 'older-memory', relation: 'contradicts', confidence: 0.8}
]}]}
```

A null relation means abstention. Candidate arrays correspond to fact indexes.
Discovery takes the namespace's lexical top ten and, when a matching vector
cache and configured embedder are available, vector top ten. Their union is
capped at eight per fact. Vector requests share the existing embedding budget.
The relation call shares the existing input/output budgets, shortens candidate
text when necessary, and reserves time for admission. A failed call emits a
content-free diagnostic; admission proceeds without its edges.

Candidate text and model output are untrusted data. Core drops unknown IDs,
duplicates, invalid relations, and invalid confidence values. A supersession
with confidence below 0.6 or an earlier event time becomes a contradiction.
Each new memory gets at most five outgoing edges. The admission transaction
rechecks candidate revisions, namespace, and content eligibility, and binds the
edge to both final revisions and the receipt inserted by that capture.

Without the port, a conservative rule can emit only `contradicts`, at confidence
0.3. It requires a cessation/negation marker in English or Traditional Chinese
and content-token Jaccard overlap of at least 0.5 with the top lexical candidate.
Rule decisions retain their receipt and revision bindings so a future authorized
backfill can re-evaluate them. There is no automatic backfill scheduler.

## Storage and lifecycle

The additive relation layout family preserves each inherited base and safety
layout. `memory_relations` stores typed, revision-bound edges, confidence,
decision source, triggering receipt, event time, and creation time. Endpoint
foreign keys cascade on deletion. The endpoint indexes support both traversal
directions. A namespace/revision trigger rejects invalid endpoint bindings.

`memory_relation_times` stores revision-bound event times even for a fact with
no edge. This avoids losing a stated date on the first fact in a chain. It is
memory metadata, not an entity graph. Receipt time and admission time provide
fallbacks when there is no stated event time.

Existing conflict assertions migrate to user-decided contradiction edges;
`memory_conflicts` becomes a compatibility view. `conflictHints` retains its
validation, two source labels, atomic failures, and five-assertion incident
limit. `get().conflicts` keeps its bounded legacy projection. `get().relations`
legacy recall item `relations`, and context item `metadata.relations` add typed relation labels and dates.

Correction, forgetting, a new receipt, and ordinary filing revision changes
invalidate incident edges atomically. Forgetting a superseder therefore makes
its predecessor available to current reads again. A capture's own initial
filing settles that capture's automatic edges on its final revisions inside the
filing transaction; caller assertions and other captures' edges are invalidated.
Every endpoint is checked through the existing content safety predicate before
expansion or labeling. Forgotten, suppressed, excluded, denied, and foreign
content cannot be reintroduced through an edge.


## Backfill hook design

A future authorized writer can expose a two-step internal hook:
`planRuleRelationBackfill({namespace, afterId, limit})` pages rule decisions and
captures edge ID, both revisions, receipt ID and original event time. Batches of
at most five source memories use the same discovery, `relateMemories` port and
compiler as capture. `applyRuleRelationDecisions({expected, decisions})` must
compare-and-set only rows still decided by a rule with exactly those endpoint
and receipt bindings, recheck content eligibility, and advance the namespace
revision in its transaction. An abstention can remove the rule assertion; an
accepted decision becomes LLM-decided. Backfill uses the original event time,
never its execution time. This is a proposed internal protocol, not a shipped
public API or an automatic scheduler.
