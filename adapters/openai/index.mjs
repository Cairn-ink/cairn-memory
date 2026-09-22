import { get_encoding } from 'tiktoken';
import { MemoryStoreError } from '../../core/validation.mjs';
import { emitDiagnostic } from '../../core/model-diagnostics.mjs';
import { schemasFor } from './schemas.mjs';
import { DEFAULT_MODEL, modelProfile } from './profiles.mjs';
import { classificationWire } from './classification-wire.mjs';

const encoder = get_encoding('o200k_base');
const fail = (code) => { throw new MemoryStoreError(code); };
const providerFailure = () => { throw new Error('openai_request_failed'); };
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const qualificationSlot = itemIndex => `item_${itemIndex}`;

// The provider's strict-schema subset is small and request-scoped here. Core
// still performs the authoritative source/semantic compilation after mapping.
function schemaAccepts(schema, value) {
  if (schema.anyOf) return schema.anyOf.some(child => schemaAccepts(child, value));
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === 'null') return value === null;
  if (schema.type === 'object') return record(value) && schema.required.every(key => Object.hasOwn(value, key))
    && (schema.additionalProperties !== false || Object.keys(value).every(key => Object.hasOwn(schema.properties, key)))
    && Object.entries(schema.properties).every(([key, child]) => schemaAccepts(child, value[key]));
  if (schema.type === 'array') return Array.isArray(value) && value.length <= schema.maxItems
    && (schema.minItems === undefined || value.length >= schema.minItems)
    && value.every(child => schemaAccepts(schema.items, child));
  if (schema.type === 'integer') return Number.isSafeInteger(value)
    && (schema.minimum === undefined || value >= schema.minimum)
    && (schema.maximum === undefined || value <= schema.maximum);
  if (schema.type === 'string') return typeof value === 'string'
    && (schema.minLength === undefined || value.length >= schema.minLength)
    && (schema.maxLength === undefined || value.length <= schema.maxLength);
  return false;
}

function qualificationInstructions(method, system, input) {
  if (method !== 'qualifyCandidates') return system;
  const mapping = input.items.map(item => `${qualificationSlot(item.itemIndex)}=>itemIndex ${item.itemIndex}`).join(', ');
  return `${system}\n\nProvider wire-format override: return qualifications as an object, not the illustrative array above. `
    + `Use exactly these required transport fields: ${mapping}. Each field's value is its complete qualification entry. `
    + 'These field names are transport mapping only, not semantic slot identifiers.';
}

function normalizeQualificationSlots(method, input, output, schema, diagnose) {
  if (method !== 'qualifyCandidates') return output;
  const reject = () => { diagnose('output_shape'); fail('invalid_model_output'); };
  if (!schemaAccepts(schema, output)) reject();
  const expected = input.items.map(item => qualificationSlot(item.itemIndex));
  const qualifications = input.items.map((item, position) => {
    const value = output.qualifications[expected[position]];
    if (value.itemIndex !== item.itemIndex) reject();
    return value;
  });
  return { qualifications };
}

function normalizeClassificationWire(method, output, schema, wire, diagnose) {
  if (method !== 'classify') return undefined;
  const reject = () => { diagnose('output_shape'); fail('invalid_model_output'); };
  if (!schemaAccepts(schema, output)) reject();
  try { return wire.decode(output); } catch { reject(); }
}

function countTokens(text) {
  if (typeof text !== 'string') fail('token_count_unavailable');
  try { return encoder.encode(text, [], []).length; }
  catch { fail('token_count_unavailable'); }
}

// Local tokenizer only: no credentials, transport or generation are required.
export { countTokens as countOpenAITokens };

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
      chunks.push(new Uint8Array(value));
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

function parseOutput(response, contextWindow, model, diagnose) {
  const reject = (reason) => { diagnose(reason); fail('invalid_model_output'); };
  if (!record(response) || response.object !== 'response' || response.model !== model ||
      response.status !== 'completed' ||
      response.error !== null || response.incomplete_details !== null ||
      !Array.isArray(response.output) || !response.output.length) reject('response_envelope');
  const usage = response.usage;
  if (!record(usage) || !count(usage.input_tokens) || !count(usage.output_tokens) ||
      !count(usage.total_tokens) || usage.input_tokens > 7024 || usage.input_tokens + 1024 > contextWindow || usage.output_tokens > 1024 ||
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
  extractionModel = DEFAULT_MODEL, rationaleModel = DEFAULT_MODEL, basisModel = DEFAULT_MODEL,
  onDiagnostic, ...unknown } = {}) {
  const profile = modelProfile(extractionModel, rationaleModel, basisModel);
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
    let snapshot;
    let wire;
    let instructions;
    try {
      // Validate before JSON serialization can erase sparse/custom fields.
      if (method === 'selectChecklist') schemasFor(method, input);
      const originalSerializedInput = JSON.stringify(input);
      snapshot = JSON.parse(originalSerializedInput);
      schema = schemasFor(method, snapshot);
      instructions = qualificationInstructions(method, system, snapshot);
      localTokens = countTokens(JSON.stringify({ system: instructions, input: snapshot, maxOutputTokens }));
      if (method === 'classify') {
        wire = classificationWire(snapshot);
        snapshot = wire.input;
        schema = schemasFor(method, snapshot);
      }
      serializedInput = JSON.stringify(snapshot);
    } catch (error) {
      diagnose('request_invalid');
      if (error instanceof MemoryStoreError) throw error;
      throw new Error('invalid_openai_request');
    }
    if (typeof serializedInput !== 'string') { diagnose('request_invalid'); throw new Error('invalid_openai_request'); }
    if (localTokens > 6000) { diagnose('request_bounds'); fail('context_budget_exceeded'); }
    const selected = profile[method === 'selectChecklist' ? 'select' : method];
    const payload = { model: selected.model, instructions,
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
    const output = parseOutput(response, selected.contextWindow, selected.model, diagnose);
    return normalizeClassificationWire(method, output, schema, wire, diagnose)
      ?? normalizeQualificationSlots(method, snapshot, output, schema, diagnose);
  }

  return Object.freeze({ contextWindow, countTokens, ...(onDiagnostic === undefined ? {} : { onDiagnostic }),
    extract: (request) => invoke('extract', request),
    qualify: (request) => invoke('qualify', request),
    qualifyCandidates: (request) => invoke('qualifyCandidates', request),
    relate: (request) => invoke('relate', request),
    reviewBasis: (request) => invoke('reviewBasis', request),
    classify: (request) => invoke('classify', request),
    select: (request) => invoke('select', request),
    selectChecklist: (request) => invoke('selectChecklist', request),
    rank: (request) => invoke('rank', request),
    reconcile: (request) => invoke('reconcile', request),
  });
}
