import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';
import { createMockRecallModel } from '../testing/mock-recall-model.mjs';

const namespace = { ownerId: 'synthetic-excerpt-test', scope: 'personal', projectId: null };
const ok = (result) => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const filler = 'General planning notes cover routine coordination. '.repeat(6);
const fact = 'The saffron observatory opens on Wednesday.';
const rank = ({ input }) => ({ refs: input.candidates.slice(0, input.limit).map((item) => ({
  namespaceIndex: item.namespaceIndex, memoryId: item.memory.id, revision: item.memory.revision,
})) });
const select = ({ input }) => ({ refs: input.maps.flatMap((map) => map.items
  .filter((item) => item.type === 'unfiled' && item.label.toLowerCase().includes(input.query.toLowerCase()))
  .map((item) => ({ namespaceIndex: map.namespaceIndex, ...item.ref }))) });
function fixture(t, selectStep = select) {
  const model = createMockRecallModel({ select: Array(12).fill(selectStep), rank: Array(12).fill(rank) });
  const core = openMemoryCore({ path: join(mkdtempSync(join(tmpdir(), 'cairn-excerpt-')), 'memory.sqlite'), model });
  t.after(() => core.close());
  return { core, model };
}
function admit(core, content, scope = namespace) {
  return ok(core.admit({ namespace: scope, memory: { content, kind: 'fact' },
    receipts: [{ client: 'synthetic', sessionId: 's', eventId: randomUUID(), role: 'user', excerpt: content }] })).memory;
}
const recall = (core, query = 'saffron') => core.recall({ readSet: [namespace], query });

test('hidden relevant fact among four distractors reaches selector and actual recall', async (t) => {
  const { core, model } = fixture(t);
  for (let i = 0; i < 4; i += 1) admit(core, `${filler}Unrelated inventory record ${i}.`);
  const content = filler + fact;
  const target = admit(core, content);
  const result = ok(await recall(core));
  assert.deepEqual(result.memories.map((item) => item.memory.id), [target.id]);
  const navigation = model.calls.find((call) => call.method === 'select').input.maps[0];
  assert.equal(navigation.items.length, 5, 'excerpting must not filter candidates');
  assert.ok(navigation.items.find((item) => item.ref?.memoryId === target.id).label.includes('saffron'));
  assert.equal(result.memories[0].memory.content, content);
  assert.equal(result.memories[0].receipts[0].excerpt, content);
});

for (const [position, content] of [
  ['front', fact + filler], ['middle', filler + fact + filler], ['back', filler + fact],
]) test(`query evidence at ${position} remains a bounded original slice`, async (t) => {
  const { core, model } = fixture(t);
  const target = admit(core, content);
  const result = ok(await recall(core));
  assert.deepEqual(result.memories.map((item) => item.memory.id), [target.id]);
  const label = model.calls[0].input.maps[0].items[0].label;
  assert.ok(label.includes('saffron'));
  assert.ok([...label].length <= 120);
  assert.ok(content.includes(label));
  if (position === 'front') assert.equal(label, [...content].slice(0, 120).join(''));
});

test('unrelated and absent answers remain empty without ranking fallback', async (t) => {
  const { core, model } = fixture(t);
  admit(core, filler + fact);
  for (const query of ['astronomy', 'unrecorded-telescope-code']) {
    const before = model.calls.length;
    assert.deepEqual(ok(await recall(core, query)).memories, []);
    assert.deepEqual(model.calls.slice(before).map((call) => call.method), ['select']);
    assert.equal(model.calls.at(-1).input.maps[0].items[0].label, [...(filler + fact)].slice(0, 120).join(''));
  }
});

test('public recall maps and classification inputs retain their original prefix labels', async (t) => {
  const { core, model } = fixture(t);
  const target = admit(core, filler + fact);
  const before = ok(core.map({ namespace }));
  const classificationBefore = ok(core.map({ namespace, purpose: 'classification' }));
  ok(await recall(core));
  assert.deepEqual(ok(core.map({ namespace })), before);
  assert.deepEqual(ok(core.map({ namespace, purpose: 'classification' })), classificationBefore);
  assert.equal(before.items[0].label, [...(filler + fact)].slice(0, 120).join(''));
  let classificationInput;
  model.classify = async ({ input }) => {
    classificationInput = input;
    return { items: [{ memoryId: target.id, parentIds: [] }] };
  };
  ok(await core.classifyPlacement({ namespace, memoryIds: [target.id],
    expectedMemoryRevisions: [{ memoryId: target.id, revision: target.revision }],
    mapRevision: classificationBefore.indexRevision }));
  assert.deepEqual(classificationInput.map, classificationBefore.items);
  assert.deepEqual(core.map({ namespace, query: 'saffron' }),
    { ok: false, error: { code: 'invalid_input', retryable: false } });
});

test('Unicode excerpts preserve complete code points and original stored slices', async (t) => {
  const { core, model } = fixture(t);
  const content = '🌌 '.repeat(100) + '星圖 saffron café 観測所 opens Wednesday. ' + '🪐 '.repeat(90);
  const target = admit(core, content);
  const result = ok(await recall(core));
  assert.deepEqual(result.memories.map((item) => item.memory.id), [target.id]);
  const label = model.calls[0].input.maps[0].items[0].label;
  const stored = ok(core.get({ namespace, memoryId: target.id })).memory.content;
  assert.ok([...label].length <= 120);
  assert.ok(stored.includes(label));
  assert.ok(label.includes('saffron'));
  assert.equal(label.isWellFormed(), true);
});

