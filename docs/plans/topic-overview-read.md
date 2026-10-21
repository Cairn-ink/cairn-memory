# Bounded topic overview (E-1)

Status: implementation and local acceptance complete; fixed-candidate review
and remote delivery gates are tracked in the PR.
Fixed base: cd6d1ad32ac3d6f5926c6846e8c6d27645bb7c9a (current main).
Worktree: /home/chichieh/Github/cairn-memory-worktrees/topic-overview-read.
Branch: feat/topic-overview-read. Primary owns planning/integration/acceptance;
one bounded GPT6.1Sol/high author owns diagnostic harness and later approved
implementation. Separate non-author fixed-candidate reviews remain required.

## Report and priority

Product issue wsxqaza12/cairn-wiki#453, comments6285922802 (original E-1) and
6313060464 (2026-10-21 urgent performance report), requests a generic model-free
topic metadata port rather than product-side private-table reads. The report
attributes roughly33seconds of synchronous CPU to core.map on a synthetic
1,112Memory/four-namespace/71-MOC world; the production feature is reportedly
off. These are product-team measurements, not yet primary reproductions.
Acknowledgement/request for the synthetic harness: comment6313275124.

Keep production/flags, credentials, user stores and product pin untouched. This
branch is independent of the default-off Raw dependency stack; it must not
require merging or enabling Raw to address the product's read bottleneck.
Finish Raw B1's already frozen verification/review, but prioritize confirmed
E-1 read blocking over further Raw installation work. Preserve B2a's separate
skipped-tail reproductions/plan rather than merging unrelated runtime changes.

## First bounded packet: reproducible diagnostic loop

Use only new owned synthetic stores, no real transcript, production snapshot,
provider/model request or product execution. Build an agent-runnable failing
command at the actual public map call path, measuring exact token-call counts,
total CPU/wall time and maximum uninterrupted main-loop turn. Repeat/minimize
before changing runtime or selecting a fix. Do not infer production causality
from a guessed nearby failure. Existing source inspection is for fixture/API
construction until the loop is red; generate multiple falsifiable hypotheses
and vary one condition at a time afterward.

Allowed diagnostic files: only under
/tmp/cairn-e1-overview-evidence.3fXetL; primary owns this tracked plan. Runtime,
tests, package/CI, product and other worktrees stay read-only until the concrete
implementation contract is approved by primary. Reuse the owned runner and
immediate deferred resource cleanup. Retain exact commands, actual exits and
red/green observations. The full-size baseline may take tens of seconds; the
minimized deterministic structural regression must be faster. Profile only
synthetic text. Check in no machine-local profiler output or source data.

## Product acceptance to resolve into the implementation contract

- Public exact-owner/namespace-bound L1/L2 metadata, ID/revision/title, direct
  and unique descendant counts by kind, namespace unique/unfiled totals and
  latest-member time. Optional member IDs off by default; no Memory body.
- Visible current revisions only. Title visibility respects source/review and
  forgetting boundaries. Deduplicate multi-filing, do not treat partial unknown
  counts as exact zero. Bind output/cursor to one index/generation snapshot.
- Explicit node/byte/work bounds, opaque continuation and typed stale refusal;
  no countTokens, mapPage, mapRows or full inspect scan in the new port.
- Short readonly snapshot; current-version opener does not reserve a writer.
  No main-thread five-second busy wait or host-wide serialization. If bounded
  work cannot guarantee responsive calls, select an async public seam rather
  than hiding blocking work behind a Promise.
- Synthetic cold/warm/revision-change cases at the reported scale and a larger
  multi-filing case. Target main-loop maximum100ms per request, measured rather
  than promised. Concurrent unrelated-owner read/write and an in-flight capture
  must preserve existing behavior and paid-work publication semantics.
- Distinguish the requested E-1 topic overview from coordinated extensions:
  bounded member-ID pages/selected-ref topic locations and E-7 episode headers.
  Decide the minimal necessary extension explicitly; no claim all are original
  E-1 scope or already implemented.

