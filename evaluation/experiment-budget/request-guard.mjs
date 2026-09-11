import {
  closeSync,
  constants,
  fsyncSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  ExperimentBudgetError,
  reopenExperimentBudget,
} from './index.mjs';
import {
  DEFAULT_MODEL,
  EXPERIMENTAL_EXTRACTION_MODEL,
  LUNA_EXTRACTION_MODEL,
} from '../../adapters/openai/profiles.mjs';
import { createOpenAIModel } from '../../adapters/openai/index.mjs';
import { schemasFor } from '../../adapters/openai/schemas.mjs';

const BINDING_FILENAME = 'experiment-request-policy.json';
const EXTENSION_FILENAME = 'experiment-extraction-extension.json';
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const OPENAI_MODELS = new Set([DEFAULT_MODEL, EXPERIMENTAL_EXTRACTION_MODEL]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MODEL_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const CHANNEL_KEYS = Object.freeze([
  'endpoint',
  'inputPrice',
  'inputTokenFraming',
  'maxInputTokens',
  'maxOutputTokens',
  'maxRequestBytes',
  'maxResponseBytes',
  'model',
  'outputPrice',
  'reservedMicroUsd',
  'timeoutMs',
]);
const PRICE_KEYS = Object.freeze(['microUsdNumerator', 'tokenDenominator']);
const POLICY_ENDPOINTS = Object.freeze({
  hostCompletion: 'https://api.openai.com/v1/chat/completions',
  cairnCount: 'https://api.openai.com/v1/responses/input_tokens',
  cairnGeneration: 'https://api.openai.com/v1/responses',
});
const CHANNELS = Object.freeze({
  hostCompletion: 'host-completion',
  cairnCount: 'cairn-count',
  cairnGeneration: 'cairn-generation',
});
const encoder = new TextEncoder();
const localCounter = createOpenAIModel({
  apiKey: 'synthetic-local-counter',
  fetchImpl: () => { throw new Error('local_counter_has_no_transport'); },
});

export class ExperimentRequestGuardError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ExperimentRequestGuardError';
    this.code = code;
  }
}

const fail = (code) => { throw new ExperimentRequestGuardError(code); };
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isPlainObject = (value) => value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const safeInteger = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum;

