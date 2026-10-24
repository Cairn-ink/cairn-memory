# HR-2b results: long-item budgeted assembly (synthetic, offline)

Status: **completed under protocol v1.1 (frozen `d3a6e24f`), one test-split
run of 80 cells, no deviation after the freeze; outcome Keep.** Direction
only; not a product reliability claim. This answers protocol §1's question for
**long memories with long receipts, where a receipt-only fact may sit in the
first or in a later receipt**; it says nothing about generated summaries,
prefixes, answer correctness or the shipped host's exact token counts.

Provenance:
- Protocol: v1 frozen `c546bfc1`; **v1.1** (`d3a6e24f`) is a pre-outcome
  amendment made after the first candidate fixture's W1/W2/W3 counts and
  validator output were seen and before any ranking, calibration or assembly:
  pooled later-receipt guard, receipts capped at four, quotas; thresholds,
  gates, outcome semantics and the primary macro contrast unchanged
  (protocol status line and "v1.1 amendment provenance" paragraph; non-author
  audit: four P1 and two P2 applied, freeze confirmed).
- Fixture `hr2b-fixture-v1`, **candidate 3, seed `3023009795`**, frozen in
  [FROZEN.md](../../evaluation/retrieval-research/fixtures-hr2b/FROZEN.md)
  (sha256 `ccef1982…`, 31 files; commit `3251b8ca`; one manifest member, the
  empty `build/candidate0-v11-identity/check.stderr.log`, was excluded by the
  repository's `*.log` ignore rule at that commit and is force-added in the
  results-document commit, hash unchanged). Candidates 0 (under v1:
  guard quota and receipt cap; under v1.1: identity gate and a duplicate
  body), 1 (test first-receipt stratum 20 groups < 30) and 2 (duplicate
  body) were rejected before any ranking; their diagnostics are retained under
  `fixtures-hr2b/build/` (`world-stats.json`, `candidate0-v1-validation/`,
  `candidate0-v11-identity/`, `candidate1-v11-validation/`).
- Rankings: A1 and bge-m3 + A3 (local, `Xenova/bge-m3` revision `4de13258`,
  CPU), dev and test, S1000 with the foreign namespace, body-only documents,
  horizon 24, frozen in
  [results/hr2b-rankings/FROZEN.md](../../evaluation/retrieval-research/results/hr2b-rankings/FROZEN.md)
  (sha256 `8de0d1d6…`; commit `98e88b01`) with `configuration.json` and the
  `host-v2` calibration. No hosted ranking, no API key, no spend.
- Harness: protocol-v1.1 tooling `9e2e86c3` (Spec review: no findings;
  Standards review: three P2, fixed and confirmed resolved; coordinator's
  owned-runner tests on Node 22.16.0 and 24.15.0 all exit 0, legacy 240/240
  and host-v2 120/120 regressions unchanged).
- Cost models: `host-v2` constants `assembly/overhead-host-v2.json` (sha256
  `5eba1bd4…`, HR-2 §11) and the scalar `O = 0`. Counter `tiktoken@1.0.22`,
  `o200k_base`.
- Run: clean checkout `98e88b01` (implementation identity `dirty: false` for
  assembly, scorer and report; source hash `2f218798…`), Node 22.16.0; the
  run, score and report stages through `cairn-heavy`, the hashing, archiving
  and restore-check stages directly; 32 threads, about 39 GB RAM, WSL2.
  Artifacts:
  [`results/hr2b-final/`](../../evaluation/retrieval-research/results/hr2b-final/)
  (`preflight.log`, `test-preflight.log`, `*.command`, `*.exit`, `*.log`;
  `report.md`; `cells.tar.xz`, `scores.json.xz`, `report.json.xz` with
  uncompressed hashes in `SHA256SUMS.uncompressed` and archive hashes in
  `archive.sha256`; `extract.*` records the restore check, 83 files OK).
  Stage records of steps 3 and 4 are under `results/hr2b-stage-logs/`. Home
  directory prefixes are written as `~` in stage files.
- Run summary: `cells: 80, expectedCells: 80`, 94 scored test queries per
  cell, 131 required groups (26 body, 56 first-receipt, 49 later-receipt), 28
  test families (C1–C7: 15/14/13/12/13/14/13); report `comparisons: 64`,
  `outcome: keep`; every stage exit 0 on the first attempt.

