import { createRequire } from 'node:module';

const requireFromAdapter = createRequire(new URL('../../adapters/openai/package.json', import.meta.url));
const { get_encoding: getEncoding } = requireFromAdapter('tiktoken');
const chatEncoder = getEncoding('o200k_base');
const embeddingEncoder = getEncoding('cl100k_base');
const boundRecords = new WeakMap();
const VERSION = 'mem0-text-wire-v1';
const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const MAX_DEPTH = 32;
const MAX_VISITED = 1_000_000;

const deepFreeze = value => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

const PROFILE = deepFreeze({
  version: VERSION,
  chat: {
    model: 'gpt-4.1-mini-2025-04-14',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    encoding: 'o200k_base', maxInputTokens: 32_768, maxOutputTokens: 2_000,
    inputFramingTokens: 1_024, maxRequestBytes: 1_048_576, maxResponseBytes: 262_144,
    inputPrice: { microUsdNumerator: 2, tokenDenominator: 5 },
    outputPrice: { microUsdNumerator: 8, tokenDenominator: 5 },
    reservedMicroUsd: 16_308, maxFacts: 256, maxFactTokens: 8_192,
  },
  embedding: {
    model: 'text-embedding-3-small', endpoint: 'https://api.openai.com/v1/embeddings',
    encoding: 'cl100k_base', maxItemInputTokens: 8_192, maxInputTokens: 300_000,
    maxOutputTokens: 0, inputFramingTokens: 0,
    maxRequestBytes: 4_194_304, maxResponseBytes: 8_388_608,
    inputPrice: { microUsdNumerator: 1, tokenDenominator: 50 },
    outputPrice: { microUsdNumerator: 0, tokenDenominator: 1 },
    dimensions: 1_536, encodingFormat: 'float', maxItems: 100,
  },
});

export class Mem0WireError extends Error {
  constructor(code) { super(code); this.name = 'Mem0WireError'; this.code = code; }
}
const fail = code => { throw new Mem0WireError(code); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));
const integer = value => Number.isSafeInteger(value) && value >= 0;
const bytes = text => Buffer.byteLength(text, 'utf8');
const ceiling = (tokens, numerator, denominator) => {
  const amount = (BigInt(tokens) * BigInt(numerator) + BigInt(denominator) - 1n)
    / BigInt(denominator);
  if (amount > BigInt(MAX_SAFE)) fail('invalid_usage');
  return Number(amount);
};

function wellFormed(text) {
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}

// JSON.parse returns data-only values. This bounded iterative walk also checks
// every forwarded key and string, including otherwise ignored metadata.
function safeGraph(root) {
  let visited = 0;
  const queue = [{ value: root, depth: 0 }];
  while (queue.length) {
    const { value, depth } = queue.pop();
    visited += 1;
    if (visited > MAX_VISITED || depth > MAX_DEPTH) return false;
    if (typeof value === 'string') { if (!wellFormed(value)) return false; continue; }
    if (value === null || typeof value === 'boolean') continue;
    if (typeof value === 'number') { if (!Number.isFinite(value)) return false; continue; }
    if (typeof value !== 'object') return false;
    if (!Array.isArray(value) && !plain(value)) return false;
    const keys = Object.keys(value);
    if (keys.length > MAX_VISITED - visited || (Array.isArray(value)
      && (keys.length !== value.length || keys.some((key, index) => key !== String(index))))) {
      return false;
    }
    for (const key of keys) {
      visited += 1;
      if (visited > MAX_VISITED || !wellFormed(key)) return false;
      queue.push({ value: value[key], depth: depth + 1 });
    }
  }
  return true;
}

const count = (encoder, text) => encoder.encode(text, [], []).length;
const canonical = value => JSON.stringify(value);

export function mem0WireProfile() { return PROFILE; }

export function inspectMem0WireRequest(route, bodyText) {
  if (!['chat', 'embedding'].includes(route) || typeof bodyText !== 'string') fail('invalid_options');
  const profile = PROFILE[route];
  if (bytes(bodyText) > profile.maxRequestBytes) fail('unsupported_request');
  let body;
  try { body = JSON.parse(bodyText); } catch { fail('unsupported_request'); }
  if (!safeGraph(body)) fail('unsupported_request');
  let inputTokenUpperBound;
  let itemCount;
  let requestedOutputTokens;
  let reservedMicroUsd;
  if (route === 'chat') {
    if (!exact(body, ['model', 'messages', 'max_tokens', 'temperature', 'top_p',
      'response_format', 'store']) || body.model !== profile.model
      || body.max_tokens !== profile.maxOutputTokens || body.temperature !== 0.1
      || body.top_p !== 0.1 || body.store !== false
      || !exact(body.response_format, ['type']) || body.response_format.type !== 'json_object'
      || !Array.isArray(body.messages) || body.messages.length !== 2
      || body.messages.some((message, index) => !exact(message, ['role', 'content'])
        || message.role !== ['system', 'user'][index] || typeof message.content !== 'string')) {
      fail('unsupported_request');
    }
    inputTokenUpperBound = count(chatEncoder, canonical(body.messages)) + profile.inputFramingTokens;
    if (inputTokenUpperBound > profile.maxInputTokens) fail('input_bound_exceeded');
    itemCount = 2;
    requestedOutputTokens = profile.maxOutputTokens;
    reservedMicroUsd = profile.reservedMicroUsd;
  } else {
    if (!exact(body, ['model', 'input', 'dimensions', 'encoding_format'])
      || body.model !== profile.model || body.dimensions !== profile.dimensions
      || body.encoding_format !== profile.encodingFormat || !Array.isArray(body.input)
      || body.input.length < 1 || body.input.length > profile.maxItems
      || body.input.some(text => typeof text !== 'string' || text.length === 0)) {
      fail('unsupported_request');
    }
    inputTokenUpperBound = 0;
    for (const text of body.input) {
      const tokens = count(embeddingEncoder, text);
      if (tokens > profile.maxItemInputTokens) fail('input_bound_exceeded');
      inputTokenUpperBound += tokens;
      if (inputTokenUpperBound > profile.maxInputTokens) fail('input_bound_exceeded');
    }
    itemCount = body.input.length;
    requestedOutputTokens = 0;
    reservedMicroUsd = Math.max(1, ceiling(inputTokenUpperBound, 1, 50));
  }
  const forwarded = canonical(body);
  if (bytes(forwarded) > profile.maxRequestBytes) fail('unsupported_request');
  const record = Object.freeze({ profileVersion: VERSION, route, bodyText: forwarded,
    inputTokenUpperBound, requestedOutputTokens, reservedMicroUsd, itemCount });
  boundRecords.set(record, Object.freeze({ route, inputTokenUpperBound,
    requestedOutputTokens, itemCount }));
  return record;
}

