# Fresh context reader open cost

Status: design only; two non-author reviews required before implementation. Q1: fresh `open → fetch → close` p95 ≤150 ms,
where fetch is `fetchCandidateEvidence`. No authority-bearing reader may survive between HTTP requests.

## Method and limits

Run the report-only diagnostic through the heavy-work queue on the selected Node patch:

```sh
cairn-heavy node tools/testing/run.mjs --script tools/testing/context-product-open.diagnostic.mjs --samples 40
```

`--smoke` uses two tiny-store samples. `--profile memory18|mixed16|all` selects the full synthetic shapes: 1,112
Memories / one namespace / schema 18 / DELETE, or 1,640 Memories + 26 Cards / 16 namespaces / schema 23 / DELETE. Both
current/history projections are prebuilt. Fetch uses 24 full refs, including two Cards in mixed16. Each sample has a
fresh credential binding, reservation, supervisor and reader; fetch and awaited close count, fixture/prebuild work does
not. Each profile/control family runs in a separate process. Cold is its first reader/Worker (n=1; p50=p95=max); warm is
39 later fresh Workers. Quantiles use nearest rank; no OS cache flush. The bare control has only timestamp/transport
code; the static-graph control evaluates exactly the Worker's static imports derived from source. Neither control
bootstraps or opens a database.

The WSL2 machine was not quiet. These are attribution numbers, not Q1 evidence, a regression threshold or platform
qualification. Samples are sequential; controls follow readers and load differs by family. Never subtract independent
phase p95 values to claim a lifecycle p95.

## Measured attribution

One Node 22.16.0 run, 2026-10-29T10:22:53.422Z to 2026-10-29T10:25:15.619Z; 40 samples per family/profile. Milliseconds
below: cold cells equal p50 = p95 = max (n=1); warm cells show p50 / p95 / max (n=39). Overall load average (1/5/15
min): 8.03 / 9.12 / 9.21 → 7.24 / 8.31 / 8.88. memory18 reader-process load: 7.42 / 8.69 / 9.05 → 7.42 / 8.69 / 9.05.
mixed16 reader-process load: 7.26 / 8.33 / 8.89 → 7.24 / 8.31 / 8.88.

| Phase | Memory18 cold | Memory18 warm | Mixed16 cold | Mixed16 warm |
| --- | ---: | ---: | ---: | ---: |
| Parent validation + issuance | 0.968 | 0.141 / 0.236 / 0.250 | 1.192 | 0.242 / 0.372 / 0.432 |
| Parent dispatch | 0.655 | 0.186 / 0.336 / 0.347 | 0.913 | 0.333 / 0.679 / 0.975 |
| Worker start + static graph | 36.306 | 33.859 / 38.426 / 42.129 | 33.743 | 33.753 / 36.670 / 36.764 |
| Worker setup + record verification | 0.791 | 0.776 / 1.021 / 1.061 | 0.996 | 0.973 / 1.135 / 1.175 |
| Dynamic database import | 8.600 | 8.396 / 11.088 / 11.530 | 7.830 | 8.258 / 9.402 / 10.184 |
| File identity | 0.058 | 0.056 / 0.082 / 0.180 | 0.048 | 0.053 / 0.077 / 0.087 |
| Identity/ack IPC round trip | 0.497 | 0.310 / 0.540 / 0.547 | 0.453 | 0.314 / 0.462 / 0.496 |
| Host import: addon (a) + host graph (c) | 0.499 | 0.480 / 0.673 / 0.712 | 0.436 | 0.479 / 0.666 / 0.813 |
| Host construction: may contain ACL (b) | 0.076 | 0.076 / 0.116 / 0.120 | 0.101 | 0.078 / 0.180 / 0.204 |
| Facade import | 15.251 | 14.269 / 17.424 / 17.905 | 14.238 | 14.372 / 15.445 / 15.745 |
| Canonical preflight / journal child | 18.067 | 17.744 / 19.909 / 21.972 | 18.077 | 17.978 / 19.841 / 20.649 |
| Canonical native open | 0.132 | 0.089 / 0.113 / 0.122 | 0.112 | 0.082 / 0.141 / 0.180 |
| Canonical configuration | 0.228 | 0.194 / 0.417 / 0.482 | 0.247 | 0.191 / 0.323 / 0.335 |
| Product layout attestation | 2.925 | 2.963 / 3.442 / 3.819 | 3.586 | 3.476 / 4.246 / 4.279 |
| Other canonical validation | 0.951 | 0.734 / 1.023 / 1.504 | 0.630 | 0.658 / 0.847 / 0.899 |
| Facade initialization (historical boundary) | 0.564 | 0.582 / 0.796 / 0.912 | 0.822 | 0.809 / 0.915 / 1.001 |
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

