# H5b: bounded source-ranking read snapshots

Prospective primary contract, 2026-10-18. Fixed predecessor:
`70c27d49cfa96cc09e3e14fe99fe4972d1f68c36` (H5 with its failed resource
campaign preserved). No implementation or H5b resource measurement preceded
this contract. This is an offline correction hypothesis, not quality evidence
or permission to reopen any closed paid attempt.

## Why a separate hypothesis

H5's original R3 required a single `BEGIN IMMEDIATE` transaction. Its R5 campaign
failed: the old worst20000 query prevented a writer reservation for the complete
5-second timeout. New-arm contention and Node 24 were not executed. Keep that
failure and every original R1-R7/R8 byte and threshold unchanged.

A subsequent three-memory structural probe isolated the cause for both arms:
with initialized connections and a pause after the second receipt read, an
ordinary competing capture timed out; after the query released, capture
committed. Primary repeated this on Node 22.16 and 24.15, actual exits 0.
Release-before-writer controls committed and failed the precise blocking
assertion, actual exits 2. Those deliberate pauses establish causality, not
unpaused performance. All owned stores were removed.

This new hypothesis replaces **only the opted-in IDF path's transaction scope**.
It does not make the old H5 experiment pass. The default path remains unchanged
and retains its known worst-case limitation. Ordinary recall/automatic rationale
discovery do not silently adopt IDF. No WAL, schema or global transaction-helper
change is proposed: a long deferred read alone can still obstruct writer COMMIT
in SQLite's rollback-journal mode.

## P1. Unchanged ranking and public contract

Preserve H5 R1/R2 and all R4 acceptance, options, exact scores/ties, first-four
receipt ordering, projected eligibility, physical scan/sentinel accounting,
mask bound, 120-code-point excerpt, cursor/cache bindings and model quotas.
`bounded-idf-v1` is not a released ranking version and its mathematical result
does not change. No new option, cursor field, model stage or public metadata.
Option-off must be byte-identical to the predecessor; compare on the same normal
capture stores, not just a test expectation updated with implementation.

The ordinary prefix still scans at most 1024 physical rows, but the opted-in
implementation may divide that prefix into pages of at most 256 rows. The
keyset path remains at most 20000 physical rows, page 256, retained 1024.
One physical scan, not two complete source traversals. No term truncation,
shorter corpus, retained full-source copy, persistent statistics or vector DB.

## P2. Short snapshots, computation outside locks

For IDF only, use short explicit read snapshots. The first snapshot captures
namespace epoch and the exact index state (no state row versus active generation;
a state row with NULL generation is unavailable). Within each snapshot check
availability and both anchors, then read at most one physical page, eligible
projected bodies/revisions and first-four receipt records. Release every SQLite
statement and transaction before receipt hashing/validation, token matching,
mask/DF processing, sorting or excerpt generation. Only bounded page-local source
strings may be retained. Compact masks/IDs/revisions/receipt identities retain
the existing proportional bound across pages.

Every subsequent page, sentinel check and retained-winner reread uses the same
epoch and generation/availability anchors. Reread winners/placements in batches
of at most 256; validate source identity and materialize unchanged labels outside
transactions. After the last callback/computation, perform a final short
anchored check before returning a private candidate snapshot. On mismatch or
unavailable index, reject: no partial results, implicit retry, silently refreshed
DF population or stale cached result. Always roll back/close on exceptions.

Absence of an index-state row is not equivalent to a newly staged NULL row:
the first rebuild can introduce the latter without advancing epoch. A published
generation change must also invalidate. Existing post-token-counter map checks,
pre-model/microtask checks, canonical fetch rereads and atomic recall finalization
remain untouched and authoritative. This preserves their observation boundaries;
it cannot prevent a write after the final pre-call observation.

This is cross-connection writer responsiveness, not asynchronous same-process
CPU scheduling. The synchronous ranking computation can still occupy its JS
thread for seconds. Do not claim that this work resolves event-loop latency.

## P3. Race, failure and rollback acceptance

Use the real core, owned synthetic stores and separate initialized connections.
Test-only process-local instrumentation may synchronize at structural boundaries;
it must not add production callbacks or paid calls. Record the actual boundary
and ensure mutation happened, rather than accepting an unrelated error.

1. With ranking paused during outside-lock source processing and during retained
   excerpt processing, a normal foreign-namespace capture must actually commit
   before release. Query remains correct; foreign text cannot affect DF/results.
   Merely acquiring a write reservation does not pass.