## 1. Confirmatory outcome (protocol §4)

Primary cell: test split, S1000, ranking bge-m3 + A3, cost model `host-v2`,
budget 1,500 tokens; P-top-s1 (`rank-first-first-source-v1`, first receipt
only) against P-top (`rank-first-whole-v1`, whole items); macro group coverage
over C1–C7; 28 families, every category ≥ 12.

| Quantity | Value |
| --- | ---: |
| Δ macro coverage, P-top-s1 − P-top | **−11.48 points** |
| 95% family-bootstrap CI (10,000 resamples, 0 rejected, seed `hr2b-bootstrap-v1`) | **[−23.82, −0.15]** |
| P-top coverage / P-top-s1 coverage | 0.366 / 0.252 |
| All-required: P-top / P-top-s1 | 0.284 / 0.176 |
| Macro ranking ceiling (both arms) | 0.742 |
| Token use p50 (P-top / P-top-s1) | 0.963 / 0.967 |
| McNemar on all-required (one query per family, 28) | baseline-only 3, candidate-only 2, p ≈ 1.0 |

Category deltas (points): C1 −13.3, C2 −7.1, **C3 −30.8** (its own
exploratory CI [−53.8, −7.7]), C4 −16.7, C5 0.0, C6 −4.8, C7 −7.7.

**Guard stratum (`later-receipt`, pooled over group occurrences, protocol §4
v1.1):**

| Quantity | Value |
| --- | ---: |
| Later-receipt groups / families / queries (test) | 49 / 22 / 45 |
| P-top pooled coverage | 0.388 (19 of 49) |
| P-top-s1 pooled coverage | 0.000 (0 of 49, by construction) |
| Pooled Δ, P-top-s1 − P-top | **−38.78 points** |
| 95% family-bootstrap CI (22 families, 10,000 valid draws) | **[−55.2, −20.9]** |
| Pooled ranking ceiling | 0.735 (36 of 49) |

Descriptive per-category later-receipt Δ (points; groups / families; no CI,
no decision): C1 −42.9 (7 / 7), C2 −50.0 (6 / 6), C3 −57.1 (7 / 7), C4 −40.0
(5 / 5), C5 −22.2 (9 / 7), C6 −33.3 (9 / 7), C7 −33.3 (6 / 6). The loss is
spread over every category; C5 and C6 carry the most group occurrences (9
each) and so weigh most in the pooled figure.

**Outcome: Keep. `rank-first-whole-v1` stays the §15 default;
`rank-first-first-source-v1` stays available and non-default.** Both Keep
conditions hold independently: Δ ≤ 0 with the CI's upper bound (−0.15) below
+3, and the guard's CI upper bound (−20.9) below −5. The thresholds carry no
power claim; 28 families establish neither power nor equivalence. The result
is the preregistered direction: on long items whose receipt-only evidence is
split between first and later receipts, deepening only the first receipt loses
the whole later-receipt stratum and does not win it back on the first-receipt
and body strata (first-receipt stratum +8.2 points and body stratum +8.3
points, both exploratory and Inconclusive for too few families per category).

## 2. Exploratory results (not used for the decision)

Pointwise, unadjusted 95% family-bootstrap CIs; 63 exploratory contrasts
against P-top on the same ranking, cost model and budget.

### 2.1 Macro group coverage (test split, 94 queries, 131 groups)

Macro ceilings: A1 0.708, bge-m3 + A3 0.742. By group occurrences, 42 of
131 groups (32.1%) are unreachable within the horizon of 24 on A1 and 34 of
131 (26.0%) on bge-m3 + A3: body-only rankings do not see receipt-only facts
at ranking time.