function embeddingPayload(body, itemCount) {
  if (body.object !== 'list' || !Array.isArray(body.data) || body.data.length !== itemCount) return false;
  const seen = new Set();
  for (const entry of body.data) {
    if (!plain(entry) || entry.object !== 'embedding'
      || !Number.isSafeInteger(entry.index) || entry.index < 0 || entry.index >= itemCount
      || seen.has(entry.index) || !Array.isArray(entry.embedding)
      || entry.embedding.length !== PROFILE.embedding.dimensions
      || entry.embedding.some(value => typeof value !== 'number' || !Number.isFinite(value))) return false;
    seen.add(entry.index);
  }
  return seen.size === itemCount;
}

function chatPayload(body) {
  if (body.object !== 'chat.completion' || !Array.isArray(body.choices)
    || body.choices.length !== 1) return false;
  const choice = body.choices[0];
  if (!plain(choice) || choice.index !== 0 || choice.finish_reason !== 'stop'
    || !plain(choice.message) || choice.message.role !== 'assistant'
    || typeof choice.message.content !== 'string') return false;
  let content;
  try { content = JSON.parse(choice.message.content); } catch { return false; }
  if (!plain(content) || !safeGraph(content)) return false;
  const memory = content.memory;
  if (!memory) return true;
  if (!Array.isArray(memory) || memory.length > PROFILE.chat.maxFacts) return false;
  for (const fact of memory) {
    if (!plain(fact)) return false;
    if (Object.hasOwn(fact, 'text')) {
      if (typeof fact.text !== 'string') return false;
      if (fact.text.length && count(embeddingEncoder, fact.text) > PROFILE.chat.maxFactTokens) {
        return false;
      }
    }
  }
  return true;
}

export function inspectMem0WireResponse(requestRecord, bodyText) {
  const context = boundRecords.get(requestRecord);
  if (!context || typeof bodyText !== 'string') fail('invalid_options');
  const profile = PROFILE[context.route];
  if (bytes(bodyText) > profile.maxResponseBytes) fail('invalid_response');
  let body;
  try { body = JSON.parse(bodyText); } catch { fail('invalid_response'); }
  if (!plain(body)) fail('invalid_response');
  if (body.model !== profile.model) fail('invalid_model');
  const usage = body.usage;
  if (!plain(usage) || !integer(usage.prompt_tokens) || !integer(usage.total_tokens)) {
    fail('invalid_usage');
  }
  let outputTokens = 0;
  let actualMicroUsd;
  if (context.route === 'chat') {
    if (!integer(usage.completion_tokens) || usage.prompt_tokens > MAX_SAFE - usage.completion_tokens
      || usage.total_tokens !== usage.prompt_tokens + usage.completion_tokens) fail('invalid_usage');
    outputTokens = usage.completion_tokens;
    const inputCost = ceiling(usage.prompt_tokens, 2, 5);
    const outputCost = ceiling(outputTokens, 8, 5);
    if (inputCost > MAX_SAFE - outputCost) fail('invalid_usage');
    actualMicroUsd = inputCost + outputCost;
  } else {
    if (usage.prompt_tokens !== usage.total_tokens) fail('invalid_usage');
    actualMicroUsd = ceiling(usage.prompt_tokens, 1, 50);
  }
  const usageWithinBounds = usage.prompt_tokens <= context.inputTokenUpperBound
    && outputTokens <= context.requestedOutputTokens;
  let payloadValid = safeGraph(body) && (context.route === 'chat'
    ? chatPayload(body) : embeddingPayload(body, context.itemCount));
  const normalized = payloadValid ? canonical(body) : null;
  if (normalized !== null && bytes(normalized) > profile.maxResponseBytes) payloadValid = false;
  const accepted = usageWithinBounds && payloadValid;
  return Object.freeze({ profileVersion: VERSION, route: context.route,
    inputTokens: usage.prompt_tokens, outputTokens, actualMicroUsd, usageWithinBounds,
    payloadValid, failureCode: !usageWithinBounds
      ? 'usage_bound_exceeded' : !accepted ? 'invalid_payload' : null,
    bodyText: accepted ? normalized : null });
}
