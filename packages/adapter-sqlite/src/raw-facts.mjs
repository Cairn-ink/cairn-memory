import {
  boundedText, cleanContent, CoreError, factHidesRow, normalizeForHash, prepareCoreText,
  PRIVACY_REDACTION_VERSIONS, redactCore, redactHostedCurrent, redactV1, validateSuppressionFact, withholdsAnyPassage,
} from "@cairn-ink/core";
import { sha256 } from "./storage-values.mjs";

/** @import { FactMatchRow, StoredFact, TextDigest, TextFact } from "@cairn-ink/core" */
/** @import { CaptureMessage, Scope } from "@cairn-ink/core/ports" */
/** @import { Session } from "./raw-rows.mjs" */
/** @import { SessionHasher } from "./suppressions.mjs" */

const { core, v1, hostedCurrent } = PRIVACY_REDACTION_VERSIONS;

/** @param {string} value @param {TextDigest["pipeline"]} pipeline @param {number} redactionVersion
 * @returns {TextDigest}
 */
function digest(value, pipeline, redactionVersion) {
  return { alg: "sha256", value: sha256(value), pipeline, redactionVersion, keyId: null };
}

/** @param {TextDigest[]} digests @param {TextDigest} next */
function appendDigest(digests, next) {
  if (!digests.some(existing => existing.value === next.value)) digests.push(next);
}

/** Synchronous counterpart of Core's unkeyed allDigests.
 * @param {string} content
 */
function exactDigests(content) {
  const digests = [digest(normalizeForHash(prepareCoreText(content)), "core", core)];
  appendDigest(digests, digest(normalizeForHash(redactV1(cleanContent(content))), "hosted-v1", v1));
  try {
    appendDigest(digests, digest(boundedText(content, 4000).toLowerCase(), "engine-legacy", v1));
  } catch (error) {
    if (!(error instanceof CoreError) || error.code !== "invalid_text") throw error;
  }
  return digests;
}

/** @param {Scope} scope @param {Session} session
 * @param {Pick<CaptureMessage, "id" | "occurredAtMs"> & Partial<Pick<CaptureMessage, "content">>} message
 * @param {string} sessionKeyHash @param {boolean} withText
 * @returns {Extract<FactMatchRow, { type: "raw" }>}
 */
function evidence(scope, session, { id, content = "", occurredAtMs }, sessionKeyHash, withText) {
  return {
    type: "raw", scope, source: { client: session.client, sessionKeyHash, occurredAtMs },
    sessionKeyHash, messageKey: id, startUtf16: 0, endUtf16: content.length,
    digests: withText ? exactDigests(content) : undefined,
  };
}

/** @param {Scope} scope @param {Session} session @param {readonly StoredFact[]} facts @param {SessionHasher} hashSession */
export function rawFactPolicy(scope, session, facts, hashSession) {
  const sessionKeyHash = hashSession(scope, session.client, session.sessionId);
  const withText = facts.some(({ fact }) => fact.kind === "text");

  /** @param {StoredFact} stored @param {Extract<FactMatchRow, { type: "raw" }>} candidate */
  const match = (stored, candidate) => factHidesRow(stored, candidate, { rowShingles: false });

  return {
    sessionKeyHash,

    /** @param {CaptureMessage} message */
    evidence(message) {
      return evidence(scope, session, message, sessionKeyHash, withText);
    },

    /** @param {CaptureMessage} message */
    hides(message) {
      if (facts.length === 0) return false;
      const candidate = evidence(scope, session, message, sessionKeyHash, withText);
      return facts.some(stored => match(stored, candidate) !== false);
    },

    /** @param {CaptureMessage} message */
    purges(message) {
      const candidate = evidence(scope, session, message, sessionKeyHash, withText);
      return facts.some(stored => match(stored, candidate) === true);
    },

    /** @param {Pick<CaptureMessage, "id" | "occurredAtMs">} message @param {boolean} failClosed */
    refusesSource(message, failClosed) {
      const candidate = evidence(scope, session, message, sessionKeyHash, false);
      return facts.some(stored => {
        const { fact } = stored;
        if (fact.kind === "rawSpan") {
          // A shorter replay of the same message must not evade a span fact.
          return match(stored, { ...candidate, startUtf16: fact.startUtf16, endUtf16: fact.endUtf16 }) !== false;
        }
        if (fact.kind !== "window") return false;
        const result = match(stored, candidate);
        return result === true || (failClosed && result !== false);
      });
    },
  };
}

/** @param {StoredFact[]} facts @param {string} content @param {ReadonlySet<string>} [legacy] */
export function importTextBlocked(facts, content, legacy) {
  const texts = facts.map(({ fact }) => fact).filter(fact => fact.kind === "text");
  if (!texts.length && !legacy?.size) return false;
  const original = cleanContent(content);
  const normalized = original.normalize("NFKC");
  const prepared = redactCore(normalized);
  if (!prepared) return exactDigests(original).some(({ value }) => legacy?.has(value)) ||
    texts.some(unavailableLegacyDomain);

  // Match the exact aliases Core uses at capture admission, including historical redaction spellings.
  /** @type {Map<string, TextDigest[]>} */
  const spellings = new Map();
  /** @type {Array<[string, TextDigest["pipeline"], number]>} */
  const variants = [[original, "hosted-v1", v1], [redactV1(original), "hosted-v1", v1],
    [redactHostedCurrent(original), "hosted-v1", hostedCurrent], [prepared, "core", core],
    [redactV1(normalized), "hosted-v1", v1]];
  for (const [variant, pipeline, version] of variants) {
    const spelling = normalizeForHash(variant);
    const digests = exactDigests(variant);
    appendDigest(digests, digest(spelling, pipeline, version));
    if (digests.some(({ value }) => legacy?.has(value))) return true;
    spellings.set(spelling, digests);
  }
  return withholdsAnyPassage(Array.from(spellings.values(), digests => ({ digests, shingles: null, keyId: null })), texts);
}

/** @param {TextFact} fact */
function unavailableLegacyDomain({ text }) {
  return text.digests.every(({ keyId }) => keyId !== null) &&
    text.digests.some(({ label, pipeline }) => (label ?? pipeline) !== "core");
}

/** @param {Scope} scope @param {readonly StoredFact[]} supplied @returns {StoredFact[]} */
export function purgeFacts(scope, supplied) {
  if (!Array.isArray(supplied)) throw new CoreError("invalid_input");
  return Array.from(supplied, stored => {
    if (!stored || typeof stored.factId !== "string" || !stored.factId || typeof stored.incarnation !== "string" ||
        typeof stored.epoch !== "bigint" || !Number.isSafeInteger(stored.createdAtMs)) throw new CoreError("invalid_input");
    return { ...stored, fact: validateSuppressionFact(stored.fact) };
  }).filter(({ fact }) => fact.owner === scope.owner && (fact.namespace ?? null) === scope.namespace &&
    (fact.kind === "text" || fact.kind === "rawSpan"));
}
