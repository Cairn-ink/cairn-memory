import { EXTRACT_MEMORIES_PROMPT } from './generated/extract-memories-prompt.mjs';
import { validateQuantities } from '../ledger/quantities.mjs';
import { withQuantityExtraction } from './quantity-spec.mjs';
import { redactSecrets } from './redact.mjs';

export { EXTRACT_MEMORIES_PROMPT };

const kinds = ['fact', 'preference', 'decision', 'instruction', 'context'];
const integer = { type: 'integer', minimum: 0 };
const array = (items, maxItems) => ({ type: 'array', items, maxItems });
const schemaObject = (properties) => ({ type: 'object', properties,
  required: Object.keys(properties), additionalProperties: false });
const extractSchema = schemaObject({ items: array(schemaObject({
  content: { type: 'string', maxLength: 600 },
  kind: { type: 'string', enum: kinds },
  confidence: { type: 'number', minimum: 0, maximum: 1 },
  sourceIndices: { ...array(integer, 4), minItems: 1 },
}), 5) });

/** Project the host's eligible messages in their supplied order. */
export function plainExtractionSpec(messages, options = {}) {
  const input = { messages: messages.map(({ role, content }, index) => ({ index, role, content })) };
  const projected = input.messages;
  if (projected.length > 24) throw new Error('invalid_openai_request');
  for (let position = 0; position < projected.length; position++) {
    const message = projected[position];
    if (!Object.hasOwn(projected, position) || !['user', 'assistant'].includes(message.role) ||
        typeof message.content !== 'string') throw new Error('invalid_openai_request');
  }
  const schema = structuredClone(extractSchema);
  const userCount = projected.filter(message => message.role === 'user').length;
  schema.properties.items.maxItems = projected.length ? Math.max(5, Math.min(20, userCount)) : 0;
  if (projected.length) schema.properties.items.items.properties.sourceIndices.items.maximum = projected.length - 1;
  const request = options.quantities === true
    ? withQuantityExtraction(EXTRACT_MEMORIES_PROMPT, schema)
    : { system: EXTRACT_MEMORIES_PROMPT, schema };
  return { system: request.system, input, schema: request.schema };
}

const fail = (code) => { throw Object.assign(new Error(code), { code }); };

function object(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getOwnPropertyNames(value).some(key =>
        !allowed.includes(key) && Object.getOwnPropertyDescriptor(value, key)?.enumerable)) fail('invalid_input');
  return value;
}

function denseArray(value, min, max) {
  if (!Array.isArray(value) || value.length < min || value.length > max ||
      Object.keys(value).length !== value.length) fail('invalid_input');
  for (let index = 0; index < value.length; index++) {
    if (!Object.hasOwn(value, index)) fail('invalid_input');
  }
  return value;
}

function normalizeBoundedText(value, rawMax = 20_000) {
  if (typeof value !== 'string' || value.length > rawMax) fail('invalid_text');
  const clean = redactSecrets(value.normalize('NFKC')).replace(/\s+/gu, ' ').trim();
  if (!clean || clean === '[REDACTED]' || clean.includes('\0')) fail('invalid_text');
  return clean;
}

function boundedText(value, max) {
  const clean = normalizeBoundedText(value);
  if (clean.length > max) fail('invalid_text');
  return clean;
}

/** Validate the whole batch before the host binds source indices to receipts. */
export function validatePlainCandidates(output, policy) {
  return validateCandidates(output, policy, ['items']);
}

/** Validate items as usual and independently drop invalid entries from the optional list. */
export function validatePlainExtraction(output, policy, options = {}) {
  const enabled = options.quantities === true;
  const items = validateCandidates(output, policy, enabled ? ['items', 'quantities'] : ['items']);
  let value;
  try {
    const descriptor = enabled ? Object.getOwnPropertyDescriptor(output, 'quantities') : undefined;
    value = descriptor && (Object.hasOwn(descriptor, 'value') ? descriptor.value : null);
  } catch {
    value = null;
  }
  return { items, ...validateQuantities(value, items.length) };
}

function validateCandidates(output, { sourceCount, itemLimit }, allowed) {
  let reason = 'invalid_extraction_output_shape';
  try {
    object(output, allowed);
    return denseArray(output.items, 0, itemLimit).map((item) => {
      reason = 'invalid_extraction_item_shape';
      object(item, ['content', 'kind', 'confidence', 'sourceIndices']);
      if (Object.hasOwn(item, 'procedural') &&
          (item.procedural !== true || !['preference', 'instruction'].includes(item.kind))) {
        fail('invalid_model_output');
      }
      reason = 'invalid_extraction_text';
      const content = boundedText(item.content, 600);
      reason = 'invalid_extraction_value';
      if (!kinds.includes(item.kind) || typeof item.confidence !== 'number' ||
          !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) {
        fail('invalid_model_output');
      }
      reason = 'invalid_extraction_source_shape';
      const indices = denseArray(item.sourceIndices, 1, 4);
      reason = 'invalid_extraction_source_duplicate';
      if (new Set(indices).size !== indices.length) fail('invalid_model_output');
      reason = 'invalid_extraction_source_range';
      if (indices.some(index => !Number.isInteger(index) || index < 0 || index >= sourceCount)) {
        fail('invalid_model_output');
      }
      return { content, kind: item.kind, confidence: item.confidence, sourceIndices: [...indices] };
    });
  } catch {
    fail(reason);
  }
}
