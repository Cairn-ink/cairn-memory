import assert from 'node:assert/strict';
import test, { after, mock } from 'node:test';
import { createOpenAIModel } from '../index.mjs';
import { MemoryStoreError } from '../../../core/validation.mjs';
import { vectors } from './tokenizer-vectors.mjs';

// Every factory receives fake fetch explicitly. This extra guard makes accidental
// native-network fallback fail locally, even if an implementation ignores injection.
const nativeGuard = mock.method(globalThis, 'fetch', () => assert.fail('Native fetch is forbidden in offline tests'));
after(() => nativeGuard.mock.restore());
const secret = 'synthetic-key-never-a-real-credential';
const sensitive = 'SYNTHETIC_PRIVATE_PROVIDER_BODY';
const request = (input = { query: 'Synthetic', maps: [], maxRefs: 24 }) => ({
  system: 'Return the requested JSON object.', input, maxOutputTokens: 1024, signal: new AbortController().signal,
});
const json = (value, init) => new Response(JSON.stringify(value), init);
const countEnvelope = (input_tokens = 100) => ({ object: 'response.input_tokens', input_tokens });
function envelope(value = { refs: [] }, input = 100, output = 4) {
  return { id: 'resp_offline', object: 'response', model: 'gpt-4.1-mini-2025-04-14', status: 'completed', error: null, incomplete_details: null,
    output: [{ id: 'msg_offline', type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: JSON.stringify(value), annotations: [] }] }],
    usage: { input_tokens: input, output_tokens: output, total_tokens: input + output } };
}
function harness(steps = [() => json(countEnvelope()), () => json(envelope())]) {
  const calls = [];
  const model = createOpenAIModel({ apiKey: secret, fetchImpl: async (url, options) => {
    calls.push({ url: String(url), ...options, body: JSON.parse(options.body) });
    assert.ok(calls.length <= steps.length, 'Unexpected retry or extra HTTP operation');
    return steps[calls.length - 1](calls.at(-1));
  } });
  return { model, calls };
}
function sanitized(err, code) {
  assert.ok(err instanceof Error);
  if (code) { assert.ok(err instanceof MemoryStoreError); assert.equal(err.code, code); }
  const exposed = `${String(err)} ${err.stack} ${JSON.stringify(err)} ${String(err.cause)}`;
  assert.ok(!exposed.includes(secret), exposed);
  assert.ok(!exposed.includes(sensitive), exposed);
  assert.equal(err.cause, undefined);
  return true;
}
const reject = (promise, code) => assert.rejects(promise, (err) => sanitized(err, code));
const localCount = (model, req) => model.countTokens(JSON.stringify({ system: req.system, input: req.input, maxOutputTokens: req.maxOutputTokens }));
const userInput = (body) => {
  assert.equal(body.input.length, 1);
  assert.equal(body.input[0].role, 'user');
  const content = body.input[0].content;
  if (typeof content === 'string') return JSON.parse(content);
  assert.equal(content.length, 1); assert.equal(content[0].type, 'input_text');
  return JSON.parse(content[0].text);
};
function strictObjects(schema) {
  if (!schema || typeof schema !== 'object') return;
  if (schema.type === 'object') {
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort());
  }
  for (const value of Object.values(schema)) {
    if (Array.isArray(value)) value.forEach(strictObjects);
    else if (value && typeof value === 'object') strictObjects(value);
  }
}
// Small independent recognizer for optional-field shape assertions, not a
// production validator. Constraints unrelated to object presence are not needed.
function shapeMatches(schema, value) {
  if (schema.anyOf) return schema.anyOf.some((variant) => shapeMatches(variant, value));
  if (schema.type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value)
    && schema.required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => Object.hasOwn(schema.properties, key) && shapeMatches(schema.properties[key], value[key]));
  if (schema.type === 'array') return Array.isArray(value) && value.every((item) => shapeMatches(schema.items, item));
  if (schema.type === 'integer') return Number.isInteger(value);
  if (schema.type === 'number') return typeof value === 'number';
  if (schema.type === 'string') return typeof value === 'string';
  return true;
}

test('A01: synchronous pinned tokenizer matches independently frozen multilingual and literal-special vectors', () => {
  const { model, calls } = harness([]);
  assert.equal(model.contextWindow, 1047576);
  for (const { text, tokens } of vectors) {
    const actual = model.countTokens(text);
    assert.equal(typeof actual, 'number'); assert.equal(actual, tokens.length, JSON.stringify(text));
  }
  assert.equal(calls.length, 0);
});

