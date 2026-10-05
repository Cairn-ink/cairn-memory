import assert from 'node:assert/strict';
import test from 'node:test';
import { createQueryScore } from '../../../core/query-candidates.mjs';
import { admitSynthetic, allReceipts, coldThrowingModel, createPartitionFixture, fileVisible, listAll,
  memoryDetails, memoryRef, namespace, placeSynthetic, requireOk, visibleMemoryRefs } from '../fixtures.mjs';

const query = 'lantern anchor';
const body = index => 'SYNTHETIC lantern anchor note ' + String(index).padStart(3, '0') + '.';
const asciiOrder = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const recall = core => core.recall({ readSet: [namespace], query, limit: 1 });
function pages(core, options = {}) {
  const result = []; let cursor;
  do {
    const page = requireOk(core.map({ namespace, limit: 100, ...options, ...(cursor ? { cursor } : {}) }));
    result.push(page); cursor = page.nextCursor;
    assert.equal(page.exhausted, cursor === null);
  } while (cursor);
  return result;
}
const topic = (core, memoryId, title) => placeSynthetic(core, memoryId,
  { parentIds: [], newL1: { title, parentL2Ids: [] } }).createdMocs.find(moc => moc.level === 'L1');
function truncation(value) {
  if (!value.recallTruncated) return;
  assert.deepEqual(Object.keys(value.recallTruncated).sort(),
    ['navigationItemsOmitted', 'candidatesOmitted', 'candidatesShortened', 'receiptListsCapped'].sort());
  assert.ok(Object.values(value.recallTruncated).every(count => Number.isSafeInteger(count) && count >= 0));
}

test('SP7 public 101-card two-topic/101-topic maps differ, ordinary recall sees query-aware memory refs not topics', async t => {
  for (const topicCount of [2, 101]) {
    let target;
    // Explicit structural test units: all full envelopes measure one unit.
    // This isolates page cardinality, not real token fit or semantic relevance.
    const f = createPartitionFixture(t, { countTokens: () => 1,
      select: ({ input }) => ({ refs: visibleMemoryRefs(input).filter(ref => ref.memoryId === target) }) });
    const memories = Array.from({ length: 101 }, (_, index) => admitSynthetic(f.core, body(index)));
    const groups = memories.slice(0, topicCount).map((memory, index) => topic(f.core, memory.id,
      'Synthetic topic ' + String(index).padStart(3, '0')));
    for (let index = topicCount; index < memories.length; index++)
      placeSynthetic(f.core, memories[index].id, { parentIds: [groups[index % groups.length].id] });
    target = memories.at(-1).id;
    assert.equal(listAll(f.core).length, 101);
    const publicPages = pages(f.core);
    assert.equal(publicPages[0].exhausted, false);
    assert.equal(publicPages[0].truncatedBy, 'page_limit');
    assert.equal(publicPages.flatMap(page => page.items).filter(item => item.type === 'moc').length, topicCount);
    assert.ok(publicPages.every(page => !Object.hasOwn(page, 'classificationTruncated')));
    const classifierMap = pages(f.core, { purpose: 'classification' });
    assert.equal(classifierMap.flatMap(page => page.items).filter(item => item.type === 'moc').length, topicCount);
    f.close();
    const cold = f.open(f.model), recalled = requireOk(await recall(cold.core));
    assert.deepEqual(recalled.memories.map(item => item.memory.id), [target]);
    const selectCalls = f.calls.filter(call => call.method === 'select');
    assert.ok(selectCalls.length >= 1 && selectCalls.length <= 2);
    assert.ok(selectCalls.every(call => call.input.maps.every(page => page.items.every(item => memoryRef(item) !== null))));
    assert.ok(selectCalls.every(call => call.input.maps.every(page => page.items.every(item => item.type !== 'moc'))));
    truncation(recalled);
    const seed = requireOk(cold.core.get({ namespace, memoryId: memories[0].id })).memory;
    requireOk(cold.core.forget({ namespace, memoryId: seed.id, expectedRevision: seed.revision }));
    const afterForget = pages(cold.core, { purpose: 'classification' }).flatMap(page => page.items);
    assert.equal(afterForget.find(item => item.type === 'moc' && item.moc.id === groups[0].id).moc.title, null);
    assert.equal(listAll(cold.core).length, 100);
    cold.close();
  }
});

