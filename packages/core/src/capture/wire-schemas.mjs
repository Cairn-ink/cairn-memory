// Capture boundaries read accessor-backed fields once through a snapshot and refuse Proxies,
// functions and symbol values with the entry's invalid code. The engine may reread fields or accept stable Proxies.
// Indexed wire input has its own property descriptor checks.
import { CoreError } from '../errors.mjs';
import { extractionLimit, extractionOutputTokens } from './capture-input.mjs';
import { snapshotQualificationTextCatalog } from './qualification-text-catalog.mjs';
import { validateDenseArray } from './validate.mjs';

export { extractionOutputTokens };

/** @returns {never} */
function invalid() { throw new CoreError('invalid_input'); }

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {unknown} value @returns {unknown[]} */
function list(value) {
  if (!Array.isArray(value)) invalid();
  return value;
}

/** @param {unknown} value */
function index(value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid();
  return value;
}

/** @param {unknown} value @param {string} field */
function fieldValue(value, field) {
  return /** @type {Record<string, unknown> | null | undefined} */ (value)?.[field];
}

/** @param {number[]} values */
function sorted(values) {
  return [...new Set(values)].sort((a, b) => a - b);
}

/** @template T @param {T} base @param {number[]} values */
function constrained(base, values) {
  return { ...base, enum: sorted(values) };
}

/** @template T @param {T} items @param {number} maxItems */
const array = (items, maxItems) => ({ type: 'array', items, maxItems });

/** @template {object} T @param {T} properties */
const object = (properties) => ({ type: 'object', properties,
  required: Object.keys(properties), additionalProperties: false });

/** @type {{type: string, minimum: number, maximum?: number}} */
const integer = { type: 'integer', minimum: 0 };

