# Bounded commit batching in lexical maintenance

Design delta against `50877b4e`; documentation only, not an implementation or
qualification result. Verification batching is primary; comparison coalescing
and GC batching are independently optional follow-ups. Keep publication separate.
Do not change public APIs, schema, semantic maintenance, reader-pool admission,
authority, writer ownership, cutoff eligibility or journal deployment defaults.

## Amendments and evidence

Amend [incremental catch-up §5](context-read-incremental-catchup.md#5-retarget-reuse-closure-and-crash-safety-under-continuous-writes),
specifically its logical replacement/checkpoint recovery boundary at
`docs/plans/context-read-incremental-catchup.md:1293` and durable-boundary table
at `:1324`: the atomic unit may contain several bounded preparation chunks.
Intermediate chunks are tentative, not durable checkpoints or coverage credit.
Its closure, captured-E witness, publication and artifact-provenance rules remain.

Amend [SQLite recovery and durable resume](context-read-maintenance-cutoff.md#sqlite-recovery-and-durable-resume),
`docs/plans/context-read-maintenance-cutoff.md:119`: rows, verification state and
signed progress commit per bounded transaction, not necessarily per page.
At `:132`, recovery chooses the previous or complete new batch checkpoint;
replay may cover more chunks. Writable-first recovery and validation are unchanged.

Evidence E is the supplied, unpublished commit-cost breakdown against `88d168f8`:
an initial certification used **451 commits, including 350 verification commits**;
a retarget comparison pass used **58 commits**. These are structural probe counts,
not one-second throughput measurements or checked-in qualification evidence.
The fixture shape and text recipe are reproducible from
`tools/testing/context-product-freshness.diagnostic.mjs:14` and its seeding loop.
GC currently commits each **128-row** deletion slice
(`core/context-product-sidecar.mjs:599`); verification commits each chunk at `:779`.
The reported baseline was DELETE/FULL; keep FULL in this delta.

**Hypothesis:** grouping chunks reduces repeated commit barriers and checkpoint
writes, increasing useful progress per quantum and shortening convergence.
Neither the counts nor this proposal establish sync attribution or a speedup.

## Admission and batch bounds

Use the existing operation clock. Let `start` be refresh entry, and define
`D = min(cutoff, start + maxMs)`, retaining earlier authority/window deadlines
(`core/context-product-sidecar.mjs:869`). Opening and dispatch are not free time.
Keep `R0 = max(50 ms, min(250 ms, 0.15 * maxMs))`, sourced from
`core/context-product-quantum.mjs:4`, inside the existing quantum reservation.
Reserve `R >= R0` for rechecks, signing/save, COMMIT and final observation/delivery.
The adaptive reserve is call-local: initialize `R = R0`; raise only between transactions
to `min(D - start, max(R, 2 * H, F(firstUnit)))`. H is the largest observed finalization cost plus
estimated remaining delivery cost. Doubling follows `core/context-product-quantum.mjs:15`;
tail adaptation is a proposal. Never lower R or resize an open batch retroactively.
Its cap is D-start; if that cannot cover R0/useful work, do not begin a batch. Reset next call; no native-I/O guarantee.

Candidate policy P below is a **new, unqualified design choice**, not measurement.
Freeze it before qualification; use private finite limits, not new public knobs.

| Bound | Candidate P | Meaning |
| --- | --- | --- |
| Chunks per transaction | 8 | Ceiling on existing bounded chunks/slices. |
| Rows per transaction | 1,024 | Charge materialized/reset rows, lookups and completion records. |
| Logical bytes per transaction | 1 MiB | UTF-8 payload plus staged logical mutations/checkpoint data. |
| Active batch work | 100 ms | Cooperative ceiling before final save/commit; excludes reserved tail. |
| Reclamation duty interval | 8 eligible owner refreshes | Maximum deferral while reclamation debt exists. |

Logical bytes are an admission bound, not exact dirty-page or filesystem bytes.
Ordinary work keeps Fix A's predicate unchanged (`core/context-product-quantum.mjs:10`).
Also require row/byte bounds and `now + estimatedCost < min(batchStart + T, D - R)` before each unit; T is P's work ceiling.
Before adding a unit require `F(prospectivePrefix) <= R`; otherwise finalize the existing prefix.
Count all native work, including rows fetched but not consumed and repeated reads;
do not replace existing accounting with a count of completed logical chunks.
Use bounded length metadata and smaller fetch prefixes to enforce byte limits
before materializing payloads. Do not enlarge existing native query limits.
Stop adding work at the first bound; finish the admitted atomic unit, then save.
If a valid indivisible unit cannot fit P, choose the existing bounded unbatched
path before beginning the batch; retain its original item limits and accounting.
Do not reject previously valid items merely for exceeding a batching target,
or repeatedly yield at the same cursor without attempting that fallback.
An unexpectedly slow indivisible call can still reach the genuine cutoff.

## Verification transaction

Load and authenticate the durable generation/checkpoint before constructing a
tentative copy of all verification state. Never mutate the retained resume state
through aliases to a tentative hash, cursor, counts or reset-progress object.
Admission must cover a useful first unit and the reserved commit tail before
`BEGIN IMMEDIATE`. Recheck after lock acquisition; roll back if no unit fits.

Run several existing bounded verification chunks inside that transaction,
preserving document, reset, posting, statistics and referential-audit ordering.
The existing chunk bounds are at `core/context-product-sidecar.mjs:425`;
bounded prefixes may be smaller when a transaction limit would otherwise fail.
`verified_df`, reset cursor/completion, manifest hash state, counts, scan cursor,
phase and generation incarnation must describe the same completed prefix.
At a soft bound, atomically save that state, signed progress and work ownership,
then execute the transaction's COMMIT. Advance the checkpoint once per committed
batch, not once per tentative chunk; it remains a resume identity, not a percentage.
Do not defer the entire verification pass until publication or keep progress
only in Worker memory between calls. Publication retains its atomic certificate,
generation, sequence and pointer transaction and its existing admission checks.

Finalization spends the reserve: require real progress, valid target/access/fences and
`now < D && F(prefix) <= D - now`. F conservatively estimates remaining rechecks, save, COMMIT and
observation/delivery. Do **not** call ordinary work `admit()` or add R again; recheck remaining cost before COMMIT.
A preparation-fence change invalidates the whole batch, including counters. Future
closed-E compatibility still does not require E to become the newest epoch.
No canonical read transaction spans a sidecar COMMIT or await; release all native
iterators before commit. Never carry a write transaction across calls or awaits,
or intentionally past cutoff. An in-flight native COMMIT may finish during drain;
its outcome is resolved through SQLite, never retained for the next call to use.

| Outcome | Required action |
| --- | --- |
| Soft row/byte/time limit, useful work, bindings valid | Save and commit the complete prefix within the reserved tail. |
| Prospective next unit would leave insufficient tail | Do not admit it; finalize the smaller completed prefix if F fits. If F no longer fits, roll back the whole open batch to the last durable checkpoint; never just move its cursor backward. |
| No useful unit and no legitimate phase advance | Roll back; do not increment/sign an empty successful checkpoint. |
| Fence race before COMMIT or known rollback-safe failure | Roll back the whole open batch; discard tentative objects and reload the previous durable checkpoint before replay. |
| Genuine deadline/cutoff | Cooperatively roll back when possible; retain terminal failure and full reservation. Disposal/recovery resolves any uncertain native outcome. |
| COMMIT error, interruption or lost reply | Do not assume rollback; authenticated recovery chooses old or complete new state before replay. |

Retain every earlier committed batch. A rolled-back batch earns no durable work
or freshness credit, although its attempts remain charged. Fewer checkpoints
increase crash/race replay relative to page commits; that tradeoff is explicit.
Keep the private fence-change control flow and existing honest rebuilding/stale
outcome; do not relabel an ordinary retarget race as a storage error or cutoff.
After tail-shortage rollback, end the call. A clean pre-D yield may refund only validated
unused allowance; attempts and elapsed rollback stay charged (`docs/context-read-product.md:783`).
Failure, cutoff or uncertainty retains it all. Set a bounded lane/kind width cap to a single
existing chunk across calls/resident replacement; fresh lanes calibrate with a single chunk.
After shortage, widen only on explicit policy reset and successful calibration. These are
proposed backoff rules; work admission stays unchanged and arbitrary stalls promise no liveness.

## Optional comparison coalescing

Apply P and the same deadline, reserve, rollback and tentative-state rules to
several existing comparison pages. Keep bounded canonical snapshots and all
support/dependency reads; scan-page coalescing is not snapshot stitching.
Rows, replacements/removals, dictionary/posting contributions and comparison
cursor/phase commit together with signed progress. Repeat existing freshness
checks and reject the entire open batch on an in-batch canonical fence race.
Earlier durable batches survive; never retain a cursor past rolled-back rows.

Keep Card scans at their current **one-item** maximum and Memory scans at their
current **128-row** maximum (`core/context-product-sidecar.mjs:687`). Several
Card pages may share a transaction; this does not widen the expensive support scan.
An empty state tail counts as progress only when bounded discovery proves
exhaustion and advances the phase. Several such advances may share a checkpoint.
Repeatedly signing the same empty state is not work. Neither empty tails nor
retarget rebinding alone create certification, observation or coverage credit.
Preserve the existing new-tokenization item limit; reuse/copy comparisons still
consume rows/bytes/time even when they consume no transformation attempts.

## Optional GC and vacuum cadence

Combine eligible deletion slices under P; preserve their existing bounded SQL.
Recheck publication/work/base references, owner/intent retention, vector links
and applicable reader/audit pins inside the same write transaction before each
slice. A pre-transaction candidate hint never authorizes deletion. Keep replayable
deletion order and canonical suppression/provenance evidence outside GC's scope.

Maintain bounded owner-local reclamation debt: pending garbage, freelist bytes
and eligible-call age. On reopening, recompute bounded SQLite metadata and mark
unknown age due; process restart must not postpone reclamation indefinitely.
Under P, offer a GC batch before corpus work whenever debt is due, and never
defer a pending debt beyond the duty interval of admitted owner turns.
At that boundary, prioritize reclamation over new sidecar allocation. If quotas
or disposal prevent admission, retain debt; do not bypass quota or retention.
Implementation must freeze a finite allocation/debt high-water limit before
enablement; at that limit, refuse further allocation through the existing
storage/capacity failure policy until safe reclamation is possible.

Vacuum only with positive freelist debt, outside the comparison/verification
transaction, after admission with its own tail reserve. Offer at most one vacuum
per refresh and make it due by P's duty interval; idle time may service it earlier.
Keep the existing **32-page** invocation bound
(`core/context-product-sidecar.mjs:609`). Record effective implicit vacuum writes
separately from explicit write() commits. Space debt is not permission to force
checkpointing, change journal mode, unlink companions or reclaim pinned data.

## Invariants retained

| Rule | Preservation requirement |
| --- | --- |
| Fix A admission and cadence | Keep `N = 2 * activeSelections`, `S = max(pollMs, Q)` and `N*S + Q <= 5000 ms`, including actual observation deadlines (`docs/context-read-product.md:563`). Batches do not invent observations or shorten spacing. |
| Nonterminal cadence misses | Record misses and continue while authority/quota remain; no terminal conversion merely because a timer or observation is late (`docs/context-read-product.md:586`). |
| Reservations/refunds | Reserve full items/time before opening/dispatch. Refund only validated known usage after successful settlement; rollback attempts remain charged. Failure, crash, uncertain COMMIT/reply and cutoff keep the full reservation (`docs/context-read-product.md:783`). |
| Genuine cutoff | Keep terminal `read_timeout` and supervised drain. Only the existing qualified, privately attested exception can alter pump continuation; it remains disabled here (`docs/context-read-product.md:745`, `:752`). |
| Service scope/writer | Use fresh per-call service control; never extend authority or retain a transaction across calls. Hold the exclusive writer claim through confirmed graceful/forced disposal, balanced resources and quarantine resolution (`docs/context-read-product.md:729`). Reader-pool prewarming grants no maintenance capability. |
| No empty successful checkpoint | Require actual verification/reset/comparison work or proved phase advancement. Allocation, rebinding, polling, re-signing or a diagnostic increment alone does not qualify (`docs/plans/context-read-maintenance-cutoff.md:109`). |
| Forward progress | Commit a useful admitted prefix or use the bounded unbatched fallback. Resume authenticated durable progress after faults; finite capacity and suitable stalls are prerequisites, not an unconditional convergence promise. |
| B1 retarget/byte safety | Authenticate work, base and full bindings; retain exact provenance, BINARY ordering, round-trip ID checks and the byte-safety marker. Restart verification on contribution change, retain it after a complete unchanged comparison, and abandon invalid/access-changed work (`docs/context-read-product.md:333`). |
| Durability | Keep FULL on writable sidecar connections, including initialization/reopen. Do not add `synchronous=NORMAL`, change canonical durability or switch journal modes per quantum. |

Real work includes processing a newly admitted verification tuple, advancing a
bounded reset range, reconciling a compared identity, or proving an empty stream
exhausted. Resetting values already zero can still advance the authenticated
reset cursor. It excludes a scan stopped before processing or proving exhaustion.
Preserve the first-row admission/Fix A behavior without letting a batching limit
manufacture a successful checkpoint or turn a genuine cutoff into a soft yield.

Keep `commitSumMs`/`commitMaxMs` measured around **each actual COMMIT**, including
lock wait and sync, as defined in `docs/context-read-product.md:624`.
Keep per-unit scan/item/verification counters even when chunks share a commit.
Add private fixed, saturating per-kind attempted/successful COMMIT counts and
rollback counts for verification, comparison, publication, selection/setup and GC.
Document whether a counter records COMMIT entry or return; unknown outcomes stay
unknown. Preserve operation ordinals, stall steps and cutoff-lost-sample markers.
Do not combine overlapping attribution intervals as disjoint total time.

Preserve initiating failure cause/stage/step/ordinal before rollback/unwinding;
rollback, disposal or proof failures remain secondary. Do not overwrite native
errors with a batching label or inspect arbitrary exception properties under a
SQLite lock. Existing sanitized failure families and public mappings remain
unchanged (`docs/context-read-product.md:671`). Diagnostics never prove usage,
disposal, authority, eligibility or successful COMMIT.

## Recovery and acceptance

Required implementation acceptance, not tests performed for this documentation:

- Under DELETE/FULL and WAL/FULL, SIGKILL a dedicated maintenance process at
  barriers before and after every batched COMMIT kind; include mid-write/cache
  spill and native-COMMIT interruption. A killed Worker need not run JS rollback.
- Use an independent oracle with separately captured old and expected new rows,
  contributions, reset/counters/hash/cursors, signed bindings and pointer/certificate.
  Recovery must equal old or complete new state, never mixed state. The oracle
  must not derive its expected result from the batching loop or its counters.
  Use deterministic unit schedules to fix the expected prefix and independently
  authenticate its records; do not require random certificate IDs to match.
- Exercise lost replies after durable commit and interruption before commit,
  including publication. Do not blindly reapply work because acknowledgment was lost.
- Reach writable recovery before final status inspection; await writer disposal
  and release before successor open. Validate physical/store identity, format,
  HMAC/domain, access, fences, lineage and byte safety after SQLite recovery.
- Replay with unchanged bindings, retargeted bindings and a contribution change;
  compare batched and unbatched builds against the same captured canonical state.
  Preserve current format-3 restart points below; do not add full preparation restarts.
  Require equal manifests, counts, documents/postings/statistics and lexical
  results/scores/order; physical layout and checkpoint ordinals may differ.
- Cover row/byte/time edges, oversized-unit fallback, zero-work scans, reset-only
  chunks, empty Card tails, fence races, retained earlier batches, GC pins/debt,
  grace/forced disposal, lost samples, failure causes, refunds and nonterminal misses.
  Include tail spending despite rejected work admission, reserve cap/reset, prefix commit/rollback, and backoff across calls/resident replacement.
  Keep the cutoff exception disabled in normal cells; test its existing seam only.

## Quiet-window protocol

Use paired DELETE/FULL and WAL/FULL cells, each with batching off/on; isolate the
primary change before enabling optional comparison or GC batching. Verify actual
per-connection PRAGMAs. WAL remains a persistent deployment opt-in for readers
and maintainers; no recovery retry changes mode. Restore identical canonical
fixtures through SQLite APIs, prebuild both intents, fix reader/pool activity,
budgets and writer schedule, and counterbalance repeated pairs.
Use the profile definitions and schedule in
`tools/testing/context-product-freshness.diagnostic.mjs:13` and `:101` as sources;
include a fixed target and continuous writes. Freeze all settings before runs.

Record revision/runtime/SQLite compile options, OS/filesystem/storage, load and
all journal/sync/page/cache/auto-vacuum/auto-checkpoint settings. Per quantum log
dispatch ordinal/lane/sequence, per-kind transactions, committed versus attempted
rows/bytes/chunks, existing attribution fields, before/after checkpoint and phase,
reuse/copy/tokenization/removal, retarget/restart counts, cadence gaps/misses,
cutoffs/stalls/failure causes, reservations/refunds and missing returned samples.
Record open/recovery, refresh, delivery, close/disposal, WAL growth/checkpoint and
vacuum costs, plus write acknowledgment to ready-and-findable and convergence.
Judge complete lifecycle cost and useful committed progress, not commit share alone.

Run external syscall tracing separately from untraced timing runs; collect
database/journal/WAL write bytes/pages, sync calls/durations, lock waits,
checkpoint and truncate activity. Never open in-process raw descriptors on SQLite
files. Serialized page-image differences are not physical write-volume evidence.
Do not call `wal_checkpoint` as passive observation or omit final-close WAL work.
Any throughput, latency or convergence improvement remains **hypothesis** until
the paired measurements and correctness acceptance support that claim.

## Estimate and conflicts

Planning estimates from the supplied commit-cost option table, including runtime,
focused tests and docs: primary verification **250–500 LOC**; optional comparison
**450–900 LOC**; optional GC/vacuum **120–300 LOC**. These are not measured diffs
or delivery promises. Re-estimate shared infrastructure rather than blindly adding
the ranges. Journal-default changes and durability relaxation are outside scope.

Baseline conflicts/interpretations; line references are against `50877b4e`:

- `docs/plans/context-read-maintenance-cutoff.md:19` describes keeping the pump
  alive on eligible cutoff without the current enablement gate. Read it subject
  to `docs/context-read-product.md:752`: the exception stays disabled; batching
  adds no qualification, public override or eligibility evidence.
- `docs/plans/context-read-maintenance-cutoff.md:139` and `:175` mix present/future scope.
  Current format-3 preserves B1 retarget/artifact reuse and lost-commit recovery; production closure/witnesses remain B4 (`docs/plans/context-read-incremental-catchup.md:1780`).
- `docs/plans/context-read-incremental-catchup.md:110` describes abandonment on
  target mismatch; it is historical motivation, superseded for authenticated
  UTF-8 preparation by `docs/context-read-product.md:333`, not batching behavior.
- **Current format-3 behavior:** after a crash, authenticate the checkpoint and resume its
  preparation cursor with unchanged bindings (`core/context-product-sidecar.mjs:675`). Changed
  fences reset comparison phase/cursor, retaining authenticated artifacts (`:677`). Preserve
  these restart points and access/invalid-work/verification rules (`docs/context-read-product.md:333`).
- **Future compatibility:** `docs/plans/context-read-incremental-catchup.md:1333` stays intact:
  “Any incomplete comparison restarts as a full comparison, with sealed artifacts still reusable.”
  This covers any incomplete comparison, not only closure; B4 acceptance must address it.
- **Open conflict for the coordinating owner:** that rule and `docs/plans/context-read-maintenance-cutoff.md:140`
  conflict with current B1 cursor resume after a halfway-comparison crash; this delta amends neither rule nor owner policy.
