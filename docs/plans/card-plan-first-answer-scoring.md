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

### Independent review corrections: original-wire proof and ordinary decoding

Independent Spec review of candidate
`b7f61004381fc4a44f1c62f31e7062290384b0b2` found two blocking parity defects:
successful CW envelopes/proposals used ordinary JSON parsing instead of the
pinned strict grammar, and successful ordinary responses were not constrained
to their endpoint-specific limits or exact recorded responseBytes. Standards
review reported no findings. The review is retained at
`/tmp/cairn-complementary-qa-acceptance.7sG2vXdH/card-scoring-reviews-b7f6100.md`.

The public R1 diagnostic used one genuinely fresh owned synthetic runtime
prefix, real core/stores and fake HTTP. Its unchanged runtime control was
ready:120 total slots,5 retained/115 later unrun;72 answer slots,69 later unrun,
two eligible completed A/B answers and a genuine C failure after extraction.
The halted report was not rewritten into success. Only copied retained
artifacts and their affected references/index were changed for eight negative
controls. All eight incorrectly returned ready:four decoded-key duplicates
in B envelope/proposal/usage/count, ordinary count65537, generation262145,
answer262145 and wrong responseBytes. Ordinary duplicate JSON remained a valid
positive. Original inputs/report were unchanged. Diagnostic child/outer exits
were1, without setup failure; its owned parent was removed after empty-residue
checks. Immutable script SHA-256 is
`f9417b4a18135b78c83d86006c9e048b096dc1becd299be637b3570f806ae46f`;
original raw `card-scoring-r1-red-node22.tILcP2.log` SHA-256 is
`c08031e35d8112dbebd635a26d6b0c47253756bd595ed15a8329f87a0deb8a1d`.
All log basenames below are under the same retained acceptance directory.

The bounded correction requires successful CW post.responseSha256 to be valid
lowercase64-hex and equal the literal retained text SHA before claiming
original-body proof. Unequal hashes produce the existing denied schema with
`insufficient_original_cw_proof`:insufficient proof, not a tampering claim.
Runtime completion, literals and hashes remain intact; no raw reconstruction
or selective redacted-key repair is attempted. The direct-identity path uses
the exact pinned decoded-duplicate-key grammar,100000 value nodes/depth32,
endpoint limits and count fields. Ordinary duplicate JSON behavior is unchanged.
Failed CW responses retain conservative failure handling without a blanket
successful-body limit on their replacement/redacted artifacts.

Permanent public controls were added before implementation:15 targeted denial
and7 acceptance boundary controls, plus two economical genuine prefixes. One
has a completed B selection whose successful response is genuinely redacted
and lacks original-wire identity; it is denied for insufficient proof. The
other has an actual B count HTTP failure with redacted retained text and remains
a valid failure, without source or successful-answer credit. Observed failure
was provider_failed/settled-model-failure, not invented metadata.

First corrected Node22 sequence session25545 actually exited0:two syntax
checks, unchanged public R1 reproduction and focused suite92/92 passing with
zero failures/cancellations/skips. Scorer/test hashes were respectively
`d22614965d04df5157c766a3294c54b0877026f98c2d877802bc2a5cceb61acd`
and `63ce06af20f70048d85f84617a212c6b722333f85bd134d736f79638a9322e45`.
Raw hashes:syntax `card-scoring-r1-syntax.SXWrr1.log` =
`86048a2d8aad92c83abb435892c9df7c451e39e6ead16b282e0cd933b4f5d777`;
public `card-scoring-r1-public-green.u57GiX.log` =
`fa2a2f673004b2dca7199566d2b6a5da9caf1f17c89c02f8278530560dc533fb`;
focused `card-scoring-r1-focused-node22.vHepKu.log` =
`3d5bb7e3a997c6f357de8b48a404596c98ff596b900b986d51ecb23588168160`.
Parent `/tmp/card-scoring-r1-fix-parent.avDypW` empty-find/rmdir/absence
checks each actually exited0. These greens did not cover the next observation.

Primary independently found a legitimate ordinary BOM boundary using a fresh
public runtime prefix:selection completed/post succeeded, literal retained
body56 bytes with leading U+FEFF, but responseBytes53 because pinned fatal
TextDecoder consumes exactly one leading BOM. Public scorer incorrectly
denied successful_response_bytes_mismatch; child/outer1, no setup failure.
Immutable primary script `card-scoring-ordinary-bom-repro.mjs` SHA-256
`7601b0e6a1ab2b67faee00e7a458d923679afb09b7745144e61d001c168df022`;
original raw `card-scoring-ordinary-bom-red.log` SHA-256
`cc6cd7ad9cefa735ac445fb734c5a335eac5275b031b0ec1f106697eaad38aef`.

