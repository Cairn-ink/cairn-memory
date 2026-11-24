import { CoreError, factBlocksIncoming } from "../../core/src/index.mjs";
import { CHECK_LINEAGE, LEGACY_EVENTS } from "./raw-lineage-query.mjs";

/** @import { CaptureKey, CaptureMessage } from "../../core/src/ports/capture.d.ts" */
/** @import { StoredFact } from "../../core/src/suppression-fact.mjs" */
/** @import { Scope } from "../../core/src/ports/common.d.ts" */
/** @import { CaptureOptions } from "./capture.d.mts" */
/** @import { Connection } from "./driver.mjs" */
/** @typedef {{message_mac: string, content_mac: string | null}} Proof */

const SOURCE_FACTS = `SELECT kind, body, action_id FROM core_suppression_facts
  WHERE user_id = $1 AND (
    kind = 'window' AND (body ->> 'namespace') IS NOT DISTINCT FROM $2
    OR kind = 'session' AND body #>> '{session,client}' = $3
  )
  UNION ALL
  SELECT 'window', jsonb_build_object('kind', 'window', 'origin', 'backfill', 'client', client,
    'window', jsonb_build_object('startMs', floor(EXTRACT(EPOCH FROM window_start) * 1000),
      'endMs', ceil(EXTRACT(EPOCH FROM window_end) * 1000))), id
  FROM suppressions WHERE user_id = $1 AND $2::text IS NULL AND kind = 'window'
    AND (client IS NULL OR client = $3)`;

const encoder = new TextEncoder();

