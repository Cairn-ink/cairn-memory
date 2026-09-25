# Qualified source-pair scoring and fixed-roster aggregation

Fixed base: `9402ae702b3b8836c6684db4a889acef34ee4b60` (qualified source-pair).
Branch/worktree: `test/qualified-source-scoring` / `qualified-source-scoring`.
Primary owns this contract. One GPT-6 Sol/high worker implements; two separate
nonauthor agents review Standards and Spec at the full original base.
Dependency PR #224 at the fixed base passed all 17 exact-head CI checks;
implementation is released. This does not authorize merging either PR.

This packet is offline only: no actual corpus, keys, operator ledger, paid calls, merge,
release or deployment. User's cumulative US$200 authority is unchanged.

## P1 — Separate API and trusted binding

Add `evaluation/longmemeval/qualified-source-scoring.mjs` exporting
`scoreQualifiedSourcePair` and `aggregateQualifiedSourceScores`. Do not relabel
a pair as a legacy three-arm run or widen existing official scorer acceptance.
Reuse imports of officialPrompt, officialJudgeRequest, parseOfficialJudgeText,
official constants and resolveReferenceRendering; never rewrite those prompts.

Scorer exact required options: run, expectedProtocol, evaluator, judge,
judgeTimeoutMs, execution. Optional referenceRendering only. judge may be
undefined (an explicit unresolved result), otherwise function. Timeout is a
positive safe integer <= 2147483647. execution exactly withCaseScope/isHalted.
Capture every caller property and port method once, clone data before validation
and before any callback. Preserve the nonserializable rendering token by
reference, not structuredClone; resolve it against the detached exact evaluator
before invoking any scope or judge. No model, prompt or template overrides.

Validate the full exact N protocol shape, all fields and canonical two names,
unique valid scopes derived from questionId+arm, actual policy/plan identities,
dense batch-digest arrays (equal lengths; hex digest or null), correct canonical
domain hash and common V2 settings. Exact run.protocol equality to the trusted
expectedProtocol is required before callbacks. Do not accept a digest merely
supplied by the result itself. The launch constructs expectedProtocol separately
from a frozen roster; offline validation is binding, NOT authenticity.

Validate N run's exact top-level schema and canonical two arms, all required
name/status/reason/answer/diagnostics fields, completed iff reason null and
answer text+usage shape valid, otherwise nonempty reason and null answer.
Validate finite nonnegative latency, fixed interpretation/time/coverage fields,
completed/null haltReason vs halted/finite haltReason, attemptedOrder unique
prefix of protocol.armOrder, completed scheduling has both attempted. A halted
run may have a previously completed arm. Validate retrieval coverage IDs and
packed subset whenever present; diagnostics otherwise remain non-oracular.

Finite generation reasons are the accepted N runner's SAFE_ERROR_CODES plus
namespace_check_failed, namespace_not_pristine, question_or_framing_too_large,
ingestion_failed, ingestion_incomplete, recall_threw, malformed_recall_response,
invalid_recall_provenance, source_get_failed, source_get_mismatch,
duplicate_receipt, unknown_or_mismatched_receipt, partial_receipts,
context_window_exceeded, malformed_answer_response, answer_output_too_large,
answer_timeout, answer_failed, case_timeout, arm_failed, global_halt,
scope_contract_invalid and scope_execution_failed. Reject not_started and
arbitrary error prose; do not export or widen old private validators to reuse
this finite set. Halt codes must agree with the report's halted scheduling.

Validate evaluator with the existing six exact fields and semantics: opaque
question/source identity, six types, unique session/turn labels, supported
string/finite-number/nonempty dense scalar-list reference. No labels reach N.

## P2 — Official semantics and separately scheduled judging

Reuse pinned upstream judge request and parser exactly, including its unusual
case-insensitive substring `yes` behavior. `_abs` source ID selects abstention.
Strings without a rendering capability are verified-string; valid capability
is verified-python-rendered. Numeric/list reference without that capability is
unverified-non-string and produces unresolved compatibility, zero judge calls.
Malformed/mismatched rendering rejects before any callback.

One scorer call uses N protocol.armOrder for exactly two scoring identities:
withCaseScope({phase:'scoring',caseId:descriptor.scopeId}, operation).
The campaign uses ONE guard for ALL generation scopes, then ALL matching
scoring scopes; the scorer does not construct or reset it. For nonhalted
generation, enter both scoring slots even if generation failed or reference
serialization/judge is unavailable, so the frozen guard schedule advances
without a paid request. No retries, hidden baseline or fabricated response.

