# Receipt-ID grouping: small fresh model-interface feasibility

Primary implementation contract accepted 2026-10-13. Offline implementation is
released, not paid execution. Fixed base 93c2ba55276c56886bac842dac6d968a35ee8c01,
independent Spec/Standards v3 PASS; upstream draft PR #414 awaits its own CI.
Isolated branch experiment/receipt-group-feasibility. Original cumulative US$400,
protected US$30, existing ledger identity/history and closed CQ/BQ/official
cohorts remain fixed.

Primary static fixture acceptance: private cases proposal SHA256
94bc7434f6aa4b0320edda6177283976d6a7ac3a0c6d7eae22fecec0c42129ba,
readiness SHA256 92ba2c64f352364cb8bc1e7a2fec1b3f49b2aa3413db5182b55e31230d73240d.
The original proposal files remain immutable, still labelled proposal rather than
runtime preparation. Independent static inspection exit 0 confirms 24 planned
cards / 31 source literals and hashes, maximum 437 wrapped characters, exact source wrapper
and capture limits. This is not actual capture/dedup/token-fit verification.
Case 02 shuffles literal/session order, not the future actual rank-card ordering;
preserve and record the genuine bounded scan order. Source anchors are diagnostic
targets, not gold answer requirements; some proposal/context anchors may be
unnecessary to a correct answer.

Purpose: determine whether the changed receipt-only representation can produce
usable first-response selections, before paying for a larger answer comparison.
This is NOT a new first-answer score, competitor result, natural MOC benchmark or
installed-harness acceptance. Extraction is scripted; ranking alone uses a model.

Checked-in source fixture SHA256:
176fba365369bc36e85b371aa209ae1ed32e864b3e14b0bb7fbecbf3b70d5a8d.

Scope: new evaluation/algorithm-development/receipt-group-feasibility.mjs,
new evaluation/algorithm-development/receipt-group-feasibility-cases.json,
new evaluation/algorithm-development/test/receipt-group-feasibility.test.mjs,
new docs/plans/receipt-group-feasibility.md, append-only docs/limitations.md and
one suite name in the existing required offline .github/workflows/ci.yml step.
No old runner/cohort/scorer,
core/adapter/default/model/prompt/schema/transport/ledger implementation changes.

F1. Six new synthetic source histories and queries, authored before model output.
No old fixture, cohort JSON, transcript, model answer, judge or official holdout.
Fixed order and opaque actual captured receipt IDs; no short-ID substitution.
Exercises: single-card evidence; shuffled six-card distractors; same-card mixed
user/assistant receipts with tentative versus confirmed content; shared context
needed for two independent requested facts; one card with six source receipts;
and a source-rich twelve-card case within the unchanged complete-wire budget.
Capture at most four sources per extraction item using normal dedup if needed;
do not raise core caps. Each source <=800 chars. No post-output fixture tuning.
For the six-source case independently require exactly one captured card, six
distinct real receipt IDs and all six complete new source literals retained.
Record literal source anchors expected to be available for each query, but do
not expose that diagnostic metadata or any gold answer in the model request.

F2. Prepare all six through fresh owned SQLite, normal source-mapped scripted
capture, close/reopen and actual bounded-source-scan rank envelopes. No direct
SQL memory insertion. Preserve complete original roles/excerpts/order and actual
IDs. Use prepareReceiptGroupPlan with real countOpenAITokens and the fixed new
wire. First persist the complete six-ID/source-hash planned roster, before the
first case preparation, so a preparation failure retains failed/not-prepared
dispositions for the whole denominator. Freeze manifest/requests/source/store hashes and token witnesses before
any model call. The manifest is an observation, not a capability. A process-local
preparation capability is consumed once; clones, repeats and concurrent calls
fail. Verify all three complete actual/pre-count/generation serializations fit
6000 tokens and the selected fixed source-rich case genuinely exercises more
input pressure than the other five, measured by complete generation-body tokens.
Fixed card/source character counts alone do not guarantee this token condition.
No adaptive clipping, omission or retuning. If a frozen preparation does not fit,
stop and retain it; any redesign is separately frozen before model output.
Preparation failures record the boundary and prevent paid execution; all six
planned items remain visible in the retained result, never swapped out.

