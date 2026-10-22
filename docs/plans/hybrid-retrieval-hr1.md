# HR-1: hybrid candidate retrieval, frozen offline protocol

Status: **protocol frozen before any result-producing run.** This is a research
packet on branch `experiment/hybrid-retrieval-hr1`, based on PR #468 head
`3f6590584e746cc596c7859c9b0a00ae808941b6`. It changes no public core API, schema,
default, adapter or installed artifact. Main `cd6d1ad` has identical retrieval
and ranking code (only a provenance label differs), so results apply to both.

## Question and decision

A proposed integration plan would add an embedding channel next to literal
search and fuse them by weighted reciprocal-rank fusion (RRF). Before an
embedding dependency becomes a default part of a lightweight local engine, HR-1
asks one question:

> On the same frozen bilingual (Traditional Chinese / English) synthetic corpus,
> does fusing an embedding channel with a CJK-capable lexical channel retrieve
> more of the required evidence than the CJK-capable lexical channel alone,
> without losing exact-term and Chinese-name queries?

Beating the current `selectEvidence` is not informative. It scans in random-UUID
`id` order (default 128 rows), keeps the first `limit` rows with at least one
overlapping whole-Unicode-run token and only then sorts them. Contiguous Han text
is one token. The informative comparison is fused retrieval against a strong,
cheap lexical baseline (A1).

