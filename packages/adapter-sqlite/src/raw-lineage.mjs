import { createHmac } from "node:crypto";
import { CoreError, factHidesRow } from "@cairn-ink/core";
import { decodeJson, readEntry, readReceipts } from "./memory-rows.mjs";
import { readRawRow } from "./raw-rows.mjs";
import { scopeKey, sha256, validateId } from "./storage-values.mjs";
import { readFacts } from "./suppressions.mjs";

/** @import { RawSpanFact } from "@cairn-ink/core" */
/** @import { CaptureMessage, Scope, SpanLineageStore } from "@cairn-ink/core/ports" */
/** @import { Session } from "./raw-rows.mjs" */
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
      const find = db.prepare(`SELECT DISTINCT namespace_key, session_hash FROM cairn_raw_anchors
        WHERE owner_id = ? AND client_key = ? AND message_tag = ? AND session_tag <> ?
          AND (? = '' OR proof = '' OR proof = ?)`);
      const checked = new Set();
      for (const [messageTag, proof] of candidates) {
        for (const row of find.iterate(owner, JSON.stringify(client), messageTag, sessionTag, proof, proof)) {
          const identity = JSON.stringify([row.namespace_key, row.session_hash]);
          if (checked.has(identity)) continue;
          checked.add(identity);
          // Only source eligibility consults ancestors across namespaces, and
          // each ancestor is evaluated under the scope where it was recorded.
          const sourceScope = { owner, namespace: decodeJson(row.namespace_key) };
          if (!allowsRawSession(db, sourceScope, client, String(row.session_hash))) return true;
        }
      }
      return false;
    },
  };
}

/** @param {Port} port @param {SessionHasher} hashSession @returns {SpanLineageStore} */
export function createSpanLineage(port, hashSession) {
  return {
    resolveSpans(tx, input, memoryId) {
      return port(tx, input?.owner, {}, db => {
        const scope = { owner: tx.owner, namespace: input.namespace };
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
          // A missing row leaves no Raw span to fence. Surviving rows still need
          // to support the receipt before their content can supply a span.
          if (!archived) continue;
          const { content } = archived.message;
          if (typeof content !== "string" || !content || archived.message.role !== role) {
            throw new CoreError("raw_lineage_unavailable");
          }
          // Capture receipts identify a full message. Core supplies the final
          // action ID when it writes the resolved facts.
          spans.push({ ...scope, kind: "rawSpan", origin: "forget", actionId: memoryId,
            sessionKeyHash: hashSession(scope, client, sessionId), messageKey: messageId,
            startUtf16: 0, endUtf16: content.length, contentDigest: sha256(content) });
        }
        return spans;
      });
    },
  };
}
