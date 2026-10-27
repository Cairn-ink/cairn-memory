# `topic-member-previews-v1` implementation handoff

Uncommitted implementation on `feat/topic-member-previews-impl`, based on
`7212228e`. The frozen P1 and E1-M specifications and existing assertions are
unchanged. No product enablement or full performance acceptance is claimed.

## Design

P1 has a separate Worker reader, strict own-data request validation, the exact
versioned eleven-row grapheme canary table, and an internal Node/V8/ICU/Unicode
fingerprint bound into its authenticated `tp1` cursor configuration. The
`tm1` family and overview origin domain remain unchanged. One acknowledged
member traversal spans both modes; overview has separate state.

Three charged initialization steps validate the consumed TEXT declaration,
direct `octet_length` support and indexed source point path. Metadata enumeration
and lookahead use the existing member storage. Source extraction follows a
same-transaction epoch/generation/target fence, reusing the unchanged membership
and canonical-attribution checkpoint and rechecking exact ID, namespace,
revision, kind and visibility in the guarded point query. Text transformation
runs after commit; another fence precedes delivery. There is no migration,
writer slot or new native wait policy.

The source/type/size guard uses lazy CASE and direct-column byte metadata.
Approved values are materialized whole, cast to BLOB and decoded strictly;
this is a bounded payload contract, not a physical disk-I/O or RSS bound.
Whitespace normalization, whole-grapheme prefix selection, independent
1,024-byte cap and repeated whole-grapheme trailing-space removal follow the
frozen algorithm, including `trimmed_prefix_empty`. Rejected 12,000-ASCII-byte
sources account for 12,000 decoded units, zero normalization/segmentation and a
36,000-byte source-plus-decoded temporary payload.

Each source/validation/construction operation reserves three units together,
with final fence/envelope work reserved. Capability refusal charges one outcome
unit without extraction. Pending and EOF-only-fitting refs retain metadata.
Replay recipes retain refs, revisions, nontext outcomes and envelope/cursor
fields, with sufficient regeneration work reserved; they retain no text or text
digest. Busy preserves acknowledged state; stale/timeout discards unsafe state.
The numeric-only `cairn.topic-member-previews.metrics` diagnostics channel reports
work, bytes, decoded/normalization/segmentation units, failures and payload peaks.

P1 transfers the complete bounded UTF-8 JSON envelope as an ArrayBuffer and
parses it at the host, inside the request deadline. This makes actual transfer
payload bytes directly observable, separately from V8 serialization estimates
and unexposed native framing. Default member/overview transport and DTO property
order stay unchanged. All three new runtime modules and shipped docs/report are
registered in the artifact manifest; CLI/local static imports remain SQLite-free.

## Guard proof on the installed nvm runtimes

`tools/testing/prove-topic-member-previews-guard.mjs` inspects EXPLAIN for the
actual guarded query against an owned in-memory indexed TEXT table, checks its
point plan, executes oversized/approved rows, and runs every exact raw canary.
All three binaries produced the same relevant bytecode:

- content `Column` operands at 26/30 have TYPEOFARG `128`;
- operands at 28/33 have TYPEOFARG|LENGTHARG `192`, immediately followed by
  direct `octet_length(1)`, allowing encoded-length metadata without loading text;
- opcode 35 compares against register 18, initialized to 12,000, and jumps to
  `Null` at 40 for an oversized value;
- the only ordinary content load is opcode 36 (`p5=0`), followed by BLOB
  `Cast` at 37 (`p2=65`) and `substr(3)` at 38. The oversized branch skips all
  three. The plan is `SEARCH memories USING INDEX sqlite_autoindex_memories_1 (id=?)`.

A 12,001-byte row returns a null source; 4,000 BMP CJK units return exactly
12,000 source bytes. Runtime source tests also exercise the real store table.
This proves the guarded extraction branch, not total native I/O or allocation.

| Node | Bundled SQLite | ICU | Guard/canaries exit |
| --- | --- | --- | --- |
| 22.16.0 | 3.49.1 | 77.1 | 0 |
| 24.15.0 | 3.51.3 | 78.2 | 0 |
| 24.22.1 | 3.53.4 | 78.3 | 0 |

```sh
node@v22.16.0 tools/testing/prove-topic-member-previews-guard.mjs
node@v24.15.0 tools/testing/prove-topic-member-previews-guard.mjs
node@v24.22.1 tools/testing/prove-topic-member-previews-guard.mjs
```

Each command above exited 0. The guard/canary checks on the two Node 24 versions
are not a substitute for primary's full functional/runtime acceptance.

## Functional verification and actual exits

All tests ran on Node 22.16.0, by explicit path. No broad suites or timing gates
ran. The complete focused command was:

```sh
node@v22.16.0 tools/testing/run.mjs --test-concurrency=1 core/test/topic-member-previews.test.mjs core/test/topic-member-previews-text.test.mjs core/test/topic-member-previews-bounds.test.mjs core/test/topic-member-previews-mutations.test.mjs core/test/topic-member-previews-visibility.test.mjs core/test/topic-member-previews-compatibility.test.mjs core/test/topic-member-previews-scale.test.mjs core/test/topic-member-previews-installed.test.mjs core/test/topic-member-previews-measurement.test.mjs core/test/topic-members.test.mjs core/test/topic-members-bounds.test.mjs core/test/topic-members-compatibility.test.mjs core/test/topic-members-integration.test.mjs core/test/topic-members-mutations.test.mjs core/test/topic-members-primary.test.mjs core/test/topic-members-recheck-findings.test.mjs core/test/topic-members-review-findings.test.mjs core/test/topic-members-round3-findings.test.mjs core/test/topic-members-scale.test.mjs core/test/topic-members-visibility.test.mjs core/test/topic-overview.test.mjs core/test/topic-overview-lifecycle.test.mjs core/test/topic-overview-raw29.test.mjs core/test/topic-overview-visibility.test.mjs
```

Exit **1**, 296/298 passed. Two identified failures were corrected: the new
SQL-function refusal fixture registered the wrong function arity; the existing
progress observer requires the exact `let traversal;` declaration, now restored.
The affected final command was:

```sh
node@v22.16.0 tools/testing/run.mjs --test-concurrency=1 core/test/topic-members.test.mjs core/test/topic-member-previews.test.mjs core/test/topic-member-previews-bounds.test.mjs core/test/topic-member-previews-measurement.test.mjs
```

