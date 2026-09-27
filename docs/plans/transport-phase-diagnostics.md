# Bounded transport-phase diagnostics (TD1–TD6)

Fixed base `9ac117671a0ba714d427fe1129823bfcfebe19a3`; isolated branch
`test/transport-phase-diagnostics`. Owner: GPT-6 Sol, high effort. This is a
private synthetic-diagnostic slice for the one-shot case-deadline benchmark
path, not provider-root-cause evidence or a new paid authority.

## Acceptance contract

- TD1: Only `createCaseDeadlineExperimentRequestGuard` and its trusted live
  session accept optional `transportDiagnostics:'bounded-v1'`. The guard reads
  the caller field once and rejects any other value before the irrevocable
  case-deadline claim. Baseline and benchmark constructors retain their exact
  option allowlists. The CLI accepts `--transport-diagnostics bounded-v1`
  only with the complete case-deadline flag set, rejects invalid combinations
  before ledger, output, key or claim effects, and reflects the opt-in in a
  dry-run without authorizing a request or consuming a claim. Omission keeps
  default byte shape and behavior unchanged.
- TD2: A guard-internal collector retains only the current/latest schedule
  scope and the latest 256 attempt rows; oldest rows drop first with explicit
  total/dropped counts. Its closed v1 row contains only schedule ordinal,
  generation/scoring phase, per-scope attempt ordinal, route
  `count|generation|answer|judge`, validated Cairn method
  `extract|classify|select|rank|unknown` (count and host routes unknown),
  monotonic nonnegative bounded elapsed `fetchEnteredMs`,
  `responseAvailableMs`, `bodyCompleteMs`, `settledMs` (null if unreached), a
  closed termination enum and `accountingOutcome:null|succeeded|failed|unknown`.
  No user callback, case/attempt ID, source/question/answer, model ID, raw
  URL/error/body/header/key/usage or arbitrary string enters a row. Response
  availability means availability to this guard, not wire/provider proof.
- TD3: Collection cannot change 30-second core and 60-second transport timers,
  retries, request/response bytes, policy caps, scorer, accounting or sticky
  halt rules. One row seals at the existing settle point, including ledger
  failure with `accountingOutcome:null`; an exceptional unsettled path closes
  in `finally`. A closed scope cannot be mutated by late work or contaminate
  another scope. Getter snapshots are detached and read-only. Observation
  failures cannot swallow genuine guard failures or grant another attempt.
- TD4: Only the enabled guard has `transportDiagnostics()`. Trusted session
  integration is internal, not an arbitrary caller callback. `runGeneration`
  adds `transport` only to private per-case `diagnostics.json` for an enabled
  case-deadline session and writes that file last, after accounting/timings.
  Legacy/custom/default sessions omit it; aggregate score and public report
  schemas do not change. This slice persists generation scopes (including
  answer requests), not a new scoring artifact; scoring remains inspectable
  programmatically via the guard getter.
- TD5: Actual guard/fake-HTTP tests compare enabled and disabled results and
  ledger outcomes, distinguish count and validated generation methods,
  localize fetch-wait versus body-wait failures, and cover core/transport/
  external aborts, invalid option before claim, failed ledger settlement,
  detached snapshot mutation, cross-scope/late-completion fencing, and >256
  overflow retaining the final failure. Actual public-pilot fake-HTTP tests
  show absent/default versus enabled private transport, unchanged score
  results and no sensitive literal leakage. CLI tests cover invalid opt-in and
  dry-run safety. Existing deadline semantics and assertions are retained;
  relevant tests add observation assertions.
- TD6: Both Node 22.16 and 24.15 pass generic tests, JSON and strict plugin
  validation, experiment-budget suite/demo, request-guard suite/demo, and
  live-evidence-offline suite with isolated adapters installed. Focused tests
  run first. No provider account/key, paid call, real ledger, historical 30-case
  rerun, schema/dependency/policy/core/scorer change, push or merge.

## Entrypoints and dependent checks

Guard: constructor validation -> one-shot claim -> case scope -> validated
request -> shared send/settle -> private getter. Runner: trusted WeakMap session
-> generation scope -> diagnostics last. CLI: argument gate -> dry-run or
capability/session creation. Existing benchmark/baseline route wrappers and
case-deadline attempt accounting are negative controls. Tests should exercise
the real fake transport and ledger, not just collector snapshots. No public
aggregate, scoring, model callback or telemetry consumer is changed.

The collector cannot reveal which provider component caused a delay. A local
fetch timer and response-body timer only identify where the guard observed a
stall; provider processing, network buffering and transport implementation
remain unresolved.
