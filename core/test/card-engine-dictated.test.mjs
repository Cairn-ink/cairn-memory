import test from 'node:test';
import assert from 'node:assert/strict';
import { engineCardFixture, scriptedConsolidator, realisticCardMemories, ns, ok } from '../testing/engine-card-fixture.mjs';
import { cardTrigger, partitionCardClusters } from '../engine-card-clusters.mjs';
import { createEngineCardStorage } from '../engine-card-storage.mjs';
import { createEngineCardMaintenance } from '../engine-card-maintenance.mjs';
import { validateConsolidation, normalizedMemoryText } from '../engine-card-output.mjs';
import { assembleContext, cardSourceKeys, memoryPackKey } from '../context-read-assembly.mjs';
import { assembleThreeLayerContext } from '../context-read-three-layer.mjs';

const output = memories => ({ currentState: memories.map(memory => ({ text: memory.content, memoryIds: [memory.id] })),
  timeline: [], contradictions: [] });
const completeModel = () => scriptedConsolidator(({ input }) => output(input.memories));
const worker = (f, now) => createEngineCardMaintenance({ model: f.model, now,
  storage: createEngineCardStorage({ db: f.db, upgrade: true, ready() {},
    identity: f.db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get() }) });
const run = w => w.maintain({ namespace: ns, budget: { maxMs: 5000 } });

// These lengths include distinct facts rather than repeating filler words.
const facts = [
  'Orion volunteers prepare the community garden before the spring planting workshop.',
  'Orion coordinators reserve the public library room for the next planning meeting with local volunteers.',
  'Orion organizers collect participant dietary preferences before ordering lunch for the community workshop and ask volunteers to confirm any additional accessibility needs.',
  'Orion facilitators share the planting guide with new volunteers and invite questions before the workshop begins.'
];

test('topic trigger counts distinct Memories per conversation and preserves recurrence, chain and pressure', () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({ id: String(i), date: '2026-01-01', currentness: 'current', conversations: ['shared'] }));
  assert.deepEqual(cardTrigger(rows.slice(0, 4), undefined, 0),
    { eligible: false, recurring: false, topic: false, chain: null, pressure: false, memories: 4, conversations: 1, tokens: 0 });
  assert.deepEqual(cardTrigger(rows.slice(0, 5), undefined, 0),
    { eligible: true, recurring: false, topic: true, chain: null, pressure: true, memories: 5, conversations: 1, tokens: 0 });
  const spread = rows.map((row, i) => ({ ...row, conversations: ['separate-' + i] }));
  assert.equal(cardTrigger(spread.slice(0, 5), undefined, 0).eligible, true);
  assert.equal(cardTrigger(rows.map(row => ({ ...row, currentness: 'historical' })), [], 0).topic, false);
  assert.equal(cardTrigger(rows.slice(0, 4).map(row => ({ ...row, conversations: ['shared', 'shared'] })), [], 1200).topic, false);
  const recurring = spread.map((row, i) => ({ ...row, date: new Date(Date.UTC(2026, 0, 1 + i * 2)).toISOString() }));
  assert.deepEqual(cardTrigger(recurring, [], 0),
    { eligible: true, recurring: true, topic: true, chain: 0, pressure: true, memories: 8, conversations: 8, tokens: 0 });
  const edges = rows.slice(1, 4).map((row, i) => ({ from: row.id, to: rows[i].id, kind: 'supersedes', slot: 'status' }));
  assert.deepEqual(cardTrigger(spread.slice(0, 4), edges, 1200),
    { eligible: true, recurring: false, topic: false, chain: 3, pressure: true, memories: 4, conversations: 4, tokens: 1200 });
  assert.equal(cardTrigger(spread.slice(0, 4), edges, 1199).eligible, false);
});

