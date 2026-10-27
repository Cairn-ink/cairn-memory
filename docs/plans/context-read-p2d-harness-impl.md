# Context-read P2d qualification harness handoff

Branch `feat/context-read-p2d-harness`, base `9a8f6fb7`, frozen
`context-read-product-v1.1`, protocol `P2-product-v3`. The primary commits.
This delivers the opt-in runner and deterministic qualification checks. No
production, contention, smoke, freshness or backup timing run was performed.
Functional checks use tiny DELETE stores and assert outcomes and file/process
lifecycles, never an elapsed-time or loop threshold.

## Design and entry points

`npm run measure:context-read-product -- --registration registration.json
--writer-profile writer-profile.json --report qualification.jsonl` is the real
opt-in entry. `--plan` prints the mechanically expanded registration inventory
without collection. `--smoke` runs one narrow DELETE operation cell for a fixed
2 s, with no gate acceptance. Neither smoke nor functional-only can return
`passed`. All CLI paths print a final `passed`, `failed`, `inconclusive` or
`invalid` line and exit nonzero except `passed`.

The small command module coordinates the following measurement-only modules in
`tools/testing/fixtures/context-product/`:

- `protocol.mjs`: inventory, exact numeric thresholds, successful and all-attempt
  nearest-rank quantiles, exposure classes, availability, censored freshness,
  writer summaries and gate/aggregate decisions.
- `engine.mjs`, `host.mjs`: the single §5 selection adapter, fresh request/service
  issuance, real capability probes, public reader lifecycle, exact DTO/schema and
  byte checks, exact assembly recount, host-loop and GC observations and prompt
  supervisor export/ack. No engine runtime module is changed.
- `series.mjs`: three warmups; main/cold success populations and attempt ceilings;
  separate initialized warm candidate reference; explicit cron-renewed pump;
  fixed-window reader/baseline pairs. Every concurrent main/cold success requires
  public read-call/public write-call overlap. Missed overlaps stay in the journal
  and consume the ceiling; final overlap reconciliation is also journaled.
- `writer.mjs`, `writer-journal.mjs`, `writer-sqlite.mjs`, `sqlite-loader.mjs`,
  `controller.mjs`: independent capture/review writer; native observation before
  ordinary imports/opening; bounded journal, contiguous transfer acknowledgements,
  parent-assigned operation range, final seal acknowledgement and actual exit plus
  IPC disconnect. Separate native events cover opening, prepare/cached execution,
  iterator steps, transactions including rollback, inspection and every close.
  Card freshness targets use authored draft/confirmed-current Card public calls.
- `actors.mjs`, `runner-child.mjs`, `startup-loop.mjs`, `gc-worker.mjs`: supervised
  children, genuinely fresh Node cold hosts, separate launcher/startup/read host
  observations and Worker GC entries. Cold configuration serialization and oracle
  validation are outside observation. The cold child and launcher handshake after
  engine cleanup and before validation/report transfer. Startup observation starts
  in a Node preload and pauses for harness configuration/oracle work.
- `io-child.mjs`: short SQLite-free copy/hash process; separate Linux schedstat,
  vmstat and disk-size sampler. The host performs metadata operations only on DBs.
- `storage-child.mjs`: SQLite-only setup/inspection/consistent backup/deep verify,
  with no raw DB file reads/copies. Restored canonical content/schema hashes are
  compared; old request bindings/certificates are never reused. Current/history
  are explicitly rebuilt before a separately authenticated fresh ready check.
- `report.mjs`: exclusive immutable header, append/sync numeric records journal,
  incrementally valid JSONL `.partial` report, final rename and status. Only the
  current cell's raw records remain in memory. Each cell owns a separate temporary
  subtree, removed after its actors and supervisors have drained.

E1-C2 supplies the shared `measureWriterLifecycle`, `exposureMetrics`, fixed
window/repetition constants and paired order convention. Its independent writer
uses that same lifecycle driver; the product supplies native observation and its
capture/review recipe. The shared helper preserves original native exceptions and
fresh finally-close, and leaves retained shutdown close outside write exposure.
The unmerged previews harness and its metrics fixture were read with `git show`;
there is no import or dependency on that branch. §10.1's product populations and
bounds supersede previews-specific limits and smoke behavior.

## Dependency plug points

`selectReadSet(inventory, selectionRevision)` is the sole readSet adapter for
launch and overflow. It selects personal plus the first 31 authorized projects
by descending host activity, missing activity zero, UTF-8 project-ID ties, then
canonicalizes namespace keys. It emits the exact `ownerCoverage` descriptor.
There is no engine fan-out or host ranking fusion.

`probeDependencies` opens the real public reader, calls capabilities and probes
maintainer admission. A rejected wide selection (`invalid_read_set`, or an
advertised insufficient maximum) identifies P2c. WAL is probed independently on
a narrow selection if wide admission failed; both advertised journal capabilities
and actual maintainer admission are checked. There is no operator readiness flag.
Blocked results are `decision:invalid, reason:blocked_dependency`, retained against
the full inventory. Equivalent blocked probes may be reused during the same run;
no successful data or telemetry is reused between attempts. Dependency detection
runs before the corpus adapter, so it cannot be hidden by failed snapshot setup.

P2c plugs in by admitting the frozen selected readSet/coverage configuration;
P2d-WAL plugs in through its public canonical/sidecar capabilities and maintainer
admission. The current engine supports the tiny one/two-namespace DELETE checks.
Full four-namespace launch/overflow and WAL qualification remain unaccepted until
the corresponding engine packages and real run evidence exist.

