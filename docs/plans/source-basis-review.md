# Experimental source-bound decision-basis review

Base 371946d7f91d6599cba2b50f1169c63673ca7f25 after the separately delivered
model-control report (#85); no overlapping runtime changes. Follow-up to the fixed model
control: model choice affects errors, but memory-level endpoints cannot identify
the changed price premise separately from unchanged storage location.

This is a read-only, nonpersistent review in the existing shared core. Prove the
source-bound representation and evaluate it before a durable schema migration.
No separate engine, automatic capture, default model change or authority upgrade.

## Acceptance

1. Embedded `reviewDecisionBasis({namespace, refs})` takes one to six current
   exact-namespace/revision references. It uses the existing bounded source
   snapshot, complete receipts and fresh checks, not stored generated summaries.
   Model inputs have local indices and source text/roles, no private identifiers.
2. A distinct `reviewBasis` model method proposes at most eight source units and
   ten links. Units select a memory/receipt index, an exact unique source quote
   (1–200 UTF-16 units), and a proposed role: decision, premise or update.
   Core compiles offsets from the retained canonical source; it never accepts
   model offsets or silently normalizes/truncates a quote. Ambiguous/repeated,
   absent, malformed or cross-receipt quotes reject the whole review.
3. Links support premise→decision or challenge-current-basis update→premise.
   Wrong role/direction, selflinks, out-of-range indices and duplicates reject.
   One compound receipt can supply distinct premises; changing one does not
   assert all reasons invalid or a historical statement false. Role assignment
   and semantic support remain model-proposed, not proved by a matching quote.
4. Result includes source-bound units, typed links, complete source context and
   snapshot revision, explicitly unassessed and not stored. It never updates
   memory state, existing rationale edges, qualifications, adoption or index
   epoch. Recheck freshness after compilation and bound returned context too.
5. Use existing 6,000-local-input/1,024-output token and 30-second core limits.
   No fallback/retry. Optional adapter `basisModel` independently chooses the
   existing baseline, Luna or Sol without changing extraction/rationale routing.
   Its distinct strict schema/method is denied by every old paid capability;
   no new spending grant in this slice.
6. Tests cover two premises/one update, unadopted suggestions, attribution context,
   exact Unicode/ambiguous quote binding, stale source/revision/epoch, hostile
   model getters, input/output bounds, unchanged stored state and actual installed
   package with new prompt asset. Mocked semantics are not a quality claim.
   Both Node runtimes run core/demo, adapter/demo, artifact and contributor gates,
   followed by independent dual review. Paid evaluation requires a later frozen
   experiment and separately scoped method capability in the same budget.

## Working boundary

Do not infer current applicability from arrival order alone. The model may propose
an update only when source context supports it. Preserve "I thought", uncertainty,
quoted speakers, conditions and temporary scope. A source unit is a proposed
interpretation of a passage, not a verified atomic fact. Inspecting this view is
not permission to execute anything and cannot stand in for user consent.
