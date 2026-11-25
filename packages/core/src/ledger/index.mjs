import { CoreError } from '../errors.mjs';
import { compareUtf8 } from '../utf8.mjs';
import { roundReceiptNumber } from './receipt-numbers.mjs';
import { receiptMatchesTerms } from './terms.mjs';
import { validTime } from './window.mjs';

/** @import { ExtractedQuantity, LedgerCapture, LedgerReceipt, LedgerReconciliation, LedgerReadState, LedgerRowAttribution, QuantityLedgerStore } from './index.mjs' */
/** @import { Scope } from '../ports/common.d.ts' */
/** @import { Tx } from '../ports/unit-of-work.d.ts' */

export { validateQuantities } from './quantities.mjs';
export { readIntent } from './terms.mjs';
export { ledgerRowInRange, parseWindow } from './window.mjs';
export { digest } from './digest.mjs';

/** @param {LedgerRowAttribution | ExtractedQuantity} quantity */
function identity({ measure, category, value, unit, period, comparator }) {
  return [measure, category, value, unit, period, comparator];
}

/** @param {LedgerRowAttribution} row */
export function ledgerRowKey(row) {
  return JSON.stringify([row.memoryId, row.receiptId, ...identity(row), row.ordinal]);
}

/** @param {string} content */
function receiptValues(content) {
  const numbers = content.normalize('NFKC').match(/[+−-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|[+−-]?\.\d+/gu) ?? [];
  return new Set(numbers.map(value => Number(value.replaceAll(',', '').replace('−', '-'))));
}

/** @param {readonly LedgerReceipt[]} receipts */
function orderSources(receipts) {
  const ordered = receipts.filter(receipt => receipt.role === 'user' && receipt.receiptId)
    .map(receipt => ({ ...receipt, time: validTime(receipt.occurredAtMs) ? receipt.occurredAtMs : Infinity }))
    .sort((left, right) => left.time - right.time ||
      compareUtf8(left.messageId, right.messageId) || compareUtf8(left.receiptId, right.receiptId));
  const seen = new Set();
  const sources = [];
  for (const receipt of ordered) {
    if (seen.has(receipt.receiptId)) continue;
    seen.add(receipt.receiptId);
    const sentences = receipt.content.split(/[!?。！？]+|\.(?=\s|$)/u)
      .map(text => ({ text, values: receiptValues(text) }));
    sources.push({ receipt, sentences });
  }
  return sources;
}

/** @typedef {ReturnType<typeof orderSources>} Sources */
/** @typedef {ReadonlyMap<string, ReadonlySet<number>>} RecordValues */

/** @param {Sources} sources @param {Sources} fallback @param {ExtractedQuantity} quantity @param {boolean} standalone
 * @param {RecordValues} [recordValues] */
function candidatesFor(sources, fallback, quantity, standalone, recordValues) {
  const terms = [quantity.measure, quantity.category];
  const rounded = recordValues && quantity.kind === 'record' ? roundReceiptNumber(quantity.value) : undefined;
  const values = sources.filter(source => rounded === undefined
    ? source.sentences.some(sentence => sentence.values.has(quantity.value))
    : recordValues?.get(source.receipt.messageId)?.has(rounded));
  const local = standalone ? values.filter(source => source.sentences.some(sentence =>
    sentence.values.has(quantity.value) && receiptMatchesTerms(sentence.text, terms))) : [];
  const matching = local.length ? local : values.filter(source => receiptMatchesTerms(source.receipt.content, terms));
  if (matching.length) {
    // A standalone attribution has no saved rows to tell it whether a reply repeats evidence.
    // When a direct match is present, an explicit affirmation of it adds no candidate.
    if (standalone) {
      const direct = matching.filter(source => !/^\s*yes\s*[,，]/iu.test(source.receipt.content));
      if (direct.length) return direct;
    }
    return matching;
  }
  return values.length ? values : fallback;
}

/**
 * @param {Omit<LedgerReconciliation, 'textHash'> & { textHash?: string }} capture
 * @param {boolean} standalone
 * @param {RecordValues} [recordValues]
 * @returns {LedgerRowAttribution[]}
 */
function additionalAttributions({ memoryId, textHash, quantities, citedReceipts, captureTimeMs, existingRows }, standalone, recordValues) {
  const sources = orderSources(citedReceipts);
  if (!sources.length) return [];

  const cited = new Set(sources.map(source => source.receipt.receiptId));
  const memoryRows = existingRows.filter(row => row.memoryId === memoryId);
  const occupied = new Set(memoryRows.filter(row => row.textHash === textHash).map(row => row.receiptId));
  const newSources = sources.filter(source => !occupied.has(source.receipt.receiptId));
  const preferred = [...newSources, ...sources.filter(source => occupied.has(source.receipt.receiptId))];
  const fallback = sources.slice(0, 1);
  const covered = new Map();
  /** @type {Map<string, Map<string, number>>} */
  const nextOrdinals = new Map();
  for (const row of memoryRows) {
    const key = JSON.stringify(identity(row));
    const onCitedReceipt = cited.has(row.receiptId);
    if (row.textHash === textHash && (onCitedReceipt || !newSources.length)) {
      covered.set(key, (covered.get(key) ?? 0) + 1);
    }
    if (!onCitedReceipt) continue;

    // A retained old-hash row still occupies its storage key.
    let ordinals = nextOrdinals.get(key);
    if (!ordinals) nextOrdinals.set(key, ordinals = new Map());
    ordinals.set(row.receiptId, Math.max(ordinals.get(row.receiptId) ?? 0, row.ordinal + 1));
  }

  /** @type {Map<string, { candidates: Sources, assigned: number, ordinals: Map<string, number> }>} */
  const assignments = new Map();
  const rows = [];
  for (const quantity of quantities) {
    const key = JSON.stringify(identity(quantity));
    const remaining = covered.get(key) ?? 0;
    if (remaining > 0) {
      covered.set(key, remaining - 1);
      continue;
    }

    let assignment = assignments.get(key);
    if (!assignment) {
      assignment = { candidates: candidatesFor(preferred, fallback, quantity, standalone, recordValues), assigned: 0,
        ordinals: nextOrdinals.get(key) ?? new Map() };
      assignments.set(key, assignment);
    }
    const { receipt } = assignment.candidates[Math.min(assignment.assigned++, assignment.candidates.length - 1)];
    const { receiptId } = receipt;
    const ordinal = assignment.ordinals.get(receiptId) ?? 0;
    assignment.ordinals.set(receiptId, ordinal + 1);
    const date = validTime(receipt.time) ? receipt.time : captureTimeMs;
    if (!validTime(date)) throw new CoreError('invalid_input');
    const { item, ...amount } = quantity;
    rows.push({ ...amount, memoryId, receiptId, date, ordinal });
  }
  return rows;
}

/** Attribute a batch independently of the store. Use reconciliation for capture writes.
 * @param {string} memoryId
 * @param {readonly ExtractedQuantity[]} quantities
 * @param {readonly LedgerReceipt[]} receipts
 * @param {number} captureTimeMs
 */
export function attributeLedgerQuantities(memoryId, quantities, receipts, captureTimeMs) {
  return additionalAttributions({ memoryId, quantities, citedReceipts: receipts, captureTimeMs, existingRows: [] }, true);
}

/** @param {LedgerReconciliation} capture @param {RecordValues} [recordValues] */
export function reconcileLedgerQuantities(capture, recordValues) {
  const { textHash } = capture;
  if (typeof textHash !== 'string' || !textHash) throw new CoreError('invalid_input');
  return additionalAttributions(capture, false, recordValues).map(row => ({ ...row, textHash }));
}

/** @param {Tx} tx @param {Scope} scope @param {QuantityLedgerStore} store @param {LedgerCapture} capture */
export async function writeLedgerQuantities(tx, scope, store, capture) {
  if (!capture.quantities.length) return { inserted: 0 };
  const existingRows = await store.listForMemory(tx, scope, capture.memoryId);
  const rows = reconcileLedgerQuantities({ ...capture, existingRows });
  return rows.length ? store.put(tx, scope, rows) : { inserted: 0 };
}

/** @param {unknown} selector */
export function ledgerDropSelector(selector) {
  try {
    if (selector && typeof selector === 'object' && Reflect.ownKeys(selector).length === 2) {
      const by = Object.getOwnPropertyDescriptor(selector, 'by')?.value;
      const id = Object.getOwnPropertyDescriptor(selector, 'id')?.value;
      if ((by === 'memoryId' || by === 'receiptId') && typeof id === 'string' && id) return by;
    }
  } catch { /* Unreadable selectors are invalid too. */ }
  throw new CoreError('invalid_input');
}

/** @param {import('./index.mjs').QuantityLedgerRow} row @param {LedgerReadState} state */
export function ledgerRowDeliverable(row, state) {
  return typeof row.textHash === 'string' && row.textHash.length > 0 &&
    state.memoryTextHashes?.get(row.memoryId) === row.textHash &&
    state.memoryStates?.get(row.memoryId) === 'current_visible' &&
    state.retainedReceipts?.get(row.memoryId)?.has(row.receiptId) === true;
}
