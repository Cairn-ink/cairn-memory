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
/** @param {string} client */
function lineageVertices(client) {
  return `vertices(session_id, message_mac, content_mac) AS (
    SELECT session_id, message_mac, content_mac FROM roots
    UNION
    SELECT next.session_id, next.message_mac, next.content_mac
    FROM vertices v CROSS JOIN LATERAL (
      SELECT NULL::text, l.message_mac, l.content_mac
      FROM capture_raw_lineage l
      WHERE l.user_id = $1 AND l.client = ${client} AND l.session_id = v.session_id AND l.content_mac IS NOT NULL
      UNION ALL
      SELECT l.session_id, NULL::text, NULL::text
      FROM capture_raw_lineage l
      WHERE v.session_id IS NULL AND l.user_id = $1 AND l.client = ${client}
        AND l.message_mac = v.message_mac AND l.content_mac = v.content_mac
    ) AS next(session_id, message_mac, content_mac)
  ), bounded AS MATERIALIZED (SELECT * FROM vertices LIMIT ${MAX_LINEAGE_VERTICES + 1})`;
}

const EXCEEDED = `(SELECT count(*) FROM bounded) > ${MAX_LINEAGE_VERTICES}
  OR (SELECT count(session_id) FROM bounded) > ${MAX_LINEAGE_SESSIONS}`;

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
  ), ${lineageVertices("$2")},
  uncertain AS NOT MATERIALIZED (
    SELECT l.session_id FROM capture_raw_lineage l
    WHERE l.user_id = $1 AND l.client = $2 AND EXISTS (
      SELECT 1 FROM incoming WHERE incoming.message_mac = l.message_mac
        AND (incoming.content_mac IS NULL OR l.content_mac IS NULL)
    )
  )
  SELECT EXISTS (SELECT 1 FROM bounded JOIN fences USING (session_id)) AS fenced,
    ${EXCEEDED} AS exceeded,
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

// Read fence anchors must have recorded evidence before they can reach other sessions.
// An exact proof only seeds the walk if the message index finds a distinct peer.
const READ_LINEAGE_ANCHORS = `WITH requested AS (SELECT unnest($2::text[]) AS client),
  fences AS MATERIALIZED (
    SELECT f.client, f.session_id FROM requested c JOIN capture_raw_fences f USING (client) WHERE f.user_id = $1
    UNION
    SELECT * FROM jsonb_to_recordset($3::jsonb) AS f(client text, session_id text)
  ), anchors AS MATERIALIZED (
    SELECT f.client, f.session_id, l.message_mac, l.content_mac
    FROM fences f JOIN capture_raw_lineage l
      ON l.user_id = $1 AND l.client = f.client AND l.session_id = f.session_id
  )
  SELECT c.client, graph.exceeded, graph.sessions, graph.proofs
  FROM requested c CROSS JOIN LATERAL (
    WITH RECURSIVE roots(session_id, message_mac, content_mac) AS (
      SELECT NULL::text, a.message_mac, a.content_mac FROM anchors a
      WHERE a.client = c.client AND a.content_mac IS NOT NULL AND EXISTS (
        SELECT 1 FROM capture_raw_lineage l WHERE l.user_id = $1 AND l.client = a.client
          AND l.message_mac = a.message_mac AND l.content_mac = a.content_mac AND l.session_id <> a.session_id
      )
    ), ${lineageVertices("c.client")}
    SELECT ${EXCEEDED} AS exceeded,
      ARRAY(SELECT session_id FROM bounded WHERE session_id IS NOT NULL
        UNION SELECT session_id FROM fences WHERE client = c.client) AS sessions,
      COALESCE((SELECT jsonb_agg(p) FROM (
        SELECT message_mac, content_mac, true AS anchor FROM anchors WHERE client = c.client
        UNION
        SELECT message_mac, content_mac, false FROM bounded WHERE session_id IS NULL
      ) p), '[]'::jsonb) AS proofs
  ) graph`;

const READ_LINEAGE_EVIDENCE = `WITH requested AS (
    SELECT * FROM jsonb_to_recordset($2::jsonb) AS s(client text, session_id text)
  ), anchors AS (
    SELECT * FROM jsonb_to_recordset($3::jsonb) AS a(client text, message_mac text, content_mac text, anchor boolean)
  ), checked AS MATERIALIZED (
    SELECT s.client, s.session_id, EXISTS (
      SELECT 1 FROM capture_raw_lineage l JOIN anchors a USING (client, message_mac)
      WHERE l.user_id = $1 AND l.client = s.client AND l.session_id = s.session_id
        AND (a.content_mac = l.content_mac OR (a.anchor AND (a.content_mac IS NULL OR l.content_mac IS NULL)))
    ) AS withheld FROM requested s
  )
  SELECT s.client, s.session_id, s.withheld, r.message_id, r.content
  FROM checked s LEFT JOIN LATERAL (
    SELECT message_id, content FROM raw_messages
    WHERE NOT s.withheld AND user_id = $1 AND client = s.client AND session_id = s.session_id
  ) r ON true`;

