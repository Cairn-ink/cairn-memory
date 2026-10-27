# Context-read P2d implementation handoff

Code half implemented on `feat/context-read-p2d`, base `9a8f6fb7`, without a
commit. The primary's 2026-10-28 detection resolution supersedes this report's
previous detection blocker. The frozen contract is unchanged. No measurement
harness, qualification, production switch, generated setup runtime, network,
key access or other worktree changes are included.

## Design and scope

The smallest deployment permission is the optional boolean **`wal:true`** on
both product constructors. Absent/false retains P2b's journal refusal,
capability bytes and statuses. The frozen v1 sidecar and its isolated nolock
probe are unchanged. Opted-in capabilities list DELETE/WAL for both journals
and `wal:{available:true}`; availability describes code support, not a platform
qualification. The adapter guide describes opt-in and operator obligations.

`core/context-product-sqlite.mjs` composes the existing topic detector and wait
policy with the existing product native observer. It imports no SQLite. The
Worker starts one clock before opening bootstrap and once per authenticated
later operation, using the existing absolute `operationCutoffMonoNs` converted
to process-monotonic milliseconds. Canonical, sidecar and lifecycle connections
share that policy object; opening another connection never starts a window.
Opening/SQL/verification work consumes the same allowance. Cached statement,
iterator next/return and BEGIN/COMMIT/ROLLBACK calls pass through the topic
policy. No new native timeout values, retry loop, sleep or parent SQLite work
is introduced. DELETE mode remains zero after the opening probe's reset.

Before native opening, metadata-only checks require a same-owner 0700 directory
and same-owner regular single-link 0600 database/companions, without symlinks.
Checks pin directory/main identities, track continuously present companion
identities, accept SQLite-coordinated disappearance/creation, and validate
permissions/type/identity before and after native statements. At the opening
mode-probe boundary only, SQLite may have recreated companions after the last
writer closed; revalidate their protection and adopt the new identities while
retaining the pinned main/directory identities. Canonical and sidecar openers
retain their pre-constructor guards and revalidate those original main identities
at that same boundary, adopting only protected replacement companions. Later uncoordinated replacement
refuses. SQLite remains
the sole reader/writer of database/companion descriptors. Failed opening closes
through the native observer; unsupported READONLY/CANTOPEN arrangements become
`index_unavailable`, retaining the numeric native diagnostic. Native 5/6 is
preserved even if a concurrent companion change also fails validation.
Rollback, query_only restoration and close always reach the pinned native
connection to release locks, even after filesystem refusal; rollback still
refreshes the native wait budget. Protected active DELETE journals retain zero wait; the canonical read-only
connection refuses hot-journal recovery, with byte preservation tested.

Canonical opening remains read-only. The opt-in bypasses only product blanket
WAL preflight, then installs the policy before metadata/configuration beyond
the initial zero timeout. The first storage statement is journal_mode, before
application_id/user_version/layout validation. The legacy branch still runs its
original preflight/configuration/probe. The product telemetry labeler now
recognizes the existing `journal_mode` enum member; no diagnostic enum or DTO
extension was necessary.

A new sidecar is initialized in its explicitly configured DELETE/WAL mode in
the existing isolated staging child while it owns exclusive lifecycle exclusion.
SQLite closes the staged WAL database before publication, resolving its own
companions. No live canonical or incumbent sidecar mode changes. An incumbent
mode mismatch refuses. Authorized sidecar rollback recovery remains separate
from canonical reads. The legacy replacement protocol refuses WAL companions;
the opt-in additionally refuses replacement when the detected incumbent mode is
WAL or unknown. A damaged WAL cache requires host quiescence, confirmed drain
and explicit discard/rebuild, rather than treating nolock's WAL CANTOPEN as
proof of corruption. No live WAL/SHM is manually deleted or restored.

Maintenance's existing bounded canonical phases and separate sidecar write
transactions remain unchanged. No canonical snapshot spans a provider await,
host callback or another quantum. Cancellation uses the existing independent
public-settlement/native-reaping supervisor path; it introduces no ordinary
writer exclusion. The pump forwards the explicit WAL option; renewal refuses changes to opted-in
journal configuration instead of silently reusing a differently configured
maintainer. ReadSet validation, certificate contents, selection, ranking
and fusion are unchanged; P2c remains independently mergeable.

## context-read-product C-4 delta v1.1.1 (detection and wait window)

Proposed additive delta for non-author audit, implemented under the primary's
explicit resolution. It changes only the product opt-in detection/window rules
of `context-read-product-v1.1` §7; frozen sections are not edited.

