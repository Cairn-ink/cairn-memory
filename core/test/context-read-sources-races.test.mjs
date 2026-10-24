import test from 'node:test';
import assert from 'node:assert/strict';
import { createHook } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { sourcesFixture, ns, ok, memoryRef, sourceChild, sourceQuery } from '../testing/context-read-sources-fixture.mjs';
import { denied } from '../testing/context-read-core-fixture.mjs';

for (const mutation of ['correct', 'forget', 'undelivered-seed', 'witness-removal']) {
  test(`C07 real source-disabled ${mutation} during counting refuses snapshot_stale`, async t => {
    let armed = false, changed = false, job, f;
    const counter = { id: 'synthetic-race', countTokens(text) {
      if (armed && !changed) { changed = true; const result = sourceChild(f, job, { sync: true }); ok(result); assert.equal(result.sourceEnabled ?? result.value.sourceEnabled, false); }
      return mutation === 'undelivered-seed' && text.includes('needle seed body') ? 5001 : 1;
    } };
    f = sourcesFixture(t, { sources: ['relations-one-hop-v1'], counter });
    const seed = f.admit('needle seed body'), endpoint = f.admit('Endpoint canonical body'); await f.relate(endpoint, seed);
    const first = ok(await f.find({ limit: 1 })); assert.ok(first.nextCursor);
    const target = mutation === 'undelivered-seed' ? seed : endpoint;
    job = mutation === 'witness-removal' ? { kind: 'corruption-probe', sql: 'DELETE FROM rationale_edges' } :
      { method: mutation === 'correct' ? 'correct' : 'forget', input: { namespace: ns, memoryId: target.id, expectedRevision: target.revision,
        ...(mutation === 'correct' ? { content: 'Changed endpoint', kind: 'fact', receipt: { client: 'synthetic', sessionId: 'writer', eventId: 'changed', role: 'user', excerpt: 'Changed endpoint' } } : {}) } };
    armed = true;
    denied(await f.assemble({ budget: { maxItems: mutation === 'witness-removal' ? 2 : 1, maxTokens: 4000 } }), 'snapshot_stale'); assert.equal(changed, true);
    denied(await f.find({ cursor: first.nextCursor, limit: 1 }), 'cursor_stale');
  });
}
for (const mutation of ['delete', 'support', 'applicability']) {
  test(`C07 real source-disabled Card ${mutation} during counting refuses stale relation`, async t => {
    let armed = false, changed = false, f, job;
    const counter = { id: 'synthetic-card-race', countTokens() {
      if (armed && !changed) { changed = true; const result = sourceChild(f, job, { sync: true }); ok(result); assert.equal(result.sourceEnabled, false); } return 1;
    } };
    f = sourcesFixture(t, { cards: true, counter }); const memory = f.admit('needle memory');
    const card = f.card('Card endpoint body', { memories: [memory] });
    const detail = ok(f.host.call(f.core, 'getCard', { namespace: ns, cardId: card.cardId })).card;
    if (mutation === 'delete') job = { card: true, method: 'deleteKnowledgeCard', input: { namespace: ns, actionId: 'delete-child', cardId: card.cardId, expectedRevision: card.revision } };
    else if (mutation === 'support') job = { method: 'correct', input: { namespace: ns, memoryId: memory.id, expectedRevision: memory.revision,
      content: 'Changed backing Memory', kind: 'fact', receipt: { client: 'synthetic', sessionId: 'writer', eventId: 'support', role: 'user', excerpt: 'Changed support' } } };
    else job = { card: true, method: 'editKnowledgeCard', input: { namespace: ns, actionId: 'applicability-child', cardId: card.cardId, expectedRevision: card.revision,
      title: detail.title, body: detail.body, bindings: detail.bindings.map(b => b.source), applicability: 'historical' } };
    assert.equal(ok(await f.find({ types: ['memory', 'card'] })).items.length, 2); armed = true;
    denied(await f.assemble({ types: ['memory', 'card'] }), 'snapshot_stale'); assert.equal(changed, true);
  });
}
test('C07 first staged Memory rebuild has unchanged epoch but a distinct fence during counting', async t => {
  let armed = false, changed = false, f, job, before;
  f = sourcesFixture(t, { sources: ['moc-v1'], counter: { id: 'synthetic-projection-race', countTokens() {
    if (armed && !changed) {
      changed = true; const result = sourceChild(f, job, { sync: true }); assert.equal(ok(result).state, 'staged'); assert.equal(result.sourceEnabled, false);
      assert.equal(f.db.prepare('SELECT epoch FROM namespace_epochs WHERE owner_id=? AND scope=? AND project_id=?').get(ns.ownerId, ns.scope, ns.projectId).epoch, before);
      assert.equal(f.db.prepare('SELECT active_generation FROM namespace_index_state').get().active_generation, null);
    } return 1;
  } } });
  f.topic(f.admit('Visible current member'), 'needle title'); f.admit('needle direct');
  assert.equal(f.db.prepare('SELECT 1 FROM namespace_index_state').get(), undefined);
  before = f.db.prepare('SELECT epoch FROM namespace_epochs WHERE owner_id=? AND scope=? AND project_id=?').get(ns.ownerId, ns.scope, ns.projectId).epoch;
  job = { method: 'rebuildIndex', input: { namespace: ns, expectedIndexRevision: before, limit: 1 } };
  ok(await f.find()); armed = true; denied(await f.assemble(), 'snapshot_stale'); assert.equal(changed, true);
  const after = ok(await f.find()); assert.deepEqual(after.trace.sources['moc-v1'].reasons, ['index_unavailable']);
  assert.ok(after.items.some(item => item.ref.memoryId), 'direct lexical retrieval continues');
});
for (const mutation of ['public-topic', 'moc-epoch-only']) test(`C07 undelivered Card-topic dependency ${mutation} during counting`, async t => {
  let armed = false, changed = false, f, job;
  f = sourcesFixture(t, { cards: true, sources: ['moc-v1'], counter: { id: 'synthetic-topic-race', countTokens() {
    if (armed && !changed) { changed = true; ok(sourceChild(f, job, { sync: true })); } return 1;
  } } });
  f.admit('needle direct'); const card = f.card('Other evidence'), topic = f.cardTopic(card, 'nonmatching title');
  job = mutation === 'public-topic' ? { card: true, method: 'refreshCardTopic', input: { namespace: ns, actionId: 'refresh-child', refs: [card],
    expectedIndexRevision: topic.indexRevision, topicRef: { mocId: topic.createdMocRefs[0].mocId, revision: 1 }, title: 'changed title' } } :
    { kind: 'corruption-probe', sql: 'UPDATE card_moc_epochs SET revision=revision+1' };
  const first = ok(await f.find({ types: ['memory', 'card'] })); assert.equal(first.items.length, 1); assert.equal(first.items[0].ref.type, 'memory');
  armed = true; denied(await f.assemble({ types: ['memory', 'card'] }), 'snapshot_stale'); assert.equal(changed, true);
});
test('C07 mutation after expansion but before first page publication; authoritative read validates witnesses', async t => {
  const f = sourcesFixture(t, { sources: ['relations-one-hop-v1'] }), seed = f.admit('needle'), endpoint = f.admit('Other endpoint'); await f.relate(endpoint, seed);
  let changed = false; const original = Map.prototype.set;
  t.mock.method(Map.prototype, 'set', function (key, value) {
    const result = original.call(this, key, value);
    if (!changed && value?.sourceState?.witnesses?.length && value?.expires) {
      changed = true; ok(sourceChild(f, { kind: 'corruption-probe', sql: 'DELETE FROM rationale_edges' }, { sync: true }));
    }
    return result;
  });
  denied(await f.find(), 'cursor_stale'); assert.equal(changed, true);
});
test('C07 final transaction is query_only; every host hook and any subsequent await are guarded', async t => {
  let counterCalls = 0, finalRead = false; const called = new Set(), laterPromises = [];
  const guard = (name, fn) => function (...args) { assert.equal(finalRead, false, name + ' after final read'); called.add(name); return fn.apply(this, args); };
  const counter = { id: 'synthetic-final', countTokens: guard('counter', () => { counterCalls++; return 1; }) };
  const f = sourcesFixture(t, { counter, model: { contextWindow: 32768, countTokens: guard('model.countTokens', () => 1), relate: guard('model.relate', () => ({ edges: [] })) } });
  for (const method of ['authorize', 'isCurrent']) f.trusted.authority[method] = guard('authority.' + method, f.trusted.authority[method]);
  const context = f.reopen({ sources: ['moc-v1'], counter,
    embedder: { id: 'synthetic-final', revision: '1', dimensions: 2, normalization: 'l2', embed: guard('embedder', async texts => texts.map(() => [1, 0])) },
    policy: { family: 'local', maxRequests: 100, maxUsd: 1, estimateUsd: guard('estimateUsd', () => 0) } });
  const memory = f.admit('Member body');
  const indexRevision = ok(context.map({ namespace: ns, purpose: 'classification' })).indexRevision;
  ok(context.applyPlacement({ namespace: ns, expectedIndexRevision: indexRevision, expectedMemoryRevisions: [{ memoryId: memory.id, revision: memory.revision }],
    proposal: { items: [{ memoryId: memory.id, parentIds: [], newL1: { title: 'needle', parentL2Ids: [] } }] } }));
  ok(await f.trusted.call(context, 'refreshContextIndex', { readSet: [ns], types: ['memory'], intent: 'current', budget: { maxItems: 1024, maxMs: 5000 } }));
  const native = DatabaseSync.prototype.prepare;
  t.mock.method(DatabaseSync.prototype, 'prepare', function (sql) {
    const statement = native.call(this, sql), get = statement.get, db = this;
    if (/SELECT epoch FROM namespace_epochs/.test(sql)) statement.get = function (...args) {
      if (counterCalls) { finalRead = true; assert.equal(native.call(db, 'PRAGMA query_only').get().query_only, 1); }
      return get.apply(this, args);
    };
    return statement;
  });
  const hook = createHook({ init(id, type) { if (finalRead && type === 'PROMISE') laterPromises.push(id); } });
  hook.enable(); let assembled;
  try { assembled = await f.trusted.call(context, 'contextRead', sourceQuery({ semantic: true })); }
  finally { hook.disable(); }
  ok(assembled); assert.equal(finalRead, true); assert.ok(counterCalls > 0);
  assert.equal(assembled.value.diagnostics.trace.counterCalls, counterCalls); assert.deepEqual(laterPromises, [], 'an await after final reading creates a PROMISE resource');
  for (const name of ['authority.authorize', 'authority.isCurrent', 'embedder', 'estimateUsd', 'counter']) assert.ok(called.has(name), name + ' exercised');
});

