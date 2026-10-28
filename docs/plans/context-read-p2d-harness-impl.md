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


## Fix round 2

Base `cf60a27f`; both spec and standards re-reviews were read in full. The
primary commits. All changes remain in measurement code, its deterministic
regressions and this handoff. No timing measurement or smoke run was performed.

| Re-review finding | Fix | Regression in `tools/testing/measure-context-read-product-fix2.test.mjs` |
| --- | --- | --- |
| Spec P1, S1 residual: paired WAL promotes incomplete build coverage | Each contention window returns its maintainer coverage, requiring an explicit complete clone build as well as complete available diagnostics. The paired decision requires both returned coverage values. Empty diagnostic drains cannot promote an incomplete build. | S1 runs the actual paired/window orchestration with fabricated writer intervals, commits and a manual clock. Each member independently has incomplete build coverage, with empty or complete diagnostic arrays; both are invalid. Complete pairs pass as a control. |
| Spec P1: nested dimensions or missing language pool gated populations | `validateDefinition()` runs at registration validation and before plan expansion. Every kind must have its complete required axes, every scalar dimension value comes from its closed domain, groups must preserve those axes, and expanded rows must have complete identities. Arbitrary objects are no longer spread into rows. | Separate nested-array and omitted-language cases reproduce the spec examples under a fabricated revision. Every required axis of every cell kind is also independently removed and rejected. |
| Standards P1: object-valued language pools gated populations | Method descriptors are the sole structured dimension entries and must match one entire closed `METHODS` profile exactly. The dependent type dimension resolves to registered scalar values for each physical schema. Overflow defaults must also retain scalar population identities. | The reviewer's `{language:[...]}` dimension is rejected. Additional cases substitute arrays, objects, null and unknown values into every dimension and pool the overflow language default. |
| Standards P1, T4: exceptional cleanup loses acknowledged writer evidence | `recordedWriter()` writes startup evidence or the recovered stop result to the numeric journal before returning or rethrowing, sharing one stop promise. Requests, contention, availability, freshness and injection writers all use it. Nested cleanup still drains pumps and samplers after writer cleanup failure. Post-catch-up injection also retains its writer result. | Four regressions use the real writer controller with an in-memory child: acknowledge a native extended BUSY=261 chunk, then inject `reader_cleanup_failed`. Each actual series must journal exactly one recovered BUSY=1 result, incomplete coverage, native records and confirmed exit before propagating the original error. Startup-evidence retention is checked separately. |
| Standards P1, S6 residual: compact fetch accepts the full profile | Full fetch requires complete typed refs and excludes fences/snapshot. Compact fetch requires expanded full refs and one mandatory eight-character base64url fence per ref. Snapshot fetch requires a bounded nonempty snapshot and excludes refs, intent and fences. | Full/compact/snapshot cross-substitutions, missing/null/malformed/sparse compact fences, mixed snapshot/direct inputs and incomplete typed refs are rejected. Valid 1- and 24-item full/compact inputs and valid snapshot inputs remain accepted. |
| Standards P2: `paired:false` estimate differs from execution | Unsupported unpaired definitions are rejected before registration and plan/estimate expansion. Paired orchestration also refuses an explicit false baseline flag before preparing any clone. | A fabricated revision sets `paired:false` and one repetition; registration, estimation and orchestration all reject it, with zero clones executed. |

The contention regressions link the production module through VM import doubles;
function bodies are unchanged. Imported waits advance a manual clock, native
observations and commits are fabricated, and neither a process nor SQLite is
started. The cleanup regressions use real exclusive report/journal files and
in-memory writer children. No elapsed-time threshold is an assertion. Ordinary
`*.test.mjs` discovery launches the new suite in its own VM-enabled runner when
needed; the explicit command below exposes all 23 cases directly.

All 23 new checks passed on the fixed implementation. The same new suite was
also run against the four exact implementation files from `cf60a27f`, with no
other source substitutions: **21 behavior regressions failed, 2 controls passed,
exit 1 on both Node versions**. In particular, the old paired case returned
`passed` for an incomplete reader clone with empty drains, both scalar-pooling
reproductions were accepted, all four exceptional cleanup paths omitted the
writer journal row, and full/compact substitutions were accepted. The four
modified implementation files were restored byte-for-byte in a `finally` block
before fixed-source verification.

The default v3 remains exactly **7,520 cells, 81,056 expanded descriptors and
57,600 fixed windows**, totaling **1,728,000,000 fixed-window milliseconds**.
The existing fix-round-1 test additionally compares every original cell field
and every expanded descriptor against the original implementation. No frozen
contract, engine runtime, generated runtime, SQLite import boundary, raw-fd
allowance or shared E1 helper is changed.

### Commands and actual exit codes

The executable paths are explicit, with the corresponding binary directory
first in `PATH` for each command and its children:

```sh
NODE22="$NVM_DIR/versions/node/v22.16.0/bin/node"
NODE24="$NVM_DIR/versions/node/v24.15.0/bin/node"
"$NODE22" --version
"$NODE24" --version
# Each ordinary table row, once per runtime, serially:
"$NODE22" --test --test-reporter=tap <explicit-test-path>
"$NODE24" --test --test-reporter=tap <explicit-test-path>
# New regressions, exposing every case:
"$NODE22" --experimental-vm-modules --test --test-reporter=tap tools/testing/measure-context-read-product-fix2.test.mjs
"$NODE24" --experimental-vm-modules --test --test-reporter=tap tools/testing/measure-context-read-product-fix2.test.mjs
# Arithmetic only; no collection:
"$NODE22" tools/testing/measure-context-read-product.mjs --estimate
"$NODE24" tools/testing/measure-context-read-product.mjs --estimate
```

Both version commands exited **0** and printed the requested exact patches.
The required core test inventory was independently derived from the filesystem
glob and `rg --files` filtered to the same immediate-directory pattern: **29
matching paths**. Including both lock guards, all three harness suites, the
explicit functional checks and the E1 helper tests gives **36 distinct explicit
paths per runtime**. Actual subprocess return codes and TAP totals were captured
directly, without a stdout pipeline. The functional suite checks tiny DELETE
outcomes and cleanup; it does not measure qualification gates.

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
| `tools/testing/fixtures/context-product/functional-check.mjs` | 0 / 9 | 0 / 9 |
| `tools/testing/measure-context-read-product-fix1.test.mjs` | 0 / 26 | 0 / 26 |
| `tools/testing/measure-context-read-product-fix2.test.mjs` | 0 / 23 | 0 / 23 |
| `tools/testing/measure-context-read-product.test.mjs` | 0 / 27 | 0 / 27 |
| `tools/testing/measure-topic-reader-wal.test.mjs` | 0 / 7 | 0 / 7 |

Node **22.16.0**: **36 commands, every exit 0; 650/651 passed, 1 existing skip, 0 failures and 0 cancellations**.
Node **24.15.0**: **36 commands, every exit 0; 650/651 passed, 1 existing skip, 0 failures and 0 cancellations**.

The complete serial matrix exited **0**. After the final test-only refinement
of the unpaired assertion order, the new suite was rerun on both runtimes:
**23/23, exit 0 each**. The same final suite against `cf60a27f` again produced
**21 failures / 2 controls passed, exit 1 each**; its first unpaired failure was
acceptance of the unsupported estimate. Ordinary discovery without VM flags
also exited **0 on each runtime**, with its one wrapper requiring the complete
inner suite to exit 0. All four implementation files were unchanged throughout
the matrix and final regression reruns.

The one existing assembly counter test skips because `tiktoken` is unavailable.
No dependency was installed. Functional-only CLI children deliberately return
`inconclusive` / exit 1; the functional test commands assert that behavior and
exit 0. No production qualification gate was measured.

Each changed JavaScript file also ran with `--check <explicit-path>`:

| Syntax-check path | Node 22.16.0 exit | Node 24.15.0 exit |
| --- | --- | --- |
| `tools/testing/fixtures/context-product/controller.mjs` | 0 | 0 |
| `tools/testing/fixtures/context-product/protocol.mjs` | 0 | 0 |
| `tools/testing/fixtures/context-product/series.mjs` | 0 | 0 |
| `tools/testing/measure-context-read-product-fix2.test.mjs` | 0 | 0 |
| `tools/testing/measure-context-read-product.mjs` | 0 | 0 |

The standalone `--estimate` command exited **0 on Node 22.16.0** and **0 on
Node 24.15.0**, with the exact default arithmetic stated above. The final new
test file also passed `--check` again after its test-only refinement, exit **0**
on each runtime.

### Changed files, cross-checked two ways

The inventory from `git diff --name-only HEAD` plus
`git ls-files --others --exclude-standard` was independently re-derived by
comparing HEAD tree blob IDs with hashes of working files and discovering new
files with `rg --files --hidden`. The sorted inventories matched: **6 files**.

- `docs/plans/context-read-p2d-harness-impl.md`
- `tools/testing/fixtures/context-product/controller.mjs`
- `tools/testing/fixtures/context-product/protocol.mjs`
- `tools/testing/fixtures/context-product/series.mjs`
- `tools/testing/measure-context-read-product-fix2.test.mjs`
- `tools/testing/measure-context-read-product.mjs`

Final `git diff --check`, an independent trailing-whitespace/final-newline check
over all six files, `git diff --cached --exit-code`, and the diff check over
`core`, `packages/setup/runtime`, the frozen contract and packaging manifest
all exited **0**. Source hashes for all five JavaScript files were checked
against the final tested content. Nothing is staged or committed; HEAD remains
`cf60a27f` on `feat/context-read-p2d-harness`. Owned verification logs were
removed after recording the results. No test, measurement or monitor is left
running for unattended supervision.


## P2-product-v4 encoding

Base: `0cf0e3d3`, with `origin/main` at `3b6b57f6` integrated by a clean
`git merge --no-commit origin/main`. The merge remains pending for the primary;
HEAD has not advanced. The accepted contract is byte-identical to origin/main.
No contract text or engine runtime module was edited for this encoding.

`v4-definition.json` contains Appendix V4-A, Revision 1, as declarative data.
`v4-plan.mjs` exposes two frozen definitions, `DEFINITIONS.engine` and
`DEFINITIONS.production`, expands the registered rows, rejects duplicate cell
and request-population keys, sorts numeric worlds/schemas before appendix order,
and independently compares every expanded count with the appendix. Assembly
aliases translate `maxItems` to the existing harness's `limit` field; the exact
public budget is still checked by `validateWorkload`.

Real qualification defaults to v4 and requires explicit `--profile engine` or
`--profile production`, plus a pre-registered `--segment ID`. Arithmetic defaults
to the engine column. `--protocol v3` preserves the previous 7,520-cell plan and
its execution path. Functional-only and the existing operation-only smoke path
retain their non-qualification decisions; neither was used for timing here.
The report header records the selected platform profile, protocol and revision,
full immutable inventory/hash, workload/environment inputs, estimate, reservation,
segment definitions and the unchanged gates. It copies the exact V4.2 claims
table, V4.7 coverage table and explicitly unclaimed list from `v4-claims.json`.

