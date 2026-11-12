import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleContext } from '../context-read-assembly.mjs';
import { assembleThreeLayerContext } from '../context-read-three-layer.mjs';
import { engineCardFixture, scriptedConsolidator, ns, ok } from '../testing/engine-card-fixture.mjs';
import { openMemoryCore } from '../index.mjs';
import { validateConsolidation } from '../engine-card-output.mjs';

function fixture() {
  const model = scriptedConsolidator();
  const memories = Array.from({ length: 16 }, (_, i) => ({ type: 'memory', ns: 0, rank: i + 1,
    ref: { type: 'memory', namespace: ns, memoryId: `abcdef01-1234-4567-89ab-${String(i).padStart(12, '0')}`, revision: 1 },
    text: `Orion group ${i} prepares the community garden workshop and confirms the volunteer schedule.`,
    sources: [], sourceAccess: 'available', sourcesComplete: true, turnIds: [], sessionIds: [], fence: 'synthetic-fence', date: null,
    metadata: { state: 'active', reviewState: 'none', filing: { status: 'unfiled' }, kind: 'fact', origin: 'explicit', confidence: 1 } }));
  const sources = memories.slice(2, 14), outputMemories = sources.map(item => ({ id: item.ref.memoryId, date: '2026-01-01', content: item.text }));
  const body = validateConsolidation({ currentState: [{ text: 'ok', memoryIds: [outputMemories.at(-1).id] }], timeline: [], contradictions: [] }, outputMemories, model).body;
  const card = { ...memories[0], type: 'card', rank: 17, text: body,
    ref: { type: 'card', namespace: ns, cardId: 'synthetic-card', revision: 1, bodyRevision: 1 },
    metadata: { state: 'confirmed', origin: 'engine' }, sourceMemoryRefs: sources.map(item => item.ref) };
  const text = 'Orion independent Raw observation.', value = { namespace: ns, conversationId: 'synthetic-conversation',
    messageId: 'synthetic-turn', role: 'user', occurredAt: null, ranges: [{ source: { span: { start: 0, end: text.length } }, text }] };
  const raw = { items: [{ key: 'synthetic-turn', rank: 1, value, handle: {} }], coverage: 'included',
    rawSearch: { revalidate: handles => handles.map(() => value) } };
  return { memories, card, raw, args: { prepared: [...memories, card], counter: model, policy: { id: 'rank-first-whole-v1' },
    budget: { maxItems: 12, maxTokens: 6000 }, deadlineAt: Infinity, snapshotOf: () => null, readSet: [ns],
    query: 'Orion', representation: 'representation-v2' } };
}

