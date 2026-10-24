import { CATEGORIES, compareIds } from './fixture.mjs';

// Evaluator projection only. W2's authoring records remain intact; W3's active
// identities and categories are authoritative for every HR-2b consumer.
export function auditedHR2bQueries(fixture, { split, scored = false } = {}) {
  const originals = fixture.queries?.queries, labels = fixture.labels?.queries;
  if (!Array.isArray(originals) || !Array.isArray(labels)) throw new Error('hr2b_audited_queries_required');
  const byId = new Map(labels.map(label => [label.id, label]));
  if (byId.size !== labels.length || new Set(originals.map(query => query.id)).size !== originals.length ||
      labels.length !== originals.length || originals.some(query => !byId.has(query.id))) throw new Error('hr2b_audited_query_set');
  return [...originals].sort((a, b) => compareIds(a.id, b.id)).flatMap(query => {
    const label = byId.get(query.id);
    if (label.family !== query.family || label.intent !== query.intent || label.lang !== query.lang || label.split !== fixture.split?.[query.family] ||
        ![...CATEGORIES, 'C8', 'FOREIGN'].includes(label.category)) throw new Error(`hr2b_audited_query_metadata:${query.id}`);
    if (label.dropped) return [];
    if (label.checks?.[label.category]?.pass !== true) throw new Error(`hr2b_audited_category_check:${query.id}`);
    if ((split && label.split !== split) || (scored && !CATEGORIES.includes(label.category))) return [];
    return [{ ...structuredClone(query), category: label.category }];
  });
}
export function auditedHR2bFixture(fixture) {
  return { ...fixture, queries: { ...fixture.queries, queries: auditedHR2bQueries(fixture) } };
}