function exactKeys(value, keys, code = 'invalid_options') {
  if (!isPlainObject(value)) fail(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(code);
  }
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isPlainObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function validatePrice(value) {
  exactKeys(value, PRICE_KEYS, 'invalid_policy');
  if (!safeInteger(value.microUsdNumerator) || !safeInteger(value.tokenDenominator, 1)) {
    fail('invalid_policy');
  }
}

function pricedTokens(tokens, price) {
  const numerator = BigInt(tokens) * BigInt(price.microUsdNumerator);
  return (numerator + BigInt(price.tokenDenominator) - 1n) / BigInt(price.tokenDenominator);
}

function pricedUpperBound(channel) {
  return pricedTokens(channel.maxInputTokens, channel.inputPrice)
    + pricedTokens(channel.maxOutputTokens, channel.outputPrice);
}

function validateChannel(name, value) {
  exactKeys(value, CHANNEL_KEYS, 'invalid_policy');
  if (value.endpoint !== POLICY_ENDPOINTS[name]
    || typeof value.model !== 'string'
    || !MODEL_PATTERN.test(value.model)
    || !OPENAI_MODELS.has(value.model)
    || !safeInteger(value.reservedMicroUsd, 1)
    || !safeInteger(value.maxRequestBytes, 1)
    || !safeInteger(value.maxResponseBytes, 1)
    || !safeInteger(value.timeoutMs, 1) || value.timeoutMs > 2_147_483_647
    || !safeInteger(value.maxInputTokens, 1)
    || !safeInteger(value.maxOutputTokens)
    || !safeInteger(value.inputTokenFraming)) {
    fail('invalid_policy');
  }
  if (name !== 'hostCompletion' && value.inputTokenFraming !== 1024) fail('invalid_policy');
  if (name === 'cairnCount' && value.maxOutputTokens !== 0) fail('invalid_policy');
  if (name !== 'cairnCount' && value.maxOutputTokens < 1) fail('invalid_policy');
  validatePrice(value.inputPrice);
  validatePrice(value.outputPrice);
  if (name !== 'cairnCount') {
    const upper = pricedUpperBound(value);
    if (upper > BigInt(MAX_SAFE_INTEGER) || BigInt(value.reservedMicroUsd) < upper) {
      fail('invalid_policy');
    }
  }
}

function snapshotPolicy(policy) {
  let snapshot;
  try { snapshot = structuredClone(policy); } catch { fail('invalid_policy'); }
  exactKeys(snapshot, ['version', 'hostCompletion', 'cairnCount', 'cairnGeneration'], 'invalid_policy');
  if (snapshot.version !== 1) fail('invalid_policy');
  for (const name of Object.keys(POLICY_ENDPOINTS)) validateChannel(name, snapshot[name]);
  return deepFreeze(snapshot);
}

function validateConstructor(options) {
  exactKeys(options, ['fetchImpl', 'ledger', 'policy']);
  if (typeof options.fetchImpl !== 'function') fail('invalid_options');
  exactKeys(options.ledger, ['directory', 'limitMicroUsd', 'requestCap', 'runId']);
  if (typeof options.ledger.directory !== 'string' || !UUID_PATTERN.test(options.ledger.runId)
    || !safeInteger(options.ledger.limitMicroUsd, 1) || !safeInteger(options.ledger.requestCap, 1)) {
    fail('invalid_options');
  }
  return snapshotPolicy(options.policy);
}

function readBinding(filename, expected) {
  let entry;
  try { entry = lstatSync(filename); } catch { fail('unsafe_policy_binding'); }
  if (entry.isSymbolicLink() || !entry.isFile()
    || entry.size > 1_000_000
    || (process.platform !== 'win32' && (entry.mode & 0o777) !== 0o600)) {
    fail('unsafe_policy_binding');
  }
  let descriptor;
  try {
    if (realpathSync(filename) !== filename) fail('unsafe_policy_binding');
    descriptor = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== entry.dev || opened.ino !== entry.ino
      || opened.size > 1_000_000 || opened.nlink !== 1
      || (process.platform !== 'win32' && (opened.mode & 0o777) !== 0o600)) fail('unsafe_policy_binding');
    const bytes = readFileSync(descriptor);
    if (bytes.byteLength > 1_000_000) fail('unsafe_policy_binding');
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (expected !== undefined && canonical(parsed) !== canonical(expected)) fail('policy_mismatch');
    return parsed;
  } catch (error) {
    if (error instanceof ExperimentRequestGuardError) throw error;
    fail('unsafe_policy_binding');
  } finally { if (descriptor !== undefined) closeSync(descriptor); }
}

