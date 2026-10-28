# Product maintenance convergence diagnosis

Status: **blocked under the registered pump settings; returned for explicit review.**
Base: `be5698fa`, branch `fix/context-read-pump-convergence`. No runtime or
contract change, qualification run, benchmark, network access, key access,
workspace dependency installation or commit was made. The tests added here are executable
diagnostic counterexamples; their passing result means the failure was reproduced,
**not** that convergence or §10.4 has passed.

The stop condition in the task applies. Fixing only the fence exception would
leave a demonstrable >30-second maintenance gap, even after successful initial
builds and with an almost idle writer. A fence-race retry or checkpoint patch
must not be presented as resolving the registered F/A blocker. No host-visible
behavior changes, so the host guide needs no behavioral update.

## Inputs and the decisive configuration distinction

Read the qualification input package's preparation handoff, especially lines
11–37, its adapter and registration, and the actual session/writer implementation
in the separate qualification-input worktree. Those inputs are not added here.
The source references below for `evaluation/context-read-qualification/` and
`tools/testing/fixtures/context-product/v4-*` refer to that supplied worktree;
the `core/` references refer to this checkout. Paths are repository-relative.

The registered ordinary writer **alternates capture/review on a 20-ms cycle**,
fresh open/write/finally-close per operation. `v4-writer.mjs:76` selects the
operation, and `:83` subtracts actual work time from 20 ms before delaying.
It is nonsaturating, without backlog: slower operations reduce the attained
rate. `writerProfile.captureMs:25000` and `reviewMs:5000` are **operation
deadlines**, not intervals (`registration.engine.template.json:2256`,
`v4-writer.mjs:31`, `:46`). Target writes supplement ordinary writes (`:80`).

The registered pump has quantum 128 items/1,000 ms, budgets 1,024 items/8,000 ms,
poll 25 ms, renewal lifetime 10,000 ms and cron 60,000 ms
(`registration.engine.template.json:2267`). These are **cumulative minute-window
budgets in the actual integration**, not a fresh allowance each poll:
`v4-session-pump.mjs:18` computes the minute ID and `:19` its 60-second end;
`:28` renews only every `cronMs`. The rehearsal's larger allowances are
explicitly test-only and cannot demonstrate production convergence.

The 10-second renewal expiry cannot explain a rehearsal lasting only six
seconds, and that rehearsal used larger test-only quotas. Those are additional
production-registration blockers. The deterministic fence/retarget tests below
establish engine mechanisms consistent with the rehearsal's exported failure
and stale/rebuilding observations; they do not invent an internal trace for
the original session or claim that its four censored targets were re-observed.

## Deterministic reproduction

`core/test/context-read-maintenance-convergence.test.mjs` contains six tests:

The minimal fixture selects one namespace with both physical types and both
intents. This is an engine counterexample, not a replay of the four-namespace
qualification profile or its 100-target populations. Writes in one selected
namespace invalidate the entire exact projection; adding selected namespaces
cannot remove the quota/renewal gap or the need to transform the new rows.

1. At the storage `transformed` rendezvous, a fresh independent process performs
   a real native capture and closes. Refresh throws
   `index_unavailable/fence_changed`. The rendezvous requires a completed document
   first, so it cannot accidentally fire on an empty Card-state stream. The four
   preceding empty-stream checkpoints survive, but the staged generation has
   **zero documents and zero publications**: its completed Memory item rolled
   back before the Memory cursor advanced. Fresh status is stale,
   with null indexed counts. With no further writes, explicit refresh completes.
2. The actual product Worker is instrumented at its native staged-statistics
   statement to run that independent writer before the final in-batch fence
   check. The normal supervised pump, with the registered quantum and quotas,
   exports **failed/index_unavailable**, stops scheduling and drains. A fresh
   reader observes stale/fence_changed and refuses candidate search. Worker open
   is performed before the tested quantum to isolate the fence outcome from
   startup. Native method deadlines remain unchanged.
3. A 32-Memory base is published. Four successive independent captures, each
   followed by a one-item refresh, produce increasing generation sequences but
   repeatedly restart checkpoints at five (four empty Card-state streams plus
   the first Memory batch). Every new generation uses the **old publication**,
   never the previous work checkpoint, as its base. A fifth capture followed by
   an uninterrupted refresh reads **37 canonical metadata rows**, transforms
   **five** rows and verifies the full projection before becoming ready.
4. An independent capture at `precommit` leaves a complete captured certificate
   durably published but **stale**. Current counts remain null. A subsequent
   explicit catch-up restores readiness. This supplements the existing P2-21
   DELETE/WAL publication-race tests rather than changing their semantics.
5. Both mixed-type intents are genuinely prebuilt. A mock admission clock drives
   eight **successful no-op** native quanta at 25-ms intervals. At mock time
   **200 ms** the minute is exhausted (1,024 items/8,000 ms), with no timer left.
   At mock time **201 ms**, fresh independent processes capture/review a Memory
   and draft/confirm a Card. Fresh authorized reader handles observe both intents
   stale, null counts and refused searches at **10,000, 30,202 and 59,999 ms**.
   Same-window renewal cannot create more capacity. Only a new minute window
   admits catch-up; bounded additional quanta then make the reviewed/confirmed
   exact revisions searchable in all four type/intent lanes. This proves a
   scheduling counterexample, not a measured wall-clock latency. The capture's
   earlier history revision is not relabeled as its later reviewed revision.
