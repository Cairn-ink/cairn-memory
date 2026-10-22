# HR-1 results: hybrid candidate retrieval (synthetic, offline)

Status: **completed once under protocol v2.2. Direction only; not a product
reliability claim.**

Provenance:
- Fixture `hr1-fixture-v2`: frozen at `46b9691`; hashes in
  [FROZEN.md](../../evaluation/retrieval-research/fixtures/FROZEN.md).
- Selection: frozen on the dev split at `1a200af`, before any test run.
- Harness: commit `4fcec31`, run from a detached worktree pinned to that commit.
- Environment: Node 22.16.0; AMD Ryzen 9 9950X (32 threads), 47 GB RAM, WSL2.
- Artifacts: under
  [`evaluation/retrieval-research/results/test-final/`](../../evaluation/retrieval-research/results/test-final/)
  (bulky files xz-compressed; uncompressed hashes in `SHA256SUMS.uncompressed`).

## 1. Confirmatory outcome (test split, S1000, protocol §2.2)

Lexical comparator: **A1** (BM25, Han bigrams), chosen on dev.
Points are percentage points of macro group recall@12 over C1–C7.

| Context | Nominated (dev) | Δ macro | Δ C3 | 97.5% family-bootstrap CI | C1∪C2 losses | p95 latency | Isolation | Outcome |
| --- | --- | ---: | ---: | --- | ---: | ---: | --- | --- |
| local | bge-m3 + A3 (RRF k=60, depth 12) | **+18.9** | **+26.7** | [11.6, 26.6] | 0 | 38.5 ms | verified | **continue** |
| hosted | openai-3-small + F-RRF10 | **+16.9** | **+20.0** | [10.2, 23.5] | 0 | 262 ms | verified | **continue** |

- **Bootstrap**: 29 test families, 10,000 resamples, 0 rejected. Every
  category had ≥12 test families.
- **McNemar** on all-required@12, one preregistered query per family:
  - local: candidate-only 4, baseline-only 0, p = 0.125;
  - hosted: 3 and 0, p = 0.25.

  It is underpowered by design; the CI decides.

Category deltas (local / hosted):

| Category | Local | Hosted |
| --- | ---: | ---: |
| C1 exact term | +16.7 | +16.7 |
| C2 Chinese embedded term | 0 | 0 |
| C3 paraphrase | +26.7 | +20.0 |
| C4 cross-lingual | +50.0 | +41.7 |
| C5 multi-evidence | +18.1 | +20.8 |
| C6 change and history | +21.1 | +18.9 |
| C7 near-miss | 0 | 0 |

The structural concern behind the k=10 menu entry did not occur here: no exact
or Chinese-term query lost recall under A3. In A3 at k=60, a hit from both
channels always outranks a hit from one channel.

### A5 (secondary): verbatim spans

A5-both was compared with the nominated local body-only fusion:
- span-only groups: **−2.0**;
- body-covered groups: +2.4.

Outcome: **threshold not met.** On this corpus, indexing retained spans does not
justify reopening the "no Raw search" boundary.

## 2. Exploratory results (not used for decisions)

Macro recall@12 on test; recall@24 in parentheses where defined.

| Arm | S1000 | S300 |
| --- | --- | --- |
| openai-3-large + A3 | 0.987 (0.987) | 0.990 |
| bge-m3 + A3 (local nominated) | 0.973 (0.987) | 0.977 |
| bge-m3 dense only (A2) | 0.967 | 0.971 |
| openai-3-small + F-RRF10 (hosted nominated) | 0.952 (0.978) | 0.968 |
| openai-3-large@1024 + A3 | 0.977 | 0.990 |
| e5-small + A3 | 0.880 | 0.944 |
| A1+ (Han unigram+bigram, stemming) | 0.831 (0.901) | 0.944 |
| **A1** (comparator) | **0.784** (0.873) | 0.927 |
| A1t (FTS5 trigram) | 0.576 | 0.728 |
| A0b (core v2 literal scorer over all rows) | 0.227 | 0.260 |
| A0-paged (`selectEvidence`, all pages) | 0.173 (5-store mean) | 0.222 |
| **A0-default** (current `selectEvidence`) | **0.030** (range 0.015–0.053) | 0.113 |

Observations:
- **Scale hurts lexical, not dense.** From S300 to S1000 (700 added
  distractors), A1 falls 0.927 → 0.784; bge-m3 + A3 holds 0.977 → 0.973.
- **Current `selectEvidence` is not a usable ranker at this size.** It scans
  128 random-UUID-ordered rows and keeps the first matches, and contiguous Han
  text is one token (C2 = 0.00). A plain BM25-T1 replacement alone moves S1000
  from 0.03 to 0.78, with no model.
- **Two dev picks did not hold on test.** Dev chose 3-small over 3-large by
  0.002, and A1 over A1+. On test, 3-large and A1+ were better. By protocol
  there is no test rescue; these are recorded as signals for a larger
  follow-up.
