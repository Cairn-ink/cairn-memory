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

## Fix round 1

This round starts at `1c769bdb`. Both non-author reviews accepted the
**context-read-product C-4 delta v1.1.1 (detection and wait window)** above;
that section remains byte-for-byte unchanged. The fixes address all seven P1
review findings (the two failed-opening findings share one fix), plus the
capability-oracle note. No performance or platform qualification is claimed.

### Findings, fixes and regressions

| Review finding | Fix | Regression |
| --- | --- | --- |
| Spec 1 / standards 1: refused opening caches a closed connection, overwrites BUSY and double-closes | Lifecycle and sidecar native handles remain local until admission succeeds. Policy opening owns refused-native disposal; successful sidecar admission includes configuration, identity and schema checks. Cleanup preserves the original failure. Close detaches the lifecycle handle before disposal and is idempotent. Repair uses the same admission path. | `context-read-product-wal.test.mjs`: four `failed lifecycle/side admission SQLite 5/14` cases retain BUSY or unavailable, clear contention, run a distinct refresh successfully, observe ready, and assert every native connection closes exactly once. |
| Standards 2: pump key drops WAL opt-in and sidecar policy | Handle reuse and renewal include normalized `wal` and explicit `sidecarJournalMode` as well as the existing path/readSet/host identity. These are the journal configuration inputs; the shared wait constants are fixed runtime policy. | `context-read-product-pump.test.mjs`: otherwise identical WAL/true and DELETE/false projections dispatch all four current/history quanta, invoke both constructors and close both handles. |
| Standards 3: ordinary DELETE journal recreation refuses | Before a native call with no pinned transaction, a detected DELETE connection may adopt a new protected rollback-journal identity. After that native call and throughout a pinned transaction, identity checks remain strict. Main-file and directory identities and WAL/SHM checks retain their existing rules. Sidecar metadata guards use the same snapshot boundary. | WAL test: independent DELETE writer, isolated old-inode pin, released reader snapshot, new active journal with a distinct inode, then successful reading. Two blocked writer commits prove the reader lock survives guard checks and the isolated descriptor close; the writer commits after release. Additional mode, symlink, type, wrong-companion-owner and during-statement replacement cases refuse. |
| Standards 4: second refresh bypasses configured-mode refusal | A refused sidecar candidate is disposed before publication, including mode mismatch. Cached writable handles also check configured mode before reuse. | WAL test: existing WAL cache with configured DELETE refuses on both successive refresh calls. |
| Spec 2: staged companion initialization maps CANTOPEN to storage_error | Opted-in publication maps required-companion initialization/persistence failures to index_unavailable, including native PERM/READONLY/IOERR/FULL/CANTOPEN and filesystem permission, read-only, space and unsupported errors. BUSY remains storage_busy. Legacy mapping is unchanged. | WAL tests: real maintainer child faults at open/mode/execution/close with CANTOPEN, and mode faults with READONLY/IOERR/FULL/BUSY; assert public refresh mapping, original numeric telemetry, later successful refresh and clean drain. |
| Spec 3: staged initialization falsely claims complete aggregate telemetry | Opted-in publication uses the observed-probe transcript pattern: reserve supervisor coverage before dispatch; emit individual native begin/outcome records for lifecycle, initializer and repair-incumbent opens, configuration/journal-mode, prepare, execute, transaction and close calls; replay before mapping. Sequence numbers, final native-call count, pairing, fixed enums, connection ownership and terminal result detect incomplete transcripts. Lost dispatch/replay leaves incomplete coverage. No new diagnostic enums are needed. | WAL tests inject each initializer boundary through the actual child and assert the supervisor's exact stage/statement/code. Dropping a journal-mode outcome or all close event pairs yields incomplete coverage, never complete. A lost statement outcome with an acknowledged terminal BUSY retains storage_busy and incomplete coverage. |
| Spec note: omitted/false capability self-comparison is not independent | Both default spellings now compare exact serialized bytes against `fixtures/context-product-capabilities-p2b.json`, frozen from base `9a8f6fb7`'s capability factory, actual index assembly and synthetic host counter. No current capability implementation contributes expected bytes. | Historical golden passes unchanged defaults. In an isolated base archive, changing hardResponseCutoff identically for both constructors makes the golden test fail on both runtimes; the former omitted/false comparison would still agree. |

The DELETE rule distinguishes a new SQLite transaction after snapshot release
from replacement during a native operation: only the pre-call boundary, while
`isTransaction` is false and detected mode is DELETE, can adopt a journal inode.
A journal inode has no continuity requirement across those released snapshots;
SQLite may delete/recreate it while no observation sees its absence. Every new
entry must still be a regular, non-symlink, single-link, current-owner 0600 file
in the unchanged current-owner 0700 directory. Both sides of a statement remain
checked, as do pinned snapshots. Safe uncoordinated journal replacement outside
a snapshot is indistinguishable by metadata from legitimate recreation; the
protected directory remains the deployment exclusion boundary. This does not
authorize external replacement or mode changes. No raw descriptor is opened in
a process holding SQLite connections; the test's inode pin is in its own process.

### Regression proof and verification

