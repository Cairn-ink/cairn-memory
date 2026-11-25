import { factHidesRow } from "../privacy/fact-match.mjs";
import {
  fingerprintLegacyCapture, fingerprintMemoryPassages, textVariants, validateFingerprintLabels,
  validateFingerprintSigningKey,
} from "../privacy/fingerprint.mjs";
import { PRIVACY_REDACTION_VERSIONS } from "../privacy/redact.mjs";
import { normalizeForHash, prepareCoreText, prepareHostedCaptureText } from "../privacy/text.mjs";
import { passageWithholding, requiresLegacyMacDomain, snapshotReader } from "../privacy/withholds.mjs";
import { validateSuppressionFact } from "../suppression-fact.mjs";
import { buildDocumentCard } from "./card.mjs";

/** @import { ItemRef, Scope } from "../ports/common.d.ts" */
/** @import { TextDigest } from "../suppression-fact.mjs" */
/** @import { DocumentCardHiddenReason, DocumentCardRowDropReason, DocumentCardSourceWithheldInput, DocumentCardStalenessInput, DocumentCardVisibility, DocumentCardVisibilityInput, LoadDocumentCardVisibility, StaleReplacement, StaleReplacementInput } from "./visibility.mjs" */

/** @param {unknown} value @returns {value is string} */
const nonempty = (value) => typeof value === "string" && value.length > 0;

/** @param {Scope | undefined} scope */
const validScope = (scope) => nonempty(scope?.owner) && (scope.namespace === null || nonempty(scope.namespace));

/** @param {unknown} value @returns {value is number} */
const natural = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** @param {DocumentCardHiddenReason} reason @returns {DocumentCardVisibility} */
const hidden = (reason) => ({ visible: false, reason });

/** @typedef {NonNullable<DocumentCardVisibilityInput["legacyFingerprint"]>} LegacyFingerprint */

/** @param {TextDigest} digest */
const isLegacyMac = (digest) => digest.alg === "hmac" && digest.pipeline !== "core";

/** @param {LegacyFingerprint} input @returns {Promise<LegacyFingerprint | null>} */
async function readLegacyFingerprint(input) {
  const { field } = snapshotReader();
  const labels = validateFingerprintLabels(field(input, "labels"));
  const key = field(input, "key");
  if (!key || typeof key !== "object" || Array.isArray(key)) return null;
  const id = field(key, "id");
  if (typeof id !== "string" || !/^[0-9a-f]{16}$/u.test(id)) return null;
  const signingKey = await validateFingerprintSigningKey(field(key, "signingKey"));
  return { key: { id, signingKey }, labels };
}

/** @param {string} text @param {LegacyFingerprint} legacy
 * @returns {Promise<import("../ports/privacy.d.ts").PassageFingerprint[]>} */
async function legacyCardPassages(text, { key, labels }) {
  const spellings = textVariants(text, prepareCoreText(text));
  spellings.push([prepareHostedCaptureText(text), "hosted-v1", PRIVACY_REDACTION_VERSIONS.hostedCurrent]);
  /** @type {Map<string, Set<number>>} */
  const variants = new Map();
  for (const [spelling, , version] of spellings) {
    const versions = variants.get(spelling) ?? new Set();
    versions.add(version);
    variants.set(spelling, versions);
  }

  /** @type {Map<string, ReturnType<typeof fingerprintLegacyCapture>>} */
  const signatures = new Map();
  // Reuse signing work for identical bytes while keeping each spelling's version set.
  /** @param {string} input @param {string} signedText */
  function sign(input, signedText) {
    const existing = signatures.get(signedText);
    if (existing) return existing;
    const pending = fingerprintLegacyCapture(input, key, labels);
    signatures.set(signedText, pending);
    return pending;
  }

  const signed = await Promise.all(Array.from(variants).flatMap(([spelling, versions]) => {
    const normalized = normalizeForHash(spelling);
    const normalizedAgain = normalizeForHash(normalized);
    const candidates = [sign(spelling, normalized)];
    // Hosted forget signs stored text. Older card lookups signed already normalized text.
    if (normalizedAgain !== normalized) candidates.push(sign(normalized, normalizedAgain));
    return candidates.map(async candidate => ({ ...await candidate, versions }));
  }));
  const passages = new Map();
  for (const { text_hmac, shingles, key_id: keyId, versions } of signed) {
    const redactionVersions = [...versions].sort((a, b) => a - b);
    const identity = `${text_hmac}:${keyId}:${redactionVersions.join(",")}`;
    if (passages.has(identity)) continue;
    const digests = redactionVersions.map((redactionVersion) =>
      /** @satisfies {TextDigest} */ ({ alg: "hmac", value: text_hmac, pipeline: "hosted-v1", redactionVersion, keyId }));
    passages.set(identity, { digests, shingles, keyId });
  }
  const retained = [...passages.values()];
  // Compare every exact alias before checking each spelling's own shingles.
  const digests = retained.flatMap(passage => passage.digests);
  return retained.map(({ shingles, keyId }) => ({ digests, shingles, keyId }));
}

