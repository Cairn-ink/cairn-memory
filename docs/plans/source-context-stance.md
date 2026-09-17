# SCS: opt-in proposition-local source stance

Fixed dependency base: `34801396ca2c0a5627d3311467d61dd230596371` (SCA PR170,
depending on BCU PR169 and CU PR168). This is a dependent delivery, not a merge
or release authorization. One isolated worktree/branch `feat/source-context-stance`.

## Problem and decision

A private, authored three-case installed diagnostic completed structurally but
lost a hypothesis qualifier on its causal unit; separate "not confirmed" units
did not qualify that unit. Reported claimant identity was also absent from the
interpreted proposition. These are diagnostic observations, not a benchmark or
proof of a model's internal cause. Raw citations and an unverified flag alone do
not make the proposition's interpreted meaning faithful.

Add opt-in version2 source-context units through the existing pure, bound and
OpenAI paths. Put source stance, claimant and reporter on each unit. Preserve
legacy versionless inputs, output, prompts and serialized requests. Do not add
a separate engine, confidence score, inferred authorization, semantic verifier,
automatic capture or persistence. Global source selection/coverage remains
unassessed; a separate bounded receipt-local experiment will study starvation.

## Acceptance

SCS1 — Compatibility. Existing `prepareSourceContextUnits({sources})`,
`compileSourceContextUnits({sources}, proposal)` and
`core.reviewSourceContext({namespace,refs})` remain byte/shape compatible.
Explicit opt-in is raw input `{version:2,sources}` or bound input
`{namespace,refs,version:2}`. Other explicit versions and unknown keys reject.
The prepared model input retains version2; the compiled result derives version2
from the input, never a model-authored version. Model proposal root stays `{units}`.
Do not accept v2 fields in legacy mode or omit them in v2 mode.

SCS2 — Proposition-local qualification. Every v2 factual_claim and decision_state
unit additionally requires three `{value,evidence}` fields:

- `epistemicState`: `tentative`, `asserted`, or `unknown`. Tentative means the
  source presents the proposition as a hypothesis/possibility; asserted means
  the source states it, not that Cairn verified it. This is independent of
  polarity: a source can assert a negation or tentatively propose a positive claim.
- `claimant`: nullable bounded160-character label for the source-attributed
  holder of this proposition. Not the claim subject and not authenticated identity.
- `reporter`: nullable bounded160-character label for who relays that proposition.
  Use unknown/null when the text does not establish it. No role/namespace inference.

Compile each into `{value,anchors,interpretationStatus:'model-proposed-unverified'}`
on the same unit. Reuse exact same-receipt passage ownership, canonical label and
secret checks. Non-unknown/non-null values require evidence. Include these refs
in the derived focus union; keep the existing one-to-four-passage bound. Do not
stuff these into or modify legacy qualificationInput fields. Preserve existing
decision states, attribution and polarity semantics.

The160-character new-label bound applies before and after NFKC normalization;
reject empty/whitespace-only claimant/reporter labels (use null for unknown).
This clarification does not change legacy label handling.

SCS3 — Honest guarantees. Schema/compilation prove shape and source linkage only,
not semantic correctness. A cited but semantically wrong `asserted` value can
still compile; tests/docs must acknowledge that rather than claim certainty
detection. Nulls/unknowns must remain unknown. No source identity, confirmation,
truth or execution permission is authenticated. Outputs remain assessment-only,
not-stored, semanticCoverage/sourceSelectionCoverage unassessed.

SCS4 — Actual bound path. Version2 uses a separate explicit prompt (legacy prompt
unchanged), which requires tentative status to stay with the causal proposition,
and distinguishes claimant, reporter and subject. It must not fabricate a person,
certainty or decision; preserve stated reasons and decision-state limits.
Same actual admitted-source snapshot, captured identity binding and final
freshness fences as SCA. No new persistence, MCP/HTTP route or default enablement.
No private fixture/rubric, raw paid responses, identifiers or credentials in public
source. Use distinct synthetic examples in conformance tests.

SCS5 — Adapter/budget parity. The existing optional reviewSourceContext model
port recognizes only canonical v1 or explicit v2 prepared input/schema through
the actual core helpers. Full request/schema budget remains6000input/3072output,
same count/generation payload, bounded reads/cancellation and no retry. All other
methods retain1024output/default configuration/wire. No new live allowlist entry
or changes to consumed private operators; no paid calls in this implementation.

SCS6 — Tests and installed delivery. Add direct+reported tentative examples,
asserted negation, unknown claimant/reporter, missing/extra fields, malformed
indices, cross-receipt references, focus overflow, secret/invalid labels,
detachment/mutation and ordinary/decision-unit cases. Prove legacy wire stability
against fixed-base fixture rather than merely self-comparing current code.
Exercise real bound core+adapter fake HTTP and installed artifact v2, including
source changes in flight/no persistence after reopen. Reuse existing limits;
reject over-budget output rather than silently dropping qualifiers or units.
Run generic/JSON/plugin gates, core/store demo, OpenAI/demo, artifact and relevant
installed gates on Node22.16 and24.15. Primary independently verifies key paths;
separate Standards/Spec review the same final candidate before delivery.

## Non-goals and next gate

This does not fix source coverage, relations/dependencies, stale summaries or
end-user cold-session behavior. No claim that required fields force a model to
interpret correctly. Do not increase global8unit count or other limits. Only
after mechanical acceptance and independent review may a separately frozen fresh
synthetic diagnostic assess semantic benefit within remaining shared budget.
Consumed SCL evidence/rubric is immutable and cannot become a repaired success.

## Ownership

Primary owns acceptance/design and reads final diff/reruns verification. Existing
Sol/high worker owns scoped implementation/tests/docs/CONTEXT updates. Main and
unrelated user work stay untouched. No merge, publication or deployment in this
slice. Glossary terms describe source epistemic stance and claimant only, not
API implementation; no durable ADR is warranted for this opt-in reversible API.

## Verification record

Implementation owner: existing Sol/high worker `source_rank_first_impl`; primary
owns design/acceptance. Runtime model attestation and token cost are unavailable.
Code candidate796cee9c19732a74cf691dfccae9833593daa223, fixedbase34801396ca2c0a5627d3311467d61dd230596371.
Entrypoints traced: pure prepare/compile, explicit bound core operation, shared
OpenAI source-context request/schema validation, actual packaged cold child.
Legacy calls retain versionless raw/prepared/schema/result shapes and old prompt;
worker pins old HTTP body hashes, primary separately compares against fixed-base
core+adapter including the bound prompt. New v2 prompt is in artifact allowlist.

Author initial full gates both Node22.16/24.15: generic106, core648, OpenAI204,
artifact70, installed rationale4, JSON/strict plugin/store/OpenAI demos pass;
Node22 MCP71 also passed. Primary then identified new labels bypassing legacy
boundedText canonical checks (NUL/noncanonical whitespace). Direct synthetic
reproduction confirmed acceptance; scoped new-label fix and negative tests now
reject them. Author reran six affected pure/bound/adapter/installed test files
on both versions:44/44 pass,0skip. No old runtime behavior was changed.

Primary draft probes initially5/6: the failed reopen test omitted the token
counter required by sourceSnapshot. This was a primary test setup defect, not a
product regression; reopening with the same fake model fixed it (6/6). Final
probes include label canonicalization rejection and will run in the final full
gate matrix. Earlier full greens are not substituted for final-candidate gates.

Primary full final gates and separate Standards/Spec reviews are pending at this
record. No paid calls in this worktree, no push/merge/publication/deployment yet.