**Deployment permission.** Add optional boolean `wal` to the two product
constructors and forwarded pump projection options. Only literal `true` permits
live WAL/SHM access/creation and `sidecarJournalMode:'WAL'`. Absent/false keeps
the prior refusal/capability/status bytes. This grants filesystem permission,
not authority, a canonical mode change or platform qualification. The frozen
v1 constructors and sidecar do not gain this option.

**Detection.** Inherit E1-C2 v1.0.1 exactly. Its project-wide lock-safety delta
explicitly supersedes preceding raw-header requirements, including the 100-byte
rule (`docs/plans/topic-overview-member-pages.md:942`). A raw descriptor close
releases process-owned POSIX locks, including another connection/Worker's locks
(`docs/plans/topic-overview-member-pages.md:943`). Therefore do not introduce a
100-byte detector or child header protocol. Configure zero native timeout, then
reuse `topicJournalMode` before schema/storage metadata. WAL/SHM lstat evidence
without a rollback journal is only a wait hint. On BUSY from the zero-wait
opening query with no rollback journal, retry that opening query at most once
inside the same operation window. Always clear provisional timeout and recheck
safe identity afterward (`core/topic-reader-sqlite.mjs:12`, `:31`, `:38`;
`core/context-product-sqlite.mjs:54`). Never retry a transaction or traversal.
The isolated nolock probe for unopted product/v1/store-fence remains unchanged.

Inherited residual ambiguity, verbatim from
`docs/plans/topic-overview-member-pages.md:972`:

> Residual ambiguity: an exclusive DELETE connection before its first journaled
> write, OFF/MEMORY journaling, or external mode switching can produce BUSY with
> no rollback journal and receive the bounded opening fallback. A stale/persistent
> rollback journal can suppress a WAL opening wait. Companion checks are not
> atomic; external concurrent journal-mode switching remains unsupported. Ordinary
> journaled DELETE writers never gain a wait; detected DELETE statements always
> have zero wait. Corruption is left to normal SQLite validation.

That opening fallback is the sole bounded exception to detected DELETE's
zero-wait rule. OFF/MEMORY detected modes are refused by the product.

**Window.** Adopt E1-C2 v1.1's deadline-bounded window, replacing §7's 100 ms
window only under this product opt-in. At operation start t and absolute
monotonic request/maintenance cutoff D:

```text
cutoff = min(D, t + TOPIC_WAL_WAIT_MS) - TOPIC_WAL_REPLY_RESERVE_MS
native timeout = max(0, floor(cutoff - now))
```

The single named pair remains `TOPIC_WAL_WAIT_MS = 1000` and
`TOPIC_WAL_REPLY_RESERVE_MS = 20` in `core/topic-reader-sqlite.mjs:46`.
The product calls `createTopicSqlitePolicy` directly
(`core/context-product-sqlite.mjs:49`), rather than copying constants/formula.
Changing the shared ceiling constant back to 100 is one line; the existing
reserve still applies unless audit separately changes its semantics. The cap
includes reserve: at most 980 ms native waiting, bounded further by remaining
request/maintenance time. Connection, transaction and statement admission do
not restart it. The reserve is delivery headroom, not a scheduling guarantee or
deadline extension. Native exhaustion is `storage_busy`; parent cutoff is
`read_timeout`, without reclassification.

Evidence: four of twenty supplied fresh-writer trials exceeded the historical
100 ms budget, with five busy member and five busy overview attempts during
writer-close checkpoint/reset (`docs/plans/topic-reader-wal-fix.md:976`).
The v1.1 formula and rationale are at `docs/plans/topic-reader-wal-fix.md:985`
and `:992`, implemented at `core/topic-reader-sqlite.mjs:83`. The primary's task brief additionally supplies a later v1.1 result: one busy
cell out of 40, because the topic reader's 250 ms request left roughly 230 ms
for native waiting. This later supplied result is not a measurement in this
worktree. The product's intended 2,000–5,000 ms requests permit the full cap
when enough time remains; they do not themselves prove the zero-busy gate. No
new measurement was run or evidence invented here.

All other §7 guarantees remain: Worker-only native waiting, detected DELETE
zero, refreshed prepare/step/iterator/transaction policy, no retries beyond the
inherited opening exception, no immutable, forced checkpoint, canonical writable
open/migration/mode change, hot canonical recovery or manual live companion
unlink/restore. Platforms and zero-busy must still qualify independently.

## Owned deterministic acceptance

All new WAL cases are in `core/test/context-read-product-wal.test.mjs`, with
isolated process/native-rendezvous fixtures in `core/test/fixtures/`.