test('topic consolidation builds immediately from the whole topic, then rebuilds ten minutes after staling and after forget', async t => {
  const f = engineCardFixture(t, { model: completeModel() });
  let clock = Date.UTC(2026, 5, 1);
  const w = worker(f, () => clock), memories = [];
  for (let i = 0; i < 4; i++) memories.push(f.add(`Orion item ${i} ready.`, 0, 0));
  assert.equal((await run(w)).modelCalls, 0);
  memories.push(f.add('Orion item four ready.', 0, 0));
  // The whole cluster includes a sixth fact from a different conversation.
  memories.push(f.add('Orion item five ready.', 0, 1));
  const first = ok(await f.pass()); assert.equal(first.built.length, 1, JSON.stringify(first));
  clock = Date.parse(first.built[0].builtAt);
  assert.equal(first.modelCalls, 1); assert.equal(f.model.calls[0].memories.length, 6);
  const body = f.db.prepare('SELECT body FROM private_cards WHERE id=?').get(first.built[0].id).body;
  for (const memory of memories) assert.ok(body.includes(`[${memory.id}]`));
  assert.match(ok(f.core.getEngineCardStatus({ namespace: ns })).trigger, /five.*topic part/);
  clock += 60000;
  memories.push(f.add('Orion item six ready.', 0, 0), f.add('Orion item seven ready.', 0, 0));
  const stale = await run(w); assert.equal(stale.built.length, 0); assert.equal(stale.debounced, 1);
  assert.equal(f.db.prepare('SELECT revision FROM private_cards WHERE id=?').get(first.built[0].id).revision, 2);
  clock += 599999; assert.equal((await run(w)).modelCalls, 0);
  clock += 1;
  const rebuilt = await run(w); assert.equal(rebuilt.built.length, 1, JSON.stringify(rebuilt));
  assert.notEqual(rebuilt.built[0].id, first.built[0].id);
  assert.equal(rebuilt.built[0].sourceRevisions.length, 8);
  ok(f.core.forget({ namespace: ns, memoryId: memories[0].id, expectedRevision: memories[0].revision }));
  ok(await f.refresh());
  const hidden = ok(await f.read('Orion item'));
  assert.ok(hidden.metered.items.length);
  assert.ok(hidden.metered.items.every(item => item.ref.type !== 'card'));
  assert.ok(!JSON.stringify(hidden.metered).includes(memories[0].id));
  const updated = Date.parse(f.db.prepare('SELECT updated_at FROM private_cards WHERE id=?').get(rebuilt.built[0].id).updated_at);
  clock = updated + 600000;
  const forgotten = await run(w); assert.equal(forgotten.built.length, 1, JSON.stringify(forgotten));
  assert.equal(forgotten.built[0].sourceRevisions.length, 7);
  assert.ok(!f.model.calls.at(-1).memories.some(memory => memory.id === memories[0].id));
  assert.ok(!f.db.prepare('SELECT body FROM private_cards WHERE id=?').get(forgotten.built[0].id).body.includes(memories[0].content));
});

test('five same-day facts from separate conversations consolidate; owner and namespace sources never join', async t => {
  const f = engineCardFixture(t, { model: completeModel() });
  const memories = Array.from({ length: 5 }, (_, i) => f.add(`Orion task ${i} ready.`, 0, i));
  const filed = f.file(memories, 'Orion workshop');
  for (const namespace of [{ ...ns, ownerId: 'synthetic-other-owner' }, { ...ns, projectId: 'synthetic-other-project' }])
    for (let i = 0; i < 5; i++) f.add(`Orion private workshop task ${i} ready.`, 0, 0, namespace);
  const pass = ok(await f.pass()); assert.equal(pass.built.length, 1, JSON.stringify(pass));
  assert.equal(pass.built[0].clusterKey, 'moc:' + filed.mocId);
  const status = ok(f.core.getEngineCardStatus({ namespace: ns }));
  assert.match(status.trigger, /five.*topic part/); assert.equal(status.lastPass.built, 1);
  assert.deepEqual(new Set(f.model.calls[0].memories.map(memory => memory.id)), new Set(memories.map(memory => memory.id)));
  const body = f.db.prepare('SELECT body FROM private_cards WHERE id=?').get(pass.built[0].id).body;
  for (const memory of memories) assert.ok(body.includes(`[${memory.id}]`));
});

test('without consolidation configured topic consolidation does no work or control reads', async t => {
  const f = engineCardFixture(t, { model: null });
  for (let i = 0; i < 6; i++) f.add(`Orion task ${i} ready.`, 0, 0);
  assert.equal(Object.hasOwn(f.core, 'maintainCards'), false);
  assert.equal(Object.hasOwn(f.core, 'getEngineCardStatus'), false);
  const w = createEngineCardMaintenance({ model: null, storage: new Proxy({}, { get() { assert.fail('control read'); } }) });
  assert.equal((await run(w)).state, 'model_not_configured');
  assert.equal(f.db.prepare("SELECT name FROM sqlite_schema WHERE name='private_cards'").get(), undefined);
});

