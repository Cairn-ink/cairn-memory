import { createHmac } from "node:crypto";
import { CoreError, factHidesRow } from "@cairn-ink/core";
import { decodeJson, readEntry, readReceipts } from "./memory-rows.mjs";
import { decodeRawRow, rawScopeWhere, rawSessionKey, rawSessionWhere, readRawRow } from "./raw-rows.mjs";
import { scopeKey, sha256, validateId } from "./storage-values.mjs";
import { readFacts } from "./suppressions.mjs";

/** @import { RawSpanFact } from "@cairn-ink/core" */
/** @import { CaptureMessage, Scope, SpanLineageStore } from "@cairn-ink/core/ports" */
/** @import { RawRow, Session } from "./raw-rows.mjs" */
/** @import { Connection, Port } from "./storage-values.mjs" */
/** @import { SessionHasher } from "./suppressions.mjs" */
/** @typedef {[messageTag: string, proof: string]} Proof */

/** @param {Connection} db @param {Scope} scope @param {string} sessionHash */
export function hasRawFence(db, scope, sessionHash) {
  return db.prepare(`SELECT 1 FROM cairn_raw_fences WHERE owner_id = ? AND namespace_key = ? AND session_hash = ?`)
    .get(...scopeKey(scope), sessionHash) !== undefined;
}

/** @param {Connection} db @param {Scope} scope @param {string} client @param {string} sessionHash
 * @param {ReturnType<typeof readFacts>} [facts]
 */
export function allowsRawSession(db, scope, client, sessionHash, facts = readFacts(db, scope)) {
  return !hasRawFence(db, scope, sessionHash) && !blocksRawSession(scope, client, sessionHash, facts);
}

/** @param {Scope} scope @param {string} client @param {string} sessionHash @param {ReturnType<typeof readFacts>} facts */
export function blocksRawSession(scope, client, sessionHash, facts) {
  /** @type {import("@cairn-ink/core").FactMatchRow} */
  const candidate = { type: "raw", scope, source: { client, sessionKeyHash: sessionHash },
    sessionKeyHash: sessionHash, messageKey: "", startUtf16: 0, endUtf16: 0 };
  return facts.some(stored => stored.fact.kind === "session" && factHidesRow(stored, candidate) !== false);
}

/** @param {string} storeKey @param {SessionHasher} hashSession */
export function createRawLineage(storeKey, hashSession) {
  const secret = Buffer.from(storeKey, "hex");
  const tag = (/** @type {string[]} */ parts) => createHmac("sha256", secret).update(JSON.stringify(parts)).digest("hex");

  /** @param {string} owner @param {string} client @param {readonly CaptureMessage[]} messages @returns {Proof[]} */
  function proofs(owner, client, messages) {
    return messages.map(({ id, content }) => {
      const messageTag = tag(["raw-lineage-id", owner, client, id]);
      return [messageTag, content === "" ? "" : tag(["raw-lineage-content", messageTag, content])];
    });
  }

  /** @param {Connection} db @param {string} owner @param {string} client
   * @param {readonly Proof[]} candidates @param {string | null} excludedSession
   */
  function* matchingAnchors(db, owner, client, candidates, excludedSession) {
    const find = db.prepare(`SELECT DISTINCT namespace_key, session_hash FROM cairn_raw_anchors
      WHERE owner_id = ? AND client_key = ? AND message_tag = ? AND (? IS NULL OR session_tag <> ?)
        AND (? = '' OR proof = '' OR proof = ?)`);
    const seen = new Set();
    for (const [messageTag, proof] of candidates) {
      for (const row of find.iterate(owner, JSON.stringify(client), messageTag, excludedSession, excludedSession, proof, proof)) {
        const key = JSON.stringify([row.namespace_key, row.session_hash]);
        if (seen.has(key)) continue;
        seen.add(key);
        yield { scope: { owner, namespace: decodeJson(row.namespace_key) }, sessionHash: String(row.session_hash) };
      }
    }
  }

  return {
    proofs,

    /** @param {Connection} db @param {Scope} scope @param {Session} session @param {readonly CaptureMessage[]} messages */
    record(db, scope, { client, sessionId }, messages) {
      const { owner } = scope;
      const [, namespace] = scopeKey(scope);
      const sessionTag = tag(["raw-lineage-session", owner, client, sessionId]);
      const sessionHash = hashSession(scope, client, sessionId);
      const insert = db.prepare(`INSERT INTO cairn_raw_anchors
        (owner_id, client_key, message_tag, namespace_key, session_tag, session_hash, proof)
        VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`);
      for (const [messageTag, proof] of proofs(owner, client, messages)) {
        insert.run(owner, JSON.stringify(client), messageTag, namespace, sessionTag, sessionHash, proof);
      }
    },

    /** @param {Connection} db @param {Scope} scope @param {Session} session @param {readonly Proof[]} candidates */
    fenced(db, scope, { client, sessionId }, candidates) {
      if (hasRawFence(db, scope, hashSession(scope, client, sessionId))) return true;
      const { owner } = scope;
      const sessionTag = tag(["raw-lineage-session", owner, client, sessionId]);
      for (const root of matchingAnchors(db, owner, client, candidates, sessionTag)) {
        if (!allowsRawSession(db, root.scope, client, root.sessionHash)) return true;
      }
      return false;
    },

    /** @param {Connection} db @param {Scope} scope @param {Session & {messageId: string}} receipt */
    hasPossibleReceiptSource(db, scope, receipt) {
      const { client, sessionId, messageId } = receipt;
      if (db.prepare(`SELECT 1 FROM cairn_raw_messages WHERE ${rawSessionWhere} LIMIT 1`)
        .get(...rawSessionKey(scope, receipt))) return true;
      const messageTag = tag(["raw-lineage-id", scope.owner, client, messageId]);
      const sessionTag = tag(["raw-lineage-session", scope.owner, client, sessionId]);
      const clientKey = JSON.stringify(client);
      // Without the full turn, even a root with a different content proof is possible.
      return Boolean(db.prepare(`SELECT 1 FROM cairn_raw_anchors WHERE owner_id = ? AND client_key = ?
        AND message_tag = ?
        UNION ALL SELECT 1 FROM cairn_raw_anchors WHERE owner_id = ? AND client_key = ?
        AND namespace_key = ? AND session_tag = ? LIMIT 1`)
        .get(scope.owner, clientKey, messageTag, ...scopeKey(scope), clientKey, sessionTag));
    },

    /** @param {Connection} db @param {Scope} scope @param {RawRow} source
     * @param {(scope: Scope, row: RawRow) => boolean} visible
     */
    receiptRootsVisible(db, scope, { client, sessionId, message }, visible) {
      const candidates = proofs(scope.owner, client, [message]);
      const direct = hashSession(scope, client, sessionId);
      const rowsForMessage = db.prepare(`SELECT * FROM cairn_raw_messages WHERE ${rawScopeWhere}
        AND client_key = ? AND message_key = ?`);
      for (const root of matchingAnchors(db, scope.owner, client, candidates, null)) {
        const target = root.scope;
        if (target.namespace === scope.namespace && root.sessionHash === direct) continue;
        if (hasRawFence(db, target, root.sessionHash)) return false;
        const rows = rowsForMessage.all(...scopeKey(target), JSON.stringify(client), JSON.stringify(message.id))
          .map(decodeRawRow).filter(row => hashSession(target, client, row.sessionId) === root.sessionHash);
        if (rows.length !== 1 || !visible(target, rows[0])) return false;
      }
      return true;
    },
  };
}

