# Topic overview on the local Raw schema

Status: bounded integration implemented; local gates passed; committed acceptance,
independent reviews and latest-head CI remain delivery gates. Not released.
Fixed base: f6acccf8f89c31fb61e05197428048f1847a1d59, installed-lifecycle packet.
Independent source: ready PR #457, commit
`3ae5bc1d40ae611293cd42edaab14bf1252e55ae`.
Branch/worktree: `feat/topic-overview-raw29` /
`cairn-memory-worktrees/topic-overview-raw29`.
Target main; dependent stack remains unmerged.

## Outcome and boundary

Bring the reviewed, model-free Memory MOC overview into the same Raw / Memory /
authored Card engine. Add exact schema29 reader compatibility, not a second
database, new retrieval algorithm, general migration, Card-MOC overview or
product-side engine. Existing model-facing map semantics do not change.
The public API and bounds from the original E1 contract remain unchanged.

Only synthetic local data, tests and PR delivery are authorized. No real
transcripts/configuration/store/keys, paid calls, native-client activation,
product pins/flags, operational migrations, merge, release or deployment.
Read-only engine compatibility does not close product joint acceptance/G1/G2/H6.

## Existing evidence and integration risk

Primary has independently created real schema18 and29 synthetic stores using
the Raw public core, then invoked the original #457 reader on both Node versions.
18 succeeds;29 returns unsupported_database; main DB hashes are unchanged and
scratch removed. The probe exits0 to mean the expected boundary was reproduced,
not that compatibility passed. Evidence is next-reader-schema-probe.mjs under
/tmp/cairn-installed-lifecycle-evidence.UNo3zn.

Read-only author audit independently compares diff and full trees: #457 has21
changed paths, current Raw parent has232 before the installed-lifecycle packet.
Thirteen #457 paths are absent from Raw. Preserve overlapping Raw content in
core/database.mjs, the artifact manifest, CHANGELOG and architecture/install/
limitations docs; core/index.mjs and local-store docs also require inspection.

Nine installed capture test walkers assume all statically reachable URL modules
are eagerly observed. The exported reader eagerly loads memory-reader and input,
but read-database, topic-overview-storage and topic-overview-worker are reached
only through a literal Worker edge. Do not weaken exact runtime tracing into
a subset assertion or hide missing files with filename exceptions.

Use one test-only closure helper that returns required/eager/lazy/workerEntries.
Follow all imports/assets for archive coverage; distinguish literal Worker
edges for eager reachability. Eager reachability wins for shared dependencies.
Keep complete required-closure archive/hash checks, exact observed=eager checks,
installed-only fallback guards and separate actual installed Worker execution.
Include small synthetic graph tests (shared dependencies, missing files,
out-of-root paths and a Worker-only asset) so the helper is not its own oracle.

## Ownership and allowed paths

Primary owns this plan, the checkpoint in raw-local-v1-completion.md, independent
acceptance, integration choices and delivery. One actual GPT-6.1 Sol/high worker
owns the bounded implementation. No alternative agent or simultaneous writer.

- Selectively port the21 reviewed #457 paths, including its historical plan.
  Preserve its historical results as such; do not relabel them schema29 results.
- Minimal runtime delta from #457: exported APPLICATION_ID and exact
  READ_SCHEMA_VERSIONS =18/20/21/22/23/29 using current constants. Do not accept
  ranges or implicitly support24–28. No ordinary writer behavior change.
- Add focused core schema29 tests/fixture under core/test and core/testing;
  add installed schema29 reader test/fixture under packaging/test.
- New packaging/test/fixtures/installed-import-closure.mjs and focused helper test.
- Adjust only the9 affected closure callers:
  packaging/test/{local-oneshot,local-transport,local-worker,local-host,
  local-host-rearm,qualified-duplicates,raw-conversations,local-authority}.test.mjs
  and packaging/test/fixtures/raw-installed-lifecycle.mjs.
- Bounded docs/topic-overview.md, limitations, architecture/install/local-store
  and CHANGELOG updates. Manifest only the5 reviewed runtime modules.
- No package/lock/version/CI/dependency changes expected. Report any additional
  path or runtime algorithm change before editing.

