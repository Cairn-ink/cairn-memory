import { CoreError, factBlocksIncoming } from "../../core/src/index.mjs";
import { readVisibilityFacts } from "./memory-visibility.mjs";
import { CHECK_LINEAGE, LEGACY_EVENTS } from "./raw-lineage-query.mjs";

/** @import { CaptureKey, CaptureMessage } from "../../core/src/ports/capture.d.ts" */
/** @import { StoredFact } from "../../core/src/suppression-fact.mjs" */
/** @import { Scope } from "../../core/src/ports/common.d.ts" */
/** @import { CaptureOptions } from "./capture.d.mts" */
/** @import { Connection } from "./driver.mjs" */
/** @typedef {{message_mac: string, content_mac: string | null}} Proof */

const ANCESTOR_SESSION_FACTS = `SELECT kind, body, action_id FROM core_suppression_facts
  WHERE user_id = $1 AND kind = 'session' AND body #>> '{session,client}' = $2`;

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

  /** @param {Pick<CaptureKey, "scope" | "client">} capture @param {readonly Pick<CaptureMessage, "id" | "content">[]} messages @returns {Promise<Proof[] | null>} */
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
async function readAncestorFacts(query, { scope, client }) {
  const { rows } = await query(ANCESTOR_SESSION_FACTS, [scope.owner, client]);
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
 * @param {{incoming: StoredFact[], ancestors?: StoredFact[]}} facts
 * @param {Signer} signer @param {CaptureOptions["hashSessionKey"]} hashSessionKey
 * @param {boolean} raw
 * @returns {Promise<"allowed" | "suppressed" | "proven" | "id-only" | "unknown" | "session-unknown">}
 */
async function lineageVerdict(query, source, proofs, { incoming, ancestors }, signer, hashSessionKey, raw) {
  if (proofs === null) return "unknown";
  const { scope, client, sessionId } = source;
  const policy = /** @type {const} */ ({ mode: "capture", hashSessionKey });
  for (const stored of incoming) {
    if (stored.fact.kind !== "session") continue;
    const applies = factBlocksIncoming(stored, { scope, passages: [], session: { client, sessionId } }, policy);
    if (applies === true) return "suppressed";
    if (applies !== false) return "session-unknown";
  }

  // Ancestor matching needs Core session facts in their own namespaces. An
  // incoming-scope visibility read can omit a plain fact for the same session ID.
  // The lineage SQL's FENCES still reads legacy session suppressions directly.
  ancestors ??= await readAncestorFacts(query, source);
  const fences = [];
  const hashes = [];
  for (const stored of ancestors) {
    const { fact } = stored;
    if (fact.kind !== "session") continue;
    const ancestorScope = { owner: scope.owner, namespace: fact.namespace ?? null };
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
      const result = await lineageVerdict(query, ancestor, [], { incoming: ancestors, ancestors }, signer, hashSessionKey, false);
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
  const facts = await readVisibilityFacts(query, scope.owner, { source });
  const candidate = { scope, passages: [], session: { client, sessionId } };
  const policy = /** @type {const} */ ({ mode: "capture", hashSessionKey });
  const windows = facts.filter(({ fact }) => fact.kind === "window");
  const positions = Array.from(times.keys()).filter((position) => !windows.some((stored) =>
    factBlocksIncoming(stored, { ...candidate, occurredAtMs: times[position] }, policy) !== false));
  if (mode === "assert" && positions.length !== times.length) throw new CoreError("suppressed");

  const verdict = await lineageVerdict(query, source, proofs, { incoming: facts }, signer, hashSessionKey, mode === "raw");
  if (verdict === "allowed") return positions;
  if (mode === "assert") throw new CoreError(verdict === "suppressed" || verdict === "session-unknown" ? "suppressed" : "lineage_fenced");
  return [];
}

/**
 * @param {Connection["query"]} query @param {Source} source
 * @param {Signer} signer @param {CaptureOptions["hashSessionKey"]} hashSessionKey @param {boolean} [raw]
 */
export async function checkSourceLineage(query, source, signer, hashSessionKey, raw = true) {
  const incoming = await readVisibilityFacts(query, source.scope.owner, { source });
  return lineageVerdict(query, source, [], { incoming }, signer, hashSessionKey, raw);
}

const MAX_LINEAGE_SESSIONS = 1_000;
const MAX_LINEAGE_VERTICES = 20_000;
// Traverse sessions and proof pairs separately so each pair is expanded only once.
/** @param {string} client */
function readLineageVertices(client) {
  return `vertices(session_id, message_mac, content_mac) AS (
    SELECT session_id, message_mac, content_mac FROM roots
    UNION
    SELECT next.session_id, next.message_mac, next.content_mac
    FROM vertices v CROSS JOIN LATERAL (
      (SELECT NULL::text, l.message_mac, l.content_mac
      FROM capture_raw_lineage l
      WHERE l.user_id = $1 AND l.client = ${client} AND l.session_id BETWEEN v.session_id AND v.session_id AND l.content_mac IS NOT NULL
        ORDER BY l.session_id, l.message_mac, l.content_mac LIMIT ${MAX_LINEAGE_VERTICES + 1})
      UNION ALL
      (SELECT l.session_id, NULL::text, NULL::text
      FROM capture_raw_lineage l
      WHERE v.session_id IS NULL AND l.user_id = $1 AND l.client = ${client}
        AND l.message_mac = v.message_mac AND l.content_mac = v.content_mac
        ORDER BY l.session_id LIMIT ${MAX_LINEAGE_VERTICES + 1})
    ) AS next(session_id, message_mac, content_mac)
  ), bounded AS MATERIALIZED (SELECT * FROM vertices LIMIT ${MAX_LINEAGE_VERTICES + 1})`;
}

const EXCEEDED = `(SELECT count(*) FROM bounded) > ${MAX_LINEAGE_VERTICES}
  OR (SELECT count(session_id) FROM bounded) > ${MAX_LINEAGE_SESSIONS}`;

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

// Discover clients from the fences and facts, including in an unfiltered raw read.
// Ordered point ranges preserve the session index path when one unrelated session dominates the statistics.
const READ_LINEAGE = `WITH fences AS MATERIALIZED (
    SELECT client, session_id FROM capture_raw_fences
    WHERE user_id = $1 AND ($2::text[] IS NULL OR client = ANY($2))
    UNION
    SELECT * FROM jsonb_to_recordset($3::jsonb) AS f(client text, session_id text)
  ), clients AS (SELECT DISTINCT client FROM fences)
  SELECT c.client, graph.* FROM clients c CROSS JOIN LATERAL (
    WITH RECURSIVE anchors AS MATERIALIZED (
      SELECT f.session_id, l.message_mac, l.content_mac FROM fences f CROSS JOIN LATERAL (
        SELECT message_mac, content_mac FROM capture_raw_lineage
        WHERE user_id = $1 AND client = c.client AND session_id BETWEEN f.session_id AND f.session_id
        ORDER BY session_id, message_mac, content_mac LIMIT ${MAX_LINEAGE_VERTICES + 1}
      ) l WHERE f.client = c.client LIMIT ${MAX_LINEAGE_VERTICES + 1}
    ), roots(session_id, message_mac, content_mac) AS (
      SELECT NULL::text, a.message_mac, a.content_mac FROM anchors a CROSS JOIN LATERAL (
        SELECT 1 FROM capture_raw_lineage l WHERE l.user_id = $1 AND l.client = c.client
          AND l.message_mac = a.message_mac AND l.content_mac = a.content_mac AND l.session_id <> a.session_id
        LIMIT 1
      ) peer WHERE a.content_mac IS NOT NULL
    ), ${readLineageVertices("c.client")}, proofs AS MATERIALIZED (
      SELECT message_mac, content_mac, true AS anchor FROM anchors
      UNION
      SELECT message_mac, content_mac, false FROM bounded WHERE session_id IS NULL
    ), peers AS MATERIALIZED (
      SELECT p.* FROM (SELECT DISTINCT message_mac FROM proofs) k CROSS JOIN LATERAL (
        SELECT session_id, message_mac, content_mac FROM capture_raw_lineage l
        WHERE l.user_id = $1 AND l.client = c.client AND l.message_mac = k.message_mac OFFSET 0
      ) p LIMIT ${MAX_LINEAGE_VERTICES + 1}
    )
    SELECT (${EXCEEDED}) OR (SELECT count(*) FROM anchors) > ${MAX_LINEAGE_VERTICES}
      OR (SELECT count(*) FROM peers) > ${MAX_LINEAGE_VERTICES} AS exceeded,
      ARRAY(SELECT session_id FROM bounded WHERE session_id IS NOT NULL
        UNION SELECT session_id FROM fences WHERE client = c.client) AS sessions,
      COALESCE((SELECT jsonb_agg(proofs) FROM proofs), '[]'::jsonb) AS proofs,
      COALESCE((SELECT jsonb_agg(peers) FROM peers), '[]'::jsonb) AS peers
  ) graph`;

const MAX_LEGACY_ROWS_PER_SESSION = 1_000;
const READ_LEGACY_IDS = `SELECT s.client, s.session_id, r.id, r.message_id
  FROM jsonb_to_recordset($2::jsonb) AS s(client text, session_id text)
  CROSS JOIN LATERAL (
    SELECT id, message_id FROM raw_messages
    WHERE user_id = $1 AND client = s.client AND session_id = s.session_id
    ORDER BY message_id LIMIT ${MAX_LEGACY_ROWS_PER_SESSION + 1}
  ) r`;

/** @typedef {{client: string, session_id: string}} SqlSession */
/** @typedef {Proof & {anchor: boolean}} ReadProof */

/** @param {Map<string, ReadProof[]>} proofs @param {Proof} proof */
function matchesReadProof(proofs, { message_mac, content_mac }) {
  return proofs.get(message_mac)?.some(anchor =>
    (content_mac !== null && content_mac === anchor.content_mac) ||
    (anchor.anchor && (content_mac === null || anchor.content_mac === null))) ?? false;
}

/**
 * @param {Connection["query"]} query @param {string} owner @param {string[] | null} clients
 * @param {ReturnType<typeof createCaptureProofs>} captureProofs
 * @param {readonly import("../../core/src/suppression-fact.mjs").SessionRef[]} facts
 * @param {CaptureOptions["hashSessionKey"]} hashSessionKey
 */
export async function readLineageFence(query, owner, clients, captureProofs, facts, hashSessionKey) {
  /** @type {SqlSession[]} */
  const roots = [];
  /** @type {Map<string, Set<string>>} */
  const hashes = new Map();
  /** @type {Set<string>} */
  const withheldClients = new Set();
  for (const fact of facts) {
    if (clients && !clients.includes(fact.client)) continue;
    if ("sessionId" in fact) {
      roots.push({ client: fact.client, session_id: fact.sessionId });
    } else {
      let values = hashes.get(fact.client);
      if (!values) hashes.set(fact.client, values = new Set());
      values.add(fact.sessionKeyHash);
    }
  }
  if (hashes.size) {
    // Opaque hashes can only be resolved against the recorded session IDs.
    const { rows } = await query(`SELECT c.client, l.session_id FROM unnest($2::text[]) AS c(client)
      CROSS JOIN LATERAL (
        WITH RECURSIVE sessions(session_id, position) AS (
          (SELECT session_id, 1 FROM capture_raw_lineage
            WHERE user_id = $1 AND client = c.client ORDER BY session_id LIMIT 1)
          UNION ALL
          SELECT next.session_id, s.position + 1 FROM sessions s CROSS JOIN LATERAL (
            SELECT session_id FROM capture_raw_lineage
            WHERE user_id = $1 AND client = c.client AND session_id > s.session_id
            ORDER BY session_id LIMIT 1
          ) next WHERE s.position <= ${MAX_LINEAGE_SESSIONS}
        )
        SELECT session_id FROM sessions
      ) l`, [owner, [...hashes.keys()]]);
    const counts = new Map();
    for (const { client, session_id } of rows) {
      const count = (counts.get(client) ?? 0) + 1;
      counts.set(client, count);
      if (count > MAX_LINEAGE_SESSIONS) withheldClients.add(client);
      else if (withholdsHashedAncestor(hashes.get(client) ?? new Set(), hashSessionKey, client, session_id)) {
        roots.push({ client, session_id });
      }
    }
  }
  /** @type {Map<string, {sessions: Set<string>, proofs: Map<string, ReadProof[]>, touched: Map<string, Set<string>>}>} */
  const verdicts = new Map();
  /** @type {SqlSession[]} */
  const touched = [];
  // Recursive cardinality estimates can trigger per-statement JIT compilation on tiny walks.
  await query("SET LOCAL jit = off");
  const { rows } = await query(READ_LINEAGE, [owner, clients, JSON.stringify(roots)]);
  for (const graph of rows) {
    const { client, exceeded } = graph;
    if (exceeded) withheldClients.add(client);
    if (withheldClients.has(client)) continue;
    /** @type {Set<string>} */
    const sessions = new Set(graph.sessions);
    /** @type {Map<string, ReadProof[]>} */
    const proofs = new Map();
    for (const proof of graph.proofs) {
      let matches = proofs.get(proof.message_mac);
      if (!matches) proofs.set(proof.message_mac, matches = []);
      matches.push(proof);
    }
    /** @type {Map<string, Set<string>>} */
    const recorded = new Map();
    for (const { session_id, ...proof } of graph.peers) {
      if (matchesReadProof(proofs, proof)) sessions.add(session_id);
      let evidence = recorded.get(session_id);
      if (!evidence) recorded.set(session_id, evidence = new Set());
      evidence.add(proof.message_mac);
    }
    for (const [session_id, evidence] of recorded) {
      // A different proof for a known ID establishes a touch. A fallback is
      // needed only when another ID in the fence has no proof in that session.
      if (!sessions.has(session_id) && evidence.size < proofs.size) touched.push({ client, session_id });
    }
    verdicts.set(client, { sessions, proofs, touched: recorded });
  }

  let overflowSessions = 0;
  if (touched.length) {
    const { rows: rawIds } = await query(READ_LEGACY_IDS, [owner, JSON.stringify(touched)]);
    /** @type {Map<string, Array<{id: string, message_id: string}>>} */
    const bySession = new Map();
    for (const row of rawIds) {
      const key = JSON.stringify([row.client, row.session_id]);
      let ids = bySession.get(key);
      if (!ids) bySession.set(key, ids = []);
      ids.push(row);
    }
    const missing = [];
    for (const { client, session_id } of touched) {
      const ids = bySession.get(JSON.stringify([client, session_id])) ?? [];
      const verdict = verdicts.get(client);
      if (!verdict || !ids.length) continue;
      if (ids.length > MAX_LEGACY_ROWS_PER_SESSION) {
        verdict.sessions.add(session_id);
        overflowSessions++;
        continue;
      }
      const signatures = await captureProofs({ scope: { owner, namespace: null }, client },
        ids.map(({ message_id }) => ({ id: message_id, content: "" })));
      if (!signatures) {
        verdict.sessions.add(session_id);
        continue;
      }
      const recorded = verdict.touched.get(session_id);
      for (const [i, { message_mac }] of signatures.entries()) {
        if (verdict.proofs.has(message_mac) && !recorded?.has(message_mac)) missing.push(ids[i].id);
      }
    }
    if (missing.length) {
      const { rows: legacy } = await query(`SELECT r.* FROM unnest($2::text[]) AS wanted(id)
        CROSS JOIN LATERAL (
          SELECT client, session_id, message_id, content FROM raw_messages
          WHERE user_id = $1 AND id = wanted.id OFFSET 0
        ) r`, [owner, missing]);
      for (const { client, session_id, message_id, content } of legacy) {
        const verdict = verdicts.get(client);
        if (!verdict || verdict.sessions.has(session_id)) continue;
        const proof = await captureProofs({ scope: { owner, namespace: null }, client }, [{ id: message_id, content }]);
        if (!proof || matchesReadProof(verdict.proofs, proof[0])) verdict.sessions.add(session_id);
      }
    }
  }
  const sessions = [...verdicts].flatMap(([client, { sessions }]) =>
    [...sessions].map(session_id => ({ client, session_id })));
  return { sessions, withheldClients: [...withheldClients], overflowSessions };
}
