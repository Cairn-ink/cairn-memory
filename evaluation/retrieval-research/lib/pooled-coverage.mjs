import { CATEGORIES, compareIds } from './fixture.mjs';
import { familyCounts, pairedQueries, percentile } from './stats.mjs';
import { seededRandom } from '../tools/split.mjs';

export const POOLED_GUARD_STATISTIC = 'pooled-group-coverage-v1';
const fail = code => { throw new Error(code); };
const sum = (rows, field) => rows.reduce((total, row) => total + row[field], 0);

// Ceiling is stored as a per-query ratio by the unchanged scorer. Recover its
// integer numerator only after checking that the ratio represents whole groups.
function ceilingGroups(row) {
  const covered = row.ceiling * row.groupCount, rounded = Math.round(covered);
  if (!Number.isFinite(row.ceiling) || row.ceiling < 0 || row.ceiling > 1 || Math.abs(covered - rounded) > 1e-9) fail(`invalid_pooled_ceiling:${row.id}`);
  return rounded;
}
function absolute(rows, categories) {
  const groupCount = sum(rows, 'groupCount'), coveredGroups = sum(rows, 'coveredGroups');
  const ceilingCoveredGroups = rows.reduce((total, row) => total + ceilingGroups(row), 0);
  const representedCategories = categories.filter(category => rows.some(row => row.category === category));
  return { queryCount: rows.length, groupCount, coveredGroups, coverage: groupCount ? coveredGroups / groupCount : null,
    ceilingCoveredGroups, ceiling: groupCount ? ceilingCoveredGroups / groupCount : null,
    families: new Set(rows.map(row => row.family)).size, categoryCount: representedCategories.length, representedCategories,
    familyCounts: familyCounts(rows, categories), categoryCounts: Object.fromEntries(categories.map(category => [category,
      { queries: rows.filter(row => row.category === category).length, groups: sum(rows.filter(row => row.category === category), 'groupCount') }])) };
}

// HR-2b v1.1: sample N contributing families N times, uniformly with
// replacement. Keep all paired rows with multiplicity, never redraw categories
// or invalid draws. Every draw recomputes the group-occurrence denominator.
export function pooledGuardComparison(baseline, candidate, { seed, resamples, minimumFamilies, categories } = {}) {
  if (typeof seed !== 'string' || !seed || !Number.isSafeInteger(resamples) || resamples < 1 ||
      !Number.isSafeInteger(minimumFamilies) || minimumFamilies < 1 || !Array.isArray(categories) || !categories.length ||
      new Set(categories).size !== categories.length || categories.some(category => !CATEGORIES.includes(category))) fail('invalid_pooled_bootstrap_options');
  const paired = pairedQueries(baseline, candidate);
  for (const row of paired) {
    if (typeof row.id !== 'string' || typeof row.family !== 'string' || !row.family || !categories.includes(row.category) ||
        row.groupCount !== row.candidate.groupCount || [row, row.candidate].some(value =>
          !Number.isSafeInteger(value.groupCount) || value.groupCount < 1 || !Number.isSafeInteger(value.coveredGroups) ||
          value.coveredGroups < 0 || value.coveredGroups > value.groupCount)) fail(`invalid_pooled_counts:${row.id}`);
  }
  const before = absolute(paired, categories), after = absolute(paired.map(row => row.candidate), categories);
  if (before.ceilingCoveredGroups !== after.ceilingCoveredGroups || paired.some(row => ceilingGroups(row) !== ceilingGroups(row.candidate))) fail('pooled_ceiling_mismatch');
  const delta = rows => {
    const groups = sum(rows, 'groupCount');
    return groups ? (sum(rows.map(row => row.candidate), 'coveredGroups') - sum(rows, 'coveredGroups')) / groups * 100 : null;
  };
  const descriptive = categories.map(category => {
    const rows = paired.filter(row => row.category === category);
    return { category, point: delta(rows), groups: sum(rows, 'groupCount'), families: new Set(rows.map(row => row.family)).size };
  });
  const families = [...new Set(paired.map(row => row.family))].sort(compareIds);
  const bootstrap = { seed, requested: resamples, exploratory: true, confidence: .95, endpoints: [.025, .975],
    familyCounts: before.familyCounts, families: families.length, minimumFamilies, point: delta(paired), unit: 'percentage-points' };
  const result = { statistic: POOLED_GUARD_STATISTIC, absolute: { baseline: before, candidate: after }, descriptive };
  if (families.length < minimumFamilies) return { ...result, status: 'inconclusive', bootstrap: { ...bootstrap,
    status: 'inconclusive', reason: 'too_few_families', accepted: 0, rejected: 0, attempts: 0, rejectionFrequency: 0, ci: null } };
  const byFamily = new Map(families.map(family => {
    const rows = paired.filter(row => row.family === family);
    return [family, { groups: sum(rows, 'groupCount'), delta: sum(rows.map(row => row.candidate), 'coveredGroups') - sum(rows, 'coveredGroups') }];
  }));
  const random = seededRandom(seed), samples = [];
  let rejected = 0;
  for (let draw = 0; draw < resamples; draw++) {
    let groups = 0, coveredDelta = 0;
    for (let i = 0; i < families.length; i++) {
      const selected = byFamily.get(families[Math.floor(random() * families.length)]);
      groups += selected.groups; coveredDelta += selected.delta;
    }
    if (!groups) rejected++;
    else samples.push(coveredDelta / groups * 100);
  }
  samples.sort((a, b) => a - b);
  const status = rejected ? 'inconclusive' : 'ok';
  return { ...result, status, bootstrap: { ...bootstrap, status, ...(rejected ? { reason: 'invalid_bootstrap_draw' } : {}),
    accepted: samples.length, rejected, attempts: resamples, rejectionFrequency: rejected / resamples,
    ci: rejected ? null : bootstrap.endpoints.map(p => percentile(samples, p)) } };
}
