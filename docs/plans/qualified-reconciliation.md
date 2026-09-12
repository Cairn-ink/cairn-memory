# Qualified reconciliation: first reliability implementation slice

Parent runtime: PR #58 at `08b566fc6949f65148460e23919e49fcfb188fef`.
Parent contract: PR #59, carried as `294a2e5` on this dependent branch.
Fixed implementation/review base: `294a2e5`.
No merge, publication, deployment or paid experiment is included.

## Acceptance

- Q1: retain bounded one-call reconciliation and existing input privacy. Every
  nonempty model transition now requires relation (supersedes, reaffirms,
  historical_context, compatible, unresolved), valueChange (changed, unchanged,
  unknown) and adoption (explicit, not_adopted, uncertain), in addition to the
  existing source-bound indices. No free-text motives or model-created receipts.
- Q2: only supersedes + changed + explicit may reach the existing atomic
  retirement seam. Reject contradictory supersedes tuples, unknown/missing fields,
  duplicates and unbound evidence before any admission. Validate nonretiring
  entries too, then discard them from retirement decisions. Empty output remains
  valid; legacy nonempty tuples lacking qualifications fail closed. No implicit
  fallback, new model call, expanded budget or silent migration of old evidence.
- Q3: prompts distinguish current-value change from restatement with historical
  context, proposals, assistant recommendations, changed subject/scope and
  uncertain evidence. Source role/order is necessary evidence binding, not proof
  of entailment. No date/name keyword patches or fixture-specific rules.
- Q4: scripted actual-core tests check unchanged predecessor state and supported
  positive replacement, atomic rejection, source/revision/replay/namespace guards
  and cold reads. Test nonretiring judgments and paired later explicit adoption.
  Provider fake-HTTP tests enforce strict request-scoped output schema. Update
  scripted integrations to the new port, never rewrite retained real-model data.
- Q5: docs explain this is a changed experimental injected model-port contract,
  not a hosted protocol change. Existing database, capture response, immutable
  replay results and prompt input shape stay unchanged. Nonretiring relation
  labels are not yet stored or exposed as conflict/rationale/history QA features.
- Q6: Node 22.16 and 24 required core, adapter, MCP and affected evaluation gates,
  demos, generic validation and packaging regression pass; exact-commit independent
  Standards/Spec reviews precede push. Offline passing does not resolve the retained
  C6 semantic failure or authorize paid reruns.

This is an inspectable judgment contract, not three independent model votes.
Correlated mistaken labels can still retire an assertion incorrectly. Fresh
held-out semantic evaluation remains necessary; no reliability percentage is
claimed. Qualified extraction, persisted conflicts, premise dependencies and
query views remain later slices of the parent reliability contract.