Final contract will name API shapes, allowed files, observable requirement IDs,
negative visibility/ownership cases, frozen performance fixtures and required
Node22.16/24.15, installed-artifact, concurrency, dual-review and latest-head CI
gates. No merge, publication, deployment or pin update is authorized here.

## Reproduced baseline and ranked diagnostic checkpoint

Diagnostic author: /root/topic_overview61, actual GPT6.1Sol/high. The frozen
public-path oracle is map-oracle.mjs in the evidence directory, SHA256
a2cbda796729e21c210c9824833a03fdbddc4415cae078158d6d055e838ae5e7.
Invocation from this worktree on Node22.16:

```
TMPDIR=/tmp/cairn-e1-overview-evidence.3fXetL NODE_DISABLE_COMPILE_CACHE=1 node tools/testing/run.mjs --script /tmp/cairn-e1-overview-evidence.3fXetL/map-oracle.mjs 75 1 1 1 2
```

It creates an owned store through actual public admit/applyPlacement, then
drives root map exactly as the product does (limit100/tokenBudget4000, no
parentRef). Generation methods throw. Native o200k_base encoding times1.15
matches the host counter semantics; it excludes host timing-wrapper overhead.
Primary personally observes two red traversals247/237ms and single map
calls168/161ms, actual exit1 against the100ms responsiveness bound. Worker
repeat75 remains red;50-Memory control is green, actual exit0. Fixture and
encoder construction are outside the read timer. Owned scratch is removed.
Early token-calls-per-page threshold probes were diagnostic harness drafts,
not a product contract; the corrected oracle gates actual responsiveness.

Before instrumentation, the ranked falsifiable hypotheses were shown to the
user: (1) overlapping decrement-by-one exact recount cost, predicted to fall
when capacity starts nearer the returned page size; (2) repeated namespace
assembly per map page, predicted to scale with namespace/returned pages even
without recount cost; (3) MOC/title-source/multifiling fanout, predicted to add
assembly cost at fixed memory count; (4) initialization/contention, predicted
to produce materially lower warm/isolated timings. Single-variable probes
retain returned-union hashes and distinguish completion from responsiveness.

The100-Memory same-fixture page-limit100 versus32 comparison retains exactly
the same returned union and four map calls. Exact counts fall131 to14,
token CPU386ms to16ms, wall451ms to74ms. This supports recount cost, not a
complete fix. At1,112 Memories/four equally sized namespaces/60 L1+11 L2,
one filing per Memory, full-limit profiled traversals take9,247/9,117ms,
40 pages and2,304 counters, max single map294ms. Profiles attribute about83%
to the counter and16% to mapRows. This is independently reproduced blocking,
NOT the product team's exact33second/62page/4,253counter/mapRows61.8% shape;
that synthetic harness remains requested from the product team.

A separate same-fixture1,112-Memory limit comparison retains all1,243 returned
items: limit100 wall8,994ms versus limit32 wall1,510ms, still40 map calls;
count calls2,312 versus93. Whole-traversal responsiveness still fails at1.5s.
The diagnostic controller exits0 to mean measurement completed; individual
responsiveness booleans are false. It is not a green performance gate.

Primary separately verifies the current-version opener under a synthetic
reserved SQLite writer: unchanged public open waits5,006.7ms then SQLITE_BUSY;
a native readonly/query_only/busy_timeout0 short snapshot succeeds0.8ms.
Database bytes are unchanged. primary-read-opener-baseline.mjs and its22.log
retain this expected-existing-failure experiment, actual exit0 and no owned
residue. The native read probe is feasibility only, not the delivered port.

The current schema has no placement-added timestamp on Memory refs or MOC
edges. Do not relabel MOC.updated_at or Memory.created_at as lastMemberAddedAt.
The implementation contract must state any unavailable timestamp explicitly
and coordinate it with product; no retrospective timestamp fabrication or
unrequested schema migration. Legacy model-facing map is not promised to
become a UI overview: replacing the product caller is a later product-owned
integration, so engine delivery alone cannot declare the production incident
resolved or authorize turning its flag on.

