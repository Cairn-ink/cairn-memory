// Synthetic provider responses only. This is not a production encoder or oracle.
const FIELDS = ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'];

export function qualificationPoolWire(input, inline) {
  const entries = Array.isArray(inline.qualifications)
    ? inline.qualifications : Object.values(inline.qualifications);
  return { wireVersion: 'evidence-pool-v1', qualifications: Object.fromEntries(input.items.map(item => {
    const entry = entries.find(value => value.itemIndex === item.itemIndex);
    if (!entry) throw new Error('Missing synthetic qualification entry');
    const referenced = [...new Set(FIELDS.flatMap(field => entry[field].evidenceIndices))];
    const pool = referenced.length ? referenced : [item.candidates[0].candidateIndex];
    return [`item_${item.itemIndex}`, { itemIndex: item.itemIndex, pool,
      ...Object.fromEntries(FIELDS.map(field => [field, { value: entry[field].value,
        evidenceSlots: entry[field].evidenceIndices.map(index => pool.indexOf(index)) }])) }];
  })) };
}
