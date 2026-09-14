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
// and qualification methods remain dynamic-only until a separately authorized guard extension exists.
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

/** Request-scoped identifier constraints; core still validates correlated tuples. */
export function schemasFor(method, input) {
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
