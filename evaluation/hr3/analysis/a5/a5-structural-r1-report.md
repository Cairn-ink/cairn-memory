# A-5 r1 synthetic structural checks

These are synthetic design calculations only. No pilot observations, research extraction, answer, score, calibration or paid call is used.

## Scope and what the ceilings mean

All five within-type and overall absolute C/O/R/J panels are checked under both Bernoulli designs at pilot, development and test allocations: 144 scalar panels, reduced by distributional identity to 42 unique configurations. C/O/R marginal distributions coincide; joint J uses the stated Bernoulli p cubed. Expanded checks do not change the frozen 13-column simulation grid.

Let L be lineages, m families/lineage, n=mL, S total successes, A_m all-success lineages and A_0 all-failure lineages, c=sqrt(m/(m-1)). Every corrected replicate lies between:

`[S+c(m A_m-S), S+c(m(L-A_0)-S)]/n`.

Exact source-state enumeration of (A_m,S), plus the flipped-data counterpart, gives the guaranteed noncoverage outside that range. Boundary cases are rescued only when the prescribed boundary supplement contains the true mean. Rational inequality signs are evaluated by integer squaring. For n<=400 the state weights are exact integers/Fractions; test-overall enumeration uses positive binary64 arithmetic with a conservative explicit operation/underflow enclosure. A coverage ceiling is an upper bound, not achieved percentile coverage; a ceiling above 93% is not a pass.

† denotes a tighter, rigorous finite-10,000-draw percentile ceiling averaging over fresh bootstrap draws. It uses exact source histogram weights and exact conditional bootstrap CDFs, with outward-rounded interval-arithmetic Chernoff bounds for necessary order-statistic events. Unenumerated source states are assigned coverage one. These are NOT silently claimed as exact ceilings conditional on the single frozen protocol matrix. Unmarked entries use the stronger-in-scope, universal replicate-support ceiling, valid for every matrix. Percentages round upwards.

## Complete coverage-ceiling table

| Configuration | Pilot ceiling % | Development ceiling % | Test ceiling % |
|---|---:|---:|---:|
| Within-type C/O/R: homogeneous .40; heterogeneous refinement | ≤88.247993 | ≤93.308482† | ≤100.000000 |
| Within-type J: homogeneous .064; heterogeneous refinement | ≤97.602147 | ≤99.615260† | ≤99.999974 |
| Overall homogeneous C/O/R (.40) | ≤99.933875 | ≤100.000000 | ≤100.000000 |
| Overall homogeneous J (.064) | ≤90.047811 | ≤92.981481† | ≤100.000000 |
| Within correction C/O/R (.20) | ≤95.292910 | ≤93.203863† | ≤100.000000 |
| Within correction J (.008) | ≤99.961607 | ≤99.886702† | ≤100.000000 |
| Within reversal C/O/R (.30) | ≤88.088225 | ≤92.803718† | ≤100.000000 |
| Within reversal J (.027) | ≤99.563397 | ≤99.670159† | ≤92.909474† |
| Within scope-change C/O/R (.50) | ≤92.480469 | ≤93.152868† | ≤100.000000 |
| Within scope-change J (.125) | ≤93.659115 | ≤94.826468† | ≤100.000000 |
| Within expiry C/O/R (.60) | ≤88.247993 | ≤93.308482† | ≤100.000000 |
| Within expiry J (.216) | ≤76.878912 | ≤93.003662† | ≤100.000000 |
| Overall heterogeneous C/O/R (mean .40) | ≤99.918850 | ≤100.000000 | ≤100.000000 |
| Overall heterogeneous J (mean .088) | ≤90.256800 | ≤99.995142 | ≤100.000000 |

Pilot within-type .40: two independent exact routes (4,096 ordered datasets and integer state enumeration) give noncoverage 0.1175200768 and coverage ceiling 88.24799232%. Other pilot designs also fail; they are retained as non-use diagnostics.

No development/test *universal support* ceiling is below 93%; that weak bound cannot certify their percentile intervals. The tighter finite-B marginal ceilings prove undercoverage below 93% for development within-type .30 (92.8037177%), development overall J .064 (92.9814806%), and test within-type J .027 (92.9094740%). This distinction is retained rather than mislabeling Monte Carlo evidence as an exact fixed-matrix theorem.

## Large targeted simulations

Every one of the 42 configurations has 100,000 synthetic datasets (4.2 million total). FFT conditional bootstrap CDFs and necessary/sufficient order-statistic conditions enclose the finite-10,000-draw coverage probability for fresh resampling. Reported JSON includes both estimates, Monte Carlo intervals, all seeds and numerical FFT roundoff diagnostics. This is targeted simulation, not the full protocol validation.

The six additional probes below use the exact `hr3-bootstrap-v1` family-count matrices generated from committed random.mjs, including draws for all zero-weight lineages. Integer-valued float32 matrix multiplication computes sampled counts exactly; a 1e-10 endpoint enclosure accommodates arithmetic reordering. Each probe has 100,000 independently generated synthetic datasets. Wilson 95% Monte Carlo enclosures are pointwise diagnostics, not simultaneous mathematical ceilings or full-grid acceptance.

| Frozen-matrix probe | Coverage estimate % | MC 95% enclosure % |
|---|---:|---:|
| development-within-homogeneous-C | 92.924–92.924 | 92.763–93.081 |
| development-within-correction-C | 92.759–92.759 | 92.597–92.918 |
| development-within-reversal-C | 92.117–92.117 | 91.948–92.282 |
| development-within-scope-C | 92.478–92.478 | 92.313–92.640 |
| development-overall-homogeneous-J | 92.641–92.641 | 92.478–92.801 |
| test-within-reversal-J | 92.793–92.793 | 92.631–92.952 |

The targeted probes independently support development/test undercoverage; not every remaining cell has proven nominal coverage. No interval is retrospectively certified, and no failing development/test cell is excluded.

## Prospective remedy and checks

Apply the same KL-Chernoff carrier/hull rule to all development/test binary absolute panels, including interior outcomes and all types. Under independent (not necessarily identical) Bernoulli families the carrier has coverage >=95% by Chernoff and AM–GM. Numeric Poisson-binomial checks of the carrier cover all 28 development/test configurations; minimum numeric coverage is 98.912167%. This is not a full validation pass. T−U and all paired guard intervals remain the frozen corrected bootstrap, and their full validation remains pending.

Remove only the unused pilot allocation from acceptance: its four cells/52 scalar outputs remain mandatory method reports and its full workload remains. Empirical pilot interval use stays prohibited. Remaining Holm family: M=8×13+20×5=204; first cutoff .05/204=.00024509803921568627; largest first-step rejecting count remains 1863/2000. No threshold is weakened.

## Commands and actual exits

- `nice -n 10 python -B a5-structural-r1.py`: exit **0**, 42 configurations complete.
- `nice -n 10 python -B a5-percentile-bound-r1.py`: initial attempt exit **1** (mpz-to-Decimal conversion); fixed integer conversion, final rerun exit **0**, 12 proofs/bounds complete. The initial error was computational, not a discarded statistical failure.
- `nice -n 10 python -B a5-fixed-matrix-r1.py`: exit **0**, six frozen-matrix probes complete.
- `nice -n 10 python -B a5-kl-check-r1.py`: exit **0**, 28 carrier checks complete.

All computation/output files are under this dispatch directory. The analysis harness is read-only and remains unchanged. Raw JSON retains exact probabilities, enumeration scope, rounding bounds, seeds, matrix hashes and script hashes. Mathematical bounds, fresh-resampling simulation and frozen-matrix simulation are explicitly distinguished.
