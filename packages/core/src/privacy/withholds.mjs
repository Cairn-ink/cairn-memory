import { CONTAINMENT_THRESHOLD } from "../decisions.mjs";
import { validateSuppressionFact } from "../suppression-fact.mjs";

/** @typedef {import("../suppression-fact.mjs").TextDigest} TextDigest */
/** @typedef {import("../suppression-fact.mjs").TextFact} TextFact */
/** @typedef {import("../ports/privacy.d.ts").PassageFingerprint} PassageFingerprint */

function invalidSnapshot() {
  throw new TypeError("Invalid withholding input");
}

/** @param {unknown} value */
function string(value) {
  if (typeof value !== "string") invalidSnapshot();
  return value;
}

/** @param {unknown} value */
function finiteNumber(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) invalidSnapshot();
  return value;
}

/** @param {unknown} value */
const optionalString = (value) => value == null ? value : string(value);

/** @param {unknown} value */
function record(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalidSnapshot();
  return value;
}

export function snapshotReader() {
  // Share captured properties even when a record appears in multiple input slots.
  /** @type {WeakMap<object, Map<PropertyKey, PropertyDescriptor | undefined>>} */
  const captured = new WeakMap();

  /** @param {object} input @param {PropertyKey} name */
  function dataProperty(input, name) {
    let properties = captured.get(input);
    if (!properties) {
      properties = new Map();
      captured.set(input, properties);
    }
    if (!properties.has(name)) {
      // Capture the data value in one descriptor read, including for proxies.
      const property = Object.getOwnPropertyDescriptor(input, name);
      if (property && !Object.hasOwn(property, "value")) invalidSnapshot();
      properties.set(name, property);
    }
    return properties.get(name);
  }

  /** @param {object} input @param {PropertyKey} name @returns {unknown} */
  const field = (input, name) => dataProperty(input, name)?.value;

  /**
   * @template T
   * @param {unknown} input
   * @param {(value: unknown) => T} copy
   * @param {boolean} [allowHoles]
   */
  function array(input, copy, allowHoles = false) {
    if (!Array.isArray(input)) invalidSnapshot();
    const length = finiteNumber(field(input, "length"));
    if (!Number.isInteger(length) || length < 0 || length > 0xffff_ffff) invalidSnapshot();
    const values = [];
    for (let index = 0; index < length; index++) {
      const property = dataProperty(input, index);
      if (!property && !allowHoles) return undefined;
      values.push(copy(property?.value));
    }
    return Object.freeze(values);
  }

  /**
   * @template T
   * @param {unknown} input
   * @param {(value: unknown) => T} copy
   */
  const list = (input, copy) => array(input, copy) ?? invalidSnapshot();

  /** @param {unknown} input */
  function digest(input) {
    const data = record(input);
    return Object.freeze({
      alg: string(field(data, "alg")),
      value: string(field(data, "value")),
      pipeline: string(field(data, "pipeline")),
      redactionVersion: finiteNumber(field(data, "redactionVersion")),
      keyId: optionalString(field(data, "keyId")),
    });
  }

  /** @param {unknown} input */
  const digests = (input) => list(input, digest);

  /** @param {unknown} input */
  function fingerprint(input) {
    const data = record(input);
    const shingles = field(data, "shingles");
    return Object.freeze({
      digests: digests(field(data, "digests")),
      // Sparse shingle evidence matters only for full-mode comparisons.
      shingles: shingles == null ? shingles : array(shingles, string) ?? false,
      keyId: optionalString(field(data, "keyId")),
    });
  }

  /** @param {unknown} input */
  function source(input) {
    const data = record(input);
    return Object.freeze({
      id: string(field(data, "id")),
      createdAtMs: finiteNumber(field(data, "createdAtMs")),
    });
  }

  /** @param {unknown} input */
  function fact(input) {
    const data = record(input);
    const text = record(field(data, "text"));
    const mode = string(field(data, "mode"));
    let textSnapshot;
    if (mode === "exact") {
      textSnapshot = fingerprint(text);
    } else {
      const embedding = field(text, "embedding");
      textSnapshot = {
        ...fingerprint(text),
        embedding: embedding == null ? embedding : list(embedding, (item) => item),
      };
    }
    const sourceMemory = field(data, "sourceMemory");
    return Object.freeze({
      kind: string(field(data, "kind")),
      origin: string(field(data, "origin")),
      mode,
      text: Object.freeze(textSnapshot),
      sourceMemory: sourceMemory == null ? sourceMemory : source(sourceMemory),
    });
  }

  /** @param {unknown} input */
  const keyId = (input) => input == null ? null : string(field(record(input), "id"));

  return { dataProperty, field, array, list, digests, fingerprint, source, fact, keyId };
}

