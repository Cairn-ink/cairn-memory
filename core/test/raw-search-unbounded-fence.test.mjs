import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { sourceFixture, savedSource, ok, request, splitRaw } from '../testing/raw-source-fixtures.mjs';
import { searchFixture, broker } from '../testing/raw-search-fixtures.mjs';
import { createRawSearchMaintenance } from '../raw-search-maintenance.mjs';

// Advance only the host cadence. Every operation still consumes real elapsed
// time, including the full fence and the unchanged 25 ms recent-work budget.
export async function checkCoverage(t, count) {
  const realNow = performance.now.bind(performance);
  const own = Object.getOwnPropertyDescriptor(performance, 'now');
  let cadence = 0;
  Object.defineProperty(performance, 'now', { configurable: true, value: () => realNow() + cadence });
  t.after(() => { if (own) Object.defineProperty(performance, 'now', own); else delete performance.now; });
  const f = sourceFixture(t);
  // The CI population uses separate conversations, exercising the fence's
  // per-conversation work even on a fast runner. Larger qualification stores
  // batch seed writes exactly like the existing recent-lane fixtures.
  const batchSize = count === 300 ? 1 : 24;
  for (let start = 0; start < count - 1; start += batchSize) {
    const messages = Array.from({ length: Math.min(batchSize, count - 1 - start) }, (_, offset) => {
      const i = start + offset;
      return splitRaw('synthetic copper baseline ' + i, { id: 'baseline-' + i, ordinal: batchSize === 1 ? 1 : i + 1 })[0];
    });
    ok(await f.core.captureRaw({ ...request(messages[0], { sessionId: batchSize === 1 ? 'baseline-' + start : 'baseline', eventId: 'batch-' + start }), messages }));
  }
  // Leave a one-part newest event, as in the existing recent-lane fixtures:
  // discovery preserves an unresolved batch before admitting a newer event.
  ok(await f.core.captureRaw(request(splitRaw('synthetic copper baseline tail',
    { id: 'baseline-tail', ordinal: batchSize === 1 ? 1 : count })[0],
    { sessionId: batchSize === 1 ? 'baseline-tail' : 'baseline', eventId: 'baseline-tail' })));
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_messages').get().n, count);
  const s = await searchFixture(f);
  const index = new DatabaseSync(join(s.directory, readdirSync(s.directory).find(name => name.endsWith('.sqlite'))));
  f.workspace.defer(() => index.close());
  const readCheckpoint = index.prepare('SELECT checkpoint FROM header WHERE singleton=1');
  const bound = Math.ceil(count * 1.7) + 100;
  const ceiling = 3 * bound;
  let state, passes = 0;
  const began = realNow();
  const pass = async () => {
    cadence += 1010;
    await s.maintain({ maxItems: 16, maxMs: 25 });
    state = JSON.parse(readCheckpoint.get().checkpoint);
    passes++;
    await new Promise(resolve => setImmediate(resolve));
  };
  await pass();
  assert.notEqual(state.coverageComplete, true);
  const arrival = await savedSource(f, 'uniquefencearrival', { sessionId: 'new-arrival', eventId: 'new-arrival' });
  let found = false;
  for (let i = 0; i < 4; i++) {
    await pass();
    const result = await s.search({ query: 'uniquefencearrival' });
    assert.equal(result.coverage.status, 'partial');
    if (result.candidates.some(candidate => candidate.conversationId === arrival.conversationId)) { found = true; break; }
  }
  assert.equal(found, true, 'the recent lane must publish a new conversation within four real slices');
  t.diagnostic(`recent lane searchable with partial coverage at pass ${passes}, population ${count}`);
  while (passes < ceiling && !state.coverageComplete) {
    await pass();
    if (passes % 1000 === 0) console.log(`coverage progress population=${count} passes=${passes} wallMs=${Math.round(realNow() - began)}`);
  }
  const wallMs = realNow() - began;
  t.diagnostic(JSON.stringify({ count, bound, ceiling, passes, wallMs, hostSeconds: passes, complete: state.coverageComplete === true }));
  assert.equal(state.coverageComplete, true, `coverage must complete within ${bound} passes; observed ${passes} (base observed for at least 3x the bound)`);
  assert.ok(passes <= bound, `completion used ${passes} passes, bound ${bound}`);
  assert.equal((await s.search({ query: 'uniquefencearrival' })).coverage.status, 'complete');
  await checkExpiredComparison('initial');
  await checkExpiredComparison('final');
}

test('full Raw inventory completes at the real host slice and preserves recent saves (300 messages)', t => checkCoverage(t, 300));

// An admitted native operation can finish after its slice. The final canonical
// comparison must still certify the completed inventory instead of discarding
// it because the ordinary work deadline has already elapsed.
async function checkExpiredComparison(phase) {
  const overrun = () => { const until = performance.now() + 30; while (performance.now() < until) { /* admitted synchronous work */ } };
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
