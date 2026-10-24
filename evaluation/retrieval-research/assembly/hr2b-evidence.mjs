import { CATEGORIES, eligibleMemory } from '../lib/fixture.mjs';
import { auditedHR2bQueries } from '../lib/hr2b-queries.mjs';
import { placementOf, PLACEMENTS } from '../lib/placement.mjs';
import { metrics, summarize } from './scoring-metrics.mjs';
import { fail } from './auth.mjs';

// Re-derive every denominator, row and stratum from authenticated labels and
// actual admissions, never from the scorer's supplied stratum membership.
export function deriveHR2bEvidence(fixture, admissions, run) {
  const originals = new Map(auditedHR2bQueries(fixture, { split: run.split, scored: true }).map(query => [query.id, query]));
  const labels = new Map(fixture.labels.queries.map(label => [label.id, label]));
  const memories = new Map(fixture.corpus.memories.map(memory => [memory.id, memory]));
  const strata = Object.fromEntries(['fidelity:body-covered', 'fidelity:span-only', ...PLACEMENTS.map(value => `placement:${value}`)].map(key => [key, []]));
  const queries = admissions.map(row => {
    const query = originals.get(row.id), label = labels.get(row.id);
    if (!query || !label) fail('hr2b_evidence_query');
    const groups = label.groups.map(group => {
      const members = group.members.filter(member => member.namespace === 'target' && ['S300', 'S1000-extra'].includes(member.scale));
      if (!members.length || members.some(member => !memories.has(member.memory) || !eligibleMemory(memories.get(member.memory), query.intent) ||
          !['body', 'span'].includes(member.where) || !Array.isArray(member.spans) ||
          member.spans.some(id => !memories.get(member.memory).spans.some(span => span.id === id)) || (member.where === 'span' && !member.spans.length))) fail('invalid_required_group');
      const placement = placementOf(fixture, members, query.intent);
      if (group.placement !== placement) fail('hr2b_stale_placement');
      return { ...group, members, placement, fidelity: members.some(member => member.where === 'body') ? 'body-covered' : 'span-only' };
    });
    const have = new Set(row.admitted.map(unit => unit.id));
    const result = { ...row, family: query.family, category: query.category, lang: query.lang, ...metrics(groups, have, row.ranked), tokenUse: row.used / run.budget };
    const add = (key, selected) => { if (selected.length) (strata[key] ??= []).push({ ...result, ...metrics(selected, have, row.ranked) }); };
    for (const fidelity of ['body-covered', 'span-only']) add(`fidelity:${fidelity}`, groups.filter(group => group.fidelity === fidelity));
    for (const placement of PLACEMENTS) add(`placement:${placement}`, groups.filter(group => group.placement === placement));
    add(`language:${query.lang}`, groups); add(`category:${query.category}`, groups);
    return result;
  });
  return { queries, summary: summarize(queries, { requireAllCategories: true }), strata: Object.fromEntries(Object.entries(strata).map(([key, rows]) => [key,
    { ...summarize(rows), families: new Set(rows.map(row => row.family)).size,
      familyCounts: Object.fromEntries(CATEGORIES.map(category => [category, new Set(rows.filter(row => row.category === category).map(row => row.family)).size])), queries: rows }])) };
}