test('A02: factory requires explicit nonempty credentials and never discovers them', () => {
  for (const apiKey of [undefined, null, '', '   ']) assert.throws(() =>
    createOpenAIModel({ apiKey, fetchImpl: () => assert.fail('Factory must not send HTTP') }));
});

test('A02: each method uses fixed endpoint, exact count/generation projection, strict schema and shared signal', async () => {
  const inputs = {
    extract: { messages: [{ index: 0, role: 'user', content: 'Synthetic source' }] },
    classify: { memories: [{ id: 'memory', revision: 1 }], map: [], mapExhausted: true },
    select: { query: 'Synthetic', maps: [], maxRefs: 24 },
    rank: { query: 'Synthetic', candidates: [], limit: 6 },
  };
  for (const [method, input] of Object.entries(inputs)) {
    const output = ['extract', 'classify'].includes(method) ? { items: [] } : { refs: [] };
    const { model, calls } = harness([() => json(countEnvelope()), () => json(envelope(output))]);
    const req = request(input);
    assert.deepEqual(await model[method](req), output);
    assert.deepEqual(calls.map((call) => call.url), ['https://api.openai.com/v1/responses/input_tokens', 'https://api.openai.com/v1/responses']);
    for (const call of calls) {
      assert.equal(call.method, 'POST'); assert.equal(call.redirect, 'error'); assert.equal(call.signal, req.signal);
      const headers = new Headers(call.headers);
      assert.equal(headers.get('authorization'), `Bearer ${secret}`);
      assert.equal(headers.get('content-type'), 'application/json');
      assert.equal(call.body.model, 'gpt-4.1-mini-2025-04-14');
      assert.equal(call.body.instructions, req.system); assert.equal(call.body.truncation, 'disabled');
      assert.deepEqual(userInput(call.body), input);
      assert.ok(!JSON.stringify(call.body).includes(secret));
      assert.equal(call.body.text.format.type, 'json_schema'); assert.equal(call.body.text.format.strict, true);
      assert.equal(call.body.text.format.name, `cairn_${method}`); strictObjects(call.body.text.format.schema);
    }
    assert.deepEqual(Object.keys(calls[0].body).sort(), ['input', 'instructions', 'model', 'text', 'truncation']);
    const { max_output_tokens, store, stream, ...projection } = calls[1].body;
    assert.equal(max_output_tokens, 1024); assert.equal(store, false); assert.equal(stream, false);
    assert.deepEqual(projection, calls[0].body);
    const schema = calls[0].body.text.format.schema;
    assert.deepEqual(Object.keys(schema.properties), ['extract', 'classify'].includes(method) ? ['items'] : ['refs']);
    if (method === 'extract') assert.deepEqual(Object.keys(schema.properties.items.items.properties).sort(),
      ['confidence', 'content', 'kind', 'sourceIndices']);
    if (method === 'select' || method === 'rank') assert.deepEqual(Object.keys(schema.properties.refs.items.properties).sort(),
      ['memoryId', 'namespaceIndex', 'revision']);
  }
});

test('A02: classification schemas represent absent/new-L1/new-L2 fields as strict nested alternatives', async () => {
  const { model, calls } = harness([() => json(countEnvelope()), () => json(envelope({ items: [] }))]);
  await model.classify(request({ memories: [], map: [], mapExhausted: true }));
  const schema = calls[0].body.text.format.schema;
  for (const item of [
    { memoryId: 'm', parentIds: [] },
    { memoryId: 'm', parentIds: [], newL1: { title: 'Group', parentL2Ids: [] } },
    { memoryId: 'm', parentIds: [], newL1: { title: 'Group', parentL2Ids: [], newL2Title: 'Root' } },
  ]) assert.equal(shapeMatches(schema, { items: [item] }), true, JSON.stringify(item));
  for (const item of [
    { memoryId: 'm', parentIds: [], newL1: null },
    { memoryId: 'm', parentIds: [], newL1: { title: 'Group', parentL2Ids: [], newL2Title: null } },
    { memoryId: 'm', parentIds: [], unexpected: 'field' },
  ]) assert.equal(shapeMatches(schema, { items: [item] }), false, JSON.stringify(item));
  assert.ok(JSON.stringify(schema).includes('anyOf'));
});

