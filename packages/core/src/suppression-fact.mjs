import { CoreError } from "./errors.mjs";
import { compareUtf8 } from "./utf8.mjs";

// One SuppressionFact union for every store. Facts are permanent. A retry of the same fact
// (same incarnation) returns the original; a different incarnation for the same fact slot is
// fact_conflict (hard error, the whole transaction rolls back). The incarnation hashes
// factIncarnationBody: the canonical body without a text fact's embedding, because provider
// embeddings are not bit-for-bit repeatable and a second forget of the same text must not
// conflict. Stores keep the full factBody.
export const FACT_KINDS = Object.freeze(["identity", "text", "session", "window", "rawSpan"]);
export const FACT_ORIGINS = Object.freeze(["forget", "correct", "edit", "backfill", "import"]);
// exact: digest match only. full: digests + shingles + vector neighbours (where capable).
export const FACT_MODES = Object.freeze(["exact", "full"]);
export const DIGEST_PIPELINES = Object.freeze(["core", "hosted-v1", "engine-legacy"]);

const HEX = /^[0-9a-f]+$/u;
const HEX64 = /^[0-9a-f]{64}$/u;
/** @param {unknown} value */
const isHex64 = (value) => typeof value === "string" && HEX64.test(value);

function fail() {
  throw new CoreError("invalid_input");
}
/** @param {unknown} v @param {number} [max] @returns {v is string} */
const str = (v, max = 512) => typeof v === "string" && v.length > 0 && v.length <= max;
/** @param {unknown} v */
const ms = (v) => Number.isSafeInteger(v);
/** @param {unknown} v */
const nat = (v) => Number.isSafeInteger(v) && /** @type {number} */ (v) >= 0;

/** @param {any} s */
function validateSessionRef(s) {
  if (!s || typeof s !== "object" || !str(s.client, 128)) fail();
  const plain = "sessionId" in s;
  const hashed = "sessionKeyHash" in s;
  if (plain === hashed) fail();
  if (plain ? !str(s.sessionId, 512) : !isHex64(s.sessionKeyHash)) fail();
}

/** @param {any} digests */
function validateDigests(digests) {
  if (!Array.isArray(digests) || digests.length === 0) fail();
  const seen = new Set();
  for (const d of digests) {
    if (!d || typeof d !== "object" || (d.alg !== "sha256" && d.alg !== "hmac")) fail();
    if (!isHex64(d.value) || !DIGEST_PIPELINES.includes(d.pipeline)) fail();
    if (!Number.isSafeInteger(d.redactionVersion) || d.redactionVersion < 1) fail();
    if (d.alg === "hmac" ? !str(d.keyId, 64) : d.keyId !== null) fail();
    const key = `${d.alg}:${d.value}`;
    if (seen.has(key)) fail();
    seen.add(key);
  }
}

/** @param {unknown} values @param {(value: unknown) => boolean} isValid */
function validateArrayItems(values, isValid) {
  if (!Array.isArray(values)) fail();
  const length = Object.getOwnPropertyDescriptor(values, "length")?.value;
  if (!Number.isInteger(length) || length < 0 || length > 0xffff_ffff) fail();
  for (let index = 0; index < length; index++) {
    const item = Object.getOwnPropertyDescriptor(values, index);
    if (!item || !Object.hasOwn(item, "value") || !isValid(item.value)) fail();
  }
}

/**
 * Validates a fact before it reaches a store. Never inspects or returns content.
 * @param {unknown} fact
 */
