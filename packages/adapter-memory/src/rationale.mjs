import {
  allDigests, compareUtf8, coreDigest, coreFingerprintLabels, CoreError, cutRationaleText,
  factBlocksIncoming, passageShingles, RATIONALE_LIMITS,
} from "@cairn-ink/core";
import { addKeyedDigest } from "./privacy.mjs";
import { snapshotArray, validateLimit, validateMemoryId, writeNamespace } from "./validation.mjs";

/** @import { Namespace, RationaleAnchor, RationaleEdge, RationaleEdgeStore, RationaleGuard,
 * Receipt, Scope, Tx } from "@cairn-ink/core/ports" */
/** @import { FingerprintKey, StoredFact } from "@cairn-ink/core" */
/** @import { State } from "./unit-of-work.mjs" */
/** @typedef {ReturnType<typeof import("./unit-of-work.mjs").createUnitOfWork>["port"]} Port */

/** @param {Pick<Receipt, "client" | "sessionId" | "messageId">} receipt */
export function sourceMessageKey({ client, sessionId, messageId }) {
  return JSON.stringify([client, sessionId, messageId]);
}

/** @param {string} key */
async function receiptId(key) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** @param {RationaleEdge} edge */
function edgeKey({ from, to, relation }) {
  return [from.id, to.id, relation, from.receiptId, to.receiptId];
}

/** @param {RationaleEdge} edge @param {string} id */
const incident = ({ from, to }, id) => from.id === id || to.id === id;

/** @param {RationaleEdge} a @param {RationaleEdge} b */
function edgeOrder(a, b) {
  const left = edgeKey(a);
  const right = edgeKey(b);
  for (let i = 0; i < left.length; i++) {
    const order = compareUtf8(left[i], right[i]);
    if (order) return order;
  }
  return 0;
}

/** @param {State} state @param {Namespace} namespace @param {string} id */
export function invalidateRationale(state, namespace, id) {
  const edges = state.rationale.get(namespace);
  let deleted = 0;
  if (edges) {
    for (const [key, row] of edges) {
      if (incident(row, id)) deleted += Number(edges.delete(key));
    }
    if (!edges.size) state.rationale.delete(namespace);
  }
  return deleted;
}

/** @param {State} state @param {Namespace} namespace
 * @param {readonly Pick<Receipt, "client" | "sessionId" | "messageId">[]} messages
 */
export async function invalidateRationaleSources(state, namespace, messages) {
  const edges = state.rationale.get(namespace);
  if (!edges?.size || !messages.length) return;
  const ids = new Set(await Promise.all(messages.map(message => receiptId(sourceMessageKey(message)))));
  for (const [key, { from, to }] of edges) {
    if (ids.has(from.receiptId) || ids.has(to.receiptId)) edges.delete(key);
  }
  if (!edges.size) state.rationale.delete(namespace);
}

/** @param {Scope} scope @param {readonly StoredFact[]} facts
 * @param {string} excerpt @param {readonly FingerprintKey[]} keys
 */
async function withholdsExcerpt(scope, facts, excerpt, keys) {
  const digests = await allDigests(excerpt, null);
  for (const keyed of await Promise.all(keys.map(key => coreDigest(excerpt, key)))) {
    addKeyedDigest(digests, keyed);
  }
  /** @type {Map<string, string[]>} */
  const shingleCache = new Map();
  for (const stored of facts) {
    const { fact } = stored;
    if (fact.kind !== "text") continue;
    // A digest miss alone cannot clear an excerpt for rationale.
    if (fact.mode !== "full" || !fact.text.shingles?.length) return true;
    const key = keys.find(key => key.id === fact.text.keyId);
    if (!key) return true;
    let shingles = shingleCache.get(key.id);
    if (!shingles) {
      shingles = await passageShingles(excerpt, key, coreFingerprintLabels);
      shingleCache.set(key.id, shingles);
    }
    if (!shingles.length) return true;
    const passage = { digests, keyId: key.id, shingles };
    if (factBlocksIncoming(stored, { scope, passages: [passage] }, { mode: "capture" }) !== false) return true;
  }
  return false;
}