## Observable acceptance

| ID | Pass condition |
| --- | --- |
| R29-01 | Real physical18/20/21/22/23 layouts still read; real29 reads. Create legacy layouts through the actual schema installers, not just relabelling one schema. Real24–28 and unknown versions refuse unchanged. Malformed consumed metadata/index layouts fail safely; this is not a full Raw-table integrity checker. |
| R29-02 | Actual public Raw capture creates Memory/receipt lineage in29; public placement builds a hand-counted hierarchy. Reader reports exact visible counts/member revisions/order; no Memory/receipt/Raw/Card-body sentinel leaks. No SQL-seeded Memory or relationship substitutes for this claim. |
| R29-03 | Correction, forget and real conversation deletion change fresh counts/title visibility and invalidate old continuation. A surviving independent receipt keeps its Memory while removed source text stays gone. Published/staging generation behavior matches the existing reader contract. No semantic-corroboration claim. |
| R29-04 | Quiescent DB and existing WAL bytes stay unchanged; missing DB is not created. Existing SHM can perform native read-mark coordination: retain a cold native-reader control, restrict the observed difference to documented read-mark bytes, and check full warmed-file equality. This corrects the original overbroad sidecar invariant with the retained diagnosis below, not a runtime behavior change. Reserved/exclusive writer tests and unrelated writer/capture progress preserve refusal/timing behavior. Do not mix concurrent writer mutations with reader-byte checks. |
| R29-05 | Required archive closure is complete and hashed; eager observed closure remains exact in all9 affected callers. Actual installed reader uses the fixed installed Worker with empty app environment/execArgv and closes it. New helper negatives prove it cannot silently suppress missing eager files. |
| R29-06 | Source/installed tests and bounded resource/continuation/owner-isolation regressions pass both22.16 and24.15. Owned cleanup and actual process exits are checked on success/failure; no real network/provider. |
| R29-07 | Serial schema29 scale measurements separately record full latency and main-loop responsiveness at the existing1,112/four/71 and3,336 multifiling fixtures. Retain100ms main-loop bound and1s complete1112 target; construction excluded and separately recorded. Do not loosen after seeing results or claim production latency. |

Legacy and schema29 visibility are explicit variants, not new inferred product
capabilities. Memory-only metadata remains distinct from authored Card MOCs,
member-ID pages, selected-reference locations and episode headers.

## Gates and delivery

Before runtime changes, independently reproduce29 refusal and the eager/lazy
graph mismatch against the port-only baseline. Keep those results. No model
experiment is needed for this compatibility packet.

Worker performs focused source, helper and installed checks on both runtimes.
Primary personally runs separate public/installed acceptance and serial scale
fixtures. Then finite affected matrix on both runtimes: core, artifact, generic,
MCP, workspace lifecycle, JSON validation, store/MOC/rebuild demos and pinned
marketplace/strict-plugin validation. Read current package/CI and CONTRIBUTING
before freezing exact commands; no TypeScript gate exists. Add gates only for
actually changed seams and state why.

Freeze source/dependencies, derive changed paths via diff and independent
tree/filesystem comparison, commit scoped candidate, rerun meaningful acceptance
on that SHA, then separate nonauthor Standards/Spec review. Fix findings with
affected checks and fresh reviews. Push only reviewed candidate; supervise all
latest-head CI, verify merge-preview tree and mark ready without merging.
Update named product issue453 with exact PR/SHA and capability limits.

## Execution checkpoint, 2026-10-22

Parent PR #467 is ready/unmerged at the fixed base above. Primary verified all31
latest-head CI checks/four runs, matching merge-preview tree, dual nonauthor
review and both-node exact-commit installed acceptance. No merge/deployment.

One actual GPT-6.1 Sol/high worker selectively ported the21 #457 paths, preserving
overlapping Raw content. The13 added files match #457 byte-for-byte; eight
overlapping paths contain only its signed deltas. No other runtime change has
yet occurred. Phase-A receipt is under /tmp/cairn-topic-raw29-author.sBtrJr.