/** @param {DocumentCardVisibilityInput} input @param {{ definiteOnly?: boolean }} [options]
 * @returns {Promise<DocumentCardVisibility>} */
export async function documentCardVisible(input, { definiteOnly = false } = {}) {
  const verdict = await readCardVisibility(input, false);
  if (!definiteOnly || verdict.visible) return verdict;
  const evidence = await readCardVisibility(input, true);
  if (evidence.reason === "text_withheld") return evidence;
  if (verdict.reason === "source_memory_corrected") {
    return evidence.reason === "source_withheld" || evidence.reason === "source_memory_forgotten" ||
      evidence.reason === "source_memory_not_visible" ? evidence : hidden("uncertain");
  }
  if (verdict.reason !== "text_withheld" && verdict.reason !== "source_memory_not_visible") return verdict;
  return evidence.reason === verdict.reason ? verdict : hidden("uncertain");
}

/** @param {DocumentCardVisibilityInput} input @param {boolean} definiteOnly
 * @returns {Promise<DocumentCardVisibility>} */
async function readCardVisibility(input, definiteOnly) {
  try {
    const { card, requestedScope, memoryStates, sourceWithheld } = input;
    const { field, array } = snapshotReader();
    if (!nonempty(card?.id) || !validScope(card.scope) || !validScope(requestedScope)) return hidden("uncertain");
    if (card.scope.owner !== requestedScope.owner || card.scope.namespace !== requestedScope.namespace) {
      return hidden("scope_mismatch");
    }
    const { origin, sourceMessage, canonicalSessionKey } = card;
    const messageBacked = origin === "router" || origin === undefined;
    if (!messageBacked && ((origin !== "import" && origin !== "manual") || sourceMessage !== null)) {
      return hidden("uncertain");
    }
    // Definite text evidence can establish erasure even when the link state is uncertain.
    const textEvidence = definiteOnly && !messageBacked ? await authoredTextVisibility(input, true) : null;
    if (textEvidence?.reason === "text_withheld") return textEvidence;
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
      if (state === undefined) return hidden("source_memory_missing");
      if (state === null || typeof state !== "object" || Array.isArray(state)) return hidden("uncertain");
      const status = field(state, "status");
      switch (status) {
        case "forgotten":
          return hidden("source_memory_forgotten");
        case "suppressed":
          return hidden("source_memory_not_visible");
        case "unknown":
          return hidden(definiteOnly ? "uncertain" : "source_memory_not_visible");
        case "historical":
        case "visible": {
          const revision = field(state, "revision");
          const unresolvedCorrection = field(state, "unresolvedCorrection");
          if (!natural(revision) ||
              (unresolvedCorrection !== undefined && typeof unresolvedCorrection !== "boolean")) return hidden("uncertain");
          const correctedRevisions = array(field(state, "correctedRevisions"), replaced => {
            if (!natural(replaced) || replaced >= revision) throw new TypeError("Invalid corrected revision");
            return replaced;
          });
          if (!correctedRevisions) return hidden("uncertain");
          if (unresolvedCorrection || correctedRevisions.includes(source.revision)) {
            if (!definiteOnly) return hidden("source_memory_corrected");
          } else if (!messageBacked && (status !== "visible" || revision !== source.revision)) {
            return hidden(definiteOnly ? "uncertain" : "source_memory_not_visible");
          }
          break;
        }
        default:
          return hidden("uncertain");
      }
    }

    if (!messageBacked) return textEvidence ?? await authoredTextVisibility(input, false);
    return { visible: true, reason: null };
  } catch {
    return hidden("uncertain");
  }
}

