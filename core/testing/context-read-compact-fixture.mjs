// Deliberately independent of canonical storage and the production serializer.
export const compactRepresentation = 'memory-compact-v1';
export const compactNamespace = { ownerId: 'compact-owner', scope: 'project', projectId: 'compact-project' };
export const compactRequest = (patch = {}) => ({ readSet: [compactNamespace], query: 'telescope',
  types: ['memory'], intent: 'current', raw: false, representation: compactRepresentation, ...patch });
export function compactPrepared() {
  return ['later', 'unknown', 'earlier', 'equal'].map((id, i) => ({
    type: 'memory', ns: 0, rank: i + 1,
    ref: { type: 'memory', namespace: compactNamespace, memoryId: id, revision: 1 },
    fence: String(i).repeat(43), text: 'Whole telescope body ' + id + '\n界 and "quotes".',
    date: ['2026-03-01T08:00Z', null, '2026-01-01T08:00Z', '2026-01-01T08:00Z'][i],
    metadata: { state: 'active', reviewState: 'none', filing: { status: 'unfiled' }, kind: 'fact', origin: 'explicit', confidence: 1 },
    sources: [{ index: 0, role: 'user', excerpt: 'Source prose ' + id },
      { index: 1, role: 'assistant', excerpt: 'Shared source prose', date: '2026-01-01T08:00Z' }],
    sourceAccess: 'available', sourcesComplete: true,
  }));
}
export const compactCounter = { id: 'compact-utf8', countTokens: text => Buffer.byteLength(text) };
export function compactAssemblyOptions(patch = {}) {
  return { prepared: compactPrepared(), counter: compactCounter, policy: { id: 'rank-first-whole-v1' },
    budget: { maxTokens: 6000, maxItems: 24 }, deadlineAt: Infinity, now: () => 0,
    snapshotOf: items => JSON.stringify(items.map(item => item.ref)), ...patch };
}
export const legacyCases = [
  { name: 'default' },
  ...['representation-v2', 'representation-v2-dated'].flatMap(representation =>
    ['rank-first-whole-v1', 'coverage-first-v1', 'rank-first-first-source-v1'].map(id =>
      ({ name: representation + '/' + id, representation, policy: { id } }))),
];
