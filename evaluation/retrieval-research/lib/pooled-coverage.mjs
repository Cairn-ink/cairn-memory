import { CATEGORIES, compareIds } from './fixture.mjs';
import { familyCounts, pairedQueries, percentile } from './stats.mjs';
import { seededRandom } from '../tools/split.mjs';

export const POOLED_GUARD_STATISTIC = 'pooled-group-coverage-v1';
const fail = code => { throw new Error(code); };
function safeSum(left, right) {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) return null;
  const result = left + right;
  return Number.isSafeInteger(result) ? result : null;
}
function add(left, right) {
  const result = safeSum(left, right);
  if (result === null) fail('unsafe_pooled_aggregate');
  return result;
}
const sum = (rows, field) => rows.reduce((total, row) => add(total, row[field]), 0);

// Ceiling is stored as a per-query ratio by the unchanged scorer. Recover its
// integer numerator only after checking that the ratio represents whole groups.
function ceilingGroups(row) {
  if (!Number.isFinite(row.ceiling) || row.ceiling < 0 || row.ceiling > 1) fail(`invalid_pooled_ceiling:${row.id}`);
  const rounded = Math.round(row.ceiling * row.groupCount);
  // At large safe denominators, multiplication can round one integer away.
  // Each possible numerator must still reproduce the scorer's exact division;
  // there is no tolerance for a different stored ratio, including at 0 and 1.
  const candidates = row.ceiling === 0 ? [0] : row.ceiling === 1 ? [row.groupCount] : [rounded, rounded - 1, rounded + 1];
  const covered = candidates.find(value => Number.isSafeInteger(value) && value >= 0 && value <= row.groupCount && Object.is(value / row.groupCount, row.ceiling));
  if (covered === undefined) fail(`invalid_pooled_ceiling:${row.id}`);
  return covered;
}
function absolute(rows, categories) {
  const groupCount = sum(rows, 'groupCount'), coveredGroups = sum(rows, 'coveredGroups');
  const ceilingCoveredGroups = rows.reduce((total, row) => add(total, ceilingGroups(row)), 0);
  const representedCategories = categories.filter(category => rows.some(row => row.category === category));
  return { queryCount: rows.length, groupCount, coveredGroups, coverage: groupCount ? coveredGroups / groupCount : null,
    ceilingCoveredGroups, ceiling: groupCount ? ceilingCoveredGroups / groupCount : null,
    families: new Set(rows.map(row => row.family)).size, categoryCount: representedCategories.length, representedCategories,
    familyCounts: familyCounts(rows, categories), categoryCounts: Object.fromEntries(categories.map(category => [category,
      { queries: rows.filter(row => row.category === category).length, groups: sum(rows.filter(row => row.category === category), 'groupCount') }])) };
}

// null is an explicit invalid-draw result. Consume the whole draw even after an
// invalid contribution, so no selected family or RNG step is silently redrawn.
export function evaluatePooledDraw(selections) {
  if (!selections || typeof selections[Symbol.iterator] !== 'function') return null;
  let groups = 0, difference = 0, invalid = false;
  for (const selected of selections) {
    const nextGroups = safeSum(groups, selected?.groups), nextDifference = safeSum(difference, selected?.delta);
    if (invalid || selected?.groups < 0 || nextGroups === null || nextDifference === null) invalid = true;
    else { groups = nextGroups; difference = nextDifference; }
  }
  if (invalid || groups <= 0) return null;
  const point = difference / groups * 100;
  return Number.isFinite(point) ? point : null;
}

// The production sampler is supplied internally; this separate checked runner
// also permits direct tests with injected draws, without adding an override to
// the authenticated comparison's options.
export function bootstrapPooledDraws(bootstrap, draw) {
  if (!Number.isSafeInteger(bootstrap?.requested) || bootstrap.requested < 1 || typeof draw !== 'function' ||
      !Array.isArray(bootstrap.endpoints) || bootstrap.endpoints.length !== 2 ||
      bootstrap.endpoints.some(value => !Number.isFinite(value) || value < 0 || value > 1) ||
      bootstrap.endpoints[0] > bootstrap.endpoints[1]) fail('invalid_pooled_draw_options');
  const samples = [];
  let rejected = 0;
  for (let index = 0; index < bootstrap.requested; index++) {
    const point = evaluatePooledDraw(draw(index));
    if (point === null) rejected++;
    else samples.push(point);
  }
  samples.sort((a, b) => a - b);
  const status = rejected ? 'inconclusive' : 'ok';
  return { ...bootstrap, status, ...(rejected ? { reason: 'invalid_bootstrap_draw' } : {}),
    accepted: samples.length, rejected, attempts: bootstrap.requested, rejectionFrequency: rejected / bootstrap.requested,
    ci: rejected ? null : bootstrap.endpoints.map(p => percentile(samples, p)) };
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
    return groups ? add(sum(rows.map(row => row.candidate), 'coveredGroups'), -sum(rows, 'coveredGroups')) / groups * 100 : null;
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
    return [family, { groups: sum(rows, 'groupCount'), delta: add(sum(rows.map(row => row.candidate), 'coveredGroups'), -sum(rows, 'coveredGroups')) }];
  }));
  const random = seededRandom(seed);
  function* draw() {
    for (let i = 0; i < families.length; i++) {
      yield byFamily.get(families[Math.floor(random() * families.length)]);
    }
  }
  const completed = bootstrapPooledDraws(bootstrap, draw);
  return { ...result, status: completed.status, bootstrap: completed };
}
