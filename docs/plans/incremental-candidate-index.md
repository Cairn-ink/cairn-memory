# Incremental candidate-index offline experiment (IC1–IC6)

Fixed base `c118c0f0fd70af01c63ea1339305de03eeb84c94`; isolated branch
`experiment/incremental-candidate-index`. Owner: GPT-6 Sol, high effort. This
plan and `incremental-candidate-index-fixtures.json` are frozen in a separate
commit **before** any result-producing run. No fixture/query/label/cap tuning
after output. The experiment alone may create fresh private synthetic SQLite
files; no public core/runtime, schema version, provider, user DB or real ledger
is changed.

## Frozen inputs and comparisons

- Sizes: exactly 100, 1,000 and 10,000 authorized current memories **after**
  mutations, seeded separately. The fixed generator inserts `size + 1` rows:
  ordinary row `Synthetic bank record {zero-padded ordinal} stores slate marker
  {zero-padded ordinal} on a neutral shelf.` at every non-special position;
  special keys occupy positions 0–7 and `size` (tail). Correct keeps one row,
  forget removes one current row, and supersede trades one current predecessor
  for one current successor, yielding exactly `size` current rows. Tail is
  beyond the first 1,024 in **ID-ordered** memory scans only at 10,000 because
  setup assigns ascending synthetic UUIDs
  `00000000-0000-4000-8000-{12-digit insertion ordinal}`; this is setup-only,
  not an evaluator feature or query input. Foreign-volume control adds 10,000
  rows with fixed text `Private lilac charter for foreign record {ordinal}.`
  in a separate same-owner project; neither its hits nor its size may change
  authorized ranking or output caps.
- Caps: return top 5 refs; materialize at most 24; keyset comparator scans at
  most 20,000 authorized current rows and reports exhaustion/incomplete.
  Index query work is bounded by 5 quoted terms and 20,000 matching documents
  after namespace/current/projection filtering; SQLite FTS posting work itself
  is unknown and separately disclosed. A size run has a 120-second test bound.
- Score: lowercase ASCII `[a-z0-9]+` **whole Unicode word runs** as distinct
  query terms only; discard a whole non-ASCII word rather than deriving an
  ASCII fragment such as `caf` from `café`. Per document
  count distinct overlaps, then per memory take the maximum document score.
  Body and first four receipts ordered by receipt `id` participate; there
  is no union of terms across documents and no corpus-global BM25/IDF. Both
  index and scan use the same score and deterministic tie break by memory UUID
  on the same DB, not evaluator labels or synthetic ordinals. The sidecar stores **all** receipts; query filters
  to the first four before score/rank. This makes receipt mutation trigger work
  incremental without a five-document refresh. FTS5 uses `unicode61
  remove_diacritics 0`, but the comparative query language is intentionally
  ASCII-only. Frozen Chinese substring and accent-folding queries are negative
  controls, not token-equivalence claims. Literal FTS operators are quoted.
  SQLite `unicode61` and JavaScript Unicode word categories may differ on
  edge code points; only the frozen ASCII comparison is asserted.
- Timings: one build per size and three repeats of every fixed query, monotonic
  elapsed milliseconds. Report finite aggregate timings/counts only, as
  shared-host observations without percentiles, speedup confidence or model
  quality claims. Include per-write/correct/forget maintenance, DB/WAL bytes,
  document and active-row counts. Full 10,000 is an explicit measure command;
  The measured full 10,000-row, 13-query cell is an explicit command, not an
  ordinary CI measurement. Ordinary CI also includes large functional boundary
  fixtures (10,000 foreign/tail rows and a >20,000-row cap test); these are
  safety checks, not growth measurements.

The fixture separates `query` from private `expected` labels/keys. The fixture
also freezes the corrected content `Updated bronze timetable is current.`,
the supersession replacement `Current indigo rota is adopted.`, four neutral
receipts `Neutral receipt {1..4}.` and fifth target receipt, and a new
generation/exclusion mutation `Fresh onyx compass is present.` with no query
  label tuning. Fixture setup inserts fixed ascending experiment-only
  ascending UUID-format receipt IDs
  `20000000-0000-4000-8000-{12-digit global receipt ordinal}` directly into the
  fresh synthetic DB. This is setup instrumentation, **not** a public API
  capability or proof of public receipt-ID control; later public core mutation
  tests run separately and add their own UUIDs.
Expected
positives: exact body, >1,024 tail at 10,000, receipt-only first-four hit,
corrected replacement, new generation after rebuild. Query labels also include
zero-target expectations for foreign, deleted, historical, superseded,
fifth-receipt-only, CJK partial, accent folding, literal operator and no-match.
These are **diagnostic** labels, not safety gates that force empty results:
`former indigo` may retrieve the *current* replacement by one lexical term.
Safety checks separately forbid the historical predecessor ID, deleted ID,
foreign ID and fifth-only document from the authorized candidate set. Reports
never include raw source/query/answer, IDs, paths or
hashes. Labels remain evaluator-private and cannot enter retrieval input.

## Mechanism and safety acceptance

1. Preflight native FTS5 and `fts5vocab` on actual Node 22.16 and 24.15 with
   `trusted_schema=OFF`. If persistent SQL triggers calling FTS5 are blocked,
   record the exact failure; do not enable trusted schema or alter core.
