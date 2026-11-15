import test from 'node:test';
import assert from 'node:assert/strict';
import { engineCardFixture, ns, ok } from '../testing/engine-card-fixture.mjs';
import { createEngineCardStorage } from '../engine-card-storage.mjs';
import { createEngineCardMaintenance } from '../engine-card-maintenance.mjs';
import { clusterMemories, partitionCardClusters, ENGINE_CARD_LIMITS } from '../engine-card-clusters.mjs';
import { cardHost } from '../testing/raw-source-fixtures.mjs';

const noop = () => {};
function worker(f, ports = {}) {
  const storage = createEngineCardStorage({ db: f.db, upgrade: true, ready: noop,
    identity: f.db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get() });
  let clock = Date.now();
  const w = createEngineCardMaintenance({ storage, model: f.model, now: () => clock, ...ports });
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

for (const smallerWins of [false, true])
test(`disjoint similarity clusters keep distinct destinations when the ${smallerWins ? 'smaller' : 'larger'} cluster inherits the seed key`, async t => {
  const f = engineCardFixture(t); f.seed(30);
  let memberships;
  const w = worker(f, { vectors: { read: () => memberships.map((group, i) => group.map(memory =>
    ({ memoryId: memory.id, revision: memory.revision, vector: i ? [0, 1] : [1, 0] }))).flat() } });
  const original = clusterMemories(w.storage.snapshot(ns, 512, noop).memories)[0];
  // The seed's natural key belongs to the losing cluster in both variants.
  const large = smallerWins ? original.memories.slice(0, 20) : original.memories.slice(10);
  const small = smallerWins ? original.memories.slice(20) : original.memories.slice(0, 10);
  // A later legacy source set can retain an earlier seed's identity. Here the
  // 13-source cluster has 10/13 overlap with that 11-source prior topic.
  const prior = smallerWins ? { ...original, memories: [original.memories[0], ...small] } : original;
  const old = seedCard(w, prior);
  w.storage.retire(ns, old.id, new Date(w.time() - ENGINE_CARD_LIMITS.debounceMs - 1).toISOString());
  const added = f.seed(3, 'Synthetic additions');
  const current = w.storage.snapshot(ns, 512, noop).memories;
  memberships = [large, [...small, ...current.filter(memory => added.some(value => value.id === memory.id))]];
  const expected = memberships.flatMap(memories => partitionCardClusters([{ key: 'expected', memories }]))
    .filter(part => part.memories.length >= 5).map(part => part.memories.map(memory => memory.id).sort());
  const built = [];
  for (let i = 0; i < 8; i++) built.push(...(await w.pass()).built);
  assert.equal(built.length, expected.length, 'no eligible part is overwritten or left unbuilt');
  const actual = built.map(card => card.sourceRevisions.map(ref => ref.memoryId).sort());
  assert.deepEqual(actual.sort(), expected.sort(), 'each eligible source set is built exactly once');
  assert.equal(new Set(built.map(card => card.clusterKey)).size, expected.length);
  assert.equal(new Set(built.map(card => topicKey(card.clusterKey))).size, 2);
  const winner = memberships[smallerWins ? 1 : 0];
  assert.ok(built.filter(card => card.sourceRevisions.some(ref => winner.some(memory => memory.id === ref.memoryId)))
    .every(card => topicKey(card.clusterKey) === original.key), 'the highest qualifying overlap owns the prior key');
});

test('a purged legacy topic blocks both the continuity winner and its displaced natural-key owner', async t => {
  const f = engineCardFixture(t); f.seed(30);
  let groups;
  const w = worker(f, { vectors: { read: () => groups.flatMap((group, i) => group.map(memory =>
    ({ memoryId: memory.id, revision: memory.revision, vector: i ? [0, 1] : [1, 0] }))) } });
  const original = clusterMemories(w.storage.snapshot(ns, 512, noop).memories)[0];
  const legacy = seedCard(w, original), small = original.memories.slice(0, 10), large = original.memories.slice(10);
  f.seed(3, 'Synthetic additions');
  const current = w.storage.snapshot(ns, 512, noop).memories;
  groups = [large, [...small, ...current.filter(memory => !original.memories.some(old => old.id === memory.id))]];
  // The larger group qualifies by 20/30 overlap; the smaller owns the exact
  // natural seed key. Both must stay blocked even after key displacement.
  w.storage.retire(ns, legacy.id, new Date(w.time()).toISOString(), true);
  for (const advance of [0, ENGINE_CARD_LIMITS.debounceMs - 1]) {
    w.advance(advance);
    const result = await w.pass();
    assert.equal(result.modelCalls, 0); assert.deepEqual(result.built, []);
    assert.equal(result.debounced, 3, 'all eligible parts of both matching purged topics are blocked');
  }
  w.advance(2);
  const built = [];
  for (let i = 0; i < 5; i++) built.push(...(await w.pass()).built);
  assert.equal(built.length, 3);
  assert.equal(new Set(built.map(card => card.clusterKey)).size, 3);
  assert.equal(new Set(built.map(card => topicKey(card.clusterKey))).size, 2);
});

for (const actionId of ['engine-supersede.user-delete', 'ordinary-user-delete'])
test(`public deletion starts the topic cooldown even with action id ${actionId}`, async t => {
  const host = cardHost(), f = engineCardFixture(t, { privateCards: host.options });
  f.file(f.seed(18), 'Orion');
  const w = worker(f), parts = partitionCardClusters(clusterMemories(w.storage.snapshot(ns, 512, noop).memories));
  const old = seedCard(w, parts[0]);
  t.mock.timers.enable({ apis: ['Date'], now: w.time() });
  try { ok(host.call(f.core, 'deleteKnowledgeCard', { namespace: ns, actionId, cardId: old.id, expectedRevision: 1 })); }
  finally { t.mock.timers.reset(); }
  assert.ok(w.storage.recentPurges(ns, new Date(w.time()).toISOString(), noop).some(card => card.id === old.id),
    'a caller-chosen action id cannot exempt the tombstone');
  const result = await w.pass();
  assert.equal(result.modelCalls, 0); assert.deepEqual(result.built, []);
  w.advance(ENGINE_CARD_LIMITS.debounceMs + 1);
  const rebuilt = [];
  for (let i = 0; i < 2; i++) rebuilt.push(...(await w.pass()).built);
  assert.equal(rebuilt.length, 2);
});

test('a real same-part replacement exempts its purge only while the published replacement remains current', async t => {
  const f = engineCardFixture(t); f.file(f.seed(18), 'Orion');
  const w = worker(f), part = partitionCardClusters(clusterMemories(w.storage.snapshot(ns, 512, noop).memories))[0];
  const old = seedCard(w, part);
  w.storage.retire(ns, old.id, new Date(w.time()).toISOString());
  w.advance(ENGINE_CARD_LIMITS.debounceMs + 1);
  const replacement = w.storage.commit(ns, part, { body: 'Synthetic completed replacement.' }, new Date(w.time()).toISOString(), noop);
  assert.ok(replacement);
  assert.ok(!w.storage.recentPurges(ns, new Date(w.time()).toISOString(), noop).some(card => card.id === old.id));
  w.storage.retire(ns, replacement.id, new Date(w.time()).toISOString());
  assert.ok(w.storage.recentPurges(ns, new Date(w.time()).toISOString(), noop).some(card => card.id === old.id),
    'a stale replacement is no longer a completed current publication');
});

// The whole-topic continuity map keeps an in-memory `ids` set per prior topic.
// It is working state only: no pass result and no row the pass writes may
// carry an `ids` key.
test('the in-memory topic membership set never reaches a pass result or a stored row', async t => {
  const f = engineCardFixture(t); f.seed(30);
  const w = worker(f), cluster = clusterMemories(w.storage.snapshot(ns, 512, noop).memories)[0];
  // A prior similarity Card makes the continuity map, and its `ids` set, live.
  seedCard(w, cluster);
  const hasIdsKey = value => {
    if (!value || typeof value !== 'object') return false;
    if (Array.isArray(value)) return value.some(hasIdsKey);
    return Object.entries(value).some(([key, child]) => key === 'ids' || hasIdsKey(child));
  };
  const storedRowsCarryIds = () => {
    for (const { name } of f.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
      for (const row of f.db.prepare(`SELECT * FROM "${name}"`).all()) for (const [column, value] of Object.entries(row)) {
        if (column === 'ids') return name;
        if (typeof value !== 'string' || !/^[\[{]/.test(value)) continue;
        let parsed; try { parsed = JSON.parse(value); } catch { continue; }
        if (hasIdsKey(parsed)) return name + '.' + column;
      }
    }
    return null;
  };
  assert.equal(storedRowsCarryIds(), null, 'baseline store has no ids key');
  let built = 0;
  for (let i = 0; i < 6; i++) {
    w.advance(ENGINE_CARD_LIMITS.debounceMs + 1);
    const pass = await w.pass();
    assert.equal(hasIdsKey(pass), false, JSON.stringify(pass));
    built += pass.built.length;
  }
  assert.ok(built > 0, 'the passes published at least one Card');
  assert.equal(storedRowsCarryIds(), null);
});