const CHECK_READ_LINEAGE_PROOFS = `WITH incoming AS (
    SELECT * FROM jsonb_to_recordset($1::jsonb) AS i(client text, session_id text, message_mac text, content_mac text)
  ), anchors AS (
    SELECT * FROM jsonb_to_recordset($2::jsonb) AS a(client text, message_mac text, content_mac text, anchor boolean)
  )
  SELECT DISTINCT i.client, i.session_id FROM incoming i JOIN anchors a USING (client, message_mac)
  WHERE a.content_mac = i.content_mac OR (a.anchor AND (a.content_mac IS NULL OR i.content_mac IS NULL))`;

/** @typedef {{client: string, sessionId: string}} ReadSession */
/** @typedef {{session_id: string, client: string}} SqlSession */
/** @typedef {{exceeded: boolean, sessions: string[], proofs: Array<Proof & {anchor: boolean}>}} AnchorGraph */
/** @param {{client: string, sessionId?: string, session_id?: string}} session */
function sessionKey({ client, sessionId, session_id }) {
  return JSON.stringify([client, sessionId ?? session_id]);
}

/**
 * @param {Connection["query"]} query @param {string} owner
 * @param {ReturnType<typeof createCaptureProofs>} captureProofs
 * @param {readonly import("../../core/src/suppression-fact.mjs").SessionRef[]} facts
 * @param {CaptureOptions["hashSessionKey"]} hashSessionKey
 */
export function readLineageFence(query, owner, captureProofs, facts, hashSessionKey) {
  /** @type {Map<string, AnchorGraph>} */
  const graphs = new Map();
  /** @type {Map<string, boolean>} */
  const verdicts = new Map();

  /** @param {string[]} clients */
  async function readGraphs(clients) {
    if (!clients.length) return;
    const active = new Set(clients);
    /** @type {SqlSession[]} */
    const roots = [];
    /** @type {Map<string, Set<string>>} */
    const hashes = new Map();
    for (const fact of facts) {
      if (!active.has(fact.client)) continue;
      if ("sessionId" in fact) {
        roots.push({ client: fact.client, session_id: fact.sessionId });
      } else {
        let values = hashes.get(fact.client);
        if (!values) hashes.set(fact.client, values = new Set());
        values.add(fact.sessionKeyHash);
      }
    }
    if (hashes.size) {
      // Opaque hashes can only be resolved over recorded sessions on those clients.
      const { rows } = await query(`SELECT DISTINCT client, session_id FROM capture_raw_lineage
        WHERE user_id = $1 AND client = ANY($2::text[])`, [owner, [...hashes.keys()]]);
      for (const row of rows) {
        if (withholdsHashedAncestor(hashes.get(row.client) ?? new Set(), hashSessionKey, row.client, row.session_id)) {
          roots.push(row);
        }
      }
    }
    const { rows } = await query(READ_LINEAGE_ANCHORS, [owner, clients, JSON.stringify(roots)]);
    for (const { client, ...graph } of rows) graphs.set(client, graph);
  }

  /** @param {readonly ReadSession[]} candidates */
  return async function withheldSessions(candidates) {
    const pending = new Map(candidates.map(session => [sessionKey(session), session]));
    for (const key of pending.keys()) {
      if (verdicts.has(key)) pending.delete(key);
    }
    const clients = [...new Set([...pending.values()].map(({ client }) => client))];
    await readGraphs(clients.filter(client => !graphs.has(client)));
    /** @type {SqlSession[]} */
    const checked = [];
    const activeClients = new Set();
    for (const [key, { client, sessionId }] of pending) {
      const graph = graphs.get(client);
      const withheld = !graph || graph.exceeded || graph.sessions.includes(sessionId);
      verdicts.set(key, withheld);
      if (!withheld && graph.proofs.length) {
        checked.push({ client, session_id: sessionId });
        activeClients.add(client);
      }
    }
    if (checked.length) {
      const anchors = JSON.stringify([...activeClients].flatMap(client =>
        graphs.get(client)?.proofs.map(proof => ({ client, ...proof })) ?? []));
      const { rows } = await query(READ_LINEAGE_EVIDENCE, [owner, JSON.stringify(checked), anchors]);
      /** @type {Array<SqlSession & Proof>} */
      const incoming = [];
      // Older raw rows can lack recorded proofs. Check every sibling before caching the session verdict.
      for (let start = 0; start < rows.length; start += 128) {
        await Promise.all(rows.slice(start, start + 128).map(async row => {
          const { client, session_id, withheld, message_id, content } = row;
          if (withheld) verdicts.set(sessionKey(row), true);
          if (message_id === null) return;
          const proofs = await captureProofs({ scope: { owner, namespace: null }, client }, [{ id: message_id, content }]);
          if (!proofs) verdicts.set(sessionKey(row), true);
          else incoming.push(...proofs.map(proof => ({ client, session_id, ...proof })));
        }));
      }
      if (incoming.length) {
        const { rows: linked } = await query(CHECK_READ_LINEAGE_PROOFS, [JSON.stringify(incoming), anchors]);
        for (const row of linked) verdicts.set(sessionKey(row), true);
      }
    }
    return candidates.map(session => verdicts.get(sessionKey(session)) !== false);
  };
}
