import { createHmac } from "node:crypto";
import { rankScores, scoreBM25, termFrequencies, tokenizeT1 } from "@cairn-ink/core";
import { contextDeadline, contextEpochs } from "./context-read-state.mjs";
import { receiptProjector } from "./inspect.mjs";
import { decodeJson, readEntry } from "./memory-rows.mjs";
import { importTextBlocked, rawFactPolicy } from "./raw-facts.mjs";
import { hasRawFence } from "./raw-lineage.mjs";
import { decodeRawRow, rawRows, rawSegment, readRawRow } from "./raw-rows.mjs";
import { scopeKey, sha256 } from "./storage-values.mjs";
import { scopedSuppression } from "./suppressions.mjs";

/** @import { CaptureMessage, ContextRawReadStore, ContextRawTurn, ContextReadSet, ContextReadStore, DocumentCardSourceMessage, FinishResult, Receipt, Scope } from "@cairn-ink/core/ports" */
/** @import { MigratedRawPolicy } from "./migrate/raw-privacy.mjs" */
/** @import { RawRow } from "./raw-rows.mjs" */
/** @import { StoredReceipt } from "./receipt-identity.mjs" */
/** @import { Connection, Port } from "./storage-values.mjs" */
/** @import { SessionHasher } from "./suppressions.mjs" */
/** @typedef {ReturnType<typeof contextEpochs>} Epochs */
/** @typedef {ReturnType<typeof import("./receipt-read-safety.mjs").createReceiptReadSafety>} ReceiptReadSafety */
/** @typedef {ReturnType<typeof import("./raw-lineage.mjs").createRawLineage>} RawLineage */

const CHECKPOINT_ROWS = 1024;
const MAX_INVENTORY = 4096;
const MAX_TEXT_UNITS = 4 * 1024 * 1024;
const MAX_LINKS = 1024;
/** @type {[string, string, string, string]} */
const START_OF_INVENTORY = ["", "", "", ""];

/** @param {RawRow} row */
const conversationId = ({ client, sessionId }) => JSON.stringify([client, sessionId]);
/** @param {ContextReadSet} readSet */
const inventoryKey = ({ owner, namespaces }) => sha256(JSON.stringify(["raw-inventory-v1", owner, namespaces]));
/** @param {Epochs} epochs */
const inventoryFence = ({ canonical, suppression, raw }) => sha256(JSON.stringify([canonical, suppression, raw]));

/**
 * Checkpoint the exact canonical inventory, one bounded keyset page at a time.
 * This is separate from search, which may deliver a qualified prefix before
 * upkeep has completed. No copied Raw content is stored in the checkpoint.
 * @param {Connection} db @param {ContextReadSet} readSet @param {Epochs} epochs
 * @param {() => boolean} stopped @param {boolean} [force]
 */
