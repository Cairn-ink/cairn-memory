import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { rankScores, scoreBM25, termFrequencies, tokenizeT1 } from "@cairn-ink/core";
import { contextDeadline, contextEpochs } from "./context-read-state.mjs";
import { receiptProjector } from "./inspect.mjs";
import { decodeEntry, decodeJson, LIVE_SCOPE, MEMORY_COLUMNS } from "./memory-rows.mjs";
import { importTextBlocked, rawFactPolicy } from "./raw-facts.mjs";
import { rawFenceReader } from "./raw-lineage.mjs";
import { decodeRawRow, rawRows, rawSegment, rawSessionKey, readRawRow } from "./raw-rows.mjs";
import { receiptIdentityKey } from "./receipt-identity.mjs";
import { archivedReceiptExcerpt, scopeKey, sha256 } from "./storage-values.mjs";
import { scopedSuppression } from "./suppressions.mjs";

/** @import { CaptureMessage, ContextRawReadStore, ContextRawTurn, ContextEvidenceRow, ContextReadSet, FinishResult, Receipt, Scope } from "@cairn-ink/core/ports" */
/** @import { MigratedRawPolicy } from "./migrate/raw-privacy.mjs" */
/** @import { RawRow } from "./raw-rows.mjs" */
/** @import { Connection, Port } from "./storage-values.mjs" */
/** @import { SessionHasher } from "./suppressions.mjs" */
/** @import { StoredReceipt } from "./receipt-identity.mjs" */
/** @import { Policy } from "./receipt-read-safety.mjs" */
/** @import { SQLOutputValue } from "node:sqlite" */
/** @typedef {Extract<ContextEvidenceRow, {type: "memory"}>["receipts"][number]} EvidenceReceipt */
/** @typedef {ReturnType<typeof contextEpochs>} Epochs */
/** @typedef {ReturnType<typeof import("./receipt-read-safety.mjs").createReceiptReadSafety>} ReceiptReadSafety */
/** @typedef {ReturnType<typeof import("./raw-lineage.mjs").createRawLineage>} RawLineage */
/** @typedef {[string, string, string, string]} InventoryPosition */
/** @typedef {{ scope: Scope, row: RawRow, tokens: ReturnType<typeof termFrequencies>, ref: ReturnType<typeof rawSegment>["ref"] }} Document */
/** @typedef {Map<string, Array<{message: CaptureMessage, memories: Set<string>}>>} CaptureMessages */
/** @typedef {{ after: string, complete: boolean, byMessage: CaptureMessages }} CaptureSession */

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
      const encoded = stored.slice(CHECKPOINT_PREFIX.length);
      const bytes = Buffer.from(encoded, "base64url");
      const tagEnd = CHECKPOINT_IV_BYTES + CHECKPOINT_TAG_BYTES;
      if (bytes.length <= tagEnd || bytes.toString("base64url") !== encoded) return undefined;
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, CHECKPOINT_IV_BYTES)).setAAD(binding);
        decipher.setAuthTag(bytes.subarray(CHECKPOINT_IV_BYTES, tagEnd));
        const position = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(tagEnd)), decipher.final()]).toString("utf8"));
        if (Array.isArray(position) && position.length === 4 && position.every(value => typeof value === "string")) {
          return /** @type {InventoryPosition} */ (position);
        }
      } catch {
        return undefined;
      }
    },
  };
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
  const seal = checkpointSeal(storeKey, key, captured);
  const position = seal.decode(current?.last_key);
  if (position && current?.published === 1) return true;
  if (stopped()) return false;
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
    .run(key, captured, seal.encode(complete ? START_OF_INVENTORY : after), examined, Number(complete));
  return complete;
}

/** @param {Connection} db @param {ContextReadSet} readSet @param {string} fence */
function publishedInventory(db, readSet, fence) {
  return db.prepare(`SELECT examined FROM cairn_context_raw_checkpoints
    WHERE projection = ? AND fence = ? AND published = 1`).get(inventoryKey(readSet), fence)?.examined;
}

