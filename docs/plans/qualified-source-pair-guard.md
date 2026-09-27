# Qualified source-pair guarded execution

Status: frozen contract; implementation released after dependency B #226 passed
both independent reviews and all17 exact-head CI jobs (run36100091549).
This release is not a paid-run grant or authorization to merge.
Fixed review base: `1c667299adf3a4273c6e47c81a72c6f7cb0b9582`.
Branch/worktree: `feat/qualified-source-pair-guard` / `qualified-source-pair-guard`.
Primary owns design and acceptance; one GPT-6 Sol/high author implements and
two other agents independently review the same original-base/final-SHA diff.

## Goal and sequence

The product goal is a lightweight, source-backed reliable memory layer usable
through Hermes, MCP and other harnesses. The immediate experiment asks whether
indexed source windows improve over a qualified prefix on identical histories,
without confusing source exposure with qualification or MOC navigation.
Generation (N), official-style scoring (P) and the separate immutable budget
chain (B) precede this guarded transport (G). After G: freeze fresh development
and untouched holdout cases, balanced arm orders, phase dollars/request ceilings
and success criteria; independently verify the installed launch; only then run
within the cumulative US$200 authority. Previous terminal six/30-case cohorts
are never retried, relabeled or relaunched. A later matched Mem0 comparison and
installed growth/onboarding remain distinct milestones.

This packet is offline: no corpus download/read, provider/key, operator ledger,
actual cap change, migration, merge, release or deployment. It makes no semantic
gain, competitive-parity or product-readiness claim. Do not import the separate
embedding-ledger branch. Existing v1 channels suffice.

## G1 — Existing-only bound ledger handle

Add one maintainer export `openBoundExperimentBudget({configuration, authorize})`
to `evaluation/experiment-budget/index.mjs`. Exact two options; configuration
is the existing exact four-key snapshot, each caller field read once. authorize
must be a synchronous trusted function, not a sandbox or source of permission.

Reuse B's encoded existing-only SQLite `mode=rw`, privacy/link/identity checks,
state/schema validation and transaction ownership. Own BEGIN IMMEDIATE on ONE
connection. Require exact configuration and open, fully settled state before
calling authorize with its frozen detached publicState (not a raw database).
Only undefined return is valid. Recheck unchanged full state and path identity
after callback and before commit. Return a bound handle on that SAME connection
only after successful commit; never silently use ordinary writable reopen.
Callback failure rolls back/closes; fixed errors remain authoritative. A guard
callback can retain a known guard error in its closure and rethrow after cleanup,
as B does. Durable files/claims created by a callback are never deleted on failure.

The handle exposes existing reserve/recordOutcome/getState/close signatures.
Privately pin the whole initial state and update its expected history only from
its own successfully committed operations. Verify the witness INSIDE every
transaction, especially reserve's writer transaction, not merely in a separate
guard precheck. Foreign append/settlement/deletion/edit, config drift, replaced
path, mode/link change or corrupt schema must fail before further reservation
or transport. Own pending rows remain valid for settlement; unknown/failed rows
retain full reservations. Return immutable detached snapshots.

Before commit recheck identity and exact expected post-state. Install the next
witness only after a confirmed commit. Ambiguous commit, operational state/path
failure or transaction cleanup failure permanently fences this bound handle;
no retry, refund, adoption of foreign history or fallback reopen. Subsequent
operations fail with a fixed closed/fenced error; close stays safe/idempotent.
Invalid caller arguments before a transaction need not fence it. Preserve the
original cause for the first failed operation. Release SQL locks before HTTP.
This protects named application races, not hostile privileged same-user writes
after the last check or arbitrary direct network egress.

Reuse the existing private handle machinery with an explicit private bound mode
where practical; do not duplicate an entire ledger or alter ordinary create/
reopen semantics. No public arbitrary validator hook on reserve/settlement.

## G2 — Compact prospective roster and immutable capability

Add named request-guard exports `authorizeQualifiedSourcePairCapability(options)`
and `createQualifiedSourcePairExperimentRequestGuard(options)`.

Authorization options exactly: ledger, policy, benchmarkExtension,
authorizationId, executionId, checkpoint, roster. IDs use the existing bounded
authorization-ID grammar. checkpoint has requestCount/reservedMicroUsd exactly.
benchmarkExtension is either a complete file-bound v1 monetary extension at100
or the separately validated B chain at200; no original/allowance-only fallback,
recursive chain, arbitrary caps or widening of old validators. Verify the whole
parent and historical-prefix chain against the current state.

roster is a dense array of 1..250 entries with no extra array properties. Each
entry has exactly questionId, protocolDigest, armOrder, arms. questionId uses
the prepared-v2 `lme-case-` plus64 lowercase hex form, globally unique; digest
is64 lowercase hex. armOrder is exactly either dense permutation of the two
names. arms is the dense canonical name order qualified-prefix,indexed-windows;
each entry exactly name,scopeId. Derive/verify scopeId with N's existing domain
hash `cairn.lme.source-pair.scope.v1` over [questionId,name]; all scopes unique.
The trusted launcher, not a result, supplies these descriptors from independently
computed full expected protocols. The guard validates shape/binding, not the
unknown preimage of a supplied protocol digest. No raw question/history,
reference answer, label or model-authored passage is persisted in the grant.

