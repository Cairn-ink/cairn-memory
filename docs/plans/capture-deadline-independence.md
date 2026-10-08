# Deterministic same-core capture deadline independence

Status: contract fixed before implementation; offline fixture-only correction.
Base: `1a7a4826ea310a07b281a7c2133cd51826db1dc9`.
Branch: `test/capture-deadline-independence`; target `docs/source-competition-results`.

## Evidence and diagnosis

Result-only PR #372 CI run 37815702279 failed the Node22 D2/D4 deadline test:
1212/1213 passed; a later capture classified as failed rather than applied.
Node24's 1213 tests passed before sibling-job cancellation. The relevant runtime
and test files are identical to the result PR base. Focused tests pass locally.
A minimal actual-core probe reproduces the same failed/applied assertion when
1001 ms elapses after admission under a 1000 ms aggregate deadline. Removing
that advance, or removing the aggregate deadline, makes the probe pass. This
proves a timing-sensitive assertion; CI did not record enough detail to prove
CPU starvation or the exact classification error. Do not claim otherwise.

The solution must preserve the same-core sequential invocation guarantee; a
different core without a deadline would weaken that coverage. Do not change
production deadlines or simply increase a timeout to get a green rerun.

## Acceptance

- D1 Scope only this plan, `core/test/capture-invocation-deadline.test.mjs` and
  new `core/testing/capture-independence-clock-child.mjs`. Replace only the
  D2/D4 independence case; preserve all other real deadline tests. No runtime,
  source-retention, model, configuration, release, ledger or corpus changes.
- D2 Child installs a controlled monotonic clock before dynamically importing
  the actual core, as existing clock children do. Native model-call timers stay
  real. Use one core with the original 1000 ms aggregate limit. Start a stalled
  extraction at time 0, advance to 1001 inside its actual model callback, await
  genuine timer timeout, and verify aborted signal with private core provenance,
  rejection of externally constructed provenance, no memory/receipt/classification.
  Resolve the first promise late and flush asynchronous work; still no writes.
- D3 At frozen time 1001, capture a fresh event on that very same core. Its
  signal differs from the aborted one and is initially un-aborted; admission and
  classification complete exactly once, with the expected persisted receipt and
  initial classification journal. Core limits/protocol are unchanged. No host
  elapsed-time threshold determines the healthy second invocation's verdict.
- D4 A child-only import mutation reuses the first returned capture deadline.
  Verify exactly one intended module mutation. First-call timeout and late-result
  checks still pass; second invocation must fail the tagged independence assertion.
  Baseline child exit 0; mutation child expected exit 2. The parent requires the
  exact tag and stage, not merely any nonzero exit. This is a deliberately wrong
  implementation counterfactual, not a production regression claim.
- D5 Use owned temporary workspace with immediate deferred cleanup, including
  expected mutation failure. No prototype/clock mutation escapes the child.
  Parent forwards only the needed safe environment; no provider key or network.
  Parent subprocess timeout is a hang guard, not a semantic speed assertion.
- D6 Author and primary run child baseline/mutation plus the full deadline file
  on exact Node22.16/24.15; baseline/full-suite actual exit 0, intentional mutant
  exit 2 with verified assertion. Run required generic/core/validation gates;
  inspect current CI configuration. Two independent nonauthors review one fixed
  candidate. Latest-head CI must pass before ready delivery; no merge authority.

## Ownership and limits

Primary owns diagnosis acceptance and direct validation. GPT-6.1 Sol/high worker
implements this bounded three-file packet. Separate nonauthor Standards/Spec
reviewers inspect it. File inventories are independently cross-checked twice.
This strengthens regression testing, not semantic accuracy or product speed.
Original CI failure remains recorded; no paid evaluation is rerun or rescored.

## Author implementation and verification

Actual GPT-6.1 Sol/high implemented only the D2/D4 parent case and its new
isolated clock child. The eighteen other deadline tests are unchanged. One
actual core retains its 1000 ms aggregate budget: the first extraction advances
the imported monotonic clock from 0 to 1001 inside its model callback, leaves
the adapter promise unresolved, and loses to the unchanged native timer. Its
private aborted-signal provenance, zero writes and ignored late result are
checked before a second capture runs on the same core at fixed time 1001.
The successful second capture checks a fresh un-aborted signal, exactly one
classification, the exact persisted message receipt and an applied initial
classification journal through SQL and the actual inspection API.

The child-only `reuse-first-deadline` mutation changes exactly one deadline
factory module/target and caches its first returned deadline. The parent
requires exit 2 specifically at
`INDEPENDENCE_ASSERTION_FAILED:second-independence:fresh same-core capture must succeed`,
with preceding timeout/late-result checks passed and no second model dispatch
or writes. It rejects setup, earlier assertion, subprocess and cleanup failures
as substitutes for that counterfactual. Owned workspace cleanup and clock/hook
restoration run on both paths; parent forwards only validated standard temp
directories and disables the Node compile cache. Its 30-second subprocess
timeout is a hang guard, not a deadline or healthy-capture speed verdict.

