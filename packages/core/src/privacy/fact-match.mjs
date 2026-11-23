import { CONTAINMENT_THRESHOLD, SUPPRESSION_DISTANCE } from "../decisions.mjs";
import { validateSuppressionFact } from "../suppression-fact.mjs";
import {
  compareValidatedDigests, isValidFingerprint, isValidThreshold, shingleContainmentMatch, snapshotReader,
} from "./withholds.mjs";

export { NEAR_DUPLICATE_DISTANCE, SUPPRESSION_DISTANCE } from "../decisions.mjs";

// Widen the hiding cutoff to cover rounding from pgvector's float32 storage.
export const SUPPRESSION_DISTANCE_TOLERANCE = 1e-6;

/** @import { FactMatchEmbedding, FactMatchIncoming, FactMatchPolicy, FactMatchResult, FactMatchRow, FactMatchSource, IncomingFactMatchPolicy } from "./fact-match.mjs" */
/** @import { Scope } from "../ports/common.d.ts" */
/** @import { SessionRef, StoredFact, SuppressionFact, TextFact, WindowFact } from "../suppression-fact.mjs" */

/** @typedef {Pick<FactMatchRow, "digests" | "shingles" | "keyId" | "embedding">} TextCandidate */

/** @param {unknown} value @returns {value is string} */
const nonempty = (value) => typeof value === "string" && value.length > 0;

/** @param {unknown} value @returns {value is string} */
const hash = (value) => typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);

/** @param {unknown} value @returns {value is number} */
const integer = (value) => Number.isSafeInteger(value);

/** @param {unknown} value @returns {value is number} */
const natural = (value) => integer(value) && value >= 0;

const invalidEvidence = /** @type {Readonly<Record<string, unknown>>} */ (Object.freeze(Object.create(null)));
const typedArrayLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Float32Array.prototype), "length")?.get;

/** @param {unknown} value */
const scalar = (value) => value != null && (typeof value === "object" || typeof value === "function")
  ? invalidEvidence : value;

function matchReader() {
  const { array, dataProperty, field } = snapshotReader();

  /**
   * Capture only the fields named by the projection. Preserve missing properties
   * for validators that distinguish omission from an explicit undefined value.
   * @param {unknown} input @param {readonly string[]} keys
   * @param {Record<string, (value: unknown) => unknown>} [nested]
   */
  function record(input, keys, nested = {}) {
    if (input == null) return input;
    if (typeof input !== "object" || Array.isArray(input)) return invalidEvidence;
    /** @type {Record<string, unknown>} */
    const output = Object.create(null);
    for (const name of keys) {
      const property = dataProperty(input, name);
      if (property) output[name] = scalar(property.value);
    }
    for (const [name, copy] of Object.entries(nested)) {
      const property = dataProperty(input, name);
      if (property) output[name] = copy(property.value);
    }
    return Object.freeze(output);
  }

  /** @param {unknown} value @param {(item: unknown) => unknown} copy @param {boolean} [allowHoles] */
  const list = (value, copy, allowHoles) => value == null ? value :
    Array.isArray(value) ? array(value, copy, allowHoles) ?? invalidEvidence : invalidEvidence;

  /** @param {unknown} value */
  function candidateEmbedding(value) {
    if (!ArrayBuffer.isView(value) || (!(value instanceof Float32Array) && !(value instanceof Float64Array))) {
      return list(value, scalar);
    }
    // Use the intrinsic length for typed arrays, then read only own element descriptors.
    const length = typedArrayLength?.call(value);
    return Object.freeze(Array.from({ length }, (_, index) => field(value, index)));
  }

  /** @param {unknown} value */
  const scope = (value) => record(value, ["owner", "namespace"]);
  /** @param {unknown} value */
  const source = (value) => record(value, ["client", "sessionId", "sessionKeyHash", "occurredAtMs"]);
  /** @param {unknown} value */
  const incarnation = (value) => record(value, ["id", "createdAtMs"]);
  /** @param {unknown} value */
  const digest = (value) => record(value, ["alg", "value", "pipeline", "redactionVersion", "keyId"]);
  const fingerprintDigests = {
    digests: (/** @type {unknown} */ value) => list(value, digest),
  };
  const fingerprintLists = {
    ...fingerprintDigests,
    shingles: (/** @type {unknown} */ value) => list(value, scalar),
  };

  return {
    /** @param {StoredFact} stored */
    fact(stored) {
      const body = record(stored, [], {
        fact: (value) => record(value, [
          "kind", "origin", "owner", "namespace", "actionId", "memoryId", "throughRevision", "mode", "client",
          "unknownTime", "anchor", "sessionKeyHash", "messageKey", "startUtf16", "endUtf16", "contentDigest",
        ], {
          text: (value) => record(value, ["keyId"], { ...fingerprintLists, embedding: (value) => list(value, scalar) }),
          sourceMemory: incarnation,
          session: source,
          window: (value) => record(value, ["startMs", "endMs"]),
        }),
      });
      return body?.fact;
    },
    /** @param {SuppressionFact} fact @param {FactMatchPolicy} policy */
    useCandidateShingles(fact, policy) {
      // Stored evidence is always captured for validation. Only candidate evidence can be omitted.
      return !(fact.kind === "text" && fact.mode === "full" && policy && typeof policy === "object" &&
        !Array.isArray(policy) && field(policy, "rowShingles") === false);
    },
    /** @param {FactMatchRow} row @param {boolean} useShingles */
    row(row, useShingles) {
      return /** @type {FactMatchRow} */ (/** @type {unknown} */ (record(row, [
        "type", "memoryId", "revision", "sessionKeyHash", "messageKey", "startUtf16", "endUtf16",
        ...(useShingles ? ["keyId"] : []),
      ], { scope, source, ...(useShingles ? fingerprintLists : fingerprintDigests), embedding: candidateEmbedding })));
    },
    /** @param {FactMatchIncoming} incoming @param {boolean} useShingles */
    incoming(incoming, useShingles) {
      /** @param {unknown} value */
      const passage = (value) => record(value, useShingles ? ["keyId"] : [], {
        ...(useShingles ? fingerprintLists : fingerprintDigests), embedding: candidateEmbedding,
      });
      return /** @type {FactMatchIncoming} */ (/** @type {unknown} */ (record(incoming, ["occurredAtMs"], {
        scope, passages: (value) => list(value, passage, true), session: source, sourceMemory: incarnation,
      })));
    },
    /** @template {FactMatchPolicy} T @param {T} policy */
    policy(policy) {
      return /** @type {T} */ (/** @type {unknown} */ (record(policy, [
        "mode", "containmentThreshold", "vectorSuppression", "suppressionDistance", "rowShingles",
      ], {
        key: (value) => record(value, ["id"]),
        hashSessionKey: (value) => typeof value === "function" ? value : undefined,
      })));
    },
  };
}

