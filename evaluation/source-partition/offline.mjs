// Synthetic, OFF-by-default planning only. No capture, provider or native dispatch.
import { createHash } from 'node:crypto';
import { captureSnapshot } from '../../core/capture-input.mjs';
import { extractionRequest } from '../../core/capture.mjs';
import { MODEL_INPUT_TOKENS, modelRequestText } from '../../core/model-call.mjs';
import { identifier } from '../../core/validation.mjs';

export const SOURCE_PARTITION_VERSION = 'cairn-synthetic-source-partition-v1';
export const SOURCE_PARTITION_POLICY = 'indexed-evidence-v1';
const EVENT_DOMAIN = 'cairn.synthetic.source-partition-event.v1';
const MAX_WINDOWS = 20;
const MAX_DATA_NODES = 200_000;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

// Parsed JSON / ordinary data objects only; Proxy traps are not guaranteed inert.
// Inspect every descriptor before reading it. Bound the diagnostic's own input
// traversal; authoritative message/window/text limits still come from core.
function data(value, state = { nodes: 0, bytes: 0, ancestors: new Set() }, depth = 0) {
  if (++state.nodes > MAX_DATA_NODES || depth > 16) fail('diagnostic_input_invalid');
  if (typeof value === 'string') {
    state.bytes += Buffer.byteLength(value, 'utf8');
    if (!value.isWellFormed() || value.includes('\0') || state.bytes > 8 * 1024 * 1024)
      fail('diagnostic_input_invalid');
    return value;
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) fail('diagnostic_input_invalid');
    return value;
  }
  if (!value || typeof value !== 'object' || state.ancestors.has(value)) fail('diagnostic_input_invalid');
  const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
  if (prototype !== (array ? Array.prototype : Object.prototype)) fail('diagnostic_input_invalid');
  const keys = Reflect.ownKeys(value);
  if (keys.length > MAX_DATA_NODES - state.nodes || array && (value.length > 20_000
    || keys.length !== value.length + 1)) fail('diagnostic_input_invalid');
  state.ancestors.add(value);
  const result = array ? [] : {};
  for (const key of array ? Array.from({ length: value.length }, (_, i) => String(i)) : keys) {
    if (typeof key !== 'string') fail('diagnostic_input_invalid');
    state.bytes += Buffer.byteLength(key, 'utf8');
    if (state.bytes > 8 * 1024 * 1024) fail('diagnostic_input_invalid');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail('diagnostic_input_invalid');
    Object.defineProperty(result, key, { value: data(descriptor.value, state, depth + 1),
      enumerable: true, configurable: true, writable: true });
  }
  state.ancestors.delete(value);
  return result;
}
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key)))
    fail('diagnostic_input_invalid');
}
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const unwrap = result => {
  if (!result.ok) fail(result.error.code);
  return result.value;
};

function sourceData(input) {
  const detached = data(input);
  exact(detached, ['namespace', 'client', 'sources']);
  exact(detached.namespace, ['ownerId', 'scope', 'projectId']);
  const { ownerId, scope, projectId } = detached.namespace;
  // This deliberately narrow harness does not admit user/production namespaces.
  if (typeof ownerId !== 'string' || !ownerId.startsWith('synthetic-') || scope !== 'project'
    || typeof projectId !== 'string' || !projectId.startsWith('synthetic-')) fail('diagnostic_input_invalid');
  const namespace = { ownerId: identifier(ownerId), scope, projectId: identifier(projectId) };
  const client = identifier(detached.client);
  if (!Array.isArray(detached.sources) || !detached.sources.length || detached.sources.length > 64)
    fail('diagnostic_input_invalid');
  // This first harness intentionally requires globally distinct message IDs.
  // Core receipt identity is broader (client/session/event); this is not an
  // engine rule and equal IDs in different sessions are outside this fixture scope.
  const boundaries = new Set(), identities = new Set();
  const sources = detached.sources.map(source => {
    exact(source, ['baseEventId', 'sessionId', 'batchId', 'date', 'messages']);
    const result = { baseEventId: identifier(source.baseEventId),
      sessionId: identifier(source.sessionId), batchId: identifier(source.batchId),
      date: source.date, messages: source.messages };
    if (typeof result.date !== 'string' || !result.date.trim()) fail('diagnostic_input_invalid');
    const boundary = JSON.stringify([result.sessionId, result.batchId]);
    if (boundaries.has(boundary)) fail('diagnostic_input_invalid');
    boundaries.add(boundary);
    if (!Array.isArray(result.messages)) fail('diagnostic_input_invalid');
    result.messages = result.messages.map(message => {
      exact(message, ['id', 'role', 'content']);
      return { id: message.id, role: message.role, content: message.content };
    });
    const snapshot = captureSnapshot({ namespace, client, sessionId: result.sessionId,
      eventId: result.baseEventId, messages: result.messages }, undefined, SOURCE_PARTITION_POLICY);
    // Canonical bytes only: never silently NFKC/redact/trim the proposed source.
    if (!same(snapshot.messages, result.messages)) fail('diagnostic_source_not_canonical');
    for (const message of snapshot.messages) {
      if (identities.has(message.id)) fail('diagnostic_input_invalid');
      identities.add(message.id);
    }
    return result;
  });
  return freeze({ namespace, client, sources });
}

