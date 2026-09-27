# Same-dollar request-cap transition for the existing mixed ledger

Status: bounded implementation contract, no operational transition yet.

## Scope

Base ecfe68c66622a35d726f6b868c9b523c940951b8, isolated dependent branch
fix/mixed-request-cap-v2. Worker GPT6Sol/high owns index.mjs, request-guard.mjs
and focused new budget/guard tests plus this plan. Do not edit the resource
projection or shared limitations document: another worker owns that packet.
Primary subsequently added `package.json` test registration and the bounded
C10 D6 test/isolated-clock helper to this worker's scope below.
Primary will combine the two evaluation-budget changes into one scoped delivery
after inspection, required gates and independent review of the combined SHA.
No changes to memory algorithms, models, source data, native profile or old
private launchers. No operational ledger/key/provider access, migrations,
grants, pushes, merge, deployment or package publishing by the worker.

The user permits arbitrary request counts within the cumulative US$200 limit.
The narrow intended future transition is schema2/200M/50000 requests to
schema2/200M/420000 requests. The fixed30 upper request need394689 plus existing
12730 requires407419;420000 leaves12581 headroom. This changes no dollar
authority and does not itself authorize the paid pilot.

## State and authentication contract

C1. Preserve existing exported v1 transition behavior (it requires both limits
to rise). Add a narrow v2-only same-dollar request-cap transition, reusing private
transaction/path validation where appropriate. Same directory/runId and200M
limit, strictly larger safe integer request cap. Existing-only database,
BEGIN IMMEDIATE, no pending/overrun/halted state. Initial transition matches
exact old cap, checkpoint count/reservation and full old history witness.
CAS updates request_cap only. No attempt insert/update/delete or schema change.

C2. Full historySha256 includes request_cap, so it MUST change. Old and new
checkpoint witnesses must bind the same raw attempt rows INCLUDING rowids,
IDs/channels/outcomes/reservations/usage, projected with old/new caps. Preserve
the original parent bindings and descriptors; never overwrite their cap fields.
Tests verify row-for-row preservation and both witnesses independently.

C3. Existing bound snapshots omit rowids. Use an index-module-private WeakMap
to associate exact issued frozen boundEmbeddingSnapshot objects with their
validated rowid-bearing state, without changing the public snapshot shape.
A narrow projector accepts only an authentic issued snapshot and exact
old/new caps/checkpoint, verifies its retained full witness, and returns the
two prefix hashes. Clone/fabrication denied. This is an authenticated historical
witness, NOT freshness or a grant. No nested database connection is needed.
Projecting after a suffix uses the complete checkpoint prefix and old/new caps;
validate current full state independently. The transition callback receives an
issued snapshot under the write lock; re-read raw state after callback and
compare its full witness before CAS. Do not expose raw private row state.

C4. Add one versioned request-allowance record/binding for an existing
BENCHMARK_BUDGET_CHAIN_VERSION parent. Exact fields include old/new ledgers,
unchanged policy/stages, original chained parent, authorization ID, checkpoint,
old/new rowid-aware prefix hashes and appropriate existing historical digest.
Singleton filename by the existing parent-chain authorization identity prevents
parallel inconsistent extensions. Verify immutable parent binding against old
config and original v1 ancestry, not a silently rewritten new cap.

C5. Binding/CAS ordering: oldcap/no file may create; oldcap/exact durable file
may complete the same transition; newcap/exact file may replay after suffix;
newcap/missing, mismatched or unsafe file denies. Different target/auth/parent,
stale checkpoint/history, pending/overrun and monetary change deny. A callback
failure must not change the database; a retained valid pre-CAS binding is not
proof of completed transition. Idempotency is only for this operator transition,
not permission to retry failed model questions.

C6. Extend only mixed parent verification to recognize the new allowance.
Retain original snapshot descriptor safely before descriptor-first detachment;
new variant needs the authentic issued snapshot for the prefix projector.
Legacy old-parent assertion behavior stays unchanged. Existing mixed preflight,
binding and dispatch already funnel through the parent checks; no new fetch
path or authority escape. Old parent token under new cap fails. Fresh inspect/
openBound at actual admission remains necessary; issued snapshots alone may
be stale after their transaction.

