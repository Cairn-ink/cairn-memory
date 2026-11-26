import { createHash, createHmac } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { CoreError } from '../../packages/core/src/index.mjs';
import { recallModel } from './provider-config.mjs';

const contextWindow = 1_047_576;
const modelInputLimit = 6_000;
const providerInputLimit = 7_024;
const embeddingModel = 'text-embedding-3-small';
const dimensions = 1_536;
const maxEmbeddingTokens = 50_000_000; // $1 at the installed embedding rate.
const encoder = new TextEncoder();

export const localClock = {
  nowMs: Date.now,
  monotonicMs: () => performance.now(),
  sha256Hex: async text => createHash('sha256').update(text).digest('hex'),
  hmacHex: async (key, text) => createHmac('sha256', key).update(text).digest('hex'),
};

async function readJSON(response, maximum) {
  const length = response.headers.get('content-length');
  if ((length !== null && (!/^\d+$/u.test(length) || Number(length) > maximum)) || !response.body) {
    throw new CoreError('provider_error');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0, text = '', complete = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) { complete = true; break; }
      bytes += value.byteLength;
      if (bytes > maximum) throw new CoreError('response_too_large');
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    if (!complete) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function modelBody({ system, input, schema, schemaName }) {
  return { model: recallModel, instructions: system,
    input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(input) }] }],
    ...(schema && { text: { format: { type: 'json_schema', name: schemaName, strict: true, schema } } }),
    truncation: 'disabled' };
}

function modelOutput(response, countTokens, maximum) {
  if (response?.object !== 'response' || response.model !== recallModel || response.status !== 'completed' ||
      !Array.isArray(response.output)) throw new CoreError('invalid_model_output');
  let text = '';
  for (const message of response.output) {
    if (message.type !== 'message' || message.role !== 'assistant' || !Array.isArray(message.content)) {
      throw new CoreError('invalid_model_output');
    }
    for (const content of message.content) {
      if (content.type !== 'output_text' || typeof content.text !== 'string') throw new CoreError('invalid_model_output');
      text += content.text;
    }
  }
  if (!text || countTokens(text) > maximum) throw new CoreError('invalid_model_output');
  try { return JSON.parse(text); } catch { throw new CoreError('invalid_model_output'); }
}

function orderedVectors(response, count) {
  if (response?.object !== 'list' || response.model !== embeddingModel ||
      !Array.isArray(response.data) || response.data.length !== count) throw new CoreError('embedding_failed');
  const vectors = Array.from({ length: count });
  for (const { index, embedding } of response.data) {
    if (!Number.isInteger(index) || index < 0 || index >= count || vectors[index] ||
        !Array.isArray(embedding) || embedding.length !== dimensions || !embedding.every(Number.isFinite)) {
      throw new CoreError('embedding_failed');
    }
    const norm = Math.sqrt(embedding.reduce((sum, component) => sum + component ** 2, 0));
    if (norm < .9 || norm > 1.1) throw new CoreError('embedding_failed');
    vectors[index] = Float32Array.from(embedding, component => component / norm);
  }
  return vectors;
}

export function createLocalProvider({ key, owner, countTokens, request, authorize, clock = localClock }) {
  const tokens = { countTokens };
  const gate = { async assertOpen(requestOwner) {
    if (requestOwner !== owner) throw new CoreError('authority_required');
    await authorize();
  } };
  async function post(path, body, maximum, options = {}) {
    const timeout = AbortSignal.timeout(30_000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    await gate.assertOpen(owner);
    signal.throwIfAborted();
    let value;
    try {
      const response = await request('https://api.openai.com/v1/' + path, {
        method: 'POST', redirect: 'error', signal, body: JSON.stringify(body),
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new CoreError(response.status === 429 ? 'rate_limited' : 'provider_error');
      }
      value = await readJSON(response, maximum);
    } catch (error) {
      if (timeout.aborted) throw new CoreError('model_timeout');
      if (options.signal?.aborted) throw new CoreError('model_cancelled');
      if (error instanceof CoreError) throw error;
      throw new CoreError('provider_error');
    }
    await gate.assertOpen(owner);
    signal.throwIfAborted();
    return value;
  }
  const model = {
    model: recallModel, contextWindow, countTokens,
    fits(_stage, input) { return countTokens(JSON.stringify(modelBody(input))) <= modelInputLimit; },
    async call(stage, input, options) {
      const body = modelBody(input);
      if (!model.fits(stage, input)) throw new CoreError('context_budget_exceeded');
      const usage = await post('responses/input_tokens', body, 65_536, options);
      const counted = usage?.input_tokens;
      if (usage?.object !== 'response.input_tokens' || !Number.isSafeInteger(counted) || counted < 0) {
        throw new CoreError('token_count_unavailable');
      }
      if (counted > providerInputLimit || counted + input.maxOutputTokens > contextWindow) {
        throw new CoreError('context_budget_exceeded');
      }
      const response = await post('responses', {
        ...body, max_output_tokens: input.maxOutputTokens, store: false, stream: false,
      }, 262_144, options);
      return modelOutput(response, countTokens, input.maxOutputTokens);
    },
    detectChanges(input, options) { return model.call('detectChanges', input, options); },
    verifyChange(input, options) { return model.call('verifyChange', input, options); },
  };
  let budgetDay = -1, remaining = 0;
  const embedder = {
    model: embeddingModel, dimensions,
    async embed(texts, options) {
      const sizes = texts.map(text => encoder.encode(text).byteLength + 16);
      const total = sizes.reduce((sum, length) => sum + length, 0);
      if (!sizes.length || sizes.length > 64 || sizes.some(size => size > 8192) || total > 300_000) {
        throw new CoreError('context_item_too_large');
      }
      await gate.assertOpen(owner);
      const day = Math.floor(clock.nowMs() / 86_400_000);
      if (day > budgetDay) { budgetDay = day; remaining = maxEmbeddingTokens; }
      if (total > remaining) throw new CoreError('embedding_failed');
      remaining -= total;
      try {
        const response = await post('embeddings', { model: embeddingModel, input: texts, dimensions,
          encoding_format: 'float' }, texts.length * dimensions * 32 + 65_536, options);
        return orderedVectors(response, texts.length);
      } catch (error) {
        if (['authority_required', 'capture_paused'].includes(error.code)) throw error;
        throw new CoreError('embedding_failed');
      }
    },
  };
  const embedQuery = { async embedQuery(requestOwner, query, options) {
    await gate.assertOpen(requestOwner);
    const [vector] = await embedder.embed([query], options);
    return { vector, model: embeddingModel };
  } };
  return { model, embedder, gate, clock, tokens, embedQuery };
}
