import { denseArray, identifier, revision } from '../../core/validation.mjs';
import { isDeepStrictEqual } from 'node:util';
import { prepareSourceContextUnits } from '../../core/source-context-units.mjs';

const string = { type: 'string' };
const integer = { type: 'integer', minimum: 0 };
const array = (items, maxItems) => ({ type: 'array', items, maxItems });
const object = (properties) => ({ type: 'object', properties,
  required: Object.keys(properties), additionalProperties: false });
const newTopic = { title: string, parentL2Ids: array(string, 3) };
const placement = { memoryId: string, parentIds: array(string, 3) };
const refs = object({ refs: array(object({ namespaceIndex: integer,
  memoryId: string, revision: { type: 'integer', minimum: 1 } }), 24) });

// This export is also the existing live guard's method allowlist. Reconcile
// qualification and checklist methods remain dynamic-only until a separately authorized guard extension exists.
export const schemas = {
  extract: object({ items: array(object({ content: { type: 'string', maxLength: 600 },
    kind: { type: 'string', enum: ['fact', 'preference', 'decision', 'instruction', 'context'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    sourceIndices: { ...array(integer, 4), minItems: 1 },
  }), 5) }),
  classify: object({ items: { ...array({ anyOf: [object(placement), object({ ...placement,
    newL1: { anyOf: [object(newTopic), object({ ...newTopic, newL2Title: string })] },
  })] }, 5), minItems: 1 } }),
  select: refs,
  rank: refs,
};

const invalid = () => { throw new Error('invalid_openai_request'); };

function plainJSON(value, active = new Set(), count = { nodes: 0 }, depth = 0) {
  if (++count.nodes > 12_000 || depth > 18) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || active.has(value)) return false;
  const arrayValue = Array.isArray(value);
  if (Object.getPrototypeOf(value) !== (arrayValue ? Array.prototype : Object.prototype)) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length > 12_000 || (arrayValue && keys.length !== value.length + 1)) return false;
  active.add(value);
  const valid = keys.every(key => {
    if (typeof key !== 'string') return false;
    if (arrayValue && key === 'length') return true;
    if (arrayValue && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable && Object.hasOwn(descriptor, 'value')
      && plainJSON(descriptor.value, active, count, depth + 1);
  });
  active.delete(value);
  return valid;
}

function snapshotJSON(value) {
  try {
    if (!plainJSON(value)) invalid();
    return structuredClone(value);
  } catch { invalid(); }
}

function sourceContextContract(input, suppliedSchema) {
  try {
    const sources = input.sources.map(source => ({ receipts: source.receipts.map(receipt => ({
      role: receipt.role, excerpt: receipt.passages.map(passage => passage.text).join(''),
    })) }));
    const raw = { ...(Object.hasOwn(input, 'version') ? { version: input.version } : {}), sources };
    const prepared = prepareSourceContextUnits(raw);
    if (!isDeepStrictEqual(input, prepared.input) ||
        (suppliedSchema !== undefined && !isDeepStrictEqual(suppliedSchema, prepared.responseSchema))) invalid();
    return { raw, schema: prepared.responseSchema };
  } catch { invalid(); }
}

/** Closed transport request; core remains the sole passage/schema compiler. */
export function sourceContextRequest(request) {
  try {
    if (!request || Object.getPrototypeOf(request) !== Object.prototype ||
        !isDeepStrictEqual(Reflect.ownKeys(request).sort(),
          ['system', 'input', 'responseSchema', 'maxOutputTokens', 'signal'].sort())) invalid();
    for (const key of ['system', 'input', 'responseSchema', 'maxOutputTokens', 'signal']) {
      const descriptor = Object.getOwnPropertyDescriptor(request, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
    }
    if (typeof request.system !== 'string' || !request.system.isWellFormed() ||
        request.maxOutputTokens !== 3072 || !(request.signal instanceof AbortSignal)) invalid();
    const input = snapshotJSON(request.input);
    const responseSchema = snapshotJSON(request.responseSchema);
    const { raw, schema } = sourceContextContract(input, responseSchema);
    return { system: request.system, input, responseSchema: schema,
      maxOutputTokens: 3072, signal: request.signal, raw };
  } catch { invalid(); }
}
const id = (value) => { if (typeof value !== 'string' || !value.length) invalid(); return value; };
const index = (value) => { if (!Number.isSafeInteger(value) || value < 0) invalid(); return value; };
const positive = (value) => { if (!Number.isSafeInteger(value) || value < 1) invalid(); return value; };
const list = (value) => { if (!Array.isArray(value)) invalid(); return value; };
const sorted = (values) => [...new Set(values)].sort((a, b) => typeof a === 'number' ? a - b : a < b ? -1 : a > b ? 1 : 0);
const constrained = (base, values) => values.length ? { ...base, enum: sorted(values) } : { ...base };
const idArray = (values, maximum) => array(constrained(string, values), values.length ? Math.min(maximum, values.length) : 0);
const snapshotIndices = (values, maximum) => {
  const indices = list(values).map((value) => index(value?.index));
  if (indices.length > maximum || sorted(indices).length !== indices.length) invalid();
  return indices;
};
const qualificationSlot = itemIndex => `item_${itemIndex}`;
const qualificationSlots = (items, variants) => object(Object.fromEntries(
  items.map((item, position) => [qualificationSlot(item.itemIndex), variants[position]])));

function checklistRecord(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).length !== fields.length) invalid();
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
  }
}

