# E1-C2 WAL fresh-reader fix and smoke

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


## E1-C2 v1.1: deadline-bounded WAL wait (2026-10-27)

This round is based on 69900556 on fix/wal-reader-wait-v11 and remains
uncommitted for the primary. Earlier sections describe the historical 100ms
policy. Product supplied a Node24.22.1 full run of 200 trials: four of twenty
fresh-writer WAL trials failed zero-busy, with five busy member attempts out
of 4668 and five busy overview attempts out of 4813. Writer-close checkpoint
or WAL reset exceeded the fixed 100ms budget. The reported no-wait control had
21–25% busy; reader p95 peaked at 132ms and the maximum at 161ms. Those are the
product's supplied observations, not a measurement run in this round.

### Policy and reserve

At Worker request start t with the host's absolute monotonic deadline D:

~~~text
cutoff = min(D, t + 1000ms) - 20ms
native timeout before each operation = max(0, floor(cutoff - now))
~~~

This replaces the fixed 100ms limit. The single request-wide budget is the
remaining request deadline capped at 1000ms, minus a 20ms reserve (maximum
980ms native waiting). Startup already consumed part of D; SQL work and all
statements/fences consume the same budget. The cap never restarts per statement.

The 20ms reserve leaves four normal 5ms quanta of headroom for rollback,
constructing the small failure envelope, posting it and host delivery. It is
practical delivery headroom, not an extension of the deadline or a guarantee
against arbitrary scheduling delay. The existing watchdog remains the fallback.
Members use their deadlineMs-derived deadline; legacy and opt-in overview keep
the existing 5000ms watchdog deadline. No host-thread wait or new retry is added.
DELETE stays at zero wait. Native busy exhaustion keeps storage_busy under the
existing classification; cancellation keeps read_timeout. WAL header detection,
diagnostics, read-only behavior and the writer IPC fix remain unchanged.

The exact versioned contract delta is [E1-C2 additive contract v1.1](topic-overview-member-pages.md#e1-c2-additive-contract-v11-2026-10-27).
Public usage is updated in [topic-overview.md](../topic-overview.md#e1-c2-v11-deadline-bounded-wal-waiting).
Measurement metadata now identifies reader policy E1-C2-v1.1 and its ceiling
and reserve. The zero-wait control still patches only the ceiling constant to
zero. Protocol v2's pre-registered thresholds are byte-identical to the base;
all matrix windows, exposure requirements, failure gates and throughput's
reported-only role are unchanged. The two IPC delivery/judgment blocks are
also byte-identical to 69900556. No new runtime modules or shipped docs need
manifest entries.

### v1.1 verification

Only the two touched test files were run, by explicit path. They cover late
Worker startup, short/exhausted/fractional deadlines, the 1000ms cap, reserve
headroom at each native call, shared cached-statement/iterator budgets,
rollback after exhaustion, host forwarding of member and overview deadlines,
simulated locks over 100ms, busy exhaustion without retry, default byte parity,
DELETE, diagnostics, header detection, native iterator fidelity and unchanged
measurement thresholds/control copying.

~~~sh
node --test core/test/topic-reader-sqlite.test.mjs tools/testing/measure-topic-reader-wal.test.mjs
# first run exit 0: 18/18; final run exit 0: 19/19
node --version
# exit 0: v22.16.0
~~~

No smoke or full measurement ran in this round. No broad suite, network,
provider/model call, key read or commit was performed. No background work is
left running. Full performance acceptance requires the primary's queued rerun;
the deterministic simulations establish the new bounds, not a zero-busy
performance claim under production contention.


### v1.1 delivery inventory and checks

Changed files were derived from git diff --name-only HEAD plus git ls-files
--others --exclude-standard, then independently from git status --porcelain=v1
-z. Exact set equality: **7 files**, exit 0. Whitespace includes untracked paths;
no trailing whitespace, missing final newline or machine-local path literals
in the changed files (exit 0).

~~~text
core/test/topic-reader-sqlite.test.mjs
core/topic-reader-sqlite.mjs
docs/plans/topic-overview-member-pages.md
docs/plans/topic-reader-wal-fix.md
docs/topic-overview.md
tools/testing/measure-topic-reader-wal.mjs
tools/testing/measure-topic-reader-wal.test.mjs
~~~

Exact syntax checks (each exit 0):

~~~sh
node --check core/test/topic-reader-sqlite.test.mjs
node --check core/topic-reader-sqlite.mjs
node --check tools/testing/measure-topic-reader-wal.mjs
node --check tools/testing/measure-topic-reader-wal.test.mjs
~~~


Additional checks: git diff --check exited 0. The inline source comparison of
measurement thresholds and both IPC blocks against 69900556 exited 0, with
byte-identical results. The reader/Worker import closure check exited 0:
52 required files, zero manifest misses; all three affected shipped docs are
already registered. Final inventory and whitespace/path checks were repeated
after this report update; no new entries are needed in the artifact manifest.