## Pre-registration and host inputs

`preregister` writes an exclusive, mode-0400 `<report>.header.json`, freezes its
in-process value and places its SHA-256 in both output streams before collection.
The JSONL report begins with that same header. It is never rewritten. Changing
inputs or thresholds requires a new registration/report path and a new run.
The header contains:

| Fields | Contents |
| --- | --- |
| `protocol`, `implementationCommit`, `profileCommit`, `protocolCommit` | Exact identities, numerical gates, capacities and schedules |
| `sourceDiffHash`, `changedSourceHashes` | Dirty implementation evidence, including new harness source |
| `inventory`, `cellCount`, `expandedInventory`, `expandedCellCount` | All dimensions, series, paired window order and count before collection |
| `corpus`, `inputHashes`, `labelsHash`, `queriesHash`, `settingsHash` | Six physical snapshots, registered Cards, authorized selection metadata, corpus/label/query/module/profile hashes |
| `node`, `productionNode`, `counter` | Actual patch, deployed patch and exact local counter identity/hash |
| `hardware`, `filesystem`, `platformRole`, `load` | CPU/RAM/OS, actual target-volume filesystem and host description, qualification role and initial load |
| `deadlines`, `writerProfile`, `writerRates` | Unchanged request/open/read and capture/review deadlines, provenance and 20 ms nonsaturating writer cadence |
| `pump` | 60 s cron renewal, quantum, poll/renewal settings and cumulative minute budgets |
| `diagnosticCapacities`, `drainSchedule` | Fixed reader 512-failure buffers; writer 65,536-record capacity/chunk bound, 100,000 parent operation-ID ceiling; immediate per-operation export/ack and acknowledged final seals |
| `seriesCeilingMs`, `buildCeiling`, `freshnessObservationMs`, `availabilityWindows`, `probes` | Fixed observation/attempt/quantum ceilings and unique freshness probes |

The registration JSON supplies `productionNode` (exact `v24.x.y`), the two frozen
40-character commit IDs, `platformRole`, `filesystem`, and `volumeRoot` (a writable
owned directory on the production volume). Real scratch worlds are created below
that directory, rather than assuming the system temporary volume is production.
A production pass additionally checks Linux, non-WSL kernel, ext-family filesystem
magic and the actual Node patch. The primary attests the concrete ext4 production
mount; WSL2 ext4 and APFS remain separately labeled reports.

`fixtures` contains exactly six entries: `{id,count,schema,cards,path,
consistency:'closed-snapshot',inventory,overflowInventory,selectionRevision,
otherOwnerNamespace}`. Counts are 1,112/3,336 × physical v18/v23/v33; v18 has zero
Cards and v23/v33 have registered positive Card counts. Launch inventories have
four namespaces; overflow inventories must exercise omitted coverage. Fixture
hashes are checked again after each exclusive child copy. Live companions refuse
source copying. Storage inspection refreshes actual metadata/revisions rather
than trusting mutation return values. Initial/final populations are journaled.

Also supply `labelsFile`, `queriesFile`, `adapterModule`, `counterModule`,
`counterId`, optional `counterConfiguration`, `deadlines`, `pump`,
`seriesCeilingMs`, `buildCeiling`, `availabilityWindows`,
`freshnessObservationMs` and `probes`. The two modules are local file URLs and
are hashed before collection. The counter exports
`createCounter(configuration) -> {id,countTokens}` and must match `counterId`.
No character-count substitute is permitted in real runs.

The corpus adapter is the fixture/label integration seam, not a replacement
engine: `prepare({cell,config,ledger}) -> {input,responseSchema,schemas?,oracleData?}`
and pure `validate(result,config) -> boolean`. `ledger` comes from storage after
placement; `oracleData.relevant` (full relevance refs) and `oracleData.knownMisses` are required for candidate/assembly preparation. These produce numeric recall@5/@12 and known-miss counts in attempt records. `oracleData` is the bounded frozen known-answer data sent to a cold
host. `prepare` runs after dependencies and prebuild, outside observed windows,
and may prepare full/compact refs or a host snapshot. It cannot override paths,
selection, deadlines or pump settings. Its method input must retain the exact
readSet and registered deadline. It supplies the frozen language ranking/recall
labels, complete-empty expectation, exact evidence order/revisions and closed DTO
schemas; schemas declare every key, optional key and status enum. The validator
rejects unknown fields/statuses. `tiny-schema.mjs` provides the closed lexical
candidate schema used in functional acceptance. Snapshot/compact profiles must
prepare exactly the registered 1/24 items; no extra read is inserted into a
fresh measured sample. The adapter also reports the frozen recall@5/@12 labels
and the documented single-Han known miss through its registered oracle data;
these are correctness fixtures, not a newly invented quality percentage.

`writer-profile.json` is exactly `{captureMs,reviewMs,provenance}`. Both deadline
fields accept positive integers or null. Null makes the corresponding coexistence
check inconclusive; no review or capture deadline is invented. The later 5,000 ms
review deadline belongs in this host-supplied file when the product supplies it.
The profile file itself is hashed in the registration.

## Inventory

The mechanically generated inventory contains **7,520 qualification cells**:

| Kind | Count |
| --- | ---: |
| Request cells | 7,200 |
| Freshness | 80 |
| Availability | 48 |
| Overflow partial | 48 |
| Canonical backup/restore/rebuild/verify/size | 24 |
| Absent/exhaustion/abort/crash/post-catch-up | 120 |
| Total | 7,520 |

