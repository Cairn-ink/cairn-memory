# Qualification slot schema

The one-shot long-history diagnostic stopped before admission because a completed
model response returned qualification indices `[0, 1, 2, 2]` for four items.
The local compiler correctly rejected that mapping. Do not accept, deduplicate,
renumber or infer the missing qualification; do not replay the paid experiment.

## Acceptance

1. Reproduce the duplicate/missing mapping locally using synthetic fake provider
   output at the actual adapter/compiler seam. Preserve its fail-closed behavior.
2. Investigate a provider-facing schema with exactly one required named slot per
   input item, each constrained to that item's evidence candidates. Normalize
   verified slots back to the existing public qualifications array. No new core
   storage, caller contract, model, retry, extra request or token-limit change.
3. A response with a missing/extra slot, mismatched item identifier, foreign
   evidence or invalid field must fail before admission. Do not derive semantic
   truth or authority from a structurally complete mapping.
4. Cover zero/one/multiple items, reordered JSON keys, unknown/null labels,
   duplicate/missing old array outputs and ordinary source-bound capture.
   Preserve other model methods and public qualification validation.
5. Run both Node adapter suites and offline demos, relevant installed-artifact
   tests, generic checks, and independent Standards/Spec review. A future live
   comparison needs a fresh frozen protocol; this patch alone proves no semantic
   quality gain. Record exact red/green evidence and limitations.

If the named-slot schema is unsupported or requires broader changes, report the
evidence and alternatives before changing scope. This is not permission to
weaken provenance checks or silently fall back to unqualified writes.