F3. Run one new createReceiptGroupPlanRankTransport per predeclared case, using
the existing createSourceBundleGuard, existing bound budget and exact current
checkpoint/history. Fixed gpt-4.1-mini-2025-04-14, input 6000 / provider 7024,
output 1024, count + generation only. At most six generations / twelve physical
intents / 60000 micro-USD conservative reservation, absolute run <=20 minutes and
case <=200 seconds, existing internal 30-second logical deadline unchanged. No answer/judge,
extra probe/search, repair, retry, fallback, batch resume or new ledger. Verify
whole-run affordability and protected balance before the first reservation.
No import-time network, key or operational path; all explicit operator inputs.

F4. Persist exclusive private artifacts before/after requests using known owned
root identity. Keep the transport-permitted literal first response, hashes,
usage and disposition; keep actual RG request/proposal versus derived CP/refs
separate. Retain original
redaction/credential-echo safety: never recover a withheld raw body or hash;
record the absence reason instead. Preserve the original ledger prefix and
reconcile each new intent/settlement once; unknown remains
fully reserved. Stop on auth/redirect/credential/persistence/wire/provenance/
accounting/budget/global-cancellation anomalies. Ordinary settled model failure
or independently verified per-call timeout stays failed and may continue to the
next originally frozen case, never rerun the failed item. Timeout continuation
requires the pending port to settle, unchanged active global/absolute deadlines,
caller not cancelled, reconciled terminal ledger, transport consumed with no
fatalCode and no persistence/integrity failure, not merely a matching error name.
Inspect transport health on EVERY terminal outcome, including ordinary provider
errors: a retained ordinary public/record error can coexist with fatal integrity
health. Any non-null fatalCode stops the cohort regardless of that public code.
Do not relabel an unknown dispatch as no request. Preserve artifacts on run failure; test-owned
workspaces must clean on success, setup and assertion failure.

F5. Report fixed denominator 6 and each case separately: preparation/dispatch/
generation/compile outcome, groups/cards/receipts selected, actual-proposal and
derived/ref token lengths, and whether the intended structural exercise was
actually elicited. Empty groups are structurally valid but not evidence that
nonempty/shared/dense selection worked. Report exact-source-anchor coverage as
a diagnostic, not truth, relation correctness, final-answer quality or a score.
No post-hoc repair, output dedup or dropping unresolved cases.

Prospective decision: consider a fresh matched answer comparison only if at
least 5/6 first responses genuinely compile and select nonempty cards, all six
have unambiguous retained terminal accounting (no pending reservation; an explicit
unknown outcome is retained and fully reserved, not known usage or zero cost),
and there is no systemic provider/schema failure. Separately report missed
structural exercises and source anchors even if this threshold passes. Coverage
must distinguish raw selected endpoint IDs from all receipts available on the
selected whole cards; one selected endpoint may carry its entire card later.
Selected endpoint coverage uses only proposal-mentioned IDs; chosen-card
availability uses the authoritative unchanged full receipt inventory. Both
compare separately with the fixed source anchors kept outside the wire.
Label the latter chosen-card source availability, not delivered answer context,
because this experiment does not call the answer model. This small gate is an
engineering feasibility signal, not a reliability guarantee.
If it fails, diagnose the recorded first failures and choose a new hypothesis;
never retry or repair this frozen run to pass.

F6. Tests first, complete fake-HTTP roundtrip through all six genuine prepared
stores and real tokenizer, independently literal expected wire/proposal and
source-ID mapping oracles. Controls for empty versus nonempty outputs, one
ordinary failure followed by remaining frozen cases, fatal stop with retained
not-run denominator, immutable source/request/store drift, reuse/clone/cancel,
reservation/persistence failure, unknown usage and protected affordability.
These injected failure controls are not live structural exercises and never
enter the six-case model denominator. Independently map fresh raw source literals
to captured IDs for test oracles, rather than copying compiler output as truth.
No external network in tests. Workers do not run broad/native gates without
primary release; one native sequence at a time. Require absent dependencies to
fail required CI, not silently skip. Failed observations remain retained.