An isolated `git archive 1c769bdb` received only the new tests/fixtures. On both
Node 22.16.0 and 24.15.0, the explicit WAL+pump command with
`--test-name-pattern='P2d fix round 1'` exited **1**: **23 tests, 18 failures,
5 safety checks passing**, reproducing every runtime finding. The isolated
archive is removed. The historical-capability mutation command with
`--test-name-pattern='P2-01/10 WAL opt-in'` exited **1 / 1** as intended.

The golden was generated using a temporary archive of `9a8f6fb7`, extracting its
capability factory and invoking it with that revision's `openProductIndex`
assembly and `createContextReadHost` counter. The archive is removed. The
fixture SHA-256 (including final newline) is
`111ad0916fbbd9d2902c6a490be40b3b9887abf8391c49666b281855978bd454`.

Development commands retained their actual failures: the first Node 22 WAL+pump
run exited **1** (42 pass / 26 fail) because the new child wrapper passed an
explicit undefined options argument to DatabaseSync; a default options object
fixed it. The next WAL+pump run exited **0** (84/84), and the WAL+pump+journal-probe
run exited **0** (113/113). A later selected new-test/golden run exited **1**
(22/23) because golden generation omitted the historical synthetic host counter;
regeneration now invokes the actual historical index and host. No assertion was
weakened. Final full-file checks below supersede those development runs.

Final verification uses the nvm-installed Node executables; `node --version`
reported `v22.16.0` and `v24.15.0`, each exit **0**. The exact test inventory
was expanded before dispatch using filesystem globs and independently selected
from `rg --files`: **53 explicit paths, zero differences**. Each command ran
one path, sequentially, through the managed process-group runner:

```sh
p2d_node="$(nvm which "$p2d_version")"
"$p2d_node" tools/testing/run.mjs \
  --import "$p2d_verification/npm-cache-only.mjs" \
  --test-reporter=tap --test-concurrency=1 "$p2d_test"
```

The temporary preload only confines npm subprocesses to a task-owned offline
cache. It was seeded with **15 already-cached pinned package bodies** and
four cached public packuments (both npm Accept variants), with zero missing
source entries; no download, key or shared-cache write occurred. MCP and
OpenAI dependencies were already installed and were not changed. Every path
below has **zero skips**. Each cell is the actual command exit and pass count.

| Explicit path | Node 22.16.0 exit (pass) | Node 24.15.0 exit (pass) |
| --- | ---: | ---: |
| `adapters/mcp/test/context-read-default-entropy.test.mjs` | 0 (1) | 0 (1) |
| `adapters/mcp/test/context-read-sources.test.mjs` | 0 (4) | 0 (4) |
| `core/test/context-read-assembly-races.test.mjs` | 0 (7) | 0 (7) |
| `core/test/context-read-assembly-readonly.test.mjs` | 0 (28) | 0 (28) |
| `core/test/context-read-assembly.test.mjs` | 0 (20) | 0 (20) |
| `core/test/context-read-bm25.test.mjs` | 0 (3) | 0 (3) |
| `core/test/context-read-budget.test.mjs` | 0 (5) | 0 (5) |
| `core/test/context-read-core.test.mjs` | 0 (26) | 0 (26) |
| `core/test/context-read-default-entropy.test.mjs` | 0 (1) | 0 (1) |
| `core/test/context-read-embedder.test.mjs` | 0 (5) | 0 (5) |
| `core/test/context-read-fusion.test.mjs` | 0 (4) | 0 (4) |
| `core/test/context-read-local-embedder.test.mjs` | 0 (38) | 0 (38) |
| `core/test/context-read-local-status.test.mjs` | 0 (3) | 0 (3) |
| `core/test/context-read-moc-source.test.mjs` | 0 (15) | 0 (15) |
| `core/test/context-read-process.test.mjs` | 0 (1) | 0 (1) |
| `core/test/context-read-product-artifact.test.mjs` | 0 (1) | 0 (1) |
| `core/test/context-read-product-control.test.mjs` | 0 (83) | 0 (83) |
| `core/test/context-read-product-import.test.mjs` | 0 (2) | 0 (2) |
| `core/test/context-read-product-index.test.mjs` | 0 (65) | 0 (65) |
| `core/test/context-read-product-pump.test.mjs` | 0 (18) | 0 (18) |
| `core/test/context-read-product-service.test.mjs` | 0 (2) | 0 (2) |
| `core/test/context-read-product-wal.test.mjs` | 0 (72) | 0 (72) |
| `core/test/context-read-product.test.mjs` | 0 (126) | 0 (126) |
| `core/test/context-read-recovery.test.mjs` | 0 (10) | 0 (10) |
| `core/test/context-read-review.test.mjs` | 0 (10) | 0 (10) |
| `core/test/context-read-sidecar.test.mjs` | 0 (17) | 0 (17) |
| `core/test/context-read-source-work.test.mjs` | 0 (7) | 0 (7) |
| `core/test/context-read-sources-authority.test.mjs` | 0 (6) | 0 (6) |
| `core/test/context-read-sources-bounds.test.mjs` | 0 (5) | 0 (5) |
| `core/test/context-read-sources-races.test.mjs` | 0 (16) | 0 (16) |
| `core/test/context-read-sources.test.mjs` | 0 (14) | 0 (14) |
| `core/test/context-read-tokenize.test.mjs` | 0 (2) | 0 (2) |
| `core/test/no-raw-db-fd.test.mjs` | 0 (5) | 0 (5) |
| `core/test/sqlite-journal-probe.test.mjs` | 0 (23) | 0 (23) |
| `core/test/sqlite-lock-safety.test.mjs` | 0 (16) | 0 (16) |
| `core/test/topic-members-bounds.test.mjs` | 0 (7) | 0 (7) |
| `core/test/topic-members-compatibility.test.mjs` | 0 (32) | 0 (32) |
| `core/test/topic-members-integration.test.mjs` | 0 (1) | 0 (1) |
| `core/test/topic-members-mutations.test.mjs` | 0 (20) | 0 (20) |
| `core/test/topic-members-primary.test.mjs` | 0 (26) | 0 (26) |
| `core/test/topic-members-recheck-findings.test.mjs` | 0 (33) | 0 (33) |
| `core/test/topic-members-review-findings.test.mjs` | 0 (7) | 0 (7) |
| `core/test/topic-members-round3-findings.test.mjs` | 0 (18) | 0 (18) |
| `core/test/topic-members-scale.test.mjs` | 0 (2) | 0 (2) |
| `core/test/topic-members-visibility.test.mjs` | 0 (10) | 0 (10) |
| `core/test/topic-members.test.mjs` | 0 (10) | 0 (10) |
| `core/test/topic-overview-lifecycle.test.mjs` | 0 (11) | 0 (11) |
| `core/test/topic-overview-raw29.test.mjs` | 0 (22) | 0 (22) |
| `core/test/topic-overview-visibility.test.mjs` | 0 (8) | 0 (8) |
| `core/test/topic-overview.test.mjs` | 0 (4) | 0 (4) |
| `core/test/topic-reader-cancellation.test.mjs` | 0 (6) | 0 (6) |
| `core/test/topic-reader-sqlite.test.mjs` | 0 (21) | 0 (21) |
| `packaging/test/topic-overview-raw29.test.mjs` | 0 (3) | 0 (3) |

