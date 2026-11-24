import { CoreError } from "../errors.mjs";

/** @import { ClockAndHash, ReadTokenIdentity } from "../ports/index.d.ts" */

const algorithm = { name: "HMAC", hash: "SHA-256" };
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const base64url = /^[A-Za-z0-9_-]+$/u;

/** @param {unknown} value @returns {value is string} */
export function isReadMac(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u.test(value);
}

/** @param {Uint8Array} bytes */
function encodeBytes(bytes) {
  return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(""))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

/** @param {string} value */
function decodeBytes(value) {
  const bytes = Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), char => char.charCodeAt(0));
  if (encodeBytes(bytes) !== value) throw new TypeError("invalid_base64url");
  return bytes;
}

/** @param {string} hex */
function digestBytes(hex) {
  if (!/^[\da-f]{64}$/iu.test(hex)) throw new CoreError("internal_error");
  return Uint8Array.from(hex.match(/../gu) ?? [], byte => Number.parseInt(byte, 16));
}

/** @param {ReadTokenIdentity["cursorKey"]} cursorKey @param {ClockAndHash} [clock] */
export function signedReadToken(cursorKey, clock) {
  /** @type {Promise<CryptoKey> | undefined} */
  let importedKey;
  const key = cursorKey instanceof Uint8Array
    ? () => importedKey ??= globalThis.crypto.subtle.importKey("raw", new Uint8Array(cursorKey), algorithm, false, ["sign", "verify"])
    : () => cursorKey;

  /** @param {string} value */
  async function sign(value) {
    if (clock) return digestBytes(await clock.hmacHex(cursorKey, value));
    return new Uint8Array(await globalThis.crypto.subtle.sign("HMAC", await key(), encoder.encode(value)));
  }

  /** @param {string} value @param {Uint8Array<ArrayBuffer>} signature */
  async function verify(value, signature) {
    const signingKey = await key();
    if (signingKey.usages.includes("verify") || !clock) {
      return globalThis.crypto.subtle.verify("HMAC", signingKey, signature, encoder.encode(value));
    }
    // Legacy inspect accepts opaque sign-only handles. Compare the two MACs
    // through the platform's constant-time verifier under a fresh key.
    const comparisonKey = /** @type {CryptoKey} */ (
      await globalThis.crypto.subtle.generateKey(algorithm, false, ["sign", "verify"])
    );
    const expected = await globalThis.crypto.subtle.sign("HMAC", comparisonKey, await sign(value));
    return globalThis.crypto.subtle.verify("HMAC", comparisonKey, expected, signature);
  }

  return {
    /** @param {string} value */
    async mac(value) { return encodeBytes(await sign(value)); },

    /** @param {unknown} payload @param {(body: string) => string} [bind] */
    async encode(payload, bind = body => body) {
      const body = encodeBytes(encoder.encode(JSON.stringify(payload)));
      return body + "." + encodeBytes(await sign(bind(body)));
    },

    /** @param {string} token @param {(body: string) => string} [bind] @returns {Promise<unknown>} */
    async decode(token, bind = body => body) {
      const [body, signature, extra] = token.split(".");
      if (!body || !base64url.test(body) || !isReadMac(signature) || extra !== undefined ||
          !await verify(bind(body), decodeBytes(signature))) return undefined;
      try {
        return JSON.parse(decoder.decode(decodeBytes(body)));
      } catch {
        return undefined;
      }
    },
  };
}