Requests are the full cross-product of 2 world sizes × 3 physical schemas ×
4 canonical/sidecar journal pairs × 2 intents × 3 languages × 10 method profiles
× 5 loads. Profiles are candidates 12/24, assembly 1,500/12 and 4,000/24, and fetch
1/24 × full/compact/snapshot. Loads are idle, fresh/retained same-projection and
fresh/retained other-owner writers. DELETE/DELETE and WAL/WAL are required;
the two mixed journal pairs remain registered controls. No percentile pools these
dimensions. v18 requests remain Memory-only.

The expanded registration contains **81,056 series/window descriptors**, including
**57,600 individually ordered fixed windows** (five paired reader/baseline windows
per contention request cell). Their fixed duration alone is 1,728,000 s; this
exhaustive inventory is substantial and is not silently shortened to fit a window.
`--smoke` registers one explicit narrow operation-only scope. The primary owns
quiet-window scheduling and production/platform evidence; no shortened run can
claim blanket qualification.

## Gate-to-code map

Paths in the following table are relative to `tools/testing/fixtures/context-product/`.

| Requirement | Code / behavior |
| --- | --- |
| Three warmups, 50/500 main, 10/100 cold; successful-only nearest rank | `protocol.population`, `quantiles`, `qualifies`; `series.requestSeries`; cold is a fresh process, without cold warmups |
| Warm candidate p95 300/max 1,500 | `protocol.decide`, `warm-reference` uses initialized read-call time |
| Fresh candidates p95 700/1,000, max 1,500 | `protocol.decide`, world-specific main/cold lifecycle |
| Fresh fetch p95 150/max 500, all ≤24-ref adapters | `protocol.decide`, all full/compact/snapshot profiles |
| Fresh assembly p95 800/max 2,000 | `protocol.decide`, main/cold lifecycle |
| Absolute host loop ≤100, zero gaps strictly >100 | `engine.observeLoop`, `startup-loop`, `actors.coldAttempt`, all read/startup/launcher/writer loop inputs to `decide`; 100 ms idle baseline is report-only, never subtracted |
| Timeout/abort overshoot ≤50; reject late success | `engine.attempt`, original request and per-call cutoffs, public settlement distinct from awaited cleanup lag |
| Zero WAL public/native busy | `protocol.decide` uses reader + all drained maintainer + writer + paired-baseline evidence; incomplete coverage makes the comparison invalid while preserving observed failures |
| DELETE busy | Raw public/native counts retained, no busy-rate ceiling; refusals never count as successes |
| Writer coexistence | Capture/review raw public-call, close and lifecycle statistics; no deadline overrun/timeout; null deadline inconclusive; paired throughput ratio report-only |
| Fresh writer exposure | `exposure`: ≥20 write overlaps, ≥100 in-call/window native commits, ≥10 fresh-close overlaps |
| Retained and baseline exposure | Retained ≥20/100, no fresh-close minimum; baseline ≥100 commits only; shared E1 `exposureMetrics` clips actual intervals/window |
| Functional and byte/counter bounds | `engine.closedShape`, `validateResponse`, registered oracle; ≤65,536 bytes, cursor ≤8,192, snapshot ≤16,384, exact assembly recount and item budget; unexpected errors fail |
| Not-ready ≤1%, ≥100 index-dependent scheduled attempts | `protocol.availability`, command `availabilitySeries`; mutually exclusive classes, no evidence-only dilution or dirty-period exclusions |
| Eligible item searchability p95 ≤30 s, ≥100 targets | `protocol.freshness`, command `freshnessSeries`; unique frozen probes, exact ref/revision from fresh handles, first successful observation; missing observations are censored +infinity; cadence/drain violations invalid |
| Build/pump | `series.build`, `startPump`, explicit service credentials, both intents, bounded quanta, cumulative quotas and observed renewal/completion/close |
| Size/backup/verification | command `backupSeries`, `storage-child`: all §8.4 times and main/WAL/SHM/total/peak bytes; independent manifest/statistics verification, canonical consistent backup; peak sampling resolution 10 ms disclosed; no invented time/size gate |
| Dependency, insufficient, interrupted, incomplete | `probeDependencies`, `decide`, `aggregate`, report finalization; every non-pass CLI outcome exits nonzero |

## Deterministic acceptance and lessons

`tools/testing/measure-context-read-product.test.mjs` owns P2-19. Its fixed numeric
answers independently establish successful n=50/rank48=480 and all-attempt
n=500/rank475=250 despite 450 zero-time failures. It checks all success minima,
ceilings, overlap qualification, exactly three warmups, inconclusive results and
the distinct fresh/retained/baseline exposure rules. Fabricated decisions exercise
every numeric latency/loop/settlement/bytes/writer/freshness/availability gate,
null deadlines, missing coverage and blocked-dependency outcomes.

The same file owns P2-23: fake native constructor/commit/rollback/close failures
with primary 5/6, including a generic public mapper; retained parent busy counts;
exact resends; conflicting duplicates; wrong epoch; missing chunk/seal/operation;
overflow; crash/unacknowledged seal/disconnect; and final close outside write
exposure. Known busy counters survive missing record coverage and still fail the
zero-busy comparison. A separate import subprocess rejects eager SQLite linkage.

