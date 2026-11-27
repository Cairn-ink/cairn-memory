import { CoreError } from "../errors.mjs";
import { redactHostedCurrent, redactV1, PRIVACY_REDACTION_VERSIONS } from "./redact.mjs";
import { boundedText, cleanContent, normalizeForHash, prepareCoreText } from "./text.mjs";

/** @typedef {import("./fingerprint.mjs").FingerprintKey} FingerprintKey */
/** @typedef {import("./fingerprint.mjs").FingerprintLabels} FingerprintLabels */
/** @typedef {import("../suppression-fact.mjs").TextDigest} TextDigest */
/** @typedef {import("../ports/privacy.d.ts").RetainedDigester} RetainedDigester */

const encoder = new TextEncoder();
const hmac = { name: "HMAC", hash: "SHA-256" };

// The key provider supplies the signing key. Adapters own their legacy MAC labels.
export const coreFingerprintLabels = Object.freeze({
  keyIdDomain: "core-key-id", shingleKeyPrefix: "core-shingles:", legacyExactPrefix: "core-exact:",
});

/** @param {ArrayBuffer} bytes */
function toHex(bytes) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** @param {string} text */
async function sha256(text) {
  try {
    return await sha256Hex(text);
  } catch {
    throw new CoreError("fingerprint_unavailable");
  }
}

/** @param {string | Uint8Array} input */
export async function sha256Hex(input) {
  const bytes = typeof input === "string" ? encoder.encode(input) : new Uint8Array(input);
  return toHex(await globalThis.crypto.subtle.digest("SHA-256", bytes));
}

/** @param {BufferSource} bytes */
function signingKey(bytes) {
  return globalThis.crypto.subtle.importKey("raw", bytes, hmac, false, ["sign"]);
}

/** @param {CryptoKey} key @param {string} text */
function sign(key, text) {
  return globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(text));
}

/** @param {unknown} value @returns {Promise<CryptoKey>} */
export async function validateFingerprintSigningKey(value) {
  const key = /** @type {CryptoKey | null | undefined} */ (value);
  if (key?.type !== "secret" || !key.usages.includes("sign")) throw new CoreError("invalid_input");
  const algorithm = /** @type {HmacKeyAlgorithm} */ (key.algorithm);
  if (algorithm.name !== "HMAC" || algorithm.hash.name !== "SHA-256" || algorithm.length !== 256) {
    throw new CoreError("invalid_input");
  }
  await sign(key, "");
  return key;
}

/** @param {object} labels @param {keyof FingerprintLabels} name */
function labelValue(labels, name) {
  /** @type {unknown} */
  const value = Object.getOwnPropertyDescriptor(labels, name)?.value;
  if (typeof value !== "string" || value.length === 0) throw new CoreError("invalid_input");
  return value;
}

const LABEL_KEYS = Object.freeze(["keyIdDomain", "legacyExactPrefix", "shingleKeyPrefix"]);

/**
 * Exactly the three label keys as own properties: no extra string, symbol, or
 * non-enumerable keys. Reflect.ownKeys reads keys only; no getter runs.
 * @param {object} labels
 */
function hasExactlyLabelKeys(labels) {
  const keys = Reflect.ownKeys(labels);
  if (keys.length !== LABEL_KEYS.length) return false;
  if (keys.some((key) => typeof key !== "string")) return false;
  const sorted = /** @type {string[]} */ (keys).slice().sort();
  return sorted.every((key, index) => key === LABEL_KEYS[index]);
}

/** @param {unknown} labels @returns {FingerprintLabels} */
export function validateFingerprintLabels(labels) {
  try {
    if (labels !== null && typeof labels === "object" && !Array.isArray(labels) && Object.isFrozen(labels) &&
      hasExactlyLabelKeys(labels)) {
      return Object.freeze({
        keyIdDomain: labelValue(labels, "keyIdDomain"),
        shingleKeyPrefix: labelValue(labels, "shingleKeyPrefix"),
        legacyExactPrefix: labelValue(labels, "legacyExactPrefix"),
      });
    }
  } catch {
    throw new CoreError("invalid_input");
  }
  throw new CoreError("invalid_input");
}