F7. Worker owns only agreed files, no commit/push/paid execution. Primary checks
actual diff/test adequacy and reruns focused+relevant old regression, the required
npm run test:algorithm-development, npm test, validate and both CLI validators
on pinned Node 22.16 / 24.15 serial. Independently derive file inventory two ways.
Freeze commit, separate nonauthor Standards and
Spec against fixed base/head, latest-head CI and mergeability before readiness.
No merge/release/deploy. Root separately reviews prepared live artifacts, actual
source/dependency hashes, current shared budget and bounded operator before any
real request; offline success alone is not model execution authorization.

## Tests-first implementation boundary

The public API is deliberately limited to three exports:

```js
await prepareReceiptGroupFeasibility({ outputRoot });
createReceiptGroupFeasibilityManifest(preparation.observation);
await runReceiptGroupFeasibility({ preparation, manifest, configuration,
  checkpoint, historySha256, apiKey, fetchImpl, signal, onRecord, onCheckpoint });
```

There is no CLI, cohort argument, model override, prompt override, case filter,
resume option, answer port, test counter or time override. Preparation accepts a
fresh absolute owned output root. It writes `planned-roster.json` synchronously,
then loads the native/tokenizer dependencies and prepares the complete fixed
roster. Its frozen process-local capability exposes an immutable observation;
the manifest is a consistency binding only. A cloned capability has no authority.
A valid capability is consumed before an invocation's first asynchronous work,
including failed runs and concurrent calls. Invalid-capability calls reject;
owned preparation/runtime failures retain denominator-wide artifacts.

The existing `prepareMixedSourceCase` convenience function requires project
scope and `projectId === history.question_id`; it cannot honor these accepted
personal namespaces. Preparation therefore uses direct public `core.capture`
with `captureSourcePolicy: 'indexed-evidence-v1'`, fresh client/session/event and
message identities, and scripted extraction partitions. Case 05 makes two
same-content extraction items with four and two source indices. Normal admission
dedup, not SQL insertion, must yield exactly one card with six actual receipts.

All source literals have the frozen session date `2026/10/09 (Fri) 14:00`.
The exact stored source wrapper is:

```text
[session-date: 2026-10-09 14:00; clock: dataset-local] source{<literal> }
```

Original user/assistant roles are preserved. The query is the exact JSON
serialization of `{ question: originalText, date: '2026-10-13 18:00' }`.
These representations are checked independently from raw fixture literals in
public `core.map` / `core.get` rereads. Dataset-local source/card/session labels
never become runtime memory or receipt IDs. Case 02 retains its accepted literal
capture order; the genuine bounded scan order is observed, not manually sorted.

Observation rows expose the owned store path, frozen actual RG request, source
and preparation artifact bindings, and complete actual-request/count/generation
token witnesses. Each witness binds exact serialization SHA256 and real tokens.
The manifest fixes version `receipt-group-first-response-feasibility-v1`, ordered
six-case roster, source/dependency/preparation hashes and unchanged limits.
The runner uses slot IDs `<case-id>-receipt-group`, one existing RG transport
per case, and the existing source-bundle guard; no old runner is invoked.

The terminal report retains all six cases, original ledger prefix, resources and
per-case transport health even on ordinary model failure. Completed rows keep
literal permitted response provenance, actual request/proposal hashes, derived
CP request/proposal hashes and refs separately. Selected endpoint coverage and
authoritative chosen-card source availability are distinct; the latter explicitly
has `deliveredAnswerContext: false`. The structural gate counts only genuinely
compiled nonempty first responses, independently of diagnostic source anchors.

### Prospective test mapping

Fourteen normal top-level tests are written before runtime implementation. A conditional
child test exists solely for deliberate setup/assertion failure cleanup proofs.
Required SQLite/tokenizer dependencies fail rather than silently skip.