6. With the entire quota still available, a timer delivered at the 10-second
   renewal cutoff refuses work and reports `renewal_expired`. A 60-second cron
   cannot keep a 10-second renewal continuously active.

The independent writer helper uses the native capture/confirm and Card
draft/confirm APIs, required decision review and synthetic model/receipts. It
opens and closes a core in each child and reports its resulting identity/revision.
Every child exit and termination signal is checked. SQLite owns all database
descriptors; neither helper opens raw file descriptors. The native Worker fixture
changes only test instrumentation, not engine SQL, locking or WAL policy.

Storage-only probes use a constant quantum clock, so verification progress does
not depend on machine speed. The pump probes use mock scheduling time and real
engine Workers/readers, not a performance benchmark. Recovery allows bounded
additional quanta because format 2 may honestly yield during verification;
finishing in exactly one quantum is not a test requirement. There is no timing
acceptance gate. All resources and child processes are drained before completion.

## Root causes and publication semantics

| Finding | Source | Consequence |
| --- | --- | --- |
| In-batch fence change is an exception | `core/context-product-sidecar.mjs:614`; transaction rollback at `:167` | The current batch's documents/postings/statistics roll back before the cursor/progress save at `:617`. Earlier committed batches survive physically, but the failed batch is not a resumable delta. |
| Every unsuccessful refresh is terminal to the pump | `core/context-product-pump.mjs:129`, `:131` | The index error becomes `error`; `stop()` cancels scheduling and drains at `:87`. Structured successful `rebuilding` already continues. The defect is not a failure to recognize that successful status. |
| Progress resumability requires current target equality | `core/context-product-sidecar.mjs:284`, `:288`, `:564` | Any canonical/dependency mismatch rejects the previous work checkpoint. No-op fence changes cause this too. |
| Retargeting restarts from the last publication | `core/context-product-sidecar.mjs:565`, `:571` | New generation, phase zero, empty scan cursor and fresh verification hash/counts. Committed but outdated work is not used as the catch-up base. |
| “Delta” is not O(changes) | `core/context-product-sidecar.mjs:328`, `:597`, `:608`, `:347`, `:364` | Keyset-scan every canonical row; reuse unchanged text identities from the published base, but copy their documents/postings and rebuild/verify whole-generation statistics and manifest. Transformation work can be O(changes); metadata, copying and deep verification are O(corpus + postings + dictionary). |
| Full reservations are never reconciled to known no-op usage | `core/context-product-pump.mjs:112`, `:114` | Eight no-ops consume the entire registered minute allowance. Restart/renewal preserves charges (`:62`, `:142`). This conservative crash accounting is intentional, but the host capacity assumption is wrong. |
| Scheduling spends the allowance immediately | `core/context-product-pump.mjs:102`, `:109` | Round-robin each 25 ms after short calls, then no more work until another admitted window. Polling does not mean sustained maintenance. |
| Renewal and cron have different lifetimes | `core/context-product-pump.mjs:78`, `:105`, `:145`; supplied `v4-session-pump.mjs:28` | Even with quota spare, maintenance loses renewal after 10 s unless the host renews sooner than the registered 60-second cron. |

An early fence change returns without throwing at
`core/context-product-sidecar.mjs:582` or `:623`; the public refresh then honestly
returns `rebuilding`. The more unfortunate race at `:614` throws instead;
`core/context-product-index.mjs:176` sanitizes that to its code. The pump cannot
distinguish this sanitized fence race from other `index_unavailable` causes.
Blindly ignoring every such error would also hide corruption/storage refusals.

Publication requires full verification **and** `fresh(t)` at
`core/context-product-sidecar.mjs:627`. If writes advance the fences between every
quantum of a multi-quantum build, the current algorithm cannot reach publication:
each next call restarts. “Writes faster than one quantum” does not by itself
mathematically forbid publication: a small projection may finish inside a quiet
inter-commit interval, and a commit after the last successful check may race the
sidecar commit. The latter installs a valid certificate for E, not a certificate
for E+1 (`:632`, `:635`, `:644`). There is no cross-database atomicity.

Readiness is correctly stricter. `recordBindings` compares canonical and
dependency fences (`core/context-product-sidecar.mjs:247`), and observation only
returns ready on a current match (`:302`). Refresh checks a **new** final canonical
snapshot (`core/context-product-index.mjs:142`); search first refuses a non-ready
observation (`:73`) and then checks fresh readiness and the publication again
before final delivery (`:55`). An intact E publication can therefore never make
a fresh E+1 reader accept stale or incomplete lexical statistics. These checks
must remain unchanged.

## Capacity estimate and why a runtime fix was stopped

These are deterministic arithmetic bounds, not measured host throughput:

* Reserved dispatches per minute:
  `min(floor(1024/128), floor(8000/1000)) = 8`, or four per intent.
  In the no-op mock-clock case, the inactive remainder is **59,800 ms**.
  A commit immediately after exhaustion has no possible maintenance completion
  for almost a minute. Renewing the same window, even every 10 s, does not help.
  One such release is sufficient to disprove an unconditional 30-second freshness
  guarantee; repeated same-phase releases make the p95 fail as well.
