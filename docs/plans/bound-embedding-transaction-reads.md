# Bound embedding accounting: eliminate one duplicate full read

Fixed base7467aebcb32563c9aab4356a8c3e04c0ebb1ecd4. This packet addresses a
source-observable duplicate full validation inside one successful bound-v2
accounting transaction. It does not diagnose or fix any historical provider
timeout, native halt, ingestion failure, semantic error or scoring result.

## Acceptance

- BO1: Freeze a red-capable test before any production edit. Exercise the real
  existing bound embedding public reserve and recordOutcome paths, counting
  actual full-state reads/quick checks only during each measured operation,
  excluding construction/setup. Baseline must show three full validations;
  successful candidate operations require exactly two, not zero or one. Use
  test-local instrumentation at SQLite prepare only; no new public callback,
  test injection option, instrumentation export or private implementation API.
- BO2: Only remove the discarded immediate post-write read inside reserve and
  recordOutcome when embeddingBound is true. The existing enclosing access
  transaction must still perform its complete pre-write witness validation and
  complete post-write validation/expected-state comparison before commit.
  Preserve every schema/quick-check/configuration/location/order/rowid/hash
  witness check at these boundaries. No cache across operations, weak witness,
  authorization bypass, new schema/version, PRAGMA or transaction mode.
- BO3: Keep legacy unbound-v1, unbound embedding-v2 and bound-v1 behavior and
  validation counts unchanged. getState, construction, upgrades/transitions,
  guard routing, callbacks, caps, pricing, unknown reservations, time limits,
  retry policy, core, prompts and model selection stay unchanged. No actual
  ledger/control/corpus/provider/key/private operator reads or mutations.
- BO4: Test observable exact ordered history, caps, hash/current snapshot,
  successful reservation/settlement, unknown full retention, overrun, duplicate
  IDs, repeated terminal attempts and budget/request ceiling failures. Prove
  foreign edits/order/configuration changes still reject before mutation and
  permanently close the bound handle; other persisted rows are unaffected.
  Establish test preconditions through public constructors on fresh owned
  synthetic books. Raw SQL only for deliberate corruption challenges.
- BO5: Tracked scope is evaluation/experiment-budget/index.mjs, one focused
  regression test and narrowly relevant docs/CHANGELOG/this plan. Any other
  production change requires primary re-scoping. Do not import journal/v3
  changes, add a launcher, read old private outputs or claim paid-root cause,
  latency guarantees, memory quality, product lightweight status or parity.
  Document reduced work count, not an unmeasured wall-clock improvement.
- BO6: Keep every initial failure and correction; canonical run.mjs fixtures
  use createTestWorkspace with immediate deferred closure and cleanup. Both
  pinnedNode22.16/24.15 author gates: generic npm test and validate, full
  experiment-budget suite/demo plus focused regression; request-guard suite/
  demo and LongMemEval suite/mixed demo after this worktree's locked OpenAI
  dependency install. No paid/native operational execution or historical sweep.
- BO7: Primary fully reads actual candidate diff and personally reruns focused
  count/integrity/accounting and actual guard integration on both Nodes.
  Freeze scoped local commit before push; independent nonauthor Standards and
  Spec reviews inspect same fixed base/candidate. Latest remote-head CI must
  pass and PR be mergeable before ready delivery. No merge/release/deploy.

One actualGPT-6.1Sol/high worker owns implementation; primary owns requirements,
scope, hypothesis decisions, integration and acceptance. Worktree
`/home/chichieh/Github/cairn-memory-worktrees/bound-embedding-transaction-reads`,
branch `fix/bound-embedding-transaction-reads`. Keep evidence and exact entrypoint
trace here; no separate issue tracker. This packet is not the explanation for
an earlier paid failure and never authorizes a paid rerun.

## Diagnosis checkpoints

Before production edits, return frozen test hashes and two baseline RED runs
with exact count and source SHA. Primary then reviews the signal and ranks
falsifiable hypotheses; proceed only after that checkpoint. Hypotheses and
subsequent evidence must distinguish the duplicate-read symptom from historical
timeouts that cannot currently be reproduced. After acceptance, record all
commands, failures, review findings, candidate hashes and limits below.