The pump exports/acknowledges completed supervisor records through public engine calls every 100 ms, buffering references only; validation and serialization wait until between read observations. A drain gap above 500 ms makes coverage incomplete, avoiding history-eviction zero-busy claims. This schedule is pre-registered.

The slow-validation regression uses a deterministic injected clock: 20,000 units
of validation/oracle work after observation do not appear in loop records, while
250 units injected inside the engine-call window do. No wall-clock threshold is
asserted. All record construction, JSON serialization, bounds checks and oracle
comparison occur after observation. Cold report transfer is separately fenced
from its startup/read observation.

`tools/testing/fixtures/context-product/functional-check.mjs` is an explicit-path
functional suite, kept outside automatic `*.test.mjs` discovery. It exercises:
one/two-namespace DELETE CLI runs, actual certified build and fresh read, closed
response/record shapes, immutable header/journal/partial/final files, expected
non-pass CLI exit, cleanup, ordinary independent writer arming/native seal,
fresh-process cold operation and actual blocked wide/WAL probes. A separate native lock regression proves that child copy/hash leaves a host-held exclusive SQLite lock intact before COMMIT. Two-operation
Memory and Card cases verify capture/review target revisions refreshed from
storage. The wrapper test exits 0 when the functional-only CLI correctly exits 1.

The raw-fd tripwire now scans the command, summary and every fixture module,
including future `.mjs` additions. Copy APIs are included in the tokenizer. The
19 exact justified allowances cover only owned report/config files and the
SQLite-free child, never a whole-file exemption. `sqlite-lock-safety.test.mjs`
remains unchanged and must pass. Shared E1 lifecycle tests verify original native
failure identity, unconditional fresh close and absence of retained per-write
close. Neither the frozen contract nor `packages/setup/runtime` is changed.

Per-block diagnostics retain overlapping host/Worker V8 GC, process resourceUsage
CPU/fault/context-switch deltas and the sampler's per-thread schedstat run-queue
and vmstat swap/major-fault observations. Missing attribution is labeled incomplete;
it never subtracts from or waives an absolute loop gate. Raw records survive an
interruption in `.records.jsonl` and `.partial`. The separate streaming summary
prints a decision tally and block table, automatically reading the journal sibling,
without dumping the report:

`node tools/testing/summarize-context-read-product.mjs qualification.jsonl`

Actors have IPC progress watchdogs, error/exit/disconnect observation and awaited
termination. Signal interruption cancels further sampling, then drains owned
resources and preserves evidence; no expensive run is automatically restarted.
There is no claim of supervision after this command exits.

## Primary inputs and deferred acceptance

Before a real run the primary supplies the unchanged production capture/review
profile and provenance, exact deployed Node patch, frozen synthetic physical
snapshots/Card distributions, zh/ja/mixed relevance/ranking labels and known misses,
query and unique-probe data, corpus adapter, exact production counter, pump quotas,
bounded observation ceilings, a production-volume host and a sufficiently quiet
run window. No private corpus or production counter has been supplied or inspected
here. The adapter's frozen labels must include recall@5/@12 evidence and full versus
compact/snapshot known answers; no 92% Japanese/mixed threshold is invented.

Owner-wide fusion/selection acceptance remains P2c; canonical/sidecar WAL and its
lock/wait policies remain P2d-WAL. Narrow functional success grants neither release
claim. No engine hook was added. Optional semantics/inference, product HTTP glue,
authority sign-off, fallback/restore admission ownership and rollout remain outside
this synthetic qualification package. The primary decides whether this internal
handoff document ships and registers it in the artifact manifest if it does.

## Verification and changed files

The actual explicit-path commands, exits and mechanically cross-checked changed
inventory follow. No package install, network, key access, broad suite, timing run,
smoke run, staging or commit occurred.

The core test inventory was independently derived by filesystem glob and `rg --files`: **29 identical explicit paths**. Five additional explicit paths cover the new harness, explicit functional suite, both lock guards and the touched E1-C2 helper: **34 distinct paths per runtime**. Each file ran separately with `node --test --test-reporter=tap <path>`, using the exact nvm-installed **22.16.0** or **24.15.0** executable, with that executable directory first in PATH. Both version commands exited **0**. Actual subprocess return codes and TAP totals were captured directly.

Node **22.16.0**: **34 commands, all exit 0; 599/600 tests passed, 1 existing skip, zero failures/cancellations**.

Node **24.15.0**: **34 commands, all exit 0; 599/600 tests passed, 1 existing skip, zero failures/cancellations**.

The existing A13 `o200k_base` assembly probe skips because the `tiktoken` package is unavailable; no dependency was installed and no constants were inferred. This remains a primary/deployed-counter qualification input. The tiny functional-only CLI intentionally exits **1** (`inconclusive`); its wrapper asserts that behavior and exits **0**.

