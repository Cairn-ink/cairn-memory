import { boundedText, fingerprint, fail } from './validation.mjs';

// The same scoped lookup serves bound writes and the Session Start projection.
export const suppressedFingerprintSQL = ({ owner = '?', scope = '?', project = '?', key = '?' } = {}) =>
  `SELECT 1 FROM suppressed WHERE owner_id = ${owner} AND scope = ${scope} AND project_id = ${project} AND fingerprint = ${key}`;

/** Admission and its suppression read must fingerprint the same bounded text. */
export function suppressionContent(value, max = 4000, rawMax = 20_000) {
  let content;
  try { content = boundedText(value, max, false, rawMax); } catch { fail('invalid_input'); }
  return { content, fingerprint: fingerprint(content) };
}
