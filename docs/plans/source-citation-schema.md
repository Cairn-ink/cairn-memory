# SCC: align v3 generation citations with the existing compiler

Fixed dependency base d479702705f752d7c0d0a02bb5508a97f50773a2 (accepted PR172).
Isolated worktree source-citation-schema, branch fix/source-citation-schema.
Remote main observed 3c7b9ee322a52b6af12ac169eddf1e75eea0a1f9; use the explicit
dependency so consumed experiments and their pinned source tree stay immutable.
No merge, release, deployment or paid experiment belongs to this slice.

## Observed defect and decision

A source-only diagnostic produced enum value `unspecified` with evidence `[]`.
The generated JSON schema permits this combination, while the compiler correctly
rejects every non-null/non-unknown interpreted value without a citation. A full
saved-output offline replay and a one-unit minimization reproduce the rejection;
removing links does not help. Supplying only the missing evidence or changing
only those values to unknown makes the counterfactual compile. This is a
generation-schema/validator mismatch, not a reason-direction or size failure.
The failed experiment remains failed; do not repair or resample its outputs.

Tighten only the opt-in v3 generation schema to express existing per-field
citation requirements. Keep the compiler strict and unchanged. This is a bug
fix to the schema, not a new result version or a new semantic rule. It purposely
changes v3 prepared/HTTP schema bytes; v1/v2 remain byte-identical. No inference
that a valid citation proves a label, claimant or reporter is correct.

## Acceptance

SCC1 — Existing contract preserved. Versionless/v2 inputs, schemas, prompts,
compiled results and full HTTP requests remain byte-identical to the base. V3
input/result shapes, prompts, interpretation statuses, source/identity binding,
empty-unit/link support and compiler acceptance/rejection remain unchanged.
No automatic filling of citations, fallback unknowns, output repair, retry,
new provider/port, MCP method, persistent data or default selection.

SCC2 — Closed conditional citation schema. For v3 each unit field represented
as `{value,evidence}` must require 1–4 evidence references when value is non-null
or its enum is not `unknown`. This includes descriptive subject/property/scope/
applies/value, attribution/polarity/quantifier (including `unspecified`),
epistemicState/claimant/reporter, and decision state. Null labels and enum unknown
retain the existing 0–4 range (they may cite context). Every nested object stays
closed and fully required. Use supported nested anyOf branches, not unsupported
if/then/else/allOf/oneOf. Root remains an object. Same reference enums and bounds.
Do not turn minItems into a claim of source-relative semantic validity; compiler
still rejects foreign, duplicate, wrong-role/direction and out-of-focus references.

SCC3 — Test the actual defect seam. Before implementing, add a regression which
fails on the base because the generated v3 field schema permits non-unknown with
zero references. Verify the generated branch constraints against a matrix of
every relevant field/value family, with and without citations, including null/
unknown with references and empty arrays. Use distinct synthetic fixtures, not
private model outputs. Test matching compiler acceptance/rejection and preserve
all existing guards. The original invalid output must STILL reject after this
fix; do not assert it is now usable. The repaired seam is generation constraints.

SCC4 — Actual adapter/installed path and limits. Demonstrate both count and
generation requests carry the exact tightened canonical schema from the core,
reject caller-supplied old/mismatched v3 schema before HTTP, and accept valid v3
units/links without stored changes. Preserve v1/v2 wire hashes. Installed artifact
uses the same schema and preserves correction/cold-reopen tests. Measure full
request size/local token cost for a small positive synthetic fixture against the
base; show it remains under the unchanged 6000 input/3072 output limits and that
over-limit requests still reject before provider contact. No new runtime
dependency or ad-hoc production schema-validation engine. Do not relax budgets.

SCC5 — Delivery evidence. Run generic/JSON/strict plugin, core/store demo,
OpenAI/offline demo, artifact and opt-in installed rationale gates on both
Node22.16/24.15. Primary independently checks schema matrix, legacy wire parity
and installed behavior. Freeze, separate Standards and Spec reviews, then PR and
all applicable CI at the exact final SHA. Changelog/docs explain v3 schema
tightening and remaining semantic limits, without claiming model reliability.

## Source and ownership

Primary checked official OpenAI documentation on 2026-09-18:
https://developers.openai.com/api/docs/guides/structured-outputs
It documents nested anyOf, minItems/maxItems, required closed objects and excludes
if/then/else/allOf. Provider support for the exact new schema remains to be tested
in a separately frozen fresh diagnostic after local/CI acceptance; mocks cannot
prove the live service accepts it or that the model selects the right facts.

Primary owns this plan and acceptance. Existing Sol/high worker owns scoped
schema/test/docs changes; preserve accepted source-reason-links and consumed
SRP/SSR/SCL files. Allowed core/source-context-units.mjs schema construction only,
relevant core/OpenAI/packaging tests, docs/source-context-units.md,
docs/openai-provider.md and CHANGELOG.md. No compiler semantic changes, prompts,
budget/ledger/operator changes, source fixtures from private experiments, new
dependencies or unrelated files. The separate reporter-inference failure is
explicitly unresolved by this slice; do not hide it behind structural success.
