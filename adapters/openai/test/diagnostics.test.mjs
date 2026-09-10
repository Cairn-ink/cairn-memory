import assert from 'node:assert/strict';
import test, { after, mock } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createOpenAIModel } from '../index.mjs';
import { callModel } from '../../../core/model-call.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const guard = mock.method(globalThis, 'fetch', () => assert.fail('Native network forbidden'));
after(() => guard.mock.restore());
const secret = 'SYNTHETIC_PRIVATE_KEY_BODY_QUERY';
const inputs = {
  extract: { messages: [{ index: 0, role: 'user', content: secret }] },
  classify: { memories: [], map: [], mapExhausted: true },
  select: { query: secret, maps: [], maxRefs: 24 },
  rank: { query: secret, candidates: [], limit: 6 },
};
const request = (stage) => ({ system: 'Synthetic instructions', input: inputs[stage], maxOutputTokens: 1024,
  signal: new AbortController().signal });
const output = (stage) => ['extract', 'classify'].includes(stage) ? { items: [] } : { refs: [] };
const json = (value) => new Response(JSON.stringify(value));
function envelope(value) {
  return { object: 'response', model: 'gpt-4.1-mini-2025-04-14', status: 'completed', error: null,
    incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
    usage: { input_tokens: 100, output_tokens: 4, total_tokens: 104 } };
}
function fixture(stage, response, onDiagnostic, countResponse = () => json({ object: 'response.input_tokens', input_tokens: 100 })) {
  let calls = 0;
  const model = createOpenAIModel({ apiKey: secret, onDiagnostic, fetchImpl: async () => {
    calls++;
    assert.ok(calls <= 2, 'No retry is authorized');
    return calls === 1 ? countResponse() : response();
  } });
  return { model, calls: () => calls };
}
function checkEvent(actual, stage, reason, layer = 'adapter') {
  assert.deepEqual(actual, { version: 1, stage, layer, reason });
  assert.equal(Object.isFrozen(actual), true);
  assert.equal(JSON.stringify(actual).includes(secret), false);
}

test('diagnostics: adapter rejects invalid optional observers before HTTP', () => {
  for (const onDiagnostic of [null, false, 0, 'callback', [], {}]) {
    assert.throws(() => createOpenAIModel({ apiKey: secret, onDiagnostic,
      fetchImpl: () => assert.fail('Configuration cannot send HTTP') }), /invalid_openai_configuration/);
  }
});

test('diagnostics: all four successful adapter ports remain silent and preserve outputs', async () => {
  for (const stage of Object.keys(inputs)) {
    const events = [];
    const { model, calls } = fixture(stage, () => json(envelope(output(stage))), (e) => events.push(e));
    assert.deepEqual(await model[stage](request(stage)), output(stage));
    assert.equal(calls(), 2);
    assert.deepEqual(events, []);
  }
});

test('diagnostics: response validation has static reasons for all four adapter ports', async () => {
  const failures = [
    ['response_envelope', (v) => { v.status = secret; }],
    ['response_usage', (v) => { v.usage.total_tokens = secret; }],
    ['response_message', (v) => { v.output[0].role = secret; }],
    ['response_content', (v) => { v.output[0].content[0].type = secret; }],
    ['output_json', (v) => { v.output[0].content[0].text = secret; }],
    ['output_shape', (v) => { v.output[0].content[0].text = '[]'; }],
    ['output_bounds', (v) => { v.output[0].content[0].text = 'x'.repeat(40001); }],
  ];
  for (const stage of Object.keys(inputs)) for (const [reason, mutate] of failures) {
    const events = [];
    const value = envelope(output(stage)); mutate(value);
    const { model } = fixture(stage, () => json(value), (e) => events.push(e));
    await assert.rejects(model[stage](request(stage)), (e) => e.code === 'invalid_model_output'
      && !`${e.stack}${JSON.stringify(e)}`.includes(secret));
    assert.equal(events.length, 1, `${stage}/${reason}`);
    checkEvent(events[0], stage, reason);
  }
});

