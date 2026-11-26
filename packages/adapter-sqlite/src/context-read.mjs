import { CoreError } from "@cairn-ink/core";
import { contextDeadline, contextEpochs, namespaceEpochs } from "./context-read-state.mjs";
import { exactReceiptTurn, reconcileRawInventory } from "./context-raw-read.mjs";
import { anchorsVisible, receiptProjector, storedEvidence } from "./inspect.mjs";
import { decodeJson, readEntry } from "./memory-rows.mjs";
import { readRawRow } from "./raw-rows.mjs";
import { archivedReceiptExcerpt, scopeKey } from "./storage-values.mjs";
import { scopedSuppression } from "./suppressions.mjs";

/** @import { ContextEvidenceRow, ContextReadFields, ContextReadStore, Scope, UnitOfWork } from "@cairn-ink/core/ports" */
/** @import { Connection, Port } from "./storage-values.mjs" */
/** @import { SessionHasher } from "./suppressions.mjs" */
/** @import { ReceiptProjector, ReceiptReadSafety } from "./inspect.mjs" */
/** @import { RawRow } from "./raw-rows.mjs" */
/** @import { StoredReceipt } from "./receipt-identity.mjs" */
/** @import { Policy } from "./receipt-read-safety.mjs" */
/** @import { SQLOutputValue } from "node:sqlite" */
/** @typedef {Extract<ContextEvidenceRow, {type: "memory"}>} Evidence */
/** @typedef {Evidence["receipts"][number]} EvidenceReceipt */

const RECEIPT_LIMIT = 16;

/** @param {Scope} scope @param {EvidenceReceipt} receipt @param {RawRow} archived @returns {EvidenceReceipt} */
function withRawEvidence(scope, receipt, { client, sessionId, message }) {
  return { ...receipt, rawTurns: [{ scope, conversationId: JSON.stringify([client, sessionId]), messageId: message.id }],
    ...(message.occurredAtMs !== null && { sourceTimesMs: [message.occurredAtMs] }) };
}

/** @param {Connection} db @param {Scope} scope @param {string} memoryId @param {Policy} policy
 * @param {ReceiptReadSafety} receiptReadSafety @param {Record<string, SQLOutputValue>} row
 */
function addressReceipt(db, scope, memoryId, policy, receiptReadSafety, { body, legacy_receipt_key, id, time }) {
  if (typeof id !== "string" || !id) return;
  const stored = /** @type {StoredReceipt} */ (decodeJson(body));
  if (stored.receiptKey !== undefined || stored.excerpt !== undefined) return;
  const { client, sessionId, messageId, role, occurredAtMs } = stored;
  const address = { client, sessionId, messageId, role, occurredAtMs };
  const legacyKey = typeof legacy_receipt_key === "string" ? legacy_receipt_key : undefined;
  /** @type {RawRow | undefined} */
  let archived;
  if (!receiptReadSafety(db, scope, policy, address, legacyKey, legacyKey, stored, memoryId, row => { archived = row; }) ||
      !archived || !exactReceiptTurn(db, scope, memoryId, address, archived)) return;
  const excerpt = archivedReceiptExcerpt(archived.message.content);
  if (!excerpt) return;
  return withRawEvidence(scope, { ...address, id, eventId: messageId, excerpt,
    createdAtMs: Number(BigInt(String(time)) / 1000n) }, archived);
}

/** @param {Connection} db @param {Scope} scope @param {string} id @param {ReceiptProjector} project
 * @param {Policy} policy @param {ReceiptReadSafety} receiptReadSafety @param {boolean} current
 * @param {boolean} includeRaw @returns {Pick<Evidence, "receipts" | "receiptCoverage">}
 */
