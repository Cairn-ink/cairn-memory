import { random } from './random.mjs';
import { interval } from './statistics.mjs';

export const BOOTSTRAP_SEED = 'hr3-bootstrap-v1';
// Data: {names:[...], lineages:[{id,type,values:[[outcome,...],...],weights:[...]}]}.
// A zero weight excludes a lineage from that estimand, without discarding draws.
export function validateData(data) {
  const k = data.names.length, ids = new Set(), totals = Array(k).fill(0);
  if (!k || new Set(data.names).size !== k || !data.lineages.length) throw Error('Empty/duplicate outcomes or lineages');
  for (const l of data.lineages) {
    if (ids.has(l.id) || !l.type || l.values.length < 2 || l.weights.length !== k) throw Error('Missing/duplicate lineage, type, m<2, or weights');
    ids.add(l.id);
    if (l.weights.some(w => !Number.isFinite(w) || w < 0)) throw Error('Invalid weights');
    l.weights.forEach((w, j) => { totals[j] += w; });
    if (l.values.some(v => v.length !== k || v.some(x => !Number.isFinite(x)))) throw Error('Invalid family vector');
  }
  if (totals.some(w => Math.abs(w - 1) > 1e-12)) throw Error('Weights must sum to one per estimand');
  return data;
}
export function prepare(data) {
  validateData(data);
  const k = data.names.length, point = new Float64Array(k);
  const lineages = data.lineages.map(l => {
    const m = l.values.length, means = new Float64Array(k), factors = new Float64Array(k);
    for (const v of l.values) for (let j = 0; j < k; j++) means[j] += v[j] / m;
    for (let j = 0; j < k; j++) { point[j] += l.weights[j] * means[j]; factors[j] = l.weights[j] * Math.sqrt(m / (m - 1)); }
    return { ...l, m, means, factors };
  });
  return { names: data.names, point, lineages };
}
export function analyticCovariance(data) {
  const p = prepare(data), k = p.point.length, cov = Array.from({ length: k }, () => Array(k).fill(0));
  for (const l of p.lineages) for (let j = 0; j < k; j++) for (let h = 0; h < k; h++) {
    let sum = 0;
    for (const v of l.values) sum += (v[j] - l.means[j]) * (v[h] - l.means[h]);
    cov[j][h] += l.weights[j] * l.weights[h] * sum / (l.m * (l.m - 1));
  }
  return cov;
}
export function familyDraws(data, rng) {
  return data.lineages.map(l => Array.from({ length: l.values.length }, () => rng.int(l.values.length)));
}
export function correctedReplicate(data, draws, route = 'direct') {
  return evaluatePrepared(prepare(data), draws, route);
}
function evaluatePrepared(p, draws, route) {
  if (!['direct', 'count'].includes(route)) throw Error('Unknown bootstrap route');
  if (draws.length !== p.lineages.length) throw Error('Missing lineage draws');
  const result = Float64Array.from(p.point);
  p.lineages.forEach((l, index) => {
    const chosen = draws[index];
    if (chosen.length !== l.m || chosen.some(i => !Number.isInteger(i) || i < 0 || i >= l.m)) throw Error('Invalid family draw');
    const sum = new Float64Array(result.length);
    if (route === 'direct') {
      for (const i of chosen) for (let j = 0; j < sum.length; j++) sum[j] += l.values[i][j];
    } else {
      const counts = new Uint32Array(l.m);
      for (const i of chosen) counts[i]++;
      for (let i = 0; i < l.m; i++) for (let j = 0; j < sum.length; j++) sum[j] += counts[i] * l.values[i][j];
    }
    for (let j = 0; j < sum.length; j++) result[j] += l.factors[j] * (sum[j] / l.m - l.means[j]);
  });
  return result;
}
// Hot loop implements the same count formula, accumulating counts in-place.
// Packed 5-dimensional {-1,0,1} sums avoid a vector loop per sampled family.
export function bootstrap(data, { draws = 10000, seed = BOOTSTRAP_SEED, route = 'count', onProgress } = {}) {
  if (!Number.isInteger(draws) || draws < 2 || !['direct', 'count'].includes(route)) throw Error('Invalid draws/route');
  const p = prepare(data), k = p.point.length, rng = random(seed);
  const replicates = Array.from({ length: k }, () => new Float64Array(draws));
  const packed = route === 'count' && k <= 5 && p.lineages.every(l => l.m <= 8 && l.values.every(v => v.every(x => x === -1 || x === 0 || x === 1)));
  const multipliers = Array.from({ length: k }, (_, j) => 32 ** j);
  const compiled = p.lineages.map(l => ({ ...l, codes: packed ? l.values.map(v => v.reduce((s, x, j) => s + (x + 1) * multipliers[j], 0)) : null,
    counts: new Uint32Array(l.m), sum: new Float64Array(k) }));
  for (let b = 0; b < draws; b++) {
    const value = Float64Array.from(p.point);
    for (const l of compiled) {
      if (packed) {
        let code = 0;
        for (let i = 0; i < l.m; i++) code += l.codes[rng.int(l.m)];
        for (let j = 0; j < k; j++) {
          const sum = Math.floor(code / multipliers[j]) % 32 - l.m;
          value[j] += l.factors[j] * (sum / l.m - l.means[j]);
        }
      } else {
        l.sum.fill(0);
        if (route === 'direct') {
          for (let i = 0; i < l.m; i++) {
            const v = l.values[rng.int(l.m)];
            for (let j = 0; j < k; j++) l.sum[j] += v[j];
          }
        } else {
          l.counts.fill(0);
          for (let i = 0; i < l.m; i++) l.counts[rng.int(l.m)]++;
          for (let i = 0; i < l.m; i++) if (l.counts[i]) for (let j = 0; j < k; j++) l.sum[j] += l.counts[i] * l.values[i][j];
        }
        for (let j = 0; j < k; j++) value[j] += l.factors[j] * (l.sum[j] / l.m - l.means[j]);
      }
    }
    for (let j = 0; j < k; j++) replicates[j][b] = value[j];
    if (onProgress && (b + 1) % 1024 === 0) onProgress(b + 1);
  }
  return summarize(p, replicates, 'corrected-within-lineage');
}
function summarize(p, replicates, method) {
  return { method, names: p.names, point: Array.from(p.point), intervals: replicates.map(r => interval(r)), replicates };
}
// Candidate sensitivity: resample whole lineages within type. Each sampled
// lineage carries its entire family vector. Multihop and non-multihop lineages
// form separate sub-strata so frozen guard weights/denominators are preserved.
export function lineageSensitivity(data, { draws = 10000, seed = BOOTSTRAP_SEED + '/lineage', onProgress } = {}) {
  if (!Number.isInteger(draws) || draws < 2) throw Error('Invalid sensitivity draws');
  const p = prepare(data), k = p.point.length, rng = random(seed), groups = new Map();
  for (const l of p.lineages) {
    const key = JSON.stringify([l.type, l.weights]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(l);
  }
  const replicates = Array.from({ length: k }, () => new Float64Array(draws));
  for (let b = 0; b < draws; b++) {
    for (const group of groups.values()) for (let i = 0; i < group.length; i++) {
      const l = group[rng.int(group.length)];
      for (let j = 0; j < k; j++) replicates[j][b] += l.weights[j] * l.means[j];
    }
    if (onProgress && (b + 1) % 1024 === 0) onProgress(b + 1);
  }
  return summarize(p, replicates, 'whole-lineage-sensitivity-candidate-stratified');
}
