import { CoreError, factBlocksIncoming, validateSuppressionFact } from "../../core/src/index.mjs";
import { hasRawFence } from "./capture-source.mjs";
import { copyReceipts, inputText } from "./memory-input.mjs";
import { readReceipts, selectMemory } from "./memory-rows.mjs";
import {
  decodeCoreFact, matchesRowFact, readVisibilityFacts, rowFactCandidate, rowVisibilityPolicy, sessionBlocksIncoming, usesSource,
} from "./memory-visibility.mjs";
import { requireLiveRun, runOperation } from "./uow.mjs";

/** @import { FactMatchPolicy, StoredFact, TextFact } from "../../core/src/index.mjs" */
/** @import { Scope, Tx } from "../../core/src/ports/index.d.ts" */
/** @import { PassageFingerprint, SuppressionStore } from "../../core/src/ports/privacy.d.ts" */
/** @import { Connection } from "./driver.mjs" */

const MAX_FACTS = 4096;
const MAX_POSITIONS = 16384;
const MAX_COMPARISONS = 262144;
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
          AND d.key_id IS NULL AND d.label = d.pipeline
          AND f.body -> 'text' = jsonb_build_object('digests', jsonb_build_array(jsonb_build_object(
            'alg', d.alg, 'value', d.value, 'pipeline', d.pipeline,
            'redactionVersion', d.redaction_version, 'keyId', d.key_id)))
          AND f.body - 'text' - 'namespace' = jsonb_build_object('kind', f.kind, 'origin', f.origin, 'mode', f.mode)
          AND (f.body -> 'namespace' IS NULL OR jsonb_typeof(f.body -> 'namespace') IN ('null', 'string'))
          AND f.slot IN (
            $7 || to_json(d.value)::text || ']],null]',
            $7 || to_json(d.value)::text || ',null,' || to_json(d.label)::text || ',' ||
              to_json(d.pipeline)::text || ',' || d.redaction_version::text || ']],null]')
      )
    ))
  )
  ORDER BY f.epoch LIMIT ${MAX_FACTS + 1}`;

const TARGET_FACTS = `SELECT ${FACT_COLUMNS} FROM core_suppression_facts f
  WHERE ${FACT_SCOPE} AND (
    (f.kind = 'identity' AND (f.body ->> 'memoryId') COLLATE "C" = $3)
    OR ($4 AND f.kind IN ('text', 'session', 'window'))
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
    pipeline: field(digest, "pipeline"), redactionVersion: field(digest, "redactionVersion"), label: field(digest, "label"),
  }), 128);
  const shingleList = field(value, "shingles");
  const shingles = shingleList == null ? null : copyList(shingleList, copyShingle);
  const keyId = field(value, "keyId") ?? null;
  const retained = field(value, "retainedShingles");
  const retainedShingles = retained === undefined ? undefined : copyList(retained, (entry) => {
    const keyId = field(entry, "keyId");
    if (!validString(keyId, 64)) ineligible();
    return { keyId, shingles: copyList(field(entry, "shingles"), copyShingle) };
  });
  validateSuppressionFact({
    owner: "validation", actionId: "validation", kind: "text", mode: "full", origin: "forget",
    text: { digests, shingles, keyId },
  });
  return { digests, shingles, keyId, retainedShingles };
}