function bindPolicy(directory, runId, policy, ledgerState) {
  const resolvedDirectory = path.resolve(directory);
  const filename = path.join(resolvedDirectory, BINDING_FILENAME);
  const binding = { version: 1, runId, policy };
  try {
    lstatSync(filename);
    readBinding(filename, binding);
    return;
  } catch (error) {
    if (error instanceof ExperimentRequestGuardError) throw error;
    if (error?.code !== 'ENOENT') fail('unsafe_policy_binding');
  }
  if (ledgerState.requestCount !== 0 || ledgerState.reservedMicroUsd !== 0 || ledgerState.attempts.length !== 0) {
    fail('policy_binding_missing');
  }
  let descriptor;
  try {
    descriptor = openSync(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    writeFileSync(descriptor, `${canonical(binding)}\n`, { encoding: 'utf8' });
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    const directoryDescriptor = openSync(resolvedDirectory, constants.O_RDONLY);
    try { fsyncSync(directoryDescriptor); } finally { closeSync(directoryDescriptor); }
  } catch (error) {
    try { if (descriptor !== undefined) closeSync(descriptor); } catch { /* Preserve binding failure. */ }
    if (error?.code === 'EEXIST') {
      readBinding(filename, binding);
      return;
    }
    fail('unsafe_policy_binding');
  }
  readBinding(filename, binding);
}

function requestSnapshot(url, options, channel) {
  if (url instanceof URL) url = url.href;
  if (typeof url !== 'string' || url !== channel.endpoint) fail('invalid_request');
  exactKeys(options, ['body', 'headers', 'method', 'redirect', 'signal'], 'invalid_request');
  if (options.method !== 'POST' || options.redirect !== 'error'
    || !(options.signal instanceof AbortSignal) || typeof options.body !== 'string') {
    fail('invalid_request');
  }
  if (options.signal.aborted) fail('request_aborted');
  let headers;
  try { headers = new Headers(options.headers); } catch { fail('invalid_request'); }
  if ([...headers.keys()].some((key) => !['authorization', 'content-type'].includes(key))
    || headers.get('content-type') !== 'application/json'
    || !/^Bearer [^\s\r\n]+$/u.test(headers.get('authorization') ?? '')) {
    fail('invalid_request');
  }
  const bytes = encoder.encode(options.body).byteLength;
  if (bytes > channel.maxRequestBytes) fail('request_too_large');
  let body;
  try { body = JSON.parse(options.body); } catch { fail('invalid_request'); }
  if (!isPlainObject(body)) fail('invalid_request');
  if (options.signal.aborted) fail('request_aborted');
  return { body, bodyText: options.body, headers, signal: options.signal };
}

function jsonValue(value, depth = 0) {
  if (depth > 20) return false;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 256 && value.every((item) => jsonValue(item, depth + 1));
  return isPlainObject(value) && Object.keys(value).length <= 256
    && Object.entries(value).every(([key, child]) => key.length <= 256 && jsonValue(child, depth + 1));
}

function validateHostMessage(message) {
  if (!isPlainObject(message) || !['developer', 'system', 'user', 'assistant', 'tool'].includes(message.role)) {
    fail('unsupported_request');
  }
  if (message.role === 'tool') {
    exactKeys(message, ['content', 'role', 'tool_call_id'], 'unsupported_request');
    if (typeof message.content !== 'string' || typeof message.tool_call_id !== 'string'
      || !message.tool_call_id.length || message.tool_call_id.length > 256) fail('unsupported_request');
    return;
  }
  if (message.role !== 'assistant' || !own(message, 'tool_calls')) {
    exactKeys(message, ['content', 'role'], 'unsupported_request');
    if (typeof message.content !== 'string') fail('unsupported_request');
    return;
  }
  exactKeys(message, ['content', 'role', 'tool_calls'], 'unsupported_request');
  if (message.content !== null && typeof message.content !== 'string') fail('unsupported_request');
  if (!Array.isArray(message.tool_calls) || message.tool_calls.length < 1 || message.tool_calls.length > 32) {
    fail('unsupported_request');
  }
  for (const call of message.tool_calls) {
    exactKeys(call, ['function', 'id', 'type'], 'unsupported_request');
    exactKeys(call.function, ['arguments', 'name'], 'unsupported_request');
    if (call.type !== 'function' || typeof call.id !== 'string' || !call.id.length
      || typeof call.function.name !== 'string' || !call.function.name.length
      || typeof call.function.arguments !== 'string') fail('unsupported_request');
  }
}

function validateHostTool(tool) {
  exactKeys(tool, ['function', 'type'], 'unsupported_request');
  if (tool.type !== 'function' || !isPlainObject(tool.function)) fail('unsupported_request');
  const allowed = ['description', 'name', 'parameters', 'strict'];
  if (!Object.keys(tool.function).every((key) => allowed.includes(key))
    || !own(tool.function, 'name') || !own(tool.function, 'parameters')
    || typeof tool.function.name !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/u.test(tool.function.name)
    || (own(tool.function, 'description') && typeof tool.function.description !== 'string')
    || (own(tool.function, 'strict') && typeof tool.function.strict !== 'boolean')
    || !isPlainObject(tool.function.parameters) || !jsonValue(tool.function.parameters)) fail('unsupported_request');
}

function validateHostBody(body, channel, byteLength) {
  const allowed = ['max_completion_tokens', 'messages', 'model', 'n', 'store', 'stream', 'tool_choice', 'tools'];
  if (!Object.keys(body).every((key) => allowed.includes(key))
    || !own(body, 'model') || !own(body, 'messages') || !own(body, 'store') || !own(body, 'stream')
    || !own(body, 'max_completion_tokens')
    || body.model !== channel.model || body.store !== false || body.stream !== false
    || !Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 128
    || (own(body, 'n') && body.n !== 1)
    || !safeInteger(body.max_completion_tokens, 1)
    || body.max_completion_tokens > channel.maxOutputTokens) {
    fail('unsupported_request');
  }
  for (const message of body.messages) validateHostMessage(message);
  if (own(body, 'tools')) {
    if (!Array.isArray(body.tools) || body.tools.length < 1 || body.tools.length > 32) fail('unsupported_request');
    for (const tool of body.tools) validateHostTool(tool);
  }
  if (own(body, 'tool_choice')) {
    if (body.tool_choice === 'none' || body.tool_choice === 'auto' || body.tool_choice === 'required') {
      // Closed string choices.
    } else {
      exactKeys(body.tool_choice, ['function', 'type'], 'unsupported_request');
      exactKeys(body.tool_choice.function, ['name'], 'unsupported_request');
      if (body.tool_choice.type !== 'function'
        || typeof body.tool_choice.function.name !== 'string') fail('unsupported_request');
    }
  }
  if (byteLength + channel.inputTokenFraming > channel.maxInputTokens) fail('input_bound_exceeded');
}

function deepEqual(left, right) { return canonical(left) === canonical(right); }

function validateCairnBody(body, channel, generation) {
  const baseKeys = ['input', 'instructions', 'model', 'text', 'truncation'];
  const expectedKeys = generation
    ? [...baseKeys, 'max_output_tokens', 'store', 'stream']
    : baseKeys;
  if ([EXPERIMENTAL_EXTRACTION_MODEL, LUNA_EXTRACTION_MODEL].includes(body.model)) expectedKeys.push('reasoning');
  exactKeys(body, expectedKeys, 'unsupported_request');
  if (body.model !== channel.model || typeof body.instructions !== 'string'
    || body.truncation !== 'disabled' || !Array.isArray(body.input) || body.input.length !== 1) {
    fail('unsupported_request');
  }
  exactKeys(body.input[0], ['content', 'role'], 'unsupported_request');
  if (body.input[0].role !== 'user' || !Array.isArray(body.input[0].content)
    || body.input[0].content.length !== 1) fail('unsupported_request');
  exactKeys(body.input[0].content[0], ['text', 'type'], 'unsupported_request');
  if (body.input[0].content[0].type !== 'input_text'
    || typeof body.input[0].content[0].text !== 'string') fail('unsupported_request');
  if ([EXPERIMENTAL_EXTRACTION_MODEL, LUNA_EXTRACTION_MODEL].includes(body.model)) {
    if (!deepEqual(body.reasoning, { effort: 'none' })) fail('unsupported_request');
  }
  exactKeys(body.text, ['format'], 'unsupported_request');
  const format = body.text.format;
  exactKeys(format, ['name', 'schema', 'strict', 'type'], 'unsupported_request');
  const match = /^cairn_(extract|classify|select|rank)$/u.exec(format.name);
  let input;
  try { input = JSON.parse(body.input[0].content[0].text); } catch { fail('unsupported_request'); }
  let expectedSchema;
  try { expectedSchema = match ? schemasFor(match[1], input) : null; }
  catch { fail('unsupported_request'); }
  if (!match || format.type !== 'json_schema' || format.strict !== true
    || !deepEqual(format.schema, expectedSchema)) fail('unsupported_request');
  let localTokens;
  try {
    localTokens = localCounter.countTokens(JSON.stringify({
      system: body.instructions,
      input,
      maxOutputTokens: 1024,
    }));
  } catch { fail('unsupported_request'); }
  if (localTokens > 6000 || localTokens + channel.inputTokenFraming > channel.maxInputTokens) {
    fail('input_bound_exceeded');
  }
  if (generation && (body.max_output_tokens !== 1024
    || body.max_output_tokens > channel.maxOutputTokens || body.store !== false || body.stream !== false)) {
    fail('unsupported_request');
  }
}

function integerUsage(value) { return safeInteger(value); }

function parseUsage(json, kind, channel, requestedOutputTokens) {
  if (kind === 'cairnCount') {
    exactKeys(json, ['input_tokens', 'object'], 'invalid_response');
    if (json.object !== 'response.input_tokens' || !integerUsage(json.input_tokens)
      || json.input_tokens > channel.maxInputTokens) fail('invalid_response');
    return { actualMicroUsd: null, withinBounds: true };
  }
  if (kind === 'hostCompletion') {
    if (json?.object !== 'chat.completion' || json?.model !== channel.model) fail('invalid_response');
  } else if (json?.object !== 'response' || json?.model !== channel.model) fail('invalid_response');
  const usage = json?.usage;
  if (!isPlainObject(usage)) fail('invalid_response');
  const input = kind === 'hostCompletion' ? usage.prompt_tokens : usage.input_tokens;
  const output = kind === 'hostCompletion' ? usage.completion_tokens : usage.output_tokens;
  const total = usage.total_tokens;
  if (!integerUsage(input) || !integerUsage(output) || !integerUsage(total) || total !== input + output) {
    fail('invalid_response');
  }
  const actual = pricedTokens(input, channel.inputPrice) + pricedTokens(output, channel.outputPrice);
  if (actual > BigInt(MAX_SAFE_INTEGER)) fail('invalid_response');
  return {
    actualMicroUsd: Number(actual),
    withinBounds: input <= channel.maxInputTokens
      && output <= channel.maxOutputTokens
      && output <= requestedOutputTokens,
  };
}

function abortError(signal) {
  return signal.reason === 'request_timeout' ? 'request_timeout' : 'request_aborted';
}

function raceAbort(promise, signal) {
  if (signal.aborted) {
    Promise.resolve(promise).catch(() => {});
    return Promise.reject(new ExperimentRequestGuardError(abortError(signal)));
  }
  return new Promise((resolve, reject) => {
    const aborted = () => reject(new ExperimentRequestGuardError(abortError(signal)));
    signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve(promise).then(
      (value) => { signal.removeEventListener('abort', aborted); resolve(value); },
      (error) => { signal.removeEventListener('abort', aborted); reject(error); },
    );
  });
}

async function readBounded(response, maximum, signal) {
  if (!response?.body || typeof response.body.getReader !== 'function') fail('invalid_response');
  const reader = response.body.getReader();
  const cancel = () => {
    try { Promise.resolve(reader.cancel()).catch(() => {}); } catch { /* Best-effort cancellation only. */ }
  };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await raceAbort(reader.read(), signal);
      if (done) break;
      if (!(value instanceof Uint8Array)) fail('invalid_response');
      size += value.byteLength;
      if (size > maximum) fail('response_too_large');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel();
    try { reader.releaseLock(); } catch { /* Content-free failure below remains authoritative. */ }
  }
}

