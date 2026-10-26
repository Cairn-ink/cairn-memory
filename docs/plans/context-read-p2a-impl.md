# Context-read P2a implementation handoff

Implemented on `feat/context-read-p2a`, base `8e852e98`, without a commit.
The frozen `context-read-product-v1.1` specification and unified-memory contract
are unchanged. This is partial C-1: capabilities and canonical exact evidence
fetch only, lexical-only, baseline one/two namespaces and DELETE. There is no
production sidecar builder, candidates/assembly path, owner-wide fusion,
maintenance API, WAL change, migration, provider construction or inference.

## Product adapter

See [the product usage guide](../context-read-product.md) for the exact handoff,
requestControl, credential, Worker-local authorize/isCurrent ports, supervisor,
resource attribution, return envelopes and shutdown sequence. The public core
entry exports `openContextProductReader` and `createContextReadSupervisor`.

`requestControl` retains the contract's exact closed issuance shape. Concrete
trusted `host.configuration` contains the bound request snapshot, canonical
credential digest and a fresh atomic `requestReservation`. That reservation is
one backing cell per issuance, shared by clones and never reset or replaced to
retry an old issuance. It prevents replay even after bounded registry history
and the short ID cache have expired, including credentials with null expiry.
It is trusted issuance state, not a model field or caller-selected authority
flag. Binding checks happen before dispatch; a service issuance is rejected.

The host still owns authentication, method/payload validation, published
revocation/erasure state, optional ownerGeneration equality and stopped-client
erasure/restore procedures. The synthetic host is test-only. No private product
integration or adapter sign-off is claimed by these engine tests.

## Design notes

- The parent captures hrtime before UTC and option reflection. Frozen request
  and operation records use decimal unsigned-64 nanoseconds in one process clock
  domain. Expiry converts once. Every call gets the minimum of method, original
  request and converted credential cutoffs. No replacement/retry route renews
  admission; P2a permanently closes failed/cancelled handles.
- `memory-reader.mjs` and the product dispatcher share the extracted prompt
  cancellation/termination state machine. Legacy adapters keep their existing
  result mapping, idle policy and validation. The product watchdog is armed
  before Worker creation or dispatch, latches the first terminal event, settles
  without awaiting termination and checks receipt and final acceptance of every
  envelope, including errors. Close is idempotent and awaits actual cleanup.
- Native work stays in the fixed Worker, with empty env/execArgv, drained output
  and an explicit 192 MiB old-generation limit. P2a constructs neither a vector
  cache nor a token counter. SQLite-reaching imports remain dynamic behind the
  established boundary; there is no createRequire escape.
- Product fetch reuses the existing canonical evidence reader, both reads,
  eligibility/revision precedence, full fences and DTOs. Its authority strategy
  authorizes one request snapshot, samples currentness at entry and immediately
  before the authoritative read, and never calls back afterward. The final
  envelope guard latches failure and protects synthetic diagnostic-error paths
  without adding a third sample. The unavailable product search/assembly/status
  methods deliver bare errors only; their real data-bearing routes belong to P2b.
- Product snapshot HMAC domains are isolated from legacy snapshots. Compact item
  fence HMACs remain unchanged. Snapshot access binding contains the optional
  stable scalar ownerGeneration (null when absent), not request identity,
  issuance time, credential or a namespace authority vector.
- The supervisor registry is shared across supervisor instances and installed
  module copies in the host. It registers ownership before bootstrap. Safe
  device/inode preflight receives parent acknowledgement before native opening
  or host resource acquisition, so aliases cannot bypass a pending quarantine.
  Failed disposal latches reader_failed. Registered host resource disposers and
  optional host.close are supervised independently of public settlement.
- Live ownership is separate from completed history: 256 live records, 1,024
  completed records, 1 MiB completed metadata, 16 MiB completed diagnostics and
  fixed five-minute expiry. Completed entries release Worker/bootstrap closures
  and safety indexes. Concurrent drains share a delivery promise; acknowledgement
  removes history without tombstones. Pending/failed safety records cannot be
  evicted. The internal recovery seam requires a disposal verifier and checks
  shared resource-release counters before releasing a latch.
