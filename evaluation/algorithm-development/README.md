# Synthetic algorithm comparison

The prospective [relation-bound first-answer probe](../../docs/plans/relation-binding-probe.md)
is a separate answer-only diagnostic: 12 new submitted-source cases, 24 first
answers, six supported and six uncertain requested relations. It changes only
the system instruction, using the named `packRelationBoundAnswer` builder and
`createRelationBindingTransport`; ordinary request bytes/defaults stay unchanged.
There is no capture, core/MOC change, rubric/gold in answering requests, or model
quality claim from fake HTTP tests. Sources remain untrusted quoted data.

`prepareRelationBindingProbe({ configuration, outputDirectory })` is read-only
and binds the clean committed runtime, source/rubric/protocol hashes, exact Node,
owned empty output identity, original cumulative checkpoint and all 24 final
requests. `executeRelationBindingProbe` requires that exact manifest, distinct
approved Standards/Spec review receipts, explicit `keyProvider`/`fetchImpl`, and
durably starts once before credential lookup. It rechecks sources/checkpoint after
the asynchronous callback, dispatches each slot once and retains failures/unrun
slots without resume/retry. Actual maximum is 24 HTTP requests and $0.12 reserved,
with a $1 local ceiling; the original $400/$30 campaign and stricter existing
$10/1,968-request affordability requirement remain. No CLI or key discovery exists.

Post-run `buildBlindRelationBindingPacket`, `unblindRelationBindingJudgments`
and `aggregateRelationBindingJudgments` are evaluator-only. Judgment fields are
`verdict` (correct/incorrect/unresolved), `unsupported`/`stale`
(clean/positive/unknown), and boolean-or-null `severeError`, `bindingError`,
`abstained`. Binding errors must concern the requested relation and be judged
independently; generic incorrectness or optional unsupported background is
insufficient. Reviewer identity is caller-attested. Preserve first submissions;
missing/disagreeing judgments remain unknown. At least two distinct baseline
binding-error cases, positive paired QA, preserved known-answer usefulness,
known safety and accepted resources are necessary for a diagnostic signal.
Even a positive signal sets `advances: false` and requires fresh full-pipeline
validation. A baseline ceiling or no gain is inconclusive/stop, not a fix.
`loadRelationBindingRubric()` returns `{ bytes, sha256, rubric }`; both blind
packing and aggregation require this freeze envelope and verify its exact byte
hash against the report's recorded rubric identity before use. Unblinding accepts
only `label` plus the six judgment fields and cannot accept caller `cellId`
overrides. Scripted verdict controls test aggregation; detecting actual semantic
binding errors remains the independent reviewers' task.

Run the focused offline files with the owned runner:
`node tools/testing/run.mjs evaluation/algorithm-development/test/relation-binding.test.mjs evaluation/longmemeval/test/relation-binding-answer.test.mjs`.
The test-only `CAIRN_RELATION_CONTROL_DISABLED=1` substitutes the ordinary builder
at the treatment seam; the `red-capable` test must exit 1. It never changes a
production builder or measures model behavior.

`runAlgorithmDevelopmentComparison({ cases, transport, outputDirectory, onCase })`
accepts the separately validated, deeply frozen 24 source-only cases. Each case
has `{ id, family, question: { text, date }, sessions: [{ id, eventTime,
messages: [{ role, content }] }] }`. The module never imports a rubric or grades
answers. Only an arm with a validated answer has `status: 'completed'`; all
failures and unrun arms remain `unresolved` over 24 cases per arm.

The runner uses existing dated-source preparation, real indexed-evidence
capture with normal classification, cold reopening of the same database, the
existing full-label wrapper, source-evidence recall and verified source-only
answer packing. It uses default selection, bounded-keyset candidate policy and
a six-unit limit in both arms. `bounded-source-scan` is deliberately omitted:
its complete-map shortcut skips selection on small stores. Full labels are the
only intervention; differences in later navigation/ranking inputs are recorded.
ISO event times are rendered consistently as UTC floating-minute source labels.
Receipt `createdAt` remains the normal ingestion stamp, not the event time.

