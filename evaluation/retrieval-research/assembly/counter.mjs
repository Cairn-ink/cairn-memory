import { get_encoding } from 'tiktoken';

export const COUNTER_ID = 'tiktoken@1.0.22:o200k_base:encode(text,[],[])';
const encoding = get_encoding('o200k_base');
const counts = new Map();

export function countTokens(text) {
  if (typeof text !== 'string') throw new Error('counter_text_required');
  if (!counts.has(text)) counts.set(text, encoding.encode(text, [], []).length);
  return counts.get(text);
}
