import { factBlocksIncoming, factHidesRow, PRIVACY_REDACTION_VERSIONS } from "@cairn-ink/core";
import { isFloat32Vector } from "./validation.mjs";

/** @import { FactMatchIncoming, FactMatchPolicy, FactMatchRow, StoredFact, SuppressionFact, TextDigest, TextFact } from "@cairn-ink/core" */
/** @import { DuplicateQuery, Scope, SourceRef, SuppressionStore } from "@cairn-ink/core/ports" */
/** @import { Entry, State } from "./unit-of-work.mjs" */

/** @param {string} hash */
function digestValue(hash) {
  return typeof hash === "string" && hash.startsWith("sha256:") ? hash.slice(7) : "";
}

/** @param {Pick<DuplicateQuery, "textHash" | "legacyHash">} candidate @returns {TextDigest[]} */
function digestsFor({ textHash, legacyHash }) {
  /** @type {TextDigest[]} */
  const digests = [{
    alg: "sha256", value: digestValue(textHash), pipeline: "core",
    redactionVersion: PRIVACY_REDACTION_VERSIONS.core, keyId: null,
  }];
  if (legacyHash !== undefined && legacyHash !== textHash) {
    digests.push({
      alg: "sha256", value: digestValue(legacyHash), pipeline: "engine-legacy",
      redactionVersion: PRIVACY_REDACTION_VERSIONS.v1, keyId: null,
    });
  }
  return digests;
}

/** @template T @param {T} embedding */
function projectEmbedding(embedding) {
  return isFloat32Vector(embedding) ? Array.from(Float32Array.prototype.values.call(embedding)) : embedding;
}

/** @param {FactMatchIncoming["passages"]} passages @returns {FactMatchIncoming["passages"]} */
function projectPassages(passages) {
  try {
    if (!Array.isArray(passages)) return passages;
    const slots = Object.getOwnPropertyDescriptors(/** @type {object} */ (passages));
    let changed = false;
    for (const slot of Object.values(slots)) {
      const passage = slot.value;
      if (passage == null || typeof passage !== "object" || Array.isArray(passage)) continue;
      const embedding = Object.getOwnPropertyDescriptor(passage, "embedding");
      const vector = projectEmbedding(embedding?.value);
      if (embedding && vector !== embedding.value) {
        // Preserve the input descriptors so core still rejects accessor-based evidence.
        slot.value = Object.defineProperties({}, {
          ...Object.getOwnPropertyDescriptors(passage),
          embedding: { ...embedding, value: vector },
        });
        changed = true;
      }
    }
    return changed ? Object.defineProperties([], slots) : passages;
  } catch {
    // Let core classify malformed projections using its normal fail-closed rules.
    return passages;
  }
}

/** @template {SuppressionFact["kind"]} K @param {StoredFact} stored @param {K} kind
 * @returns {stored is StoredFact<Extract<SuppressionFact, {kind: K}>>}
 */
function isKind(stored, kind) {
  return stored.fact.kind === kind;
}

/** @param {boolean} vectorSuppression @param {FactMatchPolicy["hashSessionKey"]} [hashSessionKey] */
export function createFactMatcher(vectorSuppression, hashSessionKey) {
  /** @type {FactMatchPolicy} */
  const policy = { vectorSuppression, rowShingles: false, hashSessionKey };
  const capture = /** @type {const} */ ({ ...policy, mode: "capture" });

  /** @param {State["facts"]} facts @param {Scope} scope */
  return function matchFacts(facts, scope) {
    const scoped = [...facts.values()].filter(({ fact }) =>
      fact.owner === scope.owner && (fact.namespace ?? null) === scope.namespace);
    const texts = scoped.filter((stored) => isKind(stored, "text"));
    const sessions = scoped.filter((stored) => isKind(stored, "session"));

    /** @param {Entry} entry */
    function rowMatcher({ row, receipts }) {
      /** @type {FactMatchRow} */
      const candidate = {
        type: "memory", scope, memoryId: row.id, revision: row.revision,
        digests: digestsFor(row), embedding: projectEmbedding(row.embedding?.vector),
      };
      /** @param {StoredFact} stored */
      return (stored) => {
        switch (stored.fact.kind) {
          case "identity":
          case "text":
            return factHidesRow(stored, candidate, policy) !== false;
          case "session":
            return receipts.some(({ client, sessionId, occurredAtMs }) => client &&
              factHidesRow(stored, { ...candidate, source: { client, sessionId, occurredAtMs } }, policy) !== false);
          default:
            return false;
        }
      };
    }

    /** @param {SourceRef["client"]} client @param {SourceRef["sessionId"]} sessionId */
    function blocksSession(client, sessionId) {
      return client != null && sessionId != null && sessions.some((stored) =>
        factBlocksIncoming(stored, { scope, passages: [], session: { client, sessionId } }, capture) !== false);
    }

    return {
      /** @param {Entry} entry */
      hides(entry) {
        return scoped.length > 0 && scoped.some(rowMatcher(entry));
      },

      /** @param {DuplicateQuery} query @param {"hash" | "full"} mode
       * @param {FactMatchIncoming["sourceMemory"]} sourceMemory
       */
      blocks(query, mode, sourceMemory) {
        if (texts.length === 0) return false;
        const embedding = query.embedding == null ? query.embedding : Array.from(query.embedding);
        const passages = [{ digests: digestsFor(query), shingles: null, keyId: null, embedding }];
        return texts.some((stored) => factBlocksIncoming(stored, { scope, passages, sourceMemory },
          { ...policy, mode: mode === "hash" ? "explicitSave" : "capture" }) !== false);
      },

      blocksSession,

      /** @param {Parameters<SuppressionStore["snapshot"]>[2]} candidates */
      snapshot({ client, sessionId, occurredAtMs, passages }) {
        const blockedMessages = [];
        if (client != null && occurredAtMs) {
          const windows = scoped.filter((stored) => isKind(stored, "window"));
          // Core's window comparison reads the client and time, including for messages without a session ID.
          const session = { client, sessionId: sessionId ?? "" };
          for (const [index, time] of occurredAtMs.entries()) {
            if (windows.some((stored) => factBlocksIncoming(stored,
              { scope, passages: [], session, occurredAtMs: time }, capture) !== false)) {
              blockedMessages.push(index);
            }
          }
        }
        return {
          blockedSession: blocksSession(client ?? null, sessionId ?? null),
          blockedMessages,
          passages: structuredClone(passages === undefined ? texts : matchingPassages(texts, passages)),
        };
      },

      /** @param {string} memoryId @param {Entry | undefined} entry */
      factsFor(memoryId, entry) {
        const applicable = entry ? scoped.filter(rowMatcher(entry)) :
          scoped.filter(({ fact }) => fact.kind === "identity" && fact.memoryId === memoryId);
        return structuredClone(applicable);
      },
    };

    /** @param {StoredFact<TextFact>[]} stored @param {FactMatchIncoming["passages"]} passages */
    function matchingPassages(stored, passages) {
      if (stored.length === 0) return [];
      const incoming = { scope, passages: projectPassages(passages) };
      return stored.filter((fact) => factBlocksIncoming(fact, incoming, capture) !== false);
    }
  };
}
