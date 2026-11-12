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
import { DatabaseSync } from 'node:sqlite';
import { installPrivateCards, installCardMemorySources } from '../private-card-schema.mjs';
import { installPrivateEvidence } from '../private-evidence-schema.mjs';
import { installPrivateOrganization } from '../private-organization-schema.mjs';
import { lineageFixture, receipt } from '../testing/card-lineage-fixture.mjs';
import { withContentWriteOperation } from '../content-write-context.mjs';

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
  assert.equal(f.db.prepare('PRAGMA user_version').get().user_version, 18);
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
  assert.equal(Object.hasOwn(keyless.core, 'getEngineCardStatus'), false);
  assert.equal(Object.hasOwn(keyless.core, 'maintainCards'), false);
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
    identity: raw.db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get(), ready() {}, upgrade: true });
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


test('ordinary opening and admission keep the original layout until engine maintenance is invoked', async t => {
  const f = engineCardFixture(t);
  assert.equal(f.db.prepare('PRAGMA user_version').get().user_version, 18);
  assert.equal(f.db.prepare("SELECT name FROM sqlite_schema WHERE name='private_cards'").get(), undefined);
  f.seed(8);
  assert.equal(f.db.prepare('PRAGMA user_version').get().user_version, 18);
  assert.equal(ok(await f.pass()).built.length, 1);
  assert.equal(f.db.prepare('PRAGMA user_version').get().user_version, 23);
  ok(await f.refresh());
  assert.ok(ok(await f.read('Orion current state')).metered.items.some(item => item.ref.type === 'card'));
});

test('authored Cards retain their place beside higher-ranked source Memories in both packers', () => {
  const namespace = ns, ref = { type: 'memory', namespace, memoryId: 'synthetic-memory', revision: 1 };
  const memory = { type: 'memory', ref, ns: 0, rank: 1, text: 'Synthetic source',
    metadata: { state: 'active', reviewState: 'not-required', filing: { status: 'unfiled' }, kind: 'fact', origin: 'explicit', confidence: 1 },
    sources: [], sourceAccess: 'available', sourcesComplete: true, fence: 'synthetic-memory-fence', date: null };
  const card = { ...memory, type: 'card', rank: 2, text: 'Synthetic authored Card',
    ref: { type: 'card', namespace, cardId: 'synthetic-card', revision: 1, bodyRevision: 1 },
    metadata: { state: 'confirmed', origin: 'authored', support: { status: 'eligible', applicability: 'current', reasons: [] } },
    sourceMemoryRefs: [ref], fence: 'synthetic-card-fence' };
  const args = { prepared: [memory, card], counter: { id: 'synthetic', countTokens: text => text.length },
    policy: { id: 'rank-first-whole-v1' }, budget: { maxItems: 12, maxTokens: 100000 },
    snapshotOf: () => null, deadlineAt: Infinity, query: 'Synthetic', readSet: [ns], representation: 'representation-v2-dated' };
  const text = 'Synthetic Raw source', value = { namespace: ns, conversationId: 'synthetic-conversation',
    messageId: 'synthetic-message', role: 'user', occurredAt: null,
    ranges: [{ source: { span: { start: 0, end: text.length } }, text }] };
  const raw = { items: [{ key: 'synthetic-turn', rank: 1, value, handle: {} }], coverage: 'included',
    rawSearch: { revalidate: handles => handles.map(() => value) } };
  for (const result of [assembleContext(args), assembleThreeLayerContext(args, raw)])
    assert.deepEqual(result.metered.items.filter(item => item.ref?.type === 'card' || item.ref?.type === 'memory')
      .map(item => item.ref.id), ['synthetic-memory', 'synthetic-card']);
});


