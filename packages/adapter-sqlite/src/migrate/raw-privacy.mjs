import { createHmac } from "node:crypto";
import { decodeJson } from "../memory-rows.mjs";
import { rawSessionKey, rawSessionWhere } from "../raw-rows.mjs";
import { scopeKey } from "../storage-values.mjs";
import { advanceSuppressionEpoch } from "../suppressions.mjs";

/** @import { CaptureKey, CaptureMessage, Scope } from "@cairn-ink/core/ports" */
/** @import { Connection } from "../storage-values.mjs" */
/** @import { Session } from "../raw-rows.mjs" */
/** @import { SessionHasher } from "../suppressions.mjs" */
/** @typedef {Pick<CaptureMessage, "id" | "occurredAtMs">} Position */
/** @typedef {ReturnType<typeof createMigratedRawPolicy>} MigratedRawPolicy */

/** @param {string} sessionId */
export function opaqueSessionHash(sessionId) {
  return /^legacy-raw:([0-9a-f]{64})$/u.exec(sessionId)?.[1];
}

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

/** @param {string} key @param {SessionHasher} hashSession @param {boolean} localPrivacy */
export function createMigratedRawPolicy(key, hashSession, localPrivacy) {
  /** @param {Scope} scope @param {Session} session */
  function fenceHashes(scope, { client, sessionId }) {
    const direct = hashSession(scope, client, sessionId);
    const archived = /^s1:([0-9a-f]{64})$/u.exec(sessionId)?.[1];
    return archived === undefined || archived === direct ? [direct] : [direct, archived];
  }

  /** @param {Connection} db @param {Scope} scope @param {Session} session */
  function storageSession(db, scope, session) {
    const { client, sessionId } = session;
    const opaque = { client, sessionId: "legacy-raw:" + hashSession(scope, client, sessionId) };
    return sessionId !== opaque.sessionId && db.prepare(`SELECT 1 FROM cairn_raw_messages WHERE ${rawSessionWhere} LIMIT 1`)
      .get(...rawSessionKey(scope, opaque)) ? opaque : session;
  }

  /** @param {Connection} db @param {Scope} scope @param {Session} session @param {string} id */
  function blocksUuid(db, scope, { client }, id) {
    return client === "claude-code" && Boolean(db.prepare(`SELECT 1 FROM cairn_migrated_raw_privacy
      WHERE owner_id=? AND namespace_key=? AND client_key=? AND kind='uuid' AND selector=?`)
      .get(...scopeKey(scope), JSON.stringify(client), legacyRawHash(key, scope, "local-raw-forgotten-uuid-v1", client, id)));
  }

  /** @param {Connection} db @param {Scope} scope @param {Session} session @param {readonly Position[]} positions */
  function range(db, scope, session, positions) {
    const hash = hashSession(scope, session.client, session.sessionId);
    const keys = [...scopeKey(scope), JSON.stringify(session.client), hash];
    const ranges = db.prepare(`SELECT body FROM cairn_migrated_raw_privacy
      WHERE owner_id=? AND namespace_key=? AND client_key=? AND kind='range' AND selector=?`).all(...keys);
    let unknown = false, min = Infinity, max = -Infinity;
    for (const { body } of ranges) {
      const [start, end, unknownTime] = decodeJson(body);
      unknown ||= unknownTime;
      if (start !== null) min = Math.min(min, start);
      if (end !== null) max = Math.max(max, end);
    }
    for (const { occurredAtMs } of positions) {
      if (occurredAtMs === null) unknown = true;
      else {
        min = Math.min(min, occurredAtMs);
        max = Math.max(max, occurredAtMs);
      }
    }
    return { keys, min, max, unknown };
  }

  /** @param {Connection} db @param {Scope} scope @param {Session} session @param {readonly Position[]} positions */
  function blocksSession(db, scope, session, positions) {
    if (fenceHashes(scope, session).some(hash => fenced(db, scope, hash))) return true;
    const [owner, namespace] = scopeKey(scope);
    /** @type {Array<[number, number]>} */
    const windows = db.prepare(`SELECT body FROM cairn_migrated_raw_privacy
      WHERE owner_id=? AND namespace_key=? AND client_key='' AND kind='window'`)
      .all(owner, namespace).map(row => decodeJson(row.body));
    if (!windows.length) return false;
    const archived = db.prepare(`SELECT min(occurred_at_ms) AS first, max(occurred_at_ms) AS last,
      count(*) != count(occurred_at_ms) AS has_unknown FROM cairn_raw_messages WHERE ${rawSessionWhere}`)
      .get(...rawSessionKey(scope, storageSession(db, scope, session)));
    const { min, max, unknown } = range(db, scope, session, positions);
    const first = archived?.first == null ? min : Math.min(min, Number(archived.first));
    const last = archived?.last == null ? max : Math.max(max, Number(archived.last));
    // The entire session range must miss the inclusive legacy windows.
    return unknown || archived?.has_unknown === 1 || windows.some(([start, end]) => first <= end && last >= start);
  }

  return {
    storageSession, blocksSession, blocksUuid, fenceHashes,
    /** @param {Connection} db @param {Scope} scope @param {string} client
     * @param {readonly Pick<CaptureMessage, "id">[]} messages */
    blocksLegacyFork(db, scope, client, messages) {
      if (!localPrivacy || client !== "claude-code" || !messages.length) return false;
      const [owner, namespace] = scopeKey(scope);
      const clientKey = JSON.stringify(client);
      // Legacy deletion preserves a keyed ID but erases the message and its
      // payload evidence. Treat the surviving UUID fence as scrubbed lineage.
      const ancestors = db.prepare(`SELECT DISTINCT namespace_key FROM cairn_migrated_raw_privacy
        WHERE owner_id=? AND namespace_key<>? AND client_key=? AND kind='uuid' AND body='null'`);
      const matches = db.prepare(`SELECT 1 FROM cairn_migrated_raw_privacy
        WHERE owner_id=? AND namespace_key=? AND client_key=? AND kind='uuid' AND selector=? AND body='null'`);
      for (const { namespace_key } of ancestors.iterate(owner, namespace, clientKey)) {
        const ancestor = { owner, namespace: decodeJson(namespace_key) };
        if (messages.some(({ id }) => matches.get(owner, namespace_key, clientKey,
          legacyRawHash(key, ancestor, "local-raw-forgotten-uuid-v1", client, id)))) return true;
      }
      return false;
    },
    /** @param {Connection} db @param {Scope} scope @param {Session} session @param {string} id */
    blocksSpan(db, scope, { client, sessionId }, id) {
      return Boolean(db.prepare(`SELECT 1 FROM cairn_migrated_raw_privacy
        WHERE owner_id=? AND namespace_key=? AND client_key=? AND kind='span' AND selector=? AND json_extract(body, '$[0]')=?`)
        .get(...scopeKey(scope), JSON.stringify(client), hashSession(scope, client, sessionId), id));
    },
    /** @param {Connection} db @param {Scope} scope @param {Session} session @param {readonly Position[]} positions */
    recordRange(db, scope, session, positions) {
      if (!localPrivacy || !positions.length) return;
      const { keys, min, max, unknown } = range(db, scope, session, positions);
      db.prepare(`DELETE FROM cairn_migrated_raw_privacy
        WHERE owner_id=? AND namespace_key=? AND client_key=? AND kind='range' AND selector=?`).run(...keys);
      db.prepare("INSERT INTO cairn_migrated_raw_privacy VALUES (?, ?, ?, 'range', ?, ?)")
        .run(...keys, JSON.stringify([min, max, unknown]));
    },
    /** @param {Connection} db @param {Scope} scope @param {Session} session @param {string} id */
    reservesMessage(db, scope, { client, sessionId }, id) {
      return Boolean(db.prepare(`SELECT 1 FROM cairn_migrated_raw_privacy
        WHERE owner_id=? AND namespace_key=? AND client_key=? AND kind='reservation' AND selector=? AND body=?`)
        .get(...scopeKey(scope), JSON.stringify(client), hashSession(scope, client, sessionId), JSON.stringify(id)));
    },
    /** @param {Connection} db @param {Scope} scope @param {Session} session @param {readonly Position[]} positions */
    fenceArrival(db, scope, session, positions) {
      const { client, sessionId } = session;
      const keys = scopeKey(scope);
      const hash = hashSession(scope, client, sessionId);
      const fence = db.prepare("INSERT OR IGNORE INTO cairn_raw_fences VALUES (?, ?, ?)").run(...keys, hash);
      const sessionKeys = rawSessionKey(scope, session);
      if (localPrivacy && client === "claude-code") {
        const insert = db.prepare(`INSERT OR IGNORE INTO cairn_migrated_raw_privacy
          VALUES (?, ?, ?, 'uuid', ?, '"arrival"')`);
        const archived = db.prepare(`SELECT message_key FROM cairn_raw_messages WHERE ${rawSessionWhere}`)
          .all(...rawSessionKey(scope, storageSession(db, scope, session)));
        const queued = db.prepare(`SELECT messages FROM cairn_capture_claims
          JOIN cairn_capture_outbox USING (owner_id,client_key,event_key) WHERE ${rawSessionWhere} AND messages IS NOT NULL`)
          .all(...sessionKeys);
        const ids = [...positions.map(item => item.id), ...archived.map(row => decodeJson(row.message_key)),
          ...queued.flatMap(row => decodeJson(row.messages).map((/** @type {Position} */ item) => item.id))];
        for (const id of ids) {
          const uuid = legacyRawHash(key, scope, "local-raw-forgotten-uuid-v1", client, id);
          if (uuid !== null) insert.run(...keys, JSON.stringify(client), uuid);
        }
      }
      db.prepare(`UPDATE cairn_capture_outbox SET messages='[]'
        WHERE messages IS NOT NULL AND (owner_id, client_key, event_key) IN (
          SELECT owner_id, client_key, event_key FROM cairn_capture_claims WHERE ${rawSessionWhere})`).run(...sessionKeys);
      db.prepare(`UPDATE cairn_capture_claims SET status='failed', token=NULL, expires_at_ms=NULL, dispatched=0,
        source_positions=NULL, source_proofs=NULL, failure_code='lineage_fenced'
        WHERE ${rawSessionWhere} AND status IN ('pending', 'leased', 'retryable')`).run(...sessionKeys);
      if (fence.changes) advanceSuppressionEpoch(db, scope.owner);
    },
    /** @param {Connection} db @param {boolean | undefined} receiptProof */
    receiptAncestryEmpty(db, receiptProof) {
      if (receiptProof !== undefined) return receiptProof === true;
      // Older conversions carry only counts. Legacy validation already rejected
      // derived receipts with missing roots. Claims and episodes can own job roots.
      return Boolean(db.prepare(`SELECT 1 FROM cairn_migration WHERE
        json_type(source_evidence, '$.dropped.rawConversations') = 'integer' AND
        json_extract(source_evidence, '$.dropped.rawConversations') = 0 AND
        json_type(source_evidence, '$.dropped.rawReceiptLineage') = 'integer' AND
        json_extract(source_evidence, '$.dropped.rawReceiptLineage') = 0 AND
        json_type(source_evidence, '$.dropped.episodes') = 'integer' AND
        json_extract(source_evidence, '$.dropped.episodes') = 0 AND
        json_type(source_evidence, '$.dropped.captureAdmissions') = 'integer' AND
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
      return blocksSession(db, scope, session, positions) ||
        positions.some(({ id }) => blocksUuid(db, scope, session, id));
    },
  };
}
