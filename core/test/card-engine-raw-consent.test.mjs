import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceFixture, savedSource, ns, ok, localPlainPort } from '../testing/raw-source-fixtures.mjs';
import { scriptedConsolidator, engineCardFixture } from '../testing/engine-card-fixture.mjs';
import { openMemoryCore } from '../index.mjs';
import { createEngineCardMaintenance } from '../engine-card-maintenance.mjs';

for (const [name, options, expected] of [
  ['default', {}, 0],
  ['explicit opt-out', { rawSpans: false }, 0],
  ['explicit opt-in', { rawSpans: true }, 8],
]) test(`Card maintenance Raw consent: ${name}`, async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('recording model is offline'));
  const model = scriptedConsolidator(), port = localPlainPort();
  const opened = t.mock.method(port, 'openRaw');
  const f = sourceFixture(t, { lineage: true, port, model: { ...model, classify: undefined,
    extract: ({ input }) => ({ items: [{ content: input.messages[0].content, kind: 'fact', confidence: 1, sourceIndices: [0] }] }) } });
  for (let i = 0; i < 8; i++) await savedSource(f, `Orion raw milestone ${i}: retained synthetic detail`, { sessionId: 'conversation-' + i });
  const memories = f.db.prepare('SELECT id FROM memories ORDER BY id').all();
  assert.equal(memories.length, 8);
  memories.forEach((memory, i) => f.db.prepare('UPDATE memories SET created_at=? WHERE id=?')
    .run(new Date(Date.UTC(2026, 0, i * 3 + 1)).toISOString(), memory.id));
  opened.mock.resetCalls();
  const pass = ok(await f.core.maintainCards({ namespace: ns, budget: { maxMs: 10000 }, ...options }));
  assert.equal(pass.built.length, 1, JSON.stringify(pass));
  assert.equal(model.calls.length, 1);
  assert.equal(model.calls[0].rawSpans.length, expected);
  assert.equal(opened.mock.callCount(), expected);
  if (expected) assert.ok(model.calls[0].rawSpans.every(span => span.text.startsWith('Orion raw milestone')));
  else assert.deepEqual(model.calls[0].rawSpans, []);
});

for (const context of [false, true]) test(`maintainCards validates rawSpans through ${context ? 'context' : 'base'} wrappers`, async t => {
  const f = engineCardFixture(t);
  const core = context ? f.core : openMemoryCore({ path: f.path, model: f.model });
  if (!context) f.workspace.defer(() => core.close());
  for (const rawSpans of [null, undefined, 0, 1, 'false', [], {}]) {
    const result = await core.maintainCards({ namespace: ns, rawSpans });
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.error.code, 'invalid_input');
  }
  for (const rawSpans of [false, true]) assert.equal((await core.maintainCards({ namespace: ns, rawSpans })).ok, true);
  assert.equal(f.model.calls.length, 0);
});

test('maintenance input checker rejects non-boolean rawSpans before storage access', async () => {
  const worker = createEngineCardMaintenance({ model: scriptedConsolidator(), storage: new Proxy({}, {
    get() { assert.fail('invalid input must not access storage'); },
  }) });
  for (const rawSpans of [null, undefined, 0, 'true', [], {}]) {
    await assert.rejects(worker.maintain({ namespace: ns, rawSpans }), { code: 'invalid_input' });
  }
});

for (const [name, options, expected] of [
  ['default', {}, false],
  ['explicit opt-out', { rawSpans: false }, false],
  ['explicit opt-in', { rawSpans: true }, true],
]) test(`four-Memory receipt pressure respects Raw consent: ${name}`, async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('recording model is offline'));
  const sentinel = 'SYNTHETIC_RECEIPT_ONLY', counted = [], otherCalls = [];
  const model = scriptedConsolidator(request => {
    otherCalls.push(structuredClone(request));
    return { currentState: [{ text: 'Orion current slot value.', memoryIds: [request.input.memories[0].id] }],
      timeline: [], contradictions: [] };
  });
  const count = model.countTokens;
  model.countTokens = text => { counted.push(text); return count(text); };
  model.fitsConsolidationRequest = request => { otherCalls.push(structuredClone(request)); return true; };
  let edges;
  const f = engineCardFixture(t, { model, cardRelations: { read: () => edges } });
  const memories = Array.from({ length: 4 }, (_, i) => ok(f.core.admit({ namespace: ns,
    memory: { content: `Orion slot value ${i}.`, kind: 'fact' },
    receipts: [{ client: 'synthetic', sessionId: `conversation-${i}`, eventId: `event-${i}`,
      role: 'user', excerpt: `${sentinel} ${i}: ` + 'x! '.repeat(240) }] })).memory);
  edges = memories.slice(1).map((memory, i) => ({ from: memory.id, to: memories[i].id,
    kind: 'supersedes', slot: 'orion-status' }));
  assert.equal(edges.length, 3);
  assert.ok(memories.every(memory => !ok(f.core.get({ namespace: ns, memoryId: memory.id })).memory.content.includes(sentinel)));
  counted.length = 0; otherCalls.length = 0;
  const pass = ok(await f.core.maintainCards({ namespace: ns, budget: { maxMs: 10000 }, ...options }));
  assert.ok(counted.length > 0, 'four-Memory chain actually meters pressure');
  assert.equal(counted.some(text => text.includes(sentinel)), expected, 'receipt text requires opt-in at the counter');
  assert.ok(!JSON.stringify(otherCalls).includes(sentinel), 'receipt-only text never enters another model method');
  assert.equal(pass.built.length, expected ? 1 : 0, JSON.stringify(pass));
  assert.equal(model.calls.length, expected ? 1 : 0, 'receipts alone create pressure only with opt-in');
});
