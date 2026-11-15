import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as turn } from 'node:timers/promises';
import { createContextMaintenanceDemand, startContextMaintenance } from '../server.mjs';
import { createEngineCardMaintenance } from '../../../core/engine-card-maintenance.mjs';
import { createCommitDispatcher, bindCommitRuntime, hasCommitDispatcher } from '../../../core/commit-dispatch.mjs';
import { openDatabase } from '../../../core/database.mjs';

for (const hosted of [true, false]) test(hosted
  ? 'item 8: a busy Card namespace cannot skip other namespaces or projection refresh'
  : 'unbound upkeep retains main early return after a refused Card namespace', { timeout: 3000 }, async t => {
  let tick;
  const original = globalThis.setTimeout;
  globalThis.setTimeout = callback => { tick = callback; return { unref() {} }; };
  t.after(() => { globalThis.setTimeout = original; });
  const seen = [], projections = [];
  const namespaces = ['one', 'two'].map(ownerId => ({ ownerId, scope: 'personal', projectId: null }));
  const core = { getContextReadCapabilities: () => ({ ok: true, value: { types: ['memory', 'card'] } }),
    maintainCards: async ({ namespace }) => {
      seen.push(namespace.ownerId);
      return { ok: true, value: { state: 'refused', reason: 'storage_busy' } };
    } };
  // Coordinator 11-14 decision (A): continuation and demand scheduling are host-only.
  if (hosted) {
    const dispatcher = createCommitDispatcher({ strict: true });
    const db = dispatcher.open(() => openDatabase(':memory:'));
    t.after(() => db.close());
    bindCommitRuntime(core, db);
  }
  const demand = createContextMaintenanceDemand();
  demand.note(['memory']); demand.note(['card']);
  const loop = startContextMaintenance(core, { readSet: namespaces, call: async (core, method, input) => {
    projections.push(input.types);
  } }, { cards: true, demand, host: hasCommitDispatcher(core) });
  try {
    for (let i = 0; i < 8; i++) {
      tick(); await turn();
    }
    if (hosted) {
      assert.deepEqual(seen, Array.from({ length: 8 }, () => ['one', 'two']).flat(), 'R2I_MAINTENANCE_CONTINUES');
      assert.deepEqual(projections, [
        ['memory'], ['card'], ['memory'], ['card'],
        ['memory'], ['card'], ['memory'], ['card'],
      ]);
    } else {
      assert.deepEqual(seen, Array(8).fill('one'), 'R2O7_UNBOUND_MAINTENANCE_MAIN');
      assert.deepEqual(projections, [], 'R2O7_UNBOUND_MAINTENANCE_MAIN');
    }
  } finally { await loop.close(); }
});

for (const native of [false, true]) test(`item 8: failureReasons reports ${native ? 'native' : 'dispatcher'} BUSY as storage_busy`, { timeout: 3000 }, async t => {
  const host = createCommitDispatcher({ strict: true });
  const db = host.open(() => openDatabase(':memory:'));
  t.after(() => db.close());
  const storage = { available: () => true, pauseGuard: () => () => {},
    snapshot() { throw native ? Object.assign(Error('synthetic lock'), { code: 'ERR_SQLITE_ERROR', errcode: 5 })
      : Object.assign(Error('storage_busy'), { code: 'storage_busy' }); } };
  bindCommitRuntime(storage, db);
  const worker = createEngineCardMaintenance({ storage, model: { consolidate() {} } });
  const value = await worker.maintain({ namespace: { ownerId: 'synthetic', scope: 'personal', projectId: null } });
  assert.equal(value.state, 'refused'); assert.equal(value.reason, 'storage_busy', 'R2I_BUSY_REASON');
});

for (const native of [false, true]) test(`unbound Card ${native ? 'native' : 'code-only'} BUSY retains the default refusal`, { timeout: 3000 }, async () => {
  const storage = { available: () => true, pauseGuard: () => () => {},
    snapshot() { throw native ? Object.assign(Error('synthetic lock'), { code: 'ERR_SQLITE_ERROR', errcode: 5 })
      : Object.assign(Error('storage_busy'), { code: 'storage_busy' }); } };
  const worker = createEngineCardMaintenance({ storage, model: { consolidate() {} } });
  const value = await worker.maintain({ namespace: { ownerId: 'synthetic', scope: 'personal', projectId: null } });
  assert.equal(value.state, 'refused');
  assert.equal(value.reason, 'consolidation_failed', 'R2L_DEFAULT_BUSY_REASON');
});
