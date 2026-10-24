import { CATEGORIES } from '../lib/fixture.mjs';
import { average, scoreGroups } from '../lib/metrics.mjs';
import { percentile } from '../lib/stats.mjs';
import { fail } from './auth.mjs';

export function metrics(groups, have, ranked) {
  if (!groups.length) fail('empty_required_groups');
  const covered = groups.filter(group => group.members.some(member => member.where === 'body'
    ? have.has(`${member.memory}#body`) : member.spans.some(id => have.has(id)))).length;
  const coverage = covered / groups.length, ceiling = scoreGroups(groups, ranked).recall24;
  return { groupCount: groups.length, coveredGroups: covered, coverage, allRequired: covered === groups.length, ceiling, assemblyLoss: ceiling - coverage };
}

export function summarize(rows, { requireAllCategories = false } = {}) {
  const categories = Object.fromEntries(CATEGORIES.map(category => {
    const selected = rows.filter(row => row.category === category);
    return [category, { queries: selected.length, groups: selected.reduce((sum, row) => sum + row.groupCount, 0),
      coverage: average(selected.map(row => row.coverage)), allRequired: average(selected.map(row => Number(row.allRequired))),
      ceiling: average(selected.map(row => row.ceiling)), assemblyLoss: average(selected.map(row => row.assemblyLoss)) }];
  }));
  const representedCategories = CATEGORIES.filter(category => categories[category].queries);
  const macro = field => requireAllCategories && representedCategories.length !== 7 ? null : average(representedCategories.map(category => categories[category][field]));
  const use = rows.map(row => row.tokenUse).sort((a, b) => a - b);
  return { queryCount: rows.length, groupCount: rows.reduce((sum, row) => sum + row.groupCount, 0), representedCategories,
    complete: representedCategories.length === 7, categories, macroCoverage: macro('coverage'), macroAllRequired: macro('allRequired'),
    macroCeiling: macro('ceiling'), macroAssemblyLoss: macro('assemblyLoss'), tokenUse: { p50: percentile(use, 0.5), p95: percentile(use, 0.95) } };
}
