# Fresh context reader open cost

Status: diagnostic and design proposal; no reader optimization is implemented. Two non-author reviews of this
note are required before implementing a fix. Q1 remains the full fresh `open → fetchCandidateEvidence → close`
p95 ≤150 ms. Keeping an authority-bearing reader alive between HTTP requests is excluded.

## Method and limits

The report-only tool is `tools/testing/context-product-open.diagnostic.mjs`. Run it through the heavy-work
queue on the selected Node patch:

```sh
cairn-heavy node tools/testing/run.mjs --script tools/testing/context-product-open.diagnostic.mjs --samples 40
```

`--smoke` uses two samples and tiny synthetic stores; it is a functional check. `--profile
memory18|mixed16|all` selects the requested synthetic fixture shape. The full shapes are 1,112 Memories / one
namespace / schema 18 / DELETE, and 1,640 Memories + 26 Cards / 16 namespaces / schema 23 / DELETE. Both
current/history product projections are prebuilt before measurement. Fetch uses 24 full refs, including two
Cards in the mixed profile. Every sample receives a new credential binding, reservation, supervisor and
reader. The fetch and awaited close are included; fixture/prebuild work is excluded.

Each profile/control family has a separate measuring process. Cold is its first reader/Worker
(n=1; p50=p95=max); warm is 39 later *fresh* Workers. Quantiles use nearest rank; OS caches are not
flushed. The bare control contains only the timestamp harness and Worker transport import. The static-graph
control evaluates the Worker's exact static imports, mechanically derived from source, plus that harness.
Neither control executes bootstrap or opens a database file.

The measured host is WSL2 and is not quiet. These numbers attribute work; they are not Q1 timing evidence, a
regression threshold, a throughput result or a platform qualification. Samples are sequential, controls follow
readers, and load can differ by family. Do not subtract independent phase p95 values to claim a lifecycle p95.

## Measured attribution

One Node 22.16.0 run, 2026-10-29T10:22:53.422Z to 2026-10-29T10:25:15.619Z; 40 samples per family/profile.
Milliseconds below: cold cells equal p50 = p95 = max (n=1); warm cells show p50 / p95 / max (n=39). Overall
load average (1/5/15 min): 8.03 / 9.12 / 9.21 → 7.24 / 8.31 / 8.88. memory18 reader-process load: 7.42 / 8.69
/ 9.05 → 7.42 / 8.69 / 9.05. mixed16 reader-process load: 7.26 / 8.33 / 8.89 → 7.24 / 8.31 / 8.88.