Exit **0**, **29/29** passed, including the added EOF-only-fitting/work16 case.
Mechanically reconciling final TAP outcomes by exact test name gives **299
unique cases, 299 passing, zero unresolved**. Legacy differential assertions
against `b2513501` passed **184** page/budget comparisons and **154** fault
comparisons, with **zero differences**; those assertions were not edited.
Both P1 product worlds completed, independently reconciling 1,112/3,336 Memories,
four namespaces and 71 MOCs (60 L1, 11 L2), with zero inventory differences.

Offline installed verification command:

```sh
node@v22.16.0 tools/testing/run.mjs core/test/topic-member-previews-installed.test.mjs
```

The final installed/observer recheck also ran:

```sh
node@v22.16.0 tools/testing/run.mjs --test-concurrency=1 core/test/topic-member-previews-installed.test.mjs core/test/topic-member-previews-measurement.test.mjs
```

Exit **0**, **4/4** passed. Its owned cache uses offline `npm pack`, then actual archive
extraction and installed core/Worker imports on physical 18/33, DELETE/WAL.
Archive and recursive extracted inventories both contain **298 files**, diff
empty; **152 reachable core/Worker modules** match manifest coverage and source
bytes. npm/tar/tar child exit codes are all 0, signals null. An initial npm-path
fixture error exited 1 before correction. Earlier development checks also
caught invalid raw fixtures (STRICT BLOB insertion and insufficient oversize);
corrected focused runs exited 0. One mixed-version development run was stopped
with exit 130 after editing delivery while it was running; its partial outcomes
are excluded from the final reconciliation. No requested tests/fixtures owned
by another session were edited.

## One smoke; full acceptance remains queued work

```sh
node@v24.22.1 tools/testing/run.mjs --script tools/testing/measure-topic-member-previews.mjs --smoke --report docs/plans/topic-member-previews-smoke.json
```

Exit **0**, exactly one smoke. The saved report retains **38 raw attempts**
across six tiny cells (112 Memories, four namespaces, 71 MOCs; page24/L2;
DELETE/WAL; idle/same-owner/other-owner), exactly three warmups and separate
fresh-process cold samples. All reader/writer child exits were 0, signals null.
Concurrent DELETE produced 18 reader busy outcomes; WAL had zero busy and one
same-owner stale outcome. Observed host loop maximum was 2.667109ms. Every
retained smoke traversal reached exact EOF. These are observations only.

The saved smoke predates the final UTF-8 transfer accounting and summary
refinements; the final observation path is covered by the functional measurement
test, which checks exact transport payload/envelope equality and numeric work.
No second smoke or full measurement was run. The full harness preregisters all
144 cells, successful-page sampling/ceilings, separate cold populations,
per-request fresh capture/review writers, actual write-call overlap, unchanged
common caps, host heartbeat through cleanup, and all decision-table gates.
It records invalid overlaps and typed failures without discarding their latency.

Primary must supply unchanged production deadline provenance and run the full
final harness under the machine-wide queue, for example:

```sh
node@v24.22.1 tools/testing/run.mjs --script tools/testing/measure-topic-member-previews.mjs --writer-profile /OWNED/PATH/deadlines.json --report /OWNED/PATH/previews-full.json
```

The profile contains only `{captureMs,reviewMs,provenance}`. Missing production
results/deadlines/sample/overlap evidence is inconclusive. No latency threshold
was relaxed; page100/retained/cold3336 remain report-only for latency. Primary
also owns the remaining Node 24 functional and CI-equivalent acceptance matrix.
No background agent monitoring is promised or left running by this handoff.

## Changed files: two independent inventories

`git diff --name-only HEAD` plus `git ls-files --others --exclude-standard`
was compared with `git status --porcelain --untracked-files=all`. Both give
**27 delivery files**, diff empty. Temporary working logs are excluded and
removed. `git diff --check` and an independent trailing-whitespace/EOF scan
include every tracked and untracked delivery file; both exit 0.

```text
core/memory-reader.mjs
core/test/topic-member-previews-bounds.test.mjs
core/test/topic-member-previews-compatibility.test.mjs
core/test/topic-member-previews-installed.test.mjs
core/test/topic-member-previews-measurement.test.mjs
core/test/topic-member-previews-mutations.test.mjs
core/test/topic-member-previews-scale.test.mjs
core/test/topic-member-previews-text.test.mjs
core/test/topic-member-previews-visibility.test.mjs
core/test/topic-member-previews.test.mjs
core/testing/topic-member-previews-fixture.mjs
core/topic-member-previews-reader.mjs
core/topic-member-previews-storage.mjs
core/topic-member-previews-text.mjs
core/topic-members-input.mjs
core/topic-members-reader.mjs
core/topic-members-session.mjs
core/topic-overview-worker.mjs
core/topic-snapshot.mjs
docs/plans/topic-member-previews-impl.md
docs/plans/topic-member-previews-smoke.json
docs/topic-overview.md
package.json
packaging/artifact-files.json
tools/testing/fixtures/topic-member-previews-metrics.mjs
tools/testing/measure-topic-member-previews.mjs
tools/testing/prove-topic-member-previews-guard.mjs
```

## Fix round 1 (after `45096021`)

The runtime, text algorithm, source transactions, charging and paging are
unchanged. Both reviews' duplicated privacy finding and every other finding
are resolved in the measurement tool or its two focused tests:

