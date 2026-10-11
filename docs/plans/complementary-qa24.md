# Complementary source QA development comparison

Fixed base `56f555df56184e7ea7980cea2351c84c12f72572`; branch
`experiment/complementary-qa24`; worktree
`/home/chichieh/Github/cairn-memory-worktrees/complementary-qa24`.
Bounded implementation owner: actual GPT-6.1 Sol High. Primary owns design,
integration, final gates, nonauthor review and paid decisions. Before editing,
HEAD matched this base and worktree was clean; primary accepted the design
checkpoint. Author cost/token usage unavailable; no evaluated-model HTTP or
operational-ledger writes occurred.

## Frozen contract (Q1–Q8)

Q1: Use the same 24 known source-only D01–D24 cases, unchanged requested-answer-v2 rubric and all 42 anchors. Capture each case once into a fresh database, cold reopen the same logical state for every arm, and preserve immutable observations. Use distinct report, freeze, launch, coverage and judgment versions. This is development evidence, not a fresh holdout, official LongMemEval or a competitive score.

Q2: Three arms: A baseline = ordinary-v1; B linked = source-diverse selection plus source-linked-evidence ranking; C complementary = the same source-diverse selection plus createComplementarySourceSetModel/assembleComplementarySourceSet from the frozen evaluation/experiments/cloud-retrieval-v1/candidate.mjs. All use verifiedRoleEvidence, the unchanged packMixedAnswer and gpt-4.1-mini-2025-04-14. Preserve frozen candidate bytes. Repeat all six permutations A B C / A C B / B A C / B C A / C A B / C B A four times, giving eight occurrences at each position. No evaluator gold reaches models or rankers. Record actual raw ranking and deterministic compiler reconstruction; actual packed evidence is authoritative, with no raw-reference fallback.

Q3: Closed limits: 40 logical core calls per case, split into capture <=16 and each arm <=8, three answers per case (one each), 24 cases, and 1992 maximum HTTP attempts =24*(2*40+3). Reserve 5000 microUSD per request; local cap 10,000,000 microUSD ($9.96 worst case), protected 30,000,000, total ceiling 400,000,000. Keep local input 6000, provider input 7024, core output 1024, answer output 512, physical timeout 200,000ms and core logical timeout 30,000ms unchanged. Preserve the original two-arm 1968 profile. Manifest binds exact limits; arbitrary inputs cannot elevate them. Use only the existing original money/request ledger with immutable history/checkpoint checked before key lookup. Observe the existing request cap without resetting it.

Q4: Require a current reviewed one-shot manifest, clean committed runtime, exact Node executable hash/version, and complete artifact hashes including candidate and all live protocol paths. Write the exclusive durable marker before credential lookup. Preserve failed/unrun observations over denominator 24. Authentication, usage or accounting anomalies stop the entire run. Retain ordinary arm timeouts/failures without retry or alternate questions. Never resume closed runs. Old and new launch profiles reject each other. Secrets stay private; no hidden key discovery.

Q5: At most 72 independently blind answers, judged by two nonauthor judges with the same frozen requested-answer semantic rubric. Disagreement/missing judgments stay unresolved; unknown safety blocks advancement. Preserve per-case outcomes and denominator 24 per arm. C-A retains >=3 net correct and >0 packed-anchor gain; C-B has no net-correct or coverage regression. Require no safety block and affirmative resource acceptance. Claim positive incremental superiority over the old combined algorithm only for positive same-batch C-B QA after all advancement gates pass, never from historical 22/24 or offline 36. Unknown gates do not advance.

Prospective primary clarification before any paid results: preserve the existing B8 safety meaning. Candidate C must have no increased unsupported/stale question counts against both same-batch controls, no newly failing severe case against either control, and no unknown safety in any arm. Known preexisting positive harm in baseline/linked alone does not block advancement; no new requirement that all three arms be perfect. Accuracy remains C-A>=3 and C-B>=0. Preserve per-arm harm/claim counts.

Q6: Measure capture/candidate/selected/recalled/packed coverage from actual traces, independently replaying selection/rank compilers. Report C-A and C-B with 42-anchor denominators; coverage is not QA. Preserve failures and resource/latency breakdown by arm and capture, without inventing cost or calling recorded usage an invoice.

Q7: Offline tests exercise actual caller seams: 24 captures/72 answers/balanced order; same cold database and role evidence; new versus old compiler choice; grading/disagreement/unknown/harm in all three arms; 1992 arithmetic and fair capture/arm caps; invalid profile/manifest/dirty runtime/hashes; key-failure one-shot lifecycle; mutation/cross-profile/closed state/fatal-unrun denominator 24; no additional candidate model call. Fault injection uses only synthetic ledgers in owned fixtures with cleanup on success/failure; generic workspace errors are not masked.

