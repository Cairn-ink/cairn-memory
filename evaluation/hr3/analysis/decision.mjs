import { FROZEN, CONTRASTS } from './design.mjs';
export const HARD_VIOLATIONS = ['unauthorizedExposure', 'namedForgottenExposure', 'replayResurrection', 'staleCardCurrentUse'];
// Missing validity information is a failed gate, never implicit approval.
export function decision(result, gates) {
  if (result.names?.length !== 5 || result.names.some((n, j) => n !== CONTRASTS[j].name) || result.intervals?.length !== 5 ||
    result.point?.length !== 5 || result.point.some(x => !Number.isFinite(x)) ||
    result.intervals.some(i => i.raw?.length !== 2 || !i.raw.every(Number.isFinite) || i.raw[0] > i.raw[1])) throw Error('Require primary and four guards in frozen order, with finite raw intervals');
  const valid = gates?.completeTest === true && gates.resolvedAdjudications === true && gates.validity === true && gates.budget === true &&
    ['T', 'U', 'O'].every(a => Number.isFinite(gates.validFinalShare?.[a]) && gates.validFinalShare[a] >= .98 && gates.validFinalShare[a] <= 1) &&
    HARD_VIOLATIONS.every(k => typeof gates.hardViolations?.[k] === 'boolean');
  if (!valid) return 'Inconclusive';
  const hard = HARD_VIOLATIONS.some(k => gates.hardViolations[k]);
  const [primary, ...guards] = result.intervals.map(i => i.raw);
  if (hard) return 'Keep U';
  if (gates.judgmentRobust !== true) return 'Inconclusive';
  if (primary[1] < FROZEN.estimateThreshold || guards.some(g => g[1] < FROZEN.guardThreshold)) return 'Keep U';
  if (result.point[0] >= FROZEN.estimateThreshold && primary[0] > 0 && guards.every(g => g[0] >= FROZEN.guardThreshold)) return 'Advance';
  return 'Inconclusive';
}
export function simulationGates() {
  return { completeTest: true, resolvedAdjudications: true, validity: true, budget: true, judgmentRobust: true,
    validFinalShare: { T: 1, U: 1, O: 1 }, hardViolations: Object.fromEntries(HARD_VIOLATIONS.map(k => [k, false])) };
}
// Factual decision: changed statistical advancement or unestablished robustness
// makes the result judgment-sensitive and Inconclusive, including a Keep-U flip.
export function judgmentDecision(baseline, scenarioDecisions, established) {
  const sensitive = !established || scenarioDecisions.some(d => (d === 'Advance') !== (baseline === 'Advance'));
  return { decision: sensitive ? 'Inconclusive' : baseline, judgmentSensitive: sensitive };
}
