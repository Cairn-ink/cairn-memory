import test from 'node:test';
import assert from 'node:assert/strict';
import { engineCardFixture, scriptedConsolidator, realisticCardMemories, ns, ok } from '../testing/engine-card-fixture.mjs';
import { CONSOLIDATE_PROMPT, validateConsolidation, normalizedMemoryText } from '../engine-card-output.mjs';
import { createEngineCardStorage } from '../engine-card-storage.mjs';
import { createEngineCardMaintenance } from '../engine-card-maintenance.mjs';
import { configured, prebuild } from '../testing/context-product-owner-fixture.mjs';
import { ENGINE_CARD_LIMITS } from '../private-card-input.mjs';
import { createHash } from 'node:crypto';
import { assembleContext, deliveredCardText, meteredText } from '../context-read-assembly.mjs';
import { assembleThreeLayerContext } from '../context-read-three-layer.mjs';
import { modelRequestText, MODEL_INPUT_TOKENS } from '../model-call.mjs';

const output = (memories, retired = []) => ({ currentState: [{ text: 'ok', memoryIds: [memories.at(-1).id] }],
  timeline: retired.map(id => ({ text: 'model prose never stored', date: 'untrusted date', memoryIds: [id] })), contradictions: [] });
const line = memory => `${memory.date.slice(0, 10)}: ${normalizedMemoryText(memory.content)} [${memory.id}]`;

test('twelve dated verbatim lines preserve normalized source bytes and date/ID order', () => {
  const memories = realisticCardMemories(12);
  memories[0].content += ' [injected]\n\t\u0000\u007f\u0085 text';
  memories[1].date = memories[0].date;
  assert.equal(normalizedMemoryText('A[unsafe]\0 B\nC'), 'A unsafe B C');
  const ordered = [...memories].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const model = scriptedConsolidator(), value = validateConsolidation(output(memories), [...memories].reverse(), model);
  assert.deepEqual(value.body.split('\n'), ordered.map(line));
  assert.equal(value.body.split('\n').length, 12);
  assert.ok(model.countTokens(value.body) <= ENGINE_CARD_LIMITS.maxTokens);
  assert.doesNotMatch(value.body, /[\x00\t\x7f\x85]/u);
});

test('whole oldest current lines yield while timeline and exact remaining content stay intact', () => {
  const memories = realisticCardMemories(12).map(m => ({ ...m, content: (m.content + ' ').repeat(4).trim() }));
  const model = scriptedConsolidator(), value = validateConsolidation(output(memories, [memories[0].id]), memories, model);
  assert.ok(value.body.startsWith(line(memories.at(-value.body.split('\n').length + 1))));
  const lines = value.body.split('\n');
  assert.deepEqual(lines.slice(0, -1), memories.slice(12 - (lines.length - 1)).map(line));
  assert.equal(lines.at(-1), 'Timeline: ' + line(memories[0]));
  assert.ok(model.countTokens(value.body) <= ENGINE_CARD_LIMITS.maxTokens);
  assert.ok(lines.length < 12);
});

test('only valid request IDs mark old lines; model text, dates, currentState and contradictions never supply content', () => {
  const memories = realisticCardMemories(8), model = scriptedConsolidator();
  const result = output(memories, [memories[0].id, memories[1].id]);
  result.timeline.push({ text: 'ignored', date: '', memoryIds: [memories[2].id, 'foreign-id'] });
  result.currentState[0].text = 'invented current state';
  result.contradictions = [{ text: 'invented contradiction', memoryIds: [memories[3].id] }];
  const value = validateConsolidation(result, memories, model);
  assert.deepEqual(value.outOfDateIds, [memories[0].id, memories[1].id]);
  assert.deepEqual(value.body.split('\n'), [...memories.slice(2).map(line), 'Timeline: ' + memories.slice(0, 2).map(line).join('; ')]);
  assert.doesNotMatch(value.body, /invented|model prose|untrusted date/);
  assert.equal(validateConsolidation(output(memories, memories.map(m => m.id)), memories, model).body, null);
  assert.equal(validateConsolidation(output(memories), memories, model).body.split('\n').length, 8);
});

for (const malformed of [{}, { currentState: [], timeline: null, contradictions: [] },
  { currentState: [], timeline: [{ text: 'bad', memoryIds: [] }], contradictions: [] }])
  test('malformed output refuses publication', async t => {
    const f = engineCardFixture(t, { model: scriptedConsolidator(() => malformed) }); f.seed(8);
    const pass = ok(await f.pass()); assert.equal(pass.reason, 'invalid_model_output'); assert.equal(pass.built.length, 0);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM private_cards').get().n, 0);
  });

