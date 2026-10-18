# H5: bounded source-ranking hypothesis

Prospective primary contract, 2026-10-18. Parent candidate
1a072c5eb05742841e5114b22ffc1478287fd3e8 (H4); primary is still completing its
final broad gates. This document authorizes planning only until those gates
pass. Implementation then follows the same isolated-worker, fixed-candidate
Standards/Spec review and primary acceptance workflow. No paid run is part of H5.

## Goal and scope

Test whether distinguishing literal cues reach the actual model-facing window
more reliably than equally weighted query words. This is one ranking hypothesis,
not proof of semantic quality, a complete Raw/Memory/Card architecture, or a
replacement for MOC, relationships or future vector experiments. The closed H3
case is not replayed, hand-filed, selected again or used as a new test fixture.

H4 restores a standalone topic entry and two flat rounds. H5 changes only an
explicitly opted-in source candidate ranking. It must not silently change the
scan scope, classification, labels, model prompts, provider/ledger limits or
host/default behavior. Query-aware hierarchy leaves and weighted excerpts remain
separate hypotheses even if a new case exposes their limitations.

## R1. Public contract and unchanged paths

- Add trusted `openMemoryCore({sourceRankingPolicy:'bounded-idf-v1'})`.
  Omission preserves the old implementation and serialized results/requests.
  Own undefined, null, wrong values and accessors reject before storage/model
  access, following existing constructor policy validation.
- Activate only for existing source-context recall (source-evidence and
  rationale-evidence). Ordinary recall, public map, capture/classification and
  automatic rationale discovery keep their existing literal scorer. Keep
  `createQueryScore`, its version and the old excerpt helper unchanged.
- Ranking, `sourceCandidatePolicy` and `selectionMode` are independent axes.
  No new scan allowance: ordinary1024-current-physical-row prefix versus
  bounded-keyset-v1's20000, page256 and retained1024 remain exact. Projected-out
  physical rows still consume the scan allowance. Do not compute statistics
  only over the old top1024 or over an expanded corpus.
- Add an explicit ranking version to private cursor/cache bindings only when
  enabled. Old bindings remain byte-for-byte unchanged. Cross-policy cursors
  reject. Query/scope/epoch/generation/revision checks retain authority.
- Ranking adds no model method or stage. Per-mode orchestration and call caps
  stay unchanged. Actual calls may differ when different choices create or
  remove candidates; do not promise identical stochastic choices/call counts.
  In matched scripted controls, verify actual methods and quotas unchanged.
- No MCP/Hermes/hook activation, evaluation profile/guard edits, migration,
  dependency, persistent statistics, source-copy sidecar or production write.

## R2. Exact ranking semantics

Per authorized namespace, use exactly the eligible projected memories in its
existing bounded physical prefix. `N` is that eligible count. For every distinct
whole Unicode query run, `df` counts memories whose body OR one of their first
four validated, stable-ID-ordered receipts contains that run. Count each memory
once, regardless of repetition or duplicate passages. Do not inspect a fifth
receipt. Query/content validation and whole-run lowercase tokenization match
the existing scorer; there is no segmentation, stemming, stopword or synonym
addition. Sort unique query tokens by deterministic code-unit ordering before
accumulating scores, independent of query word order.

For each query token:

`weight = Math.log1p((N - df + 0.5) / (df + 0.5))`

For each individual body/receipt, sum weights of distinct matching query tokens.
The candidate score is the maximum individual-passage score, never a combined
cross-passage score. Body wins body/receipt ties; first receipt wins receipt
ties. Candidate ties keep memory-ID ordering. Zero scores remain eligible. Empty
query-token sets and empty eligible stores are defined, not divide-by-zero or
special unlimited searches. This is IDF-weighted binary overlap, not BM25.

The winning passage goes through the unchanged120-code-point excerpt helper.
A high score does not guarantee its rare cue survives that excerpt. Report such
a failure separately instead of silently changing labels. Source evidence
still goes through canonical fetch, whole-source rank packing, unchanged rank,
and final atomic validation. Ranking is not support or authorization.

## R3. Bounded implementation and privacy

