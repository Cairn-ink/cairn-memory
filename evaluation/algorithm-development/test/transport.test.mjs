import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { createExperimentBudget, inspectExperimentBudgetForEmbeddingUpgrade,
  upgradeExperimentBudgetForEmbeddings, inspectEmbeddingExperimentBudgetSnapshot,
  reopenEmbeddingExperimentBudget } from '../../experiment-budget/index.mjs';
import { createAlgorithmDevelopmentTransport, algorithmLimits } from '../transport.mjs';

const key = 'synthetic-transport-secret';
const extractPrompt = readFileSync(new URL('../../../core/prompts/extract-source-windows.md', import.meta.url), 'utf8');
const request = () => ({ system: extractPrompt, input: { inputMode: 'indexed-windows-v1',
  messages: [{ index: 0, messageIndex: 0, role: 'user', content: 'Synthetic visible source.' }] },
  maxOutputTokens: 1024, signal: new AbortController().signal });
const envelope = (usage = { input_tokens: 100, output_tokens: 20, total_tokens: 120 }) => ({
  object: 'response', model: 'gpt-4.1-mini-2025-04-14', status: 'completed', error: null,
  incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: '{"items":[]}' }] }], usage });
const code = expected => error => error.code === expected;
function fixture(t, overrides = {}, configurationOverrides = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'algorithm-transport-' });
  const configuration = { directory: join(workspace.path, 'ledger'), runId: randomUUID(),
    limitMicroUsd: 400_000_000, requestCap: 100_000, ...configurationOverrides };
  createExperimentBudget(configuration).close();
  const old = inspectExperimentBudgetForEmbeddingUpgrade(configuration);
  upgradeExperimentBudgetForEmbeddings({ ...configuration, expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 }, expectedHistorySha256: old.historySha256 });
  const initial = inspectEmbeddingExperimentBudgetSnapshot(configuration), callbacks = [], calls = [];
  const options = { configuration, checkpoint: { requestCount: 0, reservedMicroUsd: 0 }, historySha256: initial.historySha256,
    apiKey: key, onRecord: row => { callbacks.push(row); }, fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return Response.json(url.endsWith('/input_tokens') ? { object: 'response.input_tokens', input_tokens: 100 } : envelope());
    }, ...overrides };
  const transport = createAlgorithmDevelopmentTransport(options); workspace.defer(() => transport.close());
  transport.beginCase({ id: 'D01', ordinal: 1 });
  return { options, configuration, transport, callbacks, calls };
}

test('exact adapter bodies, shared ledger history, reservations and durable pre/post records', async t => {
  const f = fixture(t);
  assert.deepEqual(await f.transport.model.extract(request()), { items: [] });
  assert.equal(f.calls.length, 2); assert.equal(f.callbacks.length, 4);
  assert.ok(f.callbacks.every(row => Object.isFrozen(row)));
  assert.equal(f.callbacks[0].outcome, 'unknown'); assert.equal(f.callbacks[1].outcome, 'succeeded');
  const count = JSON.parse(f.calls[0].options.body), generation = JSON.parse(f.calls[1].options.body);
  assert.deepEqual(generation, { ...count, max_output_tokens: 1024, store: false, stream: false });
  assert.equal(count.model, 'gpt-4.1-mini-2025-04-14'); assert.equal(count.text.format.name, 'cairn_extract');
  assert.equal(count.instructions, extractPrompt);
  assert.equal(f.transport.records()[1].actualMicroUsd, 72);
  const state = inspectEmbeddingExperimentBudgetSnapshot(f.configuration);
  assert.equal(state.requestCount, 2); assert.equal(state.reservedMicroUsd, 10_000);
  assert.deepEqual(state.attempts.map(row => row.channel), ['cairn-count', 'cairn-generation']);
  assert.equal(JSON.stringify(f.transport.records()).includes(key), false);
});

test('method, prompt, model and one-shot lifecycle stay bounded', async t => {
  const f = fixture(t);
  assert.equal(Object.keys(f.transport.model).sort().join(','), 'classify,contextWindow,countTokens,extract,rank,select');
  await assert.rejects(f.transport.model.extract({ ...request(), system: 'arbitrary prompt' }), code('algorithm_method_denied'));
  assert.equal(f.calls.length, 0);
  const another = fixture(t);
  another.transport.beginArm('baseline');
  assert.throws(() => another.transport.beginArm('baseline'), code('algorithm_lifecycle'));
  const reused = fixture(t); reused.transport.endCase();
  assert.throws(() => reused.transport.beginCase({ id: 'D01', ordinal: 2 }), code('algorithm_lifecycle'));
});

