import {
  allDigests, compareUtf8, CoreError, factBlocksIncoming, factHidesRow, PRIVACY_REDACTION_VERSIONS,
  validateSuppressionFact,
} from "../../core/src/index.mjs";
import { factBody } from "../../core/src/suppression-fact.mjs";
import { factSlot, matchesFactSlot } from "./facts.mjs";
import { CREATED_AT_US, CREATED_MS, MATCH_COLUMNS, readReceipts, storageHash, TEXT_HASH, WRITE_TIME_US } from "./memory-rows.mjs";

/** @import { FactMatchIncoming, FactMatchPolicy, FactMatchRow, StoredFact, SuppressionFact, TextDigest } from "../../core/src/index.mjs" */
/** @import { IncomingFactMatchPolicy } from "../../core/src/privacy/fact-match.d.mts" */
/** @import { CaptureKey, DuplicateQuery, Receipt, Scope, SourceRef } from "../../core/src/ports/index.d.ts" */
/** @import { CandidateEntry, MemoryEntry, Query } from "./memory-rows.mjs" */
/** @import { LegacySuppressionRow } from "./index.mjs" */

const SHA256 = /^(?:sha256:)?[0-9a-f]{64}$/u;

/** @param {string} value */
function digestValue(value) {
  // The hosted column can contain a legacy bare SHA-256.
  return SHA256.test(value) ? value.replace(/^sha256:/u, "") : null;
}

/** @param {Pick<DuplicateQuery, "textHash" | "legacyHash" | "digests">} candidate */
function digestAliases({ textHash, legacyHash, digests = [] }) {
  const result = [...digests];
  for (const hash of [textHash, legacyHash]) {
    const value = hash === undefined ? null : digestValue(hash);
    if (value && !result.some(digest => digest.alg === "sha256" && digest.label === undefined && digest.value === value)) {
      /** @type {TextDigest["pipeline"]} */
      const pipeline = hash === legacyHash ? "engine-legacy" : "core";
      result.push({ alg: "sha256", value, pipeline, redactionVersion: PRIVACY_REDACTION_VERSIONS.core, keyId: null });
    }
  }
  return result;
}

/** @param {LegacySuppressionRow} row @param {string} owner */
export function legacySuppressionToFact(row, owner) {
  const { kind, origin } = row;
  const base = { owner, kind, origin: origin ?? "backfill", actionId: "legacy" };
  let body;
  if (kind === "session") {
    body = { ...base, session: { client: row.client, sessionId: row.session_id } };
  } else if (kind === "window") {
    body = { ...base, client: row.client, window: { startMs: Number(row.start_ms), endMs: Number(row.end_ms) } };
  } else {
    const { text_hash, text_hmac, key_id, shingles, embedding, redaction_version, created_at_us } = row;
    /** @type {TextDigest[]} */
    const digests = [];
    const sha = digestValue(text_hash);
    const hmacs = new Set([text_hash.startsWith("hmac:") ? text_hash.slice(5) : null, text_hmac]);
    const domain = /** @type {const} */ ({ pipeline: "hosted-v1", redactionVersion: redaction_version });
    if (sha) digests.push({ ...domain, alg: "sha256", value: sha, keyId: null });
    for (const value of hmacs) {
      if (value) digests.push({ ...domain, alg: "hmac", label: "hosted-v1", value, keyId: key_id });
    }
    if (origin === "edit") {
      body = { ...base, mode: "exact", legacyTextHash: text_hash, text: { digests } };
    } else {
      body = { ...base, mode: "full", legacyTextHash: text_hash,
        text: { digests, embedding: JSON.parse(embedding), shingles, keyId: key_id },
        explicitSaveExemptAfterUs: origin === null ? "infinity" : created_at_us.toLowerCase() };
    }
  }
  return validateSuppressionFact(body);
}

/** @param {SuppressionFact} fact */
function legacyCutoff(fact) {
  const cutoff = fact.kind === "text" ? fact.explicitSaveExemptAfterUs : undefined;
  if (cutoff === "infinity") return Infinity;
  if (cutoff === undefined || cutoff === "-infinity") return -Infinity;
  return BigInt(cutoff);
}