| Finding | Resolution and evidence |
| --- | --- |
| Preview text in replay assertion/report/exception (both reviews) | `tools/testing/measure-topic-member-previews.mjs:96` asserts boolean equality with a fixed message, then emits `replay_mismatch` with numeric counts/byte lengths only. The allowlist at `:72`, report boundary at `:463` and public entry at `:473` discard original messages, stacks, causes and assertion operands. Child stderr is not forwarded. Tests at `core/test/topic-member-previews-measurement.test.mjs:98` and `:163` exercise both sentinel mismatches and real CLI parse failures. |
| Installed mutation test passed without mutation | `core/test/topic-member-previews-installed.test.mjs:59` creates a live paginated root continuation and verifies exact replay, including after DELETE busy. At `:73` only the namespace epoch changes; the identical request must then be stale. This runs on physical 18/33 in DELETE/WAL through the actual installed Worker. |
| Fast missed-overlap requests lowered gated p95 | `tools/testing/measure-topic-member-previews.mjs:253` constructs a separate successful-overlapping population for concurrent gates. All attempts and all successful pages retain informational distributions. The main/cold regression adds 400 fast missed overlaps to 50 overlapping pages and still fails the slow gated p95. |
| Required content not extracted by timed selections | `tools/testing/measure-topic-member-previews.mjs:317` places two copies of the four cases among the smallest eight IDs in the measured namespace: four filed under the selected L1/containing L2, four unfiled. The fixed world shape is preserved. `tools/testing/fixtures/topic-member-previews-metrics.mjs:8` counts actual guarded point-read extraction and bytes per numeric case index, without retaining content. Missing coverage is inconclusive; inconsistent counters fail. The test at `core/test/topic-member-previews-measurement.test.mjs:144` verifies all six selection/page-size combinations, including actual 12,000-byte maximum-source extraction and at least 7,000 normalization input units. |
| Unexpected idle/other-owner staleness accepted | `tools/testing/measure-topic-member-previews.mjs:287` permits staleness only with same-owner load and an actually overlapping committed public write. Idle, other-owner, noncommitting and missed-overlap stale regressions fail acceptance. |
| Zero successful pages classified as failure | Absent gated percentiles are null at `tools/testing/measure-topic-member-previews.mjs:303`; only explicit false checks constitute observed violations. A 500-busy/zero-page DELETE series is inconclusive. Loop, byte, WAL-busy, writer and unexpected-error violations retain failure precedence. |
| Product profile has no review deadline | `tools/testing/measure-topic-member-previews.mjs:102` accepts the supplied file unchanged: capture 25,000 ms, review null, original provenance. At `:279` null review makes its deadline gate inconclusive. The 5,000 ms review comparison is informational, explicitly **not a deadline**, and never becomes an overrun. The deterministic null-review test is at `core/test/topic-member-previews-measurement.test.mjs:114`. |

Commands below use `node@vX.Y.Z` to identify the actual nvm binary. The profile
variable denotes the exact product-supplied JSON; report variables denote owned
output locations. No full measurement, broad suite, network call or commit ran.

| Command | Actual exit / result |
| --- | --- |
| `node@v22.16.0 --check tools/testing/measure-topic-member-previews.mjs` | 0 |
| `node@v22.16.0 tools/testing/run.mjs --test-concurrency=1 core/test/topic-member-previews-measurement.test.mjs core/test/topic-member-previews-installed.test.mjs` | Final run 0, **12/12**. Initial run 1 exposed an eight-item fixture placement exceeding the existing batch limit; fixed with two four-item batches. |
| `node@v22.16.0 tools/testing/run.mjs core/test/topic-member-previews-measurement.test.mjs` | Intermediate corrected run 0, **10/10**, before adding the final CLI sanitation test. |
| `node@v22.16.0 tools/testing/measure-topic-member-previews.mjs --plan --writer-profile "$P1_WRITER_PROFILE" --report "$P1_PLAN_REPORT"` | 0; exact profile equality verified, 144 planned cells, zero measured cells. |
| `node@v24.22.1 tools/testing/run.mjs --script tools/testing/measure-topic-member-previews.mjs --smoke --writer-profile "$P1_WRITER_PROFILE" --report "$P1_SMOKE_REPORT"` | 0; **one** tiny smoke, six cells, **38 raw attempts**. |
| `node@v22.16.0 tools/testing/run.mjs core/test/topic-member-previews-installed.test.mjs` | Final archive recheck 0, **1/1**, after the updated docs and numeric smoke report. |
| `git diff --check` plus independent all-delivery-file whitespace/newline/path scan | 0 |

The updated `topic-member-previews-smoke.json` preserves this round's raw numeric
records. Every successful main/cold page observed all four cases, including
12,000 source bytes for the maximum case. The busy-only DELETE series remain
inconclusive. WAL reported zero busy; the single same-owner stale outcome had
actual committed-write overlap. All retained traversals passed; all cold and
writer child exits were 0, signals null. Review-deadline checks are inconclusive
throughout concurrent cells. These tiny populations do not establish launch
acceptance. Full measurements remain the primary's queued work.

Installed archive and recursive extracted inventories both contained **298
files**, difference empty; the installed core/Worker module closure contained
**152 modules**, all covered by the manifest. npm/tar/tar child exits were all 0.
No runtime module or manifest entry was added in this round.

This round's inventories were derived from `git diff --name-only HEAD` plus
untracked-file enumeration, independently from recursive filesystem Git-blob
hashes compared with HEAD, and cross-checked again with porcelain status.
All three contain **7 files**, difference empty; working logs are excluded and
removed. Every changed file passes the independent whitespace/newline and
absolute-developer-path scans.

```text
core/test/topic-member-previews-installed.test.mjs
core/test/topic-member-previews-measurement.test.mjs
docs/plans/topic-member-previews-impl.md
docs/plans/topic-member-previews-smoke.json
docs/topic-overview.md
tools/testing/fixtures/topic-member-previews-metrics.mjs
tools/testing/measure-topic-member-previews.mjs
```


## Launch measurement r3 diagnosis

r3 at `4a434564` used Node 24.22.1: 144 cells, 432 warmup,
37,282 main and 7,599 cold attempts. Its 576 decisions (including retained)
were 259 pass / 246 inconclusive / 71 fail. This diagnosis parses the raw JSON
with Node and runs both supplied summary scripts; it does not load the report
into a terminal. No full measurement, setup regeneration, network access or
commit was performed. The preregistered header, thresholds, populations and
`topic-member-previews-v1` contract remain unchanged. Measurements below are
observations from r3, not acceptance claims for this patch.

### A. Stale seed metadata, correctly rejected by the reader

The defect is in the measurement world's metadata ledger, not preview extraction
or the physical-18 read path. `memberFixture.place()` assumed the public mutation's
`refs` enumerated every affected MOC. In fact those refs describe the resulting
placements. Removed parents and MOCs whose title-source memory changes filing
revision can be bumped without appearing in `refs`. The edge-case seeding moves
four low-ID memories into the chosen L1 and unfiles another four; unfiling can
therefore leave the selected L1's cached revision behind its stored revision.
`createTopicMembersStorage.target()` correctly raises `revision_conflict`.