`createAlgorithmDevelopmentTransport({ configuration, checkpoint,
historySha256, apiKey, fetchImpl, onRecord })` opens only an existing schema-2
shared ledger at the exact checkpoint/history. It exposes the pinned adapter's
`model` with extract/classify/select/rank methods and an `answer({question,
units})` method using the exact existing packer. `beginCase({id, ordinal})`
starts capture; `beginArm('baseline'|'full')` begins each one-shot recall/answer
arm, then `endCase()` closes that case. `records()`, `state()`,
`assertHealthy()` and `close()` provide bounded lifecycle inspection. There is
no general HTTP port, environment-key discovery, retry or ledger creation.

The limits are exported as `algorithmLimits`: 40 core calls plus two answers
per case, 1,968 HTTP attempts, 5,000 microUSD reserved per attempt, US$10 local
cap, and US$30 protected under the existing cumulative ceiling. Known valid
usage is priced with the adapter profile even on an overrun; unknown usage
retains its reservation. Authentication, usage, accounting and durable-record
anomalies halt the transport. Other case failures remain in the result.
The 200-second physical transport bound does not extend the unchanged core's
30-second logical call timeout. Case/run upper bounds are 20 minutes/8 hours.

Both callbacks must synchronously durably write their immutable observation
and return `undefined`. HTTP records are emitted before dispatch and after
settlement, keyed by attempt ID. `onCase` emits each completed observation,
including failures and fatal-stop placeholders. The caller owns formal output,
fresh output directory, one-shot marker and manifest freezing; the runner
retains every created database and performs no cleanup. Tests alone use the
existing owned workspace lifecycle.

Run the offline suite with `npm run test:algorithm-development` after
`npm ci --prefix adapters/openai`, on Node 22.16 and 24.15. Neither command
uses a provider credential (the install contacts the package registry).

`launch.mjs` is the primary integration envelope: read-only preparation requires
a clean committed checkout, exact corpus hashes, supported campaign budget and
settled current checkpoint. A separately reviewed manifest must match before
the exclusive start marker and explicit key-provider callback. Reusing an output
directory is rejected, including after key lookup fails. It writes private
pre/post request records, each case, the report and closure record with fsync.
No command auto-discovers a credential or resumes a closed operation.

Post-run scoring is evaluator-only. `scoreDevelopmentCoverage` consumes the
observations and separately frozen rubric, verifies source identity through the
existing provenance verifier, and counts all 42 positive anchors at each stage.
Absent, unknown and not-run anchors remain in the denominator. Literal coverage
is not semantic support. `buildBlindDevelopmentPacket` sends only opaque labels,
questions, original source truth, rubric, actual packed evidence and answers to
two nonauthor reviewers; retain its mapping separately. Unblind their independent
JSON results with `unblindDevelopmentJudgments`, then use
`aggregateDevelopmentJudgments`. Missing/disagreed verdicts remain unresolved;
safety disagreement blocks advancement. No automated grader calls are included.

## Prospective requested-answer comparison

The closed optional runner `treatment: 'source-diverse-v1'` selects the existing
bounded source-diverse wrapper; omission remains `full-label-v1` with the original
report shape. The new report is `source-diverse-requested-answer-comparison-v1`
and explicitly maps transport arm `full` to `source-diverse-v1`, not full labels.
It retains unchanged raw model calls and adds each arm's `effectiveSelections`:
actual core request/returned refs, failure, bounded public-get observations and
pure assembly diagnostics. Diagnostics use observed reads only, never extra reads.
These private artifacts contain source material and have the same caller-owned
retention/privacy obligations as the existing report. Source novelty is not QA.

`loadRequestedAnswerFreeze()` loads separately versioned `qa-rubric-v2.json` and
compiles requested propositions onto the unchanged original 42 anchors,
multi-source requirements and safety definitions. Optional background and three
prospective calibration examples per question stay outside correctness criteria;
they are not historical model answers, an exact matcher or a semantic parser.
The judging protocol requires concise/explained correctness invariance while
checking all factual claims actually made against actual packed evidence.

