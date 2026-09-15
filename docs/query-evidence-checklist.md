# Question-conditioned selection checklist (offline candidate)

This is a transient evaluation candidate, not a production selection mode.
The [multi-window result](multi-window-fidelity-results.md) found seven required
passages omitted during selection even though navigation labels conveyed their
relevant content. A further passage was lost at ranking. More faithful labels
or removal of ranking alone cannot address that entire observed failure set.

The candidate asks a selector to associate exact spans of the actual question
with visible memory references. It compiles the stable union into the existing
`{ refs }` response. A question about a choice, its original reasons and later
changes can thereby ask for evidence for each part without a second discovery
call or another stored graph. This is a hypothesis about selection behavior,
not proof that a checklist improves recall.

## Boundary

`evaluation/architecture/query-evidence-checklist.mjs` prepares a detached,
frozen request and a compiler tied to that request. It invokes no model and
does not change the production OpenAI schema, core prompts, MCP tool or store.
The proposed requests use UTF-16 offsets into the question and visible exact
namespace/memory/revision references. A span cannot split a surrogate pair.

At most four requests may be proposed. References can be shared across requests;
the union keeps first occurrence order and remains within `maxRefs` (at most24)
and twelve unique memories per namespace. An empty request is permitted.
Invented fields, invalid spans, duplicate spans, duplicate references within a
request, nonvisible/stale tuples and over-budget unions fail rather than being
repaired. Input/output byte bounds are additional structural limits, not a
replacement for model token, timeout or authoritative freshness checks.
The complete request including instructions is capped at24,000 UTF-8 bytes;
proposals at16,000. The unchanged query is nonblank, well-formed Unicode and at
most4,000 UTF-16 units. Maps retain their original0/1 namespace indices; malformed
navigation entries and conflicting revisions for one memory are rejected.
Repeated identical memory references under different group memberships remain
valid. Inputs must be ordinary JSON data, without accessors, custom objects,
sparse arrays or nesting deeper than twelve levels.

The diagnostic is always `model-proposed` with semantic coverage `unassessed`.
Neither a selected reference nor a nonempty request proves that its source
answers the question. Empty references do not prove that information is absent.
The checklist grants no authority to run actions, widen namespaces or alter
memory. It provides no chronology, entailment or currentness certification.
Selecting the whole question as one span is valid and can reproduce flat
selection behavior. A model can also omit an entire requested aspect. Exact
offsets do not establish useful decomposition or completeness; the later
comparison must judge those separately, not count filled checklist rows.

## What remains before a useful result

1. The subsequent [model integration](checklist-model-integration.md) adds a
   narrow adapter method and evaluation wrapper with existing token/time/output
   bounds. Ordinary production selection still uses its original shape.
   An immutable experiment-guard capability remains unfinished; do not send
   proposals through a permissive path or introduce a repair/retry loop.
2. Freeze a fresh paired comparison with matched model, call count, navigation
   rounds and context budgets. Measure selection, rank and final receipt
   coverage independently, alongside irrelevant exposure, latency, cost,
   invalid output and abstention. Retain every failed/not-run slot.
3. Test changed and unchanged premises, exceptions, distinct actors and genuinely
   absent evidence. Existing failures are regression evidence, not fresh scores.
   Selecting more unrelated material or losing previously retained evidence
   can falsify the candidate even if its checklist looks complete.
4. Evaluate answer currentness separately on identical complete-source inputs,
   then retrieved inputs. A source-linked distinction between original reason,
   later evidence and uncertain current applicability is a separate candidate,
   not implemented by this selector. A reason becoming false must not imply that
   the user has changed their decision.

Handcrafted tests verify bounds and compatibility with the existing recall
orchestration. They do not establish better real-model selection, lower cost,
reliable state tracking, launch readiness or a release.
Pure compiler tests also run on Node20. Only the real SQLite-core integration
test requires Node22.16 or newer and explicitly skips on earlier runtimes.

See the [acceptance contract](plans/query-evidence-checklist.md).
