import { fail, object } from './validation.mjs';

// This is deterministic addressing, not a tokenizer or a linguistic parser.
function partsOf(excerpt) {
  if (typeof excerpt !== 'string' || !excerpt.isWellFormed()) fail('invalid_model_output');
  return [...excerpt.matchAll(/\p{Script=Han}|(?:(?!\p{Script=Han})[\p{L}\p{M}\p{N}])+|\s+|[^\p{L}\p{M}\p{N}\s]/gu)];
}

export function sourceParts(excerpt) {
  return partsOf(excerpt).map((part, index) => ({ index, text: part[0] }));
}

/** Resolve core-enumerated part boundaries; never normalize or repair text. */
export function sourceAddressAnchor(range, excerpt) {
  object(range, ['startPart', 'endPart']);
  const { startPart, endPart } = range;
  const parts = partsOf(excerpt);
  if (!Number.isSafeInteger(startPart) || !Number.isSafeInteger(endPart)
    || startPart < 0 || endPart <= startPart || endPart > parts.length) fail('invalid_model_output');
  const start = parts[startPart].index;
  const end = endPart === parts.length ? excerpt.length : parts[endPart].index;
  const text = excerpt.slice(start, end);
  if (!text.trim().length || text.length > 200) fail('invalid_model_output');
  return { start, end, text };
}