| Phase | Memory18 cold | Memory18 warm | Mixed16 cold | Mixed16 warm |
| --- | ---: | ---: | ---: | ---: |
| Parent validation + issuance | 0.968 | 0.141 / 0.236 / 0.250 | 1.192 | 0.242 / 0.372 / 0.432 |
| Parent dispatch | 0.655 | 0.186 / 0.336 / 0.347 | 0.913 | 0.333 / 0.679 / 0.975 |
| Worker start + static graph | 36.306 | 33.859 / 38.426 / 42.129 | 33.743 | 33.753 / 36.670 / 36.764 |
| Worker setup + record verification | 0.791 | 0.776 / 1.021 / 1.061 | 0.996 | 0.973 / 1.135 / 1.175 |
| Dynamic database import | 8.600 | 8.396 / 11.088 / 11.530 | 7.830 | 8.258 / 9.402 / 10.184 |
| File identity | 0.058 | 0.056 / 0.082 / 0.180 | 0.048 | 0.053 / 0.077 / 0.087 |
| Identity/ack IPC round trip | 0.497 | 0.310 / 0.540 / 0.547 | 0.453 | 0.314 / 0.462 / 0.496 |
| Host import | 0.499 | 0.480 / 0.673 / 0.712 | 0.436 | 0.479 / 0.666 / 0.813 |
| Host construction | 0.076 | 0.076 / 0.116 / 0.120 | 0.101 | 0.078 / 0.180 / 0.204 |
| Facade import | 15.251 | 14.269 / 17.424 / 17.905 | 14.238 | 14.372 / 15.445 / 15.745 |
| Canonical preflight / journal child | 18.067 | 17.744 / 19.909 / 21.972 | 18.077 | 17.978 / 19.841 / 20.649 |
| Canonical native open | 0.132 | 0.089 / 0.113 / 0.122 | 0.112 | 0.082 / 0.141 / 0.180 |
| Canonical configuration | 0.228 | 0.194 / 0.417 / 0.482 | 0.247 | 0.191 / 0.323 / 0.335 |
| Product layout attestation | 2.925 | 2.963 / 3.442 / 3.819 | 3.586 | 3.476 / 4.246 / 4.279 |
| Other canonical validation | 0.951 | 0.734 / 1.023 / 1.504 | 0.630 | 0.658 / 0.847 / 0.899 |
| Facade initialization | 0.564 | 0.582 / 0.796 / 0.912 | 0.822 | 0.809 / 0.915 / 1.001 |
| Product index import | 3.714 | 3.919 / 5.119 / 5.941 | 3.878 | 3.877 / 4.246 / 4.267 |
| Product index construction | 0.152 | 0.165 / 0.262 / 0.305 | 0.154 | 0.158 / 0.219 / 0.263 |
| Open result IPC | 0.174 | 0.143 / 0.199 / 0.210 | 0.161 | 0.141 / 0.188 / 0.198 |
| Open wall total | 91.335 | 86.888 / 101.434 / 102.049 | 88.261 | 86.927 / 93.183 / 93.754 |
| Fetch parent dispatch | 0.525 | 0.330 / 0.498 / 0.620 | 0.723 | 0.397 / 0.598 / 0.624 |
| Fetch dispatch IPC | 0.227 | 0.248 / 0.375 / 0.428 | 0.232 | 0.249 / 0.364 / 0.438 |
| Fetch Worker execution | 8.371 | 8.589 / 9.835 / 11.678 | 10.590 | 10.507 / 11.522 / 12.192 |
| Fetch response IPC | 0.236 | 0.201 / 0.268 / 0.287 | 0.254 | 0.210 / 0.306 / 0.324 |
| Fetch wall total | 12.527 | 10.295 / 11.966 / 13.841 | 14.217 | 12.260 / 13.578 / 14.297 |
| Close dispatch | 0.100 | 0.065 / 0.109 / 0.163 | 0.097 | 0.062 / 0.100 / 0.103 |
| Close disposal | 0.292 | 0.265 / 0.413 / 0.618 | 0.342 | 0.379 / 0.702 / 0.718 |
| Close Worker exit | 2.013 | 1.660 / 2.510 / 4.697 | 1.826 | 1.678 / 3.040 / 4.681 |
| Close wall total | 2.639 | 2.088 / 2.921 / 5.112 | 2.499 | 2.197 / 3.987 / 5.174 |
| Lifecycle wall total | 106.501 | 98.757 / 114.618 / 116.544 | 104.977 | 101.658 / 108.251 / 110.748 |
| Bare Worker control | 18.641 | 17.549 / 20.652 / 21.025 | 17.082 | 16.421 / 17.461 / 17.763 |
| Static-graph-only control | 42.057 | 34.056 / 40.825 / 41.569 | 37.514 | 34.638 / 40.432 / 40.908 |
| Sidecar open / attest / checks | Not executed | Not executed | Not executed | Not executed |

All 80 reader samples have all 45 numeric fields; each nonoverlapping open/fetch/close partition sums to its
marked total. The tool prints the remaining small marker/acceptance spans, overlapping subtotals and each
control family’s load averages.

This WSL2 run did not reproduce the reported native-host lifecycle p95 of 255–332 ms. Its warm lifecycle p95
is 114.6 / 108.3 ms. Isolate/module loading is about 70% of open time here; the journal safety child costs
about 18 ms, metadata validation about 4 ms, and sidecar attestation is absent.

## What the intervals mean

The Worker timestamp is its first body statement after ESM static evaluation. `new Worker` through that
statement includes isolate startup, scheduling and the complete static import graph; it is not an `online`
event approximation. Parent validation/issuance ends after the request binding has been checked. Parent
dispatch includes bounded transport checks, reservation CAS, registry registration, listener/timer setup and
the remaining work before construction. Worker verification includes its setup, record equality, deadline and
issuance checks. The dynamic database import links `node:sqlite` and the database import graph. File identity
is the safe metadata preflight; identity IPC includes the parent registry bind, ack delivery and Worker-side
record verification. Host import and `createContextReadHost` are separate request-time costs. Facade/index
imports are distinct from facade/index construction.

Canonical preflight includes auxiliary-file refusal and the independent SQLite journal-mode child. This child
is required by the existing DELETE path: an in-process raw file open/close or nolock SQLite probe can drop
POSIX locks held by another connection. This diagnostic does neither. Native canonical open, configuration,
product layout attestation, other seek validation and facade initialization are measured independently.
Product layout timing includes entry to its validation transaction. The initialization interval includes the
subsequent cached journal guard.

`productSidecar` is deliberately lazy: construction opens no sidecar connection. Its `connection`, `attest`,
lifecycle lock and integrity checks do not execute during open or canonical evidence fetch, even with a
prebuilt sidecar present. Their opening cost in this lifecycle is therefore **not executed**, not an
unmeasured positive cost or proof that a later search is free. The index-open interval measures object
construction only. Search/status/maintenance have their own authorized sidecar opening costs.

