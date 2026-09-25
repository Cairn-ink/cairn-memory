# Chained benchmark budget extension

Status: contract frozen; offline implementation locally committed for primary
acceptance and independent review. Scorer PR #225 at `397d22e` passed all 17
exact-head CI jobs (run `36097661692`). No B exact-head CI or operational use.
Fixed review base: `397d22e688cce40e5aca775a5758d420f5da2575`
(`test/qualified-source-scoring`, reviewed test-suite ownership correction).
Branch/worktree: `feat/chained-benchmark-budget` / `chained-benchmark-budget`.
Only unpublished planning commits were rebased onto that scorer candidate;
the primary worktree, existing grants and operational ledger are untouched.

This is an offline prerequisite to a possible later experiment, not a paid-run
grant. No operator ledger, corpus, credential, provider call, actual ceiling
change, migration, merge, release or deployment belongs here. User authority
remains US$200 cumulative; unknown reservations are never refunded. Previous
terminal experiments remain closed. Do not reset their ledger or reuse grants.

## Why this packet exists

The existing monetary-extension API records one immutable transition tied to
the original request allowance. Its validator verifies that allowance against
the prior configuration, and its filename is keyed by the allowance ID. Calling
it again is not a safe way to chain US$50→100→200. Existing synthetic tests
explicitly reject a second changed transition. Preserve that behavior.

The new path handles exactly one v1 monetary extension as parent. It is not a
recursive chain, a generic policy upgrade, an embedding-ledger migration or a
way for older request guards to resume. A later separately reviewed pair guard
must bind any actual fresh roster, models, request schedule and resource caps.

## B1 — Closed API and immutable binding

New request-guard exports:

- `authorizeChainedBenchmarkBudgetExtension({oldLedger, policy,
  parentBudgetExtension, authorizationId, newLimitMicroUsd, newRequestCap,
  expectedCheckpoint})`.
- `loadChainedBenchmarkBudgetExtension({ledger, policy,
  parentBudgetAuthorizationId, authorizationId, stages})`.

Exact closed options, detached input, each caller property captured once.
Parent must be the complete valid `benchmark-budget-extension-v1` record and
match its immutable file and all older bindings. Validate it against its own
historical configuration, never relabel it as the target configuration.
This campaign-specific version accepts prior limit 100,000,000 and target
200,000,000 microUSD only. `newRequestCap` is an explicit positive safe integer
strictly above the old cap; no counter reset or implicit unlimited requests.
The later operational finite request cap is not selected by this plan.

New record has exactly version (`benchmark-budget-chain-v1`), authorizationId,
priorLedger, ledger, policy, method (`benchmark`), stages,
parentBudgetExtension, checkpoint and historicalDigest. Checkpoint has exactly
requestCount and reservedMicroUsd. Digest uses the existing canonical ordered
attempt-row representation, including unknown outcomes and actual-cost nulls.
Same directory, run ID, stages and policy; only two caps may change.
New filename: `experiment-benchmark-budget-chain-PARENT_ID.json`, using the
validated parent authorization ID. Never overwrite any prior binding or claim.

## B2 — Ledger-owned existing-only transaction

Add exactly two narrow maintainer APIs in `index.mjs`:

`transitionExperimentBudgetCaps({oldConfiguration, newConfiguration,
expectedCheckpoint, authorize})` and
`inspectExperimentBudgetSnapshot(configuration)`.

Configurations have the current exact four configuration fields. Both money
and request caps strictly increase, with identical normalized directory/run ID;
the helper is cap mechanics, while B1 enforces the campaign's exact money
amounts and binding. Snapshot returns the existing immutable publicState shape
after a genuinely read-only validation, not a reserving/reopening handle.
Transition returns that same shape for the verified post-state after successful
commit/replay. It never returns a raw database, transaction or writable handle.

`authorize` is synchronous and receives exactly `{mode, state,
checkpointAttempts}`: mode is `transition` at the prior config or `replay` at
the exact new config; state is the frozen detached publicState; checkpointAttempts
is the immutable ordered prefix of length expectedCheckpoint.requestCount.
Checkpoint is exactly requestCount/reservedMicroUsd, both safe nonnegative
integers within prior caps. Verify its prefix reservation sum and terminal
outcomes; in transition mode the whole state must equal the checkpoint.
Only undefined callback return is accepted; reject thenables and other return
values before a cap update. The guard owns the candidate record outside the
callback, and only returns it after successful helper completion. Guard-specific
callback failures must remain their fixed guard errors, not disappear into a
generic ledger error. Unknown callback errors get the ledger's fixed failure.
The guard can capture a known guard error in its callback closure and rethrow
it after the helper has rolled back/closed. Do not introduce a ledger-to-guard
import cycle just to recognize that error class.

