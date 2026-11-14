import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalRawSearch } from '../local-raw-search.mjs';
import { createRawSearchRequestScope, withRawSearchRequestScope } from '../raw-search-request-scope.mjs';
import { sourceFixture, savedSource, ns, ok } from '../testing/raw-source-fixtures.mjs';
import { installRawSearchTestClock, rawSearchTestWait } from '../testing/raw-search-clock.mjs';
import { assembleThreeLayerContext } from '../context-read-three-layer.mjs';

test.beforeEach(installRawSearchTestClock);
const sentinel = 'SYNTHETIC_COPPER_ROUTE_SENTINEL';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

async function fixture(t) {
  const f = sourceFixture(t, { model: { extract: () => ({ items: [
    { content: 'Synthetic copper fact.', kind: 'fact', confidence: .8, sourceIndices: [0] }] }) } });
  const source = await savedSource(f, 'copper ' + sentinel);
  const manager = createLocalRawSearch(f.path, f.port);
  f.workspace.defer(() => manager.close());
  const port = manager.contextPort([ns]);
  let found;
  for (let i = 0; i < 16; i++) {
    await rawSearchTestWait(1010);
    ok(await manager.methods.maintainRawSearch({ namespace: ns }));
    found = await port.search({ query: 'copper' });
    if (found.candidates.length === 1) break;
  }
  assert.equal(found.candidates.length, 1, 'synthetic route fixture must publish its Raw source');
  return { ...f, source, port };
}

test('N=16 overlapping scopes retain every local reader route until prepare', { timeout: 30000 }, async t => {
  const f = await fixture(t), ready = deferred(); let arrived = 0;
  const results = await Promise.all(Array.from({ length: 16 }, () => withRawSearchRequestScope(async () => {
    const candidate = (await f.port.search({ query: 'copper' })).candidates[0];
    assert.ok(candidate);
    if (++arrived === 16) ready.resolve();
    await ready.promise;
    assert.equal(arrived, 16, 'all searches finish before any preparation');
    let handle;
    await assert.doesNotReject(async () => { handle = await f.port.prepare(candidate); },
      'N=16 local reader routes must survive all overlapping searches (single)');
    const batch = await f.port.prepareMany([candidate]);
    assert.equal(batch.complete, true);
    assert.ok(batch.handles[0], 'N=16 local reader routes must survive all overlapping searches (batch)');
    assert.equal(f.port.revalidate([handle, batch.handles[0]]).length, 2);
    const assembled = assembleThreeLayerContext({ prepared: [],
      counter: { id: 'synthetic-route-counter', countTokens: () => 1 }, policy: { id: 'rank-first-whole-v1' },
      budget: { maxTokens: 6000, maxItems: 24 }, query: 'copper', readSet: [ns],
      representation: 'representation-v2-dated', deadlineAt: Infinity, snapshotOf: () => null },
    { coverage: 'included', rawSearch: f.port, items: [{ handle, value: handle.value, key: 'synthetic', rank: 1 }] });
    assert.equal(assembled.diagnostics.coverage.raw, 'included', 'N=16 must never fall back to Memory from route eviction');
    assert.equal(assembled.validateRaw(), true);
    return assembled.metered.items.some(item => item.ref.type === 'raw');
  })));
  assert.deepEqual(results, Array(16).fill(true));
});

test('each local scope retains its own eight reader routes in FIFO order', async t => {
  const f = await fixture(t);
  await withRawSearchRequestScope(async scope => {
    const candidates = [];
    for (let i = 0; i < 8; i++) candidates.push((await f.port.search({ query: 'copper' })).candidates[0]);
    assert.equal(scope.inspect().routes, 8, 'each local scope must retain the legacy eight-route capacity');
    await withRawSearchRequestScope(async () => {
      for (let i = 0; i < 9; i++) await f.port.search({ query: 'copper' });
    });
    assert.equal(scope.inspect().routes, 8, 'another scope must never evict retained local routes');
    let dispatched = 0;
    const settings = { get intent() { dispatched++; return 'current'; } };
    await assert.rejects(f.port.prepare(candidates[0], settings), { code: 'stale_publication' });
    assert.equal(dispatched, 1, 'eighth scoped route must still dispatch the first proof');
    await f.port.search({ query: 'copper' });
    assert.equal(scope.inspect().routes, 8, 'ninth scoped route must keep the eight-route capacity');
    dispatched = 0;
    await assert.rejects(f.port.prepare(candidates[0], settings), { code: 'stale_publication' });
    assert.equal(dispatched, 0, 'ninth scoped route must evict only its own oldest route');
  });
});

