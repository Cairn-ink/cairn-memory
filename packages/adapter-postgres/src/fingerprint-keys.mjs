import { CoreError, userFingerprintKey } from "../../core/src/index.mjs";
import { HOSTED_FINGERPRINT_LABELS } from "./fingerprint-labels.mjs";

/** @import { FingerprintKeyProvider } from "../../core/src/ports/privacy.d.ts" */

/** @param {string | null} [secret] @returns {FingerprintKeyProvider} */
export function createPostgresFingerprintKeyProvider(secret = null) {
  if (secret !== null && (typeof secret !== "string" || secret.length === 0)) throw new CoreError("invalid_input");
  return { userKey: (owner) => userFingerprintKey(secret, owner, HOSTED_FINGERPRINT_LABELS) };
}
