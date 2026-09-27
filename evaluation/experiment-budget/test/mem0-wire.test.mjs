import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import { inspectMem0WireRequest, inspectMem0WireResponse, Mem0WireError,
  mem0WireProfile } from '../mem0-wire.mjs';

const requireFromAdapter = createRequire(new URL('../../../adapters/openai/package.json', import.meta.url));
const { get_encoding: getEncoding } = requireFromAdapter('tiktoken');
const cl = getEncoding('cl100k_base');
const o = getEncoding('o200k_base');
const error = code => caught => caught instanceof Mem0WireError
  && caught.code === code && caught.message === code;
const chat = (system = 'System.', user = 'User.') => ({
  model: 'gpt-4.1-mini-2025-04-14',
  messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  max_tokens: 2000, temperature: 0.1, top_p: 0.1,
  response_format: { type: 'json_object' }, store: false,
});
const embedding = (input = ['hello world']) => ({ model: 'text-embedding-3-small',
  input, dimensions: 1536, encoding_format: 'float' });
const request = (route, body) => inspectMem0WireRequest(route, JSON.stringify(body));
const chatResponse = (memory = [], usage = { prompt_tokens: 1, completion_tokens: 1,
  total_tokens: 2 }) => ({ object: 'chat.completion', model: chat().model, usage,
  choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant',
    content: JSON.stringify({ memory }) } }] });
const vector = () => Array(1536).fill(0);
const embeddingResponse = (count = 1, usage = { prompt_tokens: 2, total_tokens: 2 }) => ({
  object: 'list', model: embedding().model, usage,
  data: Array.from({ length: count }, (_, index) => ({ object: 'embedding',
    index, embedding: vector() })),
});

test('W1/W2 exact frozen profile, inert exports and fixed source-free errors', () => {
  const profile = mem0WireProfile();
  assert.equal(profile.version, 'mem0-text-wire-v1');
  assert.deepEqual([profile.chat.encoding, profile.embedding.encoding], ['o200k_base', 'cl100k_base']);
  assert.deepEqual([profile.chat.model, profile.embedding.model],
    ['gpt-4.1-mini-2025-04-14', 'text-embedding-3-small']);
  assert.deepEqual([profile.chat.reservedMicroUsd, profile.embedding.dimensions], [16_308, 1536]);
  assert.equal(profile.embedding.minimumReservedMicroUsd, 1);
  assert.equal(Object.isFrozen(profile.chat.inputPrice), true);
  assert.equal(Object.isFrozen(profile.embedding), true);
  assert.throws(() => inspectMem0WireRequest('other', '{}'), error('invalid_options'));
  let getterCalls = 0;
  const nontext = { get toString() { getterCalls += 1; return () => '{}'; } };
  assert.throws(() => inspectMem0WireRequest('chat', nontext), error('invalid_options'));
  assert.equal(getterCalls, 0);
  const source = 'private synthetic marker';
  assert.throws(() => inspectMem0WireRequest('embedding',
    JSON.stringify(embedding([source, '']))), caught => caught instanceof Mem0WireError
    && caught.code === 'unsupported_request' && caught.message === 'unsupported_request'
    && !caught.message.includes(source));
});

test('W3 actual pinned cl100k and o200k remain distinct and special-looking text is ordinary', () => {
  const expected = [
    ['antidisestablishmentarianism', 6, 6],
    ['お誕生日おめでとう', 9, 8],
    ['<|endoftext|>', 7, 7],
    ['hello world', 2, 2],
    [' a'.repeat(8192), 8192, 8192],
    [' a'.repeat(8193), 8193, 8193],
  ];
  for (const [text, clCount, oCount] of expected) {
    assert.equal(cl.encode(text, [], []).length, clCount);
    assert.equal(o.encode(text, [], []).length, oCount);
  }
  const japanese = request('embedding', embedding(['お誕生日おめでとう']));
  assert.equal(japanese.inputTokenUpperBound, 9);
  assert.equal(request('chat', chat('', 'お誕生日おめでとう')).itemCount, 2);
  assert.equal(request('embedding', embedding(['<|endoftext|>'])).inputTokenUpperBound, 7);
});