for (const mode of ['refusal', 'invalid', 'empty', 'timeout', 'network', 'fetch-network', 'rate-limit', 'deadline'])
  test(`unchanged ${mode} is bounded across cooldowns and restarts; source changes re-enable dispatch`, async t => {
    const transient = ['timeout', 'network', 'fetch-network', 'rate-limit', 'deadline'].includes(mode);
    const codes = { timeout: 'model_timeout', network: 'ECONNRESET', 'rate-limit': 'rate_limit_exceeded', deadline: 'deadline' };
    const model = scriptedConsolidator(() => {
      if (mode === 'fetch-network') throw new TypeError('Synthetic fetch transport failure');
      if (mode === 'invalid') return { foreign: true };
      if (mode === 'empty') return { currentState: [], timeline: [], contradictions: [] };
      throw Object.assign(Error('Synthetic provider failure'), { code: codes[mode] });
    });
    const f = engineCardFixture(t, { model }); f.seed(8);
    let clock = Date.UTC(2026, 5, 1), expected = 0;
    // Each pass reopens the database and recreates both storage and worker.
    const pass = async () => {
      const db = new DatabaseSync(f.path); db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
      try {
        const storage = createEngineCardStorage({ db, upgrade: true, ready() {},
          identity: db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get() });
        return await createEngineCardMaintenance({ storage, model, now: () => clock })
          .maintain({ namespace: ns, budget: { maxMs: 5000 } });
      } finally { db.close(); }
    };
    await pass(); assert.equal(model.calls.length, ++expected);
    clock += 600001; await pass();
    if (transient) expected++;
    assert.equal(model.calls.length, expected);
    // Growing backoff: ten more minutes is too early for attempt three.
    clock += 600001; await pass(); assert.equal(model.calls.length, expected);
    clock += 600001; await pass();
    if (transient) expected++;
    assert.equal(model.calls.length, expected);
    for (let i = 0; i < 5; i++) { clock += 3600000; await pass(); }
    assert.equal(model.calls.length, transient ? 3 : 1);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM private_cards').get().n, 0);
    f.add('Orion additional milestone: synthetic changed source evidence.', 61, 7);
    await pass(); assert.equal(model.calls.length, ++expected, 'new fingerprint dispatches immediately');
    await pass(); assert.equal(model.calls.length, expected, 'new fingerprint is also bounded');
    const outcomes = f.db.prepare("SELECT result FROM card_operations WHERE method='consolidateOutcome'").all();
    assert.equal(outcomes.length, expected);
    assert.ok(outcomes.every(row => JSON.parse(row.result).outcome === (transient ? 'transient' : 'terminal')));
  });

test('schema22 maintenance skips without writing a Card or changing the layout', async t => {
  const f = engineCardFixture(t); f.seed(8);
  installPrivateCards(f.db); installCardMemorySources(f.db); installPrivateEvidence(f.db);
  f.db.exec('PRAGMA user_version=22');
  assert.ok(f.db.prepare("SELECT name FROM sqlite_schema WHERE name='card_applicability_reviews'").get());
  const before = f.db.prepare('SELECT type,name,sql FROM sqlite_schema ORDER BY type,name').all();
  const pass = ok(await f.pass());
  assert.equal(pass.state, 'unsupported_store'); assert.equal(pass.modelCalls, 0);
  assert.equal(f.db.prepare('PRAGMA user_version').get().user_version, 22);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM private_cards').get().n, 0);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM card_operations').get().n, 0);
  assert.deepEqual(f.db.prepare('SELECT type,name,sql FROM sqlite_schema ORDER BY type,name').all(), before);
});


test('a revision-only source change re-enables a refused fingerprint and unfinished claims remain bounded', async t => {
  const f = engineCardFixture(t, { model: scriptedConsolidator(() => { throw Error('Synthetic refusal'); }) });
  f.seed(8);
  const storage = createEngineCardStorage({ db: f.db, upgrade: true, ready() {},
    identity: f.db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get() });
  let clock = Date.UTC(2026, 5, 1);
  const pass = () => createEngineCardMaintenance({ storage, model: f.model, now: () => clock })
    .maintain({ namespace: ns, budget: { maxMs: 5000 } });
  await pass(); assert.equal(f.model.calls.length, 1);
  // Identical source IDs and text, changed canonical revision only.
  f.db.exec('UPDATE memories SET revision=revision+1');
  await pass(); assert.equal(f.model.calls.length, 2);
  for (let i = 0; i < 4; i++) { clock += 3600000; await pass(); }
  assert.equal(f.model.calls.length, 2);
  // Simulate restart after reservation but before provider outcome persistence.
  f.add('Orion another synthetic source milestone.', 62, 8);
  const crashStorage = { ...storage, finish() { throw Error('Synthetic process interruption'); } };
  for (let i = 0; i < 6; i++) {
    clock += 3600000;
    await createEngineCardMaintenance({ storage: crashStorage, model: f.model, now: () => clock })
      .maintain({ namespace: ns, budget: { maxMs: 5000 } });
  }
  assert.equal(f.model.calls.length, 5, 'unfinished reservations exhaust three attempts');
});

