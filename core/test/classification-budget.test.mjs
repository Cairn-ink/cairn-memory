import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';
import { packClassification, TEXT_FLOOR } from '../model-packing.mjs';
import { createCjkTokenCounter } from '../testing/cjk-token-counter.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

// Synthetic topics and memories only; the counter is shaped like a real
// tokenizer (CJK about one token per character), not a provider tokenizer.
const namespace = { ownerId: 'cr1-classify', scope: 'personal', projectId: null };
const countTokens = createCjkTokenCounter();
const system = readFileSync(new URL('../prompts/classify-placement.md', import.meta.url), 'utf8');
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r).slice(0, 400)); return r.value; };
const passage = '我們今天把部署流程重新整理了一遍，決定先在測試環境驗證資料庫遷移，再請團隊成員檢查設定檔與監控告警。';
const zh = (length, seed = 0) => Array.from({ length }, (_, i) => passage[(seed * 5 + i) % passage.length]).join('');
const requestTokens = (input) => countTokens(JSON.stringify({ system, input, maxOutputTokens: 1024 }));

function fixture(t, classify) {
  const ws = createTestWorkspace(t, { prefix: 'cr1-classify-' });
  const calls = [];
  const model = { contextWindow: 8192, countTokens, async classify(request) {
    calls.push({ tokens: requestTokens(request.input), input: structuredClone(request.input) });
    return classify(request);
  } };
  const core = openMemoryCore({ path: join(ws.path, 'memory.sqlite'), model });
  t.after(() => core.close());
  let events = 0;
  const admit = (content) => ok(core.admit({ namespace, memory: { content, kind: 'fact' },
    receipts: [{ client: 'wiki', sessionId: 's', eventId: `event-${events++}`, role: 'user', excerpt: content.slice(0, 800) }] })).memory;
  const catalog = () => ok(core.map({ namespace, purpose: 'classification' }));
  return { core, calls, admit, catalog };
}

test('CR1 classification of long Chinese memories against a full topic catalog stays within budget', async (t) => {
  const reuse = ({ input }) => ({ items: input.memories.map((memory) => ({ memoryId: memory.id,
    parentIds: [input.map.find((item) => item.moc.level === 'L1').moc.id] })) });
  const f = fixture(t, reuse);
  // Eighty topics fill most of one complete 4,000-token catalog page.
  for (let batch = 0; batch < 16; batch++) {
    const seeds = Array.from({ length: 5 }, (_, i) => f.admit(`主題種子${batch * 5 + i}`));
    ok(f.core.applyPlacement({ namespace, proposal: { items: seeds.map((memory, i) => ({ memoryId: memory.id,
      parentIds: [], newL1: { title: `部署主題${batch * 5 + i}：監控與遷移計畫`, parentL2Ids: [] } })) },
    expectedMemoryRevisions: seeds.map((memory) => ({ memoryId: memory.id, revision: memory.revision })),
    expectedIndexRevision: f.catalog().indexRevision }));
  }
  const targets = Array.from({ length: 5 }, (_, i) => f.admit(`長篇決定${i}：${zh(600, i)}`));
  const snapshot = targets.map((memory) => ok(f.core.get({ namespace, memoryId: memory.id })).memory);
  const classified = ok(await f.core.classifyPlacement({ namespace, memoryIds: targets.map((memory) => memory.id),
    expectedMemoryRevisions: targets.map((memory) => ({ memoryId: memory.id, revision: memory.revision })),
    mapRevision: f.catalog().indexRevision }));
  const [call] = f.calls;
  assert.ok(call.tokens <= 6000, `classify request counted ${call.tokens}`);
  assert.equal(call.input.map.length, 80, 'shortening memory text first keeps the complete catalog');
  assert.equal(call.input.mapExhausted, true);
  const unpacked = requestTokens({ memories: snapshot.map((memory) => ({ ...memory })), map: call.input.map, mapExhausted: true });
  assert.ok(unpacked > 6000, `unpacked classify request counted ${unpacked}`);
  for (const [index, memory] of call.input.memories.entries()) {
    assert.deepEqual([memory.id, memory.revision], [targets[index].id, targets[index].revision]);
    assert.ok(snapshot[index].content.startsWith(memory.content) && memory.contentShortened === true);
    assert.ok([...memory.content].length >= TEXT_FLOOR);
  }
  assert.deepEqual(classified.classificationTruncated, { memoriesShortened: 5, catalogItemsOmitted: 0 });
  assert.equal(classified.basedOn.mapExhausted, true);
  const applied = ok(f.core.applyPlacement({ namespace, proposal: classified.proposal,
    expectedMemoryRevisions: classified.basedOn.memoryRevisions, expectedIndexRevision: classified.basedOn.indexRevision }));
  assert.equal(applied.memories.length, 5);
  for (const [index, memory] of targets.entries()) {
    assert.equal(ok(f.core.get({ namespace, memoryId: memory.id })).memory.content, snapshot[index].content);
  }
});