/** @param {unknown} item */
function copyShingle(item) {
  if (typeof item !== "string" || item.length > 64 || !/^[0-9a-f]+$/u.test(item)) ineligible();
  return item;
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

/** @param {Tx} tx @param {Scope} scope @param {boolean} allowNonNullNamespace */
function readScope(tx, scope, allowNonNullNamespace) {
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
  if (namespace !== null && (!allowNonNullNamespace || !validString(namespace))) ineligible();
  return { owner: tx.owner, namespace };
}

/** @param {any[]} rows @param {Scope} scope @returns {StoredFact[]} */
function decodeFacts(rows, scope) {
  if (rows.length > MAX_FACTS) ineligible();
  return rows.map((row) => {
    const stored = decodeCoreFact(row, scope.owner);
    if ((stored.fact.namespace ?? null) !== scope.namespace) ineligible();
    return stored;
  });
}

/** @param {Connection["query"]} query @param {Scope} scope */
async function legacyFacts(query, scope) {
  const facts = await readVisibilityFacts(query, scope.owner, { legacyOnly: true, limit: MAX_FACTS + 1 });
  if (facts.length > MAX_FACTS) ineligible();
  return scope.namespace === null ? facts : [];
}

/** @param {Pick<FactMatchPolicy, "hashSessionKey" | "vectorSuppression"> & {allowNonNullNamespace?: boolean}} options */
export function createSuppressionReads({ hashSessionKey, allowNonNullNamespace = false }) {
  const policy = rowVisibilityPolicy(hashSessionKey);
  const capture = /** @type {const} */ ({ hashSessionKey, mode: "capture" });

  /** @type {SuppressionStore["snapshot"]} */
  async function snapshot(tx, scope, candidates) {
    const scoped = readScope(tx, scope, allowNonNullNamespace);
    let copy;
    try {
      copy = copyCandidates(candidates);
    } catch {
      ineligible();
    }
    const { client, sessionId, occurredAtMs, passages } = copy;
    let digestValues = null;
    if (passages?.length && passages.every(({ digests }) =>
      digests.some(({ alg, label }) => alg === "sha256" && label === undefined))) {
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
        // Core decides containment at capture and write time. Keep the full evidence
        // for every scoped full fact, including facts decoded from hosted rows.
        const projected = passages === undefined ? texts : passages.length === 0 ? [] :
          texts.filter((stored) => stored.fact.mode === "full" ||
            factBlocksIncoming(stored, { scope: scoped, passages }, capture) !== false);
        return { blockedSession, blockedMessages, passages: projected };
      } catch {
        return ineligible();
      }
    });
  }

  /** @type {NonNullable<SuppressionStore["receiptWithheld"]>} */
  async function receiptWithheld(tx, scope, input) {
    const scoped = readScope(tx, scope, allowNonNullNamespace);
    const [{ client, sessionId, messageId, occurredAtMs }] = copyReceipts([input]);
    inputText(input.excerpt);
    const withheld = await runOperation(tx, async (query) => {
      if (await hasRawFence(query, { scope: scoped, client, sessionId })) return true;
      if (scoped.namespace !== null) return false;
      const { rows } = await query(`SELECT 1 FROM core_memory_receipts
        WHERE user_id = $1 AND client = $2 AND session_id = $3 AND message_id = $4 AND forgotten_at IS NOT NULL LIMIT 1`,
      [scoped.owner, client, sessionId, messageId]);
      return rows.length > 0;
    });
    if (withheld) return true;
    const { blockedSession, blockedMessages } = await snapshot(tx, scoped, { client, sessionId, occurredAtMs: [occurredAtMs] });
    return blockedSession || blockedMessages.length > 0;
  }

  /** @type {SuppressionStore["factsFor"]} */
  async function factsFor(tx, scope, target) {
    let scoped;
    let memoryId;
    try {
      scoped = readScope(tx, scope, allowNonNullNamespace);
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
        facts.push(...legacy);
        if (facts.length > MAX_FACTS) ineligible();
        if (!facts.length) return facts;
        const row = await rowFactCandidate(entry, facts);
        const receipts = facts.some(usesSource)
          ? (await readReceipts(query, scoped.owner, [memoryId], MAX_POSITIONS + 1)).get(memoryId) ?? []
          : [];
        if (receipts.length > MAX_POSITIONS || receipts.length * facts.length > MAX_COMPARISONS) ineligible();
        return facts.filter(stored => matchesRowFact(stored, row, receipts, policy, entry.memory));
      } catch {
        return "ineligible";
      }
    });
  }

  return { snapshot, receiptWithheld, factsFor };
}