test('an expired model deadline persists a transient outcome and can recover after restart', async t => {
  let stalled = true;
  const model = scriptedConsolidator(({ input }) => stalled ? new Promise(() => {}) :
    { currentState: [{ text: 'Orion recovered.', memoryIds: [input.memories[0].id] }], timeline: [], contradictions: [] });
  const f = engineCardFixture(t, { model }); f.seed(8);
  installPrivateCards(f.db); installCardMemorySources(f.db); installPrivateEvidence(f.db);
  installPrivateOrganization(f.db); f.db.exec('PRAGMA user_version=23');
  const storage = createEngineCardStorage({ db: f.db, upgrade: true, ready() {},
    identity: f.db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get() });
  let clock = Date.UTC(2026, 5, 1);
  const pass = maxMs => createEngineCardMaintenance({ storage, model, now: () => clock })
    .maintain({ namespace: ns, budget: { maxMs } });
  const expired = await pass(1000);
  assert.equal(expired.state, 'deadline'); assert.equal(expired.reason, 'deadline');
  assert.equal(model.calls.length, 1);
  assert.equal(JSON.parse(f.db.prepare("SELECT result FROM card_operations WHERE method='consolidateOutcome'").get().result).outcome, 'transient');
  stalled = false; clock += 600001;
  assert.equal((await pass(5000)).built.length, 1); assert.equal(model.calls.length, 2);
  clock += 3600000; await pass(5000); assert.equal(model.calls.length, 2);
});

test('changing a cluster label cannot reset an unchanged source fingerprint', async t => {
  const f = engineCardFixture(t, { model: scriptedConsolidator(() => { throw Error('Synthetic refusal'); }) }); f.seed(8);
  const canonical = createEngineCardStorage({ db: f.db, upgrade: true, ready() {},
    identity: f.db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get() });
  let label = 'synthetic-topic-a', clock = Date.UTC(2026, 5, 1);
  const storage = { ...canonical, snapshot(...args) {
    const page = canonical.snapshot(...args);
    return { ...page, memories: page.memories.map(memory => ({ ...memory, topics: [label] })) };
  } };
  const pass = () => createEngineCardMaintenance({ storage, model: f.model, now: () => clock })
    .maintain({ namespace: ns, budget: { maxMs: 5000 } });
  await pass(); assert.equal(f.model.calls.length, 1);
  label = 'synthetic-topic-b'; clock += 3600000;
  await pass(); assert.equal(f.model.calls.length, 1);
});

