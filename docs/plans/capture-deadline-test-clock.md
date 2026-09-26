# Cumulative capture deadline test scheduling isolation

## PR 245 placement boundary amendment (frozen before implementation)

CI run 36272536418, Node 24.21.0 job 108489088380 failed the existing
`D3 placement expiry rolls back filing and applied journal while retaining
admission`: target SQL count was zero rather than one. Core had 727 passes
and this one failure; Node 22 was cancelled, not a pass. Candidate
582fd12529f4f13c3aeef236c5ddd1c00b6caba3 contains no core runtime changes
relative to mixed-runner base 30bd041d231d12441cc1568dd17814a812136ada.

Primary reproduced the same assertion on Node 24.15 with an actual-core
synthetic probe: a 650 ms pre-classification pause exhausts the 600 ms fixture
deadline before target SQL; no pause reaches the SQL and rolls back. Both
retain one receipt, zero MOCs and a failed classification journal. This
supports a scheduling-sensitive test, not a demonstrated rollback defect;
it does not identify the exact scheduling delay in the remote CI run.

- C10 Preserve the placement proof: classification is called, the applied-journal
  SQL executes exactly once inside the real transaction, then the shared
  capture deadline expires before commit. Classification returns model_timeout;
  filing and applied journal roll back while admission survives (one memory,
  one receipt, zero MOCs, unfiled memory, failed classification journal).
- C11 Use an isolated test child with a controlled monotonic clock installed
  before importing the real core. Advance beyond the configured deadline only
  after the target SQL executes. A large fixture-only deadline may protect
  real model timers from incidental scheduling; no production changes or
  shared parent clock patching. Keep other real-time cases unchanged.
- C12 A counterfactual import-hook mutation removing only the transaction's
  post-work deadline check must fail the durable rollback assertions. Assert
  exactly one matched mutation. No production source files are rewritten.
- C13 Allowlist: this plan, core/test/capture-invocation-deadline.test.mjs,
  and one narrowly named placement-clock child under core/testing/. No corpus,
  live key, operational ledger, paid request or production access.
- C14 Run focused real and mutant cases, complete deadline file, full core,
  demo:store, demo:capture, npm test and validate on Node 22.16 and 24.15.
  Primary reruns key paths; both independent axes review the entire original
  mixed base to final candidate. Update draft PR 245 only after those gates;
  monitor all latest-head CI. Retain the original red; never certify a rerun
  alone. No semantic-score improvement is claimed from this test correction.

Implementation owner: GPT-6 Sol/high (resume_p6); primary owns acceptance.
Earlier C6-C9 evidence below remains historical, not new-head certification.

### PR 245 placement correction evidence

The unchanged focused wall-clock test passed locally on Node 24.15 but failed
in CI on Node 24.21. A private actual-core diagnostic reproduced its exact
`0 !== 1` SQL-reach assertion with a 550–650 ms pre-classification pause;
without that pause or with 450 ms, the SQL was reached and rollback held.
The controlled pre-import monotonic-clock probe separated these paths:
pre-phase 0/450/550 ms reached placement SQL and rolled back after the
post-SQL clock advance; 650 ms expired before SQL. All cases retained one
receipt and zero durable MOCs. This identifies a scheduling-sensitive
fixture, not the exact remote scheduler event. The two private diagnostic
artifacts have SHA-256 `78f6736fecdc434776ed2e755a019f3bb4464630b16f545df3dd467eb505e49a`
and `179fddc0cd8afe2262cfd037faa82d71eac12d461eff9d5f31bb884146859774`.

The corrected parent test invokes a private isolated child with the real
core imported after its controlled monotonic clock. It uses a fixture-only
120,000 ms budget and advances 120,001 ms only after the real applied-journal
SQL `run` executes. Before the advance, the same transaction sees a MOC and
an applied journal; after it, the result is `model_timeout`, with one memory,
one receipt, zero MOCs, unfiled memory and failed journal. A synchronous
import-hook counterfactual removes exactly the one transaction post-work
deadline check; it reaches the same SQL and fails the durable rollback
assertion with a filed memory, MOC and applied journal. No production source,
default deadline or other real-time test was changed.

On Node 22.16.0 and 24.15.0, the direct child passed and counterfactual
failed as intended; focused parent, complete deadline file (19/19), full
`test:core` (728/728), `demo:store`, `demo:capture`, `npm test` and
`npm run validate` all passed serially. Raw logs are retained in a private
verification archive. These are local synthetic results, not a claim that
the old CI failure was reproduced on Node 24.21 or that latest-head CI has
passed. No provider, corpus, credential or operational ledger was used.

Additional CI delivery failure in PR #218, separate from the request-guard
Promise ownership failure. Original review base remains
`45eca22639836e8035c3ccbbe6403a9f5c076b1d`. This contract is frozen before
implementation and extends the narrow test-only correction scope.

## Observed failure

