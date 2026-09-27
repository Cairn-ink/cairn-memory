# Controlled mixed comparison — prospective integration contract

DRI source-only decisions, 2026-09-27. This is NOT a paid launcher, corpus
preparation authorization or final experiment freeze. Implementation dispatch
waits for accepted Y16 and R10 and an explicit integrated base SHA. No old
experiment helper, holdout, evaluator label, provider key or operational ledger
was used to derive this contract. P242 and K240 are already accepted components;
Y and R must finish their current correction/review gates.

## Outcome and bounded scope

One complete offline-verifiable Cairn/native-Mem0 generation and official-style
scoring path, with identical source batches, question/cutoff, answer instruction,
answer model, context/output cap and judge. It preserves every selected question
and distinguishes wrong answers from unresolved execution. It is a controlled
profile comparison, not a defaults comparison or upstream leaderboard score.

Three narrowly named modules under evaluation/longmemeval:
mixed-answer.mjs, mixed-generation.mjs, mixed-scoring.mjs, their focused tests,
one synthetic demo, tracked plan and narrow comparison/limitations/gate docs.
The generation module may expose a thin transport factory around the supplied
X guard; it must not create a second guard, ledger, session or authorization.
Do not rewrite core retrieval, existing official metrics, source rendering,
old runners, ledger, prices, native gateway or historical results. Exact allowed
files and required dependency gate commands are frozen at dispatch.

## Source and profile binding

- Use actual P prepareMixedSourceCase({history,question,namespace}) unchanged.
  Recompute planIndexedWindowLongMemEvalCase over frozen renderedHistory and
  deep-compare with P.cairnPlan BEFORE any capture. Feed its ordered messages
  to actual indexed ingestion and exact P.mem0Input to actual Y. P errors remain
  fixed-N preflight outcomes; neither arm gets source fragments or a fallback.
- Before native work, reproduce installed native parse_messages byte layout
  (role + ': ' + content + '\n') and count each batch with pinned cl100k_base;
  exceeding W's singleton8192 bound blocks both arms explicitly. No one-arm
  rebatching or post-answer source policy adjustment. Dynamic native prompts
  still face W's runtime caps; this preflight is not completion assurance.
- Fixed Cairn constructor: captureQualification source-bound-v2,
  captureSourcePolicy indexed-windows-v1, sourceCandidatePolicy bounded-keyset-v1.
  No rationale/evidence add-ons or new capture-deadline override. Model adapter
  qualificationInputMode adaptive-text-catalog-v1; existing pinned model IDs.
  Recall query exactly P.mem0Input.query; limit6, contextMode source-evidence,
  selectionMode bounded-source-scan. Bind BOTH distinct keyset/selection choices.

- Native Y topK6, threshold0, unchanged inferTrue and no-NLP verified profile;
  HTTP timeout equals the supplied X capability. Child deadline must be a
  documented positive fixed value <=Y cap, frozen before source preparation.
  Bind exact Y configuration/source/dependency digests, P policy, actual Cairn
  artifact/configuration and common answer/scorer policies into X's manifest
  and each roster protocol digest; reject mismatch before provider calls.
- One fresh private Cairn store and Y private native store per case; no previous
  corpus/store/child reuse. Use original opaque prepared-v2 question identity
  and X's scope-ID hash rule; arm order supplied in frozen roster, not chosen
  from outcomes. Freeze all source-facing rows before asynchronous work.

## Shared answer bytes and honest evidence

- Exact request key order model,messages,temperature,max_tokens,n; existing
  PUBLIC_ANSWER_INSTRUCTION unchanged; user content exactly
  JSON.stringify({evidence:[{text}],currentQuestion:{text,date}}), with original
  question text and P.canonicalQuestionDate. Model gpt-4.1-mini-2025-04-14,
  temperature0, max_tokens512, n1; contextWindow123000, answerTimeoutMs200000.
  Thin transport adds existing store:false,stream:false; both arms identical.
- One Cairn unit is a recalled card's verified authoritative receipt excerpts
  in returned order, joined with exactly one newline. Authenticate via actual
  core.get, complete receipt count/revision/active namespace/client/session/role,
  and equality to P's submitted indexed windows. No summary/fact substitution.
  For identical excerpt matches retain ALL matching coordinates/classifications
  privately. Never fabricate a unique raw-source span or call metadata a quote.
- One Mem0 unit is its returned memory string unchanged, preserving native
  order; no provenance oracle join. IDs/scores/attribution/origin diagnostics
  stay outside answer text. The two evidence types are not equivalent merely
  because the outer JSON is identical.
- Exact-string first-seen deduplication, whole units only, stable order. Measure
  the complete serialized request with existing countOpenAITokens plus reserved
  output512. If one unit does not fit, record budget omission and try the next.
  Distinguish duplicates from budget omissions. Empty valid retrieval is a valid
  empty-evidence answer, not a failed case. Question-only overflow stays unresolved.
- P's once-per-message date can be absent from a later800-unit receipt. Test
  and disclose this; do not attach an unretrieved date from the origin sidecar.
  Both arms saw the same dates at ingestion; retention is part of the outcome.

## Schedule, cancellation and accountability

- Accept actual trusted supplied X guard/capability and Y artifacts, not arbitrary
  child-supplied authority. Constructor/template shape checks are not a sandbox
  against hostile same-process JavaScript. No public callback may assert reaped,
  settled, paid-authorized or successful-native state.
