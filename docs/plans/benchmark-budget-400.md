# Same-history cumulative benchmark budget: US$300 to US$400

Status: implementation and required offline acceptance complete; fixed-SHA
independent reviews and latest-head CI pending. Operational activation is
not performed by this change.
Fixed base `b9a4a52a5c21b3fda41ae8dbee17c4f8852acf26`; worktree
`benchmark-budget-400`, branch `feat/benchmark-budget-400`.
Actual author GPT-6.1 Sol/high; primary owns authentic ledger inspection/action,
integration, commits, independent fixed-SHA reviews and PR/CI. No author commit,
push, actual/private data access, provider call or operational transition.

The owner's US$400 authority is cumulative, not US$400 new money. This delivery
adds exact technical lineage only. Preserve every old reservation including
unknown actual cost and every prior consumed evaluation. No roster is selected
or run, no score changes and no released MCP/Hermes adoption is established.

## Acceptance

- B401: New `benchmark-budget-v4`, `authorizeChainedBenchmarkBudgetV4` and
  `loadChainedBenchmarkBudgetV4` accept exactly 300,000,000→400,000,000 microUSD
  on the same run/path/policy, with identical finite request cap (operational
  cap 840,000; synthetic fixtures may use smaller valid caps). Require authentic
  immutable v3 parent plus complete older ancestry and fixed stages. Keep v3
  exact 200→300 and strict cap increase untouched.
- B402: New `projectEmbeddingBudgetLimitV4Prefix` and
  `transitionEmbeddingExperimentBudgetLimitV4` are existing-only, ledger-issued
  origin-bound, exact-prefix operations. Preserve schema, all rows/rowids/order,
  costs, counters, old files and unknown reserves. No reset/refund/repricing.
  Project an authentic old-prefix snapshot, never a JSON/copy-directory witness.
- B403: Under existing write transaction and location fencing, exclusively
  publish/fsync authorization and sync directory before limit commit. Exact
  interrupted replay/recovery is idempotent and valid later settled suffixes
  remain valid. Reject tampered history/prefix/parent, pending/overrun, unsafe
  modes/symlinks, missing files/DB, partial/conflicting records and copied/cloned
  witnesses. Existing fixed errors and locking/rollback/close semantics remain.
- B404: Explicitly wire v4 through parent verification/envelope, authentic
  embedding-snapshot assertion, mixed configuration and actual mixed guard.
  All stale configurations and old consumed/unused/live grants lose dispatch
  after transition. Fresh v4 Cairn/native requests work, including the N15
  authorized navigation manifest. No core/native/model/timeout/retry change.
- B405: Synthetic owned fixtures prove old rows/files frozen, complete ancestry
  after later suffix, exact finite-cap exhaustion, crash recovery, write/fsync/
  commit failure, real child concurrency and old reservation race. Every
  allocated workspace/resource cleans up after success and failure; no old
  temporary directory cleanup. Use no operational ledger, key or corpus.
- B406: Exact Node22.16/24.15 focused, budget/request-guard/LME/portable and
  installed native/mixed-native/live/generic/validate/maintainer/workspace and
  relevant demos report actual exits. Budget-only tests must not import adapter
  dependencies into their CI job. Independent reviewers inspect one fixed
  committed diff; primary replays key persistence/integration paths. No typecheck
  script exists in this JavaScript repository; unrun gates are not passes.

## Proposed bounded surface and caller trace

| Surface | Exact responsibility | Owner |
| --- | --- | --- |
| experiment-budget/index.mjs | New fixed v4 configuration, projector and named transactional transition; reuse existing storage/brand/origin/close fences without widening old helpers | Author |
| experiment-budget/request-guard.mjs | Separate v4 filename/config/record/verify/authorize/load; one fixed v4→v3 ancestry step; explicit embedding/mixed acceptance | Author |
| Named v4 budget-only synthetic test | Prefix/rows/files/refusal/fault/real-process race/crash; builtins+ledger only | Author |
| Named v4 guard/integration synthetic test | Authentic ancestry/grants, stale versus fresh mixed Cairn/native fake HTTP and N15 manifest | Author |
| package.json | Narrow existing budget/guard gate registration, no dependency/version change | Author |
| integrations/client/test/pairing-guards.test.mjs | Exact two changed script strings only; retain historical caller-environment fixture and all other guard assertions | Author, explicitly approved after caller regression |
| Plan, budget docs, limitations, one unreleased entry | Cumulative authority/technical boundary and honest evidence | Author |
| Authentic operational ledger, fixed-SHA reviews/CI | Read-only rebind and transition only after acceptance; no worker access | Primary |

