import { CoreError, userFingerprintKey } from "../../core/src/index.mjs";
import { publishFingerprintKey, readFingerprintKeyId } from "./digest-gate.mjs";
import { HOSTED_FINGERPRINT_LABELS } from "./fingerprint-labels.mjs";
import { inputText } from "./memory-input.mjs";
import { requireLiveRun, runOperation } from "./uow.mjs";

/** @import { FingerprintKeyProvider } from "../../core/src/ports/privacy.d.ts" */
/** @import { Tx, UnitOfWork } from "../../core/src/index.mjs" */

/**
 * Configured secrets are available for staging. The owner state selects the
 * active key, including across restarts and between hosts.
 * @param {string | null} [secret]
 * @param {{uow?: UnitOfWork, stagedSecrets?: readonly string[]}} [options]
 * @returns {FingerprintKeyProvider & Required<Pick<FingerprintKeyProvider, "userKeyForWrite">> & {publish(owner: string, keyId: string): Promise<void>}}
 */
export function createPostgresFingerprintKeyProvider(secret = null, { uow, stagedSecrets = [] } = {}) {
  const secrets = [...new Set(secret === null ? stagedSecrets : [secret, ...stagedSecrets])];
  if (secrets.some(value => typeof value !== "string" || !value) || (secrets.length && !uow)) {
    throw new CoreError("invalid_input");
  }

  /** @type {Promise<Map<string, string>> | undefined} */
  let configured;
  function configuredSecrets() {
    configured ??= Promise.all(secrets.map(async value => {
      const key = await userFingerprintKey(value, "", HOSTED_FINGERPRINT_LABELS);
      if (!key) throw new CoreError("fingerprint_unavailable");
      return /** @type {const} */ ([key.id, value]);
    })).then(entries => new Map(entries));
    return configured;
  }

  /** @param {Tx} tx */
  async function selectedKey(tx) {
    const keyId = await runOperation(tx, query => readFingerprintKeyId(query, tx.owner));
    if (keyId === null) return null;
    const value = (await configuredSecrets()).get(keyId);
    if (value === undefined) throw new CoreError("fingerprint_key_mismatch");
    return userFingerprintKey(value, tx.owner, HOSTED_FINGERPRINT_LABELS);
  }

  return {
    async userKey(owner) {
      inputText(owner);
      return uow ? uow.run(owner, { readOnly: true }, selectedKey) : null;
    },

    userKeyForWrite(tx) {
      requireLiveRun(tx, true);
      return selectedKey(tx);
    },

    async publish(owner, keyId) {
      inputText(owner);
      if (!uow || !(await configuredSecrets()).has(keyId)) throw new CoreError("fingerprint_key_mismatch");
      await uow.run(owner, {}, tx => publishFingerprintKey(tx, keyId));
    },
  };
}
