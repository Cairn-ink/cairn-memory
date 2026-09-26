# Source-pair cohort preparation

Status: primary contract before bounded implementation. Fixed base
`a5d76b3723f10280b45052578f6ae43733c676d4`, accepted installed launcher PR #228;
all17 exact-head CI jobs passed in run36109490910. Branch/worktree:
`test/source-pair-cohort-preparation` / `source-pair-cohort-preparation`.
One GPT-6 Sol/high author; primary owns architecture and personally verifies;
two nonauthor reviewers inspect the same original-base/final-SHA diff.

## Goal and decision

The goal remains a lightweight reliable memory layer for Hermes/MCP and other
harnesses, judged against matched existing solutions, not100% answer accuracy.
The installed source-pair launcher is now accepted offline. Do not build another
execution/guard/scoring framework. This packet adds only pure preparation helpers
needed to freeze a prospective development experiment and preserve an untouched
comparator holdout. It makes no quality claim or paid call.

The source experiment compares qualified prefix and indexed windows with common
source-bound-v2 qualification, MOC, answer/judge and resource limits. It isolates
source exposure, not MOC-versus-vector, default-versus-qualified, or Mem0 parity.
The prior terminal30 and fresh6 cohorts remain immutable and are not rerun.

Primary product choice, before new answers: select six development cases, one
per existing question type, and reserve thirty disjoint holdout IDs, five/type,
for a later matched comparator. Holdout membership is not permission to evaluate
it or tune against it. This is an explicitly stratified sample, not the full
500-case benchmark or its natural question-type distribution. Source-pair
development may use at mostUS$30 later,
subject to actual audited headroom and a complete conservative projection;
preserve at leastUS$70for matched Mem0 andUS$10for installed host work. These
are prospective allocation ceilings, not reservations or a live launch grant.
If the selected six cannot fit, stop before calls; never replace expensive or
failing cases with convenient ones. Existing cumulative authority remainsUS$200.

## R1 — Pure blind membership allocation

New maintainer module `evaluation/longmemeval/source-pair-preparation.mjs`.
Export `selectSourcePairCohorts({inventory, exclusions})` with exact options.
The input inventory is exactly500 dense entries of exactly
`{sourceQuestionId, questionType}`. IDs are unique nonempty bounded strings;
types are the same six documented LongMemEval types as the existing smoke.
Reject raw source entries, question/history/answer fields and unknown fields.
Exclusions are a dense unique list of known source IDs, bounded by inventory
size; no hardcoded82 assumption. At least six eligible IDs per type are needed.
Snapshot inputs before deriving membership; immutable output, no callbacks,
filesystem, environment, provider, random generator or data-dependent fallback.

Freeze seed `cairn-qualified-source-pair-cohorts-2026-09-25:`. Within each type,
rank by SHA-256 of UTF-8 seed+sourceQuestionId, breaking ties by UTF-8 bytewise
ID order. First item is development, next five are held out. Return both
memberships in input dataset order, plus the by-type allocation and separate
membership/prepared-order digests. Use a new separately named schema identity;
do not reuse the old fresh-smoke grant/version. Record the seed, inventory
identity/order digest and exclusion-set digest so subsequent preparation can
check the exact decision. No reference answers, raw history or model labels
belong in this result. IDs/digests from real data are private experiment records,
not public benchmark results.

The existing `selectFreshSmoke` algorithm is a precedent, not a callable generic
allocator: its exact82-exclusion contract must remain unchanged. Reuse its type
constant if appropriate, not its old experiment identity or CLI. Completeness of
the supplied exclusion set cannot be proved by this pure function; the operator
must audit every historical/reserved cohort before real selection. Reject an
insufficient type rather than substitute another type or shorten the roster.

## R2 — Pure source-derived request and reservation upper bound

Export `projectSourcePairCase(options)` in the same module. Exact options:
`history, question, namespace, answerModel, limits, armOrder, reservations`.
The first six fields reuse the existing N protocol helper's exact validation
and semantics. `reservations` is exactly `{cairnCount, cairnGeneration, answer,
judge}`, each a positive safe integer in microUSD. These are full guarded-route
reservations, not current provider prices, known usage or a discount assumption.
The later operator must obtain them from the same frozen parent used by L/G.
The helper does not authorize or validate a monetary grant.

