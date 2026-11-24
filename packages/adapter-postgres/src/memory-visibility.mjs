import {
  allDigests, CoreError, factBlocksIncoming, factHidesRow, PRIVACY_REDACTION_VERSIONS, validateSuppressionFact,
} from "../../core/src/index.mjs";
import { factSlot } from "./facts.mjs";
import { CREATED_MS, MATCH_COLUMNS, readReceipts, TEXT_HASH } from "./memory-rows.mjs";

/** @import { FactMatchIncoming, FactMatchPolicy, FactMatchRow, StoredFact, TextDigest } from "../../core/src/index.mjs" */
/** @import { IncomingFactMatchPolicy } from "../../core/src/privacy/fact-match.d.mts" */
/** @import { CaptureKey, DuplicateQuery, Receipt, Scope, SourceRef } from "../../core/src/ports/index.d.ts" */
/** @import { CandidateEntry, MemoryEntry, Query } from "./memory-rows.mjs" */

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
  const { id, kind, origin, client, session_id, start_ms, end_ms, text_hash, text_hmac, key_id, shingles, embedding, redaction_version } = row;
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
    body = { ...base, mode: "full", text: { digests, embedding: JSON.parse(embedding), shingles, keyId: key_id } };
  }
  return { fact: validateSuppressionFact(body), factId: id, incarnation: "", epoch: 0n, createdAtMs: 0 };
}

/** @param {unknown} value @param {bigint} minimum */
export function readEpoch(value, minimum) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value)) throw new CoreError("internal_error");
  const epoch = BigInt(value);
  if (epoch < minimum || epoch > 9223372036854775807n) throw new CoreError("internal_error");
  return epoch;
}

/** @param {unknown} value */
export function readCreatedAtMs(value) {
  if (typeof value !== "string" || !/^-?(?:0|[1-9][0-9]*)$/u.test(value)) throw new CoreError("internal_error");
  const us = BigInt(value);
  const ms = Number((us - (us < 0n ? 999n : 0n)) / 1000n);
  if (!Number.isSafeInteger(ms)) throw new CoreError("internal_error");
  return ms;
}

/** @param {any} row @param {string} owner @returns {StoredFact} */
export function decodeCoreFact(row, owner) {
  const fact = validateSuppressionFact({ ...row.body, owner, actionId: row.action_id });
  if (fact.kind !== row.kind || fact.origin !== row.origin ||
      (fact.kind === "text" ? fact.mode : null) !== row.mode || factSlot(fact) !== row.slot ||
      typeof row.fact_id !== "string" || row.fact_id.length > 512 || !/^[^\u0000\uD800-\uDFFF]+$/u.test(row.fact_id) ||
      typeof row.incarnation !== "string" || !/^[0-9a-f]{64}$/u.test(row.incarnation)) {
    throw new CoreError("ineligible");
  }
  return { fact, factId: row.fact_id, incarnation: row.incarnation,
    epoch: readEpoch(row.epoch, 1n), createdAtMs: readCreatedAtMs(row.created_at_us) };
}

/** @param {StoredFact} stored */
export function usesSource({ fact }) {
  return fact.kind === "session" || fact.kind === "window";
}

/** @param {Query} query @param {string} owner
 * @param {{ textOnly?: boolean, rawSpans?: boolean, source?: Pick<CaptureKey, "scope" | "client" | "sessionId">,
 *   legacyOnly?: boolean, allowPendingLegacy?: boolean, limit?: number }} [options] */