| Requirement | Independent prospective oracle/control |
| --- | --- |
| F1 | Exact accepted fixture file hash, 31 raw source hashes, fixed six shapes, roles, personal namespaces and extraction partitions; no answer/judge fields |
| F1–F3 | Actual public cold map/get correlation by raw role + literal date wrapper; 24 cards / 31 distinct real receipt IDs; case 05 independently 1 card / 6 receipts |
| F2–F3 | Literal closed RG schema and complete count/generation bodies using actual oracle IDs; genuine tokenizer hashes/counts and strictly greatest case 06 generation pressure |
| F4–F5 | Exact fixed fake HTTP schedule, one pre/post per reserved intent, immutable original ledger prefix, whitespace-bearing response versus actual proposal versus derived CP/refs |
| F5 | Empty outputs compile but fail nonempty feasibility; shared-context and dense single-card test plumbing; selected endpoints versus whole-card source availability, not delivered answer context |
| F4 | One ordinary incomplete generation continues once; fatal usage/auth/credential, caller descriptor mutation and genuine cancellation stop remaining fixed cases; actual internal native-port mutation plus ordinary failure preserves public error but fatal health stops all five remaining cases |
| F2 | Clone, reuse and concurrent one-use rejection; frozen public requests/manifests; request/source artifact and real public-core store drift before any reservation |
| F3–F4 | Whole-run protected money and intent headroom before reservation; record/checkpoint throw or asynchronous return; unknown dispatch retains full reservation and null actual usage |
| F4 | Genuine native local timeout requires settled port, unchanged caller/global deadline, ledger reconciliation, consumed nonfatal health and persistence integrity before next-case dispatch |
| F2/F6 | Synchronously retained six-case/source-hash roster before setup failure; owned setup/assertion child failures and success cleanup |

The fake proposals are deterministic test plumbing, not expected model answers.
No historical model output is replayed. No missing-module/import error will be
reported as behavioral RED. The first native observation requires the implemented
real seam and primary coordination; any preparation/capture/budget failure is
retained, not repaired through changes to the frozen source fixtures.

Pre-native static fixture corrections: transport records identify count/generation
with `kind`, not a native `channel` field. The actual invocation freezes the RG
request shell and its input; trying to assign a new `system` there would throw
before the intended provider response. The consumer control therefore asserts
that freeze and mutates only the genuine native signal's own
`removeEventListener` accessor. It observes the core model-call port signal,
not a caller/guard composite, retains ordinary public failure plus fatal health,
requires zero hostile hooks and restores its native descriptors in `finally`.
Existing standalone wire controls cover mutable request-data drift. This static
correction is not a product RED or permission to weaken the invocation freeze.

## Initial focused observation (retained)

Pinned Node 22.16.0 attempt 1 exited 1: 6/14 passed, 8 failed, no skips,
duration 94.661 seconds. The independent proposal helper eagerly constructed
every case's branch and looked up endpoints absent from cases 01–05 before
returning their fake generation responses. Only case 06 had all those endpoint
numbers. This is a test-oracle construction/precondition failure, not a valid
model response rejected by the runner and not evidence about model reasoning.
The original log is retained privately. Correction makes branch evaluation
lazy without changing any case, source literal, query, extraction partition,
diagnostic anchor, provider limit or runtime behavior.

One prospective persistence count assertion also needed its actual boundary:
a checkpoint callback runs after a complete count + generation (two fake calls),
whereas pre-record failure sends none and post-count failure sends at most one.
The correction distinguishes that checkpoint boundary; it does not weaken fatal
persistence handling or terminal accounting. The native timeout control actually
ran for 33.960 seconds in the failed attempt; its later cases were affected by
the same eager helper bug. All owned scratch is checked separately from pass
counts. No production correction was made for these fixture-only failures.

Pinned Node 22.16.0 attempt 2 exited 1: 13/14 passed, one failed, no skips,
duration 101.743 seconds. All six real-capture literal-wire controls, empty and
ordinary continuation, fatal caller/safety controls, drift, one-use, protected
budget, persistence, unknown accounting, native timeout and child cleanup passed.
The remaining observer matched the core model-call file anywhere in a stack,
so nested transport/guard getter reads could overwrite the actual core port with
a composite signal before the mutation precondition. Primary approved one
bounded fixture correction: match only the direct caller frame, retaining the
exact request/signal identity, frozen request, reached count + generation,
zero hooks and exact native descriptor restoration. The original attempt 2 log
is retained. No production guard is weakened, and a further observer miss stops
that control rather than triggering another speculative stack adjustment.

## Closed worker focused verification