Do one bounded physical scan, not two complete source traversals. Retain compact
per-memory, per-passage query-match masks (body plus up to four receipts), IDs,
revisions and necessary passage identity; no full source corpus copy. A temporary
union mask supplies per-memory DF. After DF is known, score each passage mask,
retain the existing top-K, then materialize/revalidate only retained candidates'
winning passages and placements under the same trusted transaction. All source
reads require the same namespace/lifecycle/projected-revision eligibility first.

Use a typed-array arena or bounded slabs, not one Set per passage. With at most
2000 distinct query runs, the hard payload bound per active namespace is
`20000 * 5 * ceil(2000/32) * 4 = 25200000` bytes. Smaller scans/queries allocate
proportionally, not always the maximum. A scalar memory/passages layout and DF
array may add bounded metadata. Return no arena in cached map snapshots; process
namespaces sequentially. The payload bound is not a promise of instantaneous GC
or a peak-RSS bound; measure actual RSS separately.

Keep the existing transaction semantics for this slice. It uses BEGIN IMMEDIATE,
so writer blocking is a real cost. No model/token-counter/user callback belongs
inside the new statistics computation. No source text, query token, rare-term
list, IDF explanations or global cross-namespace statistics enter telemetry.
Optional private measurement output is content-free numeric counts only and
must not leak into model inputs or ordinary public results.

## R4. Frozen offline acceptance

Use new synthetic fixtures, owned test workspaces and exact original sources.
Positive route cases use ordinary capture/classification and cold reopen, not
SQL/manual target placement. Explicit structural capacity/poison fixtures may
use test-only setup, clearly distinguished from product-quality evidence.

1. Rare cue versus generic crowding: enough decoys to exceed both actual packed
   flat windows; target/query semantics predetermined independently of random
   IDs. Same store, scan, query, counter, model logic and quotas. Old ranking
   demonstrably misses the target; new ranking exposes its actual cue, then
   canonical source in fetch/rank/final. Also test filed/unfiled and source-only
   cue versus a generated body lacking that cue. Do not select a target after
   observing random ID order.
2. Within-memory/query repetition and duplicate source text do not add weight.
   Unrelated padding leaves score/order unchanged. This is not a claim that all
   long-document bias disappears.
3. Separate receipts cannot combine into fictitious joint evidence; fifth-only
   cue excluded; body and stable receipt ties exact. An independent score oracle
   computes DF, passage maximum and top-K without calling production helpers.
4. DF and ordering unchanged by foreign owner/scope/project, historical/deleted/
   awaiting/projected-out records, inactive generations and beyond-cap rows.
   Another authorized namespace's size does not change this namespace's ranking.
   Excluded poisoned receipts are not read; eligible poisoned receipts fail
   before selector. Validate both namespace orders.
5. Boundaries0/1/1024/1025/20000/20001, empty and no-overlap query, exact physical
   scan/sentinel/projected/source/mask/retained counts, honest unread/pruned
   coverage, indexed access and missing-index failure. Existing epoch checks and
   finalization remain authoritative across counter/microtask/select/fetch/rank
   mutations; disabled mode must not gain a new failure surface.
6. Counterexamples include a rare-token wrong-person/date/negated/proposed-only
   distractor. A scripted oracle is mechanics evidence only. Count inappropriate
   selections and keep these cases for later real-model diagnostics; never
   treat rare tokens as proof of truth.
7. Separately exercise navigation-visible but whole-source-rank-omitted evidence
   and a weighted-winning passage whose unchanged label hides the rare cue.
   The test should distinguish those stages, not force a successful final answer.
8. Omitted-option exact predecessor/current request/result parity for ordinary,
   source, rationale, bounded-source-scan, hierarchy-v1 and hierarchy-v2 on both
   scan policies, mixed scopes, actual o200k_base and scripted counters. Compare
   v2's unchanged flat inputs to flat recall under the same new ranking policy.
9. Real fake-HTTP strict adapter and installed archive import/cold reopen,
   manifest versus archive-list independent count/hash check, no default/host
   activation, no additional ranking model call. Success and deliberate failure
   clean owned scratch and children, preserving retained explicit output only.

## R5. Resource gate before evaluator activation

