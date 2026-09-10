import { get_encoding } from 'tiktoken';
import { MemoryStoreError } from '../../core/validation.mjs';
import { emitDiagnostic } from '../../core/model-diagnostics.mjs';
import { schemasFor } from './schemas.mjs';
import { DEFAULT_MODEL, modelProfile } from './profiles.mjs';

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

function checkAbort(signal, diagnose) {
  if (signal.aborted) {
    diagnose?.('model_cancelled');
    throw new DOMException('OpenAI request cancelled', 'AbortError');
  }
}

async function readJSON(response, maximum, signal, diagnose) {
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
      if (size > maximum) { diagnose('response_body_bounds'); providerFailure(); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch (error) { diagnose('response_json'); throw error; }
  } finally {
    // Stop an oversized or interrupted stream without retaining provider bodies.
    signal.removeEventListener('abort', cancel);
    cancel();
    reader.releaseLock();
  }
}

function parseOutput(response, inputTokens, model, diagnose) {
  const reject = (reason) => { diagnose(reason); fail('invalid_model_output'); };
  if (!record(response) || response.object !== 'response' || response.model !== model ||
      response.status !== 'completed' ||
      response.error !== null || response.incomplete_details !== null ||
      !Array.isArray(response.output) || !response.output.length) reject('response_envelope');
  const usage = response.usage;
  if (!record(usage) || !count(usage.input_tokens) || !count(usage.output_tokens) ||
      !count(usage.total_tokens) || usage.input_tokens !== inputTokens || usage.output_tokens > 1024 ||
      usage.total_tokens !== usage.input_tokens + usage.output_tokens) reject('response_usage');
  let text = '';
  for (const message of response.output) {
    if (!record(message) || message.type !== 'message' || message.role !== 'assistant' ||
        message.status !== 'completed' || !Array.isArray(message.content) || !message.content.length) {
      reject('response_message');
    }
    for (const part of message.content) {
      if (!record(part) || part.type !== 'output_text' || typeof part.text !== 'string') {
        reject('response_content');
      }
      text += part.text;
      if (text.length > 40000) reject('output_bounds');
    }
  }
  if (!text.length) reject('response_content');
  if (countTokens(text) > 1024) reject('output_bounds');
  let output;
  try { output = JSON.parse(text); } catch { reject('output_json'); }
  if (!record(output)) reject('output_shape');
  return output;
}

export function createOpenAIModel({ apiKey, fetchImpl = globalThis.fetch,
  extractionModel = DEFAULT_MODEL, onDiagnostic, ...unknown } = {}) {
  const profile = modelProfile(extractionModel);
  const contextWindow = Math.min(...Object.values(profile).map((entry) => entry.contextWindow));
  if (typeof apiKey !== 'string' || !apiKey.trim() || /[\r\n]/.test(apiKey) ||
      typeof fetchImpl !== 'function' || Object.keys(unknown).length ||
      (onDiagnostic !== undefined && typeof onDiagnostic !== 'function')) throw new Error('invalid_openai_configuration');

  async function post(path, body, maximum, signal, diagnose) {
    checkAbort(signal, diagnose);
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
      return await readJSON(response, maximum, signal, diagnose);
    } catch (error) {
      diagnose(signal.aborted || error?.name === 'AbortError' ? 'model_cancelled' : 'transport_failure');
      checkAbort(signal);
      if (error?.name === 'AbortError') throw new DOMException('OpenAI request cancelled', 'AbortError');
      providerFailure();
    }
  }

  async function invoke(method, { system, input, maxOutputTokens, signal }) {
    const diagnose = (reason) => emitDiagnostic({ onDiagnostic }, method, 'adapter', reason);
    if (!(signal instanceof AbortSignal) || typeof system !== 'string' || maxOutputTokens !== 1024) {
      diagnose('request_invalid');
      throw new Error('invalid_openai_request');
    }
    checkAbort(signal, diagnose);
    let serializedInput;
    let localTokens;
    let schema;
    try {
      serializedInput = JSON.stringify(input);
      const snapshot = JSON.parse(serializedInput);
      localTokens = countTokens(JSON.stringify({ system, input: snapshot, maxOutputTokens }));
      schema = schemasFor(method, snapshot);
    } catch (error) {
      diagnose('request_invalid');
      if (error instanceof MemoryStoreError) throw error;
      throw new Error('invalid_openai_request');
    }
    if (typeof serializedInput !== 'string') { diagnose('request_invalid'); throw new Error('invalid_openai_request'); }
    if (localTokens > 6000) { diagnose('request_bounds'); fail('context_budget_exceeded'); }
    const selected = profile[method];
    const payload = { model: selected.model, instructions: system,
      input: [{ role: 'user', content: [{ type: 'input_text', text: serializedInput }] }],
      text: { format: { type: 'json_schema', name: `cairn_${method}`, strict: true,
        schema } }, truncation: 'disabled', ...(selected.reasoning ? { reasoning: selected.reasoning } : {}) };
    // Serialize both requests before the first asynchronous host callback.
    const countBody = JSON.stringify(payload);
    const generateBody = JSON.stringify({ ...payload, max_output_tokens: 1024, store: false, stream: false });
    const counted = await post('/responses/input_tokens', countBody, 65536, signal, diagnose);
    if (!record(counted) || counted.object !== 'response.input_tokens' || !count(counted.input_tokens)) {
      diagnose('token_count_response');
      fail('token_count_unavailable');
    }
    if (counted.input_tokens > 7024 || counted.input_tokens + 1024 > selected.contextWindow) {
      diagnose('request_bounds');
      fail('context_budget_exceeded');
    }
    checkAbort(signal, diagnose);
    const response = await post('/responses', generateBody, 262144, signal, diagnose);
    checkAbort(signal, diagnose);
    return parseOutput(response, counted.input_tokens, selected.model, diagnose);
  }

  return Object.freeze({ contextWindow, countTokens, ...(onDiagnostic === undefined ? {} : { onDiagnostic }),
    extract: (request) => invoke('extract', request),
    classify: (request) => invoke('classify', request),
    select: (request) => invoke('select', request),
    rank: (request) => invoke('rank', request),
  });
}