The final single-variable filing probe holds1,112 Memories/four namespaces/
71 MOCs and limit32 fixed. One to three filings per Memory grows40 to112
map pages and sampled mapRows time1.39s to4.36s; wall1.51s to4.76s. This
supports membership/page amplification, not the product's exact title-source
profile. All measured-only profiler runs complete with actual exit0; none is
a passing responsiveness result. Node enumeration and find independently
confirm zero retained workspace directories/SQLite files. Stop extending
diagnostics here and implement the bounded metadata seam below.

## E1-A implementation decision and public contract

The primary selects a real asynchronous, owner-bound, read-only port in the
same engine. Do not optimize or silently change model-facing map in this
packet. Native work belongs in a fixed internal Worker, not Promise-wrapped
main-thread SQLite. No new npm dependency, separate index/database, persisted
cache, schema migration, global mutex or changed write/admission gate.

Public export from core/index.mjs:

```
const reader = openMemoryReader({ path, ownerId });
const result = await reader.readTopicOverview({
  namespace, nodeLimit: 100, maxBytes: 65536, workLimit: 5000,
  memberLimit: 0, cursor,
});
await reader.close();
```

- Constructor is synchronous validation only; lazily start the fixed worker
  on the first async read. Options/requests must be plain own-data objects,
  rejecting unknown names, symbols and accessors without invoking getters.
  Use existing well-formed identifier rules. namespace is the existing exact
  ownerId/scope/projectId shape and must match the reader owner; no read-set
  expansion or host-authentication claim. The trusted host authenticates.
- Require an existing safely permissioned regular SQLite file. Reject memory
  databases, missing files, symlinks and unsupported schemas without creating,
  migrating or modifying them. Share the real application/schema identity,
  not guessed version ranges. Initial supported layouts are the main branch's
  current18/20/21/22/23; future Raw schema support is a separate integration
  check, not implicit compatibility. No changes to the ordinary write opener.
- Bounds: nodeLimit1..100 (default100), maxBytes4096..262144(default65536),
  workLimit16..50000(default5000), memberLimit0..10(default0). They bind the
  continuation. Byte bound covers the complete UTF-8 result envelope including
  cursor. Node limit bounds each returned page, not an unbounded query scan.
- Success uses the existing ok/value envelope. value includes snapshot
  {indexRevision,generation}, items, totals, coverage and nextCursor.
  generation is null for the live pre-rebuild projection; a declared but
  unavailable generation returns index_unavailable. Each item has id,
  revision, level, title (nullable after the existing source guard), parentIds,
  directCounts and descendantCounts ({total,byKind} for the existing five
  Memory kinds), latestMemberCreatedAt, lastMemberAddedAt:null and
  addedAtCoverage:'not_recorded'. Include memberRefs only when memberLimit>0;
  refs contain memoryId/revision, first K unique members in ascending Memory ID.
  This is Memory MOC metadata, not authored Card MOCs or episode headers.
- L1 direct and descendant Memory counts match. L2 direct Memory count is
  exactly0 (its direct children are topics); descendants are unique current
  Memories across all valid child L1s. parentIds expresses valid L2→L1 edges;
  ordering is L2 then L1, then binary ID. Totals contain unique and unfiled
  {total,byKind}; a current visible Memory with no valid projected L1 placement
  is unfiled, regardless of a stale filing_status flag.
- latestMemberCreatedAt means the largest creation time among currently
  visible members, not placement time, last edit or ingest-event time. Never
  synthesize lastMemberAddedAt. Product receives this explicit capability gap;
  adding historical placement timestamps is not part of the urgent read fix.
- While bounded aggregation is incomplete, return items:[], totals:null,
  coverage {complete:false,countsComplete:false,reason:'work_limit'}, plus
  opaque continuation. Do not send partial exact counts or provisional titles.
  Once aggregation finishes, page exact nodes/totals with countsComplete:true;
  coverage.complete is true only on the final emitted page. Bound-triggered
  incomplete coverage uses reason node_limit, byte_limit or state_limit as
  appropriate. Empty fully read namespaces have exact zero totals.

### Progress, visibility and resource rules