2. Actual trusted same-namespace writes between pages, during mask processing,
   during winner materialization and before model invocation must commit and
   cause the expected existing freshness error before the next selector/model
   call. Exercise memory/receipt revision, filing/lifecycle and generation
   changes. No mixed-version or partially returned candidate snapshot.
3. Start first index rebuild with a small page limit while the query is outside
   a snapshot; demonstrate unchanged epoch plus staged NULL generation, then
   `index_unavailable` before model visibility. Also cover publication and a
   pre-existing active generation. Do not use an epoch bump to fake this case.
4. Eligible poisoned receipts still reject; excluded poison is not read. An
   injected failure during page reading or label generation leaves no open
   transaction; a following actual capture can commit. Every child and owned
   directory is removed on pass and deliberate failure.
5. Red controls restore a long transaction or omit an anchor check in an isolated
   test process and fail a specifically named assertion with the intended write
   preconditions. No repository runtime mutation, relaxed deadline or skip.
6. Exact same-state IDF output/count parity against the frozen H5 implementation
   for both scan modes, boundaries, ties and multi-namespace cases. Re-run the
   independent DF oracle, both ordinary flat rounds, hierarchy-v2, strict fake
   HTTP and installed-artifact/cold-reopen tests. Retain known semantic distractor,
   hidden-label and whole-source-rank-omission negative controls.

## P4. Separate, prospective resource campaign

Do not edit or rerun the closed original H5 campaign. Add a separate named H5b
measurement entrypoint; reuse H5's frozen corpus construction and pure gates
without rewriting their outcome. All five cells, three alternating old/new
pairs, fresh query children, 60-second watchdog, exact masks/index/count/file-size
checks and CPU/RSS measurements remain as in R5/R7. Candidate versus unchanged
legacy medians must satisfy the same <=2x +10ms elapsed/CPU and <=64MiB extra
peak-RSS limits. Run Node 22.16 and 24.15 sequentially without other heavy gates.
Record all results, not only successful or fastest trials.

For each 20000-row cell, measure actual competing **capture completion/COMMIT**
on fresh owned copies after uncontended measurements. Prepare and close the
seed store before copying; assert no WAL/SHM dependency. Initialize query and
writer cores before GO. A test-only first-physical-page-read observation triggers
the writer, with monotonic timestamps proving its attempt starts after the query
begins and before it ends. Use a foreign namespace so a correct query can finish
without expected same-namespace staleness. Confirm the captured memory/receipt
is durable from a cold connection and the authorized query population is
unchanged. Deliberate structural pauses belong to P3, not these timings.

Three candidate contention trials per 20000-row cell must complete the capture
in <2500ms and commit before the query ends; the existing 5000ms SQLite timeout
must not be raised. Report actual overlap, wait, result and durable counts.
Missing overlap, impossible timestamps or a threshold crossing is inconclusive,
not a passing zero; a timeout, failed query/writer, watchdog or cleanup fails.
Uncontended stores remain hash-identical; contention-store changes must be exactly
the expected foreign capture, not included in the CPU/RSS arm comparison.

Run one unchanged-legacy contention observation per 20000-row cell as a labelled
negative control. A legacy worst-cell timeout remains a failure of that path,
but is not a claim that the new candidate failed or passed. This explicit H5b
decision rule differs from frozen H5's both-arms gate. Candidate acceptance
requires every candidate check, not reclassification of the old failure. Never
advertise default-path responsiveness or full H5 acceptance from this experiment.

## P5. Scope and ownership

Prospective allowlist for this correction, relative to the fixed predecessor:

- core/moc-storage.mjs
- core/test/source-ranking-snapshots.test.mjs (new)
- core/testing/source-ranking-snapshot-child.mjs (new)
- evaluation/architecture/source-ranking-page-measure.mjs (new)
- evaluation/architecture/test/source-ranking-page-measure.test.mjs (new)
- docs/plans/source-idf-page-snapshots.md (this contract; execution append only)
- docs/local-store.md
- docs/limitations.md (append)
- ROADMAP.md
- CHANGELOG.md

All previous H5 files outside this list are read-only, including source ranking
math, frozen measurement and its tests, global transaction/index/runtime code,
contract/prompt/recall/provider/ledger code, manifests and deadline fixtures.
If another runtime file is required, stop and propose the exact scope before
editing; primary may prospectively refine the contract, never silently widen it.

One GPT-6.1 Sol/high worker implements runtime plus race/regression tests in an
isolated dependent worktree. A different GPT-6.1 Sol/high worker owns only the two
new measurement files in a separate worktree. Primary owns this contract,
integration, independent parity/resource acceptance and truthful delivery docs.
Standards and Spec reviewers are independent of both implementers, review the
same final full H4-to-candidate diff and preserve the original failures.