Use H(domain,value) = SHA256 UTF8 JSON.stringify([domain,C(value)]), C recursively
sorts plain-object keys and preserves array order. rosterDigest domain is
`cairn.lme.source-pair.roster.v1`. Derive the exact schedule: roster order and
each armOrder for ALL generation entries, followed by matching ALL scoring
entries. Entries retain the existing exact {phase,caseId} shape and1000-entry
maximum. Never accept a caller-supplied inconsistent schedule.

Capability has exactly version (`qualified-source-pair-case-v1`),
authorizationId, executionId, ledger, policy, benchmarkExtension, checkpoint,
historicalDigest, roster, rosterDigest, schedule, methodProfile
(`qualified-source-pair-v1`). Canonical serialized binding plus newline must
fit the existing1MB readBinding bound BEFORE creating files. Preserve existing
private file checks, create-only0600 and file+directory fsync. New distinct paths:
`experiment-qualified-source-pair-EXECUTION_ID.json` and corresponding
`.claim.json`. Claim exact version (`qualified-source-pair-claim-v1`), executionId,
capabilityDigest; use existing canonical historicalDigest([capability]) for that
digest, not a fabricated new authenticity guarantee.

Authorization uses G1's callback under the existing-only writer lock to verify
the exact fully settled checkpoint/history/chain and unused claim, then create
or sync an identical existing binding. Conflicting, partial or unsafe files fail
closed; no repair. Close its handle after provisioning. It does not consume a
claim or authorize provider access by itself.

Factory exact required options: ledger, policy, benchmarkExtension,
qualifiedSourcePairCapability, fetchImpl. Optional transportDiagnostics only
`bounded-v1`. Read data/function references once before callbacks; detach data.
Validate capability against files and inputs, then use G1 callback to revalidate
under lock and create/fsync one exclusive claim. Partial/consumed claim remains
irrevocably consumed, including later initialization failures. Return the guard
with the SAME bound handle; failure closes it without deleting any claim. No
second ordinary reopen on this path. Two competing constructors cannot both win.

## G3 — One closed pair profile, unchanged old routes

Reuse private constructBenchmarkGuard's send/usage/settlement/deadline/scope
machinery through a CLOSED private pair profile and injected bound handle.
Only the new named factory can select it. Do not export caller-supplied body
validators, copy the entire guard, or loosen old factory capability acceptance.
Old benchmark/candidate/indexed denials and old explicit-target baseline behavior
remain unchanged; B's clarification is not a global transport-policy change.

The active trusted scope selects its arm. Pair-only Cairn validation permits
extract,classify,select,rank,qualifyCandidates with actual schemasFor output,
exact count/generation wire shape, pinned policy models/prices and existing
6000 local-token/7024 framed/1024 output bounds. Qualified-prefix permits normal
extract and rejects indexed inputMode; indexed-windows requires precisely
indexed-windows-v1 extraction and rejects legacy extraction. Qualification has
no inputMode; do not invent one. Deny qualify,reconcile,relate,reviewBasis,
selectChecklist, unknown methods/schema changes, mismatched arm/model/endpoint.
No answer/judge or host escape via Cairn routes. Answer only during generation;
judge only during scoring; hostFetch remains unsupported. Pair-only validation
may share narrowly refactored wire checks with old code with unchanged defaults.
Body/schema checks do not attest instruction semantics or history equality;
trusted launch and N/P separately enforce those boundaries.

Keep existing withCaseScope/snapshot/timeouts contract so N/P work unchanged;
expose the new grant as qualifiedSourcePairCapability, not mislabeled old grant.
Do not expose caseDeadlineCapability on the new factory. Keep scope snapshot
version case-deadline-scope-v1 for N/P port compatibility. One instance owns the
entire frozen schedule and physical request history. No per-arm guard reset,
hidden retries or additional baseline calls. Keep every blocked/unrun slot in
the later fixed-roster denominator.

Only recognized core_deadline/transport_deadline isolates the current scope.
External abort,429/non-2xx, malformed responses and accounting/state anomalies
still halt globally. Late response/body completion cannot settle twice or reopen
a sealed scope. Actual integration must place guard deadlines ahead of N/P
backup timers with explicit margin; do not relax failures to inflate completion.

## G4 — Observable offline acceptance

Use actual temporary SQLite, actual adapter-generated wire requests, fake HTTP,
real N generation and P scoring. Required cases:

1. Both source arms perform extraction+candidate qualification+filing+recall,
   answer then official-style judge through ONE frozen schedule and bound ledger;
   use two fresh core files and verify actual source receipt policy per arm.
   At least two cases exercise all-generation-before-all-scoring ordering and
   reversed arm order. No paid calls. Exact ledger cost/request accounting.