Adapt the existing bounded-keyset measurement pattern, not a second general
benchmark framework. Preserve every raw result, actual child status, indexed
plan/count/file-size checks and the60-second child watchdog. All databases are
new synthetic owned scratch; never clean historical directories. Seed once in
a preparation process, close it, then use fresh measurement children so seed
allocations do not contaminate query peak RSS. Sequentially reuse an unchanged
store for paired read arms. Do not measure while unrelated heavy local gates
are running; record the environment and execution order.

Frozen cells: existing1000,20000,worst1000(four800-character receipts),
foreign1000, plus worst20000 with4000-character bodies, four distinct valid
800-character receipts and a4000-character many-distinct-token query. Include
sparse and dense passage matches within that fixed last corpus. Structural
seeding is allowed only for these capacity/complexity cells.

Run three paired repetitions per cell on Node22.16 and24.15, alternating arm
order; retain all results, not only the fastest. Measure query elapsed, CPU
user/system delta, RSS before/after, process peak RSS (fresh child startup/core
open still included), mask payload and record counts. Compare paired medians:
new elapsed/CPU must be <=2x old median plus10ms measurement tolerance. Extra
median peak RSS must be <=64MiB and the exact mask payload bound must hold.
These prospective engineering gates are not a product SLA.

For both20000 cells, separately probe competing-writer contention for each arm
using a ready dedicated child connection, bounded zero-timeout lock probes and
a bounded writer-reservation attempt. A BEGIN IMMEDIATE/ROLLBACK probe measures
writer reservation, not full capture latency. Keep contention probes out of
uncontended CPU/RSS measurements. Report probe resolution, observed blocked
interval, actual wait/result and whether overlap was established; a missed
overlap is inconclusive, not a passing zero. Observed blocking must be <2500ms;
reaching existing5000ms busy timeout, failed child, invalid bound/plan or timeout
fails the gate. No exact lock-hold claim from sampled probes.

If resources fail, stop promotion and explain the measured cause. Do not change
corpus scope, truncate query terms, alter transaction semantics or weaken these
gates after seeing results. A revised hypothesis needs a new prospective record.

## R6. Delivery and ownership

Prospective path allowlist:

- core/source-ranking.mjs (new)
- core/contract.mjs
- core/moc-storage.mjs
- core/test/source-ranking.test.mjs (new)
- core/test/source-ranking-recall.test.mjs (new)
- adapters/openai/test/source-ranking.test.mjs (new)
- packaging/artifact-files.json
- packaging/test/source-ranking.test.mjs (new)
- evaluation/architecture/source-ranking-measure.mjs (new)
- evaluation/architecture/test/source-ranking-measure.test.mjs (new)
- docs/plans/source-idf-ranking.md
- docs/local-store.md
- docs/limitations.md (append)
- CHANGELOG.md

Primary owns this contract, independent acceptance and resource decision. A
GPT-6.1 Sol/high worker owns runtime/tests in an isolated worktree; a separate
worker may own only the measurement module/test after agreeing numeric private
interface. Standards and Spec reviewers are independent of both implementers
and review the same final SHA. No implementation begins until H4 broad gates
pass. Report focused status and interface completion; after two unsuccessful
correction rounds, escalate/rescope instead of repeating. No worker provider,
credentials/ledger, broad cleanup, merge or deployment authority.

Trace actual callers before editing. Run focused then complete core/OpenAI/MCP/
artifact/generic/workspace lifecycle gates, store/MOC/recall/OpenAI demos and
pinned plugin validation on both Node versions as applicable. Run resource gates
separately without concurrent heavy gates. Primary repeats key acceptance. Use
actual exit codes, independently cross-check changed paths and artifact lists,
preserve unrelated work. No UI/browser change is expected.

H5 does not authorize spending. Before the next stage, freeze two new authentic
diagnostic cases, support rubrics, code/config/provider scope and cost estimates;
verify the original cumulative400USD ledger and protected30USD reserve. Last
verified reservation342.162281USD is not a fresh ledger reading. H3 remains
closed. Later24-case and fresh30 gates in H4 remain prospective, not attained.
No merge/release/deploy. Primary stays active while jobs run; no unattended
handoff without verified product supervision. This turn's12-hour discussion
checkpoint remains2026-10-19 03:58UTC; this new plan does not restart the clock.