- Diagnostics use fixed 512-failure shared buffers per operation, committed
  atomic begun/completed/failure/busy/in-flight/overflow counters and sealed
  outcomes. They reuse the topic stage/statement families with two fixed context
  labels. Open, configuration, prepare, cached execution, iterator steps,
  transactions, close and temporary schema-comparison constructors are observed
  before public mapping. Drain preserves known BUSY after discarded retrieval;
  unreturned native work, missing sequences/seals or overflow is incomplete.

## Acceptance coverage and boundaries

The new tests cover P2a's portions of P2-01/02/03/04/05/06/08/11/13/14/16/17,
P2-22, P2-24, P2-25, P2-26, P2-27, P2-28 and P2-29. They include physical
v18 and every accepted intermediate layout through v33, v23/v33 Card evidence,
old-pin v18 reopen/hash preservation, no sidecar access, fixed-set permutations,
service/cross-request rejection, optional generation, both revocation samples
and permitted publication after final reading. Fresh credentials can refetch a
durable snapshot; ordinary content epochs do not revoke request authority.

Mock clocks and rendezvous cover 4,900-ms opening followed by a 100-ms fetch
remainder, a 4,950-ms credential cutoff leaving 50 ms, null expiry, UTC changes,
held partial/diagnostic envelopes, final-acceptance crossing, abort/close/crash,
failed constructors, delayed and failed termination, attribution pins, quota
refusal, aliases, history eviction/expiry, shared drains and 10,000 synthetic
fresh request operations across supervisors. No elapsed-time gate was added.

P2-27 candidate/assembly/status observations are synthetic tests of the shared
final-envelope authority guard and parent discard boundary. They are not a
released production search/status path. Inverse maintenance request-credential
rejection and real maintained diagnostic routes remain P2b work. Index
certification/status/pump, owner-wide ranking, WAL/writer telemetry and complete
performance qualification remain P2b–P2d; this report claims none of them.

## Verification

Runtime: Node **22.16.0**. Only the explicit core context-read/topic test paths
below were run. No broad suite, network, keys or package install was used.
There were **41** distinct prescribed files; the path inventory was independently
cross-checked by filesystem glob and rg file enumeration. Each final per-file
exit code below is an actual captured process return code, not a pipeline tail.

Total final observations: **539 tests**, **539 passed**, **0 skipped**. The three new files contribute **67 passing tests**.

