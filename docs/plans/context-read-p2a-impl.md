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

## Fix round 2

This revision fixes the two re-reviews of `ed0211d1` against the unchanged
v1.1 contract. Frozen specification sections, the topic SQLite implementation
and the sidecar `walHeader` probe remain unchanged. No commit was created.

| Finding | Fix | Deterministic regression coverage |
| --- | --- | --- |
| P1 forged/accessor-backed signals and registration reentry | After rejecting proxies, require the exact native signal prototype, the own-key set captured from a fresh controller at module load, and data descriptors for every own property. Only then invoke the captured `aborted` getter. This rejects copied state on ordinary objects, symbol accessors, extra hooks and caller method overrides without invoking them; deriving keys at runtime avoids depending on one Node version's symbol inventory. Recheck reader/owner/slot ownership immediately after registration. Put every post-registration check in supervised cleanup. | P2-03 control tests exercise copied symbol state, every native own key replaced by a throwing accessor, an actual runtime listener-hook symbol, proxies and own overrides at open/method entry. Forced close inside native registration spawns/posts nothing, disposes the returned subscription and drains to zero live records. Late descriptor mutation after registration and timer setup failures also release all records. |
| P1 suppressible cancellation | Register with `node:events` `addAbortListener`, dispose its handle on settlement and in `finally`, and check native aborted state immediately before accepting a final envelope. | P2-03 installs an earlier `stopImmediatePropagation()` listener. Abort still settles `read_cancelled`; late success is discarded. Separate tests remove the protected listener to prove the final acceptance guard independently, for opening and method results. Listener inventories verify disposal; mock clocks and termination gates verify cleanup without timing gates. |
| P2 SharedArrayBuffer validation executes user code | Classify with `util.types.isSharedArrayBuffer` after `isProxy`, require the exact supported prototype and inspect own descriptors before native reads. Capture `growable` and `byteLength` intrinsic getters; use the native length getter for the request reservation too. | P2-28 refuses proxy instances, objects and buffers with proxy prototypes, own accessor overrides and growable buffers. A replaced prototype getter is never called; the captured getter still validates a genuine fixed buffer. All caller trap/getter counters stay zero. |
| P2 rejected authority Promises become unhandled rejections | Identify native Promises with `util.types.isPromise` and observe rejection with captured `Promise.prototype.then`, without reading their own `then`. Keep synchronous refusal and the existing sample protocol. Non-native thenables remain refused without calling `then`. | P2-26 covers authorize, entry currentness and final currentness with rejected native Promises whose own `then` throws, plus refused non-native thenables. Exact sample counts remain 0/1/2 and errors remain `authority_required`/`scope_changed`. Real engine Workers return the prescribed errors, serve a subsequent capability request and close gracefully with confirmed cleanup. |
| P2 partial-index predicates are not attested | Include token-normalized predicates from `sqlite_schema.sql` in required partial-index metadata, preserving quoted literal bytes while normalizing SQL keyword case and spacing. | P2-05 validates both required partial indexes at all 15 accepted versions, then flips `deleted=0` to `deleted=1` and drops `WHERE`, independently restoring and revalidating each index. Real Workers refuse both `active_identity` mutations as `unsupported_database` and drain the failed opening. Existing genuine-version tests still fetch successfully. |

### Round-2 verification

Verified runtime executables report **22.16.0** and **24.22.1**. No network,
keys, package installation, broad suite or timing acceptance gate was used.
The prescribed paths were independently derived by filesystem glob and
`rg --files`: **41 files**, no difference. Each test ran as a separate child
with an explicit file path; its actual process return code was captured.

Node **22.16.0**: **620 passed**, zero failed, cancelled or skipped across all
41 prescribed files. `node` in the following table denotes that verified
runtime. The sequential 40-file runner exited **0**; the separately executed
product file exited **0**.

