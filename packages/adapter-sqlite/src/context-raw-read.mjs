import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { rankScores, scoreBM25, termFrequencies, tokenizeT1 } from "@cairn-ink/core";
import { contextDeadline, contextEpochs } from "./context-read-state.mjs";
import { receiptProjector } from "./inspect.mjs";
import { decodeJson, readEntry } from "./memory-rows.mjs";
import { importTextBlocked, rawFactPolicy } from "./raw-facts.mjs";
import { hasRawFence } from "./raw-lineage.mjs";
import { decodeRawRow, rawRows, rawSegment, readRawRow } from "./raw-rows.mjs";
import { scopeKey, sha256 } from "./storage-values.mjs";
import { scopedSuppression } from "./suppressions.mjs";

/** @import { CaptureMessage, ContextRawReadStore, ContextRawTurn, ContextReadSet, FinishResult, Receipt, Scope } from "@cairn-ink/core/ports" */
/** @import { MigratedRawPolicy } from "./migrate/raw-privacy.mjs" */
/** @import { RawRow } from "./raw-rows.mjs" */
/** @import { Connection, Port } from "./storage-values.mjs" */
/** @import { SessionHasher } from "./suppressions.mjs" */
/** @typedef {ReturnType<typeof contextEpochs>} Epochs */
/** @typedef {ReturnType<typeof import("./receipt-read-safety.mjs").createReceiptReadSafety>} ReceiptReadSafety */
/** @typedef {ReturnType<typeof import("./raw-lineage.mjs").createRawLineage>} RawLineage */
/** @typedef {[string, string, string, string]} InventoryPosition */

const CHECKPOINT_ROWS = 1024;
const MAX_INVENTORY = 4096;
const MAX_TEXT_UNITS = 4 * 1024 * 1024;
const MAX_LINKS = 1024;
/** @type {InventoryPosition} */
const START_OF_INVENTORY = ["", "", "", ""];
const CHECKPOINT_PREFIX = "v1.";
const CHECKPOINT_IV_BYTES = 12;
const CHECKPOINT_TAG_BYTES = 16;

/** @param {RawRow} row */
const conversationId = ({ client, sessionId }) => JSON.stringify([client, sessionId]);
/** @param {ContextReadSet} readSet */
const inventoryKey = ({ owner, namespaces }) => sha256(JSON.stringify(["raw-inventory-v1", owner, namespaces]));
/** @param {Epochs} epochs */
const inventoryFence = ({ canonical, suppression, raw }) => sha256(JSON.stringify([canonical, suppression, raw]));

/** @param {string} storeKey @param {string} projection @param {string} fence */
function checkpointSeal(storeKey, projection, fence) {
  const key = createHmac("sha256", Buffer.from(storeKey, "hex")).update("context-raw-checkpoint-v1").digest();
  const binding = Buffer.from(JSON.stringify([projection, fence]));
  return {
    /** @param {InventoryPosition} position */
    encode(position) {
      const iv = randomBytes(CHECKPOINT_IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", key, iv).setAAD(binding);
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(position), "utf8"), cipher.final()]);
      return CHECKPOINT_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
    },
    /** @param {unknown} stored @returns {InventoryPosition | undefined} */
    decode(stored) {
      if (typeof stored !== "string" || !stored.startsWith(CHECKPOINT_PREFIX)) return undefined;
      const bytes = Buffer.from(stored.slice(CHECKPOINT_PREFIX.length), "base64url");
      const tagEnd = CHECKPOINT_IV_BYTES + CHECKPOINT_TAG_BYTES;
      if (bytes.length <= tagEnd) return undefined;
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, CHECKPOINT_IV_BYTES)).setAAD(binding);
        decipher.setAuthTag(bytes.subarray(CHECKPOINT_IV_BYTES, tagEnd));
        return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(tagEnd)), decipher.final()]).toString("utf8"));
      } catch {
        return undefined;
      }
    },
  };
}

/** @param {Connection} db */
export function discardPlaintextRawCheckpoints(db) {
  db.prepare("DELETE FROM cairn_context_raw_checkpoints WHERE published = 0 AND last_key NOT LIKE ?")
    .run(CHECKPOINT_PREFIX + "%");
}

/**
 * Checkpoint the exact canonical inventory, one bounded keyset page at a time.
 * This is separate from search, which may deliver a qualified prefix before
 * upkeep has completed. No copied Raw content is stored in the checkpoint.
 * @param {Connection} db @param {ContextReadSet} readSet @param {Epochs} epochs
 * @param {string} storeKey @param {() => boolean} stopped @param {boolean} [force]
 */
