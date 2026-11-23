import { CoreError, factBlocksIncoming, validateSuppressionFact } from "../../core/src/index.mjs";
import { factSlot } from "./facts.mjs";
import { readReceipts, selectMemory } from "./memory-rows.mjs";
import { matchesRowFact, readVisibilityFacts, rowFactCandidate, sessionBlocksIncoming } from "./memory-visibility.mjs";
import { requireLiveRun, runOperation } from "./uow.mjs";

/** @import { FactMatchPolicy, StoredFact, TextFact } from "../../core/src/index.mjs" */
/** @import { Scope, Tx } from "../../core/src/ports/index.d.ts" */
/** @import { PassageFingerprint, SuppressionStore } from "../../core/src/ports/privacy.d.ts" */
/** @import { Connection } from "./driver.mjs" */

const MAX_FACTS = 4096;
const MAX_POSITIONS = 16384;
const MAX_COMPARISONS = 262144;
const HEX64 = /^[0-9a-f]{64}$/u;
const STORABLE = /^[^\u0000\uD800-\uDFFF]+$/u;

const FACT_COLUMNS = `f.fact_id, f.action_id, f.kind, f.origin, f.mode, f.body, f.slot,
  f.incarnation, f.epoch::text, trunc(EXTRACT(EPOCH FROM f.created_at) * 1000000)::text AS created_at_us`;
const FACT_SCOPE = `f.user_id = $1 AND (f.body ->> 'namespace') COLLATE "C" IS NOT DISTINCT FROM $2`;

// Only a canonical singleton SHA exact fact can be pruned, and only when every
// passage has SHA evidence. Full, mixed, keyed, and inconsistent projections
// still reach core. Check the body against the lookup row before ruling it out.
const SNAPSHOT_FACTS = `WITH hits AS (
    SELECT DISTINCT fact_id FROM core_fact_digests
    WHERE user_id = $1 AND value = ANY($6::text[])
  )
  SELECT ${FACT_COLUMNS} FROM core_suppression_facts f
  LEFT JOIN hits USING (fact_id)
  WHERE ${FACT_SCOPE} AND (
    ($3 AND f.kind = 'session') OR ($4 AND f.kind = 'window') OR
    ($5 AND f.kind = 'text' AND (
      $6::text[] IS NULL OR hits.fact_id IS NOT NULL OR f.mode IS DISTINCT FROM 'exact' OR
      NOT EXISTS (
        SELECT 1 FROM core_fact_digests d
        WHERE d.user_id = f.user_id AND d.fact_id = f.fact_id AND d.alg = 'sha256'
          AND f.body -> 'text' = jsonb_build_object('digests', jsonb_build_array(jsonb_build_object(
            'alg', d.alg, 'value', d.value, 'pipeline', d.pipeline,
            'redactionVersion', d.redaction_version, 'keyId', d.key_id)))
          AND f.body - 'text' - 'namespace' = jsonb_build_object('kind', f.kind, 'origin', f.origin, 'mode', f.mode)
          AND (f.body -> 'namespace' IS NULL OR jsonb_typeof(f.body -> 'namespace') IN ('null', 'string'))
          AND f.slot = $7 || to_json(d.value)::text || ']],null]'
      )
    ))
  )
  ORDER BY f.epoch LIMIT ${MAX_FACTS + 1}`;

const TARGET_FACTS = `SELECT ${FACT_COLUMNS} FROM core_suppression_facts f
  WHERE ${FACT_SCOPE} AND (
    (f.kind = 'identity' AND (f.body ->> 'memoryId') COLLATE "C" = $3)
    OR ($4 AND f.kind IN ('text', 'session'))
  )
  ORDER BY f.epoch LIMIT ${MAX_FACTS + 1}`;

/** @returns {never} */
function ineligible() {
  throw new CoreError("ineligible");
}