The reader may keep one ephemeral overview traversal at a time, inside its
worker. It is not a durable index. A fresh request without a cursor starts a
new traversal and invalidates older cursors. Bind opaque random continuation
identity and sequence to store identity, owner, exact namespace, index epoch,
active generation and all request bounds. Last-page replay on an unchanged
snapshot is idempotent; consumed older sequences, changed snapshots or lost
reader state return cursor_stale. Malformed cursors return invalid_cursor.
Reopen/restart does not silently rebuild or continue an old traversal.

At most one read is in flight per reader; a second concurrent call returns
read_in_progress without a queue. This never gates other readers, owners or
ordinary core reads/writes. close cancels/settles in-flight work, actually
closes/terminates the worker and permits no future read (store_closed).
Worker failures/deadlines settle finite safe codes, not leaked raw errors,
source text, paths or SQL. No hidden retry. Hard request deadline5seconds;
idle worker expiry60seconds, unref'ed timer, makes continuation stale.
Use fixed worker code, empty application environment, no inherited execArgv,
no model/counter/network import. Explicit bounded worker state (8MiB logical
metadata budget) and a64MiB V8 old-generation limit supplement, not replace,
physical work bounds. State overflow returns explicit incomplete state_limit
without bogus counts and without an endlessly repeating continuation.

Read-only connection uses native readOnly plus query_only, trusted_schema off
and busy_timeout0. No BEGIN IMMEDIATE, schema install, PRAGMA journal-mode
change, filesystem consent write or retention sweep. A short deferred BEGIN
snapshot covers each bounded quantum: at most64 physical work units or5ms
between units, commit before yielding. Validate captured epoch/generation
at each quantum and before emission. Native indexed point operations may
exceed a quantum under OS contention; the worker protects the main loop,
while measured lock/concurrency tests remain required. Missing/malformed
expected indices fail safely, not an unnoticed full-scan fallback.

Recommended minimal scan: namespace-keyset MOCs and all original title-source
bindings; indexed edges rooted at selected namespace topics; namespace-keyset
Memories and their memory_moc_refs. Filter only after charging bounded physical
visits. Validate exact owner/revisions/currentness/review and active-generation
membership. Do not fetch Memory.content, receipts, Raw, Cards or inspect every
Memory. Accumulate L1 counts and deduplicate a Memory's L2 ancestors before
counting it, then discard that per-Memory set; avoid an unbounded set of every
Memory per topic. Any internal alternative must preserve this observable work
bound and report its exact unit before implementation, not hide aggregation
under SELECT COUNT/DISTINCT with a final LIMIT. Titles are visible only if
every original binding is present/current/same-namespace/non-awaiting and at
its bound revision. Partial title validation never releases title text.

### Allowed implementation and tests

One author (/root/topic_overview61, GPT6.1Sol/high) owns:

- New focused core/memory-reader.mjs, core/topic-overview-worker.mjs,
  core/topic-overview-storage.mjs, core/topic-overview-input.mjs and
  core/read-database.mjs as needed; no universal query framework.
- core/index.mjs export; core/database.mjs only shared identity/version
  constants or a narrowly shared read-only opener helper, with ordinary
  write semantics unchanged. Report another required path before editing.
- New core/test/topic-overview*.test.mjs and dedicated synthetic fixture
  under core/testing/; tracked tests own worker/DB teardown on failure too.
- packaging/artifact-files.json, one new installed topic-overview test and
  its dedicated fixture. Archive must contain the actual Worker closure and
  execute from installed bytes without source-tree fallback.
- docs/topic-overview.md, minimal docs/architecture.md, docs/local-store.md,
  docs/install-artifact.md, docs/limitations.md, CHANGELOG.md.
- Optional small examples/topic-overview.mjs plus its exact package.json/CI
  demo wiring if it adds usable public evidence; no unrelated CI rewrite.

Primary owns this plan, cross-packet integration, independent acceptance,
fixed-candidate reviews and delivery. No write to product, Raw worktrees,
main checkout, dependencies or any user data. Diagnostic files remain in the
clearly identified evidence directory; no profiler dumps enter the repo.

## E1-A observable acceptance and handoff