## R7. Prospective feasibility clarifications

Primary2026-10-18, before worker implementation or resource measurement. R1-R6
above remain unchanged; these clarify their acceptance, not relax it.

- R4's empty-query case means invalid empty/whitespace text rejects at the public
  contract, while valid punctuation-only text has zero tokens and keeps the
  existing deterministic zero-score order. Do not make empty text valid.
- Freeze worst20000 query tokens as `String.fromCodePoint(0x4e00+i)` for
  `i=0..1999`, query=`tokens.join(' ')+'?'`. It has exactly4000UTF-16 units and
  2000distinct whole tokens and must survive existing NFKC/redaction/whitespace
  validation unchanged. Primary independently checked this arithmetic and
  actual boundedText validation on Node22.16, exit0, before measurements.
- Freeze the worst20000 physical corpus in ascending synthetic-ID order, index
  `i=0..19999`. Even rows have the dense4000-unit query as body. Their four
  receipts use token blocks `[400*j,400*(j+1))` for `j=0..3`, joined by spaces
  plus`?`, each exactly800units. Odd rows have
  `tokens[i%2000]+' '+'x'.repeat(3998)` as body and
  `tokens[(i+j+1)%2000]+' '+'x'.repeat(798)` as receipt j. Stable distinct receipt
  identities and correctly computed receipt keys remain mandatory. Exactly
  10000dense/10000sparse rows and four receipts per row; no randomized density
  or post-result substitutions. This is a structural workload, not CJK quality
  evidence. Other cells retain the existing measure's explicit construction.
- Contention timestamps must form a conservative bracket, not merely first-BUSY
  to last-BUSY (a lower bound). Open both connections and finish initialization
  before the query-only start handshake. Confirm a successful zero-timeout
  writer probe before starting the one measured query. With no other connection
  writing this owned store, sample at a recorded nominal<=5ms interval until
  observing BUSY during that query. Record the last successful probe release
  before BUSY and the first successful writer acquisition/rollback after it.
  A single bounded5000ms writer-reservation attempt after BUSY can provide that
  upper endpoint and its independently reported actual wait/result; it must not
  overlap another probe-created write transaction. Use one probe clock for both
  endpoints, not unaligned process-local clocks.
- The upper bracket includes probe resolution/scheduling overhead. Pass only
  when overlap with the query (not core-open transactions) is established, the
  upper bracket is<2500ms and the bounded attempt succeeds in<2500ms. Report
  missing endpoints/overlap or a bracket crossing the threshold as inconclusive,
  never as zero blocking or a pass. A timeout/failing writer remains a failure.
  Sampled brackets are not an exact lock-acquisition timestamp or capture SLA.
- Freeze the private measurement boundary: runtime.queryCandidateRows receives
  optional `sourceRankingPolicy:'bounded-idf-v1'` plus the already validated
  `query` for the enabled path. It preserves the existing score/memoryLabel/
  sourceReceiptLimit/sourceCandidatePolicy arguments and old return shape when
  disabled. Enabled results add private numeric `ranking` metadata with
  `version`, `physicalRows`, `eligibleMemories`, `receiptReads`, `retainedRows`,
  `maskBytes`, and `queryTokenCount`. Counts distinguish initial scan receipt
  validation from any retained-source rereads in an additional numeric
  `retainedReceiptReads` field. This metadata stays out of public map/recall and
  model/telemetry payloads. Measurement must assert the version is actually
  active, so a silently ignored unknown option cannot pass as a new arm.

## Execution record

Primary read-only research inspected pinned872fd9 lexical scorer, source scan,
labels/cursors and existing measurement. Independent GPT-6.1 Sol/high researcher
confirmed equal whole-token overlap, per-passage maximum and1024/20000 scan
separation. A proposed two-pass scan was rejected before implementation because
BEGIN IMMEDIATE extends competing-writer blocking. Compact per-passage masks
are a prospective alternative, not yet a measured performance improvement.
Historical short-input timings/RSS are not used as current performance proof.