export async function readVisibilityFacts(query, owner, {
  textOnly = false, rawSpans = false, source, legacyOnly = false, allowPendingLegacy = false, limit,
} = {}) {
  // Both halves see the same statement snapshot while legacy writers are still active.
  const { rows } = await query(`WITH owner_state AS (
    SELECT legacy_facts_ready AS ready, legacy_writes_reconciled AS reconciled
    FROM core_owner_state WHERE user_id = $1
  )
  SELECT false AS legacy, false AS pending, fact_id, action_id, incarnation, epoch::text, body,
    trunc(EXTRACT(EPOCH FROM created_at) * 1000000)::text AS created_at_us, kind, origin, mode, slot
    FROM core_suppression_facts WHERE user_id = $1
      AND (kind IN ('identity', 'text', 'session', 'window') OR ($10::boolean AND kind = 'rawSpan'))
      AND (NOT $2::boolean OR kind = 'text') AND NOT $3::boolean
      AND (NOT $6::boolean OR (
        kind IN ('session', 'window') AND (body ->> 'namespace') IS NOT DISTINCT FROM $7::text
        OR kind = 'session' AND body #>> '{session,client}' = $8::text AND (
          body #>> '{session,sessionId}' <> $9::text OR body #>> '{session,sessionKeyHash}' IS NOT NULL
        )
      ))
  UNION ALL
  SELECT true, NOT COALESCE((SELECT ready FROM owner_state), false), id, NULL, NULL, NULL,
    jsonb_build_object('id', id, 'kind', kind, 'origin', origin, 'client', client, 'session_id', session_id,
      'start_ms', floor(EXTRACT(EPOCH FROM window_start) * 1000),
      'end_ms', ceil(EXTRACT(EPOCH FROM window_end) * 1000),
      'text_hash', text_hash, 'text_hmac', text_hmac, 'key_id', key_id,
      'embedding', embedding::text, 'redaction_version', redaction_version, 'shingles', shingles), NULL, NULL, NULL, NULL, NULL
    FROM suppressions WHERE user_id = $1
      AND (NOT $2::boolean OR kind = 'text' OR (NOT $5::boolean AND NOT COALESCE((SELECT ready FROM owner_state), false)))
      AND NOT COALESCE((SELECT ready AND reconciled FROM owner_state), false)
      AND (NOT $6::boolean OR (
        kind IN ('session', 'window') AND $7::text IS NULL
        OR kind = 'session' AND client = $8::text AND session_id <> $9::text
      ))
    LIMIT $4`, [owner, textOnly, legacyOnly, limit ?? null, allowPendingLegacy,
    source !== undefined, source?.scope.namespace ?? null, source?.client ?? null, source?.sessionId ?? null, rawSpans]);
  if (!allowPendingLegacy && rows.some(row => row.pending)) throw new CoreError("ineligible");
  return rows.map(row => row.legacy ? legacyFact(row.body, owner) : decodeCoreFact(row, owner));
}

/** @param {MemoryEntry | CandidateEntry} entry @param {readonly StoredFact[]} facts @returns {Promise<FactMatchRow>} */
export async function rowFactCandidate({ memory, digests }, facts) {
  const { scope, id, revision, text, textHash, embedding } = memory;
  /** @type {FactMatchRow} */
  const candidate = { type: "memory", scope, memoryId: id, revision, embedding: embedding?.vector };
  if (facts.some(({ fact }) => fact.kind === "text")) {
    const aliases = text !== undefined &&
      facts.some(({ fact }) => fact.kind === "text" && fact.text.digests.some(d => d.alg === "sha256"));
    const evidence = digests ?? [];
    candidate.digests = digestAliases({ textHash, digests: aliases ? [...evidence, ...await allDigests(text)] : evidence });
  }
  return candidate;
}

/** @param {StoredFact} stored @param {FactMatchRow} row @param {readonly Pick<Receipt, "client" | "sessionId">[]} receipts
 * @param {FactMatchPolicy} policy @param {Pick<CandidateEntry["memory"], "source" | "createdAtMs" | "updatedAtMs">} legacySource */