/** @param {SuppressionFact} fact @param {Scope} scope @returns {FactMatchResult} */
function scopeMatches(fact, scope) {
  if (!nonempty(scope?.owner) || (scope.namespace !== null && !nonempty(scope.namespace))) return "ineligible";
  return fact.owner === scope.owner && (fact.namespace ?? null) === scope.namespace;
}

/**
 * pgvector's cosine distance is 1 minus cosine similarity, clamped to [0, 2].
 * Core accumulates in float64 over the available inputs.
 * @param {FactMatchEmbedding} a @param {FactMatchEmbedding} b
 */
function cosineDistance(a, b) {
  if (!Array.isArray(b) || a.length === 0 || a.length !== b.length) return NaN;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return NaN;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  const denominator = Math.sqrt(normA * normB);
  if (denominator === 0 || !Number.isFinite(denominator)) return NaN;
  const similarity = dot / denominator;
  return 1 - Math.max(-1, Math.min(1, similarity));
}

/** @param {FactMatchPolicy} policy */
function isValidPolicy(policy) {
  if (policy.rowShingles !== undefined && typeof policy.rowShingles !== "boolean") return false;
  if (!Object.hasOwn(policy, "vectorSuppression") || policy.vectorSuppression === false) return true;
  if (policy.vectorSuppression !== true) return false;
  if (!Object.hasOwn(policy, "suppressionDistance")) return true;
  const cutoff = policy.suppressionDistance;
  return typeof cutoff === "number" && Number.isFinite(cutoff) && cutoff >= 0 && cutoff <= 2;
}

/** @param {TextCandidate} passage @param {TextFact} fact @param {FactMatchPolicy} policy @returns {FactMatchResult} */
function vectorMatch(passage, fact, policy) {
  if (policy.vectorSuppression !== true || fact.text.embedding == null || passage.embedding == null) return false;
  const cutoff = policy.suppressionDistance ?? SUPPRESSION_DISTANCE;
  const distance = cosineDistance(fact.text.embedding, passage.embedding);
  return Number.isFinite(distance) ? distance <= cutoff + SUPPRESSION_DISTANCE_TOLERANCE : "ineligible";
}

