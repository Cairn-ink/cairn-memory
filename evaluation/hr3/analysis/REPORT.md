# HR-3 offline analysis delivery

Implemented only under `evaluation/hr3/analysis/` on `experiment/hr3-update-policy`. No network, credentials, pilot data, paid calls, commits or full-grid execution. Sibling harness/integration/scorer/generator/protocol files were read only. No background work remains after the reported checks.

The implementation is ready for prospective review and scheduling; it is not a §15 validation certificate. All manifests remain non-certifying because the full grid and resolution of explicitly disclosed design ambiguities are outstanding. A-1.1 leaves engineering pilots independent of this gate.

## Clause mapping

See [README clause mapping](README.md#clause-mapping) for all clauses and file:line references. Principal entries:

- `bootstrap.mjs:20`, `:43`, `:67`: centered correction, direct/count parity and production count route; `:31` analytic covariance; `:111` separate lineage sensitivity.
- `adapter.mjs:9`, `:41`, `:58`: exact A-4 outputs, finalized pass keys/shared propagation and frozen score vectors; `analyze.mjs:10` calibrated analysis and partial-P handling.
- `decision.mjs:4`, `:26`: guards, hard violations, completion and judgment-sensitive decisions; no added multiplicity correction.
- `design.mjs:30`, `:36` and `simulation.mjs:7`, `:18`, `:38`: frozen 60 power cells, ICC and 12 coverage benchmarks.
- `statistics.mjs:17`, `:24`, `:30`, `:45`, `:56`; `boundary.mjs:6`: MC uncertainty, boundary supplements, exact upper rates and integer budgets.
- `judgment.mjs:10`, `:53`: exact own-centered shared-draw envelopes, parent scenarios, tipping points and conservative negative-coefficient bounds.
- `runner.mjs:10`, `:35`; `storage.mjs:24`, `:32`, `:49`: grid refusal, seeded/checkpointed supervision, manifests, hashes and verified resume.

## Focused checks

All test commands were niced and run directly as `node <test-file>`; no broad suites ran. Each retained exit file records the command exit, without a masking pipe. Node 22 launcher-only output from an early attempt was replaced with per-test results. The final matrix passed:

| Node | Test file | Tests | Passed | Failed | Actual exit |
|---|---|---:|---:|---:|---:|
| 22.16.0 | `analysis.test.mjs` | 11 | 11 | 0 | 0 |
| 22.16.0 | `adapter.test.mjs` | 6 | 6 | 0 | 0 |
| 22.16.0 | `runner.test.mjs` | 2 | 2 | 0 | 0 |
| 24.15.0 | `analysis.test.mjs` | 11 | 11 | 0 | 0 |
| 24.15.0 | `adapter.test.mjs` | 6 | 6 | 0 | 0 |
| 24.15.0 | `runner.test.mjs` | 2 | 2 | 0 | 0 |

**19/19 tests per Node version; 38 passing executions.** Logs and exits: `reports/*-tests*`; structured evidence: [test-summary.json](reports/test-summary.json).

128/128 mixed-m direct/count replicates matched at 1e-12. At 100,000 corrected draws per split, nine corrected/analytic variance ratios were 0.992461–1.001672; three shared-covariance ratios were 0.991054–1.000371. The corresponding ordinary-bootstrap ratios were 0.497370 / 0.750541 / 0.874751. ICC checks used 40,000 lineages per rho/harm combination, preserved J(U)=.40, J(T)=.48 and q=.50 within prespecified tolerances, and checked J, paired-difference and C ICC.

Exact test names (source file:line):

- `adapter.test.mjs:11` — A-4 scorer outputs map C/O/R/J without changing component validity or citation semantics
- `adapter.test.mjs:18` — real integration A-4 adapter referrals retain pass keys and parent-rule identities
- `adapter.test.mjs:30` — forced-J-zero still requires resolution, malformed attempts stay zero, unexecuted never zero-filled
- `adapter.test.mjs:40` — not_stated empty-delivery factual R is retained separately from stated supported R
- `adapter.test.mjs:47` — score vectors use planned allocations, paired family J, guard/type weights, missing data fail closed
- `adapter.test.mjs:60` — A-1.1 blocks engineering-pilot intervals; calibrated analysis derives O completion rather than trusting a claimed gate
- `analysis.test.mjs:17` — §15 precursor: 128 mixed-m=2/4/8 direct/count parity checks at 1e-12, including guard weights
- `analysis.test.mjs:24` — real packed count hot loop equals direct shared-draw route at 1e-12
- `analysis.test.mjs:30` — §15 precursor: 100000 draws per split reproduce corrected/analytic variance and shared covariance
- `analysis.test.mjs:48` — §12 ICC mixture preserves J margins, discordance and component ICC for rho=0/.1/.3
- `analysis.test.mjs:68` — grid: exactly 60 power and 12 coverage cells, actual allocations and coverage weights
- `analysis.test.mjs:77` — decision uses raw intervals, four conjunctive guards, strict boundaries and all completion gates
- `analysis.test.mjs:91` — boundary supplements, display clipping and Monte Carlo uncertainty retain raw tails
- `analysis.test.mjs:101` — judgment upper bounds and integer budgets use all eligible keys, unsupported strata rate=1
- `analysis.test.mjs:107` — judgment exact assignments recenter separately, propagate keys and parent scenarios
- `analysis.test.mjs:115` — conservative envelope includes negative replicate coefficients and all exact assignments
- `analysis.test.mjs:124` — lineage sensitivity is separate, paired and deterministic
- `runner.test.mjs:8` — runner refuses reduced/modified grids unless explicit engineering smoke and limits workers to four
- `runner.test.mjs:17` — seeded determinism, checkpoint resume, worker-count independence and tamper refusal

## Measured throughput and projection

Benchmark: Node v22.16.0, nice 10, 1 worker, six datasets at **10,000 draws**; actual exit **0**. Wall time 2.137 s; peak RSS 111,220 KiB. Measured implementation SHA-256: `72eb59258e9b7ea87f970bae14f1f3617dfa1cb91ff45349cacbe589adc3e1df`. Raw arrays and cell checkpoints are retained in `reports/benchmark-run/`. The final source/authority fingerprint was independently rechecked against this benchmark hash: [implementation-verification.json](reports/implementation-verification.json).

| Phase | Measured |
|---|---:|
| Corrected power primary, mean | 0.271723 s/dataset |
| Whole-lineage power sensitivity, mean | 0.073850 s/dataset |
| Coverage pilot/dev/test | 0.055035 / 0.119791 / 0.812046 s/dataset |
| Dataset encoding/hash/filesystem I/O, six datasets | 27.098 ms |
| Manifest/cell I/O | 13.798 ms |
| Source fingerprint (one-time) | 22.994 ms |
| Synthetic exact judgment optimization, 9 assignments + 1 parent scenario | 64.158 ms |

The unchanged workload is **120,000 power datasets, 1.2B primary + 1.2B lineage replicates, plus 24,000 coverage datasets / 240M primary replicates**. Projection: resampling 13.71 h; generation 0.061 h; steady runner/I/O 0.40 h; total **14.18 serial h**, with **at least 36 h** scheduling allocation. Four-worker ideal 3.54 h is unmeasured and not promised. Retained binary arrays alone require **120,960,000,000 bytes**. No full grid was run.

Hot-cache microbenchmarks and a small number of cells do not establish sustained disk or shared-machine throughput. Growing checkpoint scans/manifests can add cost. Production judgment optimization, subscription/adjudication work, review and contention are excluded. The small optimizer timing is not a production projection. [Full benchmark evidence](reports/benchmark.json).

## Ambiguities and remaining gates

Explicit candidate conventions, never silently certified: failure-component probabilities/dependence; coverage probabilities, normal analogues, heterogeneity and dependence; whole-lineage stratification/weighting; material-undercoverage acceptance; boundary grid/combination; calibration key/application and parent-failure registries; RNG/stream/quantile conventions; and decision precedence in a possible skewed-interval overlap. See [README ambiguity list](README.md#ambiguities-requiring-prospective-clarification) and hashed `CANDIDATE_CHOICES`. Statistical allocations, effect grid, numeric thresholds, correction and multiplicity remain frozen.

The full grid, non-author clarification/review, any undercoverage investigation and external calibration/subscription/resource gates remain before development. There is no unattended notification facility in this deliverable; the primary must establish and verify a supported queue/monitor before unattended execution.

## Changed files and scope checks

Mechanically cross-checked **59 files**, using Git tracked-diff + untracked-file enumeration against independent `find -type f`; list diff actual exit **0**. [Complete changed-file manifest](reports/delivery.json), [Git list](reports/changed-files.git.txt), [independent filesystem list](reports/changed-files.find.txt). All files are new paths under the allowed directory. Whitespace checks include untracked text files; no sibling changes were made by this task.
