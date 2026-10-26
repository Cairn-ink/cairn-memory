# E1-C2 WAL fresh-reader fix and smoke

Current implementation: see **Lock-safety fix round 2** below. Earlier handoff
results and header/inode-exclusion designs are historical and superseded.

Date: 2026-10-26. Node: v22.16.0. Branch: fix/wal-fresh-reader-busy. Uncommitted; primary commits and runs full queued acceptance.

## Cause and evidence

The instrumented zero-wait WAL control returned 35 storage_busy outcomes in 313 attempts. All 35 had SQLite primary/extended **5/5 (SQLITE_BUSY)**, canonical errstr **database is locked**. Overview failed at **execute/application_id**; members failed at **execute/user_version**. No SQLITE_BUSY_RECOVERY (261), BUSY_SNAPSHOT (517), BUSY_TIMEOUT (773), or LOCKED (6) was observed.

All **34** busy responses in fresh-writer cells returned during recorded writer close intervals. The WAL was absent after those closes. For example, the schema18 overview reader returned at 1793022571139 during close [1793022571138,1793022571144], after the public write finished at 1793022571138. Another returned at 1793022571177 during [1793022571176,1793022571182]. This supports **H1**, last-connection close/checkpoint/deletion racing the first metadata read with busy_timeout=0. The failure precedes overview enumeration.

The other busy result was retained/schema33 after window end: endAt 1793022605241, response 1793022605246, last public write finished 1793022605240. The retained writer then closed. That shutdown attribution is an inference because this smoke revision did not separately timestamp the retained shutdown close. The final harness records it explicitly. No recovery-specific code supports H2 in this run; H2 is not proven impossible. Missing companions alone are tolerated in quiet WAL reads and header tests; no CANTOPEN outcome supports H3 as an independent cause.

## Implementation

The explicit handle-level own-data option diagnostics:true adds error.diagnostics = {stage,statement,sqlite:{code,extendedCode}} to captured native storage failures. It covers opening, overview and members via Worker data, independent of env/execArgv. Closed enums exclude SQL, paths, identifiers, namespace/owner values, content and native messages. Default/false/undefined envelopes remain byte-identical. Existing legacy error classification is preserved.

WAL uses one **100ms request-wide native wait budget**, capped by the remaining monotonic request deadline. Refresh before prepare/execution, cached statements and iterator steps; SQL work consumes the same budget. No application retry/sleep or host-thread SQLite wait is added. Existing watchdog and close terminate the Worker. DELETE retains zero wait. Context-read and candidate evidence are unchanged.

Detection reads the existing main-file format-3 signature and read/write version bytes 18/19, enabling WAL waiting only for 2/2. A read-only descriptor uses O_NOFOLLOW and matches safe-file device/inode. Unknown/truncated headers retain zero wait and normal SQLite validation. This avoids a lock-taking PRAGMA journal_mode. No write connection, mode change, migration or immutable connection is introduced. Concurrent external journal-mode switching is outside this per-connection policy.

The E1-C candidate-copy anchors were updated so its existing tests still exercise the old measurement-only DELETE candidate. Its rejected wait is not used by production DELETE readers.

## Smoke output

Exactly one smoke invocation, exit **0**. Each of 40 cells ran once for 2s, using physical schema18 and schema33 fixtures of 1,112 Memories / four namespaces / 71 MOCs. All cells are observations, with no timing acceptance.

~~~sh
npm run measure:topic-reader-wal -- --smoke --report <temp-dir>/smoke.json
~~~

The control copies the reader closure and changes only TOPIC_WAL_WAIT_MS to zero; it reproduces the old policy with diagnostics rather than an untouched historical binary. Source hashes are registered before seeding. During seeding, error remapping was changed to preserve diagnostic provenance; it did not change the WAL wait or reported busy cases.

~~~text
schema journal writer variant attempts busy read95 writer/s write95 ratio loopMax gate
18 WAL retained baseline 0 0  147.50 8.75 1.00 10.63 observation
18 WAL retained zero-wait-overview 46 0 44.25 162.00 8.54 1.10 10.96 observation
18 WAL retained zero-wait-members 42 0 52.87 173.50 7.39 1.18 11.03 observation
18 WAL retained overview 44 0 46.90 172.50 5.82 1.17 11.26 observation
18 WAL retained members 40 0 52.56 130.50 10.70 0.88 10.99 observation
18 WAL fresh baseline 0 0  42.00 34.57 1.00 10.76 observation
18 WAL fresh zero-wait-overview 48 18 44.33 53.50 22.41 1.27 10.94 observation
18 WAL fresh zero-wait-members 40 0 49.68 57.00 18.35 1.36 11.07 observation
18 WAL fresh overview 42 0 53.17 52.00 23.43 1.24 10.98 observation
18 WAL fresh members 36 0 66.80 45.50 32.27 1.08 10.96 observation
18 DELETE retained baseline 0 0  55.00 27.26 1.00 10.40 observation
18 DELETE retained zero-wait-overview 51 50 41.97 55.00 25.73 1.00 11.01 observation
18 DELETE retained zero-wait-members 53 52 39.05 62.50 19.66 1.14 10.99 observation
18 DELETE retained overview 53 52 40.65 63.00 19.41 1.15 10.96 observation
18 DELETE retained members 51 50 41.93 50.00 27.23 0.91 11.03 observation
18 DELETE fresh baseline 0 0  46.00 30.05 1.00 10.67 observation
18 DELETE fresh zero-wait-overview 50 47 43.87 48.50 23.79 1.05 10.97 observation
18 DELETE fresh zero-wait-members 50 48 48.17 43.00 30.08 0.93 10.91 observation
18 DELETE fresh overview 52 49 43.60 37.00 34.68 0.80 11.00 observation
18 DELETE fresh members 46 44 51.31 46.00 30.55 1.00 11.01 observation
33 WAL retained baseline 0 0  106.50 15.13 1.00 10.56 observation
33 WAL retained zero-wait-overview 32 1 67.06 151.50 7.51 1.42 10.95 observation
33 WAL retained zero-wait-members 38 0 57.49 147.50 7.87 1.38 10.90 observation
33 WAL retained overview 30 0 75.08 136.50 8.89 1.28 11.03 observation
33 WAL retained members 37 0 57.34 132.00 11.27 1.24 10.99 observation
33 WAL fresh baseline 0 0  25.00 49.02 1.00 10.67 observation
33 WAL fresh zero-wait-overview 32 9 74.72 30.00 39.51 1.20 10.94 observation
33 WAL fresh zero-wait-members 35 7 65.23 29.50 34.25 1.18 11.03 observation
33 WAL fresh overview 29 0 82.02 30.50 39.85 1.22 11.00 observation
33 WAL fresh members 31 0 76.20 21.00 74.90 0.84 11.00 observation
33 DELETE retained baseline 0 0  25.00 66.80 1.00 10.49 observation
33 DELETE retained zero-wait-overview 49 48 44.68 58.00 20.93 2.32 10.96 observation
33 DELETE retained zero-wait-members 51 50 42.40 50.00 28.23 2.00 10.90 observation
33 DELETE retained overview 52 51 43.87 57.50 20.86 2.30 11.02 observation
33 DELETE retained members 52 52 40.52 58.50 20.75 2.34 11.00 observation
33 DELETE fresh baseline 0 0  36.00 27.22 1.00 10.47 observation
33 DELETE fresh zero-wait-overview 47 44 56.41 31.00 36.28 0.86 11.21 observation
33 DELETE fresh zero-wait-members 46 43 53.47 28.50 44.16 0.79 11.12 observation
33 DELETE fresh overview 45 43 51.61 31.00 34.73 0.86 11.03 observation
33 DELETE fresh members 46 43 52.94 32.00 33.47 0.89 11.03 observation
{"report":"<temp-dir>/smoke.json","status":"complete","trials":40}
~~~