- **The 1024-dimension cut of 3-large lost little** (0.977 vs 0.987 at S1000).
- **C7 near-misses never pushed targets out of the top 12.** This recall-based
  suite does not measure precision or hard-negative ranking quality.

## 3. Failures (S1000, test, recall@12 < 1)

| System | Failing scored queries | Categories |
| --- | ---: | --- |
| A1 | 26 | C5 7, C3 6, C4 6, C6 5, C1 2 |
| bge-m3 + A3 | 4 | C3 2, C5 2 |
| openai-3-small + F-RRF10 | 6 | C3 3, C4 1, C5 1, C6 1 |
| openai-3-large + A3 | 2 | C3 1, C5 1 |

Both nominated systems miss **q-058** (a very indirect C3 description) and
**q-098** (C5 with three required facts; one group is missed).

## 4. Cost

- **API**: OpenAI spend for all of HR-1 (dev, test, A5, hosted timing) was
  **US$0.0050** under the separate US$1 ledger.
- **Local resources**: bge-m3 is a 2.27 GB fp32 download, loads cold in 1.4 s,
  and peaked at **2.19 GB RSS** while serving queries with 4 threads. e5-small
  is 0.47 GB but scores lower. A1 has 0.49 ms p95 and 87 MB RSS.
- **Hosted latency**: p95 262 ms includes the HTTPS round trip from this
  machine's network (single run).

## 5. Incidents and deviations (all before scoring, retained)

1. **C6 clarification (v2.2).** Nine authored C6-current queries targeted
   unchanged decisions. The mechanical join rejected them, and the
   independent query author replaced them before the freeze.
2. **Label audit.** The independent audit made 11 changes (9 supports added,
   2 corrected). No queries were dropped.
3. **A0 seeding bug.** The first test run, at `1a200af`, failed A0 in both
   scales with `supersession_limit`: every historical row was given the same
   replacement, which exceeded core's limit of 5. The worker fixed the seeding,
   and A0 was re-run at `4fcec31`. All **66 non-A0 ranking files are identical**
   (rankings and channel scores) between the two commits. The failed first run
   is retained in `initial-run-1a200af.tar.xz`.
4. **Isolation variant.** The flag was added after the first test run so that
   protocol §6 could be verified; it changes no default behaviour.
   Isolation was verified for every arm.
5. **Protocol §9.7 after the first test run.** No fixture, label, tokenizer,
   menu or selection changed after the first test-split run (`1a200af`).
   Fixture hashes are identical, and `selection.json` was frozen earlier. Only
   two harness defects were fixed (items 3 and 4); no fixture defect was found,
   so no new fixture version is warranted.
   - The first run's rankings were never scored or inspected before the fix;
     only `status:"unavailable"` was observed.
   - They are retained unchanged, as `initial-run-1a200af.tar.xz`.
   - The confirmatory comparisons use non-A0 arms only. Their rankings and
     channel scores are identical between the two runs, so the confirmatory
     outcome equals the first run's. The `4fcec31` non-A0 runs are verification
     duplicates.
   - A0 is a baseline outside every confirmatory decision. Its numbers come
     only from the corrected harness.

   An independent reviewer argued that §9.7 calls for a new fixture version here.
   The primary's reasoning is recorded so readers can judge it.
6. **A0 capacity precondition.** The corrected A0 seeding requires historical
   ≤ current memories per projection: this fixture has 20 historical and at
   least 280 current. The validator's public-API preflight is being extended to
   refuse fixtures that break this precondition.

## 6. Limits of this evidence

- One synthetic, LLM-authored bilingual world:
  - fixed seven-fact family structure;
  - mostly one-fact memories;
  - 40 target families, 29 test families.
- Authors were independent but all came from one model family.
- Recall@k only: no precision, answer correctness, abstention or update
  correctness (HR-3).
- One machine and one run per configuration. Latency is indicative.
- The A5 conclusion is conditional on how this corpus places details in spans.
- Not real user data; not LongMemEval; not a competitor comparison.

## 7. Recommendation

1. **Worth continuing.** In both contexts the semantic channel is a
   **default-on candidate**:
   - the gain is large and its CI excludes zero;
   - there were no exact-term losses;
   - latency is within budget.
2. **Local default.** bge-m3 costs about 2.2 GB RSS and a 2.3 GB download. For a
   "lightweight" local engine this is a product decision:
   - offer local embeddings as an explicit option, or
   - evaluate a smaller or quantized multilingual model in a follow-up (e5-small
     alone underperforms).
3. **Hosted default.** Use the OpenAI path, at negligible cost. Re-check
   3-small vs 3-large on a larger fresh suite; 3-large was ahead on test.
4. **Independent quick win.** Replace `selectEvidence`'s first-matches scan with
   corpus-wide BM25-T1, or any real top-k. This needs no model and moves S1000
   recall from 0.03 to 0.78 in this suite.
5. **Do not reopen Raw full-text search** on this evidence (A5 not met).
6. **Next research**:
   - HR-2: layered assembly under a token budget;
   - HR-3: typed update policies with real-model extraction (paid; needs
     approval);
   - a larger, independently authored suite before freezing defaults.
