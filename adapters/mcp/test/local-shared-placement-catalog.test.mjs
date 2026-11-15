import test from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryCore } from '../../../core/contract.mjs';
import { createCommitDispatcher } from '../../../core/commit-dispatch.mjs';
import { createLocalSharedRuntime } from '../local-shared-runtime.mjs';
import { connect, call } from './local-shared-support.mjs';
import { transaction } from '../../../core/database.mjs';
import { writeContentSuppressionInside } from '../../../core/content-suppression-storage.mjs';
import { safetyFixture, ns, ok, receipt } from '../../../core/testing/content-safety-s2h-fixture.mjs';
import { rationaleModel } from '../../../core/testing/rationale-model.mjs';

for (const flow of ['capture', 'mcp']) for (const suppress of [true, false]) test(`classification catalog dependency survives placement back-off: flow=${flow} suppress=${suppress}`, async t => {
  const f = safetyFixture(t); await f.migrate();
  const writer = f.connect(); let backoffs = 0, seen = false, victim, placementEpoch;
  const marker = 'Synthetic cobalt catalog secret';
  const onBackoff = () => {
    backoffs++; writer.exec('ROLLBACK');
    assert.equal(epoch(), placementEpoch, 'placement has not committed before back-off');
    if (suppress) transaction(writer, () => writeContentSuppressionInside(writer, { namespace: ns,
      kind: 'memory', key: victim.id, reason: 'user_forget', actionId: 'synthetic-catalog-forget' }));
    assert.equal(epoch(), placementEpoch, 'B suppression does not change the namespace epoch');
  };
  const model = { ...rationaleModel(), countTokens: () => 1, classify({ input }) {
    const catalog = input.map.find(item => item.type === 'moc' && item.moc.title === marker);
    assert.ok(catalog, 'the real classification input contains B-derived catalog text'); seen = true;
    placementEpoch = epoch();
    writer.exec('BEGIN IMMEDIATE');
    return { items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [],
      newL1: { title: catalog.moc.title + ' copied for A', parentL2Ids: [] } })) };
  } };
  const ordinary = openMemoryCore({ path: f.path, raw: false, model });
  victim = ok(ordinary.admit({ namespace: ns, memory: { content: 'Synthetic B catalog source', kind: 'fact' }, receipts: [receipt('catalog-B')] })).memory;
  const mapped = ok(ordinary.map({ namespace: ns }));
  ok(ordinary.applyPlacement({ namespace: ns, expectedIndexRevision: mapped.indexRevision,
    expectedMemoryRevisions: [{ memoryId: victim.id, revision: victim.revision }],
    proposal: { items: [{ memoryId: victim.id, parentIds: [], newL1: { title: marker, parentL2Ids: [] } }] } }));
  const originalMocs = new Set(writer.prepare('SELECT id FROM mocs').all().map(row => row.id));
  const target = flow === 'mcp' ? ok(ordinary.admit({ namespace: ns, memory: { content: 'Synthetic A unrelated source', kind: 'fact' }, receipts: [receipt('catalog-A')] })).memory : null;
  await ordinary.close();
  const epoch = () => writer.prepare('SELECT epoch FROM namespace_epochs WHERE owner_id=? AND scope=? AND project_id=?')
    .get(ns.ownerId, ns.scope, ns.projectId ?? '').epoch;
  let core, shared, result;
  t.after(async () => { if (writer.isTransaction) writer.exec('ROLLBACK'); await core?.close(); await shared?.close(); writer.close(); });
  if (flow === 'capture') {
    const host = createCommitDispatcher({ strict: true, onBackoff });
    core = host.open(() => openMemoryCore({ path: f.path, raw: false, model }));
    result = await core.capture({ namespace: ns, client: 'synthetic', sessionId: 'catalog-A', eventId: 'catalog-A',
      messages: [{ id: 'catalog-A-message', role: 'user', content: 'Synthetic A unrelated source' }] });
  } else {
    shared = createLocalSharedRuntime({ path: f.path, namespace: ns, raw: false, model,
      classificationRecovery: 'guarded-v1' }, { strict: true, onBackoff });
    const peer = await connect(t, shared);
    result = await call(peer.client, 'classify_unfiled_memories', { refs: [{ memoryId: target.id, revision: target.revision }] });
  }
  const rows = writer.prepare('SELECT id,title FROM mocs ORDER BY id').all();
  t.diagnostic('R2O_PLACEMENT_ROWS ' + JSON.stringify({ flow, rows }));
  assert.ok(seen && backoffs >= 1, 'classification ran and placement encountered real BUSY');
  if (suppress) {
    assert.equal(rows.filter(row => !originalMocs.has(row.id) && row.title?.includes(marker)).length, 0, 'R2O_PLACEMENT_CATALOG');
    if (flow === 'capture') assert.notEqual(result.value?.classification.status, 'applied', 'R2O_PLACEMENT_CATALOG');
    else assert.equal(result.ok, false, 'R2O_PLACEMENT_MCP_ACCOUNT');
  } else {
    assert.equal(flow === 'capture' ? ok(result).classification.status : ok(result).status, 'applied');
    assert.equal(rows.filter(row => !originalMocs.has(row.id) && row.title?.includes(marker)).length, 1, 'same-shape positive writes the title');
  }
});
