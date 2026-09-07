import { get_encoding } from 'tiktoken';
import { MemoryStoreError } from '../../core/validation.mjs';
import { schemas } from './schemas.mjs';

const model = 'gpt-4.1-mini-2025-04-14';
const contextWindow = 1047576;
const encoder = get_encoding('o200k_base');
const fail = (code) => { throw new MemoryStoreError(code); };
const providerFailure = () => { throw new Error('openai_request_failed'); };
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const count = (value) => Number.isSafeInteger(value) && value >= 0;

function countTokens(text) {
  if (typeof text !== 'string') fail('token_count_unavailable');
  try { return encoder.encode(text, [], []).length; }
  catch { fail('token_count_unavailable'); }
}

function checkAbort(signal) {
  if (signal.aborted) throw new DOMException('OpenAI request cancelled', 'AbortError');
}

async function readJSON(response, maximum, signal) {
  if (!response.body || typeof response.body.getReader !== 'function') providerFailure();
  const reader = response.body.getReader();
  const cancel = () => { reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      checkAbort(signal);
      const { done, value } = await reader.read();
      checkAbort(signal);
      if (done) break;
      if (!(value instanceof Uint8Array)) providerFailure();
      size += value.byteLength;
      if (size > maximum) providerFailure();
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally {
    // Stop an oversized or interrupted stream without retaining provider bodies.
    signal.removeEventListener('abort', cancel);
    cancel();
    reader.releaseLock();
  }
}

function parseOutput(response, inputTokens) {
  if (!record(response) || response.object !== 'response' || response.model !== model ||
      response.status !== 'completed' ||
      response.error !== null || response.incomplete_details !== null ||
      !Array.isArray(response.output) || !response.output.length) fail('invalid_model_output');
  const usage = response.usage;
  if (!record(usage) || !count(usage.input_tokens) || !count(usage.output_tokens) ||
      !count(usage.total_tokens) || usage.input_tokens !== inputTokens || usage.output_tokens > 1024 ||
      usage.total_tokens !== usage.input_tokens + usage.output_tokens) fail('invalid_model_output');
  let text = '';
  for (const message of response.output) {
    if (!record(message) || message.type !== 'message' || message.role !== 'assistant' ||
        message.status !== 'completed' || !Array.isArray(message.content) || !message.content.length) {
      fail('invalid_model_output');
    }
    for (const part of message.content) {
      if (!record(part) || part.type !== 'output_text' || typeof part.text !== 'string') {
        fail('invalid_model_output');
      }
      text += part.text;
      if (text.length > 40000) fail('invalid_model_output');
    }
  }
  if (!text.length || countTokens(text) > 1024) fail('invalid_model_output');
  let output;
  try { output = JSON.parse(text); } catch { fail('invalid_model_output'); }
  if (!record(output)) fail('invalid_model_output');
  return output;
}

export function createOpenAIModel({ apiKey, fetchImpl = globalThis.fetch } = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim() || /[\r\n]/.test(apiKey) ||
      typeof fetchImpl !== 'function') throw new Error('invalid_openai_configuration');

  async function post(path, body, maximum, signal) {
    checkAbort(signal);
    try {
      const response = await fetchImpl(`https://api.openai.com/v1${path}`, {
        method: 'POST', redirect: 'error', signal,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body,
      });
      checkAbort(signal);
      if (!response.ok || response.redirected || response.status < 200 || response.status >= 300) {
        response.body?.cancel().catch(() => {});
        providerFailure();
      }
      return await readJSON(response, maximum, signal);
    } catch (error) {
      checkAbort(signal);
      if (error?.name === 'AbortError') throw new DOMException('OpenAI request cancelled', 'AbortError');
      providerFailure();
    }
  }

  async function invoke(method, { system, input, maxOutputTokens, signal }) {
    if (!(signal instanceof AbortSignal) || typeof system !== 'string' || maxOutputTokens !== 1024) {
      throw new Error('invalid_openai_request');
    }
    checkAbort(signal);
    let serializedInput;
    let localTokens;
    try {
      serializedInput = JSON.stringify(input);
      localTokens = countTokens(JSON.stringify({ system, input, maxOutputTokens }));
    } catch (error) {
      if (error instanceof MemoryStoreError) throw error;
      throw new Error('invalid_openai_request');
    }
    if (typeof serializedInput !== 'string') throw new Error('invalid_openai_request');
    if (localTokens > 6000) fail('context_budget_exceeded');
    const payload = { model, instructions: system,
      input: [{ role: 'user', content: [{ type: 'input_text', text: serializedInput }] }],
      text: { format: { type: 'json_schema', name: `cairn_${method}`, strict: true,
        schema: schemas[method] } }, truncation: 'disabled' };
    // Serialize both requests before the first asynchronous host callback.
    const countBody = JSON.stringify(payload);
    const generateBody = JSON.stringify({ ...payload, max_output_tokens: 1024, store: false, stream: false });
    const counted = await post('/responses/input_tokens', countBody, 65536, signal);
    if (!record(counted) || counted.object !== 'response.input_tokens' || !count(counted.input_tokens)) {
      fail('token_count_unavailable');
    }
    if (counted.input_tokens > localTokens + 1024 || counted.input_tokens + 1024 > contextWindow) {
      fail('context_budget_exceeded');
    }
    checkAbort(signal);
    const response = await post('/responses', generateBody, 262144, signal);
    checkAbort(signal);
    return parseOutput(response, counted.input_tokens);
  }

  return Object.freeze({ contextWindow, countTokens,
    extract: (request) => invoke('extract', request),
    classify: (request) => invoke('classify', request),
    select: (request) => invoke('select', request),
    rank: (request) => invoke('rank', request),
  });
}
