# HR-2 results: budgeted assembly (synthetic, offline)

Status: **completed under protocol v1.1 (`c863e9d6`), one test-split run, no
deviation.** Direction only; not a product reliability claim. This answers the
question for short, single-fact items whose evidence often sits in receipts
(protocol §3); it says nothing about long memories or long receipts.

Provenance:
- Fixture `hr1-fixture-v2`, hashes in
  [FROZEN.md](../../evaluation/retrieval-research/fixtures/FROZEN.md), unchanged.
- Rankings: the frozen HR-1 test-final `with-foreign` S1000 files for A1,
  bge-m3 + A3 and openai-3-small + F-RRF10; archive and member hashes in
  [INPUTS.md](../../evaluation/retrieval-research/assembly/INPUTS.md) and
  verified by the harness before every stage.
- Harness: commit `241fad89` (dual non-author review: Spec yes, Standards yes
  after one fix round), run from a clean checkout of that commit.
- Counter: `tiktoken@1.0.22`, `o200k_base`, `encode(text, [], [])`, the same
  encoding the MCP host uses.
- Environment: Node 22.16.0; AMD Ryzen 9 9950X (32 threads), 42 GB RAM, WSL2.
- Artifacts: [`evaluation/retrieval-research/results/hr2-final/`](../../evaluation/retrieval-research/results/hr2-final/)
  (`report.md`; `cells.tar.xz`, `scores.json.xz`, `report.json.xz` with
  uncompressed hashes in `SHA256SUMS.uncompressed`; stage logs).
- The recorded implementation identity shows `dirty: true` for all three
  stages. The source hash (`28d76e34…`) equals the hash of the clean commit;
  the flag reflects the untracked output directories that the run itself
  created under `results/hr2-final/`, not a source change. A clean detached
  checkout of `241fad89` yields the same source hash with `dirty: false`.

## 1. Confirmatory outcome (protocol §4)

Primary cell: test split, S1000, ranking bge-m3 + A3, overhead `O = 0`,
budget 512 tokens; P-cover (coverage-first) against P-top (rank-first whole
units); macro group coverage over C1–C7; 29 families, every category ≥ 12.

| Quantity | Value |
| --- | ---: |
| Δ macro coverage, P-cover − P-top | **−2.5 points** |
| 95% family-bootstrap CI (10,000 resamples, 0 rejected) | **[−6.6, +1.5]** |
| P-top coverage / P-cover coverage | 0.957 / 0.948 |
| All-required: P-top / P-cover | 0.952 / 0.941 |
| Token use p50 (P-top / P-cover) | 0.99 / 0.99 |
| McNemar on all-required (one query per family) | baseline-only 1, candidate-only 0, p = 1 |

Category deltas (points): C3 **−20.0**, C5 +2.8, all others 0.

**Outcome: rank-first whole units stay U5b's initial default** (Δ ≤ 0 and the
CI's upper bound is below +5). Coverage-first established no material gain
for this ranking and evidence shape. The threshold has no claimed power
guarantee, and 29 families establish neither power nor equivalence; the
result is the preregistered direction, not a proof.

## 2. Exploratory results (not used for the decision)

Macro group coverage, test split, `O = 0`. The ceiling is the ranking's own
group recall over its full list (A1 0.873, bge-m3 0.987, 3-small 0.978).

| Ranking | Arm | 128 | 192 | 256 | 384 | 512 | 768 | 1024 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A1 | P-top | 0.639 | 0.713 | 0.738 | 0.763 | 0.796 | 0.855 | 0.873 |
| A1 | P-top-s1 | 0.665 | 0.713 | 0.750 | 0.784 | 0.802 | 0.869 | 0.873 |
| A1 | P-top+tail | 0.632 | 0.713 | 0.738 | 0.763 | 0.784 | 0.855 | 0.873 |
| A1 | P-cover | 0.479 | 0.479 | 0.503 | 0.564 | 0.779 | 0.853 | 0.873 |
| A1 | P-cover-s1 | 0.479 | 0.479 | 0.503 | 0.564 | 0.787 | 0.865 | 0.873 |
| bge-m3 + A3 | P-top | 0.759 | 0.832 | 0.884 | 0.933 | 0.973 | 0.977 | 0.987 |
| bge-m3 + A3 | P-top-s1 | 0.799 | 0.847 | 0.919 | 0.944 | 0.977 | 0.987 | 0.987 |
| bge-m3 + A3 | P-top+tail | 0.769 | 0.837 | 0.884 | 0.933 | 0.973 | 0.977 | 0.987 |
| bge-m3 + A3 | P-cover | 0.560 | 0.576 | 0.593 | 0.874 | 0.948 | 0.987 | 0.987 |
| bge-m3 + A3 | P-cover-s1 | 0.560 | 0.576 | 0.597 | 0.886 | 0.958 | 0.987 | 0.987 |
| 3-small + F-RRF10 | P-top | 0.746 | 0.845 | 0.877 | 0.920 | 0.964 | 0.968 | 0.978 |
| 3-small + F-RRF10 | P-top-s1 | 0.777 | 0.869 | 0.887 | 0.938 | 0.964 | 0.968 | 0.978 |
| 3-small + F-RRF10 | P-top+tail | 0.758 | 0.845 | 0.883 | 0.920 | 0.964 | 0.968 | 0.978 |
| 3-small + F-RRF10 | P-cover | 0.533 | 0.568 | 0.584 | 0.641 | 0.921 | 0.968 | 0.978 |
| 3-small + F-RRF10 | P-cover-s1 | 0.533 | 0.568 | 0.584 | 0.641 | 0.939 | 0.968 | 0.978 |

