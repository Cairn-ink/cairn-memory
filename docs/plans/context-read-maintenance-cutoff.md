# Confirmed-disposal maintenance cutoff delta, revision 2

Design only, against fix A and B0. Adopt the reduced recovery below as the recommendation.
Amends the [product cutoff rule](../context-read-product.md#cron-renewal-and-supervised-pump), preserving
[fix B crash safety](context-read-incremental-catchup.md#5-retarget-reuse-closure-and-crash-safety-under-continuous-writes).

On a native qualification host, rare stalls reached cutoff and stopped maintenance until renewal.
Safe disposal should instead cost one charged quantum plus recovery overhead; all call bounds stay intact.

## Recommended eligibility and recovery

Only lexical `refreshContextIndex` dispatched by the owned lexical pump qualifies. Use a private,
parent-owned dispatch capability binding pump/resident epochs, lane, quantum, operation, ledger and
absolute cutoff, plus parent/reader deadline-cause attestation. An operation ID, method name, bare
`read_timeout` or caller flag alone is insufficient. Opening, status, standalone maintainers, reader
operations, `fetchCandidateEvidence`, search/`findCandidates` and `contextRead` retain terminal cutoffs.
Semantic/embedding-enabled pumps, including their lexical turns, keep their current behavior and USD rules.

Keep the pump alive on an eligible cutoff; do not invoke global `stop()` while deciding recovery.
The call still settles `read_timeout` promptly. Preserve reader deadline checks, detachment, late-frame
rejection and the pump elapsed check. Reuse the affected resident's existing `close()` and drain path;
it owns termination or graceful close as appropriate. Hold new dispatch while that turn/disposal is
pending. Do not close healthy residents or restart the whole pump through the renewal factory.

Require proof within 1,000 ms of cutoff and an available recovery allowance. On success invalidate the
dead resident's handle/writer cache references and every cached intent sharing it. Apply the shared-domain
cooldown, then resume the existing scheduler with the same observation baselines, missed-interval flags,
last observation, round-robin cursor and spacing baseline. Preserve the already-advanced cursor; do not
rewind to the failed lane or initialize a new observation interval. No dispatch overlaps pending work.
An isolated recovered cutoff keeps public status `active`, error null and completion pending while
quota/authority remain valid; private diagnostics expose the cutoff and recovery decision.

If allowance/proof wait is exhausted, take the existing terminal stop-and-drain path. Successful terminal
drain retains public `read_timeout`. A failed or uncertain drain after cutoff makes public completion
`failed`/`reader_failed`, exactly as `stop()` and its failed-drain regression do today; private diagnostics
retain the triggering cutoff. No successful disposal outcome may be inferred from an unresolved drain.
Late proof cannot revive this expedited recovery or its stopped pump. Ordinary authorized renewal after
a later successful drain remains available as today; failed or uncertain disposal retains quarantine.

## Disposal proof and runtime enablement

Await actual Worker exit/termination completion and both resident-resource and interrupted-operation
cleanup deliveries. Both records must be `complete`, with `workerStopped`, `nativeDisposed`,
`leasesReleased` and `providersSettled` true. Operation completion alone does not prove resident disposal.
All native SQLite connections/statements must be closed; lease/provider acquisition/release counters
must balance. The writer claim is released only after successful resident disposal. No replacement
opens before that release: no transaction from the old Worker can commit after the successor opens.
A commit already executing can finish before exit; inspect durable state rather than assume rollback.

Worker exit suffices for the engine's isolate-owned `node:sqlite` connections because Node tears down
its Worker environment before joining/reporting exit, and the `DatabaseSync` destructor finalizes
backups/statements/sessions and calls `sqlite3_close_v2`. This is a runtime-specific inference from
[Worker teardown](https://github.com/nodejs/node/blob/v24.22.1/src/node_worker.cc),
[environment cleanup](https://github.com/nodejs/node/blob/v24.22.1/src/env.cc) and
[the SQLite destructor](https://github.com/nodejs/node/blob/v24.22.1/src/node_sqlite.cc#L931).
It is not a generic property of thread exit. The registry's `nativeDisposed` bit derives from confirmed
termination, not independent native-close evidence; `complete` is likewise derived from its safety bits.
Qualify this ownership/teardown argument and forced-termination recovery on each deployed Node patch
before enabling the exception. A different native adapter requires its own proof; no blanket opt-in.

Registered leases/providers remain independent: forced termination can skip their close hooks. A host
exposing `close()` registers a lease and can be ineligible despite SQLite closure. Rejected close/termination,
missing proof/ID, unbalanced resources or quarantine forbids recovery; retain safety records/drain ownership.

## Fixed cooldown, allowance and persistence

Initially use one fixed 1,000-ms cooldown after confirmed disposal and at most two expedited recoveries
per existing ledger domain/window; the next cutoff is terminal. Consume one allowance when recovery is
approved, even if later authority expiry prevents reopening. Renewing or replacing pump IDs within the
same process/window cannot reset the shared allowance or bypass a pending cooldown. Open failures stay
terminal. A new quota window starts a fresh allowance; carry any unexpired cooldown into its ledger.

Use exactly the current `domainOf(p)` key: `JSON.stringify([resolve(p.options.path),
p.options.readSet[0].ownerId, p.options.host.moduleUrl])`; its ledger key is `JSON.stringify([domain,
window.id])`. Store allowance with that process-owned ledger, retain it through the window, and retire
it with the ledger. This is a resolved-path key, not an inode/physical-store circuit identity. Keep the
existing consistent-path host ownership contract and physical-identity exclusive-writer checks unchanged.
The cooldown gates all intents/selections in that domain; another intent cannot open around it.

The breaker is process-local. A process restart resets the recovery allowance; this is acceptable because
restart is rare, costs more than a recovery and never refunds usage. Cross-process usage persistence stays
mandatory: restore cumulative `usedItems`/`usedMs` floors, including uncertain reservations, before admission.
Floors do not transport circuits. Cross-process breaker persistence is deferred hardening requiring a
defined host restore/persist interface, ordering, retention and unknown-history policy.

Use scheduler eligibility times, not sleeping Workers. Skip cooling lanes without reserving, preserve
relative round-robin order among eligible lanes, and use a positive timer when all are cooling. Keep
`N*S + Q <= 5000`, actual observation deadlines and minimum spacing. A cutoff is no epoch observation:
never reset its deadline; count cadence misses and recover them nonterminally as today. Disposal can
still delay other lanes. Qualify their actual gaps, disposal/open tails and capacity before enablement.

Graduated backoff, per-lane consecutive limits, cross-window/process circuits and extra phase diagnostics
are optional later hardening, outside the reduced estimate; the shared allowance bounds initial retries.

## Reservations and forward progress

The full admitted `maxItems`/`maxMs` stays charged in the captured ledger's `items`/`ms` and may exhaust
its window. Disposal, partial counters, checkpoint deltas or lost replies authorize no refund/transfer.
Export charges before ledger retirement; renewal/restart must preserve cumulative usage floors.

Reserve every successor's full available quantum before drain/open/dispatch. Every call receives fresh
parent-stamped service control within remaining budget/window/grant expiry; never extend an old cutoff.
Successful settled calls alone get existing validated attempt-count and rounded elapsed refunds.
Elapsed includes disposal/opening, SQLite recovery, inspection and delivery. The roughly 286-ms fresh-open
p95 on a native qualification host was outside measured refresh time, not free pump time or a tail bound.
Keep open inside the reserved turn; an opening/overhead cutoff before refresh remains terminal and charged.
Retain the failed reservation for disposal beyond cutoff; quota milliseconds do not bound cleanup latency.

Retain committed progress; never synthesize a successful empty checkpoint. Require real work or legitimate
empty-page phase advancement. Sufficient capacity and finite stalls below the allowance permit publication;
a breaker ends the run. Arbitrary finite stalls, continuous writes or oversized items give no such guarantee.

## SQLite recovery and durable resume

The successor's lexical refresh must reach writable `connection(true)` before any final status
observation. Do not insert a read-only status preflight before writable hot-journal recovery.
Recovery and durable-state inspection use SQLite only, never raw file-descriptor access.

Sidecar `write()` wraps rows/statistics/signed progress in `BEGIN IMMEDIATE`/`COMMIT`. Cooperative errors
roll back; a killed Worker need not run JavaScript rollback. DELETE can leave a hot journal: SQLite,
driven by the next writable open/first access under recovery locks, restores pre-transaction pages before
serving data. A protected journal is allowed; a read-only probe's recovery refusal must not automatically
prevent the writable opener. Read-only requests unable to recover may refuse meanwhile.
See [SQLite atomic recovery](https://www.sqlite.org/atomiccommit.html).

WAL recovery reconstructs the WAL index as needed and ignores frames beyond the last valid commit;
committed frames remain valid without checkpointing. Preserve protected-file/identity/journal checks.
Never unlink journals, truncate WAL, copy SHM, force checkpointing or change journal mode to retry.
A refused/busy/corrupt writable recovery fails normally and is terminal.
See [SQLite WAL recovery](https://www.sqlite.org/walformat.html#recovery).

SQLite supplies atomicity; HMAC validation authenticates the recovered complete state. Revalidate format,
physical/store identity, HMAC/domain, access, fences and generation lineage; never use in-memory cursors.
With unchanged bindings, the last signed checkpoint remains valid and resumable, or a newer complete
checkpoint committed before exit is found. Changed bindings follow existing abandon/rebuild rules.
Publication/certificate/pointer are all old or all new, including a lost commit reply. Partial batches
are never visible as committed work. Valid progress does not certify current canonical freshness.

When B1 integrates, preserve authenticated exact-provenance artifacts across retargets and its atomic
replacement/map/statistics/checkpoint boundary. Restart incomplete comparisons as full coherent passes;
reobserve metadata/dependencies/lineage before reuse. Retarget earns no coverage credit; closed E and
its witness retain identity/time. This remains a future compatibility requirement.

## Lifecycle, capacity and minimal diagnostics

Renewal extends future authority only: no charge erasure, cooldown shortening or stopped-pump revival.
`budget_exhausted`/`renewal_expired` prevent dispatch and retain existing completion/continuous-renewal
observation rules; disposal stays supervised. Pump/supervisor close and restore/erasure admission close
cancel recovery timers and await all native drains. Backoff is not quiescence; late callbacks cannot reopen.
Keep the process-wide 256-live-record limit, including pump/resident/operation records; no alternate
registry bypasses it. Export diagnostics before acknowledging completed IDs, never pending/failed records.
Capacity refusal is terminal without spinning; retain verified proof before history eviction/acknowledgment.

Minimal fixed numeric private diagnostics: process-wide operation ordinal, lane/quantum/resident counters,
triggering cutoff enum, charged items/ms, disposal wait/outcome enum, allowance count and cooldown deadline.
Use one process-wide monotonically increasing safe-integer operation ordinal shared with stall markers,
unique across all pumps; refuse expedited recovery if uniqueness cannot be maintained. Keep bounded
counters/latest snapshots with fixed absent-value sentinels, no history buffer or paths/content/credentials/
owner/window strings/raw cleanup IDs. Markers never grant eligibility, disposal proof or usage refunds.
Public DTO shapes/serializer remain unchanged; extra phase diagnostics are deferred.

## Staged acceptance and estimate

Current acceptance, runnable now with fixture extensions: deterministic
parent/reader deadline races, late replies/commits, request/open exclusions, gated/failed termination,
unbalanced resources, failed-drain public `reader_failed`, late successful drain then ordinary renewal.
Assert writer handoff, invalidated shared intents, preserved scheduler baselines/cursor/spacing, cooldown
fairness/misses, allowance across same-process IDs, reset on process restart with usage floors retained,
window rollover, quota/expiry/close/restore/erasure cancellation and 256-record pressure. Native DELETE/WAL
barrier-driven kills before/after batch, verification and publication COMMIT must compare recovered
rows/checkpoint/pointer with an independent atomic old-or-new oracle. Adapt the existing crash harness
to product tables/phases; add finite-stall progress and persistent-stall breaker tests. Timing campaigns
measure real disposal/open tails and other lanes' gaps per deployed Node patch; p95 alone is insufficient.

B1 integration acceptance, required when B1 exists: authenticated artifact reuse and retarget recovery,
incomplete comparison restart, atomic replacement/map/checkpoint and lost-commit outcomes. These cases
are outside this delta's current acceptance and estimate; do not block current recovery on absent B1 code.

Estimate: 150–250 runtime lines; 450–800 total, comprising runtime 150–250, current deterministic/native
fixture/tests 225–400, and contract/docs 75–150. Covers the private eligibility bridge, resident close/drain
reuse, cache invalidation, fixed cooldown/shared allowance, scheduler preservation and minimal unique
attribution. Assumes existing lifecycle proof and crash-harness adaptation; excludes B1, broader circuits,
new native proof machinery, host persistence interfaces and extended diagnostics. This revision edits no
code/schema/API and changes no request authority/safety, semantic scheduling or runtime bundle inventory.

## Rule summary (10 lines)

1. Only privately attested lexical pump refresh cutoffs qualify.
2. Keep the pump; close/drain the affected resident and reject late replies.
3. Require Worker exit, qualified native disposal, balanced resources and writer release.
4. Failed/uncertain drain makes public completion reader_failed; retain cutoff privately.
5. Keep the full failed reservation in its original window; reserve successors again.
6. Use fixed shared-domain cooldown and a process-local domain/window allowance.
7. Carry observation baselines and round-robin position into the existing scheduler.
8. Recover through writable SQLite first, then validate complete signed durable state.
9. Late proof cannot revive expedited recovery; ordinary renewal after safe drain remains.
10. Expiry/exhaustion/close/drains forbid dispatch; request and semantic behavior stay unchanged.

## Accounting argument per fix A invariant

| Invariant | Preservation argument |
| --- | --- |
| Full unknown reservation | Captured window/domain retains failed items/ms, including across restart usage restoration. |
| Known-usage refunds only | Only successful validated usage refunds; disposal or checkpoint inspection proves no usage. |
| Five-second cadence | Preserve admission, real observations, spacing/cursor and nonterminal misses; cooldown invents no observation. |
| Reserve before dispatch | Successor reserves before open/recovery; skipped cooling lanes reserve nothing. |
| Per-call service scope | Fresh bounded control within grant/budget/expiry; no old call extension. |
| Exclusive writer | Qualified native exit plus complete records and writer release precede replacement open. |
| No empty successful checkpoint | Cutoff remains failure; real work or legitimate phase advancement remains required. |
| Forward progress | Resume committed work; sufficient capacity/stalls below breaker allow progress, never unconditional liveness. |

## Review answers and remaining qualification

Timing: the proposed proof wait, fixed cooldown and allowance are experimental defaults, not qualified
bounds. Open p95 establishes no tail budget; measure disposal tails and other lanes' observation gaps.
Native closure: qualify the checked Node teardown chain per deployed patch and require host settlement.
Persistence/join: usage floors stay mandatory, breakers process-local; the process-wide ordinal is unique.
Remaining enablement question: which deployed Node patch/host combinations pass those native recovery,
resource-balance and observation-gap campaigns with the proposed constants? Record evidence before enabling.
