# Exact orphan reservation settlement

Status: implementation contract, 2026-10-01. Base:
`7467aebcb32563c9aab4356a8c3e04c0ebb1ecd4`.
Worktree `orphan-attempt-settlement`; branch `fix/orphan-attempt-settlement`.

## Purpose and authorization boundary

The interrupted private experiment left one unresolved reservation. The user
now authorizes the primary to settle that one reservation as unknown while
retaining its entire US$0.005 reservation. This is not evidence of a successful
request, a refund, a repaired experiment or recovered answers. The cumulative
US$300 limit and all prior rows remain unchanged. Only the primary may inspect
and act on real control metadata after offline verification and independent
review. Implementation workers and reviewers use synthetic inputs only.

Legacy reopened embedding handles can record an unknown outcome, but they do
not atomically bind a preceding inspection to that write. The existing bound
opener correctly rejects pending rows before authorization; do not weaken it.
Add one focused maintainer-only existing-ledger compare-and-set operation,
reusing the current private-path, transaction and exact-v2 history witnesses.
Do not build a recovery framework or add a network/reservation capability.

## Frozen acceptance

- OS1: Add `settleOrphanedEmbeddingAttemptUnknown({configuration,
  expectedCheckpoint, expectedAttempt, authorize})`. Configuration has the
  existing four fields. Checkpoint has exactly `requestCount`,
  `reservedMicroUsd`, `historySha256`. Expected attempt has exactly `attemptId`,
  `channel`, `reservedMicroUsd`; it implies null outcome and null actual usage.
  Descriptor-safe own-data snapshots reject extras, accessors, symbols,
  malformed identifiers/integers/digests and asynchronous/nonfunction authority.
- OS2: Open only an existing exact schema-v2 ledger. Never create or upgrade a
  missing file, reset rows, alter caps/state/schema, or relax an old API. Bind
  configuration plus current path/inode/private-mode/hard-link checks.
- OS3: Under one `BEGIN IMMEDIATE` transaction require open state, exact full
  checkpoint/history, and exactly ONE pending row matching the entire expected
  attempt. A changed row, row order, checkpoint, path or additional pending row
  fails before the authorization callback or any update. Old request-cap-v3
  guard lineage is not a new SQLite schema version.
- OS4: Call a synchronous trusted authorization callback once with detached
  frozen before-state and target information, no database/writable handle.
  Require an undefined return; callback rejection, drift or unsafe replacement
  fails closed. Revalidate unchanged identity/history after the callback and
  before the conditional write. A callback is not a sandbox or operator approval.
- OS5: Change only the matching pending row to `outcome='unknown'` and
  `actualMicroUsd=null`; require exactly one changed row. Preserve its complete
  reservation, every other row and rowid/order, request/reservation totals,
  caps, schema and state. Verify the precise intended post-state/history and
  private path before commit. Return a frozen v2 inspection snapshot, never a
  writable handle, grant or execution/resume token.
- OS6: Duplicate/terminal calls refuse, not idempotent authorization success.
  No settlement retry, automatic reconnect, refunds or attempted cost guesses.
  Failure before commit rolls back; acknowledgement/close failure after commit
  can be uncertain and must be diagnosed read-only, not automatically replayed.
  Fixed error codes must not expose arbitrary exception text or private inputs.
- OS7: Owned synthetic tests on Node22.16/24.15 cover exact settlement, every
  unchanged field/row, duplicate/terminal/wrong target/history/config/schema,
  multiple/no pending, overrun, callback getter/return/throw/async cases,
  foreign append/settlement between inspection and writer open, path replacement,
  privacy/hard-link drift, lock failure, and before/after-commit uncertainty.
  Verify an ordinary bound embedding opener accepts the settled synthetic
  state afterward without changing its previous pending refusal. New fixtures
  use `createTestWorkspace` and canonical runner; close resources before cleanup
  and verify success/refusal/test-failure scratch has no unexpected residues.
