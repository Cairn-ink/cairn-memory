import { CoreError } from '../errors.mjs';

/** @import { ClassificationInput } from './packing.mjs' */
/** @import { PlacementProposal } from './proposal.mjs' */
/** @import { ClassificationSchema, ClassificationWire } from './wire.mjs' */

const string = /** @type {const} */ ({ type: 'string' });

/** @param {ClassificationSchema} items @param {number} maxItems */
const array = (items, maxItems) => ({ type: /** @type {const} */ ('array'), items, maxItems });
/** @param {Record<string, ClassificationSchema>} properties */
const object = (properties) => ({ type: /** @type {const} */ ('object'), properties,
  required: Object.keys(properties), additionalProperties: /** @type {const} */ (false) });

/** @returns {never} */
const invalid = () => { throw new CoreError('invalid_input'); };
/** @param {unknown} value */
const id = (value) => { if (typeof value !== 'string' || !value.length) invalid(); return value; };
/** @param {unknown} value @returns {unknown[]} */
const list = (value) => { if (!Array.isArray(value)) invalid(); return value; };
/** @param {string[]} ids */
const constrained = (ids) => ids.length ? { ...string, enum: [...new Set(ids)].sort() } : { ...string };
/** @param {string[]} ids */
const idArray = (ids) => array(constrained(ids), Math.min(3, new Set(ids).size));

/** @param {unknown} input @returns {ClassificationSchema} */
export function classifySchema(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid();
  const request = /** @type {{ memories?: unknown, map?: unknown, mapExhausted?: unknown }} */ (input);
  const memories = list(request.memories);
  if (memories.length > 5 || Object.keys(memories).length !== memories.length) invalid();
  const memoryIds = memories.map((memory) => id(/** @type {{ id?: unknown } | null} */ (memory)?.id));
  if (new Set(memoryIds).size !== memoryIds.length) invalid();
  /** @type {string[]} */
  const l1 = [];
  /** @type {string[]} */
  const l2 = [];
  if (typeof request.mapExhausted !== 'boolean') invalid();
  for (const entry of list(request.map)) {
    const item = /** @type {{ type?: unknown, moc?: { level?: unknown, id?: unknown } } | null} */ (entry);
    if (item?.type !== 'moc') continue;
    const moc = item.moc;
    if (moc?.level !== 'L1' && moc?.level !== 'L2') invalid();
    (moc.level === 'L1' ? l1 : l2).push(id(moc.id));
  }
  const existing = { memoryId: constrained(memoryIds), parentIds: idArray(l1) };
  const topic = { title: { ...string }, parentL2Ids: idArray(l2) };
  const variants = [object(existing)];
  if (request.mapExhausted) variants.push(object({ ...existing,
    newL1: { anyOf: [object(topic), object({ ...topic, newL2Title: { ...string } })] } }));
  return object({ items: { ...array({ anyOf: variants }, memoryIds.length), minItems: memoryIds.length } });
}

/** Validate the strict schema subset produced by classifySchema.
 * @param {ClassificationSchema} schema @param {unknown} value @returns {boolean}
 */
export function schemaAccepts(schema, value) {
  if (schema.anyOf) return schema.anyOf.some((child) => schemaAccepts(child, value));
  if (schema.enum && (typeof value !== 'string' || !schema.enum.includes(value))) return false;
  if (schema.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const fields = /** @type {Record<string, unknown>} */ (value);
    const { required, properties } = schema;
    return !!required && !!properties && required.every((key) => Object.hasOwn(fields, key))
      && (schema.additionalProperties !== false || Object.keys(fields).every((key) => Object.hasOwn(properties, key)))
      && Object.entries(properties).every(([key, child]) => schemaAccepts(child, fields[key]));
  }
  if (schema.type === 'array') {
    const { items, minItems, maxItems } = schema;
    return !!items && Array.isArray(value) && maxItems !== undefined && value.length <= maxItems
      && (minItems === undefined || value.length >= minItems)
      && value.every((child) => schemaAccepts(items, child));
  }
  return schema.type === 'string' && typeof value === 'string';
}

/** @param {Iterable<string>} values @param {'m' | 'c'} role */
function roleMap(values, role) {
  /** @type {Map<string, string>} */
  const originalToWire = new Map();
  /** @type {Map<string, string>} */
  const wireToOriginal = new Map();
  for (const value of values) {
    if (originalToWire.has(value)) continue;
    const wire = `${role}${originalToWire.size.toString(36)}`;
    originalToWire.set(value, wire);
    wireToOriginal.set(wire, value);
  }
  return {
    encode: (/** @type {string} */ value) => /** @type {string} */ (originalToWire.get(value)),
    decode: (/** @type {string} */ value) => wireToOriginal.get(value),
  };
}

/** @param {ReturnType<typeof roleMap>} mapping @param {string} value */
function decoded(mapping, value) {
  const result = mapping.decode(value);
  if (result === undefined) throw new CoreError('invalid_model_output');
  return result;
}

/** Build the aliased input and keep the reverse maps private to the invocation.
 * @param {ClassificationInput} input @returns {ClassificationWire}
 */
export function classificationWire(input) {
  const memories = roleMap(input.memories.map((memory) => memory.id), 'm');
  const catalog = roleMap(input.map.filter((item) => item?.type === 'moc').map((item) => item.moc.id), 'c');
  const wireInput = {
    ...input,
    memories: input.memories.map((memory) => ({ ...memory, id: memories.encode(memory.id) })),
    map: input.map.map((item) => item?.type === 'moc'
      ? { ...item, moc: { ...item.moc, id: catalog.encode(item.moc.id) } }
      : item),
  };
  return Object.freeze({ input: wireInput, /** @param {PlacementProposal} output */ decode(output) {
    return { items: output.items.map((item) => ({
      memoryId: decoded(memories, item.memoryId),
      parentIds: item.parentIds.map((id) => decoded(catalog, id)),
      ...(item.newL1 === undefined ? {} : { newL1: {
        title: item.newL1.title,
        parentL2Ids: item.newL1.parentL2Ids.map((id) => decoded(catalog, id)),
        ...(item.newL1.newL2Title === undefined ? {} : { newL2Title: item.newL1.newL2Title }),
      } }),
    })) };
  } });
}