- Execute EXACT X schedule: ALL generation scopes for fixed roster/arm order,
  THEN ALL scoring scopes. P preflight errors and no-answer cases consume zero-
  dispatch scheduled scopes where possible. X may auto-block scoring for sealed
  generation. Never skip an ordinal to advance, fabricate a consumed guard
  outcome, replace a case, resume or replay. Global halt fills remaining report
  slots as unresolved without attempting later scopes.
- Use actual openMemoryCore/createOpenAIModel and actual Y for production path;
  no test bypass exported publicly. Synthetic fake provider exercises real
  integration; private test seams may verify failures but must be labeled.
- Local failure advances only after X/Y cleanup and settled accounting. Unknown
  usage outside the authenticated M7b local-timeout exception, identity drift,
  unreaped child, unsettled attempt or swallowed global
  error stops globally. Preserve first cause and no late callback progression.
  Closing a fresh store must wait for its in-flight work; never unlink a live
  SQLite store to make cancellation appear complete.
- Final answers must satisfy bounded response shape/output tokens. Truncation,
  malformed response, timeout and rejected provenance are explicit unresolved
  reasons, not incorrect-answer verdicts. No last-plausible-string parser.
- Diagnostics separate stored/admitted, retrieved, packed and answered stages,
  actual request/reservation counts, safe failure codes and private provenance.
  Do not put raw source/reference/key text in errors or public summaries.

## Scoring and reporting

- New narrow two-arm records, not relabeled three-arm or two-Cairn outputs.
  Reuse officialPrompt, officialJudgeRequest, parseOfficialJudgeText unchanged,
  including six categories/abstention and upstream substring-yes behavior.
  Judge gpt-4o-2024-08-06; same existing token/time/guard ceilings. No custom
  rubric or retry. Labels enter only after ALL generation outcomes freeze.
- Use resolveReferenceRendering with evaluator-bound verified capability for
  non-string original answers; absent capability is unresolved compatibility,
  never JS coercion/JSON rendering. String references preserve exact text.
- Report fixed N per arm: correct, incorrect, unresolved; correctness/fixed N,
  resolved-only accuracy (null when none), resolved fraction. Also common paired
  resolved N, full3x3 outcome table and per-category counts. Do not call unresolved
  incorrect or silently shrink N. These are diagnostic counts, no new readiness
  threshold or population inference. Reuse agreed paired statistical procedure
  later, not an improvised confidence interval here.
- R remains conditional planning arithmetic, never a launchReady predictor.
  Actual spend/billing unknowns must remain distinct from reservation ceilings.

## Required offline acceptance

Exact payload golden tests for BOTH arms; source-plan recomputation mismatch
before capture; long/Unicode/role/date cases and >8192 native preflight denial;
authenticated/forged/partial/stale/ambiguous receipts; metadata-origin and absent
date header; duplicate/oversized/empty evidence; question/output bounds; frozen
data mutation attempts; full generation-then-scoring both arm orders; local
seals and global stops at every stage; zero-call preflight schedule slots;
failed/skipped judge and non-string references; independent fixed-N/3x3 golden.

Actual fresh Cairn and real pinned native Y through X and fake HTTP on BOTH
Nodes22.16/24.15, plus synthetic module tests and all current contributor gates.
Primary independently reruns integrated key paths; nonauthor Standards and Spec
on final same fixed-base SHA; exact-head CI before ready. Retain all failures.
No paid calls, no operational ledger mutation, no holdout preparation in this
packet. Separate accepted launch/resource freeze remains required afterwards.

## Dispatch choices still to freeze

Integrated base SHA and artifact representation; exact exported factory/function
signatures and serialized report schema; native child deadline; bounded roster/
source/report limits; explicit core close/cancellation ownership; minimal gate
commands and safe synthetic protocol fixture. Resolve before implementation,
not by worker guesses. These are DRI engineering choices, not user blockers.

## DRI API audit disposition, before any implementation

Accepted source-only audit choices:

- Public APIs are packMixedAnswer({question:{text,date},units,countTokens}),
  prepareMixedComparison({sourceCases,armOrders,nativeArtifact,
  nativeConfiguration,cairnRuntimeArtifactSha256}),
  runMixedGeneration({prepared,guard,apiKey,cairnStoreRoot}),
  scoreMixedGeneration({generationReport,evaluatorRows,
  referenceRenderings,guard,apiKey}). Packing uses fixed shared settings; its
  injected counter is a trusted synchronous pure port, not paid transport.
  All provider transport in generation/scoring goes through the supplied guard.
- sourceCases are ordered exact {history,question,namespace} source-only rows;
  no evaluator, reference, caller coreFactory/nativeRunner/judge bypass.
  nativeConfiguration is the actual factory identity, not deserialized JSON.
  Use actual adaptive-text-catalog model construction. Do not invoke old session
  factories that create their own guard or ledger.
- prepareMixedComparison is the one pure pre-grant derivation point. It returns
  frozen serializable manifest/roster/resource counts plus an opaque in-process
  prepared identity holding the exact P plans/native identities. No ledger,
  key, provider or guard construction. X validates but does not derive the
  caller's protocolDigest; compare exact resulting manifest/roster before work.
  Reproduce its private scope-ID formula only here and test an independent
  golden accepted by actual X. Do not misuse the older adaptive two-Cairn digest.
