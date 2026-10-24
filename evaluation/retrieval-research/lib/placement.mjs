import { CATEGORIES, HR2B_VERSION, FIXTURE_PROFILES, fixtureProfile, eligibleMemory, unique } from './fixture.mjs';

export const PLACEMENTS = Object.freeze(['body', 'first-receipt', 'later-receipt']);
export function placementOf(fixture, members, intent) {
  const memories = new Map(fixture.corpus.memories.map(memory => [memory.id, memory]));
  const eligible = members.filter(member => {
    const memory = memories.get(member.memory);
    return memory && eligibleMemory(memory, intent);
  });
  if (!eligible.length) return null;
  if (eligible.some(member => member.where === 'body')) return 'body';
  if (eligible.some(member => member.spans.includes(memories.get(member.memory).spans[0]?.id))) return 'first-receipt';
  return 'later-receipt';
}

export function placementQuotas(labels) {
  const quotas = FIXTURE_PROFILES[HR2B_VERSION].quotas;
  const active = labels.queries.filter(label => !label.dropped && CATEGORIES.includes(label.category));
  const guardCategories = unique(active.filter(label => label.groups.some(group => group.placement === 'later-receipt')).map(label => label.category));
  const errors = [], splits = {};
  for (const split of ['dev', 'test']) {
    const rows = active.filter(label => label.split === split);
    splits[split] = {};
    for (const placement of ['first-receipt', 'later-receipt']) {
      const selected = rows.filter(label => label.groups.some(group => group.placement === placement));
      const groups = selected.reduce((sum, label) => sum + label.groups.filter(group => group.placement === placement).length, 0);
      const families = new Set(selected.map(label => label.family)).size;
      const categories = Object.fromEntries(guardCategories.map(category => [category,
        new Set(selected.filter(label => label.category === category).map(label => label.family)).size]));
      splits[split][placement] = { groups, families, categories };
      if (groups < quotas.groups) errors.push(`${split}:${placement}:groups_minimum_${quotas.groups}`);
      if (families < quotas.families) errors.push(`${split}:${placement}:families_minimum_${quotas.families}`);
      if (placement === 'later-receipt') for (const category of guardCategories)
        if (categories[category] < (split === 'test' ? quotas.guardTestFamilies : quotas.guardDevFamilies)) errors.push(`${split}:guard:${category}:family_minimum`);
    }
  }
  return { ok: !errors.length, errors, guardCategories, splits };
}

export function finalizePlacement(fixture, labels) {
  if (fixtureProfile(fixture).version !== HR2B_VERSION) return labels;
  return { ...labels, placement: placementQuotas(labels) };
}
