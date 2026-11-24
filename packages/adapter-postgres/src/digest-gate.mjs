import { inputText, invalid } from "./memory-input.mjs";
import { advanceIndex } from "./memory-rows.mjs";
import { readVisibilityFacts } from "./memory-visibility.mjs";
import { runOperation } from "./uow.mjs";

/** @import { UnitOfWork } from "../../core/src/index.mjs" */

const macPattern = "^[0-9a-f]{64}$";
const validMac = `d->>'alg' = 'hmac' AND d->>'pipeline' IN ('core', 'hosted-v1', 'engine-legacy')
  AND jsonb_typeof(d->'keyId') = 'string' AND length(d->>'keyId') BETWEEN 1 AND 64
  AND jsonb_typeof(d->'value') = 'string' AND d->>'value' ~ '${macPattern}'
  AND jsonb_typeof(d->'redactionVersion') = 'number' AND d->>'redactionVersion' ~ '^[1-9][0-9]{0,15}$'
  AND d->'redactionVersion' <= '9007199254740991'::jsonb`;

/**
 * The host supplies the accepted key IDs. For cutover, pass only the current key.
 * @param {UnitOfWork} uow
 * @param {(owner: string) => readonly string[] | Promise<readonly string[]>} keyIdsForOwner
 */
export function createPostgresDigestGate(uow, keyIdsForOwner) {
  return async function rowsMissingKeyedDigest(/** @type {string} */ owner) {
    const keys = (await keyIdsForOwner(inputText(owner))).map(inputText);
    return uow.run(owner, { readOnly: true }, tx => runOperation(tx, async query => {
      const required = new Set();
      for (const { fact } of await readVisibilityFacts(query, owner, true)) {
        if (fact.kind !== "text" || fact.text.digests.some(d => d.alg !== "hmac")) continue;
        for (const { pipeline, keyId } of fact.text.digests) required.add(JSON.stringify([pipeline, keyId]));
      }
      if (!keys.length && !required.size) return 0;
      const { rows: [row] } = await query(`WITH required AS (
        SELECT unnest($3::text[])::jsonb AS domain
      )
      SELECT count(*)::text AS count FROM memories
      WHERE user_id = $1 AND (
        (cardinality($2::text[]) > 0 AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(core_digests) d
          WHERE ${validMac} AND d->>'keyId' = ANY($2::text[])
        )) OR EXISTS (
          SELECT 1 FROM required WHERE NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(core_digests) d
            WHERE ${validMac} AND d->>'pipeline' = domain->>0 AND d->>'keyId' = domain->>1
          )
        )
      )`, [owner, keys, [...required]]);
      return Number(row.count);
    }));
  };
}

/**
 * Run at cutover with the owner's memory writers paused. The callback signs the
 * stored text using the host's legacy MAC domain and returns lowercase hex.
 * @param {UnitOfWork} uow @param {string} owner
 * @param {{keyId: string, redactionVersion: number, macForText: (text: string) => string | Promise<string>}} options
 */
export async function backfillPostgresHostedDigests(uow, owner, { keyId, redactionVersion, macForText }) {
  if (!inputText(owner) || !inputText(keyId) || keyId.length > 64 ||
      !Number.isSafeInteger(redactionVersion) || redactionVersion < 1 || typeof macForText !== "function") invalid();
  const mac = new RegExp(macPattern, "u");
  return uow.run(owner, {}, tx => runOperation(tx, async query => {
    const { rows } = await query(`SELECT id, text FROM memories
      WHERE user_id = $1 AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(core_digests) d
        WHERE ${validMac} AND d->>'pipeline' = 'hosted-v1' AND d->>'keyId' = $2
      ) ORDER BY id COLLATE "C" FOR UPDATE`, [owner, keyId]);
    for (const { id, text } of rows) {
      const value = await macForText(text);
      if (typeof value !== "string" || !mac.test(value)) invalid();
      const digest = { alg: "hmac", pipeline: "hosted-v1", keyId, redactionVersion, value };
      await query(`UPDATE memories SET core_digests = COALESCE(core_digests, '[]'::jsonb) || $3::jsonb
        WHERE user_id = $1 AND id = $2`, [owner, id, JSON.stringify([digest])]);
    }
    if (rows.length) await advanceIndex(query, owner);
    return rows.length;
  }));
}
