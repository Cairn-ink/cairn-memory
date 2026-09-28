# Long-history stage gate: capture, cold recall and answer evidence

Status: acceptance frozen before implementation; offline development only.
Base: `882fff3ce1ea2ee80975bcacfc9f1254d349b1b8` (includes #271 and SE-2).
Worktree: `long-history-stage-gate`; branch: `test/long-history-stage-gate`.

## Outcome and scope

The immediate product question is where a long history loses needed evidence:
capture completion, retained receipts, candidate visibility, selection, final
recall, or answer-context packing. A successful script is not semantic quality.
Keep the small diagnostic gate separate from the future six-case paid comparison,
fixed-30 expansion, host promotion and broader reliability promise.

This packet adds a reproducible maintainer-only gate using the actual public
core and current source-evidence path. No product default, prompt, persistence
schema, MOC placement rule or model bound changes are authorized by this spec.
If the gate reveals a new product defect, record a minimized red probe and
bring the bounded proposed correction to primary before implementation.

## Frozen cases and observable acceptance

- H1: Three synthetic case families, frozen before result-producing execution:
  long source text with front/middle/tail evidence across 800-unit windows;
  1,025 distinct memories with at least one retained source outside the legacy
  first-1,024-ID candidate prefix; dated A/B choices with explicitly recorded
  reasons. Use public `capture` for every admission and model classification for
  filing; no direct SQL seeding, hand placement, direct `admit`, or injected IDs.
  No evaluator expectations or later questions enter capture/model inputs.
  Because IDs are random, the capacity probe's target-selection rule is frozen:
  select the admitted memory with the greatest ID after all writes, using its
  pre-existing unique source marker as the query. Label this a diagnostic, not
  a blind or semantic benchmark; do not choose a target based on recall results.
- H2: Scripted extraction/classification and visible-input-only select/rank are
  explicitly mechanical controls. Neither selector nor ranker can read the
  store, expected answers, target IDs or expected-evidence table. Use the actual
  local tokenizer, not constant count=1. Freeze fixture source text/generator,
  question rules, required evidence and control expectations before first run.
  Keep schema limits and per-stage budgets unchanged; no paid provider/key/corpus.
- H3: Record per-batch completion including explicit post-admission failure;
  inspect retained receipts through public APIs after closing/reopening the DB.
  Observe only the real select/rank request/response boundaries, actual recall
  result and existing answer-packing utility. For each required passage report
  retained / candidate-visible / selected / ranked / final-returned /
  answer-context-present, with first observed missing stage (not a guessed cause).
  An upstream failure makes downstream stages not-run, not false or successful.
  A visible memory whose source is absent from its preview is not visible source
  evidence. Report memory-reference visibility separately from passage visibility.
- H4: Compare unchanged default candidate policy against explicit
  `bounded-keyset-v1` on the SAME cold store. Exercise explicit
  `indexed-evidence-v1` capture without asserting claim qualification, truth,
  supersession or current-decision reliability. Capacity default-prefix control
  must expose retained-but-not-visible evidence; opt-in must carry it to the
  actual packed answer request. A/B both remain source evidence, not an automatic
  graph relation or adopted latest-state judgment. No answer-model score emitted.
- H5: Fault controls prove the diagnostic is red-capable at the actual seams:
  malformed extraction, failed classification after admission, omitted source,
  empty selection and empty rank cannot appear as successful evidence delivery.
  Do not resume an incomplete capture sequence or fabricate stage events.
  Verify correction, forgetting and namespace isolation on cold reads, including
  no forgotten source resurrection; preserve public-core validation/revisions.
- H6: Versioned bounded source-free aggregate JSON plus human-readable summary
  includes all cases/controls and denominators, stage counts, call/token totals,
  write/read elapsed time and final database bytes. These are local scripted
  metrics, not provider billing, latency SLA, benchmark accuracy or MOC superiority.
  Raw synthetic traces may be used privately by tests; public aggregate must not
  contain source/answer text, opaque IDs, paths, credentials or arbitrary errors.
  The gate fails nonzero on an unexpected outcome, preserving expected negative
  controls as such rather than treating every successful process as product pass.
- H7: All stores use `createTestWorkspace` and close resources before cleanup;
  canonical invocation uses `tools/testing/run.mjs`. No historical tmp scans or
  deletions, external/operational ledgers, benchmark cohorts or mutable user DBs.
  Add CI coverage on existing Node22.16/24 jobs with required locked adapter
  tokenizer dependency. Do not load SQLite into generic Node20 tests.
- H8: Freeze local candidate after worker and primary verify actual outputs and
  negative controls. Required gates: dedicated gate/tests on22.16/24.15,
  existing core/LongMemEval plus relevant demos, generic/JSON/strict-plugin,
  scratch lifecycle and diff checks. No TypeScript gate exists. Independent
  Standards and Spec reviews inspect same final SHA before PR and exact-head CI.
  Do not relax a failing assertion or silently expand runtime scope to pass.

## Work ownership

One implementation worker, GPT-6 Sol/high, owns `evaluation/long-history/**`,
the named root package script, one existing CI job addition, and this plan's
implementation/evidence section plus narrow technical CHANGELOG, limitations
and ROADMAP entries. Primary owns frozen requirements, integration, acceptance,
the independent reviews and a separate read-only check of #241's retained
installed-host failure. Do not implement or merge #241 or new host options here.
No paid run in this packet; cumulative US$200 authority is unchanged.

Before implementing, report the caller trace and intended finite fixture sizes.
Keep fixture/expectation freeze in a separate local commit before measurement.
Record exact commands, failed observations, explanations, corrected candidates
and measured/unknown cost facts below. No GitHub issue is requested.

## Implementation and evidence

Fixture and expectation freeze: `ad4a96c0e61bff12d6d6638c6b913a762a8d3917`,
then `4da14fac6ca65b694623fa9721e7e74e98b87ec4` before the first
result-producing run. The second commit fixed the exact 800-unit boundary
separator and required a normal classifier-proposed L1 for the front passage.
The scripted model reads only each public model request. The evaluator derives
full required passages from the frozen source text and checks exact cold
receipts, rank input, final recall and packed evidence. Its marker query is a
literal diagnostic of routing, not a semantic or blind benchmark. The output
contains per-batch statuses, bounded stage aggregates and no source text or IDs.
The long passages do not fit the 120-character candidate preview. For the
shorter capacity and dated passages, the summary body's equal query score
wins the existing tie against the source receipt, so those full passages are
also absent from previews. Memory references and marker routing cues are
visible in successful cases; subsequent fetch/rank/final/packing can still
deliver exact receipts. `firstMissing` identifies the first preview-level gap,
`firstDeliveryFailure` identifies the first broken source-delivery stage, and
`deliverySucceeded` records the observed downstream delivery.

Caller path: `openMemoryCore.capture` → indexed source-window catalog → model
extract → public admission → model classify → closed/reopened store → public
get/recall → query candidate map → model select → fetch → model rank → final
snapshot → existing `packMixedAnswer`. The capacity family writes 205 public
capture batches of five, then freezes the maximum admitted ID as the target
before either recall policy is invoked. The default and opt-in policy read the
same cold database. The front long-window item is filed by normal model
classification and observed as an L1 child reference; other capacity items
exercise unfiled candidate routing.

Initial CLI runs failed `gate_negative_controls` because the evaluator matched
the marker in the packed question even when evidence was empty. The empty
selection/rank controls exposed that diagnostic bug; checking the packed
`evidence` array corrected it. An early successful worker run, before the
final preview and count corrections, was
`node tools/testing/run.mjs --script evaluation/long-history/run.mjs` on
Node 22.16.0: exit 0 in 40.558 s, 208/208 positive capture batches and
1,030 admitted memories; default capacity retained the target but did not
show its reference, while the opt-in route packed it and reported
`budget_exhausted` because 1,025 eligible rows exceed the 1,024 top set.
All eight expected negative controls were observed. That candidate miscounted
downstream `not-run` stages as true in aggregate. A later test stopped after
206/208 positive batches at `gate_capacity_optin_delivery`: its first revision
mistook absence of the full source from the candidate preview for a delivery
failure. The existing summary/source tie keeps the marker visible while the
source itself arrives through fetch. The final diagnostic separates preview
visibility, routing cue and actual delivery; these were evaluator corrections,
not product behavior changes.

Primary precommit checks of unchanged runtime and dependents: `npm test`
passed 121/121, `npm run validate` passed, strict marketplace/plugin validation
passed, `npm run test:longmemeval` passed 193/193 on Node 22.16.0 and 24.15,
and local-store, MOC, recall, capture and LongMemEval ingestion/comparison/
public/mixed demos passed on both runtimes through the owned runner. Individual
demo durations were not recorded. The worker's corrected dedicated
`npm run test:long-history` passed 1/1 on Node 22.16.0 in 48.335 s before the
final preview-visibility refinement; it is not final-SHA evidence. Primary
full-core Node 22.16.0 and workspace-lifecycle Node 22.16.0/24.15 checks
subsequently passed. Full-core Node 24.15 also passed 934/934 in 360.352 s.

Final worker precommit check on Node 22.16.0: `npm run test:long-history`
passed 1/1 in 25.780 s. The CLI
`node tools/testing/run.mjs --script evaluation/long-history/run.mjs`
exited 0 in 32.091 s. It recorded 208 completed positive capture batches,
1,030 admitted memories, seven cold retained required passages, six visible
memory references and six passages reaching selected/rank/final/packed stages.
All seven full passages are absent from candidate previews (the long passages
exceed 120 characters; short source/body scores tie), yet six route from
visible marker cues to exact packed evidence. The default 1,025-memory target
has no visible reference; opt-in `bounded-keyset-v1` packs its exact source
and honestly reports `budget_exhausted`. The eight negative controls passed,
including explicit post-admission classification failure and cold lifecycle
checks. Local counts were 214 extract, 212 classify, 16 select and eight rank
calls, 5133 tokenizer calls, 319597 scripted model-input tokens, 56117
model-output tokens and 15886942 total local tokenizer tokens across all core
checks. Write/read/control times were 30219/615/1154 ms; final SQLite bytes
were 6512640. These are local measurements, not provider billable tokens,
provider latency or a performance SLA. Later exact-head acceptance and
independent-review outcomes are recorded in the PR against their final SHA.

Primary acceptance on candidate `630661a8fd80ee490b5ec4a8312008cbf6cf1d6a`
found a gate-reporting defect despite its green positive path: an unexpected
capture failure was unwrapped before its batch was recorded, and the catch
returned only already-pushed cases with empty controls/stage counts and
incomplete write timing. The bounded correction predeclares all 208 positive
batches, seven questions and eight controls, marks later work `not-run`, and
records each attempted batch before checking its result. Failed admission is
unknown unless a cold public read proves zero; post-admission classification
failure retains its five admitted sources and is counted as a failed completed
classification, not a fully completed batch. The total source-stage counts
and elapsed write/read work remain available on failure. A fixed test-only
selector fails extraction or classification at the second capacity batch; it
never resumes the sequence or enters capacity recall, dated capture or controls.
The failure CLI emits the bounded sanitized aggregate and exits nonzero.
Focused precommit `node tools/testing/run.mjs --test-name-pattern='second capacity batch|test-only fault CLI' evaluation/long-history/gate.test.mjs`
passed 3/3 in 1.583 s. The first full corrected `npm run test:long-history`
passed 4/4 in 37.863 s; after the minor control-reporting refinement, its
final affected rerun passed 4/4 in 34.612 s on Node 22.16.0. Neither
failure-path run invokes the remaining 203 capacity batches.

An independent base control used the pre-existing public-`admit` K7 test on
Node 22.16.0: `node tools/testing/run.mjs --test-name-pattern='K7 public-admit source beyond' core/test/bounded-keyset-candidates.test.mjs`
passed in 86.08 s. It establishes the prior 1,024-ID differential only; it
does not fulfill this gate's public-`capture` requirement.

The read-only #241 installed-host audit found the remote PR open and draft.
Its retained initial Node 24 evidence records `recall_failed` and an outer
`ETIMEDOUT` near 1,022 s. Later four diagnostic gates were green, but the
original cause was not established by the retained evidence. Installed-host
readiness stays open; the local scripted gate does not reclassify that failure.

Final exact-head verification, independent review and CI outcomes are recorded
in the PR against the candidate SHA rather than treated as completed here.
Real-model completion/selection, installed MCP/Hermes acceptance
(including #241), and semantic/current-state reliability remain open. No
provider calls were made; provider charges are US$0 for this packet, and
model-token/cost usage for agent work is not exposed by this runtime.