| Delta rule | Code | Deterministic regression in `measure-context-read-product-v4.test.mjs` |
| --- | --- | --- |
| V4.1 unchanged populations, gates and fresh lifecycle | Existing `protocol.mjs`, `engine.mjs`, `series.mjs`; v4 request series attach cold and idle references only where registered. `normalDecision` retains known failures independently of incomplete coverage. | Exact plan/series attachment; loaded requests collect main only, failures advance language ordinals and never supply successes. Existing P2-19/P2-23/fix-round suites remain required. |
| V4.2 two platform profiles and supplied production inputs | `v4-runner.mjs:validateV4Registration` and `runV4`; common registration validation remains in the CLI. Both profiles require the registered exact Node 24 patch; production additionally checks actual Linux/non-WSL/ext4. Existing protected workspace/copy/engine permission checks apply. | Missing host/volume/patch/capacities/reservation/deadline provenance/session/segment inputs refuse before collection. Null capture/review deadlines remain inconclusive through the existing writer gates. |
| V4.3 R1-R7, language rotation, disjoint percentile populations | `v4-definition.json`, `v4-plan.mjs:buildV4Plan`, `rotatingCell`, existing `requestSeries` with per-attempt preparation. | Exact independent arithmetic; production mixed adapters remain compact-only; no loaded cold/reference attachment; failures consume ordinal and ceiling. |
| V4.4 method-specific successful exposure | `v4-validation.mjs:validateExposure` re-derives clipped intersections after final telemetry drain, de-duplicates cell/window/attempt/method/target, checks independent 20/10 credits and three-window spread, plus every per-window/baseline minimum. | Successful control; unavailable/failed/unvalidated/bounds/oracle/WM/out-of-window exclusions; write/close intersection; spread; separate W3 targets without a fresh-close requirement. |
| V4.4 labelled rotating mix and unique paired windows | `windowSlot`, `v4-windows.mjs:exposureCell`; five fresh pairs or eight retained pairs, odd-order reversal, separate placement/build for every member. W3 uses two retained connections with the frozen same/other capture/review cycle. `v4-writer.mjs` records both shutdown closes and per-target writer statistics. | Exact slot formula/mix/deduplication; actual orchestration with a manual clock, unique clones, immutable durations and pair reversal. No process or SQLite is started by this orchestration test. |
| V4.4 WM | `windowReferences` immediately follows final-reader writer stop/drain, interleaves four independently counted reference series and keeps the identical pump until all finish. `startPump` records renewals/status/activity/drain; `validateWM` checks identity, ordering, intervals and coverage. Existing candidate reference 300/1,500-ms gates apply. | Four 50-success populations, per-series language ordinals including failures; replacement/readiness-wait/missing-activity/incomplete-telemetry rejection; integrated W-to-WM orchestration. |
| V4.5 shared F/A sessions | `v4-session.mjs`, `v4-lane.mjs`, `v4-writer.mjs`; twelve fixed 180-second sessions, twenty serial probe lanes and a separate availability lane. Actual scheduled IDs, method/intent allocation, native commits and exits reconcile before decisions. Freshness quantiles remain separate by type/intent and retain explicit infinity flags. | Per-intent method alternation and balance; 99/1 and omitted/duplicate/substituted/reordered release rejection; session span, writer lifecycle/target/cycle/tail/seal checks. |
| V4.5 first eligible revisions and fixed target recipes | `v4-eligibility.mjs` is a fixed, bounded intrinsic recorder used by the writer journal. It associates recognized canonical mutations with their own successful native COMMIT, never a later bookkeeping commit. Memory history/current and confirmed Card intent events are distinct. Native diagnostic chunks remain numeric and contain no SQL or target identities; target metadata transfers separately after the public operation. | Earlier Memory history commit/revision survives later bookkeeping/review; Card drafts cannot qualify, and Card intents share a timestamp only at actual confirmation. Intrinsic observer test verifies target metadata never enters diagnostic chunks. |
| V4.5 O/B | Overflow retains selected-scope main/cold populations. `backupSeries` rebuilds both intents and independently opens/verifies each restored intent, including its loop observations and all five existing output timings. The unchanged §9 P2-04 physical-v18/old-pin acceptance remains required. | Exact O/B counts; both restored intents use independent fresh handles; history refusal prevents completion. Required core P2-04 tests cover physical-v18 preservation and old-pin reopen. |
| V4.5 T: 60 cells / 288 mandatory subprobes | Exact manifest/defaults in the definition; `v4-state.mjs:stateCell` resets each branch and records immutable cutoff, entry, settlement, cleanup, writer progress and exit evidence. The injection-only native SQLite rendezvous runs in the reader Worker; ordinary Workers never load it. `validateSubprobes` refuses missing/unknown/duplicate IDs and checks each expected outcome independently. | Every branch of all five manifests is independently removed or given the wrong outcome. All eight abort-family branches independently lose cleanup/progress/disposal evidence or miss settlement. No real native hold or timing workload is run by these regressions. |
| V4.6 arithmetic correction and reservation | `estimateV4` computes separate serial cost components, including 53 main/warm-up attempts, idle cold, idle/WM references, 432/224 placements, sessions, storage, T and failure allowances. | Exact 728/488 cells, 432/224 windows, 252/172 references, 288 subprobes and both estimates/reservations; CLI equality and preserved v3 estimate. |
| V4.6 admission/observation supervision | `admissionBudget` and the active runner check projected remaining work, actual record/child activity and progress. Stop reasons prevent admitting more cells; owned resources still drain. V4 ordinary actors and storage work have no slow-sample kill watchdog. Fixed windows keep their original end times. | Fabricated projected-overrun/stalled-activity/missing-progress admission; manual-clock W orchestration proves fixed windows; no budget result contains a sample-termination action. |
| V4.6 checkpoints/segments | `v4-checkpoints.mjs`, `mergeSegments`, CLI `--resume REPORT` and `--merge REPORT`. Require the same registration/source/workload, host, volume, patch and pre-registered segment identity; retain raw journals and only merge complete cell records. Duplicates refuse instead of replacing a faster repeat. Known failures in interrupted raw records remain a failure latch. Malformed checkpoint reports fail closed. | Identity changes, duplicate cells, incomplete-record exclusion and prior-failure retention; real journal/partial-file regression proves an interrupted failed cell cannot be erased by a later passing complete cell. |
| V4.7 claim boundaries | `v4-claims.json` is copied into every v4 header, alongside exact profile/inventory. Engine qualification has no production-launch claim. | Copied appendix and every claims-table/unclaimed string match the accepted contract as data. |

The existing lock-safe boundary is retained: database copy/hash work remains in
`io-child.mjs`; the host only streams suffix-validated numeric checkpoint reports
and performs metadata-only absent-sidecar checks. Four exact guard allowances
cover these new imports/streaming sites; the estimate-registration allowance is
updated to its revised expression. SQLite-reaching imports remain inside the
existing dynamic boundaries. No runtime change, package installation, network,
key use or generated setup-runtime update is part of this work.

For a real run the primary supplies the original frozen fixture/adapter/counter,
labels/queries and workload inputs, plus `host` and `volume` identities, the
exact Node patch, `deadlineProvenance`, `telemetryCapacities`, `drainSchedule`,
`reservation`, `observationBudgetMs`, `supervision`, `stateDeadlines`, frozen
`stateProbes`, twelve `sessions`, and pre-registered `segments` containing IDs
and cell keys. Session schedules declare targets, creation/review releases,
batches/queries, availability IDs/times and lane capacities. The adapter's
existing `prepare` receives the scalar rotated cell, and for probes the frozen
`probeBatch`, intent-specific `probeTargets` and all first-eligible committed
target proofs. Its `validateProbe` independently verifies batch membership;
unsupported batching cannot pass. Preparation/oracle work remains outside the
observed read interval. The primary still supplies a quiet reservation and live
supervision; saving this report starts no monitor or unattended run.

P2c/four-namespace and P2d-WAL availability remain actual capability probes,
never operator readiness switches. This implementation and its deterministic
tests make no platform timing/production acceptance claim.

### Estimate outputs

Both exact runtime executables ran these read-only commands; each exit was 0:

```sh
node tools/testing/measure-context-read-product.mjs --profile engine --estimate
node tools/testing/measure-context-read-product.mjs --profile production --estimate
```

| Profile | Cells | Fixed windows | Idle + WM references | Estimated seconds | Reservation |
| --- | ---: | ---: | ---: | ---: | --- |
| Engine | 728 | 432 | 108 + 144 = 252 | 46,627.4 | 47,700 s = 13 h 15 min |
| Production | 488 | 224 | 92 + 80 = 172 | 26,284 | 27,000 s = 7 h 30 min |

The complete JSON outputs, identical on both patches, are:

```json
{
  "engine": {
    "protocol": "P2-product-v4",
    "revision": 1,
    "profile": "engine-platform-v4",
    "request": 532,
    "exposure": 36,
    "freshness": 40,
    "availability": 24,
    "overflow": 24,
    "storage": 12,
    "state": 60,
    "stateSubprobes": 288,
    "cells": 728,
    "main": 556,
    "warmupGroups": 556,
    "cold": 420,
    "idleReference": 108,
    "windowReference": 144,
    "reference": 252,
    "fixedWindows": 432,
    "writeSuccessCredits": 9600,
    "freshCloseSuccessCredits": 2400,
    "costSeconds": {
      "mainAndWarmups": 16207.4,
      "cold": 4200,
      "idleReferences": 1620,
      "windowReferences": 2160,
      "fixedWindows": 12960,
      "sharedSessions": 2160,
      "storage": 1080,
      "state": 480,
      "placements": 2160,
      "failuresAndSlowOperations": 3600
    },
    "estimateSeconds": 46627.4,
    "reservationSeconds": 47700,
    "inventoryHash": "500a41f1ba8adb60e5d5e7bb0e5b9dd523017bb762bc4f5355f0f1619b689d0a",
    "assumption": "Planning allowances, not timeouts or measured timings; slower attempts are never censored."
  },
  "production": {
    "protocol": "P2-product-v4",
    "revision": 1,
    "profile": "production-launch-v4",
    "request": 308,
    "exposure": 20,
    "freshness": 40,
    "availability": 24,
    "overflow": 24,
    "storage": 12,
    "state": 60,
    "stateSubprobes": 288,
    "cells": 488,
    "main": 332,
    "warmupGroups": 332,
    "cold": 292,
    "idleReference": 92,
    "windowReference": 80,
    "reference": 172,
    "fixedWindows": 224,
    "writeSuccessCredits": 4800,
    "freshCloseSuccessCredits": 1600,
    "costSeconds": {
      "mainAndWarmups": 8798,
      "cold": 2628,
      "idleReferences": 1150,
      "windowReferences": 1000,
      "fixedWindows": 6720,
      "sharedSessions": 2160,
      "storage": 720,
      "state": 300,
      "placements": 1008,
      "failuresAndSlowOperations": 1800
    },
    "estimateSeconds": 26284,
    "reservationSeconds": 27000,
    "inventoryHash": "7f70e1cbf2558bcb1d167fc2c593916aec01a2e1529a8794a7c06d103072de99",
    "assumption": "Planning allowances, not timeouts or measured timings; slower attempts are never censored."
  }
}
```

### Verification commands and actual exit codes

Each command used the exact nvm-installed executable, with that executable's
binary directory first in PATH for it and its children. No stdout pipeline
provided a status; subprocess return codes and TAP totals were captured directly.

```sh
NODE22="$NVM_DIR/versions/node/v22.16.0/bin/node"
NODE24="$NVM_DIR/versions/node/v24.15.0/bin/node"
"$NODE22" --version
"$NODE24" --version
# Each ordinary explicit path in the table, serially, on each runtime:
PATH="$NVM_DIR/versions/node/v22.16.0/bin:$PATH" "$NODE22" --test --test-reporter=tap <explicit-path>
PATH="$NVM_DIR/versions/node/v24.15.0/bin:$PATH" "$NODE24" --test --test-reporter=tap <explicit-path>
# Fix-round-2 exposes all cases with its established VM test seam:
"$NODE22" --experimental-vm-modules --test --test-reporter=tap tools/testing/measure-context-read-product-fix2.test.mjs
"$NODE24" --experimental-vm-modules --test --test-reporter=tap tools/testing/measure-context-read-product-fix2.test.mjs
# Source checks, one command for each changed JavaScript path:
"$NODE22" --check <explicit-changed-JavaScript-path>
"$NODE24" --check <explicit-changed-JavaScript-path>
# Arithmetic only, on each runtime:
node tools/testing/measure-context-read-product.mjs --profile engine --estimate
node tools/testing/measure-context-read-product.mjs --profile production --estimate
node tools/testing/measure-context-read-product.mjs --protocol v3 --estimate
```