test('both packers retain uncited cluster Memories when a body omits items, across origins and scopes', () => {
  const model = completeModel();
  const memories = Array.from({ length: 12 }, (_, i) => ({ type: 'memory', ns: 0, rank: i + 2,
    ref: { type: 'memory', namespace: ns, memoryId: 'synthetic-source-' + i, revision: 1 },
    text: `Orion item ${i} requires preparation.`, sources: [], sourceAccess: 'available', sourcesComplete: true,
    turnIds: [], sessionIds: [], fence: 'synthetic-fence', date: null,
    metadata: { state: 'active', reviewState: 'none', filing: { status: 'unfiled' }, kind: 'fact', origin: 'explicit', confidence: 1 } }));
  const card = { ...memories[0], type: 'card', rank: 1,
    ref: { type: 'card', namespace: ns, cardId: 'synthetic-card', revision: 1, bodyRevision: 1 },
    metadata: { state: 'confirmed', origin: 'engine' },
    text: 'Orion workshop needs preparation [synthetic-source-0,synthetic-source-1]',
    sourceMemoryRefs: memories.map(memory => memory.ref) };
  const args = { prepared: [card, ...memories], counter: model, policy: { id: 'rank-first-whole-v1' },
    budget: { maxItems: 12, maxTokens: 10000 }, deadlineAt: Infinity, snapshotOf: () => null,
    readSet: [ns], query: 'Orion workshop', representation: 'representation-v2-dated' };
  for (const result of [assembleContext(args), assembleThreeLayerContext(args, { items: [], coverage: 'unavailable' })]) {
    assert.ok(result.metered.items.some(item => item.ref.type === 'card'));
    assert.deepEqual(result.metered.items.filter(item => item.ref.type === 'memory').map(item => item.ref.id),
      memories.slice(2).map(memory => memory.ref.memoryId));
  }
  assert.equal(cardSourceKeys([{ ...card, metadata: { origin: 'authored' } }]).size, 0);
  assert.equal(cardSourceKeys([{ ...card, text: 'No citations.' }]).size, 0);
  assert.equal(cardSourceKeys([card]).has(memoryPackKey({ ...memories[0].ref, namespace: { ...ns, ownerId: 'synthetic-other-owner' } })), false);
  assert.equal(cardSourceKeys([card]).has(memoryPackKey({ ...memories[0].ref, revision: 2 })), false);
});

test('host read retains ordinary Memories omitted by whole-entry fitting', async t => {
  const model = scriptedConsolidator();
  const f = engineCardFixture(t, { model });
  // Distinct text per Memory: identical content would be admitted once.
  const memories = Array.from({ length: 12 }, (_, i) => f.add(`${(facts[i % facts.length] + ' ').repeat(4).trim()} Detail ${i}.`, i, i));
  const pass = ok(await f.pass()); assert.equal(pass.built.length, 1, JSON.stringify(pass));
  const body = f.db.prepare('SELECT body FROM private_cards WHERE id=?').get(pass.built[0].id).body;
  assert.ok(model.countTokens(body) <= 850);
  const omitted = memories.filter(memory => !body.includes(memory.id)); assert.ok(omitted.length);
  ok(await f.refresh());
  const read = ok(await f.read('what is the current state of Orion', { budget: { maxItems: 24, maxTokens: 6000 } }));
  assert.ok(read.metered.items.some(item => item.ref.type === 'card'), JSON.stringify(read));
  for (const memory of omitted) assert.ok(read.metered.items.some(item => item.ref.type === 'memory' && item.ref.id === memory.id), memory.id);
});

for (const count of [5, 8, 12]) test(`${count} verbatim dated Memories fit without rewriting`, () => {
  const memories = realisticCardMemories(count), model = completeModel();
  const { body } = validateConsolidation(output(memories), [...memories].reverse(), model);
  assert.deepEqual(body.split('\n'), memories.map(m => `${m.date.slice(0, 10)}: ${normalizedMemoryText(m.content)} [${m.id}]`));
  assert.ok(model.countTokens(body) <= 850);
});

for (const count of [13, 30]) test(`${count} Memories form bounded parts and generate once per pass`, async t => {
  const f = engineCardFixture(t, { model: scriptedConsolidator() });
  const memories = f.seed(count), filed = f.file(memories, 'Orion');
  const parts = partitionCardClusters([{ key: 'topic', memories: memories.map((m, i) =>
    ({ ...m, date: new Date(Date.UTC(2026, 0, i + 1)).toISOString() })) }]);
  assert.deepEqual(parts.map(p => p.memories.length), count === 13 ? [12, 1] : [12, 12, 6]);
  const built = [];
  for (let i = 0; i < (count === 13 ? 1 : 3); i++) {
    const pass = ok(await f.pass()); assert.equal(pass.modelCalls, 1); assert.equal(pass.built.length, 1, JSON.stringify(pass));
    built.push(pass.built[0]); assert.equal(pass.built[0].clusterKey, `moc:${filed.mocId}#${i}`);
  }
  assert.equal(ok(await f.pass()).modelCalls, 0);
  assert.deepEqual(built.map(c => c.sourceRevisions.length), count === 13 ? [12] : [12, 12, 6]);
  assert.ok(f.model.calls.every(call => call.memories.length <= 24));
});