export function reconcileRawInventory(db, readSet, epochs, stopped, force = false) {
  const key = inventoryKey(readSet), captured = inventoryFence(epochs);
  const prior = db.prepare("SELECT * FROM cairn_context_raw_checkpoints WHERE projection = ?").get(key);
  // Prioritize an authoritative Raw or denial change on demand. On a cold
  // fence without either, the host may request its ordinary upkeep pass.
  if (!force && !prior && epochs.suppression === "0" && !db.prepare(
    "SELECT 1 FROM cairn_raw_fences WHERE owner_id = ? LIMIT 1").get(readSet.owner)) return false;
  const current = prior?.fence === captured ? prior : undefined;
  if (current?.published === 1) return true;
  if (stopped()) return false;
  let after = /** @type {[string, string, string, string]} */ (current ? decodeJson(current.last_key) : START_OF_INVENTORY);
  let examined = Number(current?.examined ?? 0), scanned = 0, complete = true;
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
    .run(key, captured, JSON.stringify(complete ? START_OF_INVENTORY : after), examined, Number(complete));
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
 * @param {(source: DocumentCardSourceMessage) => string} [conflictKey] */
export function createContextRawRead(port, hashSession, storeKey, lineage, receiptReadSafety, monotonicMs, migratedRaw, controls, conflictKey) {
  const secret = Buffer.from(storeKey, "hex");

  /** @param {Scope} scope @param {RawRow} row @param {string} fence @returns {ContextRawTurn} */
  function witnessedTurn(scope, row, fence) {
    const { id: messageId, role, occurredAtMs, content } = row.message;
    const turn = { scope, conversationId: conversationId(row), messageId, role, occurredAtMs,
      ranges: [{ start: 0, text: content }] };
    const witness = createHmac("sha256", secret).update(JSON.stringify(["context-raw-turn-v1", fence, turn])).digest("hex");
    return { ...turn, witness };
  }

  /** @param {Connection} db @param {() => boolean} stopped @param {boolean} [amendment] */
  function visibility(db, stopped, amendment = false) {
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
      const address = { ...row, messageId: message.id, role: message.role, occurredAtMs: message.occurredAtMs };
      return !stopped() && (!controls || controls.rawReadable(scope)) && Boolean(message.content) &&
        !hasRawFence(db, scope, rawPolicy.sessionKeyHash) &&
        !policy.withholdsReceipt(address) &&
        !rawPolicy.hides(message) && !importTextBlocked([], message.content, policy.legacy) &&
        !migratedRaw?.blocks(db, scope, row, [message]) && (!amendment || !sourceDenied(scope, address));
    }

    /** @param {Scope} scope @param {DocumentCardSourceMessage} source */
    function sourceDenied(scope, source) {
      return (conflictKey && policyFor(scope).legacy.has(conflictKey(source))) ||
        migratedRaw?.blocksSpan(db, scope, source, source.messageId) ||
        migratedRaw?.reservesMessage(db, scope, source, source.messageId);
    }

    /** @param {Scope} scope @param {RawRow} row @param {DocumentCardSourceMessage} source */
    function receiptLinksVisible(scope, row, source) {
      const policy = policyFor(scope), project = receiptProjector(db, scope, policy, receiptReadSafety);
      const sourceKey = JSON.stringify([source.client, source.sessionId, source.messageId]);
      let linkCount = 0;
      for (const record of possibleReceipts.iterate(...scopeKey(scope), sourceKey, MAX_LINKS + 1)) {
        if (++linkCount > MAX_LINKS || stopped()) return false;
        const id = String(record.memory_id), entry = readEntry(db, scope, id);
        /** @type {Receipt | undefined} */
        let receipt = project(record)?.receipt;
        if (!entry || entry.row.historical || policy.hides(entry)) return false;
        if (amendment && record.excerpt == null) {
          // A capture may retain only the address. Prove it against the finished capture below.
          const stored = /** @type {StoredReceipt} */ (decodeJson(record.body));
          const legacy = typeof record.legacy_receipt_key === "string" ? record.legacy_receipt_key : undefined;
          if (!receiptReadSafety(db, scope, policy, stored, stored.receiptKey ?? legacy, legacy,
            stored.legacyRawAncestryEmpty)) return false;
          receipt = stored;
        }
        if (!receipt || (amendment && (receipt.client !== source.client || receipt.sessionId !== source.sessionId ||
            receipt.messageId !== source.messageId)) || !exactReceiptTurn(db, scope, id, receipt, row)) return false;
      }
      return true;
    }

    return { policyFor, sourceDenied, receiptLinksVisible,
      /** @param {Scope} scope @param {RawRow} row */
      visible(scope, row) {
        return directlyVisible(scope, row) && lineage.receiptRootsVisible(db, scope, row, (target, root) =>
          (!amendment || root.message.role === row.message.role) && directlyVisible(target, root)) &&
          receiptLinksVisible(scope, row, { ...row, messageId: row.message.id });
      },
    };
  }

  /** @type {ContextRawReadStore} */
  const raw = {
    async search(tx, readSet, query, { limit, ...options }) {
      return port(tx, readSet.owner, {}, db => {
        const stopped = contextDeadline(options, monotonicMs), fence = inventoryFence(contextEpochs(db, readSet));
        const published = publishedInventory(db, readSet, fence);
        const { visible } = visibility(db, stopped);
        const documents = [], df = new Map(), terms = tokenizeT1(query);
        let examined = 0, textUnits = 0, complete = true, totalLength = 0;
        inventory: for (const namespace of readSet.namespaces) {
          const scope = { owner: readSet.owner, namespace };
          for (const record of rawRows(db, scope)) {
            if (stopped() || examined >= MAX_INVENTORY) {
              complete = false;
              break inventory;
            }
            const row = decodeRawRow(record);
            textUnits += row.message.content.length;
            if (textUnits > MAX_TEXT_UNITS) {
              complete = false;
              break inventory;
            }
            examined++;
            if (!visible(scope, row)) continue;
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
        const { visible } = visibility(db, () => false);
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

  /** @type {NonNullable<ContextReadStore["documentCardAmendmentSource"]>} */
  async function documentCardAmendmentSource(tx, readSet, scope, { sourceMessage, quote }) {
    if (scope.owner !== readSet.owner || !readSet.namespaces.includes(scope.namespace) ||
        typeof quote !== "string" || !quote) return null;
    return port(tx, readSet.owner, {}, db => {
      const session = migratedRaw?.storageSession(db, scope, sourceMessage) ?? sourceMessage;
      const row = readRawRow(db, scope, session, sourceMessage.messageId);
      if (row?.message.role !== "user" || !row.message.content.includes(quote)) return null;
      const { visible, policyFor, sourceDenied, receiptLinksVisible } = visibility(db, () => false, true);
      if (!visible(scope, row)) return null;
      const policy = policyFor(scope);
      if (session !== sourceMessage && (sourceDenied(scope, sourceMessage) ||
          !receiptReadSafety(db, scope, policy, { ...sourceMessage, role: row.message.role,
            occurredAtMs: row.message.occurredAtMs }, undefined, undefined) ||
          !receiptLinksVisible(scope, row, sourceMessage))) return null;
      const rawPolicy = rawFactPolicy(scope, row, policy.facts, hashSession);
      const { sessionKeyHash } = rawPolicy;
      return {
        sourceIdentity: { sessionKeyHash, messageKey: sourceMessage.messageId },
        source: { rawRows: [rawPolicy.evidence(row.message)], sourceLengthUtf16: row.message.content.length,
          facts: policy.facts, sourceExcluded: false, policy: { rowShingles: false } },
      };
    });
  }

  return { raw, documentCardAmendmentSource };
}