function checklistSchema(input) {
  checklistRecord(input, ['query', 'maps', 'maxRefs']);
  if (typeof input.query !== 'string' || !input.query.trim() || !input.query.isWellFormed() ||
      input.query.length > 4000 || index(input.maxRefs) > 24) invalid();
  const rows = (value, maximum) => {
    denseArray(value, 0, maximum);
    if (Reflect.ownKeys(value).length !== value.length + 1) invalid();
    for (let i = 0; i < value.length; i++) {
      if (!Object.hasOwn(Object.getOwnPropertyDescriptor(value, String(i)), 'value')) invalid();
    }
    return value;
  };
  rows(input.maps, 2);
  const namespaces = [], memoryIds = [], revisions = [], seen = new Map();
  const label = (value, nullable = false) => {
    if (nullable && value === null) return;
    if (typeof value !== 'string' || !value.isWellFormed()) invalid();
  };
  for (const map of input.maps) {
    checklistRecord(map, ['namespaceIndex', 'items', 'exhausted']);
    if (![0, 1].includes(map.namespaceIndex) || namespaces.includes(map.namespaceIndex) ||
        typeof map.exhausted !== 'boolean') invalid();
    namespaces.push(map.namespaceIndex);
    rows(map.items, 24000);
    for (const item of map.items) {
      let memoryId, memoryRevision;
      if (item?.type === 'moc') {
        checklistRecord(item, ['type', 'moc']);
        checklistRecord(item.moc, ['id', 'level', 'title', 'revision']);
        identifier(item.moc.id); revision(item.moc.revision); label(item.moc.title, true);
        if (!['L1', 'L2'].includes(item.moc.level)) invalid();
        continue;
      }
      checklistRecord(item, ['type', 'ref', 'label']);
      label(item.label, item.type === 'ref');
      if (item.type === 'unfiled') {
        checklistRecord(item.ref, ['memoryId', 'revision']);
        memoryId = identifier(item.ref.memoryId); memoryRevision = revision(item.ref.revision);
      } else if (item.type === 'ref') {
        checklistRecord(item.ref, ['parentId', 'parentRevision', 'childType', 'childId', 'childRevision', 'relation']);
        identifier(item.ref.parentId); revision(item.ref.parentRevision);
        identifier(item.ref.childId); revision(item.ref.childRevision);
        if (!['memory', 'moc'].includes(item.ref.childType) || item.ref.relation !== 'contains') invalid();
        if (item.ref.childType === 'moc') continue;
        memoryId = item.ref.childId; memoryRevision = item.ref.childRevision;
      } else invalid();
      const key = JSON.stringify([map.namespaceIndex, memoryId]);
      if (seen.has(key) && seen.get(key) !== memoryRevision) invalid();
      seen.set(key, memoryRevision);
      memoryIds.push(memoryId); revisions.push(memoryRevision);
    }
  }
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > 24000) invalid();
  return object({ requests: array(object({ start: { ...integer, maximum: input.query.length - 1 },
    end: { ...integer, minimum: 1, maximum: input.query.length },
    refs: array(object({ namespaceIndex: constrained(integer, namespaces), memoryId: constrained(string, memoryIds),
      revision: constrained({ type: 'integer', minimum: 1 }, revisions) }), Math.min(input.maxRefs, seen.size)),
  }), 4) });
}

