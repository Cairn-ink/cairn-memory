import { CoreError, PRIVACY_REDACTION_VERSIONS } from "../../core/src/index.mjs";
import { inputText, invalid } from "./memory-input.mjs";
import { advanceIndex } from "./memory-rows.mjs";
import { readVisibilityFacts } from "./memory-visibility.mjs";
import { requireLiveRun, runOperation } from "./uow.mjs";

/** @import { StoredFact, TextDigest, Tx, UnitOfWork } from "../../core/src/index.mjs" */
/** @import { Query } from "./memory-rows.mjs" */

const macPattern = "^[0-9a-f]{64}$";
const maxRotationFacts = 4096;
const validMac = `d->>'alg' = 'hmac' AND d->>'pipeline' IN ('core', 'hosted-v1', 'engine-legacy')
  AND jsonb_typeof(d->'keyId') = 'string' AND length(d->>'keyId') BETWEEN 1 AND 64
  AND (NOT d ? 'label' OR (jsonb_typeof(d->'label') = 'string' AND length(d->>'label') BETWEEN 1 AND 512))
  AND jsonb_typeof(d->'value') = 'string' AND d->>'value' ~ '${macPattern}'
  AND jsonb_typeof(d->'redactionVersion') = 'number' AND d->>'redactionVersion' ~ '^[1-9][0-9]{0,15}$'
  AND d->'redactionVersion' <= '9007199254740991'::jsonb`;

// Historical records use their pipeline as the signing label, without changing stored JSON.
const macDomain = `jsonb_build_array(d->>'alg', d->>'keyId', COALESCE(d->>'label', d->>'pipeline'),
  d->>'pipeline', d->'redactionVersion')`;

/** @param {Omit<TextDigest, "value">} digest */
function encodeDomain({ alg, keyId, label, pipeline, redactionVersion }) {
  return JSON.stringify([alg, keyId, label ?? pipeline, pipeline, redactionVersion]);
}

/** @param {Query} query @param {string} owner @param {readonly string[]} keys @param {ReadonlySet<string>} required */
async function countMissingDigests(query, owner, keys, required) {
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
        WHERE ${validMac} AND ${macDomain} = domain
      )
    )
  )`, [owner, keys, [...required]]);
  return Number(row.count);
}

/** @param {readonly StoredFact[]} facts @param {string | null} [currentKeyId] */
function requiredDomains(facts, currentKeyId) {
  const required = new Set();
  for (const { fact } of facts) {
    if (fact.kind !== "text" || fact.text.digests.some(d => d.alg !== "hmac")) continue;
    for (const digest of fact.text.digests) {
      if (currentKeyId !== undefined && digest.keyId !== currentKeyId) throw new CoreError("fingerprint_key_mismatch");
      required.add(encodeDomain(digest));
    }
  }
  return required;
}

/**
 * The host supplies the accepted key IDs. For cutover, pass only the current key.
 * @param {UnitOfWork} uow
 * @param {(owner: string) => readonly string[] | Promise<readonly string[]>} keyIdsForOwner
 */
export function createPostgresDigestGate(uow, keyIdsForOwner) {
  return async function rowsMissingKeyedDigest(/** @type {string} */ owner) {
    const keys = (await keyIdsForOwner(inputText(owner))).map(inputText);
    return uow.run(owner, { readOnly: true }, tx => runOperation(tx, async query => {
      const facts = await readVisibilityFacts(query, owner, { textOnly: true, allowPendingLegacy: true });
      return countMissingDigests(query, owner, keys, requiredDomains(facts));
    }));
  };
}

/** @param {Query} query @param {string} owner @returns {Promise<string | null>} */
export async function readFingerprintKeyId(query, owner) {
  const { rows: [state] } = await query("SELECT fingerprint_key_id FROM core_owner_state WHERE user_id = $1", [owner]);
  return state?.fingerprint_key_id ?? null;
}

/**
 * Check staging and change the owner pointer in the same write transaction.
 * K2 refuses publication when a live HMAC-only fact needs a non-current key.
 * @param {Tx} tx @param {string} nextKeyId
 */
export async function publishFingerprintKey(tx, nextKeyId) {
  requireLiveRun(tx, true);
  return runOperation(tx, async query => {
    const currentKeyId = await readFingerprintKeyId(query, tx.owner);
    if (currentKeyId === nextKeyId) return;
    let facts;
    try {
      facts = await readVisibilityFacts(query, tx.owner, { textOnly: true, limit: maxRotationFacts + 1 });
    } catch {
      throw new CoreError("fingerprint_key_mismatch");
    }
    if (facts.length > maxRotationFacts) throw new CoreError("fingerprint_key_mismatch");
    const required = requiredDomains(facts, currentKeyId);
    required.add(encodeDomain({ alg: "hmac", keyId: nextKeyId, pipeline: "core", redactionVersion: PRIVACY_REDACTION_VERSIONS.core }));
    if (await countMissingDigests(query, tx.owner, [], required) !== 0) {
      throw new CoreError("fingerprint_key_mismatch");
    }
    await query(`INSERT INTO core_owner_state (user_id, fingerprint_key_id) VALUES ($1, $2)
      ON CONFLICT (user_id) DO UPDATE SET fingerprint_key_id = EXCLUDED.fingerprint_key_id`, [tx.owner, nextKeyId]);
  });
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
  const domain = /** @type {const} */ ({ alg: "hmac", keyId, label: "hosted-v1", pipeline: "hosted-v1", redactionVersion });
  return uow.run(owner, {}, tx => runOperation(tx, async (query, run) => {
    const { rows } = await query(`SELECT id, text FROM memories
      WHERE user_id = $1 AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(core_digests) d
        WHERE ${validMac} AND ${macDomain} = $2::jsonb
      ) ORDER BY id COLLATE "C" FOR UPDATE`, [owner, encodeDomain(domain)]);
    for (const { id, text } of rows) {
      const value = await macForText(text);
      if (typeof value !== "string" || !mac.test(value)) invalid();
      await query(`UPDATE memories SET core_digests = COALESCE(core_digests, '[]'::jsonb) || $3::jsonb
        WHERE user_id = $1 AND id = $2`, [owner, id, JSON.stringify([{ ...domain, value }])]);
    }
    if (rows.length) await advanceIndex(query, owner, run);
    return rows.length;
  }));
}
