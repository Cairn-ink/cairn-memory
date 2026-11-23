import {
  allDigests, CoreError, factBlocksIncoming, factHidesRow, PRIVACY_REDACTION_VERSIONS, validateSuppressionFact,
} from "../../core/src/index.mjs";
import { CREATED_MS, floorMillis, MATCH_COLUMNS, readReceipts, TEXT_HASH } from "./memory-rows.mjs";

/** @import { FactMatchIncoming, FactMatchRow, StoredFact, TextDigest } from "../../core/src/index.mjs" */
/** @import { DuplicateQuery, Receipt, Scope, SourceRef } from "../../core/src/ports/index.d.ts" */
/** @import { CandidateEntry, MemoryEntry, Query } from "./memory-rows.mjs" */

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

/** @param {any} row @param {string} owner @returns {StoredFact} */
function legacyFact(row, owner) {
  const { id, kind, origin, client, session_id, start_ms, end_ms, text_hash, text_hmac, key_id, embedding, redaction_version } = row;
  const base = { owner, kind, origin: origin ?? "backfill", actionId: "legacy" };
  let body;
  if (kind === "session") {
    body = { ...base, session: { client, sessionId: session_id } };
  } else if (kind === "window") {
    body = { ...base, client, window: { startMs: Number(start_ms), endMs: Number(end_ms) } };
  } else {
    /** @type {TextDigest[]} */
    const digests = [];
    const sha = digestValue(text_hash);
    const hmacs = new Set([text_hash.startsWith("hmac:") ? text_hash.slice(5) : null, text_hmac].filter(Boolean));
    const label = /** @type {const} */ ({ pipeline: "hosted-v1", redactionVersion: redaction_version });
    if (sha) digests.push({ ...label, alg: "sha256", value: sha, keyId: null });
    for (const value of hmacs) digests.push({ ...label, alg: "hmac", value, keyId: key_id });
    body = { ...base, mode: "full", text: { digests, embedding: JSON.parse(embedding) } };
  }
  return { fact: validateSuppressionFact(body), factId: id, incarnation: "", epoch: 0n, createdAtMs: 0 };
}

/** @param {StoredFact} stored */
function usesSource({ fact }) {
  return fact.kind === "session" || fact.kind === "window";
}

/** @param {Query} query @param {string} owner */
export async function readVisibility(query, owner) {
  // Both halves see the same statement snapshot while legacy writers are still active.
  const { rows } = await query(`WITH owner_state AS (
    SELECT legacy_facts_ready AS ready, legacy_writes_reconciled AS reconciled
    FROM core_owner_state WHERE user_id = $1
  )
  SELECT false AS legacy, false AS pending, fact_id, action_id, incarnation, epoch::text, body,
    (EXTRACT(EPOCH FROM created_at) * 1000000)::bigint::text AS created_us
    FROM core_suppression_facts WHERE user_id = $1 AND kind IN ('identity', 'text', 'session', 'window')
  UNION ALL
  SELECT true, NOT COALESCE((SELECT ready FROM owner_state), false), id, NULL, NULL, NULL,
    jsonb_build_object('id', id, 'kind', kind, 'origin', origin, 'client', client, 'session_id', session_id,
      'start_ms', floor(EXTRACT(EPOCH FROM window_start) * 1000),
      'end_ms', ceil(EXTRACT(EPOCH FROM window_end) * 1000),
      'text_hash', text_hash, 'text_hmac', text_hmac, 'key_id', key_id,
      'embedding', embedding::text, 'redaction_version', redaction_version), NULL
    FROM suppressions WHERE user_id = $1
      AND NOT COALESCE((SELECT ready AND reconciled FROM owner_state), false)`, [owner]);
  if (rows.some(row => row.pending)) throw new CoreError("ineligible");
  /** @type {Map<Scope["namespace"], StoredFact[]>} */
  const byNamespace = new Map();
  for (const row of rows) {
    const stored = row.legacy ? legacyFact(row.body, owner) : {
      fact: validateSuppressionFact({ ...row.body, owner, actionId: row.action_id }),
      factId: row.fact_id, incarnation: row.incarnation, epoch: BigInt(row.epoch),
      createdAtMs: floorMillis(BigInt(row.created_us)),
    };
    const ns = stored.fact.namespace ?? null;
    let facts = byNamespace.get(ns);
    if (!facts) byNamespace.set(ns, facts = []);
    facts.push(stored);
  }

  /** @param {Scope["namespace"]} namespace @param {{exact?: boolean, distance?: boolean}} [options] */
  function candidateColumns(namespace, { exact, distance } = {}) {
    const facts = byNamespace.get(namespace) ?? [];
    const textFacts = facts.flatMap(({ fact }) => fact.kind === "text" ? [fact] : []);
    const aliases = textFacts.some(fact => fact.text.digests.some(d => d.alg === "sha256"));
    const vector = textFacts.some(fact => fact.mode === "full" && fact.text.embedding != null);
    const columns = [MATCH_COLUMNS];
    if (exact || textFacts.length) columns.push(`${TEXT_HASH} AS logical_hash`);
    if (textFacts.length) columns.push("core_digests");
    if (aliases) columns.push("CASE WHEN core_digests IS NULL THEN text END AS text");
    if (facts.some(usesSource)) columns.push("source_client", "source_session_id", `${CREATED_MS}::text AS created_ms`);
    if (vector || distance) columns.push("embedding::text");
    return columns.join(", ");
  }

  /** @param {MemoryEntry | CandidateEntry} entry @param {readonly Receipt[]} evidence */
  async function hides({ memory, digests }, evidence) {
    const { scope, id, revision, text, textHash, embedding } = memory;
    const facts = byNamespace.get(scope.namespace);
    if (!facts?.length) return false;
    /** @type {FactMatchRow} */
    const candidate = { type: "memory", scope, memoryId: id, revision, embedding: embedding?.vector };
    if (facts.some(({ fact }) => fact.kind === "text")) {
      candidate.digests = digestAliases({ textHash, digests: digests ?? (text === undefined ? [] : await allDigests(text)) });
    }
    return facts.some((stored) => {
      if (usesSource(stored)) {
        if (evidence.length) {
          // On receipt-backed memories, windows govern admission. Session facts also fence reads.
          return stored.fact.kind === "session" && evidence.some(({ client, sessionId }) =>
            factHidesRow(stored, { ...candidate, source: { client, sessionId } }, policy) !== false);
        }
        const { source: { client, sessionId }, createdAtMs, updatedAtMs } = memory;
        if (stored.fact.kind === "session") {
          return client !== null && sessionId !== null &&
            factHidesRow(stored, { ...candidate, source: { client, sessionId } }, policy) !== false;
        }
        return [createdAtMs, updatedAtMs].some(occurredAtMs =>
          factHidesRow(stored, { ...candidate, source: { client: client ?? "", sessionId, occurredAtMs } }, policy) !== false);
      }
      return factHidesRow(stored, candidate, policy) !== false;
    });
  }

  /** @template {MemoryEntry | CandidateEntry} T @param {readonly T[]} entries @param {boolean} [includeReceipts] */
  async function check(entries, includeReceipts = false) {
    const ids = entries.filter(({ memory }) => includeReceipts ||
      byNamespace.get(memory.scope.namespace)?.some(usesSource)).map(({ memory }) => memory.id);
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

  return { check, blocks, blocksSession, candidateColumns };
}
