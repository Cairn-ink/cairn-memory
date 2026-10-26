# Frozen synthetic P2 qualification fixture

Revision 1, `p2-qualification-fixture-v1-r1`, fixed seed in `seed.json`, for frozen
`context-read-product-v1` and protocol `P2-product-v3`. This is authored synthetic
qualification data, not a product snapshot or a retrieval/performance result.
Every project and actor is invented. No network, credentials, provider, model,
real person, or real organization is used. All files stay in this fixture directory.

## Generate and verify

Use Node 22.16.0 or 24.15.0 from the repository root:

```sh
node evaluation/context-read-product/fixture/freeze.mjs
node --test evaluation/context-read-product/fixture/fixture.test.mjs
P2_FIXTURE_W3=1 node --test evaluation/context-read-product/fixture/fixture.test.mjs
```

`freeze.mjs` explicitly generates six physical stores (W1/W3 × v18/v23/v33),
validates them, writes catalogs/JSON labels/plain-text auditor notes/statistics,
then hashes every local file except the manifest itself. v23 uses disk stores;
v18/v33 validation uses the public in-memory opener to avoid repeated disk fsyncs.
`canonicalBytes:null` explicitly means no disk size was collected for that
variant. A previously verified disk result retains its actual file size. Set
`P2_FIXTURE_REUSE` to a directory of closed `.sqlite.fixture.json` generation
results to resume authoring without repeating successful work; their logical
digests/version/schema are checked before reuse. This is never measurement reuse.
Scratch stores are
deleted after completion. Regeneration changes the freeze; do it before any
measurement. After a source-only edit, `rehash.mjs` updates the manifest without
regenerating stores; the deterministic test still checks source/output agreement.
Never edit labels after observing retrieval. A changed corpus, workload or label
requires a new fixture version and new registration.

For a persistent store, import `generateWorld` from `generator.mjs` and await
`generateWorld({path, world:'W1', schema:23})`; `path` must not exist, and its
directory must be private. W3 and schemas 18/33 use the same interface. The
returned catalog records actual engine UUIDs, revisions, content hashes and
receipt identities. It also writes `path + '.fixture.json'` and a `.progress`
scratch log beside the store. Never include this scratch location in registration.
The caller must supervise the awaited operation. Worker progress is available via
`onProgress`; the generator bounds each worker to 600 seconds and awaits its exit.

An isolated child installs deterministic UUID/byte entropy and a fixed wall clock
before loading the engine. Entropy is scoped to each named public operation, so
cohort-zero Memory/Card identities remain stable across world sizes and schemas.
These overrides never affect the parent process or runtime files. All data and
schema creation uses public `openMemoryCore`, `admit`, `supersede`,
`applyPlacement`, `linkMocs`, `createCardDraft`, and `confirmCardDraft`. There is
no SQL write, schema installer, relabeled version, capture hook or model stub.
Public inspection supplies final revisions and canonical content. SQL inspection
is read-only. v18 has no Card tables; v23 installs Cards through its public option;
v33 uses the public method-package/current-dependency options, with no optional
retrieval sources enabled and no package dependency declarations.

The ordinary test generates W1 twice plus v18/v33 using the public `:memory:`
opener for speed. A child-local connection observer permits read-only physical
assertions before public close. It compares full catalogs to the disk-generated
freeze. It also validates every W3 label/hash without generating W3. Actual W3
regeneration is opt-in. The same single test checks temporal windows, full-body
zero-token intersections, complete before/reason evidence, namespace majorities,
subtle distractor eligibility and plausible missing-property negatives; no latency or contention assertion belongs in this test.

## World shape and lengths

One owner has personal plus `mist-prism`, `moss-chord`, `sand-orbit`. W1 has
278 Memories and 24 confirmed/current/eligible Cards per namespace: 1,112
Memories, 96 Cards. Twelve Memories are superseded through public operations,
and their successors are included in the 1,112 total. W1 has 60 L1 + 11 L2 MOCs,
distributed 18/18/18/17. Each namespace has a shared L1 child and multi-parent
filing; about one ninth of non-anchor active Memories remain unfiled.
W3 has three cohorts of this shape: 834 Memories and 72 Cards per namespace,
3,336 Memories, 288 Cards, 180 L1 + 33 L2 MOCs, 36 historical Memories.
Cross-cohort copies of an answer are explicitly acceptable alternatives in W3.