Read timing separates parent validation/dispatch, request IPC, Worker execution, response preparation,
response IPC and parent acceptance. Close separates dispatch, disposal, Worker exit and parent registry
delivery. Worker execution includes the unchanged entry/final authority samples. External wall timings include
Promise settlement and caller continuation; internal phase totals end at their marked acceptance boundaries.
Subtotals overlap their component rows and must not be added to those rows.

## Diagnostic implementation boundary

Timing is internal and enabled only by `diagnostics:true`. A fixed shared buffer holds monotonic timestamps,
without file names, content, credential material, request IDs, owner IDs or unbounded history. The internal
reader module exposes immutable numeric snapshots through a WeakMap, following the existing maintenance
diagnostic pattern. Neither handles, method DTOs, supervisor DTOs nor serialized results gain fields. There
are no new clock reads, timing buffers or Worker timing transport when off. Markers do not change deadlines,
transactions, authorization or cleanup order. The single-sample slots describe the latest fetch, not an
operation event log. Failed/incomplete intervals are omitted, never converted to a zero-duration success. The
reporting tool fails on functional errors rather than dropping bad samples.

## Candidate fixes, ranked

| Rank | Candidate | Expected gain | Risk and scope |
| --- | --- | --- | --- |
| 1 | Prewarm a bounded pool of single-use Workers and audited modules | Paired warm saving p50 60.4–60.6 ms; p95 64.5–71.0 ms | Moderate lifecycle work; keeps request-time DB validation intact |
| 2 | Cache validation under proven unchanged file identity and state | About 22–25 ms if both journal probe and layout checks can safely be skipped; layout alone about 4 ms | Higher storage-safety risk; dev/inode alone is insufficient |
| 3 | Defer index module import/construction for canonical fetch | About 4–5 ms | Small change, but alone leaves startup and canonical preflight |
| 4 | Reduce graceful-close overhead | Entire close is only 2.9–4.0 ms at warm p95 | Small ceiling; forced termination can lose disposal evidence |

The second candidate must distinguish immutable layout attestation from mutable journal policy, store
generation and publication/authority checks. A dev/inode cache survives in-place writes and restore; it cannot
establish safety. At minimum it needs a bounded fingerprint with size/mtime/ctime at nanosecond resolution,
schema/version/store identity checked in a consistent snapshot, explicit restore/erasure invalidation and
before/after replacement detection. It must preserve missing/unsafe-file and WAL/auxiliary refusal precedence.
The existing journal cache is Worker-local; a new Worker does not inherit it. A cross-Worker cache requires an
independently reviewed ownership/proof protocol.

The third candidate cannot defer canonical validation until after data is read. Lazy sidecar acquisition
already exists, so adding it again yields no saving. Deferring index import can be independently useful for
canonical-only readers, but it moves cost to the first search/status operation and needs error-order tests.
Close must still await real native disposal, external leases/providers and exit. Returning before that work
completes would merely remove work from the metric.

## Recommended smallest targeted change

Prototype an opt-in, service-owned pool of **single-use** prewarmed Workers. Preload the audited static graph,
database library, facade and index modules. Retain the host module import and all authority/file-dependent
work at bootstrap. Never return an assigned Worker to the ready pool, including after failed opening.
Terminate every assigned Worker at reader close using the existing disposal path. Start with at most two ready
Workers and one refill in flight, configurable internally; do not invent an unbounded HTTP queue or resize on
each request.

For each warm sample, subtract only Worker-start/static-graph, database-import, facade-import and index-import
intervals from that sample’s observed lifecycle; then take quantiles. Paired removable p95 is 71.0 / 64.5 ms
and idealized remaining lifecycle p95 is 43.6 / 45.2 ms. Adding an **assumed**, unmeasured 5–15 ms handoff
budget suggests about 49–60 ms ready-hit p95 on this host, below 150 ms. This is a counterfactual, not a pool
implementation result.

The affected native-host p95 needs a 105–182 ms reduction to reach 150 ms. This run does not demonstrate that
absolute saving there, and percentages must not be scaled across hosts as proof. The recommendation is the
largest measured removable phase class with unchanged storage policy. Both non-author reviews should require
the same attribution on the affected native host before approving implementation; deployment qualification
must then measure the complete hit/miss mixture. No further timing campaign was run here.

Keep the DELETE journal child and canonical validation in the first prototype. If request-time residual p95
still exceeds 150 ms on the qualification host, stop and review the next smallest change; do not silently add
a validation cache. Pool misses use the existing cold path immediately within the original cutoff. A ready-hit
ratio below 95% can leave cold opens in the lifecycle p95 tail. Prewarming moves CPU work ahead of requests;
it does not remove that CPU work. Capacity, refill CPU and arrival bursts therefore need qualification
together.

## Authority and supervision contract