2. Wrong arm/method/schema/model/stage/endpoint, sparse/drifting/extra roster,
   protocol/scope mismatch, binding modification or parent-chain damage rejects
   before reserve/forward. Test actual old factories still deny new paths.
3. Existing-only disappearance before open, swap/mode/hard-link change during
   callback and after claim, valid foreign row insertion between guard verify
   and reserve, foreign settlement, and state tampering all fail closed. Assert
   no replacement DB, no unauthorized forwarding or erased reservation.
4. Actual concurrent child constructors yield exactly one claim owner; partial
   write/fsync/commit/cleanup failures leave consumed claims and fenced handles.
   Include failure before and after a real COMMIT, no runtime fault hooks.
5. Exact finite cap exhaustion, reservation/settlement failure, unknown usage,
   429, external abort, deadline, late body, callback exit failure and escaped
   descendant behavior preserve accounting and fixed schedule. A recognized
   deadline isolates one arm and allows the next preselected arm; global errors
   block all subsequent sends. Verify with actual N/P integration, not only ports.

Pure ledger tests belong in the dependency-free budget suite; actual adapter/
N/P integration belongs in installed request-guard/live suites. Do not introduce
adapter imports into the isolated LongMemEval CI job. No workflow/dependency or
lockfile changes are planned. Check clean no-adapter budget/LME snapshots too.

## G5 — Verification, review and continuation

Allowed: index.mjs, request-guard.mjs, narrowly scoped private helpers if needed,
new/existing budget/guard/live tests, registration in existing scripts,
docs/experiment-budget.md, docs/experiment-request-guard.md, docs/limitations.md,
CHANGELOG and this plan. Core, adapter behavior, N/P protocol, provider profiles,
old APIs, actual ledger/config and external files are excluded.

Both Node22.16/24.15: budget, request-guard, live-offline, LongMemEval, generic,
budget/guard and three LME demos, JSON, pinned local Claude2.1.260 strict.
Primary reads actual diff/tests, runs independent critical path/race probes and
required gates, verifies final candidate bytes. Independent Standards and Spec
review original base through final commit; correction repeats both axes.
Exact-head all CI and mergeability precede ready status. No merge/paid transition.

Historical pre-implementation checkpoint: B at the fixed base was accepted offline after primary full
two-runtime gates, independent Standards/Spec and exact-head all CI. Its actual
operator ledger was not changed. G implementation is released to one bounded
Sol6/high author; no G runtime evidence exists yet. Primary prepared independent
bound-handle and compact-grant acceptance probes. After each checkpoint record
actual commands/results, findings, tested SHA, open limitations and next task
here and in the PR; never equate a transport gate with semantic reliability.

### Author implementation checkpoint (pre-review candidate, 2026-09-25)

The preceding checkpoint describes the pre-implementation state. G1–G3 now
have a local implementation and G4 has synthetic temporary-ledger,
fake-HTTP tests. Primary independently exercised the same bound-ledger code
with named races, before/after real COMMIT, and actual N/P 100/200 parent
flows on both Node runtimes; this is acceptance input, not a completed review.
The author-focused current Node24 runs pass bound-ledger 7/7, installed guard
30/30, and live-offline 4/4. The live positive covers two cases, opposed arm
orders, four fresh real cores, adapter-generated source methods, source-only
receipt differences and all generation before scoring. The separate live
deadline/429 negatives use N/P with synthetic empty-core source metadata;
primary separately exercised failure modes through real cores. Claim-write,
fsync, pre/post constructor COMMIT, cleanup, competing ready children, late
body, pending settlement, and a foreign row exactly at reserve BEGIN are
asserted without modifying the actual operator ledger. A provisional live
fixture initially sent raw N/P chat request objects without the guard's
required `store:false`/`stream:false`; adding that synthetic wire envelope
made the actual flow pass. A later cap test expected the scope wrapper to
return after `request_cap_exceeded`, but the bound handle conservatively fences
and the wrapper then returns `ledger_closed`; the corrected test inspects
durable rows using a separate observer handle. A brief author experiment
to keep a clean cap denial reusable was reverted before freeze; current
runtime bytes match the primary-probed conservative fence. Primary's full G5
matrix on the frozen runtime, test and package bytes above passed on Node
22.16 and 24.15 (`/tmp/cairn-g5-offline-matrix.mjs`, sessions 91390/3357):
budget 25, request-guard 222, live-offline 355 total (325 passed, 30 explicit
opt-in skips), LongMemEval 123, generic 112, all five budget/guard/LongMemEval
demos, JSON, and isolated pinned Claude 2.1.260 strict plugin validation.
The author ran the focused Node24 tests reported above; the full two-runtime
matrix is primary-run evidence, not an author-run claim. G5 is accepted locally
for this pre-review candidate. Clean no-adapter archive checks, fixed-SHA
independent reviews, exact-head CI and mergeability remain pending. No
provider request, private corpus, operator-ledger operation or paid grant
occurred.
