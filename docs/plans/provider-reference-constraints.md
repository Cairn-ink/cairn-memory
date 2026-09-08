# Provider reference constraints

Base `ca087ba3cd5388331423ca767249b196a318e4c1` (#17). A separately scoped fix
discovered by the frozen semantic evaluation, not a relaxed evaluation rubric.

## Reproduction and hypothesis

The two-fact synthetic classify probe (Harbor Go, Juniper Python) returned
`parentIds:["programming_languages"]` while its map contained only unfiled
memories and no existing groups. Its `newL1.title` used the same string. All HTTP
requests were 200 but core classification returned `invalid_model_output`.
Single-memory live smoke had passed; bulk classification failed in the evaluation.
The core correctly rejected invented authority. Original diagnostic evidence is
synthetic, retained outside the repo; no key/raw HTTP body is published.

Ranked predictions: (1) schemas permitting arbitrary parent IDs let the model
invent them; request-specific allowed-ID constraints prevent that output;
(2) clearer prompt examples alone might reduce ambiguity but cannot forbid it;
(3) remaining semantic/model errors could persist even with valid identifiers.
Test (1) first without prompt changes or a different model. Core guards stay on.

## Acceptance R01–R07

- R01: Add a failing offline schema test proving the currently valid schema
  permits the observed fabricated group ID. After the change, an empty group map
  requires empty parentIds/parentL2Ids, and nonempty maps allow only visible
  groups of the correct level. Generated new titles never become existing IDs.
- R02: Classify memory IDs are constrained to the input snapshot. Select/rank
  namespace indices are constrained to the supplied maps/candidates, including
  index0 when the sole namespace is project. Where practical memory IDs/revisions
  are bounded to visible candidates; core still validates correlated tuples and
  per-namespace/per-round authority. Empty candidates allow only empty refs.
- R03: Derive strict response schemas from the immutable request snapshot for
  both count and generation. Same schema in both phases; no extra remote call,
  retry, model change, silent fallback or removal of current core checks. The
  initial schema-only experiment leaves prompts unchanged; the separately
  recorded P01 follow-up below changes only classification instructions.
  Maintain local6000/provider-framing1024/output1024 bounds. Large dynamic schemas
  may fail explicitly at preflight, never enlarge or bypass budgets.
- R04: The live budget guard verifies the same derived schema, preserving its
  endpoint/payload safety and reservation limits. Shared schema construction is
  not a second extraction/classification engine.
- R05: Real synthetic two-fact classification succeeds and applies valid groups;
  rerun frozen evaluation separately after this verified fix. Retain all failed
  baseline attempts. Neither valid IDs nor a successful probe proves semantics.
- R06: Both Node22.16 and24 adapter tests/demos and core regressions pass. Tests
  cover empty maps, visible L1/L2 IDs, foreign namespaces, changed snapshots,
  strict schemas and exact count/generation agreement. No paid calls in CI.
- R07: Independent Standards and Spec review on final commit, then scoped PR.
  No self merge/publication/deploy. No frozen corpus/rubric edits in this fix.

## Budget

Before this fix: #17 two runs reserved US$0.160128; first36-case evaluation
US$0.747264; two-request diagnostic probe US$0.008896. Total US$0.916288 of
authorized US$5. DRI alone performs subsequent paid probes/runs and updates the
ledger; no worker reads credentials or invokes live models.

## P01: Follow-up cold-start instruction experiment

The schema-only two-fact probe returned two structurally valid items with empty
parentIds and no newL1. Classification and application returned success, but
both memories remained unfiled and createdMocs was empty. Two HTTP requests
returned 200; this is format/authority evidence only. **That attempt did not meet R05.**
The synthetic schema-only probe evidence is retained privately by the DRI.
At that point the DRI's shared ledger reserved US$0.951872 of the authorized US$5.

Next prediction, recorded before changing instructions: explicitly distinguish
an empty complete map from semantic uncertainty, and direct a classifier to
create a precise L1 topic when the memory has a clear subject and no suitable
visible group. This should improve cold-start filing without forcing genuinely
unclear memories into invented topics. Existing ID, source, namespace and
revision checks remain unchanged. No corpus, model or rubric change is allowed.

First add a deterministic test at the actual classification port that checks
delivery of the cold-start rule and validates its synthetic JSON example through
the real placement application. Separately retain empty-parent/no-new-group as
a valid core outcome for genuinely unclear content. Watch the instruction test
fail before editing the prompt, then rerun it and core regressions. These offline
tests establish an instruction/contract regression, **not model compliance**.
Only a subsequent separately budgeted DRI live probe can resolve R05; retain this
failed filing attempt regardless of the next result.

### P01 outcome and current ledger

The instruction-contract test failed before the prompt edit and passed afterward;
the separate genuine-unfiled test remained passing. No storage/classification
validation logic, model, corpus or numeric quality gate changed.

On 2026-09-09 (Asia/Taipei), the DRI's next two-fact actual-provider probe passed
an explicit assertion that **both memories were filed**. It created one shared
L1 topic, `Programming languages used by software projects`, and two current
memory references. Classification and application succeeded. The retained
synthetic probe evidence is retained privately by the DRI.
Two HTTP requests returned 200, reserving US$0.008896. Generation reported 1041
input and 104 output tokens, estimated US$0.0005828. This satisfies the narrow
R05 filing probe, not the still-pending frozen-evaluation rerun or general quality.

Current shared reservation: #17 US$0.160128 + baseline evaluation US$0.747264 +
initial classification diagnostic US$0.008896 + MCP host probe US$0.026688 +
schema-only unfiled probe US$0.008896 + successful P01 probe US$0.008896 =
**US$0.960768**, leaving **US$4.039232** of the authorized US$5.
Failed baseline/probe evidence is retained; no unrecorded retries are implied.
Final candidate verification and independent reviews remain DRI-owned gates.

## Offline verification

Node 22.16 and 24: 179 core tests and 44 adapter tests passed, including the
two prompt-contract and fourteen request-reference regressions. MOC and offline
provider demos passed on both versions. All eight core demos, 31 plugin tests,
JSON validation and isolated Claude marketplace/strict plugin validation passed.
The DRI repeated the changed classification-port test and actual-provider probe;
no ordinary test required a credential. No typecheck gate exists in this JS repo.
