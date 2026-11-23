import { quantitySchema } from '../ledger/quantities.mjs';
import { EXTRACT_QUANTITIES_PARAGRAPH } from './generated/extract-memories-prompt.mjs';

/**
 * @template {{ properties: object, required: string[] }} T
 * @param {string} system @param {T} schema
 */
export function withQuantityExtraction(system, schema) {
  return {
    system: system + '\n' + EXTRACT_QUANTITIES_PARAGRAPH,
    schema: {
      ...schema,
      properties: { ...schema.properties, quantities: quantitySchema() },
      required: [...schema.required, 'quantities'],
    },
  };
}