/** @typedef {ReturnType<ReturnType<typeof snapshotReader>["digests"]>[number]} DigestSnapshot */
/** @typedef {ReturnType<ReturnType<typeof snapshotReader>["fingerprint"]>} FingerprintSnapshot */
/** @typedef {ReturnType<ReturnType<typeof snapshotReader>["fact"]>} FactSnapshot */

/** @param {unknown} value */
const isHex = (value) => typeof value === "string" && /^[0-9a-f]+$/u.test(value);

/** @param {unknown} value */
const isKeyId = (value) => typeof value === "string" && value.length > 0;

/** @param {readonly DigestSnapshot[]} digests */
function hasValidDigests(digests) {
  if (digests.length === 0) return false;
  for (const digest of digests) {
    // Validate each record with the same digest rules used when storing a fact.
    try {
      validateSuppressionFact({
        owner: "validation", actionId: "validation", kind: "text", origin: "forget", mode: "exact",
        text: { digests: [digest] },
      });
    } catch {
      return false;
    }
  }
  return true;
}

/** @param {{ digests?: readonly DigestSnapshot[] } | null | undefined} passage */
export function isValidFingerprint(passage) {
  return Array.isArray(passage?.digests) && hasValidDigests(passage.digests);
}

/** @param {{ id: string, createdAtMs: number }} source */
const isValidSource = (source) => source.id.length > 0 && Number.isSafeInteger(source.createdAtMs);

/** @param {FactSnapshot} fact */
function isValidFact(fact) {
  if (fact.kind !== "text") return false;
  try {
    // Exact facts keep the fingerprint shape checks and validate only digest content.
    const text = fact.mode === "exact" ? { digests: fact.text.digests } : fact.text;
    validateSuppressionFact({ owner: "validation", actionId: "validation", ...fact, text });
    return true;
  } catch {
    return false;
  }
}

/** @param {unknown} threshold @returns {threshold is number} */
export const isValidThreshold = (threshold) => typeof threshold === "number" && threshold > 0 && threshold <= 1;

/** @param {DigestSnapshot} digest */
const digestIdentity = ({ alg, value }) => `${alg}:${value}`;

/** @param {readonly DigestSnapshot[]} a @param {readonly DigestSnapshot[]} b */
function hasExactDigestMatch(a, b) {
  const identities = new Set(a.map(digestIdentity));
  return b.some((digest) => identities.has(digestIdentity(digest)));
}

/** @param {readonly TextDigest[]} a @param {readonly TextDigest[]} b */
export function exactDigestMatch(a, b) {
  try {
    const snapshot = snapshotReader();
    const left = snapshot.digests(a);
    const right = snapshot.digests(b);
    return !hasValidDigests(left) || !hasValidDigests(right) || hasExactDigestMatch(left, right);
  } catch {
    return true;
  }
}

/** @param {readonly DigestSnapshot[]} a @param {readonly DigestSnapshot[]} b */
export function compareValidatedDigests(a, b) {
  let result = /** @type {false | "ineligible"} */ ("ineligible");
  for (const left of a) {
    for (const right of b) {
      if (left.alg !== right.alg) continue;
      // SHA aliases compare by hash. Keyed digests also need the same signing domain.
      if (left.alg === "hmac" && (left.keyId !== right.keyId || left.pipeline !== right.pipeline)) continue;
      if (left.value === right.value) return true;
      result = false;
    }
  }
  return result;
}

/**
 * @param {Pick<FingerprintSnapshot, "shingles" | "keyId">} passage
 * @param {Partial<Pick<FingerprintSnapshot, "shingles" | "keyId">>} reference
 * @param {number} threshold
 * @param {boolean} checkContainment
 * @param {boolean} [containmentKeyUnavailable]
 */
