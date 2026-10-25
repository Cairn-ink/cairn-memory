export const FROZEN = Object.freeze({ datasets: 2000, draws: 10000, effects: [0, .03, .05, .08, .10],
  discordance: [.30, .50], icc: [0, .10, .30], baseline: .40, guardHarmShare: .30,
  estimateThreshold: .05, guardThreshold: -.05, bootstrapSeed: 'hr3-bootstrap-v1' });
export const ALLOCATIONS = Object.freeze({ pilot: { lineages: 30, m: 2, perType: 6, multiPerType: 4 },
  development: { lineages: 50, m: 4, perType: 10, multiPerType: 6 },
  test: { lineages: 200, m: 8, perType: 40, multiPerType: 20 } });
export const TYPES = ['correction', 'reversal', 'refinement', 'scope_change', 'expiry'];
export const CONTRASTS = [
  { name: 'J(T)-J(U)', component: 'J', arm: 'T', minus: 'U' },
  ...['C', 'O', 'R'].map(component => ({ name: `${component}(T)-${component}(U)`, component, arm: 'T', minus: 'U' })),
  { name: 'multihop R(T)-R(U)', component: 'R', arm: 'T', minus: 'U', multihop: true },
];
export const CANDIDATE_CHOICES = Object.freeze({
  status: 'REQUIRES-PROSPECTIVE-NONAUTHOR-REVIEW',
  failureSelection: 'one independently uniform C/O/R failure per failed arm; independent across arms except guard-harm override',
  guardHarm: 'in 30% of both-failure pairs set U failure R and T failure C',
  sensitivity: 'whole lineages within type and equal-weight/multihop strata, percentile intervals, no finite-family rescale',
  coverage: { homogeneousP: .4, heterogeneousP: [.2, .3, .4, .5, .6], normalMean: .4, homogeneousSD: .2, heterogeneousSD: [.1, .15, .2, .25, .3] },
  coverageDependence: 'independent components/arms/families conditional on fixed lineage; normal P and contrasts are linear score analogues',
  materialUndercoverage: 'not specified: report Wilson upper bound below .95 as an audit flag, never automatic acceptance',
  decisionPrecedence: 'validity gates, T hard violation, judgment robustness, Keep U statistical conditions, Advance, otherwise Inconclusive',
  randomStreams: 'SHA256-seeded xoshiro128**, planned lineage order, fixed primary draws reused across datasets/assignments; separate lineage stream; interpolated (B-1)*p quantiles',
  boundaryProbabilities: [0, .001, .01, .99, .999, 1],
});
export function allocation(split) {
  const a = ALLOCATIONS[split];
  if (!a) throw Error('Unknown split');
  return TYPES.flatMap(type => Array.from({ length: a.perType }, (_, i) => ({ id: `${split}/${type}/${i}`, type, m: a.m, multihop: i < a.multiPerType })));
}
export function powerCells() {
  return FROZEN.effects.flatMap(effect => FROZEN.discordance.flatMap(discordance => FROZEN.icc.flatMap(icc => [false, true].map(guardHarm => ({
    kind: 'power', split: 'test', effect, discordance, icc, guardHarm,
    id: `power-d${effect}-q${discordance}-icc${icc}-${guardHarm ? 'harm' : 'benign'}`,
  })))));
}
export function coverageCells() {
  return Object.keys(ALLOCATIONS).flatMap(split => ['homogeneous-bernoulli', 'heterogeneous-bernoulli', 'homoscedastic-normal', 'heteroscedastic-normal'].map(distribution => ({
    kind: 'coverage', split, distribution, id: `coverage-${split}-${distribution}`,
  })));
}
export const allCells = () => [...powerCells(), ...coverageCells()];