| Owned row | Test and observable |
| --- | --- |
| P2-01/defaults | Strict opt-in test compares absent/false capabilities byte-for-byte and keeps WAL refusal. Existing entropy and legacy source tests retain their goldens. |
| P2-04 WAL | Physical v18 created by the frozen old pin in an independent process; separate raw-byte observer process and independent SQLite logical observer. Native-control and product cases limit cold SHM differences to offsets 100–119, require main/WAL equality, warmed all-file equality and logical/schema/version/mode preservation; old pin reopens. No equality claim during concurrent writes. |
| P2-08 WAL | Four journal combinations use the existing actual-Worker trap fixture: no writable reader open, DDL/DML/repair, integrity/aggregate/unkeyed index scan or provider call. Canonical exact fetch, candidates, assembly and status succeed with a certified projection. |
| P2-09 WAL | One-item checkpoint, Worker death inside the next uncommitted batch, fresh durable checkpoint equality, independent WAL writer and explicit resumed build. Canonical snapshots release between bounded phases. |
| P2-10 | Canonical × sidecar DELETE/WAL; checkpointed absent companions; live companions; independent fresh WAL writer close rendezvous at first mode statement and actual canonical/sidecar openings; protected active DELETE journals, hot-journal byte preservation, pre-constructor main identity; unsafe/symlink/replaced companions, replaced main and directory protection; mock-clock common window, first-statement zero baseline, cached/iterator/rollback refresh and later-connection exhaustion. Deterministic exclusive locks preserve native BUSY without a timing gate; DELETE no-journal fallback is bounded. Static prohibition and read traps retain no migration/mode switch/immutable/manual companion deletion. Unsupported opening retains numeric CANTOPEN telemetry. |
| Lock safety | Independent process contenders remain BUSY while same-process DELETE/WAL writer locks survive policy opening, metadata checks, iterator traversal and close; after host rollback the contender succeeds. No runtime raw-fd allowlist changes. |
| P2-13 | New runtime module and handoff report registered in artifact manifest. Existing product installed-artifact test now pins the policy module in the actual Worker closure and executes an opted-in WAL sidecar through the installed reader/maintainer. Source/install graph equality, an independent installed reverse-edge fixed point, and manifest/archive filesystem equality print counts. SQLite-free import tests remain. |
| P2-17 WAL | Reader status and actual maintainer refresh inject primary 5/6 before mapping; reply rendezvous crosses a mock parent cutoff. Complete committed failures survive discarded retrieval. A native SQLite UDF rendezvous leaves an unreturned call: termination yields incomplete telemetry, never zero-busy. |
| Cancellation | Reader and maintainer native snapshot rendezvous, abort/public settlement, withheld termination acknowledgement, then independent ordinary WAL writer commit while canceled reader still awaits reaping. Cleanup acknowledgement checked separately. No elapsed writer-progress threshold. |
| P2-20 WAL | v18/v23 canonical-only backup/restore after closed clients/maintenance and confirmed drain; SQLite writable close resolves WAL, then canonical copy. Independent logical validation and new issuance; search unavailable until explicit background rebuild, then fresh reader succeeds. Product owns external admission/quiescence gates. |
| P2-21 WAL | Independent expected E digest; writes at precommit, no-op and post-publication rendezvous leave E's authentic durable certificate but stale/null-count fresh status and unavailable candidates; explicit E+1 catch-up restores ready. Actual Worker tests distinguish rebuilding at precommit from valid complete at final-snapshot completion. Timeout after publication discards the reply while fresh authorized status sees the durable artifact. |

## Verification

Both nvm executables were verified with `--version`: **22.16.0 / exit 0** and
**24.15.0 / exit 0**. The host's generic node wrapper precedes nvm in PATH, so
the matrix invokes the absolute executable returned by `nvm which` and puts
that executable's directory first for subprocesses. No runtime version is
inferred from a preceding `nvm use` message.

The matrix ran **54 explicit files per runtime, 108 initial commands**, serially,
through the managed test runner. Glob enumeration and independent `rg --files`
filtering produced the same 54 paths, zero differences. Child return codes were
captured with `Popen.wait()` or `rc=$?` immediately after the command. The table
shows final actual exits, including the explicitly recorded corrective runs.
Every requested file ultimately exits **0 on both versions**, with no remaining
skips after the assembly recheck. No broad suite or measurement command ran.

Per-file command (each path is expanded separately, not a broad suite):

```sh
p2d_node="$(nvm which "$p2d_version")"
"$p2d_node" tools/testing/run.mjs --test-reporter=tap --test-concurrency=1 "$p2d_test"
```

