# Mixed-runner ingestion stop diagnostics

Fixed base: `de148532e553c7825a1c3afc9860b6fd5e3863ad` (frozen S3 runtime).
Branch: `feat/mixed-ingestion-observability`. This is an observability correction
for *future synthetic or separately authorized runs*, not a repair or replay of
the completed 30-case S3 result. The old result and operational artifacts stay
immutable. No new campaign, retry, refund, provider request or scope change is
authorized by this plan.

## Observable acceptance

- O1 RED: an actual `runMixedGeneration` synthetic case whose indexed-window
  capture returns a noncompleted outcome currently reports only
  `ingestion_incomplete`/`stage:execution`, losing the already-sanitized capture
  status, safe error code and batch position. Retain that failing test output
  before implementation.
- O2 GREEN: when the runner's recomputed ingestion plan differs from the frozen
  expected plan or the outcome count differs, preserve `ingestion_incomplete`
  failure and a fixed `ingestion.kind:plan_mismatch`; do not present a capture
  error as its cause. When a planned capture outcome disqualifies the arm, use
  `ingestion.kind:capture_outcome`, fixed counts for `completed`, `duplicate`,
  `failed`, `partial`, `unknown`, `not_run`, and the first noncompleted,
  arm-disqualifying batch's numeric index and allowlisted status. A duplicate
  can be followed by another ingestion batch even though the mixed runner
  rejects the arm; `firstStop` is not necessarily the capture-loop stop.
  Include only the existing `projectIngestionFailure` finite error
  stage/code/retryable where available;
  unknown private/provider values are collapsed by that existing sanitizer.
  No source text, event IDs, question/answer, receipt, model output, arbitrary
  exception string or dynamic diagnostic key crosses the report boundary.
  The existing `createOpenAIModel(onDiagnostic)` hook additionally records at
  most 64 of the core's finite-vocabulary `{version, stage, layer, reason}`
  observations and an omitted count. These are observational clues, not a
  replacement for the capture outcome or a proof of its cause. An observer
  failure must not change capture behavior.
- O3 The runner still revokes only a semantic failure, settles/cleans the guard
  and core, keeps the Cairn arm failed, produces no partial answer, and continues
  the fixed next arm/case under existing authority. Completed arms retain their
  existing report shape and semantics exactly. There is no new network/model
  call, validation relaxation, budget change or success reinterpretation.
- O4 The real generation report remains accepted by `scoreMixedGeneration`,
  which keeps fixed-N unresolved judgments for failed arms. Existing report
  snapshot size/node limits and strict source/guard validation stay in force.
- O5 Synthetic tests cover actual mixed-runner capture failures and real core
  capture/fake HTTP extract and qualification core validation, classification
  adapter failure, and malformed-response boundaries. An admission error is
  exercised at the pure ingestion-outcome projection boundary, not mislabeled
  as an induced real SQLite fault. A non-settled HTTP failure may instead halt
  the guard; do not change that accounting rule. Projected diagnostics
  distinguish known boundaries without implying the unknown cause of S3.
  Also test plan mismatch, every outcome counter, safe-error fallback, privacy,
  no answer, scorer, unchanged completed path, diagnostic overflow and observer
  failure without changing the original operation's outcome.
- O6 Verify focused tests and required generic, LongMemEval, mixed demo and
  native-local gates on Node 22.16 and 24.15; inspect the full fixed-base diff,
  make a local candidate commit only, then hand to primary and independent
  Standards/Spec reviewers. Document the metadata threat boundary in
  `docs/protocol.md` and the old-run evidence limit in `docs/limitations.md`.
  Do not push or open a PR before primary approval.

## Evidence and limits

The completed S3 diagnostic report records 30 Cairn `ingestion_incomplete`
arms; read-only store inspection found a released pending capture claim in each
store. This proves pre-admission stops, not their individual internal error
codes. This correction cannot reconstruct information absent from those old
artifacts and does not promote that result to a reliability comparison.
