import { identifier, validateObject } from "../capture/validate.mjs";
import { CoreError } from "../errors.mjs";
import { decodeCursor, encodeCursor } from "../retrieval/hosted-paging.mjs";

/** @import { ClockAndHash, InspectReceiptAnchor, ReadTokenIdentity, Scope } from "../ports/index.d.ts" */
/** @typedef {{ v: 1, s: string, n: string, o: "list", f: string, l: number, states?: string } |
 * { v: 1, s: string, n: string, o: "get", m: string, l: number }} Binding */

const hmac = { name: "HMAC", hash: "SHA-256" };
const encoder = new TextEncoder();

/** @param {Uint8Array} bytes */
function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

/** @param {string} value */
function fromBase64url(value) {
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  if (base64url(bytes) !== value) throw new CoreError("invalid_cursor");
  return bytes;
}

/** @param {string} hex */
function digestBytes(hex) {
  if (!/^[\da-f]{64}$/iu.test(hex)) throw new CoreError("internal_error");
  return Uint8Array.from(hex.match(/../gu) ?? [], byte => Number.parseInt(byte, 16));
}

/** @param {number} value */
function positiveInteger(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

/** @param {unknown} value */
function timeKey(value) {
  const parts = typeof value === "string" && /^((?:\d{4}|[+-]\d{6})-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?Z$/u.exec(value);
  if (!parts) throw new CoreError("invalid_cursor");
  const whole = parts[1] + ".000Z";
  const ms = Date.parse(whole);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== whole) throw new CoreError("invalid_cursor");
  return BigInt(ms) * 1000n + BigInt((parts[2] ?? "").padEnd(6, "0"));
}

/** @param {bigint} us */
function isoTime(us) {
  const remainder = (us % 1000n + 1000n) % 1000n;
  const milliseconds = (us - remainder) / 1000n;
  const iso = new Date(Number(milliseconds)).toISOString();
  return remainder === 0n ? iso : iso.slice(0, -1) + remainder.toString().padStart(3, "0") + "Z";
}

/** Match legacy core/contract.mjs:330–375,437–484.
 * @param {ReadTokenIdentity} identity
 * @param {ClockAndHash} clock
 */
export function inspectTokens({ storeId, cursorKey }, clock) {
  /** @param {string} value */
  const sign = async value => digestBytes(await clock.hmacHex(cursorKey, value));

  /** @param {string} body @param {Uint8Array<ArrayBuffer>} signature */
  async function verify(body, signature) {
    if (signature.length !== 32) return false;
    const bytes = encoder.encode(body);
    if (cursorKey instanceof Uint8Array || cursorKey.usages.includes("verify")) {
      const key = cursorKey instanceof Uint8Array
        ? await globalThis.crypto.subtle.importKey("raw", new Uint8Array(cursorKey), hmac, false, ["verify"])
        : cursorKey;
      return globalThis.crypto.subtle.verify("HMAC", key, signature, bytes);
    }
    // Sign-only handles can still be compared with the platform's constant-time
    // MAC verification, using a fresh key for the comparison.
    const comparisonKey = /** @type {CryptoKey} */ (
      await globalThis.crypto.subtle.generateKey(hmac, false, ["sign", "verify"])
    );
    const expected = await globalThis.crypto.subtle.sign("HMAC", comparisonKey, await sign(body));
    return globalThis.crypto.subtle.verify("HMAC", comparisonKey, expected, signature);
  }

  return {
    /** @param {Scope} scope @param {number} limit @param {{ memoryId?: string, state?: string }} filter @returns {Promise<Binding>} */
    async binding({ owner, namespace }, limit, { memoryId, state }) {
      const parts = namespace?.split("\0") ?? [];
      const [kind, projectId] = parts;
      const legacy = parts.length === 2 && (kind === "personal" && projectId === "" || kind === "project" && projectId);
      const publicScope = legacy
        ? { ownerId: owner, scope: kind, projectId: projectId || null }
        : { ownerId: owner, namespace };
      const base = /** @type {const} */ ({ v: 1, s: storeId, n: base64url(await sign(JSON.stringify(publicScope))) });
      return memoryId === undefined
        ? { ...base, o: "list", f: "filed,unfiled", l: limit, ...(state && { states: state }) }
        : { ...base, o: "get", m: memoryId, l: limit };
    },

    /** @param {string} cursor @param {Binding} binding */
    async decode(cursor, binding) {
      try {
        const parts = cursor.split(".");
        if (parts.length !== 2 || !parts.every(part => /^[A-Za-z0-9_-]+$/u.test(part)) ||
            !await verify(parts[0], fromBase64url(parts[1]))) throw new CoreError("invalid_cursor");
        fromBase64url(parts[0]);
        const keys = Object.keys(binding);
        const payload = validateObject(decodeCursor(parts[0]), [...keys, "e", "a"]);
        if (Object.keys(payload).length !== keys.length + 2 ||
            Object.entries(binding).some(([key, value]) => payload[key] !== value) ||
            typeof payload.e !== "number" || !positiveInteger(payload.e)) throw new CoreError("invalid_cursor");
        return { epoch: payload.e, anchor: payload.a };
      } catch {
        throw new CoreError("invalid_cursor");
      }
    },

    /** @param {Binding} binding @param {number} epoch @param {object} anchor */
    async encode(binding, epoch, anchor) {
      const body = encodeCursor({ ...binding, e: epoch, a: anchor });
      return body + "." + base64url(await sign(body));
    },
  };
}

/** @param {unknown} anchor */
export function listAnchor(anchor) {
  try {
    const { updatedAt, id } = validateObject(anchor, ["updatedAt", "id"]);
    return { updatedAtUs: timeKey(updatedAt), id: identifier(id) };
  } catch {
    throw new CoreError("invalid_cursor");
  }
}

/** @param {{ updatedAtUs: bigint, id: string }} row */
export function encodeListAnchor({ updatedAtUs, id }) {
  return { updatedAt: isoTime(updatedAtUs), id };
}

/** @param {unknown} anchor @returns {InspectReceiptAnchor} */
export function receiptAnchor(anchor) {
  try {
    const fields = validateObject(anchor, ["row", "createdAt", "id"]);
    if (Object.keys(fields).length === 1 && typeof fields.row === "number" && positiveInteger(fields.row)) return { row: fields.row };
    if (Object.keys(fields).length !== 2) throw new CoreError("invalid_cursor");
    const createdAtUs = timeKey(fields.createdAt);
    return { createdAtUs, createdAtMs: Number(createdAtUs / 1000n), id: identifier(fields.id) };
  } catch {
    throw new CoreError("invalid_cursor");
  }
}

/** @param {InspectReceiptAnchor} anchor */
export function encodeReceiptAnchor(anchor) {
  if ("row" in anchor) return anchor;
  const { createdAtMs, createdAtUs, id } = anchor;
  return { createdAt: isoTime(createdAtUs ?? BigInt(createdAtMs) * 1000n), id };
}
