# Opt-in rationale claim focus

Base: `0469eac48412d29674357261cc0435096b256f5a`.
After synchronizing the independently delivered evidence report, review against
`efdfad08675fc27f3d9f2742316488e9036a7c0f`. Only changelog entries overlapped;
both entries are retained and no core behavior changed during synchronization.

## Problem and hypothesis

The retained rationale pilot exposed ambiguous endpoints when different memories
share a complete multi-claim receipt. Current relate input contains only receipts
and local indices: two distinct extracted claims with identical receipts are
indistinguishable. More direction instructions cannot restore missing identity.

Supply the existing memory interpretation as an explicitly unverified focus,
alongside unchanged complete receipts. This is an input-information ablation,
not proof that the focus is entailed. Do not turn generated text into evidence.

## Acceptance

1. Embedded `reviewRationale` accepts only absent inputMode or explicit
   `inputMode: 'claim-focus-v1'`. Absence preserves exact old input/result behavior.
   Invalid/null modes reject before provider calls or writes.
2. Opt-in model input adds each current memory's stored content as
   `focus: { content, interpretationStatus: 'unverified' }`. No namespace,
   persistent IDs, timestamps, kind/confidence or qualification enters this field.
   Complete receipt indices/roles/excerpts remain unchanged. Instructions require
   source support for the particular focused claim, preservation of subject,
   scope and uncertainty, and abstention where summary and evidence disagree.
3. Snapshot/freshness/commit validation bind the exact focus together with sources.
   Existing six-memory, 24,000-unit snapshot, 6,000-input-token, 1,024-output-token,
   degree, revision and namespace guards remain. No truncation or hidden fallback.
4. Returned opt-in review includes inputMode, but stored edges remain unverified
   proposals in the shared schema. No automatic reversal, adoption, supersession,
   authorization, migration, new provider method, or extra model call.
5. Tests show the identical-receipt ambiguity in legacy input and distinguishable
   opt-in focus, including Chinese and two-person claims; hostile summary remains
   untrusted. Exercise focus mutation, bounds, wrong namespace, invalid mode and
   cold inspection. Run full core and contributor gates on Node 22.16 and 24,
   adapter offline coverage, and independent dual review before PR/merge.
6. Document the explicit expansion of model-visible personal text. Manual core
   API only in this slice: automatic capture/MCP defaults unchanged. Offline tests
   establish payload/safety behavior, not improved rationale semantics. A fresh,
   pre-frozen real-provider comparison must precede promotion to capture defaults.