| Explicit test path | Node 22.16.0 exit / passed | Node 24.15.0 exit / passed |
| --- | --- | --- |
| `core/test/context-read-assembly-races.test.mjs` | 0 / 7 | 0 / 7 |
| `core/test/context-read-assembly-readonly.test.mjs` | 0 / 28 | 0 / 28 |
| `core/test/context-read-assembly.test.mjs` | 0 / 19 | 0 / 19 |
| `core/test/context-read-bm25.test.mjs` | 0 / 3 | 0 / 3 |
| `core/test/context-read-budget.test.mjs` | 0 / 5 | 0 / 5 |
| `core/test/context-read-core.test.mjs` | 0 / 26 | 0 / 26 |
| `core/test/context-read-default-entropy.test.mjs` | 0 / 1 | 0 / 1 |
| `core/test/context-read-embedder.test.mjs` | 0 / 5 | 0 / 5 |
| `core/test/context-read-fusion.test.mjs` | 0 / 4 | 0 / 4 |
| `core/test/context-read-local-embedder.test.mjs` | 0 / 38 | 0 / 38 |
| `core/test/context-read-local-status.test.mjs` | 0 / 3 | 0 / 3 |
| `core/test/context-read-moc-source.test.mjs` | 0 / 15 | 0 / 15 |
| `core/test/context-read-process.test.mjs` | 0 / 1 | 0 / 1 |
| `core/test/context-read-product-artifact.test.mjs` | 0 / 1 | 0 / 1 |
| `core/test/context-read-product-control.test.mjs` | 0 / 83 | 0 / 83 |
| `core/test/context-read-product-import.test.mjs` | 0 / 2 | 0 / 2 |
| `core/test/context-read-product-index.test.mjs` | 0 / 65 | 0 / 65 |
| `core/test/context-read-product-pump.test.mjs` | 0 / 16 | 0 / 16 |
| `core/test/context-read-product-service.test.mjs` | 0 / 2 | 0 / 2 |
| `core/test/context-read-product.test.mjs` | 0 / 126 | 0 / 126 |
| `core/test/context-read-recovery.test.mjs` | 0 / 10 | 0 / 10 |
| `core/test/context-read-review.test.mjs` | 0 / 10 | 0 / 10 |
| `core/test/context-read-sidecar.test.mjs` | 0 / 17 | 0 / 17 |
| `core/test/context-read-source-work.test.mjs` | 0 / 7 | 0 / 7 |
| `core/test/context-read-sources-authority.test.mjs` | 0 / 6 | 0 / 6 |
| `core/test/context-read-sources-bounds.test.mjs` | 0 / 5 | 0 / 5 |
| `core/test/context-read-sources-races.test.mjs` | 0 / 16 | 0 / 16 |
| `core/test/context-read-sources.test.mjs` | 0 / 14 | 0 / 14 |
| `core/test/context-read-tokenize.test.mjs` | 0 / 2 | 0 / 2 |
| `core/test/no-raw-db-fd.test.mjs` | 0 / 5 | 0 / 5 |
| `core/test/sqlite-lock-safety.test.mjs` | 0 / 16 | 0 / 16 |
| `tools/testing/fixtures/context-product/functional-check.mjs` | 0 / 7 | 0 / 7 |
| `tools/testing/measure-context-read-product.test.mjs` | 0 / 27 | 0 / 27 |
| `tools/testing/measure-topic-reader-wal.test.mjs` | 0 / 7 | 0 / 7 |

All **24 new/touched JavaScript paths** passed individual `node --check` invocations on both runtimes: **48 actual exits, every one 0**. The syntax inventory was independently cross-checked by glob and `rg` enumeration. No timing or smoke command was run.

The initial development unit invocation exited **1** solely because its expected cell count was 7,664 instead of the mechanically derived 7,520; that assertion was corrected before the final runs. Subsequent additions increased the harness unit suite from 24 to 27 and the explicit functional suite from 4 to 7 cases. No engine behavior or production threshold was changed to obtain a pass.

The changed-file inventory was derived by `git diff --name-only HEAD` plus untracked enumeration, then independently by comparing every tracked worktree content/mode with its index object and adding porcelain-status untracked paths. The sorted inventories match at **27 files**, including the scripts, fixture modules, configuration, lock guard, exact allowlist and this report. No new runtime source is hidden by an untracked-file omission.

- `core/test/fixtures/no-raw-db-fd-allowlist.json`
- `core/test/no-raw-db-fd.test.mjs`
- `docs/plans/context-read-p2d-harness-impl.md`
- `package.json`
- `tools/testing/fixtures/context-product/actors.mjs`
- `tools/testing/fixtures/context-product/controller.mjs`
- `tools/testing/fixtures/context-product/engine.mjs`
- `tools/testing/fixtures/context-product/functional-check.mjs`
- `tools/testing/fixtures/context-product/gc-worker.mjs`
- `tools/testing/fixtures/context-product/host.mjs`
- `tools/testing/fixtures/context-product/io-child.mjs`
- `tools/testing/fixtures/context-product/protocol.mjs`
- `tools/testing/fixtures/context-product/report.mjs`
- `tools/testing/fixtures/context-product/runner-child.mjs`
- `tools/testing/fixtures/context-product/series.mjs`
- `tools/testing/fixtures/context-product/sqlite-loader.mjs`
- `tools/testing/fixtures/context-product/startup-loop.mjs`
- `tools/testing/fixtures/context-product/storage-child.mjs`
- `tools/testing/fixtures/context-product/tiny-schema.mjs`
- `tools/testing/fixtures/context-product/writer-journal.mjs`
- `tools/testing/fixtures/context-product/writer-sqlite.mjs`
- `tools/testing/fixtures/context-product/writer.mjs`
- `tools/testing/measure-context-read-product.mjs`
- `tools/testing/measure-context-read-product.test.mjs`
- `tools/testing/measure-topic-reader-wal.mjs`
- `tools/testing/measure-topic-reader-wal.test.mjs`
- `tools/testing/summarize-context-read-product.mjs`

