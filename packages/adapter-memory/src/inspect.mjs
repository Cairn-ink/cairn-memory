import { compareSortKey, compareUtf8, CoreError } from "@cairn-ink/core";
import { advanceInspectEpoch } from "./unit-of-work.mjs";

/** @import { ContextReadFields, InspectItemEvidence, InspectMemoryMetadata, InspectReceipt, InspectStore,
 * Scope, StorageAdapter, StoredDocumentCardRecord } from "@cairn-ink/core/ports" */
/** @import { Entry, State } from "./unit-of-work.mjs" */
/** @typedef {Pick<InspectItemEvidence, "procedural" | "qualification">} StoredInspectEvidence */
/** @typedef {ReturnType<ReturnType<typeof import("./fact-match.mjs").createFactMatcher>>} Policy */

const encoder = new TextEncoder();

/** @param {Pick<StorageAdapter<StoredDocumentCardRecord>, "placement" | "supersession" | "conflicts">} related
 * @param {ReturnType<typeof import("./unit-of-work.mjs").createUnitOfWork>} work
 * @param {ReturnType<typeof import("./fact-match.mjs").createFactMatcher>} matchFacts
 */
export function createInspectStore(related, { port, runSeed }, matchFacts) {
  const storeId = crypto.randomUUID();
  const cursorKey = crypto.getRandomValues(new Uint8Array(32));

  /** @param {State} state @param {Scope} scope @param {number} [expectedEpoch] */
  function epochOf(state, scope, expectedEpoch) {
    const epoch = state.inspectEpochs.get(scope.namespace) ?? 1;
    if (expectedEpoch !== undefined && expectedEpoch !== epoch) throw new CoreError("cursor_stale");
    return epoch;
  }

  /** @param {Entry} entry @param {Policy} policy @returns {(InspectReceipt & { position: number })[]} */
  function visibleReceipts({ receipts, inspectReceipts }, policy) {
    return receipts.flatMap(receipt => {
      const { excerpt, client, sessionId, messageId, role, occurredAtMs } = receipt;
      const stored = inspectReceipts?.get(receipt);
      if (!stored || excerpt === undefined || policy.blockedMessages(client, sessionId, [occurredAtMs]).length) return [];
      return [{ ...stored, excerpt, client, sessionId, messageId, eventId: messageId, role, occurredAtMs }];
    });
  }

  /** @param {State} state @param {Entry} entry @param {number} receiptCount @returns {InspectMemoryMetadata} */
  function metadata(state, { row }, receiptCount) {
    const { id, scope, kind, origin, confidence, revision, historical, createdAtMs, updatedAtMs } = row;
    const outcome = state.topics.get(scope.namespace)?.outcomes.get(id);
    const filed = !historical && outcome?.revision === revision && outcome.memberships.size > 0;
    return { id, scope: { ...scope }, kind, origin, confidence, revision, state: historical ? "historical" : "active",
      filing: { status: filed ? "filed" : "unfiled" }, receiptCount, createdAtMs, updatedAtMs };
  }

  /** @param {unknown} anchors @param {readonly InspectReceipt[]} receipts */
  async function anchorsVisible(anchors, receipts) {
    if (!Array.isArray(anchors) || anchors.length > 4) return false;
    for (const anchor of anchors) {
      if (!anchor || typeof anchor.receiptId !== "string") return false;
      const excerpt = receipts.find(receipt => receipt.id === anchor.receiptId)?.excerpt;
      if (excerpt === undefined || !Number.isInteger(anchor.start) || !Number.isInteger(anchor.end) ||
          anchor.start < 0 || anchor.start >= anchor.end || anchor.end > excerpt.length) return false;
      const span = excerpt.slice(anchor.start, anchor.end);
      if (/[\uD800-\uDFFF]/u.test(span) || (anchor.text !== undefined && span !== anchor.text)) return false;
      const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(excerpt)));
      const digest = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
      if (digest !== (anchor.receiptDigest ?? anchor.digest)) return false;
    }
    return true;
  }

  /** @type {InspectStore} */
  const inspect = {
    async identity(tx) {
      return port(tx, { owner: tx.owner }, false, () => ({ storeId, cursorKey: cursorKey.slice() }));
    },

    async list(tx, scope, { states, limit, after, expectedEpoch }) {
      return port(tx, scope, false, state => {
        const epoch = epochOf(state, scope, expectedEpoch);
        const policy = matchFacts(state.facts, scope);
        const entries = Array.from(state.rows.get(scope.namespace)?.values() ?? []);
        const rows = entries.filter(entry => {
          const { row } = entry;
          return states.includes(row.historical ? "historical" : "active") &&
            (!after || row.updatedAtUs < after.updatedAtUs ||
              row.updatedAtUs === after.updatedAtUs && compareUtf8(row.id, after.id) > 0) && !policy.hides(entry);
        }).sort(({ row: a }, { row: b }) => compareSortKey(b.updatedAtUs, a.updatedAtUs) || compareUtf8(a.id, b.id));
        return {
          epoch,
          rows: rows.slice(0, limit + 1).map(entry => ({
            ...metadata(state, entry, visibleReceipts(entry, policy).length),
            updatedAtUs: entry.row.updatedAtUs,
          })),
        };
      });
    },

    async item(tx, scope, memoryId, { limit, after, expectedEpoch, includeQualification }) {
      const snapshot = await port(tx, scope, false, state => {
        const epoch = epochOf(state, scope, expectedEpoch);
        const entry = state.rows.get(scope.namespace)?.get(memoryId);
        const policy = matchFacts(state.facts, scope);
        if (!entry || policy.hides(entry)) return { epoch, item: null, nextAnchor: null };
        const retained = visibleReceipts(entry, policy);
        retained.sort((a, b) => a.createdAtMs - b.createdAtMs || compareUtf8(a.id, b.id));

        let offset = 0;
        if (after) {
          const index = retained.findIndex(receipt => "row" in after ? receipt.position === after.row :
            receipt.id === after.id && BigInt(receipt.createdAtMs) * 1000n === (after.createdAtUs ?? BigInt(after.createdAtMs) * 1000n));
          if (index === -1) throw new CoreError("cursor_stale");
          offset = index + 1;
        }
        const page = retained.slice(offset, offset + limit + 1);
        const nextAnchor = page.length > limit ? { row: page[limit - 1].position } : null;
        const receipts = page.slice(0, limit).map(({ position: _position, ...receipt }) => receipt);
        const memory = { ...metadata(state, entry, retained.length), text: entry.row.text };
        return { epoch, nextAnchor, item: { memory, receipts }, retained,
          evidence: structuredClone(entry.inspectEvidence) };
      });
      if (!snapshot.item) return { epoch: snapshot.epoch, item: null, nextAnchor: null };
      const { epoch, nextAnchor, item, evidence, retained } = snapshot;
      const placements = (await related.placement?.forMemory(tx, scope, memoryId) ?? []).map(id => ({ id }));
      const conflicts = (await related.conflicts?.list(tx, scope, memoryId) ?? []).map(edge => ({ ...edge }));
      const qualification = includeQualification && evidence?.qualification &&
        await anchorsVisible(evidence.qualification.anchors, retained) ? evidence.qualification : null;
      const procedural = evidence?.procedural && await anchorsVisible(evidence.procedural.anchors, retained)
        ? evidence.procedural : undefined;

      /** @type {ContextReadFields | undefined} */
      let supersession;
      if (item.memory.state === "historical") {
        const links = await related.supersession?.read(tx, scope, memoryId);
        supersession = await port(tx, scope, false, state => {
          const link = state.relations.get(scope.namespace)?.supersessions.get(memoryId);
          const replacement = links?.supersededBy && state.rows.get(scope.namespace)?.get(links.supersededBy);
          if (!link || !replacement || replacement.row.revision < link.replacement.revision) {
            return { previousRevision: link?.previous.revision ?? null, replacement: null, receiptIds: [], evidenceAvailable: false };
          }
          const policy = matchFacts(state.facts, scope);
          const visibleIds = new Set(visibleReceipts(replacement, policy).map(receipt => receipt.id));
          const receiptIds = link.receiptIds.filter(id => visibleIds.has(id));
          return {
            previousRevision: link.previous.revision,
            replacement: { memoryId: replacement.row.id, revision: link.replacement.revision,
              currentRevision: replacement.row.revision, state: replacement.row.historical ? "historical" : "active" },
            receiptIds, evidenceAvailable: receiptIds.length > 0 && receiptIds.length === link.receiptIds.length,
          };
        });
      }
      return {
        epoch, nextAnchor,
        item: { ...item, placements, conflicts, ...(includeQualification && { qualification }),
          ...(procedural && { procedural }), ...(supersession && { supersession }) },
      };
    },
  };

  /** @param {Scope} scope @param {string} id @param {StoredInspectEvidence} evidence */
  async function seedInspectEvidence(scope, id, evidence) {
    const stored = structuredClone(evidence);
    await runSeed(scope.owner, tx => port(tx, scope, true, state => {
      const entry = state.rows.get(scope.namespace)?.get(id);
      if (!entry) throw new CoreError("memory_not_found");
      entry.inspectEvidence = stored;
      advanceInspectEpoch(state, scope.namespace);
    }));
  }

  return { inspect, seedInspectEvidence };
}
