import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { broker } from '../testing/raw-search-fixtures.mjs';
import { createRawSearchMaintenance } from '../raw-search-maintenance.mjs';

// An admitted native operation can finish after its slice. The final canonical
// comparison must still certify the completed inventory instead of discarding
// it because the ordinary work deadline has already elapsed.
async function checkExpiredComparison(t, phase) {
  const own = Object.getOwnPropertyDescriptor(performance, 'now');
  let now = 0;
  Object.defineProperty(performance, 'now', { configurable: true, value: () => now });
  t.after(() => { if (own) Object.defineProperty(performance, 'now', own); else delete performance.now; });
  // Model an admitted operation crossing the slice without waiting on the host.
  const overrun = () => { now += 30; };
  let checkpoint = { after: ['', '', -1], cycles: 0, cycleFence: 'stable', denialsReconciled: true,
    ...(phase === 'initial' ? { coverageComplete: true, fence: 'stable' } : {}) };
  let fenceCalls = 0;
  const storage = {
    head: () => ({ checkpoint }), tail: () => 0,
    lookup: async () => [],
    snapshot: async () => { if (phase === 'initial') overrun(); return { rows: [], partial: false }; },
    async commitBatch(batch) { checkpoint = batch.checkpoint; return { removed: 0 }; },
  };
  const authority = {
    identity: { storeId: 'synthetic-comparison', fileIdentity: String(Math.random()) },
    recent: cursor => ({ cursor, rows: [] }),
    fence(_expected, at = Infinity) {
      fenceCalls++;
      if (performance.now() >= at) throw Object.assign(Error('expired comparison'), { code: 'search_deadline' });
      return 'stable';
    },
    inventory() {
      overrun();
      return { rows: [], complete: true };
    },
  };
  const maintenance = createRawSearchMaintenance(storage, authority, { maintenanceTurn: broker() });
  try {
    await maintenance.maintain({ maxItems: 16, maxMs: 25 }, guard => guard?.());
    assert.equal(checkpoint.coverageComplete, true, `completed inventory survives the ${phase} comparison after the slice expires`);
    assert.equal(fenceCalls, 2, 'both inventory comparisons must execute');
  } finally { await maintenance.close(); }
}

test('initial comparison preserves completed inventory after the slice expires', t => checkExpiredComparison(t, 'initial'));
test('final comparison preserves completed inventory after the slice expires', t => checkExpiredComparison(t, 'final'));