## P6. Verification and stop rules

Before measurement: focused tests and original H5 tests, complete core/OpenAI/
MCP/artifact/generic/workspace gates, applicable store/MOC/recall/OpenAI demos,
validate and pinned plugin checks on both Node versions. The primary personally
repeats key integrated paths. Inventory via git diff plus independent full-tree
mode/blob comparison, count both, verify R1-R7/R8 bytes unchanged. Final dual
review and exact-head CI precede live evaluator activation. Never claim any
test passed without the actual exit code.

No paid calls, corpus inspection, provider keys, operational ledger writes,
merge, deployment, package publication or historical cleanup in worker packets.
After two unsuccessful corrections of the same issue, rescope/escalate rather
than repeat. Preserve all failures; any resource failure blocks promotion and
requires explanation before a new prospective attempt. The next authentic
two-case diagnostic, later paired24 and fresh30 gates remain separate. Budget
remains cumulative400USD with protected30USD, requiring a fresh ledger check.
The 12-hour discussion checkpoint remains 2026-10-19 03:58UTC.

## P7. Prospective acceptance clarifications

Before implementation, an independent GPT-6.1 Sol/high Spec reviewer found
P1-P6 feasible. Make these test preconditions explicit:

- Exercise staged NULL-generation creation both during outside-lock ranking
  work and from a later map/model token-counter callback. Require the precise
  availability failure and no subsequent selector invocation.
- A successful competing capture requires `ok: true`, exactly one newly
  admitted memory, applied initial classification and its expected complete
  disposition, plus a cold-read durable memory and source receipt. Partial
  capture/admission with a failed later stage cannot pass P3 or P4.
- Releasing a snapshot means no active reader/iterator or transaction spans
  computation. Reusable prepared statement handles need not be destroyed.

## Execution record

Planning only. P1-P7 precede correction implementation and H5b measurements.
Independent prospective review used `7f980ff`; its two suggested acceptance
clarifications are recorded in P7 before dispatch. No blocking finding or
resource pass was claimed.

### Integrated candidate, before broad/resource acceptance

The runtime worker used GPT-6.1 Sol/high at fixed base `f0c0828`, committing
`2083236` (runtime and 21 isolated structural scenarios) and `f816816`
(descriptive docs). The separate measurement worker, also GPT-6.1 Sol/high,
committed `05d11ab` at the same base. Primary integrated them as `a273293`,
`c48e1a4` and `6cfacf0`, respectively. Neither worker accessed a model key,
authentic corpus, operational ledger or a paid endpoint.

Runtime evidence: `/tmp/cairn-h5b-runtime-evidence-0uBH8P`. Both Node 22.16 and
24.15 focused runs passed 46/46 with actual exit 0, including the 21 new
scenarios and 25 original ranking checks. The final exact durable-count
strengthening passed all four affected foreign-capture/red-control cases on
both runtimes, actual exit 0. Page/winner structural capacity setup uses five
normal captures plus correctly hashed synthetic rows; it is race evidence,
not model extraction or admission-quality evidence. Original normal-capture
positive controls remain unchanged. No watchdog was raised or test skipped.

Measurement evidence: `/tmp/cairn-page-measure-evidence-gUPcbL`. All 25 frozen
and new measurement tests passed on both runtimes with actual exit 0. A native
1000-row smoke against the unchanged predecessor correctly returned an
inconclusive capture-overlap result: the capture committed after query end.
It is neither a resource pass nor an H5b full campaign. The frozen original
measurement module and tests remain byte-identical.

Primary independently compared `git diff --name-only` with complete-tree
mode/blob inventories at `c48e1a4`: 22 full H4-to-candidate paths and 9 H5b
correction paths agreed, all within their allowlists. The R1-R7, R8 and P1-P7
hashes are unchanged, as are the protected runtime/math/measurement files and
the legacy scan/scoring/label body. Verification exited 0.

Full Node 22.16 and 24.15 core gates started at `a273293`; `c48e1a4` changes
only CHANGELOG, ROADMAP and local-store documentation, with identical test and
runtime bytes. These broad runs, primary same-state parity, separate resource
campaign and final independent dual review/CI are still pending. There is no
new semantic score, evaluator activation, default promotion or merge.

### Broad and frozen resource observations at 21cec10

Primary full core passed 1211/1211 on each Node version, actual exits 0.
The remaining twelve checks per version all exited 0: OpenAI318, MCP111,
artifact93 passed/1 native-Windows skip, workspace25, generic673, validate,
four applicable demos and both pinned Claude validations. Focused71,
deadline19 and 168 independent same-state comparisons on 212 normal captures
also passed with actual exits 0 and unchanged canonical data. Separate
non-author GPT-6.1 Sol/high Standards and Spec reviews of the full 22-path
H4-to-21cec10 diff reported no findings. Exact-head CI is still pending.