/** @param {SuppressionFact} fact */
function legacyMatchingBody(fact) {
  // The legacy matcher treats non-edit origins alike. The cutoff value can be
  // merged by taking the maximum only when both facts have a cutoff.
  const origin = fact.origin === "edit" ? "edit" : "backfill";
  return factBody(fact.kind === "text" && fact.explicitSaveExemptAfterUs !== undefined
    ? { ...fact, origin, explicitSaveExemptAfterUs: "infinity" }
    : { ...fact, origin });
}

/** @param {readonly (LegacySuppressionRow & { id: string })[]} rows @param {string} owner */
export function legacySuppressionsToFacts(rows, owner) {
  /** @type {Map<string, { fact: SuppressionFact | null, rowIds: string[] }>} */
  const bySlot = new Map();
  for (const row of rows) {
    if (typeof row.id !== "string") throw new CoreError("invalid_input");
    const fact = legacySuppressionToFact(row, owner);
    const slot = factSlot(fact);
    const previous = bySlot.get(slot);
    if (!previous) {
      bySlot.set(slot, { fact, rowIds: [row.id] });
      continue;
    }
    previous.rowIds.push(row.id);
    if (previous.fact === null) continue;
    if (legacyMatchingBody(fact) !== legacyMatchingBody(previous.fact)) {
      previous.fact = null;
      continue;
    }
    const cutoff = legacyCutoff(fact);
    const previousCutoff = legacyCutoff(previous.fact);
    if (cutoff > previousCutoff ||
      (cutoff === previousCutoff && compareUtf8(factBody(fact), factBody(previous.fact)) < 0)) {
      previous.fact = fact;
    }
  }
  const facts = [];
  const uncopyable = [];
  for (const [, { fact, rowIds }] of [...bySlot].sort(([a], [b]) => compareUtf8(a, b))) {
    if (fact === null) {
      for (const id of rowIds) uncopyable.push(id);
    } else {
      facts.push(fact);
    }
  }
  return { facts, uncopyable: uncopyable.sort(compareUtf8) };
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
      (fact.kind === "text" ? fact.mode : null) !== row.mode || !matchesFactSlot(fact, row.slot) ||
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

const FACT_KIND = "COALESCE(kind, body->>'kind')";
const TEXT_FACT = `${FACT_KIND} = 'text'`;
// Select candidate evidence from the same live fact rows that the matcher decodes.
const ROW_EVIDENCE = {
  needs_digests: { when: TEXT_FACT, columns: { logical_hash: TEXT_HASH, core_digests: "core_digests" } },
  needs_text: { when: `${TEXT_FACT} AND CASE WHEN legacy THEN (body->>'text_hash') ~ '${SHA256.source}'
    ELSE jsonb_path_exists(body, '$.text.digests[*] ? (@.alg == "sha256")') END`, columns: { text: "text" } },
  needs_source: { when: `${FACT_KIND} IN ('session', 'window')`,
    columns: { source_client: "source_client", source_session_id: "source_session_id" } },
  needs_window: { when: `${FACT_KIND} = 'window'`,
    columns: { created_ms: `${CREATED_MS}::text` } },
  needs_vector: { when: `${TEXT_FACT} AND CASE WHEN legacy THEN (body->>'origin') IS DISTINCT FROM 'edit' AND body->>'embedding' IS NOT NULL
    ELSE mode = 'full' AND body #>> '{text,embedding}' IS NOT NULL END`, columns: { embedding: "embedding::text" } },
  needs_physical_source: { when: `${TEXT_FACT} AND CASE WHEN legacy THEN body->>'origin' IN ('forget', 'correct', 'backfill')
    ELSE body->>'explicitSaveExemptAfterUs' IS NOT NULL END`,
    columns: { source_kind: "source_kind", created_at_us: `${CREATED_AT_US}::text` } },
};

const evidence = Object.entries(ROW_EVIDENCE);

/** @param {string} namespace SQL expression for the JSON-encoded namespace. */
export function scopedEvidenceSql(namespace) {
  // The encoded scope can contain an escaped NUL, which PostgreSQL jsonb cannot decode.
  return `SELECT ${evidence.map(([key]) => `bool_or(${key}) AS ${key}`).join(", ")} FROM facts
    WHERE NULLIF(body->'namespace', 'null'::jsonb)::text IS NOT DISTINCT FROM ${namespace}`;
}

/** @param {boolean} currentness */
export function endpointEvidenceSql(currentness) {
  return [
    `jsonb_build_object('id', id, 'core_namespace', core_namespace, 'revision', revision${currentness ? ", 'currentness', currentness" : ""})`,
    ...evidence.map(([key, { columns }]) => {
      const fields = Object.entries(columns).map(([name, expression]) => `'${name}', ${expression}`);
      if (key === "needs_window") fields.push(`'updated_us', ${WRITE_TIME_US}::text`);
      return `CASE WHEN ${key} THEN jsonb_build_object(${fields.join(", ")}) ELSE '{}'::jsonb END`;
    }),
  ].join(" || ");
}

const CORE_VISIBILITY_COLUMNS = `fact_id, action_id, incarnation, epoch::text, body,
  ${CREATED_AT_US}::text AS created_at_us, kind, origin, mode, slot`;

/** @param {Query} query @param {Scope} scope @param {string} messageId */
export async function readRawSpanFacts(query, scope, messageId) {
  const { rows } = await query(`SELECT ${CORE_VISIBILITY_COLUMNS}
    FROM core_suppression_facts WHERE user_id = $1 AND kind = 'rawSpan'
      AND (body ->> 'namespace') IS NOT DISTINCT FROM $2::text AND body ->> 'messageKey' = $3`,
  [scope.owner, scope.namespace, messageId]);
  return rows.map(row => decodeCoreFact(row, scope.owner));
}

export function visibilityFactsSql({
  textOnly = "false", legacyOnly = "false", limit = "NULL", allowPendingLegacy = "false", rawSpans = "false",
  hasSource = "false", namespace = "NULL", client = "NULL", sessionId = "NULL", rowEvidence = false,
} = {}) {
  const liveFacts = `SELECT false AS legacy, false AS pending, ${CORE_VISIBILITY_COLUMNS}
    FROM core_suppression_facts WHERE user_id = $1
      AND (kind IN ('identity', 'text', 'session', 'window') OR (${rawSpans} AND kind = 'rawSpan'))
      AND (NOT ${textOnly} OR kind = 'text') AND NOT ${legacyOnly}
      AND (NOT ${hasSource} OR (
        kind IN ('session', 'window') AND (body ->> 'namespace') IS NOT DISTINCT FROM ${namespace}::text
        OR kind = 'session' AND body #>> '{session,client}' = ${client}::text AND (
          body #>> '{session,sessionId}' <> ${sessionId}::text OR body #>> '{session,sessionKeyHash}' IS NOT NULL
        )
      ))
  UNION ALL
  SELECT true, NOT COALESCE((SELECT ready FROM owner_state), false), id, NULL, NULL, NULL,
    jsonb_build_object('id', id, 'kind', kind, 'origin', origin, 'client', client, 'session_id', session_id,
      'start_ms', floor(EXTRACT(EPOCH FROM window_start) * 1000),
      'end_ms', ceil(EXTRACT(EPOCH FROM window_end) * 1000),
      'text_hash', text_hash, 'text_hmac', text_hmac, 'key_id', key_id,
      'embedding', embedding::text, 'redaction_version', redaction_version, 'shingles', shingles),
    ${CREATED_AT_US}::text, NULL, NULL, NULL, NULL
    FROM suppressions WHERE user_id = $1
      AND (NOT ${textOnly} OR kind = 'text' OR (NOT ${allowPendingLegacy} AND NOT COALESCE((SELECT ready FROM owner_state), false)))
      AND NOT COALESCE((SELECT ready AND reconciled FROM owner_state), false)
      AND (NOT ${hasSource} OR (
        kind IN ('session', 'window') AND ${namespace}::text IS NULL
        OR kind = 'session' AND client = ${client}::text AND session_id <> ${sessionId}::text
      ))
    LIMIT ${limit}`;
  // Both halves see the same statement snapshot while legacy writers are still active.
  return `WITH owner_state AS (
    SELECT legacy_facts_ready AS ready, legacy_writes_reconciled AS reconciled
    FROM core_owner_state WHERE user_id = $1
  )
  ${rowEvidence ? `SELECT f.*, ${evidence.map(([key, { when }]) => `(${when}) AS ${key}`).join(", ")}
    FROM (${liveFacts}) f` : liveFacts}`;
}

/** @param {any[]} rows @param {string} owner @param {boolean} [allowPendingLegacy] */
export function decodeVisibilityFacts(rows, owner, allowPendingLegacy = false) {
  if (!allowPendingLegacy && rows.some(row => row.pending)) throw new CoreError("ineligible");
  return rows.map(row => row.legacy ? {
    fact: legacySuppressionToFact({ ...row.body, created_at_us: row.created_at_us }, owner),
    factId: row.fact_id, incarnation: "", epoch: 0n,
    createdAtMs: row.created_at_us === "Infinity" || row.created_at_us === "-Infinity"
      ? Number(row.created_at_us) : readCreatedAtMs(row.created_at_us),
  } : decodeCoreFact(row, owner));
}

const filteredVisibilityFactsSql = visibilityFactsSql({
  textOnly: "$2::boolean", legacyOnly: "$3::boolean", limit: "$4", allowPendingLegacy: "$5::boolean",
  hasSource: "$6::boolean", namespace: "$7", client: "$8", sessionId: "$9", rawSpans: "$10::boolean",
});

/** @param {Query} query @param {string} owner
 * @param {{ textOnly?: boolean, rawSpans?: boolean, source?: Pick<CaptureKey, "scope" | "client" | "sessionId">,
 *   legacyOnly?: boolean, allowPendingLegacy?: boolean, limit?: number }} [options] */
export async function readVisibilityFacts(query, owner, {
  textOnly = false, rawSpans = false, source, legacyOnly = false, allowPendingLegacy = false, limit,
} = {}) {
  const { rows } = await query(filteredVisibilityFactsSql, [owner, textOnly, legacyOnly, limit ?? null,
    allowPendingLegacy, source !== undefined, source?.scope.namespace ?? null, source?.client ?? null,
    source?.sessionId ?? null, rawSpans]);
  return decodeVisibilityFacts(rows, owner, allowPendingLegacy);
}

/** @param {MemoryEntry | CandidateEntry} entry @param {readonly StoredFact[]} facts @returns {Promise<FactMatchRow>} */
export async function rowFactCandidate({ memory, digests, sourceKind, createdAtUs }, facts) {
  const { scope, id, revision, text, textHash, embedding } = memory;
  /** @type {FactMatchRow} */
  const candidate = { type: "memory", scope, memoryId: id, revision, embedding: embedding?.vector, sourceKind, createdAtUs };
  if (facts.some(({ fact }) => fact.kind === "text")) {
    const aliases = text !== undefined &&
      facts.some(({ fact }) => fact.kind === "text" && fact.text.digests.some(d => d.alg === "sha256"));
    const evidence = digests ?? [];
    candidate.digests = digestAliases({ textHash, digests: aliases ? [...evidence, ...await allDigests(text)] : evidence });
  }
  return candidate;
}

/** @param {StoredFact} stored @param {FactMatchRow} row @param {readonly Pick<Receipt, "client" | "sessionId">[]} receipts
 * @param {FactMatchPolicy} policy @param {Pick<CandidateEntry["memory"], "source" | "createdAtMs" | "updatedAtMs" | "textHash">} legacySource */
export function matchesRowFact(stored, row, receipts, policy, legacySource) {
  const { fact } = stored;
  if (fact.kind === "text" && fact.legacyTextHash !== undefined) {
    if (fact.owner !== row.scope.owner || (fact.namespace ?? null) !== row.scope.namespace) return false;
    // The logical hash is a reversible projection of the hosted text_hash column.
    const physicalHit = typeof legacySource.textHash === "string" && storageHash(legacySource.textHash) === fact.legacyTextHash;
    if (physicalHit || fact.mode === "exact") return physicalHit;
  }
  if (fact.kind === "session") {
    const { client, sessionId } = legacySource.source;
    const sources = receipts.length || client == null || sessionId == null ? receipts : [{ client, sessionId }];
    return sources.some(({ client, sessionId }) =>
      factHidesRow(stored, { ...row, source: { client, sessionId } }, policy) !== false);
  }
  if (fact.kind !== "window") return factHidesRow(stored, row, policy) !== false;
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
  const { rows } = await query(visibilityFactsSql({ rowEvidence: true }), [owner]);
  return createVisibility(rows, owner, ids => readReceipts(query, owner, ids), hashSessionKey);
}

/** @template {Pick<Receipt, "client" | "sessionId">} R
 * @param {any[]} rows @param {string} owner @param {(ids: string[]) => Promise<Map<string, R[]>>} loadReceipts
 * @param {FactMatchPolicy["hashSessionKey"]} [hashSessionKey] */
export function createVisibility(rows, owner, loadReceipts, hashSessionKey) {
  const facts = decodeVisibilityFacts(rows, owner);
  const policy = rowVisibilityPolicy(hashSessionKey);
  const capture = /** @type {const} */ ({ ...policy, mode: "capture" });
  const explicitSave = /** @type {const} */ ({ ...policy, mode: "explicitSave" });
  /** @type {Map<Scope["namespace"], { facts: StoredFact[], evidence: Set<string> }>} */
  const byNamespace = new Map();
  for (const [index, stored] of facts.entries()) {
    const ns = stored.fact.namespace ?? null;
    let selected = byNamespace.get(ns);
    if (!selected) byNamespace.set(ns, selected = { facts: [], evidence: new Set() });
    selected.facts.push(stored);
    for (const [key] of evidence) {
      if (rows[index][key]) selected.evidence.add(key);
    }
  }

  /** @param {readonly Scope["namespace"][]} namespaces */
  function selectedFacts(namespaces) {
    return namespaces.flatMap(namespace => byNamespace.get(namespace)?.facts ?? []);
  }

  /** @param {readonly Scope["namespace"][]} namespaces @param {{exact?: boolean, distance?: boolean, skipEmbedding?: boolean}} [options] */
  function candidateColumns(namespaces, { exact, distance, skipEmbedding } = {}) {
    const projections = new Set(namespaces.flatMap(namespace => [...(byNamespace.get(namespace)?.evidence ?? [])]));
    if (!skipEmbedding && distance) projections.add("needs_vector");
    if (skipEmbedding) projections.delete("needs_vector");
    const columns = [MATCH_COLUMNS];
    if (exact && !projections.has("needs_digests")) columns.push(`${TEXT_HASH} AS logical_hash`);
    for (const [key, { columns: required }] of evidence) {
      if (projections.has(key)) columns.push(...Object.entries(required).map(([name, sql]) => `${sql} AS ${name}`));
    }
    return columns.join(", ");
  }

  /** @param {MemoryEntry | CandidateEntry} entry @param {readonly R[]} evidence */
  async function hides(entry, evidence) {
    const facts = byNamespace.get(entry.memory.scope.namespace)?.facts;
    if (!facts?.length) return false;
    const candidate = await rowFactCandidate(entry, facts);
    return facts.some(stored => matchesRowFact(stored, candidate, evidence, policy, entry.memory));
  }

  /** @template {MemoryEntry | CandidateEntry} T @param {readonly T[]} entries @param {boolean} [includeReceipts] */
  async function check(entries, includeReceipts = false) {
    const ids = entries.filter(({ memory }) => includeReceipts ||
      byNamespace.get(memory.scope.namespace)?.facts.some(usesSource)).map(({ memory }) => memory.id);
    const receipts = await loadReceipts(ids);
    return Promise.all(entries.map(async (entry) => {
      const evidence = receipts.get(entry.memory.id) ?? [];
      return { ...entry, evidence, hidden: await hides(entry, evidence) };
    }));
  }

  /** @param {Scope} scope @param {DuplicateQuery} incoming @param {"hash" | "full"} mode
   * @param {FactMatchIncoming["sourceMemory"]} sourceMemory */
  function blocks(scope, incoming, mode, sourceMemory) {
    const passages = [{ digests: digestAliases(incoming), embedding: incoming.embedding }];
    return byNamespace.get(scope.namespace)?.facts.some((stored) => stored.fact.kind === "text" &&
      factBlocksIncoming(stored, { scope, passages, sourceMemory }, mode === "hash" ? explicitSave : capture) !== false) ?? false;
  }

  /** @param {Scope} scope @param {Pick<SourceRef, "client" | "sessionId">} source */
  function blocksSession(scope, { client, sessionId }) {
    if (client === null || sessionId === null) return false;
    return byNamespace.get(scope.namespace)?.facts.some(stored =>
      sessionBlocksIncoming(stored, scope, { client, sessionId }, capture)) ?? false;
  }

  return { check, blocks, blocksSession, candidateColumns, selectedFacts };
}
