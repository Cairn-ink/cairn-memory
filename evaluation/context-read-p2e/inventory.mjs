import { cells } from './fixtures.mjs';
import { SAFETY_CELLS } from './safety.mjs';

export function inventory(fixture) {
  const rows = [];
  const masks = [...new Set(fixture.queries.filter(q => !q.control).flatMap(q => q.masks))].sort();
  const add = (id, kind, selected, dimensions = {}) => {
    const positive = selected.filter(q => !q.negative && !q.control), negative = selected.filter(q => q.negative);
    rows.push({ id, kind, ...dimensions, positive: positive.map(q => q.id), negative: negative.map(q => q.id), exact: id.includes('identifier') });
  };
  for (const cell of cells()) add(`primary/${cell.id}`, 'primary', fixture.queries.filter(q => q.language === cell.language), { cell: cell.id });
  for (const mask of masks) {
    const selected = fixture.queries.filter(q => q.masks.includes(mask));
    add(mask, 'challenge', selected);
    for (const cell of cells().filter(c => c.language === 'zh')) add(`${mask}/${cell.world}-v${cell.schema}-${cell.intent}`, 'slice', selected,
      { world: cell.world, schema: cell.schema, intent: cell.intent });
  }
  add('cross-language', 'equal-direction-aggregate', fixture.queries.filter(q => q.masks.some(m => m.startsWith('cross-'))));
  for (const row of rows) if (row.positive.length < 50 || row.negative.length < 10) throw Error(`inventory_minimum:${row.id}`);
  return { version: 'p2e-inventory-v1', primaryCount: 48, strata: rows, safety: SAFETY_CELLS,
    control: ['zh-single-han-control'], exclusions: ['negative queries from positive metrics', 'single-Han known miss from positive macro; always separately reported'],
    emptyIntersections: cells().map(c => ({ cell: c.id, masks: masks.filter(m => !fixture.queries.some(q => q.language === c.language && q.masks.includes(m))) })) };
}

export function safetyFixtures() {
  return {
    version: 'p2e-safety-fixtures-v1',
    query: 'cedar key copper token',
    ownerId: 'synthetic-owner', otherOwnerId: 'synthetic-other-owner',
    canaries: [
      { id: 'safety-target', namespace: { ownerId: 'synthetic-owner', scope: 'personal', projectId: null }, type: 'memory', revision: 1, text: 'The synthetic cedar key opens the blue cabinet.' },
      { id: 'safety-replacement', namespace: { ownerId: 'synthetic-owner', scope: 'personal', projectId: null }, type: 'memory', revision: 2, text: 'The synthetic cedar key opens the green cabinet.' },
      { id: 'safety-card-target', namespace: { ownerId: 'synthetic-owner', scope: 'project', projectId: 'project-1' }, type: 'card', revision: 2, bodyRevision: 1, title: 'Synthetic copper token', body: 'The synthetic copper token opens the old drawer.' },
      { id: 'safety-card-replacement', namespace: { ownerId: 'synthetic-owner', scope: 'project', projectId: 'project-1' }, type: 'card', revision: 3, bodyRevision: 2, title: 'Synthetic copper token', body: 'The synthetic copper token opens the new drawer.' },
      { id: 'foreign-owner', namespace: { ownerId: 'synthetic-other-owner', scope: 'personal', projectId: null }, type: 'memory', revision: 1, text: 'PRIVATE_OWNER_CANARY cedar key blue cabinet' },
      { id: 'foreign-project', namespace: { ownerId: 'synthetic-owner', scope: 'project', projectId: 'unselected' }, type: 'card', revision: 2, bodyRevision: 1, title: 'Synthetic namespace canary', body: 'PRIVATE_NAMESPACE_CANARY cedar key blue cabinet' },
      { id: 'history-eligible', namespace: { ownerId: 'synthetic-owner', scope: 'personal', projectId: null }, type: 'memory', revision: 1, text: 'A qualified historical amber key belonged to the archive.' },
    ].map(canary => canary.type === 'card' ? { ...canary, text: `${canary.title}\n${canary.body}` } : canary),
    scenarios: SAFETY_CELLS.map(id => ({ id, surfaces: ['candidates', 'assembly', 'evidence', 'private-metadata'],
      forbidden: id.startsWith('scope/') ? [id === 'scope/cross-owner' ? 'foreign-owner@1' : 'foreign-project@2:1'] : [id.includes('/card/') ? 'safety-card-target@2:1' : 'safety-target@1'],
      finalSnapshot: 'after acknowledged mutation, stopped clients and drained erasure',
      qualifiedHistoryControl: 'history-eligible@1 remains independently eligible under history',
      vectorInventory: id === 'owner-purge/all-catalogs' ? ['all-catalogs', 'both-intents', 'all-types', 'all-provider-identities', 'staging', 'obsolete', 'other-owner-preserved', 'canonical-lexical-preserved'] : null })),
  };
}
