# Cumulative benchmark budget: US$200 to US$300

Status: prospective contract; no operational transition or provider call.
Fixed base: `8607e0ff8fcf2681bf2661f23348956e2a6f5195` (PR #304).
Worktree/branch: `benchmark-budget-300` / `feat/benchmark-budget-300`.

The owner authorized a cumulative US$300 provider-evaluation ceiling on
2026-09-30. Continue the original ledger and all unknown reservations; this
is not a fresh US$300 allowance. Prior consumed evaluations remain closed.
The primary owns the actual ledger transition and any fresh paid manifest
after offline acceptance and independent review. No release or deployment.

## Acceptance contract

- B301: Add a separately versioned `benchmark-budget-v3` authorization for
  exactly US$200 to US$300 on an existing embedding-enabled ledger. Its parent
  must be a valid immutable `benchmark-request-cap-v2` authorization, with the
  entire older 50/100/200 lineage verified. Never broaden old authorizers or
  load a fabricated, edited, or missing parent. APIs are
  `authorizeChainedBenchmarkBudgetV3` and `loadChainedBenchmarkBudgetV3`.
  Authorizer inputs mirror request-cap-v2 with an explicit `newLimitMicroUsd`
  and `expectedOldHistorySha256`; target money is exactly 300,000,000 and a
  finite request cap must strictly increase. Loader has the existing strict
  ledger/policy/parent authorization ID/authorization ID/stages shape.
- B302: The ledger owns an existing-only, transactional cap update with exact
  settled checkpoint and authentic embedding snapshot. Keep run ID, directory,
  schema, all attempts/order/costs/reservations/counters and old bindings intact.
  Use a narrow `transitionEmbeddingExperimentBudgetCaps` plus
  `projectEmbeddingBudgetCapsPrefix` if required. Both helpers accept exact
  old/new configurations and checkpoint; snapshot projection requires the
  ledger-issued brand, not a JSON clone. Preserve old helpers' behavior.
- B303: Bind old and new prefix hashes including both money and request caps.
  Create/fsync a private immutable authorization before cap commit; exact replay
  and interrupted-commit recovery are idempotent. Tampered history, prefix,
  parent, wrong cap/run/path/policy/stages, pending rows, unsafe links/modes,
  missing database and conflicting records fail closed without repairing data.
  Callback/locking/close failures must retain the original fixed error contract.
- B304: Permit fresh mixed Cairn/Mem0 capabilities at 300,000,000 only with
  this verified v3 lineage and authentic current snapshot. Existing 200M
  behavior remains. Old parent records, old configuration handles and old
  consumed/unused mixed capabilities cannot regain dispatch after transition.
  No changes to models/prices/wire routes/timeouts/retries/roster/scorers.
- B305: Synthetic temporary-ledger tests cover nonzero settled unknown costs,
  complete row and old-file preservation, later valid suffix, forged snapshots,
  exact recovery, all named refusals, crash/fault/concurrent-writer behavior,
  stale handles and both denied old and valid fresh mixed guards. Use owned
  test workspaces and verify success/failure cleanup. No key, actual ledger,
  corpus, historical provider output or paid call in worker/reviewer tests.
- B306: On Node 22.16.0 and 24.15.0 run focused v3 tests, complete budget and
  request-guard suites, live-offline suite, LongMemEval, generic tests, budget/
  guard demos, JSON validation and pinned local Claude plugin checks. Follow
  CONTRIBUTING for any additional touched scope. Primary personally inspects
  and reruns critical persistence/lineage and integration tests. Two independent
  Standards/Spec reviewers inspect the same fixed-base committed candidate;
  latest-head CI and mergeability precede ready delivery. No typecheck script
  exists in this JavaScript repository. Unrun checks are not passes.

## Ownership and scope

One GPT-6.1 Sol/high implementation worker owns the two budget modules, focused
v3 tests and package test registration, plus this plan and technical budget
documentation/limitations. Do not modify core, adapters, packaging, CI, existing
paid results, frozen fixtures, other worktrees or operational directories.
Avoid incidental refactoring. Flag a necessary contract change to the primary
before changing implementation scope. The primary owns planning, integration,
direct acceptance, scoped commits/PR and the actual cap transition.

Worker model/effort, candidate hashes, verification, corrections, review and
operational status will be recorded here after they occur.

## Implementation design acceptance

Primary accepted on 2026-09-30: the exact 200M→300M prefix projector returns
both cap-bound hashes and a ledger-branded `oldPrefixSnapshot` containing only
the frozen v3 checkpoint prefix under its old 200M configuration. Verify the
current authentic snapshot separately, then use this historical snapshot to
verify the complete immutable v2 lineage. It cannot relabel a later suffix.
The v3 lineage detachment uses the existing v2 64MiB/3M-node envelope, unchanged.
Worker: GPT-6.1 Sol/high; no operational access or provider calls.
Primary additionally accepted private originating-directory metadata on issued
snapshots, enforced only by the new v3 projector. Its public shape and old v2
behavior remain unchanged. Inspection, bound issuance, transitions and old
checkpoint projection propagate origin. A copied same-run/same-history ledger
in another directory cannot witness the original directory's v3 lineage.

## Worker verification record

Initial focused Node22 run: `node tools/testing/run.mjs
evaluation/experiment-budget/test/budget-v3.test.mjs` completed 7/8 passing,
duration 7904.021367ms. The stale mixed guard correctly throws
`configuration_mismatch` before invoking the scope callback; the new test had
incorrectly expected a returned failed scope. Corrected its assertion to
expect the existing fixed rejection. No implementation change for that failure.

The expanded focused Node22 run completed 12/15 passing, duration
10736.394233ms. The three new filesystem-fault assertions incorrectly expected
`unsafe_policy_binding` for injected raw write/fsync exceptions. The inherited
authorization/transaction mapping correctly emits `ledger_failed` for these
raw exceptions; corrected the tests to require that fixed code. Malformed
persisted-binding rereads continue to require `unsafe_policy_binding`. No
implementation changes were needed for these assertion corrections.

The first batched Node22/24 runs had already loaded the pre-correction focused
tests; both focused and complete-budget runs therefore retained those three
failures. The complete-budget runs also exposed one real integration regression:
the new anonymous transaction callback duplicated a source string that the
existing migration fault child requires to be unique. Named the new callback
`transitionBudgetCaps`, matching the earlier request-cap helper's named-callback
pattern and preserving the frozen old test seam. Both budget runs will rerun.

Initial batched failing command elapsed times (Node22/24 respectively):
`npm run test:benchmark-budget-v3` 14549/14096ms, 12/15 passing;
`npm run test:experiment-budget` 15752/15292ms, 76/80 passing. These ran before
the expectation/seam corrections. The corrected 17-case focused suite plus
18-case old embedding migration suite passed 35/35 on Node22 in
18419.101875ms. Subsequent origin-metadata and cumulative-ceiling additions
increase the focused suite to 19 cases; the final gates below use that candidate.

Final source hashes (pre-commit base remains `8607e0ff8fcf2681bf2661f23348956e2a6f5195`):

- `evaluation/experiment-budget/index.mjs`:
  `932e6a64b5ca09ad5469fa85e27e9befb3111e8737b563bf623e053b4c4fa220`
- `evaluation/experiment-budget/request-guard.mjs`:
  `a076c0506c21b967326eb23b85a0636349404b9131a4b03ea6c229777d45708f`
- `evaluation/experiment-budget/test/budget-v3.test.mjs`:
  `d59e0bd0f54a43bf94057c977bf9bc14897dbfa645a24cd50edd623bc6556300`
- `package.json`:
  `1795fd2f5423df33948bad5f078fc17760800ef4dab6c55ef54a866dd2847fab`

All test gates use the owned test runner with pinned runtime PATH,
`NODE_DISABLE_COMPILE_CACHE=1`, and a child environment containing PATH and
Node flags only. Elapsed milliseconds are observed command wall times, not
provider, cost or token telemetry.

| Command | Node22.16.0 | Node24.15.0 |
| --- | --- | --- |
| `npm run test:benchmark-budget-v3` | 19/19 pass; 18332ms | 19/19 pass; 18038ms |
| `npm run test:experiment-budget` | 84/84 pass; 18142ms | 84/84 pass; 17933ms |
| `npm run test:experiment-request-guard` | 292/292 pass; 31557ms | 292/292 pass; 31321ms |
| `npm run test:live-evidence-offline` | 340 pass, 30 existing opt-in skips; 135160ms | 340 pass, 30 existing opt-in skips; 135372ms |
| `npm run test:longmemeval` | 207/207 pass; 10937ms | 207/207 pass; 10898ms |
| `npm test` | 131/131 pass; 4411ms | 131/131 pass; 4407ms |
| `npm run test:workspace-lifecycle` | 25/25 pass; 19323ms | 25/25 pass; 19748ms |
| `npm run demo:experiment-budget` | pass; 226ms | pass; 229ms |
| `npm run demo:experiment-request-guard` | pass; 600ms | pass; 581ms |
| `npm run validate` | pass; 97ms | pass; 103ms |
| `node <pinned-local-cli> plugin validate .` | pass; 701ms | pass; 699ms |
| `node <pinned-local-cli> plugin validate ./plugins/cairn-memory --strict` | pass; 710ms | pass; 713ms |

The pinned local CLI is the read-only
`/home/chichieh/Github/cairn-memory-worktrees/installed-classification-followup/tools/plugin-validation/node_modules/@anthropic-ai/claude-code/cli-wrapper.cjs`,
version 2.1.260. Its lock matches this worktree's lock exactly (SHA256
`4f8437487e60c8c3f297ee4baae6f3a1ba950d68fa8dea800b7a72f10eaf7ec1`).
Both validation commands target this worktree. Locked
`npm ci --prefix adapters/openai` passed (1 package; zero audit findings), with
no manifest/lock change. `git diff --check` passed. Final gates above all exit0;
the live-offline opt-in skips are explicitly not verified installed/native gates.

All worker-required offline gates are complete. Primary-only gates remain
unrun by worker: committed
candidate direct acceptance, independent Standards/Spec reviews, latest-head
CI/mergeability and actual original-ledger transition. No TypeScript/typecheck
script exists. No old paid case was reopened or new provider call made.

Primary inspected the final index/guard diff and accepted the private origin
metadata. Primary personally reran the final Node24 focused v3 suite: 19/19
passing, duration 24740.426335ms (reported by primary).

The scoped candidate consists of the two budget modules, one focused v3 test,
the narrow package registration, the two technical budget documents and this
plan. These seven files are frozen for primary delivery/review. Worker made no
commit, push, PR, merge or operational transition. No token/cost telemetry or
whole-task elapsed measurement was exposed; those values remain unknown.
