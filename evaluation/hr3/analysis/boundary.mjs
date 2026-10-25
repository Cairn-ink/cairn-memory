import { ALLOCATIONS, CANDIDATE_CHOICES } from './design.mjs';
import { boundarySupplement, zeroHardViolationUpper } from './statistics.mjs';

// Exact calculation, separate from the 12 interior coverage benchmarks. These
// numbers describe only the extreme-observation supplements, not full CIs.
export function boundaryChecks() {
  const candidateProbabilities = CANDIDATE_CHOICES.boundaryProbabilities;
  return { method: 'analytic-boundary-supplements-only', candidateProbabilities,
    uncertainty: 'No Monte Carlo error: all probabilities below are analytic.',
    cells: Object.entries(ALLOCATIONS).flatMap(([split, a]) => [a.lineages * a.m, a.perType * a.m].map(n => {
      const failure = boundarySupplement(0, n), success = boundarySupplement(n, n);
      return { split, n, allFailureInterval: failure, allSuccessInterval: success, zeroHardViolationUpper: zeroHardViolationUpper(n),
        checks: candidateProbabilities.map(p => ({ truth: p, allFailureProbability: (1 - p) ** n, allSuccessProbability: p ** n,
          allFailureCovers: failure[0] <= p && p <= failure[1], allSuccessCovers: success[0] <= p && p <= success[1],
          unconditionalNoncoverageContribution: (p > failure[1] ? (1 - p) ** n : 0) + (p < success[0] ? p ** n : 0) })) };
    })) };
}