* Nominal ordinary traffic: `1000/20 = 50 operations/s`, half captures, hence
  **25 new Memories/s = 1,500/minute**. Actual fresh-operation throughput can be
  lower; this is the registered cadence's capacity scenario, not a claim that
  this shared machine sustained 50/s. Target additions only add work.
* Under the present separate intent transforms, even perfect coalescing of review
  updates needs at least two transformations per new Memory: **3,000/minute**.
  The optimistic upper bound is **512 new Memories/minute = 8.533 captures/s**,
  or **17.067 alternating ordinary operations/s**, with zero retries, no wasted
  quota, free metadata/copy/verification and all work fitting the time budget.
  At 25 captures/s the minimum backlog growth is **1,976 transform attempts/minute**.
* Even a future shared-transform architecture doing only one transformation per
  unique new capture would need **1,500/minute > 1,024/minute** at nominal cadence.
  Its necessary upper bound would be **17.067 captures/s**, or **34.133 alternating
  operations/s**. This is not an achieved sustainable rate. Existing reuse only
  applies to unchanged candidate identities, not arbitrary new input text.
* Independently of those item bounds, eight dispatches cannot give each of two
  projections a five-second observation sweep throughout a minute: that requires
  at least **24 projection observations/minute**. The contract limits that duty
  to active authority/quota, but exhausting quota does not exempt the §10.4 gates.
* With no intervening host renewal, the registered lifetime leaves **50 seconds
  per minute without renewal**, even if accounting is improved. No background
  indexing architecture can make a fresh post-write reader current while
  maintenance lacks authority to run.

There is therefore **no demonstrated positive sustained rate satisfying the
requested freshness/availability guarantees with these registered settings**.
For the current burst scheduler, the guaranteed all-phase rate is zero: even a
single ordinary mutation just after the burst can remain stale past 30 s. This
is a worst-case scheduling bound, not an empirical maximum or a claim that every
positive-rate run fails. The bounded functional counterexample above uses actual
Memory/Card operations and fresh readers, and establishes the gap without a
machine-speed assumption. A maximum attained physical write rate cannot honestly
be reported from these functional tests. No §10.4 qualification pass is claimed.

## Review proposal; no change implemented

The smallest first review is **host configuration and accounting**, preserving
the frozen readiness model: decide whether 1,024/8,000 was really intended per
minute; renew service ownership before 10 s rather than at 60 s; authorize enough
minute capacity and an evenly sustained observation schedule. With full quantum
reservations, nominal traffic alone needs at least **24** 128-item dispatches
per minute for separate intents (3,072 reserved items/24,000 reserved ms), or
**12** for an ideal shared-transform path (1,536/12,000). Neither number includes
verification, retries, target additions or spare throughput, so neither is a
sufficient production budget. Actual safe values need separate supervised
qualification. Do not slow the registered writer to hide failure.

Then implement and review narrowly separated engine changes: return an honest
rebuilding outcome for a recognized fence race, preserve useful completed
transformation work across retargeting, and replace the full-generation rescan/
copy/verification architecture with a bounded incremental design. Only fail the
pump for genuine service/storage/lifecycle errors. Proving reuse must include
eligibility/dependency/revision changes and deletions, authenticated checkpoint
state, full manifest consistency and both P2-09 and P2-21 races. Simply removing
`:614`, allowing stale progress to count as current, or updating a checkpoint's
fences without reconciling its content would falsely certify mixed-generation
data and is not an acceptable fix.

Changing these host settings is already expressible by §6.2, but it changes the
task's exact registered product facts and requires explicit product review. If
those facts are immovable, a semantic contract delta would have to define
snapshot/as-of-generation readiness and its staleness bound, then explicitly
revisit both §6.1.2 and §10.4's availability/freshness accounting. Merely renaming
stale to ready cannot preserve the present targets. No such delta is proposed
as an implementation here, and no stale/partial generation is served.

Because work stopped at this review boundary, there is **no convergence fix and
no new positive convergence regression claimed to fail main and pass a fix**.
The added tests intentionally diagnose current main, including its native
failure. The requested positive regression and registered-cadence proof remain
blocked rather than being replaced with a slower writer, a larger allowance,
relaxed fences or manufactured observations.

## Verification

The matrix resolves each named runtime and asserts its exact `--version` result
before dispatch. Each command uses `--test --test-reporter=tap
--test-concurrency=1` followed by explicit file arguments; the table abbreviates
those arrays with their source globs. Glob expansion was independently compared
with recursive directory enumeration and filename matching: **61 distinct required
paths, zero differences**. The new file belongs to the context prefix and is
also run separately. Child process return codes are captured directly; no test
status is inferred from a pipeline or the tail of output.

| File arguments after the Node test flags | Files | Node 22.16.0 exit / pass | Node 24.15.0 exit / pass |
| --- | ---: | --- | --- |
| `core/test/context-read*.test.mjs` | 35 | **0 / 706** | **0 / 706** |
| `core/test/topic-*.test.mjs` | 17 | **0 / 238** | **0 / 238** |
| `core/test/no-raw-db-fd.test.mjs core/test/sqlite-lock-safety.test.mjs core/test/sqlite-journal-probe.test.mjs` | 3 | **0 / 44** | **0 / 44** |
| `adapters/mcp/test/context-read*.test.mjs` | 5 | **0 / 88** | **0 / 88** |
| `packaging/test/topic-overview-raw29.test.mjs` | 1 | **0 / 3** | **0 / 3** |
| `core/test/context-read-maintenance-convergence.test.mjs` | 1 | **0 / 6** | **0 / 6** |