test('CR1 packClassification leaves a catalog tail out only after memories reach the floor', () => {
  const memory = (i) => ({ id: `m${i}`, revision: 1, kind: 'fact', content: 'x'.repeat(2000) });
  const topic = (i) => ({ type: 'moc', moc: { id: `t${i}`, level: 'L1', title: 'y'.repeat(40), revision: 1 } });
  const input = { memories: [memory(0), memory(1)], map: Array.from({ length: 60 }, (_, i) => topic(i)), mapExhausted: true };
  const length = (text) => [...text].length;
  const model = { countTokens: length };
  const packed = packClassification(model, 'system', input);
  assert.ok(length(JSON.stringify({ system: 'system', input: packed.input, maxOutputTokens: 1024 })) <= 6000);
  assert.ok(packed.catalogItemsOmitted > 0);
  assert.equal(packed.input.mapExhausted, false, 'a partial catalog forbids new topics');
  assert.deepEqual(packed.input.map, input.map.slice(0, 60 - packed.catalogItemsOmitted));
  assert.ok(packed.input.memories.every((item) => item.content.length >= TEXT_FLOOR && item.content.length < 2000));
  assert.ok(length(JSON.stringify({ system: 'system', input: { ...packed.input,
    map: input.map.slice(0, 61 - packed.catalogItemsOmitted), memories: input.memories.map((item) =>
      ({ ...item, content: 'x'.repeat(TEXT_FLOOR), contentShortened: true })) }, maxOutputTokens: 1024 })) > 6000,
  'one more topic would not fit even at the floor');
  assert.deepEqual(packClassification(model, 'system', input), packed, 'deterministic');
  const small = { memories: [memory(0)], map: [], mapExhausted: true };
  assert.equal(packClassification({ countTokens: () => 1 }, 'system', small).input, small);
  assert.equal(packClassification({ countTokens: () => 6001 }, 'system', small).overflow, true);
});

test('CR1 classification refuses a topic that packing left out of its request', async (t) => {
  const ws = createTestWorkspace(t, { prefix: 'cr1-classify-hidden-' });
  const topics = [];
  const requests = [];
  const counter = (text) => [...text].length;
  const model = { contextWindow: 8192, countTokens: counter, async classify({ system: prompt, input }) {
    requests.push(counter(JSON.stringify({ system: prompt, input, maxOutputTokens: 1024 })));
    const shown = new Set(input.map.map((item) => item.moc.id));
    const hidden = topics.find((topic) => !shown.has(topic.id));
    assert.ok(hidden && input.mapExhausted === false && shown.size < topics.length);
    return { items: input.memories.map((memory) => ({ memoryId: memory.id, parentIds: [hidden.id] })) };
  } };
  const core = openMemoryCore({ path: join(ws.path, 'memory.sqlite'), model });
  t.after(() => core.close());
  let events = 0;
  const seed = (content) => ok(core.admit({ namespace, memory: { content, kind: 'fact' },
    receipts: [{ client: 'wiki', sessionId: 's', eventId: `event-${events++}`, role: 'user', excerpt: content.slice(0, 800) }] })).memory;
  for (let batch = 0; batch < 6; batch++) {
    const seeds = Array.from({ length: 5 }, (_, i) => seed(`topic seed ${batch * 5 + i}`));
    const placed = ok(core.applyPlacement({ namespace, proposal: { items: seeds.map((memory, i) => ({ memoryId: memory.id,
      parentIds: [], newL1: { title: `T${String(batch * 5 + i).padStart(2, '0')}`, parentL2Ids: [] } })) },
    expectedMemoryRevisions: seeds.map((memory) => ({ memoryId: memory.id, revision: memory.revision })),
    expectedIndexRevision: ok(core.map({ namespace, purpose: 'classification' })).indexRevision }));
    topics.push(...placed.createdMocs);
  }
  // Catalog order is level, title, ID: the first unshown topic is the first one packing cut.
  topics.sort((left, right) => left.title < right.title ? -1 : 1);
  const targets = Array.from({ length: 5 }, (_, i) => seed(`target ${i} ${'w'.repeat(3900)}`));
  const result = await core.classifyPlacement({ namespace, memoryIds: targets.map((memory) => memory.id),
    expectedMemoryRevisions: targets.map((memory) => ({ memoryId: memory.id, revision: memory.revision })),
    mapRevision: ok(core.map({ namespace, purpose: 'classification' })).indexRevision });
  assert.equal(requests.length, 1);
  assert.ok(requests[0] <= 6000);
  assert.deepEqual(result, { ok: false, error: { code: 'invalid_model_output', retryable: false } });
  for (const memory of targets) assert.equal(ok(core.get({ namespace, memoryId: memory.id })).memory.filing.status, 'unfiled');
});
