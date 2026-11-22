import { CONTAINMENT_THRESHOLD } from "../decisions.mjs";
import { FACT_ORIGINS, validateSuppressionFact } from "../suppression-fact.mjs";

/** @typedef {import("../suppression-fact.mjs").TextDigest} TextDigest */
/** @typedef {import("../suppression-fact.mjs").TextFact} TextFact */
/** @typedef {import("../ports/privacy.d.ts").PassageFingerprint} PassageFingerprint */

/**
 * @template T
 * @param {readonly T[]} values
 * @param {(value: T) => boolean} valid
 */
function isDenseArray(values, valid) {
  if (!Array.isArray(values)) return false;
  for (let index = 0; index < values.length; index++) {
    if (!Object.hasOwn(values, index) || !valid(values[index])) return false;
  }
  return true;
}

/** @param {unknown} value */
const isHex = (value) => typeof value === "string" && /^[0-9a-f]+$/u.test(value);

/** @param {unknown} value */
const isKeyId = (value) => typeof value === "string" && value.length > 0;

/** @param {TextDigest} digest */
function isValidDigest(digest) {
  if (digest == null || typeof digest !== "object" || Array.isArray(digest) ||
      typeof digest.value !== "string") return false;
  try {
    // Validate each record with the same digest rules used when storing a fact.
    validateSuppressionFact({
      owner: "validation", actionId: "validation", kind: "text", origin: "forget", mode: "exact",
      text: { digests: [digest] },
    });
    return true;
  } catch {
    return false;
  }
}

/** @param {readonly TextDigest[]} digests */
const hasValidDigests = (digests) => isDenseArray(digests, isValidDigest) && digests.length > 0;

/** @param {PassageFingerprint | TextFact["text"]} passage */
function isValidFingerprint(passage) {
  return passage != null && typeof passage === "object" && hasValidDigests(passage.digests);
}

/** @param {string[] | null | undefined} shingles */
const isValidShingleList = (shingles) => shingles == null || isDenseArray(shingles, isHex);

/** @param {{ id: string, createdAtMs: number } | null} source */
const isValidSource = (source) => source !== null && typeof source === "object" &&
  typeof source.id === "string" && source.id.length > 0 && Number.isSafeInteger(source.createdAtMs);

/** @param {TextFact} fact */
function isValidFact(fact) {
  return fact != null && fact.kind === "text" && FACT_ORIGINS.includes(fact.origin) &&
    (fact.mode === "exact" || fact.mode === "full") && isValidFingerprint(fact.text) &&
    (fact.sourceMemory == null || isValidSource(fact.sourceMemory));
}

/** @param {number} threshold */
const isValidThreshold = (threshold) => Number.isFinite(threshold) && threshold > 0 && threshold <= 1;

/** @param {TextDigest} digest */
const digestIdentity = ({ alg, value }) => `${alg}:${value}`;

/** @param {readonly TextDigest[]} a @param {readonly TextDigest[]} b */
function hasExactDigestMatch(a, b) {
  const identities = new Set(a.map(digestIdentity));
  return b.some((digest) => identities.has(digestIdentity(digest)));
}

/** @param {readonly TextDigest[]} a @param {readonly TextDigest[]} b */
export function exactDigestMatch(a, b) {
  return !hasValidDigests(a) || !hasValidDigests(b) || hasExactDigestMatch(a, b);
}

/** @param {readonly TextDigest[]} a @param {readonly TextDigest[]} b */
function hasComparableDigests(a, b) {
  return a.some((left) => b.some((right) => left.alg === right.alg &&
    (left.alg === "sha256" || left.keyId === right.keyId)));
}

/**
 * @param {PassageFingerprint} passage
 * @param {TextFact} fact
 * @param {number} threshold
 * @param {boolean} checkContainment
 * @param {boolean} [containmentKeyUnavailable]
 */
function withholdsValidatedPassage(passage, fact, threshold, checkContainment, containmentKeyUnavailable = false) {
  const reference = fact.text;
  if (hasExactDigestMatch(passage.digests, reference.digests) ||
      !hasComparableDigests(passage.digests, reference.digests)) return true;
  if (fact.mode === "exact") return false;

  if (!isValidShingleList(passage.shingles) || !isValidShingleList(reference.shingles)) return true;
  if (passage.shingles?.length === 0 || reference.shingles?.length === 0) return false;
  if (containmentKeyUnavailable || !isKeyId(passage.keyId) || reference.keyId !== passage.keyId ||
      !passage.shingles || !reference.shingles) return true;
  if (!checkContainment) return false;

  const shingles = new Set(passage.shingles);
  const shared = reference.shingles.filter((shingle) => shingles.has(shingle)).length;
  return shared >= threshold * reference.shingles.length;
}

/**
 * @param {PassageFingerprint} passage
 * @param {TextFact} fact
 * @param {number} [threshold]
 */
export function withholdsPassage(passage, fact, threshold = CONTAINMENT_THRESHOLD) {
  if (!isValidFingerprint(passage) || !isValidFact(fact) || !isValidThreshold(threshold)) return true;
  return withholdsValidatedPassage(passage, fact, threshold, true);
}

/**
 * @param {readonly PassageFingerprint[]} passages
 * @param {readonly TextFact[]} facts
 * @param {number} [threshold]
 */
export function withholdsAnyPassage(passages, facts, threshold = CONTAINMENT_THRESHOLD) {
  if (!isDenseArray(passages, isValidFingerprint) || !isDenseArray(facts, isValidFact) ||
      !isValidThreshold(threshold)) return true;
  return passages.some((passage) => facts.some((fact) => withholdsValidatedPassage(passage, fact, threshold, true)));
}

/**
 * @param {readonly PassageFingerprint[]} passages
 * @param {readonly TextFact[]} facts
 * @param {{ id: string } | null} key
 * @param {number} [threshold]
 * @param {{ id: string, createdAtMs: number }} [edit]
 */
export function blocksMemoryPassage(passages, facts, key, threshold = CONTAINMENT_THRESHOLD, edit) {
  if (!isDenseArray(passages, isValidFingerprint) || !isDenseArray(facts, isValidFact) ||
      !isValidThreshold(threshold) || (key != null && !isKeyId(key.id)) ||
      (edit !== undefined && !isValidSource(edit))) return true;

  return facts.some((fact) => {
    const source = fact.sourceMemory;
    const checkContainment = fact.mode === "full" && (fact.origin === "edit"
      ? !edit || !source || source.id !== edit.id || source.createdAtMs !== edit.createdAtMs
      : passages.length > 1);
    const containmentKeyUnavailable = checkContainment && (!key || fact.text.keyId !== key.id);
    if (containmentKeyUnavailable && passages.length === 0) return true;
    // The exemption skips containment only after a comparable exact miss.
    return passages.some((passage) =>
      withholdsValidatedPassage(passage, fact, threshold, checkContainment, containmentKeyUnavailable));
  });
}
