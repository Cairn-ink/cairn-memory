import { join } from 'node:path';
import { CATEGORIES, fixtureProfile, HR2B_VERSION, compareIds, loadFixture, writeJson, cliMain, requiredOption } from '../lib/fixture.mjs';

// FNV-1a seed + mulberry32: stable across supported Node versions.
export function seededRandom(seed) {
  let state = 2166136261;
  for (const char of String(seed)) { state ^= char.charCodeAt(0); state = Math.imul(state, 16777619); }
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

export function splitSummary(queries, assignment) {
  const scored = queries.filter(query => CATEGORIES.includes(query.category));
  const categories = Object.fromEntries(CATEGORIES.map(category => {
    const selected = scored.filter(query => query.category === category);
    const dev = selected.filter(query => assignment[query.family] === 'dev');
    const test = selected.filter(query => assignment[query.family] === 'test');
    return [category, { total: selected.length, dev: dev.length, test: test.length,
      devFamilies: new Set(dev.map(query => query.family)).size, testFamilies: new Set(test.map(query => query.family)).size }];
  }));
  const dev = scored.filter(query => assignment[query.family] === 'dev').length;
  const overallDev = queries.filter(query => assignment[query.family] === 'dev').length;
  return { total: scored.length, dev, devFraction: scored.length ? dev / scored.length : null,
    overallTotal: queries.length, overallDev, overallDevFraction: queries.length ? overallDev / queries.length : null, categories };
}

export function splitViolations(summary) {
  const errors = [];
  if (summary.devFraction == null || summary.devFraction < 0.27 || summary.devFraction > 0.33) errors.push('dev_fraction_outside_27_33_percent');
  if (summary.overallDevFraction == null || summary.overallDevFraction < 0.27 || summary.overallDevFraction > 0.33) errors.push('overall_dev_fraction_outside_27_33_percent');
  for (const [category, count] of Object.entries(summary.categories)) {
    if (count.dev < 4 || count.dev > 8 || count.test < 12 || count.test > 16) errors.push(`${category}:query_quota`);
    if (count.devFamilies < 4 || count.testFamilies < 10) errors.push(`${category}:family_minimum`);
  }
  return errors;
}

// Exact branch-and-bound, seeded traversal. The category/family bounds prune
// impossible partial assignments; a search limit is reported, never relaxed.
export function assignSplit(queries, { seed = 'hr1-split-v2', maxNodes = 2_000_000 } = {}) {
  const random = seededRandom(seed);
  const allFamilies = [...new Set(queries.map(query => query.family))].sort(compareIds);
  const scored = queries.filter(query => CATEGORIES.includes(query.category));
  const total = scored.length;
  const groups = allFamilies.map(id => ({ id, counts: CATEGORIES.map(category => scored.filter(query => query.family === id && query.category === category).length), tie: random() }));
  groups.sort((a, b) => b.counts.filter(Boolean).length - a.counts.filter(Boolean).length || a.tie - b.tie || compareIds(a.id, b.id));
  const totals = CATEGORIES.map((_, c) => groups.reduce((sum, group) => sum + group.counts[c], 0));
  const familyTotals = CATEGORIES.map((_, c) => groups.filter(group => group.counts[c]).length);
  for (let c = 0; c < 7; c++) {
    if (familyTotals[c] < 14 || totals[c] < 16 || totals[c] > 24) throw new Error(`split_infeasible:${CATEGORIES[c]}:queries=${totals[c]}:families=${familyTotals[c]}`);
  }
  const remaining = Array.from({ length: groups.length + 1 }, () => Array(7).fill(0));
  const remainingFamilies = remaining.map(() => Array(7).fill(0));
  for (let i = groups.length - 1; i >= 0; i--) for (let c = 0; c < 7; c++) {
    remaining[i][c] = remaining[i + 1][c] + groups[i].counts[c];
    remainingFamilies[i][c] = remainingFamilies[i + 1][c] + Number(groups[i].counts[c] > 0);
  }
  const dev = Array(7).fill(0), devFamilies = Array(7).fill(0), testFamilies = Array(7).fill(0);
  const assignment = {};
  let nodes = 0;
  const remainingAll = Array(groups.length + 1).fill(0);
  for (let i = groups.length - 1; i >= 0; i--) {
    groups[i].allCount = queries.filter(query => query.family === groups[i].id).length;
    remainingAll[i] = remainingAll[i + 1] + groups[i].allCount;
  }
  function search(i, devTotal, allDev = 0) {
    if (++nodes > maxNodes) throw new Error(`split_search_limit:${maxNodes}:no_valid_assignment_found`);
    if (allDev > Math.floor(queries.length * 0.33) || allDev + remainingAll[i] < Math.ceil(queries.length * 0.27)) return false;
    if (devTotal > Math.floor(total * 0.33) || devTotal + remaining[i].reduce((a, b) => a + b, 0) < Math.ceil(total * 0.27)) return false;
    for (let c = 0; c < 7; c++) {
      const min = Math.max(4, totals[c] - 16), max = Math.min(8, totals[c] - 12);
      if (dev[c] > max || dev[c] + remaining[i][c] < min || devFamilies[c] + remainingFamilies[i][c] < 4 ||
          testFamilies[c] + remainingFamilies[i][c] < 10) return false;
    }
    if (i === groups.length) return true;
    const group = groups[i], size = group.counts.reduce((a, b) => a + b, 0);
    const choices = random() < 0.3 ? ['dev', 'test'] : ['test', 'dev'];
    for (const choice of choices) {
      assignment[group.id] = choice;
      for (let c = 0; c < 7; c++) if (group.counts[c]) {
        if (choice === 'dev') { dev[c] += group.counts[c]; devFamilies[c]++; } else testFamilies[c]++;
      }
      if (search(i + 1, devTotal + (choice === 'dev' ? size : 0), allDev + (choice === 'dev' ? group.allCount : 0))) return true;
      for (let c = 0; c < 7; c++) if (group.counts[c]) {
        if (choice === 'dev') { dev[c] -= group.counts[c]; devFamilies[c]--; } else testFamilies[c]--;
      }
    }
    delete assignment[group.id];
    return false;
  }
  if (!search(0, 0)) throw new Error('split_infeasible:no_family_assignment_satisfies_all_constraints');
  const result = Object.fromEntries(allFamilies.map(id => [id, assignment[id]]));
  const errors = splitViolations(splitSummary(queries, result));
  if (errors.length) throw new Error(`split_internal_error:${errors.join(',')}`);
  return result;
}

await cliMain(import.meta.url, async options => {
  const dir = requiredOption(options, 'fixture'), fixture = await loadFixture(dir);
  const profile = fixtureProfile(fixture), hr2b = profile.version === HR2B_VERSION;
  const seed = options.seed ?? (hr2b ? 'hr2b-split-v1' : 'hr1-split-v2');
  const split = assignSplit(fixture.queries.queries, { seed });
  await writeJson(options.out ?? join(dir, 'hr1-split.json'), hr2b ? { version: profile.version, ...split } : split);
  console.log(JSON.stringify({ ok: true, seed, ...(hr2b ? { version: profile.version } : {}), ...splitSummary(fixture.queries.queries, split) }));
});