for (const change of ['relabel', 'move']) test(`a built Card survives a topic ${change} without another model request`, async t => {
  const f = engineCardFixture(t), seeded = f.seed(8);
  const filed = change === 'move' ? f.file(seeded, 'Orion') : null;
  const canonical = createEngineCardStorage({ db: f.db, upgrade: true, ready() {},
    identity: f.db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get() });
  let topic = filed?.mocId ?? 'synthetic-topic-a', clock = Date.UTC(2026, 5, 1);
  const storage = { ...canonical, snapshot(...args) {
    const page = canonical.snapshot(...args);
    return filed ? page : { ...page, memories: page.memories.map(memory => ({ ...memory, topics: [topic] })) };
  } };
  // Recreate the worker each time to exercise persisted identity across restarts.
  const pass = () => createEngineCardMaintenance({ storage, model: f.model, now: () => clock })
    .maintain({ namespace: ns, budget: { maxMs: 5000 } });
  const first = (await pass()).built[0]; assert.ok(first);
  const before = f.db.prepare('SELECT * FROM private_cards WHERE id=?').get(first.id);
  const bindings = f.db.prepare('SELECT * FROM card_memory_bindings WHERE card_id=? ORDER BY memory_id').all(first.id);
  const revisions = f.db.prepare('SELECT id,revision FROM memories ORDER BY id').all();
  topic = 'synthetic-topic-b';
  if (filed) {
    f.db.prepare(`INSERT INTO mocs SELECT ?,owner_id,scope,project_id,level,?,?,1,created_at,updated_at
      FROM mocs WHERE id=?`).run(topic, 'Synthetic destination', 'synthetic destination', filed.mocId);
    f.db.prepare('UPDATE moc_memory_refs SET moc_id=?,moc_revision=1 WHERE moc_id=?').run(topic, filed.mocId);
  }
  assert.deepEqual(f.db.prepare('SELECT id,revision FROM memories ORDER BY id').all(), revisions);
  clock += 3600000;
  const moved = await pass(); assert.equal(moved.state, 'ready', JSON.stringify(moved));
  const cards = canonical.cards(ns);
  assert.equal(cards.length, 1, 'the Card remains available after its old cluster key disappears');
  assert.equal(cards[0].status, 'current'); assert.equal(cards[0].clusterKey, 'moc:' + topic);
  assert.equal(cards[0].id, first.id); assert.deepEqual(cards[0].sourceRevisions, first.sourceRevisions);
  assert.deepEqual(f.db.prepare('SELECT * FROM private_cards WHERE id=?').get(first.id), before);
  assert.deepEqual(f.db.prepare('SELECT * FROM card_memory_bindings WHERE card_id=? ORDER BY memory_id').all(first.id), bindings);
  assert.equal(moved.deleted, 0); assert.equal(moved.modelCalls, 0); assert.equal(moved.built.length, 0);
  await pass();
  assert.equal(f.model.calls.length, 1); assert.equal(canonical.cards(ns).length, 1);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM private_cards').get().n, 1);
  // This worker upgraded the layout outside the public maintenance facade.
  // Open a reader against that installed layout before checking product reads.
  const reader = openMemoryCore({ path: f.path, contextRead: { version: 'context-read-v1', authority: f.trusted.authority,
    counter: { id: 'synthetic', countTokens: f.model.countTokens } } });
  f.workspace.defer(() => reader.close());
  ok(await f.trusted.call(reader, 'refreshContextIndex', { readSet: [ns], types: ['memory', 'card'], intent: 'current',
    budget: { maxItems: 1024, maxMs: 5000 } }));
  const read = ok(await f.trusted.call(reader, 'contextRead', { readSet: [ns], types: ['memory', 'card'], intent: 'current',
    query: 'Orion current state', semantic: false, deadlineMs: 5000, budget: { maxItems: 12, maxTokens: 3000 } }));
  assert.ok(read.metered.items.some(item => item.ref.type === 'card' && item.ref.id === first.id));
});

test('forgetting changes the source fingerprint and rebuilds the remaining topic after a relabel', async t => {
  const f = engineCardFixture(t), memories = f.seed(9);
  const canonical = createEngineCardStorage({ db: f.db, upgrade: true, ready() {},
    identity: f.db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get() });
  let topic = 'synthetic-topic-a', clock = Date.UTC(2026, 5, 1);
  const storage = { ...canonical, snapshot(...args) {
    const page = canonical.snapshot(...args);
    return { ...page, memories: page.memories.map(memory => ({ ...memory, topics: [topic] })) };
  } };
  const pass = () => createEngineCardMaintenance({ storage, model: f.model, now: () => clock })
    .maintain({ namespace: ns, budget: { maxMs: 5000 } });
  const first = (await pass()).built[0]; assert.ok(first);
  ok(f.core.forget({ namespace: ns, memoryId: memories[0].id, expectedRevision: memories[0].revision }));
  topic = 'synthetic-topic-b';
  clock = Date.parse(f.db.prepare('SELECT updated_at FROM private_cards WHERE id=?').get(first.id).updated_at) + 3600000;
  const rebuilt = await pass(); assert.equal(rebuilt.state, 'ready', JSON.stringify(rebuilt));
  const cards = canonical.cards(ns);
  assert.equal(cards.length, 1); assert.equal(cards[0].status, 'current');
  assert.equal(cards[0].clusterKey, 'moc:' + topic); assert.notEqual(cards[0].id, first.id);
  assert.equal(cards[0].sourceRevisions.length, 8);
  assert.equal(cards[0].sourceRevisions.some(ref => ref.memoryId === memories[0].id), false);
  assert.equal(f.db.prepare('SELECT state FROM private_cards WHERE id=?').get(first.id).state, 'deleted');
  assert.equal(f.model.calls.length, 2);
  await pass(); assert.equal(f.model.calls.length, 2);
});