export function reconcileRawInventory(db, readSet, epochs, storeKey, stopped, force = false) {
  const key = inventoryKey(readSet), captured = inventoryFence(epochs);
  const prior = db.prepare("SELECT * FROM cairn_context_raw_checkpoints WHERE projection = ?").get(key);
  // Prioritize an authoritative Raw or denial change on demand. On a cold
  // fence without either, the host may request its ordinary upkeep pass.
  if (!force && !prior && epochs.suppression === "0" && !db.prepare(
    "SELECT 1 FROM cairn_raw_fences WHERE owner_id = ? LIMIT 1").get(readSet.owner)) return false;
  const current = prior?.fence === captured ? prior : undefined;
  if (current?.published === 1) return true;
  if (stopped()) return false;
  const seal = checkpointSeal(storeKey, key, captured);
  const position = seal.decode(current?.last_key);
  let after = position ?? START_OF_INVENTORY;
  let examined = position ? Number(current?.examined) : 0, scanned = 0, complete = true;
  const namespaceKeys = readSet.namespaces.map(namespace => scopeKey({ owner: readSet.owner, namespace })[1]);
  const rows = db.prepare(`SELECT namespace_key, client_key, session_key, message_key FROM cairn_raw_messages
    WHERE owner_id = ? AND namespace_key IN (SELECT value FROM json_each(?))
      AND (namespace_key, client_key, session_key, message_key) > (?, ?, ?, ?)
    ORDER BY namespace_key, client_key, session_key, message_key LIMIT ?`);
  for (const row of rows.iterate(readSet.owner, JSON.stringify(namespaceKeys), ...after, CHECKPOINT_ROWS + 1)) {
    if (scanned >= CHECKPOINT_ROWS || stopped()) {
      complete = false;
      break;
    }
    after = [String(row.namespace_key), String(row.client_key), String(row.session_key), String(row.message_key)];
    examined++;
    scanned++;
  }
  complete &&= !stopped();
  db.prepare(`INSERT INTO cairn_context_raw_checkpoints VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (projection) DO UPDATE SET fence = excluded.fence, last_key = excluded.last_key,
    examined = excluded.examined, published = excluded.published`)
    .run(key, captured, complete ? "" : seal.encode(after), examined, Number(complete));
  return complete;
}

/** @param {Connection} db @param {ContextReadSet} readSet @param {string} fence */
function publishedInventory(db, readSet, fence) {
  return db.prepare(`SELECT examined FROM cairn_context_raw_checkpoints
    WHERE projection = ? AND fence = ? AND published = 1`).get(inventoryKey(readSet), fence)?.examined;
}

/** @param {Connection} db @param {Scope} scope @param {string} memoryId @param {Receipt} receipt @param {RawRow} row */
export function exactReceiptTurn(db, scope, memoryId, receipt, row) {
  if (row.message.role !== receipt.role || !row.message.content) return false;
  const captures = db.prepare(`SELECT messages, result
    FROM cairn_capture_claims JOIN cairn_capture_outbox USING (owner_id, client_key, event_key)
    WHERE owner_id = ? AND namespace_key = ? AND client_key = ? AND session_key = ? AND status = 'done'
    LIMIT ?`).iterate(...scopeKey(scope), JSON.stringify(receipt.client), JSON.stringify(receipt.sessionId), MAX_LINKS);
  for (const capture of captures) {
    if (typeof capture.messages !== "string" || typeof capture.result !== "string") continue;
    const result = /** @type {FinishResult} */ (decodeJson(capture.result));
    if (!result.memories.some(memory => memory.id === memoryId)) continue;
    const admitted = /** @type {CaptureMessage[]} */ (decodeJson(capture.messages)).find(message => message.id === receipt.messageId);
    if (admitted?.content === row.message.content && admitted.role === row.message.role) return true;
  }
  return false;
}

/** @param {Port} port @param {SessionHasher} hashSession @param {string} storeKey @param {RawLineage} lineage
 * @param {ReceiptReadSafety} receiptReadSafety @param {() => number} monotonicMs
 * @param {MigratedRawPolicy} [migratedRaw]
 * @param {import("./migrate/capture-controls.mjs").MigratedCaptureControls} [controls]
 * @returns {ContextRawReadStore} */