/** @param {unknown} value @param {number} [max] @returns {value is string} */
function validString(value, max = 512) {
  return typeof value === "string" && value.length <= max && STORABLE.test(value);
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

/** @param {unknown} object @param {PropertyKey} key */
function field(object, key) {
  if (object === null || typeof object !== "object") ineligible();
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (descriptor && !Object.hasOwn(descriptor, "value")) ineligible();
  return descriptor?.value;
}

/** @template T @param {unknown} value @param {(value: any) => T} copy @param {number} [max] */
function copyList(value, copy, max = MAX_POSITIONS) {
  const length = field(value, "length");
  if (!Array.isArray(value) || !Number.isSafeInteger(length) || length < 0 || length > max) ineligible();
  return Array.from({ length }, (_, index) => copy(field(value, index)));
}

/** @param {unknown} value @returns {PassageFingerprint} */
function copyPassage(value) {
  const digests = copyList(field(value, "digests"), (digest) => ({
    alg: field(digest, "alg"), value: field(digest, "value"), keyId: field(digest, "keyId"),
    pipeline: field(digest, "pipeline"), redactionVersion: field(digest, "redactionVersion"),
  }), 128);
  const shingleList = field(value, "shingles");
  const shingles = shingleList == null ? null : copyList(shingleList, (item) => {
    if (typeof item !== "string" || item.length > 64 || !/^[0-9a-f]+$/u.test(item)) ineligible();
    return item;
  });
  const keyId = field(value, "keyId") ?? null;
  validateSuppressionFact({
    owner: "validation", actionId: "validation", kind: "text", mode: "full", origin: "forget",
    text: { digests, shingles, keyId },
  });
  return { digests, shingles, keyId };
}

/** @param {Parameters<SuppressionStore["snapshot"]>[2]} candidates */
function copyCandidates(candidates) {
  const client = field(candidates, "client");
  const sessionId = field(candidates, "sessionId");
  if ((client !== undefined && !validString(client, 128)) ||
      (sessionId !== undefined && !validString(sessionId))) ineligible();
  const times = field(candidates, "occurredAtMs");
  const occurredAtMs = times === undefined ? [] : copyList(times, (value) => {
    if (value !== null && !Number.isSafeInteger(value)) ineligible();
    return /** @type {number | null} */ (value);
  });
  const evidence = field(candidates, "passages");
  const passages = evidence === undefined ? undefined : copyList(evidence, copyPassage, 4096);
  return { client, sessionId, occurredAtMs, passages };
}

/** @param {Tx} tx @param {Scope} scope */
function readScope(tx, scope) {
  requireLiveRun(tx);
  let owner;
  let namespace;
  try {
    owner = field(scope, "owner");
    namespace = field(scope, "namespace");
  } catch {
    ineligible();
  }
  if (owner !== tx.owner) throw new CoreError("internal_error");
  if (namespace !== null && !validString(namespace)) ineligible();
  return { owner: tx.owner, namespace };
}

/** @param {any[]} rows @param {Scope} scope @returns {StoredFact[]} */
function decodeFacts(rows, scope) {
  if (rows.length > MAX_FACTS) ineligible();
  return rows.map((row) => {
    const fact = validateSuppressionFact({ ...row.body, owner: scope.owner, actionId: row.action_id });
    if ((fact.namespace ?? null) !== scope.namespace || fact.kind !== row.kind || fact.origin !== row.origin ||
      (fact.kind === "text" ? fact.mode : null) !== row.mode || factSlot(fact) !== row.slot ||
      !validString(row.fact_id) || typeof row.incarnation !== "string" || !HEX64.test(row.incarnation)) ineligible();
    return { fact, factId: row.fact_id, incarnation: row.incarnation,
      epoch: readEpoch(row.epoch, 1n), createdAtMs: readCreatedAtMs(row.created_at_us) };
  });
}

/** @param {Connection["query"]} query @param {Scope} scope */
async function legacyFacts(query, scope) {
  const facts = await readVisibilityFacts(query, scope.owner, { legacyOnly: true, limit: MAX_FACTS + 1 });
  if (facts.length > MAX_FACTS) ineligible();
  return scope.namespace === null ? facts : [];
}

/** @param {Pick<FactMatchPolicy, "hashSessionKey" | "vectorSuppression">} options */
export function createSuppressionReads({ hashSessionKey, vectorSuppression = false }) {
  const policy = { hashSessionKey, vectorSuppression, rowShingles: false };
  const capture = /** @type {const} */ ({ ...policy, rowShingles: true, mode: "capture" });

  /** @type {SuppressionStore["snapshot"]} */
  async function snapshot(tx, scope, candidates) {
    const scoped = readScope(tx, scope);
    let copy;
    try {
      copy = copyCandidates(candidates);
    } catch {
      ineligible();
    }
    const { client, sessionId, occurredAtMs, passages } = copy;
    let digestValues = null;
    if (passages?.length && passages.every(({ digests }) => digests.some(({ alg }) => alg === "sha256"))) {
      const values = new Set(passages.flatMap(({ digests }) => digests.map(({ value }) => value)));
      if (values.size <= MAX_POSITIONS) digestValues = [...values];
    }
    const slotPrefix = JSON.stringify([scoped.namespace, "text", "exact"]).slice(0, -1) + ',[["sha256",';
    const session = client !== undefined && sessionId !== undefined ? { client, sessionId } : undefined;
    const messageSession = client === undefined ? undefined : { client, sessionId: sessionId ?? "" };
    return runOperation(tx, async (query) => {
      try {
        const legacy = await legacyFacts(query, scoped);
        const { rows } = await query(SNAPSHOT_FACTS, [
          scoped.owner, scoped.namespace, session !== undefined, occurredAtMs.length > 0,
          passages?.length !== 0, digestValues, slotPrefix,
        ]);
        const facts = [...decodeFacts(rows, scoped), ...legacy];
        if (facts.length > MAX_FACTS) ineligible();
        const windows = facts.filter(({ fact }) => fact.kind === "window");
        const texts = /** @type {StoredFact<TextFact>[]} */ (facts.filter(({ fact }) => fact.kind === "text"));
        if (windows.length * occurredAtMs.length + texts.length * (passages?.length ?? 0) > MAX_COMPARISONS) ineligible();
        const blockedSession = session !== undefined && facts.some(stored =>
          sessionBlocksIncoming(stored, scoped, session, capture));
        const blockedMessages = [];
        for (const [position, time] of occurredAtMs.entries()) {
          if (windows.some((stored) => factBlocksIncoming(stored,
            { scope: scoped, passages: [], session: messageSession, occurredAtMs: time }, capture) !== false)) {
            blockedMessages.push(position);
          }
        }
        return { blockedSession, blockedMessages, passages: passages === undefined ? texts :
          texts.filter((stored) => factBlocksIncoming(stored, { scope: scoped, passages }, capture) !== false) };
      } catch {
        return ineligible();
      }
    });
  }

  /** @type {SuppressionStore["factsFor"]} */
  async function factsFor(tx, scope, target) {
    let scoped;
    let memoryId;
    try {
      scoped = readScope(tx, scope);
      memoryId = field(target, "memoryId");
    } catch (error) {
      if (error instanceof CoreError && error.code === "internal_error") throw error;
      return "ineligible";
    }
    if (!validString(memoryId)) return "ineligible";
    return runOperation(tx, async (query) => {
      // PostgreSQL statement failures poison the transaction via runOperation.
      // Classification errors return the port's ineligible result.
      try {
        const legacy = await legacyFacts(query, scoped);
        const namespace = scoped.namespace === null ? null : JSON.stringify(scoped.namespace);
        const entry = await selectMemory(query, scoped.owner, namespace, memoryId);
        const { rows } = await query(TARGET_FACTS, [scoped.owner, scoped.namespace, memoryId, entry !== null]);
        const facts = decodeFacts(rows, scoped);
        if (!entry) return facts;
        facts.push(...legacy.filter(({ fact }) => fact.kind === "text" || fact.kind === "session"));
        if (facts.length > MAX_FACTS) ineligible();
        if (!facts.length) return facts;
        const row = await rowFactCandidate(entry, facts);
        const hasSessions = facts.some(({ fact }) => fact.kind === "session");
        const receipts = hasSessions
          ? (await readReceipts(query, scoped.owner, [memoryId], MAX_POSITIONS + 1)).get(memoryId) ?? []
          : [];
        if (receipts.length > MAX_POSITIONS || receipts.length * facts.length > MAX_COMPARISONS) ineligible();
        return facts.filter(stored => matchesRowFact(stored, row, receipts, policy));
      } catch {
        return "ineligible";
      }
    });
  }

  return { snapshot, factsFor };
}
