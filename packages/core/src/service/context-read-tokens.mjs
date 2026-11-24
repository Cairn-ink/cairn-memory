import { CoreError } from "../errors.mjs";
import { signedReadToken } from "./signed-read-token.mjs";

export { isReadMac } from "./signed-read-token.mjs";

/** @import { ReadTokenIdentity } from "../ports/host.d.ts" */
/** @typedef {"cursor" | "snapshot"} TokenKind */

export const CONTEXT_VERSION = "context-read-v1";
const TOKEN_LIMITS = { cursor: 8192, snapshot: 16384 };
export const newRankingId = () => globalThis.crypto.randomUUID();

/** @param {ReadTokenIdentity} identity */
export function readTokenSigner({ storeId, cursorKey }) {
  const signer = signedReadToken(cursorKey);
  const input = (/** @type {string} */ purpose, /** @type {unknown} */ value) =>
    JSON.stringify([CONTEXT_VERSION, purpose, storeId, value]);

  return {
    async bind(/** @type {string} */ purpose, /** @type {unknown} */ value) {
      return signer.mac(input(purpose, value));
    },
    async receipt(/** @type {unknown} */ value) {
      return signer.mac(JSON.stringify(["retained-receipt-content-v1", [storeId, value]]));
    },
    async encode(/** @type {TokenKind} */ kind, /** @type {unknown} */ payload) {
      const token = await signer.encode(payload, body => input(kind, body));
      if (token.length > TOKEN_LIMITS[kind]) throw new CoreError("context_item_too_large");
      return token;
    },
    async decode(/** @type {TokenKind} */ kind, /** @type {string} */ token) {
      const code = kind === "cursor" ? "invalid_cursor" : "snapshot_stale";
      if (token.length > TOKEN_LIMITS[kind]) throw new CoreError(code);

      const payload = await signer.decode(token, body => input(kind, body));
      if (payload === undefined) throw new CoreError(code);
      return payload;
    },
  };
}
