# Confirmed-disposal maintenance cutoff delta

Design only, against fix A and B0; B1 recovery is a compatibility requirement, not implemented behavior.
Amends the [product cutoff rule](../context-read-product.md#cron-renewal-and-supervised-pump), preserving
[fix B crash safety](context-read-incremental-catchup.md#5-retarget-reuse-closure-and-crash-safety-under-continuous-writes).

On a native qualification host, the reserve covered ordinary overruns; rare discrete stalls reached
the hard cutoff and stopped the pump until renewal. This delta replaces that wait with one charged
quantum plus bounded recovery overhead; freshness and unchanged call cutoffs still require qualification.

## Eligibility and state transition

Only lexical `refreshContextIndex` calls dispatched by the owned lexical pump qualify. The parent must
retain an internal dispatch record binding pump epoch, lane ordinal, quantum sequence, resident epoch,
operation identity, reserved window/domain, and absolute cutoff. No caller-supplied flag grants
eligibility. An attested hard deadline firing during that refresh, or its matching internal deadline
failure, enters `cutoff_pending_disposal`. A bare `read_timeout` code is insufficient: missing/mismatched
identity or another failure remains terminal. Opening, status calls, independently opened maintainers,
reader operations, `fetchCandidateEvidence`, search/`findCandidates`, and `contextRead` stay terminal.
Semantic/embedding-enabled pumps, including their lexical turns, keep their current behavior; there is no
change to provider retries or USD accounting.

The call still settles `read_timeout` promptly. Detach it, discard late frames, terminate the affected
resident, and close admission to its writer domain before awaiting cleanup. The pump must not invoke
global `stop()` for an eligible cutoff until the recovery decision is made. It remains supervised, with
scheduling held while disposal is pending; no second dispatch overlaps the unsettled turn. After proof,
enter lane backoff, then ordinary scheduling. Public DTOs stay closed: an isolated recovered cutoff
leaves `active`, error null and completion pending. Private diagnostics expose the pending/recovery state
immediately. Failed proof or a confirmation deadline of 1,000 ms after cutoff takes today's terminal
`failed`/`read_timeout` stop-and-drain path; failed cleanup also retains its existing `reader_failed`
diagnostic. This deadline bounds the decision, not native cleanup.

## Disposal gate and ownership

Confirmation requires the resident resource cleanup record, plus the interrupted operation's cleanup
record, to finish under the existing lifecycle/supervisor: `state === 'complete'` and `workerStopped`,
`nativeDisposed`, `leasesReleased`, `providersSettled` all true. Await actual Worker exit/termination
completion and the resource delivery; operation settlement or an operation record alone proves neither
native disposal nor exclusive-writer release. All native SQLite connections/statements must be closed by
the existing disposal mechanism, and registered lease/provider acquisition and release counters must
balance. Forced termination does not run host close hooks; outstanding registered resources can therefore
make this gate fail. Such a host gains no automatic retry exception.

Release the maintenance-writer claim only after proof: no old writer can execute or commit after the
replacement opens. An executing commit may finish before exit; inspect durable state on recovery.
Remove the dead resident and invalidate every intent sharing it. Physical identity/selection exclusion
and quarantine still cover alternate paths and new pump IDs; a watchdog cannot release the writer.

Rejected terminate/close, missing/expired cleanup IDs, unbalanced resources, quarantine or late proof
never enable automatic retry. Preserve safety records and drain ownership; operator recovery is separate.
Diagnostic coverage cannot prove disposal or override a failed safety field.

## Reservations, cadence and reopen cost

Keep the captured original domain/window ledger's full admitted `maxItems`/`maxMs` in `items`/`ms` as
settled unknown usage, consuming that window's budget even after successful disposal or partial commits.
Never transfer it to a new window, erase it on renewal or refund checkpoint deltas/partial counters.
Export old-window charges before ledger retirement; host floors/restart persistence remain unchanged.

Every successor requires a new full available reservation before drain/open/dispatch; each call receives
a fresh parent-stamped service scope, shortened by remaining budget, window and authenticated expiry. No
retry extends old authority. Successful calls alone receive existing validated attempt-count/rounded
elapsed refunds. Elapsed includes drain, open, recovery reads and delivery. A fresh open measured about
286 ms p95 on a native qualification host, outside the measured refresh quantum; it must remain inside
the pump's reserved elapsed envelope. Do not add a free pre-open phase. If overhead consumes the envelope
before refresh dispatch, the opening/turn failure stays terminal with its full reservation. Disposal
beyond cutoff remains charged conservatively by the failed reservation; record actual excess wall time
separately. Quota milliseconds do not bound native cleanup latency, and this delta does not silently
enlarge that quota.

Keep fix A's admission inequality, 5,000-ms observation deadlines, minimum spacing and round-robin order.
A cutoff supplies no successful epoch observation and cannot reset its deadline. Count overdue intervals
and recover cadence exactly as today; a cadence miss alone remains nonterminal. Skip a cooling lane
without dispatch/reservation, visit other eligible lanes in order, and use a positive next-eligibility
timer if all cool. Never catch up with overlapping or burst retries.

## Bounded retry and forward progress

Proposed fixed initial policy: permit two recovered cutoffs per physical store/owner/host ledger domain
per quota window; the third is terminal. Also make the third consecutive cutoff on a lane terminal across
window boundaries. A lane is the normalized selection/types/intent, independent of resident/pump epoch.
Retain counters across same-process renewal/replacement IDs; persist circuit state with uncertain charges
across process replacement. Successful durable advancement or validated ready/no-work status resets the
lane streak, never the window count. An empty yield while work remains cannot reset it. Defaults require
qualification.

After confirmation, set reopen eligibility at least 1,000 ms later for the first recovery and 2,000 ms
for the second; ordinary scheduling may delay it further. Gate the writer domain so another intent
cannot bypass backoff. Other eligible domains keep turns; no Worker sleeps waiting. Recheck authority,
quota and supervisor capacity before reopening. Open failures are terminal. Qualify other lanes' actual
gaps including disposal and open cost; this policy bounds wasted opens, not native disposal latency.

Retain committed progress; never synthesize a successful empty checkpoint. Require advancement and
publication under finite injected stalls with sufficient authority/budget. A permanently over-budget
indivisible item must reach the breaker. Continuous writes or inadequate capacity can still prevent progress.

## Interrupted transactions and resume

`context-product-sidecar.mjs` writes with `BEGIN IMMEDIATE`/`COMMIT`; cooperative exceptions roll back,
but a killed Worker need not run JavaScript rollback. In DELETE mode it can leave a hot journal. On the
next authorized writable sidecar open/first access, SQLite obtains recovery locks and restores the
pre-transaction pages before serving data. The opener drives SQLite recovery; the pump does not delete a
journal or replay pages itself. A request read-only connection unable to recover may refuse until
writable recovery succeeds. See [SQLite atomic recovery](https://www.sqlite.org/atomiccommit.html).

In WAL mode uncommitted frames beyond the last valid commit are invisible; SQLite reconstructs the WAL
index if necessary and ignores that tail on recovery. Committed frames remain valid even before
checkpointing. Neither pump nor host truncates WAL, copies SHM, forces a checkpoint or changes journal
mode to retry. Existing protected-file, identity and journal admission checks still apply; a
busy/refused/corrupt recovery open fails normally and remains terminal. See [SQLite WAL
recovery](https://www.sqlite.org/walformat.html).

Each batch's rows, statistics and signed progress checkpoint commit atomically. Recovery sees the prior
complete checkpoint or a newer complete committed one, including a commit whose reply was lost.
Revalidate HMAC/domain, format, physical identity, access, fences and generation lineage before resuming;
never trust in-memory cursors. With unchanged bindings the last signed checkpoint remains valid and the
generation resumes. Changed bindings follow existing invalidation, abandon/rebuild rules; validity is not
an assertion of current canonical freshness. Publication/certificate/pointer are likewise all old or all
new; partial batches are never visible to readers or admitted as committed work by a successor.

B1 must preserve authenticated exact-provenance sealed artifacts across retargets and its atomic
replacement/map/statistics/checkpoint boundary. Restart incomplete comparisons as full coherent passes;
reobserve metadata, dependencies and lineage before reuse. Retargeting earns no coverage credit.
Closed E/witness keep their identity/time; never redate or certify mixed observations.

## Lifecycle, capacity and private diagnostics

Renewal may extend future authority while disposal/backoff proceeds, but cannot clear circuits, shorten
backoff, replace the captured ledger or resurrect a stopped pump. `budget_exhausted`/`renewal_expired`
prevent new dispatch and report through existing completion cycles; disposal remains supervised.
Expiry/boundary races use existing continuous-renewal observation rules, not an artificial observation.
Explicit pump/supervisor close, restore and erasure drains cancel pending reopen timers, close admission
first, then await all native drains. Late confirmation cannot reschedule after close. Restore/erasure
must not treat backoff as quiescence.

Keep the process-wide 256-live-record limit, including pump, resident and operation records; replacement
supervisors cannot bypass it. Export bounded diagnostics before acknowledging completed IDs; never
acknowledge pending/failed safety records. Capacity refusal is terminal without spinning. Retain the
verified disposal decision before acknowledgment/history eviction; an absent ID proves nothing.

Record a fixed numeric private snapshot per cutoff: lane/quantum/resident epoch, phase/cause enums,
cutoff and elapsed ms, reserved items/ms, disposal wait/ms and four proof bits, writer-release bit,
circuit counts, backoff ms, terminal/recovered enum and next-open elapsed ms when available. Fixed
sentinel values represent absent data. Keep bounded counters/latest values, not an unbounded event
buffer; exclude paths, owner/window strings, credentials, content and raw cleanup IDs from snapshots.
Join the separate stall-attribution marker with the same process-local numeric quantum/resident/operation
ordinal; map cleanup IDs privately only until delivery. Missing markers mean unknown attribution, never
retry eligibility or refund proof. Public status/error DTOs and serializer remain unchanged.

## Required tests and implementation estimate

Require deterministic timer/lifecycle tests for parent/Worker deadline races, late success/commit,
terminal request/open timeouts, delayed/failed disposal and unbalanced leases/providers. Assert no
replacement before writer release and no dispatch after close, expiry, quota exhaustion, restore or
erasure admission close. Exercise renewal/window rollover during cleanup with exact original-ledger
charges, host floors, successful-only refunds, both intents sharing a dead resident, backoff
fairness/cadence misses, repeated-cutoff circuits and 256-record pressure. Native DELETE/WAL kill tests
must interrupt batch, verification and publication before/after COMMIT; independently compare recovered
rows/checkpoint/pointer with an atomic old-or-new oracle, including B1 retarget and unknown commit
outcomes. Run finite-stall progress and persistent-stall breaker campaigns with real open/drain costs.
Inspect stalls exceeding proof deadline; do not silently tune them away.

Estimate 700–1,200 changed lines: 250–450 runtime/lifecycle diagnostics, 350–600 meaningful
deterministic/native tests, 100–150 contract/docs. Assumes reuse of existing disposal proof and kill
harness; new native proof machinery or B1 work requires a separate estimate. No code, schema, public API,
request semantics, authority sampling, safety predicates, semantic scheduling or bundle changes here.

## Rule summary (10 lines)

1. Only internally identified lexical pump refresh cutoffs qualify.
2. The interrupted call remains timed out and all late replies are discarded.
3. Worker exit, native closure, balanced resources and writer release are mandatory.
4. Uncertain, failed or late disposal keeps today's terminal stop and drain.
5. The original window retains the full failed item/time reservation.
6. A successor reserves again and receives a fresh bounded service scope.
7. SQLite recovers atomically; signed durable state decides resume or retarget.
8. Backoff and shared-domain/window plus lane circuits bound repeated cutoffs.
9. Cadence misses remain observable and nonterminal; no observation is invented.
10. Close, drains, exhaustion and expiry forbid reopening; requests stay terminal.

## Accounting argument per fix A invariant

| Invariant | Preservation argument |
| --- | --- |
| Full unknown reservation | Failed quantum stays in its captured domain/window `items`/`ms`; it consumes quota. |
| Known-usage refunds only | Only successful validated counts/elapsed settle refunds; disposal proves safety, not usage. |
| Five-second cadence | Keep actual observations, admission/spacing and miss recovery; cutoff/backoff never reset deadlines. |
| Reserve before dispatch | Every replacement turn reserves before any open/recovery work; cooling alone reserves nothing. |
| Per-call service scope | New control/operation/cutoff per call within existing grant, budget and expiry; no deadline extension. |
| Exclusive writer | Await resource and operation proof and writer release before opening; quarantine still blocks admission. |
| No empty successful checkpoint | Timeout stays failure; existing atomic nonempty-work/real-phase-progress admission remains required. |
| Forward progress | Resume last committed work; finite stalls permit progress, persistent stalls terminate at bounded circuits. |

## Open questions for reviewers

- Are the proposed proof wait, backoffs and recovery limits appropriate for shared-intent cadence/open tails?
- Does each supported native adapter's existing exit/disposal proof establish
  connection closure under forced termination, without relying on telemetry seals?
- Can the host persist circuits with uncertain usage, and can attribution supply the bounded numeric join?