Q8: Derive changed-file inventories independently by two routes and verify count agreement. Record actual test exit codes on pinned Node 22.16.0 and 24.15.0 for targeted and existing algorithm suites where possible. Primary owns final combined gates, dual review and CI before any paid run. Make no unmeasured claims. Record entrypoints/callers/test ownership, actual routing/base and precommit states in this plan. Inspect node_modules for symlinks before isolated locked installation.

## Entrypoints, gates and ownership

New explicit runner/transport/launch exports select a private closed profile;
old public treatment allowlists and two-arm profiles remain unchanged. Calls:
`launchComplementarySourceComparison` -> `createComplementarySourceTransport`
-> `runComplementarySourceComparison` -> real capture -> cold core recall ->
source-diverse selector for B/C -> linked or frozen complementary rank ->
verifiedRoleEvidence -> unchanged packMixedAnswer -> one answer per arm.
Candidate bytes and gold separation remain unchanged. Existing traces preserve
model calls, observed source reads, failures, latency, reservation and usage.

Evaluator calls: `loadComplementarySourceFreeze` ->
`scoreComplementarySourceCoverage` -> `buildBlindComplementarySourcePacket`
-> independent unblinding -> `aggregateComplementarySourceJudgments`.
Pure compilers replay effective selection/ranking against actual visible inputs;
authoritative role packing determines credit. Both pairs have 42 anchor counts.

Gate fields: `noFatal`, `primaryQA` (C-A>=3), `primaryPackedGain` (C-A>0),
`linkedQANoRegression` (C-B>=0), `linkedPackedNoRegression` (C-B>=0), `safety`
(all arms known; no C unsupported/stale question-count increase or newly severe
case against either control) and `resourcesWithinLimits` (caller audit true).
`advances` requires all fields true. `incrementalSuperiority` additionally
requires C-B net correct >0. Historical 18/24–22/24 and offline 36 are never inputs.

Launch binds clean committed runtime, exact Node executable/hash/version,
corpus/protocol, complete tracked runtime/control closure, existing checkpoint,
history and request cap. Exclusive durable marker precedes key lookup. Before
runner dispatch, failure writes all 24 failed/unrun observations when persistence
works. After dispatch, catastrophic persistence failure preserves actual partial
records and failure in closure; it never reruns the runner or invents unrun
observations. Closed operations never resume/refund. Missing report is a blocker.

Worker owns new complementary tests: actual core/HTTP/caps in
`test/complementary-runner.test.mjs`, freeze/coverage/blind/gates/manifest in
`test/complementary.test.mjs`. Parallel Git worker owns shared owned-Git helper
and existing requested/evidence bundle test migration. Primary owns combined
gates, mechanically cross-checked file inventory, final dual review and CI.
No browser/product flow, core, defaults, corpus, rubric, prompts, adapter,
campaign-budget or CI changes. No postimplementation commit before primary diff
inspection. Any final SHA and precommit test state must be recorded at acceptance.

## Offline verification

`adapters/openai/node_modules` was absent (not a shared symlink) before
`npm ci --offline --prefix adapters/openai`, exit 0. Locked files unchanged.
`scripts/README.md` absent in this fixed checkout; no operational script ran.
Pinned Nodes: `/home/chichieh/.nvm/versions/node/v22.16.0/bin/node` and
`/home/chichieh/.nvm/versions/node/v24.15.0/bin/node`.
The Git fixture dependency was integrated unchanged from
`33cba02777a85ed087451c991c4a315e7edceeb4` as
`df2c95c0b5eb4854f743d674ce810d7a356cf388`. Its five files and prior verification
remain owned by the Git worker, not new implementation results here.

Precommit targeted results: new runner first Node 22 invocation exited 0
(3/3, 88.37s), then the separately added real-core mutation test exited 0
(1/1, 2.29s). Node 24 ran all four runner tests and exited 0 (4/4, 82.42s).
New protocol/manifest suite initially exited 1 on Node 22 (4/5): a handcrafted
fixture aliased its raw/effective inputs, so mutating one changed both. The
fixture now matches separately serialized formal observations. Both complete
reruns exited 0 (5/5, Node 22 5.62s, Node 24 5.41s). Later transport-closure
hardening and testing-helper artifact binding require final revalidation.
The changed-file inventory was independently derived by Git diff plus untracked
listing and by filesystem Git-blob hashes plus a new-file walk, then compared:
17 files match (12 implementation packet, 5 unchanged dependency files).
Targeted/regression final results and primary acceptance pending. Offline gates
establish no new QA score, provider spend permission or product promotion.

## Interpretation limits fixed before results

The same 24 previously seen synthetic development cases include many rank
candidate pools of at most six. Their QA score cannot prove that the larger
pool rare lexical bridge strategy improved. Selection and ranking invoke the
model independently per arm: shared policy does not guarantee identical
selection or outputs. Same-batch results are point estimates, not robust proof
of semantic reliability. These limits add no advancement gate.