function parseResponseJson(bytes) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail('invalid_response'); }
}

function extensionConfiguration(options) {
  const policy = validateConstructor({ ledger: options.ledger, policy: options.policy, fetchImpl: () => {} });
  if (typeof options.authorizationId !== 'string'
    || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/u.test(options.authorizationId)) fail('invalid_extension');
  if (Object.keys(CHANNELS).some((name) => policy[name].model !== DEFAULT_MODEL)
    || policy.cairnCount.maxInputTokens !== 7024 || policy.cairnGeneration.maxInputTokens !== 7024
    || policy.cairnGeneration.maxOutputTokens !== 1024) fail('invalid_extension');
  const ledger = structuredClone(options.ledger);
  ledger.directory = path.resolve(ledger.directory);
  const models = {};
  for (const [model, input, output] of [[LUNA_EXTRACTION_MODEL, 25, 120], [EXPERIMENTAL_EXTRACTION_MODEL, 75, 450]]) {
    models[model] = {};
    for (const kind of ['cairnCount', 'cairnGeneration']) {
      const channel = { ...policy[kind], model,
        inputPrice: { microUsdNumerator: input, tokenDenominator: 100 },
        outputPrice: { microUsdNumerator: output, tokenDenominator: 100 } };
      channel.reservedMicroUsd = Math.max(channel.reservedMicroUsd, Number(pricedUpperBound(channel)));
      models[model][kind] = channel;
    }
  }
  return { version: 1, authorizationId: options.authorizationId, ledger, policy, method: 'cairn_extract', models };
}

