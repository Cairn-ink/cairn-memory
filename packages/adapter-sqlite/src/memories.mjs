import { compareSortKey, compareUtf8, CoreError } from "@cairn-ink/core";
import { attachReceipts, clearReceipts, decodeEntry, LIVE_SCOPE, MEMORY_COLUMNS, readEntry } from "./memory-rows.mjs";
import { scopedSuppression } from "./suppressions.mjs";
import {
  copyReceipts, encodeContent, invalidInput, scopeKey, validateBatch, validateId, validateMerge, validateSource, writeTime,
} from "./storage-values.mjs";

/** @import { DuplicateMerge, DuplicateQuery, MemoryMatch, MemoryStore, Receipt, Scope, SourceRef, Tx } from "@cairn-ink/core/ports" */
/** @import { Connection, Port } from "./storage-values.mjs" */
/** @import { Entry } from "./memory-rows.mjs" */
/** @import { SessionHasher } from "./suppressions.mjs" */
/** @typedef {MemoryMatch & { distance: number }} ExactMatch */

const maxSqlInteger = 9223372036854775807n;

/** @param {bigint} time @param {string} id */
function encodeCursor(time, id) {
  return Buffer.from(JSON.stringify([time.toString(), id])).toString("base64url");
}

/** @param {string} token */
function decodeCursor(token) {
  try {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]+$/u.test(token)) throw new Error();
    const [time, id, ...extra] = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(token, "base64url")));
    if (extra.length || typeof time !== "string" || !/^(0|[1-9][0-9]*)$/u.test(time) ||
        typeof id !== "string" || !id || token !== encodeCursor(BigInt(time), id)) throw new Error();
    return { time: BigInt(time), id };
  } catch {
    throw new CoreError("invalid_cursor");
  }
}

/** The reference distance is a tie-breaker even for exact matches.
 * @param {readonly number[] | null | undefined} a
 * @param {readonly number[] | Float32Array | null | undefined} b
 */
function exactDistance(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  const scaleA = a.reduce((scale, value) => Math.max(scale, Math.abs(value)), 0);
  let scaleB = 0;
  for (const value of b) scaleB = Math.max(scaleB, Math.abs(value));
  if (!scaleA || !scaleB) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index++) {
    const x = a[index] / scaleA;
    const y = b[index] / scaleB;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  return 1 - Math.max(-1, Math.min(1, dot / Math.sqrt(normA * normB)));
}

/** @param {ExactMatch} a @param {ExactMatch} b */
function matchOrder(a, b) {
  if (a.distance !== b.distance) return a.distance - b.distance;
  if (a.kind === "prior") return b.kind === "prior" ? b.batchIndex - a.batchIndex : -1;
  if (b.kind === "prior") return 1;
  return compareSortKey(b.writeTimeUs, a.writeTimeUs) || compareUtf8(b.id, a.id);
}

/** @param {Connection} db @param {Scope} scope @param {boolean} [includeStoredLegacy] */
function exactCandidates(db, scope, includeStoredLegacy = false) {
  const select = db.prepare(`SELECT ${MEMORY_COLUMNS} FROM cairn_memories WHERE ${LIVE_SCOPE}
    AND (text_hash IN (?, ?) ${includeStoredLegacy ? "OR legacy_hash IN (?, ?)" : ""})`);
  const keys = scopeKey(scope);
  /** @param {string} canonical @param {string | undefined | null} legacy */
  return (canonical, legacy) => {
    const hashes = [canonical, legacy ?? null];
    const bindings = includeStoredLegacy ? [...hashes, ...hashes] : hashes;
    return select.all(...keys, ...bindings).map(row => decodeEntry(scope, row));
  };
}

/**
 * @param {Connection} db @param {Scope} scope @param {ReturnType<typeof validateBatch>} batch
 * @param {ReturnType<typeof scopedSuppression>} policy @param {string | undefined} excludeId
 * @param {Set<string> | null} hiddenIds
 */
function duplicateMatches(db, scope, batch, policy, excludeId, hiddenIds) {
  const candidates = exactCandidates(db, scope);
  return batch.map((query, index) => {
    /** @type {ExactMatch[]} */
    const matches = [];
    for (const entry of candidates(query.textHash, query.legacyHash)) {
      const { row } = entry;
      if (row.id === excludeId) continue;
      if (policy.hides(entry)) {
        if (!hiddenIds) continue;
        hiddenIds.add(row.id);
      }
      matches.push({
        kind: "stored", match: "exact", id: row.id, revision: row.revision, writeTimeUs: row.updatedAtUs,
        distance: exactDistance(query.embedding, row.embedding?.vector),
      });
    }
    for (let i = 0; i < index; i++) {
      const prior = batch[i];
      if (prior.textHash === query.textHash || prior.textHash === query.legacyHash) {
        matches.push({ kind: "prior", match: "exact", batchIndex: i, distance: exactDistance(query.embedding, prior.embedding) });
      }
    }
    return matches.sort(matchOrder);
  });
}