/** @param {DocumentCardVisibilityInput} input @param {boolean} definiteOnly
 * @returns {Promise<DocumentCardVisibility>} */
async function authoredTextVisibility(input, definiteOnly) {
  try {
    const { card: { title, body, scope }, textFacts, fingerprintKey = null, legacyFingerprint } = input;
    if ((title !== null && typeof title !== "string") || typeof body !== "string") return hidden("uncertain");
    const facts = snapshotReader().array(textFacts, validateSuppressionFact);
    if (!facts?.every(fact => fact.kind === "text") ||
        facts.some(fact => fact.owner !== scope.owner || (fact.namespace ?? null) !== scope.namespace)) {
      return hidden("uncertain");
    }
    let legacy;
    if (legacyFingerprint !== undefined) {
      legacy = await readLegacyFingerprint(legacyFingerprint);
      if (!legacy) return hidden("uncertain");
    }
    if (facts.length > 0) {
      const texts = title === null ? [body] : [title, body];
      let uncertain = !legacy && facts.some(requiresLegacyMacDomain);
      if (uncertain && !definiteOnly) return hidden("text_withheld");
      let memoryFacts = facts;
      if (legacy || definiteOnly) {
        const legacyFacts = [];
        const coreFacts = [];
        for (const fact of facts) {
          const legacyDigests = fact.text.digests.filter(isLegacyMac);
          if (legacyDigests.length === 0) {
            coreFacts.push(fact);
            continue;
          }
          // A fact with aliases in both domains participates in both comparisons.
          const comparable = legacy ? legacyDigests.filter(digest => digest.keyId === legacy.key.id) : [];
          if (comparable.length !== legacyDigests.length) {
            if (!definiteOnly) return hidden("text_withheld");
            uncertain = true;
          }
          if (comparable.length > 0) legacyFacts.push({ ...fact, text: { ...fact.text, digests: comparable } });
          const coreDigests = fact.text.digests.filter(digest => !isLegacyMac(digest));
          if (coreDigests.length > 0) {
            coreFacts.push({ ...fact, text: { ...fact.text, digests: coreDigests } });
          }
        }
        memoryFacts = coreFacts;
        if (legacy && legacyFacts.length > 0) {
          const fingerprints = await Promise.all(texts.map(text => legacyCardPassages(text, legacy)));
          const match = passageWithholding(fingerprints.flat(), legacyFacts, input.containmentThreshold);
          if (match === true || (!definiteOnly && match === "ineligible")) return hidden("text_withheld");
          if (match === "ineligible") uncertain = true;
        }
      }
      if (memoryFacts.length > 0) {
        const fingerprints = await Promise.all(texts.map(text =>
          fingerprintMemoryPassages(text, prepareCoreText(text), fingerprintKey)));
        const match = passageWithholding(fingerprints.flat(), memoryFacts);
        if (match === true || (!definiteOnly && match === "ineligible")) return hidden("text_withheld");
        if (match === "ineligible") uncertain = true;
      }
      if (uncertain) return hidden("uncertain");
    }
    return { visible: true, reason: null };
  } catch {
    return hidden("uncertain");
  }
}

/**
 * @template {{ ref: ItemRef }} T
 * @param {readonly T[]} rows
 * @param {LoadDocumentCardVisibility} loadInput
 */
export async function visibleDocumentCardRows(rows, loadInput) {
  /** @type {T[]} */
  const visible = [];
  /** @type {Partial<Record<DocumentCardRowDropReason, number>>} */
  const drops = {};
  /** @param {DocumentCardRowDropReason} reason */
  const drop = (reason) => { drops[reason] = (drops[reason] ?? 0) + 1; };

  for (const row of rows) {
    const { ref } = row;
    if (ref?.type !== "card") {
      drop("invalid_ref");
      continue;
    }
    let input;
    try {
      input = await loadInput(ref);
    } catch {
      drop("load_failed");
      continue;
    }
    if (input === null) {
      drop("missing_input");
      continue;
    }
    const verdict = await documentCardVisible(input);
    if (!verdict.visible) drop(verdict.reason);
    else if (input.card.id !== ref.id) drop("id_mismatch");
    else if (input.card.scope.namespace !== ref.namespace) drop("scope_mismatch");
    else visible.push(row);
  }
  return { rows: visible, drops };
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
