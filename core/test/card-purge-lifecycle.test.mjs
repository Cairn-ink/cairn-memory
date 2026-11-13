import test from 'node:test';
import assert from 'node:assert/strict';
import { engineCardFixture, scriptedConsolidator, ns, ok } from '../testing/engine-card-fixture.mjs';
import { lineageFixture } from '../testing/card-lineage-fixture.mjs';
import { host } from '../testing/context-read-core-fixture.mjs';
import { cardHost } from '../testing/raw-source-fixtures.mjs';
import { configured, prebuild } from '../testing/context-product-owner-fixture.mjs';
import { createEngineCardStorage } from '../engine-card-storage.mjs';
import { createEngineCardMaintenance } from '../engine-card-maintenance.mjs';

for (const sealed of [false, true]) test(`forget falls back through candidates, assembly and evidence: sealed=${sealed}`, async t => {
  const trusted = host(), author = cardHost(), model = scriptedConsolidator();
  const f = sealed ? await lineageFixture(t, { options: { model, contextRead: {
    version: 'context-read-v1', authority: trusted.authority, counter: { id: 'synthetic', countTokens: model.countTokens },
  } } }) : engineCardFixture(t, { model, privateCards: author.options });
  const context = sealed ? trusted : f.trusted;
  const call = (method, input) => sealed ? f.call(method, input) : author.call(f.core, method, { namespace: ns, ...input });
  const memories = Array.from({ length: 9 }, (_, i) => {
    const content = `Orion synthetic fallback milestone ${i}.`;
    const memory = ok(f.core.admit({ namespace: ns, memory: { content, kind: 'fact' },
      receipts: [{ client: 'synthetic', sessionId: 'synthetic-conversation-' + i % 3,
        eventId: 'synthetic-fallback-' + i, role: 'user', excerpt: content }] })).memory;
    f.db.prepare('UPDATE memories SET created_at=? WHERE id=?').run(new Date(Date.UTC(2026, 0, 1 + i * 3)).toISOString(), memory.id);
    return memory;
  });
  const card = ok(await f.core.maintainCards({ namespace: ns, budget: { maxMs: 5000 } })).built[0]; assert.ok(card);
  // The product index is exercised on the unsealed store. The lineage fixture's
  // store is read through its embedded index only.
  const service = sealed ? null : configured(t, f.path, [ns], { service: true });
  const request = sealed ? null : configured(t, f.path, [ns]), product = sealed ? null : await request.open();
  const projection = { readSet: [ns], types: ['memory', 'card'] };
  // The lineage fixture's embedded index serves current reads; history is covered on the unsealed store.
  const intents = sealed ? ['current'] : ['current', 'history'];
  async function refreshIndexes(afterForget = false) {
    if (service) await prebuild(service);
    for (const intent of intents) {
      let complete = false, last;
      for (let i = 0; i < 100; i++) {
        const result = last = await context.call(f.core, 'refreshContextIndex', {
          ...projection, intent, budget: { maxItems: 1024, maxMs: 5000 },
        });
        // A freshly opened store answers index_unavailable until its lexical index exists.
        // On the lineage fixture's store an explicit refresh answers index_unavailable
        // after a forget, as it does without this change; reads still succeed and are
        // asserted below, so the refresh is best effort there.
        if (!result.ok && result.error?.code === 'index_unavailable' && sealed && afterForget) { complete = true; break; }
        if (!result.ok && result.error?.code === 'index_unavailable') { await new Promise(resolve => setTimeout(resolve, 50)); continue; }
        const refreshed = ok(result);
        if (refreshed.status === 'complete') { complete = true; break; }
      }
      assert.equal(complete, true, 'embedded lexical index finishes rebuilding: ' + JSON.stringify(last).slice(0, 600));
    }
  }
  await refreshIndexes();
  ok(f.core.forget({ namespace: ns, memoryId: memories[0].id, expectedRevision: memories[0].revision }));
  const row = f.db.prepare('SELECT state,title,body FROM private_cards WHERE id=?').get(card.id);
  assert.deepEqual({ ...row }, { state: 'deleted', title: null, body: null });
  const calls = model.calls.length, remaining = new Set(memories.slice(1).map(memory => memory.id));
  function onlyMemories(items, packed = false) {
    assert.ok(items.length, 'remaining Memories are returned');
    for (const item of items) {
      assert.equal(item.ref.type, 'memory');
      assert.ok(remaining.has(packed ? item.ref.id : item.ref.memoryId), JSON.stringify(item));
    }
  }
  for (const refreshed of [false, true]) {
    // Forget changes the index fence. Finish lexical projection work before
    // asserting reads; the first iteration has no post-forget Card maintenance.
    await refreshIndexes(true);
    if (refreshed) {
      assert.equal(ok(await f.core.maintainCards({ namespace: ns, budget: { maxMs: 5000 } })).modelCalls, 0,
        'forget preserves the debounce');
    }
    for (const intent of intents) {
      const input = { ...projection, intent, query: 'Orion current state', semantic: false, deadlineMs: 5000 };
      if (product) {
        const productCandidates = ok(await product.findCandidates(input, request.token)); onlyMemories(productCandidates.items);
        onlyMemories(ok(await product.contextRead({ ...input, raw: false }, request.token)).metered.items, true);
        onlyMemories(ok(await product.fetchCandidateEvidence({ readSet: [ns], intent,
          refs: productCandidates.items.map(item => item.ref) }, request.token)).items);
      }
      const selected = ok(await context.call(f.core, 'findCandidates', input)); onlyMemories(selected.items);
      onlyMemories(ok(await context.call(f.core, 'contextRead', { ...input, raw: false })).metered.items, true);
      onlyMemories(ok(context.call(f.core, 'fetchCandidateEvidence', { readSet: [ns], intent,
        refs: selected.items.map(item => item.ref) })).items);
      const evidence = ok(call('selectEvidence', { namespace: ns, intent, query: 'Orion', types: ['memory', 'card'] }));
      onlyMemories(evidence.items);
      onlyMemories(ok(call('fetchEvidence', { namespace: ns, intent, refs: evidence.items.map(item => item.ref) })).items);
      // Explicit requests for erased evidence still fail closed.
      assert.equal(call('fetchEvidence', { namespace: ns, intent, refs: [{ type: 'card', namespace: ns,
        cardId: card.id, revision: card.revision, bodyRevision: 1 }] }).ok, false);
    }
    assert.equal(model.calls.length, calls, 'fallback reads and index refreshes do not generate a replacement');
  }
});

