import { CoreError, PRIVACY_REDACTION_VERSIONS } from "../../core/src/index.mjs";
import { inputText, invalid } from "./memory-input.mjs";
import { advanceIndex } from "./memory-rows.mjs";
import { readVisibilityFacts } from "./memory-visibility.mjs";
import { requireLiveRun, runOperation } from "./uow.mjs";

/** @import { StoredFact, TextDigest, Tx, UnitOfWork } from "../../core/src/index.mjs" */
/** @import { Query } from "./memory-rows.mjs" */

const macPattern = "^[0-9a-f]{64}$";
const maxRotationFacts = 4096;
const validMac = `jsonb_typeof(d->'alg') = 'string' AND length(d->>'alg') BETWEEN 1 AND 512
  AND d->>'pipeline' IN ('core', 'hosted-v1', 'engine-legacy')
  AND jsonb_typeof(d->'keyId') = 'string' AND length(d->>'keyId') BETWEEN 1 AND 64
  AND (CASE WHEN d ? 'label' THEN jsonb_typeof(d->'label') = 'string' AND length(d->>'label') BETWEEN 1 AND 512
    ELSE d->>'alg' = 'hmac' END)
  AND jsonb_typeof(d->'value') = 'string' AND d->>'value' ~ '${macPattern}'
  AND jsonb_typeof(d->'redactionVersion') = 'number' AND d->>'redactionVersion' ~ '^[1-9][0-9]{0,15}([.]0+)?$'
  AND d->'redactionVersion' <= '9007199254740991'::jsonb`;

// Historical records use their pipeline as the signing label, without changing stored JSON.
const macDomain = `jsonb_build_array(d->>'alg', d->>'keyId', COALESCE(d->>'label', d->>'pipeline'),
  d->>'pipeline', d->'redactionVersion')`;

/** @param {Omit<TextDigest, "value">} digest */
function encodeDomain({ alg, keyId, label, pipeline, redactionVersion }) {
  return JSON.stringify([alg, keyId, label ?? pipeline, pipeline, redactionVersion]);
}

/** @param {string} keyId */
function coreDomain(keyId) {
  return encodeDomain({ alg: "hmac", keyId, label: "core", pipeline: "core", redactionVersion: PRIVACY_REDACTION_VERSIONS.core });
}

/** @param {Query} query @param {string} owner @param {ReadonlySet<string>} required */
async function countMissingDigests(query, owner, required) {
  if (!required.size) return { incompleteRows: 0, missingPairs: 0 };
  const { rows: [row] } = await query(`WITH required AS (
    SELECT unnest($2::text[])::jsonb AS domain
  )
  SELECT count(*) FILTER (WHERE missing.pairs > 0)::text AS incomplete_rows,
    COALESCE(sum(missing.pairs), 0)::text AS missing_pairs
  FROM memories CROSS JOIN LATERAL (
    SELECT count(*) AS pairs FROM required WHERE domain NOT IN (
      SELECT ${macDomain} FROM jsonb_array_elements(memories.core_digests) d WHERE ${validMac}
    )
  ) missing WHERE user_id = $1`, [owner, [...required]]);
  return { incompleteRows: Number(row.incomplete_rows), missingPairs: Number(row.missing_pairs) };
}

/** @param {readonly StoredFact[]} facts @param {string | null} [currentKeyId] */
function requiredDomains(facts, currentKeyId) {
  const required = new Set();
  for (const { fact } of facts) {
    if (fact.kind !== "text") continue;
    const { digests, shingles, keyId } = fact.text;
    if (currentKeyId !== undefined && (
      digests.some(digest => digest.keyId !== null && digest.keyId !== currentKeyId) ||
      (shingles != null && keyId != null && keyId !== currentKeyId)
    )) {
      throw new CoreError("fingerprint_key_mismatch");
    }
    // K1 requires stored MACs only when the fact has no keyless digest.
    if (digests.some(digest => digest.keyId === null)) continue;
    for (const digest of digests) required.add(encodeDomain(digest));
  }
  return required;
}

/**
 * The host supplies only the current key ID, or an empty array when keyed Core writes are disabled.
 * @param {UnitOfWork} uow
 * @param {(owner: string) => readonly string[] | Promise<readonly string[]>} keyIdsForOwner
 */
export function createPostgresDigestGate(uow, keyIdsForOwner) {
  return async function digestCoverage(/** @type {string} */ owner) {
    const keyIds = await keyIdsForOwner(inputText(owner));
    if (keyIds.length > 1) invalid();
    return uow.run(owner, { readOnly: true }, tx => runOperation(tx, async query => {
      const facts = await readVisibilityFacts(query, owner, { textOnly: true, allowPendingLegacy: true });
      const required = requiredDomains(facts);
      if (keyIds.length) required.add(coreDomain(inputText(keyIds[0])));
      return countMissingDigests(query, owner, required);
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
 * When changing the pointer, check live and pending keyed facts against the
 * current key, or against the incoming key on first publication.
 * @param {Tx} tx @param {string} nextKeyId
 */
export async function publishFingerprintKey(tx, nextKeyId) {
  requireLiveRun(tx, true);
  return runOperation(tx, async query => {
    // The owner-lock statement may have waited for a legacy writer to commit.
    const { rows: [settings] } = await query("SELECT current_setting('transaction_isolation') AS isolation");
    if (settings?.isolation !== "read committed") throw new CoreError("storage_error");
    const currentKeyId = await readFingerprintKeyId(query, tx.owner);
    const rotating = currentKeyId !== nextKeyId;
    let facts;
    try {
      // Include pending legacy evidence in the coverage and retirement checks.
      facts = await readVisibilityFacts(query, tx.owner,
        { textOnly: true, allowPendingLegacy: true, limit: rotating ? maxRotationFacts + 1 : undefined });
    } catch {
      throw new CoreError("fingerprint_key_mismatch");
    }
    if (rotating && facts.length > maxRotationFacts) throw new CoreError("fingerprint_key_mismatch");
    const required = requiredDomains(facts, rotating ? (currentKeyId ?? nextKeyId) : undefined);
    required.add(coreDomain(nextKeyId));
    if ((await countMissingDigests(query, tx.owner, required)).missingPairs !== 0) {
      throw new CoreError("fingerprint_key_mismatch");
    }
    if (!rotating) return;
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