/** @param {Connection} db @param {Scope} scope @param {readonly DuplicateQuery[]} input
 * @param {SourceRef} source @param {"hash" | "full"} mode @param {SessionHasher} hashSession
 * @param {string} [editId]
 * @param {ReadonlyArray<readonly Receipt[]>} [receiptsByPosition]
 */
export function readWritePolicy(db, scope, input, source, mode, hashSession, editId, receiptsByPosition) {
  const batch = validateBatch(input);
  validateSource(source);
  if ((mode !== "hash" && mode !== "full") || (editId !== undefined && typeof editId !== "string")) invalidInput();
  const policy = scopedSuppression(db, scope, hashSession);
  const hidden = new Set();
  const matches = duplicateMatches(db, scope, batch, policy, editId, hidden);
  const edit = editId === undefined ? undefined : readEntry(db, scope, editId)?.row;
  const sourceMemory = edit && { id: edit.id, createdAtMs: edit.createdAtMs };
  const blockedPositions = [];
  for (const [i, query] of batch.entries()) {
    if (policy.blocks(query, mode, sourceMemory) || policy.blocksReceipts(receiptsByPosition?.[i])) {
      blockedPositions.push(i);
    }
  }
  return {
    matches, hiddenIds: [...hidden].sort(compareUtf8), blockedPositions,
    blockedSession: policy.blocksSession(source.client, source.sessionId),
  };
}

/** @param {Connection} db @param {Scope} scope @param {ReturnType<typeof encodeContent>} content
 * @param {readonly Receipt[]} receipts @param {number} nowMs @param {number} [createdAtMs]
 */
export function insertMemory(db, scope, { body, textHash, legacyHash }, receipts, nowMs, createdAtMs = nowMs) {
  const time = writeTime(nowMs);
  if (!Number.isSafeInteger(createdAtMs) || createdAtMs > nowMs) invalidInput();
  const inserted = db.prepare(`INSERT INTO cairn_memories
    (owner_id, namespace_key, id, revision, created_at_ms, updated_at_us, text_hash, legacy_hash, body)
    VALUES (?, ?, lower(hex(randomblob(16))), 1, ?, ?, ?, ?, ?) RETURNING id`)
    .get(...scopeKey(scope), createdAtMs, time.updatedAtUs, textHash, legacyHash, JSON.stringify(body));
  if (typeof inserted?.id !== "string") throw new CoreError("internal_error");
  attachReceipts(db, scope, inserted.id, receipts);
  return { id: inserted.id, revision: 1, createdAtMs, ...time };
}

/** @param {Connection} db @param {Scope} scope @param {string} id @param {readonly Receipt[]} receipts
 * @param {DuplicateMerge} merge @param {number} nowMs
 * @returns {{outcome: "changed" | "touched", revision: number}}
 */
export function touchDuplicate(db, scope, id, receipts, merge, nowMs) {
  validateId(id);
  validateMerge(merge);
  const evidence = copyReceipts(receipts);
  const { updatedAtUs } = writeTime(nowMs);
  const entry = readEntry(db, scope, id);
  if (!entry) throw new CoreError("memory_not_found");
  const { row } = entry;
  const confidence = row.historical ? row.confidence : merge.confidence;
  const kind = row.historical ? row.kind : merge.kind ?? row.kind;
  const origin = row.historical ? row.origin : merge.origin ?? row.origin;
  const changed = confidence !== row.confidence || kind !== row.kind || origin !== row.origin;
  const revision = row.revision + Number(changed);
  db.prepare(`UPDATE cairn_memories SET revision = ?, updated_at_us = ?,
    body = json_set(body, '$.confidence', ?, '$.kind', ?, '$.origin', ?) WHERE ${LIVE_SCOPE} AND id = ?`)
    .run(revision, updatedAtUs, confidence, kind, origin, ...scopeKey(scope), id);
  attachReceipts(db, scope, id, evidence);
  return { outcome: changed ? "changed" : "touched", revision };
}

/** @param {Port} port @param {SessionHasher} hashSession
 * @param {(db: Connection, tx: Tx) => void} [markDirty] @returns {MemoryStore}
 */