| Ranking | Cost model | Arm | 1000 | 1500 | 2000 | 4000 |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| A1 | O = 0 | P-top | 0.272 | 0.340 | 0.413 | 0.594 |
| A1 | O = 0 | P-top-s1 | 0.169 | 0.227 | 0.258 | 0.390 |
| A1 | O = 0 | P-top+tail | 0.241 | 0.330 | 0.403 | 0.594 |
| A1 | O = 0 | P-cover | 0.074 | 0.068 | 0.093 | 0.191 |
| A1 | O = 0 | P-cover-s1 | 0.107 | 0.078 | 0.125 | 0.183 |
| A1 | host-v2 | P-top | 0.205 | 0.309 | 0.379 | 0.577 |
| A1 | host-v2 | P-top-s1 | 0.155 | 0.180 | 0.227 | 0.357 |
| A1 | host-v2 | P-top+tail | 0.200 | 0.294 | 0.375 | 0.577 |
| A1 | host-v2 | P-cover | 0.072 | 0.083 | 0.083 | 0.157 |
| A1 | host-v2 | P-cover-s1 | 0.104 | 0.072 | 0.109 | 0.149 |
| bge-m3 + A3 | O = 0 | P-top | 0.313 | 0.414 | 0.525 | 0.669 |
| bge-m3 + A3 | O = 0 | P-top-s1 | 0.200 | 0.293 | 0.339 | 0.418 |
| bge-m3 + A3 | O = 0 | P-top+tail | 0.304 | 0.403 | 0.494 | 0.658 |
| bge-m3 + A3 | O = 0 | P-cover | 0.102 | 0.135 | 0.128 | 0.289 |
| bge-m3 + A3 | O = 0 | P-cover-s1 | 0.107 | 0.119 | 0.127 | 0.270 |
| bge-m3 + A3 | host-v2 | P-top | 0.274 | **0.366** | 0.444 | 0.647 |
| bge-m3 + A3 | host-v2 | P-top-s1 | 0.175 | **0.252** | 0.312 | 0.414 |
| bge-m3 + A3 | host-v2 | P-top+tail | 0.265 | 0.366 | 0.434 | 0.642 |
| bge-m3 + A3 | host-v2 | P-cover | 0.084 | 0.109 | 0.147 | 0.148 |
| bge-m3 + A3 | host-v2 | P-cover-s1 | 0.094 | 0.122 | 0.134 | 0.149 |

Token use p50 is 0.905–0.995 of the budget in every cell; in every cell 79–94
of the 94 queries had at least one unit rejected for budget. Saturation
(protocol HR-2 §11 definition) is **not reached** on any ranking or cost model
at 4,000 tokens: coverage is still rising towards the ceiling. The `host-v2`
representation overhead costs P-top 2.2–8.1 points against `O = 0` at the
same budget on bge-m3 + A3 (1000: 0.274 vs 0.313, 1500: 0.366 vs 0.414,
2000: 0.444 vs 0.525, 4000: 0.647 vs 0.669).

### 2.2 The P-top-s1 contrast at every budget, ranking and cost model

Macro Δ (points), P-top-s1 − P-top, with the pooled later-receipt guard Δ:

| Ranking | Cost model | 1000 | 1500 | 2000 | 4000 |
| --- | --- | --- | --- | --- | --- |
| A1 | O = 0 | −10.3 [−18.6, −2.8]; guard −26.5 | −11.2 [−22.9, +0.1]; guard −36.7 | −15.5 [−28.6, −3.4]; guard −46.9 | −20.4 [−33.9, −7.4]; guard −59.2 |
| A1 | host-v2 | −5.1 [−13.5, +3.3]; guard −20.4 | −12.9 [−22.0, −4.6]; guard −30.6 | −15.1 [−28.0, −3.0]; guard −44.9 | −22.0 [−35.1, −9.9]; guard −59.2 |
| bge-m3 + A3 | O = 0 | −11.3 [−20.9, −2.6]; guard −30.6 | −12.1 [−25.8, +0.7]; guard −40.8 | −18.6 [−32.1, −6.7]; guard −51.0 | −25.1 [−38.2, −13.0]; guard −65.3 |
| bge-m3 + A3 | host-v2 | −9.8 [−18.5, −2.2]; guard −24.5 | **−11.5 [−23.8, −0.2]; guard −38.8** (§1) | −13.2 [−26.4, −0.8]; guard −44.9 | −23.3 [−36.5, −11.0]; guard −63.3 |

