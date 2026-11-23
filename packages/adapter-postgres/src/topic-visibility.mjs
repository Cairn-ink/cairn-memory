// Read optional G-A metadata without requiring the memory store migration.
/** @param {string} memory */
export function memoryNamespace(memory) {
  return `(to_jsonb(${memory})->>'core_namespace') COLLATE "C"`;
}

// Port the hosted worker's text suppression predicate, including its exact
// hash check and its vector exemption for later explicit saves.
/** @param {string} memory */
function visibleWorkerMemory(memory) {
  return `NOT EXISTS (
    SELECT 1 FROM suppressions s
    WHERE s.user_id = ${memory}.user_id AND s.kind = 'text'
      AND (s.text_hash = ${memory}.text_hash OR CASE
        WHEN s.origin = 'edit' THEN FALSE
        WHEN s.origin IN ('forget', 'correct', 'backfill')
          AND ${memory}.source_kind IN ('mcp', 'web') AND ${memory}.created_at > s.created_at THEN FALSE
        ELSE s.embedding <=> ${memory}.embedding <= 0.20 END)
  )`;
}

/** @param {string} memory */
function coreTextMatch(memory) {
  // G-A adds core_digests. Until then, the hosted SHA-256 is the available digest.
  // Like core matching, a digest match or the absence of comparable digests
  // withholds a row. Full-mode facts can also match by vector.
  return `(
    SELECT COALESCE(bool_or(f.value = m.value), TRUE) FROM core_fact_digests f
    JOIN LATERAL (
      SELECT 'sha256' AS alg, NULL::text AS key_id,
        regexp_replace(${memory}.text_hash, '^sha256:', '') AS value
      WHERE ${memory}.text_hash ~ '^(sha256:)?[0-9a-f]{64}$'
      UNION ALL
      SELECT d->>'alg', d->>'keyId', d->>'value'
      FROM jsonb_array_elements(COALESCE(NULLIF(to_jsonb(${memory})->'core_digests', 'null'), '[]')) d
    ) m ON f.alg = m.alg AND f.key_id IS NOT DISTINCT FROM m.key_id
    WHERE f.user_id = s.user_id AND f.fact_id = s.fact_id
  ) OR (s.mode = 'full' AND (s.embedding <=> ${memory}.embedding <= 0.200001
    OR s.embedding <=> ${memory}.embedding = 'NaN'::double precision))`;
}

/** @param {string} memory */
export function visibleTopicMemory(memory) {
  return `${memory}.currentness = 'current' AND ${visibleWorkerMemory(memory)}
    AND NOT EXISTS (
      SELECT 1 FROM memory_forget_log f WHERE f.user_id = ${memory}.user_id AND f.memory_id = ${memory}.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM core_suppression_facts s
      WHERE s.user_id = ${memory}.user_id
        AND to_jsonb(s.body->>'namespace')::text IS NOT DISTINCT FROM ${memoryNamespace(memory)}
        AND CASE s.kind
          WHEN 'identity' THEN s.body->>'memoryId' = ${memory}.id
            AND (s.body->>'throughRevision' IS NULL OR ${memory}.revision <= (s.body->>'throughRevision')::bigint)
          WHEN 'session' THEN EXISTS (
            SELECT 1 FROM core_memory_receipts r
            WHERE r.user_id = ${memory}.user_id AND r.memory_id = ${memory}.id
              AND r.client = s.body #>> '{session,client}'
              AND (s.body #>> '{session,sessionId}' IS NULL OR r.session_id = s.body #>> '{session,sessionId}')
          )
          WHEN 'text' THEN ${coreTextMatch(memory)}
          ELSE FALSE
        END
    )`;
}