function receiptEvidence(db, scope, id, project, policy, receiptReadSafety, current, includeRaw) {
  const rows = db.prepare(`SELECT i.id, i.memory_id, i.excerpt, i.position, CAST(i.created_at_us AS TEXT) AS time,
      r.body, r.legacy_receipt_key
    FROM cairn_inspect_receipts i JOIN cairn_receipts r USING (owner_id, namespace_key, memory_id, ordinal)
    WHERE i.owner_id = ? AND i.namespace_key = ? AND i.memory_id = ?
    ORDER BY i.created_at_us, i.id`).iterate(...scopeKey(scope), id);
  /** @type {EvidenceReceipt[]} */
  const receipts = [];
  let examined = 0;
  for (const row of rows) {
    examined++;
    const safe = row.excerpt === null && current
      ? addressReceipt(db, scope, id, policy, receiptReadSafety, row) : project(row)?.receipt;
    if (!safe) continue;
    if (receipts.length === RECEIPT_LIMIT) break;
    const archived = includeRaw && row.excerpt !== null ? readRawRow(db, scope, safe, safe.messageId) : undefined;
    receipts.push(archived && exactReceiptTurn(db, scope, id, safe, archived)
      ? withRawEvidence(scope, safe, archived) : safe);
  }
  const exhausted = examined > RECEIPT_LIMIT;
  const withheld = examined - receipts.length;
  return { receipts, receiptCoverage: { status: exhausted || withheld ? "budget_exhausted" : "complete",
    included: receipts.length, omitted: exhausted ? null : withheld } };
}

/**
 * @param {UnitOfWork} uow @param {Port} port @param {SessionHasher} hashSession @param {ReceiptReadSafety} receiptReadSafety
 * @param {ContextReadStore["identity"]} identity @param {ReturnType<typeof import("./context-lexical.mjs").createContextLexical>} index
 * @param {string} storeKey @param {() => number} monotonicMs @param {ContextReadStore["raw"]} [raw] @returns {ContextReadStore}
 */
export function createContextReadStore(uow, port, hashSession, receiptReadSafety, identity, index, storeKey, monotonicMs, raw) {
  return {
    maintenanceAvailable: true,
    identity,
    ...(raw && { raw }),
    async prepareLexical(readSet, selection, options) {
      return uow.run(readSet.owner, {}, tx => port(tx, readSet.owner, { write: true }, db => {
        const stopped = contextDeadline(options, monotonicMs), epochs = contextEpochs(db, readSet);
        const metrics = index.reconcile(db, readSet, selection, epochs, stopped);
        if (raw) reconcileRawInventory(db, readSet, epochs, storeKey, stopped);
        return metrics;
      }));
    },
    observeIndex: index.observeIndex,
    lexical: index.lexical,
    async snapshotState(tx, readSet, types) {
      // Namespace epochs cover stored evidence and scoped suppression changes.
      // Evidence fences recheck receipt safety, and Raw revalidates its own witness.
      return port(tx, readSet.owner, {}, db => namespaceEpochs(db, readSet).map(memory => ({
        memory, ...(types.includes("card") && { card: 1 }),
      })));
    },
    async evidence(tx, readSet, refs, intent) {
      return port(tx, readSet.owner, {}, db => {
        if (refs.some(({ scope }) => scope.owner !== readSet.owner || !readSet.namespaces.includes(scope.namespace))) {
          throw new CoreError("authority_required");
        }
        /** @type {Map<Scope["namespace"], ReturnType<typeof scopedSuppression>>} */
        const policies = new Map();
        return refs.map(ref => {
          const { scope, id, type } = ref;
          const entry = type === "memory" ? readEntry(db, scope, id) : undefined;
          if (!entry || (intent === "current" && entry.row.historical)) return null;
          let policy = policies.get(scope.namespace);
          if (!policy) {
            policy = scopedSuppression(db, scope, hashSession);
            policies.set(scope.namespace, policy);
          }
          if (policy.hides(entry)) return null;
          const project = receiptProjector(db, scope, policy, receiptReadSafety);
          const stored = storedEvidence(db, scope, id);
          const qualification = stored?.qualification ? /** @type {ContextReadFields} */ (decodeJson(stored.qualification)) : null;
          const { revision, text, historical, kind, origin, confidence } = entry.row;
          return {
            type: "memory", ref: { type: "memory", scope, id, revision }, text,
            metadata: { state: historical ? "historical" : "active", reviewState: "none",
              filing: { status: stored?.filing === "filed" ? "filed" : "unfiled" }, kind, origin, confidence },
            qualification: qualification && anchorsVisible(db, scope, id, project, qualification.anchors) ? qualification : null,
            attribution: { status: "unassessed", commitment: "unknown" },
            sourceAccess: historical ? "unavailable-for-noncurrent-memory" : "available",
            ...receiptEvidence(db, scope, id, project, policy, receiptReadSafety, !historical, Boolean(raw) && !historical),
          };
        });
      });
    },
  };
}