- Native childTimeoutMs is 3600000 (Y's maximum), httpTimeoutMs equals X's
  capability limit. This avoids adding an arbitrary shorter censoring limit;
  it is a native lifecycle safety cap, not a matched end-to-end latency or
  completion promise. Existing finite core/model/HTTP limits remain unchanged.
- Scope outcomes and runner outcomes are different fields. A private generation
  report binds schemaVersion, manifest/roster/protocol digests and fixed ordered
  cases. Each case retains questionId, caseDigest or null on failed preflight,
  preflight status and exactly cairn/mem0 arm records. Each arm has
  status completed|failed|blocked, safe reason, answer or null, actual scope
  {ordinal,status,reason} or null, and private bounded diagnostics. scope:null
  means not entered after global halt; no invented consumed guard outcome.
- Scoring binds exact generation report digest, preserves all fixed rows, and
  records generationStatus plus judgment {status:resolved|unresolved,
  correct:boolean|null,stage:generation|compatibility|judge|null,reason,
  attempted:boolean} and actual scoring scope or null. Aggregates keep fixedN,
  common paired resolvedN, six categories and3x3 counts. Serial report validation
  is not an authority token or proof a caller really ran a provider.
- X manifest has a closed shape: bind actual K/selection options in the existing
  canonical versioned context/config digest slots, not new manifest fields.
  Native configuration and artifact identities remain checked by actual Y.
- Core close() is synchronous and does not join work. Runner must own and await
  each capture/recall/answer operation and the guard's terminal accounting before
  close or progression. A timeout must revoke; never race-and-abandon and delete
  SQLite underneath a pending call. Underlying model transport may outlive a core
  timeout; unsettled guard state is global and blocks all later scopes. This
  packet must test that real integration seam, not only fake return values.

Outstanding before dispatch: exact integrated base and finalized serialized
schema/bounds, tracked acceptance copy, required actual integration gate setup.
No source/holdout/label/ledger/key access or paid authorization results from
this API decision. S2 development and S3 one-shot freeze remain separate.

## M1–M12 dispatch freeze (supersedes the draft/outstanding paragraphs above)

Frozen before implementation at integrated base
30bd041d231d12441cc1568dd17814a812136ada, branch
feat/mixed-comparison-runner, sibling worktree mixed-comparison-runner.
Base is Y6d5d426 plus scoped accepted K/P/R cherry-picks; no public merge.
The implementation author owns all new module/tests/docs files; primary owns
integration, contract clarifications and independent acceptance. Actual worker
model G6 Sol/high; no model-label inference about cost.

M1 Scope: three named production modules above, optional one private shared
mixed-validation.mjs and one mixed-transport.mjs if needed to avoid duplicated
boundary logic; one private mixed-evidence.mjs may extract the existing receipt
verifier unchanged for direct forged/stale/partial/ambiguous receipt tests.
Production must invoke that same verifier; no public coreFactory/native bypass.
test/mixed-{answer,generation,scoring,evidence}.test.mjs, private
testing/mixed-fixture.mjs, and explicit local testing/mixed-native.test.mjs.
One mixed-demo.mjs; package scripts; this plan, CONTRIBUTING.md, ROADMAP.md,
docs/limitations.md and docs/longmemeval-comparison.md; existing CI may add the
synthetic demo only. Do not alter core, adapter, P/R/X/ledger/judge algorithms.
Any required Y identity accessor must be approved by primary first.
No provider, corpus, actual ledger, holdout or old experiment entrypoint.

M2 Inputs: sourceCases is a dense 1..250 array of exact source-only row shapes;
armOrders is a same-length dense array of permutations of ['cairn','mem0'].
All question identities must be valid opaque IDs and unique before any work;
invalid top-level identity/shape aborts preparation, not a fabricated case.
Once identities are known, P failures remain per-case preflight outcomes.
Aggregate source traversal maximum 128 MiB UTF-8 strings/keys, 2,000,000 nodes,
depth20, own enumerable JSON data only/no accessors, width checked before
descriptors. Each P case still enforces its own tighter bounds. Question text
maximum 16 KiB UTF-8 (P query bounds may be tighter). No getters invoked.
These are finite evaluator host bounds, not benchmark eligibility claims.
Deep-snapshot before async work; source labels are never accepted.

M3 Preparation returns an immutable opaque identity whose enumerable public
projection is exactly {schemaVersion,manifest,roster,counts,preflight}.
schemaVersion 'cairn-lme-mixed-preparation-v1'; counts contains fixedN and
batchCounts in roster order (0 on failed preparation); preflight rows exactly
{questionId,status,reason,caseDigest}, status ready|failed, nullable reason/
caseDigest consistent with status. Private WeakMap holds original P results,
namespace, original question and native opaque objects. No caller mutation
or JSON reconstruction can turn into an executable prepared identity.
Use canonical sorted-key JSON and SHA256([domain,value]); scope IDs use the
EXACT X pairHash domain/formula. Source manifest digest is P policy digest.
Context/answer/scorer/config domains are individually versioned v1 and bind all
fixed values above, including runtime profiles, policy identities and limits.
Case protocol digest binds manifest, original question, namespace, P case digest
(or preflight failure with safe reason), armOrder and normalized preflight status.
Source preparation is not grant issuance or paid readiness.
cairnRuntimeArtifactSha256 is a trusted host-supplied revision descriptor, NOT an
attestation of local files. Manifest/profile equality is checked before calls;
the later launcher must independently establish the descriptor. Disclose this.

M4 Native configuration must be topK6/threshold0/childTimeout3600000 and the
actual Y factory configuration; HTTP timeout matched against X before work.
Pre-dispatch validation must detect invalid artifact/config identity or changed
files before either arm can call a provider. Recheck per native case via Y.
Native static joined-input 8192 cl100k bound is a shared preflight failure.
No fallback/one-arm split. No native/reranker/graph/NLP policy changes.

M5 packMixedAnswer takes exact {question:{text,date},units,countTokens}.
units are dense 0..6 exact {text} objects, nonempty well-formed strings,
each <=1 MiB UTF-8; no embedded metadata fields. Return immutable
{request,inputTokens,reservedOutputTokens,totalEstimatedTokens,selectedIndices,
duplicateIndices,omittedIndices}; indices refer to input order. Question-only
overflow is explicit error. Fixed settings above, zero injected transport.
Scoring/output and generation report validators must enforce well-formed
strings, finite safe numeric counters, dense arrays and status consistency.

M6 Generation report exact top-level shape:
{schemaVersion,manifest,roster,manifestDigest,rosterDigest,cases,halted,haltReason}.
halted is boolean; haltReason is null iff false, otherwise the first fixed safe
runner-global failure code. Never replace it with a later cleanup symptom.
schemaVersion 'cairn-lme-mixed-generation-v1'.
cases preserves fixed roster order; each exactly
{questionId,question,caseDigest,preflight,arms}.
question {text,date} retains original text and canonical date if P passed,
otherwise original date; preflight {status,reason}; arms in canonical cairn/mem0
order regardless of execution order, each
{name,status,reason,answer,scope,diagnostics}.
answer null or {text,usage}; text <=32 KiB and <=512 counted tokens;
usage is validated {inputTokens,outputTokens,costMicroUsd}, never invented.
scope null or actual {ordinal,status,reason}; failures after entered global halt
retain observed scope (which may still say active), not a fabricated completion.
diagnostics is a bounded private object with stage counts, packing indices,
safe reason codes, actual attempts/reservations and provenance mapping.
Do not copy raw provider errors/headers/configuration keys.
No more than 6 returned evidence units; provenance max384 receipts, each max64
matching coordinates. If ambiguous matching exceeds cap, fail provenance,
never silently select one. Match source.client/session/role/full revision and
all authoritative receipts; dates from origin map do not enter answer prompt.

M7 Await tracked guard transport promises in a finally boundary inside each scope,
including transport started by the actual adapter that outlives its core-level
timeout. On local semantic/model timeout, revoke before draining; never advance
or close store while such work remains. A rejected/global/unknown guard state
retains its halt; never convert it to local by swallowing exceptions. Do not
add another retry or make a timed-out core resume work. A trusted fake transport
that never settles is a test-only failure probe; the test must itself release
it after proving next arm/store-close hasn't occurred.
The guard may race an abort-ignoring physical fetch; its guarded promise can
settle before that physical promise. The runner cannot attest physical settlement.
Await the actual core capture/recall operation and owned guarded adapter work,
then scope/accounting completion before closing the core. The late physical
fetch has no core DB handle. Unknown outside M7b halts later scheduling; release
the physical promise afterward and prove no late calls or database progression.
The earlier test sentence requiring release before store-close is superseded by
this observable distinction: store-close waits for core+scope settlement, not
an inaccessible physical-fetch promise. Preserve this limitation in docs.
Use a fresh mkdtemp child under the explicitly supplied synthetic/private
cairnStoreRoot (validated directory, not symlink). Never use/overwrite a caller
file as store, never recursively delete uncertain/live stores.
Only supplied guard owns ledger lifecycle; runner does not close the guard.
Use one-shot prepared identity (second generation invocation fails before work).

M8 Completion transports require exactly one assistant choice, stop (not length),
bounded text, expected model, valid usage; use existing guard count/accounting.
Answer timeout200000, judge existing finite stage/guard timeout; no added retry.
No answer from invalid provenance, local failed capture/recall or blocked scope.
Empty valid recall is allowed. Handle Y's actual nested status/value result;
verifiedAddRecords is not unique or proven-source-correct memories.
Preserve completed answers if later arm fails globally.

M9 Scoring receives the frozen generation report; verify exact manifest/roster
against supplied guard and every report ID/order/status before first call.
Serialize/freeze validated report once and hash canonical versioned JSON.
evaluatorRows are prepared evaluator rows, exact same fixedN/order and opaque/
source ID binding with the existing six types and abstention naming rule.
referenceRenderings is a Map of questionId to existing verified capability or
undefined for string-only cases; it is never serialized. Read labels ONLY in
this scoring call after all generation. No rescoring on same guard/schedule.
Per-case scoring rows contain {questionId,questionType,arms}; each
{name,generationStatus,judgment,scope}, judgment fields as above.
judgment.attempted means an actual guard-reserved judge attempt exists for that
scoring ordinal; merely entering its callback or rejecting a request before
reservation is not attempted. This is not a claim that the provider received
or billed a reserved request. Derive it from actual guard attempts, not catch
control flow. An X auto-blocked scoring scope still consumes a real ordinal;
retain that scope even though its callback was not invoked.
Top level {schemaVersion,generationDigest,cases,summary,halted,haltReason}, with
the same boolean/nullable-first-safe-code rule as generation; schemaVersion
'cairn-lme-mixed-scoring-v1'. Summary exactly fixedN, perArm, commonResolvedN,
outcomeTable (3x3 canonical correct/incorrect/unresolved), byCategory.
Each perArm count includes correct/incorrect/unresolved, accuracyFixedN,
accuracyResolved (null if denominator0), resolvedFraction. byCategory contains
all six categories even empty; no disappearing cases. No reference/source in
summary. Non-string references without exact verified capability unresolved.

M10 Report detachment maximum32 MiB UTF-8, 500,000 nodes, depth24; reject
accessors/symbols/sparse arrays/nonfinite values; input limits before deep copy.
Scoring checks semantic consistency, not merely shape. Serialized reports are
data rather than execution attestations; same-process hostile code is excluded.
Any report-cap overrun is explicit failure, never silently truncated evidence.
Use safe hardcoded failure codes. No generation model sees evaluator fields.

M11 Required evidence: full listed offline acceptance plus actual native mixed
integration with installed Y and real fresh Cairn under X/fake HTTP on both
Node22.16.0/24.15.0. New explicit script test:mixed-native-local points outside
ordinary test glob; missing prerequisites FAIL, no skip-as-pass. Ordinary module
tests use synthetic artifacts only where labeled, not counterfeit native success.
Both runtimes: npm test, npm run validate, npm run test:longmemeval and all three
existing LongMemEval demos plus mixed demo; test:experiment-request-guard,
test:experiment-budget, both their demos, test:mem0-native-gateway and explicit
native local Y+mixed gates, test:core + demo:store/demo:recall (integration K),
test:openai + demo:openai-offline, strict pinned plugin validation.
Install isolated dependencies normally from lockfiles. Heavy suites SERIAL;
coordinate primary slot. Read current CONTRIBUTING/CI/package before gates.
Retain first failure logs; no success claim from unexplained green rerun.
Before commit report contract coverage and unresolved actual gaps.

M12 Two nonauthor final-diff reviews relative to integrated30bd041, primary
actual-diff inspection and independently run combined key paths. Current branch
base already includes reviewed components, but integration claims need new
verification. Scoped candidate commit only; author MUST NOT push/PR/merge.
Primary creates dependent PR after acceptance, monitors exact-head CI.
No public claim of new semantic score or launch authorization from these gates.

### M4a approved narrow Y accessor (preimplementation API audit)

Allow evaluation/experiment-budget/mem0-native-gateway.mjs and its existing
portable tests to add checkedMem0NativeConfiguration(descriptor). It returns
the original frozen descriptor after the existing WeakMap identity, current
child SHA, configuration digest and wire profile checks, sharing the check
with runMem0NativeCase. Existing in-scope failure MUST still call handle.halt()
with the original safe reason semantics. The accessor alone creates no scope,
grant, transport or new identity. Preparation stays pure: it retains native
objects without claiming validation. runMixedGeneration must call both checked
artifact and checked configuration before any arm scope/provider work; failures
there abort before dispatch. Tests must prove forged equal-value clone and
changed artifact/config cannot trigger even the first Cairn provider request.
Actual identity/current-file validation is a pre-dispatch filesystem check,
not a property of serial manifest hashes. M7c below additionally authorizes the
observed local transport deadline correction.

### M7a unknown usage and declared reserve-only observations

X may locally seal a timeout while retaining an unknown-priced terminal attempt.
The runner's stricter comparison policy examines CURRENT guard.attempts(), not
historical ledger attempts: outcome null or unknown outside the authenticated
M7b local exception stops later scheduling. A null
actualMicroUsd is permitted ONLY for a succeeded cairn-count attempt (the count
endpoint provides no billed usage), or a failed mem0-embedding attempt under
X/Y's already-declared embedding HTTP5xx fallback policy. These are terminal
reserve-only observations, not zero-cost calls; preserve their full reservation
and unknown actual cost. Every other null-actual attempt stops globally.
Test normal successful count and declared batch fallback as positive controls
alongside the timeout unknown negative; do not make normal Cairn capture halt.
Halt through the active handle when discovered inside a scope; if
discovered only after scope exit retain a runner-global halted report and never
enter later scopes. Do not relabel X state or historical unknowns. Preserve
actual scope outcome and stop reason separately. The local timeout positive
and malformed-usage global negative are specified in M7b below.

### M7b preserve already-authorized single-case timeout isolation

This corrects the earlier draft's overly broad unknown-stop wording. The user
explicitly authorized single-question timeout isolation; accepted X10(c,d)
already records authentic deadline/cancellation as local failed with full
reservation retained. The runner must not silently undo that policy.

An unknown terminal attempt is locally tolerable ONLY when its own ordinal
belongs to an authentic X generation/scoring scope with status failed and
reason deadline or cancelled, X is not globally halted, all guarded accounting
is terminal, and actual core work/owned guarded promises (or actual Y child/
gateway cleanup) have completed. Use actual handle.snapshot/guard outcomes and
final withCaseScope result, not error.code or caller-fabricated report state.
The returned result must match actual caseOutcomes and caseScopeSnapshot at
that ordinal/phase/arm. Do not invoke revoke merely to relabel an arbitrary
transport error as cancellation; X's authentic existing cause and global latch
remain authoritative. Finalize acceptance of an ordinal only after scope exit.
The runner may record authenticated completed local ordinals for subsequent
checks; an earlier allowed failed ordinal must not poison a later valid case.
Full reserved cost remains consumed, actual cost stays unknown, failed arm has
no answer/judgment, its scoring is blocked by X, and no replay is introduced.

Unknown caused by malformed usage, ambiguous transport failure, changed
identity/history, failed settlement, unfinished guarded/core work or Y cleanup
fault remains global, including when it coincides with a local deadline. X's
global halt always wins. An active/pending attempt is never advanced past.
Count success and declared embedding fallback exceptions from M7a still apply.
The positive timeout test must prove the next predeclared arm runs exactly once;
the malformed-usage negative must prove no later arm/judge runs. Also exercise
pre-existing global fault plus deadline, late completion after closed scope,
and an earlier accepted local timeout followed by normal count/generation.

Physical fetch settlement remains unobservable as documented in M7. After the
authentic core/scope boundary, close is allowed while abort-ignoring physical
fetch remains pending; its later resolution must not dispatch or write. Only
the trusted scope-owned/fenced call chain permits this, not arbitrary callbacks.

### M7c authoritative provider deadlines, separate local transport grace

DRI correction after real native integration failed, before candidate freeze.
Equal child SDK, gateway socket and X provider deadlines start at different
times. The child or socket can expire first and correctly trigger a global
unknown; this prevents the intended authentic X single-case deadline isolation.
Retained narrow probes: equal timers raced; child-only +5000 ms remained RED;
child and socket +5000 ms passed. Root independently reproduced the original
RED. No unknown exception or retry is authorized as a workaround.

Keep configuration.httpTimeoutMs equal to capability.limits.mem0TimeoutMs and
all X provider/model deadlines, costs, reservations and classifications unchanged.
Add a fixed, hash-bound timeout policy `x-provider-local-transport-grace-v1`,
localTransportGraceMs=5000 and localTransportTimeoutMs=httpTimeoutMs+5000.
Use the derived local timeout ONLY for child SDK/httpx and gateway idle socket
waiting. Keep header and body/request receive limits, whole-child deadline,
kill/reap limits, socket framing/connection bounds and zero retries unchanged.
This is bounded local IPC/cleanup allowance, not extra provider execution time.
Extreme scheduler starvation, slow upload or ambiguous local failures can still
halt globally; do not claim a hard cross-process scheduling guarantee.

Version the configuration and its digest domain to v2. Update the private child
input protocol to v2 with explicit localTransportTimeoutMs (5001..115000),
instead of passing the provider deadline under an ambiguous name; reject bools.
Factory identities and current child-source SHA checks remain required.
No old manifest/grant may be reused under the new configuration digest.
Additional allowed files: Y gateway/runtime/child and their portable/local tests,
plus narrowly affected native gateway docs/plan. No X, core, P/R changes.

In mixed completion transport remove its competing answer/judge abort timer.
Validate the supplied ceiling against the fixed mixed profile and require it
to cover the actual unchanged guard stage timeout, bound to benchmarkStagePolicy.
The existing answer ceiling is 200000 ms but X's actual answer deadline is
180000 ms; judge uses 60000 ms in both places. The exact duplicate-timer race
is in judge; removing both redundant wrappers does not extend either deadline.
Rely on X's existing authoritative request timer. Keep a non-aborted signal for the
required transport contract; do not add an external cancellation fallback.

Regression gates must exercise actual native X/Y scope failure followed by the
next declared Cairn arm and judge, plus actual X answer and judge deadlines
(a controlled test clock is permitted; fake guard success is not). Preserve full
reservations and unknown actual cost, zero replay, authentic failed scope,
blocked scoring for failed generation, and no late dispatch after release.
Malformed usage/global-fault negatives must remain globally halted even near
a deadline. Explicitly test a Y-first transport failure still halts globally.
Remove all temporary DEBUG-M7b probes and the test-only Atomics stall.
Run both runtime native gates and all M11 gates; retain original RED evidence.

### M12a independent-review correction contract

The first fixed-candidate review at c7ee7e7 found missing direct evidence, not
a demonstrated production failure. Before the next candidate, add: a valid
P source batch whose native serialization exceeds 8192 tokens and is denied
for both arms with zero provider calls; current-file native artifact drift
denied before a Cairn-first arm; and an actual Cairn capture model timeout
with pending guarded adapter work, terminal accounting before next scope and
no database/dispatch progression from a subsequently released physical fetch.
Use only synthetic fixtures, actual X/core/Y boundaries and a controlled clock
when necessary. Never edit the shared pinned native roots or tracked runtime
files to induce drift; use a fresh miniature artifact or isolated temporary
module tree. Test configuration current-child-source drift in an isolated tree
if needed to establish its own check, not by mutating this worktree mid-test.

The public prepared identity cannot carry a planner mismatch under the fixed
deterministic planner. Permit one private `mixed-plan.mjs` helper to own the
existing actual planner recomputation and exact comparison, called by the
production Cairn path before capture. A direct negative test supplies a changed
expected plan to this same helper. Do not add a public planner/core factory or
weaken prepared identity; label direct private seam evidence honestly.

Fix the comparison-document paragraph splice. Keep the three small public
option readers unchanged in this correction: their duplication is a nonblocking
maintainability heuristic, and it does not justify changing validated boundaries
while closing these concrete gaps. Run affected suites on both pinned Node
versions, preserve first failures, freeze and repeat both whole-base review
axes and primary key-path acceptance before push. No paid readiness claim.

### Candidate implementation and verification evidence

Implementation dispatch was GPT-6 Sol/high. The production entrypoints are
`prepareMixedComparison` in `mixed-generation.mjs`, `runMixedGeneration` in that
same module, and `scoreMixedGeneration` in `mixed-scoring.mjs`. The private
`mixed-evidence.mjs` verifier is called by the production Cairn path and by
direct denial tests; it is not a caller-supplied runner port. `mixed-demo.mjs`
prepares and packs a synthetic source case only. The explicit pinned-native
mixed test remains outside the ordinary LongMemEval glob; missing native roots
fail its prerequisite rather than report a skipped pass. CI runs only the
synthetic mixed demo after the existing locked adapter install.

The native timeout correction was driven by retained RED evidence, not a
waiver: equal child/socket/X deadlines could globally halt a scoped native
timeout; child-only grace remained RED, while child plus gateway-idle grace
preserved X's authentic local deadline. The first independent synthetic
integration then found a real parent-child input-version mismatch (parent v1,
child v2) before Mem0 dispatch; the parent now sends v2. Its first failure was
captured as a tool result, not mislabelled as a raw log. An early nonempty-test
failure counted a native extraction chat call as an answer call (3 versus 2);
the test now selects the exact public answer instruction, and its raw failure
is retained. The product's provider/model deadlines and all X accounting
rules were not extended. The local 5-second transport grace is a mitigation,
not a cross-process ordering guarantee.

Focused evidence: source preparation/answer packing, actual-X controlled-clock
answer and judge deadlines (including a late released physical response with
no extra dispatch or accounting), authoritative receipt positives and
stale/partial/forged/ambiguous denials, and report-cap denial. The receipt
positive retains all three genuinely matching P windows, while wrapper-overlap
is labelled metadata-or-mixed with null raw offsets. Actual local native tests
cover both arm orders, nonempty Cairn admission/recall and exact source-only
answer evidence, empty recall, malformed-usage global stop, local invalid
completion, authentic native deadline followed by Cairn and judge, fixed-N=3
scoring with 3×3 outcome cells, and non-string reference denial before judge
reservation. A real idle UDS socket times out under Y's derived local timeout
before any X reservation and globally halts; Y's existing physical-rejection,
malformed-framing and late-completion tests cover additional global/cleanup
boundaries. These tests use synthetic stores and fake HTTP only; they do not
establish answer quality, provenance truth beyond recorded sources, provider
credentials, or paid readiness.

Both Node 22.16.0 and 24.15.0 passed the serial M11 matrix: `npm test` (112),
`npm run validate`, `test:longmemeval` (172), all three existing LongMemEval
demos plus `demo:longmemeval-mixed`, `test:experiment-budget` (58) and its demo,
`test:experiment-request-guard` (285) and its demo,
`test:mem0-native-gateway` (45), `test:mem0-native-local` (9),
`test:mixed-native-local` (8), `test:core` (728), store and recall demos,
`test:openai` (224) and its offline demo, `test:live-evidence-offline`
(340 passed, 30 intentionally skipped installed-only cases), and strict pinned
plugin validation. Node 22's LongMemEval and portable Y suites were rerun
after the final report-cap and idle-socket tests; all other Node 22 gates had
already passed on unchanged code. Raw per-gate logs and the earlier RED logs
are retained in a private verification archive. No provider call, dataset,
holdout, actual campaign ledger, credential, or old experiment helper was used.

### M12a correction evidence

The review gap was coverage, not an observed production failure. The private
`mixed-plan.mjs` now owns the same deterministic planner recomputation and
exact comparison used by the Cairn production path before capture; a direct
test supplies a changed expected plan and observes `planner_mismatch`. This
does not create a public way to alter a prepared plan.

One valid P case renders one native batch with more
than 8192 tokens in the exact role/content serialization measured by the
pinned `cl100k_base` tokenizer. Its fixed roster remains one case, both arms
fail `native_static_input_exceeded`, and the actual X guard records two failed
scopes with zero physical HTTP calls and zero reserved attempts. A separate
fresh miniature inspected native artifact is changed only inside its owned
temporary tree; `runMixedGeneration` rejects `artifact_changed` before a
Cairn-first scope or any HTTP dispatch. No shared pinned artifact or tracked
child file is modified.

An actual core capture count request was held in an abort-ignoring fake
physical fetch. A controlled clock fired core's model deadline; X recorded a
terminal unknown/full-reserve attempt and failed local scope. At the first
subsequent Mem0 embedding dispatch, the Cairn store had already closed after
the sole failed scope and all then-existing attempts were terminal. Releasing
the old physical response after the run did not change dispatch count, X
attempts/scopes, memory rows, or the SHA-256 digest of every closed store file
(including any WAL/SHM file present). This tests the observable guarded/core
boundary, not inaccessible physical settlement. The comparison document's
resource-projection sentence was restored intact.

Both Node 22.16.0 and 24.15.0 passed the affected correction gates:
`npm test` (112), `npm run validate`, `test:longmemeval` (173),
`test:mem0-native-gateway` (45), `test:mixed-native-local` (11),
`test:core` (728), `demo:longmemeval-mixed`, and strict pinned plugin
validation. Raw logs are held in a private verification archive. The
unaffected M11 gates retain their prior both-runtime evidence; no new paid,
corpus, credential, or actual-ledger activity was performed. The optional
isolated current-child-source module-copy probe was not added; the mandatory
before-first-arm artifact drift and existing current-file configuration
identity checks remain in scope, with no claim that an unrun probe passed.

### M11 answer and judge evidence completion

The nonempty actual native mixed test now checks the complete answer request
for both arms: the exact shared model/options and system instruction, ordered
JSON user payload, original question and canonical date, authoritative Cairn
source excerpt, and the native returned `Synthetic memory fact.` string without
rewriting it as Cairn evidence. It still denies model-summary poison in Cairn's
answer evidence. Through the real `scoreMixedGeneration` path, a priced but
invalid completed first judge response is locally unresolved with
`attempted:true`; the next declared judge runs exactly once and fixed N is
preserved. A separate malformed-usage first judge produces a terminal unknown
actual/full-reserve X attempt and a global halt; no second judge is attempted.

Both pinned Node versions passed the six affected gates: `npm test` (112),
`npm run validate`, `test:longmemeval` (173), `test:mixed-native-local` (13),
`demo:longmemeval-mixed`, and strict plugin validation. No runtime, pricing,
grant, native policy, or scorer implementation changed in this correction.
The first focused malformed-judge test had an over-specific expected completed
scope count after X's global halt; its raw RED is retained, and only that
test assertion was removed. Earlier full M11 and M12a evidence remains
unchanged; these are synthetic local results, not paid or quality evidence.

### M12b — genuine non-string reference regression correction

The finite M11 coverage audit exposed a product failure in the new mixed scorer:
an actual Python-issued, evaluator-bound non-string rendering was rejected as
`reference_rendering_unverified`, with zero judge attempts. Main independently
reproduced the original positive test on Node24 before any runtime correction.
This is not a semantic-model failure or a reason to weaken source binding.

The bounded correction may change only `mixed-scoring.mjs`'s validated evaluator
representation, plus the existing tests/evidence. Discriminate the hypotheses
using the real capability: the original plain evaluator, the detached
null-prototype equivalent, and a `structuredClone` of that validated equivalent.
If the representation difference is confirmed, return a recursively frozen
`structuredClone` of the fully snapshot/schema-validated evaluator rows so the
existing strict resolver receives the same ordinary JSON object representation
as its issuer. Never pass original mutable caller data, alter reference values,
forge capabilities, loosen the shared resolver, or replace its equality rule.

Acceptance: genuine number and/or list reference reaches the actual mixed judge
with the exact Python-rendered text; wrong/missing capabilities and changed
reference values remain unresolved without judge dispatch. Original mutation,
accessor, sparse/nonfinite and fixed-N checks remain. Re-run the original red
test, the full LongMemEval and native mixed suites, generic/JSON checks and
comparison/public/mixed demos on both pinned Nodes; strict plugin validation
also remains required. Core/adapter/ledger code is unchanged, so earlier
unaffected gates retain their scoped evidence. Freeze only after passing, then
repeat main acceptance and both independent full-base review axes.

### M11 finite audit and M12b verification

Focused synthetic tests now pin a literal prepared case protocol digest and
both scope IDs that the actual X grant accepts. They reject JSON-cloned and
reused prepared identities before work, and prove source/question mutation
after preparation cannot change Cairn capture count/generation, native
extraction, either answer request, or the report. Cairn count, generation,
and answer unsettled-accounting failures each retain the entered scope and
globally block the later arm. A `length` finish reason and an answer exceeding
512 counted tokens remain local unresolved without that arm's judge request.
The real three-case scorer denies reordered case reports before any judge,
asserts every 3-by-3 table cell including zeros, and checks per-arm,
per-category and empty-category/null-denominator summaries. Separate frozen
report tests deny changed IDs, arm order/status, accessors, sparse arrays and
nonfinite values before judge work.

The M12b original Python-sidecar positive RED and an independent main-agent
RED are retained in the private verification archive. The three-way probe
showed a genuine plain evaluator resolves, the equal-value null-prototype
snapshot fails strict capability binding, and a clone of the validated
snapshot resolves. The only runtime change rehydrates and freezes fully
validated, detached evaluator rows in `mixed-scoring.mjs`; it neither passes
mutable caller data nor weakens the shared verifier. After that change, the
mixed scorer makes both actual judge requests with `[1, 2]` rendered by
Python. In a separate four-case genuine-generation run, forged, missing,
cross-bound and changed-reference tokens all remain unresolved without any
judge reservation or dispatch. Earlier test-only REDs for null-prototype
assertions are retained and were corrected without runtime changes.

Both Node 22.16.0 and 24.15.0 passed serial affected gates after the fix:
`npm test` (112), `npm run validate`, `npm run test:longmemeval` (175),
`npm run test:mixed-native-local` (20), the comparison, public and mixed
LongMemEval demos, and strict pinned plugin validation. Raw logs remain in
the private verification archive. Core, adapter, X ledger, provider policy,
and native runtime files were not changed in this correction; their earlier
full-suite evidence is unchanged. No paid calls, corpus, holdout, operational
ledger or provider credentials were used.

## Later bounded-qualification partition amendment

The original mixed runner above remains a frozen historical protocol. The
dependent [bounded qualification partition](bounded-qualification-partitions.md)
keeps its external adaptive catalog wire/profile but binds the new
whole-then-singleton dispatch policy into `mixed-context-v2`. It requires
fresh v3 resource and guard-cap projection before any new launch; it does not
alter prior runs or turn a stopped case into a retry.
