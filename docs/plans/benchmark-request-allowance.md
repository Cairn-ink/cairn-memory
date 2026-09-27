# Monetary-bound benchmark request allowance

## Authority and fixed base

Base `40683b78e16f28c55b3c031ed00bdcc8e18fb487` (reviewed, unmerged PR200).
The user explicitly removed the cumulative request-count approval restriction,
provided the existing cumulative US$50 monetary ceiling remains unchanged.
This is not a new budget, retry permission or permission to reset historical
reservations. No core, provider model/prompt, ranking, scoring, release or
production behavior changes. Implementation and tests use synthetic ledgers;
only the primary may separately apply the reviewed operator transition to the
existing campaign after all gates and a checkpoint audit.

## Acceptance

- **A1 — Explicit cap-only authority.** Add a separate operator-only,
  benchmark-specific request-allowance API. Closed detached/read-once inputs
  identify the exact old ledger, policy, original benchmark token, authorization
  ID, higher finite safe-integer request cap and expected request/reservation
  checkpoint. New/old configuration may differ only in request cap. The API must
  not initialize a missing ledger, change run ID/directory/money, reset or refund
  reservations, rewrite attempts/outcomes, add models/methods/stages/rates or
  automatically discover authority. Ordinary constructors/authorization remain
  unchanged. A finite operational cap remains even though user approval is now
  constrained by money, not request count.
- **A2 — Durable transaction and history.** Under the existing SQLite writer
  exclusion, verify private paths, exact schema/config, original on-disk policy
  and benchmark bindings, open/non-overrun state, no unsettled attempts and exact
  checkpoint. Compute canonical SHA256 over the ordered exact five-field
  historical attempt prefix (attemptId/channel/reservedMicroUsd/outcome/
  actualMicroUsd). Persist a new create-only mode-0600 derived authorization and
  fsync file/directory before conditionally changing only run_config.request_cap
  and committing. Preserve every original binding/claim/config/artifact byte;
  terminal unknowns remain charged history, never zero/refunded.
- **A3 — Crash safety and replay limits.** No partial/mismatched/unsafe binding
  is deleted, replaced or repaired. A fully durable exact binding plus unchanged
  old checkpoint may complete that same interrupted transition; an already
  committed exact transition may verify/return without further mutation. These
  are metadata-operation recovery only, never provider retry or case resume.
  Different authorization/cap, reduction/equality, chaining, wrong checkpoint,
  new missing binding or foreign history fails closed. Normalize failures without
  raw paths/SQLite/provider details. Existing writer-lock/race fences remain.
- **A4 — Derived benchmark verification only.** Recognize one explicit derived
  benchmark version containing old/new configs, exact original benchmark grant,
  unchanged policy/stages, checkpoint and history digest. Its separate filename
  is deterministic from validated operator inputs, never chosen by directory
  scan. Verify original v1 grant and new binding plus exact historical prefix
  before every new reservation. Do not broaden legacy/extraction/other method
  constructors. Old open handles/guards and old cap-bound capabilities must fail
  before transport after the transition. A fresh one-shot case capability may
  use the derived grant; old consumed/unconsumed executions never revive.
- **A5 — Explicit runner loading, not implicit migration.** Add the smallest
  explicit opt-in CLI path that only loads/verifies an already-issued derived
  grant. The CLI must never invoke the cap-increase operator. Preserve old CLI
  behavior, answer-v2, models, limits, guard policies, timeout isolation, key
  deferral, no-resume/no-retry and accounting-first persistence. Dry runs remain
  keyless with zero reservations/claims; missing/malformed/foreign grants reject
  before credentials, requests or claims. Summaries truthfully expose effective
  cap and grant identity without keys, source text or raw errors. Existing
  benchmark authorization identity must match the grant's original benchmark.
- **A6 — Observable offline safety and integration.** Establish current RED
  larger-cap reopen and old-grant mismatch behavior; test successful cap-only
  transition with exact preserved ordered rows/counters/money and known/unknown
  outcomes. Cover cap/ID/config/checkpoint/history tampering, unsettled/overrun,
  missing/unsafe/symlink bindings, writer-lock contention and stale handles;
  inject file-write/fsync/update/commit boundary failures with synthetic fixtures
  and prove exact recovery or fail-closed behavior. Test idempotent exact metadata
  recovery, denied different/second transition, untouched original bindings,
  per-send prefix verification, no widening of model/method/prices, actual fake
  HTTP new case execution and money exhaustion, unknown global halt, old case
  claim denial. Run actual CLI keyless dry-run and synthetic live generation/
  scoring through the derived grant; prove no automatic migration/default opt-in.
