import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { callModel } from '../model-call.mjs';
import { MemoryStoreError } from '../validation.mjs';

const invoke = (callback, options) => callModel({ contextWindow: 8192,
  countTokens: () => 1, select: callback }, 'select', 'Synthetic', {}, options);

test('trusted adapter budget/output errors retain only the narrow existing codes', async () => {
  for (const code of ['context_budget_exceeded', 'token_count_unavailable', 'invalid_model_output']) {
    await assert.rejects(invoke(() => { throw new MemoryStoreError(code); }),
      (error) => error instanceof MemoryStoreError && error.code === code);
    await assert.rejects(invoke(() => { throw { code, message: 'secret provider body' }; }),
      (error) => error.code === 'recall_failed' && !error.message.includes('secret'));
  }
  for (const code of ['revision_conflict', 'storage_busy', 'not_found']) {
    await assert.rejects(invoke(() => { throw new MemoryStoreError(code); },
      { failureCode: 'extraction_failed' }), (error) => error.code === 'extraction_failed');
  }
});

test('adapter cancellation retains the existing explicit cancellation envelope', async () => {
  await assert.rejects(invoke(() => { throw new DOMException('Synthetic', 'AbortError'); }),
    (error) => error.code === 'model_cancelled');
});

test('one core deadline aborts a pending two-phase adapter without extending phase two', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  let phases = 0;
  const pending = invoke(async (request) => {
    signal = request.signal;
    phases++;
    await setImmediate();
    phases++;
    return new Promise(() => {});
  });
  const rejected = assert.rejects(pending, (error) => error.code === 'model_timeout');
  await setImmediate();
  await setImmediate();
  assert.equal(phases, 2);
  t.mock.timers.tick(29999);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  await rejected;
  assert.equal(signal.aborted, true);
});

test('default request is unchanged; opt-in schema and 3072 output reserve share the context window', async () => {
  let request;
  const old = await invoke(value => { request = value; return { value: 'old' }; });
  assert.deepEqual(old, { value: 'old' });
  assert.deepEqual(Object.keys(request).sort(), ['input', 'maxOutputTokens', 'signal', 'system']);
  assert.equal(request.maxOutputTokens, 1024);
  const schema = { type: 'object', properties: { value: { type: 'string' } } };
  const model = { contextWindow: 8192,
    countTokens: text => text.includes('"maxOutputTokens"') ? 5120 : 3072,
    select(value) { request = value; return { value: 'new' }; } };
  const call = options => callModel(model, 'select', 'Synthetic', {}, options);
  assert.deepEqual(await call({ maxOutputTokens: 3072, responseSchema: schema }), { value: 'new' });
  assert.equal(request.maxOutputTokens, 3072);
  assert.deepEqual(request.responseSchema, schema);
  assert.notEqual(request.responseSchema, schema);
  model.contextWindow = 8192;
  model.countTokens = text => text.includes('"maxOutputTokens"') ? 5121 : 1;
  await assert.rejects(call({ maxOutputTokens: 3072, responseSchema: schema }),
    { code: 'context_budget_exceeded' });
});

test('invalid model-call options fail before model and token-counter callbacks', async () => {
  let calls = 0;
  const model = { contextWindow: 8192, countTokens() { calls++; return 1; },
    select() { calls++; return {}; } };
  const cyclic = { type: 'object' }; cyclic.self = cyclic;
  const accessor = {}; Object.defineProperty(accessor, 'type', {
    get: () => { calls++; return 'object'; }, enumerable: true });
  for (const options of [{ maxOutputTokens: 1025 }, { maxOutputTokens: 0 },
    { maxOutputTokens: 3072.5 }, { responseSchema: null }, { responseSchema: [] },
    { responseSchema: cyclic }, { responseSchema: accessor },
    { responseSchema: 'object' }, { responseSchema: 5 }, { responseSchema: true }]) {
    await assert.rejects(callModel(model, 'select', 'Synthetic', {}, options),
      { code: 'invalid_input' });
  }
  assert.equal(calls, 0);
});

test('opt-in request counts and sends one detached schema/input snapshot', async () => {
  const input = { text: 'original' }; const responseSchema = { type: 'object' };
  let sent;
  const model = { contextWindow: 8192, countTokens(text) {
    if (text.includes('"maxOutputTokens"')) {
      input.text = 'changed after count'; responseSchema.type = 'array';
    }
    return 1;
  }, select(request) { sent = request; return { units: [] }; } };
  await callModel(model, 'select', 'Synthetic', input, { maxOutputTokens: 3072, responseSchema });
  assert.deepEqual(sent.input, { text: 'original' });
  assert.deepEqual(sent.responseSchema, { type: 'object' });
  assert.equal(input.text, 'changed after count');
});

test('opt-in output counts against selected ceiling, retaining the 40k JSON bound', async () => {
  const model = { contextWindow: 8192,
    countTokens: text => text.includes('"maxOutputTokens"') ? 1 : 2000,
    select: () => ({ result: 'synthetic' }) };
  await assert.rejects(callModel(model, 'select', '', {}), { code: 'invalid_model_output' });
  assert.deepEqual(await callModel(model, 'select', '', {}, { maxOutputTokens: 3072 }),
    { result: 'synthetic' });
  model.select = () => ({ result: 'x'.repeat(40_000) });
  await assert.rejects(callModel(model, 'select', '', {}, { maxOutputTokens: 3072 }),
    { code: 'invalid_model_output' });
});