All lengths below are UTF-16 units after the public write path. Per namespace
per cohort, Memory bodies are 194 × 240, 56 × 900, 22 × 2,400 and 6 × 3,990
(near the 4,000-unit maximum). Card bodies are 12 × 360, 6 × 900, 5 × 3,000
and 1 × 19,900 (near the 20,000-unit maximum). The same rules apply at 3×.
Each Card has one submitted note; lengths cycle 320/400/1,200/19,000.

Memory receipt counts cycle 1/1/1/2/3 by local slot. Receipt lengths cycle
80/80/80/240/240/600/790/800 by `(slot + receiptIndex) mod 8`. User and
assistant receipt roles are included. `statistics.json` freezes the exact
histograms, UTF-8 byte totals, per-namespace counts, physical file sizes and
logical digests for every size/schema. Catalogs retain each receipt id/hash/length.
Whitespace, decomposed combining marks and ZWJ emoji are submitted deliberately.
Memory NFKC/whitespace normalization is reflected in canonical hashes; Cards
retain leading whitespace and decomposed marks. No expected text is compared
against an unnormalized Memory submission.

## Queries, labels and auditing

`queries.json` has **134 questions**: 76 zh-Hant, 20 Japanese, 28 mixed
(20 zh/en, 8 ja/en), and 10 negatives. Twenty-two require superseded Memories;
twenty require evidence from multiple namespaces. The negative group retains
4 zh-Hant, 3 Japanese, 2 zh/en and 1 ja/en questions. These are overlapping
dimensions, not extra populations to add to the category totals.

Revision 1 mirrors product-supplied user question styles using invented products:

| Tagged dimension | Count | Ground-truth rule |
| --- | ---: | --- |
| `shortTemporal` | 8 | Literal question text is 7–10 Unicode characters; all dated events in its frozen window are required. |
| `productTerm` | 8 | Mixed zh/en questions using MCP, embedding, WAL, API/TTL, readSet, cron and backup. |
| `zeroSharedTokens` | 10 | Natural paraphrases with no frozen T1 token shared with any required or acceptable-alternate full canonical candidate body. |
| `naturalHistory` | 6 | Require the superseded value AND its successor's stated change reason. |
| `ownerWide` | 12 | Answer is outside the namespace containing a strict majority of related records; six direct questions plus six distractor challenges. |
| `distractorChallenge` | 6 | Correct adopted decision must override a plausible suggested alternative in the question. |
| `notInMemory` | 10 | Existing subject, plausible missing property; abstention is correct. |

Temporal questions include `我這週在做什麼`, `上週決定了什麼` and
`我最近都在忙什麼`. The frozen interpretation is **2026-10-27 12:00 +08:00**,
Asia/Taipei. This week is [2026-10-26, 2026-11-02), last week is
[2026-10-19, 2026-10-26), and recent is [2026-10-21, 2026-10-28).
The source text contains explicit event dates; `eventDate` metadata explains the
labels. Event dates, not the fixture's fixed storage-write timestamps or the
measurement machine's clock, define these windows. A runner must retain the
frozen anchor when interpreting first-person temporal questions.

`scenarios.json` replaces 50 filler slots per cohort with 8 dated facts,
10 zero-overlap answer facts, 8 product-term facts, and 24 related-topic records.
Memory/Card/MOC counts, receipt counts and all length buckets are unchanged.
Six older/newer Memory pairs also gain explicit successor-body change reasons;
the already-existing 12 supersessions per W1 remain intact.

For each of six related topics, three discussion/suggestion Memories live in
one namespace and the single adopted decision lives in another. One decision
is a Card; five are Memories. W3 repeats this ratio 3x. Labels record actual
related refs, namespace counts and the strict-majority check, rather than using
`crossNamespace` as a proxy: one owner-wide answer can require only one ref in
an unexpected project. The complete four-namespace readSet still applies.

Each topic has one proposal and one rejected suggestion: **6 + 6 in W1,
18 + 18 in W3**. Both are naturally phrased (`不妨試試…`, `我偏好…`), overlap
terms with the adopted decisions, and remain current, eligible Memories with
the same decision kind. They contain no `尚未採用`, rejected, quoted or other
explicit non-adoption markers. Hidden ground truth uses `adopted:false` and
`adoptionStatus:'proposal'|'rejected-suggestion'`; `resolution` explains the
authored outcome. This metadata lives only in catalogs/labels, never in stored
bodies, receipts, source notes, MOC titles or candidate text. It must not be used
to prefilter engine candidates; false adoption is a later scoring outcome.

