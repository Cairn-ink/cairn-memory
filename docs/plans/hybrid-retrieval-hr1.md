# HR-1: hybrid candidate retrieval, frozen offline protocol (v2)

Status: **v2, frozen before any result-producing run.** v1 (`d1a64f5`) was
revised after an independent, non-author, read-only design audit (Codex
`hr1_protocol_audit`, gpt-6.1-sol/xhigh) found six P0 and eight P1 issues.
At that point no fixture, harness or result existed. Goals and boundaries are in
the [research charter](memory-next-stage-charter.md).

Branch `experiment/hybrid-retrieval-hr1`, based on PR #468 head
`3f6590584e746cc596c7859c9b0a00ae808941b6`. No public core API, schema, default,
adapter or installed artifact changes. Main `cd6d1ad` has identical retrieval and
ranking code, so results apply to both.

## 1. Question

> On one frozen bilingual (Traditional Chinese / English) synthetic corpus, does
> fusing an embedding channel with a strong CJK-capable lexical channel retrieve
> more required evidence than that lexical channel alone, without losing
> exact-term and Chinese-term queries?

The question is answered separately for two deployment contexts:
- **local**: an offline engine using open models;
- **hosted**: the product calling the OpenAI embeddings API.

Beating the current `selectEvidence` is not informative and is reported only as
a baseline. It scans in random-UUID `id` order (default 128 rows), keeps the
first `limit` rows with at least one overlapping whole-run token, then sorts
them. Contiguous Han text is one token.