| Command | Final exit | Tests | Passed | Skipped |
| --- | --- | --- | --- | --- |
| `node core/test/context-read-assembly-races.test.mjs` | 0 | 7 | 7 | 0 |
| `node core/test/context-read-assembly-readonly.test.mjs` | 0 | 28 | 28 | 0 |
| `node core/test/context-read-assembly.test.mjs` | 0 | 20 | 20 | 0 |
| `node core/test/context-read-bm25.test.mjs` | 0 | 3 | 3 | 0 |
| `node core/test/context-read-budget.test.mjs` | 0 | 5 | 5 | 0 |
| `node core/test/context-read-core.test.mjs` | 0 | 26 | 26 | 0 |
| `node core/test/context-read-embedder.test.mjs` | 0 | 5 | 5 | 0 |
| `node core/test/context-read-fusion.test.mjs` | 0 | 4 | 4 | 0 |
| `node core/test/context-read-local-embedder.test.mjs` | 0 | 38 | 38 | 0 |
| `node core/test/context-read-local-status.test.mjs` | 0 | 3 | 3 | 0 |
| `node core/test/context-read-moc-source.test.mjs` | 0 | 15 | 15 | 0 |
| `node core/test/context-read-process.test.mjs` | 0 | 1 | 1 | 0 |
| `node core/test/context-read-product-artifact.test.mjs` | 0 | 1 | 1 | 0 |
| `node core/test/context-read-product-control.test.mjs` | 0 | 34 | 34 | 0 |
| `node core/test/context-read-product.test.mjs` | 0 | 32 | 32 | 0 |
| `node core/test/context-read-recovery.test.mjs` | 0 | 10 | 10 | 0 |
| `node core/test/context-read-review.test.mjs` | 0 | 10 | 10 | 0 |
| `node core/test/context-read-sidecar.test.mjs` | 0 | 16 | 16 | 0 |
| `node core/test/context-read-source-work.test.mjs` | 0 | 7 | 7 | 0 |
| `node core/test/context-read-sources-authority.test.mjs` | 0 | 6 | 6 | 0 |
| `node core/test/context-read-sources-bounds.test.mjs` | 0 | 5 | 5 | 0 |
| `node core/test/context-read-sources-races.test.mjs` | 0 | 16 | 16 | 0 |
| `node core/test/context-read-sources.test.mjs` | 0 | 14 | 14 | 0 |
| `node core/test/context-read-tokenize.test.mjs` | 0 | 2 | 2 | 0 |
| `node core/test/topic-members-bounds.test.mjs` | 0 | 7 | 7 | 0 |
| `node core/test/topic-members-compatibility.test.mjs` | 0 | 32 | 32 | 0 |
| `node core/test/topic-members-integration.test.mjs` | 0 | 1 | 1 | 0 |
| `node core/test/topic-members-mutations.test.mjs` | 0 | 20 | 20 | 0 |
| `node core/test/topic-members-primary.test.mjs` | 0 | 26 | 26 | 0 |
| `node core/test/topic-members-recheck-findings.test.mjs` | 0 | 33 | 33 | 0 |
| `node core/test/topic-members-review-findings.test.mjs` | 0 | 7 | 7 | 0 |
| `node core/test/topic-members-round3-findings.test.mjs` | 0 | 18 | 18 | 0 |
| `node core/test/topic-members-scale.test.mjs` | 0 | 2 | 2 | 0 |
| `node core/test/topic-members-visibility.test.mjs` | 0 | 10 | 10 | 0 |
| `node core/test/topic-members.test.mjs` | 0 | 10 | 10 | 0 |
| `node core/test/topic-overview-lifecycle.test.mjs` | 0 | 11 | 11 | 0 |
| `node core/test/topic-overview-raw29.test.mjs` | 0 | 22 | 22 | 0 |
| `node core/test/topic-overview-visibility.test.mjs` | 0 | 8 | 8 | 0 |
| `node core/test/topic-overview.test.mjs` | 0 | 4 | 4 | 0 |
| `node core/test/topic-reader-cancellation.test.mjs` | 0 | 6 | 6 | 0 |
| `node core/test/topic-reader-sqlite.test.mjs` | 0 | 14 | 14 | 0 |

Additional checks:

- `node --check <file>` for each of the 16 changed JavaScript modules/tests:
  all 16 actual exit codes were 0.
- `git diff --check`: exit 0. An additional scan of all 19 changed files,
  including untracked files, found zero trailing-whitespace/final-newline errors
  and no newly introduced private absolute paths.
- The archive test uses `tar -cf` and `tar -xf`: both exit 0. All 295 manifest
  entries equal the independently walked installed filesystem, byte for byte.
  Runtime/Worker closure: source 78, installed 78, no differences. The new
  entry/supervisor static closure contains 22 modules and no node:sqlite link.

Initial failures are retained in this account. The first sequential 40-file
pass exited 1 overall: 38 files exited 0; the developing product test file and
`topic-overview-raw29.test.mjs` exited 1. New-test fixture mistakes (double close,
old-pin entry selection and comparison against an admission ref instead of
canonical stored content) were corrected only in the new tests. Initial control
and artifact development runs also exited 1 before their fixture corrections;
the initial `node --test core/test/context-read-product-control.test.mjs`
invocation exited 1. Final direct-file commands above exited 0.

