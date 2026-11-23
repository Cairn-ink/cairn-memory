import { CoreError } from "../errors.mjs";
import { redactCore } from "./redact.mjs";

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