test('W4/W5 request keys, duplicate JSON keys and immutable private contexts', () => {
  const c = request('chat', chat());
  assert.deepEqual(Object.keys(c), ['profileVersion', 'route', 'bodyText',
    'inputTokenUpperBound', 'requestedOutputTokens', 'reservedMicroUsd', 'itemCount']);
  assert.equal(Object.isFrozen(c), true);
  assert.deepEqual([c.route, c.itemCount, c.requestedOutputTokens, c.reservedMicroUsd],
    ['chat', 2, 2000, 16_308]);
  const raw = '{"model":"wrong","model":"text-embedding-3-small","input":["hello world"],'
    + '"dimensions":1536,"encoding_format":"float"}';
  const e = inspectMem0WireRequest('embedding', raw);
  assert.equal(e.bodyText, JSON.stringify(JSON.parse(raw)));
  assert.equal(e.bodyText.match(/"model"/gu).length, 1);
  assert.deepEqual([e.itemCount, e.inputTokenUpperBound, e.reservedMicroUsd], [1, 2, 1]);
  let getterCalls = 0;
  const forged = { get route() { getterCalls += 1; return 'chat'; } };
  assert.throws(() => inspectMem0WireResponse(forged, '{}'), error('invalid_options'));
  assert.throws(() => inspectMem0WireResponse({ ...c }, '{}'), error('invalid_options'));
  assert.equal(getterCalls, 0);
});

test('W3/W4 exact chat and embedding token ceilings, duplicates and aggregate bound', () => {
  assert.equal(request('embedding', embedding([' a'.repeat(8192)])).inputTokenUpperBound, 8192);
  assert.throws(() => request('embedding', embedding([' a'.repeat(8193)])),
    error('input_bound_exceeded'));
  assert.equal(request('embedding', embedding(['same', 'same'])).inputTokenUpperBound,
    2 * cl.encode('same', [], []).length);
  const ninetyNine = Array(99).fill(' a'.repeat(3000));
  assert.equal(request('embedding', embedding([...ninetyNine, ' a'.repeat(3000)]))
    .inputTokenUpperBound, 300_000);
  assert.throws(() => request('embedding', embedding([...ninetyNine, ' a'.repeat(3001)])),
    error('input_bound_exceeded'));
  const profile = mem0WireProfile().chat;
  const bound = user => o.encode(JSON.stringify(chat('System.', user).messages), [], []).length
    + profile.inputFramingTokens;
  let low = 0; let high = 32_768;
  while (low + 1 < high) {
    const mid = Math.floor((low + high) / 2);
    if (bound(' a'.repeat(mid)) <= profile.maxInputTokens) low = mid;
    else high = mid;
  }
  assert.equal(bound(' a'.repeat(low)), profile.maxInputTokens);
  assert.equal(request('chat', chat('System.', ' a'.repeat(low))).inputTokenUpperBound,
    profile.maxInputTokens);
  assert.throws(() => request('chat', chat('System.', ' a'.repeat(low + 1))),
    error('input_bound_exceeded'));
});

test('W3/W4 exact request byte caps and malformed/extra wire fields', () => {
  for (const [route, body] of [['chat', chat()], ['embedding', embedding()]]) {
    const base = JSON.stringify(body);
    const limit = mem0WireProfile()[route].maxRequestBytes;
    assert.equal(inspectMem0WireRequest(route, base + ' '.repeat(limit - Buffer.byteLength(base))).route,
      route);
    assert.throws(() => inspectMem0WireRequest(route,
      base + ' '.repeat(limit - Buffer.byteLength(base) + 1)), error('unsupported_request'));
    assert.throws(() => request(route, { ...body, extra: true }), error('unsupported_request'));
  }
  assert.throws(() => request('chat', { ...chat(), max_completion_tokens: 2000 }),
    error('unsupported_request'));
  assert.throws(() => request('chat', { ...chat(), messages: [{ role: 'user', content: 'x' }] }),
    error('unsupported_request'));
  assert.throws(() => request('embedding', embedding([])), error('unsupported_request'));
  assert.throws(() => request('embedding', embedding(Array(101).fill('x'))),
    error('unsupported_request'));
  assert.throws(() => request('embedding', embedding(['\ud800'])), error('unsupported_request'));
  assert.throws(() => request('chat', { ...chat(), ignored: { bad: '\ud800' } }),
    error('unsupported_request'));
  const deep = Array.from({ length: 34 }, () => []);
  for (let index = 0; index < 33; index += 1) deep[index].push(deep[index + 1]);
  assert.throws(() => request('embedding', { ...embedding(), ignored: deep[0] }),
    error('unsupported_request'));
});

