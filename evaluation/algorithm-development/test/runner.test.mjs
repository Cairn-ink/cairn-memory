import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { createExperimentBudget, inspectExperimentBudgetForEmbeddingUpgrade,
  upgradeExperimentBudgetForEmbeddings, inspectEmbeddingExperimentBudgetSnapshot } from '../../experiment-budget/index.mjs';
import { createAlgorithmDevelopmentTransport, freezeObservation } from '../transport.mjs';
import { runAlgorithmDevelopmentComparison } from '../runner.mjs';

const key = 'synthetic-algorithm-secret';
function fixture(t, override = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'algorithm-development-' });
  const configuration = { directory: join(workspace.path, 'ledger'), runId: randomUUID(),
    limitMicroUsd: 400_000_000, requestCap: 100_000 };
  createExperimentBudget(configuration).close();
  const old = inspectExperimentBudgetForEmbeddingUpgrade(configuration);
  upgradeExperimentBudgetForEmbeddings({ ...configuration, expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 }, expectedHistorySha256: old.historySha256 });
  const state = inspectEmbeddingExperimentBudgetSnapshot(configuration), callbacks = [];
  const transport = createAlgorithmDevelopmentTransport({ configuration, checkpoint: { requestCount: 0, reservedMicroUsd: 0 },
    historySha256: state.historySha256, apiKey: key, fetchImpl: fakeProvider(), onRecord: row => { callbacks.push(row); }, ...override });
  workspace.defer(() => transport.close());
  const outputDirectory = join(workspace.path, 'observations'); mkdirSync(outputDirectory);
  return { workspace, configuration, transport, callbacks, outputDirectory };
}
const sources = [
  'On 2026-10-01 the display choice had a basis: the gallery lease remained active.',
  'The display archive records ordinary inventory notes without resolving the current decision. '.repeat(3)
    + 'On 2026-10-02 the lease ended; reconfirm the prior choice before using it.',
];
function cases() {
  return freezeObservation(Array.from({ length: 24 }, (_, index) => ({ id: `D${String(index + 1).padStart(2, '0')}`,
    family: 'synthetic-exposure', question: { text: 'display: basis; reconfirm', date: '2026-10-03' },
    sessions: sources.map((content, i) => ({ id: `session-${i}`, eventTime: `2026-10-0${i + 1}T09:00:00Z`,
        messages: [{ role: i ? 'assistant' : 'user', content }] })) })));
}
function envelope(output) {
  return { object: 'response', model: 'gpt-4.1-mini-2025-04-14', status: 'completed', error: null,
    incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
    usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 } };
}
// This fake model reads only actual HTTP requests. It has no case gold, source
// fixture closure, target IDs or required-anchor knowledge.
function fakeProvider(intercept = () => null) {
  return async (url, options) => {
    const failure = intercept(url, options); if (failure) return failure;
    assert.equal(options.headers.Authorization, `Bearer ${key}`);
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'gpt-4.1-mini-2025-04-14');
    if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 120 });
    if (url.endsWith('/chat/completions')) {
      const evidence = JSON.parse(body.messages[1].content).evidence;
      return Response.json({ object: 'chat.completion', model: body.model,
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: evidence.map(row => row.text).join('\n') } }],
        usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 } });
    }
    const input = JSON.parse(body.input[0].content[0].text), method = body.text.format.name;
    let output;
    if (method === 'cairn_extract') output = { items: input.messages.slice(0, 5).map(message => ({
      content: message.content.slice(0, 600), kind: 'fact', confidence: 0.8, sourceIndices: [message.index] })) };
    else if (method === 'cairn_classify') output = { items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) };
    else if (method === 'cairn_select') {
      const question = JSON.parse(input.query).question;
      const cues = question.split(':').slice(1).join(':').split(';').map(cue => cue.trim().toLowerCase());
      output = { refs: input.maps.flatMap(map => map.items.filter(item => cues.some(cue =>
        new Set(item.label.toLowerCase().match(/[\p{L}\p{N}]+/gu)).has(cue))).map(item => ({
        namespaceIndex: map.namespaceIndex, memoryId: item.ref.memoryId ?? item.ref.childId,
        revision: item.ref.revision ?? item.ref.childRevision }))).slice(0, input.maxRefs) };
    } else output = { refs: input.candidates.slice(0, input.limit).map(candidate => ({ namespaceIndex: candidate.namespaceIndex,
      memoryId: candidate.memory.id, revision: candidate.memory.revision })) };
    return Response.json(envelope(output));
  };
}