The additional bounded correction derives ordinary decoded text by consuming
exactly one leading U+FEFF at count/generation/answer parsing seams. It keeps
endpoint limits on literal retained physical bytes, checks responseBytes on
derived decoded bytes, and preserves artifacts/hashes. No trim, repair or CW
change is introduced. A genuine prefix exercises count65536 and generation/
all three answers262144 physical bytes, including BOM; all five ordinary
posts succeeded with decoded bytes65533/262141. A/B completed answers remain
eligible; C failed after extraction through the actual checkpoint halt.
Five wrong-byte and five oversize copied controls are denied specifically;
double BOM is not repaired beyond the single pinned decode operation.

Final focused correction sequence session41929 used exact Node22.16.0,
credential-free nine-key environment, all four required flags1, cache disabled
and1800-second command watchdog. Both syntax checks and both immutable public
reproductions actually exited0; focused child/outer0 ended
2026-10-12T13:42:19.843Z with93/93 passing, zero failures/cancellations/skips.
Public R1 again recorded all eight targeted denials and the unchanged ordinary
duplicate positive; genuine BOM control returned ready. The scripts' embedded
b7 provenance is the historical pre-correction candidate; current source
hashes were separately captured, not mislabeled as clean b7 code.

Frozen corrected scorer SHA-256:
`ce3de16356de916c169d6d22670e10d695e608bc4acb59720c0002f195edfa23`;
test SHA-256:
`be9a12c1e5c7f5f4a949a9c8f1484d79560f84eb97ebf212b05ac00dd693bde0`.
Final raw hashes:syntax `card-scoring-bom-syntax.nbnV7m.log` =
`089a8dd384e87a0e0da79b9cc9b25444eb66232e29e69a574a0c6ff945138fc9`;
R1 `card-scoring-bom-r1-public-green.J8lZLO.log` =
`35397fc95bbb0a63d6f77d2593b6a6754f236a5b809da3fa6c79ae92f6d924fe`;
BOM `card-scoring-bom-public-green.KClMSb.log` =
`25b6b1c8469bf080d0d3004f700fd3afca8ec5444d09a1230d5f0a1d20b9cd2e`;
focused `card-scoring-bom-focused-node22.FCx1uK.log` =
`418f423b6817008d665b83367c4c01311b35db293068efd498eeb96f08c81fbb`.

All13 full sorted artifact indexes/reference inventories were printed before
cleanup and independently reconciled by primary:4137 artifact names,
129843375 metadata bytes and136759555 total literal artifact bytes, excluding
SQLite stores and old history. New prefix inventories were65/49/65 files,
with metadata9163522/9123063/9163712 bytes and total literal
9207374/9152644/10319991 bytes. Original24/72 denominators remain fixed.
Parent `/tmp/card-scoring-bom-fix-parent.O6GWHw` empty-find/rmdir/absence
checks each actually exited0; retained logs are outside the removed parent.
Original RED evidence and previous failures remain immutable.

These changes are evaluator-only parity corrections, not runtime/parser/model/
prompt/corpus/rubric/profile/gate modifications or evidence of semantic gain,
paid-provider quality, product latency/RSS fit or restored blinding. Existing
source-inspected but unreached partial-read limitation remains. Full snapshot
consistency remains tied to external runtime provenance, not independent
authentication of a wholly self-consistent fabricated transcript. Successful
CW redaction can conservatively deny proof even for legitimate runtime success.
Primary accepted this checkpoint and authorized a fresh corrected two-runtime
ST2b matrix; its outcomes will be appended after completion, not presumed here.

### Corrected ST2b worker results and retained setup failure

The first matrix wrapper failed during file discovery, before any version,
test or validation command. Both setup invocations actually exited1 because
the wrapper assumed `/usr/bin/rg`; the inspected executable was under the
Codex package's absolute codex-path directory. This is infrastructure setup
failure, not a behavioral RED or a native-suite retry. The original wrapper
`card-scoring-review-st2b-driver.mjs` remains unchanged, SHA-256
`eced3f497d6fa6b30f0f8d9d38c4853bb05f457184cec94dbaa37e8e11f9d49a`.
Its originally opened `card-scoring-review-st2b-node22.log` and
`card-scoring-review-st2b-node24.log` remain empty, each SHA-256
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
The actual tool stderr/exit observations were copied verbatim and explicitly
labeled, not rerun or presented as independently captured raw stderr, in
`card-scoring-review-st2b-wrapper-failure.txt`, SHA-256
`1d25b75ede1334897ad55b9ccecc12bedef2f201207cb44597c032c1ec659250`.
Both owned parents were empty after this setup failure; sources were unchanged.

