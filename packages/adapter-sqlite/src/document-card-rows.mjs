import { decodeJson } from "./memory-rows.mjs";
import { exactScope } from "./placement-visibility.mjs";
import { copySession } from "./raw-rows.mjs";
import { invalidInput, scopeKey, validateId } from "./storage-values.mjs";

/** @import { DocumentCardAmendment, DocumentCardStore, DocumentCardSourceMessage, Scope, StoredDocumentCardRecord } from "@cairn-ink/core/ports" */
/** @import { SQLOutputValue } from "node:sqlite" */
/** @import { Connection } from "./storage-values.mjs" */
/** @typedef {Record<string, SQLOutputValue>} Row */
/** @typedef {Parameters<DocumentCardStore<StoredDocumentCardRecord>["put"]>[2]} CardWrite */
/** @typedef {CardWrite["sourceMemories"]} MemoryLinks */

export const cardWhere = exactScope + " AND card_id = ?";
export const cardColumns = "id, origin, title, body, content_hash, source_at_ms, created_at_ms, " +
  "CAST(updated_at_us AS TEXT) AS sort_key, revision, body_revision, stale, state";

/** @param {DocumentCardSourceMessage} source */
export function copyCardSource(source) {
  const session = copySession(source);
  const { messageId } = source;
  if (typeof messageId !== "string" || !messageId) invalidInput();
  return { ...session, messageId };
}

/** @param {DocumentCardSourceMessage} source */
export function sourceKeys({ client, sessionId, messageId }) {
  return [JSON.stringify(client), JSON.stringify(sessionId), JSON.stringify(messageId)];
}

/** @param {Row} row */
export function readCardSource({ client_key, session_key, message_key }) {
  return { client: decodeJson(client_key), sessionId: decodeJson(session_key), messageId: decodeJson(message_key) };
}

/** @param {Connection} db @param {Scope} scope @param {string} id */
export function readCardRow(db, scope, id) {
  return db.prepare(`SELECT ${cardColumns}
    FROM cairn_document_cards WHERE ${exactScope} AND id = ?`).get(...scopeKey(scope), id);
}

/** @param {Connection} db @param {Scope} scope @param {string} id @returns {MemoryLinks} */
export function readCardLinks(db, scope, id) {
  return db.prepare(`SELECT memory_id, revision FROM cairn_document_card_memories
    WHERE ${cardWhere} ORDER BY ordinal`).all(...scopeKey(scope), id)
    .map(({ memory_id, revision }) => ({ id: String(memory_id), revision: Number(revision) }));
}

/** @param {MemoryLinks} input @param {MemoryLinks} [existing] @returns {MemoryLinks} */
export function unionCardLinks(input, existing = []) {
  if (!Array.isArray(input)) invalidInput();
  const revisions = new Map(existing.map(({ id, revision }) => [id, revision]));
  // Use array slots, including for caller arrays with custom iterators.
  for (let i = 0; i < input.length; i++) {
    const link = input[i];
    if (!link || typeof link !== "object") invalidInput();
    const { id, revision } = link;
    validateId(id);
    if (!Number.isSafeInteger(revision) || revision < 0) invalidInput();
    if (revision > (revisions.get(id) ?? -1)) revisions.set(id, revision);
  }
  return [...revisions].map(([id, revision]) => ({ id, revision }));
}

/** @param {Connection} db @param {Scope} scope @param {string} id @param {MemoryLinks} links */
export function writeCardLinks(db, scope, id, links) {
  const keys = [...scopeKey(scope), id];
  db.prepare(`DELETE FROM cairn_document_card_memories WHERE ${cardWhere}`).run(...keys);
  const insert = db.prepare("INSERT INTO cairn_document_card_memories VALUES (?, ?, ?, ?, ?, ?)");
  for (const [ordinal, link] of links.entries()) insert.run(...keys, link.id, ordinal, link.revision);
}

/** @param {Connection} db @param {Scope} scope @param {Row} row @returns {CardWrite} */
export function decodeCard(db, scope, row) {
  const id = String(row.id);
  const sources = db.prepare(`SELECT * FROM cairn_document_card_sources WHERE ${cardWhere} ORDER BY ordinal`)
    .all(...scopeKey(scope), id);
  const primary = sources[0]?.ordinal === 0 ? sources.shift() : undefined;
  return /** @type {CardWrite} */ ({
    id, scope: { ...scope },
    ...(row.origin !== null && { origin: row.origin }),
    title: String(row.title), body: String(row.body), contentHash: String(row.content_hash),
    date: row.source_at_ms === null ? null : Number(row.source_at_ms),
    sourceMessage: primary ? readCardSource(primary) : null,
    sentences: sources.map(source => ({
      start: Number(source.start_utf16), end: Number(source.end_utf16), source: readCardSource(source),
    })),
    sourceMemories: readCardLinks(db, scope, id),
    stale: decodeJson(row.stale),
  });
}

/** @param {Connection} db @param {Scope} scope @param {string} id @param {boolean} [includeHidden] */
export function readCardAmendments(db, scope, id, includeHidden = false) {
  return db.prepare(`SELECT * FROM cairn_document_card_amendments WHERE ${cardWhere}
    AND state ${includeHidden ? "!= 'purged'" : "= 'active'"} ORDER BY date, ordinal`).all(...scopeKey(scope), id);
}

/** @param {Row} row @returns {DocumentCardAmendment} */
export function decodeCardAmendment(row) {
  return { amendmentId: String(row.amendment_id), date: String(row.date), sourceMessage: readCardSource(row),
    sentence: String(row.sentence), quote: String(row.quote) };
}

/** @param {Connection} db @param {Scope} scope */
export function readCardGeneration(db, scope) {
  return Number(db.prepare(`SELECT generation FROM cairn_document_card_generations WHERE ${exactScope}`)
    .get(...scopeKey(scope))?.generation ?? 0);
}

/** @param {Connection} db @param {Scope} scope */
export function advanceCardGeneration(db, scope) {
  db.prepare(`INSERT INTO cairn_document_card_generations VALUES (?, ?, 1)
    ON CONFLICT (owner_id, namespace_key) DO UPDATE SET generation = generation + 1`).run(...scopeKey(scope));
}
