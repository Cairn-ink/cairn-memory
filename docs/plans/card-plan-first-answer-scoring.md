# Card-plan first-answer source-integrity and scoring

2026-10-12. Prospective implementation contract, frozen before scorer work.
Fixed base/runtime candidate: 4309ff396834f60c237910493c2dc837e11de4dc.
Worktree: /home/chichieh/Github/cairn-memory-worktrees/card-plan-scoring.
Branch: experiment/card-plan-scoring. Depends on runtime PR408; its candidate
passed primary24 and independent Standards/Spec, exact-head CI still in progress. No scoring against the closed
source-bundle cohort; never alter, rejudge or recalculate that result. No provider,
operational ledger/key access or spending permission in this implementation.

Exactly four delivery paths: evaluation/algorithm-development/card-plan-scoring.mjs,
evaluation/algorithm-development/test/card-plan-scoring.test.mjs,
docs/plans/card-plan-first-answer-scoring.md and docs/limitations.md append only.
No old scorer/parser/runtime/corpus/rubric/package/CI changes. Existing algorithm
test glob already collects the new file. Runtime must never import this scorer.

## Closed API

prepareCardPlanScoring({sourceRaw,rubricRaw,artifacts,execution,judgeSeeds})
and scoreCardPlanComparison with those SAME five fields plus firstResponses.
Both are async pure retained-data functions; no default discovery paths/options.
sourceRaw and rubricRaw are exact UTF-8-decoded strings from the frozen files;
verify raw and parsed-value hashes before semantic use. Require exact UTF-8 byte
counts before parsing/copying: source90785 and rubric76804. The immutable bindings
are:

| Input | Raw SHA-256 | JSON.stringify parsed-value SHA-256 |
| --- | --- | --- |
| Source | 9a426a536efd97c8b61a7aed9890a399f7e6f8cb72758cc2c1fbc2c78605a48f | 09ecd9710ea980d8ac228ad55858e4a757de4dc006eb8451a30707142b102cb5 |
| Rubric | c0aea913f90bd8437a455f5d9048dfd26364120b15822dccd0ff452ed4447d8c | 58ba116268bac50ce69bd8ca4598a31e1c3bcd9eaa6836345c86da6845f840c8 |

artifacts is a dense
array of exact {name,text} pairs, using basename-only output file names. Derive
UTF-8 bytes and SHA-256, never trust caller-supplied counts. Every referenced
absolute path must be exactly the declared preparation outputRoot plus its
allowed basename; never dereference it. Names are unique, but identical shared
references are allowed. Source/rubric files and original-ledger-history.json are
NOT entries in this array. No SQLite database bytes are accepted by the scorer.

execution is exactly {runtimeCommitSha,artifactIndexSha256,originalHistoryHeader,
provenanceRecordSha256}. Pin runtimeCommitSha to the final reviewed runtime
candidate, not a caller-selected commit. artifactIndexSha256 hashes JSON.stringify
of the sorted {name,bytes,sha256} index (ASCII basename ordering). The original
history header is the exact eight scalar fields schemaVersion,runId,limitMicroUsd,
requestCap,reservedMicroUsd,requestCount,state,historySha256, or null ONLY when
the runtime retained no bound original-history descriptor. Initial inspection
may already have happened: a non-null initialRequestCount alone does not imply
that history was retained or authorize inventing its baseline. It must match the retained
history descriptor/checkpoints/final fixed identity and affordability rules.
The 64-hex provenanceRecordSha256 identifies primary's separately retained
execution/provenance record. Shape/hash agreement does not prove that record's
existence, firstness or independence; report external attestation as required,
not code-verified authenticity. Primary independently reviews that record before
using any resulting score as measured evidence. No boolean self-attestation is
sufficient to replace missing literal artifact proof.

judgeSeeds is exactly {AB,C}, distinct lowercase64-hex seeds frozen BEFORE the
new live run. firstResponses is exactly {AB,C}; each domain is the unchanged
parser's two exact {judgeId,rawResponse} rows in A,B order. rawResponse is its
literal first string or null. Keep it out of generic metadata copying/limits;
reuse the helper's oversized-first-artifact behavior unchanged. External judge
agent/model/packet/time/first-raw provenance is retained by primary, separate
from the code's fieldwise agreement claim. No fabricated first-execution proof.

Accepted artifact envelope limits: maximum939 files, each metadata JSON<=8MiB,
metadata aggregate<=64MiB; request text<=262144 UTF-8 bytes, response text
<=786432 bytes, at most168 of each; aggregate literal artifact text<=256MiB.
Descriptor traversal and parsed metadata have explicit bounded node/depth limits
(maximum4000000 nodes, depth32 across retained metadata); charge before copying.
These are scorer envelopes, not widened runtime/model/HTTP budgets. Validate the
complete real-core scripted fixture and maximum-body fixtures against them before
freezing implementation. Observed2b snapshots (~13.5MB/924files) are supporting
measurements, NOT a worst-case bound proof or complete happy-run measurement.

Only allow preparation.json, run-start.json, comparison-report.json,
24 exact CQnn-preparation.json names, the 120 exact frozen slot names,
record-NNNN.json (<=336), checkpoint-NNNN.json (<=120), and actual bound UUID
request/response text names. Missing unrun-slot artifacts are legitimate;
unknown files, unrelated known-slot artifacts or fabricated run progress are not.
Require all existing referenced files and reconcile each actually dispatched
pre/post record/checkpoint. run-start.json is conditional on reaching its
persistence step: genuine configuration rejection can precede it while still
retaining a final halted report. An early checkpoint mismatch can retain run-start
and initialRequestCount but no history/checkpoints. Preserve those honest halted
states, all denominators and unknown initial accounting; do not require fictitious
files or treat their absence as a successful zero-cost baseline. Do not load an original-history file just to calculate
a new score; bind its separate <=128MiB descriptor to external provenance.

Judge packet bindings are: sourcesSha256/rubricSha256 = frozen parsed values;
preparationManifestSha256 = runtime manifest's full preparationSha256, independently
reconstructed from the complete case artifacts; runManifestSha256 = hash of exact
JSON.stringify(report.manifest); resultSha256 = literal comparison-report.json
UTF-8 hash; runtimeCommitSha = pinned runtime candidate. Do not pretend to
reconstruct unavailable full in-memory unrun slots from a summary. Additional
source/rubric raw hashes and artifact-index provenance remain explicit outputs.

Invalid artifact identity/shape yields a frozen integrity-denied result with an
explicit scalar reason and no valid metrics or gain. A valid halted first run
is separately represented: retain denominator/status/available-evidence metrics,
unknown resources and no promotion. Never convert metadata tampering into a
mere unknown judgment, or convert genuine unjudgeable provider text into source
tampering. The exact returned schema is proposed at ST1 for primary inspection.

## Artifact packaging inspected after runtime checkpoint2b

The runtime no longer duplicates complete bodies and every full case/slot in
the final JSON wrapper. It retains preparation.json as a roster referring to
exact per-case preparation files, comparison-report.json as a roster referring
to exact selection/answer files, and separate literal request/response files
referenced by byte count and SHA-256. Ordered record/checkpoint JSON files retain
durable observations. The in-memory return value is not the on-disk summary
representation. A scorer accepting only that summary would lack essential proof.