Primary explicitly authorized a new wrapper only. The retained replacement
`card-scoring-review-st2b-driver-fixed.mjs`, SHA-256
`93a74b9c8d309c65f81a48e63b4259ada195ecae95a417ea668b414494e5064b`,
uses the inspected absolute rg, discovers28 algorithm/13 plugin/22 architecture
test files, and independently compares each list with directory enumeration.
Generic arguments preserve sorted plugin-then-sorted-architecture order.
The complete command/file lists, nine environment keys and their exact values,
driver/source hashes, prospective1800000ms per-command watchdog and actual
child/final exits are recorded in each raw header/result. Source mismatch also
sets the final reported sequence exit nonzero. Syntax on both exact runtimes
and discovery preflight on both actually exited0, retained in
`card-scoring-review-st2b-driver-preflight.log`, SHA-256
`097a3c1265a84084caf868e3d342f8012742b407ad0fef17fbdadfd24a02dfc2`.
No implementation or test changes accompanied this setup correction.

Author then ran two concurrent credential-free owned sequences, root owning
zero heavy sequences. PATH was the exact runtime bin plus `/usr/bin:/bin`;
TMPDIR/TMP/TEMP were each sequence's fresh owned parent. The four required
tokenizer/transport flags were1 and NODE_DISABLE_COMPILE_CACHE was1. No
credential, HOME, install or paid/operational input was introduced.

| Exact runtime / native session | Version | Focused | Full algorithm | Generic | Validate | Owned comparison demo | Outer exit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Node22.16.0 /63001 | 0 | 0:93/93 | 0:337/337 | 0:784/784 | 0 | 0 | 0 |
| Node24.15.0 /55591 | 0 | 0:93/93 | 0:337/337 | 0:784/784 | 0 | 0 | 0 |

All twelve child exits were actually0, with no signal/error. Every test suite
had zero failures/cancellations/skips. Node22 ran13:54:35.250Z–14:26:58.422Z;
Node24 ran13:54:36.424Z–14:26:54.085Z on2026-10-12. The watchdog was per command,
not per total sequence; all commands completed within it. Complete literal
stdout/stderr, including different Node reporter framing, is preserved:

- `card-scoring-review-st2b-fixed-node22.log`, SHA-256
  `ba51431e7fd2086df383448eb6efbdaae13ad1c6c36fafd2c4313960d57d74a8`.
- `card-scoring-review-st2b-fixed-node24.log`, SHA-256
  `e0ed0ea2aed65bb12564de520db5b2fa2e4db904a76bae4407502f4aa3021e3a`.

Every focused/full-algorithm invocation freshly prepared all13 real synthetic
fixtures:52 executions across four groups. Every full literal sorted index,
independently reconstructed reference inventory, execution record and envelope
was printed before cleanup. Per-group file counts in fixture order were
939,939,939,26,27,53,37,27,939,32,65,49,65:4137 artifact names, excluding SQLite
stores and original history. Each group had697 actual fake HTTP calls,
1396 retained records and193 AB/94 C eligible items. These are aggregate
fixture counts, not a replacement for fixed24/72 case/answer denominators.

| Fresh fixture group | Metadata bytes, all13 | Literal artifact bytes, all13 |
| --- | --- | --- |
| Node22 focused | 129906762 | 136822942 |
| Node22 full algorithm scorer integration | 129906625 | 136822805 |
| Node24 focused | 129906786 | 136822966 |
| Node24 full algorithm scorer integration | 129906675 | 136822855 |

Both raw finals confirm unchanged ce3de163… scorer and be9a12c1… test hashes.
After actual outer0, parents
`/tmp/card-scoring-review-st2b-node22-parent.wok7aT` and
`/tmp/card-scoring-review-st2b-node24-parent.PrTEAW` each had zero entries;
individual find/rmdir/absence checks all actually exited0. Only these exact
owned parents were removed. Logs, both original REDs, all previous failures,
the setup failure and original wrapper remain intact outside the parents.

Precision on CW proof:post.responseSha256 hashes the unredacted parser-input
text **after** the pinned fatal TextDecoder, not an independently retained
physical wire buffer. The direct-identity check establishes that text's
identity within retained-data consistency. It does not authenticate physical
wire bytes or externally attest execution. Historical diagnostic fields named
rawSha256 refer to that recorded parser-input hash; no stronger network-byte
equality is claimed. Unequal successful CW hashes remain insufficient proof,
not proof of tampering/redaction, with no score or invented runtime transition.

Git diff since b7 and independent owned-file Git-blob comparisons agree on
exactly3 author correction paths:module, test and this plan append. Primary's
independent complete filesystem/base audit separately reported4 delivery paths
(including primary-owned limitations),1608 source files and122 relative links;
limitations were neither restored nor edited by this author. The original
33544-byte contract prefix remains exact. During the corrected matrix, no
source/config/dependency changes, commits, pushes, merges or semantic-gain/
product-fit claims were introduced.
The author stops here for serialized primary limitations/integration, direct
acceptance and fresh candidate review. Completed worker matrices do not imply
that those later primary gates, CI, release or deployment have occurred.