Fixed WAL: **0/289 busy**, 88 successes, 201 cursor_stale. Maximum cell reader p95 **82.02ms**, writer p95 **74.90ms**, host loop max **11.26ms**. Two fixed-cell writer ratios were below 0.90: schema18/retained/members **0.88**, schema33/fresh/members **0.84**. All child writers exited 0 with no failures. No performance acceptance is claimed from this smoke.

Busy outcomes grouped by complete diagnostic tuple follow. Unless stated otherwise, primary/extended are **5/5**, public code storage_busy, canonical errstr database is locked. Every individual non-ok outcome is recorded by the harness; non-SQLite errors use null SQLite fields.

| Schema | Journal | Writer | Variant | Stage | Statement | Primary/extended | Count |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 18 | WAL | fresh | zero-wait-overview | execute | application_id | 5/5 | 18 |
| 18 | DELETE | retained | zero-wait-overview | execute | application_id | 5/5 | 49 |
| 18 | DELETE | retained | zero-wait-overview | execute | schema_metadata | 5/5 | 1 |
| 18 | DELETE | retained | zero-wait-members | execute | user_version | 5/5 | 52 |
| 18 | DELETE | retained | overview | execute | application_id | 5/5 | 47 |
| 18 | DELETE | retained | overview | execute | schema_metadata | 5/5 | 2 |
| 18 | DELETE | retained | overview | execute | snapshot_metadata | 5/5 | 1 |
| 18 | DELETE | retained | overview | execute | user_version | 5/5 | 1 |
| 18 | DELETE | retained | overview | prepare | schema_metadata | 5/5 | 1 |
| 18 | DELETE | retained | members | execute | user_version | 5/5 | 50 |
| 18 | DELETE | fresh | zero-wait-overview | execute | application_id | 5/5 | 35 |
| 18 | DELETE | fresh | zero-wait-overview | execute | schema_metadata | 5/5 | 6 |
| 18 | DELETE | fresh | zero-wait-overview | execute | snapshot_metadata | 5/5 | 4 |
| 18 | DELETE | fresh | zero-wait-overview | prepare | schema_metadata | 5/5 | 2 |
| 18 | DELETE | fresh | zero-wait-members | execute | user_version | 5/5 | 48 |
| 18 | DELETE | fresh | overview | execute | application_id | 5/5 | 42 |
| 18 | DELETE | fresh | overview | execute | schema_metadata | 5/5 | 4 |
| 18 | DELETE | fresh | overview | execute | snapshot_metadata | 5/5 | 2 |
| 18 | DELETE | fresh | overview | execute | user_version | 5/5 | 1 |
| 18 | DELETE | fresh | members | execute | user_version | 5/5 | 44 |
| 33 | WAL | retained | zero-wait-overview | execute | application_id | 5/5 | 1 |
| 33 | WAL | fresh | zero-wait-overview | execute | application_id | 5/5 | 9 |
| 33 | WAL | fresh | zero-wait-members | execute | user_version | 5/5 | 7 |
| 33 | DELETE | retained | zero-wait-overview | execute | application_id | 5/5 | 40 |
| 33 | DELETE | retained | zero-wait-overview | execute | snapshot_metadata | 5/5 | 5 |
| 33 | DELETE | retained | zero-wait-overview | execute | user_version | 5/5 | 3 |
| 33 | DELETE | retained | zero-wait-members | execute | application_id | 5/5 | 1 |
| 33 | DELETE | retained | zero-wait-members | execute | user_version | 5/5 | 49 |
| 33 | DELETE | retained | overview | execute | application_id | 5/5 | 40 |
| 33 | DELETE | retained | overview | execute | snapshot_metadata | 5/5 | 8 |
| 33 | DELETE | retained | overview | execute | user_version | 5/5 | 3 |
| 33 | DELETE | retained | members | execute | user_version | 5/5 | 51 |
| 33 | DELETE | retained | members | prepare | encoding | 5/5 | 1 |
| 33 | DELETE | fresh | zero-wait-overview | execute | application_id | 5/5 | 24 |
| 33 | DELETE | fresh | zero-wait-overview | execute | schema_metadata | 5/5 | 7 |
| 33 | DELETE | fresh | zero-wait-overview | execute | snapshot_metadata | 5/5 | 7 |
| 33 | DELETE | fresh | zero-wait-overview | execute | topic_metadata | 5/5 | 2 |
| 33 | DELETE | fresh | zero-wait-overview | None | None | None/None | 4 |
| 33 | DELETE | fresh | zero-wait-members | execute | user_version | 5/5 | 43 |
| 33 | DELETE | fresh | overview | execute | application_id | 5/5 | 22 |
| 33 | DELETE | fresh | overview | execute | schema_metadata | 5/5 | 15 |
| 33 | DELETE | fresh | overview | execute | snapshot_metadata | 5/5 | 3 |
| 33 | DELETE | fresh | overview | execute | topic_metadata | 5/5 | 3 |
| 33 | DELETE | fresh | members | execute | user_version | 5/5 | 43 |

Four DELETE/schema33/fresh/zero-wait-overview control outcomes have null native metadata: the smoke exposed native for-of iteration bypassing the diagnostic iterator wrapper. The final implementation returns its wrapped iterator from Symbol.iterator and has a deterministic for-of fault assertion; the wait refresh now also covers those steps. No second smoke was run. The raw report was temporary; this table and the exact smoke stdout preserve the outcome counts and metadata.

## Contract delta