test('A02: request input is snapshotted before asynchronous preflight', async () => {
  let resolveCount;
  const req = request();
  const original = structuredClone(req.input);
  const { model, calls } = harness([() => new Promise((resolve) => { resolveCount = resolve; }), () => json(envelope())]);
  const pending = model.select(req);
  await Promise.resolve();
  assert.equal(calls.length, 1);
  req.input.query = 'Mutated after counting started'; req.system = 'Mutated instructions';
  resolveCount(json(countEnvelope())); await pending;
  assert.deepEqual(userInput(calls[1].body), original);
  assert.equal(calls[1].body.instructions, calls[0].body.instructions);
});

test('A03: local 6000-token and absolute 7024-token provider input ceilings have exact boundaries', async () => {
  for (const target of [6000, 6001]) {
    const { model, calls } = harness();
    const req = request();
    let copies = target;
    for (let i = 0; i < 5; i++) { req.system = ' x'.repeat(copies); copies += target - localCount(model, req); }
    assert.equal(localCount(model, req), target);
    if (target === 6000) { await model.select(req); assert.equal(calls.length, 2); }
    else { await reject(model.select(req), 'context_budget_exceeded'); assert.equal(calls.length, 0); }
  }
  for (const providerCount of [7024, 7025]) {
    const { model, calls } = harness([() => json(countEnvelope(providerCount)),
      () => json(envelope({ refs: [] }, providerCount))]);
    if (providerCount === 7024) { await model.select(request()); assert.equal(calls.length, 2); }
    else { await reject(model.select(request()), 'context_budget_exceeded'); assert.equal(calls.length, 1); }
  }
  let providerCount;
  const dynamic = harness([() => json(countEnvelope(providerCount)),
    () => json(envelope({ refs: [] }, providerCount))]);
  const req = request();
  providerCount = localCount(dynamic.model, req) + 1025;
  assert.ok(providerCount <= 7024);
  await dynamic.model.select(req);
  assert.equal(dynamic.calls.length, 2);
});

test('A03: malformed preflight counts fail before generation', async () => {
  for (const value of [null, [], {}, { object: 'response', input_tokens: 0 },
    ...[-1, 0.5, '100', null, Number.MAX_SAFE_INTEGER + 1].map((input_tokens) => countEnvelope(input_tokens))]) {
    const { model, calls } = harness([() => json(value)]);
    await reject(model.select(request()), 'token_count_unavailable'); assert.equal(calls.length, 1);
  }
});

test('A03: HTTP, redirects, malformed JSON and transport exceptions never disclose bodies or retry', async () => {
  for (const phase of ['count', 'generate']) for (const failure of ['http', 'redirect', 'json', 'throw', 'redirected']) {
    const failed = () => {
      if (failure === 'throw') throw new Error(`${secret} ${sensitive}`);
      if (failure === 'json') return new Response(`${sensitive} ${secret}`);
      const response = new Response(`${sensitive} ${secret}`, { status: failure === 'http' ? 429 : failure === 'redirect' ? 302 : 200 });
      if (failure === 'redirected') Object.defineProperty(response, 'redirected', { value: true });
      return response;
    };
    const { model, calls } = harness(phase === 'count' ? [failed] : [() => json(countEnvelope()), failed]);
    await reject(model.select(request())); assert.equal(calls.length, phase === 'count' ? 1 : 2);
  }
});

test('A03: decoded body byte limits include UTF-8 and stop oversized streams early', async () => {
  for (const phase of ['count', 'generate']) {
    const limit = phase === 'count' ? 65536 : 262144;
    const text = JSON.stringify(phase === 'count' ? countEnvelope() : envelope());
    const within = () => new Response(text + ' '.repeat(limit - Buffer.byteLength(text)));
    const accepted = harness(phase === 'count' ? [within, () => json(envelope())] : [() => json(countEnvelope()), within]);
    await accepted.model.select(request());
    let cancelled = false;
    let pulls = 0;
    const oversized = () => new Response(new ReadableStream({
      pull(controller) { pulls++; controller.enqueue(new TextEncoder().encode('界'.repeat(Math.ceil(limit / 3)))); },
      cancel() { cancelled = true; },
    }));
    const failed = harness(phase === 'count' ? [oversized] : [() => json(countEnvelope()), oversized]);
    await reject(failed.model.select(request()));
    assert.equal(cancelled, true); assert.ok(pulls <= 3, `Read ${pulls} chunks after overflow`);
  }
});

