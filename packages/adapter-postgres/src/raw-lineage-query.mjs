// Both admission checks and erasure traverse the same proof graph. An ID-only
// edge is evaluated separately and can never add a session to an erase closure.
export const MAX_LINEAGE_SESSIONS = 1_000;
export const MAX_LINEAGE_VERTICES = 20_000;

const WALK = `vertices(session_id, message_mac, content_mac) AS (
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
  ), bounded AS MATERIALIZED (SELECT * FROM vertices LIMIT ${MAX_LINEAGE_VERTICES + 1})`;

const EXCEEDED = `(SELECT count(*) FROM bounded) > ${MAX_LINEAGE_VERTICES}
  OR (SELECT count(DISTINCT session_id) FROM bounded) > ${MAX_LINEAGE_SESSIONS}`;

export const PROVEN_CLOSURE = `WITH RECURSIVE roots(session_id, message_mac, content_mac) AS (
    SELECT session_id, NULL::text, NULL::text FROM unnest($3::text[]) AS root(session_id)
  ), ${WALK}
  SELECT ARRAY(SELECT DISTINCT session_id FROM bounded WHERE session_id IS NOT NULL) AS session_ids,
    (SELECT count(*)::int FROM bounded) AS vertex_count, ${EXCEEDED} AS exceeded`;

const FENCES = (/** @type {string} */ facts) => `SELECT f.session_id, NULL::text AS namespace, false AS wildcard FROM capture_raw_fences f
    WHERE f.user_id = $1 AND f.client = $2
  UNION
  SELECT session_id, NULL::text, false FROM suppressions WHERE user_id = $1 AND client = $2 AND kind = 'session'
  UNION
  SELECT * FROM jsonb_to_recordset(${facts}::jsonb) AS fact(session_id text, namespace text, wildcard boolean)`;

// Hosted anchors encode only owner, client and session. Compare ancestor facts
// in their own scopes. Explicit ledger evidence carries its recorded namespace.
export const CHECK_LINEAGE = `WITH RECURSIVE fences AS MATERIALIZED (${FENCES("$6")}),
  incoming AS (
    SELECT * FROM jsonb_to_recordset($5::jsonb) AS proof(message_mac text, content_mac text)
  ), roots(session_id, message_mac, content_mac) AS (
    SELECT $4::text, NULL::text, NULL::text
    WHERE $7::boolean OR EXISTS (SELECT 1 FROM fences)
    UNION
    SELECT NULL::text, incoming.message_mac, incoming.content_mac
    FROM incoming WHERE incoming.content_mac IS NOT NULL AND ($7::boolean OR EXISTS (SELECT 1 FROM fences))
  ), ${WALK}, candidate_proofs AS (
    SELECT * FROM incoming
    UNION
    SELECT l.message_mac, l.content_mac FROM bounded b
    JOIN capture_raw_lineage l ON l.user_id = $1 AND l.client = $2 AND l.session_id = b.session_id
  ), linked AS (
    SELECT session_id, NULL::text AS namespace, true AS unscoped, true AS proven
    FROM bounded WHERE session_id <> $4
    UNION
    SELECT l.session_id, NULL::text, true, false
    FROM candidate_proofs p JOIN capture_raw_lineage l
      ON l.user_id = $1 AND l.client = $2 AND l.message_mac = p.message_mac
      AND ($8::boolean OR l.content_mac IS NULL OR p.content_mac IS NULL)
    WHERE l.session_id <> $4
    UNION
    SELECT legacy.session_id, legacy.namespace, legacy.untagged, false
    FROM jsonb_to_recordset($9::jsonb) AS legacy(session_id text, namespace text, untagged boolean, message_mac text)
    JOIN candidate_proofs p USING (message_mac)
    WHERE (legacy.session_id, legacy.namespace) IS DISTINCT FROM ($4::text, $3::text)
  )
  SELECT EXISTS (
    SELECT 1 FROM fences f WHERE f.session_id = $4 AND f.namespace IS NOT DISTINCT FROM $3
  ) AS direct,
  EXISTS (
    SELECT 1 FROM linked l JOIN fences f ON f.session_id = l.session_id AND (
      f.namespace IS NOT DISTINCT FROM l.namespace OR (l.unscoped AND f.wildcard)
    )
    WHERE (l.session_id, l.namespace) IS DISTINCT FROM ($4::text, $3::text)
  ) AS fenced,
  EXISTS (
    SELECT 1 FROM linked l JOIN fences f ON f.session_id = l.session_id AND (
      f.namespace IS NOT DISTINCT FROM l.namespace OR (l.unscoped AND f.wildcard)
    )
    WHERE l.proven AND (l.session_id, l.namespace) IS DISTINCT FROM ($4::text, $3::text)
  ) AS proven,
  ${EXCEEDED} AS exceeded,
  ARRAY(SELECT DISTINCT jsonb_build_array(session_id, namespace, unscoped, proven) FROM linked
    WHERE $7::boolean AND (session_id, namespace) IS DISTINCT FROM ($4::text, $3::text)) AS hash_candidates,
  ARRAY(SELECT DISTINCT jsonb_build_array(l.session_id, l.namespace) FROM linked l
    WHERE $8::boolean AND NOT l.proven AND l.namespace IS NULL AND EXISTS (
      SELECT 1 FROM capture_raw_lineage anchor
      WHERE anchor.user_id = $1 AND anchor.client = $2 AND anchor.session_id = l.session_id
        AND anchor.content_mac IS NOT NULL
    )) AS weak_roots`;

export const LEGACY_EVENTS = `WITH fences AS MATERIALIZED (${FENCES("$7")})
  SELECT e.session_id, e.core_namespace, e.core_payload_digest IS NULL AS untagged,
    e.raw_request, e.arrival_order::text
  FROM capture_events e
  WHERE e.user_id = $1 AND e.client = $2 AND e.arrival_order > $5::bigint
    AND e.raw_lineage_key_id IS DISTINCT FROM $6 AND e.raw_lineage_key_id IS DISTINCT FROM $9
    AND ($8::boolean OR EXISTS (SELECT 1 FROM fences))
    AND (e.session_id = $4 AND e.core_namespace IS NOT DISTINCT FROM $3 OR $8::boolean OR EXISTS (
      SELECT 1 FROM fences f WHERE f.session_id = e.session_id
        AND (f.namespace IS NOT DISTINCT FROM e.core_namespace OR (e.core_payload_digest IS NULL AND f.wildcard))
    ))
  ORDER BY e.arrival_order LIMIT 32`;
