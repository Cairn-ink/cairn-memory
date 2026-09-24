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
  beyond the first 1,024 only at 10,000. Foreign-volume control adds 10,000
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
  CI tests use small sizes.

The fixture separates `query` from private `expected` labels/keys. The fixture
also freezes the corrected content `Updated bronze timetable is current.`,
the supersession replacement `Current indigo rota is adopted.`, four neutral
receipts `Neutral receipt {1..4}.` and fifth target receipt, and a new
generation/exclusion mutation `Fresh onyx compass is present.` with no query
  label tuning. Fixture setup inserts fixed ascending experiment-only
  `ci-receipt-{six-digit memory ordinal}-{1..5}` receipt IDs directly into the
  fresh synthetic DB. This is setup instrumentation, **not** a public API
  capability or proof of public receipt-ID control; later public core mutation
  tests run separately and add their own UUIDs.
Expected
positives: exact body, >1,024 tail at 10,000, receipt-only first-four hit,
corrected replacement, new generation after rebuild. Expected negatives:
foreign namespace/volume, deleted, historical, superseded, excluded active
generation, fifth-receipt-only, CJK partial, accent folding, literal operator
and no-match. Reports never include raw source/query/answer, IDs, paths or
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
5. No source/snapshot/receipt text leaves the synthetic private DB or report.
   Sidecar FTS stores sensitive lexical derivatives and is not forensic
   erasure; update `docs/protocol.md` and `docs/limitations.md` accordingly.
   This experiment neither changes fixed public retrieval nor demonstrates
   MOC/model/QA advantage or S1/S2/S4 completion.

## Entrypoints and gates

Only experiment CLI/test/package script are new callers. Public core writes
and index readers are exercised as dependencies but remain unchanged. Run
Node 22.16 and 24.15: focused tests, `npm test`, `npm run validate`, strict
plugin validation, small-size demo and explicit full-size measure. Run core
tests/demos if integration reveals a core defect. Record exact candidate SHA,
commands, raw failures and meaningful counts here after the result-producing
work. No push, PR, merge or provider call in this packet.