## Frozen RED checkpoint

Worker requested/actual model `gpt-6.1-sol`, reasoning `high`; one bounded
implementation owner. Read the complete BO contract, CONTRIBUTING and CONTEXT,
the shared diagnosis/worktree/model-routing instructions, and relevant budget
and embedding-migration documentation. The fixed base has no budget ADR (the
three ADRs concern memory semantics). No production edit precedes this checkpoint.

Frozen focused regression:
`evaluation/experiment-budget/test/bound-embedding-transaction-reads.test.mjs`,
SHA256 `e572ab5e3a0d55e0cd555c7cdc8c0946d95f5fc304f2e63d08038d36172f3161`.
Unchanged `evaluation/experiment-budget/index.mjs` SHA256:
`daac7a41115991db520f91a93345e7f93ed6eeb8c005b80d61cb352f295f026b`.

The test creates an owned synthetic book through public constructors, seeds two
settled attempts (one unknown, one succeeded), migrates through the existing
public inspection/upgrade API and opens the actual bound-v2 handle. It verifies
the exact ordered state, reservation totals and documented rowid-aware SHA256
before and after both measured writes. Test-local `DatabaseSync.prepare`
instrumentation wraps real SQLite statements only during each operation;
construction, seeding, upgrades and external snapshot checks are excluded.
Counters distinguish `PRAGMA quick_check`, `SELECT * FROM run_config`, and the
complete ordered attempts select. No new runtime/public instrumentation seam.

Initial Node22 run: 15 pass / 1 fail / 0 skips in about 2.4 seconds. Then the
unchanged frozen test ran once on each pinned Node with retained raw logs:

```text
/home/chichieh/.nvm/versions/node/v22.16.0/bin/node tools/testing/run.mjs evaluation/experiment-budget/test/bound-embedding-transaction-reads.test.mjs
/home/chichieh/.nvm/versions/node/v24.15.0/bin/node tools/testing/run.mjs evaluation/experiment-budget/test/bound-embedding-transaction-reads.test.mjs
```

Both baseline runs exited 1 with 15 pass / 1 fail / 0 skips. The sole failure
was BO1: reserve AND recordOutcome each observed exactly
`{quickChecks:3,runReads:3,orderedHistoryReads:3}`, expected all three counters
to equal 2. All behavioral/integrity/precondition checks passed on the base.
Other baseline counts: unbound-v1 and unbound-v2 writes 2/read 1; bound-v1 writes
3/read 2; bound-v2 getState 2. These are operation counts, not elapsed-time,
semantic-quality or historical timeout evidence.

Raw original logs at `/tmp/cairn-bound-read-gates.AuvogZ/`:

- `node-22.16.0-baseline-RED.log`, SHA256
  `f2206f36bb137d88bc698af2e2af17d04ca7c92e70e80ba0b57e1ffb778a3e3a`
- `node-24.15.0-baseline-RED.log`, SHA256
  `7e8c22bb41517d9c488fc125bb6b32d2ec434d6836f132e09acfdfe558c29fe0`

Worker paused production edits for the primary's signal/hypothesis checkpoint.
No paid/provider/native operation, actual ledger/control/corpus/key read,
other-worktree write or historical-cause claim occurred.

## Primary diagnosis approval and augmented freeze

Primary read all 16 frozen tests and independently reproduced the same RED on
both Nodes with the canonical focused command above: 15 pass / 1 fail, bound-v2
write counts 3 versus required 2, source/test hashes unchanged.
Primary ranked these falsifiable hypotheses before any production edit:

1. H1: The discarded immediate post-write full read duplicates the enclosing
   access post-read. Remove only that internal read for bound-v2: both writes
   should change 3 to 2, with pre/post corruption controls unchanged.
2. H2: Instrumentation counts setup. If so, narrowing its scope without a
   production edit should reduce counts. This is weak because counters start
   after setup, exclude external inspections and have passing legacy controls.
3. H3: The source is shared legacy/read/authorization behavior. If so, the
   change should alter v1/getState controls; their unchanged counts must falsify
   this as the explanation of the removed work.