| ID | Pass condition |
| --- | --- |
| E1-01 | Public installed owner-bound async reader; malformed options/getters/cross-owner fail before DB access, no model/counter/mapRows/full inspect/content read, default memberRefs absent. |
| E1-02 | Synthetic hand-counted hierarchy, multi-filing and multiple kinds give exact direct/unique descendant and namespace/unfiled counts; stable order and opt-in first-K refs; timestamp gap stays explicit. |
| E1-03 | Forgotten/superseded/awaiting/stale-revision/foreign/generation-excluded members cannot affect output or reveal titles. Incomplete/active rebuild semantics and ordinary empty namespace differ correctly. |
| E1-04 | Tiny work/node/byte caps give bounded progress, no false zero or unbounded aggregation; unchanged cursor replay is idempotent, tamper/wrong scope/bounds/store/restart/revision change refuse safely. State overflow is finite and honest. |
| E1-05 | Existing-file read does not create/migrate or reserve a writer. Read during reserved writer succeeds when SQLite permits; exclusive contention returns promptly. Concurrent other-owner write/read and already-admitted waiting capture still finish correctly; no new global gate or delayed paid-work rejection. |
| E1-06 | Cold/warm/revision-change tests at1,112/four/71 and a larger3,336-memory/multifiling fixture measure main-loop max<=100ms per request, zero tokenizer/mapRows/inspect and bounded work. Record full latency separately: aim<=1s for complete1,112-Memory metadata traversal, investigate slower rather than hiding it behind async. |
| E1-07 | close/cancel/timeout/worker failure/idle expiry settle all promises and remove owned workers/DB/temp state on success and failure. Missing/old/unsafe stores remain unchanged. Read handles do not retain snapshots between calls. |
| E1-08 | Installed private-archive lifecycle and independent module/asset manifest agree; Node22.16/24.15 affected core/generic/MCP/artifact/validation/demo gates, primary reruns, fixed-commit nonauthor dual review and latest-head CI all pass before ready/unmerged. |

Implementation checkpoints: public shape plus red semantic/worker tests;
bounded read/visibility; concurrency/resource negatives; scaled measurements;
frozen affected matrix. Report any contradiction immediately and at least
one substantive checkpoint per20minutes. After two unsuccessful correction
rounds, primary re-scopes. Performance measurements run serially away from
heavy tests; root owns scheduling. No paid/live benchmark is needed or allowed.

The legacy map oracle remains a retained diagnosis of the old caller. Final
acceptance drives the equivalent metadata request through the new public port;
it must not claim old map now meets this UI budget. Product integration and
production re-enable remain separate, with the exact ready PR/SHA documented
in named issue453. Partial E-1 limitations and member-page/location/E-7 work
stay explicit rather than declaring all product capabilities finished.

Implementation reference: Node22.16 official SQLite readOnly option and Worker
thread lifecycle/resource-limit documentation, checked against the minimum
supported runtime: https://nodejs.org/download/release/v22.16.0/docs/api/sqlite.html
and https://nodejs.org/download/release/v22.16.0/docs/api/worker_threads.html .

## First implementation checkpoint (2026-10-21)

The bounded author's first public suite is3/3, actual exit0 on Node22.16.
Primary independently authors an external acceptance harness rather than
counting the author's report as acceptance. Its export-only pre-implementation
baseline exits1. The first full run is5/7, exit1: the harness wrongly treated
admit's ID/revision receipt as a full Memory for the unfiled instruction's kind.
Inspecting the actual public contract identifies that fixture defect; fetching
the stored record through core.get corrects the precondition without changing
runtime or relaxing an assertion. The corrected7/7 run exits0; both logs remain.

Primary expands this to10 public cases: hand-counted multifiling/kind totals,
source-title correction/forgetting, read-only reserved/exclusive contention,
strict inputs and cursor boundaries, first/staged/published/replacement index
generations, already-admitted capture waiting in a scripted classifier while
metadata reads and another owner write complete, and actual worker close plus
mock-clock deadline/idle expiry. All10 pass, actual exit0 on Node22.16, in
primary-overview-extended22.log. This is an unfrozen implementation checkpoint,
not final-candidate evidence, installed verification or a performance claim.