export function validateSuppressionFact(fact) {
  if (!fact || typeof fact !== "object") fail();
  const f = /** @type {Record<string, any>} */ (fact);
  if (!str(f.owner) || !str(f.actionId, 128) || !FACT_KINDS.includes(f.kind) || !FACT_ORIGINS.includes(f.origin)) fail();
  if (f.namespace !== undefined && f.namespace !== null && !str(f.namespace)) fail();
  switch (f.kind) {
    case "identity":
      if (!str(f.memoryId, 512)) fail();
      if (f.throughRevision !== undefined && !nat(f.throughRevision)) fail();
      break;
    case "text": {
      if (!FACT_MODES.includes(f.mode)) fail();
      const t = f.text;
      if (!t || typeof t !== "object") fail();
      validateDigests(t.digests);
      const { shingles, embedding } = t;
      if (shingles != null) validateArrayItems(shingles, (item) => typeof item === "string" && HEX.test(item));
      if (embedding != null) validateArrayItems(embedding, Number.isFinite);
      if (t.keyId !== undefined && t.keyId !== null && !str(t.keyId, 64)) fail();
      if (f.sourceMemory !== undefined && f.sourceMemory !== null &&
        (!str(f.sourceMemory.id, 512) || !ms(f.sourceMemory.createdAtMs))) fail();
      break;
    }
    case "session":
      validateSessionRef(f.session);
      break;
    case "window": {
      if (f.client !== null && !str(f.client, 128)) fail();
      const w = f.window;
      // Legacy hosted windows may predate the epoch; only ordering is required.
      if (!w || !ms(w.startMs) || !ms(w.endMs) || w.endMs <= w.startMs) throw new CoreError("invalid_window");
      if (f.unknownTime !== undefined && f.unknownTime !== true) fail();
      if (f.anchor !== undefined && f.anchor !== "pm30min") fail();
      break;
    }
    case "rawSpan":
      if (!isHex64(f.sessionKeyHash) || !str(f.messageKey, 512) || !isHex64(f.contentDigest)) fail();
      if (!nat(f.startUtf16) || !nat(f.endUtf16) || f.endUtf16 <= f.startUtf16) fail();
      break;
    default:
      fail();
  }
  return /** @type {import("./suppression-fact.mjs").SuppressionFact} */ (fact);
}

/** @param {unknown} value @returns {unknown} */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const key of Object.keys(value).sort()) {
      const v = /** @type {Record<string, unknown>} */ (value)[key];
      if (v !== undefined) out[key] = canonical(v);
    }
    return out;
  }
  return value;
}

/**
 * Order of a text fact's digests in its body: alg, then value (the set key), then the
 * remaining fields, so the order is deterministic even for input that skipped validation.
 * @param {any} x @param {any} y
 */
function compareDigests(x, y) {
  return compareUtf8(String(x.alg), String(y.alg)) || compareUtf8(String(x.value), String(y.value)) ||
    compareUtf8(String(x.pipeline), String(y.pipeline)) ||
    compareUtf8(String(x.redactionVersion), String(y.redactionVersion)) ||
    compareUtf8(String(x.keyId), String(y.keyId)) ||
    compareCodeUnits(JSON.stringify(x), JSON.stringify(y));
}

/** Last-resort total order (UTF-16 code units), e.g. for lone surrogates that share UTF-8 bytes. */
function compareCodeUnits(/** @type {string} */ a, /** @type {string} */ b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Canonical JSON of the full fact body without owner and actionId: what a store keeps.
 * @param {import("./suppression-fact.mjs").SuppressionFact} fact
 */
export function factBody(fact) {
  const { owner: _owner, actionId: _actionId, ...body } = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (fact));
  // A text fact's digests are a set: order them by (alg, value) so the same set always
  // yields the same incarnation. Other arrays keep their given order.
  const text = /** @type {{ digests?: unknown } | undefined} */ (body.text);
  if (body.kind === "text" && text && Array.isArray(text.digests)) {
    body.text = { ...text, digests: [...text.digests].sort(compareDigests) };
  }
  return JSON.stringify(canonical(body));
}

/**
 * Canonical JSON that the incarnation hashes (ClockAndHash) before SuppressionStore.writeFact:
 * factBody without a text fact's `text.embedding`. Everything else in a text body is
 * deterministic for a given text and key; the stored fact keeps its original embedding.
 * @param {import("./suppression-fact.mjs").SuppressionFact} fact
 */
export function factIncarnationBody(fact) {
  // Derived from factBody's own canonical output, so it sees exactly what factBody saw.
  const body = factBody(fact);
  const parsed = JSON.parse(body);
  if (parsed.kind !== "text" || !parsed.text || typeof parsed.text !== "object") return body;
  delete parsed.text.embedding;
  return JSON.stringify(parsed);
}