`prepareRequestedAnswerComparison` / `launchRequestedAnswerComparison` reuse
`launch.mjs`'s original read-only checkpoint and one-shot durable envelope with
a distinct manifest version. It binds policy, rubric/examples/protocol, runtime,
Node/model, control/runtime hashes and unchanged transport limits. Old manifests
cannot launch the new path; failed key lookup still consumes the start marker.
Neither path discovers a key or resumes. Reviewed clean code, current settled
affordability and a separately frozen manifest remain necessary; tests do not
authorize spending.

Evaluator-only `scoreRequestedAnswerCoverage({ report, modelInputs,
evaluatorRubric })` requires actual effective traces and never substitutes raw
refs. `buildBlindRequestedAnswerPacket({ report, freeze })` creates two-judge
input, and `aggregateRequestedAnswerJudgments` reuses agreement-only counts with
the new paired/packed/safety gate and explicit caller resource acceptance. The
caller must audit recorded calls/tokens/latency/reserved and known cost before
setting `resourcesWithinLimits`; this flag is not a new budget authority or an
automatic resource measurement. All 24/48 slots remain in denominators. The
same authored sources are previously seen development, not a fresh holdout;
this delivery contains no new paid answers, score or product promotion.

## Combined evidence comparison

`runEvidenceBundleComparison(options)` explicitly selects
`treatment: 'source-diverse-linked-v1'`. The ordinary baseline and treatment
both use the reviewed recorded-role JSON evidence projection and unchanged
answer packer/instruction. The treatment composes the existing source-diverse
selector with the existing source-linked rank wrapper. The six-memory limit,
model, capture, transport and token/resource limits stay fixed. This measures a
combined algorithm candidate against a new common-representation baseline; it
cannot isolate ranking effects or reuse the previous experiment's QA scores.

The report identity is `source-diverse-linked-requested-answer-comparison-v1`.
It keeps raw select/rank calls and existing effective-selection semantics, adds
`effectiveRanks` for both arms and records compiler diagnostics plus added and
displaced refs. Pure reconstruction uses the original visible request and raw
reply, with no extra provider or public-get calls. A wrapper failure before
delegation records an effective failure with no fabricated raw call. Empty
capture still permits an empty-map selector call and empty evidence; no rank
call is invented.

`prepareEvidenceBundleComparison` / `launchEvidenceBundleComparison` add a
separate launch identity, binding both reviewed wrappers, the role projection,
packer, controls, source/rubric/protocol hashes, runtime/Node and unchanged
campaign limits. `loadEvidenceBundleFreeze()` preserves the original requested
v2 hashes in `originalHashes`; its protocol changes only the identity version.
The new freeze hash binds those original hashes explicitly and omits the old
freeze field from its new hash fields. It changes no calibration or verdict
criterion. The normal clean-checkout, settled checkpoint, protected budget,
separately reviewed manifest and exclusive one-shot marker remain required.
Offline completion grants no spending permission.

Evaluator-only `scoreEvidenceBundleCoverage` requires actual effective
selection/rank traces, reconstructs successful compiler outputs, validates
authoritative role evidence and the entire actual packed request. Missing or
forged traces reject; unverified packed evidence receives no presence credit.
`buildBlindEvidenceBundlePacket` and `aggregateEvidenceBundleJudgments` retain
the same two independent judges, calibration, 24/48 denominators and unchanged
paired QA/packed-coverage/safety/resource gate under distinct identities.
Cross-profile reports, manifests, coverage and freezes are rejected.

Run the two new `test/evidence-bundle*.test.mjs` files through the owned test
runner on both supported Node versions. The deliberate
`node tools/testing/run.mjs --script evaluation/algorithm-development/test/evidence-bundle-runner.test.mjs --ordinary-negative`
control exits 1 because ordinary ranking omits the chain and removes only its
owned synthetic scratch. The crowded-source control retains the existing
four-addition selection limit: later rank assembly cannot recover a source
that selection never supplied. None of these scripted controls is a QA result.