Node 22.16.0: **53 paths, 902 passing tests, all final exits 0, zero skips**.

Node 24.15.0: **53 paths, 902 passing tests, all final exits 0, zero skips**.

The matrix orchestrator's actual exit is **1**, retaining the initial Node 22
R29 cache-setup failure. That original command and two diagnostic/cache-setup
reruns each exited **1** (all three installed cases stopped before fixture
execution): npm reported ENOTCACHED for missing matching registry metadata.
Copying four already-cached public packuments with both required Accept
variants fixed the private-cache prerequisite. The final identical Node 22
R29 command exited **0**, **3/3**, and is the result in the table. Node 24's
matrix used the repaired cache. No repository code or assertion changed for
this correction; the other 105 matrix commands exited 0.

The final source recheck on **each runtime** used:

```sh
"$p2d_node" tools/testing/run.mjs --test-reporter=tap --test-concurrency=1 core/test/context-read-product-artifact.test.mjs core/test/context-read-product-wal.test.mjs
```

Both commands exited **0**, **74/74**, zero skips. These rechecks include the
last added truncated-BUSY regression, which was added after the original WAL
matrix runs (72 tests each). A committed terminal BUSY remains storage_busy
when its per-statement outcome is lost, while the ledger stays incomplete.
The final WAL file now contains 73 tests, plus the one installed artifact test.

All **9 changed JavaScript files** passed `node --check`
on both runtimes: **18 individual exits of 0**. An extra early Node 22
`no-raw-db-fd.test.mjs` command exited **0**; the full matrix repeats it on both
runtimes without any runtime allowlist change.

Installed-artifact evidence remains **308 manifest = 308 installed files**,
**87 source = 87 installed = 87 independently derived closure files**, with
zero differences; static SQLite-free closure is **23**. All five changed
runtime modules and this existing report were already registered in the
manifest. The new golden is a test fixture. The R29 installed checks cover
all three existing modes/clients and retain actual child exit/cleanup checks.

`git diff --check` finally exited **0**. An intermediate docs append left an
extra EOF blank line (exit **2**); it was removed. A separate scan of all
changed files, including the untracked golden, checks trailing whitespace,
final newline and forbidden private absolute paths, exit **0**. The original
report bytes, including the accepted C-4 delta, equal the complete original
file prefix at `1c769bdb`.

### Fix-round changed-file inventory

Derived first with `git diff --name-only -z HEAD` plus
`git ls-files --others --exclude-standard -z`, then independently with
`git status --porcelain=v1 -z`: **11 files, zero differences**. The comparison
covers runtime, tests, both fixtures, the new golden and the report; it is not
limited to core runtime sources.

```text
core/context-product-pump.mjs
core/context-product-sidecar.mjs
core/context-product-sqlite.mjs
core/context-product-telemetry.mjs
core/sqlite-journal-probe.mjs
core/test/context-read-product-pump.test.mjs
core/test/context-read-product-wal.test.mjs
core/test/fixtures/context-product-capabilities-p2b.json
core/test/fixtures/context-product-wal-process.mjs
core/test/fixtures/context-product-wal-worker.mjs
docs/plans/context-read-p2d-impl.md
```