test('carrying a sealed Card preserves its body lineage and original successful outcome', async t => {
  const model = scriptedConsolidator(), f = await lineageFixture(t, { options: { model } });
  for (let i = 0; i < 8; i++) {
    const memory = ok(f.core.admit({ namespace: ns, memory: { content: 'Orion sealed milestone ' + i, kind: 'fact' },
      receipts: [{ ...receipt('synthetic-milestone-' + i), sessionId: 'synthetic-conversation-' + i % 3 }] })).memory;
    f.db.prepare('UPDATE memories SET created_at=? WHERE id=?')
      .run(new Date(Date.UTC(2026, 0, 1 + i * 3)).toISOString(), memory.id);
  }
  const canonical = createEngineCardStorage({ db: f.db, identity: f.identity, ready() {} });
  let topic = 'synthetic-topic-a', clock = Date.UTC(2026, 5, 1);
  const storage = { ...canonical, snapshot(...args) {
    const page = canonical.snapshot(...args);
    return { ...page, memories: page.memories.map(memory => ({ ...memory, topics: [topic] })) };
  } };
  const pass = () => withContentWriteOperation('maintainCards', [ns], () =>
    createEngineCardMaintenance({ storage, model, now: () => clock })
      .maintain({ namespace: ns, budget: { maxMs: 5000 } }));
  const first = (await pass()).built[0]; assert.ok(first);
  const body = f.row(first.id);
  const headers = f.db.prepare('SELECT * FROM card_body_provenance WHERE card_id=? ORDER BY provenance_revision').all(first.id);
  const sources = f.db.prepare('SELECT * FROM card_body_sources WHERE card_id=? ORDER BY source_kind,source_key,source_version').all(first.id);
  const outcomes = f.db.prepare("SELECT * FROM card_operations WHERE method='consolidateOutcome' ORDER BY action_id").all();
  assert.equal(headers[0].completeness, 'complete'); assert.ok(sources.length);
  topic = 'synthetic-topic-b'; clock += 3600000;
  const carried = await pass(); assert.equal(carried.state, 'ready', JSON.stringify(carried));
  const cards = canonical.cards(ns); assert.equal(cards.length, 1);
  assert.equal(cards[0].id, first.id); assert.equal(cards[0].status, 'current');
  assert.equal(cards[0].clusterKey, 'moc:' + topic); assert.deepEqual(cards[0].sourceRevisions, first.sourceRevisions);
  assert.deepEqual(f.row(first.id), body);
  assert.deepEqual(f.db.prepare('SELECT * FROM card_body_provenance WHERE card_id=? ORDER BY provenance_revision').all(first.id), headers);
  assert.deepEqual(f.db.prepare('SELECT * FROM card_body_sources WHERE card_id=? ORDER BY source_kind,source_key,source_version').all(first.id), sources);
  assert.deepEqual(f.db.prepare("SELECT * FROM card_operations WHERE method='consolidateOutcome' ORDER BY action_id").all(), outcomes);
  assert.ok(ok(f.call('getCard', { cardId: first.id })).card);
  assert.equal(model.calls.length, 1);
});

