# Decision-transition diagnostic result record

Base `bdc7be8a59b2a535144e1c851133a1fa970cc442`; sibling of the source-rank-first
implementation. Preserve the frozen experiment; no retries or model calls.

## Acceptance

- DTR1. Publish a compact synthetic-only JSON and readable report for all four
  cases and all twelve planned answer slots, including the unavailable arm.
  State source/fixture/rubric/operator/archive/final-report hashes and exact
  model, limits, request counts and observed accounting. Known token-cost
  estimates are not invoices; count-only unknown costs are not failed requests.
- DTR2. Separate submitted original messages, retained source events and memory
  units, post-rank selected roots, expanded neighborhoods, delivered sources,
  literal anchors and source-supported answers. Derive roots from actual rank
  requests and responses, never from projected union or pre-rank MOC selection.
  Report normal and projected product paths separately from full-history
  diagnostic groups and their synthetic revision/currentness placeholders.
- DTR3. Preserve actual answer texts and assess required claims independently
  of unsupported extra statements. Use primary and independent AI judgments;
  label them nonblind synthetic development assessment, not human review or
  general reliability/accuracy. Preserve disagreements and their disposition.
  Do not turn eleven generated answers into eleven semantic passes.
- DTR4. Record first projected arm's context_item_too_large: six ranked roots,
  seven unique memory identities in their union, six distinct original source
  events, with two units sharing one event. The frozen pure projector replay
  must fail identically. This is distinct from pre-rank unrelated-neighborhood
  blocking and not fixed by source-rank-first. Do not merge memory identities
  by text or relax the cap in this report.
- DTR5. Record all twelve natural captures completed and all eight memory-arm
  before/after snapshots matching their cold baseline, including failed recall.
  The snapshot covers admitted-source/graph data, not every SQLite table. No
  causal benefit or readiness claim: four engineered paired cases are small,
  one-shot, nonblind, different rank/context inputs, no real-user evaluation.
- DTR6. Add offline structural/regression tests for report completeness,
  accounting, inventories, unavailable-arm distinction, and limitation flags.
  Generic tests and JSON/strict validation on Node22.16 and24.15; run any other
  gates required by modified files. All public content must exclude credentials,
  private filesystem paths, account/ledger identifiers and raw provider IDs.
  Independent Standards/Spec review and primary verification before push/PR.

## Ownership

One worker writes only docs/decision-transition-results.{json,md}, this plan,
and evaluation/architecture/test/decision-transition-results.test.mjs. Primary
supplies final semantic adjudication after independent review. No source,
fixture, rubric, operator, policy, grant or raw evidence edits. No merge/release.

## Frozen result preparation

The prepared [JSON record](../decision-transition-results.json) and [readable
report](../decision-transition-results.md) are derived from frozen final-report
SHA-256 `4cfe3fcb92298abc3bc5267194f4994cadca9c4d837feaa25e22473642397ca9`.
They contain only synthetic fixture IDs and local unit labels, not private paths,
account/ledger identifiers, provider IDs or credentials. The JSON preserves
the 11 exact answer strings. The primary's final semantic adjudication and the
independent nonblind AI review are reflected separately from literal-anchor
availability; the unavailable projected slot remains in the denominator.

Worker verification on Node 22.16.0 and 24.15.0: focused result test 5/5,
`npm test` 148/148, `npm run validate` passed, strict parse of the new JSON
passed, and `node --check` of the new test passed. After `npm ci --prefix
tools/plugin-validation` in this worktree, the documented `npm run validate
--prefix tools/plugin-validation` passed both the marketplace and strict plugin
checks on both runtimes. The first focused run found
an ordering-only expectation mismatch in the deduplicated source-event list;
the assertion now compares sets because the recorded list is sorted, and the
focused test was rerun green. No source fixture, operator, model, key, real
ledger or provider call was changed or used for this reporting work. Primary
acceptance and both independent reviews remain separate gates before any push.