Runs are sequential, with each named Node binary's `bin` directory first in
`PATH`, and `npm_config_offline=true`, audit/fund disabled. The required packaging
test stages/installs its own built artifact in its disposable test workspace
using its existing explicit offline command. No checkout dependency or lockfile
changes are made. The normal test deadlines, native WAL policy, format-2 quantum
rules, raw-fd allowlist and frozen-v1 defaults remain unchanged.

Two initial targeted Node 22 fixture-development runs exited **1**. One assumed
the first Memory batch was checkpoint one instead of following the four empty
Card-state streams. The other assumed recovery always finished in exactly one
quantum per intent. Those assertions were corrected without extending any native
deadline or quota. Review also tightened the storage race to require an actual
completed document rather than an empty stream. The final standalone Node 22
and Node 24 runs include that correction and each exit **0**, six passing.
The earlier full Node 22 context run is complemented by its final affected-file
run; the full Node 24 context run also includes the tightened rendezvous.
All twelve final matrix commands exit **0**, with **zero failures, cancellations,
skips or todos**. The supervising matrix process itself exits **0**. Neither the
matrix nor any functional result is a timing/qualification pass.

### Changed files, independently cross-checked

`git diff --name-only -z HEAD` plus Git's nonignored untracked enumeration was
compared with an independent route: `git ls-tree -r -z HEAD`, direct Git blob-hash
recomputation for **2,461 tracked files**, and `rg --files --hidden` enumeration
for additions. Both inventories agree: **four files, zero differences**,
cross-check exit **0**. All tracked runtime/default/contract files are
byte-identical to HEAD. The delivery list is:

- `core/test/context-read-maintenance-convergence.test.mjs`
- `core/test/fixtures/context-maintenance-race-worker.mjs`
- `core/test/fixtures/context-maintenance-writer.mjs`
- `docs/plans/context-read-maintenance-convergence.md`

The inventory was re-derived after the report was finalized, again agreeing on
four files and zero differences. `git diff --check` exits **0**. Because all four
additions are untracked, a separate explicit content check also verifies their
trailing whitespace and final newlines: **four files, exit 0**. No running tests,
writers or task processes are handed off; all supervised verification completed.


## Fix A

The diagnosis above records the pre-fix behavior. This append implements only
the narrowly authorized engine corrections; it does not claim that the
registered workload passes §10.4. The contract, public status/error shapes,
format-2 schema, SQL, certificates, scoring and WAL/locking policies are unchanged.

### Changes and regression coverage

* The in-batch fence check uses a private identity-only rollback signal. Only
  that signal becomes successful progress; failures from checking fences,
  storage or rollback still propagate. Documents/postings/statistics and the
  cursor from the raced batch roll back together. Earlier committed documents
  and signed checkpoints survive. The ordinary refresh wrapper returns
  `rebuilding`; the pump keeps its existing successful-outcome scheduling path.
  No internal race reason crosses the public DTO boundary and no blanket
  `index_unavailable` retry is added.
* Every quantum reserves its full allowance before opening/dispatch. A
  successful settlement with a valid `progress.transformed` count reconciles
  that count and rounded-up parent elapsed milliseconds, including opening,
  disposal and result delivery. Transformed attempts that rolled back still
  count as work. Unknown/invalid usage, failed operations, timeout/crash or
  uncertain settlement keep their full reservations. Host usage floors remain
  monotonic through in-flight renewal. Process-ledger charges survive pump
  close/reopen, same-window renewal and selection changes; host persistence
  remains required for process replacement.
* Scheduling spaces admissions using nominal minute capacity, then advances
  them as necessary to meet deadlines from each projection's actual epoch
  observation. A full quantum reserves time for disposal/opening, dispatch and
  the next observation; intervening round-robin turns retain the poll/quantum
  minimum spacing. See the round-1 correction below: a nominal five-second
  admission sweep was insufficient. Pacing applies to the first quantum and
  uses the mock-clock seams. Both intents and projection fairness remain
  unchanged. No new configuration or contract field is introduced. An
  underfunded selection can still exhaust before the minute ends; scheduling
  does not manufacture capacity.

The six diagnosis tests now have these meanings:

1. The storage rendezvous race returns progress rather than throwing. A prior
   one-item quantum's actual document and checkpoint survive unchanged; the
   raced batch publishes nothing and fresh status remains stale until catch-up.
2. The actual Worker race exports successful `rebuilding`, leaves the pump
   active with another timer, and converges on the current projection after
   independent writes stop. Fresh readers still refuse the stale interval.
3. The retarget/full-corpus counterexample remains: four writes abandon staged
   checkpoints and catch-up scans 37 metadata rows for five transformations.
4. The precommit publication remains a valid captured certificate that fresh
   readers classify as stale; subsequent explicit catch-up restores readiness.
5. Eight native no-op quanta refund their unused reservations and leave
   same-window maintenance active. Subsequent independently captured/reviewed
   Memory and drafted/confirmed Card revisions converge in both intents.
6. The 10-second renewal still expires before a 60-second cron, even with the
   full budget spare. This is retained as a host configuration counterexample.