No new runtime module, generated runtime, frozen-contract change, commit,
network/key operation, timing measurement or broad suite was introduced.
Qualification and production-volume work remain with their existing owners;
production stays DELETE until the owner authorizes a switch. Test work stayed
actively supervised through logs, actual progress and exit codes. Managed
runners verified child/process-group cleanup before returning. Temporary
archives, logs and the private offline cache are removed at handoff; no task
is left running or promised unattended supervision.

## Fix round 2

This round starts at `832e9977` and addresses both re-reviews' two distinct P1
findings. The preceding report is retained byte-for-byte, including the
accepted C-4 delta v1.1.1. The quiescence rule below supersedes round 1's
assumption that `!isTransaction` alone identifies a released snapshot.

### Findings, fixes and regressions

| Finding | Fix | Regression |
| --- | --- | --- |
| Both reviews: handled repair-incumbent corruption overwrites the terminal initializer error | Creation replay records every native failure but uses only the child's acknowledged terminal result for public mapping, including when the transcript is incomplete. A handled failure cannot replace a later native or filesystem error. Missing terminal acknowledgement still refuses and marks coverage incomplete. | Three actual DELETE-sidecar repair tests inject incumbent SQLITE_CORRUPT (11), then initializer BUSY (5), CANTOPEN (14), or FULL (13). Public `refreshContextIndex` returns `storage_busy` (retryable) for BUSY and `index_unavailable` (not retryable) for CANTOPEN/FULL. Supervisor telemetry retains the preceding parent schema failure, incumbent corruption, and exact terminal journal-mode failure with complete coverage. Each case then repairs successfully on a distinct refresh and drains. |
| Standards: an unfinished native iterator retains an implicit read snapshot while `isTransaction` is false | Each admitted connection counts synchronous native calls and retains every iterator until exhaustion, successful `return()`/disposal, or connection close/disposal. DELETE journal identity adoption requires no explicit transaction, no active call, and no active iterator. Inherited iterator helpers consume the guarded receiver. Iterator cancellation and connection disposal can release resources after a guard refusal; iterator cancellation still runs the strict post-check. All ordinary pre/post checks, main/directory protections, WAL/SHM identity continuity and native BUSY preservation remain enforced. | Native SQLite iterators yield their first row with `isTransaction === false`; replacing the protected journal inode then makes the next `next()` refuse. A second case closes one of two iterators and proves the remaining iterator still prevents adoption. A native UDF that attempts a nested statement after journal replacement proves an active synchronous call cannot adopt it. Helper traversal also checks the protected source on each step. Cancellation after refusal releases the cursor. Additional cases cover explicit return, for-of break, exhaustion, connection close and connection disposal, plus iterator disposal where supported; subsequent completed-statement boundaries accept legitimate recreation. The existing independent-writer recreation/lock regression remains in the required set. |

Contract check: [product contract §8.1](context-read-product.md#81-error-
contract) assigns unusable indexes to `index_unavailable`; it does not
prescribe a separate numeric FULL mapping. FULL during required sidecar
initialization leaves the index unusable, so its public result remains
`index_unavailable`. BUSY remains `storage_busy`; only that outcome is
retryable.

The iterator regression uses native SQLite statements and metadata-only
synthetic journal identities. It never replaces an actual SQLite journal or
opens a raw descriptor while SQLite locks are held. No runtime allowlist,
SQLite import boundary, default capability bytes, frozen contract, generated
runtime or accepted delta is changed.

### Regression proof and commands

A task-owned `git archive 832e9977` received only the changed WAL test and
Worker fixture. On **each** Node 22.16.0 and 24.15.0:

```sh
"$p2d_node" tools/testing/run.mjs --test-reporter=tap --test-concurrency=1 --test-name-pattern='P2d fix round 2' core/test/context-read-product-wal.test.mjs
```

The baseline command exited **1**: **12 tests, 8 failures, 4 passes, zero
skips**. All three repair mappings, both unfinished-iterator cases, both
plain/observed helper traversal cases and reentrant statement replacement fail
at their public-result/refusal assertions. Iterator-helper traversal also
refuses rather than bypassing the guarded source. The identical fixed-source
command exited **0** on each runtime: **12/12 pass, zero skips**. The archive
contains no implementation changes.

The first development run of the same selected command on Node 22 exited **1**
(4/8 pass): the new assertions omitted the parent schema failure from the
expected telemetry ledger, and the mock's old inode getter incorrectly
followed later inode changes. Correcting those test fixtures produced exit
**0** (8/8); the additional two-iterator, iterator-helper (plain and observed)
and reentrant-statement cases bring the final count to 12. An added iterator-
helper development run exited **1** on each runtime (9/10 pass): after the
source throws, the helper itself is already done, so cleanup must return the
still-active source iterator. The corrected regression retains both the
guarded-next refusal and the explicit source-cleanup assertion. No public-
result assertion was weakened.

Final verification expands the same required explicit-path inventory as round
1. Its 53 paths were selected from that table and independently from `rg --files` using the required test families: **53 paths, zero differences**.
Each path runs serially, with the selected Node directory first on PATH:

```sh
"$p2d_node" --version
"$p2d_node" tools/testing/run.mjs --import "$p2d_verification/npm-cache-only.mjs" --test-reporter=tap --test-concurrency=1 "$p2d_test"
```

