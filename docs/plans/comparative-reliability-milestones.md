# Comparative reliability and lightweight product milestones

Status: proposed sequence; S1 is active but incomplete, and no S1–S5 milestone
has passed as a whole. See the execution snapshot and resume protocol below for
the state checked 2026-09-25; re-check live PR and CI state before resuming.
Goal: a lightweight, source-backed memory layer for Hermes and other agent
harnesses, evaluated against existing solutions under matched conditions.

## Acceptance for this plan

- P1: Preserve audited results, open-candidate status, cumulative spend authority
  and prior attempts; never retrofit criteria or claim new evidence.
- P2: Define observable pass/fail/stop criteria for repair, tracing, comparison,
  installed flows, growth measurements and onboarding.
- P3: Compare one runnable solution on the same frozen cases, cutoffs, answer/
  judge settings and resources; separate defaults from controlled configs.
- P4: Measure accuracy, completion, cost and deployment weight. The 95% pipeline
  completion gate is not a reliability target; no 100% semantic-QA target exists.
- P5: Keep source text, case IDs and private artifact paths out of public docs;
  this plan does not change production, private scope or the ledger.

## Baseline and authority

The [audited 30-case cohort](https://github.com/Cairn-ink/cairn-memory/blob/fcfd2b349ce20c6def46ed4815fa6de6b5404308/docs/evidence/reliability-cohort-30.md)
has five cases per question type: a small pilot, not the 500-case benchmark or a
competitor-parity result. As checked 2026-09-25, its documentation candidate
`fcfd2b3` (PR #202) and runtime candidate `ca9c15c` (PR #203) remain open and
unmerged; neither is shipped.

| Arm | Correct | Wrong | Unresolved | Complete | Correct among complete |
| --- | ---: | ---: | ---: | ---: | ---: |
| Cairn | 15 | 8 | 7 | 23/30 (76.7%) | 15/23 (65.2%) |
| Full history | 19 | 8 | 3 | 27/30 (90.0%) | 19/27 (70.4%) |

Cairn scored 15/30 (50.0%) on fixed N; on the 23 cases both arms resolved it was
correct on 15/23 (65.2%) versus full history's 16/23 (69.6%). Full history is a
reference, not a competing product. The old 70% target is no longer primary and
is not a threshold retrofitted to new systems.

The authorized API ceiling is US$200 cumulative; US$79.389500 is reserved,
leaving US$120.610500. Tentative DRI allocations: $15 fresh smoke, $75 paired
comparison, $20 targeted architecture, $10 installed workflow, $0.610500 buffer.
Before freezing a phase, the DRI may rebalance within remaining headroom and
reduce N/arms; freeze its cap before calls and honor that stop. The operational
ledger remains at US$100 until the authorized limit is separately reviewed and
enforced. This docs-only task makes no calls or ledger changes; verify the
frozen plan, ledger and guard before each phase. No reset/refund/retry of prior
failures; new authority is needed only above the ceiling or for new sensitive
data access. Replanning within the cap needs no further user approval.

Preserve wrapper failure, reservations, unknown prices/outcomes and case results;
do not rerun failures or replace them. Public reports may show redacted stage
labels and aggregates, never source/answer text, case IDs or private paths. If
retained evidence cannot support a cause, mark it unknown rather than infer it.

## Execution snapshot and resume protocol (checked 2026-09-25)

This is a dated handoff, not a milestone pass. The public PR state and head SHAs
were checked directly; all listed candidates were open and unmerged:

| Candidate | Head | State at check |
| --- | --- | --- |
| [PR #202](https://github.com/Cairn-ink/cairn-memory/pull/202) | `fcfd2b3` | Open; audited 30-case documentation. |
| [PR #203](https://github.com/Cairn-ink/cairn-memory/pull/203) | `ca9c15c` | Open; reliability runtime integration. |
| [PR #204](https://github.com/Cairn-ink/cairn-memory/pull/204) | `7c7e8b3` | Open; extraction source-domain bound. |
| [PR #205](https://github.com/Cairn-ink/cairn-memory/pull/205) | `285e7ff` | Open; this plan. |
| [PR #206](https://github.com/Cairn-ink/cairn-memory/pull/206) | `aaa44da` | Open; classification batch cardinality. |
| [PR #207](https://github.com/Cairn-ink/cairn-memory/pull/207) | `038f0ac` | Open; synthetic evidence lineage coverage. |

At PR #207's recorded head, seven fixed scripted capture-to-recall cases reach
actual public evidence packing. Generic checks passed 112/112 and LongMemEval
checks 75/75 on each of Node 22.16 and 24.15; CI run `36035308315` passed 17/17.
The implementation worker and both independent Standards/Spec reviewers were
GPT-6 Sol/high; both reviews passed with zero findings. These checks cover
scripted pipeline mechanics, not live semantic quality. The source/ref and
classification guards are candidate changes, not proof of a reliability fix.

| Milestone | Current state and evidence | Next acceptance work |
| --- | --- | --- |
| S1 — bounded recovery | Active, incomplete. Candidate runtime stack #203/#204/#206/#207 remains open; partial-classification recovery and timeout handling are not complete. No S1 pass is claimed. | Finish observable, repeat-safe recovery from retained evidence; verify incomplete receipts, corrected/deleted content, namespace/privacy and no resurrection. |
| S2 — tracing and navigation | Active, incomplete. The eight historical wrong outcomes remain fixed-N and read-only; finer fact-stage causes are unknown. A synthetic 1,025-memory direct-admission control misses the unique target at the max sorted ID; removing one lower-ID row makes it visible and returned at 1,024. Root reproduced the red-base miss against public `core.recall` in 0.76 seconds with an expected failing assertion. This shows a capacity-boundary effect only; it does not explain a historical wrong answer or establish a fix. | Offline packet assigned to GPT-6 Sol/high on branch `experiment/candidate-retrieval-ablation`, based on PR #207 head `038f0acbe2ac281d1fd599a1199aa921782ca5e5`. No candidate SHA or PR number is recorded yet. Freeze fixtures before output runs. The active experiment and separate later answer-stage gate are defined under S2 below. |
| S3 — matched comparator | Pending; no fresh matched Mem0 OSS score exists. | Preflight and pin the actual engine, dependencies and model configuration; reconcile harness filters and denominators; freeze a new holdout before any scoring. |
| S4 — installed path and growth | Pending; installed Hermes/MCP cold-restart and 100/1,000/10,000-memory growth gates remain. | Freeze host/runtime/resources/repeats, then complete each required synthetic workflow and measurement while retaining failures and cap breaches. |
| S5 — preview and onboarding | Pending; no cold-context onboarding pass is recorded. | Run the documented clean-environment flow through sourced write, new-session recall, inspect, correct, forget and restart/no-result; record receipt-backed pass/fail at every step. |

No new semantic score or paid request is recorded in this status update. At the
last recorded checkpoint (not re-read for this documentation update), the
cumulative API ceiling was US$200, with US$79.389500 reserved and US$120.610500
headroom; the operational ledger was US$100 pending separate review and
enforcement. Check the actual ledger and request guard before any paid phase.
Preserve the cap, freeze each phase's request/cost limit, and never reset/refund
or automatically relaunch a consumed run. No prior 30-case failure may be
rerun or tuned on. Scoped offline synthetic work within this authority needs no
redundant approval; request user direction before exceeding the cumulative
ceiling, accessing new sensitive data, or changing production scope.

On resumption after compaction:

1. Re-read this plan, the relevant milestone specification, `CONTEXT.md`,
   `CONTRIBUTING.md` and `docs/limitations.md`; treat their definitions and
   safety gates as binding.
2. Inspect the real worktree list, branch, dirty state and merge base. Then check
   each active PR's current head, state and CI against that head. This snapshot
   is not a substitute for live state and must not be assumed current.
3. Resume the active authorized packet, or its next independent unblocked task.
   Independent offline diagnostics and research may proceed while S1 is open;
   this does not pass S1 or waive any dependency for product promotion, a live
   benchmark, host readiness or preview. Record the packet's exact base/candidate
   SHA, owner and actual model/effort when available, allowed files, frozen
   inputs, next command, pass/fail criteria, unknowns and blocker. Never infer
   missing ownership or relaunch a run that may already have spent its budget.
   Update this existing plan after every gate before proceeding.
4. Keep all historical cohort outcomes fixed. Before any paid request, verify
   the real ledger, guard, credentials and remaining authority; stop at the
   frozen cap or any accounting anomaly. Retain failures, unknowns and not-run
   cases, and do not turn pipeline completion into an accuracy claim.

## Milestones

### S1 — Repair completion and bounded recovery

Repair existing ingestion before adding retrieval machinery:

- Extraction emits only refs resolving to supplied canonical evidence; invalid
  or missing refs remain visible failures, not trusted claims.
- Partial classification preserves already admitted valid items/evidence and
  records incomplete work. Recovery is explicit, bounded to retained evidence,
  repeat-safe and cannot reconstruct deleted history or undo correction/deletion.
- Test invalid refs, partial classification, repeat recovery, stale evidence and
  corrected/deleted records in synthetic stores. All finite negative deletion
  and privacy cases must pass; semantic quality is measured separately.

Pass when state and receipts are observable, partial work stays marked, and
recovery never resurrects suppressed content. Stop on unexpected partial
mutation, false completion, namespace leak or deletion resurrection; model
scores cannot waive these invariants.

### S2 — Trace the eight wrong answers and ablate MOC navigation

Trace the eight wrong Cairn answers through extraction, admission, classification,
MOC filing, visibility, selection, fetch, evidence packing, answering and judging.
Attribute causes only from recorded evidence; unknown is valid. Do not publish
source data or rerun cases.

First reproduce the synthetic 1,025-memory capacity-boundary miss against the
actual `core.recall` path; the 1,024-memory control should expose the target.
This is a retrieval diagnostic, not an explanation for any of the eight
historical wrong answers and not a claim that runtime behavior is fixed. The
active offline packet compares actual `core.recall` with flat FTS5/BM25 and
MOC-first navigation with bounded shared fallback on a frozen synthetic
corpus/query set. Run alias expansion off/on for the flat and MOC paths, with
matched source information and top-K; account for index/build and query work.
Include exact lexical, paraphrase, CJK, wrong-branch, unfiled, unknown and
multi-source controls. Every path must preserve bounded retrieval, namespace,
current/history and forget behavior. Record candidate visibility/materialization,
selected IDs/counts and resource use; hide target IDs/answer labels. This
preflight does not measure public evidence packing and is offline retrieval
evidence, not a QA score or product runtime fix claim.

The preflight does not replace the later end-to-end S2 answer-stage gate. After
S1's repair and safety conditions pass and the candidate path is frozen, use a
shared answer model, judge/scorer, prompt, cutoff and final context cap on a
frozen development set and then a fresh held-out roster. Report visible-to-
packed stages, candidate work, fixed-N correct/wrong/unresolved outcomes,
source-span fidelity and abstention; preserve every failure and unresolved
case. Freeze thresholds and resource limits before scored calls, and do not
tune on the revealed holdout. A candidate-path diagnostic or oracle ceiling is
not a product score. Promotion still requires improvement at equal resource
budget without safety regression.

Trace completion means eight supported records or explicit unknowns, not progress.
Promote an ablated path only if a frozen development check improves at equal
resource budget without safety regression. Keep fixed N and all stage outcomes;
an oracle diagnostic is not a product score.

### S3 — Fresh matched comparison against one existing solution

Freeze a new held-out roster before scoring; run Cairn and one comparator on the
same cases, ordered histories, timestamps and question cutoffs. Keep the old
30-case cohort out of tuning and never rerun it as holdout. Tune on development
cases; hold out this roster until configs are frozen.

Mem0 OSS is prospective, pending a synthetic preflight of its actual engine
version, dependencies and model config. Its
[benchmark harness at `4b61c5d`](https://github.com/mem0ai/memory-benchmarks/tree/4b61c5d31b9c668a12b4f5e78064248a02c82d2b)
and [Supermemory harness at `94e2af5`](https://github.com/supermemoryai/memorybench/tree/94e2af54b661d90e77dddbd8fa4fa5b28c07a24e)
pin harnesses, not engines or comparative results. Reconcile harness filters
and denominators before citing any score. If Mem0 cannot run fairly, select one
replacement from its official source before freezing; never choose after scoring.

Report two views separately where supported:

1. **Framework defaults:** documented defaults, versions and deviations; this
   estimates the install experience.
2. **Controlled:** shared generation/judge models, prompt/scorer, history cutoff,
   output/context budgets and supported embeddings/reranking. Record unsupported
   settings; never merge this view with defaults.

For each arm, report indexing/ingestion, extraction, embeddings, query/reranking,
answering and judging separately, including requests, usage, known/unknown cost,
storage and latency. Amortize indexing into per-case cost. Freeze scorer/order;
blind labels where practical. Use independent stores and balanced randomized
order so one arm's timeout or ingestion failure cannot block another; only a
global budget/accounting halt may stop remaining arms. Retain all not-run arms
and failures in fixed N.

Report paired outcomes and fixed-N correct/wrong/unresolved rates, Wilson
intervals per arm and a predeclared paired interval for the difference. Keep
completion separate from accuracy among completed cases. Internal run gate:
at least 95% of paired cases scoreable in every arm (29/30 for N=30). A judged
abstention is complete and may be correct or wrong; ingestion failures, deadlines
and missing judge results remain unresolved/incomplete in fixed N. Completion is
not semantic accuracy.

Decision objective: match or beat accuracy at lower total API cost and local
resource burden. Before scoring, freeze a decision-specific noninferiority
margin, meaningful-gain criterion and resource budgets; these are product inputs,
not universal standards. Claim parity only if the paired interval rules out loss
beyond the margin and budgets are met; claim accuracy gain only if the interval
supports it.
Otherwise report a trade-off/inconclusive result. If uncertainty is wide, use a
new holdout within the cap or limit the preview without a parity claim. Never tune
on holdout or infer parity from point estimates.

### S4 — Installed Hermes/MCP path and local growth profile

After S1–S3 review, verify an installed artifact in a cold Hermes/MCP session
with a configured test profile and synthetic records: recorded decision,
unadopted proposal, current/history questions, correction, deletion, restart and
real-model sourced recall within the frozen cap. Check receipts, qualifiers,
correction/deletion persistence and separate host permission from memory.

Before measuring, freeze Node version, hardware, configuration, explicit resource
and model-input/candidate ceilings, and repeat count for each size. At 100, 1,000
and 10,000 synthetic memories, complete every frozen repeat of cold start, write,
recall, correct and delete; record database size, operation latencies, candidate/
receipt counts and model/embedding calls. Growth curves are local measures, not
provider speed or user reliability. Pass only if all sizes/repeats complete, all
metrics are recorded, model-input/candidate caps stay bounded and privacy/deletion
checks pass. Retain any failed run, missing metric or cap breach; block scale
claims and host expansion until corrected and rerun within the frozen design.

The DRI freezes each real-model phase and verifies guard/credentials before use.
Never rerun cohort failures; this plan adds no budget to the US$200 authority.

### S5 — Professional developer preview, onboarding and PLG

Pass when a cold-context tester follows the docs only from a clean environment
and synthetic profile through install, first sourced write, new-session recall,
inspect, correct, forget and restart/no-result. Record a receipt-backed expected
state and pass/fail at every step. Docs and installed behavior must agree; no
undocumented manual repair is allowed. Any failed step or unsupported claim blocks
launch/promotion until fixed and reverified.

The [14-day adoption plan](local-memory-plg.md) is optional PLG learning after
approval/release, not a preview or 10-user prerequisite. Keep feedback voluntary
and content-free; no hidden telemetry, raw uploads or unapproved outreach.
Activation/useful recall are learning signals, not guarantees. Private/commercial
use of a pinned public core remains separate.

## Lightweight design inputs and limits

These sources guide experiments; none transfers a benchmark result to Cairn.

| Source | Bounded design input | Limit for this plan |
| --- | --- | --- |
| [StateMem (2026)](https://arxiv.org/abs/2608.19652) | Track superseded, current and needs-recheck outcomes; use oracle evidence only to diagnose candidate visibility. | Its 234 synthetic scenarios and stated generality limits are not a production score or a competing product arm. |
| [RD-Forget (2026)](https://arxiv.org/abs/2609.10263) | Keep retained history distinct from query-conditioned use; compare current/history read eligibility with extraction fixed. | Does not establish an agent-memory advantage or justify dropping retained source evidence. |
| [TiMem (2026)](https://arxiv.org/abs/2601.02845) | Test hierarchical temporal consolidation as one candidate design. | Extra write calls and context can confound retrieval gains; compare matched retrieval and total write/query cost. |
| [SQLite FTS5](https://www.sqlite.org/fts5.html) | Provides an embedded lexical baseline without a separate search service. | Owner-reported in-memory create/insert/query checks passed on Node 22.16 and 24.15; capability only, not retrieval quality. |

Avoid adding an external database to the default path unless measured residual
misses justify it. Test the current MOC design against a strong flat lexical
fallback first. Add typed links or local vector search only as later ablations
with separately reported write cost, query cost, index size and failure cases.

## Research appendix — 2026-09-25

These are design inputs for S2 and later scoped work, not evidence that Cairn
has gained a capability or that a biological memory mechanism runs in software.
The two proposed experiments below require a separately frozen synthetic
development set and a fresh held-out set. The earlier 30 paid cases are available
only for read-only stage tracing; never rerun, tune on, or relabel them.

### MemPalace: implementation and measurement boundary

At inspected commit
[`c4d3711`](https://github.com/MemPalace/mempalace/tree/c4d3711ee2478bb4062085fa075597af897d3a6d),
the official [README](https://github.com/MemPalace/mempalace/blob/c4d3711ee2478bb4062085fa075597af897d3a6d/README.md)
describes verbatim storage, wings/rooms/drawers, and an embedded ChromaDB
default; its [license](https://github.com/MemPalace/mempalace/blob/c4d3711ee2478bb4062085fa075597af897d3a6d/LICENSE)
is MIT. Its separate [palace graph](https://github.com/MemPalace/mempalace/blob/c4d3711ee2478bb4062085fa075597af897d3a6d/mempalace/palace_graph.py)
builds navigation from room/wing/hall metadata. The published LongMemEval raw
[runner](https://github.com/MemPalace/mempalace/blob/c4d3711ee2478bb4062085fa075597af897d3a6d/benchmarks/longmemeval_bench.py)
instead concatenates user turns into one document per session and directly
queries ChromaDB. Its reported raw score therefore does not isolate the effect
of palace navigation, nor does that benchmark path retain assistant turns.

The [MemPalace benchmark record](https://github.com/MemPalace/mempalace/blob/c4d3711ee2478bb4062085fa075597af897d3a6d/benchmarks/BENCHMARKS.md)
reports 96.6% raw `R@5`, 89.4% room-mode `R@5`, and lower LoCoMo recall when
index-time and query-time room routing disagree. These are project-reported
results, not Cairn comparisons. The [runner](https://github.com/MemPalace/mempalace/blob/c4d3711ee2478bb4062085fa075597af897d3a6d/benchmarks/longmemeval_bench.py)
prints session `recall_any@5`: any one labeled evidence session in the top five
counts, with no generated answer. The LongMemEval authors' [retrieval scorer](https://github.com/xiaowu0162/LongMemEval/blob/main/src/evaluation/print_retrieval_metrics.py)
prints `recall_all@5` and excludes abstention questions; their [metric code](https://github.com/xiaowu0162/LongMemEval/blob/main/src/retrieval/eval_utils.py)
defines both, and their [README](https://github.com/xiaowu0162/LongMemEval)
separates retrieval from judged answer accuracy. No self-reported MemPalace
retrieval score is a comparable end-to-end QA or product-reliability score.
No third-party rescore is adopted here without independent reproduction.

### Bounded analogies and library practice

The [hippocampal indexing theory](https://pubmed.ncbi.nlm.nih.gov/17696170/)
(Teyler and Rudy, 2007) suggests a cue can retrieve features of an episode.
[Human imaging](https://pmc.ncbi.nlm.nih.gov/articles/PMC2829853/) (Bakker et al.,
2008) found activity consistent with distinguishing similar experiences in
CA3/dentate gyrus; [rat recordings](https://pmc.ncbi.nlm.nih.gov/articles/PMC3904133/)
(Neunuebel and Knierim, 2014) support dentate-gyrus separation and CA3
completion from degraded cues. These motivate testing alias disambiguation,
cross-links, and partial-cue recall. They do not establish that MOC routing,
automatic consolidation, or replay improves Cairn.

Library organization gives implementable distinctions: [MARC authority 4XX](https://www.loc.gov/marc/authority/ad4xx.html)
records variant headings and [5XX](https://www.loc.gov/marc/authority/ad5xx.html)
records see-also headings; [SKOS](https://www.w3.org/TR/skos-primer/) distinguishes
preferred/alternate labels from broader, narrower and related concepts;
[FAST](https://www.oclc.org/en/fast.html) demonstrates facets usable together
or independently. [BIBFRAME](https://www.loc.gov/bibframe/faqs/) distinguishes
conceptual works from instances, while [PROV-O](https://www.w3.org/TR/prov-o/)
defines source, derivation and revision links. These suggest stable concept
identities, typed relationships and pointers to original evidence spans. Such
metadata must remain verifiable against source text and respect correction,
deletion, namespace, current/history and unadopted-proposal eligibility.

### Two near-term experiments, subject to existing S1–S3 gates

1. **Navigation and aliases.** For the later full S2 evaluation, beyond the
   current candidate-only preflight, on newly frozen synthetic development cases,
   keep actual `core.recall` as a baseline, then compare a full-corpus flat
   FTS5/BM25 candidate path and MOC-first navigation in a 2-by-2 design with
   alias expansion off/on in each navigation path. Give the navigation paths
   identical source information, alias vocabulary, top-K and final context cap.
   Charge index/build, candidate scans, ranking calls, tokens, storage and
   latency to each path; charge MOC routing and cross-branch fallback to the MOC
   path. Include exact name, paraphrase, CJK, ambiguous alias, wrong-branch,
   unfiled, unknown and multi-source controls. Record evidence visible, selected
   and packed; `recall_any` and `recall_all` at the same K; candidate work,
   source-span fidelity and safety behavior. Freeze fixtures and resource
   ceilings before inspecting output runs. An ablation that stops at candidate
   retrieval is offline diagnostic evidence, not a semantic QA or product
   reliability result. A later scored answer comparison still requires its own
   frozen model/scorer, pass/stop rules and fresh held-out roster without oracle
   labels in model input. Reject a navigation gain that comes from extra work
   or loses required evidence through routing. No external vector DB is needed.
2. **Typed decision/version relations.** In a separate small synthetic set,
   compare a relation path using existing explicit supersession and source-bound,
   model-proposed `supports-decision` links against flat notes containing the
   same decision, version and support information in words, with the same source
   pointers. Proposals stay labeled unverified, not authoritative. Ask current
   and historical questions with dated changes, wrong scope, conflicting sources,
   corrected/deleted evidence and unadopted proposals. Keep answer/judge,
   source eligibility, context and candidate budgets matched; account for
   relation-creation cost and errors. Hand-checked links may set a diagnostic
   ceiling only; the scored product path creates its own relations without
   oracle edge annotations in held-out model inputs.
   Before each scored development or held-out run, freeze both arms' rosters,
   relation-generation model/version, prompt, acceptance rules and configuration,
   the flat retrieval configuration, metrics, thresholds and resource ceilings.
   Development revisions may inform a later fresh holdout; never tune on a
   revealed holdout.
   Score correct version, supported citation, false merges, stale or out-of-scope
   answers, abstention, completion and total cost. Promote only if source
   fidelity and safety gates hold and the prespecified paired decision rule
   supports a benefit.

Replay or autonomous maintenance is deferred; neither experiment authorizes
new write autonomy, provider calls, a production path or a budget increase.

## Stop rules and handoff

- Preserve negative safety cases; all finite deletion, namespace and permission
  checks must pass before expanding a host path. This is not a 100% semantic-QA
  goal.
- Keep failed and unresolved outcomes in the denominator. Do not tune on a
  revealed holdout, replace cases, reset the ledger or retry an old failure.
- Stop a comparison at its reviewed request/cost cap, any accounting anomaly,
  missing credentials/configuration, or a result whose scorer/data cutoff
  differs across arms. Report the stop as incomplete.
- Advance one milestone at a time after its recorded pass conditions. Record
  actual implementation owner/model/effort when available; never infer effort
  from a model label. Root owns candidate acceptance and two independent
  Standards/Spec reviews. No plan assumes all stages finish in one delivery or
  authorizes production deployment.
