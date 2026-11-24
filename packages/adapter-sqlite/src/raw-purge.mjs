import { decodeJson } from "./memory-rows.mjs";
import { rawFactPolicy } from "./raw-facts.mjs";
import { decodeRawRow, rawSessionKey, rawSessionWhere } from "./raw-rows.mjs";
import { scopeKey } from "./storage-values.mjs";

/** @import { StoredFact } from "@cairn-ink/core" */
/** @import { CaptureMessage, Scope } from "@cairn-ink/core/ports" */
/** @import { Session } from "./raw-rows.mjs" */
/** @import { Connection } from "./storage-values.mjs" */
/** @import { SessionHasher } from "./suppressions.mjs" */

/** @param {Connection} db @param {Scope} scope @param {(session: Session, message: CaptureMessage) => boolean} matches
 * @param {Session} [onlySession]
 */
function scrubOutbox(db, scope, matches, onlySession) {
  const rows = db.prepare(`SELECT client_key, session_key, event_key, messages
    FROM cairn_capture_claims JOIN cairn_capture_outbox USING (owner_id, client_key, event_key)
    WHERE owner_id = ? AND namespace_key = ? AND messages IS NOT NULL
      ${onlySession ? "AND client_key = ? AND session_key = ?" : ""}`)
    .all(...(onlySession ? rawSessionKey(scope, onlySession) : scopeKey(scope)));
  const update = db.prepare(`UPDATE cairn_capture_outbox SET messages = ?
    WHERE owner_id = ? AND client_key = ? AND event_key = ?`);
  let ledgerBlanked = 0;
  for (const row of rows) {
    const session = { client: decodeJson(row.client_key), sessionId: decodeJson(row.session_key) };
    /** @type {CaptureMessage[]} */
    const messages = decodeJson(row.messages);
    const before = ledgerBlanked;
    for (const message of messages) {
      if (message.content !== "" && matches(session, message)) {
        // Retain the position and provenance for a retry and for ID-only proof.
        message.content = "";
        ledgerBlanked++;
      }
    }
    if (ledgerBlanked !== before) update.run(JSON.stringify(messages), scope.owner, row.client_key, row.event_key);
  }
  return ledgerBlanked;
}

/** @param {Connection} db @param {Scope} scope @param {readonly Session[]} sessions */
export function eraseRawSessions(db, scope, sessions) {
  const remove = db.prepare(`DELETE FROM cairn_raw_messages WHERE ${rawSessionWhere}`);
  let rawDeleted = 0;
  let ledgerBlanked = 0;
  for (const session of sessions) {
    rawDeleted += Number(remove.run(...rawSessionKey(scope, session)).changes);
    ledgerBlanked += scrubOutbox(db, scope, () => true, session);
  }
  return { rawDeleted, ledgerBlanked };
}

/** @param {Connection} db @param {Scope} scope @param {StoredFact[]} facts @param {SessionHasher} hashSession */
export function purgeRawMessages(db, scope, facts, hashSession) {
  if (!facts.length) return { rawDeleted: 0, ledgerBlanked: 0 };
  const rows = db.prepare(`SELECT * FROM cairn_raw_messages WHERE owner_id = ? AND namespace_key = ?`)
    .all(...scopeKey(scope));
  const remove = db.prepare(`DELETE FROM cairn_raw_messages WHERE ${rawSessionWhere} AND message_key = ?`);
  const matches = (/** @type {Session} */ session, /** @type {CaptureMessage} */ message) =>
    rawFactPolicy(scope, session, facts, hashSession).purges(message);
  let rawDeleted = 0;
  for (const row of rows) {
    const decoded = decodeRawRow(row);
    if (matches(decoded, decoded.message)) {
      rawDeleted += Number(remove.run(...rawSessionKey(scope, decoded), row.message_key).changes);
    }
  }
  return { rawDeleted, ledgerBlanked: scrubOutbox(db, scope, matches) };
}
