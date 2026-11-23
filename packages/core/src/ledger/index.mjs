import { CoreError } from '../errors.mjs';
import { compareUtf8 } from '../utf8.mjs';
import { receiptMatchesTerms } from './terms.mjs';
import { validTime } from './window.mjs';

/** @import { ExtractedQuantity, LedgerReceipt, LedgerReadState, QuantityLedgerRow } from './index.mjs' */

export { validateQuantities } from './quantities.mjs';
export { readIntent } from './terms.mjs';
export { ledgerRowInRange, parseWindow } from './window.mjs';
export { digest } from './digest.mjs';

/** @param {ExtractedQuantity | QuantityLedgerRow} quantity */
function identity({ measure, category, value, unit, period, comparator }) {
  return [measure, category, value, unit, period, comparator];
}

/** @param {QuantityLedgerRow} row */
export function ledgerRowKey(row) {
  return JSON.stringify([row.memoryId, row.receiptId, ...identity(row), row.ordinal]);
}

/** @param {string} content */
function receiptValues(content) {
  const numbers = content.normalize('NFKC').match(/[+−-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|[+−-]?\.\d+/gu) ?? [];
  return new Set(numbers.map(value => Number(value.replaceAll(',', '').replace('−', '-'))));
}

/**
 * Build rows for the quantities of one admitted item. Repeat amounts use distinct
 * matching sources, then ordinals on the last source. If extraction relabels the
 * same amount in another capture, its changed identity can produce another row.
 * @param {string} memoryId
 * @param {readonly ExtractedQuantity[]} quantities
 * @param {readonly LedgerReceipt[]} receipts
 * @param {number} captureTimeMs
 * @returns {QuantityLedgerRow[]}
 */
export function attributeLedgerQuantities(memoryId, quantities, receipts, captureTimeMs) {
  const ordered = receipts.filter(receipt => receipt.role === 'user' && receipt.receiptId)
    .map(receipt => ({ ...receipt, time: validTime(receipt.occurredAtMs) ? receipt.occurredAtMs : Infinity }))
    .sort((left, right) => left.time - right.time ||
      compareUtf8(left.messageId, right.messageId) || compareUtf8(left.receiptId, right.receiptId));
  const seen = new Set();
  const sources = [];
  for (const receipt of ordered) {
    if (seen.has(receipt.receiptId)) continue;
    seen.add(receipt.receiptId);
    sources.push({ receipt, values: receiptValues(receipt.content) });
  }
  if (!sources.length) return [];

  /** @type {Map<string, { candidates: typeof sources, assigned: number }>} */
  const assignments = new Map();
  return quantities.map(quantity => {
    const key = JSON.stringify(identity(quantity));
    let assignment = assignments.get(key);
    if (!assignment) {
      const values = sources.filter(source => source.values.has(quantity.value));
      const terms = values.filter(source =>
        receiptMatchesTerms(source.receipt.content, [quantity.measure, quantity.category]));
      assignment = { candidates: terms.length ? terms : values.length ? values : sources.slice(0, 1), assigned: 0 };
      assignments.set(key, assignment);
    }
    const candidate = Math.min(assignment.assigned, assignment.candidates.length - 1);
    const ordinal = assignment.assigned++ - candidate;
    const { receipt } = assignment.candidates[candidate];
    const date = validTime(receipt.time) ? receipt.time : captureTimeMs;
    if (!validTime(date)) throw new CoreError('invalid_input');
    const { item, ...amount } = quantity;
    return { ...amount, memoryId, receiptId: receipt.receiptId, date, ordinal };
  });
}

/** @param {QuantityLedgerRow} row @param {LedgerReadState} state */
export function ledgerRowDeliverable(row, state) {
  return state.memoryStates?.get(row.memoryId) === 'current_visible' &&
    state.retainedReceipts?.get(row.memoryId)?.has(row.receiptId) === true;
}