/** @param {Port} port @param {SessionHasher} hashSession
 * @returns {SpanLineageStore & {readSpans: SpanLineageStore["resolveSpans"]}}
 */
export function createSpanLineage(port, hashSession) {
  /** @param {Connection} db @param {Scope} scope @param {string} memoryId @param {"read" | "forget"} intent */
  function resolve(db, scope, memoryId, intent) {
    validateId(memoryId);
    const entry = readEntry(db, scope, memoryId);
    if (!entry) throw new CoreError("raw_lineage_unavailable");
    const receipts = readReceipts(db, scope, memoryId);
    if (!receipts.length && entry.row.source.kind === "capture") throw new CoreError("raw_lineage_unavailable");

    /** @type {RawSpanFact[]} */
    const spans = [];
    for (const receipt of receipts) {
      const { client, sessionId, messageId, role } = receipt;
      const archived = readRawRow(db, scope, receipt, messageId);
      if (!archived) continue;
      const { content } = archived.message;
      if (typeof content !== "string") throw new CoreError("raw_lineage_unavailable");
      if (content === "" || archived.message.role !== role) {
        if (intent === "forget") continue;
        throw new CoreError("raw_lineage_unavailable");
      }
      spans.push({ ...scope, kind: "rawSpan", origin: "forget", actionId: memoryId,
        sessionKeyHash: hashSession(scope, client, sessionId), messageKey: messageId,
        startUtf16: 0, endUtf16: content.length, contentDigest: sha256(content) });
    }
    return spans;
  }

  /** @type {SpanLineageStore["resolveSpans"]} */
  const readSpans = (tx, input, id) => port(tx, input?.owner, {}, db =>
    resolve(db, { owner: tx.owner, namespace: input.namespace }, id, "read"));
  /** @type {SpanLineageStore["resolveSpans"]} */
  const resolveForForget = (tx, input, id) => port(tx, input?.owner, { write: true, pauseLock: true }, db =>
    resolve(db, { owner: tx.owner, namespace: input.namespace }, id, "forget"));
  return {
    readSpans,
    resolveSpans(tx, input, id) {
      // The core forget port uses the pause-locked writer. Keep the existing
      // read-only entry strict, and expose the strict read on either Tx type.
      return tx?.readOnly ? readSpans(tx, input, id) : resolveForForget(tx, input, id);
    },
  };
}