The version commands exited **0** and printed `v22.16.0` / `v24.15.0`. The
temporary preload confines npm subprocesses to a task-owned offline cache
seeded from 15 already-cached package bodies and four public packuments,
retaining their cached Accept variants. Existing installed MCP/tokenizer
dependencies were used unchanged. No network or key operation is involved.

| Explicit path | Node 22.16.0 exit (pass) | Node 24.15.0 exit (pass) |
| --- | ---: | ---: |
| `adapters/mcp/test/context-read-default-entropy.test.mjs` | 0 (1) | 0 (1) |
| `adapters/mcp/test/context-read-sources.test.mjs` | 0 (4) | 0 (4) |
| `core/test/context-read-assembly-races.test.mjs` | 0 (7) | 0 (7) |
| `core/test/context-read-assembly-readonly.test.mjs` | 0 (28) | 0 (28) |
| `core/test/context-read-assembly.test.mjs` | 0 (20) | 0 (20) |
| `core/test/context-read-bm25.test.mjs` | 0 (3) | 0 (3) |
| `core/test/context-read-budget.test.mjs` | 0 (5) | 0 (5) |
| `core/test/context-read-core.test.mjs` | 0 (26) | 0 (26) |
| `core/test/context-read-default-entropy.test.mjs` | 0 (1) | 0 (1) |
| `core/test/context-read-embedder.test.mjs` | 0 (5) | 0 (5) |
| `core/test/context-read-fusion.test.mjs` | 0 (4) | 0 (4) |
| `core/test/context-read-local-embedder.test.mjs` | 0 (38) | 0 (38) |
| `core/test/context-read-local-status.test.mjs` | 0 (3) | 0 (3) |
| `core/test/context-read-moc-source.test.mjs` | 0 (15) | 0 (15) |
| `core/test/context-read-process.test.mjs` | 0 (1) | 0 (1) |
| `core/test/context-read-product-artifact.test.mjs` | 0 (1) | 0 (1) |
| `core/test/context-read-product-control.test.mjs` | 0 (83) | 0 (83) |
| `core/test/context-read-product-import.test.mjs` | 0 (2) | 0 (2) |
| `core/test/context-read-product-index.test.mjs` | 0 (65) | 0 (65) |
| `core/test/context-read-product-pump.test.mjs` | 0 (18) | 0 (18) |
| `core/test/context-read-product-service.test.mjs` | 0 (2) | 0 (2) |
| `core/test/context-read-product-wal.test.mjs` | 0 (85) | 0 (85) |
| `core/test/context-read-product.test.mjs` | 0 (126) | 0 (126) |
| `core/test/context-read-recovery.test.mjs` | 0 (10) | 0 (10) |
| `core/test/context-read-review.test.mjs` | 0 (10) | 0 (10) |
| `core/test/context-read-sidecar.test.mjs` | 0 (17) | 0 (17) |
| `core/test/context-read-source-work.test.mjs` | 0 (7) | 0 (7) |
| `core/test/context-read-sources-authority.test.mjs` | 0 (6) | 0 (6) |
| `core/test/context-read-sources-bounds.test.mjs` | 0 (5) | 0 (5) |
| `core/test/context-read-sources-races.test.mjs` | 0 (16) | 0 (16) |
| `core/test/context-read-sources.test.mjs` | 0 (14) | 0 (14) |
| `core/test/context-read-tokenize.test.mjs` | 0 (2) | 0 (2) |
| `core/test/no-raw-db-fd.test.mjs` | 0 (5) | 0 (5) |
| `core/test/sqlite-journal-probe.test.mjs` | 0 (23) | 0 (23) |
| `core/test/sqlite-lock-safety.test.mjs` | 0 (16) | 0 (16) |
| `core/test/topic-members-bounds.test.mjs` | 0 (7) | 0 (7) |
| `core/test/topic-members-compatibility.test.mjs` | 0 (32) | 0 (32) |
| `core/test/topic-members-integration.test.mjs` | 0 (1) | 0 (1) |
| `core/test/topic-members-mutations.test.mjs` | 0 (20) | 0 (20) |
| `core/test/topic-members-primary.test.mjs` | 0 (26) | 0 (26) |
| `core/test/topic-members-recheck-findings.test.mjs` | 0 (33) | 0 (33) |
| `core/test/topic-members-review-findings.test.mjs` | 0 (7) | 0 (7) |
| `core/test/topic-members-round3-findings.test.mjs` | 0 (18) | 0 (18) |
| `core/test/topic-members-scale.test.mjs` | 0 (2) | 0 (2) |
| `core/test/topic-members-visibility.test.mjs` | 0 (10) | 0 (10) |
| `core/test/topic-members.test.mjs` | 0 (10) | 0 (10) |
| `core/test/topic-overview-lifecycle.test.mjs` | 0 (11) | 0 (11) |
| `core/test/topic-overview-raw29.test.mjs` | 0 (22) | 0 (22) |
| `core/test/topic-overview-visibility.test.mjs` | 0 (8) | 0 (8) |
| `core/test/topic-overview.test.mjs` | 0 (4) | 0 (4) |
| `core/test/topic-reader-cancellation.test.mjs` | 0 (6) | 0 (6) |
| `core/test/topic-reader-sqlite.test.mjs` | 0 (21) | 0 (21) |
| `packaging/test/topic-overview-raw29.test.mjs` | 0 (3) | 0 (3) |