The pure API therefore accepts the explicitly supplied, bounded artifact bundle
above (literal UTF-8 text with bound names and independently derived lengths/hashes), not discover
files, trust arbitrary paths, or silently fetch missing files. Verify every
artifact entry exactly once, reject duplicate entries and foreign/missing
references, and rebuild the full observations only from those literal bound
artifacts. Multiple references to the SAME bytes/name are legitimate (for example
B's shared selection); they must resolve identically, never become extra calls,
sources or answers. Detached caller
objects, if accepted for comparison, cannot substitute for missing literal proof.
Keep byte identity distinct from parsed equality. Per-request response capacity
must preserve the ordinary transport's unchanged 262144*3 UTF-8 replacement bound;
do not put those bytes through the small generic metadata allowance.

Do NOT import or parse the potentially128MiB original historical ledger rows.
Verify its retained descriptor/header against first checkpoint and external
execution attestation, then independently reconcile this run's exact ordered
deltas, owner transitions and all durable pre/post records. Explicitly state
that old-prefix preservation and execution firstness rely on pinned-runtime
evidence and primary provenance, not a cryptographic anti-fabrication guarantee.
Reserved intents and actually dispatched requests are separate counts; no
dispatch must not erase a reservation, and missing final evidence is not zero
cost. Runtime commit/worktree/branch are pinned above. Implemented-envelope evidence
remains required; no live evaluation is authorized by this contract.

Metadata files were emitted by the pinned runtime's JSON.stringify. Requiring
their literal parse/re-encode identity can reject duplicate keys and alternate
encodings without silently accepting last-key-wins tampering. Provider response
text is a separate raw channel: retain its literal bytes and reproduce the
unchanged adapter's accepted extraction/response rules. Do not retrospectively
impose a new provider-output grammar or replace malformed first outputs. A
legitimate retained halted report with no executed slots is not a successful
run; keep all denominators and unknown resource coverage. Every dispatched
request requires its durable pre-record; missing pre-records for a reserved but
NEVER dispatched intent can exist on the explicitly observed persistence/wire
failure path. Such gaps must remain failed/incomplete, never be fabricated from
post-records to grant resource or answer credit.

Here literal response identity means the exact retained transport text artifact,
not necessarily original network bytes: the accepted transport replacement-decodes
UTF-8, redacts a credential and may replace credential-bearing failure text
entirely. Preserve that failure/redaction provenance without reconstructing or
recovering secrets. A legitimate failed/halting path with unavailable extraction
or usage proof stays explicitly unknown; it cannot receive successful-answer,
clean-safety or verified-resource credit from a placeholder. No code here claims
original-wire-byte equality on such paths.

## Inputs, proof and semantic boundary

SC1. Evaluator-only pure retained-data entrypoints prepareCardPlanScoring and
scoreCardPlanComparison. No store/provider/budget runtime or artifact-file I/O
is instantiated by scoring; the primary separately retains literal artifacts.
Trusted code and the pinned local tokenizer dependency may load normally. Reuse
the accepted pure CP/PX preparer/compiler and real token counter when deriving
expected request/selection data. Their fresh process-local validator state is
NOT the original runtime capability or execution evidence. Never call the live
coordinator, recreate a core/store, or manufacture an assembler capability to
replace missing retained reads. Replaying verifiedRoleEvidence uses only the
literal retained authoritative-read sequence and must reject missing entries.
Bind frozen CQ source
and rubric raw/value hashes, exact24 ID/order,288 source messages,102 literal
UTF-16 anchors, complete preparation/run manifest/result identities and pinned
runtime/control hashes. Reject old/different corpora or another algorithm profile.
Literal request/body identity is distinct from semantic JSON equality.

SC2. Treat all imported retained values as untrusted bounded data. Descriptor-
first traversal rejects proxies, getters, inherited hooks, cycles/sparse arrays,
custom prototypes, illegal Unicode/keys and excess metadata. Large allowed raw
response bodies get separately bounded capacity, not the small metadata budget.
Identity/source/configuration metadata remains strictly well-formed. Literal
provider-answer fields are retained separately and may be unjudgeable; do not
convert a genuine accepted first answer into an artifact-integrity mismatch just
because its decoded text exceeds the unchanged judge helper's text contract.
Return explicit denied integrity reports; no fake unknown judgment can repair a
source/ledger mismatch. No mutation of caller artifacts or reconstruction from
an answer/gold to create missing runtime evidence.

SC3. Reconstruct every prepared source window and receipt against original CQ
sessions/roles/event times and real capture observations. All twelve candidates
must derive from actual successful cold recall; no manually fabricated index.
Verify exact candidate/ref/memory/revision/namespace/source identity and the full
logical snapshots retained before/after preparation. Later per-action witnesses
contain only sha256, bytes and table count; compare those actual witnesses against
the verified prepared snapshot and enforce the pinned runtime's success/failure
semantics. Their execution is runtime/provenance-attested: do not claim complete
per-action table bodies were retained or independently reconstructed. A genuine
halt reporting source-state drift is not artifact tampering merely because that
state failed its expected equality check; retain that failure and deny successful
source credit where it applies. Trace genuine runtime
authoritative reads through existing verifiedRoleEvidence; normalization alone
is not provenance. Distinguish artifact consistency from proof against wholesale
fabrication; execution provenance remains a separate retained primary attestation.

SC4. Reconstruct A's literal first ordinary refs and PX deterministic synthetic
assembly separately from its actual paid wire. Reconstruct B's actual first
strict card proposal and compiler output. Both require actual successful core
recall before evidence credit, no extra model/read/repair. Check exact ordinary
count/generation bodies, CW prepared/count/generation strings, literal outputs,
all identities and request bounds. C references B's SAME selection/assembly and
does not invent a third ranking attempt. All48selection slots and72answer slots,
failures/not-run/dependencies and alternating/fixed orders remain explicit.
The unchanged ordinary source-rank prompt is the exact raw core prompt bytes,
SHA-256 c9cb1fbf0bee20a0e8568d405cc3ac9fb81ceb65926f47389ad13975d96326da;
core/recall.mjs passes that literal string to packRank. Do not trust a mutually
consistent but caller-rewritten prompt across preparation and HTTP artifacts.

SC5. Validate actual answer units against accepted flat whole-card projections.
For nonempty B evidence, C removes EXACTLY the defined first-card
unverifiedOrganization property to recover B's factual bytes/order; check the
metadata also equals B's genuine proposal. A legitimate empty B selection has no
first card: C must have the same empty projection and no organization field, as
the unchanged projector specifies. Never fabricate a card or metadata for this
case. No chain is factual support by itself. Reconstruct entire actual
question/date/instruction/model/512-output/6000-input request; omissions, reordered
or duplicate sources, equivalent-but-different strings and forged successful
answer observations reject. Answers are literal first results bound to actual
successful HTTP/adapter completion, not merely a responseBody field.

SC6. Independently reconcile retained evidence for new max168 requests/840000microUSD reservations,
5000microUSD per physical intent, count/generation/answer order, durable pre/post
records, one settlement, exact ordered owner transitions, retained original
history-prefix metadata and final state. Verify known usage pricing versus raw
response and pinned model, unknown-usage reservations, no refunds, protected30USD,
original cumulative400USD, existing stricter affordability floor, deadlines and
fatal-stop behavior. Reconcile measured latency/store bytes/partial-known costs;
RSS and agent-service costs remain unknown. Old history is NOT loaded/replayed
by the scorer; prefix integrity is runtime/external-provenance-attested, not an
independently recomputed historic-history claim. Resource compliance is derived,
never a caller-provided true flag.

## First independent judgments

SJ1. Reuse unchanged createSourceBundleJudgePackets and
parseSourceBundleFirstJudgments from source-bundle-judging.mjs AFTER SC validation.
Two domains/seeds fixed before live dispatch: AB up to48 actual first answers;
C up to24 actual first answers. Separate independent two-judge tasks per domain;
B judged only once in AB. Reuse B agreement for matched C comparison, not a new
B verdict. Model-facing runtime never receives rubric, required sets or judges.

SJ2. Normalize source facts only after verifying actual packed passage provenance.
Judges see question/date, original sources/rubric, actual literal answer and
actual factual passages; C organization is not passed as authenticated evidence.
Opaque IDs/order conceal direct arm labels, not clues from repeated sources.
Keep mapping separate. Same-family agreement is not truth, human validation or
perfect blinding. Preserve original first UTF-8 submissions and agent/packet/time
provenance before parsing, even malformed/oversized/missing/disagreed. No repair,
replacement/rejudge/adjudication or copying counterpart conclusions.

SJ3. Code validates normalized first-response bindings/field references and returns
agreement-only fields. Firstness and independent execution cannot be proved by
JSON shape: retain external provenance and do not overclaim. Missing answers
produce no judge item and stay unresolved in the full24 denominator. Qualified
answers require requested known facts plus precise remaining uncertainty; blanket
abstention is not automatically correct. Optional background is not required for
correctness, but unsupported optional claims still count as harm.

Judgment eligibility also requires runtime status completed and disposition
answered, in addition to verified first HTTP/adapter completion and judgeable
text. A failed slot may legitimately retain result/answer after successful
adapter extraction followed by a deadline, owner-close or cleanup failure.
Preserve and validate that literal partial observation; its presence is not
tampering. Do not make it a judge item, count it as completed/correct, or erase
the failure. It remains correctness-unresolved, supported-correct false and
safety unobserved. This prospective rule distinguishes accepted text from a
successfully completed evaluation answer, without reclassifying the runtime.

Judgeability is distinct from runtime completion. The unchanged ordinary answer
transport requires nonempty trimmed content and <=512 local tokens, but does not
require well-formed decoded UTF-16 or <=16384 UTF-16 units. Primary's local-only
real-tokenizer diagnostic on2026-10-12 exited0: "Answer [unpaired surrogate]"
has8UTF-16 units/2tokens; 60000spaces followed byX has60001units/470tokens. Those
can pass the transport text predicate but cannot enter the unchanged judge
helper. Preserve actual completion, raw answer/body hashes and explicit
unjudgeable reason; make no item, no replacement/trim/truncation/rejudge, keep
correctness/support/safety unknown. It remains in all24 denominators and blocks
known A/B safety, but cannot block A/B merely because it occurred only in C.
This pure text-bound diagnostic made no HTTP/model call and does not assert an
actual observed provider output. Include such genuine fake-HTTP first outputs
in the scorer integration tests instead of fabricating an impossible slot.

## Metrics and decision (pre-outcome)

SM1. Per arm/all24,answerable18,qualified6: completed/failed/not-run, correctness
correct/incorrect/unresolved, source support, supported-correct true/false/unknown,
complete necessary-source-set cases, literal anchor coverage and unsupported/
stale/severe question-level/claim-level counts with known/unknown coverage. All
totals reconcile. Missing answer is false supported-correct, never correct or a
safety success. Supported-correct requires a completed actual answer, applicable
complete required source set, correctness=yes, support=yes and agreed zero
unsupported claims; unknown support/count stays unknown unless another mandatory
condition is definitively false. Empty evidence is not automatically supported.

Exact predicate: all requiredEvidenceSets are cumulative requirements (AND of
their complete anchor sets); membership is verified original-source identity and
UTF-16 span within actual authoritative packed passages, never arbitrary text
substring matching. Current frozen CQ has exactly one required set per case;
assert that frozen structure rather than silently accepting an alternate rubric.
Supported-correct is three-valued conjunction of actual completed nonempty first
answer, complete required evidence, correctness=yes, support=yes and agreed
unsupportedClaims=0. Any definitive false makes false; all true makes true;
otherwise unknown. True=[1,1], false=[0,0], unknown=[0,1]. Each B-A interval is
[lower(B)-upper(A),upper(B)-lower(A)], summed over all24 fixed pairs. For raw
correctness use completed actual answer AND agreed correctness=yes with the same
three-valued mapping. Integrity denial produces no valid score or paired gain.

The unchanged transport rejects empty/whitespace-only answers as
invalid_answer_response; HTTP success alone is not runtime answer completion.
Retain the literal HTTP result but no judge item, correct credit or clean-safety
credit. A claimed completed empty-answer slot is integrity mismatch, not a scoreable
unknown. Per arm, completed+failed+not-run=24 and correct+incorrect+unresolved=24
independently; unresolved includes missing/unexecuted/unknown-judged answers.

SM2. B-v-A sole gate for a promising mechanism-followup signal: B completion>=23/24,
conservative paired supported-correct lower gain>=3, at least1 additional complete
required-source-set case, no added predefined severe condition, no qualified
supported-correct regression, no increased unsupported/stale questions/claims,
known safety and derived resource compliance. Keep all discordant pairs and
best/worst unresolved-field bounds; those are NOT confidence intervals. Missing
answers cannot produce a safety improvement. Mark their unsupported/stale/severe
assessment unobserved (not clean or zero) and report it separately from unknown
judgment fields on actual answers. For the B-v-A promotion gate, known safety
requires actual first answers in both A/B for every compared case and known
agreed unsupported/stale counts and every severe condition. Thus>=23 completion
is necessary but not sufficient: a missing A/B counterpart still blocks this
safety-based promotion claim. This is not a requirement for100% correct answers.
C missing/unknown judgments alone cannot block or improve the B-v-A gate.

The complete-source-set improvement is NET complete case count(B)-count(A)>=1,
not just newly gained pairs ignoring losses; list gains and losses individually.
Qualified non-regression is per question: for each of CQ19–CQ24 require
lower(B.supportedCorrect)>=upper(A.supportedCorrect). Unknowns cannot hide a
possible loss behind definite gains elsewhere. Predefined severe additions are
per fixed(caseId,conditionIndex) with B=yes and A!=yes; removals elsewhere cannot
offset an addition. Unknown/unobserved safety blocks independently as above.
Unsupported/stale non-increase applies to both aggregate affected-question totals
and aggregate claim totals over actual judged answers, under complete known A/B
safety coverage; also retain every per-case change. A new unsupported nonsevere
question can be offset in aggregate under this inherited criterion, but never a
new severe condition. No local per-case stronger rule is silently substituted.
Unknown claim counts retain known subtotal plus unresolved coverage; neither0
nor the parser's128 count bound is an estimate or an uncertainty upper bound.

This mechanism-followup signal is NOT original full Stage2 passage. Separately
report raw-correctness paired lower/upper and whether its lower reaches3, so the
original Stage2 QA criterion remains visible and is never replaced by supported-
correct. Stage2Passed and product/default advancement remain false in this
scripted complete-candidate diagnostic even if mechanismPromising is true.

SM3. C-v-B uses B's same verified factual sources and single AB judgment; report
diagnostic deltas only. It can never substitute as the winner if B-v-A fails.
Predefined severe conditions and old D12 remain separate; this corpus cannot
clear D12 or promote defaults. Positive authored/scripted-capture/complete-map
evidence is not natural extraction, long-history MOC quality, official benchmark
parity, lightweight product fit or installed Hermes readiness.

## Checkpoints

ST1. Importable behavioral red before implementation, primary wait. Integrated
tests use actual fresh offline runtime with fake HTTP/synthetic ledger and literal
scripted first judgments; never retained formal artifacts or historical model
answers. Test all24/72 denominator/order/source-set arithmetic, A/B/C provenance,
qualified known-plus-unknown requirements, truthful failed/not-run cases, each
integrity tamper class, shared B selection, missing/disagreed/malformed first
responses, exact-bound known/unknown support, paired bounds and C-not-winner.
Primary must inspect actual integrated diff/fixtures before broad matrix.
Include real empty-selection C projection, failed-after-extracted-answer,
halt-before-run-start and checkpoint-mismatch-with-inspected-but-unretained-history
fixtures. Freeze the API/returned-schema tests before implementation; no
fabricated impossible slot is a substitute for these observed state transitions.

ST2. Both exact supported Node runtimes: focused integration, full algorithm
suite, generic and validate, owned scratch cleanup; primary direct key checks
and both Claude validators. At most two runtime sequences, every original exit
and failure retained. Four-path Git versus full filesystem/base-blob audit,
frozen scoped candidate, separate nonauthor Standards/Spec same base/head,
dependent PR and exact-head CI/mergeability. No worker commits/pushes. Two failed
correction rounds same issue escalate; no arbitrary score tuning.

## Resource predicate to bind against the frozen runtime schema

Mandatory accounting observations: every dispatched physical count/generation/
answer intent has one durable reservation and one retained final record; no
pending/missing settlement; total<=168,5000microUSD per intent,reserved<=840000;
unchanged original400000000microUSD ceiling and30000000 protection; initial
stricter10000000microUSD/1968-request affordability and exact no-reset history/
checkpoint transitions. Valid known usage matches actual pinned-model response
tokens/pricing; unknown usage remains reserved. Token measurements separately
record local whole request<=6000,provider count<=7024,rank output<=1024,answer
output<=512,zero omitted/duplicated answer units. Fixed logical30000ms/physical
200000ms/case1200000ms/run28800000ms enforcement is pinned-runtime-attested;
retained actual transport durations/run elapsed must be finite, nonnegative and
consistent, and an expired/stopped run cannot satisfy the full signal gate.
Store bytes are finite and reconcile all24 prepared stores; logical pre/post
state equality demonstrates no mutation, not a universal storage-footprint bound.
No external DB dependency or default retention expansion is introduced.

Physical accounting charges B selection once. Per-arm read/answer call and time
figures may show A=(A selection+A answer),B=(B selection+B answer),C incremental
answer-only with B selection explicitly shared; do not sum an allocated B/C cost
as if it were extra physical spending or claim C's incremental cost is standalone.
Capture/preparation latency and bytes are common profile costs; do not assign
them as a treatment gain. PeakRSS/agent-service cost are explicitly unmeasured,
not0 and not mandatory pass measurements for this mechanism profile. Any other
mandatory missing measurement makes resource compliance unverified and blocks
mechanismPromising. This resource predicate is not measured lightweight product
fit; natural capture, absolute real-user latency/scale and host use remain separate.

## Ownership and verification packet

Primary owns contract, integration acceptance, serialized limitations append,
scoped candidate and independent review/PR. One fresh actual GPT-6.1 Sol/high
worker owns the new module/test and plan append only; preserve this complete
contract as the plan's exact prefix. No worker commits, pushes or merges.
The worker may inspect CQ source/rubric (this is evaluator-only), its test,
pinned runtime/transport/core/evidence interfaces, unchanged judging helper and
pure prior scorer implementation/test for reuse. Do not read historical formal
answers/results, closed-run artifacts or operational configuration/key/ledger.
Do not change any runtime/prompt/model/corpus/rubric/parser or old scoring result.
The worker need not read broad README/limitations result prose: primary has read
CONTRIBUTING and owns cross-stage requirements. Read CONTRIBUTING, CONTEXT,
docs/architecture.md and docs/protocol.md plus direct code dependencies.
No browser/product route or installed harness behavior changes; trace both new
entrypoints and the untouched runtime/evaluator separation in the plan.

Checkpoint ST1: supply importable not-implemented entrypoints and real integrated
behavior tests, exact proposed return schema, then one Node22 owned-runner RED
run. Retain full raw log, actual exit, counts, fixture preconditions and cleanup.
Stop before implementation for primary inspection; missing import/syntax/dependency
is not behavioral red. Use synthetic controlled first judgments only. Genuine
runtime fixture evidence may be shared within one owned test workspace to avoid
repeated real SQLite preparation; tamper controls copy retained data, never reuse
formal or operational artifacts. No weakened runtime bounds/deadlines.

Checkpoint ST2a: after approval, implement and run new focused scorer tests once
on22.16.0; stop for primary source/fixture review before broader verification.
Every failed run is retained and its cause explained. Two unsuccessful correction
rounds on the same problem require primary rescope; no blind repeated retries.
Checkpoint ST2b: after primary acceptance, exact22.16.0 and24.15.0 each run version,
new focused scorer suite, complete algorithm suite, generic, validate and owned
longmemeval comparison demo. At most two native sequences in total, coordinate
slots with primary. No package installation or shared dependency mutation.
Use existing pinned tiktoken1.0.22 via inspected local dependency links only.
No credentials inherited, compile cache disabled, all four required flags true.
All tests pass with0 skipped/cancelled; success/assertion/setup failure paths
leave no unexpected owned scratch. Keep raw logs and actual command exits.

Primary separately repeats focused scorer integration, complete algorithm suite,
53 core source checks,51 LongMemEval source/answer checks, generic, repository
validation, owned comparison demo and both Claude validators on both runtimes,
then post-commit version/validation. The full algorithm suite already includes
runtime/store/corpus tests; do not duplicate those entire suites inside focus.
The new scorer adds test workloads: prospectively set offline suite subprocess
ceiling to30 minutes (not20) before any scorer test outcome. This is only the
maintainer process watchdog, never the evaluated request/case/run deadlines,
request cap, token limits or semantic gates. No timeout retry is authorized.

Trusted control file hashes at the fixed runtime candidate:

| File | SHA-256 |
| --- | --- |
| architecture/card-plan-rank.mjs | 4a5b40fcc925b8a6ac0bdcc003862400fcb99ac5fdf47e0685a5f2989b5cbd58 |
| architecture/card-plan-evidence.mjs | 4dff6162bdbee1052ef415244f0971c2a7bbb14d4d7bfd7693353c571cf9107a |
| architecture/card-plan-projection.mjs | b723805993bd57b82cb6b946b0ea148e63ab65fdaf077994799c11b0425685a6 |
| algorithm-development/source-bundle-judging.mjs | 9e960ecfc90a8b63a1aeb46766679983478dd0324c59d9713dc5309ae376a8df |
| algorithm-development/card-plan-runner.mjs | 1a9a7fe77f79566f23c14972eae6474b52f118761d0202236355eafa0d404821 |
| algorithm-development/card-plan-store.mjs | 7791ef1c08f198713902d4bab18b91a05392633aaa90b0575fe4bff598ab1691 |
| algorithm-development/card-plan-profile.mjs | 53092d65ac9fa3b787af219e2cc04621a0d8d013ad9c6c9562aa449f3d63649e |

All paths in that table are under evaluation/. Source and rubric byte/value
hashes are above. Control-file pins describe reviewed code provenance, not
runtime anti-fabrication, author blinding or a model-accuracy guarantee. The
runtime's two historical author-read incidents and inherited PX7 exception
remain disclosed; the independent review accepted only the prospective nonblind
mechanical coordinator. Scorer acceptance cannot erase that history.

## ST1 proposed returned schema and behavioral test packet

Author: fresh actual GPT-6.1 Sol, high, explicit user selection. The earlier
capacity infrastructure occurrence produced no implementation or product-test
result; it is retained as process history. Author writes only the new module,
new test and this append. Primary owns later limitations, commit/review/PR.
The module currently has importable async entrypoints which throw the explicit
`card_plan_scoring_not_implemented` error. There is no scorer implementation.

Both entrypoints take precisely the frozen five-field API; score adds precisely
`firstResponses`. Preparation and scoring regenerate the packet domains from
validated literal artifacts. No trusted caller packet/mapping is accepted.
All returned containers are recursively frozen detached JSON data. Boolean
three-valued fields use `true | false | null`; intervals use exact integer
`lower` and `upper`. These are deterministic unresolved-field bounds.

Preparation's exact top-level keys are:

```text
version: "card-plan-scoring-preparation-v1"
status: "ready" | "denied"
integrity: {status:"valid"|"denied", reason:null|scalar-reason}
bindings: null | unchanged six-field judge bindings
provenance: null | Provenance
denominators: {casesPerArm:24,selectionSlots:48,answerSlots:72,
               answerable:18,qualified:6,sourceMessages:288,anchors:102}
runtime: null | {status:"completed"|"halted",failure:null|retained-failure}
mechanical: null | {selections:[Selection x48],answers:[AnswerEvidence x72]}
judgeDomains: null | {AB:unchanged-packet-set,C:unchanged-packet-set}
resources: null | Resources
limitations: [fixed explicit limitation strings]
```

Scoring's exact top-level keys are preparation's keys except `judgeDomains`,
plus `cases`, `judgments`, `summaries`, `paired`, `harms`, `gate`. Version is
`card-plan-scoring-report-v1`; status is `assessed | denied`. A valid halted run
is assessed with runtime status halted, retained failure, complete denominators
and unknown resources. It is never an integrity denial merely for halting.

```text
Provenance = {
  sourceRawSha256, rubricRawSha256, artifactIndexSha256,
  provenanceRecordSha256, runtimeControlHashes,
  externalAttestation:"required-not-code-verified",
  originalHistory:null|{descriptor,header,
    verification:"descriptor-header-and-new-deltas-only"}
}
Selection = {caseId,slotId,arm,execution,failure,
  recallSuccessful,selectionOrigin,selectionSha256,sharedBy,
  evidence:{status,anchors:[{id,present}],sets:[{name,complete}],completeRequired}}
AnswerEvidence = {caseId,slotId,arm,selectionSlotId,execution,disposition,
  evidence:{status,anchors:[{id,present}],sets:[{name,complete}],completeRequired},
  actualAnswer,answerSerializedSha256,responseArtifactSha256,
  judgeEligibility:{status:"eligible"|"excluded",reason:null|scalar-reason}}
cases = [{caseId,answerability,arms:{A:Arm,B:Arm,C:Arm}} x24]
Arm = {slotId,selectionSlotId,execution,disposition,failure,actualAnswer,
  answerSerializedSha256,responseArtifactSha256,judgeEligibility,evidence,
  judgment:null|unchanged-agreement-item,
  rawCorrectness:true|false|null,supportedCorrect:true|false|null,
  safety:{status:"observed"|"unobserved"}}
judgments = {AB:unchanged-parsed-first-judgments,C:unchanged-parsed-first-judgments}
summaries = {A:{all:Summary,answerable:Summary,qualified:Summary},B:...,C:...}
Summary = {cases,actualAnswers,completed,failed,notRun,
  correctness:{correct,incorrect,unresolved},support:{yes,no,unknown,unobserved},
  supportedCorrect:{true,false,unknown},completeRequiredCases,
  anchors:{present,absent,unknown,total},
  unsupported:ClaimSummary,stale:ClaimSummary,severe:SevereSummary}
ClaimSummary = {knownQuestions,affectedQuestions,claims:null|integer,
  knownClaims,unknownJudgmentQuestions,unobservedQuestions,coverage}
SevereSummary = {knownQuestions,affectedQuestions,knownConditions,
  positiveConditions,unknownJudgmentConditions,unobservedConditions,coverage}
paired = {BminusA:PairComparison,CminusB:PairComparison}
PairComparison = {diagnosticOnly,rawCorrectness:PairedMetric,
  supportedCorrect:PairedMetric,completeRequiredNet,
  completeRequiredGains:[caseId],completeRequiredLosses:[caseId],
  qualified:[{caseId,baseline:[lower,upper],treatment:[lower,upper],nonRegression}]}
PairedMetric = {lower,upper,lowerReachesThree,wins,losses,ties,uncertain,
  pairs:[{caseId,baseline:[lower,upper],treatment:[lower,upper],lower,upper} x24]}
harms = {AB:SafetyComparison,CB:SafetyComparison,D12Cleared:false}
SafetyComparison = {known,unsupported:{addedQuestions,addedClaims,perCase},
  stale:{addedQuestions,addedClaims,perCase},
  severe:[{caseId,conditionIndex,baseline,treatment,added,known}],
  unobservedCases:[caseId],unknownJudgmentCases:[caseId]}
gate = {mechanismPromising:boolean,reasons:[scalar-reason],
  Stage2Passed:false,productDefaultAdvancement:false}
Resources = {physicalCalls,reservedIntents,reservedMicroUsd,partialKnownMicroUsd,
  unknownCostCalls,missingFinalCalls,initialRequestCount:null|integer,
  initialReservedMicroUsd:null|integer,latencyMs,transportLatencyMs,storeBytes,
  rssBytes:null,serviceCostMicroUsd:null,
  byArm:{A:{selectionCalls,answerCalls,latencyMs},B:...,C:...},
  sharedBSelection:{calls,latencyMs},commonPreparation:{latencyMs:null,storeBytes},
  compliance:{status:"satisfied"|"not-satisfied"|"unverified",
    reasons:[scalar-reason],runtimeAttestationRequired:true}}
```

Scalar reasons are fixed evaluator reasons, never copied exceptions or source
text. Retained runtime failure objects keep their actual pinned-runtime shape;
in particular an ordinary transport can retain a native uppercase encoding
error code. The evaluator must not invent a lowercase-only runtime taxonomy.
Eligibility reasons include `runtime-not-completed-answered`,
`ill-formed-answer-text`, `answer-text-over-judge-limit`,
`no-actual-returned-first-answer`, and `invalid-answer-response`.
Safety `observed` means the slot was eligible for judgment, not that every
judgment field was known or clean. Unknown judgment coverage and unobserved
answer coverage are counted separately. Conditional quantities are null when
not retained; a zero known subtotal is not a complete measured zero.

`answerSerializedSha256` hashes the exact `JSON.stringify(answer)` string;
this preserves distinct decoded unpaired surrogate strings. The separate
`responseArtifactSha256` binds the transport's literal retained response text.
No lossless decoded-answer UTF-8 or original network-byte identity is claimed.
Actual text presence does not change failed-slot completion: a failed slot can
have `actualAnswer:true`, excluded judgment, raw/support predicates false and
categorical correctness unresolved. A completed unjudgeable answer has unknown
raw correctness and safety unobserved; supported-correct is unknown only if
no other mandatory condition is definitively false. Missing/unrun answers are
predicate false and categorical unresolved. Required evidence is cumulative AND; an
incomplete set is definitive false even with unknown correctness/support.

Integrity denied outputs retain exact denominators but null bindings,
provenance/runtime/mechanical/resources and judgment/metric/gain fields;
cases are empty, judgeDomains is null, and the gate is false with
`integrity-denied`. A legitimate parsed malformed/missing/oversized first
response keeps the unchanged helper's literal/hash/retention behavior and
unknown judgment fields; it does not become integrity denial.

Fixtures share one newly owned test workspace. Six genuine preparations/runs
use synthetic bound ledgers and fake HTTP only. The complete fixture contains
all24 cases,48 selections,72 completed answers,168 physical reservations,
336 pre/post records,120 checkpoints and the complete939-file scoring envelope.
Its fixture-only source selection deliberately uses rubric anchors to create
three A-incomplete/B-complete pairs. The scripted labels test deterministic
arithmetic, not a measured retrieval or QA gain. A/B otherwise share exact
required sources, including qualified known-plus-uncertainty answers.

The other actual runs are C-only overlong unjudgeable text; mixed empty B/C,
whitespace rejection, completed unpaired-surrogate on complete-evidence CQ05 A
and overlong answers plus
CQ24 A checkpoint-callback failure after extraction; invalid key before
run-start; checkpoint mismatch after inspecting but before retaining initial
history; and maximum raw262144-byte invalid-UTF8 response failure. Invalid
UTF8 fails the transport's final fatal decoder after retaining replacement-
decoded text. It cannot be substituted for a completed first answer.
The complete fixture additionally returns a valid exactly262144-byte padded
response. Artifact metadata/node/depth/body/aggregate bounds are asserted on
every real fixture. Directory inventory is independently compared with all
runtime reference names and record/checkpoint sequences; full sorted indices,
byte totals, execution records and hashes are printed before owned cleanup.

Test mapping: SC1–6 bind frozen raw/value identities, complete literal artifacts,
source/capture/snapshot/read provenance, ordinary prompt, A/B compiler/assembly,
shared C projection, request text, reservation/post/checkpoint accounting, and
descriptor-first/bounded input denial. SJ1–3 freeze unchanged opaque domains,
first raw hashes, missing/malformed/oversized/disagreed fields and real exclusion
transitions. SM1–3 assert all24/all18/all6 and72 denominators, source sets and102
anchors, any-false three-valued precedence, exact pair bounds, sole AB gate,
C-only unknown independence, per-qualified conservative comparison, per-fixed-
condition severe additions, failed/unjudgeable safety unobserved, and no
Stage2/D12/default advancement. Every semantic tamper uses a clone of owned
retained data and rebinds descriptors/index where applicable; no fake runtime
slot creates an accepted success path. Scope has no browser/product flow.
The two evaluator entrypoints are imported only by evaluation tests; runtime
continues to import only its unchanged CP/PX/transport/core dependencies.

ST1 intentionally precedes the full matrix. Remaining prospective cases for
ST2 include every resource-affordability/history/state-drift branch, all
metadata aggregate/traversal boundaries, equal-versus-literal wire rewriting,
net source-set gains and losses, aggregate unsupported/stale offsets and claim
totals, malformed item/reference variants, and setup/assertion cleanup paths.
No current red outcome is claimed to establish implementation conformance.

Primary's pre-run test inspection found the initially proposed CQ03 A unpaired
fixture also had deliberately incomplete A evidence, which would force
supported-correct false under any-false precedence. Before the first run the
unpaired output moved to CQ05 A, whose complete necessary-source set is now an
explicit test precondition. This aligns the control with the frozen predicate;
CQ01's unknown-correctness/incomplete-evidence test still asserts false.

### ST1 actual red evidence — stop before implementation

One authorized exact Node22.16.0 sequence finished against base4309ff3 and
the current uncommitted stub/test candidate. Command was the absolute22 binary
running `tools/testing/run.mjs evaluation/algorithm-development/test/card-plan-scoring.test.mjs`
inside an `env -i` allowlist with the four required tokenizer/transport flags,
`NODE_DISABLE_COMPILE_CACHE=1`, fresh owned TMPDIR/TMP/TEMP parent, and an
outer1800-second subprocess watchdog. No key or operational environment was
inherited. Before behavior execution, exact version, both `--check` commands
and the complete33544-byte frozen-contract-prefix comparison each exited0.

Actual test child exit: **1**, the required behavioral red. Node reported
45 tests,2 pass,43 fail,0 cancelled,0 skipped,276185.18936ms. The full real
fixture-precondition test and evaluator-only source trace passed. Forty-one
direct failures were `card_plan_scoring_not_implemented`; the two remaining
failures were the23- and11-subtest aggregate failures. There was no syntax,
import, dependency or fixture setup failure. Expected red is not implementation
conformance, a source-integrity acceptance or QA gain.

Full raw unchanged log:
`/tmp/cairn-complementary-qa-acceptance.7sG2vXdH/card-scoring-st1-node22.r9ceea.log`.
SHA-256:
`ec0b10b3c88b2bfa46342489af272eeb86111a1f277bc10283f512d54510e7a1`.
It includes each complete sorted literal artifact index and exact separately
serialized synthetic execution record before cleanup, with their binding hashes.

| Genuine fixture | Status | Files / independently reconstructed names | Calls / pre-post records | AB / C judgeable items | Metadata bytes | Literal artifact bytes |
| --- | --- | --- | --- | --- | --- | --- |
| complete | completed | 939 / 939 | 168 / 336 | 48 / 24 | 11929343 | 13305760 |
| C-unjudgeable | completed | 939 / 939 | 168 / 336 | 48 / 23 | 12055277 | 13230161 |
| edges | halted | 939 / 939 | 168 / 336 | 45 / 23 | 12023053 | 13193999 |
| before-start | halted | 26 / 26 | 0 / 0 | 0 / 0 | 9046966 | 9046966 |
| checkpoint-mismatch | halted | 27 / 27 | 0 / 0 | 0 / 0 | 9059495 | 9059495 |
| replacement | halted | 53 / 53 | 5 / 10 | 0 / 0 | 9133509 | 9957345 |

Every fixture retained all24 case,48 selection and72 answer slots. The complete
fixture recorded120 owner checkpoints and all168 intents settled. Its largest
request was9486 bytes; its maximum valid response was exactly262144 bytes.
Replacement's exact262144 raw bytes produced785652 retained replacement-decoded
bytes, within786432; it had no extracted answer or judge item. The precondition
test checked literal equality with Buffer replacement decoding. The actual
native failure code spelling was not printed in this first log and no invented
spelling is asserted; later implementation must validate the pinned runtime's
actual retained slot/post/report failure shapes rather than an invented grammar.

Complete and C-only metadata each measured424941 traversal nodes/depth11;
edges424283/depth11, early halted292150 and293167/depth8,
replacement297113/depth11. These observed full/max-body fixtures fit the accepted
file/per-metadata/aggregate/node/depth/body envelopes; they are not proof of a
universal preparation/storage footprint or worst-case resource fit.

Shared workspace removal succeeded. The runner-owned parent
`/tmp/card-scoring-st1-parent.Uz6gP7` had zero entries after the failed tests and
its final `rmdir` exited0. Full logs remain outside that parent; original logs
were not rewritten. No second test execution, scorer implementation, dependency
installation, operational script, paid request, commit, push or PR mutation
was performed by the author. Primary inspection and ST2a authorization remain
the next checkpoint.

### ST2a first implementation and focused run — failed, preserved

Primary authorized the closed pure scorer and remaining bounded controls, not
runtime changes, formal reruns or delivery. Actual implementer remained fresh
GPT-6.1 Sol/high; the earlier capacity occurrence was infrastructure failure,
not a product-test result. The implementation validates the bounded literal
artifact graph, frozen preparation and source identities, retained selection
and answer progress, ordinary/card compilation and projection, exact ordered
accounting, separate first-judgment domains and conservative all24 metrics.
Its seven reviewed control hashes are provenance metadata, not runtime-file
attestation. Full logical snapshot consistency is tied to the pinned runtime
and external execution provenance; it does not independently regenerate the
whole storage schema or disprove wholesale self-consistent fabrication.

Frozen first-run module SHA-256 was
`6fcf813787939e391c4d54556bfa900865cfbb0bddc9dc760fe74aaa8d9adada`;
test SHA-256 was
`30e52ba39da737e495901daf0672dae541246c1fb9abd07eedee7d7623240904`.
Exact Node22.16.0 version and both syntax checks exited0. The same credential-
free nine-key allowlist and owned runner as ST1 executed the focused file once,
from 2026-10-12T11:21:49.784Z to 11:27:49.392Z. Actual child and outer exit were
**1**:68 tests,60 pass,8 fail,0 cancelled,0 skipped,359560.949722ms.
The unchanged full raw log is
`/tmp/cairn-complementary-qa-acceptance.7sG2vXdH/card-scoring-st2a-node22.PI51kz.log`,
SHA-256
`de1dfb71b04435a88578c94de5ee78129aea99ce42639b3fddaf7479533b24f5`.

All ten fixtures were fresh actual runtime/store/owned-ledger transitions using
fake HTTP, within one shared owned workspace. Each retained24 cases,48 selection
and72 answer slots,18 answerable/6 qualified cases,288 source messages and102
anchors. Full sorted inventories and execution records were printed before
cleanup; actual directory names matched independently reconstructed runtime
references. SQLite stores and original history are excluded from artifact-byte
counts below, not silently counted as free storage.

| Genuine fixture | Status | Files / independent names | HTTP / records | AB / C eligible items | Metadata bytes | Literal artifact bytes |
| --- | --- | --- | --- | --- | --- | --- |
| complete | completed | 939 / 939 | 168 / 336 | 48 / 24 | 11930686 | 13307098 |
| C-unjudgeable | completed | 939 / 939 | 168 / 336 | 48 / 23 | 12056503 | 13231387 |
| edges | halted | 939 / 939 | 168 / 336 | 45 / 23 | 12024271 | 13195217 |
| before-start | halted | 26 / 26 | 0 / 0 | 0 / 0 | 9047040 | 9047040 |
| checkpoint-mismatch | halted | 27 / 27 | 0 / 0 | 0 / 0 | 9059570 | 9059570 |
| replacement | halted | 53 / 53 | 5 / 10 | 0 / 0 | 9133625 | 9957461 |
| read-state-drift | halted | 37 / 37 | 2 / 4 | 0 / 0 | 9079143 | 9098413 |
| unaffordable | halted | 27 / 27 | 0 / 0 | 0 / 0 | 9058197 | 9058197 |
| net-loss | completed | 939 / 939 | 168 / 336 | 48 / 24 | 11911497 | 13023282 |
| pre-dispatch-failure | halted | 32 / 32 | 0 / 2 | 0 / 0 | 9076241 | 9085576 |

The939-name maximum is3 root JSON+24 cases+120 slots+336 records+120
checkpoints+168 requests+168 responses. Complete and C-only fixtures had424941
metadata traversal nodes/depth11; edges424283/11; before-start292150/8;
checkpoint-mismatch and unaffordable293167/8; replacement297113/11;
drift294183/8; net-loss424269/11; pre-dispatch293913/8. Largest request was9486
bytes; complete's largest valid response was262144 bytes. Replacement retained
785652 replacement-decoded bytes from262144 raw bytes, not equal network bytes.
Its actual slot/post failure code was `ERR_ENCODING_INVALID_ENCODED_DATA`;
report-level projection was `card_plan_request_denied`, both fatal-request-
denial. Failed extraction retained no answer or judge eligibility.

The drift callback genuinely mutated one owned receipt during fake rank HTTP.
Actual selection failure was `storage_error`, report/state/cleanup failure was
`card_plan_store_drift`, and only the before witness remained. Assembly/evidence
were null and authoritativeReads empty: this is pre-assembly drift, not partial
assembly/read failure. The partial-read validation branch was source-inspected
but not reached by that fixture. Unaffordable retained initial count0 but no
original history; nondispatched retained one reserved intent, no HTTP, two
durable records and unknown cost. Both-records-missing reserved-gap and newest
fatal-stop/order guards remain source-inspected, not separately exercised.

CQ08 A's genuine provider usage3/3/6 retained ordinary floating-point ceil cost
7 microUSD, whereas pinned card transport's rational estimator would yield6.
The scorer reconstructs each unchanged estimator exactly; an arbitrary+1 cost
tamper is denied, with no tolerance or invoice claim. Reachable per-file,
body-count, metadata-aggregate, node/depth and key/Unicode bounds passed. The
redundant256MiB aggregate guard is not independently reachable after the other
caps:64MiB+168*(262144+786432)=232MiB. No fabricated accepted precursor tests
that unreachable deeper branch. Common preparation latency, peak RSS and
service cost remain unmeasured; artifact bytes are not SQLite resource cost.

All50 nested tamper, poison, history/pricing and envelope controls passed.
Eight top-level failures are preserved: fixture preconditions incorrectly
expected partial assembly/read; bindings compared null-versus-Object prototype
despite identical JSON data; complete-required counts were0 instead of21;
three-valued control was false instead of unknown; C-only mechanism gate was
false; complete-evidence edge coverage was false; caller-mutation gate was false;
net-loss expected gains were empty. The latter six trace to one scorer defect:
whole verified windows are legitimately metadata-or-mixed with null pure-source
spans, but the scorer incorrectly treated those null spans as absent anchors.
Frozen originMap/window/original-body intersection is required instead; wrapper
bytes must never receive factual credit. Later caller-mutation and claim checks
in failing tests were not reached. A latent unsupported-claim fixture also
contradicted the unchanged helper by giving support=yes with positive counts;
valid known-positive unsupported controls must give support=no.

Shared cleanup removed the owned workspace. Parent
`/tmp/card-scoring-st2a-parent.xYrdzy` had zero residual entries; `find`, final
`rmdir` and absence check each exited0. Original ST1/ST2a logs and ST1 stash
remain untouched. This failed run is not implementation acceptance, semantic
QA improvement, lightweight product fit, restored blinding or readiness.
Primary inspection authorized only the four bounded correction1 changes and
one subsequent focused sequence; no thresholds, runtime, profile, parser,
corpus, previous scores or historical disclosures change.

### ST2a correction1 focused result — green, stop for inspection

The four authorized corrections were applied without changing any frozen gate:
source coverage now intersects verified indexed windows with exact source-body
coordinates from the independently regenerated originMap, checks original CQ
identity/role/event and literal body bytes, and gives no wrapper credit. It does
not invent the verifier's nullable pure-source spans or search for substrings.
The retained CQ01 B regression explicitly observes metadata-or-mixed/null
coordinates, exact wrapper/body boundaries and the correctly covered anchor.
Bindings are compared as exact frozen JSON bytes rather than an unspecified
object prototype. Drift asserts the genuine pre-assembly storage-error shape;
positive unsupported counts now consistently use support=no. The judging
helper is unchanged. Partial assembly/read failure remains unobserved.

Final module SHA-256:
`579d2742477068a733af804565fdc84de624fe68fd3d3c49acc798ea3e40ccef`.
Final test SHA-256:
`2a2a011899559e97445cd4e348d689e74170de937a7cb1be471bd96ef8847526`.
One authorized synthetic-read-port boundary diagnostic using the actual pure
preparer and verifier exited0; version and both syntax checks also exited0.
That micro diagnostic does not prove actual core execution. Its unchanged raw
log is
`/tmp/cairn-complementary-qa-acceptance.7sG2vXdH/card-scoring-correction1-micro.B9mvsP.log`,
SHA-256
`d8fefd5781bc3646fc72228dc2db4bec76dc91be3632c0c82ef6ee2bea3d8d16`.
Primary independently inspected the frozen files and reproduced the micro0.

One fresh exact22.16.0 credential-free focused execution then started
2026-10-12T11:37:25.464Z and ended11:44:09.105Z. Actual child and outer exit were
**0**, signal/error null:68 tests,68 pass,0 fail,0 cancelled,0 skipped,
403594.21531ms. All previously failed and formerly unreached controls passed,
including caller mutation, net source losses and known claim-level increases.
The test command, nine-key allowlist and watchdog were unchanged. Raw log:
`/tmp/cairn-complementary-qa-acceptance.7sG2vXdH/card-scoring-correction1-node22.fu5mIG.log`,
SHA-256
`91aa5da103cc6ed6471a5a96e92a378d57ca1e798e378278dd32f31fce1578ce`.
No source/test edits occurred during this run; their final hashes match those
inspected before it. The original failed run remains intact.

| Fresh correction1 fixture | Files / independent names | Metadata bytes | Literal artifact bytes |
| --- | --- | --- | --- |
| complete | 939 / 939 | 11939281 | 13315693 |
| C-unjudgeable | 939 / 939 | 12065107 | 13239991 |
| edges | 939 / 939 | 12032819 | 13203765 |
| before-start | 26 / 26 | 9047558 | 9047558 |
| checkpoint-mismatch | 27 / 27 | 9060095 | 9060095 |
| replacement | 53 / 53 | 9134396 | 9958232 |
| read-state-drift | 37 / 37 | 9079768 | 9099038 |
| unaffordable | 27 / 27 | 9058723 | 9058723 |
| net-loss | 939 / 939 | 11920128 | 13031913 |
| pre-dispatch-failure | 32 / 32 | 9076807 | 9086142 |

Full sorted literal indices, individual descriptors, exact execution records,
all denominators and envelope node/depth/body maxima were retained in this raw
log before cleanup. Per-fixture HTTP/record/eligible-item counts and node/depth/
body maxima matched the first implementation run's table and envelopes. These
are independently fresh artifacts, not rewritten formal or earlier artifacts.
The complete fixture's scripted A21/B24 and supported-correct difference3
exercise evaluator arithmetic only; they are not an efficacy result.

Shared owned-workspace cleanup was logged. Parent
`/tmp/card-scoring-correction1-parent.CPCtdn` had no entries (`find` actual0),
then `rmdir` and absence check each exited0. Logs stayed outside the parent.
ST1 stash and all original raw proofs remain preserved. The author stops here
before broad/native24 execution, further corrections, commits or delivery;
primary acceptance and independent review remain required. No paid requests,
operational data, parser/runtime changes, restored blinding or readiness claim.

### ST2b exact two-runtime author matrix — complete, stop

After primary acceptance of correction1, the author ran precisely two native
sequences and twelve commands, with primary owning zero concurrent heavy
sequences. Exact22.16.0 session71684 and exact24.15.0 session50832 both finished
with outer exit0. Each command's actual child exit was0, signal/error null;
there were no retries or source/test changes. The module579d274... and
test2a2a011... hashes above remained exact before and after the matrix.

| Command per runtime | Node22.16.0 actual exit / tests | Node24.15.0 actual exit / tests |
| --- | --- | --- |
| absolute Node `--version` | 0 / v22.16.0 | 0 / v24.15.0 |
| owned new focused scorer suite | 0 / 68 pass | 0 / 68 pass |
| owned complete algorithm suite | 0 / 312 pass | 0 / 312 pass |
| guarded owned generic suite | 0 / 784 pass | 0 / 784 pass |
| owned `scripts/validate-json.mjs` | 0 / JSON and version consistency | 0 / JSON and version consistency |
| owned synthetic comparison demo | 0 / SYNTHETIC-ONLY PASS | 0 / SYNTHETIC-ONLY PASS |

All three test suites on both runtimes had0 failures,0 cancelled and0 skipped.
Node22 focused/algorithm/generic durations were480420.958031,
1012163.600578 and233752.675986ms; Node24 were459372.273451,
1020343.521725 and241429.082326ms. The complete algorithm command mechanically
enumerated all28 `.test.mjs` files, including the new scorer. Generic enumerated
13 plugin plus22 architecture files and used the existing client home-guard
wrapper. Exact sorted argument lists, environment key names and per-command
start/end/outcome records are in the raw logs. Validation and demo ran through
`tools/testing/run.mjs --script`, so the demo's synthetic SQLite was contained
in owned invocation scratch. No package installs or operational scripts ran.
`scripts/README.md` is absent; the directly inspected validation script is
read-only/nonoperational. All four tokenizer/transport flags remained1, compile
cache disabled, credential-free nine-key environment and prospective1800-second
per-command watchdog unchanged. No runtime deadline was extended.

Node22 ran from11:46:58.491Z version completion through12:15:45.331Z final
sequence completion on2026-10-12; Node24 from11:46:58.497Z through12:15:40.130Z.
Complete raw logs, not rewritten:

- `/tmp/cairn-complementary-qa-acceptance.7sG2vXdH/card-scoring-st2b-node22.828AP3.log`,
  SHA-256 `4cac7196bb70d5141c60ecd9bb6c1dafdbec45b6cff3501916e4d50e208f9b60`.
- `/tmp/cairn-complementary-qa-acceptance.7sG2vXdH/card-scoring-st2b-node24.6cpaay.log`,
  SHA-256 `e96d13f7d410958f5813218cd375d0700096b2ec570a7c1a717c56ac5915711e`.

Each focused and full-algorithm invocation freshly constructed all ten scoring
fixtures:40 fixture executions overall. Every full sorted literal index and
independently reconstructed reference inventory, execution record and envelope
was printed before cleanup. Each invocation's file counts in fixture order
were939,939,939,26,27,53,37,27,939,32, totaling3958 artifact names, excluding
SQLite stores and old history. Each had679 actual fake HTTP calls/1360 retained
records and189 AB/94 C eligible items across the ten fixtures. These counts
include honest failed/unrun cases, not a changed24/72 denominator.

| Fresh fixture group | Metadata bytes, sum of all ten | Literal artifact bytes, sum of all ten |
| --- | --- | --- |
| Node22 focused | 102414673 | 108101141 |
| Node22 full algorithm scorer integration | 102414505 | 108100973 |
| Node24 focused | 102414737 | 108101205 |
| Node24 full algorithm scorer integration | 102414502 | 108100970 |

Node22 TAP framing and Node24's different reporter formatting are retained
verbatim, not normalized into replacement artifacts. These synthetic tests and
the older comparison demo establish offline orchestration/regression behavior,
not semantic algorithm improvement, paid provider behavior or product fit.

After both sequences finished, owned parents
`/tmp/card-scoring-st2b-node22-parent.1zUtBM` and
`/tmp/card-scoring-st2b-node24-parent.PJLuUo` each had zero entries: individual
`find`, `rmdir` and absence checks all actually exited0. Logs are outside these
removed parents. No unrelated scratch was scanned or removed. Original ST1,
failed ST2a, correction1 logs and ST1 stash remain intact. Delivery manifest
was independently cross-checked from Git status and filesystem enumeration
minus the fixed HEAD tree:exactly the three author-owned paths, unchanged frozen
contract prefix. Primary owns later limitations, direct acceptance, fixed-
candidate independent reviews, commit and PR delivery. The author stops here.

### Primary integration and acceptance schedule

The primary inspected the actual module, fixtures and all correction changes,
independently reproduced the source-wrapper boundary diagnostic with actual
exit0, verified the retained raw hashes and actual command exits, and checked
that both ST2b parents are absent. The original failed executions remain.
The exact three-path author inventory agrees with primary's independent full
filesystem/base-blob comparison over1608 source files. The complete frozen
33544-byte contract prefix is unchanged. The primary now owns only the
serialized limitations append and this acceptance note; no module, test,
runtime, prompt, corpus, rubric or threshold changes are introduced. This is
bounded integration under the frozen ownership contract, not reassignment of
implementation or a substitute for independent review.

Before a candidate commit, primary will directly run ten commands on each
exact supported Node runtime: version, focused scorer,53 core source checks,
51 LongMemEval source/answer checks, full algorithm suite, owned comparison
demo, generic tests, repository validation, marketplace validation and strict
plugin validation. The two sequences keep the same credential-free test
boundaries, four required flags, owned scratch and1800-second per-command
watchdog. Full source snapshots before/after must match. After the scoped
four-path commit, primary repeats version and repository validation on both
runtimes, requiring the same source snapshots. This totals24 primary commands.

Final actual exits, raw-log hashes, four matching source snapshots, four-path
Git/full-filesystem inventory and exact base/candidate SHA will be retained in
the primary evidence packet and PR body. Two fresh nonauthor GPT-6.1 Sol/high
reviewers separately inspect Standards and Spec against that same fixed diff.
Only their accepted final candidate is pushed to a dependent PR against
experiment/card-plan-runtime; all applicable CI must match its exact head.
These prospective checks are not claimed completed by this note. No merge,
release, deployment, operational read, formal preparation or paid call follows
from this offline acceptance schedule.
