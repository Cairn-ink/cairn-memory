# Extraction-validation diagnostics

Status: implementation candidate; offline synthetic verification only.

## Historical evidence boundary

The retained six-case public pilot records one
`extract/core_validation/invalid_extraction` and one failed capture observation;
that case never reached recall. The rejected extraction object and provider
response were not retained. The adapter held the parsed object only in memory,
core admitted nothing after rejection, and the runner wrote only the fixed
diagnostic category and failure envelope. Therefore the historical validation
branch is unproven and cannot be reconstructed from the retained artifacts.

No private source, question, answer or model text is required or permitted for
this change. It does not authorize a paid retry or any edit to the old pilot,
ledger or artifacts.

## Pre-fix feedback loop and acceptance contract

Before implementation edits, the task and team messages recorded this contract
and the real-core synthetic loop showed it red: an out-of-range source index and
duplicate source indices both returned `invalid_model_output`, admitted zero
memories and collapsed to the same `invalid_extraction` reason. This plan file
was added after those edits were started because the in-repository record was
mistakenly omitted; it records that earlier contract rather than expanding it.

The candidate must:

1. Replace prospective catchall emission with a finite allowlist distinguishing
   output shape, item shape, text, value, source-array shape, duplicate source
   selection and source range.
2. Retain only the fixed reason string. Never retain returned text, values,
   indices, identifiers, hashes, exceptions or provider bodies.
3. Preserve the public `invalid_model_output` envelope, whole-batch rejection,
   zero admission, claim abandonment and the existing ingestion stop.
4. Add no retry, rejected-item drop, repair, truncation, fallback or validation
   weakening.
5. Carry the same categories through the existing private bounded public-pilot
   collector without changing public reports, scoring or provider requests.
6. Keep the legacy `invalid_extraction` reason allowlisted for compatibility
   with older emitters while documenting that old events cannot be refined.

## Verification

Focused tests exercise every new core category through `core.capture`, assert
one content-free event, the unchanged public failure and an empty namespace.
Observer throw/rejection/mutation cases must remain behaviorally inert. A fake-
HTTP public-pilot test must distinguish duplicate-source and source-range events
in private diagnostics while proving failed extraction stops later memory
generation. Run the complete core and offline live-evidence suites on Node
22.16 and Node 24. No live provider call is part of verification.

## Non-claims

Passing these tests establishes prospective observability only. It neither
identifies the old pilot's rejected field nor improves extraction, recall or
answer quality. A future live failure could be attributed only if collected
under the new runtime and the same bounded diagnostic contract.
