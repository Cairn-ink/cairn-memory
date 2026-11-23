import { CoreError, factBlocksIncoming, factHidesRow, PRIVACY_REDACTION_VERSIONS } from "@cairn-ink/core";
import { readEmbedding, snapshotArray } from "./validation.mjs";

/** @import { FactMatchIncoming, FactMatchPolicy, FactMatchRow, StoredFact, SuppressionFact, TextDigest, TextFact } from "@cairn-ink/core" */
/** @import { DuplicateQuery, Scope, SourceRef, SuppressionStore } from "@cairn-ink/core/ports" */
/** @import { Entry, State } from "./unit-of-work.mjs" */
/** @import { CanonicalQuery } from "./validation.mjs" */

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

/** @param {object} input @param {PropertyKey} key */
function evidenceDescriptor(input, key) {
  try {
    return Object.getOwnPropertyDescriptor(input, key);
  } catch {
    // Core rejects accessor descriptors without calling them.
    return { get: () => undefined };
  }
}

/** @template T @param {T} value @returns {T} */
function snapshotPassageList(value) {
  // Core handles non-array evidence using its existing fail-closed matching rules.
  try {
    return Array.isArray(value) ? /** @type {T} */ (snapshotArray(value)) : value;
  } catch {
    throw new CoreError("invalid_input");
  }
}

/** @param {FactMatchIncoming["passages"]} passages @returns {FactMatchIncoming["passages"]} */
function projectPassages(passages) {
  const copy = snapshotPassageList(passages);
  if (!Array.isArray(copy)) return copy;
  return copy.map((passage) => {
    if (passage != null && typeof passage === "object") {
      let isRecord;
      try {
        isRecord = !Array.isArray(passage);
      } catch {
        isRecord = false;
      }
      if (isRecord) {
        // Preserve descriptor-based validation of every other field in core.
        const record = {};
        for (const key of ["digests", "shingles", "keyId", "embedding"]) {
          const field = evidenceDescriptor(passage, key);
          if (!field) continue;
          if (key === "embedding" && field.value != null) field.value = readEmbedding(field.value, "passage");
          if (key === "digests" || key === "shingles") {
            if (Object.hasOwn(field, "value")) field.value = snapshotPassageList(field.value);
          }
          Object.defineProperty(record, key, field);
        }
        return record;
      }
    }
    return passage;
  });
}

/** @param {Parameters<SuppressionStore["snapshot"]>[2]} candidates */
export function copySuppressionCandidates({ client, sessionId, occurredAtMs, passages }) {
  return {
    client, sessionId,
    passages: passages === undefined ? undefined : projectPassages(passages),
    occurredAtMs: occurredAtMs == null ? occurredAtMs : snapshotArray(occurredAtMs),
  };
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
        digests: digestsFor(row), embedding: row.embedding?.vector,
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

    /** @param {string} client @param {string | undefined} sessionId
     * @param {ReadonlyArray<number | null>} occurredAtMs
     */
    function blockedMessages(client, sessionId, occurredAtMs) {
      const blocked = [];
      const windows = scoped.filter((stored) => isKind(stored, "window"));
      // Core's window comparison reads the client and time, including for messages without a session ID.
      const session = { client, sessionId: sessionId ?? "" };
      for (const [index, time] of occurredAtMs.entries()) {
        if (windows.some((stored) => factBlocksIncoming(stored,
          { scope, passages: [], session, occurredAtMs: time }, capture) !== false)) {
          blocked.push(index);
        }
      }
      return blocked;
    }

    return {
      /** @param {Entry} entry */
      hides(entry) {
        return scoped.length > 0 && scoped.some(rowMatcher(entry));
      },

      /** @param {CanonicalQuery} query @param {"hash" | "full"} mode
       * @param {FactMatchIncoming["sourceMemory"]} sourceMemory
       */
      blocks(query, mode, sourceMemory) {
        if (texts.length === 0) return false;
        const passages = [{ digests: digestsFor(query), shingles: null, keyId: null, embedding: query.embedding }];
        return texts.some((stored) => factBlocksIncoming(stored, { scope, passages, sourceMemory },
          { ...policy, mode: mode === "hash" ? "explicitSave" : "capture" }) !== false);
      },

      blocksSession,
      blockedMessages,

      /** @param {ReturnType<typeof copySuppressionCandidates>} candidates */
      snapshot({ client, sessionId, occurredAtMs, passages: projected }) {
        return {
          blockedSession: blocksSession(client ?? null, sessionId ?? null),
          blockedMessages: client != null && occurredAtMs ? blockedMessages(client, sessionId, occurredAtMs) : [],
          passages: structuredClone(projected === undefined ? texts : matchingPassages(texts, projected)),
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
      const incoming = { scope, passages };
      return stored.filter((fact) => factBlocksIncoming(fact, incoming, capture) !== false);
    }
  };
}