Packaging commands additionally pass
`--import "$p2d_verification/npm-cache-only.mjs"`. This temporary test-only
preload changes only npm's cache environment, because the packaging helper
intentionally strips the parent environment. It does not alter engine code,
assertions or SQLite behavior. The cache contains only already-cached public
pinned runtime/dev dependencies and frozen fixture dependencies; all npm
commands use `--offline --ignore-scripts --no-audit --no-fund`. MCP and OpenAI
node_modules were absent (checked with `ls -ld`) before offline `npm ci`;
both installs exit **0**, inside this worktree, with a task-owned private cache.
No shared install, application environment, key or network is used.

| Explicit test path | Node 22.16.0 final exit | Node 24.15.0 final exit |
| --- | ---: | ---: |
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
| `core/test/context-read-product-wal.test.mjs` | 0 | 0 |
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
| `core/test/topic-members-bounds.test.mjs` | 0 | 0 |
| `core/test/topic-members-compatibility.test.mjs` | 0 | 0 |
| `core/test/topic-members-integration.test.mjs` | 0 | 0 |
| `core/test/topic-members-mutations.test.mjs` | 0 | 0 |
| `core/test/topic-members-primary.test.mjs` | 0 | 0 |
| `core/test/topic-members-recheck-findings.test.mjs` | 0 | 0 |
| `core/test/topic-members-review-findings.test.mjs` | 0 | 0 |
| `core/test/topic-members-round3-findings.test.mjs` | 0 | 0 |
| `core/test/topic-members-scale.test.mjs` | 0 | 0 |
| `core/test/topic-members-visibility.test.mjs` | 0 | 0 |
| `core/test/topic-members.test.mjs` | 0 | 0 |
| `core/test/topic-overview-lifecycle.test.mjs` | 0 | 0 |
| `core/test/topic-overview-raw29.test.mjs` | 0 | 0 |
| `core/test/topic-overview-visibility.test.mjs` | 0 | 0 |
| `core/test/topic-overview.test.mjs` | 0 | 0 |
| `core/test/topic-reader-cancellation.test.mjs` | 0 | 0 |
| `core/test/topic-reader-sqlite.test.mjs` | 0 | 0 |
| `core/test/no-raw-db-fd.test.mjs` | 0 | 0 |
| `core/test/sqlite-lock-safety.test.mjs` | 0 | 0 |
| `adapters/mcp/test/context-read-sources.test.mjs` | 0 | 0 |
| `adapters/mcp/test/context-read-default-entropy.test.mjs` | 0 | 0 |
| `packaging/test/topic-overview-raw29.test.mjs` | 0 | 0 |
| `core/test/sqlite-journal-probe.test.mjs` | 0 | 0 |
| `packaging/test/role-profiles.test.mjs` | 0 | 0 |

Final owned recheck, after the last policy/test correction, on **each runtime**:

```sh
"$p2d_node" tools/testing/run.mjs --test-reporter=tap --test-concurrency=1 core/test/context-read-product-wal.test.mjs core/test/context-read-product-artifact.test.mjs core/test/context-read-product-pump.test.mjs core/test/no-raw-db-fd.test.mjs
```

Actual exits **0 / 0**, **74/74 pass per runtime**: 51 WAL tests, 17 pump tests,
one installed product artifact test and five raw-fd guard tests. The core guard
passes without new runtime allowlist entries. Native-control cold SHM changes
were confined to allowed read marks; warmed equality passed. Ordinary writers
committed while canceled native readers were still awaiting reaping.

Additional completed corrective commands:

| Command after the nvm-selected node executable | Runtime | Actual exit / result |
| --- | --- | --- |
| `tools/testing/run.mjs --test-reporter=tap --test-concurrency=1 core/test/context-read-product-wal.test.mjs core/test/context-read-product-pump.test.mjs core/test/context-read-product-artifact.test.mjs core/test/no-raw-db-fd.test.mjs adapters/mcp/test/context-read-sources.test.mjs adapters/mcp/test/context-read-default-entropy.test.mjs` | 22.16.0 | 0; 74 pass at that revision; later owned recheck above supersedes the owned files. |
| `tools/testing/run.mjs --import "$p2d_verification/npm-cache-only.mjs" --test-reporter=tap --test-concurrency=1 packaging/test/topic-overview-raw29.test.mjs packaging/test/role-profiles.test.mjs` | 22.16.0 | 0; 7 pass. |
| `tools/testing/run.mjs --test-reporter=tap core/test/context-read-assembly.test.mjs` | 22.16.0 and 24.15.0 | 0 / 0; 20/20 pass each, no skips. |