## Complementary source comparison

`runComplementarySourceComparison` captures the same 24 development cases once,
then runs ordinary, source-diverse-linked and source-diverse plus the frozen
complementary compiler on the same cold database. Three arms share verified
recorded-role evidence, unchanged answer packing/model and balanced ordering.
Actual raw calls and effective compiler traces remain separately recorded.

`prepareComplementarySourceComparison` / `launchComplementarySourceComparison`
bind a separate closed manifest: capture<=16 logical calls, each arm<=8,
40 total, three answers, 1992 HTTP maximum, 5000 microUSD/request, US$10 local and
US$30 protected under the existing US$400 ceiling. Node and complete artifacts
including unchanged candidate are bound. Old 1968 two-arm profiles stay separate.
One-shot marker precedes explicit key lookup; failed lookup retains all 24 slots.

`loadComplementarySourceFreeze`, `scoreComplementarySourceCoverage`,
`buildBlindComplementarySourcePacket` and
`aggregateComplementarySourceJudgments` preserve requested-v2 and 42 anchors
under new identities. Two independent nonauthor judges review at most 72 opaque
answers. C-A requires +3 net correct and positive packed anchor gain; C-B has
no QA/packed regression. Unknown safety/resources, increased candidate harm
question counts or newly severe cases against either control block
advancement. Incremental superiority additionally needs positive samebatch C-B.
Historical 18/24–22/24 and offline 36 controls establish no new QA score.

See [the frozen contract](../../docs/plans/complementary-qa24.md). Run the new
`test/complementary*.test.mjs` and entire existing algorithm suite offline on
both pinned Node 22.16/24.15 runtimes. Passing grants no spending permission.

## Closed six-case coupled larger-pool experiment

`loadLargePoolInputs` is source-only and validates the distinct L01–L06 roster,
six short user/assistant/user sessions per case and 4,000 source characters.
`loadLargePoolFreeze` separately validates evaluator gold and exactly six normal
indexed capture batches. The old D01–D24 loaders and profiles remain closed.

`runLargePoolComparison` captures each source once, then cold-reopens the same
database for linked and complementary ranking. First-arm order alternates three
times each. Only that arm makes natural select/rank calls; the second consumes
immutable raw replies in strict request order, with no model fallback. Both
real core arms retain their own source-diverse selection, compiler, authoritative
source reads, recorded-role verifier and unchanged packer, and each generates
one independent answer. Traces distinguish natural-model and replay calls.
Costs describe paired execution, not standalone treatment cost or latency.

The explicit `prepareLargePoolComparison` / `launchLargePoolComparison` reuse
the guarded transport, original cumulative ledger and one-shot closure.
Preparation requires `{ configuration, outputDirectory }`, with a fresh owned
real directory at mode `0700`; the manifest binds its path and filesystem identity
and launch rechecks that exact directory before and after explicit key lookup.
Limits
are 12 capture plus eight natural recall logical calls, zero paid replay recall,
two answers per case and 252 HTTP attempts ($1.26 maximum reservation), within
the $2 local ceiling and $30 protection. Preparation grants no spending.

`scoreLargePoolCoverage` independently reconstructs raw/effective compilers,
source origin and actual packing. Eligibility requires an actual >6 rank pool,
one to five original refs at limit six and the lexical branch; additions may
be zero. Coverage computes which newly packed anchors came from actual lexical
additions. Blind judging and aggregation retain all six/twelve slots and report
every loss. Further-development support requires four eligible cases, positive
QA and lexical packed gains, resolved safety/correctness and valid pairing and
resources. It never authorizes product promotion or Stage 3 or repairs old D12.

Run `test/large-pool*.test.mjs` and the existing algorithm suite on both pinned
Node runtimes. The real-core scripted controls prove orchestration, not model
quality. See [the prospective contract](../../docs/plans/large-pool-six.md).