2. Install experiment-prefixed sidecar tables, FTS5 and persistent triggers
   only in a fresh experiment-created core DB. Backfill, cold reopen and
   mutations through public core `admit`, `correct`, `forget`, `supersede`,
   receipt dedup, `applyPlacement` and `rebuildIndex` must preserve current
   sidecar state in the same transaction, or the mechanism is a failed result.
   Force a trigger fault and verify both core and sidecar roll back.
3. Before ranking, require exact namespace and non-null active generation.
   JOIN `index_read_memories` on current revision and physical active,
   nondeleted memory. Recheck namespace epoch before and after, then use public
   `core.get` and receipt pagination for bounded materialization; `get` alone
   does not prove active-generation membership. A mutation between query and
   get rejects stale refs. Index returns refs, not source text.
4. Comparator is an explicit bounded `(id)` keyset scan of the **same**
   authorized active projection and the same document score; record rows
   scanned and incomplete state. Test rollback, cold reopen, namespace and
   foreign-volume invariance, active-generation exclusion, correction,
   logical forget, supersession, fifth-only receipt, race and literal syntax.
5. Source/snapshot/receipt text stays inside the synthetic private process/store
   and never enters the report.
   Sidecar document and contentful FTS tables copy full synthetic source text
   as well as lexical derivatives and are not forensic
   erasure; update `docs/protocol.md` and `docs/limitations.md` accordingly.
   This experiment neither changes fixed public retrieval nor demonstrates
   MOC/model/QA advantage or S1/S2/S4 completion.

Implementation safeguard recorded after the frozen inputs (not a measurement
parameter or label change): public `get` receipt pagination uses pages of four
and fails incomplete before a 27th page. This prevents unbounded paging but
can also reject a legitimate memory with more than 104 receipts; it is not a
completeness claim for high fan-out and does not imply SQLite scanned only
104 rows.

## Entrypoints and gates

Only experiment CLI/test/package script are new callers. Public core writes
and index readers are exercised as dependencies but remain unchanged. Run
Node 22.16 and 24.15: focused tests, `npm test`, `npm run validate`, strict
plugin validation, small-size demo and explicit full-size measure. Run core
tests/demos if integration reveals a core defect. Record exact candidate SHA,
commands, raw failures and meaningful counts here after the result-producing
work. No push, PR, merge or provider call in this packet.

## Retained diagnostic evidence (post-freeze, no label changes)

The first Node 24.15 full-size invocation of
`npm run measure:incremental-candidate-index` emitted `size_timeout` after
the CLI's 120-second child-process watchdog. That uncommitted WIP query used
`ci_vocab` `instance` rows, `v.term IN (wanted terms)`, authorized/current
joins and `COUNT(DISTINCT v.term)` per document. There is **no saved SHA for
that red implementation**; the tool transcript retains the original WIP
source and command output. A later same-DB, query-only reconstruction on the
first eight frozen 10,000-row queries measured 0.2–64 ms for old vocabulary
counts versus about 55–60 ms for the replacement posting query, with equal
authorized document counts. The reconstruction stalled at the ninth, foreign-
volume query for over 30 seconds and was interrupted (exit 130). This is
evidence of a foreign-volume sensitivity in that reconstructed query, not
proof of the whole original timeout's unique cause. No fixture/label was
changed in response. The replacement counts distinct per-term FTS5 postings
in SQL, then SQL max-score/top-five refs; the `fts5vocab` table remains
installed and preflighted. SQLite internal posting work remains unknown.

Independent controlled profiling on one frozen 1,000-authorized-row DB varied
only the number of synthetic foreign rows (1/100/1,000). The reconstructed old
vocabulary count for the fixed foreign query took 3.805/248.276/2,535.487 ms;
the replacement full count-and-rank took 5.665/5.172/12.650 ms, while the
unchanged scan comparator took 17.962/14.073/27.151 ms. Authorized matches
and returned refs were zero in every cell. A sparse fixed query on the same
1,000-row DB had old count 5.426 ms plus rank 4.988 ms, replacement 5.382 ms,
scan 16.584 ms, with three document matches and equal refs. The controlled
foreign growth supports an old-query foreign-posting/projection-join
amplification hypothesis; it does not establish the unique cause of the
original whole-cell timeout. No internal SQLite visit count was measured.

The replacement full 10,000-row CLI completed within the 120-second bound on
Node 24.15 (~10.75 seconds shared-host wall time) and Node 22.16 (~8.59
seconds). Both had 10,000 current authorized plus 10,000 foreign current rows,
30,005 sidecar documents, and 13 fixed queries repeated three times. The
frozen historical and literal-operator zero-target labels each returned one
other current lexical match; no forbidden historical predecessor, forgotten
memory or fifth-only source was returned. This is diagnostic mismatch, not a
label repair or semantic win. Before the final commit, `npm test` passed
127/127 on each Node 22.16 and 24.15; `npm run validate`, strict plugin
validation, and `npm run demo:incremental-candidate-index` passed on both.
The explicit 10,000-row `npm run measure:incremental-candidate-index` passed
on both. The final candidate SHA is reported in the handoff after commit;
these timings are not official performance benchmarks.
