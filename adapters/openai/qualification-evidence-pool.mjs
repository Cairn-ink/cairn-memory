const FIELDS = ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'];
const invalid = () => { throw new Error('invalid_pool_output'); };

function dataObject(value, keys, reject, reason = 'qualification_wire_shape') {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) reject(reason);
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || keys.some((key) => !own.includes(key))) reject(reason);
  return Object.fromEntries(keys.map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) reject(reason);
    return [key, descriptor.value];
  }));
}

function dataArray(value, minimum, maximum, reject, reason) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum ||
      Reflect.ownKeys(value).length !== value.length + 1) reject(reason);
  return Array.from({ length: value.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) reject(reason);
    return descriptor.value;
  });
}

/** Decode the provider-only evidence-pool-v1 shape to the unchanged core shape. */
export function decodeQualificationEvidencePool(input, output, onInvalid) {
  const reject = reason => {
    try { Promise.resolve(onInvalid?.(reason)).catch(() => {}); }
    catch { /* Observation cannot change decoder failure. */ }
    invalid();
  };
  const wire = dataObject(output, ['wireVersion', 'qualifications'], reject);
  if (wire.wireVersion !== 'evidence-pool-v1') reject('qualification_wire_shape');
  const names = input.items.map((item) => `item_${item.itemIndex}`);
  const entries = dataObject(wire.qualifications, names, reject);
  return { qualifications: input.items.map((item, position) => {
    const entry = dataObject(entries[names[position]], ['itemIndex', 'pool', ...FIELDS], reject);
    if (entry.itemIndex !== item.itemIndex) reject('qualification_pool_mapping');
    const allowed = new Set(item.candidates.map((candidate) => candidate.candidateIndex));
    const pool = dataArray(entry.pool, 1, 4, reject, 'qualification_pool_mapping');
    if (new Set(pool).size !== pool.length || pool.some((candidateIndex) =>
      !Number.isSafeInteger(candidateIndex) || !allowed.has(candidateIndex))) reject('qualification_pool_mapping');
    const decoded = { itemIndex: entry.itemIndex };
    for (const field of FIELDS) {
      const selected = dataObject(entry[field], ['value', 'evidenceSlots'], reject);
      const slots = dataArray(selected.evidenceSlots, 0, 4, reject, 'qualification_slot_mapping');
      if (new Set(slots).size !== slots.length || slots.some((slot) =>
        !Number.isSafeInteger(slot) || slot < 0 || slot >= pool.length)) reject('qualification_slot_mapping');
      decoded[field] = { value: selected.value, evidenceIndices: slots.map((slot) => pool[slot]) };
    }
    return decoded;
  }) };
}