function verifyExtension(extension, ledger, policy) {
  exactKeys(extension, ['version', 'authorizationId', 'ledger', 'policy', 'method', 'models', 'checkpoint'], 'invalid_extension');
  const expected = extensionConfiguration({ ledger, policy, authorizationId: extension.authorizationId });
  exactKeys(extension.checkpoint, ['requestCount', 'reservedMicroUsd'], 'invalid_extension');
  if (!safeInteger(extension.checkpoint.requestCount) || !safeInteger(extension.checkpoint.reservedMicroUsd)
    || extension.checkpoint.requestCount > ledger.requestCap || extension.checkpoint.reservedMicroUsd > ledger.limitMicroUsd
    || canonical(extension) !== canonical({ ...expected, checkpoint: extension.checkpoint })) fail('invalid_extension');
  readBinding(path.join(expected.ledger.directory, BINDING_FILENAME), { version: 1, runId: ledger.runId, policy });
  readBinding(path.join(expected.ledger.directory, EXTENSION_FILENAME), extension);
}

function verifyExtensionCheckpoint(extension, state) {
  const prefix = state.attempts.slice(0, extension.checkpoint.requestCount);
  if (prefix.length !== extension.checkpoint.requestCount || prefix.some((attempt) => attempt.outcome === null)
    || prefix.reduce((sum, attempt) => sum + attempt.reservedMicroUsd, 0) !== extension.checkpoint.reservedMicroUsd) {
    fail('policy_mismatch');
  }
}