Both version commands exited **0**, printing **v22.16.0** and **v24.15.0**.
All six standalone estimate commands exited **0**. The v3 estimate retains
7,520 cells and 1,728,000,000 fixed-window milliseconds. Every one of the
**23 changed JavaScript files** passed its individual syntax check on each
runtime: **46 final per-file exit codes, all 0**. Final source hashes were
checked unchanged across the corresponding tests/checks.

The core test inventory was independently derived from filesystem glob and
`rg --files`, with identical **29-path** sets. Both lock guards, four harness
suites, the explicit tiny functional suite and E1-C2 tests make **37 distinct
paths per runtime**. The table gives each path's final actual exit / passed count;
it combines the full explicit-path sweep with final affected-source reruns.

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
| `tools/testing/measure-context-read-product.test.mjs` | 0 / 27 | 0 / 27 |
| `tools/testing/measure-context-read-product-fix1.test.mjs` | 0 / 26 | 0 / 26 |
| `tools/testing/measure-context-read-product-fix2.test.mjs` | 0 / 23 | 0 / 23 |
| `tools/testing/measure-context-read-product-v4.test.mjs` | 0 / 47 | 0 / 47 |
| `tools/testing/fixtures/context-product/functional-check.mjs` | 0 / 9 | 0 / 9 |
| `tools/testing/measure-topic-reader-wal.test.mjs` | 0 / 7 | 0 / 7 |

Node **22.16.0**: **37 distinct paths, every final exit 0; 697/698 passed, 1 existing skip, 0 failures and 0 cancellations**.

Node **24.15.0**: **37 distinct paths, every final exit 0; 697/698 passed, 1 existing skip, 0 failures and 0 cancellations**.

The new v4 suite contributes **47 deterministic checks on each runtime**, all
exit **0**. It also verifies SQLite-free CLI import, exact stored-identity
metadata after normalization/revision changes, invalid missing-loop evidence
versus retained measured failures, and cleanup when T sampler/locker startup
fails. Absolute window boundaries and repetition/variant labels are journaled
before execution so overlap credits can be independently reconstructed.
Insufficient F/A populations retain their statistics but receive an inconclusive
quantity verdict; known independent failures remain failures.

The initial 74-command sweep exited **1**: the then-new Node-22 v4 fixture ended
its availability releases too early, causing four positive-fixture assertions
to reject. The corrected schedule spans the final session slot. The affected
commands were rerun on both patches after source refinement; the final affected
matrix and subsequent final v4 runs exited **0**. Earlier development checks also
reported exit **1** for the new exact filesystem allowances, a temporary local
variable name collision, and a v3 pump test double without the v4 status API.
Those were fixed; v3 tracing remains conditional and all final guard/harness
commands in the table exit **0**. No failure is being inferred away from a
successful output tail.

The existing assembly counter skip is because `tiktoken` is unavailable; nothing
was installed. Functional-only CLI children intentionally print `inconclusive`
and exit **1**; their test wrappers assert that behavior and exit **0**. No
qualification timing run, smoke, network/key operation or unattended process
was started. Actual opt-in platform execution remains the primary's quiet-window
work, with the product inputs and package capabilities described above.

Final refinements also check that the same pump API object survives renewal,
record actual active status/quanta before shutdown, distinguish missing loop
proof (invalid) from observed threshold failures, and use bounded `get` by the
publicly returned identity to refresh stored writer metadata. The latter avoids
raw-text equality and whole-list selection when capture normalizes text or
returns a revision older than the canonical stored revision. T startup failure
regressions verify restoration, supervisor drain and retained actual locker
exit codes. All 47 final v4 cases pass on both patches.

### Changed files, cross-checked two ways

The inventory from `git diff --name-only HEAD` plus untracked enumeration was
independently re-derived by comparing every HEAD tree blob/mode with the working
file and finding new files with `rg --files --hidden`. The sorted sets agree at
**28 files**: one accepted-contract merge-only file and 27 implementation,
test/data and handoff changes. `scripts/`, `public/`, package/configuration files
and all other tracked/untracked paths were included in that comparison.

- `core/test/fixtures/no-raw-db-fd-allowlist.json`
- `docs/plans/context-read-p2d-harness-impl.md`
- `docs/plans/context-read-product.md` — merge-only, byte-identical to origin/main
- `tools/testing/fixtures/context-product/actors.mjs`
- `tools/testing/fixtures/context-product/controller.mjs`
- `tools/testing/fixtures/context-product/engine.mjs`
- `tools/testing/fixtures/context-product/runner-child.mjs`
- `tools/testing/fixtures/context-product/series.mjs`
- `tools/testing/fixtures/context-product/storage-child.mjs`
- `tools/testing/fixtures/context-product/v4-checkpoints.mjs`
- `tools/testing/fixtures/context-product/v4-claims.json`
- `tools/testing/fixtures/context-product/v4-definition.json`
- `tools/testing/fixtures/context-product/v4-eligibility.mjs`
- `tools/testing/fixtures/context-product/v4-lane.mjs`
- `tools/testing/fixtures/context-product/v4-native-loader.mjs`
- `tools/testing/fixtures/context-product/v4-native-preload.mjs`
- `tools/testing/fixtures/context-product/v4-native-sqlite.mjs`
- `tools/testing/fixtures/context-product/v4-plan.mjs`
- `tools/testing/fixtures/context-product/v4-runner.mjs`
- `tools/testing/fixtures/context-product/v4-session.mjs`
- `tools/testing/fixtures/context-product/v4-state.mjs`
- `tools/testing/fixtures/context-product/v4-validation.mjs`
- `tools/testing/fixtures/context-product/v4-windows.mjs`
- `tools/testing/fixtures/context-product/v4-writer.mjs`
- `tools/testing/fixtures/context-product/writer-journal.mjs`
- `tools/testing/measure-context-read-product-fix1.test.mjs`
- `tools/testing/measure-context-read-product-v4.test.mjs`
- `tools/testing/measure-context-read-product.mjs`

Final whitespace/newline/JSON/source-hash checks and `git diff --check HEAD`
exit **0**. The contract matches the accepted merge source byte for byte.
The engine runtime, generated setup runtime, package and packaging manifest
comparison exits **0**. The index contains only the accepted contract brought
in by the pending merge; implementation files were not staged or committed.
HEAD remains `0cf0e3d3`, MERGE_HEAD is `3b6b57f6`. The primary commits.
Owned verification logs are removed after recording the results above; no
process, measurement or monitor is left running.

## v4 encoding fix round 1

Base `06743bd8`; both non-author reviews were read in full. This round fixes
all nine distinct P1 findings without changing engine runtime sources, frozen
protocol definitions, populations, counts or estimates. There was no timing
run, smoke, network/key access or commit.

### Findings, implementation and regressions

1. **Stopped profiles could pass.** `v4-runner.mjs` now makes any supervision
   stop inconclusive unless a failure is already known. Both profile and segment
   completeness are false after a stop, including when all cells finished.
   The new `measure-context-read-product-v4fix1.test.mjs` executes the real runner
   with manual supervision callbacks during its final cell, separately covering
   projected overrun, stalled activity and missing progress, plus a retained
   prior failure control.
2. **Interrupted latency failures disappeared.** The checkpoint failure latch
   now checks the maximum for each registered method and population, using
   lifecycle elapsed time for main/cold/restored reads and read-call time for
   idle references and WM. It resolves rotating method labels and the implicit
   candidate method of backup verification. Existing loop, overshoot, late data,
   WAL busy, bounds and oracle failures remain latched; writer deadline and
   error gates are retained too. The new tests journal each maximum violation,
   interrupt, then merge a faster completed segment: the decision remains failed.
   Separate controls check the selected clocks, require actual writer overlap
   for loaded successes (including final overlap reconciliation), and preserve
   W's lack of a latency claim. The prior failure evidence is never pooled into new samples.
3. **Exceptions manufactured complete cells.** The runner writes exception
   cells/checkpoints with `complete:false`, preserving the failure record and
   excluding the cell from completed counts. A mid-T exception regression checks
   the missing cell, checkpoint admission and execution again on resume with
   the earlier failure retained. Only genuine completion records enter a merge.
4. **Shared sessions missed the parent's loop.** `v4-session.mjs` observes the
   measuring process from lane startup through pump renewal, pending reads,
   pump drain and final lane shutdown, journals the parent loop, and includes it
   in every session cell's participating-process union. Harness synchronous
   preparation, validation and serialization pause that observation. The new
   manual-loop tests inject a 150 ms parent gap in renewal, pump shutdown and
   lane shutdown while child loops remain clean; every cell fails its loop gate.
   Healthy and slow-harness-validation controls pass.
5. **Lane failures hung pending work.** `actors.mjs` supports one waiter with
   alternative message types; sessions await either the matching read result or
   lane failure. Rejections stop admission, settle the pending ledger, journal
   failure evidence, drain the writer/pump and stop all lanes before propagating
   failure. `v4-lane.mjs` preserves a sanitized failure code. Regressions cover
   explicit lane failure, rejected waits and the real actor waiter's alternative
   delivery; they assert resource drain and retained evidence.
6. **Checkpoint paths reached database descriptors.** The measuring process's
   `v4-checkpoints.mjs` now delegates all operator report/journal reads to
   `v4-checkpoint-child.mjs`, a short SQLite-free child with explicit status,
   signal/error checks and a bounded output transfer. The child uses `lstat`
   before opening each path, rejects symlinks/non-regular files and opens with
   `O_NOFOLLOW`. Journals are streamed; raw attempt populations are not retained.
   The raw-fd allowlist has no checkpoint-reader allowance in the measuring
   process; its new exact entries are child-only. Regressions cover a database
   named `canonical.sqlite.jsonl`, a link to that database, a link to a valid
   report, a linked journal and a directory. An instrumented parent verifies zero
   raw opens even when parsing the database-named path refuses it.
7. **The spread regression had an unrelated failure.** The corrected fixture in
   `measure-context-read-product-v4.test.mjs` recomputes each duplicated slot's
   method/language/intent with the registered rotating schedule. Its only
   remaining errors are method spread minima. The new mutation regression
   confirms that removing both spread checks makes this otherwise valid fixture
   pass validation; the original rejection assertion therefore fails. Separate
   isolated mutation runs compare the original and corrected test itself.
8. **WM initialization bypassed validation.** `engine.mjs` retains the
   initialization result, validates its closed shape, bounds/functional checks,
   selected-projection oracle and partial-coverage rule before the measured
   read, and combines that outcome with the measured result. Failed or thrown
   initialization cannot become an accepted sample. Initialization and final
   cleanup loop intervals are combined; harness validation remains outside
   observation. Regressions put oracle, bounds/functional and public-failure
   defects in initialization followed, where applicable, by a correct read.
9. **Crash quarantine was assumed.** `v4-state.mjs` now observes the existing
   supervisor ownership seam, starting at public settlement and recording every
   quarantine-latch transition through verified Worker/native disposal. It
   derives `supervisedUntilDisposal` from that evidence, requiring actual owned
   resources and disposal proof. The mock crash regression releases quarantine
   at `reader_failed` settlement but eventually disposes everything: all four
   crash subprobes become invalid instead of passing. Its held-quarantine control
   passes. No engine module or ordinary reply-delivery path changes.

Counts remain **728 / 488 cells**, **432 / 224 fixed windows**, **252 / 172
references**, and **46,627.4 s / 26,284 s** estimates. The existing v4 arithmetic
and CLI-estimate tests check both profiles, declarative appendix and claims.

### Changed files

The inventory was derived from `git diff --name-only 06743bd8` plus Git
untracked enumeration, then independently from index blob hashes compared with
worktree bytes plus an `rg --files --hidden` walk for untracked files. The
worktree Git metadata file is excluded from the filesystem walk. The sorted
inventories agree at **12 changed files**, including this report and both
new files; scripts, docs, assets and configuration were included in the walk.