Generation executionStatus halted: return two unresolved judgments at stage
execution/reason generation_halted; zero scope and judge calls. Retain each
generationStatus and do not rewrite saved generation evidence.

Scope checks match N's exact case-deadline-scope-v1 identity and phase scoring.
Only active permits judge. For completed generation, timed_out/blocked is local
case_timeout only when global isHalted is false. Invalid/throwing/nonboolean ports are sticky contract
failure. Check before/after judge; close local entry and callback fence on every
wrapper exit, including nonawaiting wrappers and late callback entry. Exactly
one operation invocation. Any wrapper exception halts remaining scoring with
finite reason; never expose error text or resume/retry. Already-running arbitrary
callbacks cannot be sandboxed. Future guard owns reservation/settlement/late HTTP.

The complete status-observation envelope is fail-closed: acquiring snapshot,
calling it, inspecting object shape and reading each returned field once all
belong inside contract-failure handling. A throwing getter/proxy or status
that changes when reread cannot be downgraded to ordinary judge failure and
permit another arm. Regression-test handle getters and returned-field getters.

Call judge once with request and AbortSignal; backup timeout aborts and yields
unresolved judge_timeout. Ordinary failure or malformed response yields
unresolved judge_failed/invalid_judge_response, and may continue only if the
scope exits cleanly. Save cloned safe result inside callback before return.
If scope exit fails, discard current judgment (unresolved execution), preserve
earlier successfully exited judgments, block later slots. A later global halt
never erases an earlier validated individual outcome. Future actual guard's
own deadline must beat backup timer; external abort is not promised isolated.

Failure precedence is explicit. Generation-wide halt skips all scoring as
above. Otherwise validate the exact scope and check global halt first; a global
halt, scope contract failure or wrapper exit failure overrides the current
judgment and fences later slots, preserving earlier successfully exited ones.
Within a valid, globally live scope, a noncompleted generation retains its
original safe reason at stage generation, attempted false, even if that scoring
scope is timed_out/blocked. The actual guard seals timed-out generation cases,
so their matching scoring slots are blocked by design; this is not a second
failure and must not hide the first one. For completed generation, local
timed_out/blocked takes precedence over compatibility or missing-judge outcomes.
With an active scope, check reference compatibility, then judge availability,
then invoke judge. Test failed generation with active, timed_out and blocked
scopes, plus malformed scope/global halt/exit failure overriding it. Also test
completed generation local timeout with unverified reference or absent judge.

## P3 — Closed score record

Schema `cairn-longmemeval-qualified-source-scoring-v1`; exact fields:
schemaVersion, protocol, sourceQuestionId, questionType, abstention,
generationExecutionStatus, executionStatus, haltReason, attemptedOrder,
compatibility, arms, latencyMs, interpretation.
executionStatus completed/halted describes scoring scheduling, not accuracy.
haltReason null or generation_halted/global_halt/scope_contract_invalid/
scope_execution_failed. Compatibility same referenceSerialization/upstreamCommit/
judgeRequest metadata as pinned official scorer. interpretation
`qualified-source-pair-official-style-not-a-product-reliability-guarantee`.
Arms canonical order, exact name/generationStatus/judgment/
referenceSessionCoverage. Judgment exact status/correct/reason/stage/attempted.
Resolved: completed generation, boolean correct, null reason/stage, attempted
true, verified reference. Unresolved: correct null, nonempty finite reason,
stage generation/compatibility/judge/execution and attempted boolean. Preserve
whether the actual judge callback was invoked, not merely a scope was entered.
For a noncompleted generation use its safe reason at stage generation and
attempted false. Compatibility failure has its exact reference reason and no
attempt. A preentry halt has attempted false; a postjudge exit halt has true.
ReferenceSessionCoverage uses retrieved/packed source session overlap with
answer_session_ids, or null when no references/diagnostics. It is not semantic
evidence recall or proof of causality. Never include reference text, answer text
or raw judge response in the scoring record. Deep-freeze all output.

## P4 — Fixed roster aggregate and honest paired denominator

