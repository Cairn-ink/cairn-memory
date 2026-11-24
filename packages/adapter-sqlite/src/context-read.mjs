import { CoreError } from "@cairn-ink/core";
import { contextDeadline, contextEpochs, evidenceEpochs } from "./context-read-state.mjs";
import { exactReceiptTurn, reconcileRawInventory } from "./context-raw-read.mjs";
import { anchorsVisible, receiptProjector, storedEvidence } from "./inspect.mjs";
import { decodeJson, readEntry } from "./memory-rows.mjs";
import { readRawRow } from "./raw-rows.mjs";
import { scopeKey } from "./storage-values.mjs";
import { scopedSuppression } from "./suppressions.mjs";

/** @import { ContextEvidenceRow, ContextReadFields, ContextReadStore, Scope, UnitOfWork } from "@cairn-ink/core/ports" */
/** @import { Connection, Port } from "./storage-values.mjs" */
/** @import { SessionHasher } from "./suppressions.mjs" */
/** @import { ReceiptProjector, ReceiptReadSafety } from "./inspect.mjs" */
/** @typedef {Extract<ContextEvidenceRow, {type: "memory"}>} Evidence */

const RECEIPT_LIMIT = 16;

/** @param {Connection} db @param {Scope} scope @param {string} id @param {ReceiptProjector} project
 * @param {boolean} includeRaw @returns {Pick<Evidence, "receipts" | "receiptCoverage">}
 */
function receiptEvidence(db, scope, id, project, includeRaw) {
  const prefix = db.prepare(`SELECT i.id, i.excerpt, i.position, CAST(i.created_at_us AS TEXT) AS time,
      r.body, r.legacy_receipt_key
    FROM cairn_inspect_receipts i JOIN cairn_receipts r USING (owner_id, namespace_key, memory_id, ordinal)
    WHERE i.owner_id = ? AND i.namespace_key = ? AND i.memory_id = ?
    ORDER BY i.created_at_us, i.id LIMIT ?`).all(...scopeKey(scope), id, RECEIPT_LIMIT + 1);
  /** @type {Array<Evidence["receipts"][number]>} */
  const receipts = [];
  const exhausted = prefix.length > RECEIPT_LIMIT;
  for (const row of prefix) {
    if (receipts.length === RECEIPT_LIMIT) break;
    const safe = project(row)?.receipt;
    if (!safe) continue;
    const archived = includeRaw ? readRawRow(db, scope, safe, safe.messageId) : undefined;
    if (!archived || !exactReceiptTurn(db, scope, id, safe, archived)) {
      receipts.push(safe);
      continue;
    }
    const { client, sessionId, message } = archived;
    receipts.push({ ...safe, rawTurns: [{ scope, conversationId: JSON.stringify([client, sessionId]), messageId: message.id }],
      ...(message.occurredAtMs !== null && { sourceTimesMs: [message.occurredAtMs] }) });
  }
  const withheld = prefix.length - receipts.length;
  return { receipts, receiptCoverage: { status: exhausted || withheld ? "budget_exhausted" : "complete",
    included: receipts.length, omitted: exhausted ? null : withheld } };
}

/**
 * @param {UnitOfWork} uow @param {Port} port @param {SessionHasher} hashSession @param {ReceiptReadSafety} receiptReadSafety
 * @param {ContextReadStore["identity"]} identity @param {ReturnType<typeof import("./context-lexical.mjs").createContextLexical>} index
 * @param {() => number} monotonicMs @param {ContextReadStore["raw"]} [raw] @returns {ContextReadStore}
 */
export function createContextReadStore(uow, port, hashSession, receiptReadSafety, identity, index, monotonicMs, raw) {
  return {
    maintenanceAvailable: true,
    identity,
    ...(raw && { raw }),
    async prepareLexical(readSet, selection, options) {
      return uow.run(readSet.owner, {}, tx => port(tx, readSet.owner, { write: true }, db => {
        const stopped = contextDeadline(options, monotonicMs), epochs = contextEpochs(db, readSet);
        const metrics = index.reconcile(db, readSet, selection, epochs, stopped);
        if (raw) reconcileRawInventory(db, readSet, epochs, stopped);
        return metrics;
      }));
    },
    observeIndex: index.observeIndex,
    lexical: index.lexical,
    async snapshotState(tx, readSet, types) {
      return port(tx, readSet.owner, {}, db => evidenceEpochs(contextEpochs(db, readSet)).map(memory => ({
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
            ...receiptEvidence(db, scope, id, project, Boolean(raw) && !historical),
          };
        });
      });
    },
  };
}
