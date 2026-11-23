import { inputText } from "./memory-input.mjs";
import { query } from "./uow.mjs";

/** @import { UnitOfWork } from "../../core/src/index.mjs" */

/**
 * The host supplies the accepted key IDs. For cutover, pass only the current key.
 * @param {UnitOfWork} uow
 * @param {(owner: string) => readonly string[] | Promise<readonly string[]>} keyIdsForOwner
 */
export function createPostgresDigestGate(uow, keyIdsForOwner) {
  return async function rowsMissingKeyedDigest(/** @type {string} */ owner) {
    const keys = (await keyIdsForOwner(inputText(owner))).map(inputText);
    if (!keys.length) return 0;
    return uow.run(owner, { readOnly: true }, async tx => {
      const { rows: [row] } = await query(tx, `SELECT count(*)::text AS count FROM memories
        WHERE user_id = $1 AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(coalesce(core_digests, '[]'::jsonb)) d
          WHERE d->>'alg' = 'hmac' AND d->>'keyId' = ANY($2::text[]) AND d->>'value' ~ '^[0-9a-f]{64}$'
        )`, [owner, keys]);
      return Number(row.count);
    });
  };
}