test('SP7 same bodies and IDs survive cold unfiled/correct/misleading/multiparent filing in ONE DB', async t => {
  let target;
  const f = createPartitionFixture(t, { countTokens: () => 1,
    select: ({ input }) => ({ refs: visibleMemoryRefs(input).filter(ref => ref.memoryId === target) }) });
  const memory = admitSynthetic(f.core, body(0)); target = memory.id;
  const correctSeed = admitSynthetic(f.core, 'SYNTHETIC correct-topic backing source.'),
    misleadingSeed = admitSynthetic(f.core, 'SYNTHETIC misleading-topic backing source.');
  const correct = topic(f.core, correctSeed.id, 'Lantern anchor evidence'),
    misleading = topic(f.core, misleadingSeed.id, 'Completely unrelated violet mountains');
  let current = f;
  for (const [label, parents] of [['unfiled', []], ['correct', [correct.id]],
    ['misleading', [misleading.id]], ['multiparent', [correct.id, misleading.id]]]) {
    placeSynthetic(current.core, target, { parentIds: parents }); // Fresh memory/index guards every time.
    current.close(); current = f.open(f.model);
    const detail = requireOk(current.core.get({ namespace, memoryId: target }));
    assert.equal(detail.memory.content, body(0));
    assert.equal(detail.memory.id, target);
    assert.equal(detail.placements.length, parents.length);
    const beforeCalls = f.calls.length, result = requireOk(await recall(current.core));
    assert.deepEqual(result.memories.map(item => item.memory.id), [target], label);
    const calls = f.calls.slice(beforeCalls).filter(call => call.method === 'select');
    const shown = calls.flatMap(call => call.input.maps.flatMap(page => page.items));
    assert.equal(shown.filter(item => memoryRef(item)?.memoryId === target).length, 1);
    assert.equal(shown.find(item => memoryRef(item)?.memoryId === target).type, parents.length ? 'ref' : 'unfiled');
    for (const placement of detail.placements) {
      const parentPage = requireOk(current.core.map({ namespace,
        parentRef: { mocId: placement.mocId, revision: placement.mocRevision } }));
      assert.ok(parentPage.items.some(item => item.type === 'ref' && item.ref.childId === target));
    }
    assert.equal(allReceipts(current.core, target).length, 1);
  }
});

test('SP7 actual stable-ID-last 201st equal-overlap card is cold-present but outside two 100-item recall pages', async t => {
  let target;
  const countedPages = [];
  // Declared UTF16/8 mechanical units, deliberately NOT o200k or char/4.
  // Record actual complete map envelopes to prove 100 fit, not assume it.
  const counter = text => {
    const units = Math.ceil(text.length / 8);
    if (text.startsWith('{')) {
      const parsed = JSON.parse(text);
      if (parsed.ok === true && Array.isArray(parsed.value?.items) && parsed.value.items.length === 100)
        countedPages.push({ units, value: structuredClone(parsed.value) });
    }
    return units;
  };
  const f = createPartitionFixture(t, { countTokens: counter,
    select: ({ input }) => ({ refs: visibleMemoryRefs(input).filter(ref => ref.memoryId === target) }) });
  const memories = Array.from({ length: 201 }, (_, index) => admitSynthetic(f.core, body(index)));
  assert.equal(new Set(memories.map(memory => memory.id)).size, 201);
  assert.equal(new Set(memoryDetails(f.core).map(memory => memory.content)).size, 201);
  const score = createQueryScore(query);
  assert.ok(memoryDetails(f.core).every(memory => score(memory.content) === 2));
  const ordered = memories.map(memory => memory.id).sort(asciiOrder); target = ordered.at(-1);
  f.close();
  const cold = f.open(f.model);
  assert.equal(listAll(cold.core).length, 201);
  assert.equal(requireOk(cold.core.get({ namespace, memoryId: target })).memory.id, target);
  const result = requireOk(await recall(cold.core));
  assert.equal(result.memories.length, 0);
  assert.deepEqual(f.calls.map(call => call.method), ['select', 'select']);
  const selections = f.calls.map(call => call.input.maps[0]);
  assert.deepEqual(selections.map(page => page.items.length), [100, 100]);
  assert.deepEqual(selections.flatMap(page => page.items.map(item => memoryRef(item).memoryId)), ordered.slice(0, 200));
  assert.ok(selections.every(page => !page.exhausted));
  assert.equal(result.namespaces[0].mapExhausted, false);
  assert.equal(result.namespaces[0].fetchExhausted, true);
  assert.equal(result.coverage, 'budget_exhausted');
  assert.ok(countedPages.length >= 2 && countedPages.every(page => page.units <= 4000));
  assert.equal(result.recallTruncated, undefined); // Page budget exhaustion is not packing truncation.
  cold.close();
  const reader = f.open(coldThrowingModel(counter));
  assert.equal(allReceipts(reader.core, target).length, 1);
});

