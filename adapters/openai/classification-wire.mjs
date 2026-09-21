const alias = (role, index) => `${role}${index.toString(36)}`;

function roleMap(values, role) {
  const originalToWire = new Map();
  const wireToOriginal = new Map();
  for (const value of values) {
    if (originalToWire.has(value)) continue;
    const wire = alias(role, originalToWire.size);
    originalToWire.set(value, wire);
    wireToOriginal.set(wire, value);
  }
  return { encode: (value) => originalToWire.get(value), decode: (value) => wireToOriginal.get(value) };
}

const invalid = () => { throw new Error('invalid_classification_wire_output'); };
const decoded = (mapping, value) => {
  const result = mapping.decode(value);
  if (result === undefined) invalid();
  return result;
};

/** Build one invocation's classification-only transport snapshot and private reverse maps. */
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

  return Object.freeze({ input: wireInput, decode(output) {
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

