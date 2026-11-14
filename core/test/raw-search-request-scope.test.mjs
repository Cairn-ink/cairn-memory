import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { installRawSearchTestClock } from '../testing/raw-search-clock.mjs';
import { sourceFixture, savedSource, ns, ok, localPlainPort } from '../testing/raw-source-fixtures.mjs';
import { searchFixture } from '../testing/raw-search-fixtures.mjs';
import { openRawSearch } from '../raw-search-index.mjs';
import { createRawSearchRequestScope, withRawSearchRequestScope, rawSearchRequestState } from '../raw-search-request-scope.mjs';
import { readRawChannel, assembleThreeLayerContext } from '../context-read-three-layer.mjs';
import { transaction } from '../database.mjs';

test.beforeEach(installRawSearchTestClock);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const args = () => ({ prepared: [], counter: { id: 'synthetic-bytes', countTokens: text => Buffer.byteLength(text) },
  policy: { id: 'rank-first-whole-v1' }, budget: { maxTokens: 6000, maxItems: 24 }, query: 'copper', readSet: [ns],
  representation: 'representation-v2-dated', deadlineAt: Infinity, snapshotOf: () => null });
const packed = raw => assembleThreeLayerContext(args(), raw);
const rawPort = s => ({ search: input => s.search(input), prepare: candidate => s.prepare(candidate),
  revalidate: handles => s.service.revalidate(handles) });

test('four concurrent scopes retain 24 candidates each through final revalidation', { timeout: 30000 }, async t => {
  const f = sourceFixture(t);
  for (let i = 0; i < 24; i++) await savedSource(f, 'Synthetic copper candidate ' + i, { sessionId: 'candidate-' + i });
  const s = await searchFixture(f);
  for (let i = 0; i < 40; i++) {
    await (i ? s.tick({ maxItems: 128, maxMs: 5000 }) : s.maintain({ maxItems: 128, maxMs: 5000 }));
    if ((await s.search({ query: 'copper' })).candidates.length === 24) break;
  }
  const ready = deferred(); let arrived = 0;
  await Promise.all(Array.from({ length: 4 }, () => withRawSearchRequestScope(async scope => {
    const found = await s.search({ query: 'copper' }); assert.equal(found.candidates.length, 24);
    const batch = await s.service.prepareMany(found.candidates, {}, s.host.token);
    assert.equal(batch.complete, true); assert.ok(batch.handles.every(Boolean));
    assert.equal(scope.inspect().prepared, 24);
    if (++arrived === 4) ready.resolve();
    await ready.promise;
    assert.equal(s.service.revalidate(batch.handles).length, 24);
    const raw = { coverage: 'included', rawSearch: rawPort(s), items: batch.handles.map((handle, i) =>
      ({ handle, value: handle.value, key: String(i), rank: i + 1 })) };
    const result = packed(raw);
    assert.equal(result.diagnostics.coverage.raw, 'included');
    assert.ok(result.metered.items.some(item => item.ref.type === 'raw'));
    assert.equal(result.validateRaw(), true);
  })));
});

test('each scope keeps the existing 72-entry capacity and releases evicted routes', async t => {
  const f = sourceFixture(t); await savedSource(f, 'Synthetic copper bounded scope.');
  const s = await searchFixture(f); await s.maintain();
  await withRawSearchRequestScope(async scope => {
    const candidate = (await s.search({ query: 'copper' })).candidates[0], handles = [];
    for (let i = 0; i < 73; i++) handles.push(await s.prepare(candidate));
    assert.equal(scope.inspect().prepared, 72); assert.equal(scope.inspect().routes, 72);
    assert.throws(() => s.service.revalidate([handles[0]]), { code: 'raw_search_unavailable' });
    assert.equal(s.service.revalidate(handles.slice(1)).length, 72);
  });
});