Handoff concurrency note:the3-path author inventory above was measured before
primary's serialized new limitations integration. At final shared-worktree
handoff, Git diff since b7 has4 paths because primary has now appended its
review corrections to limitations. Independent author-owned file/blob
comparison still identifies exactly module/test/plan as the3 author paths;
the fourth is explicitly primary-owned, not an undisclosed author edit.
Primary's corrected-worker collector actually exited0 and independently
verified all12 outcomes,28/13/22 inventories, unchanged before/after module/test
hashes and both absent parents. Its wx-retained evidence
`card-scoring-corrected-worker-evidence.json` SHA-256 is
`2d9ee8289e01481e55389c2ec5780420b59b255ab6a6c28af8516168843d810c`;
it was not rerun or rewritten by the author.

### Primary corrected-candidate acceptance schedule

Primary read the complete correction diff and worker result appendix, accepted
the retained RED-to-GREEN evidence, and independently reconciled all twelve
worker command outcomes, exact command inventories, raw hashes, before/after
scorer/test hashes and absent owned parents. The collector above is immutable.
The original b7 primary evidence and reviews remain historical, not acceptance
of the corrected code. Primary now owns the narrow documentation integration:
label earlier matrices as pre-review and record the parser, byte-boundary,
redaction and setup-failure limitations without changing the frozen contract.
No evaluator implementation or test edits are part of that integration.

Before launching the following checks, all four delivery files will be frozen.
Fixed review base remains `4309ff396834f60c237910493c2dc837e11de4dc`;
precommit HEAD is `b7f61004381fc4a44f1c62f31e7062290384b0b2`, with corrected
content identified by full before/after source snapshots rather than claimed
as clean b7 code. Each exact Node22.16.0 and24.15.0 will run version, focused
scorer tests, existing core-source integration, LongMemEval source/answer
integration, full algorithm tests, owned comparison demo, generic tests,
repository validation and both Claude validators. The primary driver retains
actual exit/signal/error, raw output/hash and owned-scratch absence for every
command. Both sequences use scrubbed child environments, the existing four
required flags, compile-cache disabling and the existing1800-second watchdog;
at most two heavy sequences run concurrently.

Only after those twenty commands pass will primary commit the scoped
correction, inspect current contributor/package/CI gates, and rerun version
and validation on both runtimes. Four snapshots must match the final committed
candidate; Git inventory and independent full-filesystem/base-blob comparison
must agree on four paths. The24-command final evidence uses the explicit b7
precommit HEAD, without overwriting historical evidence. Fresh nonauthor
GPT-6.1 Sol/high Standards and Spec reviewers then inspect the same fixed base
and corrected final HEAD. Any new finding follows the existing correction
policy; neither old review nor primary self-review substitutes for either axis.

After both axes pass, a dependent scorer PR may be pushed against runtime
PR408. Exact-head applicable CI and mergeability remain required. This schedule
records prospective acceptance, not results that have not happened. It grants
no main merge, release, deployment, operational access, formal preparation,
paid request or operation on the closed source-bundle cohort. A later fresh
algorithm comparison remains separately frozen and budget-preflighted.

### Prospective offline maintainer scheduling amendment

Status: accepted by the primary DRI before any new full-suite attempt, after
independent GPT-6.1 Sol/high procedural Spec review reported zero blockers.
That review is not final scorer acceptance or new execution authority. Root
owns this narrow acceptance-plan correction. No paid work is authorized.

## Scope and reason

Fixed scorer review base4309ff396834f60c237910493c2dc837e11de4dc; current
precommitHEADb7f61004381fc4a44f1c62f31e7062290384b0b2. Module ce3de16356de916c169d6d22670e10d695e608bc4acb59720c0002f195edfa23
and test be9a12c1e5c7f5f4a949a9c8f1484d79560f84eb97ebf212b05ac00dd693bde0
remain unchanged. No runtime, core, prompt, corpus, rubric, parser, package,
CI, dependency or product deadline change is proposed.

The primary's original Node22 full algorithm invocation failed with337tests,
336pass,0fail,1cancel: existing C5 exceeded180000ms at187213.546706ms.
Node24's ten-command primary sequence passed. Independent primary reconciliation
is retained in card-scoring-primary-timeout-evidence.json, SHA256
8c7312cc92c560eccb4e9d773e40bc5de992a88fca971a943f365874e7f3e237.
The selected original C5 diagnostic passed at62321.302487ms, but this does not
resolve the original timeout. Exact cause remains unknown.

Read-only Node22/24 embedded scheduler inspection establishes that the default
allows availableParallelism()-1 direct file workers, currently15 on this16-core
host. Both original full suites had28files and overlapped, permitting30 direct
file workers plus supervisors/nested children. This is a demonstrated scheduling
exposure, not measured original CPU pressure or proof of causation. CI's runtime
matrix uses separate job runners, not two full suites on this same host.

## Explicit plan revision

