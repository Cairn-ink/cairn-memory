import { CoreError, factBlocksIncoming } from "../../core/src/index.mjs";
import { readVisibilityFacts } from "./memory-visibility.mjs";

/** @import { CaptureKey, CaptureMessage } from "../../core/src/ports/capture.d.ts" */
/** @import { StoredFact } from "../../core/src/suppression-fact.mjs" */
/** @import { CaptureOptions } from "./capture.d.mts" */
/** @import { Connection } from "./driver.mjs" */
/** @typedef {{message_mac: string, content_mac: string | null}} Proof */

const MAX_LINEAGE_SESSIONS = 1_000;
const MAX_LINEAGE_VERTICES = 20_000;
// Traverse sessions and proof pairs separately so each pair is expanded only once.
const CHECK_LINEAGE = `WITH RECURSIVE fences(session_id) AS MATERIALIZED (
    SELECT session_id FROM capture_raw_fences WHERE user_id = $1 AND client = $2
    UNION SELECT unnest($4::text[])
  ), incoming AS (
    SELECT * FROM jsonb_to_recordset($5::jsonb) AS proof(message_mac text, content_mac text)
  ), roots(session_id, message_mac, content_mac) AS (
    SELECT $3::text, NULL::text, NULL::text WHERE $6::boolean OR EXISTS (SELECT 1 FROM fences)
    UNION ALL
    SELECT NULL::text, incoming.message_mac, incoming.content_mac
    FROM incoming WHERE incoming.content_mac IS NOT NULL AND ($6::boolean OR EXISTS (SELECT 1 FROM fences))
  ), vertices(session_id, message_mac, content_mac) AS (
    SELECT session_id, message_mac, content_mac FROM roots
    UNION
    SELECT next.session_id, next.message_mac, next.content_mac
    FROM vertices v CROSS JOIN LATERAL (
      SELECT NULL::text, l.message_mac, l.content_mac
      FROM capture_raw_lineage l
      WHERE l.user_id = $1 AND l.client = $2 AND l.session_id = v.session_id AND l.content_mac IS NOT NULL
      UNION ALL
      SELECT l.session_id, NULL::text, NULL::text
      FROM capture_raw_lineage l
      WHERE v.session_id IS NULL AND l.user_id = $1 AND l.client = $2
        AND l.message_mac = v.message_mac AND l.content_mac = v.content_mac
    ) AS next(session_id, message_mac, content_mac)
  ), bounded AS MATERIALIZED (SELECT * FROM vertices LIMIT ${MAX_LINEAGE_VERTICES + 1}),
  uncertain AS NOT MATERIALIZED (
    SELECT l.session_id FROM capture_raw_lineage l
    WHERE l.user_id = $1 AND l.client = $2 AND EXISTS (
      SELECT 1 FROM incoming WHERE incoming.message_mac = l.message_mac
        AND (incoming.content_mac IS NULL OR l.content_mac IS NULL)
    )
  )
  SELECT EXISTS (SELECT 1 FROM bounded JOIN fences USING (session_id)) AS fenced,
    (SELECT count(*) FROM bounded) > ${MAX_LINEAGE_VERTICES}
      OR (SELECT count(session_id) FROM bounded) > ${MAX_LINEAGE_SESSIONS} AS exceeded,
    EXISTS (SELECT 1 FROM uncertain JOIN fences USING (session_id)) AS withheld,
    ARRAY(
      SELECT session_id FROM bounded WHERE $6::boolean AND session_id <> $3
      UNION
      SELECT session_id FROM uncertain WHERE $6::boolean AND session_id <> $3
    ) AS hash_candidates`;

const encoder = new TextEncoder();