| Explicit command | Actual exit | Tests passed |
| --- | --- | --- |
| `node core/test/context-read-assembly-races.test.mjs` | 0 | 7 |
| `node core/test/context-read-assembly-readonly.test.mjs` | 0 | 28 |
| `node core/test/context-read-assembly.test.mjs` | 0 | 20 |
| `node core/test/context-read-bm25.test.mjs` | 0 | 3 |
| `node core/test/context-read-budget.test.mjs` | 0 | 5 |
| `node core/test/context-read-core.test.mjs` | 0 | 26 |
| `node core/test/context-read-embedder.test.mjs` | 0 | 5 |
| `node core/test/context-read-fusion.test.mjs` | 0 | 4 |
| `node core/test/context-read-local-embedder.test.mjs` | 0 | 38 |
| `node core/test/context-read-local-status.test.mjs` | 0 | 3 |
| `node core/test/context-read-moc-source.test.mjs` | 0 | 15 |
| `node core/test/context-read-process.test.mjs` | 0 | 1 |
| `node core/test/context-read-product-artifact.test.mjs` | 0 | 1 |
| `node core/test/context-read-product-control.test.mjs` | 0 | 66 |
| `node core/test/context-read-product.test.mjs` | 0 | 81 |
| `node core/test/context-read-recovery.test.mjs` | 0 | 10 |
| `node core/test/context-read-review.test.mjs` | 0 | 10 |
| `node core/test/context-read-sidecar.test.mjs` | 0 | 16 |
| `node core/test/context-read-source-work.test.mjs` | 0 | 7 |
| `node core/test/context-read-sources-authority.test.mjs` | 0 | 6 |
| `node core/test/context-read-sources-bounds.test.mjs` | 0 | 5 |
| `node core/test/context-read-sources-races.test.mjs` | 0 | 16 |
| `node core/test/context-read-sources.test.mjs` | 0 | 14 |
| `node core/test/context-read-tokenize.test.mjs` | 0 | 2 |
| `node core/test/topic-members-bounds.test.mjs` | 0 | 7 |
| `node core/test/topic-members-compatibility.test.mjs` | 0 | 32 |
| `node core/test/topic-members-integration.test.mjs` | 0 | 1 |
| `node core/test/topic-members-mutations.test.mjs` | 0 | 20 |
| `node core/test/topic-members-primary.test.mjs` | 0 | 26 |
| `node core/test/topic-members-recheck-findings.test.mjs` | 0 | 33 |
| `node core/test/topic-members-review-findings.test.mjs` | 0 | 7 |
| `node core/test/topic-members-round3-findings.test.mjs` | 0 | 18 |
| `node core/test/topic-members-scale.test.mjs` | 0 | 2 |
| `node core/test/topic-members-visibility.test.mjs` | 0 | 10 |
| `node core/test/topic-members.test.mjs` | 0 | 10 |
| `node core/test/topic-overview-lifecycle.test.mjs` | 0 | 11 |
| `node core/test/topic-overview-raw29.test.mjs` | 0 | 22 |
| `node core/test/topic-overview-visibility.test.mjs` | 0 | 8 |
| `node core/test/topic-overview.test.mjs` | 0 | 4 |
| `node core/test/topic-reader-cancellation.test.mjs` | 0 | 6 |
| `node core/test/topic-reader-sqlite.test.mjs` | 0 | 14 |

Node **24.22.1**:

| Explicit command | Actual exit | Tests passed |
| --- | --- | --- |
| `node core/test/context-read-product-control.test.mjs` | 0 | 66 |
| `node --test-name-pattern='P2-26 real Worker observes rejected' core/test/context-read-product.test.mjs` | 0 | 3 |

An additional Node **22.16.0** final-parent check,
`node --test-name-pattern='P2-26 real Worker observes rejected|physical v18 canonical' core/test/context-read-product.test.mjs`,
exited **0**, with **4/4 passed**. These focused reruns are not added to the
620-test inventory. Developing control runs passed before the additional
post-registration/opening regressions were added; final counts above describe
the complete control file. No test run failed in this fix round.

The installed-artifact test compared **296** manifest entries to the archive
filesystem, with tar creation/extraction exits **0/0**. Source and installed
runtime/Worker closures both contain **79** modules; the static SQLite-free
closure contains **22**. All modified shipped modules and this existing plan
are already in the manifest; no new shipped file was introduced.

`node --check` for each of the **7** changed JavaScript files exited **0**.
`git diff --check` exited **0**. The independent whitespace/final-newline scan
covers all **8** changed files, including any untracked paths; no added private
absolute paths were found. Frozen/protected-file diff checks exited **0**.
These are functional checks; full CI and performance qualification are not
claimed.