export const schemas = {
  extract: object({ items: array(object({ content: { type: 'string', maxLength: 600 },
    kind: { type: 'string', enum: ['fact', 'preference', 'decision', 'instruction', 'context'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    sourceIndices: { ...array(integer, 4), minItems: 1 },
  }), 5) }),
};

/** @param {unknown} value @param {string[]} fields */
function exactData(value, fields) {
  if (!record(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).length !== fields.length) invalid();
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
  }
  return value;
}

/** Detach and validate indexed windows before serialization.
 * @param {unknown} input
 */
export function snapshotIndexedExtractInput(input) {
  const { inputMode, messages } = exactData(input, ['inputMode', 'messages']);
  if (inputMode !== 'indexed-windows-v1') invalid();
  let windows;
  try { windows = validateDenseArray(messages, 1, 64); } catch { invalid(); }
  if (Reflect.ownKeys(windows).length !== windows.length + 1) invalid();
  const copied = [];
  let messageIndex = -1, groupUnits = 0, totalUnits = 0;
  /** @type {unknown} */
  let role;
  for (let position = 0; position < windows.length; position++) {
    const descriptor = Object.getOwnPropertyDescriptor(windows, String(position));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
    const message = exactData(descriptor.value, ['index', 'messageIndex', 'role', 'content']);
    const { messageIndex: group, role: sourceRole, content } = message;
    if (message.index !== position || typeof group !== 'number' || !Number.isSafeInteger(group) ||
        group < 0 || group > 23 || (sourceRole !== 'user' && sourceRole !== 'assistant') ||
        typeof content !== 'string' || !content.length ||
        !/** @type {string & {isWellFormed(): boolean}} */ (content).isWellFormed() || content.length > 800) invalid();
    if (group !== messageIndex) {
      if (group !== messageIndex + 1) invalid();
      messageIndex = group;
      groupUnits = 0;
      role = sourceRole;
    } else if (sourceRole !== role) invalid();
    groupUnits += content.length;
    totalUnits += content.length;
    if (groupUnits > 4000 || totalUnits > 20000) invalid();
    copied.push({ index: position, messageIndex, role: sourceRole, content });
  }
  return { inputMode, messages: copied };
}

/** @param {number} itemIndex */
export const qualificationSlot = itemIndex => `item_${itemIndex}`;

/** @param {unknown} input */
export function qualificationCandidatesInlineSchema(input) {
  if (!record(input) || Object.hasOwn(input, 'inputMode')) invalid();
  const items = Array.from(list(fieldValue(input, 'items')));
  if (!items.length || items.length > 5) invalid();
  const itemIndices = items.map(item => index(fieldValue(item, 'itemIndex')));
  if (sorted(itemIndices).length !== items.length) invalid();
  const allCandidateIndices = new Set();
  const entries = items.map((item, position) => {
    const itemIndex = itemIndices[position];
    const candidates = Array.from(list(fieldValue(item, 'candidates')));
    if (!candidates.length) invalid();
    const candidateIndices = candidates.map(candidate => {
      const candidateIndex = index(fieldValue(candidate, 'candidateIndex'));
      if (allCandidateIndices.has(candidateIndex)) invalid();
      allCandidateIndices.add(candidateIndex);
      return candidateIndex;
    });
    /** @param {object} known @param {object} unknown */
    const field = (known, unknown) => ({ anyOf: [
      object({ value: known, evidenceIndices: {
        ...array(constrained(integer, candidateIndices), 4), minItems: 1,
      } }),
      object({ value: unknown, evidenceIndices: {
        ...array(constrained(integer, candidateIndices), 4), minItems: 0,
      } }),
    ] });
    /** @param {number} maximum */
    const descriptive = maximum => field({ type: 'string', minLength: 1, maxLength: maximum }, { type: 'null' });
    /** @param {string[]} values */
    const categorical = values => field({ type: 'string', enum: values }, { type: 'string', enum: ['unknown'] });
    return [qualificationSlot(itemIndex), object({ itemIndex: constrained(integer, [itemIndex]),
      subject: descriptive(160), property: descriptive(160),
      scope: descriptive(120), applies: descriptive(120), value: descriptive(160),
      attribution: categorical(['direct', 'reported', 'quoted', 'proposed']),
      commitment: categorical(['adopted', 'considered', 'rejected']),
    })] /** @type {const} */;
  });
  return object({ qualifications: object(Object.fromEntries(entries)) });
}

/** @param {ReturnType<typeof qualificationCandidatesInlineSchema>} inline */
function qualificationEvidencePoolSchema(inline) {
  /** @param {number} minimum */
  const evidenceSlots = minimum => ({ ...array({ type: 'integer', minimum: 0, maximum: 3 }, 4), minItems: minimum });
  /** @param {object} known @param {object} unknown */
  const field = (known, unknown) => ({ anyOf: [
    object({ value: known, evidenceSlots: evidenceSlots(1) }),
    object({ value: unknown, evidenceSlots: evidenceSlots(0) }),
  ] });
  /** @param {number} maximum */
  const descriptive = maximum => field({ type: 'string', minLength: 1, maxLength: maximum }, { type: 'null' });
  /** @param {string[]} values */
  const categorical = values => field({ type: 'string', enum: values }, { type: 'string', enum: ['unknown'] });
  const definitions = { text160: descriptive(160), text120: descriptive(120),
    attribution: categorical(['direct', 'reported', 'quoted', 'proposed']),
    commitment: categorical(['adopted', 'considered', 'rejected']) };
  const slots = inline.properties.qualifications.properties;
  const entries = Object.fromEntries(Object.entries(slots).map(([name, slot]) => {
    const candidateIds = slot.properties.subject.anyOf[0].properties.evidenceIndices.items.enum;
    return [name, object({ itemIndex: slot.properties.itemIndex,
      pool: { ...array(constrained(integer, candidateIds), 4), minItems: 1 },
      subject: { $ref: '#/$defs/text160' }, property: { $ref: '#/$defs/text160' },
      scope: { $ref: '#/$defs/text120' }, applies: { $ref: '#/$defs/text120' },
      value: { $ref: '#/$defs/text160' }, attribution: { $ref: '#/$defs/attribution' },
      commitment: { $ref: '#/$defs/commitment' } })] /** @type {const} */;
  }));
  return { ...object({ wireVersion: { type: 'string', enum: ['evidence-pool-v1'] },
    qualifications: object(entries) }), $defs: definitions };
}

/** @param {unknown} input */
export function schemasForQualificationInput(input) {
  if (!input || typeof input !== 'object' || !Object.hasOwn(input, 'inputMode')) {
    return schemasFor('qualifyCandidates', input);
  }
  try {
    const { expanded } = snapshotQualificationTextCatalog(input);
    return qualificationEvidencePoolSchema(qualificationCandidatesInlineSchema(expanded));
  } catch { invalid(); }
}

/**
 * @param {'extract' | 'qualify' | 'qualifyCandidates'} method
 * @param {unknown} input
 */
export function schemasFor(method, input) {
  if (method === 'qualifyCandidates') {
    return qualificationEvidencePoolSchema(qualificationCandidatesInlineSchema(input));
  }
  if (!record(input)) invalid();
  if (method === 'qualify') {
    const items = list(fieldValue(input, 'items'));
    if (!items.length || items.length > 5) invalid();
    const itemIndices = items.map(item => index(fieldValue(item, 'itemIndex')));
    if (sorted(itemIndices).length !== items.length) invalid();
    /** @param {number} maximum */
    const nullable = maximum => ({ type: ['string', 'null'], minLength: 1, maxLength: maximum });
    const variants = items.map((item, position) => {
      const sources = list(fieldValue(item, 'sources'));
      const receiptIndices = sources.map(source => index(fieldValue(source, 'receiptIndex')));
      if (!sources.length || sources.length > 4 || sorted(receiptIndices).length !== sources.length) invalid();
      return object({ itemIndex: constrained(integer, [itemIndices[position]]), qualification: object({
        version: { type: 'integer', enum: [1] },
        slot: object({ subject: nullable(160), property: nullable(160), scope: nullable(120), applies: nullable(120) }),
        value: nullable(160),
        attribution: { type: 'string', enum: ['direct', 'reported', 'quoted', 'proposed', 'unknown'] },
        commitment: { type: 'string', enum: ['adopted', 'considered', 'rejected', 'unknown'] },
        anchors: { ...array(object({ receiptIndex: constrained(integer, receiptIndices),
          start: { ...integer, maximum: 799 }, end: { type: 'integer', minimum: 1, maximum: 800 },
          text: { type: 'string', minLength: 1, maxLength: 200 },
          fields: { ...array({ type: 'string', enum: ['subject', 'property', 'scope', 'applies', 'value',
            'attribution', 'commitment'] }, 7), minItems: 1 },
        }), 4), minItems: 1 },
      }) });
    });
    return object({ qualifications: { ...array({ anyOf: variants }, items.length), minItems: items.length } });
  }

  if (method !== 'extract') invalid();
  const indexed = Object.hasOwn(input, 'inputMode');
  const messages = indexed ? snapshotIndexedExtractInput(input).messages : list(fieldValue(input, 'messages'));
  if (!indexed) {
    if (messages.length > 24) invalid();
    for (let position = 0; position < messages.length; position++) {
      const message = messages[position];
      const role = fieldValue(message, 'role');
      if (!Object.hasOwn(messages, position) || index(fieldValue(message, 'index')) !== position ||
          (role !== 'user' && role !== 'assistant') || typeof fieldValue(message, 'content') !== 'string') invalid();
    }
  }
  const schema = structuredClone(schemas.extract);
  schema.properties.items.maxItems = messages.length ? extractionLimit(messages) : 0;
  if (messages.length) schema.properties.items.items.properties.sourceIndices.items.maximum = messages.length - 1;
  return schema;
}