/** @param {string | null} secret @param {string} userId @param {FingerprintLabels} labels @returns {Promise<FingerprintKey | null>} */
export async function userFingerprintKey(secret, userId, labels) {
  const { keyIdDomain, shingleKeyPrefix } = validateFingerprintLabels(labels);
  if (!secret) return null;
  try {
    const key = await signingKey(encoder.encode(secret));
    const [id, derived] = await Promise.all([
      sign(key, keyIdDomain),
      sign(key, shingleKeyPrefix + userId),
    ]);
    return { id: toHex(id).slice(0, 16), signingKey: await signingKey(derived) };
  } catch {
    throw new CoreError("fingerprint_unavailable");
  }
}

/** @param {string} text @param {FingerprintKey} key @param {string} prefix */
function signLegacyExact(text, key, prefix) {
  return sign(key.signingKey, prefix + text).then(toHex);
}

/** @param {string} text @param {(text: string) => Promise<string>} mac */
async function signShingles(text, mac) {
  const points = Array.from(text);
  const grams = new Set();
  for (let index = 0; index + 4 <= points.length; index++) {
    grams.add(points.slice(index, index + 4).join(""));
  }

  const unique = [...grams];
  const shingles = [];
  for (let start = 0; start < unique.length; start += 128) {
    const batch = unique.slice(start, start + 128);
    shingles.push(...await Promise.all(batch.map(mac)));
  }
  return shingles;
}

/** @param {string} text @param {FingerprintKey} key @param {FingerprintLabels} labels */
export async function legacyExactMac(text, key, labels) {
  const { legacyExactPrefix } = validateFingerprintLabels(labels);
  try {
    return await signLegacyExact(normalizeForHash(text), key, legacyExactPrefix);
  } catch {
    throw new CoreError("fingerprint_unavailable");
  }
}

/** @param {string} text @param {FingerprintKey} key @param {FingerprintLabels} labels */
export async function passageShingles(text, key, labels) {
  validateFingerprintLabels(labels);
  try {
    return await signShingles(normalizeForHash(text), gram => sign(key.signingKey, gram).then(toHex));
  } catch {
    throw new CoreError("fingerprint_unavailable");
  }
}

/** @param {string} text @param {FingerprintKey} key @param {FingerprintLabels} labels */
export async function fingerprintLegacyCapture(text, key, labels) {
  const { legacyExactPrefix } = validateFingerprintLabels(labels);
  try {
    const normalized = normalizeForHash(text);
    const [text_hmac, shingles] = await Promise.all([
      signLegacyExact(normalized, key, legacyExactPrefix),
      signShingles(normalized, gram => sign(key.signingKey, gram).then(toHex)),
    ]);
    return { text_hmac, shingles, key_id: key.id };
  } catch {
    throw new CoreError("fingerprint_unavailable");
  }
}

/** @param {string} raw */
const coreDigestText = raw => normalizeForHash(prepareCoreText(raw));

/** @param {string} raw @param {FingerprintKey | null} [key] @returns {Promise<TextDigest>} */
export async function coreDigest(raw, key) {
  return hashCore(coreDigestText(raw), key);
}

/** @param {string} text @param {FingerprintKey | null} [key] @returns {Promise<TextDigest>} */
async function hashCore(text, key) {
  const version = { pipeline: /** @type {const} */ ("core"), redactionVersion: PRIVACY_REDACTION_VERSIONS.core };
  if (key == null) return { alg: "sha256", value: await sha256(text), ...version, keyId: null };
  try {
    return { alg: "hmac", value: toHex(await sign(key.signingKey, text)), ...version, keyId: key.id };
  } catch {
    throw new CoreError("fingerprint_unavailable");
  }
}

/** @param {string} raw */
const hostedV1Text = raw => normalizeForHash(redactV1(cleanContent(raw)));

/** @param {string} raw @returns {Promise<TextDigest>} */
export async function hostedV1Digest(raw) {
  return hashHostedV1(hostedV1Text(raw));
}

/** @param {string} text @returns {Promise<TextDigest>} */
async function hashHostedV1(text) {
  return { alg: "sha256", value: await sha256(text), pipeline: "hosted-v1", redactionVersion: PRIVACY_REDACTION_VERSIONS.v1, keyId: null };
}