Node 22.16.0: **53 paths, 915 passing tests, all final exits 0, zero skips**.

Node 24.15.0: **53 paths, 915 passing tests, all final exits 0, zero skips**.

The 106-command matrix orchestrator exited **0**. Its original Node 22 WAL
command exited **0** (84/84). After the final observed-helper regression and
helper binding adjustment, the affected artifact and WAL paths were each rerun
separately on Node 22 using the same command above: **two exits of 0**,
respectively **1/1 artifact** and **85/85 WAL**, zero skips. Node 24 already
ran both paths after that edit: **1/1 artifact**, **85/85 WAL**, exits **0**.
The table uses the final per-path results. Installed closure verification
therefore includes the final source on both runtimes.

All four changed JavaScript files passed `"$p2d_node" --check "$p2d_file"` on
both runtimes: **eight individual exits of 0**. The installed artifact still
cross-checks its manifest/archive filesystem and independently derived Worker
closure; lazy SQLite import, historical default bytes, entropy, raw-descriptor
guards and actual lock-safety tests all pass in the explicit set.

Final installed-artifact counts remain **308 manifest = 308 installed files**,
**87 source = 87 installed = 87 independently derived closure files**, zero
differences; the static SQLite-free closure is **23**. Tar pack and unpack
each exited **0**.

### Changed files and final checks

The inventory was derived with `git diff --name-only -z HEAD` plus `git ls-files --others --exclude-standard -z`, then independently with `git status --porcelain=v1 -z`. Diffing the sorted lists exited **0**: **5 files, zero
differences**, including runtime, tests, the Worker fixture and this report.

```text
core/context-product-sqlite.mjs
core/context-product-telemetry.mjs
core/test/context-read-product-wal.test.mjs
core/test/fixtures/context-product-wal-worker.mjs
docs/plans/context-read-p2d-impl.md
```

`git diff --check` and the added-text whitespace/final-newline/private-path
scan exited **0**. Comparing the original report bytes with the complete
prefix at `832e9977` exited **0**; the accepted C-4 delta v1.1.1 and frozen
contract are unchanged. No runtime allowlist entries were added.

No timing tests, network/key operations, generated runtime changes or commit
were performed. Test commands were actively supervised through progress logs
and actual exits; managed runners checked child/process-group cleanup. All
task-owned temporary archives, logs and the private cache were removed after
verification; no test or monitoring task is left running.


## Integration with P2c

Integrated the approved P2c head `02abb03a` into the approved P2d-WAL head
`e8fd46dc`. First merged the local `origin/main` ref at `3b6b57f6` as
`8eda6920`, bringing protocol v4 documentation without conflicts (merge command exit **0**). Then
`git merge 02abb03a` stopped with exit **1** for semantic conflict resolution.
Both resulting commits are merges; no separate implementation, test, generated
bundle or documentation commit is part of this integration. No network or keys
were used. These functional checks establish no deployment qualification.

### Conflict resolutions

The two independent conflict-file enumerations, `git diff --name-only
--diff-filter=U` and unique paths from `git ls-files -u`, matched: **6 files,
zero differences**, with **9 conflict hunks**.

| File | Hunks | Resolution |
| --- | ---: | --- |
| `core/context-product-pump.mjs` | 2 | Retained strict boolean WAL validation and P2c's `contextReadSet(..., PRODUCT_PROFILE)` / `coverage(...)` admission. Renewal and handle lookup include path, canonical readSet, canonicalJson ownerCoverage, types, intent, moduleUrl, `wal===true` and sidecarJournalMode. Handle lookup additionally retains the prior host-configuration binding. |
| `core/context-product-sidecar.mjs` | 1 | Kept both independent helpers: P2d's original-error-preserving cleanup and P2c's validated widened projection. Retained the term-indexed 128-posting pages, with P2d's admitted handle ownership, configured-mode checks, lifecycle locks, safe file checks and native telemetry. Active-statement/iterator tracking remains in the unchanged SQLite policy module. |
| `core/test/context-read-product-artifact.test.mjs` | 2 | Combined the installed four-namespace Memory/Card build, selection, candidates, assembly and evidence checks with the opted-in WAL sidecar and journal capability assertions. Kept both source/installed graph checks and P2d's independent installed reverse-edge closure. |
| `core/test/context-read-product-pump.test.mjs` | 1 | Kept P2c's native four/32-selection and canonical-coverage renewal tests and both P2d journal-policy tests. Updated constructor/closure expectations for the complete identity and preserved native single-writer admission. |
| `docs/context-read-product.md` | 2 | Retained the owner-wide selection/coverage section and all WAL deployment obligations. The introduction and anchor link explicitly apply owner-wide selection under WAL opt-in; semantic search and deployment qualification remain unavailable/unestablished. |
| `packaging/artifact-files.json` | 1 | Took the ordered union, retaining the relative order of each parent's entries, including both the SQLite policy and pure selection modules and both handoff reports. |

The full key distinguishes intents/types as requested, while native admission
still permits only one maintainer for a physical file/selection. Before opening
a different keyed handle in that writer slot, the pump awaits the incumbent's
close/drain. Reopening and cleanup consume the already-reserved quantum; the
opening deadline is reduced by elapsed cleanup time. It does not weaken or
extend native ownership, renewal, operation cutoffs or cumulative quota rules.
Alternating intents can consequently require additional Worker openings; no
performance or freshness gate is claimed by this integration.

