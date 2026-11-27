import { CoreError } from "@cairn-ink/core";
import { cardProjectionKey } from "./context-lexical.mjs";
import { contextDeadline, contextEpochs, namespaceCardGenerations, namespaceEpochs } from "./context-read-state.mjs";
import { addressReceipt, exactReceiptTurn, reconcileRawInventory, withRawEvidence } from "./context-raw-read.mjs";
import { readCardLinks, readCardRow } from "./document-card-rows.mjs";
import { anchorsVisible, receiptProjector, storedEvidence } from "./inspect.mjs";
import { decodeJson, readEntry } from "./memory-rows.mjs";
import { readRawRow } from "./raw-rows.mjs";
import { scopeKey } from "./storage-values.mjs";
import { scopedSuppression } from "./suppressions.mjs";

/** @import { ContextEvidenceRow, ContextReadFields, ContextReadStore, ContextReadIntent, ContextReadSet,
 * Scope, Tx, UnitOfWork } from "@cairn-ink/core/ports" */
/** @import { Connection, Port } from "./storage-values.mjs" */
/** @import { SessionHasher } from "./suppressions.mjs" */
/** @import { ReceiptProjector, ReceiptReadSafety } from "./inspect.mjs" */
/** @import { Policy } from "./receipt-read-safety.mjs" */
/** @typedef {Extract<ContextEvidenceRow, {type: "memory"}>} Evidence */
/** @typedef {Evidence["receipts"][number]} EvidenceReceipt */

const RECEIPT_LIMIT = 16;
const CARD_STARVATION_READS = 2;
const DELIVERY_RESERVE_MS = 50;
const CARD_COMMIT_RESERVE_MS = 100;
const MIN_CARD_ALLOWANCE_MS = 20;

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
 * @param {ContextReadStore["documentCardAmendmentSource"]} [documentCardAmendmentSource]
 */