test('all marked makes no Card; zero marked is successful', async t => {
  for (const all of [true, false]) {
    const f = engineCardFixture(t, { model: scriptedConsolidator(({ input }) => output(input.memories, all ? input.memories.map(m => m.id) : [])) });
    f.seed(8); const pass = ok(await f.pass()); assert.equal(pass.state, 'ready'); assert.equal(pass.built.length, all ? 0 : 1);
    assert.equal(ok(await f.pass()).modelCalls, 0);
  }
});

test('current host read strips tags and Timeline, covers both kinds, keeps canonical snapshot/evidence and history', async t => {
  const f = engineCardFixture(t, { model: scriptedConsolidator(({ input }) => output(input.memories, input.memories.slice(0, 2).map(m => m.id))) });
  f.seed(8); const card = ok(await f.pass()).built[0]; assert.ok(card);
  const body = f.db.prepare('SELECT body FROM private_cards WHERE id=?').get(card.id).body;
  assert.equal(body.split('\n').length, 7);
  ok(await f.refresh());
  const current = ok(await f.read('Orion', { budget: { maxItems: 12, maxTokens: 6000 } }));
  assert.equal(current.metered.items.length, 1);
  const packed = current.metered.items[0]; assert.equal(packed.ref.id, card.id);
  assert.equal(packed.body.split('\n').length, 7); // title + six current lines
  assert.doesNotMatch(packed.body, /Timeline:|\[|\]/u);
  assert.equal(packed.ref.bodyRev, 1); assert.ok(current.snapshot);
  const evidence = ok(await f.trusted.call(f.core, 'fetchCandidateEvidence', { readSet: [ns], snapshot: current.snapshot }));
  assert.equal(evidence.items[0].body, body);
  const history = ok(await f.read('Orion', { intent: 'history', budget: { maxItems: 12, maxTokens: 6000 } }));
  assert.equal(history.metered.items.find(item => item.ref.id === card.id).body, evidence.items[0].title + '\n' + body);
  const service = configured(t, f.path, [ns], { service: true }); await prebuild(service);
  const request = configured(t, f.path, [ns]), product = await request.open();
  for (const intent of ['current', 'history']) {
    const result = ok(await product.contextRead({ readSet: [ns], types: ['memory', 'card'], intent,
      query: 'Orion', semantic: false, raw: false, deadlineMs: 5000, budget: { maxItems: 12, maxTokens: 6000 } }, request.token));
    assert.equal(result.metered.items.find(item => item.ref.id === card.id).body,
      intent === 'current' ? packed.body : evidence.items[0].title + '\n' + body);
    const fetched = ok(await product.fetchCandidateEvidence({ readSet: [ns], snapshot: result.snapshot }, request.token));
    assert.equal(fetched.items.find(item => item.ref.cardId === card.id).body, body);
  }
  assert.equal(f.db.prepare('SELECT body FROM private_cards WHERE id=?').get(card.id).body, body);
  const old = f.model.calls[0].memories[0];
  ok(f.core.forget({ namespace: ns, memoryId: old.id, expectedRevision: old.revision }));
  const after = ok(await f.read('Orion', { budget: { maxItems: 12, maxTokens: 6000 } }));
  assert.ok(after.metered.items.every(item => item.ref.id !== card.id && item.ref.id !== old.id), 'forgotten Timeline source hides its Card');
});