/** @param {unknown} raw @param {number} max @param {number} rawMax */
function engineLegacyText(raw, max, rawMax) {
  try {
    return boundedText(raw, max, false, rawMax).toLowerCase();
  } catch (error) {
    // The engine suppression admission wrapper translates bounded-text refusals.
    if (!(error instanceof CoreError) || error.code !== "invalid_text") throw error;
    return undefined;
  }
}

/** @param {string} text @returns {Promise<TextDigest>} */
async function hashEngineLegacy(text) {
  return { alg: "sha256", value: await sha256(text), pipeline: "engine-legacy", redactionVersion: PRIVACY_REDACTION_VERSIONS.v1, keyId: null };
}

/** @param {unknown} raw @param {number} [max] @param {number} [rawMax] */
export async function engineLegacyDigest(raw, max = 4_000, rawMax = 20_000) {
  const text = engineLegacyText(raw, max, rawMax);
  if (text === undefined) throw new CoreError("invalid_input");
  return hashEngineLegacy(text);
}

/** Builds lookup aliases in pipeline order. An engine admission refusal has no legacy alias.
 * @param {string} raw @param {FingerprintKey | null} [key] @returns {Promise<TextDigest[]>}
 */
export async function allDigests(raw, key) {
  if (typeof raw !== "string") throw new CoreError("invalid_input");
  return digestAliases(raw, key);
}

/** @param {string} raw @param {FingerprintKey | null} [key]
 * @param {(text: string) => boolean} [allows] @returns {Promise<TextDigest[]>}
 */
async function digestAliases(raw, key, allows = () => true) {
  const engine = engineLegacyText(raw, 4_000, 20_000);
  const core = coreDigestText(raw);
  const hosted = hostedV1Text(raw);
  const digests = await Promise.all([
    ...(allows(core) ? [hashCore(core, key)] : []),
    ...(allows(hosted) ? [hashHostedV1(hosted)] : []),
  ]);
  if (engine !== undefined && allows(engine)) digests.push(await hashEngineLegacy(engine));

  const unique = new Map();
  for (const digest of digests) {
    const identity = `${digest.alg}:${digest.value}`;
    if (!unique.has(identity)) unique.set(identity, digest);
  }
  return [...unique.values()];
}

/** @param {TextDigest[]} digests @param {TextDigest} digest */
export function addDigest(digests, digest) {
  if (!digests.some(({ alg, value }) => alg === digest.alg && value === digest.value)) digests.push(digest);
}

/** @param {string} raw @param {string} text */
export function textVariants(raw, text) {
  const original = cleanContent(raw);
  const { v1, hostedCurrent, core } = PRIVACY_REDACTION_VERSIONS;
  return /** @satisfies {Array<[string, TextDigest["pipeline"], number]>} */ ([
    [original, "hosted-v1", v1],
    [redactV1(original), "hosted-v1", v1],
    [redactHostedCurrent(original), "hosted-v1", hostedCurrent],
    [text, "core", core],
    // Hosted capture derives its stored V1 evidence after capture normalization.
    [redactV1(original.normalize("NFKC")), "hosted-v1", v1],
  ]);
}

/** @typedef {ReturnType<typeof textVariants>} TextVariants */

/** @param {string} raw @param {string} text */
function passageSpellings(raw, text) {
  /** @type {Map<string, TextVariants>} */
  const spellings = new Map();
  for (const variant of textVariants(raw, text)) {
    const normalized = normalizeForHash(variant[0]);
    const variants = spellings.get(normalized) ?? [];
    variants.push(variant);
    spellings.set(normalized, variants);
  }
  return spellings;
}

/** @param {string} normalized @param {TextVariants[number]} variant
 * @param {FingerprintKey | null} key @param {(text: string) => Promise<string>} hash
 * @param {(text: string) => boolean} allows
 */
async function passageDigests(normalized, [variant, pipeline, redactionVersion], key, hash, allows) {
  const [digests, exact] = await Promise.all([
    digestAliases(variant, key, allows),
    allows(normalized) ? hash(normalized) : null,
  ]);
  // The aliases re-redact their input. Keep the exact variant for historical facts.
  if (exact !== null) addDigest(digests, { alg: "sha256", value: exact, pipeline, redactionVersion, keyId: null });
  return digests;
}

