const string = { type: 'string' };
const integer = { type: 'integer', minimum: 0 };
const array = (items, maxItems) => ({ type: 'array', items, maxItems });
const object = (properties) => ({ type: 'object', properties,
  required: Object.keys(properties), additionalProperties: false });
const newTopic = { title: string, parentL2Ids: array(string, 3) };
const placement = { memoryId: string, parentIds: array(string, 3) };
const refs = object({ refs: array(object({ namespaceIndex: integer,
  memoryId: string, revision: { type: 'integer', minimum: 1 } }), 24) });

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

/** Request-scoped identifier constraints; core still validates correlated tuples. */
export function schemasFor(method, input) {
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