test('W6/W8 componentwise chat pricing, known zero embedding cost and usage precedence', () => {
  const c = request('chat', chat());
  const one = inspectMem0WireResponse(c, JSON.stringify(chatResponse()));
  assert.deepEqual([one.inputTokens, one.outputTokens, one.actualMicroUsd,
    one.usageWithinBounds, one.payloadValid, one.failureCode], [1, 1, 3, true, true, null]);
  assert.equal(Object.isFrozen(one), true);
  assert.equal(one.bodyText, JSON.stringify(chatResponse()));
  const e = request('embedding', embedding(['hello world']));
  const zero = inspectMem0WireResponse(e, JSON.stringify(embeddingResponse(1,
    { prompt_tokens: 0, total_tokens: 0 })));
  assert.equal(e.reservedMicroUsd, 1);
  assert.deepEqual([zero.actualMicroUsd, zero.outputTokens, zero.payloadValid], [0, 0, true]);
  const tooMany = chatResponse([], { prompt_tokens: c.inputTokenUpperBound + 1,
    completion_tokens: 1, total_tokens: c.inputTokenUpperBound + 2 });
  const over = inspectMem0WireResponse(c, JSON.stringify(tooMany));
  assert.equal(over.usageWithinBounds, false);
  assert.equal(over.payloadValid, true);
  assert.equal(over.failureCode, 'usage_bound_exceeded');
  assert.equal(over.bodyText, null);
  assert.equal(over.actualMicroUsd, Math.ceil((c.inputTokenUpperBound + 1) * 2 / 5) + 2);
  const badBoth = { ...tooMany, choices: [] };
  const both = inspectMem0WireResponse(c, JSON.stringify(badBoth));
  assert.deepEqual([both.usageWithinBounds, both.payloadValid, both.failureCode],
    [false, false, 'usage_bound_exceeded']);
});

test('W6 wrong model/usage never claims cost; malformed payload retains priced usage', () => {
  const c = request('chat', chat());
  const wrong = { ...chatResponse(), model: 'wrong' };
  assert.throws(() => inspectMem0WireResponse(c, JSON.stringify(wrong)), error('invalid_model'));
  assert.throws(() => inspectMem0WireResponse(c, JSON.stringify({ ...chatResponse(), usage: null })),
    error('invalid_usage'));
  assert.throws(() => inspectMem0WireResponse(c, JSON.stringify(chatResponse([], {
    prompt_tokens: 1, completion_tokens: 1, total_tokens: 3 }))), error('invalid_usage'));
  for (const usage of [
    { prompt_tokens: -1, completion_tokens: 1, total_tokens: 0 },
    { prompt_tokens: Number.MAX_SAFE_INTEGER + 1, completion_tokens: 0,
      total_tokens: Number.MAX_SAFE_INTEGER + 1 },
    { prompt_tokens: Number.MAX_SAFE_INTEGER, completion_tokens: 1,
      total_tokens: Number.MAX_SAFE_INTEGER },
    { prompt_tokens: 0, completion_tokens: Number.MAX_SAFE_INTEGER,
      total_tokens: Number.MAX_SAFE_INTEGER },
  ]) assert.throws(() => inspectMem0WireResponse(c,
    JSON.stringify(chatResponse([], usage))), error('invalid_usage'));
  const malformed = { ...chatResponse(), choices: [] };
  const observed = inspectMem0WireResponse(c, JSON.stringify(malformed));
  assert.deepEqual([observed.actualMicroUsd, observed.payloadValid, observed.failureCode,
    observed.bodyText], [3, false, 'invalid_payload', null]);
  const metadata = { ...chatResponse(), extra: '\ud800' };
  assert.equal(inspectMem0WireResponse(c, JSON.stringify(metadata)).actualMicroUsd, 3);
  assert.equal(inspectMem0WireResponse(c, JSON.stringify(metadata)).payloadValid, false);
  let deepMetadata = 'leaf';
  for (let index = 0; index < 33; index += 1) deepMetadata = [deepMetadata];
  const nested = { ...chatResponse(), extra: deepMetadata };
  assert.equal(inspectMem0WireResponse(c, JSON.stringify(nested)).payloadValid, false);
  const e = request('embedding', embedding());
  const tooManyVisited = { ...embeddingResponse(), extra: Array(500_000).fill(null) };
  const large = inspectMem0WireResponse(e, JSON.stringify(tooManyVisited));
  assert.deepEqual([large.actualMicroUsd, large.payloadValid, large.failureCode],
    [1, false, 'invalid_payload']);
});