test('a source forgotten just before the relabel carry transaction cannot change its routing', async t => {
  const f = engineCardFixture(t), memories = f.seed(8);
  const canonical = createEngineCardStorage({ db: f.db, upgrade: true, ready() {},
    identity: f.db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get() });
  let topic = 'synthetic-topic-a', forgetBeforeCarry = false;
  const storage = { ...canonical, snapshot(...args) {
    const page = canonical.snapshot(...args);
    return { ...page, memories: page.memories.map(memory => ({ ...memory, topics: [topic] })) };
  }, carry(...args) {
    if (forgetBeforeCarry) {
      forgetBeforeCarry = false;
      ok(f.core.forget({ namespace: ns, memoryId: memories[0].id, expectedRevision: memories[0].revision }));
    }
    return canonical.carry(...args);
  } };
  const pass = () => createEngineCardMaintenance({ storage, model: f.model })
    .maintain({ namespace: ns, budget: { maxMs: 5000 } });
  const first = (await pass()).built[0]; assert.ok(first);
  topic = 'synthetic-topic-b'; forgetBeforeCarry = true;
  const result = await pass();
  const metadata = JSON.parse(f.db.prepare("SELECT result FROM card_operations WHERE action_id=? AND method='consolidate'").get(first.id).result);
  assert.equal(metadata.clusterKey, first.clusterKey, 'forgotten source must prevent the routing write inside carry');
  assert.equal(result.state, 'refused'); assert.equal(result.reason, 'source_unavailable');
  assert.equal(f.model.calls.length, 1); assert.deepEqual(result.built, []);
});

test('a relabel carry checks for a destination Card omitted by the bounded routing snapshot', async t => {
  const f = engineCardFixture(t); f.seed(8);
  const canonical = createEngineCardStorage({ db: f.db, upgrade: true, ready() {},
    identity: f.db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get() });
  let topic = 'synthetic-topic-a', clock = Date.UTC(2026, 5, 1), omitted;
  const storage = { ...canonical, snapshot(...args) {
    const page = canonical.snapshot(...args);
    return { ...page, memories: page.memories.map(memory => ({ ...memory, topics: [topic] })) };
  }, cards(...args) { return canonical.cards(...args).filter(card => card.id !== omitted); } };
  const pass = () => createEngineCardMaintenance({ storage, model: f.model, now: () => clock })
    .maintain({ namespace: ns, budget: { maxMs: 5000 } });
  const first = (await pass()).built[0]; assert.ok(first);
  topic = 'synthetic-topic-b';
  const cluster = { key: 'moc:' + topic, memories: storage.snapshot(ns, 1024, () => {}).memories };
  const body = f.db.prepare('SELECT body FROM private_cards WHERE id=?').get(first.id).body;
  const destination = canonical.commit(ns, cluster, { body }, new Date(clock).toISOString(), () => {});
  assert.ok(destination); omitted = destination.id; clock += 3600000;
  const result = await pass();
  const routed = canonical.cards(ns).filter(card => card.status === 'current' && card.clusterKey === cluster.key);
  assert.equal(routed.length, 1, 'relabel must not duplicate an existing readable destination Card');
  assert.equal(routed[0].id, destination.id);
  assert.equal(result.state, 'ready'); assert.equal(result.modelCalls, 0);
  assert.deepEqual(result.built, []); assert.equal(f.model.calls.length, 1);
});


test('a Card follows its exact sources when its old MOC remains eligible with replacement Memories', async t => {
  const f = engineCardFixture(t), filed = f.file(f.seed(8), 'Orion');
  const first = ok(await f.pass()).built[0]; assert.ok(first);
  const before = f.db.prepare('SELECT * FROM private_cards WHERE id=?').get(first.id);
  let destination;
  for (let i = 0; i < filed.memories.length; i += 5) {
    const batch = filed.memories.slice(i, i + 5);
    const placed = ok(f.core.applyPlacement({ namespace: ns,
      expectedIndexRevision: ok(f.core.map({ namespace: ns })).indexRevision,
      expectedMemoryRevisions: batch.map(memory => ({ memoryId: memory.id, revision: memory.revision })),
      proposal: { items: batch.map(memory => ({ memoryId: memory.id, parentIds: destination ? [destination] : [],
        ...(!destination ? { newL1: { title: 'Synthetic destination', parentL2Ids: [] } } : {}) })) } }));
    destination ??= placed.createdMocs.find(moc => moc.level === 'L1').id;
    assert.deepEqual(placed.memories.map(memory => memory.revision), batch.map(memory => memory.revision),
      'a filed-to-filed move keeps the exact revisions');
  }
  const replacements = f.seed(8, 'Lyra');
  for (let i = 0; i < replacements.length; i += 5) {
    const batch = replacements.slice(i, i + 5);
    ok(f.core.applyPlacement({ namespace: ns,
      expectedIndexRevision: ok(f.core.map({ namespace: ns })).indexRevision,
      expectedMemoryRevisions: batch.map(memory => ({ memoryId: memory.id, revision: memory.revision })),
      proposal: { items: batch.map(memory => ({ memoryId: memory.id, parentIds: [filed.mocId] })) } }));
  }
  const result = ok(await f.pass());
  const metadata = JSON.parse(f.db.prepare("SELECT result FROM card_operations WHERE method='consolidate' AND action_id=?").get(first.id).result);
  assert.equal(metadata.clusterKey, 'moc:' + destination, 'carry precedes staling against the still-eligible old key');
  assert.deepEqual(metadata.sourceRevisions, first.sourceRevisions);
  assert.deepEqual(f.db.prepare('SELECT * FROM private_cards WHERE id=?').get(first.id), before,
    'carry keeps the same id, body, revisions and build time');
  assert.equal(result.built.length, 1, JSON.stringify(result));
  assert.equal(result.built[0].clusterKey, 'moc:' + filed.mocId);
  assert.equal(result.modelCalls, 1); assert.equal(f.model.calls.length, 2);
  assert.equal(ok(await f.pass()).modelCalls, 0);
});

