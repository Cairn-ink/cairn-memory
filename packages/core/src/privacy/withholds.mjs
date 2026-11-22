import { CONTAINMENT_THRESHOLD } from "../decisions.mjs";
import { FACT_ORIGINS } from "../suppression-fact.mjs";

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
  return digest != null && typeof digest === "object" && !Array.isArray(digest) &&
    (digest.alg === "sha256" || (digest.alg === "hmac" && isKeyId(digest.keyId))) &&
    isHex(digest.value) && digest.value.length === 64;
}

/** @param {readonly TextDigest[]} digests */
const hasValidDigests = (digests) => isDenseArray(digests, isValidDigest) && digests.length > 0;

/** @param {PassageFingerprint | TextFact["text"]} passage */
function isValidFingerprint(passage) {
  return passage != null && typeof passage === "object" &&
    hasValidDigests(passage.digests) &&
    (passage.keyId == null || isKeyId(passage.keyId)) &&
    (passage.shingles == null || (isDenseArray(passage.shingles, isHex) && passage.shingles.length > 0));
}

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
 */
function withholdsValidatedPassage(passage, fact, threshold, checkContainment) {
  const reference = fact.text;
  if (hasExactDigestMatch(passage.digests, reference.digests) ||
      !hasComparableDigests(passage.digests, reference.digests)) return true;
  if (fact.mode === "exact") return false;

  if (!passage.keyId || reference.keyId !== passage.keyId || !passage.shingles || !reference.shingles) return true;
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
    if (checkContainment && (!key || fact.text.keyId !== key.id)) return true;
    // The exemption skips containment only after a comparable exact miss.
    return passages.some((passage) => withholdsValidatedPassage(passage, fact, threshold, checkContainment));
  });
}