Primary dispatch preparation2026-10-18: R1-R7 prefix SHA256
`8ed97e23f6449d68e67fe8901cc5ec59410bc3a95d9e6e6411a53e9c7309926f`.
An independent GPT-6.1 Sol/high prospective review found the frozen query/corpus,
conservative query-only contention bracket and private measurement interface
unambiguous after R7. No measurements or provider calls informed these gates.
H4's frozen1a072c5 local complete gates passed on both runtimes, including1167
core tests each; both independent final-SHA reviews passed. PR#437 CI is still
being supervised; implementation dispatch waits for its remaining check.

Implementation ownership is split into two independently writable packets:
runtime/tests/docs in `source-idf-ranking` (all R6 paths except the two measurement
files), and the measurement module/test alone in `source-idf-ranking-measure`.
Both use GPT-6.1 Sol/high with the fixed R7 private interface; neither may edit
R1-R7. The primary integrates their scoped commits, personally verifies the
combined candidate and runs resource cells only after other heavy gates finish.
No worker may start the full resource experiment independently. Final Standards
and Spec reviewers must not be either implementer.

Runtime worker execution, 2026-10-19: continued the authorized isolated
`feat/source-idf-ranking` worktree at
`/home/chichieh/Github/cairn-memory-worktrees/source-idf-ranking`, base
`1a072c5eb05742841e5114b22ffc1478287fd3e8` and prospective plan commit
`e1faac0c332103206068c54c6618b66263a5e2e2`. Read CONTRIBUTING, CONTEXT, SECURITY,
the delivery/model-routing workflow and all R1-R7 before implementation. The
prospective prefix still hashes to
`8ed97e23f6449d68e67fe8901cc5ec59410bc3a95d9e6e6411a53e9c7309926f`.

Actual caller trace before edits: `openMemoryCore` validates constructor policy;
`recall` creates source-only navigation; private `mapPage` binds cursors and caches
one namespace snapshot; `runtime.queryCandidateRows` delegates unchanged to
`moc-storage`. The new branch performs one indexed physical scan, projected
eligibility before source reads, compact typed masks/per-memory union DF, sorted
query-token accumulation and retained-winner rereads inside the same trusted
transaction. Only numeric ranking metadata returns privately. Automatic rationale
discovery calls the same runtime method without the option and remains on the
old scorer. Public maps, capture/classification, ordinary recall and host wiring
have no activation. Excerpt/scorer/model prompts and runtime finalization were
not edited.

Affected checks and ownership: worker owns the new core oracle/recall tests,
strict adapter test, installed-archive test and predecessor query-candidate/keyset
regressions. Primary owns complete core/OpenAI/MCP/artifact/generic/workspace
gates, demos, pinned plugin validation, independent predecessor parity, combined
candidate acceptance and final double review. Separate measurement worker owns
R5; neither implementation worker authorizes resource promotion or paid work.

Focused command, with each absolute Node22.16.0/24.15.0 executable:
`node tools/testing/run.mjs core/test/source-ranking.test.mjs core/test/source-ranking-recall.test.mjs adapters/openai/test/source-ranking.test.mjs packaging/test/source-ranking.test.mjs`.
Both actual exits were 0, 25/25 tests each. Logs are retained at
`/tmp/cairn-idf-worker-evidence-BQzElu/focused-node22-final.log` and
`focused-node24-final.log`. The builder and test independently compared tar and
manifest listings, 101 paths, and matched ranking source/archive/installed SHA256.
Normal capture/classification plus cold reopen establishes predetermined source
visibility across both scan policies with scripted and actual o200k counters;
structural SQL fixtures are separately labeled and never quality evidence.
Tests retain all four inappropriate rare-token distractor choices, the hidden
rare-cue label and navigation-visible/rank-omitted source counterexamples.
Successful and deliberately failing subprocess fixtures close connections,
exit with exactly 0/1 and remove their owned scratch.

