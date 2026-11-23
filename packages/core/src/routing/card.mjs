import { redactSecrets } from "../extraction/redact.mjs";
import { coreRedactionMasks } from "../privacy/redact.mjs";
import { cleanContent } from "../privacy/text.mjs";
import { normalizeDocumentText } from "./text.mjs";

const REPLACEMENT = "[REDACTED]";
const REVISION = 1;
const BODY_LIMIT = 4_000;
const TITLE_LIMIT = 200;
const encoder = new TextEncoder();

/** @typedef {[start: number, end: number]} Span */

/** @param {string} body @returns {Span[] | null} */
function flattenedMasks(body) {
  // The offset at either end of a collapsed space covers the entire source run.
  const startsAt = body.length - body.trimStart().length;
  const trimmed = body.trim();
  const offsets = [startsAt];
  const parts = [];
  for (const match of trimmed.matchAll(/\s+|\S/gu)) {
    const raw = match[0];
    const part = /^\s/u.test(raw) ? " " : raw;
    const start = startsAt + match.index;
    parts.push(part);
    for (let i = 1; i < part.length; i++) offsets.push(start + i);
    offsets.push(start + raw.length);
  }

  const flat = parts.join("");
  /** @type {Span[]} */
  const mapped = [];
  for (const [flatStart, flatEnd] of coreRedactionMasks(flat)) {
    const start = offsets[flatStart];
    const end = offsets[flatEnd];
    if (!(start >= 0 && start < end && end <= body.length) ||
        body.slice(start, end).replace(/\s+/gu, " ") !== flat.slice(flatStart, flatEnd)) return null;
    mapped.push([start, end]);
  }
  return mapped;
}

/** @param {string} body @param {Span[]} masks */
function maskBody(body, masks) {
  let offset = 0;
  const parts = [];
  for (const [start, end] of masks.sort((a, b) => a[0] - b[0])) {
    if (start >= offset) parts.push(body.slice(offset, start), REPLACEMENT);
    offset = Math.max(offset, end);
  }
  return parts.join("") + body.slice(offset);
}

/** @param {string} content */
function redactDocumentBody(content) {
  let body = normalizeDocumentText(content);
  while (true) {
    const flat = flattenedMasks(body);
    if (flat === null) return null;
    // Both views see the same input. Masking one first can hide a boundary
    // needed by the other. Check the resulting body again for exposed syntax.
    const masked = maskBody(body, [...coreRedactionMasks(body), ...flat]);
    const cleaned = normalizeDocumentText(cleanContent(redactSecrets(masked)));
    const next = cleaned.split("\n").map(line => line.trimEnd()).join("\n");
    if (body === next) return body;
    body = next;
  }
}

/** @param {string} body @param {import("./index.mjs").DocumentMessageRef} source */
function sentenceSources(body, source) {
  /** @type {import("./index.mjs").DocumentSentence[]} */
  const sentences = [];
  let lineStart = 0;
  for (const line of body.split("\n")) {
    let start = 0;
    for (const match of line.matchAll(/[。！？!?]|\.(?= |$)|$/gu)) {
      const end = match.index + match[0].length;
      const text = line.slice(start, end);
      const trimmed = text.trim();
      if (trimmed) {
        sentences.push({
          start: lineStart + start + text.length - text.trimStart().length,
          end: lineStart + start + text.trimEnd().length,
          source,
        });
      }
      start = end;
    }
    lineStart += line.length + 1;
  }
  return sentences;
}

/** @param {import("./index.mjs").DocumentMessageRef} source */
async function cardId({ scope, client, canonicalSessionKey, messageId }) {
  const identity = ["document-card", scope.owner, scope.namespace, client, canonicalSessionKey, messageId, REVISION];
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(JSON.stringify(identity)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** @param {import("./index.mjs").DocumentCardDropReason} reason
 * @returns {import("./index.mjs").DocumentCardBuild}
 */
function dropped(reason) {
  return { card: null, drops: { [reason]: 1 } };
}

/** @param {import("./index.mjs").DocumentMessage} message
 * @param {import("./index.mjs").DocumentSession} session
 * @returns {Promise<import("./index.mjs").DocumentCardBuild>}
 */
export async function buildDocumentCard(message, { scope, client, canonicalSessionKey }) {
  if (typeof canonicalSessionKey !== "string" || !canonicalSessionKey) return dropped("missing_session_key");
  const body = redactDocumentBody(message.content);
  if (body === null) return dropped("unmappable_redaction");
  if (body.length > BODY_LIMIT) return dropped("oversize");
  const firstLine = body.split("\n").find(line => line.trim());
  if (firstLine === undefined) return dropped("empty_body");
  const title = firstLine.trim().slice(0, TITLE_LIMIT).replace(/[\uD800-\uDBFF]$/u, "");
  const date = message.occurredAtMs ?? null;
  const source = { scope: { owner: scope.owner, namespace: scope.namespace }, client, canonicalSessionKey, messageId: message.id };
  return {
    card: { id: await cardId(source), revision: REVISION, title, date, body, source, sentences: sentenceSources(body, source) },
    drops: {},
  };
}