The primary-scale.mjs fixture is frozen before measuring the implementation:
SHA2569594e762e354e37ba23c8d169fb3c69a04036d834b9a3b8565fb714347807215.
It creates1,112 Memories/four namespaces/60 L1+11 L2 through public admission
and placement, then separately3,336 Memories with three filings each. Expected
unique/direct/descendant counts come from fixture memberships, not the reader.
Cold, warm and post-revision complete traversals assert exact counts, envelope
bounds and zero model/token-counter calls; they measure total latency and
main-loop gaps separately. Construction is outside the read timer. Only run
serially after the author reports a stable runtime checkpoint. The1second
full-traversal target is reported separately from the100ms main-loop gate;
neither threshold is silently redefined after observing results.

Initial serialized Node22.16 measurements on the frozen seven-file runtime
(author digestdf15619d0016da3d76e478d15c6d77a83bf1d9e98935d42b5fdfe2841163f7f2)
complete with actual exit0 for both commands:

| Synthetic fixture | Cold / warm / post-revision complete traversal | Largest measured main-loop gap | Pages per traversal |
| --- | --- | --- | --- |
| 1,112 / four namespaces / 71 topics / one filing | 44.00 / 10.94 / 11.43ms | 4.27ms | 4 |
| 3,336 / four namespaces / 71 topics / three filings | 80.81 / 39.89 / 43.94ms | 3.91ms | 8 |

All six traversals match independently computed exact counts, make zero model
or counter calls, and stay within the existing response bounds. Public fixture
construction takes18.44s/56.43s and is excluded from the read timer. These are
metadata-overview measurements, not legacy map/semantic-recall accuracy or a
production latency guarantee. The logs primary-scale1112-22.log and
primary-scale3336-22.log record owned workspace deletion; final-candidate and
second-runtime checks still remain. A namespace-key-order input correction
identified afterward must receive fresh affected evidence before delivery.

Product coordination: issue453 comment6313652604 records the new read seam,
the independently reproduced9second (not claimed33second) map baseline, and
the unavailable placement-added timestamp. Product flag/pin remain untouched.
The independent Raw B1 PR456 is ready/unmerged atcc9a91d, with both independent
reviews and31 latest-head CI checks passing; it is not an E1 dependency.

## Final author freeze and primary acceptance

The 20 author files are frozen at combined SHA256
`d5bedc6ae9c7b2d5d9a782788bd17e46d0b639cf17b912577ebf0731f107f122`.
Primary independently derives 21 total changed paths (including this plan)
using Git diff/untracked and base-tree versus filesystem blob/mode comparison;
both lists agree, and all 20 author hashes match the primary inventory and
actual files. This includes the namespace-key-order correction and the final
state-limit/installed tests. No optional example or CI/dependency change.

The author reports 24/24 focused core and installed tests, actual exit 0.
Primary then repeats its independent ten public cases and installed ten-case
child on both Node versions against these frozen bytes: all four commands
exit 0; each source/installed child reports 10/10, and each installed wrapper
reports 1/1. An independently walked import/Worker/asset closure and the
inspected archive intersect at exactly 95 files, with every installed file
matching archive/source hashes. The private artifact SHA256 is
`3e8eb212cf42bc9083fa0f240d57809a19ec38f2ee8bdb2d44144531ad4faa13`.
No actual host integration or semantic-model quality is claimed.

The unchanged frozen scale harness is rerun serially on final author bytes:

| Node | Memories / filings | Cold / warm / post-revision complete read | Largest loop gap | Pages |
| --- | --- | --- | --- | --- |
| 22.16 | 1,112 / one | 49.43 / 10.28 / 10.47ms | 4.85ms | 4 |
| 22.16 | 3,336 / three | 81.05 / 41.15 / 44.28ms | 2.85ms | 8 |
| 24.15 | 1,112 / one | 47.74 / 10.77 / 11.60ms | 2.79ms | 4 |
| 24.15 | 3,336 / three | 86.86 / 41.44 / 40.18ms | 6.38ms | 8 |