P-top-s1 is behind in all 16 cells; the CI includes zero only at A1 /
host-v2 / 1000 (+3.3), A1 / O = 0 / 1500 (+0.1) and bge-m3 / O = 0 / 1500
(+0.7). The loss **grows with the budget**: the larger the budget, the more
later receipts P-top can afford, none of which P-top-s1 ever admits. This is
the opposite of HR-2 §2/§7, where on short single-fact items P-top-s1 never
lost and gained 3–4 points at the tightest budgets: there, skipping receipts
beyond the first freed room for more items; here, receipts 2–4 carry 49 of 131
required groups.

### 2.3 The other arms

- **P-cover and P-cover-s1 (coverage-first)** lose 10–50 points against
  P-top in every cell (points −10.1 to −50.0, all CIs below zero), with
  pooled guard losses of −20 to −65; their absolute coverage is 0.07–0.29.
  On long items, spreading the budget one unit per item admits mostly bodies
  that do not state the receipt-only facts the queries need; the
  budget-rejected count stays at 85–94 of 94 queries for P-cover and 79–94
  for P-cover-s1.
- **P-top+tail** is P-top within −3.1 to 0 points (the −3.1 cells are A1 /
  O = 0 / 1000 and bge-m3 / O = 0 / 2000; ties at 4,000 on A1 and at
  bge-m3 / host-v2 / 1500); its guard Δ is 0 or −2.0.
- **Strata of the primary cell**: span-only (105 groups, 93 queries) Δ −13.2
  [−25.5, −1.8]; body-covered (26 groups, 19 families) +8.3 and
  first-receipt (56 groups, 25 families) +8.2, both Inconclusive under the
  per-category family minimum (body: C3 1, C5 6, C6 12 families;
  first-receipt: 8/8/5/7/9/10/7). Language strata are Inconclusive for the
  same reason (zh −10.4, en −13.2, mixed −5.0, points).

### 2.4 Calibration of the `host-v2` model on long probes (protocol §5)

504 deterministic fact-free probes (bodies 120/220/400 tokens, receipts
40/120/200 tokens, 1–4 receipts, 1–2 items, every delivered prefix length and
both completeness states) serialized with the normative `representation-v2`
serializer at `b18dabe0` and counted with `o200k`: modelled minus measured
tokens is **0 for 153 probes and otherwise negative**; for one item the
minimum is −5 with one receipt, −9 with two, −13 with three and −17 with
four, and for two items twice that (−10 / −18 / −26 / **−34**), i.e. the
additive model undercounts the serialized cost by up to about 5 tokens for the
first receipt and 4 tokens for each further receipt in some prefix and
completeness states. The constants were not retuned (protocol §5). This run
contains no exact-host comparison, so it does not establish how the shipped
host's budgets would bind; what the constants cannot change is that P-top-s1
admits no later receipt, so its loss on the later-receipt stratum is
structural, while the size of the primary Δ under exact-host costs was not
measured.

## 3. Failures retained

None in the frozen run: run, score, report, hashes and the four archive
stages exited 0 on the first attempt from the clean checkout, and the restore
check of the archives passed (83 files). Before the fixture freeze, three
candidate fixtures were rejected and the protocol was amended once, all
before any ranking existed; every rejection and the amendment's provenance are
committed (protocol v1.1 status line and provenance paragraph; `fixtures-hr2b/
build/` records). The tooling amendment needed one fix round (three Standards
P2 on numeric robustness and test coverage). Reviewers' read-only sandboxes
could not run tests (`/tmp` read-only), so the worker's and the coordinator's
runs are the test evidence.

## 4. Limits of this evidence

