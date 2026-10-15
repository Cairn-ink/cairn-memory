import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { countOpenAITokens } from '../index.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';
import { captureSnapshot } from '../../../core/capture-input.mjs';
import { extractionRequest } from '../../../core/capture.mjs';
import { modelRequestText } from '../../../core/model-call.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { prepareSourcePartition, verifySourcePartition, SOURCE_PARTITION_POLICY } from '../../../evaluation/source-partition/offline.mjs';
import { messages21, sourceInput } from '../../../evaluation/source-partition/fixtures.mjs';

function fixture(t) {
  const previousFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = () => { fetchCalls++; assert.fail('Source partition local-tokenizer test must not fetch'); };
  t.after(() => { globalThis.fetch = previousFetch; });
  const workspace = createTestWorkspace(t, { prefix: 'synthetic-source-partition-tokenizer-' });
  let calls = 0;
  const forbidden = () => { calls++; assert.fail('Planning must not invoke any model port'); };
  const core = openMemoryCore({ path: join(workspace.path, 'memory.sqlite'),
    captureSourcePolicy: SOURCE_PARTITION_POLICY,
    model: { contextWindow: 8192, countTokens: countOpenAITokens,
      extract: forbidden, classify: forbidden, select: forbidden, rank: forbidden } });
  workspace.defer(() => core.close());
  return { core, countTokens: countOpenAITokens, calls: () => calls, fetchCalls: () => fetchCalls };
}
function exactTokens(part) {
  const snapshot = captureSnapshot(part, undefined, SOURCE_PARTITION_POLICY);
  const request = extractionRequest(snapshot, { captureSourcePolicy: SOURCE_PARTITION_POLICY });
  return countOpenAITokens(modelRequestText(request.system, request.input));
}

test('SP real local o200k counts the complete guarded extraction envelope without transport', t => {
  const f = fixture(t), input = sourceInput(messages21());
  const plan = prepareSourcePartition({ ...f, input });
  assert.deepEqual(plan.partitions.map(part => part.windowCount), [20, 1]);
  for (const part of [...plan.originalBatches, ...plan.partitions]) {
    assert.equal(part.extractionTokens, exactTokens(part));
    assert.equal(part.extractionFits, part.extractionTokens <= 6000);
  }
  assert.deepEqual(verifySourcePartition({ ...f, input, plan }), plan);
  assert.equal(f.calls(), 0);
  assert.equal(f.fetchCalls(), 0);
  // The measured envelope is core's system/input/maxOutputTokens text. This is
  // not remote input_tokens validation or a schema-overhead/provider-fit claim.
});

test('SP real tokenizer fit is separate from actual five/six UTF16 windows', t => {
  const f = fixture(t);
  const input = sourceInput([
    { id: 'synthetic-five', role: 'user', content: 'a'.repeat(4000) },
    { id: 'synthetic-six', role: 'assistant', content: 'a'.repeat(799) + '🧭' + 'a'.repeat(3199) },
  ]);
  const plan = prepareSourcePartition({ ...f, input });
  assert.equal(plan.origins.filter(origin => origin.messageId === 'synthetic-five').length, 5);
  assert.equal(plan.origins.filter(origin => origin.messageId === 'synthetic-six').length, 6);
  assert.ok(plan.partitions.every(part => part.extractionTokens === exactTokens(part) && part.extractionTokens <= 6000));
  assert.equal(f.calls(), 0);
  assert.equal(f.fetchCalls(), 0);
});

test('SP actual local-token budget partitions a fitting-window original without truncation', t => {
  const f = fixture(t), content = '記住這個'.repeat(1000);
  assert.equal(content.length, 4000);
  const input = sourceInput([0, 1].map(index => ({
    id: 'synthetic-token-heavy-' + index, role: 'user', content,
  })));
  const plan = prepareSourcePartition({ ...f, input });
  assert.equal(plan.originalBatches[0].windowCount, 10);
  assert.ok(plan.originalBatches[0].extractionTokens > 6000, 'Actual tokenizer fixture must exceed the original extraction budget');
  assert.equal(plan.originalBatches[0].extractionFits, false);
  assert.deepEqual(plan.partitions.map(part => part.windowCount), [5, 5]);
  assert.deepEqual(plan.partitions.flatMap(part => part.messages), input.sources[0].messages);
  assert.ok(plan.partitions.every(part => part.extractionTokens === exactTokens(part) && part.extractionTokens <= 6000));
  assert.equal(f.calls(), 0);
  assert.equal(f.fetchCalls(), 0);
});

test('SP real dense-script singleton exceeds tokens despite fitting actual windows and is refused whole', t => {
  const f = fixture(t);
  // Same Yi range as capture-budget.test.mjs, but the raw actual counter has
  // NO host padding. Every point is one UTF-16 unit and already canonical.
  const alphabet = Array.from({ length: 0xa48c - 0xa000 + 1 }, (_, index) =>
    String.fromCodePoint(0xa000 + index));
  const content = Array.from({ length: 4000 }, (_, index) => alphabet[index % alphabet.length]).join('');
  assert.equal(content.length, 4000);
  assert.equal(content.normalize('NFKC'), content);
  const input = sourceInput([{ id: 'synthetic-dense-yi', role: 'user', content }]);
  const source = input.sources[0];
  const snapshot = captureSnapshot({ namespace: input.namespace, client: input.client,
    sessionId: source.sessionId, eventId: source.baseEventId, messages: source.messages },
  undefined, SOURCE_PARTITION_POLICY);
  const request = extractionRequest(snapshot, { captureSourcePolicy: SOURCE_PARTITION_POLICY });
  const measured = countOpenAITokens(modelRequestText(request.system, request.input));
  assert.ok(measured > 6000, 'Raw actual tokenizer singleton must exceed 6000; no padding or fake counter');
  assert.equal(request.catalog.entries.length, 5);
  assert.ok(request.catalog.entries.length <= 20);
  assert.deepEqual(f.core.planCaptureBatches({ messages: source.messages }), {
    ok: true, value: { batches: [], oversizedMessageIndices: [0] },
  });
  assert.throws(() => prepareSourcePartition({ ...f, input }), error => error.code === 'diagnostic_message_unfit');
  assert.equal(f.calls(), 0);
  assert.equal(f.fetchCalls(), 0);
});