Primary independently froze the port-only tree:22 changed paths including this
plan,1,869 source entries excluding only this plan,18 unchanged dependencies;
diff/untracked and complete tree/filesystem inventories agree. Source digest:
`23a19f7e38fa0185260682e32bd1b7c6780ea566d580074dc92f45488a112a58`.
Primary evidence directory: /tmp/cairn-topic-raw29-evidence.XkJsMa.

Both-node boundary probes preserve these results:

- Real18 succeeds; real29 returns unsupported_database; DB unchanged, cleanup,
  actual exits0. This is expected-boundary evidence, not compatibility passing.
- Unchanged installed one-shot suite:2/2 fail on each Node, actual exits1.
  The only three missing observed imports in each case are read-database,
  topic-overview-storage and topic-overview-worker. They are present in the
  installed required archive but legitimately lazy. No application defect is
  inferred from that old eager-only test assumption.
- Primary's three independently authored actual-capture cases each reach their
  first reader call, then fail exactly unsupported_database on both Nodes,
  actual exits1. Captures/lineage/authored-Card preconditions passed before that
  boundary; later mutation assertions have not yet executed and are not passed.
- Both baseline supervisors and independent verifiers exit0 because their frozen
  expected outcomes were observed; source stayed fixed and owned scratch was
  removed. Test failure counts remain failure counts, never relabelled passes.

Primary also authored ten schema29 metadata regressions, a thirteen-case installed
wrapper and serial1112/3336 scale probes before Phase B. Scale uses actual29 plus
public explicit admission/placement, not Raw extraction throughput. Capture
provenance belongs to the separate three-case fixture. Both keep their distinct
coverage and synthetic/model-free limitations.

### Early compatibility checkpoint (not final candidate acceptance)

After the minimal exact-version addition and test-only closure repair, the worker
paused all source edits. Primary froze 34 changed paths, 1,871 source entries and
18 dependency identities; source digest:
`848ade2c97d05fea1918dd471c5ba777ffc2334ccdccb319c2571ef06ccd021f`.
On both Node 22.16.0 and 24.15.0 the independent public suite passed 13/13 and
the installed wrapper passed 1/1 with its inner 13/13. All four commands and
the independent receipt/log/source verifier exited 0, with no signal, unchanged
source and owned scratch removed. No primary acceptance fixture was changed
between the preserved refusal baseline and this successful run.

This establishes the early schema29 compatibility/capture lifecycle seam, not
the final packet: the worker still has to complete the physical-version matrix
and focused installed cases; serial scale, full affected regressions, exact
committed acceptance and separate Standards/Spec review remain outstanding.
Evidence: primary-early-v1-{commands,freeze,report,verification}.json and the four
raw logs in the primary evidence directory above.

### Retained fixture failures and narrowed WAL invariant

The first new author source suite on Node22 did not complete: two deletion cases
assumed that one Memory/one topic would produce a continuation at workLimit16,
but that small traversal finished. The fixture must first establish a genuine
multi-node continuation; no cursor is manufactured and no runtime fix follows
from that failed precondition.

The same run's cold WAL-sidecar assertion failed and its large Buffer diff
exhausted the supervisor's 16MiB output buffer (child143/null, supervisor1,
ENOBUFS; owned scratch removed). This is a retained failed/incomplete run, not
a test pass. Future file comparisons use bounded hashes/offsets.

Author minimized the sidecar difference to one capture plus placement with a
kept-open quiescent writer. A bare native read-only SELECT reproduced exactly
SHM byte104 changing; DB and WAL hashes stayed equal. No-read and warmed-reader
controls stayed entirely equal. Primary independently created a separate native
one-table WAL fixture and a four-capture Raw29 fixture on both supported Nodes:
both cold reads likewise changed only byte104, while a second warmed Raw29 read
left all files byte-identical. Primary diagnostic commands and independent
verification exited0, with frozen source and scratch cleanup checked.

