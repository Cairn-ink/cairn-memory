# Public comparison receipt canonicalization

## Scope and fixed base

This independent repair branches from the tested, unmerged PR197 candidate
`d3d08becbde6077a3736e0c415b11925f4aedd01`. The previously completed paid run,
its failures, scores, databases, roster, ledger and request allowance stay frozen.
This packet contains only offline synthetic verification and an unmerged PR.

Diagnosis reproduced `unknown_or_mismatched_receipt` on the actual public
comparison path when a normalized source exceeds 800 UTF-16 units and the
800-unit prefix ends in whitespace. Capture truncates the excerpt; admission
normalizes it again. The verifier currently expects only the first prefix.
An all-synthetic actual-core loop is RED; changing only the boundary character
to non-whitespace is GREEN. A copied retained database also exhibits this defect,
but the exact receipt selected by the original live ranker was not retained;
do not assert that offline diagnosis proves that particular live selection.

## Acceptance

- **C1 — Regress the real seam first.** Add a deterministic, keyless regression
  through actual local core capture and public comparison. Before the fix, an
  801-unit synthetic source with whitespace at unit 800 must be blocked for the
  exact receipt mismatch; a non-whitespace control must complete. Preserve RED
  evidence before applying the fix.
  The primary's caller scan also found an independently implemented prefix
  verifier in the older synthetic comparator. Check that path with its own
  actual-core RED/control before deciding whether the same repair applies.
  That separate loop now reproduces `failed/provenance_violation` at the
  whitespace boundary while its non-whitespace control completes. Include the
  older comparator in this same defect repair, without changing its protocol.
- **C2 — Match the existing stored contract.** Derive the one exact expected
  canonical stored receipt from the mapped source using the existing core text
  semantics. Keep current storage, source retention, schema, provider payloads,
  model prompts and bounds unchanged. Do not alter generic normalization or
  existing databases merely to satisfy the evaluator. No lenient prefix,
  substring, whitespace-insensitive comparison or alternate accepted forms.
  Both comparison adapters must use one small evaluation-local canonical helper
  backed by the existing core normalization function; do not introduce another
  storage implementation or change either adapter's other validation rules.
- **C3 — Preserve provenance rejection.** Continue checking event mapping,
  client/session/role binding, authoritative get identity/revision/namespace,
  receipt counts and recall-versus-authoritative exact equality. Independently
  mutate each relevant binding/excerpt and require a blocked arm with no Cairn
  answer request. Altering actual content must never pass as formatting repair.
- **C4 — Exercise canonical boundaries.** Include non-whitespace and whitespace
  truncation, short source, Unicode code-point boundaries, normalized whitespace
  and redaction cases where applicable. Tests exercise actual stored receipts,
  not only a helper implementing the same expectation. Use synthetic temporary
  databases and deterministic local callbacks; no keys, provider calls or corpus
  contents in repository fixtures.
- **C5 — Reconcile documentation honestly.** Document this as an evaluation
  provenance-adapter defect and its verified scope, not a recall or semantic
  quality improvement. Record historical outcomes as unchanged. Update the
  evaluation docs and limitations with a narrow note; do not edit prior results,
  README, release versions, frozen artifacts, budgets or operational policies.
- **C6 — Verify and deliver.** Run generic tests/JSON and strict plugin checks,
  LongMemEval suite plus ingestion/comparison/public demos on Node22.16 and24.15.
  Run the offline live-evidence suite for the pilot callers as primary
  integration acceptance, with its documented installed-case skips explicit.
  Rerun the original synthetic path against the repaired candidate. The primary
  inspects the complete diff and reruns key acceptance paths. Commit only scoped
  files; independent Standards and Spec reviewers inspect identical fixed
  base/head. Deliver a PR against main and monitor all applicable CI at its
  exact head. No merge, release, deployment, data repair or paid replay.

## Ownership

A bounded Sol/high worker owns implementation and regression tests; the primary
owns integration decisions, independent acceptance, dual-review coordination and
delivery. Two separate non-author Sol/high reviewers own Standards and Spec.
The risk is source-provenance validation, not product copy. Record actual work,
commands, results and corrections here or in the PR without raw private data.
