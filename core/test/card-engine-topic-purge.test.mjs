import test from 'node:test';
import assert from 'node:assert/strict';
import { engineCardFixture, ns, ok } from '../testing/engine-card-fixture.mjs';
import { createEngineCardStorage } from '../engine-card-storage.mjs';
import { createEngineCardMaintenance } from '../engine-card-maintenance.mjs';
import { clusterMemories, partitionCardClusters, ENGINE_CARD_LIMITS } from '../engine-card-clusters.mjs';

const noop = () => {};
function worker(f) {
  const storage = createEngineCardStorage({ db: f.db, upgrade: true, ready: noop,
    identity: f.db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get() });
  let clock = Date.now();
  const w = createEngineCardMaintenance({ storage, model: f.model, now: () => clock });
  return { storage, pass: () => w.maintain({ namespace: ns, budget: { maxMs: 5000 } }),
    time: () => clock, advance: ms => { clock += ms; } };
}
// claim installs the ordinary engine layout; commit seeds the legacy routing
// receipt and bindings just as main's unpartitioned publication did.
function seedCard(w, cluster) {
  const timestamp = new Date(w.time()).toISOString();
  const attempt = w.storage.claim(ns, cluster, timestamp, noop);
  assert.ok(attempt); w.storage.release(ns, attempt);
  return w.storage.commit(ns, cluster, { body: 'Synthetic retained topic.' }, timestamp, noop);
}
function forget(t, f, w, memory) {
  const source = f.db.prepare('SELECT revision FROM memories WHERE id=?').get(memory.id);
  t.mock.timers.enable({ apis: ['Date'], now: w.time() });
  try { ok(f.core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: source.revision })); }
  finally { t.mock.timers.reset(); }
}
const topicKey = key => key.replace(/#\d+$/, '');

for (const generation of ['partitioned', 'legacy unpartitioned'])
test(`A1: a purged ${generation} similarity topic blocks every part until cooldown ends`, async t => {
  const f = engineCardFixture(t); f.seed(30);
  const w = worker(f), cluster = clusterMemories(w.storage.snapshot(ns, 512, noop).memories)[0];
  assert.equal(cluster.memories.length, 30);
  // Force the routing seed into the first dated part so removing it shifts
  // all three parts, independent of randomly assigned admission IDs.
  cluster.memories[0].date = '2025-01-01T00:00:00.000Z';
  f.db.prepare('UPDATE memories SET created_at=? WHERE id=?').run(cluster.memories[0].date, cluster.memories[0].id);
  const published = generation === 'legacy unpartitioned' ? [seedCard(w, cluster)] : [];
  if (!published.length) for (let i = 0; i < 3; i++) {
    const pass = await w.pass(); assert.equal(pass.built.length, 1, JSON.stringify(pass)); published.push(pass.built[0]);
  }
  assert.equal(published.reduce((n, card) => n + card.sourceRevisions.length, 0), 30);
  forget(t, f, w, cluster.memories[0]); // remove the routing seed, not an arbitrary source
  const purged = w.storage.recentPurges(ns, new Date(w.time()).toISOString(), noop);
  assert.ok(purged.length); assert.ok(purged.every(card => card.row.body === null));
  const calls = f.model.calls.length;
  for (const advance of [0, ENGINE_CARD_LIMITS.debounceMs - 1]) {
    w.advance(advance);
    const pass = await w.pass();
    assert.equal(pass.modelCalls, 0, 'a tombstone blocks the full unpartitioned similarity topic');
    assert.deepEqual(pass.built, []); assert.equal(f.model.calls.length, calls);
  }
  w.advance(2);
  const rebuilt = [];
  for (let i = 0; i < 3; i++) {
    const pass = await w.pass(); assert.equal(pass.modelCalls, 1, JSON.stringify(pass));
    assert.equal(pass.built.length, 1, JSON.stringify(pass)); rebuilt.push(pass.built[0]);
  }
  assert.deepEqual(rebuilt.map(card => card.sourceRevisions.length).sort((a, b) => b - a), [12, 12, 5]);
  assert.ok(rebuilt.every(card => card.sourceRevisions.every(ref => ref.memoryId !== cluster.memories[0].id)));
});

test('similarity continuity is chosen for the whole legacy topic before partitioning', async t => {
  const f = engineCardFixture(t); f.seed(30);
  const w = worker(f), cluster = clusterMemories(w.storage.snapshot(ns, 512, noop).memories)[0];
  const legacy = seedCard(w, cluster);
  w.storage.retire(ns, legacy.id, new Date(w.time() - ENGINE_CARD_LIMITS.debounceMs - 1).toISOString());
  // Change only traversal order so the natural seed changes, with exactly the
  // same topic and source revisions. The existing full-topic Card still votes.
  const snapshot = w.storage.snapshot;
  w.storage.snapshot = (...args) => {
    const page = snapshot(...args); return { ...page, memories: [...page.memories].reverse() };
  };
  const result = await w.pass(); assert.equal(result.built.length, 1, JSON.stringify(result));
  assert.equal(topicKey(result.built[0].clusterKey), cluster.key, 'resolve continuity before partitioning');
  assert.equal(result.built[0].clusterKey, `${cluster.key}#0`);
  assert.equal(result.built[0].sourceRevisions.length, 12);
});

for (const suffix of ['', '#0', '#1'])
test(`A2: filed tombstone ${suffix || '(bare)'} debounces #0, #1 and the eligible tail`, async t => {
  const f = engineCardFixture(t), filed = f.file(f.seed(30), 'Orion');
  const w = worker(f), cluster = clusterMemories(w.storage.snapshot(ns, 512, noop).memories)[0];
  assert.equal(cluster.key, 'moc:' + filed.mocId);
  const old = seedCard(w, { ...cluster, key: cluster.key + suffix });
  forget(t, f, w, cluster.memories[0]);
  assert.equal(f.db.prepare('SELECT body FROM private_cards WHERE id=?').get(old.id).body, null);
  for (const advance of [0, ENGINE_CARD_LIMITS.debounceMs - 1]) {
    w.advance(advance);
    const pass = await w.pass();
    assert.equal(pass.modelCalls, 0, 'every part is blocked regardless of the tombstone suffix');
    assert.equal(pass.debounced, 3); assert.deepEqual(pass.built, []);
  }
  w.advance(2);
  const built = [];
  for (let i = 0; i < 3; i++) {
    const pass = await w.pass(); assert.equal(pass.modelCalls, 1, JSON.stringify(pass)); built.push(...pass.built);
  }
  assert.deepEqual(new Set(built.map(card => card.clusterKey)), new Set([0, 1, 2].map(i => `${cluster.key}#${i}`)));
  assert.deepEqual(built.map(card => card.sourceRevisions.length).sort((a, b) => b - a), [12, 12, 5]);
  // Shift every published part again. Completing one replacement must not
  // impose a fresh topic cooldown on the two still-stale sibling parts.
  const added = f.add('Orion newly dated earlier synthetic milestone.', -1, 99);
  ok(f.core.applyPlacement({ namespace: ns, expectedIndexRevision: ok(f.core.map({ namespace: ns })).indexRevision,
    expectedMemoryRevisions: [{ memoryId: added.id, revision: added.revision }],
    proposal: { items: [{ memoryId: added.id, parentIds: [filed.mocId] }] } }));
  assert.equal((await w.pass()).modelCalls, 0, 'all shifted parts first take the ordinary stale cooldown');
  w.advance(ENGINE_CARD_LIMITS.debounceMs + 1);
  const replacements = [];
  for (let i = 0; i < 3; i++) {
    const pass = await w.pass();
    assert.equal(pass.modelCalls, 1, 'a completed supersession must not debounce sibling replacements');
    replacements.push(...pass.built);
  }
  assert.deepEqual(new Set(replacements.map(card => card.clusterKey)), new Set(built.map(card => card.clusterKey)));
});

test('A3: a blocked destination cannot be carried while an unrelated topic still builds', async t => {
  const f = engineCardFixture(t), filed = f.file(f.seed(30), 'Orion'), w = worker(f);
  const cluster = clusterMemories(w.storage.snapshot(ns, 512, noop).memories)[0];
  seedCard(w, cluster); forget(t, f, w, cluster.memories[0]);
  const survivors = clusterMemories(w.storage.snapshot(ns, 512, noop).memories)[0];
  const candidate = partitionCardClusters([survivors])[0];
  const carried = seedCard(w, { ...candidate, key: 'moc:synthetic-prior-routing' });
  const before = f.db.prepare("SELECT result FROM card_operations WHERE method='consolidate' AND action_id=?").get(carried.id);
  const unrelated = f.file(f.seed(5, 'Vega'), 'Vega');
  const destinations = [], carry = w.storage.carry;
  w.storage.carry = (...args) => { destinations.push(args[2].key); return carry(...args); };
  const pass = await w.pass();
  assert.equal(pass.modelCalls, 1); assert.equal(pass.built.length, 1, JSON.stringify(pass));
  assert.equal(pass.built[0].clusterKey, 'moc:' + unrelated.mocId);
  assert.ok(destinations.every(key => !key.startsWith(`moc:${filed.mocId}`)), 'blocked parts are excluded before carry');
  assert.deepEqual(f.db.prepare("SELECT result FROM card_operations WHERE method='consolidate' AND action_id=?").get(carried.id), before);
  assert.ok(f.model.calls.every(call => call.memories.every(memory => memory.content.startsWith('Vega'))));
});