function requestFor(source, messages, eventId, input) {
  const captureInput = { namespace: input.namespace, client: input.client,
    sessionId: source.sessionId, eventId, messages };
  const snapshot = captureSnapshot(captureInput, undefined, SOURCE_PARTITION_POLICY);
  return { captureInput, request: extractionRequest(snapshot, { captureSourcePolicy: SOURCE_PARTITION_POLICY }) };
}
function origins(source, groupIndex, catalog, offset = 0) {
  return catalog.entries.map(entry => ({ groupIndex, sessionId: source.sessionId,
    batchId: source.batchId, date: source.date,
    originalMessageIndex: offset + entry.messageIndex, messageId: entry.id,
    role: entry.role, startUtf16: entry.start, endUtf16: entry.end, excerpt: entry.content }));
}
function eventId(input, source, messages, arm) {
  return 'synthetic-partition-' + digest([EVENT_DOMAIN, arm, input.namespace, input.client,
    source.baseEventId, source.sessionId, source.batchId, source.date, messages.map(message => message.id)]);
}
function tokens(countTokens, request) {
  const value = countTokens(modelRequestText(request.system, request.input));
  if (!Number.isSafeInteger(value) || value < 0) fail('token_count_unavailable');
  return value;
}
function fitsWhole(core, messages) {
  const planned = unwrap(core.planCaptureBatches({ messages }));
  if (planned.oversizedMessageIndices.length) return false;
  return planned.batches.length === 1
    && same(planned.batches[0], messages.map((_, index) => index));
}

/**
 * Plan actual <=20-window partitions, preserving each original batch/session.
 * Trusted core and counter are injected: the adapter test uses the actual local
 * o200k export. Core must use the same counter and indexed-evidence-v1 policy;
 * there is no public core configuration getter to attest that capability here.
 * This promises extraction fit only, NOT later classification,
 * select/rank fit, provider input_tokens or semantic/source completeness.
 */
export function prepareSourcePartition({ core, input, countTokens }) {
  if (typeof core?.planCaptureBatches !== 'function' || typeof countTokens !== 'function')
    fail('diagnostic_input_invalid');
  const frozenInput = sourceData(input), partitions = [], originalBatches = [], allOrigins = [];
  for (const [groupIndex, source] of frozenInput.sources.entries()) {
    const original = requestFor(source, source.messages,
      eventId(frozenInput, source, source.messages, 'unchanged'), frozenInput);
    const fullOrigins = origins(source, groupIndex, original.request.catalog);
    allOrigins.push(...fullOrigins);
    const originalTokens = tokens(countTokens, original.request);
    const originalFits = fitsWhole(core, source.messages);
    if (originalFits !== (originalTokens <= MODEL_INPUT_TOKENS)) fail('diagnostic_counter_mismatch');
    originalBatches.push({ groupIndex, ...original.captureInput,
      origins: fullOrigins, windowCount: fullOrigins.length, extractionTokens: originalTokens,
      extractionFits: originalFits });
    let start = 0;
    const append = end => {
      const messages = source.messages.slice(start, end); // Whole objects, no text slicing.
      const part = requestFor(source, messages, eventId(frozenInput, source, messages, 'partition'), frozenInput);
      const bound = origins(source, groupIndex, part.request.catalog, start);
      const count = tokens(countTokens, part.request);
      if (bound.length > MAX_WINDOWS || count > MODEL_INPUT_TOKENS || !fitsWhole(core, messages))
        fail('diagnostic_partition_unfit');
      partitions.push({ groupIndex, ...part.captureInput, origins: bound,
        windowCount: bound.length, extractionTokens: count, extractionFits: true });
    };
    for (let end = 1; end <= source.messages.length; end++) {
      const messages = source.messages.slice(start, end);
      const candidate = requestFor(source, messages, source.baseEventId, frozenInput);
      const windows = candidate.request.catalog.entries.length;
      const count = tokens(countTokens, candidate.request);
      const coreFits = fitsWhole(core, messages);
      if (coreFits !== (count <= MODEL_INPUT_TOKENS)) fail('diagnostic_counter_mismatch');
      if (windows <= MAX_WINDOWS && coreFits) continue;
      if (end - 1 === start) fail('diagnostic_message_unfit');
      append(end - 1);
      start = end - 1;
      const singleton = requestFor(source, source.messages.slice(start, end), source.baseEventId, frozenInput);
      if (singleton.request.catalog.entries.length > MAX_WINDOWS
        || tokens(countTokens, singleton.request) > MODEL_INPUT_TOKENS
        || !fitsWhole(core, source.messages.slice(start, end))) fail('diagnostic_message_unfit');
    }
    append(source.messages.length);
  }
  const plan = { schemaVersion: SOURCE_PARTITION_VERSION, captureSourcePolicy: SOURCE_PARTITION_POLICY,
    qualification: 'not-requested', extractionInputTokenLimit: MODEL_INPUT_TOKENS,
    maxSourceWindowsPerPartition: MAX_WINDOWS, input: frozenInput,
    originalBatches, partitions, origins: allOrigins, semanticCoverage: 'unassessed' };
  // Generated output duplicates source data. Apply the SAME verification bound
  // before origin-union serialization or publication: expansion is not exempted.
  data(plan);
  if (!same(partitions.flatMap(part => part.origins), allOrigins)
    || new Set(partitions.map(part => part.eventId)).size !== partitions.length) fail('diagnostic_plan_invalid');
  return freeze(plan);
}

/** Reconstruct before any awaited dispatch; never trust caller-edited local coordinates. */
export function verifySourcePartition({ core, plan, input, countTokens }) {
  const detachedPlan = data(plan);
  const expected = prepareSourcePartition({ core, input, countTokens });
  if (!same(detachedPlan, expected)) fail('diagnostic_plan_invalid');
  return expected; // Frozen authoritative copy, not the supplied mutable plan.
}