- `core/test/fixtures/no-raw-db-fd-allowlist.json`
- `docs/plans/context-read-p2d-harness-impl.md`
- `tools/testing/fixtures/context-product/actors.mjs`
- `tools/testing/fixtures/context-product/engine.mjs`
- `tools/testing/fixtures/context-product/v4-checkpoint-child.mjs`
- `tools/testing/fixtures/context-product/v4-checkpoints.mjs`
- `tools/testing/fixtures/context-product/v4-lane.mjs`
- `tools/testing/fixtures/context-product/v4-runner.mjs`
- `tools/testing/fixtures/context-product/v4-session.mjs`
- `tools/testing/fixtures/context-product/v4-state.mjs`
- `tools/testing/measure-context-read-product-v4.test.mjs`
- `tools/testing/measure-context-read-product-v4fix1.test.mjs`

### Verification commands and actual exit codes

Each command used the exact nvm Node **22.16.0** or **24.15.0** executable,
with that runtime first in PATH. Both `node --version` commands exited **0**.
Tests ran sequentially by explicit path, through
`node tools/testing/run.mjs --test-reporter=tap <path>`; process return codes
were captured directly, independently of reporter output. All **74 file
invocations exited 0**, including the v4 suite, prior harness regressions, all
29 required context-read files, both lock guards and E1-C2.

The 37-path test inventory was independently checked against an `rg --files`
walk; the required context-read subset was also cross-checked using a filesystem
glob. Both routes agree: **37 total files / 32 required files**.

| Explicit test path | Node 22.16.0 exit | Node 24.15.0 exit |
| --- | --- | --- |
| `tools/testing/measure-context-read-product-v4fix1.test.mjs` | 0 | 0 |
| `tools/testing/measure-context-read-product-v4.test.mjs` | 0 | 0 |
| `tools/testing/measure-context-read-product.test.mjs` | 0 | 0 |
| `tools/testing/measure-context-read-product-fix1.test.mjs` | 0 | 0 |
| `tools/testing/measure-context-read-product-fix2.test.mjs` | 0 | 0 |
| `core/test/context-read-assembly-races.test.mjs` | 0 | 0 |
| `core/test/context-read-assembly-readonly.test.mjs` | 0 | 0 |
| `core/test/context-read-assembly.test.mjs` | 0 | 0 |
| `core/test/context-read-bm25.test.mjs` | 0 | 0 |
| `core/test/context-read-budget.test.mjs` | 0 | 0 |
| `core/test/context-read-core.test.mjs` | 0 | 0 |
| `core/test/context-read-default-entropy.test.mjs` | 0 | 0 |
| `core/test/context-read-embedder.test.mjs` | 0 | 0 |
| `core/test/context-read-fusion.test.mjs` | 0 | 0 |
| `core/test/context-read-local-embedder.test.mjs` | 0 | 0 |
| `core/test/context-read-local-status.test.mjs` | 0 | 0 |
| `core/test/context-read-moc-source.test.mjs` | 0 | 0 |
| `core/test/context-read-process.test.mjs` | 0 | 0 |
| `core/test/context-read-product-artifact.test.mjs` | 0 | 0 |
| `core/test/context-read-product-control.test.mjs` | 0 | 0 |
| `core/test/context-read-product-import.test.mjs` | 0 | 0 |
| `core/test/context-read-product-index.test.mjs` | 0 | 0 |
| `core/test/context-read-product-pump.test.mjs` | 0 | 0 |
| `core/test/context-read-product-service.test.mjs` | 0 | 0 |
| `core/test/context-read-product.test.mjs` | 0 | 0 |
| `core/test/context-read-recovery.test.mjs` | 0 | 0 |
| `core/test/context-read-review.test.mjs` | 0 | 0 |
| `core/test/context-read-sidecar.test.mjs` | 0 | 0 |
| `core/test/context-read-source-work.test.mjs` | 0 | 0 |
| `core/test/context-read-sources-authority.test.mjs` | 0 | 0 |
| `core/test/context-read-sources-bounds.test.mjs` | 0 | 0 |
| `core/test/context-read-sources-races.test.mjs` | 0 | 0 |
| `core/test/context-read-sources.test.mjs` | 0 | 0 |
| `core/test/context-read-tokenize.test.mjs` | 0 | 0 |
| `core/test/no-raw-db-fd.test.mjs` | 0 | 0 |
| `core/test/sqlite-lock-safety.test.mjs` | 0 | 0 |
| `tools/testing/measure-topic-reader-wal.test.mjs` | 0 | 0 |

Both assembly-suite runs report the existing A13 skip: the optional
`tiktoken` package is unavailable. Each still exits **0**, with 19 passes and
one skip; no dependency installation was attempted. Other required file runs
have no skipped, cancelled or failed tests.


After the final overlap-latch and observer guards, the five harness files and
raw-fd guard above were rerun by the same explicit-path command on both patches:
**12 final file invocations, every exit 0**. The new regression file also ran
directly with
`node --experimental-vm-modules --test --test-reporter=tap tools/testing/measure-context-read-product-v4fix1.test.mjs`:
**33/33 passed, exit 0 on each patch**, with no skips or cancellations.

For before/after evidence, the same direct command with
`P2D_V4FIX1_BASE=06743bd8` loads the reviewed implementation sources from
`git show` through VM dependency doubles. Both patch runs exit **1**, with
**28 failed / 5 passed**. The failures reproduce stopped passes, erased latency
failures (including final overlap reconciliation and restored verification),
false completion, raw parent opens, omitted parent loop gates, hung lane work,
unvalidated initialization and early quarantine release. The five passing cases
are controls, including the explicit spread-mutation comparison; this is not a
claim that every newly added assertion fails on the base.

The spread check was additionally mutation-tested against the original v4 test
itself, using an isolated temporary VM loader and
`node --experimental-vm-modules --test --test-reporter=tap --test-name-pattern='method write and close successes must each span three windows' <loader>`.
The loader removes both production window-spread checks and runs the original
or corrected test source without editing the worktree:

| Node patch | Original fixture + removed spread checks | Corrected fixture + removed spread checks |
| --- | --- | --- |
| 22.16.0 | exit 0 (missed mutant) | exit 1 (caught mutant) |
| 24.15.0 | exit 0 (missed mutant) | exit 1 (caught mutant) |

Development runs of the new file initially exited **1** while correcting its
VM JSON dependency handling, manual-clock stop precedence, observation assertions
and crash method double. Those fixture failures were corrected before the final
runs above. They are not counted as passing verification. Initial inventory
comparison also exited **1** because the independent walk included the worktree's
Git metadata file; excluding that metadata yields the matching 12-file inventory.

All **10 changed JavaScript files** passed `node --check` on both patches:
**20 invocations, each exit 0**. Final `git diff --check`, the independent
trailing-whitespace/final-newline scan over all 12 files, the added-local-path
check and the inventory `diff -u` each exited **0**. `git diff --cached
--exit-code` exited **0**; the core JavaScript, frozen contract and generated
setup runtime comparison against `06743bd8` also exited **0**. The branch remains
at `06743bd8`, with 12 unstaged changed files. Verification processes finished;
owned temporary loaders/logs were removed after recording these results.

## v4 encoding fix round 2

Base `55ad96fb`; both re-reviews were read in full, together with the original
nine lessons and four additional lessons. This round addresses the three
remaining findings. Engine runtime sources, lazy SQLite boundaries, raw-fd
allowances, frozen protocol data, counts and estimates remain unchanged. No
timing run, smoke, network/key operation or commit was performed.

### Findings, fixes and regressions

1. **Async harness continuations entered the parent-loop gate (P1).**
   `v4-session.mjs` now runs session orchestration in an explicit harness async
   scope. Preparation still uses the targets learned from the live writer.
   A small async-hook bracket excludes each synchronous harness callback
   and continuation, including preparation, probe validation/oracle work,
   record construction, serialization and byte accounting after an `await`.
   Parent engine entry points use an explicit `engine()` boundary; their
   asynchronous descendants (including independent pump callbacks) stay
   observed while harness preparation is awaiting. Scope restoration preserves
   the prior observer state, including the callback already running when hooks
   are enabled. Hooks are disabled when final observation finishes.
   The extended `measure-context-read-product-v4fix1.test.mjs` fixture places
   `await Promise.resolve()` before fabricated 150 ms preparation, oracle and
   record blocks: none appears in the parent loop. Separate 150 ms blocks in
   async pump renewal/shutdown and an independently created engine callback
   delivered during async preparation remain observed and fail both session
   cells. The real pump helper also excludes async configuration and trace
   construction through its optional harness boundary, preserving observed
   renewal, drain, pump close and supervisor close. Writer control, diagnostic
   ledger validation and statistics stay in the harness scope; the independent
   writer engine remains gated by its child loop. Additional regressions inject
   async writer bookkeeping and exercise the real pump helper with manual
   timers and fabricated engine calls. Existing synchronous renewal, pump
   shutdown, lane shutdown and
   lane-failure/resource-drain regressions remain in the suite.
2. **Resume erased completed-population p95 failures (P1).**
   The SQLite-free checkpoint child now keeps per-population success/threshold
   counters and scalar final-overlap reconciliation slots for the current
   cell, evaluating its completed percentile populations at cell boundaries
   and journal EOF. It retains the failure latch through a faster resumed
   segment without pooling samples. Main/cold method populations, overflow,
   initialized idle references, all four separate WM method/intent populations,
   restored-reader verification and freshness type/intent populations are
   covered. Minimum success counts and the lifecycle versus initialized-read
   clocks remain distinct; a transient prefix p95 is not prematurely latched.
   Regressions include the reviewer's 50 candidate successes at 800 ms for
   1,112 items against the 700 ms p95 gate, every other percentile population,
   boundary/EOF evaluation, late overlap reconciliation and faster-resume
   retention. Controls exclude failed attempts, incomplete populations and
   repaired prefix percentiles, and prohibit pooling WM populations.
3. **Parent blocks lacked scheduling attribution (P2).**
   Shared sessions now start the existing SQLite-free sampler for the parent
   PID before observation. It samples the process's main/Worker threads'
   schedstat runtime/run-queue/slice counters and vmstat through the same actor
   used elsewhere. Sample transfer and final stop occur only after parent
   `loop.finish()`, including error cleanup. Parent records carry `hostPid`;
   `attributeBlocks()` attaches scheduling deltas to each block alongside the
   existing GC/resource evidence. Unsupported platforms, missing bracketing
   samples/main-thread data, dropped coverage and sampler failure explicitly
   mark block scheduling `coverage:'incomplete'`. Attribution stays diagnostic;
   measured loop failures still fail. Manual-sample regressions assert both
   thread deltas and vmstat deltas, reject collection before finish, and cover
   all six complete/incomplete attribution cases.

Counts stay **728 / 488 cells**, **432 / 224 fixed windows**, **252 / 172
references**, with **46,627.4 s / 26,284 s** estimates; the v4 inventory and
CLI-estimate regressions check these unchanged values.

### Changed files, cross-checked two ways

The first inventory uses `git diff --name-only 55ad96fb` and Git's untracked
file enumeration. The second independently compares every base tree blob hash
and file mode with worktree bytes, then adds new paths from an
`rg --files --hidden` walk, excluding Git metadata. The sorted inventories
agree at **5 changed files** (`diff -u`: **exit 0**). Both routes cover scripts,
docs, public assets and configuration as well as harness sources.

- `docs/plans/context-read-p2d-harness-impl.md`
- `tools/testing/fixtures/context-product/series.mjs`
- `tools/testing/fixtures/context-product/v4-checkpoint-child.mjs`
- `tools/testing/fixtures/context-product/v4-session.mjs`
- `tools/testing/measure-context-read-product-v4fix1.test.mjs`

The test inventory is independently derived from a filesystem glob and an
`rg --files` walk, with exact harness/guard/E1-C2 additions. Its sorted manifests
also agree (`diff -u`: **exit 0**): **37 test paths**, including **32 required
paths** (29 context-read files, two lock guards and E1-C2).