test('capture once; cold paired real-core arms preserve identity and expose late qualifier only through full labels', async t => {
  const f = fixture(t), durable = [];
  const result = await runAlgorithmDevelopmentComparison({ cases: cases(), transport: f.transport,
    outputDirectory: f.outputDirectory, onCase: row => { durable.push(row); } });
  assert.equal(result.fatal, null); assert.equal(result.denominator, 24); assert.equal(result.observations.length, 24);
  assert.equal(durable.length, 24); assert.equal(Object.isFrozen(durable[0].arms.full), true);
  assert.equal(Object.isFrozen(result.observations[0].capture), true);
  assert.deepEqual(result.observations.slice(0, 2).map(row => row.order), [['baseline', 'full'], ['full', 'baseline']]);
  for (const row of result.observations) {
    assert.equal(row.capture.status, 'completed', JSON.stringify(row.capture));
    assert.equal(row.capture.inputs.length, 2); assert.equal(row.capture.outcomes.length, 2);
    assert.equal(row.capture.modelCalls.filter(call => call.method === 'extract').length, 2);
    assert.equal(row.capture.modelCalls.filter(call => call.method === 'classify').length, 2);
    assert.equal(row.navigation.firstCandidateIdentityEqual, true, JSON.stringify(Object.values(row.arms).map(arm => ({ status: arm.status, failure: arm.failure }))));
    assert.equal(row.navigation.coreInputSequenceEqual, true);
    assert.equal(row.navigation.candidateSequenceEqual, true);
    assert.equal(row.navigation.rankInputSequenceEqual, false);
    const baseline = row.arms.baseline, full = row.arms.full;
    assert.equal(baseline.modelCalls.filter(call => call.method === 'select').length, 1);
    assert.equal(full.modelCalls.filter(call => call.method === 'select').length, 1);
    assert.equal(baseline.status, 'completed', JSON.stringify(baseline)); assert.equal(full.status, 'completed', JSON.stringify(full));
    assert.equal(baseline.recalled.memories.length, 1); assert.equal(full.recalled.memories.length, 2);
    assert.equal(baseline.answer.includes('reconfirm'), false); assert.equal(full.answer.includes('reconfirm'), true);
    assert.ok(full.modelCalls.find(call => call.method === 'select').labelBytes > baseline.modelCalls.find(call => call.method === 'select').labelBytes);
    for (const arm of [baseline, full]) {
      assert.equal(arm.stateBefore, row.capture.stateSha256); assert.equal(arm.stateAfter, row.capture.stateSha256);
      const excerpts = arm.recalled.memories.flatMap(memory => memory.receipts.map(receipt => receipt.excerpt));
      for (const unit of arm.evidence.units) assert.ok(excerpts.includes(unit.text));
      assert.ok(arm.evidence.units.every(unit => unit.text.includes('[session-date: 2026-10-')));
      assert.equal(arm.packed.omittedIndices.length, 0);
    }
    assert.ok(row.capture.receipts.every(detail => detail.receipts.every(receipt => receipt.createdAt !== '2026-10-01T09:00:00Z')));
    assert.ok(existsSync(join(f.outputDirectory, `${String(row.ordinal).padStart(2, '0')}-${row.id}`, 'memory.sqlite')));
  }
  assert.equal(f.callbacks.length, result.records.length * 2);
  assert.equal(result.finalBudget.reservedMicroUsd, result.records.length * 5000);
  assert.equal(JSON.stringify(result).includes(key), false);
  assert.equal(Object.hasOwn(result.observations[0], 'score'), false);
  for (const file of ['runner.mjs', 'transport.mjs']) assert.doesNotMatch(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), /from ['"].*(?:rubric|gold|oracle)/u);
});

test('ordinary capture and arm failures remain in fixed denominator without replacement or retry', async t => {
  let extracts = 0, answers = 0;
  const f = fixture(t, { fetchImpl: fakeProvider((url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith('/responses') && body.text.format.name === 'cairn_extract' && ++extracts === 1)
      return Response.json(envelope({ items: [{ invalid: true }] }));
    if (url.endsWith('/chat/completions') && ++answers === 1) return Response.json({ error: 'temporary' }, { status: 503 });
    return null;
  }) });
  const result = await runAlgorithmDevelopmentComparison({ cases: cases(), transport: f.transport, outputDirectory: f.outputDirectory });
  assert.equal(result.fatal, null); assert.equal(result.observations.length, 24);
  assert.equal(result.observations[0].capture.status, 'unresolved');
  assert.ok(Object.values(result.observations[0].arms).every(arm => arm.failureStage === 'capture'));
  assert.equal(result.observations[1].arms.full.status, 'unresolved');
  assert.equal(result.observations[1].arms.baseline.status, 'completed');
  assert.equal(answers, 46); assert.equal(extracts, 47);
  assert.equal(result.observations[1].arms.full.records.filter(row => row.method === 'answer').length, 1);
});

test('fatal authentication stops dispatch but retains all 48 arm slots and durable cases', async t => {
  let calls = 0, durable = 0;
  const f = fixture(t, { fetchImpl: async () => { calls++; return Response.json({ error: 'denied' }, { status: 401 }); } });
  const result = await runAlgorithmDevelopmentComparison({ cases: cases(), transport: f.transport, outputDirectory: f.outputDirectory,
    onCase: () => { durable++; } });
  assert.equal(result.fatal, 'algorithm_auth_transport_failure'); assert.equal(calls, 1); assert.equal(durable, 24);
  assert.equal(result.observations.flatMap(row => Object.values(row.arms)).length, 48);
  assert.ok(result.observations.every(row => Object.values(row.arms).every(arm => arm.status === 'unresolved')));
});
