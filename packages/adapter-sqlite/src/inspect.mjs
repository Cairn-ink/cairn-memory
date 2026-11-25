import { CoreError } from "@cairn-ink/core";
import { decodeEntry, decodeJson, LIVE_SCOPE, MEMORY_COLUMNS, readEntry } from "./memory-rows.mjs";
import { readConflicts, storedSupersession } from "./memory-relations.mjs";
import { readProceduralTag } from "./procedural-tags.mjs";
import { RAW_INSPECT_EPOCH_KEY } from "./schema/inspect.mjs";
import { scopeKey, sha256 } from "./storage-values.mjs";
import { scopedSuppression } from "./suppressions.mjs";
import { topicMembershipReader } from "./topics.mjs";

/** @import { ContextReadFields, InspectMemoryMetadata, InspectReceipt, InspectReceiptAnchor, InspectStore,
 * MemoryRow, Scope } from "@cairn-ink/core/ports" */
/** @import { SQLInputValue, SQLOutputValue } from "node:sqlite" */
/** @import { Connection, Port } from "./storage-values.mjs" */
/** @import { SessionHasher } from "./suppressions.mjs" */
/** @import { PlacementVisibility, ScopedVisibility } from "./placement-visibility.mjs" */
/** @import { Policy } from "./receipt-read-safety.mjs" */
/** @import { StoredReceipt } from "./receipt-identity.mjs" */
/** @typedef {ReturnType<typeof import("./receipt-read-safety.mjs").createReceiptReadSafety>} ReceiptReadSafety */
/** @typedef {(row: Record<string, SQLOutputValue>) => RetainedReceipt | null} ReceiptProjector */
/** @typedef {{ receipt: InspectReceipt, position: number }} RetainedReceipt */
/** @typedef {NonNullable<Awaited<ReturnType<InspectStore["item"]>>["item"]>["procedural"]} Procedural */

const withinMemory = "owner_id = ? AND namespace_key = ? AND memory_id = ?";
const receiptScope = "i.owner_id = ? AND i.namespace_key = ? AND i.memory_id = ?";
const maxSqlTime = 9223372036854775807n;

/** @param {Connection} db @param {Scope} scope @param {number} [expectedEpoch] */
function readEpoch(db, scope, expectedEpoch) {
  const [owner, namespace] = scopeKey(scope);
  const rows = db.prepare(`SELECT namespace_key, epoch FROM cairn_inspect_epochs
    WHERE owner_id = ? AND namespace_key IN (?, ?)`).all(owner, namespace, RAW_INSPECT_EPOCH_KEY);
  const epoch = Number(rows.find(row => row.namespace_key === namespace)?.epoch ?? 1) +
    Number(rows.find(row => row.namespace_key === RAW_INSPECT_EPOCH_KEY)?.epoch ?? 0);
  if (!Number.isSafeInteger(epoch)) throw new CoreError("storage_error");
  if (expectedEpoch !== undefined && expectedEpoch !== epoch) throw new CoreError("cursor_stale");
  return epoch;
}

/** @param {Connection} db @param {Scope} scope @param {string} id @param {InspectReceiptAnchor} anchor */
function resolveReceiptAnchor(db, scope, id, anchor) {
  /** @type {SQLInputValue[]} */
  const key = "row" in anchor ? [anchor.row] : [anchor.id, anchor.createdAtUs ?? BigInt(anchor.createdAtMs) * 1000n];
  if (typeof key[1] === "bigint" && (key[1] > maxSqlTime || key[1] < -maxSqlTime)) throw new CoreError("cursor_stale");
  const row = db.prepare(`SELECT CAST(created_at_us AS TEXT) AS time, id FROM cairn_inspect_receipts
    WHERE ${withinMemory} AND ${"row" in anchor ? "position = ?" : "id = ? AND created_at_us = ?"}`).get(...scopeKey(scope), id, ...key);
  if (!row) throw new CoreError("cursor_stale");
  return { time: BigInt(String(row.time)), id: String(row.id) };
}

