import { CONTAINMENT_THRESHOLD } from "../decisions.mjs";

/** @typedef {import("../suppression-fact.mjs").TextDigest} TextDigest */
/** @typedef {import("../suppression-fact.mjs").TextFact} TextFact */
/** @typedef {import("../ports/privacy.d.ts").PassageFingerprint} PassageFingerprint */

/** @param {TextDigest} digest */
const digestIdentity = ({ alg, value }) => `${alg}:${value}`;

/** @param {readonly TextDigest[]} a @param {readonly TextDigest[]} b */
export function exactDigestMatch(a, b) {
  const identities = new Set(a.map(digestIdentity));
  return b.some((digest) => identities.has(digestIdentity(digest)));
}

/** @param {unknown} shingles @returns {shingles is string[]} */
function hasShingles(shingles) {
  if (!Array.isArray(shingles)) return false;
  for (const shingle of shingles) {
    if (typeof shingle !== "string") return false;
  }
  return true;
}

/**
 * @param {PassageFingerprint} passage
 * @param {TextFact} fact
 * @param {number} [threshold]
 */
export function withholdsPassage(passage, fact, threshold = CONTAINMENT_THRESHOLD) {
  const reference = fact.text;
  if (exactDigestMatch(passage.digests, reference.digests)) return true;
  if (fact.mode === "exact") return false;

  if (typeof passage.keyId !== "string" || !passage.keyId || reference.keyId !== passage.keyId ||
      !hasShingles(passage.shingles) || !hasShingles(reference.shingles) ||
      !Number.isFinite(threshold) || threshold <= 0 || threshold > 1) return true;
  if (!reference.shingles.length) return false;

  const shingles = new Set(passage.shingles);
  const shared = reference.shingles.filter((shingle) => shingles.has(shingle)).length;
  return shared >= threshold * reference.shingles.length;
}

/**
 * @param {readonly PassageFingerprint[]} passages
 * @param {readonly TextFact[]} facts
 * @param {number} [threshold]
 */
export function withholdsAnyPassage(passages, facts, threshold = CONTAINMENT_THRESHOLD) {
  return passages.some((passage) => facts.some((fact) => withholdsPassage(passage, fact, threshold)));
}

/**
 * @param {readonly PassageFingerprint[]} passages
 * @param {readonly TextFact[]} facts
 * @param {{ id: string } | null} key
 * @param {number} [threshold]
 * @param {{ id: string, createdAtMs: number }} [edit]
 */
export function blocksMemoryPassage(passages, facts, key, threshold = CONTAINMENT_THRESHOLD, edit) {
  // Exact matches still block when a memory rephrases its own old wording.
  if (passages.some((passage) => facts.some((fact) => exactDigestMatch(passage.digests, fact.text.digests)))) {
    return true;
  }

  const applicable = facts.filter((fact) => {
    if (fact.mode === "exact") return false;
    if (fact.origin !== "edit") return passages.length > 1;
    const source = fact.sourceMemory;
    return !edit || !source || source.id !== edit.id || source.createdAtMs !== edit.createdAtMs;
  });
  return applicable.some((fact) => !key || fact.text.keyId !== key.id) ||
    withholdsAnyPassage(passages, applicable, threshold);
}