/** Request-scoped identifier constraints; core still validates correlated tuples. */
export function schemasFor(method, input) {
  if (method === 'reviewSourceContext') return sourceContextContract(snapshotJSON(input)).schema;
  if (method === 'selectChecklist') {
    try { return checklistSchema(input); } catch { invalid(); }
  }
  if (method === 'reviewBasis') {
    if (input && Object.hasOwn(input, 'inputMode') && !['source-context-v1', 'source-addressed-v1'].includes(input.inputMode)) invalid();
    const contextMode = input?.inputMode === 'source-context-v1';
    const addressed = input?.inputMode === 'source-addressed-v1';
    const memoryIndices = snapshotIndices(input?.memories, 6);
    if (!memoryIndices.length) invalid();
    const variants = input.memories.flatMap(memory => {
      const receipts = snapshotIndices(memory.receipts, 100);
      if (!receipts.length) invalid();
      if (addressed) return memory.receipts.map(receipt => {
        const parts = snapshotIndices(receipt.parts, 24000);
        if (!parts.length || parts.some((value, index) => value !== index)
          || receipt.parts.some(part => typeof part.text !== 'string' || !part.text.length)) invalid();
        const range = object({ startPart: { ...integer, maximum: parts.length - 1 },
          endPart: { ...integer, minimum: 1, maximum: parts.length } });
        return object({ memory: constrained(integer, [memory.index]), receipt: constrained(integer, [receipt.index]),
          ...range.properties, role: { type: 'string', enum: ['decision', 'premise', 'update', 'premise-update'] },
          context: object(Object.fromEntries(['subject', 'applies', 'scope', 'commitment']
            .map(field => [field, { anyOf: [range, { type: 'null' }] }]))) });
      });
      return object({ memory: constrained(integer, [memory.index]), receipt: constrained(integer, receipts),
        quote: { type: 'string', minLength: 1, maxLength: 200 },
        role: { type: 'string', enum: ['decision', 'premise', 'update'] },
        ...(contextMode ? { context: object(Object.fromEntries(
          ['subject', 'applies', 'scope', 'commitment'].map(field => [field,
            { anyOf: [{ type: 'string', minLength: 1, maxLength: 200 }, { type: 'null' }] }]))) } : {}) });
    });
    return object({ units: array({ anyOf: variants }, 8),
      links: array(object({ from: { ...integer, maximum: 7 }, to: { ...integer, maximum: 7 },
        relation: { type: 'string', enum: ['supports-decision', 'challenges-current-basis'] } }), 10) });
  }
  if (method === 'relate') {
    const memoryIndices = snapshotIndices(input?.memories, 6);
    if (!memoryIndices.length) invalid();
    const receiptIndices = input.memories.flatMap(memory => {
      const indices = snapshotIndices(memory.receipts, 100);
      if (!indices.length) invalid();
      return indices;
    });
    // Endpoint/receipt correlation is checked by core after strict parsing.
    return object({ edges: array(object({ from: constrained(integer, memoryIndices), to: constrained(integer, memoryIndices),
      relation: { type: 'string', enum: ['supports-decision', 'challenges-premise'] },
      fromReceipt: constrained(integer, receiptIndices), toReceipt: constrained(integer, receiptIndices) }), 10) });
  }
  if (method === 'qualifyCandidates') {
    if (!input || typeof input !== 'object' || Array.isArray(input)) invalid();
    const items = Array.from(list(input.items));
    if (!items.length || items.length > 5) invalid();
    const itemIndices = items.map(item => index(item?.itemIndex));
    if (sorted(itemIndices).length !== items.length) invalid();
    const allCandidateIndices = new Set();
    const variants = items.map(item => {
      const candidates = Array.from(list(item.candidates));
      if (!candidates.length) invalid();
      const candidateIndices = candidates.map(candidate => {
        const candidateIndex = index(candidate?.candidateIndex);
        if (allCandidateIndices.has(candidateIndex)) invalid();
        allCandidateIndices.add(candidateIndex);
        return candidateIndex;
      });
      // Core checks duplicate selections, aggregate anchor count and complete
      // item coverage. The provider schema restricts each field to this item's
      // candidates without claiming that a selected quote entails the value.
      const field = (known, unknown) => ({ anyOf: [
        object({ value: known, evidenceIndices: {
          ...array(constrained(integer, candidateIndices), 4), minItems: 1,
        } }),
        object({ value: unknown, evidenceIndices: {
          ...array(constrained(integer, candidateIndices), 4), minItems: 0,
        } }),
      ] });
      const descriptive = maximum => field({ type: 'string', minLength: 1, maxLength: maximum }, { type: 'null' });
      const categorical = values => field({ type: 'string', enum: values }, { type: 'string', enum: ['unknown'] });
      return object({ itemIndex: constrained(integer, [item.itemIndex]),
        subject: descriptive(160), property: descriptive(160),
        scope: descriptive(120), applies: descriptive(120), value: descriptive(160),
        attribution: categorical(['direct', 'reported', 'quoted', 'proposed']),
        commitment: categorical(['adopted', 'considered', 'rejected']),
      });
    });
    return object({ qualifications: qualificationSlots(items, variants) });
  }
  if (method === 'qualify') {
    if (!input || typeof input !== 'object' || Array.isArray(input)) invalid();
    const items = list(input.items);
    if (!items.length || items.length > 5) invalid();
    const itemIndices = items.map(item => index(item?.itemIndex));
    if (sorted(itemIndices).length !== items.length) invalid();
    const nullable = maximum => ({ type: ['string', 'null'], minLength: 1, maxLength: maximum });
    const variants = items.map(item => {
      const sources = list(item.sources);
      const receiptIndices = sources.map(source => index(source?.receiptIndex));
      if (!sources.length || sources.length > 4 || sorted(receiptIndices).length !== sources.length) invalid();
      return object({ itemIndex: constrained(integer, [item.itemIndex]), qualification: object({
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
  if (method === 'reconcile') {
    if (!input || typeof input !== 'object' || Array.isArray(input)) invalid();
    const messageIndices = snapshotIndices(input.messages, 24);
    const replacementIndices = snapshotIndices(input.items, 5);
    const predecessorIndices = snapshotIndices(input.candidates, 12);
    const transitionMaximum = replacementIndices.length && messageIndices.length
      ? Math.min(5, predecessorIndices.length) : 0;
    return object({ transitions: array(object({
      relation: { type: 'string', enum: ['supersedes', 'reaffirms', 'historical_context', 'compatible', 'unresolved'] },
      valueChange: { type: 'string', enum: ['changed', 'unchanged', 'unknown'] },
      adoption: { type: 'string', enum: ['explicit', 'not_adopted', 'uncertain'] },
      replacementIndex: constrained(integer, replacementIndices),
      predecessorIndex: constrained(integer, predecessorIndices),
      evidenceIndices: { ...array(constrained(integer, messageIndices),
        Math.max(1, Math.min(4, messageIndices.length))), minItems: 1 },
    }), transitionMaximum) });
  }
  if (!Object.hasOwn(schemas, method)) invalid();
  if (method === 'extract') return structuredClone(schemas.extract);
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid();
  if (method === 'classify') {
    const memoryIds = sorted(list(input.memories).map((memory) => id(memory?.id)));
    const l1 = []; const l2 = [];
    if (typeof input.mapExhausted !== 'boolean') invalid();
    for (const item of list(input.map)) {
      if (item?.type !== 'moc') continue;
      if (!['L1', 'L2'].includes(item.moc?.level)) invalid();
      (item.moc.level === 'L1' ? l1 : l2).push(id(item.moc.id));
    }
    const existing = { memoryId: constrained(string, memoryIds), parentIds: idArray(sorted(l1), 3) };
    const topic = { title: { ...string }, parentL2Ids: idArray(sorted(l2), 3) };
    const variants = [object(existing)];
    if (input.mapExhausted) variants.push(object({ ...existing,
      newL1: { anyOf: [object(topic), object({ ...topic, newL2Title: { ...string } })] } }));
    return object({ items: { ...array({ anyOf: variants }, Math.min(5, memoryIds.length)),
      minItems: memoryIds.length ? 1 : 0 } });
  }
  const namespaces = []; const memoryIds = []; const revisions = [];
  let maximum;
  const candidate = (namespaceIndex, memoryId, revision) => {
    namespaces.push(index(namespaceIndex)); memoryIds.push(id(memoryId)); revisions.push(positive(revision));
  };
  if (method === 'select') {
    maximum = index(input.maxRefs);
    if (maximum > 24) invalid();
    for (const map of list(input.maps)) {
      namespaces.push(index(map?.namespaceIndex));
      for (const item of list(map.items)) {
        if (item?.type === 'unfiled') candidate(map.namespaceIndex, item.ref?.memoryId, item.ref?.revision);
        else if (item?.type === 'ref' && item.ref?.childType === 'memory') {
          candidate(map.namespaceIndex, item.ref.childId, item.ref.childRevision);
        }
      }
    }
  } else {
    maximum = positive(input.limit);
    if (maximum > 24) invalid();
    for (const item of list(input.candidates)) candidate(item?.namespaceIndex, item?.memory?.id, item?.memory?.revision);
  }
  return object({ refs: array(object({ namespaceIndex: constrained(integer, namespaces),
    memoryId: constrained(string, memoryIds), revision: constrained({ type: 'integer', minimum: 1 }, revisions) }),
  memoryIds.length ? Math.min(maximum, memoryIds.length) : 0) });
}