test('cross-part context retires an older Card and the later debounced pass rebuilds it', async t => {
  let calls = 0;
  const model = scriptedConsolidator(({ input }) => {
    calls++;
    assert.equal(input.memories.length, 20); assert.deepEqual(input.rawSpans, []);
    const old = input.memories.find(m => m.content.includes('milestone 0:'));
    return output(input.memories, calls === 1 ? [] : [old.id]);
  });
  const f = engineCardFixture(t, { model }); f.file(f.seed(20), 'Orion');
  const first = ok(await f.pass()).built[0]; assert.ok(first);
  const second = ok(await f.pass()).built[0]; assert.ok(second); assert.ok(second.clusterKey.endsWith('#1'));
  const firstCall = model.calls[0].memories, secondCall = model.calls[1].memories;
  assert.equal(firstCall.slice(0, 12).some(m => m.id === secondCall[0].id), false);
  assert.ok(secondCall.slice(8).every((m, i, rest) => !i || rest[i - 1].date >= m.date));
  const row = f.db.prepare('SELECT * FROM private_cards WHERE id=?').get(first.id); assert.equal(row.revision, 2);
  const storage = createEngineCardStorage({ db: f.db, upgrade: true, ready() {},
    identity: f.db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get() });
  const pass = offset => createEngineCardMaintenance({ storage, model, now: () => Date.parse(row.updated_at) + offset })
    .maintain({ namespace: ns, budget: { maxMs: 5000 } });
  assert.equal((await pass(599999)).modelCalls, 0);
  const rebuilt = await pass(600001); assert.equal(rebuilt.built.length, 1, JSON.stringify(rebuilt));
  assert.equal(model.calls.length, 3); assert.equal(rebuilt.built[0].clusterKey, first.clusterKey);
  const body = f.db.prepare('SELECT body FROM private_cards WHERE id=?').get(rebuilt.built[0].id).body;
  assert.doesNotMatch(body.split('\n').filter(line => !line.startsWith('Timeline:')).join('\n'), /milestone 0:/);
  assert.match(body.split('\n').at(-1), /milestone 0:/);
});

test('two parts with an out-of-date Memory each stay stable: a Timeline citation never retires the other Card', async t => {
  // The model names the same two Memories on every call, whichever part is being built.
  const model = scriptedConsolidator(({ input }) => output(input.memories, input.memories
    .filter(m => m.content.includes('milestone 0:') || m.content.includes('milestone 12:')).map(m => m.id)));
  const f = engineCardFixture(t, { model }); f.file(f.seed(20), 'Orion');
  const first = ok(await f.pass()).built[0]; assert.ok(first);
  const second = ok(await f.pass()).built[0]; assert.ok(second); assert.ok(second.clusterKey.endsWith('#1'));
  const revisions = () => [first.id, second.id].map(id => f.db.prepare('SELECT revision FROM private_cards WHERE id=?').get(id).revision);
  assert.deepEqual(revisions(), [1, 1], 'building the second part leaves the first current');
  const bodies = [first.id, second.id].map(id => f.db.prepare('SELECT body FROM private_cards WHERE id=?').get(id).body);
  assert.match(bodies[0].split('\n').at(-1), /^Timeline: .*milestone 0:/u);
  assert.match(bodies[1].split('\n').at(-1), /^Timeline: .*milestone 12:/u);
  const storage = createEngineCardStorage({ db: f.db, upgrade: true, ready() {},
    identity: f.db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get() });
  const base = Date.parse(f.db.prepare('SELECT updated_at FROM private_cards WHERE id=?').get(second.id).updated_at);
  for (const offset of [1000, 600001, 1200002, 1800003]) {
    const later = await createEngineCardMaintenance({ storage, model, now: () => base + offset })
      .maintain({ namespace: ns, budget: { maxMs: 5000 } });
    assert.equal(later.modelCalls, 0, JSON.stringify(later)); assert.equal(later.built.length, 0);
  }
  assert.equal(model.calls.length, 2, 'no rebuild after both parts exist');
  assert.deepEqual(revisions(), [1, 1]);
});

test('a Memory the store holds as history goes under Timeline even when the model marks nothing', () => {
  const memories = realisticCardMemories(6);
  memories[1].currentness = 'historical';
  const value = validateConsolidation(output(memories), memories, scriptedConsolidator());
  assert.deepEqual(value.body.split('\n'), [...memories.filter((_, i) => i !== 1).map(line), 'Timeline: ' + line(memories[1])]);
  assert.deepEqual(value.outOfDateIds, [memories[1].id]);
});

test('context stays within 24, keeps all own sources, trims against the existing adapter and input envelope', async t => {
  const model = scriptedConsolidator();
  model.fitsConsolidationRequest = ({ system, input }) => {
    assert.equal(system, CONSOLIDATE_PROMPT);
    assert.ok(model.countTokens(modelRequestText(system, input)) <= MODEL_INPUT_TOKENS);
    return input.memories.length <= 18;
  };
  const f = engineCardFixture(t, { model }); f.file(f.seed(30), 'Orion');
  const built = ok(await f.pass()).built[0]; assert.ok(built);
  assert.equal(model.calls[0].memories.length, 18);
  assert.deepEqual(new Set(model.calls[0].memories.slice(0, 12).map(m => m.id)), new Set(built.sourceRevisions.map(m => m.memoryId)));
  assert.ok(model.calls[0].memories.slice(12).every((m, i, rest) => !i || rest[i - 1].date >= m.date));
});