- OS8: Retain an authentic RED at the old operation seam demonstrating the
  missing atomic checkpoint/target behavior, not a missing import/API assertion.
  A changed history must be accepted by legacy unbound settlement (symptom)
  but refused by the new CAS without modifying that history. Preserve labelled
  setup/assertion failures separately; rerun the same observation after fixing.
- OS9: Run `npm run test:experiment-budget`, `npm run demo:experiment-budget`,
  generic `npm test`, JSON and strict marketplace/plugin validation on both
  supported runtimes. Include the new tests in the existing CI gates without
  weakening them. Run relevant bound embedding/guard regressions proportional
  to the actual changed source; record command, content/SHA and raw result.
- OS10: Primary reads the actual diff and personally reruns key tests on a
  fixed committed candidate. Separate nonauthor GPT-6.1 Sol/high Standards and
  Spec reviewers inspect the same base/candidate. Fix, rerun and review again
  if changed. Scoped PR delivery requires latest-head green CI and current
  mergeability; no main/PR merge, release, deployment or cleanup of old data.
- OS11: This PR uses no keys, .env, provider calls, actual ledger/configuration,
  corpus/evaluator, old operator execution or actual orphan mutation. The
  primary's later one-shot operational action is separately pinned and audited
  against the user's exact authority; retain before/after receipts privately.

## Bounded implementation

One GPT-6.1 Sol/high worker owns `evaluation/experiment-budget/index.mjs`,
necessary tests in the existing `test/bound-embedding-ledger.test.mjs` gate,
this plan's evidence section, and narrow `docs/experiment-budget.md`,
`CONTRIBUTING.md`, `docs/limitations.md`, `ROADMAP.md` documentation if needed.
No new dependency, operational CLI, default-policy/core/MOC/report changes,
standalone generic job framework, or unrelated refactor. Root owns requirements,
architecture decisions, integration, acceptance and operational authority.

Record all affected callers and checks; no UI/browser entrypoint changes are
expected for this maintainer-only API. Existing bound/open/reopen/transition
callers must retain their established semantics and pending refusal boundaries.

## Next phases, not passed by this PR

After the exact one-shot settlement, freeze a NEW transparent development
remeasurement protocol using the reviewed result journal from PR315. The old
thirty-case batch stays interrupted and immutable, not repaired or resumed.
The old thirty's worst-case projection exceeds this new US$40 round cap.
Prefer a deterministic balanced two-per-type reused subset (12 cases), retain
the known invalid-source case in its category, freeze before any paid call,
and require the FULL prospective resource projection to fit US$40 plus the
unchanged protected allowance. If it does not fit, do not launch or silently
replace cases; root selects and records a smaller protocol before freeze.
No answer/correctness inspection informs selection. This is not an unseen
holdout, full benchmark, parity proof or permission to retry old operations.

Then separately verify/pin the fresh private operator, actual source-only
selection, new post-settlement checkpoint, model/native/runtime inventories,
one-shot identities and generation-before-evaluator boundary. Each selected
case is attempted once; failures remain in its new fixed-N denominator.
Incremental journal artifacts are private observations, not resume authority.
The new round's reservation delta is at most40M microUSD and cumulative300M
is unchanged. Reliability/source fidelity, normal installed MCP/Hermes use
and latency/RSS/request measurements remain subsequent milestones.

## Ownership and evidence

At dispatch, implementation, frozen candidate acceptance, independent reviews
and delivery were pending. No actual bookkeeping change or new paid evaluation
has occurred; implementation evidence follows.

### Implementation checkpoint (synthetic only)

Owner: actual GPT-6.1 Sol/high bounded implementation worker. Primary owns
requirements, integration, independent acceptance/reviews, delivery and any
later separately pinned operational action. Fixed base/worktree/branch are
those above; no subworkers were used. Requirements OS1–OS11 are unchanged.