No core, native, schema, prompts, model/pricing, request ceiling, retry, dataset,
roster, scorer, other worktree, private operator or paid-result edits. Initial
design duplicates only the narrow exact transition surfaces so old v3 contracts
and frozen migration fault seams remain unchanged. New callback names must not
duplicate the old migration fixture's anonymous source seam.

## Feedback and gates

Before implementation, add/run a canonical synthetic transition test that
asserts the new exported exact API and cumulative preservation. Retain its
actual RED category, never a dependency/setup error. Verify the minimum loop
before broader fault/race and integration tests. Each refusal asserts the
specific existing error category, not only any throw. Use `env -i`, exact bins,
`TMPDIR=/tmp`, `NODE_DISABLE_COMPILE_CACHE=1` and existing pinned native roots
for native gates. Inspect node_modules before isolated locked installs.
Author will checkpoint production freeze before primary parallel contributor
gates. Required scripts remain canonical; no skipped mandatory cases count as
passes. Next stages (fresh metadata-only 30, resource freeze, one-shot comparison
and adoption/cost gates) remain separate, not actions in this budget change.

## Implemented boundaries and retained feedback

V4 adds only two ledger and two guard exports. Its filename is
`experiment-benchmark-budget-v4-${parentAuthorizationId}.json`; the record
retains prior/new ledger, policy/stages, parent, checkpoint, both prefix hashes
and historical digest under the separate `benchmark-budget-v4` version.
The money-only SQL update never writes request_cap or rows. The parent verifier
takes one fixed v4→v3 step and then the existing complete older ancestry. V3's
configuration/projector/transition/record functions remain unchanged.

Initial canonical exact24 command:

```sh
env -i PATH=/home/chichieh/.nvm/versions/node/v24.15.0/bin:/usr/bin:/bin TMPDIR=/tmp NODE_DISABLE_COMPILE_CACHE=1 /home/chichieh/.nvm/versions/node/v24.15.0/bin/node tools/testing/run.mjs evaluation/experiment-budget/test/budget-v4-ledger.test.mjs
```

`b0ce64` actual exit 1: namespace import asserted the new projector was a
function, but observed `undefined`, one failure/zero skips. This is the missing
feature/API RED, not a missing-export import failure. `1d8555` then passed 1/1
with preserved finite cap and logical rows. An intermediate new-source duplicate
declaration (`4f86c0`, exit 1) was an author implementation error, not feature RED.
Initial adapted fault fixtures (`636ec0`, exit 1, 17/20) had three stale v3
amount/branch expectations; runtime validation was not relaxed to satisfy them.

Primary caught an overly broad pending-suffix check in the new projector.
The sharp `owned pending suffix` regression (`fa4202`, exit 1) observed
`invalid_options` when projecting a genuine guard-issued current snapshot with
a settled historical prefix and owned pending suffix. Earlier `83c699`/`899b72`
exits 1 hid assertions behind `callback_failed` and are not the final symptom
proof. Projection now checks only the checkpoint prefix, like the old lineage
contract. Transition/replay still rejects ANY pending attempt as `budget_blocked`.
The actual mixed guard deliberately remains single-flight: the overlapping
second request returns `guard_busy` without halt, first settles, and a later
sequential request succeeds. No general guard concurrency behavior changed.

Unowned pending work is rejected earlier by bound-ledger validation as
`invalid_ledger`; focused both-node checks `ee40c3`/`d3c6f5` exited 0 after
correcting the test's assumed `policy_mismatch`. Initial full guard gates both
exited 1 on that incorrect expectation and remain retained. Exact refusal tables
also corrected Infinity's `invalid_options` detachment and an unknown policy
field's `invalid_policy`; these expectation failures were not product REDs.
Every final negative asserts a specific existing fixed error, including each
ancestor's missing/mode/tampered evidence. Async synthetic race children have
a 10-second deadline and owned cleanup; crash controls intentionally SIGKILL
before/after COMMIT and preserve the fsynced authorization for exact recovery.

Primary generic tests initially returned 580/581, actual exit 1 on both Nodes
(`d20396`/`ef4909`): an existing caller test freezes package script strings.
Only its two exact budget/guard expected strings were updated; all other
environment/guard assertions and historical fixture bytes remain unchanged.
Both thin-entry regressions passed 1/1, zero skips (`02bcb0`/`089f66`, exit 0).