Prior work this packet builds on (unmerged branches): the September
[candidate retrieval ablation](https://github.com/Cairn-ink/cairn-memory/blob/experiment/candidate-retrieval-ablation/docs/plans/candidate-retrieval-ablation.md)
found no observed MOC-routing advantage over a flat FTS5 index and left CJK
segmentation and paraphrase as open hypotheses. HR-1 tests exactly those, plus
semantic candidates. MOC routing, typed relations, layered assembly and typed
updates are out of scope (see the end of this file).

### Pre-registered decision rule

Evaluate on the **test** split at scale **S1000**. "Best fused" is the A3 or A4
configuration chosen on the dev split (per embedding model). Points are
percentage points of macro recall@12.

| Outcome | Condition |
| --- | --- |
| Continue: semantic channel is a default-on candidate | Best fused minus A1 is at least +5 macro, at least +10 on C3 (paraphrase), no category below A1 by more than 2, and warm query p95 below 200 ms (excluding first model load) |
| Do not adopt (keep an optional port only) | Best fused minus A1 is below +3 macro, or an exact-term (C1/C2) regression above 2 cannot be removed within the A4 grid |
| Inconclusive | Anything between; report and propose a larger corpus or the product API model |
| Stop early, no conclusion | A1 is at least 95% recall@12 in every category at S1000 (corpus too easy), or a local model cannot run on the reference machine |

A5 (verbatim spans) is a separate, secondary decision. If indexing spans improves
macro recall@12 by at least 5 on the `lossy` stratum with no loss above 2 on the
`sufficient` stratum, we report that the "no Raw search" boundary is worth a
product/privacy review. Otherwise it is not.

Bootstrap 95% CIs and per-query paired results are reported with every
difference. With about 100 test queries, results show direction, not product
reliability.

## Fixed conditions

- Code: this branch; research code only under `evaluation/retrieval-research/`.
- Runtime: Node 22.16.0 (record exact version); Node 24 is optional for tests.
- Machine: record CPU model, core count, RAM and OS in each report.
- Network: model weights are downloaded once, pinned by repository revision,
  and cached outside the repo. Queries run offline. A0–A5 use no paid API.
- Dependencies: embedding runtime only in an isolated
  `evaluation/retrieval-research/package.json` with an exact, locked version.
  Core dependencies do not change.

## Corpus and queries (`evaluation/retrieval-research/fixtures/`)

Synthetic only, written for HR-1. No real user, product or benchmark data.
LongMemEval holdout IDs are never used.

- **Memories.** Short interpretation-style records (one to three sentences),
  like Cairn Memories, with `kind` in fact/preference/decision/instruction/context.
  Language is `zh` (Traditional Chinese), `en`, or `mixed` (Chinese text with
  English terms). Each memory has one to three verbatim source **spans**
  (user/assistant message excerpts) from which it was derived.
- **Body fidelity.** Each memory is labelled `sufficient` (its body keeps every
  fact a query needs) or `lossy` (some query-relevant detail exists only in a
  span, as happens when extraction drops a reason, number or name). Labels are
  assigned by an explicit rule and reported, because A5 results are conditional
  on them.
- **Namespaces.** A target namespace plus one foreign namespace that holds
  near-duplicate content. Indexes are built per namespace. Any foreign ID in
  any result fails the run.
- **Scales.** `S300` is about 300 target-namespace memories, including every
  query target and its hard negatives. `S1000` is `S300` plus about 700 more
  distractors (same domains, overlapping vocabulary). Both scales run the same
  queries, so the only difference is crowding. Template-only filler may be at
  most half of the added distractors.
- **Lifecycle.** Some decisions are superseded: the old memory is `historical`
  and the new one is `current`, linked by `supersedes`. Some proposals are
  rejected. Arms apply the same eligibility rule as `selectEvidence`:
  `current` intent ranks current memories only; `history` intent ranks all.

Query categories, each with mechanical membership checks. Target counts are
about 140 scored queries, split 30% dev / 70% test, stratified by category.

| ID | Category | Mechanical definition |
| --- | --- | --- |
| C1 | Exact term | Query contains a distinctive term (name, number, product, ID, English term) that appears verbatim in every required memory |
| C2 | CJK contiguous | Chinese key term of 2–4 characters appears inside a longer contiguous Han run in the target. In the query it stands alone or in a different run |
| C3 | Paraphrase | Zero shared content tokens between query and every required memory, using both the A1 tokenizer (Han bigrams, Latin words minus stopwords) and whole words |
| C4 | Cross-lingual | Query language differs from every required memory's language |
| C5 | Multi-evidence | Two or three required memories; each alone is insufficient |
| C6 | Change and history | (a) `current` intent: the current decision plus its reason; (b) `history` intent: the old decision, the new one and the reason for the change |
| C7 | Near-miss | A hard negative shares the entity or most words but answers a different attribute, person or time |
| C8 | No answer (diagnostic only) | No memory answers the query. Not scored for recall; top-score distributions are reported |

Each query records `id`, `split`, `category`, `lang`, `intent`, `text`,
`required` (memory IDs), optional `requiredSpans`, and `hardNegatives`.
Labels are evaluator-only and never reach an arm. A separate audit checks
necessity and sufficiency of required IDs and the mechanical definitions before
the fixture is frozen. The SHA-256 of the frozen fixture files is recorded in
every report.

## Arms

All arms see only the query text, the eligible projection of one namespace and
a fixed configuration.

| Arm | Definition |
| --- | --- |
| A0 | Actual public `selectEvidence` (types `['memory']`) on a fresh synthetic core store seeded through public APIs. A0-default: one call, defaults (`limit:12`, `scanRows:128`). A0-paged: `limit:24`, cursor followed to completion |
| A0b | Literal overlap scored over **all** eligible rows, sorted (score desc, id) — the scoring of `literal-current-memory-overlap-v2` without the model calls |
| A1 | BM25 (k1 1.2, b 0.75) over a CJK-capable tokenizer. NFKC and lowercase; Latin/number runs become words minus a fixed English stopword list; Han runs become overlapping bigrams, with single characters for one-character runs. Fixed a priori; no tuning |
| A1t | SQLite FTS5 `trigram` tokenizer with BM25 (documents the known failure of query terms shorter than three characters) |
| A2 | Dense cosine only. Models: `multilingual-e5-small` (with `query:`/`passage:` prefixes) and `bge-m3` dense. Both fp32, pinned revisions |
| A3 | Proposed fusion: `0.45/(60+r_lex) + 0.45/(60+r_sem)` over per-channel top-12 (A1 + A2), ties by id. The proposed 0.10 MOC term is omitted (no defined MOC rank) and reported as degraded |
| A4 | Alternative fusion chosen on **dev only**: (i) RRF with k ∈ {1, 10, 60}, depth ∈ {12, 24, 50}, weights (0.5,0.5), (0.6,0.4), (0.4,0.6); (ii) per-query min-max score fusion α ∈ {0.3, 0.4, 0.5, 0.6, 0.7} over top-50 of each channel; (iii) MemPalace-style `(1 − cos) × (1 − w × overlap)` with w ∈ {0.1, …, 0.5} over semantic top-50. Choose max dev macro recall@12 subject to no dev category more than 2 below A1; ties go to the simpler configuration |
| A5 | Same as A1 and the chosen A4 configuration, but documents are spans (A5-spans) or memory body plus spans (A5-both); per-memory score is the max over its documents |
| API | The product's intended embedding API in A2/A3/A4. **Not run** until a separate budget, model and key scope is approved |

## Metrics and reports

- Primary: macro average over C1–C7 of per-query recall@12 (fraction of
  `required` present in the top 12), per scale and split.
- Secondary: recall@24; all-required@12 for C5/C6; MRR of the first required
  hit; per-language and per-fidelity strata; foreign leakage (must be zero).
- Cost: index build time (total and per document), embedding throughput, cold
  model load, warm query p50/p95 over five repeats, peak RSS, model download
  size, dependency footprint.
- Stats: paired per-query differences; bootstrap 95% CI of macro differences
  (10,000 resamples, fixed seed); exact McNemar on all-required success.
- Reports keep every run, including failures, with commands, actual exit codes,
  fixture hash, model revisions and environment. Synthetic text may appear in
  failure listings.

## Procedure

1. Freeze this protocol (this commit).
2. Write the fixture, run the mechanical validator and an independent label
   audit, then freeze the fixture with its hash in a separate commit.
3. Build and unit-test the harness on a toy fixture. Dev runs only for A4
   selection.
4. One test-split run per arm and scale. No fixture, label, tokenizer or grid
   change after a test-split result. A defect found later creates a new fixture
   version and is reported alongside the original result.
5. Report: comparison tables, failure analysis and a continue / do-not-adopt /
   inconclusive recommendation, recorded in `docs/limitations.md` if it lands.

## Out of scope for HR-1

MOC as a retrieval channel (needs a query-time rank definition), one-hop typed
relations, layered L0/L1/L2 assembly under a token budget (a model-free candidate
for HR-2), typed update policies and answer correctness (need real-model
extraction; paid, later), and cross-encoder or LLM reranking.
