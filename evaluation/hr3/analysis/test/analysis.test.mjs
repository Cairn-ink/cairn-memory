import test from 'node:test';
import assert from 'node:assert/strict';
import { random } from '../random.mjs';
import { bootstrap, correctedReplicate, familyDraws, analyticCovariance, lineageSensitivity } from '../bootstrap.mjs';
import { covariance, mean, boundarySupplement, zeroHardViolationUpper, errorRates, integerBudget, monteCarlo, interval } from '../statistics.mjs';
import { powerLineage, powerDataset, coverageDataset } from '../simulation.mjs';
import { powerCells, coverageCells, allocation, CANDIDATE_CHOICES, CONTRASTS } from '../design.mjs';
import { decision, simulationGates, judgmentDecision } from '../decision.mjs';
import { exactEnvelope, conservativeOuterEnvelope } from '../judgment.mjs';
import { boundaryChecks } from '../boundary.mjs';

function mixed() {
  const rng = random('mixed-precursor');
  return { names: ['absolute', 'paired', 'guard'], lineages: [2, 4, 8, 2, 4, 8].map((m, h) => ({ id: String(h), type: h < 3 ? 'a' : 'b',
    weights: [1 / 6, 1 / 6, h % 2 ? 0 : 1 / 3], values: Array.from({ length: m }, () => { const x = rng.uniform(), y = rng.uniform(); return [x, x - y, 2 * x - y]; }) })) };
}
test('§15 precursor: 128 mixed-m=2/4/8 direct/count parity checks at 1e-12, including guard weights', () => {
  const data = mixed(), rng = random('128-parity');
  for (let b = 0; b < 128; b++) {
    const draws = familyDraws(data, rng), direct = correctedReplicate(data, draws), counts = correctedReplicate(data, draws, 'count');
    direct.forEach((x, j) => assert.ok(Math.abs(x - counts[j]) <= 1e-12));
  }
});
test('real packed count hot loop equals direct shared-draw route at 1e-12', () => {
  const data = powerDataset({ effect: .08, discordance: .5, icc: .1, guardHarm: true }, 'packed-test').data;
  // Full m=8, all five outcomes; modest draw count for a parity check.
  const a = bootstrap(data, { draws: 128, route: 'direct' }), b = bootstrap(data, { draws: 128 });
  a.replicates.forEach((r, j) => r.forEach((x, i) => assert.ok(Math.abs(x - b.replicates[j][i]) <= 1e-12)));
});
test('§15 precursor: 100000 draws per split reproduce corrected/analytic variance and shared covariance', t => {
  const reports = [];
  for (const split of ['pilot', 'development', 'test']) {
    const rng = random('variance/' + split), planned = allocation(split);
    const data = { names: ['absolute', 'paired', 'guard'], lineages: planned.map(l => ({ id: l.id, type: l.type,
      weights: [1 / planned.length, 1 / planned.length, l.multihop ? 1 / planned.filter(x => x.multihop).length : 0],
      values: Array.from({ length: l.m }, () => { const x = rng.uniform(), y = rng.uniform(); return [x, x - y, x - .2 * y]; }) })) };
    const target = analyticCovariance(data), result = bootstrap(data, { draws: 100000 });
    const ratios = result.replicates.map((r, j) => covariance(r) / target[j][j]);
    for (const ratio of ratios) assert.ok(ratio > .975 && ratio < 1.025, `${split} ratio ${ratio}`);
    const covRatio = covariance(result.replicates[0], result.replicates[1]) / target[0][1];
    assert.ok(covRatio > .97 && covRatio < 1.03);
    const m = planned[0].m, ordinaryRatio = ratios[0] * (m - 1) / m;
    assert.ok(Math.abs(ordinaryRatio - (m - 1) / m) < .025);
    reports.push({ split, draws: 100000, correctedVarianceRatios: ratios, sharedCovarianceRatio: covRatio, ordinaryVarianceRatio: ordinaryRatio });
  }
  t.diagnostic(JSON.stringify(reports));
});
test('§12 ICC mixture preserves J margins, discordance and component ICC for rho=0/.1/.3', t => {
  const report = [];
  for (const rho of [0, .1, .3]) for (const guardHarm of [false, true]) {
    const rng = random(`icc/${rho}/${guardHarm}`), cell = { effect: .08, discordance: .5, icc: rho, guardHarm };
    const t1 = [], t2 = [], u = [], delta1 = [], delta2 = [], c1 = [], c2 = []; let discordant = 0;
    for (let i = 0; i < 40000; i++) {
      const a = powerLineage(cell, rng);
      t1.push(a[0].T); t2.push(a[1].T); u.push(a[0].U);
      delta1.push(a[0].T - a[0].U); delta2.push(a[1].T - a[1].U);
      c1.push(a[0].t[0]); c2.push(a[1].t[0]); discordant += a[0].T !== a[0].U;
    }
    const correlation = (a, b) => covariance(a, b) / Math.sqrt(covariance(a) * covariance(b));
    assert.ok(Math.abs(mean(t1) - .48) < .009); assert.ok(Math.abs(mean(u) - .4) < .009);
    assert.ok(Math.abs(discordant / 40000 - .5) < .009);
    const observed = [correlation(t1, t2), correlation(delta1, delta2), correlation(c1, c2)];
    observed.forEach(v => assert.ok(Math.abs(v - rho) < .022, `ICC=${rho} observed=${v}`));
    report.push({ rho, guardHarm, meanT: mean(t1), meanU: mean(u), discordance: discordant / 40000, observedICC: observed });
  }
  t.diagnostic(JSON.stringify(report));
});
test('grid: exactly 60 power and 12 coverage cells, actual allocations and coverage weights', () => {
  assert.equal(powerCells().length, 60); assert.equal(coverageCells().length, 12);
  for (const cell of coverageCells()) {
    const { data, truth } = coverageDataset(cell, 'coverage-structure');
    const p = bootstrap(data, { draws: 2 });
    assert.equal(p.names.length, 13); assert.equal(truth.length, 13);
    assert.ok(Math.abs(truth[3] - (cell.distribution.endsWith('bernoulli') ? (cell.distribution.startsWith('hetero') ? CANDIDATE_CHOICES.coverage.heterogeneousP.reduce((s, p) => s + p ** 3, 0) / 5 : .4 ** 3) : .4)) < 1e-12);
  }
});
test('decision uses raw intervals, four conjunctive guards, strict boundaries and all completion gates', () => {
  const result = { names: CONTRASTS.map(e => e.name), point: [.05, 0, 0, 0, 0], intervals: [[.001, .1], ...Array.from({ length: 4 }, () => [-.05, .03])].map(raw => ({ raw, display: [0, 1] })) };
  assert.equal(decision(result, simulationGates()), 'Advance');
  const gates = simulationGates(); gates.validFinalShare.O = .979;
  assert.equal(decision(result, gates), 'Inconclusive');
  result.intervals[0].raw[0] = 0; assert.equal(decision(result, simulationGates()), 'Inconclusive');
  result.intervals[0].raw[1] = .049; assert.equal(decision(result, simulationGates()), 'Keep U');
  result.intervals[0].raw = [.001, .1]; result.intervals[4].raw = [-.1, -.051];
  assert.equal(decision(result, simulationGates()), 'Keep U');
  assert.equal(decision(result, {}), 'Inconclusive');
  const hard = simulationGates(); hard.hardViolations.replayResurrection = true;
  assert.equal(decision(result, hard), 'Keep U');
  assert.deepEqual(judgmentDecision('Advance', ['Advance', 'Keep U'], true), { decision: 'Inconclusive', judgmentSensitive: true });
});
test('boundary supplements, display clipping and Monte Carlo uncertainty retain raw tails', () => {
  assert.deepEqual(boundarySupplement(0, 2), [0, 1 - Math.sqrt(.025)]);
  assert.deepEqual(boundarySupplement(2, 2), [Math.sqrt(.025), 1]);
  assert.equal(boundarySupplement(1, 2), null); assert.throws(() => boundarySupplement(0, 0));
  assert.ok(Math.abs(zeroHardViolationUpper(10) - (1 - .05 ** .1)) < 1e-15);
  const ci = interval([-1, 0, 1, 2], true); assert.ok(ci.raw[0] < 0 && ci.raw[1] > 1); assert.deepEqual(ci.display, [0, 1]);
  const mc = monteCarlo(2000, 2000); assert.equal(mc.mcse, 0); assert.ok(mc.wilson95[0] < 1);
  const boundaries = boundaryChecks(); assert.equal(boundaries.cells.length, 6);
  assert.ok(boundaries.cells.every(c => c.checks.every(x => x.unconditionalNoncoverageContribution <= .05)));
});
test('judgment upper bounds and integer budgets use all eligible keys, unsupported strata rate=1', () => {
  const rates = errorRates(0, 80);
  assert.ok(Math.abs(rates.upper - (1 - .05 ** (1 / 80))) < 1e-12);
  assert.equal(integerBudget(80, rates.upper), 3); assert.equal(integerBudget(3, 2), 3);
  assert.equal(errorRates(0, 0).upper, 1); assert.equal(errorRates(80, 80).upper, 1);
});
test('judgment exact assignments recenter separately, propagate keys and parent scenarios', () => {
  const buildData = verdicts => ({ names: ['P'], lineages: [{ id: 'a', type: 'a', weights: [1], values: [[verdicts.get('shared')], [verdicts.get('shared')]] }] });
  const result = exactEnvelope({ keys: [{ id: 'shared', verdict: 1, stratum: 'all', parentRule: 'p' }], strata: { all: 1 }, buildData, draws: 128,
    evaluateDecision: r => r.point[0] === 1 ? 'Advance' : 'Keep U', parentScenarios: [{ name: 'p', keys: ['shared'] }] });
  assert.equal(result.assignments, 2); assert.equal(result.parentScenarios, 1); assert.equal(result.tippingPoint, 1);
  assert.deepEqual(result.bounds[0].point, [0, 1]); assert.deepEqual(result.bounds[0].lower, [0, 1]);
  assert.throws(() => exactEnvelope({ keys: [{ id: 'shared', verdict: 1, stratum: 'all' }], strata: { all: 1 }, buildData, maxAssignments: 1 }), /limit/);
});
test('conservative envelope includes negative replicate coefficients and all exact assignments', () => {
  const data = { names: ['P'], lineages: [{ id: 'a', type: 'a', weights: [1], values: [[0], [1]] }] };
  const outer = conservativeOuterEnvelope(data, [[[[0, 1]], [[0, 1]]]], { draws: 128 });
  assert.ok(outer.bounds[0].lower[0] < 0); assert.ok(outer.bounds[0].upper[1] > 1);
  for (const a of [0, 1]) for (const b of [0, 1]) {
    const exact = bootstrap({ ...data, lineages: [{ ...data.lineages[0], values: [[a], [b]] }] }, { draws: 128 });
    assert.ok(exact.intervals[0].raw[0] >= outer.bounds[0].lower[0]); assert.ok(exact.intervals[0].raw[1] <= outer.bounds[0].upper[1]);
  }
});
test('lineage sensitivity is separate, paired and deterministic', () => {
  const data = mixed(), a = lineageSensitivity(data, { draws: 128 }), b = lineageSensitivity(data, { draws: 128 });
  assert.deepEqual(a, b); assert.notEqual(a.method, bootstrap(data, { draws: 2 }).method);
});