/** @param {string} secret */
export function createCaptureProofs(secret) {
  if (typeof secret !== "string" || secret.length === 0) throw new CoreError("invalid_input");
  /** @type {Promise<CryptoKey> | undefined} */
  let key;
  /** @type {Promise<string> | undefined} */
  let keyId;
  /** @param {string} value */
  async function sign(value) {
    key ??= crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const bytes = await crypto.subtle.sign("HMAC", await key, encoder.encode(value));
    return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  /** @param {CaptureKey} capture @param {readonly CaptureMessage[]} messages @returns {Promise<Proof[] | null>} */
  const proofs = async ({ scope: { owner }, client }, messages) => {
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
  return Object.assign(proofs, { sign, keyId: () => keyId ??= sign("\0cairn:w1a:raw-lineage") });
}

/** @typedef {{client: string, sessionId: string, scope: Scope}} Source */
/** @typedef {ReturnType<typeof createCaptureProofs>} Signer */

/** @param {Connection["query"]} query @param {Source} source */
async function sourceFacts(query, { scope, client }) {
  const { rows } = await query(SOURCE_FACTS, [scope.owner, scope.namespace, client]);
  return /** @type {StoredFact[]} */ (rows.map(({ kind, body, action_id: actionId }) => {
    if (body?.kind !== kind) throw new CoreError("suppressed");
    return { fact: { ...body, owner: scope.owner, actionId } };
  }));
}

/**
 * @param {Connection["query"]} query @param {Source} source @param {Signer} signer
 * @param {string} fences @param {boolean} hashes @param {boolean} useCoreLedger
 */
async function legacyProofs(query, { scope, client, sessionId }, signer, fences, hashes, useCoreLedger) {
  const keyId = await signer.keyId().catch(() => null);
  if (keyId === null) return null;
  const incoming = [];
  const ancestors = [];
  let after = "0";
  for (;;) {
    const { rows } = await query(LEGACY_EVENTS,
      [scope.owner, client, scope.namespace, sessionId, after, keyId, fences, hashes, "content:" + keyId]);
    if (!rows.length) return { incoming, ancestors };
    for (const row of rows) {
      const own = row.session_id === sessionId && row.core_namespace === scope.namespace;
      // Explicit capture proofs already describe the positions in a Core outbox.
      if (own && !row.untagged && !useCoreLedger) continue;
      try {
        const request = typeof row.raw_request === "string" ? JSON.parse(row.raw_request) : row.raw_request;
        for (const { id } of request.messages) {
          if (typeof id !== "string") return null;
          const message_mac = await signer.sign(id);
          if (own) {
            incoming.push({ message_mac, content_mac: null });
          } else {
            ancestors.push({ session_id: row.session_id, namespace: row.core_namespace, untagged: row.untagged, message_mac });
          }
        }
      } catch {
        return null;
      }
    }
    after = rows.at(-1).arrival_order;
  }
}

/**
 * @param {Connection["query"]} query @param {Source} source @param {Proof[] | null} proofs
 * @param {StoredFact[]} facts @param {Signer} signer @param {CaptureOptions["hashSessionKey"]} hashSessionKey
 * @param {boolean} raw
 * @returns {Promise<"allowed" | "suppressed" | "proven" | "id-only" | "unknown" | "session-unknown">}
 */
async function lineageVerdict(query, source, proofs, facts, signer, hashSessionKey, raw) {
  if (proofs === null) return "unknown";
  const { scope, client, sessionId } = source;
  const policy = /** @type {const} */ ({ mode: "capture", hashSessionKey });
  const fences = [];
  const hashes = [];
  for (const stored of facts) {
    const { fact } = stored;
    if (fact.kind !== "session") continue;
    const ancestorScope = { owner: scope.owner, namespace: fact.namespace ?? null };
    const applies = factBlocksIncoming(stored, { scope, passages: [], session: { client, sessionId } }, policy);
    if (applies === true) return "suppressed";
    if (applies !== false) return "session-unknown";
    if ("sessionKeyHash" in fact.session) {
      hashes.push(stored);
    } else if (factBlocksIncoming(stored, { scope: ancestorScope, passages: [], session: fact.session }, policy) !== false) {
      fences.push({ session_id: fact.session.sessionId, namespace: ancestorScope.namespace, wildcard: true });
    }
  }

  const encoded = JSON.stringify(fences);
  const hasHashes = hashes.length > 0;
  const legacy = await legacyProofs(query, source, signer, encoded, hasHashes, raw || !proofs.length);
  if (!legacy) return "unknown";
  const { rows: [lineage] } = await query(CHECK_LINEAGE, [scope.owner, client, scope.namespace, sessionId,
    JSON.stringify([...proofs, ...legacy.incoming]), encoded, hasHashes, raw, JSON.stringify(legacy.ancestors)]);
  if (!lineage || lineage.exceeded) return "unknown";
  if (lineage.direct || lineage.proven) return "proven";
  if (lineage.fenced) return "id-only";
  let weak = false;
  for (const [id, namespace, unscoped, proven] of lineage.hash_candidates) {
    for (const stored of hashes) {
      const factNamespace = stored.fact.namespace ?? null;
      if (!unscoped && namespace !== factNamespace) continue;
      const match = factBlocksIncoming(stored, {
        scope: { owner: scope.owner, namespace: factNamespace }, passages: [], session: { client, sessionId: id },
      }, policy);
      if (match === "ineligible") return "unknown";
      if (match === true) {
        if (proven) return "proven";
        weak = true;
      }
    }
  }
  if (weak) return "id-only";
  // The hosted Raw gate follows an ID match with proven edges. Evaluate each
  // reachable component under the same bounds, so unrelated weak matches do
  // not consume another component's session budget.
  if (raw) {
    for (const [id, namespace] of lineage.weak_roots) {
      const ancestor = { scope: { owner: scope.owner, namespace }, client, sessionId: id };
      const result = await lineageVerdict(query, ancestor, [], facts, signer, hashSessionKey, false);
      if (result === "unknown" || result === "session-unknown") return "unknown";
      if (result === "proven" || result === "suppressed") return "id-only";
    }
  }
  return "allowed";
}

/**
 * @param {Connection["query"]} query @param {Source} source
 * @param {readonly (number | null)[]} times @param {Proof[] | null} proofs @param {"read" | "assert" | "raw"} mode
 * @param {Signer} signer @param {CaptureOptions["hashSessionKey"]} hashSessionKey
 */
export async function filterSources(query, source, times, proofs, mode, signer, hashSessionKey) {
  const { scope, client, sessionId } = source;
  const facts = await sourceFacts(query, source);
  const candidate = { scope, passages: [], session: { client, sessionId } };
  const policy = /** @type {const} */ ({ mode: "capture", hashSessionKey });
  const windows = facts.filter(({ fact }) => fact.kind === "window");
  const positions = Array.from(times.keys()).filter((position) => !windows.some((stored) =>
    factBlocksIncoming(stored, { ...candidate, occurredAtMs: times[position] }, policy) !== false));
  if (mode === "assert" && positions.length !== times.length) throw new CoreError("suppressed");

  const verdict = await lineageVerdict(query, source, proofs, facts, signer, hashSessionKey, mode === "raw");
  if (verdict === "allowed") return positions;
  if (mode === "assert") throw new CoreError(verdict === "suppressed" || verdict === "session-unknown" ? "suppressed" : "lineage_fenced");
  return [];
}

/**
 * @param {Connection["query"]} query @param {Source} source
 * @param {Signer} signer @param {CaptureOptions["hashSessionKey"]} hashSessionKey @param {boolean} [raw]
 */
export async function checkSourceLineage(query, source, signer, hashSessionKey, raw = true) {
  return lineageVerdict(query, source, [], await sourceFacts(query, source), signer, hashSessionKey, raw);
}