test('W7 embedding vector cardinality, order, index and finite-value validation', () => {
  const e = request('embedding', embedding(['a', 'b']));
  const valid = embeddingResponse(2, { prompt_tokens: 2, total_tokens: 2 });
  valid.data.reverse();
  const response = inspectMem0WireResponse(e, JSON.stringify(valid));
  assert.equal(response.payloadValid, true);
  assert.equal(response.bodyText, JSON.stringify(valid));
  for (const change of [
    body => { body.data.pop(); },
    body => { body.data[1].index = body.data[0].index; },
    body => { body.data[0].index = 2; },
    body => { body.data[0].embedding.pop(); },
    body => { body.data[0].embedding[0] = 'bad'; },
    body => { body.data[0].object = 'other'; },
  ]) {
    const bad = structuredClone(valid); change(bad);
    const result = inspectMem0WireResponse(e, JSON.stringify(bad));
    assert.deepEqual([result.actualMicroUsd, result.payloadValid, result.failureCode],
      [1, false, 'invalid_payload']);
  }
  assert.throws(() => inspectMem0WireResponse(e, 'not JSON'), error('invalid_response'));
});

test('W7 chat falsey memory, fact text and JSON-object boundaries retain known usage', () => {
  const c = request('chat', chat());
  const missing = chatResponse();
  missing.choices[0].message.content = '{}';
  assert.equal(inspectMem0WireResponse(c, JSON.stringify(missing)).payloadValid, true);
  for (const value of [[], null, false, 0, '']) {
    const result = inspectMem0WireResponse(c, JSON.stringify(chatResponse(value)));
    assert.equal(result.payloadValid, true);
  }
  for (const value of [true, {}, 'truthy', Array(257).fill({ text: '' })]) {
    const result = inspectMem0WireResponse(c, JSON.stringify(chatResponse(value)));
    assert.deepEqual([result.actualMicroUsd, result.payloadValid, result.failureCode],
      [3, false, 'invalid_payload']);
  }
  assert.equal(inspectMem0WireResponse(c, JSON.stringify(chatResponse(
    Array(256).fill({ text: '' })))).payloadValid, true);
  assert.equal(inspectMem0WireResponse(c, JSON.stringify(chatResponse([
    { other: 'native metadata' }, { text: '' }, { text: ' a'.repeat(8192) },
    { text: ' a'.repeat(8192) }]))).payloadValid, true);
  assert.equal(inspectMem0WireResponse(c, JSON.stringify(chatResponse([
    { text: ' a'.repeat(8193) }]))).payloadValid, false);
  assert.equal(inspectMem0WireResponse(c, JSON.stringify(chatResponse([{ text: null }]))).payloadValid,
    false);
  const fenced = chatResponse(); fenced.choices[0].message.content = '```json\n{}\n```';
  assert.equal(inspectMem0WireResponse(c, JSON.stringify(fenced)).payloadValid, false);
  const innerUnicode = chatResponse();
  innerUnicode.choices[0].message.content = '{"memory":[{"text":"\\ud800"}]}';
  assert.equal(inspectMem0WireResponse(c, JSON.stringify(innerUnicode)).payloadValid, false);
});

test('W6/W8 response byte ceiling and immutable result fields', () => {
  const c = request('chat', chat());
  const body = JSON.stringify(chatResponse());
  const limit = mem0WireProfile().chat.maxResponseBytes;
  assert.equal(inspectMem0WireResponse(c, body + ' '.repeat(limit - Buffer.byteLength(body)))
    .payloadValid, true);
  assert.throws(() => inspectMem0WireResponse(c,
    body + ' '.repeat(limit - Buffer.byteLength(body) + 1)), error('invalid_response'));
  const e = request('embedding', embedding());
  const embeddingBody = JSON.stringify(embeddingResponse());
  const embeddingLimit = mem0WireProfile().embedding.maxResponseBytes;
  assert.equal(inspectMem0WireResponse(e, embeddingBody
    + ' '.repeat(embeddingLimit - Buffer.byteLength(embeddingBody))).payloadValid, true);
  assert.throws(() => inspectMem0WireResponse(e, embeddingBody
    + ' '.repeat(embeddingLimit - Buffer.byteLength(embeddingBody) + 1)),
  error('invalid_response'));
  const hundred = request('embedding', embedding(Array(100).fill('a')));
  const hundredResponse = JSON.stringify(embeddingResponse(100,
    { prompt_tokens: 100, total_tokens: 100 }));
  assert.ok(Buffer.byteLength(hundredResponse) > limit);
  assert.equal(inspectMem0WireResponse(hundred, hundredResponse).payloadValid, true);
  const result = inspectMem0WireResponse(c, body);
  assert.deepEqual(Object.keys(result), ['profileVersion', 'route', 'inputTokens', 'outputTokens',
    'actualMicroUsd', 'usageWithinBounds', 'payloadValid', 'failureCode', 'bodyText']);
  assert.equal(Object.isFrozen(result), true);
});
