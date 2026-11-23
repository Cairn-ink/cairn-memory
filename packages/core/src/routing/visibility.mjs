import { factHidesRow } from "../privacy/fact-match.mjs";
import { fingerprintLegacyCapture, fingerprintMemoryPassages, validateFingerprintLabels } from "../privacy/fingerprint.mjs";
import { PRIVACY_REDACTION_VERSIONS, redactHostedCurrent, redactV1 } from "../privacy/redact.mjs";
import { normalizeForHash, prepareCoreText } from "../privacy/text.mjs";
import { requiresLegacyMacDomain, snapshotReader, withholdsAnyPassage } from "../privacy/withholds.mjs";
import { validateSuppressionFact } from "../suppression-fact.mjs";
import { buildDocumentCard } from "./card.mjs";

/** @import { Scope } from "../ports/common.d.ts" */
/** @import { DocumentCardHiddenReason, DocumentCardSourceWithheldInput, DocumentCardStalenessInput, DocumentCardVisibility, DocumentCardVisibilityInput, StaleReplacement, StaleReplacementInput } from "./visibility.mjs" */

/** @param {unknown} value @returns {value is string} */
const nonempty = (value) => typeof value === "string" && value.length > 0;

/** @param {Scope | undefined} scope */
const validScope = (scope) => nonempty(scope?.owner) && (scope.namespace === null || nonempty(scope.namespace));

/** @param {unknown} value @returns {value is number} */
const natural = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** @param {DocumentCardHiddenReason} reason @returns {DocumentCardVisibility} */
const hidden = (reason) => ({ visible: false, reason });

/** @typedef {NonNullable<DocumentCardVisibilityInput["legacyFingerprint"]>} LegacyFingerprint */

/** @param {LegacyFingerprint} input @returns {LegacyFingerprint | null} */
function readLegacyFingerprint(input) {
  const { field } = snapshotReader();
  const labels = validateFingerprintLabels(field(input, "labels"));
  const key = field(input, "key");
  if (!key || typeof key !== "object" || Array.isArray(key)) return null;
  const id = field(key, "id");
  const signingKey = field(key, "signingKey");
  if (typeof id !== "string" || !/^[0-9a-f]{16}$/u.test(id) ||
      !(signingKey instanceof globalThis.CryptoKey) || signingKey.type !== "secret" ||
      !signingKey.usages.includes("sign")) return null;
  const algorithm = /** @type {HmacKeyAlgorithm} */ (signingKey.algorithm);
  if (algorithm.name !== "HMAC" || algorithm.hash.name !== "SHA-256" || algorithm.length !== 256) return null;
  return { key: { id, signingKey }, labels };
}

/** @param {string} text @param {LegacyFingerprint} legacy
 * @returns {Promise<import("../ports/privacy.d.ts").PassageFingerprint[]>} */
function legacyCardPassages(text, { key, labels }) {
  const { v1, hostedCurrent } = PRIVACY_REDACTION_VERSIONS;
  const variants = new Map([
    [normalizeForHash(text), v1],
    [normalizeForHash(redactV1(text)), v1],
    [normalizeForHash(redactHostedCurrent(text)), hostedCurrent],
  ]);
  return Promise.all(Array.from(variants, async ([variant, redactionVersion]) => {
    const { text_hmac, shingles, key_id: keyId } = await fingerprintLegacyCapture(variant, key, labels);
    return { digests: [{ alg: "hmac", value: text_hmac, pipeline: "hosted-v1", redactionVersion, keyId }], shingles, keyId };
  }));
}