The saved run has 45 numeric fields per reader: 41 phases plus four external wall times. Removing the adjacent-mark
`canonicalReturnMs` leaves 40 required phases plus four wall times; missing/nonfinite values now fail. `facadeInitializeMs` now starts at `canonicalValidated`;
`canonicalOpenTotalMs` ends there; the historical initialization row above retains its original boundary.
No historical values were recomputed. Every required field must be finite/nonnegative or the diagnostic fails.
All registered finalizers run despite rejection; work and cleanup failures are reported together.

These are source S: synthetic-host WSL2 measurements, with warm lifecycle p95 114.6 / 108.3 ms. Source R is the
separately reported native Linux qualification-host result: open about 245 ms (about 295 ms cold), fetch 6–24 ms and lifecycle p95
255–332 ms. Source P is the product team's pending metadata-only attribution of its actual host. These are three
separate sources; neither cross-host subtraction nor scaling proves a gain.

### Host-side costs and counter audit

The product reports three likely contributors: (a) loading a native SQLite addon on every fresh Worker, (b) a
per-request application-database ACL check with two queries, and (c) its host module's ESM graph. In the product host,
**host import** covers (a)+(c); **host construction** covers part or all of (b), depending on where the ACL check runs.
Import-time ACL work instead lands in host import and is never prewarmable authority. Source S has a tiny synthetic
graph and no application ACL: those rows are near zero and do not estimate source P. Fill in P's stages, their placement
and eligible code-only portion before choosing stage 2 host preloading. No product host was run or emulated here; no new
timing campaign accompanies this revision.

Fetch and find do not call `countTokens`: fetch dispatches to the facade (`core/context-product-worker.mjs:147`;
`core/context-read-facade.mjs:680`), while only `contextRead` enters assembly in lexical/semantic search
(`core/context-product-index.mjs:201`, `:291`). Open eagerly reads `host.counter` (`core/context-product-worker.mjs:95`)
and only its `id` (`core/context-product-index.mjs:380`); counting starts in assembly (`:129`;
`core/context-read-assembly.mjs:32`). A costly `host.counter` getter would still execute at open. The product reports a
conditional counter, attached only for authorized `contextRead`, with lazy encoder creation; fetch-only/find-only
Workers never load it. No tokenizer saving belongs in their fetch forecast.
The harness eagerly builds its encoder in `createCounter()` (`evaluation/context-read-qualification/counter.mjs:28`),
relevant only to hosts calling it at construction; this is an observation, not a measurement.
The diagnostic hardcodes its synthetic host, with no host-URL option.

## What the intervals mean

Worker start ends at the first body statement after ESM evaluation: isolate, scheduling and static imports count.
Parent issuance ends after binding checks; dispatch includes bounded transport, reservation CAS, registration and
listener/timer setup. Worker verification checks records, issuance and deadline. Database import links `node:sqlite`;
file identity is metadata preflight and identity/ack includes registry bind/verification. Host import/construction
and facade/index import/open are distinct intervals.

