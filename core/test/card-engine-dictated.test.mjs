import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { engineCardFixture, scriptedConsolidator, ns, ok } from '../testing/engine-card-fixture.mjs';
import { cardTrigger } from '../engine-card-clusters.mjs';
import { createEngineCardStorage } from '../engine-card-storage.mjs';
import { createEngineCardMaintenance } from '../engine-card-maintenance.mjs';
import { validateConsolidation } from '../engine-card-output.mjs';
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

test('dictated trigger counts distinct Memories per conversation and preserves recurrence, chain and pressure', () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({ id: String(i), date: '2026-01-01', currentness: 'current', conversations: ['shared'] }));
  assert.deepEqual(cardTrigger(rows.slice(0, 4), undefined, 0),
    { eligible: false, recurring: false, dictated: false, chain: null, pressure: false, memories: 4, conversations: 1, tokens: 0 });
  assert.deepEqual(cardTrigger(rows.slice(0, 5), undefined, 0),
    { eligible: true, recurring: false, dictated: true, chain: null, pressure: true, memories: 5, conversations: 1, tokens: 0 });
  const spread = rows.map((row, i) => ({ ...row, conversations: ['separate-' + i] }));
  assert.equal(cardTrigger(spread.slice(0, 5), undefined, 0).eligible, false);
  assert.equal(cardTrigger(rows.map(row => ({ ...row, currentness: 'historical' })), [], 0).dictated, false);
  assert.equal(cardTrigger(rows.slice(0, 4).map(row => ({ ...row, conversations: ['shared', 'shared'] })), [], 1200).dictated, false);
  const recurring = spread.map((row, i) => ({ ...row, date: new Date(Date.UTC(2026, 0, 1 + i * 2)).toISOString() }));
  assert.deepEqual(cardTrigger(recurring, [], 0),
    { eligible: true, recurring: true, dictated: false, chain: 0, pressure: true, memories: 8, conversations: 8, tokens: 0 });
  const edges = rows.slice(1, 4).map((row, i) => ({ from: row.id, to: rows[i].id, kind: 'supersedes', slot: 'status' }));
  assert.deepEqual(cardTrigger(spread.slice(0, 4), edges, 1200),
    { eligible: true, recurring: false, dictated: false, chain: 3, pressure: true, memories: 4, conversations: 4, tokens: 1200 });
  assert.equal(cardTrigger(spread.slice(0, 4), edges, 1199).eligible, false);
});

test('dictation builds immediately from the whole topic, then rebuilds ten minutes after staling and after forget', async t => {
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
  assert.match(ok(f.core.getEngineCardStatus({ namespace: ns })).trigger, /five.*one conversation/);
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

test('six same-conversation facts consolidate together; owner and namespace sources never join', async t => {
  const f = engineCardFixture(t, { model: completeModel() });
  const memories = Array.from({ length: 6 }, (_, i) => f.add(`Orion task ${i} ready.`, 0, 0));
  const filed = f.file(memories, 'Orion workshop');
  for (const namespace of [{ ...ns, ownerId: 'synthetic-other-owner' }, { ...ns, projectId: 'synthetic-other-project' }])
    for (let i = 0; i < 5; i++) f.add(`Orion private workshop task ${i} ready.`, 0, 0, namespace);
  const pass = ok(await f.pass()); assert.equal(pass.built.length, 1, JSON.stringify(pass));
  assert.equal(pass.built[0].clusterKey, 'moc:' + filed.mocId);
  const status = ok(f.core.getEngineCardStatus({ namespace: ns }));
  assert.match(status.trigger, /five.*one conversation/); assert.equal(status.lastPass.built, 1);
  assert.deepEqual(new Set(f.model.calls[0].memories.map(memory => memory.id)), new Set(memories.map(memory => memory.id)));
  const body = f.db.prepare('SELECT body FROM private_cards WHERE id=?').get(pass.built[0].id).body;
  for (const memory of memories) assert.ok(body.includes(`[${memory.id}]`));
});

test('without consolidation configured dictation does no work or control reads', async t => {
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

test('host read retains facts omitted by a dictated body that fits the token limit', async t => {
  const model = scriptedConsolidator(({ input }) => {
    const currentState = [];
    for (const entry of output(input.memories).currentState) {
      const trial = { currentState: [...currentState, entry], timeline: [], contradictions: [] };
      try { validateConsolidation(trial, input.memories, model); }
      catch { break; }
      currentState.push(entry);
    }
    return { currentState, timeline: [], contradictions: [] };
  });
  const f = engineCardFixture(t, { model });
  const memories = Array.from({ length: 12 }, (_, i) => f.add(facts[i % facts.length].replace('Orion', 'Orion group ' + i), 0, 0));
  const pass = ok(await f.pass()); assert.equal(pass.built.length, 1, JSON.stringify(pass));
  const body = f.db.prepare('SELECT body FROM private_cards WHERE id=?').get(pass.built[0].id).body;
  assert.ok(model.countTokens(body) <= 250);
  const omitted = memories.filter(memory => !body.includes(memory.id)); assert.ok(omitted.length);
  ok(await f.refresh());
  const read = ok(await f.read('what is the current state of Orion', { budget: { maxItems: 24, maxTokens: 6000 } }));
  assert.ok(read.metered.items.some(item => item.ref.type === 'card'), JSON.stringify(read));
  for (const memory of omitted) assert.ok(read.metered.items.some(item => item.ref.type === 'memory' && item.ref.id === memory.id), memory.id);
});

test('body capacity uses deterministic ordinary facts, real-length UUID citations and the engine tokenizer', async t => {
  const model = completeModel();
  for (const count of [5, 8, 12, 20]) {
    const memories = Array.from({ length: count }, (_, i) => {
      const hex = createHash('sha256').update('synthetic-fact-' + i).digest('hex');
      return { id: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`,
        content: facts[i % facts.length].replace('Orion', 'Orion group ' + i) };
    });
    const sentences = (await model.consolidate({ input: { memories } })).currentState;
    const render = entries => entries.map(entry => `${entry.text} [${entry.memoryIds.join(',')}]`).join(' ');
    const allTokens = model.countTokens(render(sentences));
    let carried = 0;
    // Prefix packing is the fake model's explicit policy, not engine truncation.
    while (carried < count && model.countTokens(render(sentences.slice(0, carried + 1))) <= 250) carried++;
    const fitted = { currentState: sentences.slice(0, carried), timeline: [], contradictions: [] };
    const value = validateConsolidation(fitted, memories, model);
    assert.ok(value); assert.ok(model.countTokens(value.body) <= 250);
    assert.ok(memories.every(memory => memory.content.split(/\s+/u).length >= 10 && memory.content.split(/\s+/u).length <= 25));
    if (count >= 12) assert.ok(carried < count);
    t.diagnostic(JSON.stringify({ items: count, allTokens, carried, bodyTokens: model.countTokens(value.body) }));
  }
});