The constructor/closure counts were recomputed from recorded mock dispatches:
the existing eight-dispatch round robin now opens **8** handles and closes all
**8**, since each selection alternates intent. The four-dispatch journal-policy
case opens **4** handles with policies WAL/WAL/DELETE/DELETE and closes all
**4**. Combined single-selection regressions observe seven completed closes
before the eighth live handle, then eight after pump shutdown. Their mock also
refuses any attempt to open a second live writer for the same selection.

The source graph, installed literal-import graph and independent installed
reverse-edge fixed point all compute **88 reachable modules**: P2c's 87 plus
P2d's SQLite policy. The static reader/supervisor closure remains **23**, with
no eager SQLite dependency. The manifest union is **310 entries** (each parent
has 308, with two distinct additions per side); the manifest-only installed
filesystem independently matches all 310. The generated engine package adds
its six packaging/generated entries for **316 files**, alongside the existing
**32-file** Codex client runtime. No runtime raw-fd allowlist entry was added.
The SQLite policy module and raw-descriptor allowlist test are byte-identical
to the approved P2d head.

The WAL test's frozen P2b capability golden still contained the old namespace
maximum of 2 and caused one deterministic integration failure. Its expected
bytes now apply only P2c's approved 2-to-32 delta, retaining the historical
fixture unchanged and comparing the full absent/false responses byte-for-byte.
The expected maximum is explicitly asserted as 32; no other capability, journal
refusal or runtime behavior is relaxed.

### Added merged-behaviour regressions

- `core/test/context-read-product-pump.test.mjs`: two otherwise identical
  projections differ only in WAL permission, sidecar mode, coverage property
  order, or type selection. Reordered coverage renews the same pump without
  opening work; journal-policy changes refuse `read_in_progress`. Both intents
  dispatch, incompatible cached writers drain before replacement, and shutdown
  closes every opened handle. The inherited tests retain coverage-revision and
  selected-membership renewal refusals.
- `core/test/context-read-product-p2cd.test.mjs`: four namespaces with one Memory
  and one Card each, both intents, independently configured WAL/WAL with opt-in
  and default DELETE/DELETE. Checks ready complete coverage, all eight mixed
  candidates across four namespaces, assembly and exact snapshot refetch,
  journal capabilities, zero provider calls, complete supervisor telemetry,
  actual sidecar mode and independently unchanged canonical logical state.

### Integration verification

The matrix invokes the verified installed executables for Node **22.16.0** and
**24.15.0** directly, with that executable's directory first on PATH for
subprocesses. Both `--version` commands exit **0**. `$p2cd_node` below denotes
that verified executable; `$p2cd_test` is each separate explicit path in the
results table. The child environment contains PATH, `NODE_NO_WARNINGS=1` and
`NODE_DISABLE_COMPILE_CACHE=1`, without application environment or keys.

```sh
"$p2cd_node" tools/testing/run.mjs --test-reporter=tap --test-concurrency=1 "$p2cd_test"
```

Filesystem glob expansion and independent `rg --files` filtering produced
identical lists of **56 paths**, **zero differences**. The new owner-wide test
file and the expanded pump file are included. Tests run serially; each managed
runner return code is captured directly by `Popen.wait()`, without a pipe.
The runner also reaps its child process group before disposing its workspace.
Progress, active process state, log growth and failures were inspected during
the run; no background process was handed off without supervision. Packaging
uses its existing offline npm commands with empty task-owned configuration;
no dependency-install procedure or product assertion was weakened for this integration.

Before the final matrix, focused commands recorded these actual results:

| Node 24.15.0 focused command (same runner/options as above) | Exit | Finding |
| --- | ---: | --- |
| `core/test/context-read-product-pump.test.mjs core/test/context-read-product-p2cd.test.mjs core/test/context-read-product-artifact.test.mjs` | 1 | Installed graph/archive passed; native pump exposed the intent-handle ownership collision, and the DELETE fixture exhausted a prebuild quantum then reported store_closed. |
| `core/test/context-read-product-pump.test.mjs core/test/context-read-product-p2cd.test.mjs` | 1 | After preserving writer admission through drain/reopen, failures were a native pump prebuild read_timeout and a DELETE prebuild timeout followed by store_closed. |
| `--test-name-pattern='DELETE/DELETE' core/test/context-read-product-p2cd.test.mjs` | 0 | Unchanged DELETE case passed in approximately three seconds on recheck. |
| `packaging/test/topic-overview-raw29.test.mjs` | 0 | All three installed physical-layout/raw-source cases passed. |

The prebuild-timeout investigation found filesystem I/O waits (blocked processes
and 4% aggregate I/O wait in sampled `vmstat` intervals); the identical DELETE
case subsequently passed. No product deadline, fixture assertion, SQLite lock
policy or read result was weakened. Initial ownership failure was fixed in the
pump, rather than classified as load. Any matrix retries are recorded with
their initial and subsequent return codes below.

### Final runtime and test results

