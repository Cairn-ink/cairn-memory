# MOC architecture diagnostic

This offline diagnostic isolates candidate visibility in the public core at
runtime base `5dbf73c`. Correct synthetic memories survive a cold SQLite reopen,
but late topics can remain outside bounded recall inputs. The separate
classification control also rejects a first-category proposal when unfiled
memory bodies fill its catalog page. No product runtime change or model-quality
improvement is demonstrated here.

The [retained raw report](../../evaluations/results/moc-architecture-v1.json)
contains all ten cases, generated IDs, observed page positions, callback visibility,
coverage states, lexical scores and local timings. Reproduce from this checkout
with Node 22.16 or 24:

```sh
node evaluation/live/moc-retrieval-diagnostic.mjs
node --test evaluation/live/test/moc-retrieval-diagnostic.test.mjs evaluation/live/test/moc-lexical-baseline.test.mjs
```

The CLI creates fresh synthetic temporary SQLite files and prints JSON. UUIDs,
timestamps and timings vary between runs; fixtures and topic ordering keep the
late-topic result independent of UUID ordering. The experiment does not load user
databases or credentials and makes zero provider requests.

## Observations

Counts below mean required target memories, not answer accuracy. “Oracle” is a
scripted selector that knows target IDs but can select them only if present in
the actual core input. Lexical retrieval receives only active, namespace-filtered
`id`/`content` records and the query; target labels are used afterward for scoring.

| Case | Corpus | Target map page | Visible / required | Oracle recalled | FTS5 recalled |
| --- | ---: | --- | ---: | ---: | ---: |
| English small | 16 | 1 | 1/1 | 1 | 1 |
| Unfiled distractors | 16 | 1 | 1/1 | 1 | 1 |
| English late | 224 | 3 | 0/1 | 0 | 1 |
| English misfiled | 224 | 3 | 0/1 | 0 | 1 |
| English early | 224 | 1 | 1/1 | 1 | 1 |
| Unfiled behind filed | 224 | 3 | 0/1 | 0 | 1 |
| Chinese contiguous | 16 | 1 | 1/1 | 1 | 0 |
| Chinese spaced control | 16 | 1 | 1/1 | 1 | 1 |
| Paraphrase control | 16 | 1 | 1/1 | 1 | 0 |
| Multiple evidence, late | 224 | 3, 3 | 0/2 | 0 | 2 |

All ten cases retain direct-read support, complete target inventory and namespace
isolation. Small cases expose 18 map items, except the unfiled-distractor case's
17 items, in one selection callback and then call ranking once. Each large case
exposes two batches of 100 map items;
only the early-target case reaches ranking. Large cases report
`budget_exhausted`, including the successful early retrieval. Small cases report
`complete`. These core coverage states describe traversal, not semantic answer
completeness. The report's `observed` status likewise means the diagnostic ran
with its storage/isolation checks intact; it does not turn a retrieval miss into
a success.

The classification controls have zero existing MOCs and propose the same
`First category`. With one unfiled memory, the callback sees one item and
`mapExhausted: true`; the proposal is accepted. With 101 unfiled memories, it sees
100 items and `mapExhausted: false`; the result is `invalid_model_output`.
This is an isolated catalog-completeness bottleneck, retained as a failure.
The live diagnostic imports the checked-out core, so later catalog changes can
change that observation. Its test enforces rejection when the catalog is
incomplete, while permitting an empty, complete topic-only catalog to succeed;
the retained JSON above preserves the baseline outcome. Independent review added
the missing same-namespace unfiled-distractor fixture before delivery; the full
offline report was regenerated with that tenth case, without choosing favorable
UUIDs or changing the four late-target misses.

## Interpretation and limits

A query-independent candidate prefix cannot retrieve an absent target, even with
perfect selection inside that prefix. The early/late controls demonstrate this
visibility constraint; they do not measure a real model's topic reasoning.
The oracle's Chinese and paraphrase successes cannot be compared as semantic
advantages over lexical retrieval.

Both arms cap output at 12. Their work differs: FTS5 indexes all 16 or 224 active
documents before ranking, while MOC recall exposes bounded map batches. The
baseline's `scannedDocuments` is corpus size, not measured SQLite page I/O. Its
timing includes constructing the transient FTS index but excludes the preceding
core corpus reads. MOC timing covers the recall call. Byte counts are serialized
callback input sizes; the constant-one token counter deliberately isolates row
ceilings and is not provider token accounting. These single-run local timings
are not a latency benchmark, cost comparison or paid quality result.

## Primary research and next experiment

[RAPTOR's querying comparison](https://arxiv.org/html/2401.18059v1) distinguishes
query-ranked root-to-child traversal from searching nodes across all hierarchy
levels. Its 20-story QASPER comparison favored the latter, which it used for main
experiments. This supports testing searchable summaries and query-aware candidate
generation; it does not establish exclusive MOC routing as best for this corpus.

[SQLite's FTS5 documentation](https://www.sqlite.org/fts5.html) specifies that
`unicode61` groups contiguous letters into tokens. Here, querying `小林` fails
against `維護窗口由小林負責。` but succeeds when spaces separate the name. The
baseline also retains the `vehicle caretaker` versus `maintains the automobile`
paraphrase failure. Trigram matching is another experiment, not an automatic fix:
FTS5 full-text trigram queries shorter than three Unicode characters do not match.

[LongMemEval's primary implementation](https://github.com/xiaowu0162/LongMemEval)
separates retrieval evaluation using evidence locations from generated-answer
evaluation. Follow that separation in the next frozen experiment: measure evidence
recall and multi-evidence coverage independently of answer correctness and
abstention. First isolate the classification catalog fix; then compare lexical
candidate generation with optional bounded link expansion or actual query-ranked
hierarchy routing. Preserve direct hits, Chinese and paraphrase controls, and
misfiled/unfiled cases. A real-model follow-up needs its own frozen queries and
budget controls; this offline report establishes no real-user benefit.