// Add structural cost ONLY to complete select envelopes. Public map/fetch
// envelopes keep UTF16/8 units; no production limit or counter is modified.
function packingCounter(text) {
  const units = Math.ceil(text.length / 8);
  if (!text.startsWith('{')) return units;
  const parsed = JSON.parse(text);
  return units + (parsed.input?.maps?.reduce((sum, page) => sum + page.items.length, 0) ?? 0) * 1000;
}
for (const deny of [false, true]) test('SP7 positive navigation packing ' + (deny ? 'rejects actual hidden ref' : 'reports finite four metrics'), async t => {
  let hidden;
  const f = createPartitionFixture(t, { countTokens: packingCounter, select: ({ input }) => {
    const visible = visibleMemoryRefs(input);
    assert.ok(visible.length > 0 && visible.length < 100);
    assert.ok(!visible.some(ref => ref.memoryId === hidden.id));
    return { refs: deny ? [{ namespaceIndex: 0, memoryId: hidden.id, revision: hidden.revision }] : visible.slice(0, 1) };
  } });
  const memories = Array.from({ length: 100 }, (_, index) => admitSynthetic(f.core, body(index)));
  hidden = memories.toSorted((a, b) => asciiOrder(a.id, b.id)).at(-1);
  const result = await recall(f.core);
  if (deny) {
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'invalid_model_output');
    assert.deepEqual(f.diagnostics, [{ version: 1, stage: 'select', layer: 'core_validation', reason: 'non_visible_ref' }]);
    assert.deepEqual(f.calls.map(call => call.method), ['select']);
  } else {
    const value = requireOk(result); truncation(value);
    assert.ok(value.recallTruncated.navigationItemsOmitted > 0);
    assert.equal(value.coverage, 'budget_exhausted');
    assert.equal(value.memories.length, 1);
    assert.deepEqual(f.calls.map(call => call.method), ['select', 'rank']);
  }
  assert.equal(listAll(f.core).length, 100);
  assert.equal(allReceipts(f.core, hidden.id).length, 1);
});

test('SP7 actual classifier packing metrics are distinct from catalog paging and recall navigation metrics', async t => {
  const counted = [];
  // Structural units on complete classification requests only. The initial
  // public catalog is fully visible, then guarded request packing omits topics.
  const counter = text => {
    const basic = Math.ceil(text.length / 8);
    if (!text.startsWith('{')) return basic;
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed.input?.map) || !Array.isArray(parsed.input?.memories)) return basic;
    const units = 200 + parsed.input.map.length * 1000
      + parsed.input.memories.reduce((sum, memory) => sum + memory.content.length, 0);
    counted.push({ units, input: structuredClone(parsed.input) });
    return units;
  };
  const f = createPartitionFixture(t, { countTokens: counter, classify: fileVisible });
  for (let index = 0; index < 12; index++) {
    const memory = admitSynthetic(f.core, 'SYNTHETIC packing topic source ' + index + '.');
    topic(f.core, memory.id, 'Synthetic packing topic ' + String(index).padStart(2, '0'));
  }
  const memories = [0, 1].map(index => admitSynthetic(f.core, 'SYNTHETIC packing body ' + index + ' ' + 'x'.repeat(3800)));
  const catalog = requireOk(f.core.map({ namespace, purpose: 'classification' }));
  assert.equal(catalog.exhausted, true);
  assert.equal(catalog.items.filter(item => item.type === 'moc').length, 12);
  const result = requireOk(await f.core.classifyPlacement({ namespace, memoryIds: memories.map(memory => memory.id),
    expectedMemoryRevisions: memories.map(memory => ({ memoryId: memory.id, revision: memory.revision })),
    mapRevision: catalog.indexRevision }));
  assert.ok(counted.some(call => call.units > 6000 && call.input.map.length === 12));
  const emitted = f.calls.find(call => call.method === 'classify').input;
  assert.ok(emitted.map.length > 0 && emitted.map.length < 12);
  assert.equal(emitted.mapExhausted, false);
  assert.ok(emitted.memories.every(memory => memory.contentShortened === true));
  assert.deepEqual(result.classificationTruncated, { memoriesShortened: 2, catalogItemsOmitted: 12 - emitted.map.length });
  assert.equal(result.basedOn.mapExhausted, false);
  assert.equal(result.recallTruncated, undefined);
  assert.equal(listAll(f.core).length, 14); // Classification proposal is not application/admission.
});
