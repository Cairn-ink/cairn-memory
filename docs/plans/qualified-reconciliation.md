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
  All verdicts require item-bound evidence; only retiring verdicts require a user
  source, so an assistant-only proposal can be classified without granting it
  authority. Omitted predecessors are untouched, not certified compatible.
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

## Offline verification checkpoint

Node 22.16.0 and 24.15.0 passed `test:core`, `test:openai` (152 cases), `test:mcp`,
`test:experiment-request-guard`, `test:live-evidence-offline`, `test:artifact`
(14 cases), `npm test` (31 cases), `validate`, `demo:store`, `demo:capture` and
`demo:openai-offline`. The generic live suite has 27 explicit opt-in skips, not
27 successes. Separately, the installed ordered and legacy capture suites passed
26/26 with zero skips on each runtime using all four public artifact selectors.
Pinned Claude marketplace and strict plugin validation passed on Node 22.16.

Installed artifact SHA256:
`7e863b87cc7a3369041e77fdc22f0df1f8be22aadf54907ae8ad384953e9c3a3`.
The installed suites exercise actual core, tokenizer, fake HTTP, MCP processes,
restart, correction, forgetting and injected failures, not a real provider.
Original source/evidence pins remain unchanged. No paid calls were made.