### Round-2 changed-file cross-check

Route one: `git diff --name-only -z` plus
`git ls-files --others --exclude-standard -z`. Route two:
`git status --porcelain=v1 -z`. The independently sorted lists match exactly;
`diff -u` exited **0**, with **8 files**, including documentation. No commit
was created.

- `core/context-product-authority.mjs`
- `core/context-product-control.mjs`
- `core/context-product-reader.mjs`
- `core/context-product-schema.mjs`
- `core/test/context-read-product-control.test.mjs`
- `core/test/context-read-product.test.mjs`
- `core/testing/context-product-host.mjs`
- `docs/plans/context-read-p2a-impl.md`

## Fix round 3

This revision corrects round 2's exact-own-key signal check. Genuine Node
`AbortSignal.timeout()` and `AbortSignal.any()` signals, and controller signals
used as composite sources, can have additional native data properties. Creating
a composite during a pending call can add properties to an admitted source.

Constructor and method entry reject proxies, require the exact native
`AbortSignal.prototype`, and inspect every own descriptor for a data value.
There is no exact-key-set comparison. The captured intrinsic `aborted` getter
then validates readable native state; a throw at entry means `invalid_input`.
After registration, no shape validation runs. Final acceptance reads only that
captured getter: aborted or unreadable state discards the response as
`read_cancelled`. An unreadable final state settles the method without closing
the reader; a subsequent capability call still succeeds. Failed opening still
receives supervised cleanup. Protected `addAbortListener` registration, the
registration-reentry ownership check, and subscription disposal in `finally`
remain in place.

Control regressions cover timeout and composite signals at opening and method
entry, pre-aborted native and composite signals with no dispatch, controller
sources composed before entry and during pending opening/method calls, late
unused accessors without shape revalidation, and an unreadable final intrinsic
state followed by successful reuse. Timeout acceptance uses a pending native
timeout without waiting for real time; deterministic pre-aborted cases use
`AbortSignal.abort()`. Existing forged-accessor, proxy, registration reentry,
propagation suppression and lost-notification cases remain covered. The old
extra-data-hook rejection expectation now uses an accessor hook, consistent
with the requested entry validation. No timing acceptance gate was added.

### Known P2 hardening, deferred

These cases require a deliberately forging in-process caller that already runs
arbitrary host code. They are documented here and are not implemented in P2a:

1. Signals forged with
   `Object.create(AbortSignal.prototype, Object.getOwnPropertyDescriptors(real))`
   and a proxied internal event map can execute traps during native listener
   registration. Descriptor checks do not attest internal event-map contents.
2. A native rejected Promise with a throwing `constructor` getter can still
   produce an unhandled rejection through species lookup in the captured
   `Promise.prototype.then`. Capturing `then` does not bypass species lookup.

The separate raw `walHeader` lock-safety hotfix remains the primary's merge.
This revision does not modify `walHeader` or the topic SQLite implementation.

### Round-3 verification

Verified runtime versions: **22.16.0** and **24.22.1**. The requested
`core/test/context-read*.test.mjs` inventory was independently derived by
filesystem glob and `rg --files`: **24 files**, identical (`diff -u` exit
**0**). Every file ran sequentially as a separate child with its explicit path;
the actual child return code was captured. No network, keys, package install,
broad CI sweep or timing acceptance gate was used.

Node **22.16.0**: **404 passed**, zero failed, cancelled or skipped. Each
explicit command below exited **0**; the sequential runner also exited **0**.
`node` denotes the verified 22.16.0 executable.

