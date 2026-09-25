# Case guard concurrency test isolation

CI follow-up to PR #218 at `d41f2332fa082791b7b46242945254cda77ba989`.
This is a narrow delivery-gate correction, not a Mem0 feature or production
deadline change. The original PR base remains `45eca22639836e8035c3ccbbe6403a9f5c076b1d`.

## Retained symptom and feedback loop

CI run `36079420235`, attempt 1, job `107897798426` (Node 22.16.0) failed
`G1/G4 constructor snapshots getters once and a second in-scope send never
reserves` with `failureType: unhandledRejection`, `case_deadline_exceeded` at
`case-deadline-guard.test.mjs:721`. Node 24's matrix sibling was cancelled.
The guard and test file are byte-identical to the base; no causal attribution
to the Mem0 packet is implied. Primary ran the exact focused test on Node
22.16.0: it passed once, which does not explain or resolve the CI failure.

Feedback command: `node --test --test-name-pattern='G1/G4 constructor snapshots
getters once' evaluation/experiment-budget/test/case-deadline-guard.test.mjs`.
Keep the CI red record; establish a deterministic or high-rate reproducer for
this exact error before choosing a repair. Use synthetic temporary ledgers and
fake HTTP only. No user data, live ledger, keys, provider calls or paid reruns.

## Frozen acceptance before implementation

- C1 Reproduce the named failure or a minimized same-call-site scheduling
  variant, recording exact pre-fix source and command. State predictions before
  probes; a later green rerun alone cannot close the failure.
- C2 Preserve the named test's actual contract: constructor getters read once,
  first in-flight request holds the guard, second request is `guard_busy` before
  transport or reservation, one attempt/one reservation, release completes the
  first request, and the guard remains usable/not halted. Own every started
  promise immediately and settle/clean it up on assertion failure.
- C3 Isolate scheduling from the deliberately tiny timeout fixture used by
  deadline tests. Change only this concurrency test/helper where needed. Keep
  genuine deadline/unknown-accounting tests and all production defaults,
  cancellation, guard, ledger, retry and capability behavior unchanged.
- C4 Allowed files: `evaluation/experiment-budget/test/case-deadline-guard.test.mjs`,
  this plan and a concise pointer in `docs/plans/mem0-engine-preflight.md`.
  A temporary diagnostic harness may be kept outside the repo with a source
  digest. No runtime/CI workflow change. Broader evidence requires re-scoping
  with primary before edits, not silent widening.
- C5 Verify pre-fix red and post-fix green at the same meaningful seam; run the
  focused case file and full request-guard suite on Node 22.16 and 24.15 plus
  Mem0's no-key preflight and generic/JSON/plugin gates. Primary reruns key paths;
  both independent axes review the combined original-base diff, then update
  #218 and require all new exact-head CI checks. Do not blind-retry CI or mark
  the PR ready while any failure remains unexplained.

Implementation owner remains GPT-6 Sol/high; reviewers remain independent of
that worker. This correction does not modify the parallel frozen paid smoke
runtime, its results, roster or ledger. No merge, release or deployment.

## Evidence

Pending minimized reproduction and diagnosis. No repair or passing CI claimed.