Aggregator exact options roster, records. Roster nonempty dense entries exactly
protocol, sourceQuestionId, questionType. Each trusted protocol validated as P1,
source ID hashes to its questionId, type supported, no duplicate IDs. Require
common answerModel/template/qualification/limits/policy identities across
roster; order and per-case question/history/scope/payload bindings may differ.
Records dense, each exact P3 schema validated before counting, matches roster's
full trusted protocol/source/type/abstention; reject duplicate, foreign, old
schema, changed settings and logically inconsistent resolved/unresolved rows.
No arbitrary lenient mode. Missing records remain in denominator, not discarded.

Report distinct aggregate schema
`cairn-longmemeval-qualified-source-aggregate-v1`, fixedCaseCount,
scoredRecordCount, arms, common, completeVerifiedOfficialStyle, interpretation.
For each arm reproduce meaningful existing bucket fields: fixedN, resolved,
correct, incorrect, unresolved, accuracy (correct/resolved, null when none),
coverage resolved/fixedN, fixedNBounds {lower:correct/N,upper:(correct+unresolved)/N},
stageCounts/reasonCounts. Empty subtype buckets have null rates/bounds,
not a misleading zero score. Include overall, perType, abstentionOverlay;
macroSixTypeAccuracy only when all six types present and fully resolved.
The bounds are best/worst unresolved bounds, NOT confidence intervals.
Each arm object has exactly overall, perType, abstentionOverlay,
macroSixTypeAccuracy and completeVerifiedOfficialStyle. Empty buckets use
accuracy:null, coverage:null, fixedNBounds:{lower:null,upper:null}; an absent
abstention overlay is null. Aggregate interpretation is exactly
`qualified-source-pair-fixed-roster-accounting-not-a-competitive-or-product-reliability-claim`.

Common overall/perType/abstention only rows where BOTH arms resolved. Report
commonN and canonical byArm correct/incorrect/accuracy; commonN zero=>null
accuracy. Also report paired outcome counts bothCorrect, prefixOnlyCorrect,
indexedOnlyCorrect, bothIncorrect (sum=commonN). No statistical significance,
noninferiority, competitive parity or promotion threshold from this packet.
An individual score retained before scoring halt remains in its arm totals;
the incomplete pair never enters common. Interpretation must state offline
accounting, not paid authorization or general benchmark/competitive result.
Common's exact keys are commonN, byArm, pairedOutcomes, byType and
abstentionOverlay. Per-type/abstention common buckets have only commonN, byArm,
pairedOutcomes. pairedOutcomes has exactly the four named counts above;
byArm entries have exactly correct, incorrect and accuracy.

Validate scheduling consistency, not just field types: a generation-halted
record has no scoring attempts or resolved judgments. A scoring-halted record
may retain only previously exited resolved judgments, never an unattempted
resolved arm or a post-halt later arm. attemptedOrder is the unique prefix of
declared armOrder; completed scheduling enters both. Unknown stage/reason
combinations, resolved unverified references and malformed compatibility or
coverage arithmetic reject. Interpretation/output binding cannot authenticate
an arbitrary forged report or prove model/core construction.

Independent read-only Sol/high feasibility input (checkpoint212,2026-09-25):
officialPrompt/request/parser are reusable pure seams; old scorer/aggregate
hardcode three arms and coupled timeout policy, so must not be called by the
pair wrapper. judgeOnce's Promise.race abort is not settlement; future actual
guard requires successful exit with no in-flight records. Reference token is
WeakMap-backed and must not be cloned. Primary traced these actual seams and
incorporated them above; this input is not a completed implementation review.

## P5 — Evidence and exclusions

Synthetic real N outputs for both orders feed scorer; inspect exact official
request and no oracle exposure during generation. Cover all six types and
abstention; string/non-string verified Python sidecar and forged-token refusal;
unknown fields/duplicate arms/foreign scopes/config/history/digest mutation
reject before ports; all failures vs wrong, local/global timeout priority,
wrapper before/during/after, double/no/late/nonawaiting invocation, snapshots,
late replies, independent golden counts and old scorer/aggregate refusal.
Use actual existing sidecar loader with synthetic fixture files, no corpus.
Independent aggregate golden: three frozen cases; case1 both resolved prefix
correct/indexed wrong; case2 prefix wrong/indexed unresolved after halt; case3
missing. Prefix correct1/incorrect1/unresolved1, indexed0/1/2; commonN1,
prefixOnlyCorrect1. At N3 fixed bounds prefix1/3..2/3, indexed0..2/3.