/** @param {TextFact} fact @param {FactMatchIncoming["sourceMemory"]} edit @param {readonly TextCandidate[]} passages */
function checksExplicitPassages(fact, edit, passages) {
  // Hosted compares a single ordinary passage by digest only. Core is stricter
  // after a key change: a passage fingerprinted under any other key than the
  // fact's still goes through containment, so it withholds (known difference).
  if (fact.origin !== "edit") return passages.length > 1 || passages.some((passage) => passage.keyId !== fact.text.keyId);
  if (edit == null || fact.sourceMemory == null) return true;
  return edit.id !== fact.sourceMemory.id || edit.createdAtMs !== fact.sourceMemory.createdAtMs;
}

/**
 * Check every exact alias before applying an edit exemption. A definite block takes
 * precedence over unavailable evidence from another comparison.
 * @param {readonly TextCandidate[]} passages @param {TextFact} fact @param {FactMatchPolicy} policy
 * @param {IncomingFactMatchPolicy} [explicit] @param {FactMatchIncoming["sourceMemory"]} [edit]
 * @returns {FactMatchResult}
 */
function matchPassages(passages, fact, policy, explicit, edit) {
  const threshold = policy.containmentThreshold === undefined ? CONTAINMENT_THRESHOLD : policy.containmentThreshold;
  if (!Array.isArray(passages) || !isValidFingerprint(fact.text) || !isValidThreshold(threshold)) return "ineligible";
  if (explicit && ((explicit.key != null && !nonempty(explicit.key.id)) ||
      (edit != null && (typeof edit !== "object" || !nonempty(edit.id) || !integer(edit.createdAtMs))))) return "ineligible";

  let result = /** @type {false | "ineligible"} */ (false);
  /** @type {TextCandidate[]} */
  const candidates = [];
  for (let index = 0; index < passages.length; index++) {
    const passage = passages[index];
    if (!isValidFingerprint(passage)) {
      result = "ineligible";
      continue;
    }
    const digest = compareValidatedDigests(passage.digests, fact.text.digests);
    if (digest === true) return true;
    if (digest === "ineligible") result = "ineligible";
    candidates.push(passage);
  }
  if (fact.mode === "exact") return result;

  const useShingles = policy.rowShingles !== false;
  const checkContainment = useShingles && (!explicit || checksExplicitPassages(fact, edit, passages));
  const containmentKeyUnavailable = explicit != null && checkContainment &&
    (explicit.key !== undefined || passages.length === 0) && (!explicit.key || explicit.key.id !== fact.text.keyId);
  if (containmentKeyUnavailable && passages.length === 0) return "ineligible";

  for (const passage of candidates) {
    const shingles = useShingles &&
      shingleContainmentMatch(passage, fact.text, threshold, checkContainment, containmentKeyUnavailable);
    if (shingles === true) return true;
    const vector = explicit ? false : vectorMatch(passage, fact, policy);
    if (vector === true) return true;
    if (shingles === "ineligible" || vector === "ineligible") result = "ineligible";
  }
  return result;
}

/** @param {SessionRef} session @param {FactMatchSource | undefined} source @param {FactMatchPolicy} policy @returns {FactMatchResult} */
function sessionMatches(session, source, policy) {
  if (!nonempty(source?.client)) return "ineligible";
  if (session.client !== source.client) return false;
  const { sessionId, sessionKeyHash } = source;
  if ((sessionId == null) === (sessionKeyHash == null) ||
      (sessionId != null && !nonempty(sessionId)) || (sessionKeyHash != null && !hash(sessionKeyHash))) return "ineligible";

  if ("sessionId" in session && sessionId != null) return session.sessionId === sessionId;
  if ("sessionKeyHash" in session && sessionKeyHash != null) return session.sessionKeyHash === sessionKeyHash;
  const plain = "sessionId" in session ? session.sessionId : sessionId;
  const hashed = "sessionKeyHash" in session ? session.sessionKeyHash : sessionKeyHash;
  if (plain == null || typeof policy.hashSessionKey !== "function") return "ineligible";
  try {
    const candidateHash = policy.hashSessionKey(session.client, plain);
    return hash(candidateHash) ? candidateHash === hashed : "ineligible";
  } catch {
    return "ineligible";
  }
}

