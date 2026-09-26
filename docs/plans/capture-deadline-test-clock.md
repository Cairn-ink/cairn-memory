# Cumulative capture deadline test scheduling isolation

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