export function shingleContainmentMatch(passage, reference, threshold, checkContainment, containmentKeyUnavailable = false) {
  if (!Array.isArray(passage.shingles) || !Array.isArray(reference.shingles) ||
      !passage.shingles.every(isHex) || !reference.shingles.every(isHex)) return "ineligible";
  if (!isKeyId(passage.keyId) || !isKeyId(reference.keyId)) return "ineligible";
  if (!checkContainment) return false;
  if (containmentKeyUnavailable || reference.keyId !== passage.keyId) return "ineligible";
  if (passage.shingles.length === 0 || reference.shingles.length === 0) return false;

  const shingles = new Set(passage.shingles);
  const shared = reference.shingles.filter((shingle) => shingles.has(shingle)).length;
  // Round toward withholding at the threshold.
  return shared > 0 && shared / reference.shingles.length >= threshold - 1e-12;
}

/**
 * @param {FingerprintSnapshot} passage
 * @param {FactSnapshot} fact
 * @param {number} threshold
 * @param {boolean} checkContainment
 * @param {boolean} [containmentKeyUnavailable]
 */
function withholdsValidatedPassage(passage, fact, threshold, checkContainment, containmentKeyUnavailable) {
  if (compareValidatedDigests(passage.digests, fact.text.digests) !== false) return true;
  if (fact.mode === "exact") return false;
  return shingleContainmentMatch(passage, fact.text, threshold, checkContainment, containmentKeyUnavailable) !== false;
}

/**
 * @param {PassageFingerprint} passage
 * @param {TextFact} fact
 * @param {number} [threshold]
 */
export function withholdsPassage(passage, fact, threshold = CONTAINMENT_THRESHOLD) {
  return withholdsAnyPassage([passage], [fact], threshold);
}

/** @param {TextFact} fact */
export function requiresLegacyMacDomain({ text }) {
  // Legacy MAC labels are adapter-owned. With only keyed digests, core cannot prove a miss.
  return text.digests.every(digest => digest.alg === "hmac") &&
    text.digests.some(digest => digest.pipeline !== "core");
}

/**
 * @param {readonly PassageFingerprint[]} passages
 * @param {readonly TextFact[]} facts
 * @param {number} [threshold]
 */
export function withholdsAnyPassage(passages, facts, threshold = CONTAINMENT_THRESHOLD) {
  try {
    const snapshot = snapshotReader();
    const candidates = snapshot.list(passages, snapshot.fingerprint);
    const stored = snapshot.list(facts, snapshot.fact);
    const cutoff = finiteNumber(threshold);
    if (!candidates.every(isValidFingerprint) || !stored.every(isValidFact) || !isValidThreshold(cutoff)) return true;
    return candidates.some((passage) => stored.some((fact) => withholdsValidatedPassage(passage, fact, cutoff, true)));
  } catch {
    return true;
  }
}

/**
 * @param {readonly PassageFingerprint[]} passages
 * @param {readonly TextFact[]} facts
 * @param {{ id: string } | null} key
 * @param {number} [threshold]
 * @param {{ id: string, createdAtMs: number }} [edit]
 */
export function blocksMemoryPassage(passages, facts, key, threshold = CONTAINMENT_THRESHOLD, edit) {
  try {
    const snapshot = snapshotReader();
    const candidates = snapshot.list(passages, snapshot.fingerprint);
    const stored = snapshot.list(facts, snapshot.fact);
    const activeKeyId = snapshot.keyId(key);
    const cutoff = finiteNumber(threshold);
    const edited = edit === undefined ? undefined : snapshot.source(edit);
    if (!candidates.every(isValidFingerprint) || !stored.every(isValidFact) || !isValidThreshold(cutoff) ||
        (activeKeyId !== null && !isKeyId(activeKeyId)) || (edited && !isValidSource(edited))) return true;

    return stored.some((fact) => {
      const source = fact.sourceMemory;
      const checkContainment = fact.mode === "full" && (fact.origin === "edit"
        ? !edited || !source || source.id !== edited.id || source.createdAtMs !== edited.createdAtMs
        // Stricter than hosted after a key change: see checksExplicitPassages.
        : candidates.length > 1 || candidates.some((passage) => passage.keyId !== fact.text.keyId));
      const containmentKeyUnavailable = checkContainment && (activeKeyId === null || fact.text.keyId !== activeKeyId);
      if (containmentKeyUnavailable && candidates.length === 0) return true;
      // The exemption skips containment only after a comparable exact miss.
      return candidates.some((passage) =>
        withholdsValidatedPassage(passage, fact, cutoff, checkContainment, containmentKeyUnavailable));
    });
  } catch {
    return true;
  }
}
