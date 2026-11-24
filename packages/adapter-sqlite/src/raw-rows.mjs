import { decodeJson } from "./memory-rows.mjs";
import { invalidInput, scopeKey } from "./storage-values.mjs";

/** @import { CaptureKey, CaptureMessage, RawSegment, Scope } from "@cairn-ink/core/ports" */
/** @import { Connection } from "./storage-values.mjs" */
/** @typedef {Pick<CaptureKey, "client" | "sessionId">} Session */
/** @typedef {Session & { message: CaptureMessage }} RawRow */

export const rawScopeWhere = "owner_id = ? AND namespace_key = ?";
export const rawSessionWhere = rawScopeWhere + " AND client_key = ? AND session_key = ?";

/** @param {Session} session @returns {Session} */
export function copySession(session) {
  if (!session || typeof session !== "object") invalidInput();
  const { client, sessionId } = session;
  if (typeof client !== "string" || !client || typeof sessionId !== "string" || !sessionId) invalidInput();
  return { client, sessionId };
}

/** @param {Scope} scope @param {Session} session */
export function rawSessionKey(scope, { client, sessionId }) {
  return [...scopeKey(scope), JSON.stringify(client), JSON.stringify(sessionId)];
}

/** @param {Scope} scope @param {RawRow} row @param {number} score @returns {RawSegment} */
export function rawSegment(scope, { client, sessionId, message }, score) {
  const { owner, namespace } = scope;
  const { id: messageId, role, content, occurredAtMs } = message;
  const ref = { type: /** @type {const} */ ("raw"), namespace,
    id: JSON.stringify([owner, namespace, client, sessionId, messageId]) };
  return { ref, client, sessionId, messageId, role, content, occurredAtMs, score };
}

/** @param {Record<string, import("node:sqlite").SQLOutputValue>} row @returns {RawRow} */
export function decodeRawRow(row) {
  return {
    client: decodeJson(row.client_key), sessionId: decodeJson(row.session_key),
    message: {
      id: decodeJson(row.message_key), role: /** @type {CaptureMessage["role"]} */ (row.role),
      content: decodeJson(row.content), occurredAtMs: row.occurred_at_ms === null ? null : Number(row.occurred_at_ms),
    },
  };
}

/** @param {Connection} db @param {Scope} scope @param {Session} session @param {string} id */
export function readRawRow(db, scope, session, id) {
  const row = db.prepare(`SELECT * FROM cairn_raw_messages WHERE ${rawSessionWhere} AND message_key = ?`)
    .get(...rawSessionKey(scope, session), JSON.stringify(id));
  return row && decodeRawRow(row);
}

/** @param {Connection} db @param {Scope} scope */
export function rawRows(db, scope) {
  return db.prepare(`SELECT * FROM cairn_raw_messages WHERE ${rawScopeWhere}`).iterate(...scopeKey(scope));
}

/** @param {Connection} db @param {Scope} scope @param {Session} session */
export function rawWriter(db, scope, session) {
  const stmt = db.prepare(`INSERT INTO cairn_raw_messages
    (owner_id, namespace_key, client_key, session_key, message_key, role, content, occurred_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`);
  const keys = rawSessionKey(scope, session);
  return (/** @type {CaptureMessage} */ { id, role, content, occurredAtMs }) =>
    stmt.run(...keys, JSON.stringify(id), role, JSON.stringify(content), occurredAtMs).changes !== 0;
}