The required behavior:

- Reuse the ledger's current schema, state and privacy validators rather than
  copy them into the guard. Do not import the unrelated embedding migration.
- Open the existing database with an encoded file URL and `mode=rw`, including
  spaces and `#`; do not invoke the ordinary writable reopen path first.
  Missing-file races must never create a replacement database.
- Own `BEGIN IMMEDIATE`, rollback, close and fixed error mapping inside the
  ledger helper. Recheck path, file identity, private modes, configuration and
  complete settled state under lock and before commit. Reject unsafe links,
  pending requests, overrun, wrong run and unexpected configuration.
- At the prior configuration, require exact expected counts and reservation
  totals. At the exact target configuration, permit only exact replay against
  the existing authorization and a verified unchanged historical prefix;
  later valid settled rows are retained, not rewritten.
- Verify/create the create-only 0600 authorization and fsync file plus directory
  before conditional cap-only update. Verify post-state before commit. Preserve
  all attempt values/order, usage, reservations, counters and original files.
- A durable complete matching record may recover a rolled-back transition;
  a partial, conflicting, unreadable or unsafe record fails closed. Never
  delete, replace, repair or silently regenerate it.
- A synchronous trusted binding callback may receive frozen detached state,
  not a raw database. A callback is not a sandbox or new user authorization.
  Reject async completion before any cap update. Verify state and identity
  after callback; preserve authoritative failure and release the lock.

The inspection API uses a read-only SQLite connection and read transaction;
it does not call ordinary writable reopen or the cap-transition helper. It
checks current exact configuration, complete schema/rows and path identity
before returning. It does not itself require settled state; the B3 chain loader
does. Share narrow private location/identity primitives between these new APIs
only unless a separately justified old-callsite change is required. New physical
database-file checks must reject multiple hard links (`nlink !== 1`), not just
symbolic links. Directory link counts have normal directory semantics; do not
incorrectly require a directory's link count to equal one.
These named identity/race tests are not an isolation guarantee against a
privileged same-user adversary swapping paths repeatedly; Node's SQLite API
does not expose a raw opened file descriptor for independent inode inspection.
Keep that limitation explicit. Inject synthetic crash/fault tests in child
processes or temporary test modules, not new production runtime fault hooks.

Existing create/reopen behavior and old guard dispatch must not widen. Any
necessary shared-code refactor is explicit in the frozen helper contract and
review, not hidden in a broad cleanup.

## B3 — Strict loading; no transport authority

Loader verifies exact record, immutable full parent chain, expected stages,
current target config and unchanged bound prefix, with no mutation. No missing
parent fallback or weaker acceptance for old files. Ordinary later settled rows
are allowed; deleted/edited prefix rows or rolled-back totals are not.
Prior-configuration handles and prior benchmark/scoped capabilities must not
resume after the cap change, and old benchmark factories must reject the new
chain record. The generic baseline factory has no benchmark-capability input:
an operator explicitly supplying the new valid configuration may still create
its unchanged baseline guard. That is not reuse of an old benchmark grant and
must not permit indexed extraction or candidate qualification. Test this
positive legacy behavior as well as those denials. No provider route, source
policy, retry policy, deadline, model or price change in B.

## B4 — Observable synthetic acceptance

Actual temporary ledgers must establish:

1. Existing 50→100 followed by new 100→200 preserves every row and original
   file, including nonzero unknown reservations, costs, counters and order.
2. Exact replay is idempotent; checkpoint/cap/policy/stage/parent/identity
   mismatch, pending/overrun and historical tampering are refused.
3. Competing writers cannot both authorize different transitions; old consumed
   and unused benchmark/scoped capabilities cannot regain transport access
   under 200. Prior-configuration live handles are fenced. A generic baseline
   guard explicitly constructed with the target configuration retains only
   its existing routes, not the new pair routes or a benchmark grant.
4. Failures at partial file write, file fsync, directory fsync, update and commit
   retain the proper ledger/record state. Include child-process termination
   before/after commit, exact recovery and conflicting-record refusal.
