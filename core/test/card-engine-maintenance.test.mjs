import test from 'node:test';
import assert from 'node:assert/strict';
import { engineCardFixture, scriptedConsolidator, ns, ok } from '../testing/engine-card-fixture.mjs';
import { cardTrigger, clusterMemories, chainLength } from '../engine-card-clusters.mjs';
import { validateConsolidation } from '../engine-card-output.mjs';
import { createEngineCardStorage } from '../engine-card-storage.mjs';
import { createEngineCardMaintenance } from '../engine-card-maintenance.mjs';
import { assembleContext } from '../context-read-assembly.mjs';
import { assembleThreeLayerContext } from '../context-read-three-layer.mjs';
import { openMemoryCore } from '../index.mjs';

test('long recurring topic builds in maintenance, read packs Card, fact read retains Memory, forget falls back', async t => {
  const f = engineCardFixture(t), memories = f.seed();
  assert.equal(f.model.calls.length, 0, 'admission does not consolidate');
  const pass = ok(await f.pass()); assert.equal(pass.state, 'ready', JSON.stringify(pass)); assert.equal(pass.built.length, 1, JSON.stringify(pass));
  assert.equal(pass.modelCalls, 1); assert.equal(f.model.calls[0].memories.length, 30);
  const card = pass.built[0]; assert.equal(card.origin, 'engine'); assert.equal(card.sourceRevisions.length, 30);
  assert.equal(ok(await f.pass()).built.length, 0, 'unchanged cluster does not spend again');
  ok(await f.refresh());
  const read = ok(await f.read('what is the current state of Orion'));
  assert.ok(read.metered.items.some(item => item.ref.type === 'card'), JSON.stringify(read));
  assert.equal(read.metered.items.some(item => item.ref.type === 'memory'), false, 'all thirty sources deduped');
  const fact = ok(await f.read('what does Orion marker17 record'));
  assert.equal(fact.metered.items[0].ref.id, memories[17].id);
  assert.equal(fact.metered.items[0].ref.type, 'memory');
  const without = ok(await f.read('what is the current state of Orion', { types: ['memory'] }));
  t.diagnostic(JSON.stringify({ withCardTokens: read.diagnostics.budget.used, withoutCardTokens: without.diagnostics.budget.used }));
  ok(f.core.forget({ namespace: ns, memoryId: memories[0].id, expectedRevision: memories[0].revision }));
  const row = f.db.prepare('SELECT * FROM private_cards WHERE id=?').get(card.id);
  assert.ok(row.revision > card.revision, 'existing revision invalidation marks it stale');
  ok(await f.refresh());
  const fallback = ok(await f.read('what is the current state of Orion'));
  assert.ok(fallback.metered.items.length); assert.ok(fallback.metered.items.every(item => item.ref.type === 'memory'));
  assert.equal(ok(await f.pass()).built.length, 0, 'rebuild is debounced');
});

test('five memories, short histories, one conversation and missing pressure do not build', async t => {
  const f = engineCardFixture(t); f.seed(5);
  assert.equal(ok(await f.pass()).built.length, 0); assert.equal(f.model.calls.length, 0);
  const memories = Array.from({ length: 8 }, (_, i) => ({ id: String(i), date: new Date(2026, 0, i + 1).toISOString(), conversations: ['a'] }));
  assert.equal(cardTrigger(memories, undefined, 100).eligible, false);
  assert.equal(cardTrigger(memories.slice(0, 4), [{ from: '0', to: '1', kind: 'supersedes', slot: 's' },
    { from: '1', to: '2', kind: 'supersedes', slot: 's' }, { from: '2', to: '3', kind: 'supersedes', slot: 's' }], 1199).eligible, false);
});

test('concurrent maintenance hosts reserve one generation through the canonical operation ledger', async t => {
  const f = engineCardFixture(t); f.seed(8);
  const other = openMemoryCore({ path: f.path, model: f.model }); f.workspace.defer(() => other.close());
  const results = await Promise.all([f.pass(), other.maintainCards({ namespace: ns, budget: { maxMs: 5000 } })]);
  const passes = results.map(ok);
  assert.equal(passes.reduce((sum, pass) => sum + pass.built.length, 0), 1, JSON.stringify(passes));
  assert.equal(f.model.calls.length, 1); assert.equal(passes.reduce((sum, pass) => sum + pass.debounced, 0), 1);
});