## Focused and contributor evidence

Author combined ledger+guard checkpoint: exact22 `da35e5`, exact24
`89eaae`, each 24/24, zero skips, actual exit 0. Primary independent checkpoint
focused checks: exact22 `1d5209`, exact24 `11e658`, same 24/24, zero skips,
actual exit 0. They cover genuine Cairn adapter count/extract and the guarded
Mem0 embedding route, not an installed child end-to-end under v4; the existing
installed/native mixed gates below separately cover unchanged native plumbing.
The N15 experimental manifest is bound to its distinct methodProfile, without
changing label/core behavior here.

Dependencies were absent, not shared symlinks. Author OpenAI locked install
`cbb680` exited 0; primary MCP `8a8ce3` and maintainer `109c19` exited 0.
Lockfile parity `fc7189`/`9f8a29` exited 0. MCP retains the previously disclosed
dev-only client advisory; no lock update or audit-all-green claim is made.

| Gate | Exact22 | Exact24 | Owner |
| --- | --- | --- | --- |
| validate | exit 0 `274ff7` | exit 0 `f128a5` | Primary |
| maintainer validation | exit 0 `239aff` | exit 0 `6888d2` | Primary |
| workspace lifecycle | 25/25, 0 skip, exit 0 `ad9dfc` | 25/25, 0 skip, exit 0 `0ca6dc` | Primary |
| generic | 581/581, 0 skip, exit 0 `07ee01` | 581/581, 0 skip, exit 0 `ce67a3` | Primary |
| budget | 67/67, 0 skip, exit 0 | 67/67, 0 skip, exit 0 | Author |
| request guard, final closed-child source | 335/335, 0 skip, exit 0 `ff0a8a` | 335/335, 0 skip, exit 0 `552c65` | Author |
| LongMemEval | 300/300, 0 skip, exit 0 | 300/300, 0 skip, exit 0 | Author |
| portable native gateway | 85/85, 0 skip, exit 0 | 85/85, 0 skip, exit 0 | Author |
| installed native/containment | 20/20, 0 skip, exit 0 | 20/20, 0 skip, exit 0 | Author |
| mixed native local | 47/47, 0 skip, exit 0 | 47/47, 0 skip, exit 0 | Author |
| live evidence offline | 340 pass, 30 existing opt-in skips, exit 0 | 340 pass, 30 existing opt-in skips, exit 0 | Author |
| six demos | each exit 0 | each exit 0 | Author |

Author driver `/tmp/cairn-n16-gates.ZhYAouV7/run.mjs` uses exact bins, an
explicit keyless environment and only the existing pinned native roots. Each
of 13 tasks records actual code/signal/error, separate logs and before/after
production-source SHA256. Initial failed gate receipts are not overwritten;
final affected guard replays use separate `verified` logs. These are synthetic
owned evidence, not operating-ledger snapshots or paid-run authorization.

A final test-only cleanup refinement rejects a timed-out race child only after
observed close; deferred cleanup kills and awaits any sibling still alive.
Affected focused and full guard commands were rerun against that final test
source, with separate `final-focused`/`closed` logs; earlier passes remain dated
checkpoints, not substitutes for the final full suite.
Final author focused acceptance: exact22 `6b8e9f`, exact24 `8180c1`, each
24/24, zero skips, actual exit 0. The original 13-task drivers ended exit 1
(`f4db0b`/`b79b30`) because they retain the earlier guard failure, not because
later successful records erase that status. Their remaining 12 tasks each
exit 0 with null signal/error and production-source hashes unchanged; the
separate final full guard replays above complete all 13 gate requirements.
Live-offline's 30 skips are eight pinned-host, nineteen installed-phase and
three rationale opt-ins, not 370 verified passes. No mandatory native case
skipped. The six demos are budget, request guard, ingestion, comparison,
public pilot and mixed preparation; they retain their normal fresh synthetic
artifact contract, with no historical cleanup. Mechanical log-count audit
`12ffa0` exited 0; final public scope cross-check is 12 files.

The original operational finite request cap remains 840,000. Smaller fixture
caps are intentional: one test exhausts 20 without raising it; another preserves
300M unknown reservations and proves exactly 100M new technical headroom. No
actual historical ledger or balance was inspected/changed by the author. Whole
SQLite byte identity is not promised: cap update changes the DB, while attempt
row identity and all older immutable authorization/binding bytes are exact.