Additional pump regressions cover partial usage, opening time, missing/invalid
usage, failed/crashed/overrun settlement, charge preservation, host floors,
no-op observations throughout a mock minute, fully charged paced exhaustion,
and stop/drain on corruption (`index_unavailable`), authority, storage and
lifecycle refusals. These use mock time rather than wall-clock acceptance gates.
The existing independent logical manifest/scoring oracles, format-2 integrity,
WAL and lock-safety tests remain part of the required set.

### Remaining work for fix B and hosts

Fix B still owns reuse of completed transformations across retargeting and
incremental O(changes) catch-up. Fix A continues to restart from the last
publication after a target mismatch, scan/copy the whole selected corpus and
verify whole-generation statistics/manifests. It neither relabels stale work
nor weakens captured-generation certification. Sustained write workloads can
still prevent readiness; functional convergence after writes stop is not a
production freshness/availability qualification.

Hosts must keep renewal valid beyond the next cron and handoff, with a margin;
a 10-second grant renewed only every 60 seconds cannot do that. Since the
existing maximum renewal is 60 seconds, a 60-second cron needs additional
earlier/overlapping renewal or a shorter cadence, not an out-of-range lifetime.
Provide sufficient cumulative minute items/time for both intents and all active
selections. Eight full reservations cannot fund 24 minimum observations per
minute for two intents; refunds help only when actual usage is lower. Include
scan/verification/retry headroom and persist uncertain full reservations across
process replacement. The host guide now describes these requirements and pacing.
The 20-ms alternating writer workload remains an owner protocol/capacity decision;
no writer cadence, registration or qualification gate is changed here.


### Fix A initial verification receipts (before round 1)

Each exact Node binary's `--version` was asserted before dispatch. All commands
used `--test --test-reporter=tap --test-concurrency=1` with explicit file arrays;
the table abbreviates those arrays with globs. Glob expansion and independent
directory enumeration agree on **61 required paths**, inventory diff **exit 0**.
Runs were sequential with the named binary first in `PATH` and npm offline,
audit/fund disabled. No checkout dependency installation, external network,
provider/key access, qualification run, timing gate or commit was performed.
Every child return code was captured directly.

| File arguments after Node test flags | Files | Node 22.16.0 exit / pass | Node 24.15.0 exit / pass |
| --- | ---: | --- | --- |
| `core/test/context-read*.test.mjs` | 35 | **0 / 726** | **0 / 726** |
| `core/test/topic-*.test.mjs` | 17 | **0 / 238** | **0 / 238** |
| `core/test/no-raw-db-fd.test.mjs core/test/sqlite-lock-safety.test.mjs core/test/sqlite-journal-probe.test.mjs` | 3 | **0 / 44** | **0 / 44** |
| `adapters/mcp/test/context-read*.test.mjs` | 5 | **0 / 88** | **0 / 88** |
| `packaging/test/topic-overview-raw29.test.mjs` | 1 | **0 / 3** | **0 / 3** |
| `core/test/context-read-maintenance-convergence.test.mjs core/test/context-read-product-pump.test.mjs` | 2 | **0 / 50** | **0 / 50** |

All final required groups and focused runs have **zero failures, cancellations
and skips**. The union contains 1,099 required cases per runtime; the focused
50-case rerun is a subset, not 50 additional required cases.

The final focused tests were overlaid without runtime changes on an isolated
HEAD snapshot. On **both Node patches**, that baseline exits **1** with exactly
**10 expected failures**, 40 passes and zero cancellations/skips. Failures cover
the two fence regressions, native no-op same-window convergence, known/partial
usage refunds, no-op/full-usage pacing and continued successful scheduling with
reconciled quota. Supporting unknown/crash/error/floor checks preserve existing
behavior and pass the baseline. Separately, the updated existing
`changed canonical text between metadata and transformation` footprint case
exits **1** on that baseline on each patch; the fixed full group passes it.

An independent healthy-output comparison on each Node patch builds the same
canonical fixture with HEAD and Fix A, closes all cache connections before
swapping quiescent DELETE caches, then exercises actual delta catch-up from the
retained publications. Memory-only, Card-only and mixed selections, both
intents, ten queries, equal bodies and Chinese/Japanese/English text produce
**120 paired query outputs per runtime**, with manifests/counts and lexical
scores/order/refs compared byte-for-byte. Both comparisons exit **0**.

Delivery inventory uses `git diff --name-only -z HEAD` plus nonignored untracked
paths, independently checked against hashes/modes of **2,461 HEAD blobs** plus
`rg --files --hidden` enumeration. The routes agree on **9 delivery files**,
inventory diff **exit 0**, including both fixtures, three test files, two engine
files and both docs. Tracked diff whitespace and all four untracked text files
also pass checks with **exit 0**. All changes remain uncommitted for the primary.


### Fix A round 1: observation deadlines and latency headroom

This section records round 1. Its terminal handling of cadence misses is
superseded by round 2 below; the admission arithmetic and punctual bounded
cadence guarantees remain.

Both non-author reviews of `ca2540a4` found the same P1. With two selections
and both intents, a 1,000-ms poll and 100-ms quantum, the nominal 1,250-ms
spacing allowed variable opening latency to move observations from 1,260 to
6,310 ms (5,050 ms), or from 1,250 to 6,340 ms (5,090 ms). Punctual timers,
available quota and quanta individually within budget did not prevent this.
The old mock tests measured admission or assumed invariant latency.