Pinned Node 22.16.0 attempt 3 exited 0: 14/14 passed, no skips, duration
93.719 seconds. Pinned Node 24.15.0 attempt 1 exited 0: 14/14 passed, no skips,
duration 105.308 seconds. Both use the owned testing runner, scrubbed environment,
required tokenizer/transport flags and synthetic fake HTTP only. The internal
mutation control observed the actual frozen core port request and distinct
native port signal, reached count + generation, retained the ordinary public
failure with fatal request_mutated health, executed zero hostile hooks and
stopped all five remaining cases. No production correction was needed for the
two retained test-fixture failures.

All six genuine preparations fit the unchanged input cap. Complete generation
body token counts were 641, 1703, 911, 1093, 1339 and 3280 on Node 22, and 642,
1671, 936, 1058, 1343 and 3309 on Node 24. Case 06 was strictly largest in both
runs. Actual UUIDs and their token counts are run-specific observations, not
frozen future model inputs. The private raw logs retain full actual request,
count and generation witnesses plus separate permitted response, actual RG
proposal, derived CP and refs measurements. These scripted outputs do not
measure model first-response feasibility or semantic performance.

The four focused logs retain both failed attempts and both successful attempts.
Their 76 reported fixture workspaces and four owned runner roots were checked
by exact log-derived paths: all 80 were absent, with no manual or historical
temporary-directory cleanup. Deliberate setup/assertion child failures also
verified their owned parent directories were empty. Required dependencies did
not skip tests. The final worker inventory is exactly six paths; the independent
primary Git-versus-filesystem/base-blob inventory observed 1619 source files and
preserved the entire 184625-byte preexisting limitations prefix.

Upstream PR #414 at fixed base 93c2ba5 completed delivery as READY and MERGEABLE
with 27/27 successful checks; it was not merged. The acceptance-time draft status
above is historical. Primary final-byte full matrices, independent Standards and
Spec reviews and this candidate's delivery remain pending. Worker writes stop
after documentation/evidence closure; no broad suite, provider request, commit,
push or merge was performed by the worker.

## Closed first-response model outcome (2026-10-13)

The [original six-case result](receipt-group-feasibility-results.md) is closed
and rejected: **2/6** first responses compiled and selected nonempty cards,
below the frozen requirement of **5/6**. Operator exit 0 and reconciled accounting
do not imply a passed structural gate. All six provider generations completed;
02/03 compiled, while 01/04/05/06 retain `invalid_model_output` and no accepted
selection. Their raw outputs contain terminal-in-context overlaps in 1/2/6/1
groups; v1 enforced its original distinctness rule. Nothing was repaired,
recompiled, retried or rescored, and no answer or judge was called.

Twelve physical intents added 60000 conservative micro-USD; pending and unknown
counts are zero and the original prefix remains intact. The result separates
generation-only pricing from conservative reservations and source availability
from delivered answer context. The fresh synthetic overlap probe is separate
prospective-contract evidence, not a changed closed outcome or a shipped fix.

Runtime acceptance at 3aecc220d30a6c6efabae4a29decea60f054753d included full
two-Node gates, separate nonauthor reviews and 27 latest-head successful checks.
The earlier offline/pending status above is historical, not the present model
result. A newly matched QA24 comparison remains blocked. A separately versioned,
source-preserving representation requires its own offline implementation and
review; this result delivers no successor or improvement. Later paid work
requires a fresh reviewed freeze and original-budget preflight; all Stage 2/3,
safety/resource and installed-host gates remain.

Results-documentation checkpoint: one bounded actual GPT-6.1 Sol/high worker
used fixed base 3aecc220d30a6c6efabae4a29decea60f054753d and only the four
scoped documents. Read-only JSON/version validation and `git diff --check`
each exited 0. Six outcome rows agree with the original retained reports;
144 local Markdown targets exist. Git paths and an independent filesystem/
base-blob inventory agree on four changes (1619 base / 1620 current files).
The full 188039-byte limitations prefix, full prior feasibility plan and all
three-stage historical content/gates are preserved. No private paths, receipt
IDs, response bodies or ledger dump were added. Primary owns this delivery's
required gates, candidate freeze, independent final reviews and CI; these
worker checks do not promote the rejected result or release prospective work.
