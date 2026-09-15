# Installed qualification fixture compatibility

Base: `b9775b8268a7b1a72b4c8b0a4bce3ed8a95501f4`.

## Acceptance

1. Reproduce the CI installed-rationale RP2/RP3 failures after the named-slot
   qualification change, using synthetic HTTP and fresh installed artifacts.
2. Fix only the demonstrated incompatible fixture boundary; preserve runtime,
   public core arrays, assertions, failure retention, budgets and no-retry behavior.
3. Run all four installed rationale tests on Node22.16 and24, including malformed
   output and transport halt. Run both ordinary offline evidence suites and the
   generic, JSON and strict-plugin gates. Document the opt-in installed gate in
   CONTRIBUTING so skipped ordinary tests cannot be mistaken for this evidence.
4. Independently review the final candidate on Standards and Spec axes, then
   deliver a separate corrective PR. Explicitly require every CI state SUCCESS
   before merging; successful JSON retrieval is not a successful check suite.

PR102 was merged despite a failing CI check because the operator treated a
successful `gh pr checks --json` command as a successful suite and GitHub allowed
the merge. Preserve this record; no release or deployment occurred. Do not change
the source worktree or operator of the already-running frozen live experiment.