/** @param {Connection} db @param {() => boolean} stopped */
function captureTurnReader(db, stopped) {
  // Resume in source index order without keeping SQLite iterators open between lookups.
  const find = db.prepare(`SELECT c.event_key, o.messages, o.result
    FROM cairn_capture_claims c INDEXED BY cairn_capture_source
    CROSS JOIN cairn_capture_outbox o USING (owner_id, client_key, event_key)
    WHERE c.owner_id = ? AND c.namespace_key = ? AND c.client_key = ? AND c.session_key = ?
      AND c.event_key > ? AND c.status = 'done' AND o.messages IS NOT NULL AND o.result IS NOT NULL
    ORDER BY c.event_key LIMIT 1`);
  /** @type {Map<string, CaptureSession>} */
  const sessions = new Map();
  return (/** @type {Scope} */ scope, /** @type {string} */ memoryId, /** @type {Receipt} */ receipt, /** @type {RawRow} */ row) => {
    if (stopped() || row.message.role !== receipt.role || !row.message.content) return false;
    const keys = rawSessionKey(scope, receipt), sessionKey = JSON.stringify(keys);
    let session = sessions.get(sessionKey);
    if (!session) {
      session = { after: "", complete: false, byMessage: new Map() };
      sessions.set(sessionKey, session);
    }
    const { byMessage } = session;
    /** @param {{message: CaptureMessage, memories: Set<string>}} candidate */
    const matches = ({ message, memories }) =>
      memories.has(memoryId) && message.content === row.message.content && message.role === row.message.role;
    if (byMessage.get(receipt.messageId)?.some(matches)) return !stopped();

    while (!session.complete && !stopped()) {
      const capture = find.get(...keys, session.after);
      if (!capture) {
        session.complete = true;
        break;
      }
      if (stopped()) return false;
      session.after = String(capture.event_key);
      const result = /** @type {FinishResult} */ (decodeJson(capture.result));
      if (!result.memories.length) continue;
      const memories = new Set(result.memories.map(({ id }) => id));
      const seen = new Set();
      let proved = false;
      for (const message of /** @type {CaptureMessage[]} */ (decodeJson(capture.messages))) {
        if (seen.has(message.id)) continue;
        seen.add(message.id);
        const candidate = { message, memories };
        const candidates = byMessage.get(message.id);
        if (candidates) candidates.push(candidate);
        else byMessage.set(message.id, [candidate]);
        if (message.id === receipt.messageId && matches(candidate)) proved = true;
      }
      if (proved) return !stopped();
    }
    return false;
  };
}

/** @param {Connection} db @param {Scope} scope @param {string} memoryId @param {Receipt} receipt @param {RawRow} row */
export function exactReceiptTurn(db, scope, memoryId, receipt, row) {
  if (row.message.role !== receipt.role || !row.message.content) return false;
  const find = db.prepare(`SELECT messages, result
    FROM cairn_capture_claims JOIN cairn_capture_outbox USING (owner_id, client_key, event_key)
    WHERE owner_id = ? AND namespace_key = ? AND client_key = ? AND session_key = ? AND status = 'done'
    LIMIT ?`);
  for (const capture of find.iterate(...rawSessionKey(scope, receipt), MAX_LINKS)) {
    if (typeof capture.messages !== "string" || typeof capture.result !== "string") continue;
    const result = /** @type {FinishResult} */ (decodeJson(capture.result));
    if (!result.memories.some(memory => memory.id === memoryId)) continue;
    const admitted = /** @type {CaptureMessage[]} */ (decodeJson(capture.messages)).find(message => message.id === receipt.messageId);
    if (admitted?.content === row.message.content && admitted.role === row.message.role) return true;
  }
  return false;
}

/** @param {Scope} scope @param {EvidenceReceipt} receipt @param {RawRow} archived @returns {EvidenceReceipt} */
export function withRawEvidence(scope, receipt, { client, sessionId, message }) {
  return { ...receipt, rawTurns: [{ scope, conversationId: JSON.stringify([client, sessionId]), messageId: message.id }],
    ...(message.occurredAtMs !== null && { sourceTimesMs: [message.occurredAtMs] }) };
}

/** @param {Connection} db @param {Scope} scope @param {string} memoryId @param {Policy} policy
 * @param {ReceiptReadSafety} receiptReadSafety @param {Record<string, SQLOutputValue>} row
 * @param {ReturnType<typeof captureTurnReader>} [exactTurn]
 * @param {RawRow} [searched]
 */