The September flat-vs-MOC ablation found no MOC-routing advantage and left CJK
segmentation and paraphrase open:
- [plan](https://github.com/Cairn-ink/cairn-memory/blob/experiment/candidate-retrieval-ablation/docs/plans/candidate-retrieval-ablation.md)
- results: `git diff origin/main...origin/experiment/incremental-candidate-index -- docs/limitations.md`

## 2. Decision rule

### 2.1 Dev split only, recorded in `selection.json` and committed before any test run

1. **Lexical comparator L\***: whichever of A1 and A1+ has the higher dev macro
   recall@12 at S1000. Ties go to A1.
2. **Fused configuration per embedding model**: chosen from the confirmatory menu
   (§5.3) by dev macro recall@12 at S1000. Ties go to A3, then F-RRF60, F-RRF10,
   F-MM.
3. **One confirmatory pair per context**:
   - local: the better of e5-small and bge-m3;
   - hosted: the better of openai-3-small and openai-3-large.
   - Ties go to the cheaper/smaller model.
4. **Ease check**: if L\* reaches ≥95% recall@12 in every C1–C7 category at
   S1000 on dev, the suite is too easy. Revise the fixture (new version) before
   any test run. Saturation is inconclusive, not a result.

### 2.2 Confirmatory test

Test split, S1000. Each context's nominated pair is compared with L\*;
points are percentage points.

| Outcome | Condition |
| --- | --- |
| Continue: default-on candidate for that context | All of: Δmacro ≥ +5; Δ on C3 ≥ +10; cluster-bootstrap **97.5%** CI lower bound of Δmacro > 0 (Bonferroni for two contexts); at most one C1∪C2 test query has strictly lower group recall@12 than under L\*; latency gate (local warm request-level p95 < 200 ms; hosted < 1,000 ms) |
| Keep optional (not default-on) | Δmacro < +3, or two or more C1∪C2 test queries lose recall@12 |
| Inconclusive | Otherwise |

- **No test-grid rescue.** Other models, configurations and strata on the test
  split are exploratory.
- **Model failures** affect only their own context. If both models of a context
  fail, that context is "unavailable".
- **The regression guard is observational.** With about 14 test queries per
  category, one query is about 7.1 points.
- The secondary A5 decision is in §5.5.

## 3. Fixed conditions

- **Runtime**: Node 22.16.0; tests also on 24.15 when available. Record CPU,
  cores, threads, RAM and OS in every report.
- **Dependencies**: only `evaluation/retrieval-research/package.json`, exact
  versions, installed with `npm ci --prefix evaluation/retrieval-research`.
  Core dependencies and APIs are unchanged.
- **Local models**: pinned by repository and revision, fp32, CPU, exact cosine.
  Weights are cached outside the repo; queries run offline.
- **OpenAI API**:
  - Models `text-embedding-3-small` and `text-embedding-3-large`, with
    `encoding_format: "float"` and no `dimensions` parameter.
  - `openai-3-large@1024` is derived locally: the first 1024 dimensions,
    L2-renormalized.
  - Responses are cached by (model, text SHA-256).
  - Every HR-1 API call shares a **US$1 cap** under its own ledger: a
    pre-dispatch reservation from a token estimate, stopping before the cap. It
    does not use the repo's shared experiment ledger or any other session's
    budget.
  - The key exists only in the primary's run environment
    (`~/.config/cairn-hr1/openai.env`). Workers test against a fake HTTP server
    only.

## 4. Fixture (`evaluation/retrieval-research/fixtures/`, version `hr1-fixture-v2`)

Synthetic only. No real user, product or benchmark data; LongMemEval IDs are
never used.

### 4.1 Pipeline and author independence

1. **World author (W1)** writes scenario *families* and canonical *facts*. It
   then renders target memories with spans, distractor memories and foreign
   memories, producing `hr1-facts.json` and `hr1-corpus.json`.
2. **A script** produces `hr1-facts-view.json`: facts with metadata only
   (family, statement, kind, state, time, entities, the languages of memories
   expressing the fact, and body/span-only coverage). It contains no memory or
   span text.
3. **Query author (W2)**, a different worker that never sees corpus text or any
   retrieval output, writes `hr1-queries.json` from the facts view. Queries
   reference required facts by ID.
4. **A join script** derives `hr1-labels.json`. For each query and required fact
   there is one *evidence group*: the eligible memories expressing that fact,
   each marked `where: body|span`. It also records hard negatives (same-family
   memories that share an entity with a required fact but express none) and the
   category check results.
5. **Label auditor (W3)**, neither W1 nor W2, adjudicates:
   - alternative valid supports, including S1000 extras or foreign items that
     newly answer;
   - category validity;
   - near-miss and C6 semantics.
   It records overrides with reasons in `hr1-label-audit.json`.
6. **The validator passes** and the fixture files are frozen by SHA-256 in a
   separate commit.

### 4.2 Corpus

- **Families** are scenario groups (one decision thread, one vendor
  relationship). All queries of a family share a split.
- **Facts**: `id`, `family`, `statement`, `kind`
  (fact/preference/decision/instruction/context/reason/event), `state`
  (current/historical/rejected/proposed), `supersedes`, `eventTime`, `entities`.
  *Absent facts* are plausible but never rendered; they support C8.
- **Memories** follow the v1 fields plus `expresses: [{fact, where:
  "body"|"span", span}]`.
  - Each memory has 1–3 spans. The span-count distribution is matched between
    S300 targets and distractors.
  - Distinctive terms (names, numbers, IDs, products) are kept verbatim.
- **Fidelity**: a (required fact, memory) pair is `body` if the memory body
  expresses the fact, otherwise `span-only`. 35–45% of S300 required pairs are
  span-only. W2 sees coverage metadata, not text.
- **Languages**: about 55% zh-TW, 30% en and 15% mixed.
- **Scales**:
  - `S300`: about 300 target memories, including all query support and hard
    negatives.
  - `S1000`: S300 with IDs, text and spans unchanged, plus about 700 extras
    rendered from distractor facts in the same domains. Language, domain and
    length distributions are matched to S300 (mean length within 15%). At most
    half of the extras are template-generated.
  - Corpus statistics are recomputed per scale and namespace.
- **Foreign namespace**: about 100 memories, including near-duplicates of target
  facts. About 10 foreign-only queries (whose only answers are foreign) act as
  isolation controls and are not scored.
- **Lifecycle**:
  - Superseded decisions are `historical`.
  - Rejected and proposed options remain current memories; rejection is not an
    exclusion.
  - Change reasons exist as evidence text.

### 4.3 Queries and categories

- 20 scored queries per primary category C1–C7 (140), each with secondary tags,
  plus 10 C8 queries and the foreign-only controls.
- The split is by family: about 6 dev and 14 test per category (±2); dev is
  30% ± 3% overall.
- Query languages are about 55% zh, 30% en and 15% mixed, except C2 (all zh) and
  C4 (balanced directions).
- The equal-category macro describes this suite, not a production query
  distribution.

| ID | Category | Definition and mechanical check |
| --- | --- | --- |
| C1 | Exact term | Uses a distinctive term of a required fact; the term appears verbatim in at least one member of every group |
| C2 | Chinese embedded term | Uses a 2–4 character Chinese term of a required fact; in at least one member it sits inside a longer contiguous Han run |
| C3 | Paraphrase | Same language, phrased without the fact's distinctive wording. Overlap with group members (T1 tokens) is recorded, not constrained; zero-overlap queries form a reported stress stratum |
| C4 | Cross-lingual | Query language differs from every group member's language |
| C5 | Multi-evidence | 2–3 required facts expressed in different memories; no single memory expresses all of them |
| C6 | Change and history | (a) `current`: the current decision and its reason; (b) `history`: the old decision, the new one and the reason |
| C7 | Near-miss | At least one S300 hard negative shares the entity but answers a different attribute, person or time |
| C8 | No answer | Required facts are absent facts; excluded from recall denominators |

## 5. Arms

### 5.1 Common rules

- **Eligibility**: `current` excludes deleted, historical and awaiting-review
  rows; `history` excludes deleted rows.
- **Indexes** are per namespace and scale.
- **Output**: every arm returns a deduplicated ranking of at most 24 memory IDs.
  Ties break by fixture memory ID ascending, except A0, which uses the core.

### 5.2 Baselines and lexical channels

- **A0-default**: public `selectEvidence` (`types:['memory']`; defaults
  `limit:12`, `scanRows:128`).
  - Stores are seeded through public APIs: admit/supersede, spans as bounded
    receipts, and a synthetic trusted host authority.
  - Five independently created stores per scale (different UUID orders), with
    frozen snapshots shared across runs. Report the mean and range.
  - recall@24 is unavailable.
- **A0-paged**: `limit:24`, cursor followed to completion with unchanged
  parameters. Pages are concatenated in API order and truncated at 24. Report
  pages, scanned rows, coverage and errors; mean and range over the five stores.
- **A0b**: core `createQueryScore` (the `literal-current-memory-overlap-v2`
  scorer) over the full eligible projection. Zero scores are retained; sort by
  score descending, then fixture ID. This is a full-projection scorer
  diagnostic, not model-backed recall.
- **A1**: BM25 with k1 = 1.2 and b = 0.75.
  - IDF = ln(1 + (N − df + 0.5)/(df + 0.5)), over distinct query terms.
  - Candidates are documents with at least one matching term.
  - Tokenizer **T1**: NFKC, then lowercase. Non-Han letter/number runs become
    words, minus a frozen English stopword list. Han runs become overlapping
    bigrams; a one-character run becomes that single character.
- **A1+**: the same BM25 with tokenizer **T1+**: Han unigrams plus bigrams, and
  English words Porter-stemmed (classic 1980 algorithm) after stopword removal.
- The stopword list, Unicode boundary rules and token examples are committed
  with the harness **before** the fixture is frozen.
- **A1t** (diagnostic): SQLite FTS5 `trigram`. The query is an OR of quoted
  within-run trigrams; BM25 is converted so that higher is better; there is no
  LIKE fallback. Terms shorter than three characters cannot match.

### 5.3 Semantic channels and fusion

- **A2(m)**: dense exact cosine (fp32), top 24.
  - e5-small: `query: ` / `passage: ` prefixes, masked mean pooling, L2
    normalization.
  - bge-m3: dense CLS embedding, L2 normalization, no instruction.
  - openai-3-small; openai-3-large (3072 dimensions); openai-3-large@1024
    (exploratory).
  - Any truncation is recorded.
- **Confirmatory fusion menu** (L\* with A2(m)). RRF score(x) = Σ_c w_c / (k +
  r_c(x)); ranks start at 1, and a missing channel contributes 0.

| Config | Definition |
| --- | --- |
| A3 | The proposed formula: RRF k = 60, channel depth 12, weights 0.45/0.45. This ranks identically to equal weights. The proposed 0.10 MOC term is absent, so no MOC conclusion follows |
| F-RRF60 | RRF k = 60, depth 24, equal weights |
| F-RRF10 | RRF k = 10, depth 24, equal weights |
| F-MM | Per-query min-max score fusion over each channel's top 24; missing or constant-range scores map to 0; s = 0.5·lex + 0.5·sem |

- **Exploration grid** (dev only, never nominated):
  - RRF with k ∈ {1, 10, 60} × depth ∈ {12, 24, 50} × weights ∈ {(.5,.5),
    (.6,.4), (.4,.6)};
  - F-MM with α ∈ {.3, .4, .5, .6, .7} at depth 50;
  - MemPalace-style re-scoring over semantic top 50: distance = (1 − cos) ×
    (1 − w × overlap), sorted ascending. Here overlap = |Tq ∩ Td| /
    max(1, |Tq|) using L\*'s tokens, and w ∈ {.1, .2, .3, .4, .5}.

### 5.4 Per-run outputs

For each arm and query, report:
- the ranked list;
- for fused arms, the union size and the required-group coverage before fusion;
- each channel's rank for every required group's best member.

### 5.5 A5: verbatim spans (secondary)

- **Metric**: memory-ID reachability.
- **Documents**: A5-spans indexes spans; A5-both indexes bodies and spans as
  separate documents.
- **Ranking**: within each channel, a memory scores the maximum over its
  documents. Results are deduplicated to memories, then ranked and fused with
  L\* and each context's frozen winning configuration.
- **Report**:
  - body vs span-only strata;
  - required-span coverage;
  - span-count strata;
  - index costs.
- **Secondary decision**: if, for the local context, A5-both improves macro
  recall@12 on span-only pairs by at least 5 points with at most 2 points of
  loss on body pairs (test, S1000), indexing retained spans merits a
  product/privacy review. This does not establish benefits of arbitrary Raw
  search.

## 6. Metrics

- **Group recall@k** (k = 12, 24): per query, the fraction of evidence groups
  with at least one member in the top k. The macro averages C1–C7 equally.
- **Supporting measures**:
  - all-required@12 and @24;
  - the best rank of each required group;
  - hard-negative@12;
  - returned and non-required counts.
- **C8 and foreign-only controls**: returned counts and raw per-channel score
  distributions. No precision or abstention claims.
- **Strata**: language, fidelity, C3 zero-overlap, span count, scale.
- **Isolation**: any foreign ID in a target result fails the run. Target rankings
  must be identical with and without the foreign namespace present.

## 7. Statistics

- **Cluster bootstrap** over test families: 10,000 resamples with a fixed seed;
  recompute the fixed macro; redraw any resample with an empty category. Use
  97.5% CIs for the two confirmatory comparisons, and 95% for exploratory ones,
  labelled as exploratory.
- **Exact two-sided McNemar** on all-required@12: one preregistered query per
  family (the smallest test query ID), reporting discordant counts.
- Scales and timing repeats are not additional samples.

## 8. Latency and cost

- **Local**: batch-1 requests timed from query tokenization and embedding through
  final fusion. Query-embedding caches are off; weights are warm. Run five
  randomized full passes and report request-level p50 and p95. Report separately
  the cold load, threads, device, peak RSS and model sizes.
- **Hosted**: the same, including the HTTPS round trip; reported separately.
- **Build and spend**: index build time, per-document embedding throughput, API
  tokens and spend.

## 9. Procedure and conventions

1. v1 (`d1a64f5`) was audited; this v2 follows. The auditor re-checks P0
   resolution.
2. Run the fixture pipeline (§4.1) and freeze it in a commit.
3. Build the harness in parallel against a toy fixture.
   - Tests: `node tools/testing/run.mjs evaluation/retrieval-research/test/*.test.mjs`
     on Node 22.16 (and 24.15 when available), with `createTestWorkspace` for
     scratch.
   - Two non-author reviews (Standards, Spec), then primary acceptance.
4. Dev runs produce `selection.json`, which is committed.
5. Run each arm, scale and model once on the test split. API arms run only after
   the key is provided.
6. Commit results under `evaluation/retrieval-research/results/`. Record every
   outcome in `docs/limitations.md` on this branch, whether adopted or not.
7. After any test-split result, no fixture, label, tokenizer, menu or selection
   change is allowed. A defect creates a new fixture version, reported alongside
   the original.

## 10. Out of scope

- MOC as a retrieval channel (it needs a query-time rank definition).
- One-hop typed relations.
- Layered L0/L1/L2 assembly under a token budget (HR-2).
- Typed update policies and answer correctness (real-model extraction, paid;
  HR-3).
- Cross-encoder or LLM reranking.
