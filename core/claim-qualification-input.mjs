import { boundedText, denseArray, fail, object } from './validation.mjs';

const FIELDS = ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'];
const ATTRIBUTIONS = ['direct', 'reported', 'quoted', 'proposed', 'unknown'];
const COMMITMENTS = ['adopted', 'considered', 'rejected', 'unknown'];

function exact(value, keys) {
  object(value, keys);
  if (keys.some(key => !Object.hasOwn(value, key))) fail('invalid_input');
}

function label(value, maximum) {
  if (value === null) return null;
  try {
    if (typeof value !== 'string' || !value.isWellFormed() || value.length > maximum ||
        boundedText(value, maximum) !== value) fail('invalid_input');
  } catch { fail('invalid_input'); }
  return value;
}

export function qualificationSources(content, receipts) {
  if (typeof content !== 'string' || !content.isWellFormed()) fail('invalid_input');
  for (const receipt of denseArray(receipts, 1, 4)) {
    object(receipt, ['client', 'sessionId', 'eventId', 'role', 'excerpt']);
    if (Object.values(receipt).some(value => typeof value !== 'string' || !value.isWellFormed())) fail('invalid_input');
  }
}

function splitPair(text, offset) {
  return offset > 0 && offset < text.length &&
    /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset]);
}

// Receipts have already passed the existing canonical receipt validation.
// This checks exact source binding and declared field coverage, not entailment.
export function qualificationInput(input, receipts) {
  exact(input, ['version', 'slot', 'value', 'attribution', 'commitment', 'anchors']);
  if (input.version !== 1) fail('invalid_input');
  exact(input.slot, ['subject', 'property', 'scope', 'applies']);
  const slot = { subject: label(input.slot.subject, 160), property: label(input.slot.property, 160),
    scope: label(input.slot.scope, 120), applies: label(input.slot.applies, 120) };
  const value = label(input.value, 160);
  if (!ATTRIBUTIONS.includes(input.attribution) || !COMMITMENTS.includes(input.commitment)) fail('invalid_input');
  denseArray(receipts, 1, 4);
  qualificationSources('', receipts);
  const covered = new Set();
  const seen = new Set();
  const anchors = denseArray(input.anchors, 1, 4).map(anchor => {
    exact(anchor, ['receiptIndex', 'start', 'end', 'text', 'fields']);
    const { receiptIndex, start, end, text } = anchor;
    if (!Number.isSafeInteger(receiptIndex) || receiptIndex < 0 || receiptIndex >= receipts.length ||
        !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= end ||
        typeof text !== 'string' || !text.isWellFormed() || text.length < 1 || text.length > 200) fail('invalid_input');
    const excerpt = receipts[receiptIndex].excerpt;
    if (typeof excerpt !== 'string' || end > excerpt.length || splitPair(excerpt, start) || splitPair(excerpt, end) ||
        excerpt.slice(start, end) !== text) fail('invalid_input');
    const fields = denseArray(anchor.fields, 1, 7);
    if (new Set(fields).size !== fields.length || fields.some(field => !FIELDS.includes(field))) fail('invalid_input');
    const ordered = FIELDS.filter(field => fields.includes(field));
    // Identical receipts at different input positions still denote one source.
    const key = JSON.stringify([receipts[receiptIndex], start, end, ordered]);
    if (seen.has(key)) fail('invalid_input');
    seen.add(key);
    ordered.forEach(field => covered.add(field));
    return { receiptIndex, start, end, text, fields: ordered };
  });
  const descriptions = { ...slot, value, attribution: input.attribution, commitment: input.commitment };
  for (const field of FIELDS) {
    const unknown = descriptions[field] === null ||
      (['attribution', 'commitment'].includes(field) && descriptions[field] === 'unknown');
    if (!unknown && !covered.has(field)) fail('invalid_input');
  }
  return { version: 1, slot, value, attribution: input.attribution, commitment: input.commitment, anchors };
}