for (const mixed of [false, true]) {
  const pack = (f, args = f.args) => mixed ? assembleThreeLayerContext(args, f.raw) : assembleContext(args);
  test(`${mixed ? 'three-layer' : 'Memory'} pack promotes a fitted Card to its third-ranked cited hit`, () => {
    const f = fixture(), value = pack(f), items = value.metered.items;
    assert.equal(items[2].ref.type, 'card'); assert.equal(items[2].ref.id, f.card.ref.cardId);
    const cited = f.memories.filter(memory => f.card.text.includes(memory.ref.memoryId));
    assert.ok(cited.length >= 7);
    for (const memory of cited) assert.ok(!items.some(item => item.ref.id === memory.ref.memoryId));
    for (const memory of f.memories.filter(memory => !cited.includes(memory) &&
        f.card.sourceMemoryRefs.some(ref => ref.memoryId === memory.ref.memoryId)))
      assert.ok(items.some(item => item.ref.id === memory.ref.memoryId), memory.ref.memoryId);
    for (const memory of f.memories.slice(0, 2)) assert.ok(items.some(item => item.ref.id === memory.ref.memoryId));
    assert.ok(items.length <= 12); assert.ok(value.diagnostics.budget.used <= 6000);
    assert.deepEqual(f.memories.map(m => m.rank), Array.from({ length: 16 }, (_, i) => i + 1));
    if (mixed) assert.ok(items.some(item => item.ref.type === 'raw'), 'exercise mixed units, not fallback');
  });
  test(`${mixed ? 'three-layer' : 'Memory'} pack retains ordinary behavior for citations outside the window`, () => {
    const f = fixture(); f.card.text = `Orion distant fact [${f.memories[12].ref.memoryId}]`;
    const value = pack(f);
    assert.ok(!value.metered.items.some(item => item.ref.type === 'card'));
    assert.ok(value.metered.items.some(item => item.ref.id === f.memories[0].ref.memoryId));
    // Coalescing opens item slots while leaving the source outside the window.
    if (mixed) {
      const turn = JSON.stringify([JSON.stringify([ns.ownerId, ns.scope, ns.projectId]), 'synthetic-session', 'synthetic-coalesced']);
      for (const memory of f.memories.slice(0, 12)) memory.turnIds = [turn];
      const coalesced = pack(f);
      assert.ok(coalesced.selected.some(item => item.ref.memoryId === f.memories[12].ref.memoryId));
      assert.ok(!coalesced.metered.items.some(item => item.ref.type === 'card'));
    }
    // A selected out-of-window source still blocks its lower-ranked Card.
    const original = f.memories[0].text; f.memories[0].text = 'oversized '.repeat(10000);
    assert.ok(!pack(f).metered.items.some(item => item.ref.type === 'card'));
    f.memories[0].text = original;
    // An out-of-date statement inside the window promotes its Card as well:
    // the Card, delivered without that line, takes the old statement's place.
    f.card.text += `\nTimeline: 2026-01-01: Orion old fact [${f.memories[2].ref.memoryId}]`;
    const promoted = pack(f);
    assert.ok(promoted.metered.items.some(item => item.ref.type === 'card'), 'Timeline hit promotes');
    assert.ok(!promoted.selected.some(item => item.ref.memoryId === f.memories[2].ref.memoryId), 'out-of-date Memory leaves the pack');
    assert.ok(!JSON.stringify(promoted.metered).includes('Orion old fact'), 'out-of-date line is not delivered');
  });
  test(`${mixed ? 'three-layer' : 'Memory'} promotion still requires budget fit and leaves authored ordering intact`, () => {
    const f = fixture();
    const tiny = pack(f, { ...f.args, budget: { maxItems: 12, maxTokens: 350 } });
    assert.ok(!tiny.metered.items.some(item => item.ref.type === 'card'));
    assert.equal(tiny.diagnostics.stops.budget, true);
    assert.ok(tiny.diagnostics.budget.used <= 350);
    assert.ok(tiny.metered.items.some(item => item.ref.id === f.memories[2].ref.memoryId));
    f.card.metadata.origin = 'authored';
    const authored = pack(f, { ...f.args, budget: { maxItems: 24, maxTokens: 10000 } });
    assert.equal(authored.metered.items.findIndex(item => item.ref.type === 'card'), 16);
    for (const memory of f.memories) assert.ok(authored.metered.items.some(item => item.ref.id === memory.ref.memoryId));
  });
}

for (const mixed of [false, true]) for (const change of ['revision', 'forget', 'namespace']) test(`${mixed ? 'three-layer' : 'Memory'} promotion preserves canonical ${change} fences`, async t => {
  const f = engineCardFixture(t, { raw: mixed, model: scriptedConsolidator() });
  const memories = f.seed(9), card = ok(await f.pass()).built[0]; assert.ok(card);
  ok(await f.refresh());
  let reader = f.core;
  if (mixed) {
    const value = fixture().raw.items[0].value, handle = { value };
    reader = openMemoryCore({ path: f.path, contextRead: { version: 'context-read-v1', authority: f.trusted.authority,
      counter: { id: 'o200k_base', countTokens: f.model.countTokens }, rawSearch: {
        search: () => ({ candidates: [{ namespace: ns, conversationId: value.conversationId, messageId: value.messageId }], coverage: { status: 'complete' } }),
        prepare: () => handle, revalidate: handles => handles.map(() => value) } } });
    f.workspace.defer(() => reader.close());
  }
  const read = () => f.trusted.call(reader, 'contextRead', { readSet: [ns], types: ['memory', 'card'], intent: 'current',
    query: 'Orion', semantic: false, deadlineMs: 5000, budget: { maxItems: 12, maxTokens: 6000 } });
  const before = ok(await read());
  assert.ok(before.metered.items.some(item => item.ref.id === card.id));
  if (mixed) assert.ok(before.metered.items.some(item => item.ref.type === 'raw'));
  if (change === 'forget') ok(f.core.forget({ namespace: ns, memoryId: memories[0].id, expectedRevision: memories[0].revision }));
  else if (change === 'revision') f.db.prepare('UPDATE memories SET revision=revision+1 WHERE id=?').run(memories[0].id);
  else f.db.prepare('UPDATE private_cards SET project_id=? WHERE id=?').run('synthetic-other-project', card.id);
  assert.ok(!ok(await read()).metered.items.some(item => item.ref.id === card.id));
});
