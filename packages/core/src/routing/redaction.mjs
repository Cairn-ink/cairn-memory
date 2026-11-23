import { redactSecrets } from "../extraction/redact.mjs";
import { coreRedactionMasks } from "../privacy/redact.mjs";
import { cleanContent } from "../privacy/text.mjs";
import { normalizeDocumentText } from "./text.mjs";

const REPLACEMENT = "[REDACTED]";
const MAX_ROUNDS = 4;

/** @typedef {[start: number, end: number]} Span */
/** @typedef {[start: number, end: number, replacement: string]} Edit */
/** @typedef {{ text: string, source: Span[] }} TracedText */

/** @param {Span[]} masks @returns {Span[]} */
function mergeMasks(masks) {
  /** @type {Span[]} */
  const merged = [];
  for (const [start, end] of masks.sort((a, b) => a[0] - b[0])) {
    const previous = merged.at(-1);
    if (previous && start < previous[1]) previous[1] = Math.max(previous[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/** Replacements retain the whole source span, even when a later edit matches
 * only part of a marker or a single collapsed space.
 * @param {TracedText} view @param {Edit[]} edits @param {Span[]} [masks]
 * @returns {TracedText | null}
 */
function rewrite(view, edits, masks) {
  let offset = 0;
  const parts = [];
  const source = [];
  for (const [start, end, replacement] of edits) {
    if (!(offset <= start && start < end && end <= view.text.length)) return null;
    const first = view.source[start];
    const last = view.source[end - 1];
    if (!first || !last || first[0] >= last[1]) return null;
    /** @type {Span} */
    const span = [first[0], last[1]];
    masks?.push(span);
    parts.push(view.text.slice(offset, start), replacement);
    source.push(view.source.slice(offset, start), Array(replacement.length).fill(span));
    offset = end;
  }
  parts.push(view.text.slice(offset));
  source.push(view.source.slice(offset));
  return { text: parts.join(""), source: source.flat() };
}

/** @param {TracedText} view @param {Span[]} masks */
function traceCore(view, masks) {
  for (let round = 0; round <= MAX_ROUNDS; round++) {
    const pass = coreRedactionMasks(view.text);
    if (pass.length === 0) return view;
    const next = rewrite(view, pass.map(([start, end]) => [start, end, REPLACEMENT]), masks);
    if (!next) return null;
    if (next.text === view.text) return next;
    view = next;
  }
  return null;
}

/** @param {string} text */
function captureMasks(text) {
  /** @type {Span[]} */
  const masks = [];
  const lineKept = traceCore({
    text,
    source: Array.from({ length: text.length }, (_, index) => [index, index + 1]),
  }, masks);
  if (!lineKept) return null;
  /** @type {Edit[]} */
  const spaces = Array.from(lineKept.text.matchAll(/\s+/gu), match => {
    const start = match.index;
    const end = start + match[0].length;
    return [start, end, start === 0 || end === lineKept.text.length ? "" : " "];
  });
  const flattened = rewrite(lineKept, spaces);
  if (!flattened) return null;
  const capture = traceCore(flattened, masks);
  if (!capture) return null;
  return {
    masks: mergeMasks(masks),
    stable: lineKept.text === text && capture.text === flattened.text,
  };
}

/** @param {string} original @param {string} normalized @param {Span[]} masks
 * @returns {Span[] | null}
 */
function normalizeMasks(original, normalized, masks) {
  let offset = 0;
  let mappedLength = 0;
  const parts = [];
  /** @type {Span[]} */
  const mapped = [];
  for (const [start, end] of masks) {
    const prefix = normalizeDocumentText(original.slice(offset, start));
    const secret = normalizeDocumentText(original.slice(start, end));
    mappedLength += prefix.length;
    mapped.push([mappedLength, mappedLength + secret.length]);
    mappedLength += secret.length;
    parts.push(prefix, secret);
    offset = end;
  }
  parts.push(normalizeDocumentText(original.slice(offset)));
  // A normalization that crosses a mask boundary has no verified projection.
  return parts.join("") === normalized ? mapped : null;
}

/** @param {string} body @param {Span[]} masks */
function maskBody(body, masks) {
  let offset = 0;
  const parts = [];
  for (const [start, end] of mergeMasks(masks)) {
    parts.push(body.slice(offset, start), REPLACEMENT);
    offset = end;
  }
  return parts.join("") + body.slice(offset);
}

/** @param {string} content @param {boolean} [trimLines] */
export function redactDocumentText(content, trimLines = false) {
  let body = normalizeDocumentText(content);
  /** @type {Span[]} */
  let originalMasks = [];
  if (body !== content) {
    const traced = captureMasks(content);
    const mapped = traced && normalizeMasks(content, body, traced.masks);
    if (!mapped) return null;
    originalMasks = mapped;
  }
  for (let round = 0; round <= MAX_ROUNDS; round++) {
    const traced = captureMasks(body);
    if (!traced) return null;
    const masked = maskBody(body, [...originalMasks, ...traced.masks]);
    const cleaned = normalizeDocumentText(cleanContent(redactSecrets(masked)));
    const next = trimLines ? cleaned.split("\n").map(line => line.trimEnd()).join("\n") : cleaned;
    if (traced.stable && masked === body && next === body) return body;
    body = next;
    originalMasks = [];
  }
  return null;
}