export function createMemoryStore(port, hashSession, markDirty) {
  /** @param {Tx} tx @param {Scope} scope @param {string} id */
  function liveRow(tx, scope, id) {
    return port(tx, scope?.owner, {}, db => {
      validateId(id);
      return readEntry(db, scope, id)?.row ?? null;
    });
  }

  return {
    findDuplicates(tx, scope, input, options) {
      return port(tx, scope?.owner, {}, db => {
        if (!options || !Number.isFinite(options.nearDistance) || options.nearDistance < 0 ||
            (options.excludeId !== undefined && typeof options.excludeId !== "string")) invalidInput();
        const batch = validateBatch(input);
        return duplicateMatches(db, scope, batch, scopedSuppression(db, scope, hashSession), options.excludeId, null);
      });
    },

    readWritePolicy(tx, scope, input, source, mode, editId) {
      return port(tx, scope?.owner, {}, db => readWritePolicy(db, scope, input, source, mode, hashSession, editId));
    },

    insert(tx, scope, row, receipts, nowMs) {
      return port(tx, scope?.owner, { write: true }, db => {
        const content = encodeContent(row);
        const evidence = copyReceipts(receipts);
        if (evidence.length && scopedSuppression(db, scope, hashSession).blocksReceipts(evidence)) {
          throw new CoreError("suppressed");
        }
        const inserted = insertMemory(db, scope, content, evidence, nowMs, row.createdAtMs ?? nowMs);
        markDirty?.(db, tx);
        return inserted;
      });
    },

    touchDuplicate(tx, scope, id, receipts, merge, nowMs) {
      return port(tx, scope?.owner, { write: true }, db => {
        const touched = touchDuplicate(db, scope, id, receipts, merge, nowMs);
        markDirty?.(db, tx);
        return touched;
      });
    },

    get: liveRow,

    async readRevision(tx, scope, id) {
      const row = await liveRow(tx, scope, id);
      return row && { revision: row.revision, textHash: row.textHash };
    },

    replaceContent(tx, scope, id, expectedRevision, next, receipts, nowMs) {
      return port(tx, scope?.owner, { write: true }, db => {
        const { body, textHash, legacyHash } = encodeContent(next);
        const { updatedAtUs } = writeTime(nowMs);
        const evidence = receipts === null ? null : copyReceipts(receipts);
        validateId(id);
        if (!Number.isInteger(expectedRevision)) invalidInput();
        const entry = readEntry(db, scope, id);
        if (!entry) throw new CoreError("memory_not_found");
        const { row } = entry;
        if (row.revision !== expectedRevision) throw new CoreError("revision_conflict");
        if (row.historical) throw new CoreError("memory_historical");
        if (row.textHash === textHash) return { outcome: "unchanged", revision: row.revision };

        const policy = scopedSuppression(db, scope, hashSession);
        // Replacement collision checks also consider stored legacy digests.
        const candidates = exactCandidates(db, scope, true)(textHash, legacyHash);
        if (candidates.some(other => other.row.id !== id && !policy.hides(other))) throw new CoreError("memory_conflict");
        const revision = row.revision + 1;
        db.prepare(`UPDATE cairn_memories SET revision = ?, updated_at_us = ?, text_hash = ?, legacy_hash = ?, body = ?
          WHERE ${LIVE_SCOPE} AND id = ?`)
          .run(revision, updatedAtUs, textHash, legacyHash, JSON.stringify(body), ...scopeKey(scope), id);
        if (evidence !== null) {
          clearReceipts(db, scope, id);
          attachReceipts(db, scope, id, evidence);
        }
        markDirty?.(db, tx);
        return { outcome: "changed", revision };
      });
    },

    erase(tx, scope, id) {
      return port(tx, scope?.owner, { write: true }, db => {
        validateId(id);
        const { changes } = db.prepare(`UPDATE cairn_memories
          SET deleted = 1, body = NULL, text_hash = NULL, legacy_hash = NULL, revision = revision + 1
          WHERE ${LIVE_SCOPE} AND id = ?`).run(...scopeKey(scope), id);
        if (changes === 0) return false;
        clearReceipts(db, scope, id);
        markDirty?.(db, tx);
        return true;
      });
    },

    exportPage(tx, scope, { cursor, limit }) {
      return port(tx, scope?.owner, {}, db => {
        if (!Number.isSafeInteger(limit) || limit < 1) invalidInput();
        const key = cursor === null ? null : decodeCursor(cursor);
        const bounds = key && key.time <= maxSqlInteger ? [key.time, key.id] : [];
        const policy = scopedSuppression(db, scope, hashSession);
        const rows = db.prepare(`SELECT ${MEMORY_COLUMNS} FROM cairn_memories WHERE ${LIVE_SCOPE}
          ${bounds.length ? "AND (updated_at_us, id) < (?, ?)" : ""} ORDER BY updated_at_us DESC, id DESC`);
        /** @type {Entry["row"][]} */
        const items = [];
        let nextCursor = null;
        for (const record of rows.iterate(...scopeKey(scope), ...bounds)) {
          const entry = decodeEntry(scope, record);
          if (policy.hides(entry)) continue;
          if (items.length === limit) {
            const last = items[items.length - 1];
            nextCursor = encodeCursor(last.updatedAtUs, last.id);
            break;
          }
          items.push(entry.row);
        }
        return { items, nextCursor };
      });
    },
  };
}