test('appending changes only the final part; forgetting an early source hides and rebuilds shifted parts', async t => {
  const f = engineCardFixture(t), filed = f.file(f.seed(), 'Orion'), memories = filed.memories;
  let clock = Date.now(); const w = worker(f, () => clock), built = [];
  for (let i = 0; i < 3; i++) built.push(ok(await f.pass()).built[0]);
  const added = f.add('Orion later community planning milestone.', 61, 7);
  // Move into the existing topic rather than a new MOC.
  const map = ok(f.core.map({ namespace: ns }));
  ok(f.core.applyPlacement({ namespace: ns, expectedIndexRevision: map.indexRevision,
    expectedMemoryRevisions: [{ memoryId: added.id, revision: added.revision }],
    proposal: { items: [{ memoryId: added.id, parentIds: [filed.mocId] }] } }));
  const stale = await run(w); assert.equal(stale.debounced, 1); assert.equal(stale.modelCalls, 0);
  clock += 600001;
  const appended = await run(w); assert.equal(appended.built.length, 1, JSON.stringify(appended));
  assert.equal(appended.built[0].clusterKey, `moc:${filed.mocId}#2`); assert.equal(appended.built[0].sourceRevisions.length, 7);
  for (const card of built.slice(0, 2)) assert.equal(f.db.prepare('SELECT revision FROM private_cards WHERE id=?').get(card.id).revision, 1);
  const forgotten = memories[0];
  ok(f.core.forget({ namespace: ns, memoryId: forgotten.id, expectedRevision: forgotten.revision }));
  clock = Date.parse(f.db.prepare('SELECT updated_at FROM private_cards WHERE id=?').get(built[0].id).updated_at);
  ok(await f.refresh());
  const read = ok(await f.read('Orion current state'));
  assert.ok(!read.metered.items.some(item => item.ref.id === built[0].id));
  await run(w); clock += 600001;
  const rebuilt = await run(w); assert.equal(rebuilt.built.length, 1, JSON.stringify(rebuilt));
  assert.equal(rebuilt.built[0].clusterKey, `moc:${filed.mocId}#0`);
  assert.ok(!f.model.calls.at(-1).memories.some(memory => memory.id === forgotten.id));
  assert.ok(!f.db.prepare('SELECT body FROM private_cards WHERE id=?').get(rebuilt.built[0].id).body.includes(forgotten.content));
});

test('parts sort event dates then IDs and small clusters retain their key', () => {
  const memories = Array.from({ length: 13 }, (_, i) => ({ id: String(20 - i), date: '2026-01-01' }));
  const parts = partitionCardClusters([{ key: 'moc:topic', memories }]);
  assert.deepEqual(parts.map(p => p.key), ['moc:topic#0', 'moc:topic#1']);
  assert.deepEqual(parts.flatMap(p => p.memories.map(m => m.id)), memories.map(m => m.id).sort());
  assert.equal(partitionCardClusters([{ key: 'small', memories: memories.slice(0, 12) }])[0].key, 'small');
});

for (const filed of [false, true]) test(`${filed ? 'filed' : 'similarity'} part boundary carries exact sources and debounces changed sources`, async t => {
  const f = engineCardFixture(t); let memories = f.seed(12);
  const placement = filed ? f.file(memories, 'Orion') : null;
  if (placement) memories = placement.memories;
  const topic = placement?.mocId;
  const first = ok(await f.pass()).built[0]; assert.ok(first);
  const added = f.add('Orion appended community garden milestone.', 61, 7);
  if (filed) {
    const map = ok(f.core.map({ namespace: ns }));
    ok(f.core.applyPlacement({ namespace: ns, expectedIndexRevision: map.indexRevision,
      expectedMemoryRevisions: [{ memoryId: added.id, revision: added.revision }],
      proposal: { items: [{ memoryId: added.id, parentIds: [topic] }] } }));
  }
  const moved = ok(await f.pass()); assert.equal(moved.modelCalls, 0, JSON.stringify(moved));
  const storage = createEngineCardStorage({ db: f.db, upgrade: true, ready() {},
    identity: f.db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get() });
  assert.equal(storage.cards(ns, () => {}).find(card => card.id === first.id).clusterKey, first.clusterKey + '#0');
  assert.equal(ok(await f.pass()).modelCalls, 0, 'carry keeps a stable source fingerprint despite event ordering');
  ok(f.core.forget({ namespace: ns, memoryId: memories[0].id, expectedRevision: memories[0].revision }));
  const updated = Date.parse(f.db.prepare('SELECT updated_at FROM private_cards WHERE id=?').get(first.id).updated_at);
  let clock = updated;
  const w = worker(f, () => clock);
  assert.equal((await run(w)).modelCalls, 0);
  clock += 600001;
  const rebuilt = await run(w); assert.equal(rebuilt.built.length, 1, JSON.stringify(rebuilt));
  assert.equal(rebuilt.built[0].clusterKey, first.clusterKey);
  assert.equal(rebuilt.built[0].sourceRevisions.length, 12);
  assert.ok(!f.model.calls.at(-1).memories.some(memory => memory.id === memories[0].id));
});