The frozen33544-byte original contract remains intact as historical acceptance
scope. Its unconditional sentence "No timeout retry is authorized" and original
requirement for twenty green commands followed by four identical full-source
snapshots are NOT silently treated as satisfied. After independent review and
primary acceptance of this amendment, it permits ONE new offline primary
Node22 full algorithm invocation under changed maintainer scheduling, then the
five previously unrun Node22 commands if it succeeds. The old failed invocation
remains failed and visible. There is no automatic retry and no restoration of
the original acceptance attempt. This narrow DRI engineering-plan revision is
within the user's standing continue/fix/verify request; it grants no new
financial authority, external mutation or formal evaluation operation.

The new algorithm invocation uses the existing owned runner with explicit
--test-concurrency=4 before ALL28 mechanically discovered test-file arguments.
The two independent lists (rg and filesystem) must agree and match package
glob discovery. No name filter, subset, skipped test or changed assertion is
allowed. Four is fixed prospectively, not tuned after outcomes. It caps file
parallelism while keeping the full workload feasible within the unchanged
1800-second subprocess watchdog. One heavy native sequence at a time globally;
no simultaneous reviewer/worker native suite. Inner30s/180s C5 limits, every
other existing test deadline, evaluated30s/200s/20m/8h limits, gates, model,
tokens, request/cost ceilings and all four required flags are unchanged.

Use exact Node22.16.0, inspected tiktoken1.0.22, scrubbed environment, disabled
compile cache, fresh owned scratch, literal stdout/stderr, actual child/outer
exit/signal/error, command times and source snapshots. Observe descendant CPU/RSS
only within the launched owned process tree if feasible, without reading
environment variables, keys or arbitrary host process arguments. Telemetry is
diagnostic and may not replace assertions or certify original causality.

All337tests must pass,0fail/cancel/skip, and scratch must be empty/removed.
If anything fails, stop this sequence without retry or a new concurrency value.
Do not widen the watchdog or deadlines to finish. A pass means the amended
bounded-scheduling gate passed; it does NOT mean the unexplained original
failure is diagnosed/fixed or the uncapped local parallel policy is reliable.

Only following that pass, run the previously unrun owned comparison demo,
generic784tests, repository validation and both Claude validators. These five
are first executions for primaryNode22 on this corrected code, not retries.
All must exit0 with expected counts/cleanup; stop on any failure.

## Evidence and final review

Existing valid primary Node22 version/focused93/core53/LME51 and complete
Node24ten-command evidence remain valid for IDENTICAL functional source.
Before the new invocation, primary may append only this plan revision and
original failure/limitations to the two existing documentation files, then
freeze all four delivery files. Independently compare all1608 source hashes:
only those two documentation hashes may differ from the original Node24 proof;
the other1606 must be identical. This is explicit documentation-only provenance
reconciliation, not a claim all original full snapshots match the final tree.
No extra source path or functional byte can be excluded from this comparison.

After the new six commands pass, primary may commit the four scoped paths,
inspect contributor/package/CI configuration, and run postcommit version plus
validation on both exact runtimes, sequentially. The new six-command snapshot
and both postcommit snapshots must match the committed tree exactly. The final
evidence must show24successful command observations AND the retained failed
25th observation, separate from the one selected diagnosis. It must label which
commands used original versus bounded scheduling, and reproduce exact argv,
raw hashes, original failure cause/unknown causality and cleanup results.
Never pool the selected diagnosis into the full-suite denominator.

Fresh independent nonauthor GPT-6.1Sol/high Standards and Spec review of the
same fixedbase/finalHEAD remain mandatory, including this revision and all
original failure evidence. A reviewer may reject the revision; no primary
self-review or old b7 review substitutes. Only a candidate passing those axes
may be pushed as a dependent scorer PR. All applicable exact-head CI must then
pass with the unchanged repository commands and mergeability confirmed. CI
failure remains failure, not automatically rerun. No main merge/release/deploy.

Remaining limitations: initial uncapped concurrent local failure unresolved;
no measured reliability guarantee under arbitrary host load; synthetic tests
are not real algorithm accuracy, semantic gain or lightweight product proof.
Operational keys/config/ledger, formal preparation, paid calls, closed-cohort
rerun/reprepare/resume/retry/rescore/rejudge are excluded throughout.

## Numeric response parity correction — N1–N4

Parent candidate610751ed3ab6cd3fc3eebeff95445bc79ad967c0; fixed delivery review
base4309ff396834f60c237910493c2dc837e11de4dc. The parent's Standards0/Spec1
blockingP2 review remains historical, and the original C5 timeout remains
unresolved. No prior logs, snapshots, reviews or consumed receipts are replaced.
This append leaves the original33544-byte contract prefix intact.

The following acceptance scope is retained from the primary's prospective
card-scoring-numeric-parity-contract.md:

N1. Before an implementation change, reproduce with actual fresh pinned runtime,
real local tokenizer/core, synthetic ledgers and fake HTTP only. Inject literal
negative zero in an ordinary count response and a CW count response in separate
fresh fixtures. Preserve actual runtime failure/status and literal artifacts;
do not fabricate a completed slot or mutate the report to construct the case.
Prepare/score should assess valid retained halted evidence, keep all24 cases,
unknown/unrun answers, failed original status, no semantic/default promotion.
An integrity denial instead is the intended RED, not import/setup failure.