test('more than 129 rebuilds retain only live Cards and still rebuild the newest part', async t => {
  const f = engineCardFixture(t), parts = ['Orion', 'Vega', 'Lyra'].map(topic => f.file(f.seed(8, topic), topic));
  const identity = f.db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get();
  const storage = createEngineCardStorage({ db: f.db, identity, ready() {}, upgrade: true });
  let clock = Date.UTC(2030, 0, 1);
  const pass = () => createEngineCardMaintenance({ storage, model: f.model, now: () => clock })
    .maintain({ namespace: ns, budget: { maxMs: 5000 } });
  const addSource = (part, i) => {
    const memory = f.add(`Synthetic recurring part ${part.mocId} new milestone ${i}.`, 90 + i, i % 6);
    ok(f.core.applyPlacement({ namespace: ns, expectedIndexRevision: ok(f.core.map({ namespace: ns })).indexRevision,
      expectedMemoryRevisions: [{ memoryId: memory.id, revision: memory.revision }],
      proposal: { items: [{ memoryId: memory.id, parentIds: [part.mocId] }] } }));
  };
  for (let i = 0; i < parts.length; i++) assert.equal((await pass()).built.length, 1);
  for (let i = 0; i < 132; i++) {
    const part = parts[i % parts.length];
    clock += 600001;
    addSource(part, i);
    assert.equal((await pass()).modelCalls, 0, 'the new source first stales the part');
    clock += 600001;
    const result = await pass(); assert.equal(result.built.length, 1, JSON.stringify({ i, result }));
    assert.equal(result.built[0].clusterKey, 'moc:' + part.mocId);
    const live = storage.cards(ns); assert.equal(live.length, parts.length);
    assert.ok(live.every(card => card.row.state === 'confirmed' && card.status === 'current'));
    assert.equal((await pass()).modelCalls, 0, 'no part rebuilds without a source change');
  }
  assert.equal(f.db.prepare('SELECT count(*) n FROM private_cards').get().n, 135);
  assert.equal(f.db.prepare("SELECT count(*) n FROM private_cards WHERE state='deleted' AND title IS NULL AND body IS NULL").get().n, 132);
  const newest = storage.cards(ns).sort((a, b) => b.builtAt.localeCompare(a.builtAt))[0];
  clock += 600001;
  addSource(parts.find(part => newest.clusterKey === 'moc:' + part.mocId), 132);
  assert.equal((await pass()).modelCalls, 0);
  clock += 600001;
  const result = await pass(); assert.equal(result.built.length, 1, JSON.stringify(result));
  assert.equal(result.built[0].clusterKey, newest.clusterKey); assert.notEqual(result.built[0].id, newest.id);
  assert.equal((await pass()).modelCalls, 0);
});

