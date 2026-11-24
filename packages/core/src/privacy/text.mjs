import { CoreError } from "../errors.mjs";
import { redactCore, redactV1 } from "./redact.mjs";

/** @param {unknown} value @param {number} [rawMax] */
export function normalizeBoundedText(value, rawMax = 20_000) {
  if (typeof value !== "string" || value.length > rawMax) throw new CoreError("invalid_text");
  const clean = redactV1(value.normalize("NFKC")).replace(/\s+/gu, " ").trim();
  if (!clean || clean === "[REDACTED]" || clean.includes("\0")) throw new CoreError("invalid_text");
  return clean;
}

/** @param {unknown} value @param {number} max @param {boolean} [truncate] @param {number} [rawMax] */
export function boundedText(value, max, truncate = false, rawMax = 20_000) {
  const clean = normalizeBoundedText(value, rawMax);
  if (!truncate && clean.length > max) throw new CoreError("invalid_text");
  let result = "";
  for (const point of clean) {
    if (result.length + point.length > max) break;
    result += point;
  }
  return result;
}

/** @param {string} text */
export function cleanContent(text) {
  return text.replace(/[\uD800-\uDFFF]/gu, "\uFFFD").replaceAll("\0", "");
}

/** @param {string} text */
export function normalizeForHash(text) {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

/** New-content pipeline. NFKC exposes fullwidth credential syntax before masking.
 * @param {unknown} raw
 */
export function prepareCoreText(raw) {
  if (typeof raw !== "string") throw new CoreError("invalid_input");
  return redactCore(cleanContent(raw).normalize("NFKC")).replace(/\s+/gu, " ").trim();
}

/** Normalize a source excerpt before admission. Legacy core/validation.mjs:37–58.
 * @param {string} text
 */
export function receiptExcerpt(text) {
  const clean = redactCore(text.normalize("NFKC")).replace(/\s+/gu, " ").trim();
  if (clean.length <= 800) return clean;
  const last = clean.charCodeAt(799);
  const next = clean.charCodeAt(800);
  return clean.slice(0, last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff ? 799 : 800);
}