The first Node 22 matrix had **six command exits of 1**; they are not silently
counted as passes: fresh-writer close exposed the companion-identity bug,
no-raw-db-fd rejected a new fs import, MCP source/default-entropy and the extra
role-profile fixture could not import missing dependencies, and offline R29
installation lacked a seeded private cache. The first two caused code fixes:
adopt protected SQLite-recreated companion identities only across opening,
and reuse existing `sqliteFileStat` instead of importing fs. The other four
were fixed by the offline prerequisites above. Every affected file was rerun
successfully. The initial assembly run on each runtime skipped A13 for missing
tiktoken; the final full-file rechecks execute it and have zero skips.

Development fixture runs also exited 1 for a malformed fetch DTO, double-close
teardown, and an undersized raw-byte observer buffer during the deliberately
large hot-journal test. Their fixtures were corrected; no gate was relaxed.
Database backup/replacement copies and raw observation run in isolated child
processes, so tests themselves do not drop a live host SQLite inode's locks.
The original matrix orchestrator was interrupted with exit 130 while confining
npm's cache; its interrupted file was rerun, and no partial result was accepted.
The completed orchestration returns 0 but records its six original command
failures individually; final success comes from the actual corrective exits.

Artifact evidence: **308 manifest files = 308 installed files**, tar pack and
unpack exits **0**; product runtime/Worker closure **87 source = 87 installed =
87 independent reverse-edge fixed-point files**, differences **0**. Static
SQLite-free product closure remains **23**. Installed R29's wider core closure
is **185 required / 170 eager**, source/installed equality, with all actual
fixture children exiting **0**. C06 and both entropy tests pass. The new runtime
module and this shipped report are the two added manifest entries. The product
artifact test pins the policy module because it is a real Worker dependency;
it now executes WAL sidecar maintenance/reads instead of merely copying bytes.

All jobs were actively supervised through process progress/logs and actual
exit. Managed runners confirmed child/process-group cleanup. No test, native
reader, writer or continuation is left running at handoff. The task-owned
verification/cache workspace is removed after final checks; no unattended
monitoring promise is made.

## Qualification half, production volume and deferred work

The separate worker owns `measure:context-read-product`, protocol registration,
all performance/availability/freshness cells, independent writer native
provenance and drain (P2-23), and report-only size/backup/verify outputs. This
change keeps ordinary independent writers functional but adds no writer
telemetry harness. No production/Linux/WSL/APFS platform is qualified here.

Full release requires P2a+P2b+P2c+P2d, the host adapter checklist, actual deployed
Node patch, registered corpus/Card/query/writer/pump inputs, native coverage,
and every §10 gate. Must qualify Linux ext4 on the production volume; separately
should qualify WSL2 ext4 and macOS APFS. Network filesystems are out of scope.
Production remains DELETE until the owner authorizes a switch after baseline
re-run and production qualification. The engine never performs that switch.

Deferred: non-author audit of this delta/code; P2c owner-wide scope/fusion;
production integration/admission/cron ownership; production measurements and
runtime regeneration by the primary; optional semantics/providers; explicitly
quiescent host discard/rebuild of damaged WAL sidecars. No broad suite, deployed
product integration, qualified lock-release bound or zero-busy claim is made.

## Delivery inventory

Changed files were derived from `git diff --name-only -z HEAD` plus
`git ls-files --others --exclude-standard -z`, independently re-derived from
`git status --porcelain=v1 -z`, and compared exactly: **18 files, differences 0**.
This includes runtime, tests/fixtures, both docs and the packaging manifest.
`git diff --check` and an independent changed-file trailing-whitespace,
final-newline and forbidden-absolute-path scan exit **0**. No generated runtime
or other worktree changes; no commit.

```text
core/context-product-index.mjs
core/context-product-pump.mjs
core/context-product-reader.mjs
core/context-product-sidecar.mjs
core/context-product-sqlite.mjs
core/context-product-telemetry.mjs
core/context-product-worker.mjs
core/context-read-facade.mjs
core/read-database.mjs
core/sqlite-journal-probe.mjs
core/test/context-read-product-artifact.test.mjs
core/test/context-read-product-pump.test.mjs
core/test/context-read-product-wal.test.mjs
core/test/fixtures/context-product-wal-process.mjs
core/test/fixtures/context-product-wal-worker.mjs
docs/context-read-product.md
docs/plans/context-read-p2d-impl.md
packaging/artifact-files.json
```
