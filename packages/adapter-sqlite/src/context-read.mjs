import { CoreError } from "@cairn-ink/core";
import { contextDeadline, contextEpochs, namespaceCardGenerations, namespaceEpochs } from "./context-read-state.mjs";
import { addressReceipt, exactReceiptTurn, reconcileRawInventory, withRawEvidence } from "./context-raw-read.mjs";
import { readCardLinks, readCardRow } from "./document-card-rows.mjs";
import { anchorsVisible, receiptProjector, storedEvidence } from "./inspect.mjs";
import { decodeJson, readEntry } from "./memory-rows.mjs";
import { readRawRow } from "./raw-rows.mjs";
import { scopeKey } from "./storage-values.mjs";
import { scopedSuppression } from "./suppressions.mjs";

/** @import { ContextEvidenceRow, ContextReadFields, ContextReadStore, ContextReadIntent, Scope, UnitOfWork } from "@cairn-ink/core/ports" */
/** @import { Connection, Port } from "./storage-values.mjs" */
/** @import { SessionHasher } from "./suppressions.mjs" */
/** @import { ReceiptProjector, ReceiptReadSafety } from "./inspect.mjs" */
/** @import { Policy } from "./receipt-read-safety.mjs" */
/** @typedef {Extract<ContextEvidenceRow, {type: "memory"}>} Evidence */
/** @typedef {Evidence["receipts"][number]} EvidenceReceipt */

const RECEIPT_LIMIT = 16;

/** @param {Connection} db @param {Scope} scope @param {string} id @param {ContextReadIntent} intent
 * @param {ReturnType<typeof scopedSuppression>} policy @returns {ContextEvidenceRow | null}
 */
function cardEvidence(db, scope, id, intent, policy) {
  const row = readCardRow(db, scope, id);
  if (row?.state !== "active") return null;
  const triggerMemoryRefs = readCardLinks(db, scope, id).flatMap(({ id, revision }) => {
    const entry = readEntry(db, scope, id);
    return entry && (intent === "history" || !entry.row.historical) && !policy.hides(entry)
      ? [{ type: /** @type {const} */ ("memory"), scope, id, revision }] : [];
  });
  return { type: "card", lineageStamp: null, item: {
    type: "card", ref: { type: "card", scope, id, revision: Number(row.revision), bodyRevision: Number(row.body_revision) },
    title: String(row.title), body: String(row.body),
    origin: row.origin === "import" || row.origin === "manual" ? row.origin : "router", state: "active",
    triggerMemoryRefs, bindings: [], support: {}, qualification: {}, provenance: {},
  } };
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
 * @param {string} storeKey @param {() => number} monotonicMs @param {ContextReadStore["raw"]} [raw]
 * @param {ContextReadStore["documentCardAmendmentSource"]} [documentCardAmendmentSource] @returns {ContextReadStore}
 */
export function createContextReadStore(uow, port, hashSession, receiptReadSafety, identity, index, storeKey, monotonicMs, raw,
  documentCardAmendmentSource) {
  const cards = Boolean(documentCardAmendmentSource);
  return {
    maintenanceAvailable: true,
    identity,
    ...(raw && { raw }),
    ...(documentCardAmendmentSource && { documentCardAmendmentSource }),
    async prepareLexical(readSet, selection, options) {
      return uow.run(readSet.owner, {}, async tx => {
        const stopped = contextDeadline(options, monotonicMs);
        const metrics = await port(tx, readSet.owner, { write: true }, db => {
          const epochs = contextEpochs(db, readSet);
          const metrics = index.reconcile(db, readSet, selection, epochs, stopped);
          if (raw) reconcileRawInventory(db, readSet, epochs, storeKey, stopped);
          return metrics;
        });
        if (!cards || !selection.types.includes("card")) return metrics;
        const deadline = options.deadlineAtMs ?? Infinity;
        const remaining = Math.max(0, deadline - monotonicMs());
        const bounded = Number.isFinite(deadline) && selection.types.includes("memory");
        // After rebuilding memories, give cards at most a third of the time left.
        // The shared transaction still has to commit before search and delivery.
        const reserve = bounded ? remaining * 2 / 3 : Math.min(250, remaining / 2);
        const cardStopped = contextDeadline({ ...options, deadlineAtMs: deadline - reserve }, monotonicMs);
        const cardMetrics = await index.reconcileCards(tx, readSet, selection, cardStopped, bounded);
        return {
          canonicalRows: metrics.canonicalRows + cardMetrics.canonicalRows,
          sidecarRows: metrics.sidecarRows + cardMetrics.sidecarRows,
          textRows: metrics.textRows + cardMetrics.textRows,
          textUnits: metrics.textUnits + cardMetrics.textUnits,
          transformed: metrics.transformed + cardMetrics.transformed,
          removed: metrics.removed + cardMetrics.removed,
        };
      });
    },
    observeIndex: index.observeIndex,
    lexical: index.lexical,
    async snapshotState(tx, readSet, types) {
      // Namespace epochs cover stored evidence and scoped suppression changes.
      // Evidence fences recheck receipt safety, and Raw revalidates its own witness.
      return port(tx, readSet.owner, {}, db => {
        const generations = types.includes("card") ? namespaceCardGenerations(db, readSet) : undefined;
        return namespaceEpochs(db, readSet).map((memory, i) => ({
          memory, ...(generations && { card: generations[i] }),
        }));
      });
    },
    async evidence(tx, readSet, refs, intent) {
      return port(tx, readSet.owner, {}, db => {
        /** @param {Scope} scope */
        const inScope = scope => scope.owner === readSet.owner && readSet.namespaces.includes(scope.namespace);
        if (refs.some(({ type, scope }) => (!cards || type !== "card") && !inScope(scope))) {
          throw new CoreError("authority_required");
        }
        /** @type {Map<Scope["namespace"], ReturnType<typeof scopedSuppression>>} */
        const policies = new Map();
        /** @param {Scope} scope */
        function policyFor(scope) {
          let policy = policies.get(scope.namespace);
          if (!policy) {
            policy = scopedSuppression(db, scope, hashSession);
            policies.set(scope.namespace, policy);
          }
          return policy;
        }
        return refs.map(ref => {
          const { scope, id, type } = ref;
          if (type === "card") return cards && inScope(scope) ? cardEvidence(db, scope, id, intent, policyFor(scope)) : null;
          const entry = type === "memory" ? readEntry(db, scope, id) : undefined;
          if (!entry || (intent === "current" && entry.row.historical)) return null;
          const policy = policyFor(scope);
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
