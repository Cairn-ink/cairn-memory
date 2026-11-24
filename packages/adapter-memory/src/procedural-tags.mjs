import { CoreError } from "@cairn-ink/core";
import { sha256Hex } from "../../core/src/privacy/fingerprint.mjs";
import { validateMemoryId, writeNamespace } from "./validation.mjs";

/** @import { ProceduralTagStore } from "@cairn-ink/core/ports" */

/** @param {ReturnType<typeof import("./unit-of-work.mjs").createUnitOfWork>["port"]} port
 * @param {ReturnType<typeof import("./fact-match.mjs").createFactMatcher>} matchFacts
 * @param {ReturnType<typeof import("./receipt-read-safety.mjs").createReceiptReadSafety>["receiptReadSafety"]} receiptReadSafety
 * @returns {ProceduralTagStore}
 */
export function createProceduralTagStore(port, matchFacts, receiptReadSafety) {
  return {
    async write(tx, scope, id, tag) {
      return port.write(tx, scope, true, () => {
        validateMemoryId(id);
        const namespace = writeNamespace(scope);
        const incoming = structuredClone(tag);
        return async getState => {
          const entry = getState().rows.get(namespace)?.get(id);
          if (!entry) throw new CoreError("memory_not_found");
          if (incoming.positive && entry.row.kind !== "instruction" && entry.row.kind !== "preference") {
            throw new CoreError("invalid_input");
          }
          for (const anchor of incoming.anchors) {
            const excerpt = entry.receipts.find(receipt => receipt.id === anchor.receiptId)?.excerpt;
            if (excerpt === undefined || await sha256Hex(excerpt) !== anchor.digest) {
              throw new CoreError("invalid_input");
            }
          }
          entry.proceduralTag = { ...incoming, tagRevision: (entry.proceduralTag?.tagRevision ?? 0) + 1 };
        };
      });
    },

    async clear(tx, scope, id) {
      return port.write(tx, scope, "conditional", () => {
        validateMemoryId(id);
        const namespace = writeNamespace(scope);
        return (getState, markDirty) => {
          const entry = getState().rows.get(namespace)?.get(id);
          if (entry?.proceduralTag?.positive) {
            entry.proceduralTag = { positive: false, origin: null, anchors: [],
              tagRevision: entry.proceduralTag.tagRevision + 1 };
            markDirty();
          }
        };
      });
    },

    async read(tx, scope, id) {
      return port.read(tx, scope, async getState => {
        validateMemoryId(id);
        const namespace = writeNamespace(scope);
        const state = getState();
        const entry = state.rows.get(namespace)?.get(id);
        const policy = matchFacts(state.facts, { owner: tx.owner, namespace });
        const tag = entry?.proceduralTag;
        if (!entry || !tag || policy.hides(entry)) return null;
        for (const { receiptId, digest } of tag.anchors) {
          const receipt = entry.receipts.find(candidate => candidate.id === receiptId);
          const safe = receipt && await receiptReadSafety(state, scope, receipt, entry.receiptKeys?.get(receipt), policy);
          if (!safe || await sha256Hex(safe.excerpt) !== digest) return null;
        }
        return structuredClone(tag);
      });
    },
  };
}
