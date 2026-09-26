# Bounded benchmark monetary-budget extension

## Authority and boundary

Base `4bc8892f3699e24191331f75c64483f42f45fde9` is the reviewed, unmerged
request-allowance candidate. The user authorizes one cumulative benchmark
ceiling change from US$50 (`50_000_000` micro-USD) to US$100 (`100_000_000`
micro-USD), retaining the same run and all existing accounting history. This is
not another US$100, a refund, a new ledger, a retry/resume authorization, or
permission to change models, prices, stages, deadlines, prompts, methods, raw
data, credentials, production state, or core behavior. All implementation and
verification uses synthetic private ledgers; applying it to the campaign is a
separate operator action owned by the primary.

## Acceptance

- **B1 — One explicit bounded transition.** Export a separate operator-only
  budget-extension function whose detached, read-once, closed inputs name the
  exact current `benchmark-request-allowance-v1` grant, its ledger/policy, a new
  authorization ID, a strictly higher positive safe-integer monetary target, a
  strictly higher finite safe-integer request cap, and an exact request/
  reservation checkpoint. The campaign invocation is separately pinned to
  `50_000_000` → `100_000_000` micro-USD by this plan. Old and new
  configurations may differ only in monetary ceiling and request cap. Ordinary
  constructors never discover or perform this transition.
  Parameterizing the two strictly increasing ceilings keeps the operator
  primitive reusable; it is not general migration or chaining authority, and
  the reviewed campaign invocation may not exceed the cumulative US$100 grant.
- **B2 — Audited create-only transaction.** Under the existing SQLite writer
  exclusion, verify private nonsymlink paths, exact ledger configuration/schema,
  original policy and benchmark files, the current request-allowance file, an
  open/non-overrun state, no unsettled reservations, exact counters, and the
  canonical SHA256 of the complete ordered five-field attempt history. Create a
  deterministic, mode-0600 authorization file with exclusive creation, fsync it
  and its directory, then conditionally update only `limit_micro_usd` and
  `request_cap` before commit. The run ID, directory, all ordered attempts,
  reservations, outcomes, original policy/benchmark/request-allowance files,
  models, rates, stages, and deadlines remain byte-for-byte or value-for-value
  unchanged. Unknown terminal cost remains unknown and charged by reservation.
- **B3 — Fail closed and recover only metadata.** Malformed/tampered bindings,
  unsafe paths, wrong IDs/config/checkpoint/history, unsettled attempts, overrun,
  lock contention, reductions/equality, unsafe replacement and second/chained
  transitions fail before authority changes or transport. A fully durable exact
  authorization with the old checkpoint may finish the same interrupted update;
  an already committed exact transition may be verified and returned. File
  write/fsync, update and pre/post-commit failure boundaries have deterministic
  recovery or fail closed without deleting or repairing partial files. Recovery
  never retries/resumes a case or provider request.
- **B4 — Explicit derived grant and stale-authority fence.** The new immutable
  `benchmark-budget-extension-v1` grant embeds the old/new configurations, exact
  v1 request allowance, unchanged policy/stages, checkpoint and history digest.
  Its filename is derived from validated existing authorization identity, never
  directory scanning. Before each reservation, verify the original v1 binding,
  the budget binding, and its exact historical prefix. Old ledger handles, old
  v1 benchmark guards, and old consumed or unconsumed case capabilities cannot
  send after the transition. A freshly authorized one-shot case capability may
  use the derived grant; no other guard/method gains authority.
- **B5 — Loader-only CLI opt-in.** Add the smallest public-pilot CLI option that
  explicitly loads an already-issued budget extension together with its v1
  request-allowance identity. The CLI never invokes the operator transition.
  Existing behavior stays unchanged when the option is absent. Missing,
  malformed or foreign grants fail before credentials, claims, reservations or
  requests. Keyless dry-run verifies and reports the effective cumulative limit,
  finite cap and authorization identity without source text, keys or raw errors.
- **B5a — Existing case boundary, not a registry.** The transition cannot
  revive any old capability or consumed claim. The operator separately freezes
  a disjoint roster (including prior failed or unexecuted cases) before issuing
  a fresh capability. This budget grant does not introduce a cross-execution
  case registry and does not make a newly issued same-case capability safe.
- **B6 — Offline observable coverage.** Retain a RED proving that the fixed base
  rejects a larger-limit reopen and rejects the old v1 grant against that config.
  Synthetic tests cover B1–B5, including exact checkpoint/history preservation,
  known and unknown outcomes, stale handles/claims, per-send tampering, no
  automatic upgrade, fake-HTTP generation/scoring through a fresh case grant,
  and monetary exhaustion. The actual CLI subprocess dry-run performs zero
  claims, reservations and requests. No provider call, credential use, real
  dataset access, or campaign mutation is part of verification.
- **B7 — Gates and delivery.** Run focused budget-extension, request-guard and
  public-pilot tests plus package JSON validation and the repository's relevant
  offline gates on Node 22.16 and Node 24. Freeze only scoped evaluation/docs/
  package changes in one local commit. Do not push, open or merge a PR; the
  primary owns independent review and delivery of this dependent stack.

## Ownership and evidence

The primary owns the architecture, live boundary, acceptance, review and any
later campaign operation. Actual implementation is assigned to one Sol/high
worker. Record RED/GREEN commands, exact runtime versions, candidate SHA and
review corrections here; never infer provider or agent spend from a model name.

## Implementation evidence

- Fixed-base RED at `4bc8892f3699e24191331f75c64483f42f45fde9`:
  a synthetic current `benchmark-request-allowance-v1` ledger refused both a
  proposed larger-limit reopen and use of the old v1 grant with
  `configuration_mismatch`.
- The implementation adds one explicit, parameterized but non-chainable
  `benchmark-budget-extension-v1` operator transition and one read-only loader.
  The campaign authority in this plan remains pinned to cumulative
  `50_000_000` → `100_000_000` micro-USD; the operator code requires strictly
  increasing positive safe-integer money and request ceilings and never scans
  for or invents authority.
- Focused final GREEN on Node 22.16.0 and Node 24.20.0: budget extension 13/13,
  original request allowance 20/20, and actual public-pilot CLI budget-loader
  dry-run/live integration 1/1. The tests use only temporary synthetic ledgers
  and fake HTTP.
- Full final matrix on both runtimes: generic 106/106, budget 28/28, request
  guard 178/178, live-offline 302 pass with 30 documented installed-artifact
  skips, and LongMemEval 75/75. JSON/version validation, the budget and guard
  demos, all three LongMemEval demos, and pinned Claude Code 2.1.260 marketplace
  plus strict-plugin validation passed. Existing dependency trees were exposed
  through temporary local symlinks solely for test execution; those links were
  removed before freeze.
- No provider call, credential read, raw/private dataset access, campaign ledger
  write, push, PR or merge occurred. The separate campaign baseline and prepared
  paths supplied to the primary were not opened or modified by this worker.