Allowed new scorer, at most one small private validation/helper module,
focused tests, technical pair docs, CHANGELOG, limitations and this plan. No
core/ingestion/adapter/guard/ledger/live/host/default/dependency changes. Avoid
exporting legacy private validation just to widen API; report necessary shared
seam changes to primary before touching old runtime.

P5 test-suite ownership correction, frozen before implementation: keep pure
scoring and aggregate tests in LongMemEval without requiring adapter packages.
Move the actual scoped-guard/fake-HTTP regression into the existing live-offline
suite, whose required CI already installs its adapter dependencies. Preserve
every integration assertion and run it on both runtimes; never skip or replace
the real guard. A clean tracked snapshot without adapter packages must pass
LongMemEval and its three demos; the installed live-offline suite must execute
the moved case. No workflow, contributor prerequisite, package, lockfile,
runtime or paid-grant change is permitted by this correction.

Both Node22.16/24.15: focused, full LME/live/request-guard/generic, 3 LME demos,
JSON and verified pinned Claude2.1.260 strict, diff hygiene. Primary actual diff
inspection/reruns then independent Standards and Spec same original base and
final SHA. Exact-head all CI and mergeability before ready; no merge.

Delivery is a dependent PR against `test/qualified-source-pair`. No actual
operational cap extension belongs here. Before a later paid phase, independently
verify remaining budget and any safe US$100→200 immutable chained transition;
never reuse/overwrite the old single-transition capability. Passing this scorer
is not paid-run authorization. Keep old terminal six/30-case experiments closed.

## Implementation checkpoint (offline candidate, not acceptance)

`evaluation/longmemeval/qualified-source-scoring.mjs` owns only the new P scorer
and aggregate exports. Its LongMemEval focused test uses actual scripted N
reports in both orders, official request construction, evaluator-bound Python
sidecar rendering and independent three-case fixed-roster arithmetic; the
live-offline focused test owns synthetic scoped-guard fake HTTP/temporary ledger
settlement. Existing N, legacy official scoring,
production core, live routes and guard entrypoints are unchanged. This is
interface compatibility evidence, not semantic relevance or a transport grant
for indexed capture.

Historical pre-suite-split worker-local checks on Node 22.16.0 and 24.15.0:
full LongMemEval 124/124;
offline live evidence 320 pass/30 opt-in skips; experiment request guard
170/170; generic 112/112; three LongMemEval demos, JSON validation and
locally pinned Claude Code 2.1.260 strict plugin validation pass. Independent
review, exact-head CI, mergeability and any actual paid comparison are not
claimed by this checkpoint.

Correction checkpoint: the primary's additional behavioral probe against the
initial `45c4171` candidate found that a forged
`scope_execution_failed` aggregate row with both judgments resolved was
accepted, even though a wrapper exit failure must discard its current slot.
The narrow validator now requires an unresolved execution row with that
reason. Synthetic tests exercise both declared orders, wrapper failure before
or after entry in either slot, preservation of an earlier clean correct/wrong
judgment, and refusal of the fully resolved forgery. Cleanly exited judgments
followed by `global_halt` or `scope_contract_invalid` remain permitted. This
is a record-consistency correction, not evidence that arbitrary injected
scoring callbacks are authenticated.

CI test-suite ownership correction: the first pushed `6679e1f` candidate's
LongMemEval job failed to import `tiktoken` from `adapters/openai/index.mjs`.
Its actual synthetic scoped-guard regression imported the adapter, but that
isolated suite intentionally had no adapter dependency install. A clean
tracked-file snapshot outside ancestor `node_modules` reproduced
`ERR_MODULE_NOT_FOUND` on both Node 22.16.0 and 24.15.0. An unpublished
`ee96e7f` candidate tried adding the pinned adapter install to CI and
CONTRIBUTING; its push was refused because the available OAuth permission
cannot change workflow files. No credential or authorization was altered.
The final correction restores those files byte-for-byte to `6679e1f`, moves
the complete actual fake-HTTP guard regression into the already-installed
live-offline suite, and leaves only pure scorer tests in LongMemEval. A clean
no-adapter snapshot passes focused 15/15 and full 123/123 LongMemEval, three
demos, generic 112/112 and JSON validation on both runtimes. The installed
live suite passes 351 total (321 passed, 30 opt-in skips) on Node 22.16.0 and
24.15.0. Exact-head CI is still required; no runtime, lockfile, provider or
transport grant changed.