The unchanged topic test initially failed its contention assertion at
`core/test/topic-overview-raw29.test.mjs:139`; that assertion did not print the
unexpected retrieval outcome. The same selected test then passed with exit 0
on both this branch and an untouched `git archive HEAD core plugins tools/testing`
copy of the baseline, using
`node --test-name-pattern='reader permits a reserved writer' core/test/topic-overview-raw29.test.mjs`.
The complete branch file subsequently passed all 22 tests, exit 0. No existing
test or fixture was edited, and the first failure is not erased by the reruns.

Real +50-ms settlement, maximum host-loop latency, production platform/runtime
qualification and the primary's full installed/CI matrix were not run. No
performance acceptance is claimed. The primary still owns those queued checks
and commits.

## Changed-file and packaging cross-check

Route one was `git diff --name-only -z` plus
`git ls-files --others --exclude-standard -z`. Route two was
`git status --porcelain=v1 -z`. The sorted sets matched exactly: **19 files**.
The manifest adds exactly **7 runtime modules and 2 shipped documents**, for
**9 new entries**, with **295 entries total**. Test code/fixtures are not shipped.
The manifest filesystem walk and independent runtime import/Worker graph checks
above include docs and configuration, not just core source files.

- `core/context-product-authority.mjs`
- `core/context-product-control.mjs`
- `core/context-product-reader.mjs`
- `core/context-product-telemetry.mjs`
- `core/context-product-worker.mjs`
- `core/context-read-facade.mjs`
- `core/context-read-sidecar.mjs`
- `core/context-read-supervisor.mjs`
- `core/index.mjs`
- `core/memory-reader.mjs`
- `core/read-database.mjs`
- `core/reader-worker-lifecycle.mjs`
- `core/test/context-read-product-artifact.test.mjs`
- `core/test/context-read-product-control.test.mjs`
- `core/test/context-read-product.test.mjs`
- `core/testing/context-product-host.mjs`
- `docs/context-read-product.md`
- `docs/plans/context-read-p2a-impl.md`
- `packaging/artifact-files.json`

## Fix round 1

This revision addresses both non-author reviews of P2a against the unchanged
`context-read-product-v1.1` contract. No frozen specification section changes.

| Finding | Fix | Deterministic regression coverage |
| --- | --- | --- |
| P1 abort-signal validation and settlement | Reject proxies with `util.types.isProxy`; call the captured native `AbortSignal.prototype.aborted` getter before registration. Use captured EventTarget listener intrinsics. Put listener/timer setup inside the cleanup path, and settle even when detachment throws. | `context-read-product-control.test.mjs`: forged/proxy signals at open and method entry register nothing and execute no traps; caller getter/method overrides are ignored on success and cancellation; failed setup releases records; a throwing detach still resolves once. |
| P1 malformed physical schemas | Add product-only `context-product-schema.mjs`: version-specific presence of 109 canonical tables, and complete column/strict-table/index metadata for 39 consumed evidence/support/dependency tables. Check index uniqueness, origin, partial flag, ordered keys, direction and collation. The shared opener receives only an optional validation callback; legacy validation branches are unchanged. Ship the module in the artifact manifest. | `context-read-product.test.mjs`: genuine v18 and v20–v33 layouts remain accepted; v18 relabelled as each v20–v33 refuses `unsupported_database`; missing tables/columns, missing indexes and reordered indexes refuse; the legacy relabelled-layout behavior remains unchanged. The artifact test checks installed runtime closure. |
| P2 credential bounds narrowed by transport | Validate the credential subtree independently at 16,384 bytes, depth 16 and 8,192 nodes, then charge the complete outbound message and shared buffers against the 262,144-byte IPC cap. | Control tests dispatch credentials at exactly depth 16 and 8,192 nodes, reject one beyond each without dispatch, and check the exact whole-message byte limit plus one byte. Real engine Worker tests also fetch successfully at both credential boundaries. |
| P2 failed cleanup hides native diagnostics | A failed single-record drain still rejects `reader_failed`, with frozen `error.cleanup` and deeply frozen sanitized `error.diagnostics`. Argument-free drain returns every cleanup delivery, including failed records, so one disposal failure cannot hide the rest. Failed records retain quarantine and incomplete native coverage. | Control test commits native extended BUSY 261, discards the retrieval on timeout, fails Worker disposal, and verifies BUSY 5/261 remains exportable through both drain forms, with incomplete coverage and frozen nested records. Acknowledgement and supervisor close still report failure. |
| P2 frozen errors collapse to `reader_failed` | Include `invalid_cursor`, `cursor_stale` and `token_count_unavailable` in the product error allowlist. | A real test Worker exercises all 24 applicable frozen errors through sender mapping and parent receipt, preserving retryability only for `storage_busy`. Real engine Worker fetch after canonical inode replacement returns `cursor_stale`. |
| P2 incomplete P2-03 lifecycle coverage | Add distinct active-close, Worker-error, Worker-exit and idle-expiry scenarios with mock monotonic clocks and explicit termination gates. | Control tests assert public settlement, pinned records and unresolved close/drain before disposal; reject late data before and after disposal; and confirm cleanup and zero live records only after releasing the termination gate. |

