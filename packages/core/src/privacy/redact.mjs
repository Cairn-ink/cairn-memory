import { CoreError } from "../errors.mjs";

export const PRIVACY_REDACTION_VERSIONS = Object.freeze({ v1: 1, hostedCurrent: 2, core: 3 });
export const REDACT_CORE_POLICY = "union";

const REPLACEMENT = "[REDACTED]";
const PEM = /-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z]+)? PRIVATE KEY-----/g;
const API_KEY = /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b/g;
const V1_PAT = /\bcrn_pat_[a-f0-9]{32,}\b/gi;
const WEB_PAT = /(?<![A-Za-z0-9_-])crn_pat_[A-Za-z0-9_-]{32}(?![A-Za-z0-9_-])/g;
const CLI_PAT = /\bcrn_pat_[a-f0-9]{64}\b/gi;
const QUOTED_OAUTH =
  /((["'])(?:access_token|refresh_token|id_token|client_secret)\2\s*:\s*)(["'])(?:\\.|(?!\3)[^\\])+\3/gis;
const ASSIGNMENT =
  /\b((?:[a-z][a-z0-9_]*_)?(?:api[_-]?(?:key|token)|access[_-]?token|auth[_-]?token|client[_-]?secret|password)\s*[:=]\s*)["']?[^\s"']{8,}["']?/gi;

const COMMON_SUFFIX = [
  /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+\/-]{12,}=*\b/gi,
  ASSIGNMENT,
];

// Frozen v1. Keep the patterns and their order for historical fingerprints.
const V1_RULES = [PEM, API_KEY, V1_PAT, ...COMMON_SUFFIX];
const HOSTED_RULES = [QUOTED_OAUTH, PEM, API_KEY, WEB_PAT, CLI_PAT, ...COMMON_SUFFIX];

/** @param {RegExp} rule */
function replacementFor(rule) {
  if (rule === QUOTED_OAUTH) return `$1$3${REPLACEMENT}$3`;
  if (rule === ASSIGNMENT) return `$1${REPLACEMENT}`;
  return REPLACEMENT;
}

/** @param {unknown} text @param {RegExp[]} rules */
function redact(text, rules) {
  if (typeof text !== "string") throw new CoreError("invalid_input");
  return rules.reduce((value, rule) => value.replace(rule, replacementFor(rule)), text);
}

/** @param {unknown} text */
export function redactV1(text) {
  return redact(text, V1_RULES);
}

/** @param {unknown} text */
export function redactHostedCurrent(text) {
  return redact(text, HOSTED_RULES);
}

/** @typedef {[start: number, end: number]} Mask */

/** @param {Mask[]} ranges @returns {Mask[]} */
function mergeMasks(ranges) {
  ranges.sort((a, b) => a[0] - b[0]);
  /** @type {Mask[]} */
  const merged = [];
  for (const [start, end] of ranges) {
    const last = merged.at(-1);
    if (last && start < last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/** @param {string} text @param {Mask[]} masks */
function applyMasks(text, masks) {
  let offset = 0;
  const parts = [];
  for (const [start, end] of masks) {
    parts.push(text.slice(offset, start), REPLACEMENT);
    offset = end;
  }
  return parts.join("") + text.slice(offset);
}

/** Maps successive offsets in masked text to the corresponding original spans.
 * @param {Mask[]} masks
 */
function originalOffsets(masks) {
  let index = 0;
  let shift = 0;
  /** @param {number} offset @param {boolean} isEnd */
  return (offset, isEnd) => {
    for (; index < masks.length; index++) {
      const [start, end] = masks[index];
      const markerStart = start + shift;
      if (offset <= markerStart) break;
      if (offset < markerStart + REPLACEMENT.length) return isEnd ? end : start;
      shift += REPLACEMENT.length - (end - start);
    }
    return offset - shift;
  };
}

/** @param {string} text @param {RegExp[]} rules @returns {Mask[]} */
function traceMasks(text, rules) {
  let value = text;
  /** @type {Mask[]} */
  let masks = [];
  for (const rule of rules) {
    const originalOffset = originalOffsets(masks);
    /** @type {Mask[]} */
    const added = [];
    for (const match of value.matchAll(rule)) {
      const offset = /** @type {number} */ (match.index);
      const prefix = rule === QUOTED_OAUTH ? match[1].length + 1 : rule === ASSIGNMENT ? match[1].length : 0;
      const suffix = rule === QUOTED_OAUTH ? 1 : 0;
      const start = originalOffset(offset + prefix, false);
      const end = originalOffset(offset + match[0].length - suffix, true);
      added.push([start, end]);
    }
    if (added.length) {
      masks = mergeMasks([...masks, ...added]);
      value = value.replace(rule, replacementFor(rule));
    }
  }
  return masks;
}

/** One pass of the core policy, with positions in the original text.
 * @param {string} text
 * @returns {Mask[]}
 */
export function coreRedactionMasks(text) {
  return mergeMasks([...traceMasks(text, V1_RULES), ...traceMasks(text, HOSTED_RULES)]);
}

/** @param {unknown} text */
export function redactCore(text) {
  if (typeof text !== "string") throw new CoreError("invalid_input");
  // Each policy sees the original input. A replacement in one policy can hide
  // the boundary or quotes that the other policy needs to find a secret.
  // Repeat because replacements can expose new boundaries in the combined output.
  let value = text;
  while (true) {
    const masked = applyMasks(value, coreRedactionMasks(value));
    if (masked === value) return masked;
    value = masked;
  }
}