N2. Before deciding the patch, inventory raw provider numeric predicates for
ordinary count, rank usage, answer usage, CW count, CW generation usage, and
ordinary floating versus CW rational pricing. Separate them from strict
canonical metadata/identity/accounting input predicates. Include -0, -0.0,
-0e0, negative underflow, positive zero, negative integers, fractions, nonfinite
JSON numeric results, unsafe integers and applicable endpoint/token bounds.
Pure differential checks may cover spellings; genuine runtime fixtures must
cover the affected halted paths, not just a copied acceptance predicate.

N3. Root must inspect original RED evidence and actual artifacts before author
changes implementation. Preserve root cause distinctions: the scorer must not
relax the runtime's persistence failure or report such a run as completed.
Only raw-provider numeric replay and derived-price validation may be corrected;
metadata's negative-zero/prototype/Unicode/canonical rules remain strict.
No runtime/transport/core/prompt/model/corpus/rubric/helper/package/CI edits.

N4. After RED acceptance, implement the minimal correction and permanent
regressions within the existing module/test/plan paths; primary owns the
limitations append. Preserve the original33544-byte contract prefix. Every
new genuine fixture independently verifies source inventory, runtime status,
retained first bytes/hash, accounting consistency and owned cleanup. Keep
negative invalid-count/usage controls; do not make all numeric values valid.
All first-answer denominators, judgment/gain/safety/resource predicates stay.

### Accepted RED and numeric inventory

Actual primary D1 session34827 exited1 at a faulty reproduction precondition:
it compared a canonical receipt session with the original corpus session ID.
No runtime comparison or scorer verdict was reached. Its raw log remains
card-scoring-negative-zero-red.log; it is a setup failure, not behavioral RED.
Only the external setup assertions were corrected, preserving full canonical
batch/window/original-source binding rather than dropping source verification.

Primary corrected-setup D1 session51305 exited1 at the final N1 acceptance
assertion after both real fresh runtimes, scorer verdicts and owned cleanup.
Raw card-scoring-negative-zero-red-corrected-setup.log SHA256
66bccf643fb977d8d5be1bda8b1f0fe374f2a1152579afde6c7204c0edd2311b.
Primary's independent literal artifact audit exited0: filesystem/reference
inventories33/33 ordinary and43/43 CW; actual fake calls1/3; raw response -0,
canonical post0; original card_plan_persistence_failure retained. Both prepare
and score denied both fixtures as count_response_mismatch. Primary inspected
these artifacts before releasing D2. The setup failure and original timeout
remain failures; neither is counted as the accepted behavioral RED.

Primary showed three ranked hypotheses before correction: overstrict raw
numeric replay, JSON normalization inconsistency, or missing accounting.
Literal identity/inventory and settled-ledger evidence excluded the latter two
at this boundary. The raw scorer predicate alone rejected the transports'
accepted signed zero; runtime observation copying correctly remained strict.

| Endpoint | Raw numeric rule | Successful token bounds |
| --- | --- | --- |
| Ordinary count | Safe integer >=0, including signed zero | input<=7024 |
| Ordinary rank usage | input/output/total safe integers >=0; total=input+output | input<=7024, output<=1024 |
| Ordinary answer usage | prompt/completion/total use the same rule | input<=7024, output<=512 |
| CW count | Same rule; exact two-field count envelope | input<=7024 |
| CW generation usage | Same three-value rule and sum | input<=7024, output<=1024 |

Successful generation cost remains<=5000. Ordinary pricing remains exactly
Math.ceil(input*0.4+output*1.6), including derived -0; CW's bigint rational
estimator remains unchanged. Safe-integer checks accept parsed -0, -0.0, -0e0
and negative underflow such as -1e-999, plus positive zero. Negative integers,
nonzero fractions, nonfinite JSON numeric results such as1e309, and unsafe
integers fail. Bounds reject safe over-limit values separately. Canonical
metadata/identity/accounting predicates still reject signed zero.

### Bounded implementation and permanent cases

Author: /root/scoring_numeric_parity61, actual GPT-6.1Sol/high. Owned paths are
the scorer, its existing test and this plan append; primary owns limitations.
The separate providerInteger predicate changes only raw usage, raw count and
derived-price replay. integer(), canonical JSON, prototypes, Unicode and all
identity/header/checkpoint/accounting checks retain their original rules.
Both public entrypoints prepareCardPlanScoring and scoreCardPlanComparison use
this same replay boundary; no runtime/provider/corpus/rubric entrypoint changes.
Existing all-denominator, first-response, judgment/gain/safety/resource checks
remain. Genuine runs keep their failed/not-run states and do not gain semantic
or default-advancement credit.