test('local reader proofs never resolve across scopes or from unscoped searches', async t => {
  const f = await fixture(t), unscoped = (await f.port.search({ query: 'copper' })).candidates[0];
  await withRawSearchRequestScope(async () => {
    const a = (await f.port.search({ query: 'copper' })).candidates[0];
    await withRawSearchRequestScope(async scope => {
      const own = (await f.port.search({ query: 'copper' })).candidates[0];
      for (const foreign of [a, unscoped]) {
        let dispatched = 0;
        await assert.rejects(f.port.prepare(foreign, { get intent() { dispatched++; return 'current'; } }),
          { code: 'stale_publication' }, 'foreign reader proof must fail with the existing stale_publication code');
        assert.equal(dispatched, 0, 'scope isolation must reject a foreign proof before reader dispatch');
        const batch = await f.port.prepareMany([foreign]);
        assert.deepEqual(batch, { handles: [null], complete: true }, 'foreign batch proof must keep the existing null-handle result');
      }
      assert.equal(scope.inspect().routes, 1, 'foreign lookup must not import a reader route');
      assert.ok(await f.port.prepare(own));
    });
    assert.ok(await f.port.prepare(a));
  });
});

for (const outcome of ['success', 'refusal', 'disconnect', 'failure'])
test('local reader route cleanup on ' + outcome, async t => {
  const f = await fixture(t), controller = new AbortController(); let scope;
  const operation = withRawSearchRequestScope(async current => {
    scope = current;
    await f.port.search({ query: 'copper' });
    assert.equal(scope.inspect().routes, 1, 'the scope must retain one local reader route before finalization');
    if (outcome === 'disconnect') {
      controller.abort();
      assert.equal(scope.inspect().routes, 0, 'local reader route cleanup must be synchronous on disconnect');
    }
    if (['refusal', 'failure'].includes(outcome)) throw Object.assign(Error(outcome), { code: outcome });
  }, { signal: controller.signal });
  if (['refusal', 'failure'].includes(outcome)) await assert.rejects(operation, { code: outcome });
  else await operation;
  assert.equal(scope.inspect().closed, true);
  assert.equal(scope.inspect().routes, 0, 'local reader route cleanup must erase every route on ' + outcome);
});

test('closed inherited scopes reject late local searches without retaining reader routes', async t => {
  const f = await fixture(t), scope = createRawSearchRequestScope();
  const operation = scope.run(() => f.port.search({ query: 'copper' }));
  operation.catch(() => {}); scope.close();
  await assert.rejects(operation, error => ['source_unavailable', 'raw_search_unavailable'].includes(error.code),
    'a closed scope must reject late reader-route insertion');
  assert.equal(scope.inspect().routes, 0, 'late search must leave no reader routes');
  await withRawSearchRequestScope(async () => {
    assert.ok(await f.port.prepare((await f.port.search({ query: 'copper' })).candidates[0]));
  });
});

test('forget committed between local scope search and prepare denies the synthetic source', async t => {
  const f = await fixture(t);
  await withRawSearchRequestScope(async () => {
    const candidate = (await f.port.search({ query: 'copper' })).candidates[0];
    await withRawSearchRequestScope(async () => {
      const memory = f.db.prepare(`SELECT m.id,m.revision FROM memories m JOIN receipts r ON r.memory_id=m.id
        JOIN raw_receipt_lineage l ON l.receipt_id=r.id WHERE l.conversation_id=? LIMIT 1`).get(f.source.conversationId);
      assert.ok(memory); ok(f.core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
    });
    await assert.rejects(f.port.prepare(candidate), { code: 'raw_search_unavailable' },
      'forget between search and prepare must deny SYNTHETIC_COPPER_ROUTE_SENTINEL');
    assert.deepEqual(await f.port.prepareMany([candidate]), { handles: [null], complete: true });
    const next = await f.port.search({ query: 'copper' });
    assert.equal(JSON.stringify(next).includes(sentinel), false);
    assert.equal(next.candidates.length, 0, 'forgotten synthetic route source must not be returned');
  });
});

test('unscoped local reader routes retain the legacy eight-entry FIFO and error codes', async t => {
  const f = await fixture(t), candidates = [];
  for (let i = 0; i < 8; i++) candidates.push((await f.port.search({ query: 'copper' })).candidates[0]);
  let dispatched = 0;
  const settings = { get intent() { dispatched++; return 'current'; } };
  // The native four-proof map already rejects this proof; dispatch distinguishes
  // a retained local route from a route evicted by the ninth search.
  await assert.rejects(f.port.prepare(candidates[0], settings), { code: 'stale_publication' });
  assert.equal(dispatched, 1, 'unscoped eighth route must still dispatch the first proof to its reader');
  const ninth = (await f.port.search({ query: 'copper' })).candidates[0];
  dispatched = 0;
  await assert.rejects(f.port.prepare(candidates[0], settings), { code: 'stale_publication' });
  assert.equal(dispatched, 0, 'unscoped ninth route must evict the first route in FIFO order');
  assert.deepEqual(await f.port.prepareMany([candidates[0]]), { handles: [null], complete: true });
  assert.ok(await f.port.prepare(ninth));
  for (const candidate of candidates.slice(-3)) assert.ok(await f.port.prepare(candidate));
});