Call actual `qualifiedSourcePairProtocol`, `planQualifiedPrefixLongMemEvalCase`
and `planIndexedWindowLongMemEvalCase` with the same inputs. Reject if either
plan is nonexecutable or shared capture batches/source mapping do not agree;
do not truncate, re-batch, repair or silently drop a case. Return the independently
derived full protocol, policy-specific batch counts, per-route upper counts,
generation/scoring request and reserved-microUSD ceilings, and the reservation
inputs used. Output is immutable and serializable; no source excerpts or answers
are added beyond the existing protocol's question field. Reject unsafe arithmetic
rather than wrapping or saturating values.

Derivation from the exact accepted source, not observed success counts:

- Per arm and capture batch: at most extract, qualifyCandidates and classify.
- Per arm recall: at most two select calls plus one rank.
- Each of those core model method calls invokes at most one provider count and
  one generation request with the accepted adapter. No retries or rationale are
  enabled in this source-pair launcher.
- At most one answer and one judge per arm. Empty, failed or timed-out work can
  use fewer calls, but never refunds this prospective full upper bound.

For prefix/indexed batch counts bP/bI, let M=3*(bP+bI)+6. Then generation upper
counts are M count calls, M memory-generation calls and two answer calls;
scoring upper count is two judge calls. Generation requests=2*M+2,
scoring requests=2. Generation reservation=M*(count+memoryGeneration)+2*answer;
scoring reservation=2*judge. Separate per-phase from total; safe-sum across
selected cases later. The same-source plans normally have bP=bI; that fact is
verified, not a reason to reuse the old three-arm4b+12 formula.

Call-count bounds do not prove prompt fit, model output validity, semantic source
coverage, upstream cancellation, exact invoice or scoreability. Existing source
planners explicitly leave model-context fit unestablished. Surface this limit
in output/docs; do not mark model fit true based on character length. All actual
requests still pass installed L/G validation and frozen phase caps.

## R3 — Synthetic acceptance and compatibility

Tests must prove deterministic membership, one/five per type, disjointness,
full exclusion retention, bytewise ordering, prepared dataset order, immutable
snapshots and digests. Reordering inventory preserves membership but changes
prepared order identity. Changing a relevant identity/exclusion changes the
appropriate digest. Malformed/extra/oracle fields, duplicates, unknown IDs,
insufficient types and invalid input collections reject without side effects.
Keep the old selector's82-case contract and tests unchanged.

For projection, use actual synthetic source plans/protocols. Check both arm
orders, one and multiple capture batches, prefix/tail exposure, exact per-route
and per-phase formula, safe arithmetic, invalid reservations and real planner
blockers. Include an independently calculated golden expected total and an
actual scripted-core/adapter pair control showing observed routes do not exceed
the derived bound. Keep that actual-adapter control in one narrowly named test
under `evaluation/live/test`, whose existing CI installs adapter dependencies;
the pure preparation tests stay under `evaluation/longmemeval/test` and must
not import the optional adapter. Do not add a skipped-only gate or change CI.
Do not assert every maximum route always fires. Verify no
core/answer/judge/provider callback can be supplied to this data-only helper.
No actual dataset, operator ledger, environment key or network in worker tests.

## R4 — Scope, gates and delivery

Allowed: this plan, the one new preparation module, focused tests under
evaluation/longmemeval/test, one actual-adapter control under evaluation/live/test,
technical preparation docs, CHANGELOG and retained
limitations. No changes to old selectors/CLI, core, adapter, N/P/G/L protocols,
ledger/caps, packaging, dependencies, lockfiles, workflows or public runtime.
Report a genuine API contradiction to primary before expanding scope.

