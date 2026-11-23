import {
  allDigests, CoreError, factBlocksIncoming, factHidesRow, PRIVACY_REDACTION_VERSIONS, validateSuppressionFact,
} from "../../core/src/index.mjs";
import { floorMillis, readReceipts } from "./memory-rows.mjs";

/** @import { FactMatchIncoming, FactMatchRow, StoredFact, TextDigest } from "../../core/src/index.mjs" */
/** @import { DuplicateQuery, Receipt, Scope, SourceRef } from "../../core/src/ports/index.d.ts" */
/** @import { MemoryEntry, Query } from "./memory-rows.mjs" */

const policy = { vectorSuppression: true, rowShingles: false };
const capture = /** @type {const} */ ({ ...policy, mode: "capture" });
const explicitSave = /** @type {const} */ ({ ...policy, mode: "explicitSave" });

/** @param {string} value */
function digestValue(value) {
  // The hosted column can contain a legacy bare SHA-256.
  return /^(?:sha256:)?[0-9a-f]{64}$/u.test(value) ? value.replace(/^sha256:/u, "") : null;
}

/** @param {Pick<DuplicateQuery, "textHash" | "legacyHash" | "digests">} candidate */
function digestAliases({ textHash, legacyHash, digests = [] }) {
  const result = [...digests];
  for (const hash of [textHash, legacyHash]) {
    const value = hash === undefined ? null : digestValue(hash);
    if (value && !result.some(digest => digest.alg === "sha256" && digest.value === value)) {
      /** @type {TextDigest["pipeline"]} */
      const pipeline = hash === legacyHash ? "engine-legacy" : "core";
      result.push({ alg: "sha256", value, pipeline, redactionVersion: PRIVACY_REDACTION_VERSIONS.core, keyId: null });
    }
  }
  return result;
}

/** @param {Query} query @param {string} owner */
export async function readVisibility(query, owner) {
  // Keep reads and admission closed during the legacy copy when there is legacy evidence.
  const { rows: [state] } = await query(`SELECT EXISTS (
    SELECT 1 FROM suppressions WHERE user_id = $1
  ) AND NOT EXISTS (
    SELECT 1 FROM core_owner_state WHERE user_id = $1 AND legacy_facts_ready
  ) AS legacy_pending`, [owner]);
  if (state.legacy_pending) throw new CoreError("ineligible");

  const { rows } = await query(`SELECT fact_id, action_id, incarnation, epoch::text, body,
    (EXTRACT(EPOCH FROM created_at) * 1000000)::bigint::text AS created_us
    FROM core_suppression_facts WHERE user_id = $1 AND kind IN ('identity', 'text', 'session')`, [owner]);
  /** @type {Map<Scope["namespace"], StoredFact[]>} */
  const byNamespace = new Map();
  for (const row of rows) {
    const fact = validateSuppressionFact({ ...row.body, owner, actionId: row.action_id });
    const ns = fact.namespace ?? null;
    let facts = byNamespace.get(ns);
    if (!facts) byNamespace.set(ns, facts = []);
    facts.push({ fact, factId: row.fact_id, incarnation: row.incarnation, epoch: BigInt(row.epoch),
      createdAtMs: floorMillis(BigInt(row.created_us)) });
  }

  /** @param {MemoryEntry} entry @param {readonly Receipt[]} evidence */
  async function hides({ memory, digests }, evidence) {
    const { scope, id, revision, text, textHash, embedding } = memory;
    const facts = byNamespace.get(scope.namespace);
    if (!facts?.length) return false;
    /** @type {FactMatchRow} */
    const candidate = { type: "memory", scope, memoryId: id, revision, embedding: embedding?.vector };
    if (facts.some(({ fact }) => fact.kind === "text")) {
      candidate.digests = digestAliases({ textHash, digests: digests ?? await allDigests(text) });
    }
    return facts.some((stored) => {
      if (stored.fact.kind === "session") {
        return evidence.some(({ client, sessionId, occurredAtMs }) =>
          factHidesRow(stored, { ...candidate, source: { client, sessionId, occurredAtMs } }, policy) !== false);
      }
      return factHidesRow(stored, candidate, policy) !== false;
    });
  }

  /** @param {readonly MemoryEntry[]} entries @param {boolean} [includeReceipts] */
  async function check(entries, includeReceipts = false) {
    const ids = entries.filter(({ memory }) => includeReceipts ||
      byNamespace.get(memory.scope.namespace)?.some(({ fact }) => fact.kind === "session")).map(({ memory }) => memory.id);
    const receipts = await readReceipts(query, owner, ids);
    return Promise.all(entries.map(async (entry) => {
      const evidence = receipts.get(entry.memory.id) ?? [];
      return { ...entry, evidence, hidden: await hides(entry, evidence) };
    }));
  }

  /** @param {Scope} scope @param {DuplicateQuery} incoming @param {"hash" | "full"} mode
   * @param {FactMatchIncoming["sourceMemory"]} sourceMemory */
  function blocks(scope, incoming, mode, sourceMemory) {
    const passages = [{ digests: digestAliases(incoming), embedding: incoming.embedding }];
    return byNamespace.get(scope.namespace)?.some((stored) => stored.fact.kind === "text" &&
      factBlocksIncoming(stored, { scope, passages, sourceMemory }, mode === "hash" ? explicitSave : capture) !== false) ?? false;
  }

  /** @param {Scope} scope @param {Pick<SourceRef, "client" | "sessionId">} source */
  function blocksSession(scope, { client, sessionId }) {
    if (client === null || sessionId === null) return false;
    return byNamespace.get(scope.namespace)?.some((stored) => stored.fact.kind === "session" &&
      factBlocksIncoming(stored, { scope, passages: [], session: { client, sessionId } }, capture) !== false) ?? false;
  }

  return { check, blocks, blocksSession };
}