Evidence: the 3336/18/L1 slice accounts for all 4,871 recorded
`revision_conflict` refusals (main/cold/warmup), plus 12 retained refusals. Both
idle DELETE L1 main series have 500/500 conflicts; their cold series have
100/100 and warmups 3/3. WAL idle main has 495 and 499 conflicts, with the
remaining attempts timing out. Busy and timeout refusals mask the bad selection
in concurrent DELETE records. This explains the all-load/all-limit pattern
without a writer race. The four count/schema seeds are built independently
with random IDs, then reused across their cells: the r3 slice is deterministic
for that seed, not a guarantee that a new `seed(3336,18)` has the same fault.
A fresh unmodified 3336/18 repro here happened to have cached/stored revision
111/111 and returned 24 refs; absence on that fresh random world is not a fix.

A two-memory deterministic regression unfiles an L1/root title source while leaving
another member reachable, then reads using the fixture-derived selection.
Before the fix its root ledger revision was 1 versus stored 2 (test exit **1**).
After the fix the same regression exits **0**, including public preview reads
on both physical schemas 18 and 33 and intentional stale-ref refusals.
The fixture now refreshes its MOC revision ledger through its SQLite connection
after placement, covering removed parents and title-source changes. The world
builder also consumes the revision returned by `linkMocs`; the old comment
incorrectly claimed that link did not increment endpoints (it increments the
parent). No engine validation was weakened and no raw SQLite file descriptor
was introduced.

### B. Loop gaps: what r3 proves and what it cannot attribute

The 21 main/warmup series with loop violations contain **33 affected records
and 58 gaps**. There are another **19 gaps in five retained series**.
There is also a harness gate omission: **30 launcher gaps across 15 cold
records in eight cells** were recorded in `launcherLoop` but ignored by
`summarize()`/`decide()`. The corrected gate takes the maximum and sums counts
across both host processes. It still tests the same absolute 100 ms ceiling;
there is no baseline subtraction or exclusion of engine-caused gaps.

The table inventories every affected main/warmup record (zero-based cell and
attempt indexes into the raw report). Times are local UTC+8 on the run date;
all durations are ms, rounded to one decimal. `read`, `close` and `wait` are
respectively `readFinishedAt-readStartedAt`, `finishedAt-readFinishedAt` and
`max(writes.finishedAt,finishedAt)-finishedAt`. The latter excludes unrecorded
IPC delivery/drain time. `n` counts gaps, not independently timestamped events.
Sampler columns use the immediately preceding/following samples around that
recorded interval; a long sampler interval is corroboration of disruption,
not proof that a particular host gap has the same cause.

| Cell / series / attempt | Shape: count/schema/journal/selection/limit/load | Start | max / n | read / close / writer wait | Sampler load range / longest interval s |
| --- | --- | --- | --- | --- | --- |
| 13/main/295 | 1112/18/DELETE/unfiled/24/same-owner | 15:35:49.266 | 867.8 / 4 | 999.1 / 2322.9 / 212.8 | 2.00–3.20 / 5 |
| 22/main/57 | 1112/18/WAL/L1/100/same-owner | 15:42:41.379 | 430.8 / 1 | 887.3 / 0.9 / 0 | 2.44–2.56 / 5 |
| 23/main/33 | 1112/18/WAL/L1/100/other-owner | 15:44:16.597 | 485.5 / 1 | 62 / 1.1 / 7482 | 2.11–2.26 / 5 |
| 47/main/270 | 1112/33/DELETE/L2/100/other-owner | 16:11:38.891 | 203.2 / 1 | 203.6 / 1 / 1025.4 | 1.92–2.00 / 5 |
| 64/main/470 | 1112/33/WAL/L2/100/same-owner | 16:29:18.130 | 196.2 / 1 | 70.1 / 1.2 / 2921.5 | 2.40–2.74 / 5 |
| 86/main/329 | 3336/18/DELETE/unfiled/24/other-owner | 17:09:17.659 | 187.3 / 4 | 33.4 / 1.7 / 3197 | 1.96–2.04 / 7 |
| 88/main/459 | 3336/18/DELETE/unfiled/100/same-owner | 17:14:16.914 | 198.1 / 4 | 33.7 / 1.7 / 4273.9 | 1.94–2.11 / 5 |
| 90/main/425 | 3336/18/WAL/L1/24/idle | 17:20:48.990 | 481.7 / 1 | 1054.4 / 1.2 / 0 | 2.07–2.17 / 6 |
| 90/main/426 | 3336/18/WAL/L1/24/idle | 17:20:50.786 | 1283.7 / 1 | 1283.7 / 0.9 / 0 | 2.07–2.08 / 5 |
| 90/main/428 | 3336/18/WAL/L1/24/idle | 17:20:53.422 | 777.5 / 1 | 934.7 / 8.9 / 0 | 2.07–2.08 / 5 |
| 90/main/430 | 3336/18/WAL/L1/24/idle | 17:20:55.501 | 941.6 / 1 | 998.8 / 11.6 / 0 | 2.07–2.07 / 5 |
| 93/main/309 | 3336/18/WAL/L1/100/idle | 17:30:25.199 | 1103.7 / 1 | 1096.6 / 69 / 0 | 1.43–4.83 / 9 |
| 93/main/310 | 3336/18/WAL/L1/100/idle | 17:30:26.610 | 165.4 / 1 | 445.9 / 2 / 0 | 4.60–4.83 / 5 |
| 93/main/315 | 3336/18/WAL/L1/100/idle | 17:30:28.199 | 106.5 / 1 | 106.3 / 1.4 / 0 | 4.60–4.83 / 5 |
| 94/main/94 | 3336/18/WAL/L1/100/same-owner | 17:32:17.056 | 279.9 / 2 | 35.8 / 3.7 / 2164.5 | 2.33–2.36 / 5 |
| 94/main/95 | 3336/18/WAL/L1/100/same-owner | 17:32:20.881 | 1337.3 / 1 | 999.3 / 18.9 / 52.1 | 2.33–2.39 / 5 |
| 95/main/29 | 3336/18/WAL/L1/100/other-owner | 17:35:16.963 | 387.6 / 4 | 262.4 / 81.6 / 2435.8 | 2.08–2.09 / 5 |
| 95/main/387 | 3336/18/WAL/L1/100/other-owner | 17:37:47.210 | 1389.1 / 1 | 171.9 / 1.8 / 2636.9 | 2.05–2.51 / 5 |
| 106/main/44 | 3336/18/WAL/unfiled/100/same-owner | 17:49:15.715 | 7751.4 / 2 | 189.8 / 1.1 / 15139.9 | 2.16–5.90 / 10 |
| 106/main/45 | 3336/18/WAL/unfiled/100/same-owner | 17:49:32.538 | 202.7 / 2 | 301.8 / 1.1 / 9021.1 | 3.71–5.90 / 10 |
| 106/main/46 | 3336/18/WAL/unfiled/100/same-owner | 17:49:47.601 | 1003.6 / 1 | 998.7 / 15769.9 / 1916 | 5.10–8.94 / 11 |
| 106/main/47 | 3336/18/WAL/unfiled/100/same-owner | 17:50:07.590 | 6046.6 / 2 | 6044.4 / 2556.5 / 19.1 | 8.94–10.31 / 6 |
| 106/main/48 | 3336/18/WAL/unfiled/100/same-owner | 17:50:16.523 | 1606.6 / 4 | 2411.7 / 3700.6 / 174.9 | 9.88–10.31 / 6 |
| 112/main/385 | 3336/33/DELETE/L1/100/same-owner | 18:11:19.266 | 106.2 / 1 | 193.2 / 1.6 / 187.6 | 4.31–4.42 / 5 |
| 115/main/432 | 3336/33/DELETE/L2/24/same-owner | 18:20:59.874 | 258.3 / 1 | 435.2 / 1.7 / 27435.5 | 4.20–8.27 / 9 |
| 118/main/470 | 3336/33/DELETE/L2/100/same-owner | 18:32:35.489 | 134.4 / 1 | 291.7 / 1.8 / 194.7 | 3.08–3.40 / 6 |
| 121/main/31 | 3336/33/DELETE/unfiled/24/same-owner | 18:39:18.346 | 357.7 / 4 | 287 / 2 / 3653.5 | 3.32–3.37 / 6 |
| 121/main/174 | 3336/33/DELETE/unfiled/24/same-owner | 18:40:50.546 | 921 / 1 | 999.7 / 30.5 / 192 | 3.75–3.81 / 6 |
| 122/main/273 | 3336/33/DELETE/unfiled/24/other-owner | 18:46:17.584 | 505.2 / 4 | 34.6 / 1.6 / 4304.3 | 2.15–2.25 / 5 |
| 124/main/142 | 3336/33/DELETE/unfiled/100/same-owner | 18:50:35.897 | 117.3 / 1 | 50.2 / 5.5 / 2895.8 | 4.51–4.67 / 5 |
| 130/main/72 | 3336/33/WAL/L1/100/same-owner | 19:01:34.998 | 474.5 / 1 | 1472.2 / 4 / 1566.5 | 3.58–4.02 / 6 |
| 142/main/34 | 3336/33/WAL/unfiled/100/same-owner | 19:11:34.471 | 1232.3 / 1 | 2229.8 / 4 / 507.7 | 2.58–2.69 / 5 |
| 143/warmups/0 | 3336/33/WAL/unfiled/100/other-owner | 19:12:15.512 | 184.8 / 1 | 277.3 / 7.5 / 78.4 | 3.60–3.63 / 5 |