[SQLite's WAL format](https://sqlite.org/walformat.html) documents read marks in
SHM bytes100–119. SHM is coordination state, not stored conversation content.
Therefore the original R29-04 promise of all cold SHM bytes being immutable is
withdrawn explicitly. Preserve no logical writes and quiescent DB/WAL byte
equality, compare cold native/engine behavior, and retain warmed whole-file
equality; do not suppress arbitrary SHM differences or change the reader.
Read-only database access is not a claim of immutable SQLite sidecar files.

Author receipts: raw29-first-22.16.0 and five wal-* probes in its evidence
directory. Primary: primary-wal-diagnostic-v1-{freeze,commands,report,verification}
and both raw logs; separate diagnostic source is primary-wal-diagnostic.mjs.

### Final implementation handoff and primary acceptance

One actual GPT-6.1 Sol/high worker completed 36 author paths, then paused writes
and reaped all processes. Independently derived diff/untracked and full-tree
inventories agree. Author evidence: author-final-receipt-v1.json and
author-source-freeze-v1.json, author digest
`d8bf6a11ee3ce32417ba0472cd9cd79ade5947f41b1bd82a16f4e30b2b6fb023`.
Four focused commands passed: 52/52 source/helper and 4/4 installed on each
Node22.16/24.15; child and supervisor exits0/null, with cleanup checked.
The preserved E1 roster is 23 source plus one installed case (24 total), not
24 source cases; the initial 53-source estimate double-counted its installed
case. No test was removed to change that denominator. New cases are 22 source,
seven closure-helper and three installed cases.

The first installed run's two client cases failed because the fixture omitted
the required correction `kind`; the physical-layout case passed. Exit1 and
cleanup are retained. Only that missing fixture argument was corrected; no
runtime validation or acceptance condition was loosened.

Primary inspected the actual implementation, all nine closure callers and both
new fixtures, and confirmed the five reader runtime modules plus six original
E1 test/fixture files remain byte-identical to reviewed #457. The only runtime
compatibility delta from that reader is the exact29 version entry and exports.
The original reader algorithm, resource/work/deadline bounds and writer behavior
are unchanged. Nine affected caller regressions belong to primary's full
artifact matrix rather than a duplicate separate author sweep.

Primary's final pre-commit freeze has 38 changed paths, 1,875 source entries and
18 unchanged dependency identities; both inventory routes agree. Source digest:
`f60fef45a7d070bcf4e4b01a6498a5ef3dfdfc1b692e6cd11f869e52167874fd`.
Independent public13 and installed1/inner13 acceptance passed each runtime;
the independent native-WAL comparison also passed each. All six commands,
supervisor and separate log/hash/cleanup verifier exited0 with source unchanged.
Evidence: primary-final-acceptance-v1 report/verification plus its six raw logs.
Serial scale and the full affected matrix are separate remaining gates here.

Serial schema29 scale is now complete, without simultaneous heavy tests. All
four commands and the separate log/hash/metrics verifiers exited0; source stayed
fixed, all owned scratch was removed, and every exact count/revision assertion
passed. Full traversal timings in milliseconds:

| Node | Memories / filings per Memory | Cold | Warm | After revision | Largest main-loop gap | Fixture setup |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 22.16.0 | 1,112 / 1 | 50.06 | 11.98 | 11.76 | 3.75 | 19,315 |
| 22.16.0 | 3,336 / 3 | 84.48 | 42.76 | 44.06 | 3.85 | 59,268 |
| 24.15.0 | 1,112 / 1 | 47.20 | 14.01 | 13.19 | 2.96 | 19,132 |
| 24.15.0 | 3,336 / 3 | 89.12 | 44.37 | 42.43 | 3.68 | 59,616 |

Each fixture has four namespaces, 60 L1 and 11 L2 nodes. The revision phase adds
one unfiled Memory per namespace (so its final totals are baseline+4). Setup
uses public explicit admission/placement and is measured separately; it is not
Raw model-extraction throughput. These are single serial synthetic local
measurements, not production percentiles, semantic recall scores or a comparison
against the product's old-map incident. All phases made zero model/token calls.
Both frozen bounds passed: full1112 traversal <=1s, main-loop gap <=100ms.
Evidence: primary-final-scale-v1 report/verification/metrics and four raw logs.

Primary independently verified all author path modes/hashes, 1,874 author-frozen
source entries (both primary plans excluded), 18 dependencies, final four command
receipts/raw-log hashes and both retained failed-run hashes, verifier exit0.
Evidence: primary-author-verification.json. No final candidate/review/CI
completion is implied yet.

### Interrupted full matrix and authorized resumption

The first full matrix did not finish. Primary discovered that its default
300-second outer command limit was shorter than the unchanged full core suite's
previously recorded 443.03/461.64-second runs. The suite was still making test
progress, including the existing expensive exhaustive background-context cases;
this was not evidence of a topic-reader hang. Primary stopped its own supervised
process before that deadline. Retained primary-final-matrix-v1-report.json has
complete=false, SIGTERM, child143/null and supervisor exit1, with source unchanged
and owned scratch removed. An incomplete command has no passing suite count.

Work then paused at the user's request for credential rotation. All author and
test processes had stopped; no key was inspected or used for this packet. After
the user authorized resumption, primary keeps the failed report and original
manifest, and creates a new full-matrix manifest with the same24 commands and
arguments. Only the two full-core outer supervision limits become1,200 seconds.
The artifact outer limit remains600 seconds; all other limits remain300 seconds.
No product deadline, reader work/resource bound, performance target, test
assertion or acceptance fixture changes. This is a primary acceptance-harness
correction, not a runtime implementation change. Source and dependency hashes
are rechecked before resumption and before/after every command. The rerun remains
synthetic and key-free, and receives a new result label rather than overwriting
the interrupted run.

### Complete affected matrix

Resumption re-derived the same38 changed paths by diff/untracked and independent
tree/filesystem comparison. All1,875 source entries and18 dependency identities
matched the pre-pause freeze exactly. The two manifests were compared as complete
objects: only the two full-core outer deadlines changed; all24 command arguments
and external acceptance fixture hashes stayed identical.

The new matrix completed on2026-10-22. All24 child commands exited0/null; the
foreground supervisor and independent raw-log/hash/source/cleanup verifier both
exited0. Each command left only the owned synthetic home, and the outer workspace
was removed. No source or dependency changed while tests ran.

| Gate | Node22.16.0 | Node24.15.0 |
| --- | --- | --- |
| Core,120 test files | 1,848/1,848 pass | 1,848/1,848 pass |
| Artifact,46 test files | 143 pass,1 skip,0 fail | 143 pass,1 skip,0 fail |
| Generic,25 test files | 635/635 pass | 635/635 pass |
| MCP,24 test files | 151/151 pass | 151/151 pass |
| Workspace lifecycle,2 test files | 25/25 pass | 25/25 pass |
| JSON validation; store/MOC/rebuild demos; host/transport import checks; pinned native marketplace/strict-plugin validation | All7 exit0 | All7 exit0 |

Each artifact skip is the explicitly native-Windows installation/lifecycle case
on Linux/WSL; neither is counted as passing native-Windows evidence. Across the
two runtimes there are5,604 passing tests and2 skips, no failed/cancelled tests.
The full-core commands took508.061/425.641 seconds, consistent with the need for
an adequate outer supervisor window rather than a relaxed reader runtime limit.
The complete serial matrix took1,792.360 seconds. These are verification timings,
not application performance measurements.

Exact expanded rosters are in primary-final-matrix-v2-commands.json; each suite's
file list was derived independently through directory entries and rg. Commands
use the owned runner, concurrency4 for core/artifact/generic/MCP and2 for workspace
lifecycle. Generic uses integrations/client/testing/run.mjs; the others use
tools/testing/run.mjs. The seven script-mode checks per runtime are
scripts/validate-json.mjs, examples/{local-store,moc-placement,index-rebuild}.mjs,
integrations/client/test/fixtures/{local-host,local-transport}-import.mjs and the
pinned primary-final-validator.mjs fixture. There is no TypeScript gate.

Evidence: primary-resume-v1-freeze.json and primary-final-matrix-v2-{commands,
report,verification}.json plus24 raw logs under the primary evidence directory.
The interrupted v1 report remains retained. Primary next updates only its two
planning records, freezes the scoped candidate, reruns meaningful acceptance on
that exact commit and obtains separate nonauthor Standards/Spec review before
push. CI and merge-preview verification must still pass before ready delivery.