/** @param {Connection} db @param {Scope} scope @param {Policy} policy @param {ReceiptReadSafety} receiptReadSafety
 * @returns {ReceiptProjector}
 */
export function receiptProjector(db, scope, policy, receiptReadSafety) {
  return ({ body, legacy_receipt_key, id, excerpt, position, time }) => {
    if (typeof excerpt !== "string" || !excerpt || excerpt.length > 800 || /[\u0000\uD800-\uDFFF]/u.test(excerpt) ||
        typeof id !== "string" || !id) return null;
    const { client, sessionId, messageId, role, occurredAtMs, receiptKey, legacyRawAncestryEmpty } =
      /** @type {StoredReceipt} */ (decodeJson(body));
    const source = { client, sessionId, messageId, role, occurredAtMs, excerpt };
    const legacyKey = typeof legacy_receipt_key === "string" ? legacy_receipt_key : undefined;
    if (!receiptReadSafety(db, scope, policy, source, receiptKey ?? legacyKey, legacyKey, legacyRawAncestryEmpty)) return null;
    const createdAtMs = Number(BigInt(String(time)) / 1000n);
    return { position: Number(position), receipt: { ...source, id, eventId: messageId, createdAtMs } };
  };
}

/** @param {Connection} db @param {Scope} scope @param {string} id @param {ReceiptProjector} project
 * @param {{ time: bigint, id: string }} [after]
 */
function* visibleReceipts(db, scope, id, project, after) {
  const records = db.prepare(`SELECT i.id, i.excerpt, i.position, CAST(i.created_at_us AS TEXT) AS time,
      r.body, r.legacy_receipt_key
    FROM cairn_inspect_receipts i JOIN cairn_receipts r USING (owner_id, namespace_key, memory_id, ordinal)
    WHERE ${receiptScope} AND i.excerpt IS NOT NULL ${after ? "AND (i.created_at_us, i.id) > (?, ?)" : ""}
    ORDER BY i.created_at_us ASC, i.id ASC`).iterate(...scopeKey(scope), id, ...(after ? [after.time, after.id] : []));
  for (const record of records) {
    const visible = project(record);
    if (visible) yield visible;
  }
}

/** @param {Connection} db @param {Scope} scope @param {string} id */
export function storedEvidence(db, scope, id) {
  return db.prepare(`SELECT filing, procedural, qualification, supersession
    FROM cairn_inspect_evidence WHERE ${withinMemory}`).get(...scopeKey(scope), id);
}

/** @param {Connection} db @param {MemoryRow} row @param {ReceiptProjector} project @param {SQLOutputValue | undefined} filing
 * @returns {InspectMemoryMetadata}
 */
function metadata(db, { scope, id, createdAtMs, updatedAtMs, confidence, kind, origin, revision, historical }, project, filing) {
  let receiptCount = 0;
  for (const _receipt of visibleReceipts(db, scope, id, project)) receiptCount++;
  return { id, scope, createdAtMs, updatedAtMs, confidence, kind, origin, revision, state: historical ? "historical" : "active",
    receiptCount, filing: { status: filing === "filed" ? "filed" : "unfiled" } };
}

/** @param {Connection} db @param {Scope} scope @param {string} id @param {ReceiptProjector} project @param {readonly string[]} ids */
function receiptsById(db, scope, id, project, ids) {
  const find = db.prepare(`SELECT i.id, i.excerpt, i.position, CAST(i.created_at_us AS TEXT) AS time,
      r.body, r.legacy_receipt_key
    FROM cairn_inspect_receipts i JOIN cairn_receipts r USING (owner_id, namespace_key, memory_id, ordinal)
    WHERE ${receiptScope} AND i.id = ?`);
  return new Map(ids.flatMap(receiptId => {
    const row = find.get(...scopeKey(scope), id, receiptId);
    return row ? [[receiptId, project(row)?.receipt ?? null]] : [];
  }));
}