test('each answer is exact packMixedAnswer ChatCompletions and may be sent only once per arm', async t => {
  let calls = 0;
  const f = fixture(t, { fetchImpl: async (url, options) => {
    calls++; assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    const body = JSON.parse(options.body);
    assert.deepEqual(Object.keys(body), ['model', 'messages', 'temperature', 'max_tokens', 'n']);
    assert.equal(body.max_tokens, 512); assert.equal(body.temperature, 0); assert.equal(body.n, 1);
    assert.deepEqual(JSON.parse(body.messages[1].content), { evidence: [{ text: 'Actual receipt.' }],
      currentQuestion: { text: 'What was recorded?', date: '2026-10-03' } });
    return Response.json({ object: 'chat.completion', model: body.model,
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Recorded.' } }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } });
  } });
  f.transport.beginArm('baseline');
  const answer = { question: { text: 'What was recorded?', date: '2026-10-03' }, units: [{ text: 'Actual receipt.' }] };
  assert.equal((await f.transport.answer(answer)).answer, 'Recorded.');
  await assert.rejects(f.transport.answer(answer), code('algorithm_lifecycle')); assert.equal(calls, 1);
});

test('40 core calls includes capture plus recall; exhaustion stays local and next case can proceed', async t => {
  const f = fixture(t);
  for (let i = 0; i < 40; i++) await f.transport.model.extract(request());
  await assert.rejects(f.transport.model.extract(request()), code('algorithm_case_call_cap'));
  assert.equal(f.calls.length, 80); f.transport.assertHealthy(); f.transport.endCase();
  f.transport.beginCase({ id: 'D02', ordinal: 2 });
  await f.transport.model.extract(request()); assert.equal(f.calls.length, 82);
  assert.equal(algorithmLimits.httpRequests * algorithmLimits.reservationMicroUsd, 9_840_000);
});

test('HTTP failures do not retry; unknown usage retains reservation and later case proceeds', async t => {
  let sent = 0;
  const f = fixture(t, { fetchImpl: async () => { sent++; throw new Error('synthetic connection failure'); } });
  await assert.rejects(f.transport.model.extract(request()));
  assert.equal(sent, 1); f.transport.assertHealthy();
  const state = inspectEmbeddingExperimentBudgetSnapshot(f.configuration);
  assert.equal(state.attempts[0].outcome, 'unknown'); assert.equal(state.attempts[0].actualMicroUsd, null);
  assert.equal(state.reservedMicroUsd, 5000); f.transport.endCase();
  f.transport.beginCase({ id: 'D02', ordinal: 2 });
});

test('provider usage/auth anomalies latch fatal independently of core error laundering', async t => {
  for (const variant of ['usage', 'auth', 'echo', 'encodedEcho']) {
    let sent = 0;
    const f = fixture(t, { fetchImpl: async url => {
      sent++;
      if (variant === 'auth') return Response.json({ error: 'denied' }, { status: 401 });
      if (variant === 'echo') return Response.json({ error: key });
      if (variant === 'encodedEcho') return new Response(JSON.stringify({ error: key }).replace('synthetic', '\\u0073ynthetic'));
      return Response.json(url.endsWith('/input_tokens') ? { object: 'response.input_tokens', input_tokens: 100 }
        : envelope({ input_tokens: 100, output_tokens: 20, total_tokens: 999 }));
    } });
    await assert.rejects(f.transport.model.extract(request()));
    assert.throws(() => f.transport.assertHealthy()); assert.equal(sent, variant === 'usage' ? 2 : 1);
    assert.equal(JSON.stringify(f.transport.records()).includes(key), false);
    assert.equal(inspectEmbeddingExperimentBudgetSnapshot(f.configuration).attempts.at(-1).actualMicroUsd, null);
  }
});

test('valid over-bound usage is priced and persisted before fatal, with ledger overrun retained', async t => {
  const f = fixture(t, { fetchImpl: async url => Response.json(url.endsWith('/input_tokens')
    ? { object: 'response.input_tokens', input_tokens: 100 }
    : envelope({ input_tokens: 8000, output_tokens: 2000, total_tokens: 10000 })) });
  await assert.rejects(f.transport.model.extract(request()));
  assert.throws(() => f.transport.assertHealthy(), code('algorithm_usage_overrun'));
  const row = f.transport.records()[1];
  assert.equal(row.actualMicroUsd, 6400); assert.equal(row.usage.total_tokens, 10000);
  const state = inspectEmbeddingExperimentBudgetSnapshot(f.configuration);
  assert.equal(state.state, 'overrun'); assert.equal(state.attempts[1].actualMicroUsd, 6400);
});

test('failed HTTP with valid reported usage still preserves known cost without retry', async t => {
  const f = fixture(t, { fetchImpl: async url => url.endsWith('/input_tokens')
    ? Response.json({ object: 'response.input_tokens', input_tokens: 100 })
    : Response.json(envelope(), { status: 503 }) });
  await assert.rejects(f.transport.model.extract(request())); f.transport.assertHealthy();
  const row = f.transport.records()[1];
  assert.equal(row.outcome, 'failed'); assert.equal(row.actualMicroUsd, 72);
  assert.equal(inspectEmbeddingExperimentBudgetSnapshot(f.configuration).attempts[1].actualMicroUsd, 72);
});

test('existing checkpoint/history and foreign ledger append are checked before sending', async t => {
  const f = fixture(t);
  assert.throws(() => createAlgorithmDevelopmentTransport({ ...f.options, checkpoint: { requestCount: 1, reservedMicroUsd: 0 } }), code('ledger_failed'));
  assert.throws(() => createAlgorithmDevelopmentTransport({ ...f.options, historySha256: '0'.repeat(64) }), code('ledger_failed'));
  const other = reopenEmbeddingExperimentBudget(f.configuration), attemptId = randomUUID();
  other.reserve({ attemptId, channel: 'host-completion', reservedMicroUsd: 5000 });
  other.recordOutcome({ attemptId, outcome: 'unknown' }); other.close();
  await assert.rejects(f.transport.model.extract(request()));
  assert.equal(f.calls.length, 0);
});

test('durable callback failure prevents dispatch and latches fatal without refund', async t => {
  let sent = 0;
  const f = fixture(t, { onRecord: () => Promise.resolve(), fetchImpl: async () => { sent++; return Response.json({}); } });
  await assert.rejects(f.transport.model.extract(request())); assert.equal(sent, 0);
  assert.throws(() => f.transport.assertHealthy(), code('algorithm_persistence_failure'));
  const state = inspectEmbeddingExperimentBudgetSnapshot(f.configuration);
  assert.equal(state.requestCount, 1); assert.equal(state.reservedMicroUsd, 5000);
  assert.equal(state.attempts[0].outcome, 'unknown');
});