The additive entrypoint is `settleOrphanedEmbeddingAttemptUnknown` in
`evaluation/experiment-budget/index.mjs`. It reuses descriptor snapshots,
existing-only encoded SQLite opens, exact-v2 validation, full rowid-aware
history, private location identity, transaction/close handling and fixed errors.
The synchronous callback receives frozen `{state, target}`; its exceptions
map to `ledger_failed`, including arbitrary supplied budget-error codes.
No existing constructor, bound handle, cap/schema transition, guard, policy,
core, prompt, model, report or operator behavior is modified. There is no CLI,
network, reservation, resume or automatic replay capability. No release/version
change or extra dependency was introduced.

Caller/check inventory: the new API is called only by the synthetic tests in
`test/bound-embedding-ledger.test.mjs`. `package.json`'s existing
`test:experiment-budget` already includes that file; CI's existing Node22.16/24
budget job runs it unchanged. Existing mixed guard authorization/creation at
`request-guard.mjs` use `openBoundEmbeddingExperimentBudget`, not this API;
their settled-only boundary is unchanged. Existing embedding migration,
request-cap-v2 ledger, bound v1/v2 and mixed embedding-lineage tests are retained.
No UI/browser/client or operational caller was added. The existing migration
child's unique textual fault-injection seam was explicitly checked below.

Fresh retained evidence directory (not disposable fixture scratch):
`/tmp/cairn-orphan-settlement-evidence.JISio7`, created with `mktemp -d`.
OS8's authentic RED preceded any runtime edit: clean-environment Node22's
canonical runner selected `OS8 exact checkpoint` in the bound embedding file,
and exited1 (1test/0pass/1fail/0skip/0cancel). A real foreign reserve and unknown
settlement occurred after the captured snapshot; the actual legacy reopened
handle then accepted the stale observation and settled the target. Assertion:
`accepted foreign history` versus required `configuration_mismatch`.
Raw `OS8-original-red22.log` is retained. This is not an unsupported import or
new-option error. `OS8-first-green22.log` records the same observation passing
with the new CAS; the final test also proves zero authorization calls on drift,
unchanged foreign history, and the legacy API's deliberately retained acceptance.

`OS-first-combined22.log` retains the first expanded matrix result9/11: two
assertions incorrectly compared SQLite null-prototype raw rows with a spread
plain-object expected row. Correction1 normalizes both sides to own-field plain
records while retaining full field/key/rowid equality; the corrected11/11 log is
`OS-fixture-correction1-green22.log`. `OS-complete-matrix22.log` then passed all
13 new tests, including writer-open disappearance, lock-before-authority,
constructor identity replacement, fixed callback errors and cleanup controls.

Both first full budget gates retain76/78 failures in
`{22,24}-test-experiment-budget-final-source1.log`: the new anonymous transaction
closure collided with the old migration child's unique source-string fault seam
(`source.split` produced3 instead2). Correction2 names ONLY the new CAS closure
`function settleOrphan()`; no old runtime/test/helper semantics or assertions
were altered. Both source2 budget gates now pass78/78. This is one successful
fixture-assertion correction and one successful textual-seam compatibility
correction; there are zero unsuccessful correction rounds or scope takeovers.

Final runtime SHA256:
`06b10753bd1895412306372bc1b246e74cebdf671266f40bc85cfa67d12cc5dd`.
Final bound embedding test SHA256:
`6f1eb6458d16078a0e1a6ad0b825e3ae44138e400830337b90eb1dab23531bdb`.
Source2's gate labels are unique and no prior RED/failure evidence was replaced.
All commands below run from this isolated worktree with only:
`env -i PATH=/home/chichieh/.nvm/versions/node/v<22.16.0|24.15.0>/bin:/usr/bin:/bin NODE_DISABLE_COMPILE_CACHE=1`.
Primary installed the unchanged locked isolated OpenAI and plugin validator
trees before these gates (no new dependency and no concurrent worker install).

