import { CoreError } from "../errors.mjs";
import { redactV1, PRIVACY_REDACTION_VERSIONS } from "./redact.mjs";
import { cleanContent, normalizeForHash, prepareCoreText } from "./text.mjs";

/** @typedef {import("./fingerprint.mjs").FingerprintKey} FingerprintKey */
/** @typedef {import("./fingerprint.mjs").FingerprintLabels} FingerprintLabels */
/** @typedef {import("../suppression-fact.mjs").TextDigest} TextDigest */

const encoder = new TextEncoder();
const hmac = { name: "HMAC", hash: "SHA-256" };

/** @param {ArrayBuffer} bytes */
function toHex(bytes) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** @param {string} text */
async function sha256(text) {
  try {
    return toHex(await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(text)));
  } catch {
    throw new CoreError("fingerprint_unavailable");
  }
}

/** @param {BufferSource} bytes */
function signingKey(bytes) {
  return globalThis.crypto.subtle.importKey("raw", bytes, hmac, false, ["sign"]);
}

/** @param {CryptoKey} key @param {string} text */
function sign(key, text) {
  return globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(text));
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

/** @param {string} text @param {FingerprintKey} key */
async function signShingles(text, key) {
  const points = Array.from(text);
  const grams = new Set();
  for (let index = 0; index + 4 <= points.length; index++) {
    grams.add(points.slice(index, index + 4).join(""));
  }

  const unique = [...grams];
  const shingles = [];
  for (let start = 0; start < unique.length; start += 128) {
    const batch = unique.slice(start, start + 128);
    shingles.push(...await Promise.all(batch.map((gram) => sign(key.signingKey, gram).then(toHex))));
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
    return await signShingles(normalizeForHash(text), key);
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
      signShingles(normalized, key),
    ]);
    return { text_hmac, shingles, key_id: key.id };
  } catch {
    throw new CoreError("fingerprint_unavailable");
  }
}

/** @param {string} raw @param {FingerprintKey | null} [key] @returns {Promise<TextDigest>} */
export async function coreDigest(raw, key) {
  const text = normalizeForHash(prepareCoreText(raw));
  const version = { pipeline: /** @type {const} */ ("core"), redactionVersion: PRIVACY_REDACTION_VERSIONS.core };
  if (key == null) return { alg: "sha256", value: await sha256(text), ...version, keyId: null };
  try {
    return { alg: "hmac", value: toHex(await sign(key.signingKey, text)), ...version, keyId: key.id };
  } catch {
    throw new CoreError("fingerprint_unavailable");
  }
}

/** @param {string} raw @returns {Promise<TextDigest>} */
export async function hostedV1Digest(raw) {
  const text = normalizeForHash(redactV1(cleanContent(raw)));
  return { alg: "sha256", value: await sha256(text), pipeline: "hosted-v1", redactionVersion: PRIVACY_REDACTION_VERSIONS.v1, keyId: null };
}

/** @param {unknown} raw @param {number} max @param {number} rawMax */
function engineLegacyText(raw, max, rawMax) {
  if (typeof raw !== "string" || raw.length > rawMax) return;
  const text = redactV1(raw.normalize("NFKC")).replace(/\s+/gu, " ").trim();
  if (!text || text === "[REDACTED]" || text.includes("\0") || text.length > max) return;
  return text.toLowerCase();
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
  const engine = engineLegacyText(raw, 4_000, 20_000);
  const digests = await Promise.all([coreDigest(raw, key), hostedV1Digest(raw)]);
  if (engine !== undefined) digests.push(await hashEngineLegacy(engine));

  const unique = new Map();
  for (const digest of digests) {
    const identity = `${digest.alg}:${digest.value}`;
    if (!unique.has(identity)) unique.set(identity, digest);
  }
  return [...unique.values()];
}
