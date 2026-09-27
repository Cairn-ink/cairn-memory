# Offline public benchmark comparison and scoring

Dependency: PR #182, fixed base `c644c97479e4e44056700a96720c5d49b31a909d`.
Design reference: PR #181 at `33faa0de036ed3600e2d1ec021fe351ea1840186`.
This packet is offline plumbing, not a live manifest or a quality result.

## Acceptance

- **OC1:** Add a separately versioned comparison API; preserve the legacy
  comparator/scorer and live pilot unchanged. Three fixed, serial primary arms:
  `cairn`, `full-history`, `no-memory`. Lexical remains a legacy diagnostic,
  not a mandatory fourth arm in this API. Inputs contain only prepared v2
  history/question, an explicit namespace/core and injected callbacks.
  Validate opaque metadata shapes before any callback. Real runs must use the
  digest-checked v2 loader; shape validation is not provenance authentication.
- **OC2:** Freeze a common answer instruction, question/date, model, output
  limit and compact JSON session-block evidence format. Full history preserves
  every original role/content/date and occurrence order. Preflight the complete
  serialized answer request plus reserved output with the injected counter and
  explicit context window before ingestion/answer calls. If full history does
  not fit, block all three primary arms without calls or truncation. Retain
  per-arm statuses and counts; counter values are estimates, not proof of an
  actual provider window. No default live transport or credential discovery.
- **OC3:** Cairn uses actual capture then explicit `contextMode: source-evidence`
  recall, with question date in the retrieval query, never in capture. Bind
  selected source receipts to the ingestion map using model-free `core.get`,
  validating namespace, revision, receipt completeness, ID, role and exact
  normalized bounded excerpt. No generated memory summary enters answer
  evidence. Unknown/mismatched/stale receipts block the Cairn arm. Do not use
  content similarity as identity. Keep source dates separate from admission
  time and disclose source-time-unaware capture. Evidence packing removes only
  whole selected receipt items, with explicit omissions and coverage.
- **OC4:** Shared answer callback is stateless by contract; calls are serial,
  single-attempt and time-bounded. Fresh namespace checked before capture.
  Record failed ingestion/recall/provenance/answer/timeout; never synthesize a
  successful answer. Usage is nullable and labeled answer-only. Capture/recall
  transport guarding and whole-pipeline spend remain a later packet.
  If an answer callback times out, block later arms without invoking them: an
  abort signal does not prove the underlying operation stopped.
- **OS1:** Add an evaluator-only compatibility adapter for pinned upstream
  `evaluate_qa.py` at `9e0b455f4ef0e2ab8f2e582289761153549043fc`.
  Match all six task rubrics and the `_abs` substring overlay, exact prompt
  bytes for supported string references, judge model `gpt-4o-2024-08-06`,
  temperature 0, max_tokens 10, n 1 and the upstream `yes` substring parser.
  Retain upstream attribution/license. Golden parity fixtures must originate
  from the pinned upstream function, not the JS implementation under test.
- **OS2:** Existing prepared JSON has lost numeric lexical/type distinctions
  relevant to Python formatting. For this packet reject non-string references
  as unresolved `reference_serialization_unverified` before a judge callback;
  do not guess numeric/array rendering or label partial compatibility complete.
  This restriction is explicit in docs/results and blocks any full official
  score until all actual reference types have verified parity.
- **OS3:** Scoring happens only after generation, using a separate evaluator
  record. Failed/blocked/missing generation never gets a fake hypothesis or a
  judge call. Single bounded judge attempt; timeout/invalid transport response
  stays unresolved. Retain the odd upstream parser behavior (e.g. `yesterday`
  contains `yes`) as compatibility, not an improved truth guarantee.
  After a judge timeout, later arms remain unresolved and unattempted; no
  potentially overlapping callback is started.
- **OS4:** Aggregate against a predeclared nonempty unique case roster and fixed
  three arms. Missing results remain unresolved; unexpected/duplicate IDs are
  rejected. Report resolved accuracy with coverage, fixed-N lower/upper bounds,
  per-type buckets including abstention, separate abstention overlay, and
  stage/reason counts. No complete official-style number unless every intended
  outcome resolves under verified compatibility; no fake failure sentinels.
- **OI1:** An integrated synthetic test/demo uses prepared v2 data and the real
  local core, spies on extract/select/rank/answer/judge separation, then scores
  all arms. Tests cover exact full-history fidelity, zero-call overflow,
  source-only context, receipt tampering, failures/timeouts, no-memory,
  official rubric parity, non-string blockers and fixed denominators.
- **OI2:** Primary reruns Node 22.16.0 and 24.15.0 generic tests, validate,
  LongMemEval suite and old ingestion/comparison demos plus the new integrated
  demo and strict plugin validation. No corpus download, real keys, private
  memory, paid calls, release or deployment. Independent Standards/Spec review
  on a fixed commit, then PR/CI. Do not alter #181 or #182 while Claude reviews.

## Ownership and interfaces

Comparison worker owns `public-comparison.mjs`, its tests and API docs.
Scoring worker owns `official-scoring.mjs`, parity fixtures/license, tests and
scoring docs. Both use separate isolated worktrees. The primary owns this
contract, cross-module integration acceptance, shared documentation and gates.
Implementation workers are Sol/high; independent reviewers are non-implementers.

The new run uses schemaVersion `cairn-longmemeval-public-comparison-v1`,
`questionId`, `question: {text,date}`, `answerModel`, and `arms`. Each arm has
`name`, `status` (`completed`, `failed`, `blocked`), nullable `reason`, and
nullable `answer: {text,usage}` plus comparison diagnostics. Scoring consumes
these named fields only and validates identity/status; additional diagnostics
are not model inputs. Evaluator keeps the existing prepared record shape.
Scorer API: `scorePublicComparison({run,evaluator,judge,judgeTimeoutMs})`;
judge callback receives `{request,signal}`, returns `{text}`. Request is the
exact provider-shaped judge request. Missing callback never means a live call.
Aggregate accepts explicit roster metadata plus completed scoring records;
unexecuted roster cases are unresolved rather than dropped.

## Verification record

Comparison and scoring implemented by separate Sol/high workers. Primary
integration added the synthetic demo/test and shared documentation/CI wiring.
One integration correction made the scripted classifier reuse its existing L1
instead of proposing a duplicate title on the second capture. This corrected
the test double, not production core behavior. Integrated LongMemEval tests:
59/59 on Node 22.16 before the full dual-runtime gate. The final SHA, complete
gate results and independent reviews are recorded in the delivery PR.
No score or measured semantic improvement is claimed; provider calls: zero.
Primary also corrected owned test-temp cleanup and added isolated duplicate
receipt coverage. Redispatch was unavailable (runtime agent-thread limit), so
these bounded acceptance corrections remained with primary. Independent Spec
review identified permissive judge response shape; the callback now requires
exactly `{text}` and mixed text/error objects remain unresolved. Both axes must
recheck the final corrected SHA.
Spec review also identified replayed empty captures: duplicate ingestion now
fails Cairn rather than being counted as a fresh capture. The memory-only
namespace precheck cannot authenticate absence of event history; a future
live harness must own newly created stores. Full-history fidelity does not
authorize private-data export or override redaction requirements.
