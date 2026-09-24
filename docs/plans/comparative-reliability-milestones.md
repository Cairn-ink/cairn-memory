# Comparative reliability and lightweight product milestones

Status: proposed sequence; the finite S1 mechanical repair/recovery gate is
accepted on the current candidate. Semantic reliability and the S2–S5 product
milestones remain open; the S1–S5 sequence has not passed as a whole. See the
latest checkpoint and resume protocol below; older execution snapshots are
explicitly historical. Re-check live PR and CI state before resuming.
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
competitor-parity result. At the earlier check on 2026-09-25, the documentation
candidate `fcfd2b3` (PR #202) and runtime candidate `ca9c15c` (PR #203) remained
open and unmerged; neither is shipped.

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

## Latest checkpoint — 2026-09-25 (after PR #216)

This checkpoint supersedes the execution status of older snapshots below; their
recorded heads, results and failures remain historical evidence. The following
candidate PRs are ready, open and unmerged. PR #216's exact-head CI was
confirmed at this checkpoint; the #213–#215 runs are earlier recorded results,
not newly rerun checks.

| PR | Candidate head | Recorded exact-head CI |
| --- | --- | --- |
| [#213](https://github.com/Cairn-ink/cairn-memory/pull/213) | `709c8f0` | Run `36061875638`, 17/17 passed. |
| [#214](https://github.com/Cairn-ink/cairn-memory/pull/214) | `d58935f` | Run `36066913111`, 17/17 passed. |
| [#215](https://github.com/Cairn-ink/cairn-memory/pull/215) | `2f343e3` | Run `36069686325`, 17/17 passed. |
| [#216](https://github.com/Cairn-ink/cairn-memory/pull/216) | `2b24674` | Run `36072917284`, 17/17 passed. |

The primary accepted S1's finite mechanical gate on the current candidate
after independent Standards and Spec reviews, a read-only acceptance audit,
and 22 installed pinned-Hermes tests on each of Node 22.16 and 24.15. Core,
MCP and native evidence covers bounded canonical source references, observable
partial admission and initial-classification state, explicit bounded recovery,
current/stale reference guards, correction and deletion fencing, exact
namespace privacy and late-write prevention. Repeat-safe recovery protects
stored state, not exactly-once provider cost: an explicit no-op classification
can consume another request. The initial journal row stays unchanged after
later classification; its public view can become `unknown` when a member's
revision changes through filing or correction. This is synthetic mechanical
evidence, not a new semantic score, installed real-model reliability result or
completion of S2–S5. The historical 30-case Cairn outcomes remain 15 correct,
8 wrong and 7 unresolved.

The next packet is a separately frozen six-case development plumbing smoke,
one case per existing question type, selected from the retained source after
excluding 82 previously reserved or used cases. Its plan is in the local,
unpublished `fresh-reliability-smoke` worktree at freeze `6287e1e` plus
pricing record `658b3ba`, fixed to `2b24674`; GPT-6 Sol/high owns the bounded
implementation. No paid run has started. The phase ceiling is US$12 and 2,000
requests. A source-only projection is 1,172 requests and US$6.781960; it is
neither actual spending nor a wall-clock prediction. This smoke uses embedded
default-core capture and recall. It does not exercise native v2 qualification,
the opt-in whole-capture deadline or explicit recovery as a live model flow.
It is development plumbing evidence, not a held-out competitor comparison.

The fresh read-only accounting checkpoint recorded US$79.389500 reserved
against the unchanged US$100 operational ledger limit and US$200 user
cumulative ceiling, with 11,461 requests terminal. No ledger change, paid
request, old-cohort rerun, merge, release or deployment follows from this
documentation update. The S2 matched answer-stage gate, S3 matched Mem0
comparison, S4 installed growth profile and S5 cold-context onboarding remain
pending. Recheck the actual ledger, grants, runner and current PR heads before
any paid phase; no source text, case IDs or private artifact paths belong in
public reports.

## Previous checkpoint — 2026-09-25 (after PR #212; retained)

Fixed as-of checkpoint; earlier checkpoints below retain their own heads,
results and failures and were not rechecked here. PR [#212](https://github.com/Cairn-ink/cairn-memory/pull/212)
is ready, open, unmerged and mergeable at `a6f8bfc3176f9ca8f64ebbcd888e58a920b5e3da`,
based on `c118c0f0fd70af01c63ea1339305de03eeb84c94`. CI run `36056945007`,
attempt 1, passed 17/17. Separate full-base Standards and Spec reviews
(GPT-6 Sol/high) passed with zero findings. Primary verification of final head
`a6f8bfc` passed `npm test` (127/127), JSON validation and strict plugin
validation on Node 22.16 and 24.15. Full CLI and focused runtime measurements
used runtime-identical candidate `08e82c7` (the final head differs only in
documentation). In this documentation worktree, `npm test` passed 106/106;
`npm run validate` and `npm run validate --prefix tools/plugin-validation`
also passed on Node 22.16.0 and 24.15.0, along with `git diff --check`. No
merge, release, deployment, paid request, ledger edit, old-cohort rerun,
semantic score or S1–S5 milestone pass is recorded.

### Latest completed S2 offline diagnostic: incremental candidate index (PR #212)

Both CLI runs passed the frozen 100/1,000/10,000 synthetic-size checks. At 10,000
rows, whole-cell elapsed time was 8.553 s on Node 22.16 and 10.721 s on 24.15,
versus the retained earlier 120 s timeout. Later reconstructions of that old
query are not the exact red source (no red-source SHA was saved), so they do not
prove a unique cause. The index is not a uniform speedup: on Node 24, the
accented negative-index query took 224.595 ms indexed versus 148.175 ms for the
scan. Two lexical false positives and unsupported CJK cases remain. Full-text
copies remain in the sidecar; the 10,000-authorized plus 10,000-foreign database
grew from 21,581,824 to 34,250,752 bytes, including lifecycle/generation costs,
not a pure index-overhead measure. This is synthetic retrieval evidence, not a
production selector, semantic QA result, production promotion or S2 answer-stage
pass. Retained PR #208 failures and older results below are unchanged.

### Next S1 packet: initial capture classification journal (implementation in progress)

The frozen assignment is in the local, unpublished `capture-classification-journal`
worktree: freeze `c4dd8850e435bf3752b52f6a72154ef56aeed100` plus preimplementation
manifest clarification `6ea5b90`, fixed to PR #211 base
`632c0d8b1ad0e79ea5c9ccc8c4bbfee022d8ab9b`. Branch
`feat/capture-classification-journal`; implementation owner GPT-6 Sol/high.
The frozen plan is `docs/plans/capture-classification-journal.md` in that
worktree. Its CJ1–CJ6 contract covers one source-free initial-classification
journal row per newly admitted batch, transactional admission and placement,
v13-to-v14 migration, and opt-in `includeInitialClassification` inspection.
Default inspection remains unchanged and unknown; legacy/manual admissions
stay unknown. The journal is not a recovery queue, replay mechanism or new
classification attribution path. Whole-capture deadline and explicit-recovery
semantics remain later work.

Implementation is in progress; no implementation or runtime gate is accepted
for this packet. Resume by checking the frozen assignment and current branch
state against that plan; the primary is accepting migration and crash-probe
work. Do not claim an S1 pass.
After this journal slice, interruption/recovery and deadline work, then fresh
frozen semantic-comparison gates, remain required. S1, the later S2 answer-stage,
S3 matched Mem0, S4 installed growth and S5 cold-context onboarding remain
open. Budget was not reread: last-recorded authority is US$200 cumulative,
operational ledger US$100 pending review, and reserved spend US$79.389500.
Verify the actual ledger and guard before any paid phase. No new paid call,
ledger change, old-cohort rerun, merge or release is authorized by this checkpoint.

## Previous checkpoint — 2026-09-25 (after PR #211; retained)

This prior fixed checkpoint recorded PR [#211](https://github.com/Cairn-ink/cairn-memory/pull/211)
ready and unmerged at `632c0d8b1ad0e79ea5c9ccc8c4bbfee022d8ab9b`; CI run
`36051396331`, attempt 1, passed 17/17. Separate Standards/Spec reviews
(GPT-6 Sol/high) passed with zero findings. Primary gates reported 168
request-guard checks, generic tests 112/112, JSON and strict plugin validation
on Node 22.16 and 24.15. On the prior runtime-identical candidate,
live-evidence-offline had 335 total (305 passed, 30 existing opt-in skips), and
the budget suite passed 15/15 on both runtimes; these suites were not rerun
after its final test/docs delta.

PR #211 added opt-in `bounded-v1` private-generation diagnostics: a per-case
ring capped at 256 records for fetch entry, response availability, body-read
completion, settlement attempt and accounting outcome. It persists no source
text, case IDs, URLs, model identifiers or usage; it changes no timeout, retry,
cap, scoring or ledger behavior. CLI output requires complete `case-deadline`
flags; generation detail remains private-generation-only. The milestones do
not prove network transmission, provider receipt/billing or semantic success.
S1 recovery and the durable classification journal remained open.

## Earlier checkpoint — 2026-09-25 (after PR #210; retained)

This checkpoint was refreshed after checking the remote PR heads and workflow
runs below. The four listed PRs are open and unmerged; no merge, release,
deployment, new paid request, ledger change or old-cohort rerun is recorded.
PRs #202–#204 and #206–#207 remain in the earlier snapshot below and were not
rechecked in this refresh.
Budget numbers were not reread: the last-recorded cumulative ceiling is
US$200, the operational ledger is US$100 pending review, and reserved spend is
US$79.389500. Verify the actual ledger and guard before any paid phase.

| PR | Verified remote head | CI at that head |
| --- | --- | --- |
| [#205](https://github.com/Cairn-ink/cairn-memory/pull/205) | `ad45cd10e52983471c0c5229275f772e1a989dba` | Run `36045084989`, attempt 1, 21/21 passed. |
| [#208](https://github.com/Cairn-ink/cairn-memory/pull/208) | `c118c0f0fd70af01c63ea1339305de03eeb84c94` | Run `36045232556`, attempt 1, 17/17 passed; earlier `f25050d` failure remains retained below with cause unknown. |
| [#209](https://github.com/Cairn-ink/cairn-memory/pull/209) | `328052a1782afa50f82c5dfcc8600397320c00e5` | Run `36045345343`, attempt 1, 17/17 passed. |
| [#210](https://github.com/Cairn-ink/cairn-memory/pull/210) | `9ac117671a0ba714d427fe1129823bfcfebe19a3` | Run `36047442942`, attempt 1, 17/17 passed. This completes the check that was pending in the preceding handoff. |

PR #205's green run applies to its current remote head `ad45cd1`. This
checkpoint update is local and unpushed; any later remote head needs its own
CI and final independent review. A green later PR #208 run does not establish
that the earlier tokenizer failure was fixed: the 40,000-space/5-second gate
is unchanged, and its cause remains unknown.

### Latest completed S1 packet: capture admission inspection (PR #210)

Owner: `recovery_design6`, actual model GPT-6 Sol/high. Fixed base
`328052a1782afa50f82c5dfcc8600397320c00e5`; candidate head
`9ac117671a0ba714d427fe1129823bfcfebe19a3`, branch
`feat/capture-admission-inspection`, worktree basename
`capture-admission-inspection`. Its 14-file allowlist is:

`CHANGELOG.md`, `adapters/mcp/server.mjs`,
`adapters/mcp/test/capture-admission-inspection.test.mjs`,
`adapters/mcp/test/classification-recovery.test.mjs`,
`core/admission-storage.mjs`, `core/contract.mjs`, `core/runtime.mjs`,
`core/test/capture-admission-inspection.test.mjs`, `docs/admission-claims.md`,
`docs/limitations.md`, `docs/plans/capture-admission-inspection.md`,
`docs/protocol.md`, `docs/standalone-mcp.md`, and
`packaging/test/capture-admission-inspection.test.mjs`.

This bounded slice adds a schema-free, read-only exact-batch admission view;
it distinguishes absent, pending and completed admission without asserting
classification. Completed records report `classification: unknown`, a bounded
suppression count of 0–5 and fresh current refs or closed noncurrent members;
it does not return source text or old revisions. The opt-in keeps five default
tools, adding admission inspection plus the existing explicit classifier for
seven total when opted in. An actual installed-artifact test covers keyless
inspection followed by explicit fake classification with unchanged receipts.
This is inspectable admission membership, not batch provenance for
classification or a durable journal.

At this candidate head, worker and primary generic checks passed 112/112 on
Node 22.16 and 24.15; the packet reports core 655/655, MCP 86/86 and artifact
69/69 on both runtimes. The primary also reports the Node 22 core run exiting
0 with the dot reporter. JSON, plugin and applicable synthetic demo checks
passed. Independent Standards and Spec reviews (GPT-6 Sol/high) passed the full
14-file range with zero findings. CI run `36047442942` is tied to this exact
head and passed all 17 jobs; the PR is marked ready. At resumption, verify
`gh pr checks 210 --repo Cairn-ink/cairn-memory` still applies to this head;
do not repeat already completed test suites or boundary reproductions by
default.

The packet does not add batch-membership provenance for classification, a
durable classification journal, or a whole-capture timeout. S1 remains active
and incomplete; these results do not satisfy its full repair/recovery gate.

### Next active packet: transport phase diagnostics (assigned, not started)

Owner: `recovery_design6`, actual model GPT-6 Sol/high. Fixed base
`9ac117671a0ba714d427fe1129823bfcfebe19a3`; branch
`test/transport-phase-diagnostics`, worktree basename
`transport-phase-diagnostics`. Its packet plan is
`docs/plans/transport-phase-diagnostics.md` on that branch. This is a new
bounded assignment, not an implementation or quality result; read its exact
allowlist and frozen acceptance before resuming.

TD1–TD6 scope is an opt-in `bounded-v1` per-case transport-event ring capped at
256 records, with fetch-entered, response-available, body-complete and ledger
settlement milestones; CLI output is limited to `case-deadline`, with private
generation diagnostics only. No deadline, retry, ledger or scorer behavior is
to change. Acceptance includes fake-HTTP equivalence with diagnostics off/on,
privacy, late-callback handling, validation before claim, and required checks on
both Node runtimes. Until that packet is implemented and reviewed, phase-level
transport observations remain a proposal, not an available capability.

### Additional research checkpoint — design inputs only

Retained guarded-generation aggregates show 3 of 2,604 generation attempts
ending in `core_deadline`, intersecting 3 of the original 30 cases. For 2,601
successful guarded attempts, the observed guard durations were median 2,502 ms,
p95 4,891 ms, p99 6,584 ms and maximum 24,138 ms. These are guard durations, not
provider latency or proof of core success; method, headers and body phase are
unknown. Existing deadline, hung-body and late-reply tests cover those
mechanics; another generic repeat matrix is not the next task. Narrow,
privacy-safe phase milestones may be designed before any new scoped
calibration, but a proposed observer is not an implemented capability. Do not
waive S1 or live-benchmark gates.

A process-local FTS index built only from an already-authorized map remains a
future MOC-navigation proposal, not a selected production default. Before
selection, measure build cost with the actual tokenizer at 100/1,000/10,000
memories, plus freshness and namespace behavior. Mem0's candidate engine is
[main commit `989c7da`](https://github.com/mem0ai/mem0/commit/989c7da0fc8e4df6342dbb8c448af9816d60d24c)
(2.2.0 main, five commits ahead of the
[v2.2.0 tag](https://github.com/mem0ai/mem0/tree/47a69e1e72dc562b6fdd49a9ef892229afc7508a));
the candidate is not pinned for comparison and is not a result. Before any
paid comparison, decide release versus main, lock dependencies and BM25
availability, disable telemetry, isolate `MEM0_DIR` and stores, use fake
providers for preflight, and freeze evidence packing and time cutoff.

## Earlier execution snapshot — 2026-09-25 (historical)

This dated snapshot is retained as historical evidence, not a current PR table
or milestone pass. The latest checked heads and active packet are above. At the
time of this earlier snapshot, the listed public PR states and head SHAs were
checked directly; listed candidates were open and unmerged:

| Candidate | Head | State at check |
| --- | --- | --- |
| [PR #202](https://github.com/Cairn-ink/cairn-memory/pull/202) | `fcfd2b3` | Open; audited 30-case documentation. |
| [PR #203](https://github.com/Cairn-ink/cairn-memory/pull/203) | `ca9c15c` | Open; reliability runtime integration. |
| [PR #204](https://github.com/Cairn-ink/cairn-memory/pull/204) | `7c7e8b3` | Open; extraction source-domain bound. |
| [PR #205](https://github.com/Cairn-ink/cairn-memory/pull/205) | `285e7ff` | Open; last verified remote head. This local refresh is not pushed. |
| [PR #206](https://github.com/Cairn-ink/cairn-memory/pull/206) | `aaa44da` | Open; classification batch cardinality. |
| [PR #207](https://github.com/Cairn-ink/cairn-memory/pull/207) | `038f0ac` | Open; synthetic evidence lineage coverage. |
| [PR #208](https://github.com/Cairn-ink/cairn-memory/pull/208) | `f25050d` | Open; candidate retrieval ablation; CI has one failure. |

PR #205's last recorded local review was on `0b882e6`: Standards passed with
zero findings, and the Spec stale-head concern is addressed by this refresh.
Rerun both review axes on the final checkpoint before publishing. PR #205's
remote head remains `285e7ff`; these status changes are local and unpushed.

At PR #207's recorded head, seven fixed scripted capture-to-recall cases reach
actual public evidence packing. Generic checks passed 112/112 and LongMemEval
checks 75/75 on each of Node 22.16 and 24.15; CI run `36035308315` passed 17/17.
The implementation worker and both independent Standards/Spec reviewers were
GPT-6 Sol/high; both reviews passed with zero findings. These checks cover
scripted pipeline mechanics, not live semantic quality. The source/ref and
classification guards are candidate changes, not proof of a reliability fix.

| Milestone | Current state and evidence | Next acceptance work |
| --- | --- | --- |
| S1 — bounded recovery | Active, incomplete. Candidate runtime stack #203/#204/#206/#207 remains open; partial-classification recovery and timeout handling are not complete. The current MCP recovery packet is in progress on a separate branch; see below. No S1 pass is claimed. | Finish observable, repeat-safe recovery from retained evidence; verify incomplete receipts, corrected/deleted content, namespace/privacy and no resurrection. |
| S2 — tracing and navigation | Active, incomplete. The eight historical wrong outcomes remain fixed-N and read-only; finer fact-stage causes are unknown. The independent red-base 1,025-admit capacity control misses its target at PR #207 base `038f0ac`; PR #208's separate indexed candidate fixture reaches its target. Alias expansion helps pure-alias queries, both indexed paths miss CJK controls, and MOC-first shows no observed gain. These are retrieval diagnostics only, not an attribution for historical errors, QA results or a product fix. | Independent reviews passed; CI run #36042861159 is complete with 16/17 jobs passing and one Node 22 OpenAI offline failure. Preserve and diagnose the failure without rerunning it or calling CI green. The later matched answer-stage gate remains required. |
| S3 — matched comparator | Pending; no fresh matched Mem0 OSS score exists. | Preflight and pin the actual engine, dependencies and model configuration; reconcile harness filters and denominators; freeze a new holdout before any scoring. |
| S4 — installed path and growth | Pending; installed Hermes/MCP cold-restart and 100/1,000/10,000-memory growth gates remain. | Freeze host/runtime/resources/repeats, then complete each required synthetic workflow and measurement while retaining failures and cap breaches. |
| S5 — preview and onboarding | Pending; no cold-context onboarding pass is recorded. | Run the documented clean-environment flow through sourced write, new-session recall, inspect, correct, forget and restart/no-result; record receipt-backed pass/fail at every step. |

### Retained S2 packet evidence — earlier PR #208 head `f25050d`

At that earlier checkpoint, the original measured baseline was
`e928fea80e3da4f0eff759100d41666ee35b6dc9` and the reviewed candidate was
[PR #208](https://github.com/Cairn-ink/cairn-memory/pull/208),
head `f25050d36a91be6aef3033dadeba52082c62f789`, based on PR #207 head
`038f0acbe2ac281d1fd599a1199aa921782ca5e5`, on branch
`experiment/candidate-retrieval-ablation` (worktree basename
`candidate-retrieval-ablation`). The original implementation was by
`candidate_ablation6` (GPT-6 Sol/high); a bounded two-file correction was by
`recovery_design6` (GPT-6 Sol/high) after the original thread could not be
reactivated. The correction fixes a mixed-reference regression in the shared
filed/unfiled reference guard in `evaluation/architecture/candidate-ablation.mjs`
and its test; it does not alter fixtures or measured results. The capacity
red-boundary result was already present at measured checkpoint `e928fea`; the
`f25050d` correction is unrelated to that result.

The packet's seven-file allowlist was:
`evaluation/architecture/candidate-ablation.mjs`,
`evaluation/architecture/candidate-ablation-cli.mjs`,
`evaluation/architecture/candidate-ablation-fixtures.json`,
`evaluation/architecture/test/candidate-ablation.test.mjs`,
`docs/plans/candidate-retrieval-ablation.md`, `docs/limitations.md`, and
`package.json`.

The measured fixture reports candidate reachability, not public packing or
answer correctness: the capacity target is reachable in both indexed paths;
aliases help pure-alias queries; both indexed paths miss CJK controls; MOC-first
shows no observed gain. These results do not resolve the historical eight wrong
answers or pass S2. Independent Standards and Spec reviewers (GPT-6 Sol/high)
passed the full final range with zero findings.

At the earlier `f25050d` candidate checkpoint, PR #208 verification was
separate from this documentation PR. The candidate work reported generic
117/117 on each of Node 22.16 and 24.15; worker LongMemEval checks were 75/75
on both runtimes, with root independently reporting 75/75 on Node 24.15. The
worker passed both candidate demos and JSON validation; primary focused checks
passed 5/5 on each runtime; root passed plugin validation on both runtimes.
This plan branch's own generic count was 106/106 on each runtime, not 117/117;
its JSON and plugin validation passed on both runtimes too.

CI run `36042861159` is tied to PR #208's exact final head and is complete with
16/17 jobs passing. The sole failure is OpenAI offline on Node 22.16, job
`107779060947`: `adapters/openai/test/tokenizer-performance.test.mjs` timed out
the 40,000-space child at 5,048 ms against its 5-second limit; 205/206 adapter
tests passed. The matching Node 24 OpenAI offline job passed and is among the 16
passing jobs. Root is diagnosing exact counter performance on a separate branch;
no rerun has been made and the cause is not declared transient or confirmed. The
current tokenizer's repetition cost is a known concern, but it is not yet the
confirmed cause. Preserve the 5-second gate. The next PR #208 head,
`c118c0f0fd70af01c63ea1339305de03eeb84c94`, later passed 17/17 in run
`36045232556`; that later result does not explain the old timeout or show a
runtime fix. The 40,000-space/5-second gate remains unchanged and the cause is
unknown. Recheck current head and CI before resuming; do not enable auto-merge.

### Earlier S1 packet: explicit MCP classification (PR #209)

The explicit classifier is PR #209, open at
`328052a1782afa50f82c5dfcc8600397320c00e5`, based on PR #207's
`038f0acbe2ac281d1fd599a1199aa921782ca5e5`; its CI run `36045345343` passed
17/17. Owner: `recovery_design6`, GPT-6 Sol/high. It exposes
`classify_unfiled_memories` for caller-supplied current unfiled refs through
existing `core.classifyPlacement` and `core.applyPlacement` guards. It is not
proof that a capture batch failed. PR #210 builds on this candidate with
read-only admission inspection. Batch membership provenance for classification
and a durable classification journal remain absent, so S1 remains incomplete.
Scope of PR #209 was MCP server/CLI, tests and technical documentation; no
core/schema, live or paid work was in scope.

No semantic score or paid request is recorded in these checkpoints. At the last
recorded budget checkpoint (not reread during this documentation update), the
cumulative API ceiling was US$200, US$79.389500 was reserved with US$120.610500
headroom, and the operational ledger was US$100 pending separate review and
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
