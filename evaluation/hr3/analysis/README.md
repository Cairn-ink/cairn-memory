# HR-3 offline confirmatory analysis

Node >=22.16, ESM, built-ins only. This directory implements protocol v0.3.4
§§11–13/15 and A-4 score-vector adaptation. It makes no network, paid, key,
pilot-data, calibration or adjudicator calls. All outputs stay below this
directory. No full validation grid has been run by this implementation task.

**Implementation and engineering checks are not §15 acceptance.** Several
simulation details are absent from the authority. Explicit candidate choices
are recorded in `design.mjs:13` and every result manifest. Consequently even a
completed full run has `certificationEligible:false`; prospective clarification,
non-author review, the complete workload and coverage review remain necessary.
This is distinct from `engineeringSmoke:true`, which always means non-certifying
reduced/engineering execution. No pilot effect size sets any parameter.

A-1.1 moves corrected-analysis validation and resource validation to **before
development and any inference**. Engineering pilots do not wait for this work
and may publish only uncalibrated mechanical bounds. `analyzeScores` rejects
uncalibrated inputs. This harness cannot authorize a paid stage or resolve the
separate calibration/subscription resource gate.

## Usage

Run only these focused tests, directly, to retain their individual TAP counts
in environments whose `node --test` launcher suppresses child test reporting:

```sh
nice -n 10 node evaluation/hr3/analysis/test/analysis.test.mjs
nice -n 10 node evaluation/hr3/analysis/test/adapter.test.mjs
nice -n 10 node evaluation/hr3/analysis/test/runner.test.mjs
```

Capture each command's actual exit code, rather than a pipe's last command.
The retained `reports/*-tests.tap` and `reports/*-tests.exit` contain the measured
checks. No broad repository suites, dependency installs, packaging edits or
commits are needed for this isolated evaluation implementation.

```sh
# Explicitly non-certifying, small deterministic engineering check.
nice -n 10 node evaluation/hr3/analysis/runner.mjs \
  --engineering-smoke --datasets 2 --draws 128 --workers 1 \
  --cells power-d0.05-q0.3-icc0-benign \
  --out evaluation/hr3/analysis/reports/my-smoke

# Six selected datasets, FULL 10,000-draw counts; never the full grid.
# Use a fresh output directory if implementation/design hashes have changed.
nice -n 10 node evaluation/hr3/analysis/benchmark.mjs \
  evaluation/hr3/analysis/reports/my-benchmark

# Scheduling example FOR THE PRIMARY; not executed in this task.
# Full fixed grid: 60 power cells + 12 coverage cells, 2,000 datasets each.
nice -n 10 node evaluation/hr3/analysis/runner.mjs \
  --workers 1 --out evaluation/hr3/analysis/reports/full
```

The runner refuses reductions in cells, datasets or draws (and alternative
generation seeds) without `--engineering-smoke`. The full seed is
`hr3-validation-v1`; per-dataset generation seeds append `/cell-id/index`.
Resampling always starts from `hr3-bootstrap-v1` with shared family draws
across outcomes; lineage sensitivity uses its separate `/lineage` stream.
SHA-256 seeding and xoshiro128** integer sampling are implemented locally.
Floating-point results are expected to be bit-identical on the same supported
Node/V8/platform; transcendental functions across platforms are not guaranteed
bit-identical. Timestamps, timings and host metadata are intentionally variable.

Rerun the **same command and output path** to resume. Completed datasets are
verified and skipped. Worker count may change from 1 to 4 without changing
numerical results. `--stop-after N` checkpoints after at most N newly dispatched
datasets; it leaves the entire planned grid unchanged and the status incomplete.
SIGINT/SIGTERM stop dispatch and finish/checkpoint active work. Exit 130 marks
an interrupted invocation; exit 1 marks an error. A deliberate checkpoint limit
can exit 0 with status `incomplete`: exit 0 is never a validation certificate.

Only one process may own `runner.lock`. After an unclean OS termination, verify
that the recorded process and workers have stopped before manually removing
that lock; it is never automatically stolen. Atomic same-directory rename
protects checkpoints from ordinary process interruption. No fsync/power-loss
durability claim is made. Orphan binaries without committed dataset JSON are
recomputed. A malformed/hash-mismatched committed checkpoint stops the runner;
it is never silently replaced. Resume verifies dataset hashes and recomputes
cell summaries rather than trusting a stale aggregate manifest.

## Score-vector contract and actual-data API

`adaptScore` takes an observation envelope:

```js
{
  family: 'frozen-family-id', lineage: 'frozen-lineage-id',
  type: 'correction', arm: 'T', checkpoint: 4, attempted: true,
  score: /* exact return value of scorer/score(gold, submission) */
}
```

The scorer must declare `hr3-scorer-a4-v2` and
`hr3-a4-slot-explanation-keys-v2`. `scores:{C,O,R,J}` must satisfy the
scorer's three-valued conjunction. Null components and **all** referral keys,
including referrals with mechanically forced J=0, require finalized 0/1 pass
verdicts in `resolutions:{[key]:0|1}`. Malformed attempted responses remain
four zeros. Unattempted observations are rejected, never zero-filled.
Factual C/O do not acquire citation requirements. `reasonStratum`, negative-R
baseline, pass key, parent rule, contract/dictionary provenance and forced-J-zero
status are retained. R correctness and support resolve conjunctively.

The frozen allocation argument to `scoreVectors` is
`{split,planned:[{id,type,multihop,families:[...]}],estimands,checkpoint:4}`.
The caller supplies published family IDs and declared multihop flags. It does
not infer them from results. Pilot/dev/test require 30/50/200 lineages,
2/4/8 families each, 6/10/40 lineages per type and 4/6/20 multihop lineages
per type. Unknown, duplicate, misjoined, missing and unfinalized observations
fail closed. Intermediate checkpoints can be separately selected; family draws
can be shared across any explicitly constructed additional linear outcomes.

Vectors are `{names,lineages:[{id,type,weights,values}]}`. Each `values` entry
is one already-scored family vector. Default columns are J(T)-J(U), C(T)-C(U),
O(T)-O(U), R(T)-R(U), multihop R(T)-R(U), in that order. Overall weights are
1/30, 1/50, 1/200; multihop weights 1/20, 1/30, 1/100. `absoluteEstimands`
creates C/O/R/J absolute panels and within-type weights 1/6, 1/10, 1/40.
Zero-weight lineages still consume identical family draws. J is computed per
family, never as the product of aggregate component means.

`analyzeScores({observations,resolutions,split,planned,gates,calibrated:true})`
combines primary analysis, sensitivity and P overall/by-type panels. It derives
T/U/O valid final shares from actual observations rather than trusting claimed
percentages. The caller must also explicitly establish complete execution,
resolved adjudication, validity, budget and judgment robustness. Missing P
families produce denominator-only partial panels, without completed-design CIs;
P completion does not gate T/U inference. P headlines retain the required pinned
product/public-operation/shared-extraction qualification. Raw intervals and
replicates remain untruncated; only absolute-score display endpoints intersect
with [0,1].

`decision` implements the frozen point >=.05, primary lower >0 and all guard
lowers >=-.05 conjunctive advancement rule; Keep U uses upper <.05, any guard
upper <-.05, or a T hard violation. Hard violations are unauthorized exposure,
named-forgotten exposure, replay resurrection and stale Card current use.
Completion/validity/budget failures force Inconclusive; valid final shares in
T/U/O must each be >=.98. The statistical decision requires finalized error-free
labels in simulation; factual use additionally requires established judgment
robustness. There is no multiplicity adjustment, pooling with development,
familywise-95% interpretation of Keep U, or additional P completion gate.

## Judgment-error handling

`errorRates(errors, independentN)` returns empirical, exact one-sided 95%
Clopper-Pearson upper and capped doubled-upper rates. Unsupported strata return
rate 1. `integerBudget(K,rate)` implements min(K,ceil(K*min(1,rate))) using all
eligible distinct keys. The calibration owner supplies independent-world/key
denominators and separate component/language/style/distortion and FA/FR strata;
application counts are not independent calibration counts.

`propagateJudgments` applies each frozen key's pass verdict consistently to
every explicitly registered application across arms/families/checkpoints,
then recomputes component scores and J. Its default applications are direct
scorer referrals; propagated mappings must be frozen explicitly. One pass may
not have competing keys. Scorer context keys alone do not define propagation
or a parent-rule failure population.

`exactEnvelope({keys,strata,buildData,evaluateDecision,parentScenarios,...})`
enumerates every assignment within each integer budget, including concentrated
influential-key assignments, and separately supplied parent-rule failures.
`buildData(Map)` must propagate keys and construct score vectors anew, normally
by composing `propagateJudgments` and `scoreVectors`. Every assignment recomputes
its own point and lineage means, then uses the same fixed family draws. The
result reports point/lower/upper endpoint ranges for every requested estimand,
decision changes, influential single keys and minimum changed-key tipping count.
Call it separately for empirical, upper and doubled-upper budgets, plus P panels
and the primary/guards as needed. It throws at the exact enumeration limit;
truncated searches never certify robustness.