export function createContextReadStore(uow, port, hashSession, receiptReadSafety, identity, index, storeKey, monotonicMs, raw,
  documentCardAmendmentSource) {
  const cards = Boolean(documentCardAmendmentSource);
  /** @type {Map<string, number>} */
  const skippedCardPasses = new Map();
  /** @type {Map<string, Promise<unknown>>} */
  const cardPasses = new Map();
  /** @typedef {{ start: () => void, signal: AbortSignal | undefined }} DeferredPass */
  /** @type {WeakMap<ContextReadSet, DeferredPass>} */
  const deferredPasses = new WeakMap();
  /** @type {WeakMap<Tx, { pass: DeferredPass, assembly: boolean }>} */
  const rankedPasses = new WeakMap();
  /** @type {Set<() => void>} */
  const scheduled = new Set();
  let memoryCommitMs = 0, cardCommitMs = 0, closing = false;
  const noCardWrite = new Error();

  /** @param {() => void} work @param {number} delay */
  function schedule(work, delay) {
    const signal = AbortSignal.timeout(Math.min(0x7fffffff, Math.ceil(delay)));
    function cancel() {
      scheduled.delete(run);
      signal.removeEventListener("abort", run);
    }
    function run() {
      cancel();
      work();
    }
    scheduled.add(run);
    signal.addEventListener("abort", run, { once: true });
    return cancel;
  }

  const nextTurn = () => closing ? Promise.resolve() : new Promise(resolve => schedule(() => resolve(undefined), 0));

  /** @type {ContextReadStore} */
  const store = {
    maintenanceAvailable: true,
    identity,
    ...(raw && { raw }),
    ...(documentCardAmendmentSource && { documentCardAmendmentSource }),
    async prepareLexical(readSet, selection, options) {
      const upkeepCards = cards && selection.types.includes("card");
      const deadline = options.deadlineAtMs ?? Infinity;
      const mixed = upkeepCards && selection.types.includes("memory");
      const bounded = mixed && Number.isFinite(deadline);
      const empty = { canonicalRows: 0, sidecarRows: 0, textRows: 0, textUnits: 0, transformed: 0, removed: 0 };
      const stopped = contextDeadline(options, monotonicMs);
      const memoryReady = bounded && !raw && await uow.run(readSet.owner, { readOnly: true }, tx =>
        port(tx, readSet.owner, {}, db => index.memoryReady(db, readSet, selection)));
      let beforeCommit = 0;
      const metrics = memoryReady ? empty : await uow.run(readSet.owner, {}, async tx => {
        const result = await port(tx, readSet.owner, { write: true }, db => {
          const epochs = contextEpochs(db, readSet);
          const metrics = index.reconcile(db, readSet, selection, epochs, stopped);
          if (raw) reconcileRawInventory(db, readSet, epochs, storeKey, stopped);
          return metrics;
        });
        if (bounded) beforeCommit = monotonicMs();
        return result;
      });
      if (!upkeepCards || options.signal?.aborted || closing) return metrics;
      if (bounded && !memoryReady) memoryCommitMs = monotonicMs() - beforeCommit;

      const key = cardProjectionKey(readSet, selection);
      if (mixed && cardPasses.has(key)) return metrics;
      const started = monotonicMs(), remaining = deadline - started;
      // A recent writer commit can consume more than the scan itself.
      const reserve = Math.max(memoryCommitMs, cardCommitMs, CARD_COMMIT_RESERVE_MS) + DELIVERY_RESERVE_MS;
      const allowance = bounded ? Math.min(remaining / 3, remaining - reserve) : remaining - Math.min(250, remaining / 2);
      const force = bounded && (skippedCardPasses.get(key) ?? 0) >= CARD_STARVATION_READS;
      if (bounded && !force && allowance < MIN_CARD_ALLOWANCE_MS) {
        skippedCardPasses.set(key, (skippedCardPasses.get(key) ?? 0) + 1);
        return metrics;
      }

      let detached = false;
      /** @type {(() => void) | undefined} */
      let deliver;
      const handoff = new Promise(resolve => { deliver = () => resolve(undefined); });
      /** @type {Promise<void> | undefined} */
      let afterDelivery;
      function detach() {
        if (detached) return;
        detached = true;
        afterDelivery = new Promise(resolve => {
          const start = () => {
            cancelFallback();
            resolve();
          };
          // The request may stop before reaching rank. Bound how long an
          // already completed checkpoint can wait for that acknowledgement.
          const untilDeadline = Math.max(0, deadline - monotonicMs());
          const cancelFallback = schedule(start, untilDeadline + DELIVERY_RESERVE_MS);
          deferredPasses.set(readSet, { signal: options.signal, start });
          if (closing) start();
        });
        deliver?.();
      }
      const cardStopped = contextDeadline({ ...options, deadlineAtMs: started + allowance }, monotonicMs);
      const finish = async () => {
        let alreadyReady = false;
        try {
          const result = await uow.run(readSet.owner, {}, async tx => {
            const result = await index.reconcileCards(tx, readSet, selection,
              force ? () => false : () => detached || cardStopped(), bounded, force);
            if (result == null) {
              alreadyReady = result === null;
              throw noCardWrite;
            }
            if (bounded && !force && (detached || monotonicMs() >= deadline - reserve)) {
              detach();
              await afterDelivery;
              await nextTurn();
            }
            if (bounded) beforeCommit = monotonicMs();
            return result;
          });
          if (bounded) cardCommitMs = monotonicMs() - beforeCommit;
          skippedCardPasses.delete(key);
          return result;
        } catch (error) {
          if (!mixed && error !== noCardWrite) throw error;
          if (alreadyReady) skippedCardPasses.delete(key);
          else if (bounded) {
            skippedCardPasses.set(key, Math.min(CARD_STARVATION_READS, (skippedCardPasses.get(key) ?? 0) + 1));
          }
        }
      };
      if (force) {
        deferredPasses.set(readSet, { signal: options.signal, start() {
          if (closing || cardPasses.has(key)) return;
          skippedCardPasses.delete(key);
          const pass = nextTurn().then(finish).finally(() => cardPasses.delete(key));
          cardPasses.set(key, pass);
        } });
        return metrics;
      }
      const pass = mixed ? finish().finally(() => cardPasses.delete(key)) : finish();
      if (mixed) cardPasses.set(key, pass);

      const cancelTimeout = bounded ? schedule(detach, Math.max(0, remaining - DELIVERY_RESERVE_MS)) : undefined;
      try {
        const cardMetrics = await Promise.race([pass, handoff]);
        if (!cardMetrics) return metrics;
        return {
          canonicalRows: metrics.canonicalRows + cardMetrics.canonicalRows,
          sidecarRows: metrics.sidecarRows + cardMetrics.sidecarRows,
          textRows: metrics.textRows + cardMetrics.textRows,
          textUnits: metrics.textUnits + cardMetrics.textUnits,
          transformed: metrics.transformed + cardMetrics.transformed,
          removed: metrics.removed + cardMetrics.removed,
        };
      } finally {
        cancelTimeout?.();
      }
    },
    observeIndex(tx, readSet, selection) {
      const pass = deferredPasses.get(readSet);
      if (pass) {
        deferredPasses.delete(readSet);
        rankedPasses.set(tx, { pass, assembly: false });
      }
      return index.observeIndex(tx, readSet, selection);
    },
    lexical: index.lexical,
    async snapshotState(tx, readSet, types) {
      const pending = rankedPasses.get(tx);
      if (pending) pending.assembly = true;
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
  return {
    store,
    /** @param {Tx} tx */
    afterRead(tx) {
      const pending = rankedPasses.get(tx);
      if (!pending) return;
      const { assembly, pass: { signal, start } } = pending;
      // Assembly still needs to pack and seal its result after ranking. Its
      // call signal is closed when delivery has finished.
      if (assembly && signal && !signal.aborted) signal.addEventListener("abort", start, { once: true });
      else start();
    },
    async close() {
      closing = true;
      for (const run of scheduled) run();
      await Promise.allSettled(cardPasses.values());
    },
  };
}