for (const publish of [true, false]) test(`a missing Card releases a succeeded fingerprint for one rebuild: publish=${publish}`, async t => {
  const f = engineCardFixture(t); f.seed(8);
  const canonical = createEngineCardStorage({ db: f.db, upgrade: true, ready() {},
    identity: f.db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get() });
  let clock = Date.UTC(2026, 5, 1);
  const pass = storage => createEngineCardMaintenance({ storage, model: f.model, now: () => clock })
    .maintain({ namespace: ns, budget: { maxMs: 5000 } });
  const first = (await pass(canonical)).built[0]; assert.ok(first);
  canonical.retire(ns, first.id, new Date(clock).toISOString(), true);
  assert.deepEqual(canonical.cards(ns), []);
  const storage = publish ? canonical : { ...canonical, commit() { return null; } };
  const passes = [];
  for (let i = 0; i < 3; i++) { clock += 3600000; passes.push(await pass(storage)); }
  assert.deepEqual(passes.map(result => result.modelCalls), [1, 0, 0], 'one repair across three passes, even if no Card is published');
  assert.deepEqual(passes.map(result => result.built.length), [Number(publish), 0, 0]);
  assert.equal(f.model.calls.length, 2);
  if (publish) assert.notEqual(passes[0].built[0].id, first.id);
  const denied = engineCardFixture(t, { model: scriptedConsolidator(() => { throw Error('Synthetic refusal'); }) }); denied.seed(8);
  const deniedStorage = createEngineCardStorage({ db: denied.db, upgrade: true, ready() {},
    identity: denied.db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get() });
  const deniedPass = () => createEngineCardMaintenance({ storage: deniedStorage, model: denied.model, now: () => clock })
    .maintain({ namespace: ns, budget: { maxMs: 5000 } });
  assert.equal((await deniedPass()).state, 'refused');
  for (let i = 0; i < 3; i++) { clock += 3600000; assert.equal((await deniedPass()).modelCalls, 0); }
  assert.equal(denied.model.calls.length, 1); assert.deepEqual(deniedStorage.cards(ns), []);
});


