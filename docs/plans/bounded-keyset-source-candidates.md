# Opt-in bounded source candidate discovery

Fixed base `6d67cf0c8cf67adddcc74622e9c805d632ed7769` (accepted PR #238).
Branch `feat/bounded-keyset-source-candidates`, independent of the mixed budget
guard. Primary contract frozen before implementation. This is a product retrieval candidate,
not a semantic-score improvement or default change. No external vector/FTS
service, source-copying sidecar, new model or database schema is introduced.

## Why this change, and what it must not claim

Fresh primary public-admission reproduction on Node22.16/24.15:
1025 current synthetic memories; the maximum-ID target's source is directly
readable but query selection/recall misses it. Forget a different earlier row:
same query and source return at1024. A readonly runtime score probe observes
1024 bodies plus their one receipt (2048 calls), never the target. This is the
documented candidate prefix limit, not an unexplained LLM mistake. MOC page
and answer-packing loss are different stages, already covered by existing
synthetic-lineage tests. Historical QA errors are not attributed from this.

Ranked hypotheses considered: scan-prefix exclusion predicts target never
scored; MOC/page selection loss predicts target scored but not selected;
fetch/packing loss predicts target selected/returned before later loss. Fresh
probe supports the first. This contract directly tests the smallest repair:
scan a larger but hard-bounded authorized prefix using keyset pages, retain
only bounded top candidates, then keep existing MOC/select/fetch/rank budgets.

## Acceptance K1–K12

- K1 Trusted `openMemoryCore` constructor gains optional own-data string
  `sourceCandidatePolicy:'bounded-keyset-v1'`. Omitted retains all current
  behavior. Reject other/undefined/null values and accessor property before
  storage/model work; no getter invocation. Activate only for explicit
  source-evidence or rationale-evidence recall. Default/body-only recall,
  public map/classification catalog, automatic rationale discovery, capture,
  storage schema, MCP/HTTP/Hermes fields and ordinary defaults unchanged.
- K2 New versioned candidate scan has immutable implementation constants:
  at most20000 current physical memories per authorized namespace, page256,
  retain at most1024 candidates, first4 stable-receipt-ID sources per eligible
  memory. Readset still1–2 authorized namespaces; total worstcase40000 memory
  and160000 scored receipts, not an unbounded search. The20000 cap is an opt-in
  experimental engineering envelope based on the existing offline comparator,
  not a performance SLA or proof of semantic recall. No caller-supplied cap.
- K3 SQL keyset `id > lastId ORDER BY id` over existing
  `capture_current_memories` partial namespace index, excluding history and
  tombstones before traversal. Explicit namespace predicates each page; no
  OFFSET, global scan, absent-index fallback or source-copying table. At most
  cap current rows scored plus ONE sentinel row solely for exhaustion; never
  score/read receipts for the sentinel. Use pages<=256 (last page may include
  remaining+sentinel only) and retain only bounded current page/top candidates.
  Active-projection-rejected current physical rows still consume scan allowance
  but never score source/body or enter candidates. Preserve active generation
  authority through existing projectPrepare and current revision validation.
- K4 Reuse exact createQueryScore semantics and existing source receipt
  validation, tie and preview policies: body plus first4 validated source
  excerpts, maximum distinct literal whole-Unicode-run overlap. Source label
  only for strict score improvement; stable receipt-ID ties keep first;
  body/source tie keeps body. Keep candidate order scoreDESC,idASC. No CJK
  segmentation, synonyms/aliases, embeddings, relevance heuristics or labels
  that know an expected answer. Maintain bounded top1024 without collecting
  all scanned memories or materializing MOC placement for discarded rows.
  Candidate payload/preview<=existing120-code-point/source invariants.
- K5 Exhaustion is honest: scanExhausted true only when no further current row
  beyond cap AND no eligible row lost to top-K pruning. If physical cap or
  top-K truncates, false even if all retained map candidates are consumed.
  No complete-source-scan fallback may claim complete coverage of discarded
  candidates. Existing page/token/selected/ref/receipt/fetch/rank limits and
  public response shapes remain unchanged; use existing incomplete/budget
  exhaustion markers. New policy/cap/topK/receiptlimit bind internal recall
  cursor namespace/query/epoch so policies cannot alias. Epoch checks after
  counter callbacks and authoritative final recallSnapshot unchanged.
- K6 With <=1024 current rows, new/old source scoring yields identical ordered
  refs/previews/exhaustion on same store including zero scores and score ties.
  Above that, compare the new result with a bounded complete same-policy oracle
  over exact authorized physical prefix, sortedscore/id then top1024. Oracle
  is TEST ONLY; do not feed its IDs/targets to select/rank or product code.
  Raw SQL seed may establish deterministic scan-boundary/unit resource fixtures
  ONLY in fresh synthetic DBs and must be labeled separately from public flows.
- K7 Regression before fix: preserve original public-admit red loop (minimum
  symptom1025) with same-source/directget and1024control. Final actual core
  recall under new constructor must return exact target source at1025 and at
  a larger frozen size (e.g.2049); default must still exhibit documented limit.
  Selector uses only literal query and visible labels, rank only given
  candidates; no target IDs/oracle data in callbacks. Include correct/misfiled/
  unfiled placement and both source contexts. Record MOC-visible, final-returned
  and source-present stages separately; scripted results are not QA.
- K8 One additional actual public capture flow must verify source receipt
  linkage beyond1024 before recall. Build fresh source batches<=5 extracted
  items each through core.capture, not direct-admit-only evidence. After
  capture, select a target/query from stored synthetic sources to establish
  its actual beyond-prefix ID position; this is a reachability diagnostic,
  not a frozen benchmark question. Use real core recall with new policy and
  verify exact original receipt through authoritative get. Existing
  synthetic-lineage public comparison demo (including source packing omission)
  must remain passing; do not forge a pristine core/list or bypass full-history
  preflight to claim an end-to-end comparison. No new generic lineage report.
- K9 Lifecycle/privacy/freshness regression: namespace andforeign-volume
  isolation; personal/project readset both; corrected/forgotten/historical
  predecessor exclusion; newsource/revision/dedup; fifth-onlyreceipt cannot
  improve score; invalid first4receipt failsbeforeselector while excluded
  row poison is not read; active-generation exclusion/index rebuild/staleepoch;
  source correction during counter/select/rank yields existingfailclosed
  freshness behavior; no source authority or remembered permission inference.
  Cold reopen same mode same results; no new persisted cursor/projection/index.
- K10 Deterministic resource proof: at0,1024,1025,20000,20001 current rows assert
  exact caps, no scored sentinel, bounded topK, indexed namespace query plan,
  no body/source scoring of foreign/history/tombstone/projection-excluded rows.
  Include a namespace with many foreign rows to confirm result/scored-count
  invariance (not a claim of SQLite internal operation count). SQL EXPLAIN
  use and externally observed callback counts are distinct evidence.
  Standalone offline measure creates fresh synthetic temporary stores and
  reports source-free counts, elapsed query time, memory/file size and complete/
  incomplete status for100/1000/10000/20000 authorized rows, first4receipt
  worst-length control and foreign-volume control. Use one bounded child
  watchdog<=60sec percell; if a cell cannot finish or materialization becomes
  unbounded, retain failure and return to primary before expanding limits.
  Report all measured values/conditions; no speedup/SLO declaration from them.
- K11 Scope actual runtime change to core/query-candidates.mjs,
  core/moc-storage.mjs, core/contract.mjs (runtime forwarding only if needed),
  newfocused core/test/bounded-keyset-candidates.test.mjs, one optional synthetic
  measure helper/test under evaluation/architecture and root scripts,
  this plan, docs/source-evidence-context.md, docs/protocol.md,
  docs/limitations.md and CHANGELOG.md. No lock/dependency/schema migration,
  existing test expectation deletion, newhosttool, background job, raw source
  diagnostic or automatic opt-in. Reuse current scoring/memory materialization
  private shape where reasonable; avoid duplicating entire queryCandidateRows.
  Public docs explicitly state expanded local authorized source examination,
  unchanged bounded model exposure, limits and no semantic quality guarantee.
- K12 BothNode22.16/24.15: focused new tests; full test:core; demo:store,
  demo:moc, demo:recall, demo:continuation; existing synthetic-lineage tests/demo;
  test:longmemeval plus demo:longmemeval-public; npmtest, JSON, pinnedstrictplugin/
  marketplace. Run resource measure on both and preservefailures. If another
  touched callsite adds a required CONTRIBUTING gate, runit; no TypeScriptgate.
  Primary personally repeats originalrepro, finalcombined criticalintegration
  and readsactualdiff. Freeze localcommit, independentnonauthorStandards+Spec,
  correct/retest/rereviewexacthead. PRagainstmain,allcurrentCIgreenbeforeREADY.
  No merge,release,deploy,oldbenchmarkreplay/provider/key/corpus/operatorledger.

## Next checkpoint

This opt-in makes a defined class of stored sources reachable; it does not
make LLM selection, extraction, relation inference or answers correct. After
offline correctness/resources are accepted, integrate the explicit constructor
configuration into a separate installed-harness acceptance and frozen fair
comparison candidate. Originalreserved30 remains untouched until whole S3
protocol/resources are frozen. Default promotion and any FTS/vector addition
need their own evidence, not automatic follow-on.

## Preimplementation record

Primary owns the reproduced symptom, scope and acceptance. Independent
nonauthor GPT-6 Sol/high feasibility audit confirmed the existing namespace/id
partial index and recall freshness seams can support this without migration;
resource feasibility remains to be measured. Primary's initial repro harness
incorrectly assumed admission refs include content, producing TypeError before
observation; it was corrected to retain original synthetic content alongside
refs. This was not a product failure. Subsequent both-Node runs reached the
intended red assertion and the1024 positive control. Primary artifacts:
`/tmp/cairn-keyset-repro.0kX3CL` (synthetic/local only, no historical cohorts).

## Implementation checkpoint (pending full gates and independent review)

The new focused test first failed at constructor admission after 1,025 public
admissions, with the prior core still missing the beyond-prefix source. After
the opt-in implementation, its public-admit 1,025 case, public-capture 2,049
case, same-policy raw-seed oracle, correct/misfiled/unfiled source contexts,
lifecycle/projection/freshness controls and private cursor binding pass on
Node 22.16.0. Primary independently repeated public admit at 1,025 and 2,049
and public capture at 1,025 on Node 22.16.0; its exact original source was
visible and returned in the opt-in path, while documented default misses
remained. This is reachability and source linkage, not semantic answer scoring.

The standalone synthetic resource helper reports authorized/scored/retained
counts, cap/sentinel/incomplete state, elapsed query time, resident bytes,
separate SQLite main/WAL/SHM bytes, and indexed query-plan use. All ten cells
pass on Node 22.16.0 and 24.15.0 with one child watchdog per cell at 60s.
The table reports each isolated query measurement; receipt condition is one
80-ASCII-code-point source per row except `worst1000`, which has four distinct
800-ASCII-code-point sources. All cells include two same-namespace excluded
history/tombstone rows with poisoned receipts; no excluded or sentinel text is
scored. All use the namespace partial index without a temporary sort; WAL and
SHM are zero at the measurement instant. Foreign10k adds 10,000 other-owner
rows and exactly matches plain1000 scored/retained/exhaustion. Elapsed time
measures the query only, not seeding; RSS is a post-query snapshot, not a peak.
These are callback and SQL-plan observations, not SQLite internal operation
counts.

| Cell | Scored / retained / exhausted | Query ms 22 / 24 | RSS bytes 22 / 24 | SQLite main bytes |
| --- | --- | --- | --- | --- |
| 0 | 0 / 0 / yes | 0.587 / 0.539 | 62464000 / 66039808 | 376832 |
| 100 | 200 / 100 / yes | 15.278 / 16.093 | 66830336 / 72421376 | 483328 |
| 1000 | 2000 / 1000 / yes | 111.013 / 109.442 | 81498112 / 90062848 | 1392640 |
| 1024 | 2048 / 1024 / yes | 112.765 / 111.819 | 81743872 / 88207360 | 1413120 |
| 1025 | 2050 / 1024 / no | 111.985 / 108.261 | 82354176 / 85377024 | 1413120 |
| 10000 | 20000 / 1024 / no | 254.920 / 248.586 | 97189888 / 107323392 | 10604544 |
| 20000 | 40000 / 1024 / no | 416.673 / 409.661 | 95969280 / 99786752 | 20860928 |
| 20001 | 40000 / 1024 / no | 417.503 / 386.493 | 94593024 / 101662720 | 20860928 |
| worst1000 | 5000 / 1000 / yes | 201.402 / 193.273 | 99860480 / 96821248 | 6074368 |
| foreign1000 | 2000 / 1000 / yes | 114.172 / 117.236 | 94330880 / 93515776 | 13475840 |

Pinned Claude Code 2.1.260 strict marketplace and plugin validation and root
JSON validation pass without installing dependencies in this worktree. The
full core suite passes 728/728 on Node 22.16.0 with serial test-file execution;
Node 24.15.0 also passes 728/728. Both Nodes pass the generic 112/112 tests,
LongMemEval 128/128, the separately targeted synthetic-lineage 2/2 tests,
and the six store/MOC/recall/continuation/synthetic-lineage/public LongMemEval
demos. Independent review and primary final acceptance remain separate gates.
No resource SLA, speedup, semantic gain or default promotion is claimed.