test("one scope cannot evict another scope's search proofs", async t => {
  const f = sourceFixture(t); await savedSource(f, 'Synthetic copper proof.');
  const s = await searchFixture(f); await s.maintain();
  await withRawSearchRequestScope(async () => {
    const candidate = (await s.search({ query: 'copper' })).candidates[0];
    await withRawSearchRequestScope(async () => {
      for (let i = 0; i < 8; i++) await s.search({ query: 'copper' });
    });
    const handle = await s.prepare(candidate);
    assert.equal(handle.validate().ranges[0].text, 'Synthetic copper proof.');
  });
});

test('maintenance gets a separate empty scope and finalizes it before returning', async t => {
  const f = sourceFixture(t); await savedSource(f, 'Synthetic copper maintenance.');
  const owner = {}; let armed = false, cleaned = 0;
  const s = await searchFixture(f, { setupHost(host) {
    const authorize = host.authority.authorize;
    host.authority.authorize = (request, token) => {
      if (armed && request.method === 'rawSearchMaintenance') {
        const state = rawSearchRequestState(owner, () => ({ prepared: new Map(), searches: new Map(), routes: new Set(),
          close() { cleaned++; } }));
        assert.ok(state); assert.equal(state.prepared.size, 0); assert.equal(state.searches.size, 0);
      }
      return authorize(request, token);
    };
  } });
  await s.maintain();
  await withRawSearchRequestScope(async scope => {
    await s.search({ query: 'copper' });
    const before = scope.inspect(); armed = true;
    await s.tick();
    assert.equal(cleaned, 1, 'maintenance must finalize its own scope before returning');
    assert.deepEqual(scope.inspect(), before, 'maintenance must not append state to its caller');
  });
});

for (const outcome of ['success', 'refusal', 'disconnect', 'failure'])
test('scope finalization releases text, proofs and routes on ' + outcome, async t => {
  const f = sourceFixture(t); await savedSource(f, 'Synthetic copper lifecycle.');
  const s = await searchFixture(f); await s.maintain();
  const sibling = await openRawSearch(s.options); f.workspace.defer(() => sibling.close());
  let scope, handles; const controller = new AbortController();
  const work = withRawSearchRequestScope(async current => {
    scope = current;
    const candidate = (await s.search({ query: 'copper' })).candidates[0];
    handles = [await s.prepare(candidate), ...(await s.service.prepareMany([candidate], {}, s.host.token)).handles,
      await s.service.prepareSource(candidate.ranges[0], {}, s.host.token)];
    assert.deepEqual(scope.inspect(), { closed: false, services: 1, prepared: 3, searches: 1, routes: 3 });
    assert.equal(sibling.revalidate(handles).length, 3);
    if (outcome === 'disconnect') {
      controller.abort();
      assert.equal(scope.inspect().prepared, 0, 'disconnect cleans up before the operation settles');
      assert.throws(() => sibling.revalidate(handles));
    }
    if (outcome === 'refusal' || outcome === 'failure') throw Object.assign(Error(outcome), { code: outcome });
  }, { signal: controller.signal });
  if (outcome === 'refusal' || outcome === 'failure') await assert.rejects(work, { code: outcome });
  else await work;
  assert.deepEqual(scope.inspect(), { closed: true, services: 0, prepared: 0, searches: 0, routes: 0 });
  assert.throws(() => sibling.revalidate(handles), { code: 'raw_search_unavailable' });
  assert.throws(() => scope.run(() => {}), { code: 'source_unavailable' });
});

test('a late prepare cannot insert into a closed scope even when the source remains allowed', async t => {
  const port = localPlainPort(), entered = deferred(), gate = deferred(); let armed = false;
  t.after(() => gate.resolve());
  const open = port.openRaw;
  port.openRaw = async input => { if (armed) { entered.resolve(); await gate.promise; } return open(input); };
  const f = sourceFixture(t, { port }); await savedSource(f, 'Synthetic copper late insert.');
  const s = await searchFixture(f); await s.maintain();
  const scope = createRawSearchRequestScope();
  const operation = scope.run(async () => {
    const candidate = (await s.search({ query: 'copper' })).candidates[0]; armed = true;
    return s.prepare(candidate);
  });
  operation.catch(() => {});
  await entered.promise; scope.close(); gate.resolve();
  await assert.rejects(operation, { code: 'raw_search_unavailable' });
  assert.deepEqual(scope.inspect(), { closed: true, services: 0, prepared: 0, searches: 0, routes: 0 });
  const next = await withRawSearchRequestScope(async () => {
    const candidate = (await s.search({ query: 'copper' })).candidates[0]; return (await s.prepare(candidate)).value;
  });
  assert.equal(next.ranges[0].text, 'Synthetic copper late insert.');
});