### Verification commands and actual exit codes

Commands used the exact nvm Node **22.16.0** or **24.15.0** executable with
that runtime first in PATH. Both `node --version` commands exited **0**.
Each test file ran separately through the following command; the table records
the actual process return codes, captured directly rather than inferred from
reporter output:

```sh
node tools/testing/run.mjs --test-reporter=tap <test-path>
```

| Explicit test path | Node 22.16.0 exit | Node 24.15.0 exit |
| --- | --- | --- |
| `tools/testing/measure-context-read-product-v4fix1.test.mjs` | 0 | 0 |
| `tools/testing/measure-context-read-product-v4.test.mjs` | 0 | 0 |
| `tools/testing/measure-context-read-product.test.mjs` | 0 | 0 |
| `tools/testing/measure-context-read-product-fix1.test.mjs` | 0 | 0 |
| `tools/testing/measure-context-read-product-fix2.test.mjs` | 0 | 0 |
| `core/test/context-read-assembly-races.test.mjs` | 0 | 0 |
| `core/test/context-read-assembly-readonly.test.mjs` | 0 | 0 |
| `core/test/context-read-assembly.test.mjs` | 0 | 0 |
| `core/test/context-read-bm25.test.mjs` | 0 | 0 |
| `core/test/context-read-budget.test.mjs` | 0 | 0 |
| `core/test/context-read-core.test.mjs` | 0 | 0 |
| `core/test/context-read-default-entropy.test.mjs` | 0 | 0 |
| `core/test/context-read-embedder.test.mjs` | 0 | 0 |
| `core/test/context-read-fusion.test.mjs` | 0 | 0 |
| `core/test/context-read-local-embedder.test.mjs` | 0 | 0 |
| `core/test/context-read-local-status.test.mjs` | 0 | 0 |
| `core/test/context-read-moc-source.test.mjs` | 0 | 0 |
| `core/test/context-read-process.test.mjs` | 0 | 0 |
| `core/test/context-read-product-artifact.test.mjs` | 0 | 0 |
| `core/test/context-read-product-control.test.mjs` | 0 | 0 |
| `core/test/context-read-product-import.test.mjs` | 0 | 0 |
| `core/test/context-read-product-index.test.mjs` | 0 | 0 |
| `core/test/context-read-product-pump.test.mjs` | 0 | 0 |
| `core/test/context-read-product-service.test.mjs` | 0 | 0 |
| `core/test/context-read-product.test.mjs` | 0 | 0 |
| `core/test/context-read-recovery.test.mjs` | 0 | 0 |
| `core/test/context-read-review.test.mjs` | 0 | 0 |
| `core/test/context-read-sidecar.test.mjs` | 0 | 0 |
| `core/test/context-read-source-work.test.mjs` | 0 | 0 |
| `core/test/context-read-sources-authority.test.mjs` | 0 | 0 |
| `core/test/context-read-sources-bounds.test.mjs` | 0 | 0 |
| `core/test/context-read-sources-races.test.mjs` | 0 | 0 |
| `core/test/context-read-sources.test.mjs` | 0 | 0 |
| `core/test/context-read-tokenize.test.mjs` | 0 | 0 |
| `core/test/no-raw-db-fd.test.mjs` | 0 | 0 |
| `core/test/sqlite-lock-safety.test.mjs` | 0 | 0 |
| `tools/testing/measure-topic-reader-wal.test.mjs` | 0 | 0 |

All **74 initial file invocations exited 0**. After tightening the helper
boundaries and adding their regressions, the five harness files, both lock
guards and E1-C2 were rerun sequentially on both patches: **16 final affected
file invocations, every exit 0**. The table above uses those latest results
where applicable. Both complete matrix runners also exited **0**.

The extended v4fix1 file runs its **69 deterministic cases** (33 prior and
36 round-two checks) in a VM-enabled child; its outer wrapper asserts the
child's actual exit code. The v4 suite separately passes all **47** cases on
each patch. Both assembly-suite commands retain the existing A13 skip because
the optional `tiktoken` package is unavailable: 19 passes, one skip, exit **0**
on each patch. No dependency installation was attempted.

The final new-regression commands were also run directly on both patches:

```sh
node --experimental-vm-modules --test --test-reporter=tap --test-name-pattern=round2 tools/testing/measure-context-read-product-v4fix1.test.mjs
P2D_V4FIX1_BASE=55ad96fb node --experimental-vm-modules --test --test-reporter=tap --test-name-pattern=round2 tools/testing/measure-context-read-product-v4fix1.test.mjs
```

| Direct regression command | Node 22.16.0 | Node 24.15.0 |
| --- | --- | --- |
| Working implementation | exit 0; 36/36 passed | exit 0; 36/36 passed |
| Reviewed sources at `55ad96fb` | exit 1; 26 failed / 10 controls passed | exit 1; 26 failed / 10 controls passed |

These base runs load the reviewed session, pump and checkpoint-child sources
through the same VM loader and dependency doubles. They reproduce each of the
three findings; passing controls verify retained engine observation and proper
population qualification. No wall-clock blocking injection is used.

Final syntax commands, each run on both patches:

| Command | Node 22.16.0 exit | Node 24.15.0 exit |
| --- | --- | --- |
| `node --check tools/testing/fixtures/context-product/v4-session.mjs` | 0 | 0 |
| `node --check tools/testing/fixtures/context-product/v4-checkpoint-child.mjs` | 0 | 0 |
| `node --check tools/testing/fixtures/context-product/series.mjs` | 0 | 0 |
| `node --check tools/testing/measure-context-read-product-v4fix1.test.mjs` | 0 | 0 |

Development test runs initially exited **1** while correcting the synthetic
release-step fixture and observer-state restoration for a hook enabled during
an existing callback. Those were corrected before the final runs above. An
intermediate `git diff --check` exited **2** for an extra blank line at the end
of this unfinished report; final whitespace checks are recorded below.

Final `git diff --check`, the independent whitespace/final-newline scan over
all **5 changed files**, the added-local-path/debug scan and both inventory
`diff -u` comparisons exited **0** (5 changed paths / 37 test paths). The
unchanged engine/runtime, lazy-import helpers, raw-fd allowances, frozen
contract/protocol/counts and generated-setup comparison against `55ad96fb`
exited **0**. `git diff --cached --exit-code` exited **0**. The branch remains
`feat/context-read-p2d-harness` at `55ad96fb`, with five unstaged changed files;
the primary commits.

Both verification runners finished with actual exit **0**. Per-file test
wrappers verified their process groups drained; the owned-runner process check
also exited **0**. Owned temporary verification logs/scripts were removed after
recording the results. No measurement, smoke, process or monitor is left running.

## v4 encoding fix round 3

Base `fc58e9f8`, including the standards T7b thread-attribution correction on
`46669802`. Both second re-reviews were read in full, together with the nine
original lessons and four additional lessons. This round replaces async-context
ownership classification with a process boundary. No engine runtime, frozen
protocol, population thresholds, counts, estimates or generated runtime changes.
No timing run, smoke, network/key operation or commit.

### Structural observation boundary

- `v4-session-work.mjs` owns the unchanged schedule, all 21 lanes, independent
  writer control/ledger processing, live-target input preparation, oracle/probe
  validation, records, variable-size lane IPC and byte accounting. It runs in
  `v4-session-child.mjs`, never in the observed parent. The child refreshes its
  fixture ledger through the existing isolated storage child before starting
  the writer. Large ledger data therefore does not cross parent IPC.
- The child leases the existing numeric journal and streams/syncs raw evidence
  while the session runs. Parent and child writes are mutually exclusive; both
  handles append, and the lease returns the sequence number. Journal regression
  checks records before, during and after the lease, including durable evidence
  before export. No raw database descriptor or new database allowance is added.
- Parent preparation, configuration encoding and byte limits finish before
  `loopFactory()`. `v4-session-pump.mjs` separates pump configuration from engine
  renewal, public drain/ack, pump close and supervisor close. During observation
  it buffers raw engine outputs; diagnostic and trace records are constructed
  after `loop.finish()`. The observer counts every parent callback, including
  synchronous engine callbacks and Promise continuations. There are no scopes,
  async hooks, pause calls or resume calls in the session observer.
- In-window parent IPC sends only the fixed literal `start` string (7 bytes
  when JSON encoded); failure cancellation uses the fixed `cancel` string
  (8 bytes). Node IPC still JSON-serializes those tiny constant strings. It
  never receives a variable lane input or writer diagnostic payload to serialize
  in the observed parent. The child sends fixed `ready`/`done` controls and holds
  its variable-size export until the parent sends `export` after observation.
- Parent observation continues through writer/lane shutdown, pump drain/close,
  supervisor close and observer final drain. Sampler transfer, parent validation,
  population inspection, result decisions, diagnostics and serialization follow
  `loop.finish()`. Existing scheduling attribution, including T7b, is retained.
- The runner's admission/report timer is suspended for this unit. Actor stall
  checks, the session deadline and child cleanup run in the session child.
  Parent actor/sampler polling is disabled in-window; the sampler's stop watchdog
  starts after observation. Child export, IPC-error cleanup and actual child exit
  remain distinct. Startup cancellation drains the child and returns the journal
  lease. Actor completion accepts confirmed `exit` plus IPC `disconnect` as
  well as stdio `close`, so delayed stdio closure cannot hang export cleanup.
  Final IPC stays deliverable, and disconnect alone never proves exit. A
  disconnected sampler cancels its timer when its lane parent is terminated.
  No asynchronous work is left running by the verification commands.

### Regressions and counterfactuals

The existing VM/manual-clock suite now exercises the production session worker
with distinct parent and child clocks. Three explicit round-three cases cover
150 ms in a synchronous `AsyncResource` callback body, its asynchronous `.then`
continuation, and variable-size lane serialization. The serialization case also
asserts that the fabricated child clock advanced, so omission cannot pass it.
Existing async preparation, probe validation, record and writer-bookkeeping
cases remain, along with renewal, drain, pump shutdown, supervisor shutdown,
lane shutdown, failure cleanup and scheduling-attribution controls.

The new `measure-context-read-product-v4fix3.test.mjs` additionally checks the
journal lease (including concurrent frames), child success/failure export order,
startup cancellation, parent startup failure, sampler disconnect cleanup and
confirmed-exit/final-IPC ordering. Its unfiltered-observer checks make pause/resume throw:
synchronous callbacks, async engine continuations, drain, pump close, supervisor
close and lane-shutdown delivery each retain a fabricated 150 ms parent block.
A fabricated 150 ms validation block after an await validates a buffered loop record
after observation; parent configuration serialization runs before observation.
Both retain 0 ms in the parent-loop record. These use fabricated clocks, never
wall-clock blocking or timing qualification.

Counts remain **728 / 488 cells**, **432 / 224 fixed windows**, **252 / 172
references**, and **46,627.4 s / 26,284 s** estimates.

### Counterfactual commands and actual exit codes

Each command below used the exact Node executable for the column and a PATH
headed by that runtime. `F` denotes
`tools/testing/measure-context-read-product-v4fix1.test.mjs`; the environment
switches load reviewed sources through the existing VM loader or apply the
explicit observer mutation without editing the worktree.

| Command | Node 22.16.0 | Node 24.15.0 |
| --- | --- | --- |
| `node --experimental-vm-modules --test --test-reporter=tap --test-name-pattern=round3 F` | exit 0; 4 passed | exit 0; 4 passed |
| `P2D_V4FIX1_BASE=46669802 node --experimental-vm-modules --test --test-reporter=tap --test-name-pattern=round3 F` | exit 1; 2 failed / 2 controls passed | exit 1; 3 failed / 1 control passed |
| `P2D_V4FIX1_BASE=55ad96fb node --experimental-vm-modules --test --test-reporter=tap --test-name-pattern='round3 async engine continuation\|round2 async harness-validation' F` | exit 1; 1 failed / 1 control passed | exit 1; 1 failed / 1 control passed |
| `P2D_V4FIX3_MUTANT=async-blind node --experimental-vm-modules --test --test-reporter=tap --test-name-pattern=round3 F` | exit 1; 1 failed / 3 controls passed | exit 1; 1 failed / 3 controls passed |