Primary approved only the two conditional internal-read changes under BO2,
after requiring a pre-edit settlement post-write corruption control. The
existing reserve rollback control is now parameterized for reserve AND
recordOutcome. The latter creates its pending reservation outside counters,
then proves refused settlement preserves that exact pending attempt/full
reservation, rolls back the foreign-history change and closes the handle.
All original test expectations remain unchanged.

Augmented frozen test SHA256:
`13bc3a71bc4dd971c002bdd71b17d9aab00f3a82c2eca9f3913c11e324b8f326`.
Both Nodes reran the same canonical command BEFORE the production edit. Each
exited 1 with 16 pass / 1 fail / 0 skips: only BO1 failed (both writes 3 versus
2), and both post-write rollback controls passed. Original RED logs remain;
the new original logs are
`/tmp/cairn-bound-read-gates.AuvogZ/node-22.16.0-augmented-baseline-RED.log` and
`node-24.15.0-augmented-baseline-RED.log`. Production index still matched its
base SHA256 at this augmented freeze. This approval addresses the counted-read
symptom only; it supplies no causal evidence about historical timeouts.

## Regression CI integration clarification

Primary identified that `package.json` uses an explicit file list for
`test:experiment-budget`; a standalone regression would otherwise be omitted
by the existing budget CI gate. Primary initially expanded BO5 only to append
`evaluation/experiment-budget/test/bound-embedding-transaction-reads.test.mjs`
to that existing package script. No other script, version, lockfile or CI
configuration changes. This initial integration decision was superseded after
the generic gate exposed the frozen script compatibility assertion below.

## Implementation trace and focused GREEN

Only the immediate discarded `readValidatedState` calls in reserve and
recordOutcome now have `if (!embeddingBound)` guards. The enclosing access
transaction still checks private location, complete validated state, exact
configuration and original witness before work, and complete state,
configuration, location and expected post-state before commit. It advances the
witness only after transaction completion and closes the bound handle on any
failure. There is no cross-operation cache or new runtime seam.

Actual callers were inspected: mixed capability authorization and guard
creation obtain the existing bound-v2 handle; the guard reserves before
dispatch and settles through its `recordOutcome`. Their routing, caps,
pricing, unknown-reservation retention, settlement-failure handling and
timeouts are untouched. Public constructor/upgrade APIs and all getState
branches are untouched. CI's existing experiment-budget and request-guard jobs
call the actual package gates; the experiment-budget matrix now additionally
runs the new regression through its canonical command as clarified below.

The frozen augmented test ran GREEN on both pinned Nodes through the same
canonical command: 17 pass / 0 fail / 0 skips. Both bound-v2 writes observed
exactly `{quickChecks:2,runReads:2,orderedHistoryReads:2}`. All legacy/unbound and
getState counts matched their baseline; both reserve and settlement post-write
foreign-history challenges still rejected and rolled back, and all other
accounting/integrity cases passed. This supports H1 for the counted duplicate
and rejects H2/H3 as alternative explanations for that count reduction. It
does not reproduce, diagnose or resolve a past timeout.

GREEN raw logs: `/tmp/cairn-bound-read-gates.AuvogZ/node-22.16.0-focused-GREEN.log`
and `node-24.15.0-focused-GREEN.log`. Test SHA256 remains
`13bc3a71bc4dd971c002bdd71b17d9aab00f3a82c2eca9f3913c11e324b8f326`;
candidate index SHA256 is
`c75a1f2feb1d0d1d62e0822cc9172c5f0dd9f4fbbea898ce0c7fa677371fb6e3`.
Augmented RED log SHA256 values remain:

- Node22: `af82470052bee9892a5fc60974b3d0fc0a00d2ab48f4182c99b327e3ec1099b0`
- Node24: `9aa3e50b2d424a5b8a91afbd4c944e1bb8403ef5c82d3f08a4e595945a7a39a7`

Locked prerequisite command `npm ci --prefix adapters/openai --ignore-scripts`
ran only in this worktree (1 package added, 2 audited, 0 vulnerabilities).
No initial test was weakened or removed and no correction was required after
the two-line production change. Fixture resources register deferred closure
immediately and close before canonical owned-workspace removal; prepare
instrumentation is test-local and restored in `finally`.

## Retained generic gate integration failure