`conservativeOuterEnvelope` takes per-family outcome bounds and uses the actual
linear coefficient `(w - w*c + w*c*count)/m`, including its negative values.
It returns unrestricted all-dependent conservative outer bounds separately
labeled from calibration-budget envelopes. It ignores key budgets/dependence,
so it can be loose; failure to establish robustness yields Inconclusive.
`judgmentDecision` converts any advancement change or unestablished robustness
to judgment-sensitive/Inconclusive. These APIs do not invent key populations,
calibration labels or prospective parent scenarios.

## Simulation and coverage

The 60 power cells are effects {0,.03,.05,.08,.10} x discordance {.30,.50} x
ICC {0,.10,.30} x benign/guard-harm, at J(U)=.40. U-only=(q-delta)/2,
T-only=(q+delta)/2. One Bernoulli(rho) **per lineage** selects one shared
complete paired outcome for all eight families versus eight independent
complete outcomes. This preserves both marginals and gives ICC rho for every
nondegenerate outcome function, not just J. Guard harm overrides U failure to
R and T failure to C in 30% of both-failure pairs. All five primary/guard
columns use the same corrected draws; the separate whole-lineage analysis also
keeps outcome pairing.

The 12 additional cells cross actual pilot/development/test allocations with
homogeneous/heterogeneous Bernoulli and homoscedastic/heteroscedastic normal
families. They contain 13 columns: P C/O/R/J overall and within correction type,
paired J, three component guards and multihop R. Bernoulli components have
independent success p, so family J has probability p^3. Normal cells use the
linear average of components as the J analogue; they are mathematical coverage
benchmarks, not claimed binary accuracy data. Conditional true means account
for the fixed heterogeneity. No extra lineage resampling is added to the 240M
coverage draws. Power-cell contrasts/guards at ICC=0 also provide the required
independent-outcome coverage; ICC>0 results are stress scenarios, labeled
separately from independent conditional-family coverage.

Each cell reports decision frequencies (power cells), primary coverage and
separate lineage coverage (power cells), plug-in Monte Carlo SE and Wilson 95%
Monte Carlo intervals. At 2,000 datasets, MCSE near .95 is about .00487 and
the maximum is .01118. Wilson intervals remain nondegenerate at 0/2000 and
2000/2000. These describe dataset-level simulation uncertainty; 10,000
bootstrap replicates are not 10,000 independent coverage trials. Quantile
Monte Carlo error is not separately certified by this protocol.

`boundaryChecks` separately verifies the all-failure/all-success supplement
formulas and zero-hard-violation upper bounds at overall and within-type n for
each allocation. It reports exact extreme-observation probabilities and their
noncoverage contributions on an explicitly candidate boundary probability
grid; this analytic calculation has no Monte Carlo error. It does not claim
coverage of an entire procedure from extreme observations alone. Supplements
never replace the untruncated contrast/guard CIs used for decisions, and
repeated checkpoints never increase independent-family opportunity counts.

## Result manifest and supervision

`manifest.json` contains:

| Field | Meaning |
|---|---|
| `version`, `identitySHA256` | Versioned deterministic design/implementation identity |
| `implementation.{sha256,files}` | SHA-256 of analysis MJS/JSON (including tests), scorer/integration source/schema MJS/JSON, public contract and exact protocol/errata bytes; reports, generated artifacts and dependencies excluded |
| `frozen`, `allocations`, `candidateChoices` | All numerical design constants and unresolved candidate conventions |
| `seed`, `bootstrapSeed`, `datasets`, `draws`, `cells[].design` | Exact generation/resampling plan |
| `engineeringSmoke`, `certificationEligible`, `certificationBlockers` | Explicit non-certifying status and outstanding review gates |
| `status`, `started`, `updated`, `interrupted`, `error` | Execution state, timestamps, failure evidence |
| `runtime` | Node, worker count, measured fingerprint/scan/I/O/startup phase timings |
| `boundarySupplements` | Separate analytic supplement checks |
| `cells[]` | Planned/completed counts, decisions/coverage with MC uncertainty, audit flags, linked result artifact and canonical-content SHA-256 |

`cells/<cell-id>.json` adds the per-dataset index and replicate hashes.
`datasets/<cell-id>/<index>.json` is the authoritative dataset checkpoint:
identity hash, truth, point/interval results, primary and lineage coverage,
decision, boundary information, timings, binary metadata and checkpoint content
hash. Its `.f64le` sibling stores **all untruncated replicates**, primary
columns followed by lineage columns, each in names order, 10,000 little-endian
Float64 values per column. Resume checks identity, content SHA-256, byte length
and draw count before accepting any checkpoint. Cell summaries and the top
manifest are refreshed periodically, on cell completion and at exit; committed
datasets newer than the aggregate manifest are recovered on resume.