| Exact command after the environment prefix | Node22.16 / Node24.15 source2 result | Raw log suffix (each has `22-` / `24-`) |
| --- | --- | --- |
| `npm run test:experiment-budget` | 78/78 each; no fail/skip/cancel | `test-experiment-budget-final-source2.log` |
| `npm run test:experiment-request-guard` | 292/292 each; no fail/skip/cancel | `test-experiment-request-guard-final-source2.log` |
| `npm test` | 580/580 each; no fail/skip/cancel | `test-final-source2.log` |
| `npm run demo:experiment-budget` | exit0 each | `demo-experiment-budget-final-source2.log` |
| `npm run demo:experiment-request-guard` | exit0 each | `demo-experiment-request-guard-final-source2.log` |
| `npm run validate` | exit0 each | `validate-final-source2.log` |
| `npm run validate --prefix tools/plugin-validation` | exit0 each (marketplace and strict plugin) | `plugin-final-source2.log` |

The authentic RED/first-green and focused commands used
`node tools/testing/run.mjs --test-name-pattern='OS8 exact checkpoint' evaluation/experiment-budget/test/bound-embedding-ledger.test.mjs`;
the expanded matrix used the same command with `--test-name-pattern='OS'`.
Ordinary npm tests use the existing owned runner. New fixtures use
`createTestWorkspace`, close SQLite resources before removal, defer child reader
shutdown to the workspace, and assert their exact owned roots absent afterward.
Nested success/refusal/assertion/setup controls also measure exact cleanup.
Writer fault children finish before fixture removal. No historical scan or
cleanup is performed. Synthetic demos retain their normal private ledgers;
test-owned scratch is removed, raw evidence is intentionally retained.

The fault matrix distinguishes rollback before commit from committed unknown
after acknowledgement/close failure; it never automatically retries a settlement.
Filesystem checks/history hashes are not authentication against hostile same-user
mutation, and the callback is trusted rather than sandboxed. Offline acceptance
does not establish that an old provider completed, restore lost answers, settle
any actual pending row, or authorize a new round. Worker never accessed keys,
application environment, actual ledger/control inputs, source/evaluator data or
executed the old operator. Frozen candidate, primary personal acceptance,
separate nonauthor Standards/Spec reviews and latest-head CI/PR delivery remain
pending at this implementation checkpoint. Token/cost/overall elapsed telemetry
is unavailable; suite duration is retained in each raw log.

Primary's direct diff inspection corrected one documentation-only prerequisite:
local process/dispatch ownership can be independently checked, but remote
provider completion/charges after a crash cannot. The API therefore retains the
full reservation and unknown usage; it does not demand unverifiable remote
termination. Runtime/test source2 hashes remain unchanged. Both earlier generic
source1 gates passed580/580 without fail/skip/cancel; fresh source2 generic gates
also passed580/580 on both Nodes, with raw durations252891.723957ms and
256757.187884ms. These final-content runs supersede source1 for acceptance;
the latter remains retained intermediate evidence, not an overwritten log.
The final-source2 focused OS8 observation also passes1/1 on Node24.15 with zero
fail/skip/cancel (`OS8-final-source2-green24.log`).

### Author freeze handoff

All required source2 gates above have finished successfully, `git diff --check`
passes, and final runtime/test hashes remain as recorded. The author freezes
one scoped candidate containing the additive API, ordinary CI tests, narrow
budget/privacy/gate documentation and this plan. Exact SHA is reported from
`git rev-parse HEAD` after commit (not embedded circularly in these bytes).
Primary personal exact-candidate acceptance and separate nonauthor Standards
and Spec reviews are explicitly pending at freeze, followed by latest-head
CI/PR delivery. The author does not push, merge, settle an actual orphan or
enable any paid/new protocol. No post-freeze edits without coordination.