test('C07 a paged addition revalidates its undelivered seed even without an epoch change', async t => {
  const f = sourcesFixture(t, { sources: ['relations-one-hop-v1'] }), seed = f.admit('needle page seed'), endpoint = f.admit('Page endpoint'); await f.relate(endpoint, seed);
  const first = ok(await f.find({ limit: 1 })); assert.equal(first.items[0].ref.memoryId, seed.id); assert.ok(first.nextCursor);
  ok(await sourceChild(f, { kind: 'corruption-probe', sql: "UPDATE memories SET review_state='awaiting' WHERE id='" + seed.id + "'" }));
  denied(await f.find({ limit: 1, cursor: first.nextCursor }), 'cursor_stale');
});
test('C07 published Memory projection replacement and undelivered Card MOC epoch stale pages', async t => {
  for (const kind of ['projection', 'card-moc']) {
    const f = sourcesFixture(t, { cards: true, sources: ['moc-v1'] });
    f.topic(f.admit('Needle member'), 'needle title'); f.admit('needle other direct');
    const card = f.card('Other Card body'); f.cardTopic(card, 'Nonmatching Card title');
    let index = f.db.prepare('SELECT epoch FROM namespace_epochs WHERE owner_id=? AND scope=? AND project_id=?').get(ns.ownerId, ns.scope, ns.projectId).epoch;
    ok(f.context.rebuildIndex({ namespace: ns, expectedIndexRevision: index, limit: 500 }));
    const generation = f.db.prepare('SELECT active_generation FROM namespace_index_state').get().active_generation;
    const first = ok(await f.find({ types: ['memory', 'card'], limit: 1 })); assert.ok(first.nextCursor);
    if (kind === 'projection') {
      index = f.db.prepare('SELECT epoch FROM namespace_epochs WHERE owner_id=? AND scope=? AND project_id=?').get(ns.ownerId, ns.scope, ns.projectId).epoch;
      ok(await sourceChild(f, { method: 'rebuildIndex', input: { namespace: ns, expectedIndexRevision: index, limit: 500 } }));
      assert.notEqual(f.db.prepare('SELECT active_generation FROM namespace_index_state').get().active_generation, generation);
    } else ok(await sourceChild(f, { kind: 'corruption-probe', sql: 'UPDATE card_moc_epochs SET revision=revision+1' }));
    denied(await f.find({ types: ['memory', 'card'], limit: 1, cursor: first.nextCursor }), 'cursor_stale');
  }
});
test('C07/C10 rendezvoused source-disabled writer progresses during semantic await under a deterministic query clock', async t => {
  let armed = false, target, calls = 0, writer;
  const f = sourcesFixture(t, { embedder: { id: 'synthetic-source-writer-progress', revision: '1', dimensions: 2, normalization: 'l2', async embed(texts) {
    calls++;
    if (armed) { writer.release(); const changed = await writer.done; ok(changed); assert.equal(changed.sourceEnabled, false); }
    return texts.map(() => [1, 0]);
  } }, selectedPolicy: { family: 'local', maxRequests: 100, maxUsd: 1, estimateUsd: () => 0 } });
  const seed = f.admit('needle seed'); target = f.admit('Other relation endpoint'); await f.relate(target, seed);
  ok(await f.call('refreshContextIndex', { readSet: [ns], types: ['memory'], intent: 'current', budget: { maxItems: 1024, maxMs: 5000 } }));
  writer = sourceChild(f, { method: 'correct', input: { namespace: ns, memoryId: target.id, expectedRevision: target.revision,
    content: 'Changed while embedding', kind: 'fact', receipt: { client: 'synthetic', sessionId: 'writer', eventId: 'await', role: 'user', excerpt: 'Changed while embedding' } } }, { rendezvous: true });
  // Child has opened its source-disabled core before query timing begins. Its
  // independent 60-second real watchdog remains active while the query clock
  // and only subsequently-created timers are controlled in this process.
  await writer.ready();
  t.mock.method(performance, 'now', () => 1000);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  armed = true;
  try { denied(await f.find({ semantic: true }), 'cursor_stale'); assert.equal(calls, 2); }
  finally { t.mock.timers.reset(); await writer.done; }
});