**Phase attribution bounds:** in 12 of these 33 records the largest gap exceeds
the entire read-plus-close duration, so it cannot be contained in page reading,
decoding or close. For example cell 23/main/33 reads/closes in 63.1 ms but has
a 485.5 ms gap while waiting 7,482 ms for its writer; cell 64/main/470 reads/closes
in 71.3 ms but has a 196.2 ms gap and a 2,921.5 ms writer wait. Cell
106/main/44 finishes its read in 189.8 ms and closes in 1.1 ms; its 7,751.4 ms
maximum belongs outside that completed lifecycle, within the observation that
continues through a 15,139.9 ms writer wait/IPC drain. It is not a seven-second
preview conversion. The succeeding records show multi-second read/close delays
as well; their individual gaps cannot be assigned to one phase from aggregates.

**Machine evidence:** the 2,702 load samples include 17 intervals longer than
six seconds (maximum 11 s), not a uniformly quiet sampler. Around cell 106's
worst records the sampler skips 17:49:25 -> 17:49:35 and 17:49:50 -> 17:50:01;
the one-minute load rises from 2.16 at 17:49:15 to 10.31 at 17:50:12.
A separate process's skipped samples support a machine disruption, but do not
prove a specific scheduler, disk or GC cause. Cell 93/main/309 also coincides
with the 17:30:17 -> 17:30:26 sampler gap and load rising 1.43 -> 4.83.
For the L1 failure cluster at 17:20:48–56, the sampler continues at 5–6 s with
load about 2.07–2.17; there is no corresponding multi-second sampler outage.
For cells 94 and 95 it likewise remains near 2.1–2.5. Those gaps remain
unattributed; low aggregate load does not establish host-thread health.
The low loads and regular samples in many smaller cases are recorded alongside
their bounds above, not treated as proof of an engine cause.

Retained inventory below includes conservative wall-clock bounds between the
last cold record's `finishedAt` and the next cell's first warmup `startedAt`.
Those bounds also include cold writer completion/child exit, setup and report
work. r3 did not timestamp retained pages, replay or validation.

| Cell / shape | Window UTC+8 | maximum / gaps | total traversal / slowest timed read |
| --- | --- | --- | --- |
| 100 / 3336/18/WAL/L2/100/same-owner | 17:44:31.619–17:44:33.560 | 113.9 / 1 | 544.7 / 97.3 |
| 106 / 3336/18/WAL/unfiled/100/same-owner | 17:53:43.784–17:53:49.785 | 768.2 / 7 | 3713.1 / 182.8 |
| 115 / 3336/33/DELETE/L2/24/same-owner | 18:23:29.939–18:23:33.941 | 141.0 / 7 | 1386.8 / 68.5 |
| 116 / 3336/33/DELETE/L2/24/other-owner | 18:28:20.441–18:28:23.201 | 112.1 / 2 | 813.1 / 63.0 |
| 119 / 3336/33/DELETE/L2/100/other-owner | 18:38:41.410–18:38:43.901 | 149.4 / 2 | 910.3 / 155.0 |