Author commands used exact Node 22.16.0 and 24.15.0. On each runtime:

- `node tools/testing/run.mjs --script core/testing/capture-independence-clock-child.mjs`
  actually exited 0.
- The same command with `reuse-first-deadline` actually exited 2, with the
  required second-independence tag, `firstChecksPassed: true` and successful
  owned cleanup.
- `node tools/testing/run.mjs --test-concurrency=1 --test-reporter=tap core/test/capture-invocation-deadline.test.mjs`
  actually exited 0: 19/19 passed, zero failures, cancellations or skips.
- `node --check core/testing/capture-independence-clock-child.mjs` actually
  exited 0. `git diff --check` also actually exited 0.

The first author baseline attempts actually exited 2 on both runtimes after
successful second admission/classification because the fixture incorrectly
expected receipt `event_id` to equal capture event `later`. Actual source
receipts bind message ID `message-later`; only that fixture expectation was
corrected. Cleanup succeeded on those failed attempts. This is an author
assertion error, not a runtime regression, CI diagnosis or discarded failure.

Code freeze SHA256 values:

- `core/test/capture-invocation-deadline.test.mjs`:
  `e81a0e3f570c2f2ac8a21bf97b454cfba201b06c57d50f6f38047abcc0b7f66d`.
- `core/testing/capture-independence-clock-child.mjs`:
  `da484803025e50ec75fae990b8fa82ac689be9ba812f94cf6dfc33dbc46ae53a`.

Author full-core runs on both runtimes are in progress with serial file
concurrency and the owned canonical runner, in a keyless environment containing
only exact Node PATH, standard TMPDIR and disabled compile cache. Primary
baseline/mutation/full-file/generic/JSON/maintainer verification, fixed-candidate
independent reviews and latest-head CI remain pending. No runtime, default,
provider, ledger, old result or other fixture is changed; no commit or push is
made by this worker.

## Final author and primary offline verification

The original author full-core runs have now completed without restart or source
edits. Exact Node 22.16.0 and 24.15.0 each invoked the owned canonical runner
with `--test-concurrency=1 --test-reporter=tap` and all 89 sorted
`core/test/*.test.mjs` paths: 1213/1213 passed, zero failures, cancellations,
skips or todos. Each child and its wrapper actually exited 0, with null signal
and no launch error. Session 14290 completed as chunk `6aefa2` on Node 22;
session 6139 completed as chunk `cc80fb` on Node 24. These are the original
author executions, not the separate staging-branch core results.

Observed wrapper summaries are retained at
`/tmp/cairn-n41-author-core-evidence.a3bzIoVU/node-22-summary.json` and
`/tmp/cairn-n41-author-core-evidence.a3bzIoVU/node-24-summary.json`.
The wrapper emitted complete argv and totals but did not persist successful raw
TAP stdout; these files explicitly preserve summaries, not raw logs or a new
execution. The earlier pending paragraph records the historical source-freeze
state and is not rewritten.

Primary independently completed its twelve frozen-file gates, retained in
`/tmp/cairn-deadline-fixture-gates.p7gkBhFr/results.json`. On each exact runtime,
baseline child actually exited 0, intentional mutation actually exited 2 with
the required second-independence tag, full deadline file actually exited 0
(19/19), generic suite actually exited 0 (581/581), JSON validation actually
exited 0 and maintainer validation actually exited 0. The primary wrapper
actually exited 0, all expected-exit checks passed and all three pre/post hashes
were identical. No mutation failure is represented as an ordinary zero-exit
success.

Author `demo:store` and `demo:capture` equivalents (`node examples/local-store.mjs`
and `node examples/capture.mjs`) each actually exited 0 on both exact runtimes
in newly owned parent `/tmp/cairn-n41-author-demos.z5OoAym1`. Their four synthetic
SQLite artifacts are intentionally retained under `cairn-store-demo-pZULRV`,
`cairn-store-demo-79xtFW`, `cairn-capture-demo-uJKYy3` and
`cairn-capture-demo-Lo1YYo`. Independent recursive filesystem and `find` routes
matched exactly four database files. Formal demo retention is distinct from
the deadline children's asserted owned-fixture cleanup; no historical files
were removed.

Only this final plan section is appended after gate closure. Both code hashes
remain the frozen values above. Fixed-candidate independent reviews and
latest-head CI remain primary-owned pending gates; this evidence does not claim
semantic improvement, product timing, paid authorization, a commit or a push.