- **A7 — Scope, verification and delivery.** Allowed: experiment-budget guard
  implementation and focused tests (ledger implementation only if required and
  explained), explicit public-pilot CLI loading and its focused tests, related
  evaluation/privacy docs and this plan. No core, model adapter, prompt, old
  result, README, real ledger or credential changes by workers. Both Node22.16
  and24.15: generic, JSON, strict plugin, budget tests/demo, request-guard tests/
  demo, full live-offline suite, LongMemEval and its three demos. Primary inspects
  all source, personally reruns key gates and verifies exact content. Freeze a
  scoped local commit, get independent non-author Standards/Spec reviews, then
  PR against main and all exact-head CI. No merge/release/deployment. Paid launch
  is a later independently audited step using the same monetary ledger.

## Ownership

Primary owns architecture, contract, live authority boundary and acceptance.
One actual Sol/high worker implements this bounded cross-layer authorization
packet; separate non-author Sol/high reviewers inspect the exact final commit.
Record evidence/corrections in this plan or PR, never infer agent cost from a
model label. Private corpus preparation is a separate concurrent worker packet.

## Implementation evidence

- The implementation uses one singleton derived-binding filename keyed by the
  validated original benchmark authorization ID. The target cap and new
  authorization ID remain inside its canonical contents, so a durable intent
  from an interrupted transition cannot be displaced by a different intent.
- The retained behavioral RED is
  `a7dcc74b59b7e909f27e43d02105231542eda92d3ed830904d2b9d9e15bc3287`:
  on the fixed base, both reopening at a larger cap and using the old benchmark
  grant with that cap failed with `configuration_mismatch`. Earlier scaffold
  runs that failed only on imports were discarded and are not claimed as RED.
- The actual Sol/high implementation owner added synthetic coverage for exact
  history preservation, stale authority denial, explicit loading, fake-HTTP
  execution and every A6 boundary. Focused allowance tests pass 18/18 and the
  focused derived CLI test passes 1/1 on Node 22.16 and 24.15. The worker's
  duplicate frozen-tree gates passed generic 106/106, JSON, strict plugin,
  budget 15/15 plus demo, guard 148/148 plus demo, and live-offline
  301 pass/30 documented installed-artifact skips out of 331 on both runtimes.
- Primary inspected the complete source and independently ran the full A7
  matrix on both runtimes: generic 106, budget 15, guard 148, LongMemEval 75,
  live-offline 301 pass/30 documented skips, JSON, strict plugin, both budget
  and guard demos, and all three LongMemEval demos passed. Frozen file hashes
  were identical before and after that matrix. No provider call or campaign
  mutation was part of these gates.
- Review corrections before freeze added original-grant checkpoint validation,
  fixed-envelope validation for malformed nested ledger configurations, and
  file/directory re-fsync before recovery updates. Final crash tests added
  partial file-write and pre-commit failures and a failed recovery re-fsync
  before successful exact recovery. A Node 24 built-in-module mocking failure
  was a test-harness defect; the portable injection retained the same product
  assertions and passed on both runtimes. The CLI help now classifies the loader
  flag as optional. Two private read-only operator-audit helper expectation/
  canonicalization defects were also corrected before any live mutation; they
  caused no repository or money change.
- The first formal Spec review reported two medium findings and one low
  finding. The correction round now retains derived-allowance identity in the
  live manifest, report operator metadata and final stdout; validates canonical
  binding bytes and fsyncs them on the same verified descriptor; and rechecks
  the binding path identity after directory fsync before the cap transaction.
  Deterministic file-fsync and directory-fsync replacement injections prove
  denial without a cap change. An actual keyless CLI subprocess dry-run also
  proves zero attempts and claims with the exact derived identity.
- After those corrections, focused allowance tests passed 20/20 and the actual
  CLI subprocess target passed 1/1 on both Node 22.16 and 24.15. Primary's final
  12-gate matrix passed on both runtimes with unchanged frozen hashes: generic
  106, budget 15, final guard 150 (the earlier 148 count above is historical),
  LongMemEval 75, live-offline 301 pass/30 documented skips, JSON, strict
  plugin, both budget/guard demos, and all three LongMemEval demos. No provider
  call or real campaign mutation occurred.
