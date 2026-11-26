import { CoreError, factBlocksIncoming, factHidesRow, hasLegacyPassageDigest, PRIVACY_REDACTION_VERSIONS, withholdsAnyPassage } from "@cairn-ink/core";
import { requiresLegacyMacDomain } from "../../core/src/privacy/withholds.mjs";
import { readEmbedding, snapshotArray } from "./validation.mjs";

/** @import { FactMatchIncoming, FactMatchPolicy, FactMatchRow, StoredFact, SuppressionFact, TextDigest, TextFact } from "@cairn-ink/core" */
/** @import { DuplicateQuery, PassageFingerprint, Scope, SourceRef, SuppressionStore } from "@cairn-ink/core/ports" */
/** @import { CardWrite } from "./document-cards.mjs" */
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

/** @param {Pick<DuplicateQuery, "textHash" | "legacyHash" | "digests">} candidate */
function withDigestAliases(candidate) {
  const supplied = candidate.digests ?? [];
  const aliases = digestsFor(candidate).filter((alias) => !supplied.some(({ alg, label, value }) =>
    label === undefined && alg === alias.alg && value === alias.value));
  return [...aliases, ...supplied];
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

/** @param {readonly PassageFingerprint[]} passages @returns {readonly PassageFingerprint[]} */
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
        for (const key of ["digests", "shingles", "keyId", "embedding", "retainedShingles"]) {
          const field = evidenceDescriptor(passage, key);
          if (!field) continue;
          if (key === "embedding" && field.value != null) {
            const embedding = readEmbedding(field.value, "passage");
            field.value = embedding.length === 0 ? undefined : embedding;
          }
          if (key === "digests" || key === "shingles" || key === "retainedShingles") {
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

/** @param {unknown} value */
function hasNoShingleEvidence(value) {
  try {
    if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
    return ["shingles", "keyId", "retainedShingles"].every((key) => {
      const field = evidenceDescriptor(value, key);
      if (field === undefined) return true;
      if (!Object.hasOwn(field, "value")) return false;
      if (key !== "retainedShingles") return field.value == null;
      return field.value === undefined || (Array.isArray(field.value) && field.value.length === 0);
    });
  } catch {
    return false;
  }
}

/** @param {Parameters<SuppressionStore["snapshot"]>[2]} candidates */
export function copySuppressionCandidates(candidates) {
  const { client, sessionId, passages } = candidates;
  const occurredAtMs = candidates.occurredAtMs;
  return {
    client, sessionId,
    passages: passages === undefined ? undefined : projectPassages(passages),
    occurredAtMs: occurredAtMs == null ? occurredAtMs : snapshotArray(occurredAtMs, { allowEntries: true }),
  };
}

/** @template {SuppressionFact["kind"]} K @param {StoredFact} stored @param {K} kind
 * @returns {stored is StoredFact<Extract<SuppressionFact, {kind: K}>>}
 */
function isKind(stored, kind) {
  return stored.fact.kind === kind;
}

/** @param {boolean} vectorSuppression @param {FactMatchPolicy["hashSessionKey"]} [hashSessionKey]
 * @param {"plain" | "hashed"} [sessionRefs] */
export function createFactMatcher(vectorSuppression, hashSessionKey, sessionRefs = "plain") {
  /** @type {FactMatchPolicy} */
  const policy = { vectorSuppression, rowShingles: false, hashSessionKey };
  const capture = /** @type {const} */ ({ ...policy, mode: "capture" });
  const snapshotCapture = { ...capture, rowShingles: true };

  /** @param {Scope} scope @param {typeof import("@cairn-ink/core").factHidesRow} factHidesRow */
  function createRowMatcher(scope, factHidesRow) {
    /** @param {Entry} entry */
    return function rowMatcher({ row, receipts }) {
      /** @type {FactMatchRow} */
      const candidate = {
        type: "memory", scope, memoryId: row.id, revision: row.revision,
        digests: withDigestAliases(row), embedding: row.embedding?.vector,
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
    };
  }

  /** @param {State["facts"]} facts @param {Scope} scope */
  return function matchFacts(facts, scope) {
    const scoped = [...facts.values()].filter(({ fact }) =>
      fact.owner === scope.owner && (fact.namespace ?? null) === scope.namespace);
    const texts = scoped.filter((stored) => isKind(stored, "text"));
    const sessions = scoped.filter((stored) => isKind(stored, "session"));
    const rowMatcher = createRowMatcher(scope, factHidesRow);
    // Only a proven match is enough for erasure.
    const definiteRowMatcher = createRowMatcher(scope, (...args) => factHidesRow(...args) === true);

    /** @param {SourceRef["client"]} client @param {SourceRef["sessionId"]} sessionId */
    function blocksSession(client, sessionId) {
      return client != null && sessionId != null && sessions.some((stored) =>
        factBlocksIncoming(stored, { scope, passages: [], session: { client, sessionId } }, capture) !== false);
    }

    /** @param {string | null | undefined} client @param {string | undefined} sessionId
     * @param {ReadonlyArray<number | null>} occurredAtMs
     */
    function blockedMessages(client, sessionId, occurredAtMs) {
      const blocked = [];
      const windows = scoped.filter((stored) => isKind(stored, "window"));
      // Core's window comparison reads the client and time, including for messages without a session ID.
      const session = client == null ? undefined : { client, sessionId: sessionId ?? "" };
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

      /** @param {Entry} entry */
      definitelyHides(entry) {
        return scoped.length > 0 && scoped.some(definiteRowMatcher(entry));
      },

      /** @param {CanonicalQuery} query @param {"hash" | "full"} mode
       * @param {FactMatchIncoming["sourceMemory"]} sourceMemory
       */
      blocks(query, mode, sourceMemory) {
        if (texts.length === 0) return false;
        const passages = [{ digests: withDigestAliases(query), shingles: null, keyId: null, embedding: query.embedding }];
        return texts.some((stored) => {
          const result = factBlocksIncoming(stored, { scope, passages, sourceMemory },
            { ...policy, mode: mode === "hash" ? "explicitSave" : "capture" });
          return result !== false;
        });
      },

      /** @param {import("@cairn-ink/core/ports").Receipt} receipt @param {readonly TextDigest[]} digests */
      withholdsRaw(receipt, digests) {
        // A RawSpan fact without span-lineage proof is uncertain in this adapter.
        const passages = [{ digests, shingles: null, keyId: null }];
        return scoped.some(stored => stored.fact.kind === "rawSpan") ||
          blocksSession(receipt.client, receipt.sessionId) ||
          blockedMessages(receipt.client, receipt.sessionId, [receipt.occurredAtMs]).length > 0 ||
          texts.some((stored) => factBlocksIncoming(stored, { scope, passages }, capture) !== false);
      },

      blocksSession,
      blockedMessages,

      /** @param {NonNullable<CardWrite["sourceMessage"]>} source */
      canonicalSessionKey({ client, sessionId }) {
        return hashSessionKey ? hashSessionKey(client, sessionId) : sessionRefs === "plain" ? sessionId : null;
      },

      textFacts: texts.map(({ fact }) => fact),

      /** @param {Pick<CardWrite, "sourceMessage" | "sourceMemories" | "date">} card
       * @param {FactMatchIncoming["passages"]} passages */
      cardSourceWithholding({ sourceMessage, sourceMemories, date }, passages) {
        if (!sourceMessage) return false;
        const { client, sessionId } = sourceMessage;
        let result = /** @type {false | "ineligible"} */ (false);
        for (const stored of scoped) {
          if (stored.fact.kind === "identity") {
            for (const { id, revision } of sourceMemories) {
              const match = factHidesRow(stored, { type: "memory", scope, memoryId: id, revision }, policy);
              if (match === true) return true;
              if (match === "ineligible") result = match;
            }
          } else {
            const match = factBlocksIncoming(stored,
              { scope, session: { client, sessionId }, occurredAtMs: date, passages }, capture);
            if (match === true) return true;
            if (match === "ineligible") result = match;
          }
        }
        return result;
      },

      /** @param {ReturnType<typeof copySuppressionCandidates>} candidates */
      snapshot({ client, sessionId, occurredAtMs, passages: projected }) {
        return {
          blockedSession: blocksSession(client ?? null, sessionId ?? null),
          blockedMessages: occurredAtMs ? blockedMessages(client, sessionId, occurredAtMs) : [],
          passages: structuredClone(projected === undefined ? texts : matchingPassages(texts, projected)),
        };
      },

      /** @param {string} memoryId @param {Entry | undefined} entry @param {boolean} [definiteOnly] */
      factsFor(memoryId, entry, definiteOnly) {
        if (entry && definiteOnly) return structuredClone(scoped.filter(definiteRowMatcher(entry)));
        const applicable = entry ? scoped.filter(rowMatcher(entry)) :
          scoped.filter(({ fact }) => fact.kind === "identity" && fact.memoryId === memoryId);
        return structuredClone(applicable);
      },
    };

    /** @param {StoredFact<TextFact>[]} stored @param {readonly PassageFingerprint[]} passages */
    function matchingPassages(stored, passages) {
      if (stored.length === 0) return [];
      const incoming = { scope, passages };
      const hasCandidates = Array.isArray(passages) && passages.length > 0;
      const unkeyed = hasCandidates && passages.every(hasNoShingleEvidence);
      return stored.filter((fact) => {
        const exactOnly = unkeyed && fact.fact.mode === "full" && hasNoShingleEvidence(fact.fact.text);
        const rules = exactOnly ? capture : snapshotCapture;
        const result = factBlocksIncoming(fact, incoming, rules);
        // Core validates the full fact even with no passages. Use validation alone
        // in the exact-only profile, where the matcher already checks the candidates.
        return result !== false || withholdsAnyPassage(exactOnly ? [] : passages, [fact.fact]) ||
          (hasCandidates && (requiresLegacyMacDomain(fact.fact) || hasLegacyPassageDigest(fact.fact)));
      });
    }
  };
}