Canonical preflight includes auxiliary-file refusal and the independent SQLite journal-mode child. An in-process raw
file open/close or nolock SQLite probe can drop POSIX locks held by another connection; this diagnostic does neither.
Native open, configuration, layout attestation (including transaction entry), other validation and facade initialization
are separate. Initialization includes the subsequent cached journal guard.

The sidecar is already lazy: connection, attestation, lifecycle lock and integrity checks do not execute during open or
canonical fetch, even with a prebuilt sidecar. Index open measures object construction; later search, status and
maintenance have their own authorized sidecar costs.

Read separates parent dispatch, IPC, execution, preparation and acceptance; close separates dispatch, disposal, exit and
registry delivery. Execution includes unchanged entry/final authority samples. External wall times include Promise
settlement/caller continuation; internal totals stop at marked acceptance. Subtotals overlap their component rows and
must not be added to them.

## Diagnostic implementation boundary

Timing is internal, enabled only by `diagnostics:true`: fixed monotonic slots without paths, content or authority IDs.
A WeakMap exposes immutable numeric snapshots; public handles, DTOs and serialization gain nothing. Off means no clock
reads, buffer or transport. Markers preserve deadlines, transactions, authority and cleanup order. Slots hold the latest
fetch, not history; incomplete snapshots omit absent intervals, but the reporting tool rejects every incomplete sample.

## Candidate fixes and implementation order

| Order | Candidate and owner | Expected gain | Risk / decision boundary |
| --- | --- | --- | --- |
| 1 | Stage 1: engine-only single-use pool — engine | S: about 60–70 ms startup/import work | Moderate lifecycle work; host import stays after bootstrap and identity ack |
| 2 | Cheaper fresh ACL check or service-owned connection — product | Measured reduction in (b), unknown | Authority risk; no cross-request grant cache |
| 3 | Lazy index import/construction for canonical fetch — engine | S: about 4–5 ms on cold/fallback opens | Small ceiling but much lower safety burden than a validation cache; engine pool hits already preload index code |
| 4 | Stage 2: registered-host code preloading — engine; product audits/registers host | Only P's measured eligible host-import union | Separate later opt-in; justify with product attribution and audited side-effect-free import |
| 5 | Cross-Worker validation cache — engine | S: about 22–25 ms with journal probe; layout alone about 4 ms | High storage-safety burden; independent proof/review required |
| 6 | Cheaper close — engine | S: entire close warm p95 only 2.9–4.0 ms | Await real disposal/exit; no early success |

Product ACL options keep fresh checks inside each request's authority lifetime. A cheaper check must preserve scope,
revocation and currentness. A service-owned application connection needs request/transaction isolation, bounded
IPC/cancellation and shutdown; it must not share credentials or cached grants. The product decides after attribution.
The harness owns attribution/qualification and counter/registration hashes; no harness counter change is proposed.

Lazy index work precedes a validation cache in implementation order. Canonical validation cannot move past a read;
sidecars are already lazy. A cross-Worker validation proof must cover layout, journal policy, store generation,
size/mtime/ctime, consistent schema/store identity, replacement and restore/erasure invalidation. Preserve unsafe-file,
WAL and auxiliary refusal precedence. The existing journal cache is Worker-local. Close still awaits leases/providers.

## Recommended smallest engine change and forecast

Stage 1 is an opt-in, service-owned pool of single-use Workers preloading **engine modules only**: static graph,
database library, facade and index. The host module is still imported after authenticated bootstrap and identity ack,
exactly as today; host construction, ACL, DELETE preflight and canonical validation remain request-time work.
Start with at most two ready Workers and one refill, immediate cold fallback, no indefinite queue. Never return an
assigned Worker to the pool, even after failed open; terminate it at reader close. Stage 1 needs no product import split.

Only later consider stage 2, a separate registered-host preload opt-in, if P demonstrates useful eligible (a)/(c)
savings and audits the complete import graph/native initializer as side-effect-free except code/library loading.
No host construction, ACL or application-file/database opening may move ahead of bootstrap in either stage.