Zero-overlap proofs use frozen `hr1-t1-v1` against the **entire actual canonical
Memory body**, including namespace/cohort prefix and padding, for every required
and alternate ref. Proofs bind the stored body hash. For example, an invented
relational-engine change answers `資料庫換成什麼了` through different wording.
These are answerable questions: empty lexical retrieval is a known ceiling miss,
not a correct abstention. Report this tagged subset separately; do not relax
labels or introduce a tokenizer/substring fallback to conceal that ceiling.

All ten negatives now ask missing properties of familiar subjects: queue budget,
drill contact extension, export compression ratio, signing algorithm, maintenance
cost, acceptance certificate number, billing currency, MCP certificate fingerprint,
embedding training population and WAL disk warranty. There are no `不存在` or
`未記録` hints. Auditor notes name the absent property; unrelated nearby facts
cannot satisfy it.

`labels-W1.json` / `labels-W3.json` freeze exact typed engine refs and namespaces,
intent, schema applicability, answer facts and acceptable alternates. Required
groups are AND; a required ref or one explicitly listed alternate satisfies that
group. Repeated paraphrases share evidence intentionally. Curated Cards can
substitute only where they contain the same authored fact. v18 runs use only
queries marked applicable to v18, with Card alternates filtered out; negative
queries on v18 request Memory only. Card-only questions are never assigned fake
Memory evidence. All four namespaces must be selected, with the frozen full
coverage descriptor in `parameters.json`; no per-namespace quotas or host RRF.

`why-W1.txt` / `why-W3.txt` give every query's fact, exact refs, namespace,
current/historical state, supersession successor and alternate reasoning. An
auditor can inspect these alongside a generated world without reading code.
Negatives ask absent properties of existing subjects: abstain even if unrelated
lexical hits occur. Receipt/note padding adds no facts beyond the authored catalog.
The frozen single-Han tokenizer miss in `diagnostics.json` is a separate diagnostic: search `砂`
against bodies containing `砂羽`, report the T1 known miss separately, and never
score it as an absent-answer negative or a new regression.

This relevance fixture is not the independent BM25/RRF rank oracle required by
P2-07. It does not certify pooled-statistic ranking, request lifecycle, authority,
maintenance, or acceptance. It freezes the corpus/relevance population needed
before those checks or performance measurements.

## Writer replay and measurement boundary

`writer-workload.json` freezes request pacing, capture/review mix, target owners,
operation-only cells, five 30-second contention windows, pump cadence/budgets,
availability populations, freshness targets, censoring and final drain ceilings.
`workload.mjs` deterministically produces operation payloads and 120 unique probes
per applicable type, both intents. Record actual returned ids and native eligible
commit times. Card draft creation is not eligibility; confirmation is. v18 has
Memory targets only. Other-owner setup is explicit and outside owner-wide counts;
its new items are excluded from the read projection. Do not add another owner to
the selected readSet. No setup writes count toward contention/freshness samples.

The offline persistence replay uses `admit` and `supersede` for synthetic Memory
capture/review, and authored draft/confirmation for Cards. It invokes no extraction
or rationale model. Production capture/review path binding, unchanged production
deadlines and diagnostic instrumentation remain measurement-harness obligations;
these persistence operations cannot stand in for their production latency gates.

The fixture does not run or schedule measurement. Before any run the primary
must register the expanded §10 cell inventory/count, deployed Node patch,
filesystem/hardware/load, implementation commits, exact counter, production
writer deadlines, diagnostic capacities/drain coverage and manifest digest.
Required worlds, physical schemas, both intents, languages, methods, bounds,
fresh/cold/warm populations, DELETE/DELETE and WAL/WAL, same/other-owner loads
and paired controls remain separate. Exactly three warm-ups, 50 successful main
and 10 successful cold requests use the 500/100 attempt ceilings. Normal request
errors remain in availability/all-attempt populations. Pump gaps are not excluded.
Freshness probes are not normal availability attempts. A missing, failed,
invalid or inconclusive required cell cannot become a blanket pass.