The initial **112-command** matrix records one nonzero exit: Node 22's WAL
file exited **1** solely for the old 2-namespace golden (84 of 85 cases passed).
After the approved P2c maximum was applied to the expected bytes, the **entire
85-case WAL file** was rerun on Node 22 and exited **0**. Node 24's WAL file
exited **0** on its matrix run. Thus all **56 explicit paths on each runtime**
ultimately exit **0**, with **zero skipped or cancelled tests**. The matrix
wrapper's initial exit is **1**, preserving that original failure; the corrected
per-file rerun is a separate command. No matrix prebuild-timeout retry was
needed. Initial matrix plus corrective verification totals **113 commands**.

Each row expands to the explicit per-file command above. `1 → 0` records both
the initial and corrective exits rather than overwriting the failure.

| Explicit test path | Node 22.16.0 exit(s) | Node 24.15.0 exit |
| --- | ---: | ---: |
| `adapters/mcp/test/context-read-default-entropy.test.mjs` | 0 | 0 |
| `adapters/mcp/test/context-read-sources.test.mjs` | 0 | 0 |
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
| `core/test/context-read-product-overflow-status.test.mjs` | 0 | 0 |
| `core/test/context-read-product-owner-evidence.test.mjs` | 0 | 0 |
| `core/test/context-read-product-owner.test.mjs` | 0 | 0 |
| `core/test/context-read-product-p2cd.test.mjs` | 0 | 0 |
| `core/test/context-read-product-pump.test.mjs` | 0 | 0 |
| `core/test/context-read-product-service.test.mjs` | 0 | 0 |
| `core/test/context-read-product-wal.test.mjs` | 1 → 0 | 0 |
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
| `packaging/test/topic-overview-raw29.test.mjs` | 0 | 0 |

Runtime generation and verification use **Node 24.15.0**, with the same
verified-executable/PATH handling:

| Command | Exit |
| --- | ---: |
| `"$p2cd_node" packages/setup/build-runtime.mjs` | 0 |
| `"$p2cd_node" packages/setup/build-runtime.mjs --check` | 0 |
| `git diff --cached --check` | 0 |

Both the initial generation/check and the final regeneration/check succeed.
The final archive and manifest are regenerated from the merged sources and
completed handoff; neither is hand-merged. `--check` verifies **32 client files**
and **316 engine files**. Independent engine-manifest and tar-inventory routes
match **316 files**, **zero differences**. The staged file cross-check below is
repeated after regeneration with unchanged **29 / 11 / 30** counts.

### Changed files, independently cross-checked

At merge resolution, `git diff --cached --name-only 8eda6920` was compared with
a separate enumeration of every staged blob/mode (`git ls-files --stage`)
against the first parent's full recursive tree (`git ls-tree -r 8eda6920`).
Both routes report **29 integration files**, **zero differences**:

- `core/context-product-control.mjs`
- `core/context-product-index.mjs`
- `core/context-product-pump.mjs`
- `core/context-product-reader.mjs`
- `core/context-product-selection.mjs`
- `core/context-product-service.mjs`
- `core/context-product-sidecar.mjs`
- `core/context-product-validation.mjs`
- `core/context-product-worker.mjs`
- `core/context-read-facade.mjs`
- `core/context-read-input.mjs`
- `core/index.mjs`
- `core/test/context-read-product-artifact.test.mjs`
- `core/test/context-read-product-overflow-status.test.mjs`
- `core/test/context-read-product-owner-evidence.test.mjs`
- `core/test/context-read-product-owner.test.mjs`
- `core/test/context-read-product-p2cd.test.mjs`
- `core/test/context-read-product-pump.test.mjs`
- `core/test/context-read-product-wal.test.mjs`
- `core/test/context-read-product.test.mjs`
- `core/test/fixtures/context-product-index-worker.mjs`
- `core/testing/context-product-index-host.mjs`
- `core/testing/context-product-owner-fixture.mjs`
- `docs/context-read-product.md`
- `docs/plans/context-read-p2c-impl.md`
- `docs/plans/context-read-p2d-impl.md`
- `packages/setup/runtime/engine/cairn-memory-local-preview-0.0.0-preview.1.tgz`
- `packages/setup/runtime/engine/manifest.json`
- `packaging/artifact-files.json`

The same two routes against Git's saved `AUTO_MERGE` tree identify **11 files
changed by resolution, merged regressions, handoff and regeneration**, **zero
differences**:

- `core/context-product-pump.mjs`
- `core/context-product-sidecar.mjs`
- `core/test/context-read-product-artifact.test.mjs`
- `core/test/context-read-product-p2cd.test.mjs`
- `core/test/context-read-product-pump.test.mjs`
- `core/test/context-read-product-wal.test.mjs`
- `docs/context-read-product.md`
- `docs/plans/context-read-p2d-impl.md`
- `packages/setup/runtime/engine/cairn-memory-local-preview-0.0.0-preview.1.tgz`
- `packages/setup/runtime/engine/manifest.json`
- `packaging/artifact-files.json`

The preceding main merge independently changes **1 file**,
`docs/plans/context-read-product.md`: `git diff-tree -r --name-only 8eda6920^1 8eda6920`
and recursive parent/child blob comparison agree. Both staged diff and recursive
blob comparison against `e8fd46dc` independently report **30 files** for the
whole two-merge task, **zero differences**. The final staged inventories are
rechecked after bundle regeneration.