Initial full `npm test` on both pinned Nodes exited 1: 579 pass / 1 fail /
0 skips. The sole failure was the existing test at
`integrations/client/test/pairing-guards.test.mjs:88`, whose nonguarded package
script equality check compares `test:experiment-budget` to the frozen
`fixtures/base-scripts-3a1c17d9.json`. Actual value was exactly the approved
baseline command plus the new regression path; expected value was the old
command. This is a reproducible test-integration dependency, not an unexplained
infrastructure failure or accounting regression. Both initial raw logs remain
at `/tmp/cairn-bound-read-gates.AuvogZ/node-22.16.0-test.log` and
`node-24.15.0-test.log`. Validation passed on both Nodes; other full gates
continued independently. Worker requested primary clarification before editing
that additional test outside the bounded file scope; the historical frozen
script fixture remains untouched.

Primary then inspected that test and fixture and superseded the package-script
integration: restore our sole package append to its exact original value and
add just one canonical regression command immediately after the existing
budget command in `.github/workflows/ci.yml`'s experiment-budget matrix:
`node tools/testing/run.mjs evaluation/experiment-budget/test/bound-embedding-transaction-reads.test.mjs`.
This is the only authorized CI-file change. All package/version/lockfile,
pairing test, frozen script fixture, home guard and other CI/gate content stay
unchanged. Both generic gates must rerun after restoration; focused regression
and ordinary budget counts are reported separately. Initial failed logs remain.

One initial multi-file restoration patch failed context verification without
changing files; the corrected patch then applied the exact approved restoration
and CI line. No accounting source or frozen regression changed during this
integration correction.

## Final full author gates and local freeze

Both pinned Nodes completed all final gates below with exit 0 and zero skipped
tests. Package commands used the respective Node's `bin` directory at the
front of PATH. Each gate ran on fresh synthetic books with fake HTTP where
applicable; no native operational launch, actual provider key or paid call.

| Exact command | Node22.16.0 | Node24.15.0 |
| --- | --- | --- |
| `npm test` after exact package restoration | 580/580 | 580/580 |
| `npm run validate` after package restoration | Pass | Pass |
| `npm run test:experiment-budget` after restoration | 65/65 | 65/65 |
| `node tools/testing/run.mjs evaluation/experiment-budget/test/bound-embedding-transaction-reads.test.mjs` | 17/17 | 17/17 |
| `npm run demo:experiment-budget` | Pass | Pass |
| `npm run test:experiment-request-guard` | 292/292 | 292/292 |
| `npm run demo:experiment-request-guard` | Pass | Pass |
| `npm run test:longmemeval` | 193/193 | 193/193 |
| `npm run demo:longmemeval-mixed` | Pass, no transport dispatched | Pass, no transport dispatched |

The exact selected compatibility command also passed 1/1 with no skip on each
Node after restoration:
`node integrations/client/testing/run.mjs --test-name-pattern='thin guard entry' integrations/client/test/pairing-guards.test.mjs`.

All raw logs remain under `/tmp/cairn-bound-read-gates.AuvogZ/`, named
`node-<version>-<gate>.log`. Final generic, ordinary budget and validate logs
have suffixes `test-restored-package`,
`test-experiment-budget-restored-package` and `validate-restored-package`.
Focused logs retain `focused-GREEN` and the selected compatibility logs
`generic-script-compatibility-GREEN`. Other package logs replace colons with
hyphens. The earlier expanded package gate passed 82/82 (65 existing + 17 new)
on both Nodes, but is only intermediate evidence: the final package script is
unchanged and the regression's final CI command is separate. Every initial RED
and generic failure is retained and explained above; no other full gate failed.

Final index and augmented regression still match their recorded GREEN hashes;
`git diff --check` passes. The final scoped candidate has eight files:
the two-line index change, one new focused test, one CI command, CHANGELOG,
the experiment-budget/embedding-migration/limitations documents and this plan.
Package/version/lockfiles, pairing tests and historical fixtures have no diff.
Primary owns the exact committed-candidate both-Node affected reruns, dual
nonauthor Standards/Spec reviews, push/PR and latest-head CI. Author success
does not substitute for those delivery gates or authorize merge/deploy.