/** @param {WindowFact} fact @param {string | undefined} client @param {number | null | undefined} time @returns {FactMatchResult} */
function windowMatches(fact, client, time) {
  if (fact.client !== null && nonempty(client) && fact.client !== client) return false;
  let inside;
  if (time === null) inside = fact.unknownTime === true;
  else if (!integer(time)) return "ineligible";
  else inside = time >= fact.window.startMs && time < fact.window.endMs;
  if (!inside) return false;
  // Inside a client-specific window, an item whose client is unknown cannot be ruled out (fail closed).
  return fact.client !== null && !nonempty(client) ? "ineligible" : true;
}

/** @param {SuppressionFact} fact @param {FactMatchRow} row @param {FactMatchPolicy} policy @returns {FactMatchResult} */
function hidesRow(fact, row, policy) {
  const scoped = scopeMatches(fact, row?.scope);
  if (scoped !== true) return scoped;
  switch (fact.kind) {
    case "identity":
      if (row.type === "raw") return false;
      if (!nonempty(row.memoryId)) return "ineligible";
      if (fact.memoryId !== row.memoryId) return false;
      if (fact.throughRevision === undefined) return true;
      return natural(row.revision) ? row.revision <= fact.throughRevision : "ineligible";
    case "text":
      return matchPassages([row], fact, policy);
    case "session":
      return sessionMatches(fact.session, row.source, policy);
    case "window":
      return windowMatches(fact, row.source?.client, row.source?.occurredAtMs);
    case "rawSpan":
      if (row.type === "memory" && nonempty(row.memoryId)) return false;
      if (row.type !== "raw") return "ineligible";
      if (!hash(row.sessionKeyHash) || !nonempty(row.messageKey) || !natural(row.startUtf16) ||
          !natural(row.endUtf16) || row.endUtf16 <= row.startUtf16) return "ineligible";
      return fact.sessionKeyHash === row.sessionKeyHash && fact.messageKey === row.messageKey &&
        row.startUtf16 < fact.endUtf16 && fact.startUtf16 < row.endUtf16;
  }
}

/** @param {SuppressionFact} fact @param {FactMatchIncoming} incoming @param {IncomingFactMatchPolicy} policy @returns {FactMatchResult} */
function blocksIncoming(fact, incoming, policy) {
  const scoped = scopeMatches(fact, incoming?.scope);
  if (scoped !== true) return scoped;
  if (policy?.mode !== "capture" && policy?.mode !== "explicitSave") return "ineligible";
  switch (fact.kind) {
    case "text":
      return matchPassages(incoming.passages, fact, policy,
        policy.mode === "explicitSave" ? policy : undefined, incoming.sourceMemory);
    case "session":
      return sessionMatches(fact.session, incoming.session, policy);
    case "window":
      return windowMatches(fact, incoming.session?.client, incoming.occurredAtMs);
    case "identity":
    case "rawSpan":
      return false;
  }
}

/**
 * `rowShingles` defaults to true. Set it to false for stores without row shingles to use
 * exact digests and enabled vectors for full text facts. Paraphrases that miss both can stay visible.
 * @param {StoredFact} storedFact @param {FactMatchRow} row @param {FactMatchPolicy} [policy] @returns {FactMatchResult}
 */
export function factHidesRow(storedFact, row, policy = {}) {
  try {
    const snapshot = matchReader();
    const fact = validateSuppressionFact(snapshot.fact(storedFact));
    const candidate = snapshot.row(row, snapshot.useCandidateShingles(fact, policy));
    const rules = snapshot.policy(policy);
    if (!isValidPolicy(rules)) return "ineligible";
    return hidesRow(fact, candidate, rules);
  } catch {
    return "ineligible";
  }
}

/**
 * `rowShingles` defaults to true. Set it to false to skip containment for full text facts.
 * Enabled vectors still apply in capture mode. Explicit saves use exact digests.
 * @param {StoredFact} storedFact @param {FactMatchIncoming} incoming @param {IncomingFactMatchPolicy} policy @returns {FactMatchResult}
 */
export function factBlocksIncoming(storedFact, incoming, policy) {
  try {
    const snapshot = matchReader();
    const fact = validateSuppressionFact(snapshot.fact(storedFact));
    const candidate = snapshot.incoming(incoming, snapshot.useCandidateShingles(fact, policy));
    const rules = snapshot.policy(policy);
    if (!isValidPolicy(rules)) return "ineligible";
    return blocksIncoming(fact, candidate, rules);
  } catch {
    return "ineligible";
  }
}