The frozen H5b resource campaigns at `21cec10` ran sequentially after those
gates: Node22 18:02:36-18:04:10UTC and Node24 18:04:33-18:06:11UTC. Both
operators exited 0. Each retained 51 child exits (5 preparation, 38 queries,
8 captures), all 0 without signal/watchdog; primary checked the owned stores
were absent after closure. Five relative elapsed/CPU/reported-maxRSS cells
and all six candidate captures per version passed the encoded gates. The
12 complete captures committed before query end in 102.019-806.181ms.
Legacy worst-cell captures still failed `storage_busy` after about 5 seconds;
ordinary legacy captures completed only after query end. These are separate
labelled observations and do not change the original H5 failure.

Raw streams are retained in `/tmp/cairn-idf-h5b-primary-xLEMbe`:

- resources-node22.ndjson SHA256 `3d6747982d3eddddd581e87948655b04118ddca4d7010107877cbac2a92a71ba`.
- resources-node24.ndjson SHA256 `1633e891fe54dadaf59b68e023d091c69342d483a06f60c13b899b62a439f41a`.

Primary identified an important measurement limitation before promotion: Linux
`getrusage` peak RSS can include pre-exec residency. A separate no-store
128MiB parent-allocation probe increased a fresh child's reported peak by
about 90MB while its current-image `/proc/self/status` VmHWM stayed near 49MB.
Both Node probes exited 0. This agrees with the Linux
[getrusage documentation](https://man7.org/linux/man-pages/man2/getrusage.2.html)
that resource metrics survive exec. The reported relative-maxRSS checks remain
recorded passes, but they cannot alone establish ranking memory cost. Original
campaigns are closed; no threshold, outcome or metric is rewritten. Supplement
the memory evidence below before evaluator activation. CPU, elapsed and actual
capture observations remain valid within their stated synthetic/shared-host scope.

## P8. Prospective current-image RSS supplement

Freeze this section before its helper implementation or measurements. This is
a separate memory-observation supplement, not a rerun/reclassification of either
closed campaign and not a runtime or ranking change. The two existing raw
streams and their reported metrics remain immutable.

Use Linux `/proc/self/status` VmHWM, read immediately after the unchanged
`queryMeasurement` returns in a fresh query child. Preserve its original
`peakRssBytes` and add a separately named `currentImagePeakRssBytes` with raw
KiB/source and child PID. Require exactly one valid integer VmHWM field, safe
conversion to bytes, and a value at least both recorded rssBefore/rssAfter.
Missing, malformed or contradictory observations fail; never fall back to the
contaminated metric. This peak includes current-image startup/core-open and
small observation/validation overhead; it is not allocation attribution or a
JS-heap measurement. Do not monkeypatch runtime or process measurement methods.

Reuse all five frozen cell constructors, their query mechanics, exact
counts/index/masks, separate closed preparation children and byte-identical
read-only stores. Three alternating old/new pairs per cell, fresh initialized
query children, 60-second watchdog and all raw observations/exits retained.
The sole supplemental numerical decision is each cell's median new
current-image peak <= median old +64MiB, unchanged from the intended memory
allowance. No contention, model, corpus, provider or ledger calls. Keep timing
fields as observations only; do not replace the closed campaign's medians.
Run Node22.16 then24.15, no concurrent heavy acceptance jobs. A failure stops
this supplement and blocks promotion; do not retry or change cells/thresholds.

One GPT-6.1 Sol/high measurement worker may create only `rss-measure.mjs` and
`rss-measure.test.mjs` in a new primary-owned private evidence directory. All
repository runtime, frozen modules, old tests and raw streams remain read-only.
Primary owns this plan, integration/acceptance and descriptive result updates.
No new production/evaluation framework is required.

Before measurement, pure parser/median/order/exits/cleanup tests and a real
parent-inflation control must pass on both runtimes. The control launches the
same tiny fresh image before/after a touched retained128MiB allocation, verifies
parent current RSS increases >=96MiB, records both child metrics, requires
child reported peak increase >=32MiB while current-image peak difference is
<=16MiB. Retain the allocation until the second child exits. An unexplained
control failure is a measurement failure, not a reason to relax tolerances.
The primary repeats key checks and both independent reviewers inspect the
exact helper hashes and this contract before running the supplement. After
closure, final docs and the unchanged runtime receive both review axes and
exact-head CI before any real-model diagnostic.