The product test's former raw database hashing and manually written WAL fixture
now use SQLite-managed logical schema/data fingerprints plus file metadata, and
a SQLite-created WAL cache. These checks do not claim whole-file byte equality.
New database access uses SQLite or file metadata, without raw database or
companion descriptors. The separately owned topic SQLite module and sidecar
`walHeader` probe are unchanged.

### Fix-round verification

All commands below ran sequentially on Node **22.16.0**, with explicit
test-file paths. The selection was independently derived through `rg --files`
and a directory walk: **41 matching files**, with no difference. Each child
process exit code was captured directly, with no pipeline masking. The full
run exited **0**: **583 tests passed, zero failed, cancelled or skipped**.

| Command | Actual exit | Tests | Passed | Failed |
| --- | --- | --- | --- | --- |
| `node core/test/context-read-assembly-races.test.mjs` | 0 | 7 | 7 | 0 |
| `node core/test/context-read-assembly-readonly.test.mjs` | 0 | 28 | 28 | 0 |
| `node core/test/context-read-assembly.test.mjs` | 0 | 20 | 20 | 0 |
| `node core/test/context-read-bm25.test.mjs` | 0 | 3 | 3 | 0 |
| `node core/test/context-read-budget.test.mjs` | 0 | 5 | 5 | 0 |
| `node core/test/context-read-core.test.mjs` | 0 | 26 | 26 | 0 |
| `node core/test/context-read-embedder.test.mjs` | 0 | 5 | 5 | 0 |
| `node core/test/context-read-fusion.test.mjs` | 0 | 4 | 4 | 0 |
| `node core/test/context-read-local-embedder.test.mjs` | 0 | 38 | 38 | 0 |
| `node core/test/context-read-local-status.test.mjs` | 0 | 3 | 3 | 0 |
| `node core/test/context-read-moc-source.test.mjs` | 0 | 15 | 15 | 0 |
| `node core/test/context-read-process.test.mjs` | 0 | 1 | 1 | 0 |
| `node core/test/context-read-product-artifact.test.mjs` | 0 | 1 | 1 | 0 |
| `node core/test/context-read-product-control.test.mjs` | 0 | 49 | 49 | 0 |
| `node core/test/context-read-product.test.mjs` | 0 | 61 | 61 | 0 |
| `node core/test/context-read-recovery.test.mjs` | 0 | 10 | 10 | 0 |
| `node core/test/context-read-review.test.mjs` | 0 | 10 | 10 | 0 |
| `node core/test/context-read-sidecar.test.mjs` | 0 | 16 | 16 | 0 |
| `node core/test/context-read-source-work.test.mjs` | 0 | 7 | 7 | 0 |
| `node core/test/context-read-sources-authority.test.mjs` | 0 | 6 | 6 | 0 |
| `node core/test/context-read-sources-bounds.test.mjs` | 0 | 5 | 5 | 0 |
| `node core/test/context-read-sources-races.test.mjs` | 0 | 16 | 16 | 0 |
| `node core/test/context-read-sources.test.mjs` | 0 | 14 | 14 | 0 |
| `node core/test/context-read-tokenize.test.mjs` | 0 | 2 | 2 | 0 |
| `node core/test/topic-members-bounds.test.mjs` | 0 | 7 | 7 | 0 |
| `node core/test/topic-members-compatibility.test.mjs` | 0 | 32 | 32 | 0 |
| `node core/test/topic-members-integration.test.mjs` | 0 | 1 | 1 | 0 |
| `node core/test/topic-members-mutations.test.mjs` | 0 | 20 | 20 | 0 |
| `node core/test/topic-members-primary.test.mjs` | 0 | 26 | 26 | 0 |
| `node core/test/topic-members-recheck-findings.test.mjs` | 0 | 33 | 33 | 0 |
| `node core/test/topic-members-review-findings.test.mjs` | 0 | 7 | 7 | 0 |
| `node core/test/topic-members-round3-findings.test.mjs` | 0 | 18 | 18 | 0 |
| `node core/test/topic-members-scale.test.mjs` | 0 | 2 | 2 | 0 |
| `node core/test/topic-members-visibility.test.mjs` | 0 | 10 | 10 | 0 |
| `node core/test/topic-members.test.mjs` | 0 | 10 | 10 | 0 |
| `node core/test/topic-overview-lifecycle.test.mjs` | 0 | 11 | 11 | 0 |
| `node core/test/topic-overview-raw29.test.mjs` | 0 | 22 | 22 | 0 |
| `node core/test/topic-overview-visibility.test.mjs` | 0 | 8 | 8 | 0 |
| `node core/test/topic-overview.test.mjs` | 0 | 4 | 4 | 0 |
| `node core/test/topic-reader-cancellation.test.mjs` | 0 | 6 | 6 | 0 |
| `node core/test/topic-reader-sqlite.test.mjs` | 0 | 14 | 14 | 0 |

