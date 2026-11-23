import { cleanContent } from "../privacy/text.mjs";
import { redactDocumentText } from "./redaction.mjs";

const REVISION = 1;
const BODY_LIMIT = 4_000;
const TITLE_LIMIT = 200;
const encoder = new TextEncoder();

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
  if (cleanContent(message.content) !== message.content) return dropped("ill_formed_text");
  if (typeof canonicalSessionKey !== "string" || !canonicalSessionKey) return dropped("missing_session_key");
  const body = redactDocumentText(message.content, true);
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
