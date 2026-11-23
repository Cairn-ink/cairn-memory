import { CoreError } from "../../core/src/index.mjs";
import { toPostgresError } from "./errors.mjs";
import { buildFactStorage, canonicalDigests } from "./facts.mjs";
import { requireLiveRun, runOperation } from "./uow.mjs";

/** @import { SuppressionStore } from "../../core/src/ports/privacy.d.ts" */

const HEX64 = /^[0-9a-f]{64}$/u;
const CREATED_AT_US = "trunc(EXTRACT(EPOCH FROM created_at) * 1000000)::text AS created_at_us";
const SELECT_SLOT = `SELECT fact_id, slot, incarnation, epoch::text, ${CREATED_AT_US}
  FROM core_suppression_facts WHERE user_id = $1 AND slot_hash = $2`;
const ADVANCE_OWNER = `INSERT INTO core_owner_state (user_id, fact_epoch, index_revision) VALUES ($1, 1, 1)
  ON CONFLICT (user_id) DO UPDATE SET fact_epoch = core_owner_state.fact_epoch + 1,
  index_revision = core_owner_state.index_revision + 1 RETURNING fact_epoch::text`;
const INSERT_FACT = `INSERT INTO core_suppression_facts (
    user_id, fact_id, slot, slot_hash, incarnation, action_id, epoch, origin, kind, mode, body, embedding, shingles, key_id
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING ${CREATED_AT_US}`;
const INSERT_DIGESTS = `INSERT INTO core_fact_digests (user_id, fact_id, alg, value, pipeline, redaction_version, key_id)
  SELECT $1, $2, * FROM unnest($3::text[], $4::text[], $5::text[], $6::integer[], $7::text[])`;

/** @param {unknown} value */
function integer(value) {
  if (typeof value !== "string" || !/^-?(?:0|[1-9][0-9]*)$/u.test(value)) throw new CoreError("internal_error");
  return BigInt(value);
}

/** @param {unknown} value @param {bigint} minimum */
function readEpoch(value, minimum) {
  const epoch = integer(value);
  if (epoch < minimum || epoch > 9223372036854775807n) throw new CoreError("internal_error");
  return epoch;
}

/** @param {unknown} value */
function readCreatedAtMs(value) {
  const us = integer(value);
  const ms = Number((us - (us < 0n ? 999n : 0n)) / 1000n);
  if (!Number.isSafeInteger(ms)) throw new CoreError("internal_error");
  return ms;
}

/** @type {SuppressionStore["writeFact"]} */
async function writeFact(tx, fact, incarnation) {
  requireLiveRun(tx, true);
  try {
    if (fact?.owner !== tx.owner) throw new CoreError("internal_error");
  } catch {
    throw new CoreError("internal_error");
  }

  if (typeof incarnation !== "string" || !HEX64.test(incarnation)) throw new CoreError("invalid_input");
  const stored = await buildFactStorage(fact).catch((error) => {
    const mapped = toPostgresError(error);
    throw mapped.code === "invalid_window" ? new CoreError("invalid_input") : mapped;
  });
  const { owner, slot, slotHash } = stored;
  // A proxy can report a different owner when storage snapshots its own fields.
  if (owner !== tx.owner) throw new CoreError("internal_error");

  return runOperation(tx, async (query) => {
    const { rows } = await query(SELECT_SLOT, [owner, slotHash]);
    if (rows.length) {
      const { fact_id: factId, slot: existingSlot, incarnation: existingIncarnation, epoch, created_at_us } = rows[0];
      if (existingSlot !== slot || typeof factId !== "string" || !factId ||
        typeof existingIncarnation !== "string" || !HEX64.test(existingIncarnation)) throw new CoreError("internal_error");
      if (existingIncarnation !== incarnation) throw new CoreError("fact_conflict");
      return { factId, epoch: readEpoch(epoch, 1n), createdAtMs: readCreatedAtMs(created_at_us), created: false };
    }

    const { rows: [state] } = await query(ADVANCE_OWNER, [owner]);
    const epoch = readEpoch(state?.fact_epoch, 1n);
    const factId = crypto.randomUUID();
    const { rows: [inserted] } = await query(INSERT_FACT, [
      owner, factId, slot, slotHash, incarnation, stored.actionId, epoch.toString(), stored.origin,
      stored.kind, stored.mode, stored.body, stored.embedding, stored.shingles, stored.keyId,
    ]);
    const createdAtMs = readCreatedAtMs(inserted?.created_at_us);
    if (stored.kind === "text") {
      const digests = canonicalDigests(stored.digests);
      await query(INSERT_DIGESTS, [owner, factId, digests.map((d) => d.alg), digests.map((d) => d.value),
        digests.map((d) => d.pipeline), digests.map((d) => d.redactionVersion), digests.map((d) => d.keyId)]);
    }
    return { factId, epoch, createdAtMs, created: true };
  });
}

/** @type {SuppressionStore["epoch"]} */
async function epoch(tx, owner) {
  requireLiveRun(tx);
  if (owner !== tx.owner) throw new CoreError("internal_error");
  return runOperation(tx, async (query) => {
    const { rows } = await query("SELECT fact_epoch::text FROM core_owner_state WHERE user_id = $1", [owner]);
    if (!rows.length) return null;
    const value = readEpoch(rows[0].fact_epoch, 0n);
    return value === 0n ? null : value;
  });
}

export function createPostgresSuppressionStore() {
  return { writeFact, epoch };
}
