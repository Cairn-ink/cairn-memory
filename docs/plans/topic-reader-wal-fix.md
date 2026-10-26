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
