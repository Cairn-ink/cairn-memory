import { boundedText } from '../privacy/text.mjs';
import { denseArray, fail, isWellFormedText, object, receiptEventTime } from './validate.mjs';

const FIELDS = ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'];
const ATTRIBUTIONS = ['direct', 'reported', 'quoted', 'proposed', 'unknown'];
const COMMITMENTS = ['adopted', 'considered', 'rejected', 'unknown'];

/** @param {unknown} value @param {readonly string[]} keys */
function exact(value, keys) {
  const data = object(value, keys);
  if (keys.some(key => !Object.hasOwn(data, key))) fail('invalid_input');
  return data;
}

/** @param {unknown} value @param {number} maximum */
function label(value, maximum) {
  if (value === null) return null;
  try {
    if (!isWellFormedText(value) || value.length > maximum || boundedText(value, maximum) !== value) fail('invalid_input');
  } catch { fail('invalid_input'); }
  return value;
}

/** @param {unknown} content @param {unknown} receipts */
export function qualificationSources(content, receipts) {
  if (!isWellFormedText(content)) fail('invalid_input');
  for (const raw of denseArray(receipts, 1, 4)) {
    const receipt = object(raw, ['client', 'sessionId', 'eventId', 'role', 'excerpt', 'occurredAt']);
    receiptEventTime(receipt.occurredAt);
    const { occurredAt, ...identity } = receipt;
    if (Object.values(identity).some(value => !isWellFormedText(value))) fail('invalid_input');
  }
}

/** @param {string} text @param {number} offset */
function splitPair(text, offset) {
  return offset > 0 && offset < text.length &&
    /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset]);
}

/** Validate exact source binding and declared field coverage over canonical receipts.
 * @param {unknown} input
 * @param {unknown} receipts
 */
export function qualificationInput(input, receipts) {
  const claim = exact(input, ['version', 'slot', 'value', 'attribution', 'commitment', 'anchors']);
  if (claim.version !== 1) fail('invalid_input');
  const rawSlot = exact(claim.slot, ['subject', 'property', 'scope', 'applies']);
  const slot = { subject: label(rawSlot.subject, 160), property: label(rawSlot.property, 160),
    scope: label(rawSlot.scope, 120), applies: label(rawSlot.applies, 120) };
  const value = label(claim.value, 160);
  const { attribution, commitment } = claim;
  if (typeof attribution !== 'string' || !ATTRIBUTIONS.includes(attribution) ||
      typeof commitment !== 'string' || !COMMITMENTS.includes(commitment)) fail('invalid_input');
  const sources = denseArray(receipts, 1, 4);
  qualificationSources('', sources);
  const covered = new Set();
  const seen = new Set();
  const anchors = denseArray(claim.anchors, 1, 4).map(raw => {
    const { receiptIndex, start, end, text, fields: rawFields } = exact(raw, ['receiptIndex', 'start', 'end', 'text', 'fields']);
    if (typeof receiptIndex !== 'number' || !Number.isSafeInteger(receiptIndex) || receiptIndex < 0 || receiptIndex >= sources.length ||
        typeof start !== 'number' || !Number.isSafeInteger(start) || typeof end !== 'number' || !Number.isSafeInteger(end) ||
        start < 0 || start >= end || !isWellFormedText(text) || text.length < 1 || text.length > 200) fail('invalid_input');
    const receipt = /** @type {Record<string, unknown>} */ (sources[receiptIndex]);
    const excerpt = receipt.excerpt;
    if (typeof excerpt !== 'string' || end > excerpt.length || splitPair(excerpt, start) || splitPair(excerpt, end) ||
        excerpt.slice(start, end) !== text) fail('invalid_input');
    const fields = denseArray(rawFields, 1, 7);
    if (new Set(fields).size !== fields.length || fields.some(field => typeof field !== 'string' || !FIELDS.includes(field))) {
      fail('invalid_input');
    }
    const ordered = FIELDS.filter(field => fields.includes(field));
    // Identical receipts at different input positions still denote one source.
    const { occurredAt, ...identity } = receipt;
    const key = JSON.stringify([identity, start, end, ordered]);
    if (seen.has(key)) fail('invalid_input');
    seen.add(key);
    ordered.forEach(field => covered.add(field));
    return { receiptIndex, start, end, text, fields: ordered };
  });
  const descriptions = { ...slot, value, attribution, commitment };
  for (const field of FIELDS) {
    const description = descriptions[/** @type {keyof typeof descriptions} */ (field)];
    const unknown = description === null || ((field === 'attribution' || field === 'commitment') && description === 'unknown');
    if (!unknown && !covered.has(field)) fail('invalid_input');
  }
  return { version: 1, slot, value, attribution, commitment, anchors };
}