## Verification

C7. Synthetic existing schema2 fixtures only, including a preserved v1 prefix
and embedding suffix. Test successful transition, exact replay before/after
suffix, duplicate/concurrent authorization, stale/wrong checkpoint/hash/caps/
parent/monetary mutation, pending and halted states, missing/mismatched/unsafe
bindings, callback failure/retained binding recovery, no refund/reset, exact
attempt-row and rowid preservation and changed-but-reconstructible hashes.
Clone/fabricated snapshot cannot get a prefix witness. Demonstrate old-token
denial and new-token mixed parent verification plus fake guarded physical
reservation beyond the old request cap but below the new cap. Monetary200M
ceiling still enforced; no test uses real provider/key/data.

C8. Preserve old v1 tests. CONTRIBUTING budget and guard suites/demos on pinned
Node22.16 and24.15, generic npm test/validate; run live offline and LongMemEval
integration where cross-feature callers require it. Install only locked isolated
dependencies. Coordinate heavy-test slot with primary (R worker currently owns).
Record source/caller tracing and commands/raw evidence here; scoped local
candidate commit only. Primary reruns integrated gates and invokes independent
Standards and Spec on the combined fixed diff before any push/PR or operational
transition. No power-loss/OS-sandbox/DB-owner-forgery guarantee implied.

## C9 — fixed pilot history envelope, primary scope amendment

Primary and independent read-only reviewers found that the legacy parent
detachment ceiling (16MiB /1M visited values) fails before the projected394689
new requests, even when the ledger cap is420000. Verification runs at every
reservation, so this is a deterministic potential mid-run stop, not just a
preflight concern. Fix this in the same bounded request-cap packet, without
changing any model/source/prompt or old-parent behavior.

Only the new benchmark-request-cap-v2 parent assertion may use a bounded64MiB
and3M-value envelope, sufficient for420000 valid snapshot rows plus descriptors.
Select that envelope using own data descriptors; never invoke accessors to
select a larger limit. Retain32depth, all structural checks, full witnesses and
legacy16MiB/1M limits. Malformed/getter inputs remain safely denied. This is not
unbounded scalability or a guarantee for every possible safe-integer cap.

Synthetic acceptance: real420000-row schema2 ledger with valid original parent
and retained rows; authorize the new allowance with cap above the test count,
verify the actual mixed parent/guard reservation path near that envelope, and
deny a cloned witness. No model provider, operational ledger or corpus. Use
bulk synthetic fixture insertion only to avoid quadratic fixture generation,
then actual public inspection and guard APIs. Record elapsed time/memory when
available. Legacy tests remain unchanged. Repeated full-history scanning is
still O(N^2) over a growing campaign and needs an honest throughput limitation;
the bound is resource accounting, not a completion-time guarantee.

## Candidate verification record

Worker: delegated GPT-6 Sol/high, fixed base
`ecfe68c66622a35d726f6b868c9b523c940951b8`. The new index transition
and request guard are the only runtime edits; `package.json` registers the two
focused test files. Callers traced: `inspectMixedSourcePairParent`,
`authorizeMixedSourcePairCapability`, and
`createMixedSourcePairExperimentRequestGuard` all use the shared mixed parent
assertion. The legacy v1 parent branch and v1 cap transition remain unchanged.
No Next.js route, browser replay, production script or downloaded corpus is
involved.

Raw offline logs are under `/tmp/cairn-cap-v2.B2FBoj/`. Node 22.16 and 24.15
both passed `npm run test:experiment-budget`, both budget/guard demos,
`npm test`, `npm run validate`, `npm run test:longmemeval`, and
`npm run test:live-evidence-offline`. Node 22.16's final
`npm run test:experiment-request-guard` passed. Node 24.15's initial full guard
run passed, but its post-C9 pre-C10 run was 288/289: the unchanged D6 deadline
test omitted a `count,classify` fake-call pair after the second capture had
returned success. An isolated real-clock D6 rerun passed without explaining
that failure; the controlled diagnosis and final C10 correction are recorded
below. Final full guard suites pass on both Nodes. Adapter
dependencies came from locked
offline `npm ci --prefix adapters/openai --offline` and the corresponding MCP
command. The first pre-fix budget gate found the existing migration child's
unique source fault seam duplicated by the new transition; formatting only the
new function restored the seam and its old test passed. The first C9 scale
attempt exposed a remaining hard-coded one-million element precheck; it now
uses the selected envelope and the later real-row gates pass.