At `46669802`, both patches fail variable-size lane serialization and the
runner-supervision exclusion; Node 24 additionally loses the synchronous
engine callback body. Node 22 retains that callback as a passing control.
The async engine continuation already works at that base. The `async-blind`
mutation reproduces omission of that continuation by pausing across the await
for the fixed done control: only the async continuation regression fails on
both patches. The earlier `55ad96fb` sources reproduce async harness validation
entering observation; its engine continuation remains a passing control.

### Changed files, cross-checked two ways

One inventory uses `git diff --name-only HEAD` plus Git's untracked enumeration.
The independent inventory compares every HEAD tree blob and executable/symlink
mode with worktree bytes, then walks the filesystem for new paths, honoring
ignore rules. Both cover scripts, docs, public assets and configuration; owned
verification scratch is excluded and removed at handoff. Their sorted manifests
agree at **13 changed files** (`diff -u`: **exit 0**):

- `core/test/fixtures/no-raw-db-fd-allowlist.json`
- `docs/plans/context-read-p2d-harness-impl.md`
- `tools/testing/fixtures/context-product/actors.mjs`
- `tools/testing/fixtures/context-product/io-child.mjs`
- `tools/testing/fixtures/context-product/report.mjs`
- `tools/testing/fixtures/context-product/runner-child.mjs`
- `tools/testing/fixtures/context-product/v4-runner.mjs`
- `tools/testing/fixtures/context-product/v4-session-child.mjs`
- `tools/testing/fixtures/context-product/v4-session-pump.mjs`
- `tools/testing/fixtures/context-product/v4-session-work.mjs`
- `tools/testing/fixtures/context-product/v4-session.mjs`
- `tools/testing/measure-context-read-product-v4fix1.test.mjs`
- `tools/testing/measure-context-read-product-v4fix3.test.mjs`

The test inventory was independently derived using a filesystem glob and an
`rg --files` walk plus exact harness/guard/E1-C2 additions. The manifests agree
at **38 explicit test paths / 32 required paths** (`diff -u`: **exit 0**).

### Syntax, estimates and final checks

Both exact-runtime `node --version` commands exited **0**. Syntax checks ran
as `node --check <path>` on each patch, with the actual process status captured:

| Explicit JavaScript path | Node 22.16.0 exit | Node 24.15.0 exit |
| --- | --- | --- |
| `tools/testing/fixtures/context-product/actors.mjs` | 0 | 0 |
| `tools/testing/fixtures/context-product/io-child.mjs` | 0 | 0 |
| `tools/testing/fixtures/context-product/report.mjs` | 0 | 0 |
| `tools/testing/fixtures/context-product/runner-child.mjs` | 0 | 0 |
| `tools/testing/fixtures/context-product/v4-runner.mjs` | 0 | 0 |
| `tools/testing/fixtures/context-product/v4-session-child.mjs` | 0 | 0 |
| `tools/testing/fixtures/context-product/v4-session-pump.mjs` | 0 | 0 |
| `tools/testing/fixtures/context-product/v4-session-work.mjs` | 0 | 0 |
| `tools/testing/fixtures/context-product/v4-session.mjs` | 0 | 0 |
| `tools/testing/measure-context-read-product-v4fix1.test.mjs` | 0 | 0 |
| `tools/testing/measure-context-read-product-v4fix3.test.mjs` | 0 | 0 |

All **22 syntax invocations exited 0**. Estimate-only commands do not start
measurement or engine work:

| Command | Node 22.16.0 exit | Node 24.15.0 exit |
| --- | --- | --- |
| `node tools/testing/measure-context-read-product.mjs --protocol v4 --profile engine --estimate` | 0 | 0 |
| `node tools/testing/measure-context-read-product.mjs --protocol v4 --profile production --estimate` | 0 | 0 |

The outputs retain the exact inventories, hashes and counts checked by the v4
suite: 728 / 488 cells, 432 / 224 fixed windows, 252 / 172 references and
46,627.4 / 26,284 estimated seconds.

Two development attempts at the new sampler cleanup test were explicitly
stopped after confirmed child exit while its fixture still awaited a separate
stdio-close event: wrapper exit **143** on each attempt. The fixture now asserts
the confirmed exit directly. The final actor checks separately require both
actual exit and IPC disconnection, preserve the final result message, and reject
disconnection alone as exit proof. Final affected reruns pass on both patches.
These interrupted development attempts are not passing verification results.

### Explicit test commands and actual exit codes

Each path below ran separately with its exact nvm Node executable first in
PATH, using `node tools/testing/run.mjs --test-reporter=tap <test-path>`.
Actual process return codes were captured directly; no pipeline or reporter
tail supplied the verdict. All **76 matrix file invocations exited 0** and the
matrix driver exited **0**. After the last cleanup/actor checks, the six harness
files, both lock guards and E1-C2 ran again on both patches: **18 final affected
file invocations, every exit 0**; that driver also exited **0**. The table uses
the latest result for each path.

| Explicit test path | Node 22.16.0 exit | Node 24.15.0 exit |
| --- | --- | --- |
| `core/test/context-read-assembly-races.test.mjs` | 0 | 0 |
| `core/test/context-read-assembly-readonly.test.mjs` | 0 | 0 |
| `core/test/context-read-assembly.test.mjs` | 0 | 0 |
| `core/test/context-read-bm25.test.mjs` | 0 | 0 |
| `core/test/context-read-budget.test.mjs` | 0 | 0 |
| `core/test/context-read-core.test.mjs` | 0 | 0 |
| `core/test/context-read-default-entropy.test.mjs` | 0 | 0 |
| `core/test/context-read-embedder.test.mjs` | 0 | 0 |
| `core/test/context-read-fusion.test.mjs` | 0 | 0 |
| `core/test/context-read-local-embedder.test.mjs` | 0 | 0 |
| `core/test/context-read-local-status.test.mjs` | 0 | 0 |
| `core/test/context-read-moc-source.test.mjs` | 0 | 0 |
| `core/test/context-read-process.test.mjs` | 0 | 0 |
| `core/test/context-read-product-artifact.test.mjs` | 0 | 0 |
| `core/test/context-read-product-control.test.mjs` | 0 | 0 |
| `core/test/context-read-product-import.test.mjs` | 0 | 0 |
| `core/test/context-read-product-index.test.mjs` | 0 | 0 |
| `core/test/context-read-product-pump.test.mjs` | 0 | 0 |
| `core/test/context-read-product-service.test.mjs` | 0 | 0 |
| `core/test/context-read-product.test.mjs` | 0 | 0 |
| `core/test/context-read-recovery.test.mjs` | 0 | 0 |
| `core/test/context-read-review.test.mjs` | 0 | 0 |
| `core/test/context-read-sidecar.test.mjs` | 0 | 0 |
| `core/test/context-read-source-work.test.mjs` | 0 | 0 |
| `core/test/context-read-sources-authority.test.mjs` | 0 | 0 |
| `core/test/context-read-sources-bounds.test.mjs` | 0 | 0 |
| `core/test/context-read-sources-races.test.mjs` | 0 | 0 |
| `core/test/context-read-sources.test.mjs` | 0 | 0 |
| `core/test/context-read-tokenize.test.mjs` | 0 | 0 |
| `core/test/no-raw-db-fd.test.mjs` | 0 | 0 |
| `core/test/sqlite-lock-safety.test.mjs` | 0 | 0 |
| `tools/testing/measure-context-read-product-fix1.test.mjs` | 0 | 0 |
| `tools/testing/measure-context-read-product-fix2.test.mjs` | 0 | 0 |
| `tools/testing/measure-context-read-product-v4.test.mjs` | 0 | 0 |
| `tools/testing/measure-context-read-product-v4fix1.test.mjs` | 0 | 0 |
| `tools/testing/measure-context-read-product-v4fix3.test.mjs` | 0 | 0 |
| `tools/testing/measure-context-read-product.test.mjs` | 0 | 0 |
| `tools/testing/measure-topic-reader-wal.test.mjs` | 0 | 0 |

The v4 suite passes all **47** cases on each patch. The new boundary suite
passes all **16** cases in the final affected reruns. The v4fix1 wrapper checks
its isolated VM-enabled child's actual exit status, including the retained
round-one/round-two checks and four explicit round-three regressions.
Both assembly-suite runs retain only the existing optional-`tiktoken` A13 skip:
19 passes / one skip / exit **0**. No package installation was attempted.
No other matrix or final affected file reports a skip, cancellation or failure.

Final `git diff --check`, the independent whitespace/final-newline and added
local-path scans, both inventory `diff -u` commands and the unchanged
engine/runtime, frozen contract/protocol/counts and generated-setup comparison
against HEAD exited **0**. `git diff --cached --exit-code` exited **0**.
The inventories were re-derived after this appendix: **13 changed files /
38 test paths**, with **32 required paths**. The branch remains at `fc58e9f8`;
all changes are unstaged, and the primary commits. Verification wrappers drained
their owned process groups; all verification drivers finished, and owned scratch
was removed. No measurement, smoke, process or monitor is left running.

## v4 encoding fix round 4

Base `de2bf544`. Both third re-reviews were read in full, together with the
original nine lessons and four additional lessons. This round fixes the five
supervision findings while retaining round three's structural process boundary.
No engine runtime, frozen protocol, counts, estimates or generated runtime
changes. No measurement, smoke, network/key operation or commit.

### Findings, fixes and regressions

| Finding | Fix | Regression |
| --- | --- | --- |
| Spec P1: one stalled actor kills healthy in-flight reads and the writer | The coordinator journals an explicit supervision reason that survives a subsequent child-exit error, stops admission and requests ordinary stop on healthy actors. Only the stalled actor receives immediate SIGTERM, followed by SIGKILL if necessary. Healthy operations settle, validate and journal their records, including writer telemetry. Any actor still unresponsive at the registered drain allowance is then escalated. Startup and post-preparation dispatch both check the stop reason. | `round4 stall preserves healthy lane settlement and writer telemetry until bounded drain` checks the production coordinator with a stalled lane, a healthy pending lane and writer; the latter two keep their ordinary records and receive no kill. `round4 stop during input preparation prevents further lane admission` exercises the production worker. A separate allowance-boundary case keeps an unresponsive actor alive until the boundary, then requires escalation. A manual-timer check requires TERM, KILL and confirmed exit. |
| Spec P1: watchdog disconnects IPC but leaves preparation/session waits alive | The coordinator races preparation and work against terminal cancellation, rejects pending control waits, drains within the allowance, closes the journal and sends fixed `done` before export. Its monitors are cleared. The parent independently arms a deadline, detects IPC loss, rejects pending/future waits without confusing disconnect with confirmed exit, and owns cleanup. | An unresolved preparation Promise must still produce `done`, export the timeout failure and clear all monitors. A separately connected child that never sends `done` must fail under the independent parent deadline. A disconnected live actor must reject waits before its subsequent confirmed exit. |
| Spec P2: lost export repeats journal sequences and undercounts totals | After confirmed descendant shutdown, reclaim without an exported sequence streams the durable journal in the existing SQLite-free IO child. It validates contiguous sequence numbers and complete frames before parent writes resume. A leased or unrecoverable journal cannot produce a final count. | `round4 lost export recovers durable journal sequence and exact total` writes parent/child/parent records with the export omitted, then requires `[1,2,3]` and final totals equal to actual records. |
| Standards P1: a final session can exceed the reservation and pass | Supervision transfers to the child plus the independent parent deadline while the variable-size runner callback is suspended. Startup and active-session deadlines are bounded by the same absolute reservation. After the session returns, the runner rechecks elapsed time before accepting any group checkpoint. It no longer resets activity/progress timestamps at this boundary. | `round4 final session rechecks reservation with every other cell complete` uses the reviewer's fabricated-clock case: all other cells are resumed, the session advances beyond the reservation and even writes fresh activity, but completion remains false with `projected_overrun` and `inconclusive`. |
| Standards P1: coordinator crash orphans lanes, samplers and writer | The parent creates a detached coordinator process group inherited by every descendant. Cleanup uses a bounded SQLite-free helper to signal and confirm the entire group, even after the coordinator exits. Linux kernel zombie/exited states count as confirmed exit; a live PID alone never proves health. Lanes stop on IPC disconnect and await sampler shutdown. The separately owned parent sampler also supports cancellation during startup. Unconfirmed shutdown retains both workspace levels and the journal lease, interrupts the partial report and clears parent monitors. | Deterministic cases require detached group ownership, confirmed descendant exit before parent return/reclaim, lane disconnect cleanup, aborted sampler startup, retained workspaces and fail-closed report handling. A subprocess-only tree with a lane, its sampler and a writer kills the coordinator, runs production actor cleanup and verifies every descendant has exited. No engine workload or timing gate runs in this test. |

