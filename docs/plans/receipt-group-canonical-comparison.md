# Fresh canonical selection-policy QA24 contract

Owner: primary DRI. Fixed before new case authorship, implementation or model
outputs on 2026-10-13. Parent/runtime base:
`274a45d62d84dc8fcb0605565bcb0ab60928c51d` (PR #418, unmerged).
This is the next bounded P4 candidate, not a new general evaluation framework.

## Advancement decision and immutable history

The independently audited new canonical six passed its prospective structural
gate: five nonempty compiled first responses out of six; all six consumed and
nonfatal, 12 settled intents, no unknown/pending usage. Shapes were elicited in
3/6. Among five compiled cases, 14/15 diagnostic anchors were selected and
15/15 were available on chosen whole cards; none was delivered to an answer.
The failed case's source availability is unknown. Its first proposal put six
distinct cards in one group, violating the unchanged three-card group cap.
Provider response completion is not successful selection: its settled outcome
is failed `invalid_model_output`. This is not a QA score or a fix claim.

Root has fully read both independent outcome reviews and chooses ADVANCE TO A
FRESH MATCHED QA24, not another shape-only gate. Keep future selection failures
in the fixed denominator. No new all-shapes criterion or repair of the failed
case. All older cohorts, artifacts, answers, judgments and thresholds remain
closed: no retry, resume, repair, reprepare, recompile, rescore or rejudge.

## Q1 — scope and ownership

Use an isolated dependent worktree/branch; do not touch main, existing parents,
core, adapters, old fixtures/runners/scorers, transport profiles, package files,
dependencies, production, credentials or installed user profiles. No merge,
release, deploy or historical cleanup. Three new purpose-specific modules:
`evaluation/algorithm-development/receipt-group-canonical-comparison-{store,runner,evaluation}.mjs`;
new source cases/rubric JSON; two focused tests; tracked plan; append-only
limitations; one required CI suite addition. Ten intended tracked paths.
No third feasibility-engine profile, arbitrary policy hooks, wholesale clone of
the old three-arm runner, new HTTP implementation or general plugin framework.

Runtime worker owns the three modules, two tests, plan, limitations and CI.
Independent corpus worker owns only the two new JSON files, in a separate
worktree. Root integrates those exact bytes, verifies them and owns candidate
commit/PR/CI. Neither author can be a final Standards/Spec reviewer or semantic
judge. All assigned workers use actual GPT 6.1 Sol/high. One local native/heavy
test lane; no paid work in either worker assignment. Read-only primary work and
corpus writing may run alongside the runtime worker's bounded lane.

## Q2 — population, sources and prospective freeze

Exactly RQ01–RQ24 in ordinal order; six P4 families with four variants each:

| Slots | Family | Variant order |
| --- | --- | --- |
| 01–04 | detail-retention | nonopening number; middle condition; tail exception; attributed assistant instruction |
| 05–08 | lexical-paraphrase-cjk | exact lexical; paraphrase without shared keyword; Chinese query; mixed-language alias |
| 09–12 | multi-session-links | two-session dependency; three-session chain; distractor link; missing-link abstention |
| 13–16 | event-time-late-import | event versus ingestion time; late old import; relative date; overlapping scopes |
| 17–20 | proposal-adoption-premise | unadopted proposal; explicit adoption; premise changed/reconfirm; reaffirmation without replacement |
| 21–24 | unknown-conflict | absent source; unresolved conflict; partial support; quoted third-party claim |

This is a hand-authored, stratified synthetic development population, not random
natural-history sampling or official LongMemEval. Use wholly new literals,
subjects, facts and questions, not renamings of closed cases. The four variants
in every family have respectively 6, 8, 10 and 12 cards: 216 cards total. One
card per case has two distinct receipts; other cards have one: 240 source turns.
Each pair's turns occur in one two-message session and are captured as one card;
the remaining cards each use one single-message session. All sources are short
natural utterances, at most 240 UTF-16 units each; questions at most 300.
Include genuinely competing same-domain distractors and neutral context, not
labels such as 'irrelevant to the query'. Distribute relevant positions, use
the specified relation/uncertainty variants, and do not encode answers in IDs.
No selection output or future answer may influence authorship or sampling.

Source JSON shape: version `receipt-group-canonical-comparison-cases-v1`,
caseOrder, cases. Each case has id, family, variant, namespace, query{text,date},
history{sessions:[{sourceSessionLabel,date,turns:[{sourceLabel,role,content}]}]},
scriptedExtraction{cards:[{cardLabel,content,kind,confidence,sourcePartitions}]}.
Namespace: ownerId `canonical-comparison-source-only`, scope `project`, projectId
`lme-case-` plus SHA256 of `receipt-group-canonical-comparison-v1:` + case id.
Dates use the existing dataset-local parser format; query is after the sources.
Source partition labels bind exact submitted messages; both messages of the
two-receipt card are in one partition. All remaining partitions are singletons.
The scripted card content is the literal source text(s), kind=context,
confidence=1; it is bookkeeping, not model-generated extraction or gold.

Separate rubric JSON: version `receipt-group-canonical-comparison-rubric-v1`,
protocol, caseOrder and cases. Per case: id, requestedPropositions,
acceptableUncertainty, optionalBackground, requiredAnchors (exact sourceLabel
and quote), requiredSourceSets, unsupportedExamples, staleExamples,
severeErrorRules, calibration (conciseCorrect, explainedCorrect, nearMiss).
Freeze correctness on the REQUESTED answer, not verbosity or optional rationale.
Necessary entity/scope/time/uncertainty qualification remains required.
Frozen protocol records agreement-only/no-adjudication, all claim/safety rules,
the same-family blind-judge limitation and the paired interval method below.

A source-only loader validates exact schema, counts, source partitions, roles,
dates, Unicode and source hashes. No rubric imports in store/runner or model
ports. Static freshness checks compare question/source hashes with the known
development fixtures only; do not inspect held-out official gold. Publish all
24 slots and counts. Freeze final source/rubric hashes and instructions before
any paid preparation or model output; retain pre-model authoring corrections.

## Q3 — matched genuine capture and model-visible inputs

Prepare the complete durable roster before dependencies/capture. Reuse genuine
`prepareMixedSourceCase`, matching question/project identity and unchanged
helper-issued `longmemeval-ingestion-v1` capture inputs, sourceMap/originMap,
roles and event-date wrappers. Capture through real indexed-evidence core;
scripted exact extraction/unfiled classification isolates retrieval selection,
not end-to-end memory formation. No SQL insertion or forged provenance.
Persist capture/read observations, close and cold-reopen identical stores for
both arms. Require every planned receipt, authoritative complete core.get,
complete-map/exhausted scan/complete recall and no truncation or omission.

Use source-evidence, bounded-keyset candidates, bounded-source-scan, limit=6.
Ordinary rank is the only A model operation before its answer. No select call
or seed/fallback expansion. Construct an independent literal oracle from actual
core.get receipts. Compare both intercepted rank inputs and actual serialized
count/generation inputs: A === {query:B.query,limit:B.limit,candidates:B.cards}.
Assert every ordered namespaceIndex, memory id/revision/currentness, receipt
id/role/full wrapped excerpt, receiptCount, interpretationStatus='omitted' and
sourceSelectionCoverage='unassessed'. Outer scan metadata is asserted separately,
not incorrectly claimed to be wire data. Whitelist wire fields: no family,
variant, source labels, scripted interpretation, gold, anchors, other-arm output,
client/session/event metadata or diagnostic relationship truth.

## Q4 — exactly two fixed selection policies and common answer

A: unchanged createAlgorithmDevelopmentTransport.model.rank, actual first refs,
compileOrdinaryCardSelection, genuine assembleCardPlanEvidence/packCardPlanAnswer.
B: unchanged canonical prepare/invocation/transport/assembly/answer APIs.
Keep raw proposal and exact first response hash distinct from canonical proposal,
policy/removal counts and derived RG/CP bookkeeping. No repair, fallback,
additional generation or model-chosen invented source. Empty valid selection is
valid, may receive an empty-source answer and is not an automatic failure.

Use the same complete flat whole-card answer request builder, instruction,
gpt-4.1-mini-2025-04-14 and caps. Every chosen card and receipt appears once,
with actual roles/date wrappers. No group metadata, rationale or oracle enters
answer context. Use genuine assemblyEvidence.units, not a serialized substitute.
Assert the actual generic answer HTTP body equals the checked packer's request.
Selection order is part of treatment and must not be resorted for a match.
This compares compound selection policies (prompt/schema/constraints/order),
not the isolated effect of deduplication or a model upgrade.

## Q5 — sufficient resource fit before dispatch

Bind real tiktoken@1.0.22 and both selector count/generation request witnesses,
including schemas. Measure genuine CP/RG intermediate requests separately.
Certify every permitted <=6-card answer subset/order without trimming: build
each exact flat unit independently from authoritative receipts; let B0 be exact
empty full answer HTTP request UTF-8 bytes and Wi each evidence member's added
bytes after inner serialization and outer string escaping. Require
B0 + sum(the min(6,n) largest Wi) + max(0,min(6,n)-1) comma bytes <=6000.
Bind the byte-level tokenizer's tokens<=UTF-8-bytes property, with independently
enumerated fresh small-pool controls, escaping/CJK/astral controls and real
token checks. Do not assume BPE concatenation subadditivity. If this sufficient
bound fails, preflight refuses: retain the frozen roster and do not truncate,
drop, reorder or tune sources after model output. Unproven fit is a blocker,
not an answer failure relabeled as success.

## Q6 — single-use run, failures, accounting and deadlines

Report version `receipt-group-canonical-first-answer-comparison-v1` has all
24 case slots, 48 selections and 48 answers before dispatch. One-use capability,
frozen code/dependency/artifact/store identities. Selection order alternates AB,
BA; answer order uses BA,AB,AB,BA repeating, independent of selection output.
No retry/resume/replacement; selection failure leaves its dependent answer
explicitly unanswered, all 24 remain in denominator. Other settled ordinary
failures continue only after every-terminal health/state/accounting checks.
Fatal provenance/state/persistence/authentication/usage/ledger anomalies stop
the whole run, preserving all unrun slots and first failure, even if combined
with an ordinary error. Cancellation and original monotonic deadlines apply
across all asynchronous callbacks, holds and factories; never restart a clock.

Reuse createSourceBundleGuard, existing bound ledger/record/checkpoint APIs and
fixed transports; one ledger owner at a time. Record literal first requests,
responses, returned artifacts, post settlements, hashes, latency and tokens.
Unknown usage retains full reservations; no operational ledger in tests.
Successful maximum: 48 count + 48 selection generation + 48 first answer =
144 physical intents, 96 generations, 720000 microUSD reserved at 5000 each.
Limits: local input6000/provider7024, selection output1024/answer512, core
logical30s/physical200s/case1200s/run28800s. No judge API budget.
Unchanged generic opening requirements remain 1968 intents and US$10 beyond
protected US$30 at EVERY open. With serialized phase reopen, initial preflight
must cover 2111 remaining intents and US$10.715 beyond protected US$30.
No budget reset/refund; original cumulative US$400. Current budget must be
inspected again before any separate private one-shot operator release.

## Q7 — evaluator-only, first judgments and fixed-denominator decision

Freeze source/rubric/record bindings; evaluator never drives model selection or
reconstructs a new proposal to repair an actual failure. Validate actual sent
answer body and retained artifact linkage before computing delivered-anchor
presence. Use existing source normalization on exact required spans with
source/role identity. Report stored, selected, available and actually sent
separately; failures/unrun/unknown stay explicit over every frozen anchor.
Presence is not support or correctness. The targeted metric is actual sent
positive-anchor presence, never whole-card availability alone.

Judge unsupported claims against the question and ACTUALLY DELIVERED source
evidence, not the full frozen source truth. Judge correctness and stale/severe
errors against the full truth with its scope, time and attribution. A claim can
be factually correct yet unsupported by the evidence the answering model saw;
retain both findings. Optional explanatory claims still require delivered
support. This prospective clarification precedes every model output.

Use existing blind-packet/first-judgment primitives where suitable. Two distinct
nonauthor judges each see randomized opaque answer labels, question, full source
truth, frozen rubric, actual answer and actually delivered source evidence;
not arm, proposal, other judgment or old output. Retain original first response
from each, no adjudication/rejudge. Missing/disagreed correctness=unresolved,
no correct credit. For every produced/accepted answer, unsupported/stale/severe
unknown or disagreement blocks advancement. A proven absent/no-accepted-answer
slot has `safetyDisposition: 'not-observed-no-answer'`: retain this N/A separately,
never credit it as clean or fabricate claims/correctness. It does not impose an
extra all48-completed gate. Fatal or unknown execution/accounting independently
blocks resource/integrity acceptance. This is a prospective clarification from
independent contract review, not relaxation of any closed result. Retain each
judge's affected claim/total claim counts separately plus question-level harm
counts over24. N/A does not establish safe or useful behavior on that case;
completion and later Stage3/host acceptance remain separate.

Correct/incorrect/unresolved and completion per arm/24; each family/4; all paired
transitions and missingness. Predeclare a paired difference interval using the
existing exact paired bootstrap implementation if available and fixed seed
20261013 / 10000 draws, otherwise implement deterministic paired percentile
bootstrap under those constants; disclose it as an exploratory interval, not a
significance test. The primary paired bootstrap codes correct=1 and all other
fixed-denominator outcomes=0. Also report best/worst unresolved paired bounds,
varying only produced answers with missing/disagreed correctness judgments;
known unanswered slots can never receive hypothetical correct credit.

Advance pilot only with B correct minus A correct >=3/24, strictly improved
actual sent-anchor count, no higher unsupported/stale question counts, no new
predefined severe failure, known safety and accepted resource accounting.
Severe rules cover unsupported adoption/current-state and entity binding in
relevant cases; separate fresh offline namespace/expiry fences remain mandatory.
This is a P4 pilot threshold, not statistical proof, comparator parity or product
readiness. The case schema/evaluator must not reward universal abstention.

## Q8 — observable offline and delivery gates

Real-core/fake-HTTP tests exercise the full24/two-arm healthy path, exact144
intents/96 generations, identical input/complete packing, raw versus canonical
preservation, firstness, empty selection and delivered-anchor metric. Explicit
negative controls: six distinct cards in one raw group (ordinary failure, next
case continues), wrong/stale/revision/role/source, missing contexts, overflow,
one-use clone/reuse, artifact/store drift before and after failure, hostile
accessors/proxies/thenables (zero executed hooks), cancellation/deadline/unknown
usage, persistence failure and fatal/ordinary combination. Scoring controls
cover concise/explained equivalence, near misses, absent judgments, disagreed
harms, safety unknown, fixed denominator and always-abstain not passing.
Namespace/expiry/source isolation use new synthetic controls, not historical
replay. Use owned workspaces and assert successful and failed subprocesses
leave no unexpected residue, no survivor and all native resources closed.

Root personally checks source/rubric adequacy, real decoded wires, actual diff
and regression coverage, then reruns focused tests plus full
test:algorithm-development, npm test, npm run validate and both existing Claude
plugin/marketplace validations on Node22.16.0 and24.15.0. No TypeScript gate.
One native lane. Preserve actual exit codes, failed attempts and explanations.
Freeze only scoped files, audit inventory by Git and independent filesystem/base
blob comparison with count, review exact candidate/base independently on both
axes, then push PR and verify all exact-head CI/mergeability; do not merge.

Private live operator, prepared artifact reviews, fresh current budget check,
explicit release and closed-run audit are a later bounded packet, not granted
by successful tests or this implementation assignment. Within the existing
user budget authority root proceeds without asking unless a material choice
or authority expansion is required. At most two candidate interventions before
recorded advance/revise/stop. Stage3/Hermes/resource goals remain unchanged.

## Implementation record

Branch: `experiment/receipt-group-canonical-comparison`; fixed base: `274a45d62d84dc8fcb0605565bcb0ab60928c51d`.

The runtime owner is the retained actual GPT 6.1 Sol/high worker. The independent corpus owner writes only the two source/rubric JSON files; primary integrates and accepts those exact bytes. Primary owns final gates, reviews, commits, PR delivery and any separate future live release. This packet grants offline synthetic tests only.

### Prospective interfaces and caller mapping

The new store exports `prepareCanonicalReceiptGroupComparison({outputRoot})` and `createCanonicalReceiptGroupComparisonManifest(observation)`. A private WeakMap capability is consumed before the run's first await; a manifest or cloned observation grants no authority. The complete 24-slot roster is durable before loading dependencies or capturing sources. Genuine project-scoped `prepareMixedSourceCase` plans issue the ingestion client and identities; source normalization, dates, roles, complete cold scans and public receipt enumeration are independently checked.

The runner exports `runCanonicalReceiptGroupComparison({preparation,manifest,configuration,checkpoint,historySha256,apiKey,fetchImpl,signal,onRecord,onCheckpoint})`. It serializes the fixed ordinary rank and canonical group policies, then the same full-card flat answer packer. Existing generic transport opening floors are unchanged; the new upfront floor covers 2111 intents and $10.715 beyond the protected $30. All terminal paths inspect health, settle/account, close ownership and revalidate integrity before ordinary continuation.

The evaluator exports `prepareCanonicalReceiptGroupComparisonEvaluation({sourceRaw,rubricRaw,preparation,result,execution,rawArtifacts,judgeSeed})` and `scoreCanonicalReceiptGroupComparison({evaluation,firstResponses})`. Bounded literal raw artifacts are required: reported fields and file hashes alone do not establish sent answer context. No compiler is run by the evaluator. The existing source-bundle judging helper caps truth at 12 single-message sources and lacks reviewed-total-claim counts; our 13-turn cases therefore need a fixed new packet/parser in the assigned evaluator module, not a relaxed old helper or imported old scorer. Two first-response judges remain agreement-only. Proven absent answers use `not-observed-no-answer`, not fabricated clean safety; produced unknown/disagreed safety blocks advancement. Unanswered slots receive no hypothetical correctness in unresolved bounds.

### Planned verification stages

This records the tests-first checkpoint: prospective schemas and literal test oracles preceded implementation, and store capture and complete wire/token witnesses preceded dispatch. Focused fake-HTTP tests cover the full fixed population, failure continuation, fatal stop, ownership and independently observed whole-card answer packing. The worker used only the assigned serialized focused lane; primary owns broader gates. Actual worker results and failed attempts are recorded below. No paid preparation, model output or semantic judgments are authorized by this implementation packet.

The fixed paired percentile interval uses unsigned-seed Mulberry32 (20261013), 10000 replicates, 24 paired case indices sampled uniformly with replacement, and sorted nearest-rank indices 249 and 9749. This is a nonstratified, exploratory paired development-population interval, not a significance test or random-population proof. Correctness is 1 only for agreed correct; all other fixed-denominator slots are 0. Separate unresolved bounds vary only produced missing/disagreed judgments, never unanswered slots.

### Pre-output corpus and static checks

The corpus owner's initial canonical-label date strings did not meet unchanged `prepareMixedSourceCase`'s input grammar (`YYYY/MM/DD (Ddd) HH:mm`). This was caught statically before capture or model output; primary authorized a format-only calendar-preserving correction and independently reviewed the prospective source/rubric amendments. No runtime date coercion or helper change is used. The source hash is `99576fcbe40d1a228d81bdc0f135e3358269e994b724821d036de3e9f65efa25`; rubric hash is `07b7601424962fe9dff3c868f5f6c671a7fbedc3e8cba4d775d3b8c12620c143`. Primary integrated those exact frozen bytes before the first offline run; neither file changed during worker verification.

The tokenizer property is supported by unchanged adapter `countOpenAITokens`: `o200k_base.encode(text, [], [])` counts no added special tokens. The byte certificate uses exact empty full-request bytes and separately outer-escaped single-member additions, plus commas; it is additive and order-independent without assuming BPE token-count subadditivity. Independent fresh four-card enumeration checks 65 ordered subsets, with quotes, backslashes, controls, Chinese and astral characters, against actual tokenizer counts.

### Implementation and focused outcomes

The store independently correlates raw roles and normalized date wrappers with complete public `core.get` receipts, requires 216 distinct actual cards and 240 receipts, and checks two identical cold complete-map rank requests. Each selected answer unit comes from genuine CP/canonical assembly. The runner checks both actual core rank inputs and both literal count/generation bodies against preparation witnesses; actual answer HTTP bodies must equal the common whole-card packer. Model-visible candidate fields are exactly namespaceIndex, memory, receipts, receiptCount, interpretationStatus and sourceSelectionCoverage; scan/truncation evidence remains separate. Source labels, families, scripted extraction and rubric never enter model ports.

The purpose-specific module boundary retains consumption state privately, returns only frozen coordinator contexts, and brands preparation/artifact owners. Serialized data or a clone cannot reset or revive a capability. Safe native Promise adoption allows native async-context data-symbol descriptors while rejecting caller-controlled constructor/then/species and accessors before hooks; native cancellation remains genuine. Terminal checks preserve settled ownership, ledger/channel reconciliation, original caller/clock/deadline checks and all unrun slots. Actual count, selection-generation and answer ledger channels remain cairn-count, cairn-generation and host-completion respectively.

The first Node 22 attempt exited 1: 18/22 passed, four failed, none skipped. Three failures came from a synthetic envelope missing `object:'response'`, required by the unchanged ordinary adapter; they were fixture preconditions, not an adapter regression. The fourth exposed the new fetch boundary rejecting a genuine rejected Promise's native async-context symbols before observing rejection during synchronous abort. The boundary correction preserved synchronous cancellation and zero-hook rejection; its selected control then exited 0. All original failure logs are retained privately.

The full 29-test focused pair then passed on Node 22.16.0 and Node 24.15.0, actual exit 0 each, no skips. The healthy path exercised exactly 144 intents, 96 generations and 96 checkpoints over all 24 cases. Empty selection, ordinary six-distinct-card group failure/continuation, complete role/source/revision rejection, ownership/drift, zero-hook hostile data, native cancellation, real 30-second logical timeout with full unknown reservation, setup failure and owned child cleanup controls passed. Unknown/fatal execution remains a resource blocker. Child success/setup/assertion controls exited 0/1/1 and independently left empty owned parents; no unexpected survivor or scratch residue remained.

Two subsequent prospective precision controls exited 1 before corrections: a failed selection with concurrent fatal health left its own answer not-run rather than explicitly unanswered; and differing independently valid reviewed totals (2 versus 3), with all agreed zero harms, incorrectly added a safety veto. The runner now records that dependent answer before stopping on fatal health. The evaluator requires each reviewed total independently known/valid, retains both totals, and still blocks unknown/disagreed harm/rule observations. These do not change source/rubric bytes, prompts, caps or the advancement contract. All ten pure evaluator tests plus the actual combined fatal/ordinary native-core control then passed on each pinned Node, actual exit 0, 11/11, no skips. The final integrated focused population is 30 tests; primary's full final-byte 30-test and broader matrices remain pending. The earlier full 29/29 runs are pre-precision evidence, not relabeled as final-byte full acceptance.

Pre-precision worker measurements with actual fresh UUIDs and tiktoken@1.0.22 (not future live estimates):

| Maximum full witness | Node 22.16.0 | Node 24.15.0 |
| --- | ---: | ---: |
| Ordinary count / generation tokens | 2729 / 2744 | 2735 / 2750 |
| Canonical count / generation tokens | 2896 / 2911 | 2908 / 2923 |
| Canonical request tokens | 2756 | 2771 |
| Derived RG / CP request tokens | 2692 / 2240 | 2707 / 2246 |
| Universal complete-answer UTF-8 byte bound | 3386 | 3386 |

These prove offline representational/input fit for this frozen short-source cohort, not provider behavior, answer quality, model cost or official benchmark parity. The synthetic +3 scoring/known-unanswered positive and separate net-gain/anchor/harm/severe/resource veto controls demonstrate evaluator bookkeeping only; no real semantic judgment or QA improvement was measured. Both judges' original first raw strings and claim observations are retained without adjudication; agreement can still share bias and cannot authenticate caller-supplied provenance alone.

The worker is stopping after scoped documentation/inventory closure. Primary owns final source freeze, complete gates, two independent reviews and CI delivery. Any live preparation, current budget inspection, private one-shot operator, prepared-artifact review, explicit release and actual first-answer judging remain separate prerequisites. No historical cohort was reopened or rescored.

### Prospective Q1 integration amendment — source-exclusion inventory

Primary's first complete Node 22 matrix passed the new focused 30/30 suite,
actual exit 0, then stopped at old compatibility 30/31, actual exit 1. The old
canonical-feasibility N3 static exclusion test first failed because Git did not
yet inventory the untracked new source file. Primary staged only that file,
without changing its bytes: the two-route equality then passed, but the historic
hardcoded count rejected `8 !== 7`. The two minimal primary reproductions each
exited 1 (54 ms and 65 ms). The author independently retained the same selected
RED, actual exit 1, 0/1, no skips, before editing.

Primary prospectively extended the Q1 scope to an eleventh path:
`evaluation/algorithm-development/test/receipt-group-canonical-feasibility.test.mjs`.
Only its static inventory invariant changes: the original seven corpus paths
must each remain present, while Git-versus-filesystem equality and normalized
source/query exclusion continue over **every** discovered corpus, currently
eight. This neither pins a new total of eight nor filters out the new corpus.
No old fixture, runner, compiler, scorer, transport, output or threshold changed;
the existing regression seam tests file discovery and freshness, not historical
cohort execution. The original Q1–Q8 contract prefix and all prior records remain
unchanged above this prospective amendment.

The selected N3 control passed 1/1 with no skips and actual exit 0 on Node
22.16.0 and 24.15.0, serialized through the owned runner with sanitized env.
Both diagnostics listed all eight corpora with their exact source hashes,
including the new source pin `99576fcbe40d1a228d81bdc0f135e3358269e994b724821d036de3e9f65efa25`.
Owned caller roots were empty and removed; command exits and closes had null
signals, verified cleanup and no survivors. No capture, tokenizer execution,
provider call or old answer/output access occurred. Primary owns the renewed
complete two-Node matrices and independent reviews of the final eleven-path
candidate; this narrow static GREEN does not replace those gates.

### Prospective Q1 integration amendment — current-index JSON inventory

Primary's next full Node 22 attempt stopped at algorithm-development 459/460,
actual exit 1 with cleanup verified and no survivors, after 1409.6 seconds.
Its sole failure was another old static inventory assumption: moc-prior-corpus
compared current indexed JSON membership against HEAD alone. The two new
comparison JSON files were already staged for required pre-commit verification;
the index contained 57 selected files but HEAD contained 55. Primary retained a
selected 0/1 RED (actual exit 1, 1.366 seconds) and independently checked all
57 files/8128 strings/152 historical user messages with zero duplicate question
or user source. Neither staging a commit to hide the mismatch nor excluding the
two new files is an acceptable verification step.

The second narrowly approved Q1 exception adds a twelfth scoped path:
`evaluation/algorithm-development/test/moc-prior-corpus.test.mjs`. Its local
test helper independently reconstructs current indexed membership from the
NUL-delimited HEAD tree plus NUL-delimited staged name-status changes, explicitly
disabling rename detection. Additions are present, deletions absent, and edits
or type changes must already exist in HEAD. Unexpected/malformed status records,
duplicate index paths and unmerged evaluation entries fail conservatively.
This reconstructed set must equal git ls-files exactly; the same original
filter and duplicate-question/source checks scan every selected current JSON.
No old fixture, question, rubric, runtime, scorer, output or threshold changes.

Before the fix, a new real owned temporary-Git regression failed actual exit 1,
0/1, no skips, at the same membership comparison after staged add/delete and
rename-equivalent changes. Its initial fixture commit and index operations are
confined to owned synthetic scratch, never the user's index. After the fix,
the selected regression passed 1/1 on each pinned Node, actual exits 0. It
exercises staged edit, untracked/non-evaluation exclusion, tab/newline paths,
explicit unmerged-stage rejection and unchanged historical fixture/source/rubric
hashes. Full affected corpus tests passed 9/9 on Node 22.16.0 and 24.15.0,
actual exits 0, no skips; no additional nested test registrations were added.
Both full logs confirm 57 JSON files and 8128 strings, zero duplicate questions
or user source messages, with all 152 original user-source checks unchanged.
Owned Git fixture/caller roots and nested successful/failing child scratch were
removed, null command signals and verified cleanup with no survivors. Existing
test imports may emit the SQLite module warning; no capture/database/ledger or
provider operation was added. Private sentinel binding remains separately held.

The original contract prefix and all prior notes are preserved. Primary owns
the final twelve-path scope audit, renewed full matrices and independent
acceptance; these fast inventory controls complement, not replace, those gates.

## Q6 terminal-expiry correction and thirteenth-path scheduling amendment

The original offline coordinator could reach the final RQ24 answer checkpoint,
settle all 144 intents, record `absoluteDeadlineActive:false`, and nevertheless
return completed execution with accounting acceptance. A fresh isolated-child
probe reproduced this on the original runner: actual test exit 1, 0/2 passed,
no skips or cancellations. The case-only variant also showed outer cleanup
reviving the returned deadline flag after clearing the case deadline. A new
tracked real-path regression independently retained the same RED before the
production change, actual exit 1, 0/2, with all setup and settlement preconditions
passing. These are fresh synthetic controls, not historical-cohort replay.

The scoped correction samples captured monotonic elapsed time independently of
cancellation after reconciliation/callback/close, after terminal integrity, and
after phase artifact persistence. Expiry marks the existing sticky first-fatal
state. Explicit phase finalization prevents outer cleanup from reviving a false
verdict or retroactively expiring a previously ended timely phase. Final ledger
and report-write boundaries also receive elapsed checks. Detected post-write
expiry or persistence failure returns conservative failure with accounting
acceptance false; the original write-once literal is retained, not repaired.
An inconsistent persisted/returned report must fail the closed artifact audit.
No timer delivery, new clock seam, model call, deadline increase, budget increase,
schema or scoring change is needed for this veto.

Six new child controls cover final case/run expiry, late integrity reads, phase
artifact fsync, final-report fsync, and a prior persistence fatal combined with
expiry. Each owns genuine fresh full24 preparation; the final-checkpoint cases
reach checkpoint 96 with 144 settled calls and 96 generations, while early
boundary cases stop after checkpoint 1 and two settled calls. Stable controlled
clock descriptors are installed before product imports, and filesystem/global
descriptors and owned workspaces are restored even on assertion failure. Literal
snapshot-versus-later-verdict distinctions are asserted rather than rewritten.
The prior fatal remains authoritative, no further dispatch occurs, and all
earlier ended phase deadline flags stay unchanged.

Worker verification on Node 22.16.0 passed the new six controls (6/6) and eight
complementary controls (8/8), actual exits 0. Node 24.15.0 passed the same affected
fourteen controls together (14/14), actual exit 0. The complementary coverage
includes healthy full24 and empty selection, ordinary failure continuation,
after-error store drift, in-flight cancellation, internal canonical mutation,
real logical timeout/unknown settlement, and persistence failure. No skips or
cancellations occurred, and owned cleanup was verified with no survivors. A
fresh candidate-bound copy of the original private probe then passed 2/2 on
Node 22, actual exit 0; only its comment and expected runner hash differed from
the retained original RED probe. This is affected-subset verification, not a
worker claim that the entire now-36-test focused pair or full matrix passed.

Primary separately approved `package.json` as Q1's narrow thirteenth public
path. Only `test:algorithm-development` changes: `--test-concurrency=2` is placed
before the test-file glob, preserving every discovered file and existing test
and product deadlines. This is preventive test-file scheduling, not proof of
the cause or resolution of the retained Node 24 full-matrix failure (461 tests:
458 passed, two failed, one cancelled). Subsequent unchanged-source selected
serial and default runs each passed 11/11; those selected passes do not explain
or replace the failed full matrix. The Q4 assertion now includes nonsecret
failure diagnostics for future attribution without changing behavior.

Actual implementation owner remains GPT 6.1 Sol/high. This correction edits
only coordinator, existing runtime test, append-only plan/limitations and the
one package script. Source/rubric bytes, original contract prefix, old fixtures,
all other runtime/operator bytes, model/transport/accounting caps and the fixed
denominator remain unchanged. Primary owns final thirteen-path audit, full
two-Node matrices, fixed-candidate independent reviews and any future delivery
or live authority. No QA24 result or improvement is delivered by these controls.