for (const mixed of [false, true]) test(`${mixed ? 'mixed' : 'Memory'} assembly meters delivered text, covers Timeline and retains omitted lines`, () => {
  const model = scriptedConsolidator(), memories = realisticCardMemories(12);
  const value = validateConsolidation(output(memories, [memories[0].id, memories[1].id]), memories, model);
  const metadata = { state: 'active', reviewState: 'none', filing: { status: 'unfiled' }, kind: 'fact', origin: 'explicit', confidence: 1 };
  const prepared = memories.map((memory, i) => ({ type: 'memory', rank: i + 1, ns: 0,
    ref: { namespace: ns, type: 'memory', memoryId: memory.id, revision: 1 }, text: memory.content, metadata,
    sources: [], sourcesComplete: true, sourceAccess: 'available', turnIds: [], sessionIds: [], fence: 'synthetic-fence' }));
  const card = { ...prepared[0], type: 'card', rank: 13, text: 'Topic: Orion\n' + value.body,
    ref: { type: 'card', namespace: ns, cardId: 'synthetic-card', revision: 1, bodyRevision: 1 },
    metadata: { state: 'confirmed', origin: 'engine' }, sourceMemoryRefs: prepared.map(m => m.ref) };
  const text = 'Orion separate Raw record.', rawValue = { namespace: ns, conversationId: 'conversation', messageId: 'turn', role: 'user',
    occurredAt: null, ranges: [{ source: { span: { start: 0, end: text.length } }, text }] };
  const raw = { items: [{ key: 'turn', rank: 1, value: rawValue, handle: {} }], coverage: 'included', rawSearch: { revalidate: handles => handles.map(() => rawValue) } };
  const args = { prepared: [...prepared, card], counter: model, policy: { id: 'rank-first-whole-v1' },
    budget: { maxItems: 12, maxTokens: 6000 }, deadlineAt: Infinity, snapshotOf: items => { assert.equal(items.find(i => i.type === 'card').text, card.text); return 'canonical'; },
    readSet: [ns], query: 'Orion', representation: 'representation-v2' };
  const pack = patch => mixed ? assembleThreeLayerContext({ ...args, ...patch }, raw) : assembleContext({ ...args, ...patch });
  const packed = pack(), item = packed.metered.items.find(i => i.ref.type === 'card'); assert.ok(item);
  assert.equal(packed.diagnostics.budget.used, model.countTokens(meteredText(packed.metered)));
  if (!mixed) assert.equal(packed.diagnostics.items.find(i => i.ref.type === 'card').body.tokens, model.countTokens(item.body));
  assert.equal(item.body, deliveredCardText(card)); assert.doesNotMatch(item.body, /Timeline:|\[|\]/u);
  assert.equal(packed.metered.items.some(i => i.ref.type === 'memory'), false);
  if (mixed) assert.ok(packed.metered.items.some(i => i.ref.type === 'raw'));
  const history = pack({ intent: 'history' }); assert.equal(history.metered.items.find(i => i.ref.type === 'card').body, card.text);
  assert.ok(packed.diagnostics.budget.used < history.diagnostics.budget.used);
  // A fitting Card's source omitted from its stored citations remains eligible.
  card.text = 'Topic: Orion\n' + value.body.split('\n').slice(1).join('\n');
  const omitted = pack(); assert.ok(omitted.metered.items.some(i => i.ref.id === memories[2].id));
});

test('a sole current source that cannot fit produces no Card without shortening it', () => {
  const memories = realisticCardMemories(1); memories[0].content = 'Orion detail '.repeat(1000).trim();
  const before = structuredClone(memories), value = validateConsolidation(output(memories), memories, scriptedConsolidator());
  assert.equal(value.body, null); assert.deepEqual(memories, before);
});

// The marking result depends on this exact wording: without the paragraph on
// dated records a real model marks daily expenses and activity logs as replaced.
// Change the text only together with a real-model check, then update the digest.
test('the out-of-date marking prompt is pinned', () => {
  assert.equal(createHash('sha256').update(CONSOLIDATE_PROMPT).digest('hex'), '0dc8d244ddd9d814d97259666869c5b13815e3dfd29be8292e447611f6fb3e85');
  assert.match(CONSOLIDATE_PROMPT, /Records are never out of date/u);
  assert.match(CONSOLIDATE_PROMPT, /has done its work once the entry is gone/u);
});