At 1,536 tokens every arm reaches its ceiling. Exploratory 95% CIs (all
labelled exploratory in `report.md`):

- **Coverage-first loses heavily at tight budgets** on every ranking: at
  128–384 tokens the P-cover deficit is 16–29 points with CIs excluding zero;
  at 512 it is −1.7 (A1), −2.5 (bge-m3) and −4.3 (3-small, CI [−8.3, −0.9]);
  at 768 and above the arms coincide.
- **Deepening with the earliest receipt only (P-top-s1) is never worse and is
  slightly better at tight budgets**: +4.0 [1.2, 7.7] on bge-m3 at 128, +3.0
  [0.8, 6.0] on 3-small at 128, +2.7 [0.4, 5.7] on A1 at 128; +0.4 to +1.5
  elsewhere with CIs touching zero.
- **Depth-then-breadth (P-top+tail)** differs from P-top by at most ±1.2
  points, with every CI including zero.
- The `O = 8` sensitivity run moves every arm down by a few points and does
  not change any ordering.

Fidelity strata on bge-m3 + A3 (`O = 0`):

| Budget | Arm | Body-covered groups | Span-only groups |
| ---: | --- | ---: | ---: |
| 256 | P-top | 0.876 | 0.905 |
| 256 | P-cover | 0.958 | **0.025** |
| 256 | P-top-s1 | 0.917 | 0.934 |
| 512 | P-top | 0.952 | 1.000 |
| 512 | P-cover | 0.976 | 0.918 |
| 512 | P-top-s1 | 0.958 | 1.000 |

The mechanism is the one the design probe predicted: 54 of the 134 required
test groups (40%) are span-only by fixture design, and the body of such a
memory is a pointer without the answer. Bodies-first spends the budget on
text that cannot satisfy those groups while the rankers already place the
evidence near the top. Coverage-first wins only the body-covered stratum, by
a few points, at the cost of nearly all span-only groups when the budget is
tight. The C3 deficit of 20 points at the primary cell comes from paraphrase
queries whose evidence is span-only.

## 3. Failures retained

None in this run: input authentication, 240 cells, scoring and the report
exited 0 on the first attempt. The harness worker's in-sandbox verification
had failed earlier for sandbox reasons (`spawnSync git EPERM`, the shared
heavy-test lock); those runs are recorded in the dispatch log, and the
coordinator's out-of-sandbox verification (76/76, then 127/127 after the fix
round, on Node 22.16.0 and 24.15.0) preceded the test run.

## 4. Limits of this evidence

- One synthetic fixture with bodies of at most 82 UTF-16 units, exactly one
  fact per memory, and 40% span-only required groups. It is biased against
  body-first strategies; "coverage-first not supported" means "not on
  evidence of this shape". A follow-up with realistic memory and receipt
  lengths is required before claiming it for long items.
- Deterministic whole units only: no prefix, window or generated-summary
  representation was tested, so nothing here bounds layered representations
  that use a model.
- Coverage is evidence-region admission; it measures neither answer
  correctness nor the effect of irrelevant admitted text on a model.
- The frozen rankings are strong (ceilings 0.87–0.99); on a weaker ranking
  the budget would bind differently.
- The optional length-stress arm (protocol §6.1) was skipped, as frozen.

## 5. Recommendation

1. **U5b keeps `rank-first-whole-v1` as the initial default** (contract §15.4).
   Coverage-first stays available as a policy and is not the default.
2. **A first-receipt-only deepening variant is worth adding as a policy**
   (`rank-first-first-source-v1`, HR-2's P-top-s1): it never lost and gained
   3–4 points at the tightest budgets on all three rankings. It needs its own
   contract clause and acceptance before becoming a default.
3. **Budgets below about 50% of the candidate volume are where strategy
   matters**; at or above the full volume every deterministic strategy
   coincides. Product defaults (1,500 and 4,000 tokens) remain numbers HR-2
   does not choose.
4. **Next research**: a long-item fixture (realistic bodies and receipts,
   multi-fact memories) before revisiting the default; the length-stress recipe
   from protocol §6.1 if a cheap intermediate signal is wanted.

## 6. Reproduce

From a clean checkout of `experiment/hr2-assembly` at `241fad89` or later,
Node 22.16.0, with `npm ci --offline --ignore-scripts --prefix evaluation/retrieval-research`:

```sh
R=evaluation/retrieval-research
F=$R/results/hr2-final
mkdir -p $F/inputs
sha256sum $R/results/test-final/rankings.tar.xz   # compare with $F/archive.sha256
tar -xJf $R/results/test-final/rankings.tar.xz -C $F/inputs
node $R/assembly/run.mjs --fixture-dir $R/fixtures --rankings $F/inputs --split test --scale S1000 \
  --arms P-top,P-top-s1,P-cover,P-cover-s1,P-top+tail \
  --rankings-select A1,A3--bge-m3,F-RRF10--openai-3-small \
  --budgets 128,192,256,384,512,768,1024,1536 --overheads 0,8 --out $F/cells
node $R/assembly/score.mjs --fixture-dir $R/fixtures --cells $F/cells --out $F/scores.json
node $R/assembly/report.mjs --scores $F/scores.json --out $F/report.json --markdown $F/report.md
```

Output directories must be empty beforehand. Compare the regenerated files
with `SHA256SUMS.uncompressed` after decompressing the committed archives;
per-query admissions, costs and statistics are deterministic. Only the
`environment` and identity `dirty` fields may differ.