The retained maxima in the first four rows exceed every timed page read, so
validation, replay, observation drain or a gap crossing phase boundaries must
also be considered. The sampler has no >6 s gap in these retained windows;
nearby one-minute load is roughly 2.6, 3.5, 6.8, 3.3 and 3.5 respectively. It cannot resolve
100–768 ms pauses. Cold launcher inventory (cell/attempt: maximum, gap count):
47/64:179.8,1; 49/65:302.4,1; 75/23:5348.6,1; 79/14:789.2,1;
86/0:139.4,1; 86/5:2278.5,7; 86/6:6097.6,1; 86/7:1273.8,2;
86/8:296.1,5; 86/9:1451.4,5; 86/32:105.7,1; 86/33:1697.2,1;
92/25:1342.0,1; 95/48:854.1,1; 119/63:138.0,1. All of those cold child
`hostLoop` maxima are below 4 ms. These gaps belong to the measuring launcher,
not the child's page decoding; the old report has no launcher event timestamps.

**Harness defect and fix:** the old `save()` synchronously stringified and
rewrote the entire growing report after every attempt, while retaining all
45,313 raw attempts and writer histories. Direct save time is outside the
attempt heartbeat, so it cannot honestly be assigned as any particular r3 gap;
its allocation/GC and disk pressure are credible confounders. The tool now
appends each attempt once to a numeric `.records.jsonl` journal, asynchronously
streams completed cells into `.partial`, releases their raw records and atomically
renames the completed JSON. Only the current cell and compact decisions remain
in memory. The final JSON retains its existing fields, so the supplied parsers
still work. While running, the registered report is static; the journal and
partial stream carry progress. The journal is intentionally retained after
completion and may be removed with the report. An interrupted partial JSON is
not an acceptance result. Journal data is sanitized numeric metadata, never
preview text or IDs from pages. Reusing one host Segmenter and counting segments
without allocating arrays also removes avoidable validation allocations.

The heartbeat still starts before public handle construction and drains after
awaited close and writer IPC; retained validation/replay remains observed.
Instrumentation now records every >100 ms gap's start/end and phase boundaries,
retained timestamps, host Worker-message handling spans, and bounded per-request
SQLite call totals/longest-call diagnostics (fixed stage/category plus numbers,
no SQL/parameters). No failed or slow engine attempt is discarded. Tests use an
injected clock to verify exact absolute gaps and cold-launcher failure precedence;
a sink roundtrip verifies raw journal records and final report schema. The
public instrumentation test checks message spans and SQLite metrics.

**Attribution limit:** r3 has only `hostLoop.maxMs` and `blocksOver100`, not
per-gap timestamps, CPU profiles, GC events or native wait durations. It is
impossible to attribute each of its individual 107 recorded gaps (58 + 19 + 30)
to a specific function or machine event retrospectively. The inventory above
accounts for every affected record and states the phase bounds the data allows.
No engine host-thread defect was demonstrated: preview decoding is bounded by
the 65,536-byte envelope, and several large L1 gaps happen on text-free
`revision_conflict`/timeout responses. That does not prove the engine free of
pauses. The added diagnostics are needed on the primary's next quiet run to
resolve the remaining cases; no launch pass is inferred here.

### C. WAL same-owner latency and the gated population

| 1112 main cell | Successful overlapping pages / attempts | stale refusals | p95 / max ms |
| --- | --- | --- | --- |
| s18 L1/24 (19) | 21/500 | 479 | 404.4 / 425.7 |
| s18 unfiled/24 (31) | 20/500 | 480 | 289.5 / 361.3 |
| s33 unfiled/24 (67) | 50/51 | 1 | 504.2 / 586.8 |
| s33 L2/100 (64), report-only latency | 14/500 | 486 | 851.6 / 851.6 |

The first two populations fall below the required 50 successes; their observed
p95/max violations nevertheless have failure precedence. The 851.6 ms value
is limit100 **report only**, not a 150 ms latency-gate failure. For cell 25
(s18 L2/24), just 4/500 pages succeed and p95 is 67.2 ms; a small population
does not automatically fail latency. Nearest-rank p95 uses the 20th of 21,
19th of 20 and maximum of 14 respectively, so a few slow successes matter.
Fast stale refusals must not dilute that population. Repeated fresh-handle
requests can still become stale across a request's yielded snapshot fences;
committed same-owner actual-call overlap explains them. The protocol is
behaving as registered: record all attempts, replace missed overlaps, stop
at the ceiling, and leave a sample shortage inconclusive unless a hard check
already fails. It does not guarantee 50 successes under continuous mutation.

The tails are in the awaited read, not host decoding/close or the subsequent
writer stop: at cell 19's p95, read is 403.4 ms and close 1.0 ms, with loop
maximum 2.0 ms; cell 31's p95 is 288.5 ms read / 1.0 ms close / 2.4 ms loop;
cell 64's maximum is 850.3 ms read / 1.3 ms close / 2.0 ms loop. At those
points the writer's actual call ends 564.6, 982.8 and 1214.0 ms after the
request starts, respectively, **after the page was returned**. Thus these
particular tails cannot be explained by waiting for that writer's final
`core.close()`. They also cannot be explained by post-read writer IPC, which
is not in `elapsedMs`. Cell 67's max spans seven actual writer calls and
several closes; a bounded closing-writer wait remains possible there.

The existing E1-C2 v1.1 policy is a request-wide absolute cutoff of
`min(deadlineAt, workerNow+1000)-20` ms, not 100 ms and not a retry/reset per
statement. Worker startup already consumes the request deadline. The harness's
old `PROTOCOL.lockPolicy` string incorrectly said 100 ms; only that description
is corrected, with no runtime policy or latency/loop threshold change. A
289–851 ms read is compatible with the actual bound, but compatibility is
not evidence of a native wait. Successful reads also include Worker startup,
schema validation, synchronous SQLite execution/I/O and all preview quanta.
r3 records none of their timings, so a definitive split between native wait,
Worker scheduling, filesystem delays and compute is unavailable. The new
numeric SQLite longest-call/totals and host spans make that distinction
reviewable in the next run. Do not label every tail a closing-writer wait or
claim the harness fix has made latency pass.

