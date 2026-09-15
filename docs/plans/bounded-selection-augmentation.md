# Seed-preserving bounded candidate augmentation

Dependent base: `6f0dadb74f9673c8c2c9bba49851783dac3a2b82`.

The checklist comparison left required sources visible but unselected, with
rank input below its result cap. Its character-offset proposals did not establish
meaningful decomposition. This evaluation-only candidate instead retains valid
baseline choices and broadens the existing candidate set deterministically.
It is not a second engine, another graph or a production default.

## Acceptance

1. Add `evaluation/architecture/selection-augmentation.mjs`, exporting
   `prepareBoundedSelection(input)` for the existing `{query,maps,maxRefs}` shape.
   Return a detached, deeply frozen `input` and an `augment(output)` closure.
   Reuse the existing checklist compiler's bounded map/reference validation as
   a mechanical validator, not as a claim of query planning. No model, network,
   storage or fixture/rubric access in this pure helper.
2. `augment` accepts only a valid ordinary JSON `{refs}` baseline selection.
   Reject malformed, foreign, stale/nonvisible, duplicate, over-budget, accessor
   or generated-authority output; never repair or silently filter invalid refs.
   Preserve all valid original references and their order. With a nonempty seed,
   append unique visible memory refs in supplied map/item order, skipping groups
   and repeated placements, until `maxRefs` overall or twelve per namespace.
   The existing maximum is24 overall; zero budget and empty baseline stay empty.
   No re-scoring labels, question offsets, random order, hidden source reads or
   inference that an empty selection proves absence.
3. Return detached `{selection:{refs},diagnostics}` with exact base/addition
   counts, strategy `seed-preserving-map-order` and semantic coverage explicitly
   unassessed. Counts are candidate exposure, not relevance or answer quality.
   Prior/future invocations and mutation of caller input or returned results
   cannot alter the stored authority or each other's output.
4. Add `evaluation/architecture/augmented-model.mjs`, exporting
   `createAugmentedSelectionModel(model)`. Replace only `select`, calling the
   original snapshotted bound method once with unchanged instructions, input,
   output ceiling and abort signal. Capture, classification, ranking and all
   other methods remain unchanged. No retry/fallback/new model method or grant.
   Require the existing counter/context contract, check cancellation around
   asynchronous/callback boundaries, keep input within6000 local tokens and
   raw baseline plus augmented output within1024 each. Counter failure, mutation,
   malformed output or overflow fails before authoritative recall finalization.
5. Test real shared-core recall with scripted models: the ranker sees the exact
   augmented bounded union; its original limit/order/validation and final source
   receipts/freshness remain authoritative. Correction/forget during selection
   or ranking cannot emit an obsolete revision or invent provenance. Empty seed
   still avoids rank; added candidates can cause the unchanged rank-input budget
   to reject, not silently widen its ceiling or trigger a smaller fallback.
6. Independent tests cover both namespaces, map ordering, duplicate placements,
   original-choice protection, zero/full bounds, input/output detachment, malformed
   structures/accessors, local token/cancellation boundaries and wrapper method
   isolation. Pure tests remain Node20-compatible; only SQLite integrations may
   explicitly skip below22.16. Run generic/JSON/strict plugin gates on22.16/24,
   plus Node20 generic compatibility and focused tests. Fixed-commit independent
   Standards/Spec review and all required CI precede merge.
7. Document the cost/quality tradeoff honestly. Counterfactual padding of the
   previous frozen inputs makes all32 required sources eligible for ranking,
   but expands21 candidates to72, including35 additionally pre-labelled irrelevant
   sources and five other non-required sources. This was read-only reconstruction,
   not new recall or regenerated answers. The position12 cutoff, partial/large
   maps, lexical decoys, multilingual reachability and rank displacement remain
   risks. Fresh frozen real-model and installed/natural-host evidence remain
   separate gates. No paid execution, default change, release or deployment in
   this package; do not alter the old source/fixture/rubric/operator/results.
