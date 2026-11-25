/** @import { ExtractedQuantity, QuantityValidation } from './index.mjs' */

export const QUANTITY_TEXT_FIELDS = Object.freeze(/** @type {const} */ (['measure', 'unit', 'category']));

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
  for (const field of QUANTITY_TEXT_FIELDS) {
    const text = copy[field];
    if (typeof text !== 'string' || /[\uD800-\uDFFF]/u.test(text)) return null;
  }
  const validKind = copy.kind === 'record'
    ? copy.comparator === 'none' && (copy.period === 'none' ||
      (typeof copy.period === 'string' && goalPeriods.includes(copy.period)))
    : typeof copy.period === 'string' && goalPeriods.includes(copy.period) &&
      typeof copy.comparator === 'string' && goalComparators.includes(copy.comparator);
  if (!validKind) return null;
  if (copy.kind === 'record') copy.period = 'none';
  return /** @type {ExtractedQuantity} */ (/** @type {unknown} */ (copy));
}

/** @param {unknown} value @param {number} itemCount @returns {QuantityValidation} */
export function validateQuantities(value, itemCount) {
  const quantities = [];
  let dropped = 0;
  try {
    if (Array.isArray(value)) {
      const length = value.length;
      if (!Number.isInteger(length) || length < 0 || length > 0xffffffff) {
        return { quantities: [], dropped: { invalid_extraction_quantity: 1 } };
      }
      for (let index = 0; index < length; index++) {
        const entry = Object.getOwnPropertyDescriptor(value, index);
        const quantity = entry?.enumerable && Object.hasOwn(entry, 'value') ? readQuantity(entry.value, itemCount) : null;
        if (quantity) quantities.push(quantity);
        else dropped++;
      }
    } else if (value !== undefined) {
      dropped++;
    }
  } catch {
    return { quantities: [], dropped: { invalid_extraction_quantity: 1 } };
  }
  return { quantities, dropped: { invalid_extraction_quantity: dropped } };
}