/** Uses the same exact inputs as candidate fingerprinting, with a filter before hashing.
 * @param {string} raw @param {string} text @param {(text: string) => boolean} allows
 */
export async function unkeyedForgetDigests(raw, text, allows) {
  const variants = await Promise.all(Array.from(passageSpellings(raw, text), ([normalized, spellings]) =>
    passageDigests(normalized, spellings[spellings.length - 1], null, sha256, allows)));
  /** @type {TextDigest[]} */
  const digests = [];
  for (const aliases of variants) {
    for (const digest of aliases) addDigest(digests, digest);
  }
  return digests;
}

/** @param {Map<string, TextVariants>} spellings @param {RetainedDigester} digester */
async function retainedFingerprints(spellings, digester) {
  try {
    const { alg, keyId, label } = digester;
    if (typeof alg !== "string" || !alg || alg.length > 512 ||
        typeof keyId !== "string" || !keyId || keyId.length > 64 ||
        typeof label !== "string" || !label || label.length > 512) return null;
    /** @type {Map<string, Promise<string>>} */
    const signed = new Map();
    /** @param {string} normalized */
    function mac(normalized) {
      let pending = signed.get(normalized);
      if (!pending) {
        pending = Promise.resolve().then(() => digester.mac(normalized)).then(value => {
          if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) throw new CoreError("fingerprint_unavailable");
          return value;
        });
        signed.set(normalized, pending);
      }
      return pending;
    }
    const signedVariants = (await Promise.all(Array.from(spellings, async ([normalized, variants]) => {
      const value = await mac(normalized);
      return variants.map(([, pipeline, redactionVersion]) => ({ alg, keyId, label, value, pipeline, redactionVersion }));
    }))).flat();
    const digests = [...new Map(signedVariants.map(digest =>
      [JSON.stringify([digest.pipeline, digest.redactionVersion, digest.value]), digest])).values()];
    const shingles = alg === "hmac" && label === "core" ?
      await Promise.all(Array.from(spellings.keys(), async normalized => {
        try {
          return { keyId, shingles: await signShingles(normalized, mac) };
        } catch {
          return null;
        }
      })) : [];
    return { digests, shingles };
  } catch {
    // A partial set of exact spellings cannot prove a miss for the signing domain.
    return null;
  }
}

/** Builds withholding evidence under current and historical memory pipelines.
 * @param {string} raw @param {string} text @param {FingerprintKey | null} key
 * @param {(text: string) => Promise<string>} [sha256Hex]
 * @param {readonly RetainedDigester[]} [digesters]
 * @returns {Promise<import("../ports/privacy.d.ts").PassageFingerprint[]>}
 */
export async function fingerprintMemoryPassages(raw, text, key, sha256Hex = sha256, digesters) {
  const spellings = passageSpellings(raw, text);
  const retained = digesters?.length ?
    (await Promise.all(digesters.map(digester => retainedFingerprints(spellings, digester)))).filter(evidence => evidence !== null) : [];
  const retainedDigests = retained.flatMap(evidence => evidence.digests);
  // Each spelling has the complete exact evidence. Containment still checks its own shingles.
  return Promise.all(Array.from(spellings, async ([normalized, variants], index) => {
    const spelling = variants[variants.length - 1];
    const [variant, , redactionVersion] = spelling;
    const [digests, legacy] = await Promise.all([
      passageDigests(normalized, spelling, key, sha256Hex, () => true),
      key && fingerprintLegacyCapture(variant, key, coreFingerprintLabels),
    ]);
    if (legacy) {
      addDigest(digests, {
        alg: "hmac", value: legacy.text_hmac, pipeline: "core", redactionVersion, keyId: legacy.key_id,
      });
    }
    const retainedShingles = retained.map(evidence => evidence.shingles[index]).filter(shingles => shingles != null);
    return { digests: [...digests, ...retainedDigests], shingles: legacy?.shingles ?? null,
      keyId: legacy?.key_id ?? null, ...(retainedShingles.length && { retainedShingles }) };
  }));
}
