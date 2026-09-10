# Preserve bounded ingestion failure causes

Fixed base: a994ca82459274e1981efb3a5f345476031ea7ce (PR #41, depends on #40).
This separate reporting fix does not change model/core behavior or run models.

## Acceptance

- I1: Comparison ingestion outcomes retain the existing allowlisted nested
  classification error for partial admission, with `errorStage: classification`.
  Top-level failed/unknown capture results use `errorStage: capture`. Do not
  invent a more specific model stage. Preserve status, batch/event identity and
  top-level `ingestion_incomplete`, later not-run batches and baseline completion.
- I2: Pilot public aggregate projects optional `ingestionFailure: {stage, reason}`
  on the Cairn arm only, from the first recorded failure. No diagnostic for
  completed/duplicate/not-run outcomes or an absent failure. No new event IDs,
  batch indices, admission refs, raw results, text or exception properties in
  the aggregate diagnostic. Existing aggregate case IDs remain unchanged.
- I3: Use one shared finite ingestion failure projector based on the existing
  capture-code allowlist plus emitted fallback/status codes. Re-project at the
  aggregate boundary. Unknown strings (even legal-looking code strings) map to
  fixed fallback; unknown errors cannot preserve retryable true.
- I4: No changes to generation/scoring ordering or eligibility, prompts/models,
  limits, counts, core/runtime, old reports, original evidence or accounting.
  Never turn partial ingestion into success or claim old causes were recovered.
  The scorer must accept the optional new stage field with finite, consistent
  stage/status/error validation, while retaining acceptance of old reports
  without that field. Reject an unknown/mismatched stage or stage without error;
  new and old representations must yield the same scoring/denominators.
- I5: Offline tests cover known classification and capture causes, malformed and
  thrown failures, legal-looking private codes, success silence, stopped later
  batches and baseline completion. Actual scripted core pilot must retain the
  bounded cause in generation and aggregate JSON and exclude private sentinels.
- I6: Run LongMemEval suite/ingestion/comparison demos and live offline suite on
  Node22.16/24, generic plugin/JSON and pinned plugin validations. Independent
  Standards/Spec final-candidate reviews. No paid calls, private-app changes,
  merges, deployments or release.

## Privacy and historical evidence

The new stage/reason fields are content-free local experiment reporting, not
hosted protocol fields or telemetry. Finite projection at each report boundary
prevents arbitrary code-shaped strings from becoming an exfiltration channel.
Reports still require operator-controlled storage/retention. Old #40 reports
stay unchanged; newly preserving a cause does not identify the cause of a past
run whose underlying result was omitted.

## Verification

Bounded worker implemented reporting and regression tests; primary inspected
the code, kept the raw capture sanitizer unchanged and required missing-cause
and fallback-retryability negative tests. Integration tests exposed the scorer's
old exact shape rejecting the additive field; a narrow backward-compatible
validator update fixed that without changing the rubric or scoring eligibility.

Primary reran the combined LongMemEval and live-offline suites on Node 22.16.0
and 24.15.0: 52 passed, 0 failed, 1 explicitly skipped pinned-Hermes fixture gate
on each. No host fixture variables were supplied; this is not new actual-Hermes
evidence. The new actual-core pilot tests verify both capture and partial
classification failures through persisted generation/aggregate JSON with five
answer and five judge calls, not just a helper mock.

Ingestion and comparison demos passed on both runtimes with synthetic SQLite.
Plugin tests 31/31 and JSON/version checks passed on each; pinned Claude 2.1.260
marketplace and strict plugin validators passed. `git diff --check` passed.
No paid call, evidence overwrite, schema/rubric default change or private-app
mutation occurred. Two independent reviewers inspect the fixed final diff.