Five new fresh runtime fixture modes cover ordinary count, CW count, ordinary
rank usage, CW generation usage and ordinary answer usage. Literal Response
strings preserve signed zero. The three usage fixtures contain all signed-zero
usage fields; ordinary rank/answer independently assert derived -0 and canonical
durable/SQLite +0. Each mode verifies24stores/288captures, canonical receipt and
original-source mapping, unique memories/receipts, exact retained first bytes and
hash, callback/durable-record distinction, genuine halt, reservations/costs,
fixed24/48/72denominators, first-answer exclusion, and owned-root removal.
Shared preparation teardown remains immediately registered and all five roots'
removal is individually checked after the shared owner cleans up.

There are43 explicitly synthetic retained-copy controls:11fields each receive
one accepted zero spelling and one invalid-number class (22),16endpoint-bound
cases, three inconsistent totals and two strict metadata signed-zero controls.
All six zero spellings and all five invalid classes occur in this orthogonal
table. This new prospective test design avoids repeating full24-case retained
validation for a Cartesian product; no existing test or assertion is removed.

| Endpoint/field | Accepted spelling | Invalid class |
| --- | --- | --- |
| Ordinary count input_tokens | -0.0 | -1 |
| CW count input_tokens | -0e0 | 0.5 |
| Ordinary rank input_tokens | -1e-999 | -5e-324 |
| Ordinary rank output_tokens | 0 | 1e309 |
| Ordinary rank total_tokens | 0.0 | 9007199254740992 |
| CW generation input_tokens | -0 | -1 |
| CW generation output_tokens | -0.0 | 0.5 |
| CW generation total_tokens | -0e0 | 1e309 |
| Ordinary answer prompt_tokens | -1e-999 | 9007199254740992 |
| Ordinary answer completion_tokens | 0 | -1 |
| Ordinary answer total_tokens | 0.0 | -5e-324 |

Finite count controls, negative usage input/output pairs and endpoint maxima
carry coherent canonical post/usage/cost/ledger/resource observations so their
intended numeric rule can be isolated. Other invalids are labelled raw-consistency
or type controls, not independent runtime or isolated-predicate evidence.
Copies never alter original literal runtime artifacts or promote completion.

Prospective test increment:50 Node tests, consisting of two parent tests,
five genuine subtests and43copied controls. Focused scorer therefore expects
143tests (previous93); all28algorithm files expect387tests (previous337).
These counts are frozen before the first new full-suite result and require
primary independent reconciliation. The shared fixture set grows13to18; native
deadlines and the1800-second command watchdog are not enlarged.

### Accepted prospective verification schedule

The following schedule is retained from the independently reviewed and primary-
accepted card-scoring-numeric-verification-amendment.md, accepted before any
corrected-suite outcome (2026-10-12 UTC). This is an engineering verification
plan, not a financial or live-run grant.

The610751e candidate passed its amended native gates but has one blockingP2
Spec finding. Those results remain true for those exact bytes, not the next
candidate. Its independentStandards0/Spec1 reports and original C5timeout stay
retained. The previous single-use scheduling receipt is consumed and must not
be reused, deleted or reset. This is a newly scoped code correction, not a
retry of the earlier unchanged candidate or a formal benchmark operation.

The numeric-parity contract N1–N4 remains the behavioral scope. First establish
genuine halted-artifact RED in two count paths; then inspect adjacent numeric
usage/pricing boundaries before patching. Extend permanent regression coverage
to every affected endpoint family using actual fake-HTTP runtime observations,
with raw negative-zero spelling tests and invalid-number controls as applicable.
Keep the strict metadata predicate and runtime persistence failure unchanged.

To avoid redundant whole-suite execution, the worker runs only the bounded
reproduction/targeted correction checks, not another complete native matrix.
Primary directly owns the complete final integrated native matrix. Every test
in the focused scorer file runs inside the unfiltered full algorithm suite;
there is no second standalone invocation that rebuilds its entire fixture set.
This explicitly revises the original contract's duplicate worker+primary full
matrices and separate full-fixture focused invocation for this correction.
It does not reduce assertions, omit a test file, skip a required supported
runtime or substitute code inspection for behavior.

Before launching the corrected full matrix, freeze all four delivery files
and the exact expected test counts. Independently reconcile all28 algorithm
files through Git/rg and filesystem enumeration. Both exactNode22.16.0 and
24.15.0 run sequentially, one heavy sequence globally, using these commands:

1. node --version
2. node tools/testing/run.mjs --test-concurrency=4 <all28algorithmtestfiles>
3. node tools/testing/run.mjs <the same4core-source integration files,53tests>
4. node tools/testing/run.mjs <the same5LongMemEval source/answer files,51tests>
5. node tools/testing/run.mjs --script evaluation/longmemeval/comparison-demo.mjs
6. npm test (all784generic tests)
7. npm run validate
8. claude plugin validate .
9. claude plugin validate ./plugins/cairn-memory --strict