export function createContextRawRead(port, hashSession, storeKey, lineage, receiptReadSafety, monotonicMs, migratedRaw, controls) {
  const secret = Buffer.from(storeKey, "hex");

  /** @param {Scope} scope @param {RawRow} row @param {string} fence @returns {ContextRawTurn} */
  function witnessedTurn(scope, row, fence) {
    const { id: messageId, role, occurredAtMs, content } = row.message;
    const turn = { scope, conversationId: conversationId(row), messageId, role, occurredAtMs,
      ranges: [{ start: 0, text: content }] };
    const witness = createHmac("sha256", secret).update(JSON.stringify(["context-raw-turn-v1", fence, turn])).digest("hex");
    return { ...turn, witness };
  }

  /** @param {Connection} db @param {() => boolean} stopped */
  function visibility(db, stopped) {
    /** @type {Map<Scope["namespace"], ReturnType<typeof scopedSuppression>>} */
    const policies = new Map();
    const possibleReceipts = db.prepare(`SELECT i.id, i.excerpt, i.position, CAST(i.created_at_us AS TEXT) AS time,
        r.body, r.legacy_receipt_key, r.memory_id
      FROM cairn_receipts r LEFT JOIN cairn_inspect_receipts i USING (owner_id, namespace_key, memory_id, ordinal)
      WHERE r.owner_id = ? AND r.namespace_key = ? AND r.source_key = ? LIMIT ?`);

    /** @param {Scope} scope */
    function policyFor(scope) {
      let policy = policies.get(scope.namespace);
      if (!policy) {
        policy = scopedSuppression(db, scope, hashSession);
        policies.set(scope.namespace, policy);
      }
      return policy;
    }

    /** @param {Scope} scope @param {RawRow} row */
    function directlyVisible(scope, row) {
      const { message } = row, policy = policyFor(scope);
      const rawPolicy = rawFactPolicy(scope, row, policy.facts, hashSession);
      return !stopped() && (!controls || controls.rawReadable(scope)) && Boolean(message.content) &&
        !hasRawFence(db, scope, rawPolicy.sessionKeyHash) &&
        !policy.withholdsReceipt({ ...row, messageId: message.id, role: message.role, occurredAtMs: message.occurredAtMs }) &&
        !rawPolicy.hides(message) && !importTextBlocked([], message.content, policy.legacy) &&
        !migratedRaw?.blocks(db, scope, row, [message]);
    }

    /** @param {Scope} scope @param {RawRow} row */
    return (scope, row) => {
      if (!directlyVisible(scope, row) || !lineage.receiptRootsVisible(db, scope, row, directlyVisible)) return false;
      const policy = policyFor(scope), project = receiptProjector(db, scope, policy, receiptReadSafety);
      const sourceKey = JSON.stringify([row.client, row.sessionId, row.message.id]);
      let linkCount = 0;
      for (const record of possibleReceipts.iterate(...scopeKey(scope), sourceKey, MAX_LINKS + 1)) {
        if (++linkCount > MAX_LINKS || stopped()) return false;
        const id = String(record.memory_id), entry = readEntry(db, scope, id);
        const safe = project(record);
        if (!entry || entry.row.historical || policy.hides(entry) || !safe ||
            !exactReceiptTurn(db, scope, id, safe.receipt, row)) return false;
      }
      return true;
    };
  }

  return {
    async search(tx, readSet, query, { limit, ...options }) {
      return port(tx, readSet.owner, {}, db => {
        const stopped = contextDeadline(options, monotonicMs), fence = inventoryFence(contextEpochs(db, readSet));
        const published = publishedInventory(db, readSet, fence);
        const visible = visibility(db, stopped);
        const documents = [], df = new Map(), terms = tokenizeT1(query);
        let examined = 0, textUnits = 0, complete = true, totalLength = 0;
        inventory: for (const namespace of readSet.namespaces) {
          const scope = { owner: readSet.owner, namespace };
          for (const record of rawRows(db, scope)) {
            if (stopped()) {
              complete = false;
              break inventory;
            }
            examined++;
            const row = decodeRawRow(record);
            if (!visible(scope, row)) continue;
            textUnits += row.message.content.length;
            if (documents.length >= MAX_INVENTORY || textUnits > MAX_TEXT_UNITS) {
              complete = false;
              break inventory;
            }
            const tokens = termFrequencies(row.message.content);
            totalLength += tokens.length;
            for (const term of tokens.frequencies.keys()) df.set(term, (df.get(term) ?? 0) + 1);
            documents.push({ ref: rawSegment(scope, row, 0).ref, tokens, scope, row });
          }
        }
        const ranked = [], stats = { N: documents.length, totalLength, df };
        for (const { tokens, ...document } of documents) {
          if (stopped()) return { turns: [], coverage: "partial" };
          const score = scoreBM25(terms, tokens, stats);
          if (score !== null) ranked.push({ ...document, score });
        }
        if (stopped()) return { turns: [], coverage: "partial" };
        const rows = rankScores(ranked).slice(0, limit);
        return { turns: rows.map(({ scope, row }) => witnessedTurn(scope, row, fence)),
          coverage: complete && examined === published && rows.length === ranked.length ? "included" : "partial" };
      });
    },
    async revalidate(tx, readSet, turns) {
      return port(tx, readSet.owner, {}, db => {
        const fence = inventoryFence(contextEpochs(db, readSet));
        const visible = visibility(db, () => false);
        for (const turn of turns) {
          const { scope } = turn;
          if (scope.owner !== readSet.owner || !readSet.namespaces.includes(scope.namespace)) return false;
          let session;
          try {
            session = JSON.parse(turn.conversationId);
          } catch {
            return false;
          }
          if (!Array.isArray(session) || session.length !== 2 || !session.every(value => typeof value === "string" && value)) return false;
          const [client, sessionId] = session;
          const row = readRawRow(db, scope, { client, sessionId }, turn.messageId);
          if (!row || !visible(scope, row) || JSON.stringify(witnessedTurn(scope, row, fence)) !== JSON.stringify(turn)) return false;
        }
        return true;
      });
    },
  };
}
