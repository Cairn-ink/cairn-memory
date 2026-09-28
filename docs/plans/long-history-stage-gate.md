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

## Evidence and remaining gates

Pending implementation. Real-model completion/selection, installed MCP/Hermes
acceptance (including #241), and semantic/current-state reliability remain open
until their own evidence exists; this gate cannot mark them complete.
