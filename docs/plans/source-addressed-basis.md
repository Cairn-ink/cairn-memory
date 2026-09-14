# Source-addressed, explicitly dual-role basis proposals

Base: `255e7d35ef74ad68a1b4df8d9a9994b8a1de7358`.

## Motivation

The frozen source-context trial rejected literal-quotation failures, not outputs
over the token ceiling. It also showed one updated meeting time serving as both
challenge to an old premise and support for an explicitly adopted new choice.
Test a representation that selects source addresses and permits that dual role.
Do not repair or rerun the frozen outputs and call them newly successful.

## Acceptance

1. Add only opt-in `inputMode: 'source-addressed-v1'` to embedded read-only basis
   review. Original and source-context-v1 contracts remain unchanged.
2. Deterministically enumerate exact source parts within each canonical receipt:
   individual Han characters, other letter/mark/number runs, whitespace runs,
   remaining Unicode code points. Model-facing parts have local indices and text;
   retain complete receipt text. Parts are addresses, not linguistic assertions.
3. Addressed units specify memory, receipt, startPart (inclusive), endPart
   (exclusive), role and context. Context's subject/applies/scope/commitment are
   null or same-receipt {startPart,endPart}. Core validates safe indices, ordered
   nonempty in-range spans, nonblank well-formed text of at most200 UTF-16 units,
   and compiles exact offsets. Distinct repeated occurrences remain distinguishable.
   No model-written quote/offset, source repair, normalization or truncation.
4. Addressed mode additionally accepts explicit role premise-update: it may
   support a decision and challenge a premise, and may itself be a challenged
   premise only when it supports a decision. Decision roles remain exclusive.
   Original modes still reject this role. Preserve no self/duplicate/invalid
   links and complete challenge-support chains; no automatic role coercion.
5. Preserve model-proposed/unassessed/nonpersistent results, source/revision
   freshness, output detachment/counting and all existing resource bounds.
   Numbered parts add input cost and can cause budget rejection; document it.
6. Adapter strict schema binds addressed endpoints to selected receipt part
   bounds, preserves model routing and rejects unknown modes before transport.
   Installed artifact includes the shared implementation and exercises repeated
   source occurrences plus a dual-role decision chain. No new grant or paid run.
7. Test Unicode/whitespace and repeated occurrences; wrong/missing/extra and
   out-of-range spans; cross-receipt bounds; default/mode isolation; dual-role
   valid and invalid graphs; immutable source/cold state and budget failures.
   Full core/store, adapter/offline demo, artifact gates Node22.16/24 plus generic
   and strictplugin checks. Independent Standards/Spec review before delivery.

## Boundaries

Selecting a source span does not prove its role, attribution, compatibility or
adoption. An explicit dual role is still proposed. This is a reversible opt-in
representation experiment, not a new persisted engine or a final architecture
decision. Fresh paired real-model and full-loop evidence remain required.