Node24 also uses the prospectively fixed file-concurrency4 for this new local
matrix. Repository package/CI commands remain unchanged; exact-headCI on both
runtime versions is separate and still required. Every original inner deadline,
evaluated limit and1800-second command-work watchdog remains unchanged. Use the
already reviewed bounded owned-command helper; no hidden timeout retry or cap
tuning. Any failed command stops that sequence and requires a new diagnosis,
not automatic repetition. Preserve original exits and raw output before acting.

Both full matrices require all expected tests pass,0fail/cancel/skip, no watchdog
or termination intervention, verified ended children, and empty/removed owned
scratch. Scrub inherited credentials/config, disable compilecache, retain all4
required flags and inspected tiktoken1.0.22; no package install/cleanup.
Bind full1608-file before/after hashes. Git and independent filesystem/base-blob
inventories must agree on exactly4scoped paths; original33544-byte prefix stays.

After both9-command matrices pass, commit the scoped correction, inspect current
contributor/package/CI gates, then version+validation on22and24 sequentially.
All four new snapshots must match the final committed tree;22new actual exits0
are required. Earlier evidence is historical, never pooled into these22. Retain
originalfailedobservations alongside it. Two fresh independentnonauthor6.1Sol
Standards/Spec reviewers inspect samebase4309andfinalHEAD. Push a dependentPR
only after both pass; then all27applicableexactheadCI and mergeability.

No mainmerge/release/deploy, formalprepare, providercall, operationalkey/config/
ledgerread or closed-cohort operation. No semanticgain claim from this matrix.

Procedural review: /root/card_scoring_spec61, actual GPT-6.1 Sol/high,
read-only on610751e,0 findings. Reviewer independently reconciled28algorithm
files and3workflow files, inspection commands actual0. No native/paid calls.
Primary accepts this explicit scheduling revision, not any corrected bytes.
CI floating Node24 is not claimed to be the local pinned24.15.0. New full
matrix remains blocked until genuine RED, correction inspection, fixed counts
and source freeze. Existing single-use receipts stay consumed and immutable.

Author's D2 native authority is exactly one corrected external two-fixture GREEN
using the original inspected reproduction, scrubbed Node22.16.0, the owned runner
and unchanged1800-second watchdog. No entire scorer suite or other heavy command
is authorized to the author. Primary owns the subsequent full matrices, commit,
independent reviews and delivery; no worker commit/push is authorized here.

### D2 author bounded GREEN evidence

Exactly one author native invocation ran, session80501. Actual outer exit0,
owned child exit0/nullsignal; elapsed47757.863955ms. The reviewed owned-command
helper SHA2566d0ec3dcf25528c3237e10621f90b6fb245bb9b40d8d5b701500466391a14548
ran exact Node22.16.0 tools/testing/run.mjs --script against the unchanged
external card-scoring-negative-zero-repro.mjs, SHA256
ae2c040132bc81da549d25747b5ac4698d3fb6b9673300fcd3561cc5110a3c0f.
The literal launch argv, scrubbed fixed environment, all four required flags,
disabled compilecache, original1800000ms watchdog, raw artifacts and process
ownership/result evidence are retained in
card-scoring-negative-zero-green-author-f75d20d2-08e6-455c-b0f0-0e500fb6fa98.log,
SHA2565f94ad01e69e013e1d02d310b89550891af923c2c5f0e41a3d3860103a4ae7e4.

Both genuine cases retain halted/card_plan_persistence_failure with no first
answer. Both prepare and score return valid evidence. Filesystem/runtime-reference
inventories agree33/33 ordinary and43/43 CW; actual fakecalls remain1/3.
Artifact index SHA256 values are respectively
7303ed35bce6875448db00f8524fad9f144650bdde3cba68bfaf12d6726b6e30 and
4f13f108ad70ac1f565565e0c048a966a25a0c73fd9c57a93c236c3a5952bd4e.
No watchdog, signal, termination, observer error or surviving owned process was
observed. Verified ended children, empty fresh parent and owned-root removal
passed; the newly owned outer parent was also removed. No old scratch was swept.

Module/test source hashes before and after that invocation agree:
c7517199b74aeb3cde8eadb5d31744043e8080f5fcced3a57a95cb0418f4de7d and
9f24f1bc5117520aad945b5231addf774de6bd83f82565f91fed2810a595b123.
The plan hash likewise matched during execution; only this result append follows
it. Both module/test syntax checks, git diff --check and original33544-prefix
comparison separately exited0. Primary independently inspected the complete
module/test changes and reconciled the original21parent tests plus the new
two parents/five genuine subtests/43controls, yielding143scorer/387algorithm.

This bounded GREEN verifies the original two count paths, not the new full
permanent suite. The author did not execute its five-fixture test group, the
entire scorer file or a full matrix. Those newly authored assertions remain
pending primary integrated verification under the accepted schedule; no native
acceptance, independent review, commit or push is claimed here. Earlier failed
observations remain retained and are not pooled into this one GREEN.