export function matchesRowFact(stored, row, receipts, policy, legacySource) {
  if (stored.fact.kind === "session") {
    const { client, sessionId } = legacySource.source;
    const sources = receipts.length || client == null || sessionId == null ? receipts : [{ client, sessionId }];
    return sources.some(({ client, sessionId }) =>
      factHidesRow(stored, { ...row, source: { client, sessionId } }, policy) !== false);
  }
  if (stored.fact.kind !== "window") return factHidesRow(stored, row, policy) !== false;
  // On receipt-backed memories, windows govern admission only.
  if (receipts.length) return false;
  const { source: { client, sessionId }, createdAtMs, updatedAtMs } = legacySource;
  return [createdAtMs, updatedAtMs].some(occurredAtMs =>
    factHidesRow(stored, { ...row, source: { client: client ?? "", sessionId, occurredAtMs } }, policy) !== false);
}

/** @param {StoredFact} stored @param {Scope} scope @param {NonNullable<FactMatchIncoming["session"]>} session
 * @param {IncomingFactMatchPolicy} policy */
export function sessionBlocksIncoming(stored, scope, session, policy) {
  return stored.fact.kind === "session" && factBlocksIncoming(stored, { scope, passages: [], session }, policy) !== false;
}

/** @param {FactMatchPolicy["hashSessionKey"]} [hashSessionKey] */
export function rowVisibilityPolicy(hashSessionKey) {
  return { vectorSuppression: true, rowShingles: false, hashSessionKey };
}

/** @param {Query} query @param {string} owner @param {FactMatchPolicy["hashSessionKey"]} [hashSessionKey] */
export async function readVisibility(query, owner, hashSessionKey) {
  const policy = rowVisibilityPolicy(hashSessionKey);
  const capture = /** @type {const} */ ({ ...policy, mode: "capture" });
  const explicitSave = /** @type {const} */ ({ ...policy, mode: "explicitSave" });
  const facts = await readVisibilityFacts(query, owner);
  /** @type {Map<Scope["namespace"], StoredFact[]>} */
  const byNamespace = new Map();
  for (const stored of facts) {
    const ns = stored.fact.namespace ?? null;
    let facts = byNamespace.get(ns);
    if (!facts) byNamespace.set(ns, facts = []);
    facts.push(stored);
  }

  /** @param {readonly Scope["namespace"][]} namespaces */
  function selectedFacts(namespaces) {
    return namespaces.flatMap(namespace => byNamespace.get(namespace) ?? []);
  }

  /** @param {readonly Scope["namespace"][]} namespaces @param {{exact?: boolean, distance?: boolean}} [options] */
  function candidateColumns(namespaces, { exact, distance } = {}) {
    const facts = selectedFacts(namespaces);
    const textFacts = facts.flatMap(({ fact }) => fact.kind === "text" ? [fact] : []);
    const aliases = textFacts.some(fact => fact.text.digests.some(d => d.alg === "sha256"));
    const vector = textFacts.some(fact => fact.mode === "full" && fact.text.embedding != null);
    const columns = [MATCH_COLUMNS];
    if (exact || textFacts.length) columns.push(`${TEXT_HASH} AS logical_hash`);
    if (textFacts.length) columns.push("core_digests");
    if (aliases) columns.push("text");
    if (facts.some(usesSource)) columns.push("source_client", "source_session_id", `${CREATED_MS}::text AS created_ms`);
    if (vector || distance) columns.push("embedding::text");
    return columns.join(", ");
  }

  /** @param {MemoryEntry | CandidateEntry} entry @param {readonly Receipt[]} evidence */
  async function hides(entry, evidence) {
    const facts = byNamespace.get(entry.memory.scope.namespace);
    if (!facts?.length) return false;
    const candidate = await rowFactCandidate(entry, facts);
    return facts.some(stored => matchesRowFact(stored, candidate, evidence, policy, entry.memory));
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
    return byNamespace.get(scope.namespace)?.some(stored =>
      sessionBlocksIncoming(stored, scope, { client, sessionId }, capture)) ?? false;
  }

  return { check, blocks, blocksSession, candidateColumns, selectedFacts };
}