The parent receives only fixed ready/done controls during observation. Variable
lane input, validation, serialization, writer bookkeeping, process inventories
and journal recovery stay in children or after observation. Process-group
polling runs in the SQLite-free IO child; its parent receives only terminal
exit. Engine callbacks, renewals, drain, pump/supervisor close and normal lane
shutdown retain full unfiltered observation. Sampler transfer remains after
`loop.finish()`. Both T7b and the missing-main-thread attribution control are
retained. The existing v4 CLI import check guards lazy SQLite linkage, and the
exact raw-fd allowances add only procfs metadata and the harness-owned journal
inside the established SQLite-free child.

Counts remain **728 / 488 cells**, **432 / 224 fixed windows**, **252 / 172
references**, and **46,627.4 s / 26,284 s** estimates.

### Counterfactual commands and actual exit codes

Each command used the exact Node executable named by its column, with that
runtime first in PATH. The base switches read reviewed source blobs through
the VM loader without changing the worktree. `F4` denotes
`tools/testing/measure-context-read-product-v4fix4.test.mjs`; `F1` denotes
`tools/testing/measure-context-read-product-v4fix1.test.mjs`.

| Command | Node 22.16.0 | Node 24.15.0 |
| --- | --- | --- |
| `node --experimental-vm-modules --test --test-reporter=tap --test-name-pattern=round4 F4` | exit 0; 14 passed | exit 0; 14 passed |
| `P2D_V4FIX4_BASE=de2bf544 node --experimental-vm-modules --test --test-reporter=tap --test-name-pattern=round4 F4` | exit 1; 13 failed / 1 control passed | exit 1; 13 failed / 1 control passed |
| `node --experimental-vm-modules --test --test-reporter=tap --test-name-pattern=round4 F1` | exit 0; 2 passed | exit 0; 2 passed |
| `P2D_V4FIX1_BASE=de2bf544 node --experimental-vm-modules --test --test-reporter=tap --test-name-pattern=round4 F1` | exit 1; 2 failed | exit 1; 2 failed |

The base reproduces every finding. It kills the healthy lane/writer, admits a
read after cancellation, never sends `done` from unresolved preparation,
repeats sequence 2, accepts the final over-budget session, returns without
confirmed descendant cleanup and leaves native descendants alive. The explicit
TERM/KILL case checks the new helper directly and remains a passing control
when the other modules are loaded from the reviewed commit. These base failures
have zero test cancellations; they are expected assertion failures.

### Changed files, cross-checked two ways

The first inventory uses `git diff --name-only HEAD` plus
`git ls-files --others --exclude-standard`. The independent inventory hashes
every HEAD tree blob and compares executable/symlink modes with worktree bytes,
then walks the filesystem for new files and applies Git ignore rules. It
excludes repository metadata and ignored dependencies, covers scripts, docs,
public assets and configuration, and does not use the first inventory as its
search boundary. The sorted manifests agree: **13 changed files**
(`diff -u`: **exit 0**).

- `core/test/fixtures/no-raw-db-fd-allowlist.json`
- `docs/plans/context-read-p2d-harness-impl.md`
- `tools/testing/fixtures/context-product/actors.mjs`
- `tools/testing/fixtures/context-product/io-child.mjs`
- `tools/testing/fixtures/context-product/report.mjs`
- `tools/testing/fixtures/context-product/session-supervision.mjs`
- `tools/testing/fixtures/context-product/v4-lane.mjs`
- `tools/testing/fixtures/context-product/v4-runner.mjs`
- `tools/testing/fixtures/context-product/v4-session-child.mjs`
- `tools/testing/fixtures/context-product/v4-session-work.mjs`
- `tools/testing/fixtures/context-product/v4-session.mjs`
- `tools/testing/measure-context-read-product-v4fix1.test.mjs`
- `tools/testing/measure-context-read-product-v4fix4.test.mjs`

The test inventory was also derived twice: a filesystem glob plus explicit
harness/guard/E1-C2 additions, and an independent `rg --files` walk with the
same selection rules. They agree at **39 explicit paths / 32 required paths**.

### Syntax and estimate checks

Every command below ran separately on both patches. Actual return codes were
captured from the processes, rather than inferred from the end of output.

| Command | Node 22.16.0 exit | Node 24.15.0 exit |
| --- | --- | --- |
| `node --version` | 0 | 0 |
| `node --check tools/testing/fixtures/context-product/actors.mjs` | 0 | 0 |
| `node --check tools/testing/fixtures/context-product/io-child.mjs` | 0 | 0 |
| `node --check tools/testing/fixtures/context-product/report.mjs` | 0 | 0 |
| `node --check tools/testing/fixtures/context-product/session-supervision.mjs` | 0 | 0 |
| `node --check tools/testing/fixtures/context-product/v4-lane.mjs` | 0 | 0 |
| `node --check tools/testing/fixtures/context-product/v4-runner.mjs` | 0 | 0 |
| `node --check tools/testing/fixtures/context-product/v4-session-child.mjs` | 0 | 0 |
| `node --check tools/testing/fixtures/context-product/v4-session-work.mjs` | 0 | 0 |
| `node --check tools/testing/fixtures/context-product/v4-session.mjs` | 0 | 0 |
| `node --check tools/testing/measure-context-read-product-v4fix1.test.mjs` | 0 | 0 |
| `node --check tools/testing/measure-context-read-product-v4fix4.test.mjs` | 0 | 0 |
| `node tools/testing/measure-context-read-product.mjs --protocol v4 --profile engine --estimate` | 0 | 0 |
| `node tools/testing/measure-context-read-product.mjs --protocol v4 --profile production --estimate` | 0 | 0 |

All **22 syntax invocations exited 0**, as did both runtime-version checks and
all four estimate-only invocations. The estimate outputs retain the exact
inventories, hashes and arithmetic checked by the v4 suite.

### Explicit test commands and actual exit codes

Every path below ran separately with its exact nvm Node executable first in
PATH, as `node tools/testing/run.mjs --test-reporter=tap <test-path>`. The
supervised matrix captures each actual process return code. All **78 matrix
file invocations exited 0**; the matrix driver also exited **0**.

| Explicit test path | Node 22.16.0 exit | Node 24.15.0 exit |
| --- | --- | --- |
| `core/test/context-read-assembly-races.test.mjs` | 0 | 0 |
| `core/test/context-read-assembly-readonly.test.mjs` | 0 | 0 |
| `core/test/context-read-assembly.test.mjs` | 0 | 0 |
| `core/test/context-read-bm25.test.mjs` | 0 | 0 |
| `core/test/context-read-budget.test.mjs` | 0 | 0 |
| `core/test/context-read-core.test.mjs` | 0 | 0 |
| `core/test/context-read-default-entropy.test.mjs` | 0 | 0 |
| `core/test/context-read-embedder.test.mjs` | 0 | 0 |
| `core/test/context-read-fusion.test.mjs` | 0 | 0 |
| `core/test/context-read-local-embedder.test.mjs` | 0 | 0 |
| `core/test/context-read-local-status.test.mjs` | 0 | 0 |
| `core/test/context-read-moc-source.test.mjs` | 0 | 0 |
| `core/test/context-read-process.test.mjs` | 0 | 0 |
| `core/test/context-read-product-artifact.test.mjs` | 0 | 0 |
| `core/test/context-read-product-control.test.mjs` | 0 | 0 |
| `core/test/context-read-product-import.test.mjs` | 0 | 0 |
| `core/test/context-read-product-index.test.mjs` | 0 | 0 |
| `core/test/context-read-product-pump.test.mjs` | 0 | 0 |
| `core/test/context-read-product-service.test.mjs` | 0 | 0 |
| `core/test/context-read-product.test.mjs` | 0 | 0 |
| `core/test/context-read-recovery.test.mjs` | 0 | 0 |
| `core/test/context-read-review.test.mjs` | 0 | 0 |
| `core/test/context-read-sidecar.test.mjs` | 0 | 0 |
| `core/test/context-read-source-work.test.mjs` | 0 | 0 |
| `core/test/context-read-sources-authority.test.mjs` | 0 | 0 |
| `core/test/context-read-sources-bounds.test.mjs` | 0 | 0 |
| `core/test/context-read-sources-races.test.mjs` | 0 | 0 |
| `core/test/context-read-sources.test.mjs` | 0 | 0 |
| `core/test/context-read-tokenize.test.mjs` | 0 | 0 |
| `core/test/no-raw-db-fd.test.mjs` | 0 | 0 |
| `core/test/sqlite-lock-safety.test.mjs` | 0 | 0 |
| `tools/testing/measure-context-read-product-fix1.test.mjs` | 0 | 0 |
| `tools/testing/measure-context-read-product-fix2.test.mjs` | 0 | 0 |
| `tools/testing/measure-context-read-product-v4.test.mjs` | 0 | 0 |
| `tools/testing/measure-context-read-product-v4fix1.test.mjs` | 0 | 0 |
| `tools/testing/measure-context-read-product-v4fix3.test.mjs` | 0 | 0 |
| `tools/testing/measure-context-read-product-v4fix4.test.mjs` | 0 | 0 |
| `tools/testing/measure-context-read-product.test.mjs` | 0 | 0 |
| `tools/testing/measure-topic-reader-wal.test.mjs` | 0 | 0 |

The v4 suite passes **47/47** on each runtime; the retained round-three boundary
suite passes **16/16**. The v4fix1 and v4fix4 discovery wrappers assert their
isolated VM-enabled child's actual exit status. The direct round-four checks
above additionally expose all **14 new supervision cases** plus both runner
cases. T7b, the missing-main-thread control, synchronous and asynchronous engine
blocks, excluded post-await validation/serialization, renewal, drain and shutdown
are retained.

Both assembly runs retain the existing optional-`tiktoken` A13 skip:
**19 passed / one skipped / exit 0** each. No dependency was installed. No other
matrix file reports a skip, cancellation or failure.

Development verification exposed two issues before the final checks: the
parent timeout initially omitted defaults for older partial supervision
fixtures (combined affected run exit **1**), and an over-broad edit of exact
allowlist import strings was rejected by the raw-fd guard (combined run exit
**1**). Both were corrected; the guard rerun exited **0**. An initial independent
inventory included the worktree's Git metadata pointer (inventory comparison
exit **1**); excluding repository metadata makes both complete inventories agree
at 13 paths. These development results are not passing verification results.

After the final stall-journal and allowance-boundary assertions, all seven
harness test files, both lock guards and E1-C2 ran again, separately and serially
on both runtimes, using the same explicit commands as the table above:
**20 final affected file invocations, every exit 0**. Their driver also exited
**0**. These are the latest results for the affected paths in the table.