CI run `36079420235`, attempt 1, Node 24 job `107897798354` failed
`D2/D3 cumulative extraction plus v1/v2 qualification exhausts one budget
before admission` at `core/test/capture-invocation-deadline.test.mjs:389`.
For v2 it observed only `extract`, not the required `extract, qualify` sequence.
The test deliberately waits 600 ms in each stage against one 1,000 ms budget.
The original file is unchanged from the reviewed runtime. Primary ran the
focused test once on Node 24.15; it passed in about 2.08 seconds, which does
not explain or resolve the recorded failure.

Feedback command: `node --test --test-name-pattern='D2/D3 cumulative extraction
plus' core/test/capture-invocation-deadline.test.mjs`. Keep the original red CI
record. Reproduce a minimized same-call-site scheduling failure before fixing;
state ranked falsifiable hypotheses before changing one variable at a time.

## Acceptance frozen before implementation

- C6 Preserve the cumulative deadline proof for both source-bound-v1 and v2:
  extraction completes within the shared budget, qualification starts with
  less remaining budget, cumulative elapsed time expires before admission,
  and memories, receipts and initial-classification rows remain zero. A
  reset-per-stage mutant must fail this assertion. Merely accepting an earlier
  extraction timeout no longer proves this contract and is not a repair.
- C7 Remove the test's dependence on CI scheduling speed without changing
  production clocks, timeout defaults, core constructor/public options or
  cancellation behavior. A test-only isolated child importing the real core
  after a controlled monotonic-clock setup is allowed if necessary; do not
  patch the shared parent process clock or bypass real capture/deadline logic.
  Account for the deadline's import-time clock binding. Retain separate
  real-time timer/cancellation tests unchanged. No provider, corpus, key,
  operational ledger or production data access.
- C8 Allowed additions to the preceding C4 allowlist: this plan,
  `core/test/capture-invocation-deadline.test.mjs`, and one narrowly named
  test-only child helper under `core/testing/` if justified. Do not export the
  helper through the public API or include any runtime changes. Worker records
  the exact selected seam, diagnostic artifact hash and red/green commands.
- C9 Run the focused regression and complete capture deadline file, then full
  `test:core` and `demo:capture` on Node 22.16 and 24.15. Run the preceding C5
  gates as well. Primary personally reruns the key final paths; both independent
  axes review the whole original-base candidate before updating #218. All
  latest-head CI jobs must succeed; old red evidence is retained, never hidden.

GPT-6 Sol/high implementation remains delegated; primary owns the acceptance
and independent review. This does not reopen, retry or change the completed
six-case paid smoke, its source data, runtime, score or ledger. No merge,
publication or deployment. Broader scope must be reassessed by primary first.

## Evidence

The frozen pre-fix test source at `bd554d91e8c65d5f30f4bd0ba4013e93aab551a6`
has SHA-256 `13f1aae89fec9e91e577fbb6ccd857bb07d6f439daa950f2469251dc0876a9c5`.
The unmodified focused test passed once locally on Node 24.15. A single 500 ms
blocking scheduling pause after v2 extraction's existing 600 ms wait made it
fail twice at the same assertion as CI: actual `['extract']`, expected
`['extract', 'qualify']`. The replayable harness outside the repo is
`/tmp/cairn-capture-clock-ci-repro.mjs`, SHA-256
`c28f5912074914604155ed61ba04bd9d8bfe070ff21f33c2bd2e6cd1872e46d0`;
run it with Node 24.15 to assert this exact pre-fix red. No repo fixture or
production data is read by the diagnostic replay.

Ranked predictions before probes: (1) wall-clock scheduling can consume the
400 ms nominal remainder after extraction; controlled monotonic elapsed should
restore the qualification call, (2) v2 preparation rather than scheduling
could consume the gap, (3) late clock substitution cannot work because
`capture-deadline.mjs` binds `process.hrtime.bigint` at module import, and (4)
v2 qualification routing could be broken independent of elapsed time. A late
substitution probe returned `latePatchAffectsDeadline: false`, confirming the
import-time binding. The isolated child instead sets a virtual monotonic clock
before dynamically importing the real core; both qualification modes reached
their model call with 600 ms elapsed, then advanced to 1,200 ms on a shared
1,000 ms budget and failed before admission. This falsifies a routing failure
under a nonexpired deadline. The separate real-time timer/cancellation cases
remain untouched.

`core/testing/capture-deadline-clock-child.mjs` is the one test-only child
helper. It owns a synthetic temporary SQLite store, runs with an empty
environment, and checks `['extract', 'qualify']`, the qualification signal's
abort, `model_timeout`, and zero memory/receipt/initial-classification rows.
The parent test invokes it for v1 and v2. Its `reset-stage-deadline` mode uses
a synchronous import hook to mutate only the qualification model-call option
to a fresh 1,000 ms deadline, without writing production files; both modes
then fail the qualification-signal assertion on Node 22.16 and 24.15. This is
an actual call-site mutation, not merely a clock rewind. The outer original
deadline still blocks admission in that mutant; the failing signal assertion
proves specifically that the qualification call did not inherit the shared
budget. The focused corrected test passed on both runtimes in about 0.5
seconds. The complete capture-deadline file passed 19/19, full `test:core`
690/690 and `demo:capture` passed on both Node versions. The C5 gates in the
linked guard plan also passed. Candidate commit, primary acceptance,
independent reviews and new exact-head CI remain pending.
