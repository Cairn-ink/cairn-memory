# Qualified source-pair generation protocol

Fixed base: `bbdba950fae9c482a12cdec97f177556b62e8614` (PR #223).
Branch/worktree: `test/qualified-source-pair` / `qualified-source-pair`.
Primary owns this contract and acceptance. One GPT-6 Sol/high worker implements;
two different agents independently review Standards and Spec at the full fixed
base. Implementation starts only after PR #223's exact-head CI is accepted.

## Question, scope and subsequent gates

Compare source-bound-v2 qualified prefix and indexed windows on identical input
with the same answer settings. This isolates source exposure without also
changing qualification. It is not a MOC navigation ablation or Mem0 comparison.
This packet produces two-arm offline generation records. A separate strict
scorer, actual guarded transport, frozen fresh development/holdout roster and
resource caps are required before any paid run or answer-quality claim.

No provider calls, keys, downloaded corpus, operator ledger, cap changes, old
six/30-case reruns, core/default changes, merge, release or deployment. Cumulative
user authority remains US$200; this packet spends none on model APIs.

## N1 — Closed entrypoints and snapshots

Add `runQualifiedSourcePair` and pure `qualifiedSourcePairProtocol` exported by
`evaluation/longmemeval/public-comparison.mjs`. A small internal helper module in
that directory is allowed, without a new generic policy framework.

Runner options are exactly history, question, namespace, cores, answer,
countTokens, answerModel, limits, armOrder, execution. Data-only protocol helper
options are exactly history, question, namespace, answerModel, limits, armOrder.
Reuse existing public comparison validation for question/project namespace,
opaque prepared-v2 session identities and four-key limits. Answer template is
the existing V2 only, with its exact instruction and request serialization.
No per-arm prompt/model/limit override, evaluator, labels, reference answer or
caller-supplied arbitrary source validator is accepted.

cores has exactly qualifiedPrefix and indexedWindows, each exposing the existing
list/capture/recall/get methods. Reject the same core object before any callback.
execution has exactly withCaseScope and isHalted functions. Snapshot data and
all callback/method references before the first callback/await; replacement of
caller properties while awaiting cannot change subsequent work. The helper is
pure and never invokes any core, answer, counter or execution port.

## N2 — Deterministic trusted protocol binding

Build both actual qualified-prefix and indexed plans from the same frozen input.
Confirm captureInput and sourceMap arrays match before callbacks; never re-batch
or fall back. Their policy digests and retained views intentionally differ.
Use canonical name order `['qualified-prefix', 'indexed-windows']`. armOrder is
exactly one dense permutation of those names, frozen before execution. The
future campaign must balance that order; one call does not establish balance.

Define H(domain,value) as SHA-256 of UTF-8 JSON.stringify([domain,C(value)]),
where C recursively sorts plain-object keys lexicographically and preserves
array order. This is this protocol's deterministic JSON, not a JCS claim.
Use these domains:

- `cairn.lme.source-pair.history.v1`: qualified-prefix plan sourceTurns.
- `cairn.lme.source-pair.source-map.v1`: its ordered batches.map(sourceMap).
- `cairn.lme.source-pair.scope.v1`: [questionId, arm name].
- `cairn.lme.source-pair.protocol.v1`: the entire protocol excluding digest.

Protocol has exactly schemaVersion (`cairn-longmemeval-qualified-source-pair-protocol-v1`),
questionId, question ({text,date}), namespace, answerModel, templateVersion,
limits, armOrder, captureQualification (`source-bound-v2`), historyDigest,
sourceMapDigest, arms and digest. Each canonical arm descriptor has exactly
name, scopeId, captureSourcePolicy, planSchemaVersion and payloadDigests in
batch order. scopeId is `lme-case-` plus the scope-domain hash above; it is an
execution identity, NOT the dataset ID supplied to the evaluator. Null batch
digests are permitted only as produced by a nonexecutable actual preflight.
Policy labels are `retained-prefix-v1` and `indexed-windows-v1` respectively.
No source text/catalog/reference is emitted in protocol, except the user's
question. Raw content still affects its binding hashes.

Digest binding is not authentication of arbitrary callbacks or proof of actual
model configuration. Later scoring must receive a trusted expected protocol or
frozen roster binding, not only the report's own self-consistent digest.

## N3 — Exactly two source-only generation arms

Reuse/refactor the real private one-arm ingestion→recall→get→packing→answer
seam. Do not call the legacy three-arm runner twice or hide baseline calls.
Each arm checks its namespace is pristine at execution time. Distinct objects
are not physical store isolation: a real shared dirty-store negative must fail,
and the later actual launch must create separate fresh files.

Use the correct named ingester for each arm and require completed outcomes;
duplicate/partial/failed/unknown ingestion is not fresh successful ingestion.
Preserve authoritative full-get, exact namespace/current state/revision,
client/session/message/role and exhaustive receipt-set checks. Both qualified
arms additionally enforce global receipt-ID uniqueness. Prefix evidence must
equal the actual host-derived retainedMessages excerpt for that message;
indexed evidence must equal a trusted catalog member for that same message.
Never accept arbitrary substrings, concatenations, a foreign same-text receipt,
generated memory prose, stale/partial evidence or model-authored offsets.

Use exactly the common V2 answer request. No source labels, reference answers,
raw full transcript or qualification paraphrase may enter packed evidence.
Preserve common whole-item packing and record candidate/selected/omitted counts,
retrieved/packed source-session IDs and semantic coverage unassessed. There are
no full-history or no-memory answer arms or full-history-fit prerequisite.
The question/framing and each packed request still face the same context and
output ceilings. countTokens is a synchronous local estimate, not provider-fit
proof. Callback usage remains answer-only, not total ingestion cost.

## N4 — One scoped execution port, no implicit paid capability

Invoke execution.withCaseScope({phase:'generation',caseId:scopeId}, operation)
sequentially in armOrder. Each operation must be invoked exactly once. The
scope handle exposes snapshot(); its exact returned fields are version
(`case-deadline-scope-v1`), phase, caseId and status. Require matching identity.
Within the callback only active may do work; timed_out/blocked yields an arm
timeout without core/answer callbacks. Completed/mismatched/malformed scope is
invalid. isHalted must return boolean, and true always overrides local timeout.

Check scope/global state before and after every core/answer callback so errors
swallowed by existing helpers cannot start another callback after a known halt.
Fence the local arm when the scope exits so later wrapper invocations cannot
call snapshotted callbacks. Arbitrary direct fetches or already-running injected
callbacks cannot be sandboxed; this API does not claim otherwise.

Ordinary application failures return a failed/blocked arm inside the scope and
allow the other arm if the scope exits cleanly. A known local timeout is isolated
only while the global guard is not halted. The real future guard owns request
reservation, settlement, pending-attempt refusal and late guarded-route denial.
This port has no total arm wall-clock deadline and does not prove upstream
cancellation. A local answer timeout must not bypass a failed scope-exit fence.

Generation and scoring remain separate entrypoints: the actual shared guard
schedule requires ALL generation identities followed by matching scoring
identities in the same order. Do not compose two guard instances or change the
existing guard to implement this offline packet.

## N5 — Explicit halted record and fixed outcomes

Return schema `cairn-longmemeval-qualified-source-pair-v1` with exactly protocol,
executionStatus, haltReason, attemptedOrder, arms, latencyMs, sourceTimePolicy,
semanticCoverage and interpretation plus schemaVersion. executionStatus is
completed or halted; haltReason is null for completed, otherwise one of
global_halt, scope_contract_invalid, scope_execution_failed. attemptedOrder
records scope entries whose operation actually began; arms always contains both
canonical names with the existing name/status/reason/answer/diagnostics shape.
Ordinary model/ingestion failure can coexist with completed execution scheduling.

Initialize both arms blocked/not_started. Save a cloned safe result outside the
scope INSIDE its callback before returning; a real guard can throw after that
return during boundary verification. Any scope-wrapper exception, including
pre-entry schedule mismatch even when isHalted is false, stops all later work.
Mark the active arm failed if entered or blocked if not, clear its answer, keep
earlier completed arms unchanged and block every later arm. For halted arms use
the finite haltReason as reason. Never expose exception text or retry/resume.
Invalid scope state or a throwing isHalted sets a sticky contract-failure state;
a later benign callback result cannot clear it. Scope/port failures may not be
downgraded to an ordinary answer failure to authorize continuation.

Deep-freeze the final report. Start latency measurement at entry, including
planning. sourceTimePolicy remains
`source-date-metadata-only-capture-is-source-time-unaware`, semanticCoverage is
`unassessed`, interpretation is
`offline-qualified-source-pair-generation-not-a-semantic-score-or-paid-grant`.
Later scorer makes zero new judge calls for a generation-halted report, retaining
both unresolved judgments; earlier generated answers remain private evidence.

## N6 — Synthetic evidence and compatibility

Both orders must run exactly two arms with real separate stores, scripted core
model ports and source-only answer inspection. Prefix versus later-window
evidence is observable, including mixed roles, normalization/redaction and a
cold close/reopen before recall. Include real shared-store contamination,
same-object rejection, forged namespace/revision/receipt identity/text, partial
get, duplicate receipts, empty recall, ingestion partial/failure, normal answer
failure, local timeout and global halt. No hidden third-arm request.

Test scope failure before callback, during an arm and after callback return;
earlier results survive but no later work starts. Test malformed/throwing status,
double/no invocation, caller/callback mutation, pending/late callback work,
stale scope identity, and no retry. Scripted scopes prove orchestration only,
not real paid-transport fences. Test rejection of labels/unknown options before
callbacks, protocol/digest sensitivity to source tail/date/order/settings,
canonical object-key equivalence and deterministic scope identity. Freeze a
small independently computed protocol hash to catch implementation drift.
Old official scorer must refuse the new report before any judge call.

Preserve all legacy/indexed public comparison identities, option shapes,
requests, three-arm order/timeout behavior and fixed-base golden tests. No
widening of old paid guards or official scorer schemas. Do not relabel reports
to force old scoring compatibility.

## N7 — Verification and delivery

Allowed: this plan, public-comparison.mjs, at most one small private helper,
focused tests, technical pair/comparison documentation, CHANGELOG and limitations.
No ingestion/core/adapter/live/scorer/guard/ledger/host/default/dependency changes.
Report any required interface expansion to primary before edits.

Run on Node22.16.0 and24.15.0: focused tests, full test:longmemeval,
test:live-evidence-offline, test:experiment-request-guard, npm test, all three
LongMemEval demos, JSON, verified local Claude2.1.260 strict validation and diff
hygiene. Primary reads actual diff and personally reruns key full gates; separate
Standards and Spec inspect the same full original-base final commit. Fixes need
reruns and both axes again. Push dependent PR against
test/qualified-prefix-ingestion only after acceptance; all exact-head CI and
mergeability before ready. No merge/release/deploy. Resume from exact commit,
recorded gates and next gate, not an assumed memory of completion.