The installed-artifact check independently compared all **296** manifest
entries with the archive filesystem and checked source/installed runtime
closures (**79** modules each); tar creation and extraction both exited **0**.
The static reader/supervisor closure remains SQLite-free (**22** modules).

Additional verification: `node --check` for each of the **10 changed JavaScript
files** exited **0**; `git diff --check` exited **0**. A separate scan including
untracked files found no trailing whitespace or missing final newlines in all
**12 changed files**, and no added private absolute paths. The frozen contract,
topic SQLite implementation and sidecar module are unchanged.

The initial developing product test run exited **1** (58/59 passed): the new
replacement-file fixture was created with mode 0644, so the file-safety refusal
preceded inode-currentness checking. Setting that fixture to 0600 corrected the
test. The focused command
`node --test-name-pattern='canonical replacement|inclusive' core/test/context-read-product.test.mjs`
then exited **0** (3/3 passed). The final complete product test above exited
**0** (61/61 passed); the earlier failure is retained here.

Changed-file route one was `git diff --name-only -z` plus
`git ls-files --others --exclude-standard -z`; route two was
`git status --porcelain=v1 -z`. Independently sorted lists matched exactly,
and `diff -u` exited **0**: **12 files** including the implementation notes,
manifest and untracked runtime/test fixture. No commit was created.

- `core/context-product-control.mjs`
- `core/context-product-reader.mjs`
- `core/context-product-schema.mjs`
- `core/context-read-facade.mjs`
- `core/context-read-supervisor.mjs`
- `core/read-database.mjs`
- `core/reader-worker-lifecycle.mjs`
- `core/test/context-read-product-control.test.mjs`
- `core/test/context-read-product.test.mjs`
- `core/test/fixtures/context-product-errors.mjs`
- `docs/plans/context-read-p2a-impl.md`
- `packaging/artifact-files.json`
