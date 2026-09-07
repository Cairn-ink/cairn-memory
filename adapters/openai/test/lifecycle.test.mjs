import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test, { after, mock } from 'node:test';
import { createOpenAIModel } from '../index.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';

const nativeGuard = mock.method(globalThis, 'fetch', () => assert.fail('Native fetch is forbidden in offline tests'));
after(() => nativeGuard.mock.restore());
const ns = { ownerId: 'offline-adapter-test', scope: 'personal', projectId: null };
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
const json = (value) => new Response(JSON.stringify(value));
function fixture(t, generation) {
  const calls = [];
  const model = createOpenAIModel({ apiKey: 'offline-synthetic-key', fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body); calls.push({ url, body });
    if (String(url).endsWith('/input_tokens')) return json({ object: 'response.input_tokens', input_tokens: 100 });
    const message = body.input[0].content;
    const input = JSON.parse(typeof message === 'string' ? message : message[0].text);
    const output = generation(body.text.format.name, input);
    return json({ id: 'resp_synthetic', object: 'response', model: 'gpt-4.1-mini-2025-04-14', status: 'completed', error: null, incomplete_details: null,
      output: [{ id: 'msg_synthetic', type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: JSON.stringify(output), annotations: [] }] }],
      usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } });
  } });
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-openai-offline-')), 'memory.sqlite');
  const core = openMemoryCore({ path, model }); t.after(() => core.close());
  return { core, calls, path };
}
const captureInput = { namespace: ns, client: 'offline-test', sessionId: 'synthetic-session', eventId: 'synthetic-batch',
  messages: [{ id: 'synthetic-source', role: 'user', content: 'Use SQLite for this synthetic example.' }] };
function scripted(method, input) {
  if (method === 'cairn_extract') return { items: [{ content: 'Use SQLite for this synthetic example.',
    kind: 'decision', confidence: 0.9, sourceIndices: [0] }] };
  if (method === 'cairn_classify') return { items: input.memories.map((memory) => ({ memoryId: memory.id, parentIds: [],
    newL1: { title: 'Synthetic storage choices', parentL2Ids: [] } })) };
  if (method === 'cairn_select') return { refs: input.maps.flatMap(({ namespaceIndex, items }) => items.flatMap((item) =>
    item.type === 'unfiled' ? [{ namespaceIndex, ...item.ref }] : item.type === 'ref' && item.ref.childType === 'memory'
      ? [{ namespaceIndex, memoryId: item.ref.childId, revision: item.ref.childRevision }] : [])) };
  assert.equal(method, 'cairn_rank');
  return { refs: input.candidates.slice(0, input.limit).map(({ namespaceIndex, memory }) =>
    ({ namespaceIndex, memoryId: memory.id, revision: memory.revision })) };
}
const recall = (core) => core.recall({ readSet: [ns], query: 'Synthetic storage choice' });

test('A05: actual adapter/tokenizer and mocked HTTP complete SQLite capture/classify/recall/correct/forget', async (t) => {
  const { core, calls } = fixture(t, scripted);
  const capture = ok(await core.capture(captureInput));
  assert.equal(capture.classification.status, 'applied'); assert.equal(capture.admission.memories.length, 1);
  const id = capture.admission.memories[0].id;
  const before = ok(core.get({ namespace: ns, memoryId: id }));
  assert.equal(before.memory.origin, 'agent-inferred');
  assert.equal(before.receipts[0].eventId, 'synthetic-source');
  assert.equal(before.receipts[0].excerpt, captureInput.messages[0].content);
  assert.equal(before.receipts[0].sessionId, captureInput.sessionId);
  const initialRecall = ok(await recall(core));
  assert.deepEqual(initialRecall.memories[0].memory, before.memory);
  assert.deepEqual(initialRecall.memories[0].receipts, before.receipts);
  const replayCalls = calls.length;
  assert.equal(ok(await core.capture(captureInput)).duplicate, true); assert.equal(calls.length, replayCalls);
  ok(core.correct({ namespace: ns, memoryId: id, expectedRevision: before.memory.revision,
    content: 'Use a fresh SQLite database per offline test.', kind: 'instruction', receipt: {
      client: 'offline-test', sessionId: 'synthetic-session', eventId: 'synthetic-correction', role: 'user', excerpt: 'Fresh per test.',
    } }));
  const corrected = ok(core.get({ namespace: ns, memoryId: id }));
  const correctedRecall = ok(await recall(core));
  assert.deepEqual(correctedRecall.memories[0].memory, corrected.memory);
  assert.deepEqual(correctedRecall.memories[0].receipts, corrected.receipts);
  ok(core.forget({ namespace: ns, memoryId: id, expectedRevision: corrected.memory.revision }));
  const forgotten = ok(await recall(core));
  assert.deepEqual(forgotten.memories, []); assert.equal(forgotten.coverage, 'complete');
  assert.ok(calls.length > 0 && calls.length % 2 === 0);
  for (let i = 0; i < calls.length; i += 2) {
    assert.equal(String(calls[i].url), 'https://api.openai.com/v1/responses/input_tokens');
    assert.equal(String(calls[i + 1].url), 'https://api.openai.com/v1/responses');
  }
  const extract = calls.find((call) => call.body.text.format.name === 'cairn_extract');
  assert.ok(!JSON.stringify(extract.body).includes('synthetic-session'));
  assert.ok(!JSON.stringify(extract.body).includes('synthetic-source'));
});

test('A05: adapter output cannot forge capture source authority or recall foreign namespace refs', async (t) => {
  const extraction = fixture(t, (method, input) => method === 'cairn_extract'
    ? { items: [{ content: 'Forged evidence', kind: 'fact', confidence: 1, sourceIndices: [99] }] }
    : scripted(method, input));
  assert.deepEqual(await extraction.core.capture(captureInput), { ok: false, error: { code: 'invalid_model_output', retryable: false } });
  let foreign;
  const recallFixture = fixture(t, (method, input) => method === 'cairn_select'
    ? { refs: [{ namespaceIndex: 1, memoryId: foreign.id, revision: foreign.revision }] } : scripted(method, input));
  foreign = ok(recallFixture.core.admit({ namespace: { ...ns, ownerId: 'foreign' }, memory: { content: 'Foreign synthetic evidence', kind: 'fact' },
    receipts: [{ client: 'test', sessionId: 's', eventId: 'e', role: 'user', excerpt: 'Foreign source' }] })).memory;
  assert.deepEqual(await recall(recallFixture.core), { ok: false, error: { code: 'invalid_model_output', retryable: false } });
});

test('A05: another connection changes a fetched candidate during mocked rank; final SQLite snapshot rejects it', async (t) => {
  let other;
  const { core, path } = fixture(t, (method, input) => {
    if (method === 'cairn_rank') {
      const memory = input.candidates[0].memory;
      ok(other.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
    }
    return scripted(method, input);
  });
  ok(await core.capture(captureInput));
  other = openMemoryCore({ path }); t.after(() => other.close());
  assert.deepEqual(await recall(core), { ok: false, error: { code: 'revision_conflict', retryable: false } });
});