test('writable existing-store pins reuse installed Cards without a schema upgrade', async t => {
  const f = engineCardFixture(t, { raw: true, rawSearch: false }); f.seed(8);
  const physical = f.db.prepare('PRAGMA user_version').get().user_version;
  assert.ok([29, 30, 31, 32, 33].includes(physical));
  const storeId = f.db.prepare('SELECT store_id FROM store_metadata').get().store_id;
  const core = openMemoryCore({ path: f.path, model: f.model,
    existingStore: { version: `schema${physical}-existing-v1`, storeId } });
  f.workspace.defer(() => core.close());
  assert.equal(ok(core.getEngineCardStatus({ namespace: ns })).state, 'ready');
  const pass = ok(await core.maintainCards({ namespace: ns, budget: { maxMs: 5000 } }));
  assert.equal(pass.built.length, 1, JSON.stringify(pass));
  assert.equal(f.db.prepare('PRAGMA user_version').get().user_version, physical);
});

for (const present of [true, false]) test(`slot changed four times: relations port ${present ? 'present' : 'absent'}`, async t => {
  let edges;
  const f = engineCardFixture(t, present ? { cardRelations: { read() { return edges; } } } : {});
  const memories = Array.from({ length: 5 }, (_, i) => f.add('Orion slot value ' + i, 0, 0));
  edges = memories.slice(1).map((memory, i) => ({ from: memory.id, to: memories[i].id, kind: 'supersedes', slot: 'orion-status' }));
  const pass = ok(await f.pass()); assert.equal(pass.built.length, present ? 1 : 0, JSON.stringify(pass));
  assert.equal(f.model.calls.length, present ? 1 : 0);
});

test('four-Memory chain requires actual packed token pressure when it has fewer than five items', async t => {
  for (const verbose of [false, true]) {
    let edges;
    const model = scriptedConsolidator(({ input }) => ({ currentState: [{ text: 'Orion slot value is 3.',
      memoryIds: [input.memories.find(memory => memory.content.startsWith('Orion slot value 3')).id] }], timeline: [], contradictions: [] }));
    const f = engineCardFixture(t, { model, cardRelations: { read: () => edges } });
    const memories = Array.from({ length: 4 }, (_, i) => f.add(`Orion slot value ${i}${verbose ? ': ' + 'documented '.repeat(300) : '.'}`));
    edges = memories.slice(1).map((memory, i) => ({ from: memory.id, to: memories[i].id, kind: 'supersedes', slot: 'orion-status' }));
    const pass = ok(await f.pass());
    assert.equal(pass.built.length, verbose ? 1 : 0, JSON.stringify(pass));
    assert.equal(model.calls.length, verbose ? 1 : 0);
  }
});

test('MOC L1 separates topics, vector seed threshold and BM25 fallback are deterministic', () => {
  const memory = (id, content, topics = []) => ({ id, content, topics });
  const filed = clusterMemories([memory('a', 'shared text', ['one']), memory('b', 'shared text', ['two'])]);
  assert.equal(filed.length, 2);
  const rows = [memory('a', 'apple'), memory('b', 'apple'), memory('c', 'zebra')];
  assert.equal(clusterMemories(rows).length, 2);
  assert.equal(clusterMemories(rows, new Map([['a', [1, 0]], ['b', [0, 1]], ['c', [1, 0]]])).length, 2);
  assert.deepEqual(clusterMemories(rows, new Map([['a', [1, 0]], ['b', [0, 1]], ['c', [1, 0]]]))[0].memories.map(m => m.id), ['a', 'c']);
  assert.equal(chainLength(rows, [{ from: 'a', to: 'b', kind: 'supersedes', slot: 'x' },
    { from: 'b', to: 'c', kind: 'supersedes', slot: 'y' }]), 1, 'different slots do not form a chain');
});