Final `git diff --check` and an independent trailing-whitespace/final-newline check over every changed file exited **0**. The allowlist and package JSON parse. `git diff --cached --exit-code` exited **0**: nothing is staged. Frozen contract sections, core runtime modules and the generated setup runtime have empty diffs, **exit 0**. Owned temporary verification files/logs were removed after recording the results. No measurement/test child or monitoring process is left running; this handoff promises no unattended supervision.

## Fix round 1

Implemented against `41669767`, without a commit. Read both non-author reviews,
all extra lessons and the original brief. The references below use S1–S12 for
spec review findings and T1–T9 for standards review findings. Overlaps reduce the
21 review entries to 17 distinct issues. Regressions are fabricated numeric
inputs, injected dependencies or explicit message/callback rendezvous; no timing
or smoke measurement was run.

| Finding | Fix | Regression |
| --- | --- | --- |
| S1 incomplete maintainer coverage | `maintainerCoverage()` preserves any incomplete collected coverage and any incomplete build coverage; configuration cannot turn it complete. | Fix suite S1 runs `requestSeries` with a complete build configuration and incomplete pump drain, requiring `invalid`. |
| S2/T1 sampler IPC inside observations and unbounded buffering | SQLite-free sampler retains at most 4,096 samples, counts drops, sends only on explicit collection after reader/launcher `loop.finish()`, and awaits callbacks for batches of 128. The parent retains one previous sample per PID plus the current bounded transfer. Cold startup pauses around sampler setup. Silent idle sampling does not trigger a false progress timeout; outstanding collection and IPC errors retain the kill watchdog. | S2/T1 uses manual samples and callback acknowledgements, asserts silence during observation, a fixed storage ceiling, drop counts and no next transfer before acknowledgement. A second test drives the production sampler message handler with a manual timer and explicit collection rendezvous. |
| S3/T5 missing writer loop gate | Availability and freshness supply reader, launcher/startup and writer loops to the common absolute gate. | Both series run with fabricated 100-read/100-target populations and writer maxima of 1 or 101 ms; the latter fails. |
| S4 backup reader bypasses gates | The restored reader uses `decide()` with method latency, DTO/oracle bounds, settlement, all reader loops, native/public BUSY and diagnostic coverage. Rebuild coverage is independently required complete even for DELETE. Missing peak-sampling coverage cannot claim complete outputs. | S4 drives the real backup orchestration with fabricated dependencies, independently violating each acceptance condition and the rebuild coverage condition. |
| S5 late errors lose overshoot | Every delivered outcome computes deadline overshoot from its delivery/rejection time; cancellation also retains host-observed abort settlement. Cleanup lag stays separate. | S5 injects a clock: non-timeout returned/thrown errors at 5,060 ms against a 5,000 ms cutoff retain 60 ms and fail; exactly 50 ms remains allowed. |
| S6 substituted workload dimensions | `prepareInput()` validates registered intent, types, candidate limit, assembly token/item budget, exact selected readSet and deadline before execution. Fetch validates its applicable direct-ref or snapshot DTO. Invalid workloads produce an invalid cell. | S6 independently substitutes each dimension in an otherwise valid history mixed-type stress input; every substitution is rejected as `invalid_cell`. |
| S7 overflow without omissions | Registration, prepared overflow selection and the decision gate require positive omissions. | S7 rejects the ordinary four-namespace inventory and accepts a genuine 33-namespace selection with one omission. |
| S8/T6 history freshness starts too late | Memory history exports the storage-refreshed capture target at its first eligible commit. Confirmation updates its exact revision while preserving that origin and any earlier successful observation; target ingestion deduplicates identities. Current Memory/Card targets still start at successful confirmation; failed operations cannot create targets. | S8/T6 fabricates capture at 0, confirmation at 20 and search at 30,010 ms: p95 fails. The explicit functional suite additionally captures one Memory without any review and checks the emitted target against storage and native commit records. |
| S9 retained shutdown regression gap | The actual writer uses `shutdownRetained()` to record the distinct shutdown phase, final-close interval and native close outcome. A failed close still exports diagnostics before the incomplete seal. | P2-23 fake native close outcomes 0/5/6 include retained open, write/inspect and shutdown records, with shutdown at 30 outside the write interval [10,20]. The explicit retained writer test asserts real shutdown native records, absent per-write close and final close after public write. |
| S10 preregistration omits gates | `PROTOCOL` now includes method-specific p95/max, response/snapshot/cursor limits, assembly token/item limits, zero-BUSY and coverage policies, writer deadline/timeout and output/platform policies. Evaluators consume those registered numeric thresholds. | S10 inspects the actual preregistration result for exact latency and bounds values plus the declarative definition and estimate. |
| S11 discarded reader statistics | Request cell summaries retain both successful-only and all-attempt populations, including p50/p95/max. Pair wrapping retains them. The summary emits each cell's statistics incrementally. | S11 checks an actual report/summary and runs the registration orchestrator with fabricated request-series output, checking its persisted cell summary. |
| S12/T2 IPC errors masquerade as exit | IPC failure rejects message waits, while `child.exited` resolves only on actual process close (or confirmed spawn failure with no process). Termination still kills and waits for close; the watchdog remains active. | S12/T2 emits an IPC error on a fake live child, verifies exit and terminate remain pending, then supplies the actual close event. |
| T3 writer startup leaks pump | Both series acquire the pump and writer inside `try/finally`, stopping the acquired pump even when writer arming rejects. | Separate T3 availability/freshness regressions inject arming failure and require exactly one pump stop and exported drain. |
| T4 writer crash loses native BUSY | Controller stop drains queued chunks after confirmed termination, returns incomplete evidence with known BUSY/calls, and callers journal it. Startup errors also carry their ledger into the top-level failure journal. | T4 acknowledges a native primary-5 chunk, injects child exit before seal, and checks BUSY=1/incomplete coverage in the numeric report. |
| T7 cold attribution overwritten | Records carry their host PID; launcher samples cannot overwrite attribution belonging to the cold host. The request path also skips launcher attribution for cold host records. | T7 supplies complete cold scheduling data and conflicting launcher samples and requires the original data unchanged. |
| T8 summary retains every block | Block and cell-statistic rows stream immediately to an awaited sink; only tallies and block count survive. CLI stdout writes await callbacks. | T8 blocks a sink callback at the first row of a 1,000-row report, asserts incremental delivery, then checks only aggregate counts are returned. |
| T9 maximum-only loops disappear | Legacy loop maxima render with explicit `unavailable` timestamps and resource fields. | T9 supplies `{maxMs:250,over100:1}` without blocks and requires the 250 ms row. |

