# Source-diverse selection: prospective requested-answer comparison

Status: implementation and primary offline gates complete; independent review and
prospective live execution remain pending. No new answers or scores.
Primary DRI owns acceptance and the later one-shot execution decision.
Fixed base: `5bc9b4e8c64f41212905611914f73f79bf2d2b64` (#382).
Branch: `feat/source-diverse-qa24`. Fetched main remains
`253f5ddb10f6fa8e9b182521313077e42946d5e9`.

## Decision and experiment

The source-diverse policy has enough observed selection-stage effect to test
requested-answer correctness. This is the recorded next comparison after the
re-scope in [its contract](source-diverse-selection.md), not another retry of
the closed full-label run. That run and its rejected full-context rubric remain
immutable. No product default, rank policy, answer prompt or speaker projection
changes accompany this comparison.

Use the same 24 authored source histories/questions, explicitly **previously
seen development data**, with new capture and fresh paired baseline/treatment
answers. Do not call this fresh holdout, LongMemEval, Mem0 parity or a user score.
Capture each case once through the existing indexed-evidence path and normal
classification; cold-open its same immutable database for both arms. Odd slots
baseline-first, even slots treatment-first. Baseline is ordinary selection;
treatment is exactly the #382 source-diverse selector. Keep the original model,
prompts, limits, ranker, answer packer and source-only policy equal. The historical
transport arm key `full` can remain for compatibility, but every new manifest,
report and public description must explicitly map it to `source-diverse-v1`.

## Acceptance Q1–Q12

- Q1: Add a separately versioned requested-answer rubric. Never edit the old
  cases, rubric, report or scores. Require only the asked propositions and
  necessary scope/time/uncertainty conditions. Optional background is separately
  labeled, cannot affect correctness, and is not an extra fact-recall demand.
  Freeze concise-correct, equally correct explained, and genuinely incorrect
  examples for all 24 questions. Derive them from question/source, not observed
  historical answers. Two independent reviewers must confirm semantic adequacy.
- Q2: Reuse the original exact 42 source anchors, multi-source sets and severe/
  stale/unsupported definitions without weakening them. A source-based correct
  answer can still be unsupported by the evidence actually packed; record both.
  Keep evaluator gold/examples out of capture, selection, ranking and answering.
  Prospective concise-versus-explained invariance is an explicit judging rule.
- Q3: Reuse the existing runner with a closed, validated treatment enum. The
  default full-label experiment remains behaviorally/schema compatible. The
  new source-diverse option changes only selection. No arbitrary callback,
  hidden source scan, new external service, extra provider call, rank wrapper,
  question rewrite, answer verbosity request or new retention policy.
- Q4: Preserve raw selector requests/responses. Separately record the actual
  compiled selection seen by the core, wrapper reads/material and downstream
  rank/packing observations. New coverage uses the effective selection, not raw
  model refs. Keep old reports and their old coverage behavior unchanged. Report
  selected, packed and QA separately; source novelty does not establish relevance.
- Q5: Expose a separately versioned prospective launch/preflight path that binds
  runtime, Node, model-input hash, new rubric/examples/judging identity, treatment
  policy and current budget checkpoint. Keep the old launch valid only for its
  old experiment; changed treatment or rubric cannot reuse an old manifest.
  One-shot output/start/closure and durable HTTP/case observation contracts remain.
- Q6: Reuse the original cumulative ledger and unchanged US$10 local maximum,
  1,968 HTTP upper bound, US$30 protection, time/token caps and no-retry policy.
  Do not change transport/accounting/credentials. A later live run needs clean
  reviewed code, a separately frozen manifest and current affordability, not a
  historical balance. Worker/reviewer work is offline only. No closed-run resume.
- Q7: All 24 cases / 48 arms remain in the denominator. Failures are retained,
  normal isolated failures continue under the existing rule and fatal anomalies
  stop dispatch. No case substitution, answer retry, favorable judge selection
  or retrospective rescoring. Two blind nonauthor judges; disagreements remain
  unresolved, safety unknown blocks advancement. No human-calibrated-judge claim.
- Q8: Advance only with at least three net additional correct answers over this
  new paired baseline, improved packed-anchor coverage, no increased unsupported/
  stale questions, no new predefined severe failure, no safety unknown, and
  unchanged resource ceilings. Preserve family / paired / completion counts.
  Report calls/tokens/latency/reserved and known cost; more context is not equal
  actual resource use. These are development gates, not statistical significance.
- Q9: Run a real-core/fake-HTTP integration proving that the requested policy
  actually restores omitted complementary source evidence and changes the answer
  input while original select input/output stays unchanged. A baseline-only
  control must fail the identical restoration assertion. Also prove later rank
  loss remains possible; do not silently bundle the #381 rank intervention.
- Q10: Test closed-enum rejection before calls, default compatibility, version/
  manifest mismatch before key lookup, new evidence-stage trace correctness,
  immutable rubric loading and exact original anchors, gold separation, normal/
  fatal failures and owned cleanup on success/expected failure. Fixtures use
  owned workspaces; formal live databases retain their existing explicit contract.
- Q11: On Node 22.16.0 and 24.15.0 run focused algorithm tests, generic tests,
  validation, isolated plugin validation and relevant recall/comparison demos.
  Primary personally verifies the combined result and actual exits, cross-checks
  changed files by two independent routes, freezes one candidate, obtains
  separate nonauthor Standards/Spec review, then monitors latest-head CI.
- Q12: This code-delivery packet itself makes no paid calls and no merge,
  release, deployment or default promotion. After review/delivery, primary may
  independently freeze and execute the bounded prospective experiment under
  existing user authority, recording it separately. No new spending authority
  is implied by green tests. Historical reports remain unchanged.

## Ownership and limits

One actual GPT-6.1 Sol/high worker implements the bounded evaluation extension,
new rubric/examples, tests and evidence notes. Allowed files: this plan,
`docs/limitations.md`, and `evaluation/algorithm-development/` excluding the old
`cases.json`, `rubric.json` and `transport.mjs`. Do not change core, adapters,
product defaults, package versions or the #382 algorithm. Primary owns the
contract, code inspection, local verification, artifact/manifest integration,
budget checks and later execution. Separate nonauthor Standards/Spec reviewers
inspect one frozen diff. After two failed correction rounds, stop and re-scope.

OpenAI's [evaluation guidance](https://developers.openai.com/api/docs/guides/evaluation-best-practices)
also cautions about verbosity bias and emphasizes explicit task-specific criteria.
It informs the protocol, not a claim that this synthetic sample measures users.

## Observed implementation and verification

Evidence below concerns offline integration only. Prospective requirements above
remain fixed; none is replaced by a retrospective success claim.

### Worker implementation and affected callers

Actual GPT-6.1 Sol/high implementation remains in this isolated worktree with
no core, adapter, #382 algorithm, old fixture/rubric/transport or old-artifact
changes. The existing runner accepts only `full-label-v1` (unchanged default)
and `source-diverse-v1`. Its prospective report has a separate schema identity
and explicit `baseline: ordinary-v1` / `full: source-diverse-v1` policy map.
Original raw selector observations remain intact. New `effectiveSelections`
records the actual core-bound output, wrapper reads and pure source-set diagnostics
from already observed calls. A failure before the raw selector is invoked remains
an effective failed trace, not a fabricated raw call. Separate public reads are
not an atomic snapshot and the #382/core freshness controls remain unchanged.

`requested-answer.mjs` is evaluator/preflight-only. It compiles the separately
versioned `qa-rubric-v2.json` requirements onto the original verified evaluator
shape and checks unchanged anchor/multi-source/qualification/safety fields.
Original source/rubric canonical hashes remain the frozen v1 values. All 24
questions have prospective concise-correct, equally correct explained and genuinely
incorrect examples; background and examples stay separate from required propositions.
They were authored from the original questions/sources and original rules, never
historical answers. They are calibration controls, not a semantic parser or
human-calibrated judge evidence. Primary audit corrected D20 to require its
explicitly asked reminder clause, clarified positive-slot sufficiency for D06,
preserved explicit competing D22 counts, and removed time-ambiguous Ellis advice
from D05's equally-correct example. Nonauthor semantic adequacy review remains
the primary's acceptance responsibility.

Affected entrypoints/check ownership:

- Existing runner/launch/scorer callers keep their defaults and report identities.
  The worker runs original runner/corpus/coverage/evaluator/judging/transport tests
  alongside new controls; no legacy scorer switches to effective refs implicitly.
- New launch/preflight exports reuse the existing clean-checkout, current settled
  checkpoint, durable start/request/case/report/closure envelope. Their manifest
  binds Node/runtime/model/limits, treatment, QA/examples/protocol and runtime/control
  hashes. Version/policy mismatches fail before key lookup. Formal directories
  remain caller-owned and retained; only synthetic tests clean their own scratch.
- New coverage uses mandatory effective traces and rejects missing successful
  traces; genuine pre-delegation failures stay unknown/not-run within all 42 anchors.
  The old coverage function retains raw-selector behavior. New blind packet/gate
  reuse original opaque-label and agreement-only aggregation. The gate additionally
  requires net QA gain >=3, positive packed gain, clean safety and explicit caller
  acceptance of actual recorded resource use. No automated semantic judge is added.
- The worker owns focused fake-HTTP/SQLite, rubric/calibration, coverage, enum,
  old-default, failure and owned clean-fixture one-shot tests. Primary owns full
  generic/validation/plugin/demo gates, combined inspection and independent reviewers.

The positive synthetic control captures once and cold-opens the same unchanged
SQLite state for each arm, with eight visible cards including three exact-source
billing seeds and an omitted complementary two-receipt card. Both arms use the
same original selector request/output and unchanged input-only ranker. Raw refs
stay three; effective treatment refs become five, using sixteen public reads and
4,009 accepted source-material bytes. Actual answer HTTP bodies are checked against
verified packed requests, not reconstructed or gold-backfilled evidence. Across
24/48 slots the control uses 528 fake HTTP attempts and 2,640,000 reserved microUSD
on a fresh synthetic ledger. These are fixture resource observations, not provider
spend or semantic QA. A separate identical-across-arms rank-loss control still
loses the complementary packed source. The baseline-only assertion checks the
recorded baseline packed request against the same restoration requirement and is
expected red; it introduces no production treatment option.

The first new focused suite exited 1 (8/13 passed): the fake extractor exceeded
the existing five-item batch cap, and a coverage tamper fixture shared input-object
aliases. The former was split into three bounded source sessions without changing
core limits; the latter now detaches each observation. The restoration-only probe
passed all 24/48 slots; the mixed probe still exited 1 because it had loaded the
pre-fix coverage fixture. A fresh coverage-only probe exited 0. No acceptance
criterion or #382 policy was relaxed. Final supported-Node/full/red results and
primary acceptance/review evidence follow after worker freeze.

### Worker freeze evidence (offline only)

On both Node 22.16.0 and 24.15.0, `tools/testing/run.mjs
evaluation/algorithm-development/test/*.test.mjs` exited **0**, with 51/51 tests
passing and zero skips at that checkpoint. Subsequently affected requested-answer
rubric/coverage/gate/launch checks exited **0** on both Nodes (7/7). The final
positive real-core/fake-HTTP restoration check passed on both Nodes after the
core-bound trace-output ordering correction. The baseline-only invocation
(`CAIRN_REQUESTED_ANSWER_BASELINE_ONLY=1`, `--test-name-pattern='Q9 real core'`)
exited **1** on each Node at the intended actual packed-source assertion:
one complementary anchor versus the required two. Its owned scratch was removed.
The independent rank-loss negative and unchanged-default/failure controls passed
in the 51-test suites; primary owns final combined gates against the frozen packet.

Two final fixture assertions initially failed, without a production policy change:
the local counter injection hit core preflight rather than wrapper entry (exit 1
on both Nodes), and Node 24's copied synthetic ledger root had non-private mode
(exit 1; Node 22 exited 0). The counter sequence was verified in existing
`packSelect`, `callModel`, and the source-diverse wrapper: the third unchanged
envelope count is the wrapper's own pre-delegation check. The copied root now
explicitly retains mode 0700; file modes are retained by the copy. The narrow
`--test-name-pattern='Q4 real wrapper|owned clean synthetic'` rerun exited **0**
on both Nodes (2/2, zero skips), verifying failed effective output is null,
raw delegation never occurs, and the scorer can retain unknown coverage.
The owned launch archive also proves exact configuration digest/campaign binding,
manifest mismatch before key lookup, failed-key one-shot closure and cleanup.

Dependency ownership: root and adapter `node_modules` were both absent before
the isolated locked `npm ci --prefix adapters/openai --ignore-scripts` (exit 0).
The launch proof starts from a fresh source-only Git archive with no root
dependencies and copies only that locked adapter install; no shared install or
operational artifacts are used. This packet intentionally reuses the existing
adapter tokenizer and is not an adapter-dependency-free runner. Original
`cases.json`, `rubric.json`, `transport.mjs`, and the #382 policy remain byte-identical
to the fixed base. `git diff --check` exited 0. No provider calls, old live artifacts,
credential lookup, operational ledger access, or historical rescoring occurred.
These offline controls do not establish a QA gain or authorize a paid experiment.

### Primary combined acceptance before candidate freeze

Primary personally inspected the production diff, original source questions and
all 24 rules / 72 examples, then ran the final combined packet with an empty
environment apart from the pinned Node PATH, owned TMPDIR and disabled compile
cache. Independent semantic review of the rubric remains required; a structural
check is not a substitute for it.

On **both Node 22.16.0 and 24.15.0**, the following commands completed with actual
exit **0**, no signal and zero skipped tests:

| Command | Observed result per Node |
| --- | --- |
| `npm run test:algorithm-development` | 53/53 |
| `npm run test:longmemeval` | 193/193 |
| `npm test` | 653/653 |
| `npm run demo:recall` | Exit 0 |
| `npm run demo:longmemeval-comparison` | Exit 0 |
| `npm run demo:longmemeval-public` | Exit 0 |
| `npm run validate` | Exit 0 |
| `npm run validate --prefix tools/plugin-validation` | Exit 0 |

Each supervisor also verified that all ten scoped file hashes were unchanged
through its full run. This evidence-only plan update follows those checks; no
implementation, fixture or rubric bytes were changed afterward. The isolated
plugin dependency directory was absent before its locked install (exit 0).
There is no TypeScript/typecheck gate in this JavaScript repository.

Primary independently reran the exact `Q9 real core` control through the owned
test runner with `CAIRN_REQUESTED_ANSWER_BASELINE_ONLY=1` on both Nodes. Both
actually exited **1** at the intended packed-answer assertion, `1 !== 2`.
This option checks the recorded baseline against the same two-anchor restoration
requirement; it does not disable execution of the paired treatment. The test
asserts owned scratch cleanup on this expected failure path.

The independent contract audit exited **0**: 24 cases, 42 original anchors,
168 unchanged non-QA rubric fields and 72 frozen examples. Original cases,
rubric and transport bytes still match the base. New canonical freeze identity:
`4a136c561318c8af9a9ba2666064cb483f9dd2095dbf186b019041ff81950f25`.
The raw QA rubric SHA-256 is
`9dd6f0b8fe85493b838ee6d52f25d0d7004a81ce89ab58f49d832001c739b0da`.
Changed-file inventory was independently derived from Git diff plus untracked
files and from porcelain status: both contain exactly **10** files.

Worker ownership remains actual GPT-6.1 Sol/high. Primary owns the acceptance
notes and temporary explicit launch/post-run integration helpers, not a separate
product implementation. Those helpers do not run during this offline packet.
The original campaign was observed settled at 55,779 requests and 323,232,281
reserved microUSD before this freeze; this is a historical affordability
observation, not a launch checkpoint or invoice. The later one-shot experiment
must bind a freshly inspected checkpoint and the exact reviewed candidate.
Review reports, candidate SHA and latest-head CI will be recorded in the PR.