/** @param {DocumentCardVisibilityInput} input @returns {Promise<DocumentCardVisibility>} */
export async function documentCardVisible(input) {
  try {
    const { card, requestedScope, memoryStates, sourceWithheld } = input;
    if (!nonempty(card?.id) || !validScope(card.scope) || !validScope(requestedScope)) return hidden("uncertain");
    if (card.scope.owner !== requestedScope.owner || card.scope.namespace !== requestedScope.namespace) {
      return hidden("scope_mismatch");
    }
    const { origin, sourceMessage, canonicalSessionKey } = card;
    const messageBacked = origin === "router" || origin === undefined;
    if (!messageBacked && ((origin !== "import" && origin !== "manual") || sourceMessage !== null)) {
      return hidden("uncertain");
    }
    if (messageBacked && sourceWithheld === true) return hidden("source_withheld");
    if (!Array.isArray(card.sourceMemories) ||
        ((messageBacked || card.sourceMemories.length > 0) && typeof memoryStates?.get !== "function")) {
      return hidden("uncertain");
    }

    if (messageBacked) {
      if (sourceWithheld !== false || !nonempty(sourceMessage?.client) || !nonempty(sourceMessage.sessionId) ||
          !nonempty(sourceMessage.messageId) || !nonempty(canonicalSessionKey)) return hidden("uncertain");
      // The builder owns the ID recipe. A fixed body lets it compute the ID without reading stored text.
      const expected = await buildDocumentCard(
        { id: sourceMessage.messageId, role: "user", content: "." },
        { scope: requestedScope, client: sourceMessage.client, canonicalSessionKey },
      );
      if (!expected.card) return hidden("uncertain");
      if (expected.card.id !== card.id) return hidden("id_mismatch");
    }

    for (const source of card.sourceMemories) {
      if (!nonempty(source?.id) || !natural(source.revision)) return hidden("uncertain");
      const state = memoryStates.get(source.id);
      if (!state) return hidden("source_memory_missing");
      if (state.status === "forgotten") return hidden("source_memory_forgotten");
      if (state.status !== "visible") return hidden("source_memory_not_visible");
      if (!natural(state.revision)) return hidden("uncertain");
      if (!messageBacked && state.revision !== source.revision) return hidden("source_memory_not_visible");
    }

    if (!messageBacked) {
      const { title, body } = card;
      const { textFacts, fingerprintKey = null, legacyFingerprint } = input;
      if ((title !== null && typeof title !== "string") || typeof body !== "string") return hidden("uncertain");
      const facts = snapshotReader().array(textFacts, validateSuppressionFact);
      if (!facts?.every(fact => fact.kind === "text") ||
          facts.some(fact => fact.owner !== card.scope.owner || (fact.namespace ?? null) !== card.scope.namespace)) {
        return hidden("uncertain");
      }
      let legacy;
      if (legacyFingerprint !== undefined) {
        legacy = readLegacyFingerprint(legacyFingerprint);
        if (!legacy) return hidden("uncertain");
      }
      if (facts.length > 0) {
        if (!legacy && facts.some(requiresLegacyMacDomain)) return hidden("text_withheld");
        const texts = title === null ? [body] : [title, body];
        let memoryFacts = facts;
        if (legacy) {
          // The matcher withholds when a passage and fact lack comparable evidence.
          const legacyFacts = facts.filter(requiresLegacyMacDomain);
          if (legacyFacts.length > 0) {
            const legacyKeyId = legacy.key.id;
            if (legacyFacts.some(fact => fact.text.digests.some(digest => digest.keyId !== legacyKeyId))) {
              return hidden("text_withheld");
            }
            const legacySet = new Set(legacyFacts);
            memoryFacts = facts.filter(fact => !legacySet.has(fact));
            const fingerprints = await Promise.all(texts.map(text => legacyCardPassages(text, legacy)));
            if (withholdsAnyPassage(fingerprints.flat(), legacyFacts)) return hidden("text_withheld");
          }
        }
        if (memoryFacts.length > 0) {
          const fingerprints = await Promise.all(texts.map(text =>
            fingerprintMemoryPassages(text, prepareCoreText(text), fingerprintKey)));
          if (withholdsAnyPassage(fingerprints.flat(), memoryFacts)) return hidden("text_withheld");
        }
      }
    }
    return { visible: true, reason: null };
  } catch {
    return hidden("uncertain");
  }
}

/** @param {DocumentCardStalenessInput} input */
export function documentCardStaleness(input) {
  try {
    const { card, memoryStates } = input;
    if (typeof memoryStates?.get !== "function" || !Array.isArray(card?.stale) || !Array.isArray(card.sourceMemories)) {
      return true;
    }
    if (card.stale.length > 0) return true;
    for (const source of card.sourceMemories) {
      if (!nonempty(source?.id) || !natural(source.revision)) return true;
      const state = memoryStates.get(source.id);
      if (state?.status !== "visible" || state.revision !== source.revision) return true;
    }
    return false;
  } catch {
    return true;
  }
}

/** @param {StaleReplacementInput} input @returns {StaleReplacement | null} */
export function resolveStaleReplacement(input) {
  try {
    const { replacementMemoryId, memoryStates, successorOf } = input;
    if (!memoryStates || !successorOf) return null;
    let memoryId = replacementMemoryId ?? undefined;
    const visited = new Set();
    while (nonempty(memoryId) && !visited.has(memoryId)) {
      visited.add(memoryId);
      const state = memoryStates.get(memoryId);
      if (state?.status === "historical" && natural(state.revision)) {
        memoryId = successorOf.get(memoryId);
        continue;
      }
      if (state?.status !== "visible" || successorOf.has(memoryId)) return null;
      const { revision, content, date } = state;
      return natural(revision) && nonempty(content) &&
        (date === null || (typeof date === "number" && Number.isSafeInteger(date)))
        ? { memoryId, revision, content, date }
        : null;
    }
  } catch {
    return null;
  }
  return null;
}

/** @param {DocumentCardSourceWithheldInput} input */
export function documentCardSourceWithheld(input) {
  try {
    const { rawRows, sourceLengthUtf16, facts, sourceExcluded, policy } = input;
    if (sourceExcluded !== false || !natural(sourceLengthUtf16) || sourceLengthUtf16 === 0 ||
        !Array.isArray(rawRows) || !rawRows.length || !Array.isArray(facts)) return true;
    const source = rawRows[0];
    let coveredUntil = 0;
    for (const row of rawRows) {
      if (row?.type !== "raw" || !validScope(row.scope) || !nonempty(row.messageKey) ||
          !nonempty(row.sessionKeyHash) || !/^[0-9a-f]{64}$/u.test(row.sessionKeyHash) ||
          row.startUtf16 !== coveredUntil || !natural(row.endUtf16) ||
          row.endUtf16 <= coveredUntil || row.endUtf16 > sourceLengthUtf16) return true;
      if (row.scope.owner !== source.scope.owner || row.scope.namespace !== source.scope.namespace ||
          row.sessionKeyHash !== source.sessionKeyHash || row.messageKey !== source.messageKey) return true;
      for (const fact of facts) {
        if (factHidesRow(fact, row, policy) !== false) return true;
      }
      coveredUntil = row.endUtf16;
    }
    return coveredUntil !== sourceLengthUtf16;
  } catch {
    return true;
  }
}