Final `git diff --check`, the independent whitespace/final-newline and added
local-path scans, the changed-file and test-inventory `diff -u` comparisons,
the tested-JavaScript hash comparison and the unchanged engine/runtime,
frozen protocol/plan/claims and generated-setup comparison against HEAD all
exited **0**. `git diff --cached --exit-code` exited **0**. The inventories were
re-derived after the appendix: **13 changed files / 39 explicit test paths /
32 required paths**.

The branch remains `feat/context-read-p2d-harness` at `de2bf544`; changes are
unstaged and the primary commits. The verification runners confirmed their owned
process groups drained, both matrix drivers exited **0**, and the owned-process
check found **zero** remaining verification processes. Owned verification scratch
was removed after recording the results. No measurement, smoke, process or
monitor is left running for unattended supervision.

## v4 encoding fix round 5

Base `1671eafa`, branch `feat/context-read-p2d-harness`. Both re-reviews were
read in full, along with the original nine lessons and four additional lessons.
The three distinct P1s are covered by deterministic regressions using production
parent/actor code, manual deadlines and the existing fabricated-clock runner.
The primary commits; this round makes no commit and uses no network or keys.
No timing measurement or smoke ran on the shared machine.

### Fixes and regression coverage

| Finding | Change | Regression |
| --- | --- | --- |
| Orderly disconnect becomes child loss | After requesting export, the parent observes result delivery itself, before the awaiting continuation. An ensuing disconnect permits the separate confirmed-exit wait to continue. The deadline remains armed through exit and descendant cleanup. A premature disconnect still rejects the terminal promise. | `round5 valid export then disconnect waits for exit 0 and succeeds` delivers result and disconnect in the same turn, requires the session and journal lease to remain pending, then supplies exit 0. Separate cases reject exit 1 and a signal, reject pre-result disconnect even with exit 0, and require timeout when an exported child never confirms exit. |
| Parent deadline cannot interrupt pump preparation or shutdown | Preparation, active pump stop and pre-observation disposal race the parent terminal promise. Deadline expiry records the timeout before starting descendant cleanup, preventing cleanup-induced disconnect/exit from replacing its reason. Descendant cleanup and pump shutdown are each started once. A late prepared driver is disposed without starting work. Pending preparation or unconfirmed pump close retains the lease and both workspace levels; the runner interrupts the report and explicitly reports failure and workspace retention. | Separate unresolved preparation, stop and disposal cases fire manual deadlines and require cleanup to start, the session to reject, timers to clear and the lease to remain held. The preparation case then resolves late and verifies disposal without session start or lease reclamation. A runner check verifies both retained workspace levels, interrupted reporting and the explicit retention diagnostic. |
| Session overrun discards known failure | Returned decisions enter the tally and checkpoint journal before the admission stop is applied. Overrun checkpoints have `complete:false`. Failed verdicts and `observedFailure` survive, including newly observed failures in a resumed sibling. Any known failure produces final `failed`; a passing overrun remains `inconclusive`. | The final-session fabricated clock now returns `{decision:'failed', observedFailure:true}`, a plain failed verdict, and an invalid verdict carrying an observed failure. Each requires final failure, failed tally and an incomplete checkpoint. A resumed-sibling failure is checked separately. The prior passing-overrun control remains. |

The six round-three observation checks, T7b, the missing-main-thread attribution
control and all five round-four fixes remain in the affected suites. Parent
observation stays unfiltered through renewal, drain, pump/supervisor close and
lane shutdown. Post-await validation, variable serialization and sampler transfer
remain outside observation. The added result-delivery listener is installed only
after observation has finished. No engine runtime, shared helper, raw-file
allowance, frozen protocol/plan/claims, generated runtime, count or estimate changes.

Counts remain **728 / 488 cells**, **432 / 224 fixed windows**, **252 / 172
references**, with estimates **46,627.4 s / 26,284 s**.

### Regression commands and actual exit codes

`F1` means `tools/testing/measure-context-read-product-v4fix1.test.mjs` and
`F4` means `tools/testing/measure-context-read-product-v4fix4.test.mjs`.
Each command uses the named nvm patch with that runtime first in PATH. Base
switches load source from Git through the existing VM seam without changing the
worktree. Expected base failures are assertion failures, with no cancellations.

| Command | Node 22.16.0 | Node 24.15.0 |
| --- | --- | --- |
| `node --experimental-vm-modules --test --test-reporter=tap --test-name-pattern=round5 F1` | exit 0; 5 passed | exit 0; 5 passed |
| `P2D_V4FIX1_BASE=1671eafa node --experimental-vm-modules --test --test-reporter=tap --test-name-pattern=round5 F1` | exit 1; 5 failed | exit 1; 5 failed |
| `node --experimental-vm-modules --test --test-reporter=tap --test-name-pattern=round5 F4` | exit 0; 8 passed | exit 0; 8 passed |
| `P2D_V4FIX4_BASE=1671eafa node --experimental-vm-modules --test --test-reporter=tap --test-name-pattern=round5 F4` | exit 1; 8 failed | exit 1; 8 failed |

All **13 new cases** pass on each runtime and fail against `1671eafa`.
The existing round-four controls remain in the complete affected-file runs.

### Syntax, estimates and required test commands

Actual subprocess return codes were recorded directly. The serial matrix uses
`node tools/testing/run.mjs --test-reporter=tap <test-path>` separately for
each explicit path below. The wrapper supervises its owned process group and
confirms it has drained before removing scratch. No reporter tail or pipeline
status supplies a test verdict.

| Command | Node 22.16.0 exit | Node 24.15.0 exit |
| --- | --- | --- |
| `node --version` | 0 | 0 |
| `node --check tools/testing/fixtures/context-product/v4-session.mjs` | 0 | 0 |
| `node --check tools/testing/fixtures/context-product/v4-runner.mjs` | 0 | 0 |
| `node --check F1` | 0 | 0 |
| `node --check F4` | 0 | 0 |
| `node tools/testing/measure-context-read-product.mjs --protocol v4 --profile engine --estimate` | 0 | 0 |
| `node tools/testing/measure-context-read-product.mjs --protocol v4 --profile production --estimate` | 0 | 0 |

| Explicit test path | Node 22.16.0 exit | Node 24.15.0 exit |
| --- | --- | --- |
| `core/test/context-read-assembly-races.test.mjs` | 0 | 0 |
| `core/test/context-read-assembly-readonly.test.mjs` | 0 | 0 |
| `core/test/context-read-assembly.test.mjs` | 0 | 0 |
| `core/test/context-read-bm25.test.mjs` | 0 | 0 |
| `core/test/context-read-budget.test.mjs` | 0 | 0 |
| `core/test/context-read-core.test.mjs` | 0 | 0 |
| `core/test/context-read-default-entropy.test.mjs` | 0 | 0 |
| `core/test/context-read-embedder.test.mjs` | 0 | 0 |
| `core/test/context-read-fusion.test.mjs` | 0 | 0 |
| `core/test/context-read-local-embedder.test.mjs` | 0 | 0 |
| `core/test/context-read-local-status.test.mjs` | 0 | 0 |
| `core/test/context-read-moc-source.test.mjs` | 0 | 0 |
| `core/test/context-read-process.test.mjs` | 0 | 0 |
| `core/test/context-read-product-artifact.test.mjs` | 0 | 0 |
| `core/test/context-read-product-control.test.mjs` | 0 | 0 |
| `core/test/context-read-product-import.test.mjs` | 0 | 0 |
| `core/test/context-read-product-index.test.mjs` | 0 | 0 |
| `core/test/context-read-product-pump.test.mjs` | 0 | 0 |
| `core/test/context-read-product-service.test.mjs` | 0 | 0 |
| `core/test/context-read-product.test.mjs` | 0 | 0 |
| `core/test/context-read-recovery.test.mjs` | 0 | 0 |
| `core/test/context-read-review.test.mjs` | 0 | 0 |
| `core/test/context-read-sidecar.test.mjs` | 0 | 0 |
| `core/test/context-read-source-work.test.mjs` | 0 | 0 |
| `core/test/context-read-sources-authority.test.mjs` | 0 | 0 |
| `core/test/context-read-sources-bounds.test.mjs` | 0 | 0 |
| `core/test/context-read-sources-races.test.mjs` | 0 | 0 |
| `core/test/context-read-sources.test.mjs` | 0 | 0 |
| `core/test/context-read-tokenize.test.mjs` | 0 | 0 |
| `core/test/no-raw-db-fd.test.mjs` | 0 | 0 |
| `core/test/sqlite-lock-safety.test.mjs` | 0 | 0 |
| `tools/testing/measure-context-read-product-fix1.test.mjs` | 0 | 0 |
| `tools/testing/measure-context-read-product-fix2.test.mjs` | 0 | 0 |
| `tools/testing/measure-context-read-product-v4.test.mjs` | 0 | 0 |
| `tools/testing/measure-context-read-product-v4fix1.test.mjs` | 0 | 0 |
| `tools/testing/measure-context-read-product-v4fix3.test.mjs` | 0 | 0 |
| `tools/testing/measure-context-read-product-v4fix4.test.mjs` | 0 | 0 |
| `tools/testing/measure-context-read-product.test.mjs` | 0 | 0 |
| `tools/testing/measure-topic-reader-wal.test.mjs` | 0 | 0 |

All **78 explicit test-file invocations exited 0**, including the full v4
suite, both touched regression suites, the round-three observation suite, the
29 context-read files, both SQLite lock guards and E1-C2. All eight syntax
invocations, both version checks and all four estimate-only invocations exited
**0**. The serial verification driver exited **0**.

The existing optional-`tiktoken` assembly case is skipped on each patch; no
dependency installation was attempted. The v4 suite retains **47/47** and the
round-three boundary suite **16/16** on both patches. The affected discovery
wrappers check their VM-enabled child's actual exit status.

A development affected-test run exited **1** with two failures: starting cleanup
before recording the timeout allowed cleanup-induced disconnect/exit to replace
the timeout reason. Recording and rejecting with the timeout first corrected
that ordering. The next affected run exited **0**, as did the expanded
**29-case** round-four/round-five run. Final matrix results above supersede
these development runs.

### Inventories and final scope checks

The test inventory was derived by filesystem globs plus explicit guard/E1-C2
paths, then independently by `rg --files` selection. The two sorted lists agree:
**39 test files / 32 required files**, inventory `diff -u` **exit 0**.

The changed-file inventory uses `git diff --name-only HEAD` plus untracked files.
The independent route hashes every HEAD tree blob against worktree bytes and
compares symlink/executable modes, then walks non-ignored files for new paths.
It covers scripts, docs, public assets and configuration without using the
first list as its boundary. Both lists agree at **5 changed files**,
inventory `diff -u` **exit 0**:

- `docs/plans/context-read-p2d-harness-impl.md`
- `tools/testing/fixtures/context-product/v4-runner.mjs`
- `tools/testing/fixtures/context-product/v4-session.mjs`
- `tools/testing/measure-context-read-product-v4fix1.test.mjs`
- `tools/testing/measure-context-read-product-v4fix4.test.mjs`

Final review also guarded cleanup memoization before child creation: a deadline
that fires before any child exists cannot cache a completed cleanup for a later
child. After this guard, all seven harness suites, both lock guards and E1-C2
ran again, separately and serially, on both patches: **20 final affected-file
invocations, each exit 0**. The table above uses these latest results for those
paths. The final affected driver exited **0**. Both round-five command families
and their base counterfactuals also repeated on both patches: current **exit 0**
(13 passes per patch), base **exit 1** (13 assertion failures per patch), with
zero cancellations. Final session syntax checks on both patches exited **0**.

Final `git diff --check`, the staged-diff check, independent changed-file and
test-inventory comparisons, tested-JavaScript hash comparison, added-local-path
and final-newline scans, and the unchanged engine/runtime/frozen-plan comparison
all exited **0**. The branch remains at `1671eafa`; all five changes are unstaged.
The process check found **zero** remaining verification processes. Both drivers
finished and their test wrappers confirmed owned process-group shutdown. Owned
verification scratch was removed after recording these results; no task or
monitor remains running for unattended supervision.