One HTTP request remains exactly one reader lifetime for authority. Before bootstrap a parked Worker may hold
audited module code, immutable module constants and a private readiness/control port. It holds **no
credential, binding, reservation, request IDs, readSet, owner selection or host configuration**. It may link
`node:sqlite`; it may not open **any database file** before issuance is verified. It does not preflight,
attest, prepare statements, or cache content. It must not import a caller-selected host module before
authenticated bootstrap. Keep the existing empty Worker environment and execArgv isolation.

Authentication/ACL selection still precedes open. Admission clocks still start before parent option
validation. The parent checks requestControl and issuance, bounds bootstrap, consumes the same single-use
requestReservation with CAS, and registers the opening resource before transferring authority to a Worker.
Pool selection occurs only after those steps, inside the existing dispatch path. The Worker accepts exactly
one bootstrap and repeats record/issuance/cutoff checks before file identity, host construction or any SQLite
open. Identity must still bind in the registry and receive its ack before connection open. No handoff resets
admitted time, credential expiry, operation cutoff or epoch.

The process-wide supervisor registry keeps its 256-live-record limit, including opening reader records and
in-flight operation records; maintainers share it. An active reader plus one read can occupy two records; the
pool creates no quota. Duplicate request/handle/binding reservations remain until their existing cutoff. After
registration, opening failure still returns its cleanupId and is drained by that ID. No slot is retried with a
consumed reservation or recycled after partial bootstrap.

Parked Workers have no normal request record because they have no path or request. They need a separately
bounded, service-owned idle-resource ledger and awaited shutdown; their count cannot be hidden inside
completed request history. The owning supervisor's private close path must stop and await that ledger; no
parked/loading Worker may outlive `supervisor.close()`. `drain(cleanupId)` retains its existing
assigned-record meaning, with no invented request record. Assignment transfers exactly one parked resource
into one registered reader. Pending/failed native or external disposal keeps the existing safety quarantine.
Worker termination alone does not prove outer leases/providers released. Failed safety records do not expire
or release capacity; operator recovery still requires the existing disposal proof. Cleanup history caps and
TTL stay unchanged.

## Failures, drains and accounting

Pool exhaustion takes the normal cold path, without extending deadlines or waiting indefinitely. No ready
Worker means no special authority exception. A warm crash before assignment is reaped and refilled under the
service owner. A crash after assignment fails that request and follows its cleanupId/drain path. Refill needs
startup deadlines, error/exit observers and bounded backoff; a live thread or readiness percentage alone is
not evidence that loading is progressing. Service shutdown closes admissions/refill first, reaps
parked/loading Workers, then awaits all registered readers and external-resource delivery promises. Repeated
shutdown must be idempotent; failed cleanup remains visible to its owner.

Before restore or erasure, deny admission and publish revocation, stop the pool and pump, and drain all
registered clients plus every idle/loading Worker. Invalidate old bindings and cached certificates through the
existing integration. Resume only with the new store generation and fresh request issuance. Although parked
Workers have no storage/authority, reaping them makes the drain boundary explicit and avoids imports from an
obsolete deployment surviving it.

Retain the current 192 MiB old-generation limit per Worker; it is not an RSS cap. Two parked Workers plus one
refill can reserve up to three such heap ceilings, in addition to admitted readers, native memory, code and
host resources. Measure actual idle RSS, startup CPU, file descriptors and refill rate before choosing a
deployment default. Bound ready + loading count, total assigned work, refill concurrency and any waiters
separately; preserve the 256 registry limit. Export aggregate hit/miss/startup-failure counts without
authority or content.

## Implementation size, tests and unchanged behavior

Estimate 250–400 implementation lines across pool ownership, one-shot bootstrap and native Worker handoff,
plus 300–500 lines of meaningful lifecycle/race tests. Allow roughly 2–4 engineering days plus both non-author
reviews and qualification. This is larger than an import deferral but avoids a storage-validation protocol.

Tests must cover no pre-bootstrap database/host access, duplicate bootstrap, issuance/reflection failures,
reservation reuse, current expiry while loading, abort at handoff, crash before/after assignment, pool
exhaustion and refill bounds. Exercise the 256-record ceiling across supervisors, cleanup IDs on failed open,
quarantine after uncertain disposal, leases/providers, shutdown/refill races, restore/erasure drain and never
reusing a Worker for a second credential. Keep full-ref/snapshot equivalence, two-sample authority behavior,
native telemetry, SQLite-free parent import and manifest-only installation tests on both Node patches.
Qualification must measure ready hits, misses and burst mixtures through close.

Evidence DTOs, credential expiry, publication/lineage/eligibility/suppression rules, sidecar refresh/retarget
behavior, pump admission/quantum settlement, WAL opt-in, reader deadlines, cleanup proof and Q1's 150 ms
lifecycle definition stay unchanged. No latency claim is established by this diagnostic, and no fix is
implemented here.