test('diagnostics: transport, body, JSON and token-count failures never reflect provider data', async () => {
  for (const stage of Object.keys(inputs)) for (const [reason, respond] of [
    ['transport_failure', () => { throw Object.assign(new Error(secret), { reason: secret, stage: secret }); }],
    ['response_body_bounds', () => new Response('x'.repeat(1000000))],
    ['response_json', () => new Response(secret)],
    ['token_count_response', () => json({ object: secret, input_tokens: secret })],
  ]) {
    const events = [];
    const { model, calls } = fixture(stage, () => assert.fail('No generation after failed count'), (e) => events.push(e), respond);
    await assert.rejects(model[stage](request(stage)), (e) => !`${e.stack}${JSON.stringify(e)}`.includes(secret));
    assert.equal(calls(), 1);
    assert.equal(events.length, ['response_body_bounds', 'response_json'].includes(reason) ? 2 : 1);
    checkEvent(events[0], stage, reason);
    if (events.length === 2) checkEvent(events[1], stage, 'transport_failure');
  }
});

test('diagnostics: request validation, bounds and cancellation report before HTTP', async () => {
  for (const stage of Object.keys(inputs)) for (const reason of ['request_invalid', 'request_bounds', 'model_cancelled']) {
    const events = [];
    const { model, calls } = fixture(stage, () => assert.fail('No HTTP'), (e) => events.push(e));
    const req = request(stage);
    if (reason === 'request_invalid') req.maxOutputTokens = 0;
    if (reason === 'request_bounds') req.system = ' x'.repeat(7000);
    if (reason === 'model_cancelled') req.signal = AbortSignal.abort(secret);
    await assert.rejects(model[stage](req));
    assert.equal(calls(), 0);
    checkEvent(events[0], stage, reason);
  }
});

test('diagnostics: real core call and fake HTTP adapter report separate failing boundaries', async () => {
  for (const stage of Object.keys(inputs)) {
    const events = [];
    const { model } = fixture(stage, () => json({ providerText: secret }), (e) => events.push(e));
    await assert.rejects(callModel(model, stage, 'Synthetic', inputs[stage]), (e) => e.code === 'invalid_model_output');
    assert.equal(events.length, 2);
    checkEvent(events[0], stage, 'response_envelope');
    checkEvent(events[1], stage, 'adapter_output_invalid', 'core_call');
  }
});

test('diagnostics: actual SQLite recall keeps public failure shape through the fake HTTP adapter', async (t) => {
  const events = [];
  const { model } = fixture('select', () => json({ providerText: secret }), (e) => events.push(e));
  const core = openMemoryCore({ path: join(mkdtempSync(join(tmpdir(), 'cairn-adapter-diagnostic-')), 'test.sqlite'), model });
  t.after(() => core.close());
  const namespace = { ownerId: 'synthetic', scope: 'personal', projectId: null };
  assert.equal(core.admit({ namespace, memory: { content: secret, kind: 'fact' }, receipts: [{
    client: 'test', sessionId: 's', eventId: 'e', role: 'user', excerpt: secret }] }).ok, true);
  assert.deepEqual(await core.recall({ readSet: [namespace], query: secret }), {
    ok: false, error: { code: 'invalid_model_output', retryable: false } });
  assert.equal(events.length, 2);
  checkEvent(events[0], 'select', 'response_envelope');
  checkEvent(events[1], 'select', 'adapter_output_invalid', 'core_call');
});

test('diagnostics: disabled, throwing and rejecting observers preserve adapter error shape', async () => {
  let baseline;
  for (const onDiagnostic of [undefined, () => { throw new Error(secret); }, async () => { throw new Error(secret); },
    (e) => { e.reason = secret; }]) {
    const { model } = fixture('select', () => json({ secret }), onDiagnostic);
    await assert.rejects(model.select(request('select')), (e) => {
      const shape = JSON.stringify({ name: e.name, message: e.message, ...e });
      baseline ??= shape;
      assert.equal(shape, baseline);
      return true;
    });
    await setImmediate();
  }
});
