# Fresh bounded-augmentation comparison

Dependent base: `98e0a081dd2d3dcf7240fc016860ba1863835430`.

Test whether seed-preserving candidate broadening improves retained evidence and
answers within existing limits. The prior counterfactual is motivation, not a
passed run. Freeze new cases before execution; do not alter earlier evidence.

## Acceptance

1. Add `evaluation/live/augmentation-fixture.json` and `augmentation-rubric.json`,
   id `bounded-augmentation-comparison-v1`, compatible with the unchanged
   `runMultiWindowFidelity`: six histories, three matched pairs, three windows
   each with five user statements and one assistant suggestion. Unique IDs,
   canonical bounded source text at most800 UTF-16 units; identical questions
   within pairs, exactly one changed user sentence for provisional/committed
   status. Required sources span all three windows and fit the unchanged rank
   limit6. Rubric fields never enter model input.
2. Use fresh low-stakes domains, not prior game/meeting-room/exhibit histories:
   bookbinding workshop materials, balcony plant-marker arrangements, and a
   Traditional Chinese sketching-group supply choice. Include explicit changed
   versus reaffirmed reasons, temporary scope, another actor's independent
   choice, assistant suggestions not adopted, and genuinely absent approval.
   Some irrelevant statements must share domain words, without becoming answers
   to the actual question. No final recap or favourable source-position tailoring.
   Semantic review must check each required/irrelevant label and qualifier.
3. Compare baseline and `createAugmentedSelectionModel` once each on the same
   captured stores; alternate arm order by history. Preserve the original
   driver's baseline/canonical-control report and six separate candidate slots.
   Same extraction, qualification, classification, model, query, navigation,
   source projection, rank limit6, context and answer instruction. No checklist
   method/grant, extra model round, retry, repair or new engine. Exact active
   namespace/revision/full receipts must match cold inspection before answer use.
4. Explicitly label source-based experimental MCP execution, not installed CLI
   or natural host adoption. Use actual stdio factories with opt-in injected
   wrapper; keep provider credentials only in parent and authenticated loopback
   tokens in children. Cold reopen windows; retain process/cleanup evidence and
   distinguish it from ordinary user installation. Do not change defaults.
5. Before any paid request freeze fixture/rubric/source/dependencies/operator/
   wrapper/instruction/grant hashes and independent review. Existing US$50
   campaign remains cumulative; fresh run ceiling US$3/400 HTTP requests/18
   answers, no retries. Require conservative headroom and check pins/accounting
   before each send. Rehearse success, invalid baseline selection, source failure,
   transport halt, answer failure and cleanup failure with synthetic ledgers.
   Errors retain failed/not-run slots, never rerun a frozen scored case.
6. Report stage-specific required-source coverage, lost original choices after
   rank, irrelevant candidate exposure and final context separately; count empty
   seeds, overflow and invalid output as outcomes. Review all final answers for
   decision strength, changed/reaffirmed reasons, actor/time/scope and unsupported
   certainty, including full-source controls. Report source bytes/tokens,
   provider and local-counter costs, latency, all attempts and unknown cost.
   No promotion if final required evidence regresses, additions only expose noise,
   budgets fail, or fidelity worsens. Three authored pairs (one Chinese) are not
   independent benchmark samples or general multilingual/reliability proof.
7. Add independent fixture/driver compatibility, mutation and failure-retention
   tests without keys. Root full offline live-evidence, generic, JSON and strict
   plugin gates on22.16/24; fixed-commit independent Standards/Spec reviews and
   all required CI before merge. This protocol package executes no paid request,
   changes no real ledger/grant, publishes no package and deploys nothing.