The correction preserves §6.2 and the closed public DTOs:

* Entry to the fresh final Worker canonical snapshot read (§6.1.2) records
  a process-monotonic timestamp, before acquisition/native-read costs, epoch
  comparisons and delivery. This lower bound on the actual observation is
  conservative: native latency cannot postpone the next deadline.
  It travels beside the result on the internal operation-bound Worker frame;
  the reader validates that it lies within that operation and retains it in a
  private WeakMap. The public refresh result remains byte-identical. There is
  no host callback or await in the final canonical transaction.
* Let `N` be the number of projection/intent turns, `Q = quantum.maxMs` and
  `S = max(pollMs, Q)`. Admission now requires `N * S + Q <= 5000`.
  Otherwise `invalid_input` refuses before timers, handles or ledger charges.
  This follows the existing sweep admission rule, with explicit latency
  headroom; it requires no new public configuration or contract change.
* For each upcoming turn at round-robin distance `d`, its latest safe next
  admission is `lastActualObservation + 5000 - Q - d * S`. The next timer uses
  the earliest such deadline or the nominal paced admission, whichever is
  earlier, still bounded by authority and window expiry. This reserves a full
  quantum before the actual read and enough spacing for every intervening
  turn. Round-robin order is unchanged, with no priority starvation.
* Initial observation deadlines start at activation. Continuous renewal
  preserves them, including handoff exactly at an authority or minute-window
  boundary; an actual authority/quota gap starts a new duty interval.
  Missing timing, an unexpected quantum overrun or an observed cadence miss
  fails visibly with the existing `read_timeout`, stops and drains. Failed or
  uncertain work keeps its full reservation. A parent quantum timer exposes
  timeout even while disposal is pending; after disposal settles, no successor
  open/refresh is dispatched and the supervisor finishes the drain. Successful
  valid settlements keep the existing refunds, host floors and process-ledger
  persistence.

Admission refusal extends the existing §6.2 sweep check to include bounded
latency costs. Runtime failure also makes unexpected costs or delayed timers
honest; a shared host cannot guarantee punctual execution under arbitrary
stalls. Format 2,
SQL, certificates, authority checks, result payloads, WAL policy and fix B's
remaining scope are unchanged.

Thirteen new regressions cover the two exact reviewer scenarios, two further
variable disposal/dispatch/refresh/delivery scenarios, impossible headroom,
continuous authority/window handoffs, an unexpected >5-second refresh cost,
missing/future timing, overdue timer delivery, private native Worker timing,
and a pending disposal that outlasts its quantum. Mock observations are recorded
at the simulated epoch snapshot, separately from admission and result delivery.
Each cadence case visits every selection and intent three times, checks every
gap and initial sweep against 5,000 ms, and checks fairness, minimum admission
spacing and complete handle disposal. The
native timing assertion is a causal before/after check, not a performance
acceptance threshold. The existing native cutover fixture uses a 1,600-ms
rather than 2,500-ms quantum to leave the
now-required headroom; its corpus, authority and readiness assertions remain.


The scheduler preserves minimum spacing analytically: after an admission at
`t`, each unvisited turn's distance decreases by one, moving its latest safe
admission forward by `S`. The just-visited turn moves to distance `N-1` and
its observation is at or after `t`; admission's `N*S+Q <= 5000` constraint
therefore puts its next latest safe admission at or after `t+S` as well.
With punctual timers and each full quantum completing within `Q <= S`, the
next admission both fits every observation deadline and retains minimum
spacing. A late timer or unexpected cost is supervised and fails visibly
instead of silently extending the observation interval.

The timestamp brackets actual observation conservatively: if its read-entry
sample is `L` and snapshot acquisition is `A >= L`, reserving the full next
quantum ensures `next A <= L + 5000 <= A + 5000`. Sampling after the native
read instead could shift deadlines later by that read's variable latency.


A separate deterministic arithmetic check exercised 125,000 variable-cost
turns across admitted projection counts and poll/quantum bounds; every turn
kept both observation and spacing invariants (**exit 0**). This supplements
the engine regressions and is not a deployment timing measurement.


The existing renewal-expiry mock now makes its intended inactive gap explicit:
its short renewed authority expires before the synthetic jump to the next
minute. Leaving authority active across that unserviced jump would instead
be an overdue-observation failure; exact continuous handoff has separate
regressions and must preserve deadlines.


### Fix A round 1 verification receipts

Both exact Node binaries' `--version` outputs were asserted before dispatch.
Commands used the named binary with `--test --test-reporter=tap
--test-concurrency=1` and explicit file arrays; the table abbreviates those
arrays with globs. Glob expansion, independent directory enumeration and the
actual argument arrays agree on **61 required paths**, inventory diff **exit 0**.
Runs were sequential, with the matching binary first in `PATH`, npm offline,
audit/fund disabled. No checkout dependency installation, external network,
provider/key access, qualification run, timing benchmark or commit occurred.
Every test process exit below is its actual child return code.