Node22.16 and24.15: full LongMemEval, live-offline (with both adapter dependency
sets installed), guard, generic suites, three LongMemEval demos, JSON and locally
pinned Claude2.1.260 strict plugin validation. The new helper remains dependency
light: clean final archive LongMemEval and demos must pass without adapters.
No typecheck gate exists in this JavaScript repo. Primary reads actual diff,
personally runs independent selection/projection and final full gates; freeze
candidate, independent Standards+Spec against this original base, fix/recheck/
rereview as required, dependent PR and exact-head allCI/mergeability before ready.
No merge, publication or deployment.

## R5 — Subsequent operational checkpoint, excluded from worker implementation

After preparation is accepted: primary audits the original ledger/config/grants
read-only, all terminal/pending rows and the complete prior-reservation inventory.
Freeze audited source identity and expanded exclusion digest, then compute the
blinded memberships before evaluator inspection. Keep heldout content/answers
out of development. Prepare only development via existing prepared-v2 and
reference-sidecar tools, derive real complete protocols/projections, and freeze
numeric caps/remaining allocation before any paid call. Record exact helper,
launcher, installed artifact and model/scorer identities.

The current recorded operational cap isUS$100, user authorityUS$200; neither
this plan nor the helper changes it. If needed, a separately frozen and reviewed
primary action may use the accepted atomic100→200 API, preserving every row and
old binding, with an explicit finite request cap and settled checkpoint.
No refunds, resets, old-cohort retries, marker repair or silent policy changes.
Read-only real-plan dry-run and independent safety/fairness checks precede one
new development launch. Verify official prices/model identity at that point;
worker-model upgrades must not silently alter evaluation models.

Report fixedN correct/wrong/unresolved, completion, paired outcomes, source/
packing observations, cost, latency and storage separately.95% scoreability is
an internal completion checkpoint, not accuracy. Six development cases cannot
establish parity or source-policy gain. Further frozen comparator and installed
host gates remain open. A development result can inform a candidate but may not
be passed off as untouched holdout performance.

## Resume

Read this entire contract, current worktree/HEAD/status, dependency PR and exact
CI, and latest recorded checkpoint. Do not infer paid work has not happened from
a missing report; check durable markers and ledger at the later authorized
operational stage. Record ownership, candidate, verification, retained failures
and next action after each gate. This packet itself is synthetic/offline only.

## Offline implementation checkpoint (candidate not frozen)

The assigned GPT-6 Sol/high author added the scoped pure selector/projection,
five focused pure tests, one installed-dependency-suite actual adapter control,
technical preparation documentation, changelog and retained limitations.
Node 22.16 and 24.15 focused commands ran all six tests successfully. The
adapter control uses two real temporary cores, 25 synthetic turns/two batches
per arm, scripted fake HTTP, both source policies, all five core model methods,
nonempty source-only answer receipts and both judge callbacks. Its observed
routes remain within the independently calculated full-reservation bound;
this is no semantic answer-quality evidence. The independent primary selection/
projection oracle also passed on both runtimes against the current helper bytes.
One later test-only strengthening asserts that the actual prefix plan retains
only the first 800 units while the indexed catalog includes the synthetic tail;
both keep the same capture batch count and projected ceiling. It changed no
runtime behavior, grant or source policy.

An earlier *test fixture* failed after reusing identical generated content in
the second batch (`qualification_conflict`). Varying that content then exposed
a fixture classification proposal that created a new L1 even though an existing
L1 was visible (`classification_failed`). The corrected fixture reuses that
existing L1 and passes. Neither failure established a helper/runtime defect;
both are retained here rather than silently converted into product evidence.
Primary personally reran the final offline matrix on Node 22.16 and 24.15:
budget 25, guard 227, live 361 total (331 passed and 30 existing explicit
opt-in skips), LongMemEval 128, generic 112, all five prescribed demos, JSON
validation and locally pinned Claude 2.1.260 strict plugin validation all
passed. After the tail assertion was added, primary reran the full LongMemEval
suite on both versions (128/128 each); the tested module and focused test
hashes matched the pending candidate bytes. The primary's independent
selection/projection oracle passed on both versions. Clean archive, fixed-diff
independent reviews, exact-head CI and any operational audit remain pending.
No real cohort, ledger, key, corpus or provider was accessed.