test('forgotten content cannot return through a long-lived handle', { timeout: 30000 }, async t => {
  for (const mutation of ['forget', 'exclusion']) await t.test(mutation, async t => {
    const sentinel = 'SYNTHETIC_FORBIDDEN_COPPER_SENTINEL';
    const port = localPlainPort(), entered = deferred(), gate = deferred(); let armed = false, opens = 0;
    t.after(() => gate.resolve());
    const open = port.openRaw;
    port.openRaw = async input => { if (armed && ++opens === 2) { entered.resolve(); await gate.promise; } return open(input); };
    const f = sourceFixture(t, { port, model: { extract: () => ({ items: [
      { content: 'Synthetic copper fact.', kind: 'fact', confidence: .8, sourceIndices: [0] }] }) } });
    const source = await savedSource(f, 'copper ' + sentinel, { sessionId: 'target' });
    await savedSource(f, 'Synthetic copper allowed late turn.', { sessionId: 'late' });
    const s = await searchFixture(f);
    for (let i = 0; i < 8; i++) {
      await (i ? s.tick() : s.maintain());
      if ((await s.search({ query: 'copper' })).candidates.length === 2) break;
    }
    let scope, late;
    const servicePort = rawPort(s);
    servicePort.search = async input => {
      const result = await s.search(input);
      return { ...result, candidates: [...result.candidates].sort((a, b) =>
        Number(b.conversationId === source.conversationId) - Number(a.conversationId === source.conversationId)) };
    };
    let preparations = 0;
    servicePort.prepare = candidate => {
      const operation = s.prepare(candidate);
      if (++preparations === 2) { late = operation; late.catch(() => {}); }
      return operation;
    };
    armed = true;
    const prefix = await withRawSearchRequestScope(async current => {
      scope = current;
      return readRawChannel(servicePort, { query: 'copper', readSet: [ns] }, {}, performance.now() + 200);
    });
    await entered.promise;
    assert.equal(prefix.items.length, 1); assert.ok(late);
    assert.equal(prefix.items[0].value.ranges[0].text.includes(sentinel), true);
    assert.equal(scope.inspect().closed, true);
    await withRawSearchRequestScope(async () => {
      if (mutation === 'forget') {
        const memory = f.db.prepare(`SELECT m.id,m.revision FROM memories m JOIN receipts r ON r.memory_id=m.id
          JOIN raw_receipt_lineage l ON l.receipt_id=r.id WHERE l.conversation_id=?`).get(source.conversationId);
        assert.ok(memory); ok(f.core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
      } else transaction(f.db, () => f.db.prepare('INSERT INTO raw_source_exclusions VALUES(?,?,?,?,1)')
        .run(source.conversationId, source.messageId, 0, source.text.length));
    });
    assert.throws(() => s.service.revalidate([prefix.items[0].handle]), { code: 'raw_search_unavailable' });
    const stale = packed(prefix);
    assert.equal(JSON.stringify(stale.metered).includes(sentinel), false,
      'the final revalidation must prevent synthetic sentinel delivery through the retained handle');
    gate.resolve(); await assert.rejects(late, { code: 'raw_search_unavailable' });
    assert.deepEqual(scope.inspect(), { closed: true, services: 0, prepared: 0, searches: 0, routes: 0 });
    const next = await withRawSearchRequestScope(async () => packed(await readRawChannel(rawPort(s),
      { query: 'copper', readSet: [ns] }, {}, performance.now() + 1000)));
    assert.equal(JSON.stringify(next.metered).includes(sentinel), false);
    assert.equal(next.metered.items.some(item => item.ref.conversationId === source.conversationId), false);
  });
});