/** @param {RationaleAnchor} anchor */
function validateAnchor(anchor) {
  if (!anchor) throw new CoreError("invalid_input");
  validateMemoryId(anchor.id);
  if (!Number.isSafeInteger(anchor.revision) || anchor.revision < 1 ||
      typeof anchor.receiptId !== "string" || !/^[a-f0-9]{64}$/u.test(anchor.receiptId) ||
      typeof anchor.digest !== "string" || !/^[a-f0-9]{64}$/u.test(anchor.digest)) {
    throw new CoreError("invalid_input");
  }
}

/**
 * @param {Port} port
 * @param {ReturnType<typeof import("./fact-match.mjs").createFactMatcher>} matchFacts
 * @param {import("./privacy.mjs").RingKeys} ringKeys
 * @param {ReturnType<typeof import("./raw.mjs").createRawPorts>["findVisibleSource"]} [findVisibleSource]
 */
export function createRationaleStore(port, matchFacts, ringKeys, findVisibleSource) {
  /** @param {Tx} tx @param {Scope} scope @param {readonly RationaleGuard[]} refs */
  function readSources(tx, scope, refs) {
    return port.read(tx, scope, async getState => {
      const namespace = writeNamespace(scope);
      if (!Array.isArray(refs) || !refs.length || refs.length > RATIONALE_LIMITS.refs) throw new CoreError("invalid_input");
      const guards = snapshotArray(refs).map(ref => {
        if (!ref) throw new CoreError("invalid_input");
        const { memoryId, revision } = ref;
        validateMemoryId(memoryId);
        if (!Number.isSafeInteger(revision) || revision < 1) throw new CoreError("invalid_input");
        return { memoryId, revision };
      });
      if (new Set(guards.map(({ memoryId }) => memoryId)).size !== guards.length) throw new CoreError("invalid_input");
      const state = getState();
      const entries = state.rows.get(namespace);
      const messages = state.rationaleMessages.get(namespace);
      const target = { owner: tx.owner, namespace };
      const policy = matchFacts(state.facts, target);
      const textFacts = [...state.facts.values()].filter(({ fact }) =>
        fact.kind === "text" && fact.owner === target.owner && (fact.namespace ?? null) === namespace);
      const keys = !findVisibleSource || textFacts.length ? await ringKeys(tx.owner).catch(error => {
        if (textFacts.length) throw new CoreError("revision_conflict");
        throw error;
      }) : [];
      /** @param {string} text */
      const checkExcerpt = async text => {
        const excerpt = cutRationaleText(text, RATIONALE_LIMITS.excerptUnits);
        if (textFacts.length && await withholdsExcerpt(target, textFacts, excerpt, keys).catch(() => true)) {
          throw new CoreError("revision_conflict");
        }
        return excerpt;
      };
      return Promise.all(guards.map(async ({ memoryId, revision }) => {
        const entry = entries?.get(memoryId);
        if (!entry || entry.row.historical) throw new CoreError("memory_not_found");
        if (entry.row.revision !== revision || policy.hides(entry) || !entry.receipts.length) {
          throw new CoreError("revision_conflict");
        }
        if (entry.receipts.length > RATIONALE_LIMITS.receipts) throw new CoreError("context_item_too_large");
        const receipts = await Promise.all(entry.receipts.map(async receipt => {
          const key = sourceMessageKey(receipt);
          if (findVisibleSource) {
            const raw = await findVisibleSource(state, target, receipt);
            if (!raw || raw.role !== receipt.role || raw.occurredAtMs !== receipt.occurredAtMs) {
              throw new CoreError("revision_conflict");
            }
            const excerpt = await checkExcerpt(raw.content);
            return { id: await receiptId(key), role: raw.role, text: raw.content, excerpt };
          }
          // Synthetic sources exist for adapters opened without Raw.
          const message = messages?.get(key);
          if (!message || message.role !== receipt.role || message.occurredAtMs !== receipt.occurredAtMs) {
            throw new CoreError("revision_conflict");
          }
          const { text } = message;
          const digests = await allDigests(text, keys[0]);
          for (const keyed of await Promise.all(keys.slice(1).map(key => coreDigest(text, key)))) {
            addKeyedDigest(digests, keyed);
          }
          if (policy.withholdsRaw(receipt, digests)) throw new CoreError("revision_conflict");
          const excerpt = await checkExcerpt(text);
          return { id: await receiptId(key), role: message.role, text, excerpt };
        }));
        return { memory: { id: memoryId, revision }, receipts };
      }));
    });
  }

  /** @type {RationaleEdgeStore} */
  const rationale = {
    async sourceEvidence(tx, scope, refs) {
      return (await readSources(tx, scope, refs)).map(({ memory, receipts }) => ({
        memory, receipts: receipts.map(({ id, role, excerpt }) => ({ id, role, excerpt })),
      }));
    },

    async insert(tx, scope, edge) {
      return port.write(tx, scope, "conditional", () => {
        const { from, to, relation } = structuredClone(edge);
        validateAnchor(from);
        validateAnchor(to);
        if ((relation !== "supports-decision" && relation !== "challenges-premise") ||
            (from.id === to.id && relation !== "supports-decision")) throw new CoreError("invalid_input");
        const namespace = writeNamespace(scope);
        const row = { from, to, relation };
        const key = JSON.stringify(edgeKey(row));
        return async (getState, markDirty) => {
          const state = getState();
          const entries = state.rows.get(namespace);
          for (const { id, revision, receiptId: idOfReceipt } of [from, to]) {
            const entry = entries?.get(id);
            if (!entry || entry.row.historical) throw new CoreError("memory_not_found");
            if (entry.row.revision !== revision) throw new CoreError("revision_conflict");
            const ids = await Promise.all(entry.receipts.map(receipt => receiptId(sourceMessageKey(receipt))));
            if (!ids.includes(idOfReceipt)) throw new CoreError("revision_conflict");
          }
          let edges = state.rationale.get(namespace);
          if (edges?.has(key)) return { inserted: false };
          if (!edges) state.rationale.set(namespace, edges = new Map());
          edges.set(key, row);
          markDirty();
          return { inserted: true };
        };
      });
    },

    async degree(tx, scope, memoryId) {
      return port(tx, scope, false, state => {
        validateMemoryId(memoryId);
        return [...(state.rationale.get(writeNamespace(scope))?.values() ?? [])].filter(row => incident(row, memoryId)).length;
      });
    },

    incoming(tx, scope, memoryId, relation, { limit }) {
      return list(tx, scope, memoryId, limit, row => row.to.id === memoryId && row.relation === relation);
    },

    incident(tx, scope, memoryId, { limit }) {
      return list(tx, scope, memoryId, limit, row => incident(row, memoryId));
    },

    async invalidate(tx, scope, memoryId) {
      return port.write(tx, scope, "conditional", () => {
        validateMemoryId(memoryId);
        const namespace = writeNamespace(scope);
        return (getState, markDirty) => {
          const deleted = invalidateRationale(getState(), namespace, memoryId);
          if (deleted) markDirty();
          return { deleted };
        };
      });
    },
  };

  /** @param {Tx} tx @param {Scope} scope @param {string} id @param {number} limit
   * @param {(row: RationaleEdge) => boolean} matches
   */
  function list(tx, scope, id, limit, matches) {
    return port(tx, scope, false, state => {
      validateLimit(limit);
      validateMemoryId(id);
      if (limit > RATIONALE_LIMITS.inspectEdges + 1) throw new CoreError("invalid_input");
      const rows = [...(state.rationale.get(writeNamespace(scope))?.values() ?? [])];
      return structuredClone(rows.filter(matches).sort(edgeOrder).slice(0, limit));
    });
  }

  /** @type {NonNullable<import("@cairn-ink/core/ports").StorageAdapter["rationaleSourceText"]>} */
  async function rationaleSourceText(tx, scope, refs) {
    const sources = await readSources(tx, scope, refs);
    const distinct = new Map(sources.flatMap(({ receipts }) => receipts.map(({ id, text }) => [id, text])));
    return [...distinct.values()];
  }
  return { rationale, rationaleSourceText };
}
