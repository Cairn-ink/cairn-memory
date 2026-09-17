# SRL: explicit source-local reason associations

Fixed dependency base: `ecc39684a9fbc6a11149a65529f9cdf30e3a90dc` (PR171).
Isolated worktree `source-reason-links`, branch `feat/source-reason-links`.
Remote main observed `3c7b9ee322a52b6af12ac169eddf1e75eea0a1f9`; use the
explicit dependent base so accepted and consumed SCS evidence stays immutable.
No merge, release, deployment or paid experiment belongs to this slice.

## Problem and decision

A source-only diagnostic retained a decision and a supplier claim but omitted
their explicitly stated reason association from interpreted fields. Broad source
anchors preserved the word "because"; that is not a machine-readable association.
It also confused never-finalized choices with existing decisions needing recheck,
and inferred a reporter from a decision actor. These are observed authored-case
failures, not a general benchmark or proof of a model's internal cause.

Use one opt-in version3 in the existing source-context prepare/compile/bound
operation, inheriting v2 unit fields and adding bounded source-local reason links.
Do not create another engine or silently combine source-basis units with CU.
A prompt-only reason sentence does not encode which premise belongs to which
decision. Preserve v1/v2 contracts and prompts exactly. This is reversible opt-in
assessment, not an ADR-worthy persistence decision or a new product release.

## Acceptance

SRL1 — Compatibility and ownership. Explicit raw `{version:3,sources}` and bound
`{namespace,refs,version:3}` select the new shape. Versionless and version2 input,
prepared schemas, compiled results, bound prompts and serialized HTTP requests
remain unchanged against the fixed base. Other explicit versions reject. No new
MCP method, public transport route, default capture, persistence or live allowlist.
Use the existing core schema/compiler and adapter helper, not a copied engine.

SRL2 — Closed reason-link shape. Version3 proposal root is exactly
`{units,reasonLinks}`. Units keep all v2 requirements and the same at-most-eight
bound. Each of zero-to-eight reasonLinks has exactly
`{from,to,relation,evidence}`: integer request-local unit indices, relation literal
`stated-reason-for`, and one-to-four distinct original passage indices. The from
unit must be factual_claim; the to unit must be decision_state. Both must refer
to the SAME source AND receipt. No self links, invalid indices, cross-receipt or
cross-source links, duplicate endpoint pairs, sparse/extra fields or foreign
passage references. Empty links are permitted; no link is automatically inferred.
Schema bounds indices by the existing unit cap; compiler validates actual units.

SRL3 — Derived provenance, not truth. Compiled links retain from/to, the literal
relation, derived source/receipt indices and sorted exact original anchors from
their own evidence, plus interpretationStatus=`model-proposed-unverified`.
The bound path additionally binds memoryId/revision/receiptId from the same
captured source, never from model-supplied identifiers. Each result derives
version3 from caller input. Link direction describes the source's stated reason
for a choice, not objective causation, verified dependency, present applicability,
adoption authority or permission. Structural validation cannot prove that cited
words actually express a reason: a structurally valid but semantically wrong
link can compile and must be explicitly documented/tested as unverified.
No mapping or commit into existing persistent rationale edges in this slice.

SRL4 — Precise interpretation guidance, no semantic guarantee. A separate v3
prompt preserves proposition-local stance and roles. Require explicit reason
association, not co-occurrence/topic similarity or a retrospectively guessed
motive. Reasons can be given for consideration, adoption or rejection; a reason
link never upgrades a choice to adoption. An explicitly stated reason for
re-examining an existing decision may target its pending-reconfirmation unit;
it must not be relabeled as the original reason for adopting that choice.
Distinguish:

- Never finalized is not reconfirmation. Preserve considered when the source
  actually says considered; otherwise a factual negation/unknown is preferable
  to inventing a lifecycle state.
- Pending reconfirmation requires an existing decision explicitly needing
  re-examination; the source may itself identify that existing decision.
- No replacement selected yet is not evidence of approval being withheld, and
  certainly is not rejection of the original decision.
- Reporter is a stated relayer, not inferred from the decision actor or subject;
  absent attribution remains null. Claimant, reporter and subject may coincide
  only when the source supports that reading.
- Empty eventTimeContext is appropriate when no temporal context is stated;
  do not label arbitrary passages as dates. No parsed date/truth inference.

Define these boundaries in docs/glossary; do not claim a prompt or mock test
demonstrates that a real model obeys them. Do not add state enums or silently
repair semantically suspect output after generation.

SRL5 — Limits and freshness. Preserve existing input/output serialization bounds,
full request/schema6000input/3072output tokens, per-unit focus limits, source
snapshot/final revision fences, cancellation, bounded response reads and no retry.
New links count toward the same total compiled-output bound: fail closed on
overflow, do not trim links/qualifiers to manufacture success. No global receipt
coverage guarantee; the unit cap remains unchanged. No claim of a lightweight
consumer projection yet; source deduplication is separate future work.

SRL6 — Evidence. Add positive same-receipt reason links with multiple propositions,
reason for consideration/rejection (no adoption inference), empty links, wrong
direction/kind, cross-source/receipt, invalid/duplicate evidence and endpoints,
missing/extra fields, detached/frozen output, output overflow and semantically
wrong-but-structurally-valid examples. Preserve legacy v1/v2 byte-wire regression
fixtures against the fixed base. Exercise actual bound core plus adapter fake
HTTP and installed artifact v3; check identity binding, successful assessment
sourceSnapshot unchanged, correction during a call rejected and no derived
data persisted after close/reopen. New prompt must be in artifact allowlist.
Run generic/JSON/strict plugin, core/store demo, OpenAI/offline demo, artifact and
installed rationale gates on Node22.16/24.15. Primary independently verifies key
paths. Separate Standards and Spec reviewers inspect the same final candidate.
Only after local/CI delivery acceptance may a separately frozen fresh synthetic
experiment evaluate whether the new representation helps semantic outcomes.

## Ownership and scope

Primary owns this plan, glossary decisions, integration and acceptance. Existing
Sol/high worker implements scoped core/prompt/adapter-helper/tests/docs/CONTEXT/
artifact allowlist changes. Preserve private fixtures/rubrics/raw outputs outside
public files; public tests use distinct synthetic examples. Do not edit consumed
SSR/SCL operators or the accepted SCS worktree. No worktree cleanup or main edits.

Glossary clarification: recorded rationale is an explicitly attributed reason
association, not merely two related facts; never-finalized choice is distinct
from a previously recorded decision needing reconfirmation. Keep CONTEXT a
glossary, not an implementation map. No second tracking system or GitHub issue.
