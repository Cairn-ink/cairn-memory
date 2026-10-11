# Six-case larger-pool ranking experiment

Status: prospective, offline implementation only. No new score or paid launch.
Owner: primary DRI. Fixed dependency base:
`afa68cb47ead699725aef6878194b6d4fe6f8236` (reviewed PR #393, not merged).
Worktree: `cairn-memory-worktrees/large-pool-six`; branch:
`experiment/large-pool-six`. Preserve the separate closed 24-case and 16-answer
operations. This packet is not permission to rerun either one.

## Goal and reason for this next step

The product goal remains a lightweight, source-backed, reliable memory layer
for Hermes and other harnesses, sharing one public engine. Current short-term
work tests algorithmic answer quality; completion, source coverage, answer
correctness, reliability and installed-host use remain different measurements.

The [closed three-arm development comparison](complementary-qa24-results.md)
reported ordinary 19/24, linked 23/24 and complementary 23/24. All complementary
rank pools had at most five candidates. Its larger-pool lexical branch was
not exercised. It also produced the known severe D12 entity-binding error;
Stage 3 and promotion remain blocked. More delivered source anchors alone did
not improve linked-versus-complementary answers.

A separately closed answer-only presentation diagnostic compared nested and
flat source text in 16 prospective answers on two authored renamed analogues.
Both fresh independent judges agreed: each format had four known-correct and
four unknown-abstaining answers, with no wrong joins or unresolved judgments.
This did not reproduce D12 and provides no evidence to adopt the flat format.
It is not a causal diagnosis, repair, independent holdout or retrieval score.
The original evidence and first judgments are immutable; exact result identity
and accounting will be recorded in the delivery evidence, not used to tune
this prospective corpus after paid execution.

## Acceptance contract fixed before implementation

- L1 — Closed new source profile: exactly L01–L06, each six short sessions of
  three messages in user/assistant/user order, at most
  4,000 Unicode source characters per case. Sessions use explicit UTC event
  times. Every source plan must produce exactly six normal indexed-evidence
  capture batches before any paid launch. Source-only input and evaluator gold
  are separate files; reject evaluator metadata in model-facing input. Four
  requested known answers and two uncertainty/scope controls prevent an
  always-abstain shortcut. All six cases are fresh authored development, not
  an independent holdout or official benchmark.
- L2 — Natural ingestion: use the real public core, indexed-source capture,
  normal model extraction/classification and bounded-keyset navigation. Never
  manually admit cards, place MOCs, add evaluator anchors to model prompts,
  force an extraction/selection count, supplement capture or widen caps after
  seeing results. Close and reopen one unchanged captured database per case.
  The theoretical maximum of 30 admissions is not an observed card count or
  a test of archives larger than 36 cards.
- L3 — Coupled rank comparison: B uses the unchanged source-diverse selector
  plus source-linked rank compiler. C uses the same selector plus the frozen
  complementary compiler. Alternate B-first/C-first (three each). The first
  arm makes the natural select/rank calls. The second replays only their raw,
  detached immutable replies in strict order, requiring identical method,
  system, input and maxOutputTokens. Never replay compiled refs. Both arms
  run the real reopened core, wrappers, authoritative get/finalization,
  recorded-role evidence verifier and unchanged answer packer; each answer
  is independently generated once. Label every raw call natural-model or
  replay. Missing, extra or unequal replay calls invalidate the paired
  comparison; no fallback to another paid model call. This is a coupled rank
  intervention, not two independent end-to-end retrieval runs.
- L4 — Unchanged algorithm: no candidate/selector/core/prompt/model/default
  modifications. Same six-unit recall and source-role answer representation,
  pinned `gpt-4.1-mini-2025-04-14`, existing 6,000 local input / 7,024 provider
  input bounds, 1,024 core output and 512 answer output. No external database,
  embedding call, extra semantic verifier or persistent archive extension.
- L5 — Reuse existing execution/accounting: add a closed opt-in six-case
  profile to the existing comparison loop, transport, launch and evaluator;
  do not fork a paid runner or ledger engine. Per case at most 12 capture
  logical calls, eight natural recall calls, zero paid replay recall calls,
  and two answers. Maximum 252 HTTP attempts and USD 1.26 reserved at 5,000
  microUSD/request; local reservation ceiling USD 2. Original cumulative
  USD 400 ledger, USD 30 protection, no refund/reset/retry/resume. First-arm
  recall failure makes its replay unavailable; all six/twelve slots remain.
  Ordinary case failure is isolated under existing policy; accounting,
  authentication, persistence, captured-state or paired-trace integrity
  anomalies stop the operation. Conservative preparation binds exact corpus,
  rubric/protocol, runtime, Node, original checkpoint/history and output
  identity; durable exclusive start precedes explicit key lookup and recheck.
- L6 — Measure the actual seam: per case retain admitted cards, visible and
  selected refs, rank-input candidate count, original rank refs, compiler
  reason/paths/additions/displacements, verified recalled/packed sources and
  answer. Eligible larger-pool case requires actual rank input >6 candidates,
  one to five original refs at limit six and the complementary compiler's
  `lexical_bridges` reason. Added refs may be zero; that remains a valid
  observation. A large archive alone is not eligibility. Count every case,
  including ineligible/unresolved; do not replace or selectively score cases.
- L7 — Evaluation: requested-answer correctness uses full original histories;
  factual support uses the actual packed evidence, and stale/severe judgments
  use the prospectively authored scope/uncertainty rubric. Two fresh nonauthor
  blind reviewers give first judgments; disagreement/missing stays unresolved.
  Report fixed six-case QA counts, pair wins/losses/unresolved, harm counts,
  origin-bound literal anchor coverage by stage, eligible-case count, natural
  versus replay calls, tokens, elapsed time and retained SQLite size. Literal
  coverage is not semantic support. Do not pool with old 24/16 or official data.
- L8 — Decision fixed before paid answers: any eligible case permits only the
  statement that this lexical branch was live-exercised. Support for another
  development study additionally requires at least four eligible cases,
  positive C-minus-B correct count, positive packed-anchor gain traceable to
  lexical additions, fully resolved correctness/safety, no increased unsupported
  or stale-answer counts and no newly failing severe case, plus all replay and
  resource checks. Report every QA loss even with a positive net. Otherwise
  record reject/inconclusive/precondition unmet; do not tune and rerun this
  cohort. Even a pass is not product promotion, Stage 3, Mem0 parity or a repair
  of the older D12 failure. No 100% answer-accuracy requirement is introduced.
- L9 — Offline acceptance: real-core synthetic-HTTP tests prove six captures,
  twelve answer slots, exact shared raw trace and different compiler outputs
  on a >6 pool, with explicit replay-mismatch/extra/missing/first-arm-failure,
  known-answer and always-abstain negative controls. Verify all hard caps,
  failure denominators, foreign-source rejection, source-only loader/import
  boundary, immutable source pre-key snapshot and one-shot failures. Preserve
  old D01–D24 fixture/rubric hashes, entrypoint contracts, limits and behavior.
  Use owned temporary workspaces; success, assertion/setup failure and normal
  cancellation leave no unexpected residue. Retain formal artifacts, never
  clean history. Run affected and existing algorithm regression suites plus
  contributor gates on Node 22.16 and 24.15, reporting actual exit codes.
- L10 — Delivery: bounded GPT-6.1 Sol/high implementation and independent corpus
  author, primary diff inspection/key verification and independent nonauthor
  Standards/Spec reviews at one exact candidate. Verify changed-file inventory
  by two independent routes and count it. A dependent PR may target #393's
  branch; no merge/release/deploy. Paid execution comes only after exact-head
  offline evidence, independent review, CI and a frozen affordable manifest.

## Ownership and scope

Primary owns this contract, integration, acceptance, live preflight/operation
and final decision. The corpus author owns only new `large-pool-cases.json`,
`large-pool-rubric.json` and a fixture evidence note in an isolated worktree,
without reading the candidate's lexical implementation. Runtime owner adds
the closed profile to existing evaluation modules and targeted tests, keeping
all old profiles closed. No core, adapter, campaign-ledger implementation,
dependency/lock, CI, production or private-product changes are in scope.

Required corpus families: three-source handoff, dated location update,
decision-premise reconfirmation, CJK/paraphrase retrieval, missing entity
binding, and lexical/scope collision. The first four request known information;
the last two require supported uncertainty, not an invented identity/decision.
Use realistic short conversations and distractors, not desired output syntax
or instructions to memorize particular spans. Cases and gold freeze before
any paid output. If a boundary requires a material design change, return to
primary before implementing it.

## Verification and execution record

Pending. This prospective contract establishes no passing test, paid result,
new model bill, quality acceptance or installation claim.

### Implementation and caller evidence

Runtime implementer: actual GPT-6.1 Sol/high, under the primary's bounded
L1–L10 assignment. Fixed dependency base remains `afa68cb47ead699725aef6878194b6d4fe6f8236`.
The independent four-file corpus packet was integrated by primary as
`e773abfeae3e65e291da170a96a0f70d63d35638`; the runtime packet remained uncommitted
while primary inspected the actual combined changes. No candidate, core, old
corpus/rubric, adapter, prompt, lockfile, defaults, CI or ledger-engine change.
Dependencies were installed separately by primary with locked offline installs;
this worker made no install, key lookup, provider call or operational-ledger access.

Entrypoints: `prepareLargePoolComparison({ configuration, outputDirectory })`
requires a fresh owned real directory at mode 0700 and binds its filesystem
identity; `launchLargePoolComparison` rechecks it and the existing checkpoint
before and after explicit key lookup. Shared runner/transport launch wrappers
select only the closed new profile, preserving old entrypoint contracts.
`runLargePoolComparison` uses real capture, reopened core, selectors/compilers,
authoritative source reads, role evidence and unchanged packing. Only the
first arm delegates recall to the guarded transport; replay requires ordered
byte-equal request envelopes and immutable natural raw outputs. Actual core
error wrapping preserves pairing anomalies as fatal retained outcomes.

Evaluator entrypoints: `loadLargePoolFreeze` validates separate gold;
`scoreLargePoolCoverage` reconstructs source-bound effective traces and packing;
`buildBlindLargePoolPacket` clones only the new-profile packet before separating
calibration; `aggregateLargePoolJudgments` recomputes pairing and eligibility
from raw traces. Recorded booleans earn no eligibility credit. Lexical packed
gain counts only B-absent/C-present anchors attributable to recomputed added
refs. Empty selection, empty admission and zero additions stay valid ineligible
or eligible observations as appropriate. Cost summaries explicitly describe
paired execution, natural versus replay calls and profile estimates, not
standalone C cost, latency or an invoice. There is no browser/product-flow change.

Owned test controls cover strict replay changed/extra/underconsumed/cancelled
calls, real-core wrapped mismatch with no fallback and all six/twelve slots,
capture/natural quotas and fresh unspent denial of paid replay, larger pools
with/without additions, saturated seeds, empty selection/admission, first recall
failure versus first answer failure, auth fatal retention, foreign-source
rejection, blind/unblind immutable calibration, losses/no perfect-accuracy gate,
always-abstain/disagreement/harm negatives, source-only import/loading, distinct
launch identity, manifest/output identity mutation, key failure and source
mutation after key lookup with unchanged synthetic ledger and pre-key snapshot.
All fixtures use owned test workspaces and fake HTTP. These are orchestration
controls, never measured natural QA results.

### Separate closed answer-format probe identity

Primary supplied this source-free close record for the prior independent
diagnostic: closed `2026-10-11T08:21:09.165Z`, 16/16 answers. Both nested/flat
formats had four expected known and four expected unknown outcomes; two fresh
nonauthor first blind judges agreed on all 16. No wrong join, other or unresolved
category; no format advantage, D12 reproduction or fix. There were 16 HTTP,
4,648 input / 253 output tokens, $0.08 reservation and a $0.002275 known
model-profile estimate, not an invoice. Its 67 observations were cross-checked
by two inventory routes and independently audited by primary. No private answers
or blind labels were read or copied into this packet.

- Manifest SHA256: `cd9fbe189bd62e72c1737a0d39bd3020fc2797b8167379770c359bd64d6aef4f`
- Report SHA256: `655f2b9e8f49fd4124175b3ca696425bcfe48bf949a1f5e86367483252661f16`
- Categories SHA256: `8d0ea4176044cd47e62f6e9e64588ae3a7fb059cd4fc280c5501f0ba8e14da1b`
- Audit SHA256: `b26090fa89509915418f280eefd6eef16cdbdc21982b8bbe2f99c49bcb4ce598`

The historical ledger close does not establish present affordability or a new
grant. Old runs, first judgments and failure gates remain unchanged.

### Worker precommit verification

At integrated corpus HEAD `e773abfeae3e65e291da170a96a0f70d63d35638`, with
the 14-file runtime packet still uncommitted, both complete new suites passed:

```sh
/home/chichieh/.nvm/versions/node/v22.16.0/bin/node tools/testing/run.mjs evaluation/algorithm-development/test/large-pool*.test.mjs
/home/chichieh/.nvm/versions/node/v24.15.0/bin/node tools/testing/run.mjs evaluation/algorithm-development/test/large-pool*.test.mjs
```

Actual exits **0 / 0**, 19/19 each, fail/skip/cancel/todo zero; durations
110.532s / 110.826s. Nine independent corpus controls, seven runner controls
and three source/preflight/launch controls ran. No runtime/test code changed
after those gates; only the evidence record and README caller note were appended.
Earlier WIP Node 22 runner controls exited 0 (5/5), Node 24 exited 0 (6/6), and
the later Node 22 real-core mismatch/fresh-denial focused controls exited 0 (2/2).
Those earlier checks do not substitute for the complete new-suite results.

The existing three affected runner regression files also passed on Node 22:

```sh
/home/chichieh/.nvm/versions/node/v22.16.0/bin/node tools/testing/run.mjs evaluation/algorithm-development/test/complementary-runner.test.mjs evaluation/algorithm-development/test/requested-answer-runner.test.mjs evaluation/algorithm-development/test/evidence-bundle-runner.test.mjs
```

Actual exit **0**, 25/25, fail/skip/cancel/todo zero, 268.312s. This run began
during WIP and is regression evidence, not final committed-head acceptance.
Primary owns the fresh full algorithm/contributor matrix on both runtimes,
fixed-candidate independent Standards/Spec review and CI before any paid action.

`git diff --check` and syntax checks exited 0. The protected old-file diff
(core, frozen candidate, old sources/rubrics and adapter lock) was empty.
Inventories were independently derived by (1) Git diff plus untracked paths and
(2) fixed-base Git tree/blob hashes plus a filesystem walk, then compared:
**18 files** agree against `afa68cb47ead699725aef6878194b6d4fe6f8236`:
four separately committed corpus files plus 14 runtime/delivery files.
An earlier HEAD-based cross-check independently matched all 14 runtime files.
Primary inspected the actual runtime/evaluator/caller/test diff before granting
the scoped runtime delivery commit. No push, provider call, live preparation,
production action or old-run mutation occurred.