On the same native host, E is removable engine startup/import work; A is the **measured union** of eligible host import
work (a)/(c), excluding all ACL work. Never add overlapping addon and graph intervals. L is baseline lifecycle; H
includes ready-hit pool lookup and handoff. K is pool lookup on a miss; M is additional miss/fallback handling.
Thus both hits and misses pay lookup overhead. Forecasts are counterfactuals from paired samples:

- Stage 1 ready hit: `Q95(L_i − E_i + H_i)`; there is no A subtraction.
- Stage 2 ready hit: `Q95(L_i − E_i − A_i + H_i)`.
- Full mixture: `Q95(hit ? L_i − E_i − A_i + H_i : L_i + K_i + M_i)`, with A=0 for stage 1.

B, the request-time ACL cost inside L, remains in every expression; all fetch/close/validation work also remains.
Use paired native stage samples, never arithmetic on independent p95s. Do not move pre-open authentication into/out
of the metric. Source S's paired removable engine p95 was 71.0 / 64.5 ms, idealized residual p95 43.6 / 45.2 ms:
WSL2 counterfactuals, not native forecasts. P must provide native stages/overheads before claiming a margin below 150 ms.
A low hit ratio can leave cold opens in the p95 tail; ACL-dominated residuals require product decisions, not caching grants.

Qualification must measure the actual full lifecycle under refill CPU/memory contention, arrival bursts, misses and
crashes. That measured distribution is separate from the subtraction forecast; prewarming relocates rather than removes
CPU work. Two non-author reviews remain required before implementation. Do not silently add validation caching.

## Authority and supervision contract

The engine does **not** enforce service-fixed host selection: `core/context-product-reader.mjs:81`–`:86` accepts an API
caller's absolute local-file `host.moduleUrl`; `:121` uses it as a registry domain. The supervisor checks
capacity/quarantine (`core/context-read-supervisor.mjs:80`–`:90`), not a module allowlist. HTTP routing is outside this
engine, so it cannot prove that an HTTP caller has no influence. The harness fixes its host URL
(`tools/testing/fixtures/context-product/engine.mjs:61`); that does not prove product routing.

Stage 1 matches the engine build/bootstrap protocol, Worker runtime/resource policy and service deployment generation;
it has no preloaded host to match. Incompatible slots take cold fallback. Stage 2 additionally requires immutable
service registration of normalized host URL/version/generation outside HTTP input; reader and maintenance hosts remain
separate. A mismatch takes the existing cold path with the requested host, original cutoffs, **same opening record and
reservation**. It neither consumes a second reservation nor bootstraps/retargets the mismatched Worker. Retire stale
slots under their idle owner. Request-influenced registration is ineligible for stage 2.

One HTTP request remains one reader lifetime for authority. Stage 1 parked Workers hold only audited engine code,
immutable engine constants/generation and a private control port; they never import the host. Stage 2 may additionally
evaluate audited service-registered host code, including a native addon through the code loader only. Neither stage
may call `createContextReadHost`, run ACL queries, hold credentials, bindings, reservations, request IDs, readSets,
owner selections or request host configuration, or call application file/database open APIs. No database opens before
issuance verification and identity ack; no preflight, attestation, statements or content cache while parked.
Code/library loader reads are the only pre-bootstrap file activity. Audit transitive/deferred imports and native
initializers: application-file/database opens or ACL effects make stage 2 ineligible until split into request-time
construction. Keep the empty environment and execArgv isolation. URL matching alone proves no import purity.

Authentication and issuance precede open; any host-side ACL validation remains after bootstrap within this same request,
never carried from another request. Admission clocks begin before parent validation. The parent checks
requestControl/issuance, bounds bootstrap, consumes the single-use requestReservation by CAS, and registers the opening
record before assignment. The Worker accepts one bootstrap, repeats record, issuance and cutoff checks, then does file
identity and waits for registry bind/ack before host construction or DB open. Handoff never resets admission, credential
expiry, request cutoff, operation cutoff or epoch.

