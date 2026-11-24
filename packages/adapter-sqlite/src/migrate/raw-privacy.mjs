import { createHmac } from "node:crypto";
import { decodeJson } from "../memory-rows.mjs";
import { scopeKey } from "../storage-values.mjs";

/** @import { CaptureKey, CaptureMessage, Scope } from "@cairn-ink/core/ports" */
/** @import { Connection } from "../storage-values.mjs" */
/** @import { Session } from "../raw-rows.mjs" */
/** @import { SessionHasher } from "../suppressions.mjs" */
/** @typedef {Pick<CaptureMessage, "id" | "occurredAtMs">} Position */
/** @typedef {ReturnType<typeof createMigratedRawPolicy>} MigratedRawPolicy */

/** @param {Scope} scope */
function legacyBoundary({ owner, namespace }) {
  if (namespace === "personal\0") return [owner, "personal", ""];
  if (namespace?.startsWith("project\0")) return [owner, "project", namespace.slice(8)];
  return null;
}

/** @param {string} key @param {Scope} scope @param {string} purpose @param {string} client @param {string} value */
export function legacyRawHash(key, scope, purpose, client, value) {
  const boundary = legacyBoundary(scope);
  if (!boundary) return null;
  return createHmac("sha256", Buffer.from(key, "hex"))
    .update(JSON.stringify([purpose, ...boundary, client, value])).digest("hex");
}

/** @param {Connection} db @param {Scope} scope @param {string} hash */
function fenced(db, scope, hash) {
  return Boolean(db.prepare("SELECT 1 FROM cairn_raw_fences WHERE owner_id = ? AND namespace_key = ? AND session_hash = ?")
    .get(...scopeKey(scope), hash));
}

/** @param {string} key @param {SessionHasher} hashSession */
export function createMigratedRawPolicy(key, hashSession) {
  return {
    /** @param {Connection} db @param {boolean | undefined} receiptProof */
    receiptAncestryEmpty(db, receiptProof) {
      if (receiptProof !== undefined) return receiptProof === true;
      // Older conversions carry only counts. Legacy validation already rejected
      // derived receipts with missing roots. Claims and episodes can own job roots.
      return Boolean(db.prepare(`SELECT 1 FROM cairn_migration WHERE
        json_extract(source_evidence, '$.dropped.rawConversations') = 0 AND
        json_extract(source_evidence, '$.dropped.rawReceiptLineage') = 0 AND
        json_extract(source_evidence, '$.dropped.episodes') = 0 AND
        json_extract(source_evidence, '$.dropped.captureAdmissions') = 0`).get());
    },

    /** @param {Connection} db @param {Pick<CaptureKey, "scope" | "client" | "eventId">} key */
    blocksEvent(db, { scope, client, eventId }) {
      return Boolean(db.prepare(`SELECT 1 FROM cairn_migrated_raw_privacy
        WHERE owner_id = ? AND namespace_key = ? AND client_key = ? AND kind = 'event' AND selector = ?`)
        .get(...scopeKey(scope), JSON.stringify(client), eventId));
    },
    /** @param {Connection} db @param {Scope} scope @param {Session} session @param {readonly Position[]} positions */
    blocks(db, scope, session, positions) {
      const { client, sessionId } = session;
      const hash = hashSession(scope, client, sessionId);
      if (fenced(db, scope, hash)) return true;
      const [owner, namespace] = scopeKey(scope);
      const clientKey = JSON.stringify(client);
      if (client === "claude-code" && positions.length) {
        const uuid = db.prepare(`SELECT 1 FROM cairn_migrated_raw_privacy
          WHERE owner_id = ? AND namespace_key = ? AND client_key = ? AND kind = 'uuid' AND selector = ?`);
        if (positions.some(({ id }) => uuid.get(owner, namespace, clientKey,
          legacyRawHash(key, scope, "local-raw-forgotten-uuid-v1", client, id)))) return true;
      }
      /** @type {Array<[number, number]>} */
      const windows = db.prepare(`SELECT body FROM cairn_migrated_raw_privacy
        WHERE owner_id = ? AND namespace_key = ? AND client_key = '' AND kind = 'window'`)
        .all(owner, namespace).map(row => decodeJson(row.body));
      if (!windows.length) return false;
      const ranges = db.prepare(`SELECT body FROM cairn_migrated_raw_privacy
        WHERE owner_id = ? AND namespace_key = ? AND client_key = ? AND kind = 'range' AND selector = ?`)
        .all(owner, namespace, clientKey, hash);
      let unknown = false;
      let min = Infinity;
      let max = -Infinity;
      for (const { body } of ranges) {
        const [start, end, unknownTime] = decodeJson(body);
        unknown ||= unknownTime;
        if (start !== null) min = Math.min(min, start);
        if (end !== null) max = Math.max(max, end);
      }
      // Old windows included both endpoints. An arrival joins the existing
      // range, so a gap between two messages can intersect a window as well.
      for (const row of db.prepare(`SELECT occurred_at_ms FROM cairn_raw_messages
        WHERE owner_id = ? AND namespace_key = ? AND client_key = ? AND session_key = ?`)
        .all(owner, namespace, clientKey, JSON.stringify(sessionId))) {
        const time = row.occurred_at_ms;
        if (time === null) unknown = true;
        else {
          min = Math.min(min, Number(time));
          max = Math.max(max, Number(time));
        }
      }
      for (const { occurredAtMs } of positions) {
        if (occurredAtMs === null) unknown = true;
        else {
          min = Math.min(min, occurredAtMs);
          max = Math.max(max, occurredAtMs);
        }
      }
      return unknown || windows.some(([start, end]) => min <= end && max >= start);
    },
  };
}