Expect **120,960,000,000 bytes (~112.65 GiB)** for uncompressed replicates alone:
1.2B corrected-primary x 5 columns + 1.2B lineage x 5 + 240M coverage x 13,
all at 8 bytes. Allow additional JSON/filesystem headroom and resume-read I/O.
No worker count above four is accepted; one is the default.

The attended runner reports actual completed draws from each worker every 1,024
replicates and prints progress at least every 30 seconds, with active cell,
dataset, phase and last draw count. Five minutes without draw or checkpoint
activity stops dispatch/terminates workers for investigation; a live PID alone
is not progress. Worker or checkpoint errors stop new dispatch, finish active
safe work and retain checkpoints. The dataset scan logs every 1,000 entries.
SIGINT/SIGTERM preserve completed work. stderr/progress and atomic checkpoints
support attended operation; they are **not an unattended notification service**.
The primary must verify a supported queue/monitor/failure-notification mechanism
before leaving a full run unattended. No monitoring is promised after this task.

## Clause mapping

Line numbers refer to this implementation revision, under `evaluation/hr3/`.

| Authority | Implementation and checks |
|---|---|
| Protocol §12 centered correction; m>=2; direct/count routes | `analysis/bootstrap.mjs:20`, `:43`, `:67`; `analysis/test/analysis.test.mjs:17`, `:24` |
| §12 shared paired draws, frozen guard/overall/type/multihop weights | `analysis/bootstrap.mjs:40`; `analysis/adapter.mjs:58`; `analysis/design.mjs:1`; adapter weight/family-J test |
| §12 analytic variance/covariance; §15 precursor | `analysis/bootstrap.mjs:31`; `analysis/test/analysis.test.mjs:30` (100,000 draws/split) |
| §11 untruncated percentiles, display intersection and supplements | `analysis/statistics.mjs:11`, `:24`, `:30`; `analysis/analyze.mjs:10`; `analysis/boundary.mjs:6` |
| §12 separate whole-lineage sensitivity | `analysis/bootstrap.mjs:111` (candidate resampling convention disclosed below) |
| §12 guards, hard violations, gates, multiplicity | `analysis/decision.mjs:4`, `:26`; `analysis/analyze.mjs:10` |
| §12 judgment budgets, exact upper bounds, shared-key propagation and re-centering | `analysis/statistics.mjs:45`, `:56`; `analysis/adapter.mjs:41`; `analysis/judgment.mjs:10`, `:53` |
| §12 60-cell power design and ICC | `analysis/design.mjs:30`; `analysis/simulation.mjs:7`, `:18`, `:27`; ICC marginal test |
| §15 12 coverage cells and boundary supplements | `analysis/design.mjs:36`; `analysis/simulation.mjs:38`; `analysis/boundary.mjs:6` |
| §15 Monte Carlo uncertainty and undercoverage disclosure | `analysis/statistics.mjs:17`; `analysis/runner.mjs:25` |
| §13 and A-1/A-1.1 engineering-vs-inference ordering | `analysis/analyze.mjs:10`; no paid/pilot dispatch in this directory |
| Errata A-4 §5 C/O/R/J and §9 adapter revalidation | `analysis/adapter.mjs:9`, `:41`, `:58`; `analysis/test/adapter.test.mjs:11`, `:18`, `:30`, `:40`, `:47`, `:60` |
| §15 deterministic checkpoint/resume, complete grid, supervision | `analysis/runner.mjs:10`, `:35`; `analysis/storage.mjs:24`, `:32`, `:49`; `analysis/test/runner.test.mjs:8`, `:17` |
| §15 measured throughput and production projection | `analysis/benchmark.mjs:1`; `analysis/reports/benchmark.json` |

The adapter tests use real A-4 `scorer/scorer.mjs:103` outputs, the read-only
`integration/adapters.mjs:63` challenge adapter and independent engineering
fixtures. No pilot submissions or calibrated measurement outcomes are read.

## Ambiguities requiring prospective clarification

1. **Failure-component distribution.** §12 says a J failure selects a component
   but does not specify probabilities or cross-arm dependence. The candidate
   simulator selects exactly one independently uniform C/O/R failure per failed
   arm before the explicit 30% guard-harm override. Guard truths use delta/3
   with C decremented and R incremented by .30*P(both-failure) in harm cells.
   This choice affects advancement power and is not treated as frozen authority.