| File arguments after Node test flags | Files | Node 22.16.0 exit / pass | Node 24.15.0 exit / pass |
| --- | ---: | --- | --- |
| `core/test/context-read*.test.mjs` | 35 | **0 / 739** | **0 / 739** |
| `core/test/topic-*.test.mjs` | 17 | **0 / 238** | **0 / 238** |
| `core/test/no-raw-db-fd.test.mjs core/test/sqlite-lock-safety.test.mjs core/test/sqlite-journal-probe.test.mjs` | 3 | **0 / 44** | **0 / 44** |
| `adapters/mcp/test/context-read*.test.mjs` | 5 | **0 / 88** | **0 / 88** |
| `packaging/test/topic-overview-raw29.test.mjs` | 1 | **0 / 3** | **0 / 3** |
| `core/test/context-read-maintenance-convergence.test.mjs core/test/context-read-product-pump.test.mjs` | 2 | **0 / 63** | **0 / 63** |

The final required union contains **1,112 passing cases per runtime**, with
zero failures, cancellations or skips. The focused 63-case rerun is a subset.
All six modified source/test hashes stayed unchanged across these final runs.

The final pump test file was overlaid on an isolated `git archive ca2540a4`
snapshot, with no runtime changes. On **both Node patches**, running
`--test --test-reporter=tap --test-concurrency=1 --test-name-pattern='Fix A1'
core/test/context-read-product-pump.test.mjs` exits **1**: **all 13 regressions
fail**, zero pass, zero cancellations/skips. The first two failures reproduce
the reviewers' exact 5,050-ms and 5,090-ms gaps. The failures also cover the
other variable-cost scenarios, impossible headroom, exact continuous handoff,
overrun/missing timing/late timer visibility, actual Worker timing transport,
and supervision of pending disposal. Final full and focused fixed runs pass
all 13 on each runtime.

Earlier nonzero development receipts are retained separately from the final
green runs: the initial Node 22 focused run exited **1** (57/58 passed; the
native fence-race wrapper had no result at its assertion), followed by its
isolated test exiting **0**. An early full Node 22 context group exited **1**
(738/739 passed) on the mock that kept authority active while jumping over
almost a minute of timer service; its diagnostic single-test run also exited
**1**. Making that test's intended inactive interval explicit yielded the final
739/739 and 63/63 runs above. The first Node 22 packaging run exited **1**
(2/3 passed): its layouts child hit the unchanged 30-second `spawnSync`
`ETIMEDOUT`. No packaging or runtime edits followed; the standalone group
rerun exited **0**, 3/3 passed. Node 24 packaging also exited **0**, 3/3 passed.
No required failure is omitted from the final accounting.

Delivery inventory uses `git diff --name-only -z HEAD` plus nonignored
untracked paths, independently compared with hashes/modes of **2,465 HEAD
blobs** and filesystem enumeration. The routes agree on these **8 files**,
inventory diff **exit 0**:

* `core/context-product-index.mjs`
* `core/context-product-pump.mjs`
* `core/context-product-reader.mjs`
* `core/context-product-worker.mjs`
* `core/test/context-read-maintenance-convergence.test.mjs`
* `core/test/context-read-product-pump.test.mjs`
* `docs/context-read-product.md`
* `docs/plans/context-read-maintenance-convergence.md`

Final tracked whitespace and unchanged source/test hash checks both exit
**0**. All test processes have completed; no unattended work remains. Changes
remain uncommitted for the primary.


### Fix A round 2: recoverable cadence misses continue maintenance

Both re-reviews of `f1282669` found that round 1 made a scheduling miss
terminal. With observations at 1,250, 2,500, 3,750 and 4,900 ms, delivering
the next timer at 6,251 ms stopped before dispatch with no usage and no timer.
The standards review also exercised 6,300 ms. A timer at 6,240 ms followed by
a successful 20-ms refresh stopped after the observation at 6,260 ms and
incorrectly retained its entire 1-item/100-ms reservation. Authority and quota
were still available in each case.

Cadence reporting is now independent of operation failure:

* Pre-dispatch, actual successful epoch observation and successful delivery
  check for missed projection deadlines without setting a terminal error.
  Each overdue projection interval counts once; later checks can increase its
  worst gap until a successful observation starts that lane's next interval.
  Duty is bounded by authority/window expiry. An inactive renewal resets lane
  deadlines and overdue flags, while cumulative diagnostics remain available.
* Every status/completion observation retains its exact closed public shape.
  A private WeakMap attaches an immutable, fixed-size diagnostic, retrieved
  internally with `maintenancePumpDiagnostic(status)`:
  `{cadenceMisses,worstGapMs,observation}`. The latest successful observation
  carries `{projection,atMonoMs,gapMs,cadenceMiss}`; before success it is null.
  This adds no public DTO field, public entry-point export, callback, event
  history, path, namespace or credential. Old snapshots retain their original
  diagnostic, including after subsequent recovery or shutdown.
* Maintenance continues on its existing fair round-robin path and replans
  from actual observation times. Recovery clamps overdue deadlines to the
  minimum admission spacing, avoiding immediate timer loops or burst dispatch.
  The round-1 headroom admission refusal and punctual bounded scheduling
  arithmetic remain intact. A missed target is reported honestly; continued
  maintenance does not retroactively satisfy that target.
* Successful late settlements reconcile known attempts and parent elapsed
  time exactly as punctual settlements do. The 20-ms case uses zero items
  and 20 ms after refund. Unknown, crashed and failed usage remains fully
  charged, and host floors and process-ledger persistence remain unchanged.