test('A03: 40000-character output and 1024 reported output tokens are accepted at the exact ceilings', async () => {
  const value = envelope({ refs: [] }, 100, 1024);
  const text = value.output[0].content[0].text;
  value.output[0].content[0].text = text + ' '.repeat(40000 - text.length);
  const { model, calls } = harness([() => json(countEnvelope()), () => json(value)]);
  assert.ok(model.countTokens(value.output[0].content[0].text) <= 1024);
  assert.deepEqual(await model.select(request()), { refs: [] });
  assert.equal(calls.length, 2);
});

test('A03: completed assistant-only output, refusal, object JSON, usage and output ceilings are enforced', async () => {
  const corruptions = [
    (v) => { v.object = 'chat.completion'; },
    (v) => { delete v.model; },
    (v) => { v.model = 'gpt-4.1-mini'; },
    (v) => { v.status = 'incomplete'; },
    (v) => { v.error = { message: sensitive }; },
    (v) => { v.incomplete_details = { reason: 'max_output_tokens' }; },
    (v) => { v.output = []; },
    (v) => { v.output[0].status = 'in_progress'; },
    (v) => { v.output[0].role = 'user'; },
    (v) => { v.output.push({ type: 'function_call', name: 'leak', arguments: sensitive }); },
    (v) => { v.output[0].content = [{ type: 'refusal', refusal: sensitive }]; },
    (v) => { v.output[0].content = []; },
    (v) => { v.output[0].content[0].text = ''; },
    (v) => { v.output[0].content[0].text = '[]'; },
    (v) => { v.output[0].content[0].text = 'null'; },
    (v) => { v.output[0].content[0].text = sensitive; },
    (v) => { v.output[0].content[0].text = '{"refs":[]}' + ' '.repeat(40001 - '{"refs":[]}'.length); },
    (v) => { v.output[0].content[0].text = JSON.stringify({ refs: [], excess: ' x'.repeat(1100) }); },
    (v) => { delete v.usage; },
    (v) => { v.usage.input_tokens++; v.usage.total_tokens++; },
    (v) => { v.usage.total_tokens++; },
    (v) => { v.usage.output_tokens = 1025; v.usage.total_tokens = 1125; },
    ...['input_tokens', 'output_tokens', 'total_tokens'].flatMap((field) => [-1, 0.5, '4', null, Number.MAX_SAFE_INTEGER + 1]
      .map((value) => (v) => { v.usage[field] = value; })),
  ];
  for (const mutate of corruptions) {
    const value = envelope(); mutate(value);
    const { model, calls } = harness([() => json(countEnvelope()), () => json(value)]);
    await reject(model.select(request()), 'invalid_model_output'); assert.equal(calls.length, 2);
  }
});

test('A04: pre-abort and abort during fetch or body of either phase stop all later work', async () => {
  for (const phase of ['before', 'count-fetch', 'count-body', 'generate-fetch', 'generate-body']) {
    const controller = new AbortController();
    const req = { ...request(), signal: controller.signal };
    const aborting = () => {
      if (phase.endsWith('fetch')) return new Promise((resolve, rejectPromise) => {
        controller.signal.addEventListener('abort', () => rejectPromise(new DOMException(sensitive, 'AbortError')), { once: true });
        queueMicrotask(() => controller.abort(new Error(`${secret} ${sensitive}`)));
      });
      return new Response(new ReadableStream({ start(stream) {
        controller.signal.addEventListener('abort', () => stream.error(new DOMException(sensitive, 'AbortError')), { once: true });
        queueMicrotask(() => controller.abort(new Error(`${secret} ${sensitive}`)));
      } }));
    };
    const steps = phase === 'before' ? [] : phase.startsWith('count') ? [aborting] : [() => json(countEnvelope()), aborting];
    const { model, calls } = harness(steps);
    if (phase === 'before') controller.abort(new Error(sensitive));
    await assert.rejects(model.select(req), (err) => {
      sanitized(err); assert.ok(err.name === 'AbortError' || err.code === 'model_cancelled'); return true;
    });
    assert.equal(calls.length, phase === 'before' ? 0 : phase.startsWith('count') ? 1 : 2);
    assert.ok(calls.every((call) => call.signal === controller.signal));
  }
});
