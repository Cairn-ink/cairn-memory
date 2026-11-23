import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { callBuiltModel, callModel } from '../src/capture/model-call.mjs';
import { CoreError } from '../src/errors.mjs';

function classifyBuilt() {
  return {
    stage: 'classify',
    request: { system: 'Classify synthetic text.', input: { text: 'Cedar tea.' }, maxOutputTokens: 1024 },
    validationSchema: { type: 'object' },
    sizingText: 'Synthetic sizing text.',
    decode: raw => raw.topic,
  };
}

function errorCode(code) {
  return error => error instanceof CoreError && error.code === code;
}

test('prebuilt requests refuse shared backing memory before the pre-send gate', async () => {
  const built = classifyBuilt();
  const bytes = new Uint8Array(new SharedArrayBuffer(1));
  bytes[0] = 1;
  built.request.input = bytes;
  const received = [];
  let gateCalls = 0;
  const model = {
    contextWindow: 8192,
    countTokens: () => 1,
    async call(_stage, request) {
      received.push(request.input[0]);
      return { topic: 'tea' };
    },
  };
  const gate = { async assertOpen(_owner, phase) {
    if (phase !== 'pre-send') return;
    gateCalls++;
    await Promise.resolve();
    bytes[0] = 2;
  } };
  const rejection = await callBuiltModel(model, 'classify', built, { gate, owner: 'synthetic-owner' }).catch(error => error);
  assert.deepEqual(received, []);
  assert.equal(gateCalls, 0);
  assert.ok(errorCode('invalid_input')(rejection));
});

test('both prebuilt data fields reject values JSON would drop or change', async () => {
  let getterCalls = 0;
  const nonJSON = [
    new Uint8Array(1), new ArrayBuffer(1), new SharedArrayBuffer(1), new DataView(new ArrayBuffer(1)),
    () => {}, Symbol('value'), NaN, Infinity, [undefined], Array(1), { missing: undefined },
    { [Symbol('key')]: true }, { get value() { getterCalls++; return 1; } },
    Object.defineProperty({}, 'hidden', { value: 1 }), new Date(0),
  ];
  for (const value of nonJSON) {
    const built = classifyBuilt();
    await assert.rejects(callBuiltModel(null, 'classify', { ...built, request: { ...built.request, input: value } }),
      errorCode('invalid_input'));
    await assert.rejects(callBuiltModel(null, 'classify', { ...built, validationSchema: { value } }),
      errorCode('invalid_input'));
  }
  assert.equal(getterCalls, 0);
});

test('raw classify output is counted against its request budget before either method can decode', async () => {
  const raw = { topic: 'tea', notes: 'Synthetic classify output.' };
  const rawText = JSON.stringify(raw);
  for (const [method, maxOutputTokens] of [['classify', 1024], ['qualifyCandidates', 1024], ['classify', 1112]]) {
    const built = classifyBuilt();
    built.request.maxOutputTokens = maxOutputTokens;
    let decodes = 0;
    built.decode = () => { decodes++; return 'tea'; };
    const sizes = [];
    const events = [];
    const model = {
      contextWindow: 8192,
      countTokens(text) { sizes.push(text); return text === rawText ? 1112 : 1; },
      async call(stage, request) {
        assert.equal(stage, 'classify');
        assert.equal(request.maxOutputTokens, maxOutputTokens);
        return raw;
      },
    };
    const pending = callBuiltModel(model, method, built, { onDiagnostic: event => events.push(event) });
    if (maxOutputTokens === 1112) {
      assert.equal(await pending, 'tea');
      assert.equal(decodes, 1);
      assert.deepEqual(events, []);
    } else {
      await assert.rejects(pending, errorCode('invalid_model_output'));
      assert.equal(decodes, 0);
      assert.deepEqual(events, [{ version: 1, stage: method, layer: 'core_call', reason: 'output_bounds' }]);
    }
    assert.deepEqual(sizes, [built.sizingText, rawText]);
  }
});

test('thenables, decoder CoreErrors, and invalid decoded data map to adapter_output_invalid', async () => {
  let thenCalls = 0;
  const model = { contextWindow: 8192, countTokens: () => 1, async call() { return { topic: 'tea' }; } };
  for (const [label, decode] of [
    ['async decoder', async () => { throw new CoreError('capture_evidence_closed'); }],
    ['foreign thenable', () => ({ then(resolve) { thenCalls++; resolve('tea'); } })],
    ['CoreError', () => { throw new CoreError('capture_evidence_closed'); }],
    ['BigInt', () => 1n],
    ['decoded length', () => 'a'.repeat(39_999)],
  ]) {
    const events = [];
    await assert.rejects(callBuiltModel(model, 'qualifyCandidates', { ...classifyBuilt(), decode }, {
      onDiagnostic: event => events.push(event),
    }), errorCode('invalid_model_output'), label);
    assert.deepEqual(events, [{
      version: 1, stage: 'qualifyCandidates', layer: 'core_call', reason: 'adapter_output_invalid',
    }], label);
    assert.equal(thenCalls, 0, label);
  }
});

test('both model call entries throw synchronously when used as constructors', () => {
  const { cases } = JSON.parse(readFileSync(new URL('./fixtures/capture/engine-wire-goldens.json', import.meta.url), 'utf8'));
  const { request, output } = cases.find(entry => entry.name === 'plain 1 messages');
  let providerCalls = 0;
  const model = { contextWindow: 8192, countTokens: () => 1, async call() { providerCalls++; return output; } };
  assert.throws(() => new callModel(model, 'extract', request), TypeError);
  assert.throws(() => new callBuiltModel(model, 'classify', classifyBuilt()), TypeError);
  assert.equal(providerCalls, 0);
});

function plainModel(output) {
  return { contextWindow: 8192, countTokens: () => 1, async call() { return output; } };
}

test('a decoder result is delivered as plain data, so a late then or toJSON cannot be adopted', { timeout: 2000 }, async () => {
  let reads = 0;
  const lateThen = { topic: 'tea', get then() { reads++; return reads > 1 ? (resolve) => resolve('hijacked') : undefined; } };
  const result = await callBuiltModel(plainModel({ topic: 'tea' }), 'classify', { ...classifyBuilt(), decode: () => lateThen });
  assert.deepEqual(result, { topic: 'tea' });
  assert.equal(typeof result.then, 'undefined');

  const installsThen = { topic: 'tea', toJSON() {
    this.then = (_resolve, reject) => reject(new CoreError('capture_evidence_closed'));
    return { topic: 'tea' };
  } };
  const second = await callBuiltModel(plainModel({ topic: 'tea' }), 'classify', { ...classifyBuilt(), decode: () => installsThen });
  assert.deepEqual(second, { topic: 'tea' });
  assert.equal(Object.getPrototypeOf(second), Object.prototype);
});

test('a binary view is refused whatever its prototype', async () => {
  let calls = 0;
  const model = { contextWindow: 8192, countTokens: () => 1, async call() { calls++; return { topic: 'tea' }; } };
  for (const view of [new Uint8Array(new SharedArrayBuffer(1)), new Uint8Array(1), new DataView(new ArrayBuffer(1))]) {
    Object.setPrototypeOf(view, null);
    const built = classifyBuilt();
    await assert.rejects(callBuiltModel(model, 'classify', { ...built, request: { ...built.request, input: view } }),
      errorCode('invalid_input'));
  }
  assert.equal(calls, 0);
});