5. Original database removal between precheck and opening never leaves a new
   file. Privacy/link/identity changes under the lock are rejected. Exercise
   encoded special-character paths and verify no wrong-path artifact appears.
6. Loader is read-only and exact, source inputs cannot drift via getters or
   callback mutation, and no model/HTTP/key/operator data is touched.

## B5 — Verification and handoff

One GPT-6 Sol/high author after primary freezes the helper. Allowed future
scope: narrow ledger helper, new request-guard chain functions, focused tests,
existing budget/guard test-script registration if needed, technical docs,
CHANGELOG, limitations and this plan. No old transport widening or v2 migration.

Both Node 22.16 and 24.15: focused chain tests, complete experiment-budget,
request-guard and live-offline suites, generic tests, budget/guard demos, JSON
and pinned local Claude 2.1.260 strict validation. Primary inspects actual diff,
independently reruns critical persistence/crash paths and required suites.
Independent nonauthor Standards and Spec review the same original base/final
SHA; correction repeats both axes. Exact-head all CI and mergeability precede
ready status. No merge, release, deployment or actual cap transition.

## Historical release checkpoint (before implementation)

At release, there was no B runtime evidence, candidate review or live
authorization. Primary selected the narrow ledger-owned helper after
independently reading existing state/path/transaction code and two read-only
Sol/high seam proposals. The scorer's exact-head CI was accepted. The next
step then was one bounded Sol/high implementation followed by primary actual
verification, two independent full-base reviews and exact-head CI. No actual
cap change followed from that release. The later offline checkpoint below is
the current implementation status.

## Offline implementation checkpoint (not operational acceptance)

The new ledger APIs own an existing-only `mode=rw` SQLite writer transaction
and a separate read-only snapshot; the new guard functions bind one valid v1
monetary parent to a create-only chain record. Existing create/reopen and old
guard dispatch paths are unchanged. The dependency-free budget suite retains
pure helper tests; the actual adapter/guard chain regressions are registered
in the existing installed request-guard suite, not in the isolated budget or
LongMemEval job. No CI workflow, lockfile or dependency changed.

Author synthetic tests on both Node 22.16.0 and 24.15.0 pass focused 40/40,
complete budget 18/18, request guard 192/192, live-offline 351 total (321
passed, 30 opt-in skips), generic 112/112, budget and guard demos, JSON and
verified locally pinned Claude Code 2.1.260 strict plugin validation. An
isolated no-adapter tracked snapshot passes budget 18/18 and LongMemEval
123/123 on both runtimes; the chain test stays in the already-installed guard
suite. The synthetic tests include
50→100→200 history with nonzero unknown reservations and null actual cost,
later settled replay, full parent/prefix refusal, consumed and unused old
capability denials, explicit-target generic baseline route denial for indexed
and candidate wire requests with zero forwarding, child SIGKILL before/after
COMMIT, partial file and fsync failures, URI missing-file race, hard-link/mode/
identity changes under lock, and two competing child writers. These checks do
not authenticate injected callbacks, prove power-loss durability, establish
model quality or permit the actual operator ledger transition. Primary
acceptance, independent review and exact-head CI remain required.

The primary independently reran the same committed runtime/test/package bytes
on both Node 22.16.0 and 24.15.0: budget 18/18, guard 192/192, live-offline
351 total (321 passed, 30 opt-in skips), LongMemEval 123/123, generic 112/112,
the budget and guard demos, all three LongMemEval demos, JSON validation and
locally pinned Claude Code 2.1.260 strict validation passed. This verifies the
offline candidate's checks; it is not an independent Standards/Spec review,
exact-head B CI or authorization to touch the operational ledger.

## Contract clarification discovered during synthetic implementation

The original B3 sentence said all old factories reject the new configuration.
The author flagged a conflict with the requirement to leave old dispatch
unchanged. A primary synthetic probe confirmed the generic baseline factory
can be constructed with an explicit valid target configuration; this API never
accepted a benchmark capability. Existing monetary-extension tests fence old
benchmark/scoped grants and old configuration handles, not every invocation of
the baseline constructor. The primary therefore clarified B3/B4 above before
acceptance, rather than adding an unrequested global transport policy, a magic
200 ceiling or a second activation file. This is a documented correction to
the plan, not a runtime fix or a claim that the original broad condition passed.
No operational permission or paid route is expanded by this clarification.
