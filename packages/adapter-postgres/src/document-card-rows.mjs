import { CoreError } from "../../core/src/index.mjs";
import { copyArray, guardOwner, inputText, invalid } from "./memory-input.mjs";

/** @import { DocumentCardHideSelector, DocumentCardRecord, DocumentCardSourceMessage, ItemRef, Scope, StoredDocumentCardRecord, Tx } from "../../core/src/ports/index.d.ts" */
/** @import { Query } from "./memory-rows.mjs" */
/** @typedef {Parameters<import("../../core/src/ports/index.d.ts").DocumentCardStore<StoredDocumentCardRecord>["put"]>[2]} CardWrite */
/** @typedef {DocumentCardRecord["sourceMemories"]} Links */

/** Each card query aliases its table as c. */
export const PERSONAL_CARD = "c.user_id = $1 AND c.scope_id = c.user_id";
export const LIVE_CARD = "c.hidden_reason IS NULL AND NOT c.tombstoned";
export const CARD_COLUMNS = `c.id, c.content_hash, c.title, c.body, c.date_ms, c.origin,
  c.source_client, c.source_session_id, c.source_message_id, c.source_memories, c.sentences, c.stale,
  c.hidden_reason, c.tombstoned, (EXTRACT(EPOCH FROM c.updated_at) * 1000000)::bigint::text AS updated_us`;

/** @param {Tx} tx @param {Scope} scope @param {boolean} [write] */
export function personalOwner(tx, scope, write) {
  if (scope?.namespace != null) throw new CoreError("capability_unavailable");
  guardOwner(tx, scope, write);
  if (scope.namespace !== null) invalid();
  return tx.owner;
}

/** @param {unknown} value */
export function nonempty(value) {
  const text = inputText(value);
  if (!text) invalid();
  return text;
}

/** @param {DocumentCardSourceMessage} source */
export function copyMessage(source) {
  return { client: nonempty(source?.client), sessionId: nonempty(source?.sessionId), messageId: nonempty(source?.messageId) };
}

/** @param {any} row */
export function sourceMessage(row) {
  if (row.source_client === null && row.source_session_id === null && row.source_message_id === null) return null;
  return copyMessage({ client: row.source_client, sessionId: row.source_session_id, messageId: row.source_message_id });
}

/** @param {Links} links @returns {Links} */
export function unionLinks(links) {
  const revisions = new Map();
  for (const link of copyArray(links)) {
    const id = nonempty(link?.id);
    if (!Number.isSafeInteger(link.revision) || link.revision < 0) invalid();
    revisions.set(id, Math.max(revisions.get(id) ?? 0, link.revision));
  }
  return Array.from(revisions, ([id, revision]) => ({ id, revision }));
}

/** @param {string} owner @param {CardWrite} input @returns {CardWrite} */
export function copyCard(owner, input) {
  if (input?.scope?.owner !== owner || input.scope.namespace !== null) invalid();
  const { date, sourceMessage, origin = "router" } = input;
  if ((date !== null && !Number.isSafeInteger(date)) || !["router", "manual", "import"].includes(origin)) invalid();
  return /** @type {CardWrite} */ ({
    id: nonempty(input.id), scope: { owner, namespace: null }, origin,
    title: inputText(input.title), body: inputText(input.body), contentHash: nonempty(input.contentHash), date,
    sourceMessage: sourceMessage === null ? null : copyMessage(sourceMessage),
    sourceMemories: unionLinks(input.sourceMemories),
    sentences: copyArray(input.sentences).map(({ start, end, source }) => {
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > input.body.length) invalid();
      return { start, end, source: copyMessage(source) };
    }),
    stale: copyArray(input.stale).map(entry => copyStale(entry)),
  });
}

/** @param {DocumentCardRecord["stale"][number]} entry */
export function copyStale(entry) {
  return { memoryId: nonempty(entry?.memoryId), replacementMemoryId: nonempty(entry?.replacementMemoryId) };
}

/** @param {any} row @param {string} owner @returns {CardWrite} */
export function decodeCard(row, owner) {
  const source = sourceMessage(row);
  if ((source !== null) !== (row.origin === "router")) invalid();
  return copyCard(owner, {
    id: row.id, scope: { owner, namespace: null }, origin: row.origin,
    title: row.title, body: row.body, date: row.date_ms === null ? null : Number(row.date_ms),
    contentHash: row.content_hash, sourceMessage: source,
    sourceMemories: row.source_memories, sentences: row.sentences, stale: row.stale,
  });
}

/** @param {any} row @param {string} owner */
export function readCard(row, owner) {
  try {
    return decodeCard(row, owner);
  } catch {
    return null;
  }
}

/** @param {Query} query @param {string} owner @param {string} id @param {boolean} [lock] */
export async function cardRow(query, owner, id, lock = false) {
  const { rows: [row] } = await query(`SELECT ${CARD_COLUMNS} FROM document_cards c
    WHERE ${PERSONAL_CARD} AND c.id = $2 ${lock ? "FOR UPDATE" : ""}`, [owner, id]);
  return row;
}

/** @param {string} id @returns {ItemRef} */
export function cardRef(id) {
  return { type: "card", id, namespace: null };
}

/** @param {DocumentCardHideSelector} selector */
export function copySelector(selector) {
  const { sourceMemoryId, sourceMessage, session } = selector ?? {};
  if ([sourceMemoryId, sourceMessage, session].filter(value => value !== undefined).length !== 1) invalid();
  if (sourceMemoryId !== undefined) return { sourceMemoryId: nonempty(sourceMemoryId) };
  if (sourceMessage !== undefined) return { sourceMessage: copyMessage(sourceMessage) };
  return { session: { client: nonempty(session?.client), sessionId: nonempty(session?.sessionId) } };
}