export function addressReceipt(db, scope, memoryId, policy, receiptReadSafety, { body, legacy_receipt_key, id, time },
  exactTurn = (scope, id, receipt, row) => exactReceiptTurn(db, scope, id, receipt, row), searched) {
  if (typeof id !== "string" || !id) return;
  const stored = /** @type {StoredReceipt} */ (decodeJson(body));
  if (stored.receiptKey !== undefined || stored.excerpt !== undefined) return;
  const { client, sessionId, messageId, role, occurredAtMs } = stored;
  const address = { client, sessionId, messageId, role, occurredAtMs };
  const legacyKey = typeof legacy_receipt_key === "string" ? legacy_receipt_key : undefined;
  /** @type {RawRow | undefined} */
  let archived;
  if (!receiptReadSafety(db, scope, policy, address, legacyKey, legacyKey, stored, memoryId, row => { archived = row; }, searched) ||
      !archived || !exactTurn(scope, memoryId, address, archived)) return;
  const excerpt = archivedReceiptExcerpt(archived.message.content);
  if (!excerpt) return;
  const receipt = { ...address, excerpt };
  /** @type {RawRow | undefined} */
  let checkedArchive;
  if (!receiptReadSafety(db, scope, policy, receipt, receiptIdentityKey(receipt), legacyKey, stored, memoryId,
    row => { checkedArchive = row; }, searched) || !checkedArchive || checkedArchive.client !== archived.client ||
    checkedArchive.sessionId !== archived.sessionId || checkedArchive.message.id !== archived.message.id) return;
  if (searched && (searched.message.role !== archived.message.role || searched.message.content !== archived.message.content) &&
      !exactTurn(scope, memoryId, receipt, searched)) return;
  return withRawEvidence(scope, { ...receipt, id, eventId: messageId,
    createdAtMs: Number(BigInt(String(time)) / 1000n) }, archived);
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

  /** @param {Connection} db @param {() => boolean} stopped @param {number} [memoryCacheLimit] */
  function visibility(db, stopped, memoryCacheLimit = MAX_INVENTORY) {
    /** @type {Map<Scope["namespace"], {policy: Policy, project: ReturnType<typeof receiptProjector>, current: Map<string, boolean>}>} */
    const scopes = new Map();
    let cachedMemories = 0;
    /** @type {ReturnType<Connection["prepare"]> | undefined} */
    let citingMemories;
    // The source index avoids scanning this scope's receipt inventory for each Raw row.
    const possibleReceipts = db.prepare(`SELECT i.id, i.excerpt, i.position, CAST(i.created_at_us AS TEXT) AS time,
        r.body, r.legacy_receipt_key, r.memory_id
      FROM cairn_receipts r INDEXED BY cairn_context_receipts_by_source
      LEFT JOIN cairn_inspect_receipts i USING (owner_id, namespace_key, memory_id, ordinal)
      WHERE r.owner_id = ? AND r.namespace_key = ? AND r.source_key = ? LIMIT ?`);
    const findMemory = db.prepare(`SELECT ${MEMORY_COLUMNS} FROM cairn_memories WHERE ${LIVE_SCOPE} AND id = ?`);
    /** @type {Map<string, string>} */
    const sessionHashes = new Map();
    /** @type {SessionHasher} */
    const hash = (scope, client, sessionId) => {
      const key = JSON.stringify([scope.namespace, client, sessionId]);
      let value = sessionHashes.get(key);
      if (value === undefined) {
        value = hashSession(scope, client, sessionId);
        if (sessionHashes.size < MAX_INVENTORY) sessionHashes.set(key, value);
      }
      return value;
    };
    const fenced = rawFenceReader(db), rootsVisible = lineage.receiptRootReader(db, hash), exactTurn = captureTurnReader(db, stopped);

    /** @param {Scope} scope */
    function forScope(scope) {
      let scoped = scopes.get(scope.namespace);
      if (!scoped) {
        const policy = scopedSuppression(db, scope, hash);
        scoped = { policy, project: receiptProjector(db, scope, policy, receiptReadSafety), current: new Map() };
        scopes.set(scope.namespace, scoped);
      }
      return scoped;
    }

    /** @param {Scope} scope @param {string} id */
    function memoryVisible(scope, id) {
      const { policy, current } = forScope(scope);
      let visible = current.get(id);
      if (visible === undefined) {
        const entry = findMemory.get(...scopeKey(scope), id);
        visible = !!entry && entry.historical !== 1 && !policy.hides(decodeEntry(scope, entry));
        if (cachedMemories < memoryCacheLimit) {
          current.set(id, visible);
          cachedMemories++;
        }
      }
      return visible;
    }

    /** @param {Scope} scope @param {RawRow} row */
    function directlyVisible(scope, row) {
      const { message } = row, { policy } = forScope(scope);
      const rawPolicy = rawFactPolicy(scope, row, policy.facts, hash);
      return !stopped() && (!controls || controls.rawReadable(scope)) && Boolean(message.content) &&
        !fenced(scope, rawPolicy.sessionKeyHash) &&
        ((!policy.facts.length && !policy.legacy.size) ||
          !policy.withholdsReceipt({ ...row, messageId: message.id, role: message.role, occurredAtMs: message.occurredAtMs })) &&
        !rawPolicy.hides(message) && !importTextBlocked([], message.content, policy.legacy) &&
        !migratedRaw?.blocks(db, scope, row, [message]);
    }

    /** @param {Scope} scope @param {RawRow} row */
    const cheap = (scope, row) => directlyVisible(scope, row) && rootsVisible(scope, row, directlyVisible);

    /** @param {Scope} scope @param {RawRow} row */
    function citingMemoriesVisible(scope, row) {
      citingMemories ??= db.prepare(`SELECT memory_id FROM cairn_receipts INDEXED BY cairn_context_receipts_by_source
        WHERE owner_id = ? AND namespace_key = ? AND source_key = ?`);
      const sourceKey = JSON.stringify([row.client, row.sessionId, row.message.id]);
      for (const { memory_id } of citingMemories.iterate(...scopeKey(scope), sourceKey)) {
        if (stopped() || !memoryVisible(scope, String(memory_id))) return false;
      }
      return true;
    }

    /** @param {Scope} scope @param {RawRow} row */
    function prove(scope, row) {
      const { policy, project } = forScope(scope);
      const sourceKey = JSON.stringify([row.client, row.sessionId, row.message.id]);
      let linkCount = 0;
      for (const record of possibleReceipts.iterate(...scopeKey(scope), sourceKey, MAX_LINKS + 1)) {
        if (++linkCount > MAX_LINKS || stopped()) return false;
        const id = String(record.memory_id);
        if (!memoryVisible(scope, id)) return false;
        if (record.excerpt === null) {
          if (!addressReceipt(db, scope, id, policy, receiptReadSafety, record, exactTurn, row)) return false;
        } else {
          const receipt = project(record)?.receipt;
          if (!receipt || !exactTurn(scope, id, receipt, row)) return false;
        }
      }
      return true;
    }
    return { cheap, citingMemoriesVisible, prove };
  }

  return {
    async search(tx, readSet, query, { limit, ...options }) {
      return port(tx, readSet.owner, {}, db => {
        const stopped = contextDeadline(options, monotonicMs), fence = inventoryFence(contextEpochs(db, readSet));
        const published = publishedInventory(db, readSet, fence);
        const { cheap, citingMemoriesVisible, prove } = visibility(db, stopped, Infinity);
        /** @type {Document[]} */
        const documents = [];
        /** @type {Map<string, number>} */
        const df = new Map();
        const terms = [...new Set(tokenizeT1(query))], stats = { N: 0, totalLength: 0, df };
        let examined = 0, textUnits = 0, complete = true;

        inventory: for (const namespace of readSet.namespaces) {
          const scope = { owner: readSet.owner, namespace };
          for (const record of rawRows(db, scope)) {
            if (stopped()) return { turns: [], coverage: "partial" };
            examined++;
            const row = decodeRawRow(record);
            if (!cheap(scope, row) || !citingMemoriesVisible(scope, row)) continue;
            const tokens = termFrequencies(row.message.content);
            const matched = terms.filter(term => tokens.frequencies.has(term));
            if (matched.length && !prove(scope, row)) continue;
            const size = row.message.content.length;
            if (stats.N === MAX_INVENTORY || textUnits + size > MAX_TEXT_UNITS) {
              complete = false;
              break inventory;
            }
            stats.N++;
            stats.totalLength += tokens.length;
            textUnits += size;
            if (matched.length) {
              for (const term of matched) df.set(term, (df.get(term) ?? 0) + 1);
              documents.push({ ref: rawSegment(scope, row, 0).ref, tokens, scope, row });
            }
          }
        }

        const ranked = [];
        for (const document of documents) {
          if (stopped()) return { turns: [], coverage: "partial" };
          ranked.push({ ...document, score: /** @type {number} */ (scoreBM25(terms, document.tokens, stats)) });
        }
        rankScores(ranked);
        if (stopped()) return { turns: [], coverage: "partial" };
        const rows = ranked.slice(0, limit);
        return { turns: rows.map(({ scope, row }) => witnessedTurn(scope, row, fence)),
          coverage: complete && examined === published && rows.length === ranked.length ? "included" : "partial" };
      });
    },
    async revalidate(tx, readSet, turns) {
      return port(tx, readSet.owner, {}, db => {
        const fence = inventoryFence(contextEpochs(db, readSet));
        const { cheap, prove } = visibility(db, () => false);
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
          if (!row || !cheap(scope, row) || !prove(scope, row) ||
              JSON.stringify(witnessedTurn(scope, row, fence)) !== JSON.stringify(turn)) return false;
        }
        return true;
      });
    },
  };
}
