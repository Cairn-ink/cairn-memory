import { fail } from './validation.mjs';

/** Partition a source excerpt without normalization or trimming. */
export function partitionSourcePassages(excerpt) {
  if (typeof excerpt !== 'string' || !excerpt || excerpt.length > 800 || !excerpt.isWellFormed()) {
    fail('invalid_input');
  }
  const passages = [];
  let start = 0;
  let text = '';
  for (const point of excerpt) {
    if (text.length + point.length > 200) {
      passages.push({ start, end: start + text.length, text });
      start += text.length;
      text = '';
    }
    text += point;
  }
  passages.push({ start, end: start + text.length, text });
  return passages;
}