Failure evidence is retained, not replaced by the final green run. The initial
core command exited 1 (13/18), from fixture errors: incorrect filing DTO path,
missing fixture token counter, duplicate receipt identity violating its unique
key, an invalid non-null tombstone body, and a fetch freshness expectation.
`initial-failure-summary.log` is explicitly a transcription of those errors,
not a complete raw TAP log; the corrected core run exited 0 (18/18). Subsequent
raw `focused-node22.log` exited 1 (19/21): admission metadata omits body content,
so the adapter target lookup now uses canonical `get`; rank mutation reaches
the existing candidate-revision fence before the namespace-epoch fence.
Raw `focused-node22-r2.log` and `focused-node24.log` exited 1 (23/24): a three-row
HTTP fixture incorrectly assumed one rare token outweighed four generic tokens.
Its matched-wire query now uses one generic and one rare term, with an explicit
independent formula inequality; the 240-decoy actual-window fixture and frozen
R1-R7 remained unchanged. No runtime correction or gate relaxation resulted.

Exact freshness expectations follow existing authority: count/microtask/select
mutations return `index_revision_conflict`; mutation during source-fetch counting
returns `cursor_stale` when `fetchPage` rereads the saved epoch; rank mutation
returns `revision_conflict` when atomic `recallSnapshot` checks current rows first.
Earlier 34-test query-candidate/keyset regression run on Node22.16 exited 0.
The same command on Node24.15 exited 0, 34/34, retained in
`/tmp/cairn-idf-worker-evidence-BQzElu/predecessor-regressions-node24.log`.
Resource fit, independent final review and broad combined gates remain pending
primary verification; these focused passes establish no semantic gain or resource
claim.

## R8. Prospective test-only finalization clock correction

Primary2026-10-18, after combined4082f24 broad gates, before correction.
R1-R7 and all algorithm/resource thresholds remain unchanged. Both concurrent
Node22.16/24.15 core suites exited1:1188/1190passed; the same two unchanged
capture deadline tests failed because their injected target SQL was never
reached (`0 !== 1`), not because a checked rollback persisted a write. Each
isolated two-test rerun exited0; the whole19-test deadline file exited0.
The test file's SHA256 is identical to H4. A primary synthetic differential
probe on H4 and4082f24 showed the same four outcomes: no early delay reaches
the intended SQL and rolls back; a650ms earlier model-stage delay exhausts
the600ms budget before that SQL, while preserving the expected durable state.
This establishes sensitivity to earlier elapsed work; the original full-run
logs did not record per-stage timestamps, so exact host scheduling attribution
is not claimed. Raw failures and the diagnostic remain retained.

Extend R6 only by these two test-only paths; do not change runtime or CI gates:

- core/test/capture-invocation-deadline.test.mjs
- core/testing/capture-finalization-clock-child.mjs (new)

Replace only the two failing rationale/staged-final-admission fixtures with an
isolated-process controlled monotonic clock, following the existing placement
clock child pattern. Advance time only AFTER the actual target SQL has executed,
before the real transaction's post-work deadline check. Assert the target was
reached exactly once and its in-transaction writes were observable. Then assert
rollback preserves admitted sources/applied placement for rationale and prevents
memory/receipt/qualified-evidence admission for staged finalization, retaining
the pending/not-admitted disposition. Keep actual model/capture/storage paths.

For each case, a process-local loader mutation removing only the transaction
post-work check must produce a nonzero, specifically identified assertion and
observable durable writes; a missing mutation target or unrelated exception
does not count. No repository runtime mutation, relaxed timeout, skipped test,
accepted alternate error or increased product deadline is permitted. Child
scratch/resources close and clean on both the normal and deliberately failing
paths. All other deadline tests remain byte-for-byte unchanged.

One GPT-6.1Sol/high worker owns those two paths in an isolated worktree from this
prospective record. Primary owns integration/diagnosis and personally reruns the
full deadline file, combined core gates on both Node versions, original H5
acceptance and exact-candidate independent Standards/Spec reviews. Existing
resource cells remain unexecuted and cannot start until the corrected integrated
offline gates pass. Preserve R1-R7 prefix hash and record this additional scope
explicitly in the final inventory and PR; no semantic gain is inferred.

## Post-R8 execution

Pending worker implementation and primary acceptance. Resource campaign and
provider calls have not started.