| Explicit command | Actual exit | Tests passed |
| --- | --- | --- |
| `node core/test/context-read-assembly-races.test.mjs` | 0 | 7 |
| `node core/test/context-read-assembly-readonly.test.mjs` | 0 | 28 |
| `node core/test/context-read-assembly.test.mjs` | 0 | 20 |
| `node core/test/context-read-bm25.test.mjs` | 0 | 3 |
| `node core/test/context-read-budget.test.mjs` | 0 | 5 |
| `node core/test/context-read-core.test.mjs` | 0 | 26 |
| `node core/test/context-read-embedder.test.mjs` | 0 | 5 |
| `node core/test/context-read-fusion.test.mjs` | 0 | 4 |
| `node core/test/context-read-local-embedder.test.mjs` | 0 | 38 |
| `node core/test/context-read-local-status.test.mjs` | 0 | 3 |
| `node core/test/context-read-moc-source.test.mjs` | 0 | 15 |
| `node core/test/context-read-process.test.mjs` | 0 | 1 |
| `node core/test/context-read-product-artifact.test.mjs` | 0 | 1 |
| `node core/test/context-read-product-control.test.mjs` | 0 | 81 |
| `node core/test/context-read-product.test.mjs` | 0 | 81 |
| `node core/test/context-read-recovery.test.mjs` | 0 | 10 |
| `node core/test/context-read-review.test.mjs` | 0 | 10 |
| `node core/test/context-read-sidecar.test.mjs` | 0 | 16 |
| `node core/test/context-read-source-work.test.mjs` | 0 | 7 |
| `node core/test/context-read-sources-authority.test.mjs` | 0 | 6 |
| `node core/test/context-read-sources-bounds.test.mjs` | 0 | 5 |
| `node core/test/context-read-sources-races.test.mjs` | 0 | 16 |
| `node core/test/context-read-sources.test.mjs` | 0 | 14 |
| `node core/test/context-read-tokenize.test.mjs` | 0 | 2 |

Node **24.22.1**:

| Explicit command | Actual exit | Tests passed |
| --- | --- | --- |
| `node --test-reporter=tap core/test/context-read-product-control.test.mjs` | 0 | 81 |

The final control suite includes the unchanged forged-accessor, proxy,
registration-reentry and suppression regressions as well as the new native
signal cases. Final getter-failure coverage exercises both acceptance checks,
proves subsequent method reuse, and verifies supervised failed-opening cleanup.
The earlier developing control runs passed 79 tests on each runtime; the final
counts above supersede them. No test run failed in round 3.

`node --check` for both changed JavaScript files exited **0**.
`git diff --check` exited **0**. The whitespace/final-newline scan covers all
**3** changed files, including documentation; no added private absolute paths
were found. Protected facade, sidecar and topic SQLite file diff checks exited
**0**. Existing shipped modules and documentation remain in the artifact
manifest; no shipped file was added. These are the requested functional checks;
full CI and performance qualification are not claimed.

### Round-3 changed-file cross-check

Route one: `git diff --name-only -z` plus
`git ls-files --others --exclude-standard -z`. Route two:
`git status --porcelain=v1 -z`. Independently sorted lists match exactly;
`diff -u` exited **0**, with **3 files**. No commit was created.

- `core/context-product-reader.mjs`
- `core/test/context-read-product-control.test.mjs`
- `docs/plans/context-read-p2a-impl.md`

## Fix round 4

Scope: the three ordinary-path P1 findings against `e5df5afd`. Earlier fixes,
the frozen v1.1 contract and the generated bundle are unchanged.

### Journal probe observation and mapping

The product-only child program emits a bounded transcript with begin/outcome
records for SQLite open, prepare, execute and close. The Worker reserves an
in-flight coverage marker before synchronous child dispatch, then imports every
returned native outcome into the selected operation's shared telemetry frame
before public mapping. The child cannot share the Worker's shared buffer: a
termination before transcript import therefore leaves incomplete coverage,
never a complete zero-busy claim. Missing, malformed, interrupted or unknown
outcomes set the existing overflow/lost-outcome marker; a begun call without an
outcome remains unmatched. Already returned BUSY/LOCKED outcomes survive an
incomplete transcript. A verified fingerprint-cache hit explicitly reports no
native work, so it adds no native calls.

The closed enums have no dedicated probe value. Use existing stages `open`,
`prepare`, `execute`, `close`, with `connection` for open/close and
`journal_mode` for prepare/execute. No public enum extension or contract edit.
Native primary/extended codes remain exclusively in supervisor diagnostics.
BUSY and LOCKED families, including extended BUSY_RECOVERY 261, map to
retryable `storage_busy`; NOMEM 7, IOERR 10 and other ordinary native failures
map to nonretryable `storage_error`, matching the legacy reader mapping.
Existing query-policy signals retain their refusal/validation route: CANTOPEN
14 from nolock journal querying identifies WAL and remains `index_unavailable`
for this DELETE-only profile; READONLY/CORRUPT/NOTADB continue ordinary canonical
validation. Their native failures are still recorded. The legacy child program,
return shape, failure handling and fingerprint caching remain unchanged.