The fix regressions live in
`tools/testing/measure-context-read-product-fix1.test.mjs`; retained shutdown and
capture-only storage checks also live in the explicit functional suite. The
original synthetic per-write-close test was renamed to describe its actual
resend/overflow scope. No SQLite-reaching static import, engine runtime change,
raw database descriptor allowance or generated runtime change was introduced.

The inventory is generated by `buildPlan(definition)` from `V3_DEFINITION`:
ordered dimension cross-products, required/control journal combinations,
schema-dependent target types, per-kind series/sample rules, and fixed-window
loads/repetitions/duration/pairing. Registered cells carry their actual sample
rules and window counts. Execution uses those counts and skips paired windows
for cells without registered windows. The registration JSON may provide a
`protocolDefinition` object for a separately approved revision; changed data
cannot retain the v3 revision label. The default is unchanged v3. The header freezes that complete definition and its estimate.
The inventory regression loads the original pure protocol module from git and
compares every old cell field, stable ID and all expanded descriptors: **7,520
cells / 81,056 descriptors / 57,600 fixed windows**, unchanged.

`node tools/testing/measure-context-read-product.mjs --estimate` requires no
profile, fixture access, workspace or engine invocation. It exits 0 and prints:

```json
{"protocol":"P2-product-v3","cellCount":7520,"counts":{"requests":7200,"freshness":80,"availability":48,"overflow":48,"backup":24,"injection":120},"minimumSamplesByKind":{"requests":525600,"freshness":8000,"availability":4800,"overflow":3024,"backup":24,"injection":120},"fixedWindowMs":1728000000,"minimumAttempts":541568,"perAttemptFloorMs":1,"lowerBoundWallClockMs":1728541568,"assumption":"Serial cells; assumed 1 ms per minimum attempt outside fixed windows; excludes setup, rebuilds, extra attempts, availability windows and freshness waits. Not a measured runtime guarantee."}
```

This is **1,728,000 s** of fixed windows plus **541.568 s** at the stated assumed
per-attempt floor, approximately **20.006 days**. It is conditional arithmetic,
not measured feasibility or a promised runtime. `--estimate --registration
registration.json` reads only the definition in that JSON, so a revised cell
plan can be estimated before supplying production inputs. The immutable header
stores the same estimate for its registered plan.

The raw-fd guard adds one exact allowance for reading the estimate command's
operator registration JSON before engine startup. It permits no database or
companion access. The existing database copy/hash allowances remain confined to
the SQLite-free child.

Fix-round changed files were derived from `git diff --name-only HEAD` plus
`git ls-files --others --exclude-standard`, then independently from every
tracked file’s Git blob hash/mode versus index and porcelain untracked entries.
The sorted sets matched at **16 files** (including this document and the
JSON guard allowance).

- `core/test/fixtures/no-raw-db-fd-allowlist.json`
- `docs/plans/context-read-p2d-harness-impl.md`
- `tools/testing/fixtures/context-product/actors.mjs`
- `tools/testing/fixtures/context-product/controller.mjs`
- `tools/testing/fixtures/context-product/engine.mjs`
- `tools/testing/fixtures/context-product/functional-check.mjs`
- `tools/testing/fixtures/context-product/io-child.mjs`
- `tools/testing/fixtures/context-product/protocol.mjs`
- `tools/testing/fixtures/context-product/runner-child.mjs`
- `tools/testing/fixtures/context-product/series.mjs`
- `tools/testing/fixtures/context-product/writer-journal.mjs`
- `tools/testing/fixtures/context-product/writer.mjs`
- `tools/testing/measure-context-read-product-fix1.test.mjs`
- `tools/testing/measure-context-read-product.mjs`
- `tools/testing/measure-context-read-product.test.mjs`
- `tools/testing/summarize-context-read-product.mjs`

During development, the expanded functional suite initially exited **1** because
its new retained-call assertion expected `null` where the established shape omits
`closeStartedAt`. The assertion now checks absence; the next run exited **0**,
9/9. A later raw-fd guard invocation exited **1**, identifying the new JSON-only
estimate registration read; after adding its exact allowance it exited **0**,
5/5. These initial failures were test/allowance corrections, not relaxed gates.

Verification uses each exact nvm-installed executable with its directory first
in PATH. `node --version` exited **0** for **22.16.0** and **24.15.0**. Each test
path below is a separate serial command:
`node --test --test-reporter=tap <explicit-path>`. Return codes come directly
from the child process, without pipes. The 29 core context-read paths were
cross-checked using filesystem glob and `rg --files`; adding the two lock guards,
two harness suites, explicit functional suite and original E1-C2 suite gives
**35 distinct paths per runtime**.

