import { bootstrap, familyDraws, prepare, BOOTSTRAP_SEED } from './bootstrap.mjs';
import { random } from './random.mjs';
import { interval, integerBudget } from './statistics.mjs';

// Frozen keys: {id,verdict:0|1,stratum,parentRule}. Each eligible key counts,
// accepted or rejected; separate FA/FR strata can have their own budgets.
// buildData(Map<key,verdict>) MUST propagate all applications and recompute
// per-family C/O/R/J (including the correctness/support conjunction for R).
// This callback is explicit: the scorer does not define general propagation.
export function exactEnvelope({ keys, strata, buildData, evaluateDecision, parentScenarios = [], maxAssignments = 65536, draws = 10000 }) {
  if (new Set(keys.map(k => k.id)).size !== keys.length || keys.some(k => ![0, 1].includes(k.verdict) || !strata[k.stratum])) throw Error('Invalid frozen key/stratum registry');
  const budgets = Object.fromEntries(Object.entries(strata).map(([s, rate]) => [s, integerBudget(keys.filter(k => k.stratum === s).length, rate)]));
  const assignments = [], selected = [], used = {};
  function enumerate(i) {
    if (assignments.length >= maxAssignments) throw Error('Exact assignment limit exceeded; use conservativeOuterEnvelope, never a truncated heuristic certificate');
    if (i === keys.length) { assignments.push([...selected]); return; }
    enumerate(i + 1);
    const s = keys[i].stratum;
    if ((used[s] ?? 0) < budgets[s]) {
      used[s] = (used[s] ?? 0) + 1; selected.push(keys[i].id); enumerate(i + 1); selected.pop(); used[s]--;
    }
  }
  enumerate(0);
  const allowed = new Set(keys.map(k => k.id));
  for (const p of parentScenarios) if (!p.name || p.keys.some(k => !allowed.has(k))) throw Error('Invalid parent-rule scenario');
  const scenarios = [...assignments.map(changes => ({ changes, kind: 'calibration-budget' })), ...parentScenarios.map(p => ({ changes: p.keys, kind: `parent:${p.name}` }))];
  let bounds, baselineDecision, tippingPoint = null;
  const decisions = new Set(), influentialKeys = [];
  for (const scenario of scenarios) {
    const changes = new Set(scenario.changes), verdicts = new Map(keys.map(k => [k.id, changes.has(k.id) ? 1 - k.verdict : k.verdict]));
    // A new prepare/point/centering for EVERY assignment; same fixed draws.
    const result = bootstrap(buildData(verdicts), { draws, seed: BOOTSTRAP_SEED });
    if (!bounds) bounds = result.names.map(name => ({ name, point: [Infinity, -Infinity], lower: [Infinity, -Infinity], upper: [Infinity, -Infinity] }));
    bounds.forEach((b, j) => {
      for (const [range, value] of [[b.point, result.point[j]], [b.lower, result.intervals[j].raw[0]], [b.upper, result.intervals[j].raw[1]]]) { range[0] = Math.min(range[0], value); range[1] = Math.max(range[1], value); }
    });
    if (evaluateDecision) {
      const d = evaluateDecision(result); decisions.add(d);
      if (baselineDecision === undefined) baselineDecision = d;
      if ((d === 'Advance') !== (baselineDecision === 'Advance')) {
        tippingPoint = Math.min(tippingPoint ?? Infinity, changes.size);
        if (changes.size === 1) influentialKeys.push([...changes][0]);
      }
    }
  }
  return { method: 'exhaustive-shared-key-assignments', exact: true, budgets, assignments: assignments.length, parentScenarios: parentScenarios.length,
    bounds, baselineDecision, decisions: [...decisions], tippingPoint, influentialKeys: [...new Set(influentialKeys)],
    judgmentSensitive: evaluateDecision ? [...decisions].some(d => (d === 'Advance') !== (baselineDecision === 'Advance')) : null };
}
// Bounds shape matches lineage.values: each entry is [[lo,hi],...]. This
// unrestricted all-dependent relaxation deliberately ignores key budgets and
// dependence. It is a conservative outer bound, never heuristic optimization.
export function conservativeOuterEnvelope(data, familyBounds, { draws = 10000, seed = BOOTSTRAP_SEED } = {}) {
  const p = prepare(data), k = p.point.length, rng = random(seed);
  if (familyBounds.length !== p.lineages.length) throw Error('Missing lineage bounds');
  const pointLo = new Float64Array(k), pointHi = new Float64Array(k);
  p.lineages.forEach((l, h) => {
    if (familyBounds[h].length !== l.m) throw Error('Missing family bounds');
    familyBounds[h].forEach(row => {
      if (row.length !== k || row.some(pair => pair.length !== 2 || !pair.every(Number.isFinite) || pair[0] > pair[1])) throw Error('Invalid family bounds');
      row.forEach(([lo, hi], j) => { pointLo[j] += l.weights[j] * lo / l.m; pointHi[j] += l.weights[j] * hi / l.m; });
    });
  });
  const lower = Array.from({ length: k }, () => new Float64Array(draws)), upper = lower.map(() => new Float64Array(draws));
  for (let b = 0; b < draws; b++) {
    const chosen = familyDraws(data, rng);
    p.lineages.forEach((l, h) => {
      const counts = new Uint32Array(l.m); chosen[h].forEach(i => counts[i]++);
      for (let i = 0; i < l.m; i++) for (let j = 0; j < k; j++) {
        // Coefficients include the re-centered point term. They CAN be negative.
        const coefficient = (l.weights[j] - l.factors[j] + l.factors[j] * counts[i]) / l.m;
        const [lo, hi] = familyBounds[h][i][j];
        lower[j][b] += coefficient * (coefficient >= 0 ? lo : hi);
        upper[j][b] += coefficient * (coefficient >= 0 ? hi : lo);
      }
    });
  }
  return { method: 'unrestricted-all-dependent-conservative-outer-bound', exact: false, calibratedBudgetUsed: false,
    bounds: p.names.map((name, j) => ({ name, point: [pointLo[j], pointHi[j]], lower: [interval(lower[j]).raw[0], interval(upper[j]).raw[0]],
      upper: [interval(lower[j]).raw[1], interval(upper[j]).raw[1]] })) };
}