test('literal-token ties are deterministic and repeated words do not outweigh distinct overlap', async (t) => {
  const { core, model } = fixture(t, () => ({ refs: [] }));
  const content = 'saffron '.repeat(18) + filler + 'saffron observatory Wednesday.';
  admit(core, content);
  for (let i = 0; i < 2; i += 1) ok(await recall(core, 'saffron observatory'));
  const first = model.calls[0].input.maps[0].items[0].label;
  assert.equal(first, model.calls[1].input.maps[0].items[0].label);
  assert.ok(first.includes('observatory'));
  assert.ok(first.includes('saffron'));
  const repeated = fixture(t, () => ({ refs: [] }));
  admit(repeated.core, 'saffron begins here. ' + filler + 'saffron repeats later.');
  ok(await recall(repeated.core, 'saffron saffron'));
  assert.equal(repeated.model.calls[0].input.maps[0].items[0].label,
    [...('saffron begins here. ' + filler + 'saffron repeats later.')].slice(0, 120).join(''));
});

test('recall excerpts do not admit foreign namespace facts and follow correction and forgetting', async (t) => {
  const { core, model } = fixture(t);
  const initial = filler + fact;
  const target = admit(core, initial);
  admit(core, filler + 'saffron FOREIGN_SECRET_ORCHID', { ...namespace, ownerId: 'other-owner' });
  assert.deepEqual(ok(await recall(core)).memories.map((item) => item.memory.id), [target.id]);
  assert.ok(!JSON.stringify(model.calls).includes('FOREIGN_SECRET_ORCHID'));
  const replacement = filler + 'The saffron observatory opens on Friday.';
  const changed = ok(core.correct({ namespace, memoryId: target.id, expectedRevision: target.revision,
    content: replacement, kind: 'fact', receipt: { client: 'synthetic', sessionId: 's', eventId: 'correction',
      role: 'user', excerpt: replacement } })).memory;
  const recalled = ok(await recall(core)).memories;
  assert.equal(recalled[0].memory.revision, changed.revision);
  assert.equal(recalled[0].memory.content, replacement);
  assert.equal(recalled[0].receipts[0].excerpt, replacement);
  assert.equal(ok(core.forget({ namespace, memoryId: target.id, expectedRevision: changed.revision })).forgotten, true);
  assert.deepEqual(ok(await recall(core)).memories, []);
  assert.equal(model.calls.at(-1).method, 'select');
  assert.deepEqual(model.calls.at(-1).input.maps[0].items, []);
});

test('map token packing measures excerpt envelopes and splits them at the existing ceiling', async (t) => {
  const { core, model } = fixture(t);
  const first = admit(core, filler + fact + ' Record one.');
  const second = admit(core, filler + fact + ' Record two.');
  const envelopes = [];
  model.countTokens = (text) => {
    let envelope;
    try { envelope = JSON.parse(text); } catch { return 1; }
    const items = envelope?.ok === true ? envelope.value?.items : null;
    if (items?.some((item) => item.type === 'unfiled' && item.label.includes('saffron'))) {
      envelopes.push(structuredClone(envelope));
      return items.length > 1 ? 4001 : 4000;
    }
    return 1;
  };
  const result = ok(await recall(core));
  assert.deepEqual(result.memories.map((item) => item.memory.id).sort(), [first.id, second.id].sort());
  assert.equal(result.coverage, 'complete');
  assert.ok(envelopes.some((envelope) => envelope.value.items.length === 2));
  assert.ok(envelopes.some((envelope) => envelope.value.items.length === 1
    && envelope.value.truncatedBy === 'token_budget' && envelope.value.nextCursor));
  const selections = model.calls.filter((call) => call.method === 'select');
  assert.equal(selections.length, 2, 'the fixed two-page selection ceiling is sufficient for this fixture');
  assert.ok(selections.every((call) => call.input.maps[0].items.length === 1));
  assert.equal(model.calls.filter((call) => call.method === 'rank').length, 1);
});

test('one oversized excerpt envelope fails explicitly instead of producing empty recall', async (t) => {
  const { core, model } = fixture(t);
  admit(core, filler + fact);
  let measuredExcerpt = false;
  model.countTokens = (text) => {
    let envelope;
    try { envelope = JSON.parse(text); } catch { return 1; }
    if (envelope?.ok === true && envelope.value?.items?.some((item) =>
      item.type === 'unfiled' && item.label.includes('saffron'))) {
      measuredExcerpt = true;
      return 4001;
    }
    return 1;
  };
  assert.equal(ok(core.map({ namespace })).items.length, 1, 'unchanged prefix map still fits');
  assert.deepEqual(await recall(core),
    { ok: false, error: { code: 'context_item_too_large', retryable: false } });
  assert.equal(measuredExcerpt, true);
  assert.equal(model.calls.length, 0);
});