### D. What makes the inconclusive checks conclusive

* `reviewDeadline` is null in **288/288 checks where present**; idle and retained
  series do not have that check. The supplied writer profile has `reviewMs:null`.
  The check needs a real, unchanged product profile with an actual finite review
  deadline and observed review calls. A number invented for the benchmark, or
  the informational 5,000 ms comparison, would not supply that evidence. If the
  product intentionally has no review deadline, this launch check remains
  inconclusive by design; removing it requires a separately reviewed protocol,
  not a threshold edit in this patch.
* “DELETE cells have no gated population” is false universally. Of 72 DELETE
  cells, **37 main and 42 cold** have zero gated pages; **35 and 30** have some.
  The 24 idle cells have no busy refusals, and only two have no population (the
  bad L1 seed). Concurrent DELETE main has 23,839 busy refusals / 24,000 attempts
  (99.33%); cold has 4,776 / 4,800 (99.50%). DELETE busy has no rate gate, but
  missing successes remain missing evidence. Each main/cold series needs
  >=50/>=10 successful progressing pages within its fixed 500/100 ceiling;
  concurrent pages must overlap actual writer calls. It also needs all the
  other checks, writer commits and real deadlines. Busy-only output cannot be
  made conclusive by counting refusals as fast pages or by increasing ceilings.
* `edgeCaseCoverage` is null in **128 series**: 32 main, 35 cold and 61 warmup.
  It is true only when all four numeric extraction counters are positive in
  that series. That requires the four reachable seeded content cases, matching
  `sourceCases` instrumentation, valid selection revisions and reads that get
  far enough to extract each case. Busy/conflict-only attempts cannot prove
  coverage. The seed fix removes one obstruction; unchanged three warmups can
  still all be busy. A zero mismatch count alone does not prove coverage.
  This check has no boolean-false case: missing extraction evidence is null;
  nonzero `edgeCaseMismatches` separately fails `edgeCaseConsistency`.

### Verification and delivery

Verification results and mechanically cross-checked delivery list follow below.

| Verification | Actual exit code / result |
| --- | --- |
| Both supplied r3 summary scripts | 0 each; 144 cells, 576 decisions |
| Final two-memory regression with the original fixture helper temporarily restored, Node 24.22.1 | 1 as expected; root ledger 1 != stored 2; fixed helper restored in `finally` |
| Initial corrected regression, Node 24.22.1 | 0 |
| Instrumentation/measurement tests, Node 24.22.1, intermediate run | 0; 15/15 |
| 28 explicit target files below, Node 22.16.0 | 0; 357/357 |
| Same 28 explicit target files, Node 24.22.1 | 0; 357/357 |
| One `--smoke`, Node 24.22.1, exact supplied writer profile | 0; six cells, 35 attempts, 35 journal records; all six retained traversals pass; observed attempt loop maximum 2.70 ms; observational only |
| Both supplied summary parsers on the new smoke JSON | 0 each; streaming output remains readable |
| Final measurement + installed tests after the two-schema regression and diagnostics, Node 22.16.0 | 0; 16/16 |
| Same final two files, Node 24.22.1 | 0; 16/16 |
| Harness and preload syntax checks, both runtimes | 0 each |
| Whitespace/newline/added-path scan, header/threshold byte comparison, two-route file inventory, `git diff --check` | 0 each; six changed files |

The 28-file commands invoke `tools/testing/run.mjs --test-concurrency=1` using
the actual nvm binary for each version and these explicit arguments. Scratch
for the matrix and smoke was an owned temporary directory on memory-backed
storage, removed after each command. This is functional verification, not a
replacement for the primary's quiet-machine launch measurement.

```text
core/test/topic-member-previews-bounds.test.mjs
core/test/topic-member-previews-compatibility.test.mjs
core/test/topic-member-previews-installed.test.mjs
core/test/topic-member-previews-measurement.test.mjs
core/test/topic-member-previews-mutations.test.mjs
core/test/topic-member-previews-scale.test.mjs
core/test/topic-member-previews-text.test.mjs
core/test/topic-member-previews-visibility.test.mjs
core/test/topic-member-previews.test.mjs
core/test/topic-members-bounds.test.mjs
core/test/topic-members-compatibility.test.mjs
core/test/topic-members-integration.test.mjs
core/test/topic-members-mutations.test.mjs
core/test/topic-members-primary.test.mjs
core/test/topic-members-recheck-findings.test.mjs
core/test/topic-members-review-findings.test.mjs
core/test/topic-members-round3-findings.test.mjs
core/test/topic-members-scale.test.mjs
core/test/topic-members-visibility.test.mjs
core/test/topic-members.test.mjs
core/test/topic-overview-lifecycle.test.mjs
core/test/topic-overview-raw29.test.mjs
core/test/topic-overview-visibility.test.mjs
core/test/topic-overview.test.mjs
core/test/topic-reader-cancellation.test.mjs
core/test/topic-reader-sqlite.test.mjs
core/test/no-raw-db-fd.test.mjs
core/test/sqlite-lock-safety.test.mjs
```

The final delivery list is **6 files**, derived from `git diff --name-only`
and independently from HEAD blob IDs versus hashes of every tracked working
file (`git ls-files --stage` + `git hash-object --stdin-paths`); the two sorted
lists are identical. The untracked-file inventory was also checked after
removing owned diagnostic scratch. No new runtime module or shipped document
was added, so the artifact manifest needs no change.

```text
core/test/topic-member-previews-measurement.test.mjs
core/testing/topic-members-fixture.mjs
core/testing/topic-members-world.mjs
docs/plans/topic-member-previews-impl.md
tools/testing/fixtures/topic-member-previews-metrics.mjs
tools/testing/measure-topic-member-previews.mjs
```


### Harness fix round 1

The two P1 findings and the P2 diagnostics finding at `c2d258a6` are fixed in
this worktree. The preregistered header, `PROTOCOL`, Cartesian matrix and
`decide()` are byte-identical to that revision; only the preview bounds
validation is tightened. No full measurement, smoke, setup regeneration,
network access or commit was performed in this round.