/** @param {string} secret */
export function createCaptureProofs(secret) {
  /** @type {Promise<CryptoKey> | undefined} */
  let key;
  /** @param {string} value */
  async function sign(value) {
    key ??= crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const bytes = await crypto.subtle.sign("HMAC", await key, encoder.encode(value));
    return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  /** @param {Pick<CaptureKey, "scope" | "client">} capture @param {readonly Pick<CaptureMessage, "id" | "content">[]} messages @returns {Promise<Proof[] | null>} */
  return async ({ scope: { owner }, client }, messages) => {
    if (!messages.length) return [];
    try {
      return await Promise.all(messages.map(async ({ id, content }) => ({
        message_mac: await sign(id),
        content_mac: content === "" ? null :
          await sign("\0cairn:raw-lineage-content:" + JSON.stringify([owner, client, id, content])),
      })));
    } catch {
      return null;
    }
  };
}

/**
 * @param {Set<string>} hashes @param {CaptureOptions["hashSessionKey"]} hashSessionKey
 * @param {string} client @param {string} sessionId
 */
function withholdsHashedAncestor(hashes, hashSessionKey, client, sessionId) {
  try {
    const hash = hashSessionKey?.(client, sessionId);
    return typeof hash !== "string" || !/^[0-9a-f]{64}$/u.test(hash) || hashes.has(hash);
  } catch {
    return true;
  }
}

/**
 * @param {Connection["query"]} query @param {CaptureKey} key
 * @param {readonly (number | null)[]} times @param {Proof[] | null} proofs @param {"read" | "assert"} mode
 * @param {CaptureOptions["hashSessionKey"]} hashSessionKey
 */
export async function filterSources(query, key, times, proofs, mode, hashSessionKey) {
  const { scope, client, sessionId } = key;
  const facts = await readVisibilityFacts(query, scope.owner, { source: key });
  /** @type {StoredFact[]} */
  const windows = [];
  /** @type {Set<string>} */
  const fencedSessions = new Set();
  /** @type {Set<string>} */
  const fencedSessionHashes = new Set();
  const candidate = { scope, passages: [], session: { client, sessionId } };
  const policy = /** @type {const} */ ({ mode: "capture", hashSessionKey });
  for (const stored of facts) {
    const { fact } = stored;
    if (fact.kind === "window") {
      windows.push(stored);
    } else if (fact.kind === "session") {
      if (factBlocksIncoming(stored, candidate, policy) !== false) {
        if (mode === "assert") throw new CoreError("suppressed");
        return [];
      }
      const ancestor = fact.session;
      // Shared lineage identifies ancestors by owner, client and session. Test the
      // session facts in their own scope, keeping direct checks in the incoming scope.
      if (ancestor.client === client && "sessionId" in ancestor && ancestor.sessionId !== sessionId &&
          factBlocksIncoming(stored, {
            ...candidate, scope: { owner: scope.owner, namespace: fact.namespace ?? null }, session: ancestor,
          }, policy) !== false) {
        fencedSessions.add(ancestor.sessionId);
      } else if (ancestor.client === client && "sessionKeyHash" in ancestor) {
        fencedSessionHashes.add(ancestor.sessionKeyHash);
      }
    }
  }

  const positions = Array.from(times.keys()).filter((position) => !windows.some((stored) =>
    factBlocksIncoming(stored, { ...candidate, occurredAtMs: times[position] }, policy) !== false));
  if (mode === "assert" && positions.length !== times.length) throw new CoreError("suppressed");

  if (await lineageWithheld(query, key, proofs, fencedSessions, fencedSessionHashes, hashSessionKey)) {
    if (mode === "assert") throw new CoreError("lineage_fenced");
    return [];
  }
  return positions;
}

/**
 * @param {Connection["query"]} query @param {Pick<CaptureKey, "scope" | "client" | "sessionId">} key
 * @param {Proof[] | null} proofs @param {Set<string>} fencedSessions @param {Set<string>} fencedSessionHashes
 * @param {CaptureOptions["hashSessionKey"]} hashSessionKey
 */
export async function lineageWithheld(query, { scope, client, sessionId }, proofs, fencedSessions, fencedSessionHashes, hashSessionKey) {
  // Signing failures and older leases can leave proofs unavailable.
  if (proofs === null) return true;
  const { rows: [lineage] } = await query(CHECK_LINEAGE, [
    scope.owner, client, sessionId, [...fencedSessions], JSON.stringify(proofs), fencedSessionHashes.size > 0,
  ]);
  // Check every returned hash candidate, including ID-only matches outside the traversal.
  return lineage?.fenced !== false || lineage.withheld !== false || lineage.exceeded !== false ||
    lineage.hash_candidates.some((/** @type {string} */ id) =>
      withholdsHashedAncestor(fencedSessionHashes, hashSessionKey, client, id));
}