All four commands exit 0. Every traversal verifies independently hand-derived
membership counts, response bounds, snapshot behavior and zero model/counter
calls. Fixture construction is excluded (about18.4s/56.6s), not hidden in read
latency. All owned stores/workspaces are removed. Logs are
`primary-final-scale1112-{22,24}.log` and
`primary-final-scale3336-{22,24}.log` in the evidence directory. Primary
public/installed logs are `primary-final-{overview,installed}-{22.16.0,24.15.0}.log`.
These metadata-only local measurements neither fix the old map caller nor
authorize a production flag/pin update. Full affected matrix, committed
independent review and latest-head CI remain required before delivery.

### Full serial regression record

The frozen author matrix completes all22 unique commands (11 per runtime),
each actual exit0 and no termination signal. On both Node22.16 and24.15:
core1223/1223, MCP125/125, artifact95passed with one explicitly native-Windows-
only skip out of96, and generic635/635. JSON validation, store/MOC/rebuild
demos, pinned native marketplace/strict-plugin validation, generated client
bundle and setup-runtime parity all exit0. There is no typecheck gate in this
JavaScript repository. No test deadline is increased and no failing gate is
retried. Core takes443.03s/461.64s; its real held-lock regression cases explain
the long tail and were supervised through actual completed-case/log progress.

Primary independently parses all22 outcome records, checks distinct gate/runtime
pairs, requires code0/signalnull/no interruption, and compares before/after
frozen hashes. Every post-gate workspace contains only its expected owned home;
the supervisor's final owned workspace is removed and independently absent.
The verification command itself exits0. Evidence is retained in
`author-matrix-{before,after,report}.json`, `author-matrix-results.jsonl` and
the per-command logs. The old d5bedc manifest remains attached to this matrix;
any subsequent fixture-only cleanup correction has separate hashes and tests.

The primary identified three lifecycle-test SQLite handles that closed only
after fallible SQL calls. Immediate try/finally ownership is required even on
setup failure; this is a fixture cleanup correction, not a runtime change or a
reason to discard the passing full-matrix record. The corrected focused suite,
new freeze and final committed primary reruns are recorded separately below.

The cleanup-only correction changes one of20 author files, the lifecycle test,
and leaves all seven runtime files and the other19 author files unchanged.
The new immutable author freeze is
`67975000f8f19ab1550dfb49d605b7ee590cf9cc5bc726bca0554c972adeba87`.
The author repeats the focused24 cases on each runtime, actual exits0.
Primary independently checks the three try/finally changes and the complete
manifest, then reruns its public plus installed acceptance together on both
Node22.16 and24.15:11/11 top-level cases each (the installed wrapper also runs
the ten public cases in a fresh child), actual exits0. Logs are
`primary-cleanup-combined22.log` and `primary-cleanup-combined24.log`.
Owned resource enumeration reports no remaining test directories or SQLite
stores. Prior matrix evidence and the original failing fixture logs remain
separate; no runtime or performance result is silently relabelled.

### Routing and fixed-candidate delivery

Implementation is owned by `topic_overview61`, actual GPT6.1Sol/high; primary
owns the plan, independent public/installed/scale fixtures, inspection and
integration acceptance. This follows the user's6.1Sol choice for Sol work.
Primary requested the namespace-key-order correction and immediate lifecycle
fixture cleanup; neither changes the scope or requires ownership escalation.
Runtime billing/token figures are unavailable and are not inferred.

The scoped candidate will be committed only after the independently derived
21-path inventory agrees with the actual frozen files. Primary repeats the
affected acceptance on that commit. Two separate nonauthor GPT6.1Sol/high
agents then review the same base `cd6d1ad32ac3d6f5926c6846e8c6d27645bb7c9a`
and fixed candidate along Standards and Spec axes. Exact commit/reports and
latest-head CI are recorded in the PR rather than creating a self-referential
commit hash here. Any correction requires fresh affected checks and both
reviews; push/open is draft until every applicable latest-head check passes
and mergeability is confirmed. Delivery remains ready/unmerged, with product
integration, schema24–28 compatibility and real user data explicitly outside
this packet.