2. **Coverage parameters.** §15 names four distribution classes without their
   probabilities, means, variances, heterogeneity pattern, cross-outcome
   dependence or normal analogue of J. Candidate values are p=.4 or type
   probabilities [.2,.3,.4,.5,.6], mean=.4, SD=.2 or type SDs
   [.1,.15,.2,.25,.3], independent families/components/arms. Heterogeneity is
   between fixed types/lineages. The candidate within-type coverage panel is
   correction type; additional panels/designs require prospective specification.
3. **Whole-lineage sensitivity.** §12 requires it but does not define
   stratification, fixed versus ratio weights, guard denominators or interval
   method. The candidate resamples whole lineages within type and equal-weight/
   multihop strata, preserving frozen denominators, without the within-family
   correction. Its label explicitly says candidate sensitivity.
4. **Coverage acceptance.** “Material undercoverage” has no numerical acceptance
   threshold or multiple-cell audit rule. A Wilson upper limit below .95 is
   only an investigation flag. There is no automatic coverage pass/freeze gate.
5. **Boundary supplements.** There is no prescribed supplementary parameter
   grid, replication count or combining rule with primary intervals. This
   implementation reports analytic extreme-cell supplements separately on
   p={0,.001,.01,.99,.999,1}; it neither substitutes them into decisions nor
   claims exact overall coverage. The independence conditions for opportunity
   counts must be established outside this harness.
6. **Judgment identities and optimization.** Calibration strata, eligible keys,
   empirical error counts, propagated applications, parent-rule failure sets
   and their prospective scenarios must come from the frozen calibration
   pipeline. A-4 scorer keys identify contextual referrals, not a complete
   application/parent-failure registry. Missing inputs cannot be fabricated;
   robustness remains unestablished/Inconclusive. Production optimization can
   be exponentially larger than the included synthetic timing case.
7. **Draw-generation details.** The bootstrap seed string is fixed, but the RNG
   algorithm, lineage ordering, stream reuse between simulated datasets and
   percentile implementation are not. This implementation uses fixed published
   allocation order, xoshiro128**, identical primary draws across datasets and
   assignments, and linear interpolation at (B-1)*p. These executable conventions
   are hashed in every manifest. Actual score records use published planned order.
8. **Decision overlap.** Extremely skewed percentile replicates can in principle
   satisfy the point/lower advancement criteria while the upper is below .05.
   The table does not state precedence. This implementation checks hard/Keep
   conditions first and documents that candidate operational precedence; it does
   not relax any threshold. Unknown judgment robustness forces Inconclusive.
9. **Resources and review.** §15 subscription/calibration sessions, independent
   semantic audit and production judgment optimization are not executable from
   offline score vectors alone. They remain separate before-development gates.
   The primary must arrange supervised full-grid execution and prospective
   clarification/review; this implementation does not silently waive them.

## Measurements

`reports/benchmark.json` is the authoritative measured report; it includes
full-draw timings for three power cells and three coverage cells, machine/Node/
nice/worker metadata, separately measured generation and I/O phases, synthetic
exact judgment-optimization throughput, implementation hash and projections.
Measured on Node 22.16.0, one worker, nice 10, at 10,000 draws per dataset:

| Work | Measured seconds/dataset |
|---|---:|
| Corrected primary, three power cells | 0.233–0.292; mean 0.27172 |
| Separate lineage sensitivity | 0.069–0.078; mean 0.07385 |
| Coverage, pilot/dev/test heteroscedastic-normal | 0.05503 / 0.11979 / 0.81205 |

Generation projected separately is 0.061 hours. Measured dataset I/O was
27.10 ms across six datasets; manifest/cell I/O was 13.80 ms; source
fingerprinting was 22.99 ms and worker startup 19.12 ms. The synthetic
judgment optimizer enumerated nine allowed assignments plus one parent scenario,
each at 10,000 draws, in 64.16 ms (eight keys, budget one). This does not
support a production optimization projection without the frozen key population.

For 120,000 power datasets (1.2B primary + 1.2B lineage replicates) and 24,000
coverage datasets (240M corrected replicates), measured resampling projects to
**13.71 serial hours**, and generation, steady runner/I/O and fixed startup bring
the projection to **14.18 hours**. Retain **at least 36 hours** of scheduling
allocation. This excludes production judgment optimization, subscription work,
audit and shared-machine contention. The 3.54-hour ideal four-worker estimate is
unmeasured, not a scheduling promise. Six full-draw datasets are a throughput
sample, not cell acceptance or coverage evidence. The full workload was not run.