All **14 changed JavaScript paths** were independently enumerated from the
cross-checked changed-file set and `rg`; individual `node --check <path>` calls
on both runtimes produced **28 actual exit codes, all 0**. The read-only
`node tools/testing/measure-context-read-product.mjs --estimate` command exited
**0** on each runtime and printed the v3 arithmetic above.

Node **22.16.0**: **35 distinct paths, every final exit 0; 627/628 tests passed, 1 existing skip, 0 failures and 0 cancellations**.
Node **24.15.0**: **35 distinct paths, every final exit 0; 627/628 tests passed, 1 existing skip, 0 failures and 0 cancellations**.

| Explicit test path | Node 22.16.0 final exit / passed | Node 24.15.0 final exit / passed |
| --- | --- | --- |
| `core/test/context-read-assembly-races.test.mjs` | 0 / 7 | 0 / 7 |
| `core/test/context-read-assembly-readonly.test.mjs` | 0 / 28 | 0 / 28 |
| `core/test/context-read-assembly.test.mjs` | 0 / 19 | 0 / 19 |
| `core/test/context-read-bm25.test.mjs` | 0 / 3 | 0 / 3 |
| `core/test/context-read-budget.test.mjs` | 0 / 5 | 0 / 5 |
| `core/test/context-read-core.test.mjs` | 0 / 26 | 0 / 26 |
| `core/test/context-read-default-entropy.test.mjs` | 0 / 1 | 0 / 1 |
| `core/test/context-read-embedder.test.mjs` | 0 / 5 | 0 / 5 |
| `core/test/context-read-fusion.test.mjs` | 0 / 4 | 0 / 4 |
| `core/test/context-read-local-embedder.test.mjs` | 0 / 38 | 0 / 38 |
| `core/test/context-read-local-status.test.mjs` | 0 / 3 | 0 / 3 |
| `core/test/context-read-moc-source.test.mjs` | 0 / 15 | 0 / 15 |
| `core/test/context-read-process.test.mjs` | 0 / 1 | 0 / 1 |
| `core/test/context-read-product-artifact.test.mjs` | 0 / 1 | 0 / 1 |
| `core/test/context-read-product-control.test.mjs` | 0 / 83 | 0 / 83 |
| `core/test/context-read-product-import.test.mjs` | 0 / 2 | 0 / 2 |
| `core/test/context-read-product-index.test.mjs` | 0 / 65 | 0 / 65 |
| `core/test/context-read-product-pump.test.mjs` | 0 / 16 | 0 / 16 |
| `core/test/context-read-product-service.test.mjs` | 0 / 2 | 0 / 2 |
| `core/test/context-read-product.test.mjs` | 0 / 126 | 0 / 126 |
| `core/test/context-read-recovery.test.mjs` | 0 / 10 | 0 / 10 |
| `core/test/context-read-review.test.mjs` | 0 / 10 | 0 / 10 |
| `core/test/context-read-sidecar.test.mjs` | 0 / 17 | 0 / 17 |
| `core/test/context-read-source-work.test.mjs` | 0 / 7 | 0 / 7 |
| `core/test/context-read-sources-authority.test.mjs` | 0 / 6 | 0 / 6 |
| `core/test/context-read-sources-bounds.test.mjs` | 0 / 5 | 0 / 5 |
| `core/test/context-read-sources-races.test.mjs` | 0 / 16 | 0 / 16 |
| `core/test/context-read-sources.test.mjs` | 0 / 14 | 0 / 14 |
| `core/test/context-read-tokenize.test.mjs` | 0 / 2 | 0 / 2 |
| `core/test/no-raw-db-fd.test.mjs` | 0 / 5 | 0 / 5 |
| `core/test/sqlite-lock-safety.test.mjs` | 0 / 16 | 0 / 16 |
| `tools/testing/measure-context-read-product.test.mjs` | 0 / 27 | 0 / 27 |
| `tools/testing/measure-context-read-product-fix1.test.mjs` | 0 / 26 | 0 / 26 |
| `tools/testing/fixtures/context-product/functional-check.mjs` | 0 / 9 | 0 / 9 |
| `tools/testing/measure-topic-reader-wal.test.mjs` | 0 / 7 | 0 / 7 |

The complete serial matrix executed **70 test commands and exited 0**. After the
final failed-operation freshness guard, these four affected Node 22 commands
were repeated, all **exit 0**: the original harness suite (27/27), fix suite
(26/26), explicit functional suite (9/9), and raw-fd guard (5/5). The table gives
the final result for each distinct path. Node 24 exercised that final source in
its matrix. Source hashes were checked unchanged after those final tests.

The existing A13 `o200k_base` counter test skips because `tiktoken` is unavailable;
no package was installed. Functional-only CLI children deliberately return
`inconclusive`/exit 1; their test wrappers assert this and exit 0. No production
latency, availability, freshness or contention gate was measured.

Final `git diff --check`, independent whitespace/final-newline checks over all
16 files, allowlist JSON parsing, `git diff --cached --exit-code`, and the diff
check for frozen contract/core runtime/generated runtime changes all exited
**0**. No staging or commit occurred; HEAD remains `41669767`. Owned verification
logs are removed after recording these results. No running task is left for
unattended supervision.
