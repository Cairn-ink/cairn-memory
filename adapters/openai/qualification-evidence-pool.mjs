const FIELDS = ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'];
const invalid = () => { throw new Error('invalid_pool_output'); };

function dataObject(value, keys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || keys.some((key) => !own.includes(key))) invalid();
  return Object.fromEntries(keys.map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
    return [key, descriptor.value];
  }));
}

function dataArray(value, minimum, maximum) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum ||
      Reflect.ownKeys(value).length !== value.length + 1) invalid();
  return Array.from({ length: value.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
    return descriptor.value;
  });
}

/** Decode the provider-only evidence-pool-v1 shape to the unchanged core shape. */
export function decodeQualificationEvidencePool(input, output) {
  const wire = dataObject(output, ['wireVersion', 'qualifications']);
  if (wire.wireVersion !== 'evidence-pool-v1') invalid();
  const names = input.items.map((item) => `item_${item.itemIndex}`);
  const entries = dataObject(wire.qualifications, names);
  return { qualifications: input.items.map((item, position) => {
    const entry = dataObject(entries[names[position]], ['itemIndex', 'pool', ...FIELDS]);
    if (entry.itemIndex !== item.itemIndex) invalid();
    const allowed = new Set(item.candidates.map((candidate) => candidate.candidateIndex));
    const pool = dataArray(entry.pool, 1, 4);
    if (new Set(pool).size !== pool.length || pool.some((candidateIndex) =>
      !Number.isSafeInteger(candidateIndex) || !allowed.has(candidateIndex))) invalid();
    const decoded = { itemIndex: entry.itemIndex };
    for (const field of FIELDS) {
      const selected = dataObject(entry[field], ['value', 'evidenceSlots']);
      const slots = dataArray(selected.evidenceSlots, 0, 4);
      if (new Set(slots).size !== slots.length || slots.some((slot) =>
        !Number.isSafeInteger(slot) || slot < 0 || slot >= pool.length)) invalid();
      decoded[field] = { value: selected.value, evidenceIndices: slots.map((slot) => pool[slot]) };
    }
    return decoded;
  }) };
}