The explicit opt-in C9 gate is `CAIRN_CAP_V2_SCALE=1 node --test
--test-name-pattern=C9 evaluation/experiment-budget/test/request-cap-v2-guard.test.mjs`.
It inserts 419,996 terminal zero-reserve synthetic embedding rows in one
SQLite transaction after the four inherited rows, then uses the public
snapshot/parent/capability/guard APIs and one fake embedding response. No
provider or key is involved. Node 22.16 passed with 420,000 pre-request rows,
100.0 s test time and about 3,059 MiB final RSS; final instrumented Node 24.15
passed in 83.7 s and about 3,044 MiB final RSS. Its stages were 0.3 s setup
transition, 1.3 s bulk insert, 5.2 s snapshot/parent, 6.1 s mixed capability,
13.8 s guard creation, 14.7 s first no-request case, 38.6 s fake embedding
request and settlement, and 3.8 s state read/close. The test uses cap 420,010 to retain a six-request
mixed phase quota after the 420,000-row fixture; this is an envelope stress
test, not a proposal to change the intended 420,000 cap. It proves one bounded
admission, not practical throughput: current full-ledger validation and
history-copy work repeats on each request and is quadratic over a campaign.

## C10 — deterministic D6 invocation-clock verification

Primary diagnosis2026-09-27 retained the full-suite Node24 failure above.
Isolated realclock rerun passed but was not accepted as a diagnosis. A private
test-only import-hook probe delayed classification1100ms after admission:
both unchanged baseecfe and thiscandidate failed with the EXACT missing
count/classify sequence. Both showed one admittedmemory and classification
model_timeout at1191–1194ms; delay0 candidate completed classification at108ms.
Tool evidence cc980e/87af36/248499 and probe
/tmp/cairn-d6-clock-diagnosis.vGSs9c/probe.mjs. This establishes a scheduling-
sensitive test assumption present before the cap patch, not proof that every
possible D6 failure has that cause. No product timeout is to be relaxed.

Bounded worker extension: modify only the D6 test and one isolated test clock
helper under evaluation/experiment-budget/testing, preserving all assertions
about first invocation timeout, late response fencing, retained charge and
successful second capture/classification. Run D6 in a fresh child with a
controlled process.hrtime.bigint installed BEFORE core imports; core captures
that clock at import. Pair with mockedsetTimeout. Advance both clocks exactly
when the first fakegeneration is stalled to expire the first1000ms invocation;
leave monotonic time fixed during the second invocation. Never patch runtime
core/guard clock or lower assertions. Parenttest must not leak clock mutations
into other tests; sanitize child environment/no keys. A failing child fails the
parent, with boundedtimeout and helpful synthetic-only diagnostics.

Run isolated D6 bothNodeversions and final full request-guard suites both after
the clock correction. Primary repeats the same finalcandidate gates. Retain
the originalred evidence and identify the oldrealclock assumption in PR.

Worker correction: the D6 parent test now starts one child with an empty
environment, absolute Node executable, 15-second timeout and a required
post-assertion success marker. The child installs controlled
`process.hrtime.bigint` before dynamic core imports; D6 mocks `setTimeout`,
advances both clocks by exactly 1,001 ms only after the first fake generation
stalls, and holds monotonic time fixed throughout the second capture. No core
or request-guard runtime code changed for C10. The original first-timeout,
late-fence, monetary-charge and successful second-classification assertions
remain. Isolated D6 passed on Node 22.16 and 24.15 (`node22-d6-clock.log`,
`node24-d6-clock.log`). Final full request-guard suites passed 289/289 on both
(`node22-guard-c10.log`, `node24-guard-c10.log`). The retained real-clock
failure is at `node24-guard-final.log`; the correction removes its scheduling
assumption, not a proven product regression.
