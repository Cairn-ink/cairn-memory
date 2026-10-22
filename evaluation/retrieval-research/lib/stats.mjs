import { CATEGORIES, compareIds } from './fixture.mjs';
import { average } from './metrics.mjs';
import { seededRandom } from '../tools/split.mjs';

// Linear interpolation at (n - 1)p, with sorted finite observations.
export function percentile(sorted, p) {
  if (!sorted.length || p < 0 || p > 1) return null;
  const index = (sorted.length - 1) * p, lo = Math.floor(index), hi = Math.ceil(index);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
}

export function pairedQueries(baseline, candidate) {
  const rows = new Map(candidate.map(row => [row.id, row]));
  if (rows.size !== candidate.length || new Set(baseline.map(row => row.id)).size !== baseline.length || baseline.length !== candidate.length) throw new Error('paired_query_set_mismatch');
  return baseline.map(row => {
    const other = rows.get(row.id);
    if (!other || other.family !== row.family || other.category !== row.category) throw new Error(`paired_query_metadata_mismatch:${row.id}`);
    return { ...row, candidate: other, delta: other.recall12 == null || row.recall12 == null ? null : other.recall12 - row.recall12 };
  });
}

export function familyCounts(rows, categories = CATEGORIES) {
  return Object.fromEntries(categories.map(category => [category, new Set(rows.filter(row => row.category === category).map(row => row.family)).size]));
}

export function clusterBootstrap(baseline, candidate, { seed = 'hr1-bootstrap-v2', resamples = 10000, exploratory = false,
  categories = CATEGORIES, minimumFamilies = exploratory ? 1 : 10, maxAttempts = resamples * 1000 } = {}) {
  if (!Number.isInteger(resamples) || resamples < 1 || maxAttempts < resamples) throw new Error('invalid_bootstrap_resamples');
  const paired = pairedQueries(baseline, candidate).filter(row => categories.includes(row.category) && row.delta != null);
  const counts = familyCounts(paired, categories);
  const families = [...new Set(paired.map(row => row.family))].sort(compareIds);
  const macro = rows => average(categories.map(category => average(rows.filter(row => row.category === category).map(row => row.delta))));
  const point = categories.every(category => counts[category] > 0) ? macro(paired) * 100 : null;
  const base = { seed, requested: resamples, exploratory, confidence: exploratory ? 0.95 : 0.975, endpoints: exploratory ? [0.025, 0.975] : [0.0125, 0.9875],
    familyCounts: counts, families: families.length, minimumFamilies, point, unit: 'percentage-points' };
  if (!families.length || Object.values(counts).some(count => count < minimumFamilies)) return { ...base, status: 'inconclusive', reason: 'too_few_families', accepted: 0, rejected: 0, attempts: 0, rejectionFrequency: 0, ci: null };
  const random = seededRandom(seed), byFamily = new Map(families.map(family => [family, paired.filter(row => row.family === family)]));
  const samples = [];
  let rejected = 0, attempts = 0;
  while (samples.length < resamples && attempts < maxAttempts) {
    attempts++;
    const rows = [];
    for (let i = 0; i < families.length; i++) rows.push(...byFamily.get(families[Math.floor(random() * families.length)]));
    if (categories.some(category => !rows.some(row => row.category === category))) { rejected++; continue; }
    samples.push(macro(rows) * 100);
  }
  samples.sort((a, b) => a - b);
  if (samples.length !== resamples) return { ...base, status: 'inconclusive', reason: 'bootstrap_redraw_limit', accepted: samples.length, rejected, attempts, rejectionFrequency: rejected / attempts, ci: null };
  return { ...base, status: 'ok', accepted: samples.length, rejected, attempts, rejectionFrequency: rejected / attempts,
    ci: base.endpoints.map(p => percentile(samples, p)) };
}

// The doubled smaller binomial tail is the exact two-sided McNemar test.
// Log probabilities avoid 2^-n underflow for larger synthetic fixtures.
export function exactMcNemar(baseline, candidate) {
  const paired = pairedQueries(baseline, candidate).filter(row => CATEGORIES.includes(row.category) && row.allRequired12 != null && row.candidate.allRequired12 != null);
  const selected = new Map();
  for (const row of [...paired].sort((a, b) => compareIds(a.id, b.id))) if (!selected.has(row.family)) selected.set(row.family, row);
  let baselineOnly = 0, candidateOnly = 0;
  for (const row of selected.values()) {
    if (row.allRequired12 && !row.candidate.allRequired12) baselineOnly++;
    if (!row.allRequired12 && row.candidate.allRequired12) candidateOnly++;
  }
  const n = baselineOnly + candidateOnly, k = Math.min(baselineOnly, candidateOnly);
  let logProbability = -n * Math.LN2, tail = Math.exp(logProbability);
  for (let i = 1; i <= k; i++) { logProbability += Math.log(n - i + 1) - Math.log(i); tail += Math.exp(logProbability); }
  return { method: 'exact-two-sided-McNemar', selection: 'smallest-test-query-id-per-family', families: selected.size,
    queryIds: [...selected.values()].map(row => row.id).sort(compareIds), baselineOnly, candidateOnly, discordant: n, p: n ? Math.min(1, 2 * tail) : 1 };
}