/** @param {Connection} db @param {Scope} scope @param {string} id @param {ReceiptProjector} project @param {unknown} anchors */
export function anchorsVisible(db, scope, id, project, anchors) {
  if (!Array.isArray(anchors) || anchors.length > 4 ||
      anchors.some(anchor => !anchor || typeof anchor.receiptId !== "string")) return false;
  const receipts = receiptsById(db, scope, id, project, anchors.map(anchor => anchor.receiptId));
  if ([...receipts.values()].includes(null)) return null;
  return anchors.every(({ receiptId, receiptDigest, digest, start, end, text }) => {
    const excerpt = receipts.get(receiptId)?.excerpt;
    if (excerpt === undefined || !Number.isInteger(start) || !Number.isInteger(end) ||
        start < 0 || start >= end || end > excerpt.length) return false;
    const span = excerpt.slice(start, end);
    return !/[\uD800-\uDFFF]/u.test(span) && (text === undefined || span === text) &&
      sha256(excerpt) === (receiptDigest ?? digest);
  });
}

/** @param {Connection} db @param {Scope} scope @param {Policy} policy
 * @param {ReceiptProjector} project @param {SQLOutputValue | undefined} stored
 * @param {ReturnType<typeof storedSupersession>} current @param {ScopedVisibility | undefined} visible
 * @returns {ContextReadFields}
 */
function supersession(db, scope, policy, project, stored, current, visible) {
  const link = current ?? (stored ? /** @type {{ previousRevision: number, memoryId: string, revision: number, receiptIds: string[] }} */ (
    decodeJson(stored)
  ) : null);
  const unavailable = { previousRevision: link?.previousRevision ?? null, replacement: null, receiptIds: [], evidenceAvailable: false };
  if (!link) return unavailable;
  const replacement = readEntry(db, scope, link.memoryId);
  if (!replacement || replacement.row.revision < link.revision || policy.hides(replacement) ||
      (visible && !visible(link.memoryId))) return unavailable;
  const receiptIds = [...receiptsById(db, scope, link.memoryId, project, link.receiptIds)]
    .flatMap(([id, receipt]) => receipt ? [id] : []);
  return {
    previousRevision: link.previousRevision,
    replacement: { memoryId: link.memoryId, revision: link.revision, currentRevision: replacement.row.revision,
      state: replacement.row.historical ? "historical" : "active" },
    receiptIds, evidenceAvailable: receiptIds.length > 0 && receiptIds.length === link.receiptIds.length,
  };
}

/** @param {Port} port @param {SessionHasher} hashSession @param {ReceiptReadSafety} receiptReadSafety
 * @param {PlacementVisibility} visibility @param {Readonly<Record<string, boolean>>} flags @returns {InspectStore}
 */
