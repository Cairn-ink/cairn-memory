import { CoreError } from "../errors.mjs";

/** @import { ReadTokenIdentity } from "../ports/host.d.ts" */
/** @typedef {"cursor" | "snapshot"} TokenKind */

export const CONTEXT_VERSION = "context-read-v1";
const TOKEN_LIMITS = { cursor: 8192, snapshot: 16384 };
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
export const newRankingId = () => globalThis.crypto.randomUUID();
/** @param {unknown} value @returns {value is string} */
export function isReadMac(value) {
  return typeof value === "string" && value.length === 43 && /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(value);
}

/** @param {Uint8Array} bytes */
function encodeBytes(bytes) {
  return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(""))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** @param {string} value */
function decodeBytes(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new TypeError("invalid_base64url");
  const bytes = Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), char => char.charCodeAt(0));
  if (encodeBytes(bytes) !== value) throw new TypeError("invalid_base64url");
  return bytes;
}

/** @param {ReadTokenIdentity} identity */
export function readTokenSigner({ storeId, cursorKey }) {
  const algorithm = { name: "HMAC", hash: "SHA-256" };
  const key = cursorKey instanceof Uint8Array ?
    globalThis.crypto.subtle.importKey("raw", new Uint8Array(cursorKey), algorithm, false, ["sign", "verify"]) :
    Promise.resolve(cursorKey);

  const input = (/** @type {string} */ purpose, /** @type {unknown} */ value) =>
    encoder.encode(JSON.stringify([CONTEXT_VERSION, purpose, storeId, value]));

  /** @param {Uint8Array<ArrayBuffer>} bytes */
  async function mac(bytes) {
    return new Uint8Array(await globalThis.crypto.subtle.sign("HMAC", await key, bytes));
  }

  return {
    async bind(/** @type {string} */ purpose, /** @type {unknown} */ value) {
      return encodeBytes(await mac(input(purpose, value)));
    },
    async receipt(/** @type {unknown} */ value) {
      return encodeBytes(await mac(encoder.encode(JSON.stringify(["retained-receipt-content-v1", [storeId, value]]))));
    },
    async encode(/** @type {TokenKind} */ kind, /** @type {unknown} */ payload) {
      const body = encodeBytes(encoder.encode(JSON.stringify(payload)));
      const token = body + "." + encodeBytes(await mac(input(kind, body)));
      if (token.length > TOKEN_LIMITS[kind]) throw new CoreError("context_item_too_large");
      return token;
    },
    async decode(/** @type {TokenKind} */ kind, /** @type {string} */ token) {
      const code = kind === "cursor" ? "invalid_cursor" : "snapshot_stale";
      if (token.length > TOKEN_LIMITS[kind]) throw new CoreError(code);

      const [body, signature, extra] = token.split(".");
      if (!body || !isReadMac(signature) || extra !== undefined) throw new CoreError(code);
      const digest = decodeBytes(signature);
      const signingKey = await key;
      const bytes = input(kind, body);
      if (!await globalThis.crypto.subtle.verify("HMAC", signingKey, digest, bytes)) throw new CoreError(code);
      try {
        return /** @type {unknown} */ (JSON.parse(decoder.decode(decodeBytes(body))));
      } catch {
        throw new CoreError(code);
      }
    },
  };
}