* **Raw descriptors → isolated copies → bytes and locks regression.** Both
  seed and cell cloning now execute the literal `node:fs` copy program in a
  short child with an empty environment and no SQLite import or connection.
  The seed closes both its core and fixture connection before copying; the
  fixture exposes idempotent `closeDb()` so deferred cleanup remains safe.
  A schema-33 migration also closes before copying. Every cell uses this same
  copy method outside the observed intervals, and its journal-mode assignment
  is unchanged. The operation preserves physical pages, rather than rewriting
  them with `VACUUM INTO`: a SQLite-free hash child verifies byte-identical
  source/two-clone SHA-256 values on physical schemas 18/33 and DELETE/WAL.
  SQLite checks additionally compare schema, user version, journal mode and
  memory count. A different process's exclusive-lock probe stays BUSY before
  and after each copy while the host holds a quiescent read transaction; a
  missing-source copy fails closed with sanitized `child_failed`.
* **Fixture audit → isolated hashing → shared guard.** The audit of all
  `core/testing` filesystem imports found an additional live-database read in
  `topic-overview-raw29-fixture.fileBytes()`. Main-file/WAL/SHM hashing now runs
  in a SQLite-free child, and the same lock regression checks it. The other
  database writes in the fixture inventory are exclusive new-file creation
  (`ax`/`wx`) or closed frozen-store restoration; remaining reads/writes cover
  source assets, archives, JSON, reports and rendezvous markers. The filesystem
  inventory was cross-checked with a recursive Path scan and `rg`: **40
  modules**, identical. No additional raw database/companion descriptor is used
  by the previews harness or its fixture helpers in the measuring process.
  The existing raw-fd guard now scans the harness, preload, workspace and
  preview fixture helpers plus the shared hash fixture. Its API set includes
  `copyFile`/`cp` and synchronous forms. Exact source/multiplicity allowances
  cover report I/O, directory metadata and only the literal isolated child
  programs; regression injections reject parent-process copies and companion
  opens even with these allowances.
* **Unknown status exemption → contract shapes → measurement-path regression.**
  Bounds now accept only `available` with string text, boolean `truncated` and
  exactly those three keys, or `unavailable` with exactly `status`/`reason` and
  one of the contract's six reasons. Available text retains the existing
  1,024-byte/72-grapheme caps. Every item goes through this check, including
  unavailable items; unknown reasons cannot introduce arbitrary diagnostic
  labels. The Worker-response regression submits the reported `unexpected`
  status with 2,048 bytes, malformed unavailable variants, valid unavailable
  variants and available byte/grapheme boundary cases through `attempt()` and
  the existing 50-sample decision. Invalid responses fail bounds and acceptance;
  valid unavailable responses remain accepted. Restoring only the original
  harness makes this regression fail with `true !== false` on both runtimes.
* **Partial SQLite call metrics → executing and cleanup calls → deterministic
  counter regression.** In addition to prepare/exec/get/all/run, the preload
  times iterator creation, every `next()` (including exhaustion) and `return()`,
  `columns()`, explicit statement `close()`/`Symbol.dispose` where supported,
  and database `close()` (which includes native statement cleanup on Node 22).
  Each call updates only bounded numeric aggregates and fixed stage/category
  labels, never SQL, parameters or row text. A Worker probe with an injected
  clock checks one call and exactly one timing unit per operation, including
  early iterator return and a throwing execution. Cleanup by GC or forced
  Worker termination outside per-request publication is not separately timed.
  An informational Node 24 in-memory probe (five 20,000-cycle batches after
  warmup) measured raw iterate/next/return/columns cycles at 0.00113–0.00125 ms
  versus 0.00158–0.00176 ms instrumented, about 0.5 microseconds added per cycle.
  This is diagnostic overhead evidence, not a launch latency measurement.

Verification uses the explicit nvm binaries for Node 22.16.0 and 24.22.1.
The final command for each is `node tools/testing/run.mjs
--test-concurrency=1 --test-reporter=tap` followed by the same 28 explicit files
listed in the preceding verification section (all 26 `core/test/topic-*.test.mjs`
files plus the raw-fd and SQLite lock-safety guards). The file selection was
independently derived with glob and `rg`, then compared: **28 files**, identical.
New/touched tests and all previews measurement tests are included. Commands run
sequentially, with owned scratch on memory-backed storage and checked child exit
codes. No broad suite or timing acceptance gate was run.

| Verification | Actual exit code / result |
| --- | --- |
| First focused measurement/guard run, Node 22.16.0 | 1; two new test assertions needed correction (decision field name and WAL exclusive-lock probe); product fixes retained |
| Corrected focused regressions and harness guard, Node 22.16.0 | 0; 4/4 |
| New status regression against the original `c2d258a6` harness, Node 22.16.0 | 1, expected; `true !== false`; fixed harness restored in `finally` |
| Same original-harness status regression, Node 24.22.1 | 1, expected; `true !== false`; fixed harness restored in `finally` |
| Final 28 required files, Node 22.16.0 | 0; 361/361 |
| Final 28 required files, Node 24.22.1 | 0; 361/361 |
| Informational in-memory instrumentation overhead probe, Node 24.22.1 | 0 |
| Header/protocol/matrix/decision byte comparison and filesystem inventory cross-check | 0 |
| Final whitespace, added-path and changed-file inventory checks | 0; 8 changed files, 0 untracked files |

The final round-1 delivery list is **8 files**, derived from
`git diff --name-only HEAD` and independently from `git ls-tree -rz HEAD`
blob IDs versus `git hash-object --stdin-paths` hashes of all tracked working
files. The sorted lists match exactly. Untracked inventory was independently
checked with `git ls-files --others --exclude-standard` and
`git status --porcelain`: **0 files**, identical. The complete diff passes
whitespace/newline checks and contains no added machine-specific home or
temporary paths. No new runtime module or shipped document was added.

```text
core/test/fixtures/no-raw-db-fd-allowlist.json
core/test/no-raw-db-fd.test.mjs
core/test/topic-member-previews-measurement.test.mjs
core/testing/topic-members-fixture.mjs
core/testing/topic-overview-raw29-fixture.mjs
docs/plans/topic-member-previews-impl.md
tools/testing/fixtures/topic-member-previews-metrics.mjs
tools/testing/measure-topic-member-previews.mjs
```
