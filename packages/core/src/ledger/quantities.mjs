/** @import { ExtractedQuantity, QuantityValidation } from './index.mjs' */

const fields = ['item', 'kind', 'measure', 'value', 'unit', 'group', 'category', 'period', 'comparator'];
const kinds = ['record', 'goal'];
const groups = ['food', 'transport', 'housing', 'shopping', 'bills', 'health', 'fitness', 'entertainment', 'work', 'other'];
const goalPeriods = ['day', 'week', 'month', 'year'];
const goalComparators = ['at_most', 'at_least'];

export function quantitySchema() {
  return {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      required: [...fields],
      properties: {
        item: { type: 'integer', minimum: 0 },
        kind: { type: 'string', enum: [...kinds] },
        measure: { type: 'string' },
        value: { type: 'number' },
        unit: { type: 'string' },
        group: { type: 'string', enum: [...groups] },
        category: { type: 'string' },
        period: { type: 'string', enum: ['none', ...goalPeriods] },
        comparator: { type: 'string', enum: ['none', ...goalComparators] },
      },
    },
  };
}

/** @param {unknown} value @param {number} itemCount @returns {ExtractedQuantity | null} */
function readQuantity(value, itemCount) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== fields.length) return null;
  /** @type {Record<string, unknown>} */
  const copy = {};
  for (const field of fields) {
    const property = Object.hasOwn(descriptors, field) ? descriptors[field] : undefined;
    if (!property?.enumerable || !Object.hasOwn(property, 'value')) return null;
    copy[field] = property.value;
  }
  if (typeof copy.item !== 'number' || !Number.isSafeInteger(copy.item) || copy.item < 0 || copy.item >= itemCount ||
      !Number.isFinite(copy.value) || typeof copy.kind !== 'string' || !kinds.includes(copy.kind) ||
      typeof copy.group !== 'string' || !groups.includes(copy.group)) return null;
  for (const text of [copy.measure, copy.unit, copy.category]) {
    if (typeof text !== 'string' || /[\uD800-\uDFFF]/u.test(text)) return null;
  }
  const validKind = copy.kind === 'record'
    ? copy.period === 'none' && copy.comparator === 'none'
    : typeof copy.period === 'string' && goalPeriods.includes(copy.period) &&
      typeof copy.comparator === 'string' && goalComparators.includes(copy.comparator);
  return validKind ? /** @type {ExtractedQuantity} */ (/** @type {unknown} */ (copy)) : null;
}

/** @param {unknown} value @param {number} itemCount @returns {QuantityValidation} */
export function validateQuantities(value, itemCount) {
  const quantities = [];
  let dropped = 0;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      let quantity = null;
      try {
        const entry = Object.getOwnPropertyDescriptor(value, index);
        if (entry?.enumerable && Object.hasOwn(entry, 'value')) quantity = readQuantity(entry.value, itemCount);
      } catch { /* Reject only this entry. */ }
      if (quantity) quantities.push(quantity);
      else dropped++;
    }
  } else if (value !== undefined) {
    dropped++;
  }
  return { quantities, dropped: { invalid_extraction_quantity: dropped } };
}