- **Receipt-heavy query set.** 137 of 140 scored queries have at least one
  required group outside the body stratum after W3's audit (138 as W2 wrote
  them; W3's q-110 override moved one group to body). This was W2's choice,
  made blind to placement, to secure the receipt-stratum quotas after a
  candidate failed them; the protocol sets placement shares over distinct
  facts and group/family quotas, not a query-level share (the ≥ 40% figure
  was the coordinator's brief to W2, not a protocol rule). The test split's
  131 required groups are 26 body / 56 first-receipt / 49 later-receipt. The
  Δ magnitudes are therefore not comparable to a body-mixed query set, and
  the body stratum is too thin for a per-category interval. One fixed mix was
  run; P-top-s1 covering no later-receipt group is structural and holds for
  any mix, but the size and sign of the macro Δ under a body-heavier mix were
  not measured.
- **At most four receipts per memory.** core `admit` accepts four receipts per
  call and the validator seeds one admission per memory; memories accumulated
  over repeated admissions are outside this fixture's scope. Nothing here
  speaks to longer receipt chains.
- **Pooled guard.** Categories weigh by later-receipt group occurrences (5–9
  here); the guard does not bound per-category loss. The descriptive table in
  §1 shows the loss is in every category.
- **Body-only rankings** cap coverage at 0.71–0.74; the hosted ranking and
  receipt indexing were not evaluated, and on a ranking that indexes receipts
  the budget would bind differently.
- **`host-v2` is an additive approximation** that undercounts by up to −34
  tokens per probe on four-receipt items (§2.4); it is not a shipped-host
  measurement. Product default changes need their own exact-host validation.
- Deterministic whole units only; coverage is evidence-region admission, not
  answer correctness; authored filler is realistic-sounding but synthetic
  (protocol §10).
- The protocol was amended once after the first candidate's counts were seen
  (v1.1). The amendment changed the guard statistic, the receipt cap and
  quotas, not the thresholds, gates, outcome semantics or the primary
  contrast, and no ranking or assembly output existed; the candidate sequence
  restarted at candidate 0 and advanced by the frozen rule.

## 5. Recommendation

1. **`rank-first-whole-v1` stays the §15 default.** HR-2b closes the question
   HR-2 §5 item 2 opened: first-receipt-only deepening is not a safe default
   once memories carry several receipts with evidence beyond the first.
2. **`rank-first-first-source-v1` stays available and non-default.** It remains
   a reasonable policy for a caller who knows its receipts are single or
   first-receipt-only, which this fixture's design does not assume.
3. **Coverage-first is not a candidate on long items either** (−10 to −50
   points); HR-2's Keep for it is reinforced, not reopened.
4. **Two constraints bind on long items, and this run separates neither
   causally.** In the primary cell P-top loses 37.5 macro points to the budget
   (assembly loss, ceiling 0.742 minus coverage 0.366) and 25.8 points to the
   ranking (34 of 131 groups unreachable at horizon 24 on bge-m3 + A3, 42 on
   A1); every query had at least one unit rejected for budget. Receipt-aware
   ranking or indexing is a research question this run motivates but does not
   test (no receipt-indexing control was run); so is budget pressure on long
   items. Budgets remain numbers HR-2b does not choose.

## 6. Reproduce

From a clean checkout of `experiment/hr2-assembly` at `98e88b01` or later,
Node 22.16.0, with `npm ci --offline --ignore-scripts --prefix evaluation/retrieval-research`
(the bge-m3 model cache is only needed to regenerate the frozen rankings):

```sh
R=evaluation/retrieval-research
F=$R/results/hr2b-final
mkdir -p /tmp/hr2b-repro && cd /tmp/hr2b-repro
tar -xJf $OLDPWD/$F/cells.tar.xz && xz -dkc $OLDPWD/$F/scores.json.xz > scores.json && xz -dkc $OLDPWD/$F/report.json.xz > report.json
cp $OLDPWD/$F/report.md . && sha256sum -c $OLDPWD/$F/SHA256SUMS.uncompressed
cd $OLDPWD
node $R/assembly/run.mjs --fixture-dir $R/fixtures-hr2b --rankings $R/results/hr2b-rankings --split test --scale S1000 \
  --arms P-top,P-top-s1,P-cover,P-cover-s1,P-top+tail --rankings-select A1,A3--bge-m3 \
  --budgets 1000,1500,2000,4000 --out /tmp/hr2b-repro/cells2
node $R/assembly/score.mjs --fixture-dir $R/fixtures-hr2b --cells /tmp/hr2b-repro/cells2 --out /tmp/hr2b-repro/scores2.json
node $R/assembly/report.mjs --scores /tmp/hr2b-repro/scores2.json --out /tmp/hr2b-repro/report2.json --markdown /tmp/hr2b-repro/report2.md
```

Output directories must be empty beforehand; `results/hr2b-final/` is a
protected destination and must not be written. Per-query admissions, costs and
statistics are deterministic; the `environment`, checkout `commit`,
`detached` and `dirty` identity fields and the recorded absolute input paths
may differ from the committed files.