### Authority ordering and native opening failures

Product opening uses the existing metadata-only physical-layout/version
attestation and skips legacy `validateExistingStore`. Full-store role-profile
and dependency content attestation is unnecessary for P2a bootstrap. Existing
namespace-scoped Card dependency/currentness reads remain behind the entry
authority sample. Legacy openers retain full-store validation.

The Worker maps native exceptions from opening with the same primary-code
mapping as the legacy reader, before applying the product error allowlist.
Numeric native diagnostics have already been committed by the observer.
The mapping is SQLite-free at link time and also handles native preflight
exceptions on subsequent operations. It applies with diagnostics disabled.

### Deterministic regression coverage

- `core/test/context-read-product.test.mjs`: real Worker injections for codes
  5, 261, 6, 7 and 10 at native open/configure/prepare and child probe
  open/prepare/execute/close. Assert the returned error/retryable envelope,
  supervised cleanup, native stage/statement, primary/extended codes, failure
  and BUSY counts, and exact probe call counts. Native instrumentation on v32
  and v33 verifies zero content-table executions before the first `isCurrent`,
  actual metadata work during opening, and content work after entry. Missing,
  unknown and lost-close probe transcripts cannot seal complete. Also cover
  disabled diagnostics and checkpointed WAL's retained refusal.
- `core/test/context-read-product-control.test.mjs`: synthetic interruption
  verifies the pre-dispatch coverage reservation; an incomplete transcript
  retains BUSY_RECOVERY and an unmatched close. A complete probe counts four
  native calls and an acknowledged cache hit adds none.
- `core/test/sqlite-journal-probe.test.mjs`: the five injected codes retain the
  original legacy probe result and `index_unavailable` refusal.
- `core/test/fixtures/context-product-opening-worker.mjs`: test-only synchronous
  module hook installs synthetic native instrumentation before the actual
  product Worker loads; no production fault hook or shipped module is added.

No sleeps, elapsed-time assertions or new timing gates are introduced.

### Round-4 verification results

Each row below was run as `node <explicit test path>`, sequentially. The runner
verified the exact executable version before dispatch and captured every
child return code directly; no pipeline status or stdout tail was used to infer
success. The Node 22 inventory was independently derived by filesystem glob
and `rg --files`, then compared: **44 test paths**.

Development-only runs exposed test instrumentation issues: SQLite named
exports do not follow `syncBuiltinESMExports` on Node 22, and `PRAGMA query_only`
is configuration metadata. Those fixture/expectation failures exited **1** and
were corrected before the final matrix. One redundant development product run
was deliberately stopped with exit **143**. The corrected focused regressions
exited **0**. The final results below supersede development runs.

Node **22.16.0**: **44 commands**, **729 passed**,
zero failed, cancelled or skipped; every command exited **0**.