test('a multi-filed Card tries every exact carry destination when the first is occupied', async t => {
  const f = engineCardFixture(t); f.seed(8);
  const canonical = createEngineCardStorage({ db: f.db, upgrade: true, ready() {},
    identity: f.db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get() });
  let topics = ['synthetic-topic-a'], clock = Date.UTC(2026, 5, 1), omitted;
  const attempted = [];
  const storage = { ...canonical, snapshot(...args) {
    const page = canonical.snapshot(...args);
    return { ...page, memories: page.memories.map(memory => ({ ...memory, topics })) };
  }, cards(...args) { return canonical.cards(...args).filter(card => card.id !== omitted); },
  carry(namespace, card, destination, check) {
    attempted.push(destination.key);
    return canonical.carry(namespace, card, destination, check);
  } };
  const pass = () => createEngineCardMaintenance({ storage, model: f.model, now: () => clock })
    .maintain({ namespace: ns, budget: { maxMs: 5000 } });
  const first = (await pass()).built[0]; assert.ok(first);
  const before = f.db.prepare('SELECT * FROM private_cards WHERE id=?').get(first.id);
  topics = ['synthetic-topic-b', 'synthetic-topic-c'];
  const occupied = canonical.commit(ns, { key: 'moc:' + topics[0], memories: storage.snapshot(ns, 512, () => {}).memories },
    { body: before.body }, new Date(clock).toISOString(), () => {});
  assert.ok(occupied); omitted = occupied.id; clock += 3600000;
  const result = await pass();
  assert.deepEqual(attempted, topics.map(topic => 'moc:' + topic), 'occupied first destination does not hide the free exact match');
  const carried = canonical.cards(ns).find(card => card.id === first.id);
  assert.ok(carried); assert.equal(carried.status, 'current'); assert.equal(carried.clusterKey, 'moc:' + topics[1]);
  assert.deepEqual(carried.sourceRevisions, first.sourceRevisions);
  assert.deepEqual(f.db.prepare('SELECT * FROM private_cards WHERE id=?').get(first.id), before, 'carry preserves the original Card');
  assert.equal(canonical.cards(ns).find(card => card.id === occupied.id).clusterKey, 'moc:' + topics[0]);
  assert.equal(result.deleted, 0); assert.equal(result.modelCalls, 0); assert.deepEqual(result.built, []);
  assert.equal(f.model.calls.length, 1);
});

test('Card maintenance on a relation store upgrades only its base and preserves the relation package', async t => {
  const { installMemoryThreadLayout } = await import('../testing/install-memory-thread-layout.mjs');
  const f = engineCardFixture(t), memories = f.seed(8);
  assert.equal(f.db.prepare('PRAGMA user_version').get().user_version, 18, 'opening does not install relations or Cards');
  installMemoryThreadLayout(f.path);
  f.db.prepare(`INSERT INTO memory_relations(id,from_memory_id,from_revision,to_memory_id,to_revision,relation,confidence,decided_by,created_at)
    VALUES('card-relation-preservation',?,?,?,?,'same_thread',1,'user','now')`).run(memories[1].id, memories[1].revision, memories[0].id, memories[0].revision);
  assert.equal(ok(f.core.getEngineCardStatus({ namespace: ns })).state, 'ready');
  const pass = ok(await f.pass()); assert.equal(pass.built.length, 1, JSON.stringify(pass));
  assert.equal(f.db.prepare('PRAGMA user_version').get().user_version, 223);
  assert.equal(f.db.prepare('SELECT relation FROM memory_relations WHERE id=?').get('card-relation-preservation').relation, 'same_thread');
  ok(await f.refresh()); assert.ok(ok(await f.read('Orion current state')).metered.items.some(item => item.ref.type === 'card'));
});

for (const setting of [{ paused: 1 }, { enabled: 0 }]) test(`relation-store Card maintenance sends no model text while saving is stopped ${JSON.stringify(setting)}`, async t => {
  const { installMemoryThreadLayout } = await import('../testing/install-memory-thread-layout.mjs');
  const { control } = await import('../testing/context-semantic-pause-fixture.mjs');
  const f = engineCardFixture(t); f.seed(8); installMemoryThreadLayout(f.path);
  let inputCounts = 0; const counter = f.model.countTokens;
  f.model.countTokens = text => { if (text.includes('Orion')) inputCounts++; return counter(text); };
  control(f.db, ns, setting);
  const pass = ok(await f.pass()); assert.equal(pass.built.length, 0);
  assert.equal(f.model.calls.length, 0); assert.equal(inputCounts, 0);
});

test('relation-store Card model preflight pause prevents generation', async t => {
  const { installMemoryThreadLayout } = await import('../testing/install-memory-thread-layout.mjs');
  const { control } = await import('../testing/context-semantic-pause-fixture.mjs');
  const f = engineCardFixture(t); f.seed(8); installMemoryThreadLayout(f.path);
  let preflights = 0;
  f.model.fitsConsolidationRequest = () => { preflights++; control(f.db, ns, { paused: 1 }); return true; };
  const pass = ok(await f.pass()); assert.equal(pass.built.length, 0);
  assert.equal(preflights, 1); assert.equal(f.model.calls.length, 0);
});