The complete additive contract text is [E1-C2 additive contract v1](topic-overview-member-pages.md#e1-c2-additive-contract-v1-2026-10-26). Public usage and allowlists are in [topic-overview.md](../topic-overview.md#e1-c2-v1-opt-in-storage-diagnostics-and-wal-waits). Existing E1-M text is unchanged; the delta adds diagnostics and selects the 100ms deadline-capped WAL policy. Existing legacy parity assertions were not edited.

## Commands and actual exit codes

Each test command redirected output, saved rc=$?, and printed EXIT_CODE=$rc; no pipe masked its status.

~~~sh
node --version # exit 0: v22.16.0
node --test core/test/topic-reader-sqlite.test.mjs tools/testing/measure-topic-reader-wal.test.mjs tools/testing/measure-topic-overview-contention.test.mjs
# Initial exit 1: two double-close test cleanup errors and one incorrect prepare/execute assertion.
# Corrected only the new tests; rerun exit 0, 15/15. Later expanded assertions: exit 0, 16/16.
node --test --test-concurrency=1 core/test/topic-reader-sqlite.test.mjs core/test/topic-overview.test.mjs core/test/topic-overview-lifecycle.test.mjs core/test/topic-overview-raw29.test.mjs core/test/topic-overview-visibility.test.mjs core/test/topic-members.test.mjs core/test/topic-members-bounds.test.mjs core/test/topic-members-compatibility.test.mjs core/test/topic-members-integration.test.mjs core/test/topic-members-mutations.test.mjs core/test/topic-members-primary.test.mjs core/test/topic-members-recheck-findings.test.mjs core/test/topic-members-review-findings.test.mjs core/test/topic-members-round3-findings.test.mjs core/test/topic-members-scale.test.mjs core/test/topic-members-visibility.test.mjs tools/testing/measure-topic-reader-wal.test.mjs tools/testing/measure-topic-overview-contention.test.mjs
# First explicit regression run: exit 0, 226/226. Baseline b2513501: 184 comparisons/0 differences;
# fault parity: 154 comparisons/0 differences. Existing assertions unchanged.
~~~

The final regression rerun after the iterator fix and inventory results are recorded below.

## Residual risk and primary work

Full >=5 x 30s measurement remains required under the machine-wide queue. Two short-run writer ratios missed 90%; no threshold was relaxed. Same-namespace concurrent writes legitimately produce cursor_stale, separately recorded. Native busy timeouts and watchdog scheduling are not hard real-time guarantees. The primary owns Node24.15.0, queued full CI/installed artifact checks, full measurement and commit. No full measurement, broad suite, network or paid calls were run. No unattended task or monitoring promise remains at handoff.


## Final verification and delivery inventory

The final repeat of the exact explicit regression command above exited **0**,
**227/227 passed**, after the iterator correction. No broad suite was run.
The only subsequent runtime edit was a comment clarification.

- Syntax verification: node --check for each changed/new .mjs (10 files), and
  JSON parsing for changed configs (2 files), all actual exit codes 0.
- git diff --check: exit 0.
- An independent whitespace scan over tracked changes plus untracked files:
  exit 0, 15 files, no trailing whitespace or missing final newline.
- Import/Worker reachability checked with installedImportClosure from
  core/memory-reader.mjs and core/topic-overview-worker.mjs: 52 required files,
  zero missing from packaging/artifact-files.json, exit 0. All three affected
  shipped docs are registered, including this report; one new runtime module.
- Changed inventory: union of git diff --name-only HEAD and git ls-files
  --others --exclude-standard, independently compared with paths from
  git status --porcelain=v1 -z. Exact set equality, exit 0, **15 files**.

~~~text
core/memory-reader.mjs
core/read-database.mjs
core/test/topic-reader-sqlite.test.mjs
core/topic-members-session.mjs
core/topic-overview-input.mjs
core/topic-overview-worker.mjs
core/topic-reader-sqlite.mjs
docs/plans/topic-overview-member-pages.md
docs/plans/topic-reader-wal-fix.md
docs/topic-overview.md
package.json
packaging/artifact-files.json
tools/testing/measure-topic-overview-contention.mjs
tools/testing/measure-topic-reader-wal.mjs
tools/testing/measure-topic-reader-wal.test.mjs
~~~


## Fix round 1: review resolution and protocol v2

The sections above preserve the initial handoff. Its implementation is committed
as 3e6185c2; this round is based on a85991e8 and remains uncommitted for the
primary. The primary's writer IPC send-callback wait and exit/disconnect handling
are preserved byte-for-byte (two independently extracted source blocks compared
against a85991e8, exit 0).

All seven findings are resolved:

| Finding | Resolution and deterministic coverage |
| --- | --- |
| Standards P2: absent iterator methods | Only existing iterator functions are wrapped; absent throw stays undefined. A native in-memory yield-delegation cancellation test then drops the table, proving no active cursor remains, in both proxy modes. |
| Standards P2: statement constructor | Pass through constructor; compare native constructor identity and prototype. |
| Standards P2: timeout error attribution | Timeout installation has its own error boundary, outside the statement handler: configure/reader_configuration. Fault injection targets timeout, prepare, BEGIN, get and iterator steps separately, asserting exact labels and executed operations. |
| Spec P1: native busy acceptance | Re-derive counters from retained attempts. Count primary SQLite 5/6 independently of public storage_busy; reject either in production WAL acceptance. One-success/99-legacy-mapped BUSY or LOCKED probes now fail. cursor_stale is separate; unexpected failures fail. |
| Spec P1: missing overlap | Pre-register 20 write-overlapping attempts, 10 fresh per-write-close-overlapping attempts, and 100 in-window public-write commits in both cell and baseline. Re-derive exposure from raw intervals/commits; insufficient exposure is invalid. Tests cover absent/below-bound overlap, insufficient/window-excluded commits, retained close exemption and unchanged raw attempts. |
| Spec P2: truncated headers | Require a complete 100-byte header; test all lengths 20 through 99 with valid-looking WAL prefixes, plus complete WAL and DELETE headers. |
| Spec P2: stale rollback timeout | Refresh before rollback; controlled clock consumes 100ms and verifies busy_timeout=0 immediately before ROLLBACK. |

Product reporting is implemented as writer.writeLatency.p95Ms/maxMs for every
reader-load cell, measured around the public write call and separated from the
full open/write/close lifecycle latency. Public-write p95 retains the 250ms gate;
max is reported without inventing an additional limit. The original 0.90 ratio
remains in engineThroughput as a reported reference with acceptanceGate:false.
The WAL wait remains 100ms; it was not tuned. Commit instrumentation excludes
opener commits. Overlap is clipped to the measurement window; retained shutdown
close is reported separately and cannot satisfy fresh per-write-close exposure.

The header and saved protocol were changed to E1-C2-v2 before the only smoke.
Full-window exposure minima apply per 30s cell and are not asserted by smoke.
The additive contract v2 and public docs state these changes. There are no new
runtime modules or shipped docs in this round; existing registrations suffice.

### Round 1 commands and actual exits

Only the two touched test files were run, by explicit path. The same test command
was run three times as assertions/diagnostic error-boundary structure were
completed; every run exited 0 with 16/16 tests. The last run follows the final
runtime change. No broad suites, network, paid calls or full measurement ran.

~~~sh
node --test core/test/topic-reader-sqlite.test.mjs tools/testing/measure-topic-reader-wal.test.mjs
# exit 0; 16/16 tests
npm run measure:topic-reader-wal -- --smoke --report <temp-dir>/smoke.json
# exit 0; exactly one smoke, 40 cells, one 2s window per cell
~~~

After the smoke, the timeout-installation error handler was moved outside the
caller handler (same tested boundary labels, no wait or gate change) and one
trailing space was removed; the final 16-test rerun passed. No second smoke ran.
This is smoke validation, not full performance acceptance.

### Round 1 smoke output

All 40 separate writer processes exited 0 and delivered complete results. All
32 reader-load cells have numeric per-write p95/max. No unexpected reader
failures occurred. Every recorded native commit belongs to an actual public
write interval, independently cross-checked from the raw report. Every reader
attempt remains present in readerCalls.

Fixed WAL summary: {"attempts": 313, "cursorStale": 166, "maxWriteLatency": 31.22479099999987, "maxWriteP95": 27.2626479999999, "publicBusy": 0, "sqliteBusy": 0, "successes": 147}.

Zero-wait WAL control: {"attempts": 326, "cursorStale": 162, "maxWriteLatency": 31.882817999999986, "maxWriteP95": 26.066855000000032, "publicBusy": 49, "sqliteBusy": 49, "successes": 115}.

~~~text
schema journal writer variant attempts publicBusy sqliteBusy stale unexpected read95 writer/s lifecycle95 write95/writeMax commits writeOverlap/closeOverlap ratio loopMax gate
18 WAL retained baseline 0 0 0 0 0  108.50 9.98 9.97/20.74 217 0/0 1.00 10.43 observation
18 WAL retained zero-wait-overview 44 0 0 18 0 46.52 106.50 11.30 11.30/29.54 213 44/0 0.98 10.97 observation
18 WAL retained zero-wait-members 41 0 0 41 0 51.73 107.00 11.28 11.28/23.96 214 41/0 0.99 11.04 observation
18 WAL retained overview 45 0 0 23 0 46.33 107.50 10.67 10.67/23.40 215 45/0 0.99 11.03 observation
18 WAL retained members 43 0 0 41 0 48.01 110.50 9.78 9.78/22.28 221 43/0 1.02 11.05 observation
18 WAL fresh baseline 0 0 0 0 0  27.50 39.44 25.87/30.37 55 0/0 1.00 10.27 observation
18 WAL fresh zero-wait-overview 48 20 20 8 0 45.17 30.50 39.10 26.07/26.89 61 47/46 1.11 11.01 observation
18 WAL fresh zero-wait-members 44 17 17 13 0 52.84 30.00 38.60 25.42/29.08 60 42/42 1.09 10.98 observation
18 WAL fresh overview 42 0 0 5 0 61.94 26.50 44.33 27.21/31.02 54 40/39 0.96 10.90 observation
18 WAL fresh members 38 0 0 17 0 69.80 31.00 38.72 27.26/31.22 62 36/35 1.13 11.08 observation
18 DELETE retained baseline 0 0 0 0 0  36.50 32.48 32.48/35.08 73 0/0 1.00 10.46 observation
18 DELETE retained zero-wait-overview 53 52 52 0 0 39.27 36.50 30.60 30.60/32.33 73 53/0 1.00 11.05 observation
18 DELETE retained zero-wait-members 54 53 53 0 0 39.66 37.00 30.79 30.79/35.28 74 54/0 1.01 11.04 observation
18 DELETE retained overview 54 54 54 0 0 38.12 36.50 34.65 34.65/35.35 73 54/0 1.00 11.02 observation
18 DELETE retained members 52 51 51 0 0 41.16 39.50 29.32 29.32/35.55 79 52/0 1.08 11.06 observation
18 DELETE fresh baseline 0 0 0 0 0  34.00 35.22 31.39/38.36 68 0/0 1.00 10.58 observation
18 DELETE fresh zero-wait-overview 52 49 49 0 0 43.03 31.50 35.27 33.51/43.69 63 50/13 0.93 11.03 observation
18 DELETE fresh zero-wait-members 50 47 47 0 0 52.39 28.50 41.41 38.43/42.17 57 48/17 0.84 11.08 observation
18 DELETE fresh overview 48 46 46 0 0 45.48 31.00 35.86 33.99/37.33 62 46/21 0.91 11.08 observation
18 DELETE fresh members 51 49 49 0 0 47.37 31.50 35.74 33.89/35.86 63 49/20 0.93 11.06 observation
33 WAL retained baseline 0 0 0 0 0  110.00 11.54 11.54/26.80 220 0/0 1.00 10.31 observation
33 WAL retained zero-wait-overview 34 1 1 19 0 61.10 108.50 11.85 11.84/31.88 217 34/0 0.99 11.03 observation
33 WAL retained zero-wait-members 41 0 0 38 0 56.07 105.00 11.99 11.99/26.49 210 41/0 0.95 10.94 observation
33 WAL retained overview 34 0 0 26 0 61.27 105.50 11.61 11.60/26.78 211 34/0 0.96 10.94 observation
33 WAL retained members 41 0 0 38 0 56.23 102.50 12.66 12.65/27.74 205 41/0 0.93 10.99 observation
33 WAL fresh baseline 0 0 0 0 0  21.50 51.06 24.74/30.74 43 0/0 1.00 10.37 observation
33 WAL fresh zero-wait-overview 35 6 6 9 0 64.59 23.50 53.26 24.81/25.41 47 33/33 1.09 11.00 observation
33 WAL fresh zero-wait-members 39 5 5 16 0 56.07 23.50 52.92 24.75/28.04 47 37/37 1.09 11.18 observation
33 WAL fresh overview 33 0 0 5 0 63.20 26.50 48.36 26.03/27.08 53 31/31 1.23 11.07 observation
33 WAL fresh members 37 0 0 11 0 63.96 26.00 50.06 23.81/24.80 53 35/35 1.21 10.95 observation
33 DELETE retained baseline 0 0 0 0 0  36.00 34.68 34.68/37.13 72 0/0 1.00 10.32 observation
33 DELETE retained zero-wait-overview 53 52 52 0 0 40.88 32.50 35.43 35.43/42.30 65 53/0 0.90 11.06 observation
33 DELETE retained zero-wait-members 53 52 52 0 0 41.21 33.00 35.95 35.95/39.91 66 53/0 0.92 10.99 observation
33 DELETE retained overview 53 52 52 0 0 40.71 35.00 34.84 34.84/37.38 70 53/0 0.97 11.03 observation
33 DELETE retained members 53 52 52 0 0 39.61 35.00 35.14 35.13/37.00 70 53/0 0.97 10.90 observation
33 DELETE fresh baseline 0 0 0 0 0  24.00 45.24 33.22/34.09 48 0/0 1.00 10.32 observation
33 DELETE fresh zero-wait-overview 45 42 42 0 0 60.10 20.50 49.95 37.25/39.19 41 43/40 0.85 10.92 observation
33 DELETE fresh zero-wait-members 46 44 44 0 0 50.32 21.50 49.53 36.39/37.73 43 44/43 0.90 10.86 observation
33 DELETE fresh overview 47 45 45 0 0 57.35 22.00 48.70 35.14/37.05 44 45/43 0.92 11.15 observation
33 DELETE fresh members 47 44 44 0 0 52.09 21.50 48.19 35.94/36.29 43 45/43 0.90 11.07 observation
{"report":"<temp-dir>/smoke.json","status":"complete","trials":40}
~~~

### Round 1 final inventory and checks

Changed-file sets from git diff --name-only HEAD plus git ls-files --others
--exclude-standard and independently git status --porcelain=v1 -z are identical:
**7 files**, exit 0. Whitespace scan includes all these paths and untracked files:
exit 0. node --check on each of the four changed .mjs files: exit 0.

~~~text
core/test/topic-reader-sqlite.test.mjs
core/topic-reader-sqlite.mjs
docs/plans/topic-overview-member-pages.md
docs/plans/topic-reader-wal-fix.md
docs/topic-overview.md
tools/testing/measure-topic-reader-wal.mjs
tools/testing/measure-topic-reader-wal.test.mjs
~~~


Exact syntax/whitespace commands (each exit 0):

~~~sh
node --check core/test/topic-reader-sqlite.test.mjs
node --check core/topic-reader-sqlite.mjs
node --check tools/testing/measure-topic-reader-wal.mjs
node --check tools/testing/measure-topic-reader-wal.test.mjs
git diff --check
~~~

Inline read-only closure assertions exited 0: installedImportClosure over the
reader and Worker found 52 required files, all in the manifest; all three
modified shipped docs are registered. An independent repository-only static
MCP traversal found 58 modules and zero node:sqlite imports (exit 0); external
packages were not traversed. No new manifest entries were needed. Final
inventory equality and whitespace were rechecked after this report update.
The full v2 measurement remains for the primary's machine-wide queue. No claim
of full performance acceptance follows from the single 2s smoke.


## E1-C2 v1.0.1 lock-safety (2026-10-27)

The old header probes are unsafe: POSIX record locks are process/inode-owned,
and closing any descriptor for the inode releases all of that process's locks.
Worker threads share the process, and Worker exit closes even cached fds.

| Site | Affected | Resolution |
| --- | --- | --- |
| topicJournalMode | Yes | Replace main-file open/read/close with the read-only reader connection's `PRAGMA journal_mode`. |
| context-read walHeader | Yes | Both canonical and sidecar paths are probed, including with live host connections. Replace with an isolated SQLite-only probe; preserve no-transient-companion refusal. |
| store-fence pin/check/close | Yes | Pins overlap canonical connections in fenced openers, MCP hosts, and method/asset/context review commands. Retain and recheck lstat identity; remove the raw fd and make close a no-op. Use the isolated SQLite probe for rollback-mode validation. |
| database ax creation | Yes, narrow creation race | O_EXCL refuses preexisting inodes, but another Worker can open the new inode before close. Move exclusive creation/close into a child process. |
| sidecar O_CREAT/O_EXCL creation | Yes, narrow creation race | Same child-owned exclusive creation; no host fd. |
| local raw setup wx creation | Yes, narrow creation race | Additional site in integrations. Its awaited stat/sync previously widened the create-to-close window; use the same child-owned creation helper. |

Historical initial audit: no additional intentional DB/companion reads were
identified in adapters, setup lib, integrations or plugins. Review subsequently
found that the generic asset input channel also needed explicit inode exclusions
(see lock-safety fix round 1 below). At that initial handoff, the setup engine
archive still contained the three unsafe probes and three creation closes;
the primary later regenerated it in 3b94921d.

Topic detection uses companion lstat hints, never raw descriptors. WAL/SHM
without a rollback journal enables waiting on the first journal-mode query.
Otherwise start at zero; BUSY with a rollback journal is returned immediately.
BUSY without one retries only that opening query once under the original 100ms
request budget/deadline. Clear provisional timeout before applying the detected
mode policy. DELETE metadata/page statements stay at zero. No traversal or
transaction retries, mode changes, schema migrations or immutable reads.
The closed diagnostics statement enum gains journal_mode; first failures can
move to prepare/journal_mode or execute/journal_mode.

An absent journal cannot distinguish a WAL reset from a DELETE exclusive
transaction before its first journaled write, OFF/MEMORY journaling, or mode
switching. Those ambiguous openings may use the bounded fallback. A stale
rollback journal can suppress a WAL wait. Companion stats are not atomic and
concurrent external mode switching remains unsupported.

The isolated rollback probe uses read-only SQLite with URI nolock=1: WAL
returns CANTOPEN before SQLite creates companions. It never reads tables or
changes modes. Running this no-lock VFS in the host would recreate the same
close hazard, so a short-lived child is mandatory. A successful DELETE result
is cached by inode/size/nanosecond mtime/ctime, checked before and after the
probe. Cache misses add process-start cost; errors/timeouts/replacements fail
closed. Existing corrupt-sidecar rebuild handling is retained. SQLITE_READONLY from a
hot rollback journal is delegated to normal writable SQLite recovery; read-only
preflight refuses the journal before probing.

### Regression evidence

The new public-API regression was copied unchanged into a temporary git archive
of **546d57ac**; no other worktree was touched. On Node **22.16.0** and
**24.22.1**, it exits **1**, with **six failures of eight tests**: both DELETE
reader methods lose the writer lock, WAL loses its main-file SHARED lock, and
context canonical probes lose read locks, and sidecar/fence closes lose writer locks. Child contenders perform no
writes after acquiring a lock, avoiding deliberate corruption in the control.
The WAL checkpoint/snapshot checks are supplemented by an exclusive-lock read
because a surviving SHM read-mark alone does not prove main-file lock safety.

The CI guard scans source plus the setup runtime tree and compressed engine,
uses exact source lines and multiplicity with one-line justifications, and
self-tests the old header pattern and alternative fs spellings. The source
and scanner self-tests passed. Historically, the archived-engine test was red
at the initial handoff; the primary's regenerated bundle passed verification
at 3b94921d (see the round 1 verification below).


### Final scoped verification and handoff

Only explicit permitted test paths were run; no broad npm suites, network,
keys, commits or bundle regeneration. Exit codes were captured from the actual
Node process, never inferred through a stdout pipeline.

| Check | Result | Exit |
| --- | --- | --- |
| 546d57ac control, Node 22.16.0 | 2 pass / 6 fail, eight unchanged lock regressions | 1 |
| 546d57ac control, Node 24.22.1 | 2 pass / 6 fail, same regressions | 1 |
| Fixed Node 24.22.1 lock regressions | 8 / 8 pass | 0 |
| Fixed Node 22.16.0 context-core, sidecar and lock regressions | 50 / 50 pass | 0 |
| Fixed Node 22.16.0 recovery, topic-reader-sqlite and method-package fences | 34 / 34 pass | 0 |
| SQLite-free static closure / workflow inventory | 1 / 1 pass | 0 |
| Source raw-fs guard and scanner regressions | 2 / 2 pass, 185 justified references | 0 |
| Full raw-fs guard including committed setup engine archive | 2 pass / 1 fail: stale bundle raw opens | 1 |

The initial 39-file permitted run completed 484 tests: 479 pass / 5 fail,
exit 1. Three hot-journal recovery failures were corrected by preserving normal
SQLite recovery; one static-closure failure came from an apparent static import
inside a child script and was changed to a child-only dynamic import. The fifth
was a 500ms context deadline exceeded during a measured 576ms filesystem commit.
All affected files passed the focused reruns above; no full-matrix acceptance
is claimed. Source syntax/JSON and whitespace checks passed, exit 0.

Historical handoff status: the full guard failed until the primary regenerated
packages/setup/runtime, including its compressed engine, in 3b94921d. No unsafe
bundle exception was added to the allowlist.

Changed inventory: git diff --name-only HEAD plus git ls-files --others
--exclude-standard was independently compared with git status --porcelain=v1 -z.
Exact set equality: **15 files**. The new runtime helper and all changed
shipped docs are registered in packaging/artifact-files.json.

```text
core/context-read-sidecar.mjs
core/database.mjs
core/read-database.mjs
core/sqlite-journal-probe.mjs
core/store-fence.mjs
core/test/fixtures/no-raw-db-fd-allowlist.json
core/test/no-raw-db-fd.test.mjs
core/test/sqlite-lock-safety.test.mjs
core/test/topic-reader-sqlite.test.mjs
core/topic-reader-sqlite.mjs
docs/plans/topic-overview-member-pages.md
docs/plans/topic-reader-wal-fix.md
docs/topic-overview.md
integrations/client/raw/local-setup-init.mjs
packaging/artifact-files.json
```


## Lock-safety fix round 1 (2026-10-27; historical)

Handoff results below describe the author state before the primary committed
1e68d801 and regenerated the engine bundle. Round 2 supersedes its input-read
and guard design. Based on 3b94921d. The v1.0.1 exception remains accepted and unchanged: an
exclusive DELETE transaction with no journal can receive the bounded opening
wait. Detected DELETE statements retain zero wait. This round changes no wait
budget or contention gate.

| Finding | Fix | Regression |
| --- | --- | --- |
| Standards P1: guard bypasses | Tokenize imports across whitespace/comments; audit the entire import declaration and every fs binding (including metadata-only imports). Also audit dynamic import/require call boundaries, including createRequire aliases. Keep exact call-site multiplicity. No dependencies added. | no-raw-db-fd negative self-tests cover promises aliases, dollar identifiers, mixed imports, multiline dynamic imports, namespace/default bindings, quoted export names and FileHandle acquisition. |
| Standards P1: asset inputs can open storage | Require the store path; pass the pinned store identity from the asset command. Retain and refresh dev/ino exclusions for the canonical DB, context sidecar and all WAL/SHM/journal companions. Check lstat/stat before pins and the pinned inode before opening for data. This preserves the existing O_PATH pin/revalidation protocol; inode checks avoid a new child protocol for asset review. | sqlite-lock-safety tests reject direct single-link paths and hard-link aliases during host transactions, then verify a separate-process contender stays BUSY. DELETE and WAL cover DBs, sidecar, journals, WAL and SHM. Existing asset close/error tests retain their assertions with the now-required store argument. |
| Spec P1: unreadable sidecar enters rebuild | Isolated probe records open/query provenance. Open failures become unsafe_file; writable SQLite constructor failures also become unsafe_file. Neither can enter deletion/rebuild. | context-read-sidecar injects CANTOPEN at the actual child constructor; read-only and writable paths return unsafe_file, retain bytes/inode and emit no filesystem events. Existing checkpointed-WAL and corrupt-rebuild tests remain. |
| Spec P1: legacy precedence | Non-BUSY/non-LOCKED mode detection failures defer to the original metadata validation. Correct the misleading header-only description: journal_mode may parse schema metadata. | topic-reader-sqlite compares wrong application ID plus malformed sqlite_master SQL against the vendored b2513501 reader; both return unsupported_database. |
| Standards P2: failed exclusive creation | In the isolated child, create a unique same-directory 0600 wx stage, fsync and close it, publish with link (no replacement), unlink stage and fsync directory. Pre-publication failures clean the stage. A later attempt removes stages belonging to dead children; existing targets are never replaced or removed. | sqlite-journal-probe injects file-fsync failure and a timeout after stage creation. Both leave no target; normal local setup retries successfully and removes dead stages. A competing target between fsync and link remains intact. |
| Spec P2: stale report | Mark initial red archived-guard claims historical and record primary-regenerated bundle verification separately from this round's stale bundle. | Run the generated-runtime/archive test from the 3b94921d guard and allowlist against the committed bundle: 1/1 pass, exit 0. |

Publication recovery is deliberately no-replace. If interrupted before link,
only a stage can remain and a subsequent attempt cleans it once its child PID
is dead. If interrupted after link, the published target remains; an existing
target is still refused with EEXIST rather than overwritten. Directory-sync
errors after publication carry published:true. PID reuse can defer stale-stage
cleanup until that PID exits; it cannot grant replacement of a target.

### Round 1 verification

Commands use explicit test paths, Node 22.16.0 unless specified, and actual
process exit codes. No network, real keys, commits or bundle regeneration.

- Original eight lock regressions on a newly created detached 546d57ac
  worktree: Node 22.16.0 and 24.22.1 each exit 1, 2 pass / 6 fail. Test source
  equals the current original-eight prefix and 3b94921d, ignoring only a separator
  blank line; SHA256 760d63e31d1e472f52b5c04f302fbf6b25d98988438aefbc30ac593bab6b4c4a.
  The detached worktree was removed; removal and absence verification exit 0.
- Current expanded sqlite-lock-safety suite: Node 22.16.0 and 24.22.1 each
  exit 0, 10/10 pass (original eight plus DELETE/WAL asset-input cases).
- Regenerated baseline bundle: original 3b94921d guard/allowlist, generated
  runtime and archived-engine test only: exit 0, 1/1 pass.
- This round's source guard and negative self-tests: exit 0, 2/2 pass.
  At that handoff the complete guard exited 1 on the stale bundle. The primary
  subsequently regenerated it in 1e68d801; the round-1 complete guard on that
  committed bundle is verified separately below. No bundle exception was added.

The first focused run exited 1 (49 pass / 1 fail): the new fixture updated an
empty sidecar table, which produced no journal. The corrected fixture writes
user_version to ensure a real journal; the lock reruns above pass.

The complete scoped Node 22.16.0 run below finished with **637/637 tests
passing, exit 0** (43 explicit files; 554 top-level cases plus nested tests).
It includes every requested topic/context-read file, both lock/creation files,
the existing asset-files/assets/asset-export tests and local-host-setup tests.
The final sidecar constructor-fault rerun also exits 0, 1/1 pass. No broad npm
suite was run. The source guard audits 276 exact references, including imports;
unused or excess allowlist multiplicities are rejected in both directions.

The explicit 43-path regression command (path set independently cross-checked
using Python glob and rg --files, equality exit 0) is:

```sh
node --test --test-concurrency=1 \
  core/test/topic-members-bounds.test.mjs \
  core/test/topic-members-compatibility.test.mjs \
  core/test/topic-members-integration.test.mjs \
  core/test/topic-members-mutations.test.mjs \
  core/test/topic-members-primary.test.mjs \
  core/test/topic-members-recheck-findings.test.mjs \
  core/test/topic-members-review-findings.test.mjs \
  core/test/topic-members-round3-findings.test.mjs \
  core/test/topic-members-scale.test.mjs \
  core/test/topic-members-visibility.test.mjs \
  core/test/topic-members.test.mjs \
  core/test/topic-overview-lifecycle.test.mjs \
  core/test/topic-overview-raw29.test.mjs \
  core/test/topic-overview-visibility.test.mjs \
  core/test/topic-overview.test.mjs \
  core/test/topic-reader-sqlite.test.mjs \
  core/test/context-read-assembly-races.test.mjs \
  core/test/context-read-assembly-readonly.test.mjs \
  core/test/context-read-assembly.test.mjs \
  core/test/context-read-bm25.test.mjs \
  core/test/context-read-budget.test.mjs \
  core/test/context-read-core.test.mjs \
  core/test/context-read-embedder.test.mjs \
  core/test/context-read-fusion.test.mjs \
  core/test/context-read-local-embedder.test.mjs \
  core/test/context-read-local-status.test.mjs \
  core/test/context-read-moc-source.test.mjs \
  core/test/context-read-process.test.mjs \
  core/test/context-read-recovery.test.mjs \
  core/test/context-read-review.test.mjs \
  core/test/context-read-sidecar.test.mjs \
  core/test/context-read-source-work.test.mjs \
  core/test/context-read-sources-authority.test.mjs \
  core/test/context-read-sources-bounds.test.mjs \
  core/test/context-read-sources-races.test.mjs \
  core/test/context-read-sources.test.mjs \
  core/test/context-read-tokenize.test.mjs \
  core/test/sqlite-lock-safety.test.mjs \
  core/test/sqlite-journal-probe.test.mjs \
  adapters/mcp/test/asset-files.test.mjs \
  adapters/mcp/test/assets.test.mjs \
  adapters/mcp/test/asset-export.test.mjs \
  integrations/client/test/local-host-setup.test.mjs
```

Additional final commands:

```sh
node --test core/test/sqlite-journal-probe.test.mjs
node --test --test-concurrency=1 core/test/sqlite-lock-safety.test.mjs adapters/mcp/test/asset-files.test.mjs adapters/mcp/test/assets.test.mjs
node --test --test-name-pattern='runtime raw|guard rejects' core/test/no-raw-db-fd.test.mjs
node --test core/test/no-raw-db-fd.test.mjs
# Node 24.22.1:
node --test --test-reporter=tap core/test/sqlite-lock-safety.test.mjs
```

Final focused creation tests: exit 0, 5/5 pass (file fsync, pre-link timeout,
competing publication, directory fsync and post-link timeout). Final Node 22
asset/lock rerun: exit 0, 62/62 pass after the required store argument and retained
inode exclusions. Final Node 24 lock rerun: exit 0, 10/10 pass.

Import/Worker/CLI reachability (memory-reader, topic-overview-worker, MCP CLI,
local-setup-init): 231 required files, zero missing from artifact-files.json;
both changed shipped docs registered, exit 0. No new runtime module was added.

### Round 1 changed inventory (final committed state)

The pre-commit handoff listed 14 source/test/doc files. The final 1e68d801
commit has **16 files**, including the regenerated engine archive and manifest.
Cross-checked using git diff --name-only 3b94921d 1e68d801 and independently
git show --format= --name-only 1e68d801: equal sets, count 16, exit 0.
The following pre-commit validation is historical:

Union of git diff --name-only HEAD and git ls-files --others --exclude-standard
compared with independently parsed git status --porcelain=v1 -z: diff exit 0,
**14 source/test/doc files** before bundle regeneration. This includes the then-untracked creation regression test. Every changed
.mjs (11) passes node --check, actual exits 0; JSON parse, git diff --check and
independent whitespace/newline checks over all 14 files exit 0. The runtime
bundle had no changed paths at that handoff. The final committed 16-path
inventory, including the primary-regenerated bundle, is:

```text
adapters/mcp/asset-command.mjs
adapters/mcp/asset-files.mjs
adapters/mcp/test/asset-files.test.mjs
core/context-read-sidecar.mjs
core/read-database.mjs
core/sqlite-journal-probe.mjs
core/test/context-read-sidecar.test.mjs
core/test/fixtures/no-raw-db-fd-allowlist.json
core/test/no-raw-db-fd.test.mjs
core/test/sqlite-journal-probe.test.mjs
core/test/sqlite-lock-safety.test.mjs
core/test/topic-reader-sqlite.test.mjs
docs/plans/topic-overview-member-pages.md
docs/plans/topic-reader-wal-fix.md
packages/setup/runtime/engine/cairn-memory-local-preview-0.0.0-preview.1.tgz
packages/setup/runtime/engine/manifest.json
```


## Lock-safety fix round 2 (2026-10-27)

Based on 1e68d801; uncommitted. No wait budget, contention gate or creation
recovery policy changes. No setup runtime regeneration in this round.

| Decision | Change | Deterministic coverage |
| --- | --- | --- |
| A: isolate arbitrary input reads | A shared SQLite-free helper launches a fixed script with process.execPath, no shell, env:{}, a 5s timeout and size-derived maxBuffer. Only the child opens/reads/closes input data. Asset and method inputs retain O_PATH pins, mount/type/nlink checks, byte caps, strict decoding and review-time identity checks. Child metadata includes dev/ino/mode/size/nlink/nanosecond mtime/ctime and is checked before/after each read and against the host pin. Review dependencies retain the 32KiB limit plus one overflow byte and Error class. Remove round-1 inode exclusions and host data-open allowlist entries. | DELETE/WAL lock tests for asset, method-package and review-card: canonical DB, sidecar, companions, hard links and another live store; child contenders remain BUSY until host rollback. Existing confinement faults now inject into actual child syscalls. Isolated reader tests prove exact bytes/identity, overflow cap/close and bounded failure handling. |
| B: static tripwire | Comment/string/regex-aware tokens replace line heuristics; decode escaped identifiers; flag fs re-exports, computed members and non-literal builtin/require/createRequire loaders. Remove string/comment false positives from the exact allowlist. | Negative self-tests for each spelling, including calls after block-comment terminators and computed accesses with previously allowed import boundaries. Source audit retains exact multiplicity and stale-entry checks. |
| C: reset failure | Defer only non-lock journal-query errors inside the query boundary; timeout reset remains outside that catch. The opener closes on reset failure. | Inject SQLITE_NOMEM on busy_timeout=0 after a stale WAL hint installs a positive timeout on DELETE; assert original error/diagnostics, one close and no returned connection. Legacy wrong-ID/malformed-schema precedence still passes. |
| D: creation recovery | Documentation only; deferred to installer owner below. | Existing sqlite-journal-probe post-link directory-fsync/timeout tests remain required; no recovery implementation. |
| E: records | Distinguish historical handoffs, final round-1 commit and current source/archive status; update inventories and verification below. | Mechanically cross-check path sets, artifact reachability and actual exits. |

The static guard is a tripwire against accidental reintroduction, not an
adversarial barrier. Explicitly out of scope: eval/Function/vm, native addons,
and deliberately obfuscated code. A new reviewed raw-fs spelling still needs
an exact justified allowlist entry; no whole-file or stale-bundle exception.

### Known pre-existing limitation, follow-up for the installer owner

A directory-fsync EIO after link, or a timeout after link but before SQLite
initialization, can leave a published empty target. The next installer attempt
then reports store_invalid. This predates the hotfix: the former openSync('ax')
followed by a SQLite initialization failure left the same empty target.
Post-publication recovery is deliberately deferred and is not implemented here.

Suggested follow-up: persist a private recovery record before publication with
the installer operation ID, target path, staged/published dev+ino identity and
initialization phase. On retry, match the record and current regular-file
identity, verify that the exact target is still the empty uninitialized file
owned by that operation, and perform explicit installer-owned recovery. Never
unlink, overwrite or adopt an unrelated existing target based on pathname alone.
Record publication and initialization durably so a completed store cannot be
mistaken for an abandoned empty target.

### Round 2 verification

Actual process statuses (no pipeline-masked exits), Node 22.16.0 unless noted:

| Check | Result | Exit |
| --- | --- | --- |
| Original eight lock tests on detached 546d57ac, Node 22.16.0 | 2 pass / 6 fail | 1 |
| Same red proof, Node 24.22.1 | 2 pass / 6 fail | 1 |
| Scoped regressions, 53 explicit files | 660/660 pass; 577 top-level cases, no skips | 0 |
| Final input/helper/confinement/lock run, 7 explicit files | 92/92 pass | 0 |
| Final topic policy/reset-fault file | 13/13 pass | 0 |
| Final lock suite, Node 24.22.1 | 14/14 pass | 0 |
| Additional review-card entry/profile regressions, 2 explicit files | 9/9 pass | 0 |
| Source guard and three negative self-test groups | 4/4 pass; 250 exact allowlist references | 0 |
| Full guard including unchanged round-1 archive | 4 pass / 1 fail; five stale references in archive | 1 |
| Original 1e68d801 guard/allowlist, generated runtime/archive test only | 1/1 pass | 0 |

The red source is byte-identical to the eight-test 3b94921d source after trimming
separator whitespace (SHA256 a2d1a908afc723d2a42c184c5641ecb7fe19e829f4c708e5c46fb07e33912f7e).
Both red runs used a newly created detached worktree; creation/removal and
absence checks exited 0. No install or shared node_modules removal occurred.

The primary did regenerate the round-1 bundle in 1e68d801. Its archive and
engine manifest remain byte-identical to HEAD in this round. The round-2 full
guard correctly rejects that now-stale archive: the two former fs imports and
three host data-open sites in asset-files, method-package-files and review-card.
No stale archive exception was added. Regeneration is left to the primary per
this round's scope.

The 53-path scoped regression set was independently derived with Python glob
and rg --files; equality exit 0, count 53. The command used explicit paths:

```sh
node --test --test-concurrency=1 \
  adapters/mcp/test/asset-export.test.mjs \
  adapters/mcp/test/asset-files.test.mjs \
  adapters/mcp/test/assets.test.mjs \
  adapters/mcp/test/card-current.test.mjs \
  adapters/mcp/test/card-review-pty-framing.test.mjs \
  adapters/mcp/test/evidence.test.mjs \
  adapters/mcp/test/method-package-confinement.test.mjs \
  adapters/mcp/test/method-package-exclusions.test.mjs \
  adapters/mcp/test/method-package-files.test.mjs \
  adapters/mcp/test/method-package-linking.test.mjs \
  adapters/mcp/test/method-package-tools.test.mjs \
  adapters/mcp/test/private-cards.test.mjs \
  adapters/mcp/test/retained-raw-review.test.mjs \
  core/test/context-read-assembly-races.test.mjs \
  core/test/context-read-assembly-readonly.test.mjs \
  core/test/context-read-assembly.test.mjs \
  core/test/context-read-bm25.test.mjs \
  core/test/context-read-budget.test.mjs \
  core/test/context-read-core.test.mjs \
  core/test/context-read-embedder.test.mjs \
  core/test/context-read-fusion.test.mjs \
  core/test/context-read-local-embedder.test.mjs \
  core/test/context-read-local-status.test.mjs \
  core/test/context-read-moc-source.test.mjs \
  core/test/context-read-process.test.mjs \
  core/test/context-read-recovery.test.mjs \
  core/test/context-read-review.test.mjs \
  core/test/context-read-sidecar.test.mjs \
  core/test/context-read-source-work.test.mjs \
  core/test/context-read-sources-authority.test.mjs \
  core/test/context-read-sources-bounds.test.mjs \
  core/test/context-read-sources-races.test.mjs \
  core/test/context-read-sources.test.mjs \
  core/test/context-read-tokenize.test.mjs \
  core/test/isolated-file-read.test.mjs \
  core/test/sqlite-journal-probe.test.mjs \
  core/test/sqlite-lock-safety.test.mjs \
  core/test/topic-members-bounds.test.mjs \
  core/test/topic-members-compatibility.test.mjs \
  core/test/topic-members-integration.test.mjs \
  core/test/topic-members-mutations.test.mjs \
  core/test/topic-members-primary.test.mjs \
  core/test/topic-members-recheck-findings.test.mjs \
  core/test/topic-members-review-findings.test.mjs \
  core/test/topic-members-round3-findings.test.mjs \
  core/test/topic-members-scale.test.mjs \
  core/test/topic-members-visibility.test.mjs \
  core/test/topic-members.test.mjs \
  core/test/topic-overview-lifecycle.test.mjs \
  core/test/topic-overview-raw29.test.mjs \
  core/test/topic-overview-visibility.test.mjs \
  core/test/topic-overview.test.mjs \
  core/test/topic-reader-sqlite.test.mjs
```

Final input verification after preserving unpinned regular-file size semantics
and child close-error classes used:

```sh
node --test --test-concurrency=1 \
  core/test/isolated-file-read.test.mjs \
  core/test/sqlite-lock-safety.test.mjs \
  adapters/mcp/test/asset-files.test.mjs \
  adapters/mcp/test/assets.test.mjs \
  adapters/mcp/test/method-package-files.test.mjs \
  adapters/mcp/test/method-package-confinement.test.mjs \
  adapters/mcp/test/card-current.test.mjs
node --test --test-concurrency=1 adapters/mcp/test/retained-raw-profile.test.mjs adapters/mcp/test/context-read.test.mjs
node --test core/test/topic-reader-sqlite.test.mjs
node --test --test-name-pattern='runtime raw|guard rejects|round 2|allowed import' core/test/no-raw-db-fd.test.mjs
node --test core/test/no-raw-db-fd.test.mjs
# Node 24.22.1:
node --test --test-reporter=tap core/test/sqlite-lock-safety.test.mjs
```

The import/Worker/CLI/child-script closure has 233 required files, zero missing
from packaging/artifact-files.json; both changed shipped docs and both new
runtime files are registered. A separate Python traversal and
installedImportClosure produced equal sets, count 233, exit 0.

### Round 2 changed inventory

Union of git diff --name-only HEAD and git ls-files --others --exclude-standard
compared against independently parsed git status --porcelain=v1 -z: equality
exit 0, **21 files**. No paths under packages/setup/runtime changed. Syntax
checks on all 17 changed/new .mjs files, JSON parsing of both changed configs,
git diff --check and independent whitespace/newline checks: actual exits 0.

```text
adapters/mcp/asset-command.mjs
adapters/mcp/asset-files.mjs
adapters/mcp/method-package-files.mjs
adapters/mcp/review-card.mjs
adapters/mcp/test/asset-files.test.mjs
adapters/mcp/test/assets.test.mjs
adapters/mcp/test/card-current.test.mjs
adapters/mcp/test/fixtures/asset-files-race.mjs
adapters/mcp/test/fixtures/method-files-race.mjs
core/isolated-file-read-child.mjs
core/isolated-file-read.mjs
core/read-database.mjs
core/test/fixtures/no-raw-db-fd-allowlist.json
core/test/isolated-file-read.test.mjs
core/test/no-raw-db-fd.test.mjs
core/test/sqlite-lock-safety.test.mjs
core/test/topic-reader-sqlite.test.mjs
core/topic-reader-sqlite.mjs
docs/plans/topic-overview-member-pages.md
docs/plans/topic-reader-wal-fix.md
packaging/artifact-files.json
```

No commit, network, real-key access, broad npm suite, performance measurement
or recovery implementation. All task-owned processes are supervised through
completion; temporary worktrees/directories are removed before handoff.


## Fix round 3

Only native SQLite failures from preparing or executing PRAGMA journal_mode may
be deferred for legacy metadata validation. The query boundary marks those
failures explicitly and excludes timeout-installation errors with configure
provenance. Timeout installation and reset failures propagate to the opener,
which closes the connection. Fault injection covers SQLITE_NOMEM during
positive-timeout installation on both the WAL-hint and BUSY-fallback paths,
with diagnostics enabled and disabled; each case asserts the original error,
exactly one close, a closed connection and configure/reader_configuration
provenance. Existing reset-failure and legacy-precedence coverage is retained.

The creation child skips directory open/fsync on win32. On POSIX it retains
directory syncing, but EISDIR, EPERM, EINVAL and ENOTSUP from that directory
open/fsync after publication return success with the published dev/ino identity.
Other errors retain the existing failure behavior. Tests override process.platform
in the actual child body and make any Windows directory open fail; creation
still succeeds, preserves a live stage and reports the target identity. POSIX
faults cover all four codes at both directory open and fsync. Existing staged
file-fsync EIO, post-publication directory-fsync EIO, no-replace and timeout
coverage remains in place.

The remaining child operations were reviewed for Windows: the generated stage
suffix uses a positive decimal PID and UUID, signal 0 checks process existence,
and linkSync publishes a file within the same directory. The simulated win32
child exercises these operations and live-stage preservation. Native Windows
filesystem and process behavior was not executed on this Linux host; no further
incompatibility was identified by code review.

Actual process exit codes (Node versions verified before invocation):

| Check | Result | Exit |
| --- | --- | --- |
| Node 22.16.0: journal probe, lock safety and all core topic tests, 18 explicit paths | 256/256 pass, no skips | 0 |
| Node 22.16.0: full no-raw-db-fd guard, including generated runtime/archive | 5/5 pass | 0 |
| Node 24.22.1: sqlite-lock-safety | 14/14 pass | 0 |
| Node 22.16.0: syntax checks for all four changed modules/tests | pass | 0 |
| git diff --check and independent whitespace/newline checks | pass | 0 |

The 18 test paths were derived with Python globbing and independently with
rg --files; the sorted sets are equal, count 18, exit 0. Each path was passed
explicitly to node --test with test-concurrency=1. The five changed paths were
derived from git diff --name-only HEAD plus untracked files and independently
from git status --porcelain=v1 -z; equality exit 0, count 5:

```text
core/sqlite-journal-probe.mjs
core/test/sqlite-journal-probe.test.mjs
core/test/topic-reader-sqlite.test.mjs
core/topic-reader-sqlite.mjs
docs/plans/topic-reader-wal-fix.md
```

No runtime regeneration or commit. The generated runtime is unchanged from
HEAD (git diff --quiet exit 0). No network or key access; all test processes
were supervised through their actual completion.