| Explicit test path | Actual exit | Tests passed |
| --- | --- | --- |
| `core/test/context-read-assembly-races.test.mjs` | 0 | 7 |
| `core/test/context-read-assembly-readonly.test.mjs` | 0 | 28 |
| `core/test/context-read-assembly.test.mjs` | 0 | 20 |
| `core/test/context-read-bm25.test.mjs` | 0 | 3 |
| `core/test/context-read-budget.test.mjs` | 0 | 5 |
| `core/test/context-read-core.test.mjs` | 0 | 26 |
| `core/test/context-read-embedder.test.mjs` | 0 | 5 |
| `core/test/context-read-fusion.test.mjs` | 0 | 4 |
| `core/test/context-read-local-embedder.test.mjs` | 0 | 38 |
| `core/test/context-read-local-status.test.mjs` | 0 | 3 |
| `core/test/context-read-moc-source.test.mjs` | 0 | 15 |
| `core/test/context-read-process.test.mjs` | 0 | 1 |
| `core/test/context-read-product-artifact.test.mjs` | 0 | 1 |
| `core/test/context-read-product-control.test.mjs` | 0 | 83 |
| `core/test/context-read-product.test.mjs` | 0 | 126 |
| `core/test/context-read-recovery.test.mjs` | 0 | 10 |
| `core/test/context-read-review.test.mjs` | 0 | 10 |
| `core/test/context-read-sidecar.test.mjs` | 0 | 17 |
| `core/test/context-read-source-work.test.mjs` | 0 | 7 |
| `core/test/context-read-sources-authority.test.mjs` | 0 | 6 |
| `core/test/context-read-sources-bounds.test.mjs` | 0 | 5 |
| `core/test/context-read-sources-races.test.mjs` | 0 | 16 |
| `core/test/context-read-sources.test.mjs` | 0 | 14 |
| `core/test/context-read-tokenize.test.mjs` | 0 | 2 |
| `core/test/no-raw-db-fd.test.mjs` | 0 | 5 |
| `core/test/sqlite-journal-probe.test.mjs` | 0 | 19 |
| `core/test/sqlite-lock-safety.test.mjs` | 0 | 15 |
| `core/test/topic-members-bounds.test.mjs` | 0 | 7 |
| `core/test/topic-members-compatibility.test.mjs` | 0 | 32 |
| `core/test/topic-members-integration.test.mjs` | 0 | 1 |
| `core/test/topic-members-mutations.test.mjs` | 0 | 20 |
| `core/test/topic-members-primary.test.mjs` | 0 | 26 |
| `core/test/topic-members-recheck-findings.test.mjs` | 0 | 33 |
| `core/test/topic-members-review-findings.test.mjs` | 0 | 7 |
| `core/test/topic-members-round3-findings.test.mjs` | 0 | 18 |
| `core/test/topic-members-scale.test.mjs` | 0 | 2 |
| `core/test/topic-members-visibility.test.mjs` | 0 | 10 |
| `core/test/topic-members.test.mjs` | 0 | 10 |
| `core/test/topic-overview-lifecycle.test.mjs` | 0 | 11 |
| `core/test/topic-overview-raw29.test.mjs` | 0 | 22 |
| `core/test/topic-overview-visibility.test.mjs` | 0 | 8 |
| `core/test/topic-overview.test.mjs` | 0 | 4 |
| `core/test/topic-reader-cancellation.test.mjs` | 0 | 6 |
| `core/test/topic-reader-sqlite.test.mjs` | 0 | 21 |

Node **24.22.1**: **5 commands**, **248 passed**,
zero failed, cancelled or skipped; every command exited **0**.

| Explicit test path | Actual exit | Tests passed |
| --- | --- | --- |
| `core/test/context-read-product-control.test.mjs` | 0 | 83 |
| `core/test/context-read-product.test.mjs` | 0 | 126 |
| `core/test/sqlite-lock-safety.test.mjs` | 0 | 15 |
| `core/test/sqlite-journal-probe.test.mjs` | 0 | 19 |
| `core/test/no-raw-db-fd.test.mjs` | 0 | 5 |

The sequential runner exited **0**. The Node 24 selection includes the
requested control/product/lock suites and repeats the journal probe and raw-fd
checks. No broad npm suite, network access, key access or bundle generation was
used. These are functional checks, not performance qualification.

### Round-4 changed-file cross-check

`git diff --name-only -z` plus untracked `git ls-files` and the independent
`git status --porcelain=v1 -z` route match exactly: **11 files**; the
list diff exits **0**. The list below is generated from those results.

- `core/context-product-telemetry.mjs`
- `core/context-product-worker.mjs`
- `core/context-read-facade.mjs`
- `core/context-read-sidecar.mjs`
- `core/read-database.mjs`
- `core/sqlite-journal-probe.mjs`
- `core/test/context-read-product-control.test.mjs`
- `core/test/context-read-product.test.mjs`
- `core/test/fixtures/context-product-opening-worker.mjs`
- `core/test/sqlite-journal-probe.test.mjs`
- `docs/plans/context-read-p2a-impl.md`

Syntax checks for every changed JavaScript file exited **0**. Whitespace and
final-newline checks include the untracked fixture; `git diff --check` exits
**0**. All seven changed shipped runtime/document files already belong to
`packaging/artifact-files.json`; the new fixture is test-only. The frozen
contract is unchanged, the bundle is unchanged, and no commit was created.
