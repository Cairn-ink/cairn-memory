import { boundedText, fingerprint, fail } from './validation.mjs';

/** Admission and its suppression read must fingerprint the same bounded text. */
export function suppressionContent(value, max = 4000, rawMax = 20_000) {
  let content;
  try { content = boundedText(value, max, false, rawMax); } catch { fail('invalid_input'); }
  return { content, fingerprint: fingerprint(content) };
}