test('forgetting a similarity seed keeps the ten-minute debounce without retaining its body', async t => {
  const f = engineCardFixture(t), memories = f.seed(30);
  const first = ok(await f.pass()).built[0]; assert.ok(first);
  const seed = memories.slice().sort((a, b) => a.id.localeCompare(b.id))[0];
  ok(f.core.forget({ namespace: ns, memoryId: seed.id, expectedRevision: seed.revision }));
  const row = f.db.prepare('SELECT * FROM private_cards WHERE id=?').get(first.id);
  assert.equal(row.title, null); assert.equal(row.body, null);
  const identity = f.db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get();
  const storage = createEngineCardStorage({ db: f.db, identity, ready() {} });
  const pass = offset => createEngineCardMaintenance({ storage, model: f.model, now: () => Date.parse(row.updated_at) + offset })
    .maintain({ namespace: ns, budget: { maxMs: 5000 } });
  assert.equal((await pass(0)).modelCalls, 0);
  assert.equal((await pass(599999)).modelCalls, 0);
  const rebuilt = await pass(600001); assert.equal(rebuilt.built.length, 1, JSON.stringify(rebuilt));
  assert.ok(rebuilt.built[0].sourceRevisions.every(ref => ref.memoryId !== seed.id));
  assert.equal(f.model.calls.length, 2);
});

test('the live Card scan crosses two 128-row pages with 257 live Cards', async t => {
  const f = engineCardFixture(t);
  const identity = f.db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get();
  const storage = createEngineCardStorage({ db: f.db, identity, ready() {}, upgrade: true });
  f.seed(8); ok(await f.pass());
  const timestamp = '2030-01-01T00:00:00.000Z', ids = [];
  // Three disjoint source sets keep every Memory below its 128-Card fanout.
  for (const [topic, count] of [['Orion', 127], ['Antares', 128], ['Vega', 1]]) {
    if (topic !== 'Orion') f.seed(8, topic);
    const memories = storage.snapshot(ns, 512, () => {}).memories.filter(memory => memory.content.startsWith(topic));
    for (let i = 0; i < count; i++) ids.push(storage.commit(ns, { key: 'moc:synthetic-part-' + topic + '-' + i,
      memories }, { body: 'Synthetic live page.' }, timestamp, () => {}).id);
  }
  const live = storage.cards(ns), seen = new Set(live.map(card => card.id));
  assert.equal(live.length, 257);
  assert.equal(seen.size, 257);
  assert.ok(ids.every(id => seen.has(id)));
});