The process-wide supervisor keeps its 256-live-record limit, shared with maintenance and in-flight operations; a reader
plus a read can occupy two records. Pool capacity is no extra admission quota. Duplicate request/handle/binding
reservations retain existing cutoffs; consumed reservations are never reset or retried. Opening failures after
registration retain their cleanupId and drain-by-ID behavior. Parked Workers have no request record: track them in a
separately bounded service-owned idle ledger, awaited by supervisor close. Assignment transfers exactly one resource to
one registered reader. Uncertain native/external disposal preserves existing quarantine; Worker exit does not prove
leases/providers released. Failed safety records do not expire or release capacity. Cleanup history limits, TTL and
disposal-proof recovery remain unchanged.

## Failures, drains and accounting

Exhaustion uses the cold path within the original cutoff, with no indefinite queue. Reap/refill a crash before
assignment under the service owner; after assignment fail the request and follow cleanupId/drain. Module/addon load
failure makes that slot unusable, with bounded retry/backoff and observability, not a ready slot. Refill needs startup
deadlines and error/exit observers. Shutdown stops admissions/refill, reaps idle/loading Workers, then awaits registered
readers and external delivery promises; repeated shutdown is idempotent. No parked or loading Worker may outlive
supervisor close. Failed cleanup stays visible to its owner.

Before restore/erasure, deny admissions, publish revocation, stop pool/pump, and drain all registered clients and
idle/loading Workers. Invalidate old bindings/certificates through existing product integration. Resume with fresh
issuance and store/deployment generation; reap old host/addon code even though it holds no authority. A service-owned
application connection, if adopted by the product, must join that product drain explicitly.

Retain the 192 MiB old-generation limit per Worker, which is not an RSS cap. Two parked plus one refill means three
extra heap ceilings, plus native addon memory/threads, module code and admitted readers. Measure idle RSS, CPU,
descriptors and refill rate; parked Workers must own no database descriptors. Bound ready+loading count, refill
concurrency, assigned work and waiters separately; preserve the 256-record ceiling. Record aggregate
hit/miss/startup-failure counts without content or authority. Preloading does not eliminate repeated CPU cost.

## Implementation size, tests and unchanged behavior

Stage 1 estimate: 250–400 implementation lines and 300–500 lifecycle/race test lines; about 2–4 engineering days.
Stage 2 adds roughly 100–180 implementation and 150–250 test lines, about 1–2 days, plus product import auditing/splitting.
Both require review and native qualification; product ACL redesign is additional work. These are provisional estimates.

Tests must prove stage 1 never imports a host; stage 2 imports only registered audited code, with no construction,
ACL or application-file opens before bootstrap. Cover mismatch cold fallback with the same record/reservation,
hostile module selection, addon load failure, duplicate bootstrap, issuance and reservation
replay, expiry/abort during loading/handoff, crash before/after assignment, exhaustion/refill bounds, the shared
256-record ceiling, cleanup IDs, quarantine, leases/providers, shutdown/refill races, restore/erasure drains and never
assigning a second credential. Preserve full-ref/snapshot equivalence, two-sample authority, native telemetry,
SQLite-free parent import and manifest installation on both Node patches. Qualify hit/miss/burst mixtures through close
on the affected native host after P supplies attribution.

Diagnostics only: no pool/optimization is implemented; instrumentation stays inert without `diagnostics:true` and absent from public DTOs/serialization.
Evidence, expiry, publication/lineage/eligibility/suppression, sidecar refresh/retarget, pump admission/quantum settlement,
WAL opt-in, deadlines, cleanup proof and Q1's 150 ms lifecycle definition stay unchanged. No optimization is implemented.
