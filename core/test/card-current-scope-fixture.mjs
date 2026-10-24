import { DatabaseSync } from 'node:sqlite';
import { fixture, host, ns, project, ok, importMethod, adopt } from './card-current-fixture.mjs';
export { ns, project, ok };
export const sources = ['relations-one-hop-v1', 'moc-v1'];
export const scopes = [ns, project];
export function scopedHost() {
  const state = { revoked: false, check: null, count: null };
  const h = host({ allow: request => !(state.revoked && request.namespace.scope === 'project'),
    counter: { id: 'synthetic-scoped', countTokens(text) { state.count?.(text); return 1; } } });
  const current = h.authority.isCurrent;
  h.authority.isCurrent = (grant, request) => {
    state.check?.(request);
    if (state.revoked && request.namespace.scope === 'project') return null;
    return current(grant, request);
  };
  return { ...h, state, revokeProject() { state.revoked = true; } };
}
export function scopedFixture(t) {
  const h = scopedHost(), f = fixture(t, { h, sources, model: { contextWindow: 32768, countTokens: () => 1 } });
  const a = f.card({ context: { readSet: scopes, roleId: 'finance' } });
  const control = f.card({ declare: false, title: 'finance personal control', body: 'personal access remains available' });
  const v1 = ok(f.call('importMethodVersion', importMethod('project-v1', 'project method v1', project)));
  const v2 = ok(f.call('importMethodVersion', { ...importMethod('project-v2', 'project method v2', project), package: v1.package, expectedPackageRevision: 1, basedOn: v1.version }));
  ok(f.call('adoptMethodVersion', adopt(v1, 'project-adopt', null, project, null, [project])));
  let memory = ok(f.core.admit({ namespace: project, memory: { content: 'finance project seed', kind: 'fact' },
    receipts: [{ client: 's', sessionId: 's', eventId: 'project', role: 'user', excerpt: 'finance project seed' }] })).memory;
  const memoryIndex = ok(f.core.map({ namespace: project })).indexRevision;
  const memoryPlacement = ok(f.core.applyPlacement({ namespace: project, expectedIndexRevision: memoryIndex,
    expectedMemoryRevisions: [{ memoryId: memory.id, revision: memory.revision }],
    proposal: { items: [{ memoryId: memory.id, parentIds: [], newL1: { title: 'finance memory topic', parentL2Ids: [] } }] } }));
  const memoryTopic = memoryPlacement.createdMocs[0];
  memory = { ...memory, revision: f.db.prepare('SELECT revision FROM memories WHERE id=?').get(memory.id).revision };
  const b = f.card({ namespace: project, packages: [v1.package], title: 'Project endpoint', body: 'project-only-body',
    memoryRefs: [{ type: 'memory', namespace: project, memoryId: memory.id, revision: memory.revision }] });
  const index = ok(f.call('mapEvidence', { namespace: project, type: 'card' })).indexRevision;
  const placed = ok(f.call('applyCardPlacement', { namespace: project, actionId: 'project-topic', refs: [b], expectedIndexRevision: index,
    proposal: { items: [{ cardId: b.cardId, parentIds: [], newL1: { title: 'finance project topic', parentL2Ids: [], newL2Title: 'finance project root' } }] } }));
  const topic = placed.createdMocRefs.find(ref => ref.level === 'L1');
  for (let i = 0; i < 2; i++) ok(f.call('proposeEvidenceMapping', { namespace: project, actionId: 'mapping-' + i,
    memoryTopic: { mocId: memoryTopic.id, revision: memoryTopic.revision }, cardTopic: { mocId: topic.mocId, revision: topic.revision },
    expectedMemoryIndexRevision: memoryPlacement.indexRevision, expectedCardIndexRevision: placed.indexRevision }));
  for (const [namespace, roleKey, ref, pkg] of [[ns, 'personal-finance', a, f.v1.package], [project, 'finance', b, v1.package]])
    ok(f.call('publishRoleProfileRelease', { namespace, roleKey, actionId: 'profile-' + roleKey, expectedCurrentRelease: null, expectedRegistryRevision: null,
      fields: { duties: ['Finance'], requiredOutputs: ['Report'], related: [ref], methods: [pkg] } }));
  const deniedValues = new Set(['project']);
  for (const table of ['private_cards', 'memories', 'method_packages', 'card_mocs', 'role_profiles', 'evidence_mappings'])
    for (const row of f.db.prepare(`SELECT id FROM ${table} WHERE scope='project'`).all()) deniedValues.add(row.id);
  for (const row of f.db.prepare("SELECT id FROM method_versions WHERE package_id=?").all(v1.package.packageId)) deniedValues.add(row.id);
  for (const row of f.db.prepare('SELECT id FROM receipts WHERE memory_id=?').all(memory.id)) deniedValues.add(row.id);
  for (const row of f.db.prepare("SELECT id FROM role_profile_releases WHERE profile_id IN (SELECT id FROM role_profiles WHERE scope='project')").all()) deniedValues.add(row.id);
  return { ...f, h, a, b, control, memory, personalV1: f.v1, personalV2: f.v2, v1, v2, topic, deniedValues,
    request: { readSet: scopes, query: 'finance', types: ['memory', 'card'], intent: 'current', deadlineMs: 5000 } };
}
export function deniedLookupSpy(state, deniedValues, onRead) {
  const original = DatabaseSync.prototype.prepare;
  const observed = { denied: 0, visited: 0 };
  DatabaseSync.prototype.prepare = function(sql) {
    const statement = original.call(this, sql);
    return new Proxy(statement, { get(target, key) {
      const value = Reflect.get(target, key, target);
      if (!['get', 'all', 'iterate'].includes(key)) return typeof value === 'function' ? value.bind(target) : value;
      return (...args) => {
        const denied = state.revoked && args.some(arg => typeof arg === 'string' && deniedValues.has(arg));
        if (denied) observed.denied++;
        const inspect = row => {
          observed.visited++;
          if (!denied && state.revoked && (row?.scope === 'project' || row?.project_id === 'project')) observed.denied++;
          onRead?.(sql, row);
          return row;
        };
        const result = value.apply(target, args);
        if (key === 'iterate') return (function*() { for (const row of result) yield inspect(row); })();
        return key === 'all' ? result.map(inspect) : inspect(result);
      };
    } });
  };
  return { observed, restore() { DatabaseSync.prototype.prepare = original; } };
}