// Provisioning is separate from transport construction: existing guards never opt in implicitly.
export function authorizeExtractionModelExtension(options) {
  exactKeys(options, ['ledger', 'policy', 'authorizationId']);
  const configuration = extensionConfiguration(options);
  const ledger = reopenExperimentBudget(configuration.ledger);
  let lock;
  try {
    readBinding(path.join(configuration.ledger.directory, BINDING_FILENAME),
      { version: 1, runId: configuration.ledger.runId, policy: configuration.policy });
    // The same SQLite writer lock used by reservations excludes setup/checkpoint races.
    lock = new DatabaseSync(path.join(configuration.ledger.directory, 'experiment-budget.sqlite'));
    lock.exec('BEGIN IMMEDIATE');
    const state = ledger.getState();
    if (state.state !== 'open' || state.attempts.some((attempt) => attempt.outcome === null)) fail('extension_busy');
    const filename = path.join(configuration.ledger.directory, EXTENSION_FILENAME);
    let existing;
    try { existing = lstatSync(filename); } catch (error) { if (error?.code !== 'ENOENT') fail('unsafe_policy_binding'); }
    if (existing) {
      // Read once only to recover the immutable creation checkpoint; verify every other byte below.
      const extension = readBinding(filename);
      verifyExtension(extension, configuration.ledger, configuration.policy);
      verifyExtensionCheckpoint(extension, state);
      if (extension.authorizationId !== configuration.authorizationId
        || extension.checkpoint.requestCount > state.requestCount
        || extension.checkpoint.reservedMicroUsd > state.reservedMicroUsd) fail('policy_mismatch');
      return deepFreeze(extension);
    }
    const extension = { ...configuration, checkpoint: { requestCount: state.requestCount, reservedMicroUsd: state.reservedMicroUsd } };
    let descriptor;
    try {
      descriptor = openSync(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      writeFileSync(descriptor, `${canonical(extension)}\n`, { encoding: 'utf8' });
      fsyncSync(descriptor);
    } finally { if (descriptor !== undefined) closeSync(descriptor); }
    const directoryDescriptor = openSync(configuration.ledger.directory, constants.O_RDONLY);
    try { fsyncSync(directoryDescriptor); } finally { closeSync(directoryDescriptor); }
    verifyExtension(extension, configuration.ledger, configuration.policy);
    return deepFreeze(extension);
  } catch (error) {
    if (error instanceof ExperimentRequestGuardError || error instanceof ExperimentBudgetError) throw error;
    fail('unsafe_policy_binding');
  } finally {
    if (lock) { try { lock.exec('ROLLBACK'); } catch { /* No ledger writes were made. */ } lock.close(); }
    ledger.close();
  }
}

export function createExtendedExperimentRequestGuard(options) {
  exactKeys(options, ['ledger', 'policy', 'fetchImpl', 'extension']);
  let extension;
  try { extension = deepFreeze(structuredClone(options.extension)); } catch { fail('invalid_extension'); }
  if (!isPlainObject(extension)) fail('invalid_extension');
  return constructGuard({ ledger: options.ledger, policy: options.policy, fetchImpl: options.fetchImpl }, extension);
}

export function createExperimentRequestGuard(options) { return constructGuard(options); }

function constructGuard(options, extension = null) {
  const policy = validateConstructor(options);
  const ledgerConfiguration = structuredClone(options.ledger);
  let ledger;
  try { ledger = reopenExperimentBudget(ledgerConfiguration); }
  catch (error) {
    if (error instanceof ExperimentBudgetError) throw error;
    fail('ledger_failed');
  }
  try {
    if (extension) {
      verifyExtension(extension, ledgerConfiguration, policy);
      verifyExtensionCheckpoint(extension, ledger.getState());
    }
    else bindPolicy(ledgerConfiguration.directory, ledgerConfiguration.runId, policy, ledger.getState());
  }
  catch (error) { ledger.close(); throw error; }

  const fetchImpl = options.fetchImpl;
  let closed = false;
  let inFlight = 0;

  const guardedFetch = (kind) => async (url, requestOptions) => {
    if (closed) fail('guard_closed');
    if (extension) {
      verifyExtension(extension, ledgerConfiguration, policy);
      verifyExtensionCheckpoint(extension, ledger.getState());
    }
    let channel = policy[kind];
    const snapshot = requestSnapshot(url, requestOptions, channel);
    if (extension && kind !== 'hostCompletion' && snapshot.body.model !== channel.model) {
      if (snapshot.body.text?.format?.name !== 'cairn_extract'
        || !own(extension.models, snapshot.body.model)) fail('unsupported_request');
      channel = extension.models[snapshot.body.model][kind];
    }
    const requestBytes = encoder.encode(snapshot.bodyText).byteLength;
    if (kind === 'hostCompletion') validateHostBody(snapshot.body, channel, requestBytes);
    else validateCairnBody(snapshot.body, channel, kind === 'cairnGeneration');

    const attemptId = randomUUID();
    ledger.reserve({ attemptId, channel: CHANNELS[kind], reservedMicroUsd: channel.reservedMicroUsd });
    inFlight += 1;
    const controller = new AbortController();
    const externalAbort = () => controller.abort('request_aborted');
    snapshot.signal.addEventListener('abort', externalAbort, { once: true });
    if (snapshot.signal.aborted) externalAbort();
    const timer = setTimeout(() => controller.abort('request_timeout'), channel.timeoutMs);
    let settled = false;
    const settle = (outcome, actualMicroUsd) => {
      if (settled) return;
      settled = true;
      const outcomeRecord = actualMicroUsd === null
        ? { attemptId, outcome }
        : { attemptId, outcome, actualMicroUsd };
      ledger.recordOutcome(outcomeRecord);
    };
    try {
      let response;
      try {
        const pending = Promise.resolve().then(() => {
          if (controller.signal.aborted) fail(abortError(controller.signal));
          return fetchImpl(channel.endpoint, {
            method: 'POST',
            redirect: 'error',
            signal: controller.signal,
            headers: snapshot.headers,
            body: snapshot.bodyText,
          });
        });
        pending.then((late) => {
          if (controller.signal.aborted) {
            try { Promise.resolve(late?.body?.cancel()).catch(() => {}); } catch { /* Late cleanup only. */ }
          }
        }, () => {});
        response = await raceAbort(pending, controller.signal);
      } catch (error) {
        settle('unknown', null);
        if (error instanceof ExperimentRequestGuardError) throw error;
        fail('transport_failed');
      }
      if (!(response instanceof Response)) {
        settle('unknown', null);
        fail('transport_failed');
      }
      let bytes;
      try { bytes = await readBounded(response, channel.maxResponseBytes, controller.signal); }
      catch (error) {
        settle('unknown', null);
        if (error instanceof ExperimentRequestGuardError) throw error;
        fail('transport_failed');
      }
      if (response.redirected || response.status < 200 || response.status >= 300) {
        settle('failed', null);
        fail('http_failed');
      }
      let json;
      let usage;
      try {
        json = parseResponseJson(bytes);
        const requestedOutputTokens = kind === 'hostCompletion'
          ? snapshot.body.max_completion_tokens
          : kind === 'cairnGeneration' ? snapshot.body.max_output_tokens : 0;
        usage = parseUsage(json, kind, channel, requestedOutputTokens);
      } catch (error) {
        settle('unknown', null);
        if (error instanceof ExperimentRequestGuardError) throw error;
        fail('invalid_response');
      }
      settle('succeeded', usage.actualMicroUsd);
      if (!usage.withinBounds
        || (usage.actualMicroUsd !== null && usage.actualMicroUsd > channel.reservedMicroUsd)) {
        fail('usage_bound_exceeded');
      }
      try {
        return new Response(bytes, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      } catch { fail('invalid_response'); }
    } finally {
      clearTimeout(timer);
      snapshot.signal.removeEventListener('abort', externalAbort);
      inFlight -= 1;
    }
  };

  return Object.freeze({
    hostFetch: guardedFetch('hostCompletion'),
    cairnFetch(url, requestOptions) {
      const text = url instanceof URL ? url.href : url;
      if (text === policy.cairnCount.endpoint) return guardedFetch('cairnCount')(url, requestOptions);
      if (text === policy.cairnGeneration.endpoint) return guardedFetch('cairnGeneration')(url, requestOptions);
      fail('invalid_request');
    },
    getState() {
      if (closed) fail('guard_closed');
      return ledger.getState();
    },
    close() {
      if (closed) return;
      if (inFlight !== 0) fail('guard_busy');
      closed = true;
      ledger.close();
    },
    policy,
  });
}