test('output drops uncited sentences, refuses foreign citations and excess tokens, preserves unresolved contradictions', () => {
  const model = scriptedConsolidator(), memories = [{ id: 'a', date: '2026-01-01' }, { id: 'b', date: '2026-02-01' }];
  const output = { currentState: [{ text: 'Supported.', memoryIds: ['b'] }, { text: 'Invented.', memoryIds: [] }],
    timeline: [{ text: 'Older value.', date: '2026-01-01', memoryIds: ['a'] }],
    contradictions: [{ text: 'Values still conflict.', memoryIds: ['a', 'b'] }] };
  const value = validateConsolidation(output, memories, model);
  assert.doesNotMatch(value.body, /Invented/); assert.match(value.body, /Open contradictions/); assert.match(value.body, /2026-01-01/);
  assert.throws(() => validateConsolidation({ ...output, currentState: [{ text: 'Foreign.', memoryIds: ['foreign'] }] }, memories, model));
  assert.equal(validateConsolidation({ currentState: [{ text: 'No support.', memoryIds: [] }], timeline: [], contradictions: [] }, memories, model), null);
  assert.throws(() => validateConsolidation({ ...output, currentState: [{ text: 'length '.repeat(260), memoryIds: ['a'] }] }, memories, model));
});

test('keyless status, worker limits, provider refusal and source races never store a Card', async t => {
  const keyless = engineCardFixture(t, { model: null });
  assert.equal(ok(keyless.core.getEngineCardStatus({ namespace: ns })).state, 'model_not_configured');
  const denied = engineCardFixture(t, { model: scriptedConsolidator(() => { throw Error('quota refusal'); }) }); denied.seed();
  const result = ok(await denied.pass()); assert.equal(result.state, 'refused'); assert.equal(result.modelCalls, 1);
  const incomplete = ok(await denied.pass({ maxItems: 10 })); assert.equal(incomplete.state, 'work_limit');
  let f;
  f = engineCardFixture(t, { model: scriptedConsolidator(request => {
    const memory = request.input.memories[0]; ok(f.core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
    return { currentState: [{ text: 'Stale.', memoryIds: [memory.id] }], timeline: [], contradictions: [] };
  }) }); f.seed();
  assert.equal(ok(await f.pass()).built.length, 0);
});

test('stale rebuild waits ten minutes, creates a fresh row; lost trigger deletes the stale Card', async t => {
  const f = engineCardFixture(t); const memories = f.seed();
  const first = ok(await f.pass()).built[0];
  ok(f.core.forget({ namespace: ns, memoryId: memories[0].id, expectedRevision: memories[0].revision }));
  const storage = createEngineCardStorage({ db: f.db, identity: f.db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get(), ready() {} });
  const updated = Date.parse(f.db.prepare('SELECT updated_at FROM private_cards WHERE id=?').get(first.id).updated_at);
  const worker = createEngineCardMaintenance({ storage, model: f.model, now: () => updated + 600001 });
  const rebuilt = await worker.maintain({ namespace: ns, budget: { maxMs: 5000 } });
  assert.equal(rebuilt.built.length, 1, JSON.stringify(rebuilt)); assert.notEqual(rebuilt.built[0].id, first.id);
  assert.equal(f.db.prepare('SELECT count(*) n FROM private_cards').get().n, 2);
  for (const memory of memories.slice(1, 25)) ok(f.core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
  const cleanup = createEngineCardMaintenance({ storage, model: f.model, now: () => updated + 1200002 });
  assert.ok((await cleanup.maintain({ namespace: ns, budget: { maxMs: 5000 } })).deleted >= 1);
});

test('bounded maintenance resumes a complete namespace scan without publishing a partial cluster', async t => {
  const f = engineCardFixture(t); f.seed();
  assert.equal(ok(await f.pass({ maxItems: 10 })).state, 'work_limit');
  assert.equal(ok(await f.pass({ maxItems: 10 })).state, 'work_limit'); assert.equal(f.model.calls.length, 0);
  const completed = ok(await f.pass({ maxItems: 10 })); assert.equal(completed.built.length, 1, JSON.stringify(completed));
  assert.equal(completed.built[0].sourceRevisions.length, 30);
});

test('filed topics share one namespace but keep exact independent source sets', async t => {
  const f = engineCardFixture(t), large = f.file(f.seed(), 'Orion'), small = f.file(f.seed(5, 'Vega'), 'Vega');
  const pass = ok(await f.pass()); assert.equal(pass.built.length, 1, JSON.stringify(pass));
  assert.equal(pass.built[0].clusterKey, 'moc:' + large.mocId);
  assert.equal(f.model.calls[0].memories.length, 30);
  assert.ok(f.model.calls[0].memories.every(memory => !small.memories.some(source => source.id === memory.id)));
  assert.equal(ok(await f.pass()).built.length, 0);
});

test('model deadline is a budget result and does not permanently refuse the next pass', async t => {
  let waiting = true;
  const f = engineCardFixture(t, { cardRelations: { read: () => waiting ? new Promise(() => {}) : [] } }); f.seed(8);
  const expired = ok(await f.pass({ maxMs: 250 })); assert.equal(expired.state, 'deadline'); assert.equal(expired.reason, 'deadline');
  waiting = false;
  const recovered = ok(await f.pass()); assert.equal(recovered.built.length, 1, JSON.stringify(recovered));
  const raw = engineCardFixture(t); raw.seed(8);
  const canonical = createEngineCardStorage({ db: raw.db,
    identity: raw.db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get(), ready() {} });
  let rawWaiting = true;
  const worker = createEngineCardMaintenance({ model: raw.model, storage: { ...canonical,
    rawSpans: () => rawWaiting ? new Promise(() => {}) : [] } });
  const rawExpired = await worker.maintain({ namespace: ns, budget: { maxMs: 250 } });
  assert.equal(rawExpired.state, 'deadline'); assert.equal(rawExpired.reason, 'deadline');
  assert.equal(raw.model.calls.length, 0);
  rawWaiting = false;
  const rawRecovered = await worker.maintain({ namespace: ns, budget: { maxMs: 5000 } });
  assert.equal(rawRecovered.built.length, 1, JSON.stringify(rawRecovered));
});

test('both packers dedupe source revisions only after a Card fits, including Memory coalesced with Raw', () => {
  const model = scriptedConsolidator(), text = 'Orion raw evidence.', value = { namespace: ns,
    conversationId: 'synthetic-conversation', messageId: 'synthetic-turn', role: 'user', occurredAt: null,
    ranges: [{ source: { span: { start: 0, end: text.length } }, text }] };
  const turn = JSON.stringify([JSON.stringify([ns.ownerId, ns.scope, ns.projectId]), value.conversationId, value.messageId]);
  const memory = { type: 'memory', ref: { type: 'memory', namespace: ns, memoryId: 'source', revision: 2 },
    ns: 0, rank: 2, text: 'Orion source milestone.', fence: 'synthetic-fence', sources: [], sourceAccess: 'available',
    sourcesComplete: true, turnIds: [turn], sessionIds: [],
    metadata: { state: 'active', reviewState: 'none', filing: { status: 'unfiled' }, kind: 'fact', origin: 'explicit', confidence: 1 } };
  const card = { ...memory, type: 'card', rank: 1, text: 'Orion current state is ready.', turnIds: [],
    ref: { type: 'card', namespace: ns, cardId: 'engine-card.synthetic', revision: 1, bodyRevision: 1 },
    sourceMemoryRefs: [{ ...memory.ref, namespace: { projectId: ns.projectId, scope: ns.scope, ownerId: ns.ownerId } }],
    metadata: { state: 'confirmed', origin: 'engine', support: { status: 'eligible', applicability: 'current' },
      builtAt: '2026-05-01T00:00:00.000Z', clusterKey: 'synthetic-topic', status: 'current' } };
  const raw = { items: [{ key: turn, rank: 1, value, handle: {} }], coverage: 'included',
    rawSearch: { revalidate: handles => handles.map(() => value) } };
  for (const assemble of [args => assembleContext(args), args => assembleThreeLayerContext(args, raw)]) {
    const args = { prepared: [card, memory], counter: model, query: 'Orion current state', readSet: [ns],
      policy: { id: 'rank-first-whole-v1' }, budget: { maxItems: 12, maxTokens: 3000 },
      representation: 'representation-v2-dated', deadlineAt: Infinity, snapshotOf: () => null };
    const packed = assemble(args);
    assert.ok(packed.metered.items.some(item => item.ref?.type === 'card'));
    assert.equal(packed.metered.items.some(item => item.ref?.type === 'memory'), false);
    const rejected = assemble({ ...args, prepared: [{ ...card, text: 'oversized '.repeat(4000) }, memory],
      budget: { maxItems: 12, maxTokens: 800 } });
    assert.ok(rejected.metered.items.some(item => item.ref?.type === 'memory'));
    assert.equal(rejected.metered.items.some(item => item.ref?.type === 'card'), false);
  }
});