export function createInspectStore(port, hashSession, receiptReadSafety, visibility, flags) {
  return {
    async identity(tx) {
      return port(tx, tx.owner, {}, db => {
        const row = db.prepare(`SELECT store_id, cursor_secret FROM cairn_store
          JOIN cairn_inspect_identity USING (singleton) WHERE singleton = 1`).get();
        if (typeof row?.store_id !== "string" || typeof row.cursor_secret !== "string") throw new CoreError("storage_error");
        return { storeId: row.store_id, cursorKey: new TextEncoder().encode(row.cursor_secret) };
      });
    },

    async list(tx, callerScope, { states, limit, after, expectedEpoch }) {
      return port(tx, callerScope.owner, {}, db => {
        const scope = { owner: tx.owner, namespace: callerScope.namespace };
        const epoch = readEpoch(db, scope, expectedEpoch);
        const policy = scopedSuppression(db, scope, hashSession);
        const project = receiptProjector(db, scope, policy, receiptReadSafety);
        const memberships = flags.placement ? topicMembershipReader(db, scope, visibility(db, scope, policy)) : undefined;
        const anchor = after && after.updatedAtUs <= maxSqlTime ? after : undefined;
        /** @type {SQLInputValue[]} */
        const stateKey = states.length === 1 ? [Number(states[0] === "historical")] : [];
        const scan = db.prepare(`SELECT ${MEMORY_COLUMNS} FROM cairn_memories WHERE ${LIVE_SCOPE}
          ${stateKey.length ? "AND historical = ?" : ""}
          ${anchor ? "AND (updated_at_us < ? OR (updated_at_us = ? AND id > ?))" : ""}
          ORDER BY updated_at_us DESC, id ASC`).iterate(...scopeKey(scope), ...stateKey,
          ...(anchor ? [anchor.updatedAtUs, anchor.updatedAtUs, anchor.id] : []));
        const rows = [];
        for (const record of scan) {
          const entry = decodeEntry(scope, record);
          if (policy.hides(entry)) continue;
          const placed = memberships?.(entry.row.id);
          const filing = placed ? (placed.length ? "filed" : "unfiled") : storedEvidence(db, scope, entry.row.id)?.filing;
          rows.push({ ...metadata(db, entry.row, project, filing),
            updatedAtUs: entry.row.updatedAtUs });
          if (rows.length > limit) break;
        }
        return { epoch, rows };
      });
    },

    async item(tx, callerScope, memoryId, { limit, after, expectedEpoch, includeQualification }) {
      return port(tx, callerScope.owner, {}, db => {
        const scope = { owner: tx.owner, namespace: callerScope.namespace };
        const epoch = readEpoch(db, scope, expectedEpoch);
        const policy = scopedSuppression(db, scope, hashSession);
        const project = receiptProjector(db, scope, policy, receiptReadSafety);
        const entry = readEntry(db, scope, memoryId);
        if (!entry || policy.hides(entry)) return { epoch, item: null, nextAnchor: null };
        const anchor = after ? resolveReceiptAnchor(db, scope, memoryId, after) : undefined;
        const rows = [];
        for (const row of visibleReceipts(db, scope, memoryId, project, anchor)) {
          rows.push(row);
          if (rows.length > limit) break;
        }
        const nextAnchor = rows.length > limit ? { row: rows[limit - 1].position } : null;
        const stored = storedEvidence(db, scope, memoryId);
        const qualification = includeQualification && stored?.qualification
          ? /** @type {ContextReadFields} */ (decodeJson(stored.qualification)) : null;
        const tag = readProceduralTag(db, scope, memoryId);
        const procedural = tag
          ? { procedural: tag.positive, tagRevision: tag.tagRevision, origin: tag.origin, anchors: tag.anchors }
          : stored?.procedural ? /** @type {Procedural} */ (decodeJson(stored.procedural)) : undefined;
        const proceduralSafety = procedural ? anchorsVisible(db, scope, memoryId, project, procedural.anchors) : undefined;
        const visible = flags.placement || flags.conflictEdges || flags.supersession ? visibility(db, scope, policy) : undefined;
        const placed = flags.placement && visible ? topicMembershipReader(db, scope, visible)(memoryId) : null;
        const filing = placed ? (placed.length ? "filed" : "unfiled") : stored?.filing;
        const memory = { ...metadata(db, entry.row, project, filing), text: entry.row.text };
        const conflicts = flags.conflictEdges && visible ? readConflicts(db, scope, [memoryId], visible).get(memoryId) ?? [] : [];
        const linkVisible = flags.supersession && entry.row.historical && visible?.(memoryId);
        const link = linkVisible ? storedSupersession(db, scope, memoryId) : undefined;
        const legacyLink = !flags.supersession || linkVisible ? stored?.supersession : undefined;
        return {
          epoch, nextAnchor,
          item: {
            memory, receipts: rows.slice(0, limit).map(({ receipt }) => receipt),
            placements: (placed ?? []).map(id => ({ id })), conflicts: conflicts.map(edge => ({ ...edge })),
            ...(includeQualification && { qualification: qualification &&
              anchorsVisible(db, scope, memoryId, project, qualification.anchors) ? qualification : null }),
            ...(proceduralSafety && { procedural }),
            ...(proceduralSafety === null && { procedural: null }),
            ...(entry.row.historical && { supersession: supersession(db, scope, policy, project, legacyLink, link, visible) }),
          },
        };
      });
    },
  };
}