* Native operation timeouts, parent quantum cutoffs (including pending
  disposal/refresh), authority, storage, corruption and lifecycle failures
  still stop and drain. Invalid/missing private timing is a corrupt or
  uncertain result and reports existing `reader_failed`, rather than claiming
  an operation timeout. Actual quantum overruns retain `read_timeout` and
  their full reservations.

Seven round-2 regressions replace the terminal overdue-timer expectation and
add both late-timer reproductions, the late successful refresh, successful
delivery crossing other lanes' deadlines, and native/parent quantum cutoffs
after cadence recovery. The three reviewer reproductions check the exact
initial timestamps, continued timers and pending completion, known-usage
refunds, four-lane convergence without renewal, restored bounded observation
gaps, fairness and complete handle disposal. Diagnostics check miss counts,
worst gaps against independent observation arithmetic, observation attachment,
snapshot immutability and unchanged own keys/JSON. The first-sweep and delivery
cases check that repeated inspection of one overdue interval does not count
it repeatedly. Both cutoff cases verify terminal timeout, retained charge and
drain after an earlier recoverable miss. Round-1 punctual varying-latency,
configuration-refusal and timeout supervision coverage remains.

The host guide now distinguishes recoverable cadence diagnostics from genuine
operation failures. Hosts still own valid renewal, cumulative capacity,
supervision and timer delivery. Fix B's retarget reuse and O(changes) catch-up,
format-2 certification, SQL, public results, WAL policy and locking rules are
unchanged. These functional regressions introduce no qualification or timing
acceptance gate.

### Fix A round 2 verification receipts

The matrix asserts each exact runtime's `--version` and dispatches explicit
file arrays with `--test --test-reporter=tap --test-concurrency=1`. Glob
expansion and independent directory enumeration/filename matching agree on
**61 required files**, inventory comparison **exit 0**. Each child return code
is captured directly. Runs are sequential, with the matching runtime first in
`PATH` and npm offline, audit/fund disabled. No checkout dependency install,
network/provider/key access, qualification run, timing benchmark or commit is
part of this correction.

The final pump test file was overlaid on an isolated `git archive f1282669`
snapshot without changing its runtime. On **both Node 22.16.0 and 24.15.0**,
`--test --test-reporter=tap --test-concurrency=1 --test-name-pattern='Fix A2'
core/test/context-read-product-pump.test.mjs` exits **1** with **all seven
regressions failing**, zero passes, cancellations or skips. Every failure is
the old terminal `failed` state where continued `active` maintenance is
asserted; these are behavioral failures, not missing diagnostic imports.

Earlier nonzero receipts are retained: the initial filtered Node 22 development
run exited **1**, 30/33 passed, because three tests expected four missed lanes
instead of the one actually late lane. The remaining lanes recovered before
their deadlines; correcting those expectations required no pump change. The
subsequent full pump run exited **0**, 63/63 passed.

The initial full Node 22 context group exited **1**, 744/745 passed. The existing
native Worker fence-race fixture had no first result at its assertion, the same
intermittent symptom recorded in round 1. Its unchanged isolated rerun exited
**0**, 1/1 passed, and the unchanged focused convergence/pump group exited
**0**, 69/69 passed. No timeout, quantum, fixture, authority or readiness
assertion was relaxed. This initial failure remains separate from subsequent
full-group receipts. Live-log failure scanning was added to matrix supervision
after the failure was missed during initial progress inspection.


Final full-group and focused receipts (all commands retain the flags above):

| File arguments after Node test flags | Files | Node 22.16.0 exit / pass | Node 24.15.0 exit / pass |
| --- | ---: | --- | --- |
| `core/test/context-read*.test.mjs` | 35 | **0 / 745** | **0 / 745** |
| `core/test/topic-*.test.mjs` | 17 | **0 / 238** | **0 / 238** |
| `core/test/no-raw-db-fd.test.mjs core/test/sqlite-lock-safety.test.mjs core/test/sqlite-journal-probe.test.mjs` | 3 | **0 / 44** | **0 / 44** |
| `adapters/mcp/test/context-read*.test.mjs` | 5 | **0 / 88** | **0 / 88** |
| `packaging/test/topic-overview-raw29.test.mjs` | 1 | **0 / 3** | **0 / 3** |
| `core/test/context-read-maintenance-convergence.test.mjs core/test/context-read-product-pump.test.mjs` | 2 | **0 / 69** | **0 / 69** |

The unchanged Node 22 full context-group rerun exits **0**, 745/745 passed,
including the native race fixture. All final required groups on both runtimes
have zero failures, cancellations and skips: **1,118 required passing cases per
runtime**. The 69-case focused run is a subset, not additional required cases.
Both modified source/test hashes remained unchanged across the resumed matrix
and its final full-group rerun; the hash comparison exits **0**.

Delivery inventory compares `git diff --name-only -z HEAD` plus nonignored
untracked paths with independent hashes/modes of **2,465 HEAD blobs** and
filesystem enumeration. The routes agree on **4 changed files**, inventory
diff **exit 0**:

* `core/context-product-pump.mjs`
* `core/test/context-read-product-pump.test.mjs`
* `docs/context-read-product.md`
* `docs/plans/context-read-maintenance-convergence.md`

Final whitespace and inventory checks exit **0**. All test processes have
completed; no unattended work remains. Changes remain uncommitted for the
primary.
