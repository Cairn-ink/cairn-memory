import assert from "node:assert/strict";
import test from "node:test";
import { createPostgresMemoryCandidates, createPostgresUnitOfWork } from "../src/index.mjs";

// Default broad ANN trace, in order. Each entry records the exact SQL,
// the number of driver query arguments, and the number of bound parameters.
const expectedTrace = [
  [`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`, 1, 0],
  [`SET LOCAL lock_timeout = '5s'`, 1, 0],
  [`SET LOCAL statement_timeout = '30s'`, 1, 0],
  [`WITH owner_state AS (
    SELECT legacy_facts_ready AS ready, legacy_writes_reconciled AS reconciled
    FROM core_owner_state WHERE user_id = $1
  )
  SELECT f.*, (COALESCE(kind, body->>'kind') = 'text') AS needs_digests, (COALESCE(kind, body->>'kind') = 'text' AND CASE WHEN legacy THEN (body->>'text_hash') ~ '^(?:sha256:)?[0-9a-f]{64}$'
    ELSE jsonb_path_exists(body, '$.text.digests[*] ? (@.alg == "sha256")') END) AS needs_text, (COALESCE(kind, body->>'kind') IN ('session', 'window')) AS needs_source, (COALESCE(kind, body->>'kind') = 'window') AS needs_window, (COALESCE(kind, body->>'kind') = 'text' AND CASE WHEN legacy THEN (body->>'origin') IS DISTINCT FROM 'edit' AND body->>'embedding' IS NOT NULL
    ELSE mode = 'full' AND body #>> '{text,embedding}' IS NOT NULL END) AS needs_vector, (COALESCE(kind, body->>'kind') = 'text' AND CASE WHEN legacy THEN body->>'origin' IN ('forget', 'correct', 'backfill')
    ELSE body->>'explicitSaveExemptAfterUs' IS NOT NULL END) AS needs_physical_source
    FROM (SELECT false AS legacy, false AS pending, fact_id, action_id, incarnation, epoch::text, body,
  trunc(EXTRACT(EPOCH FROM created_at) * 1000000)::text AS created_at_us, kind, origin, mode, slot
    FROM core_suppression_facts WHERE user_id = $1
      AND (kind IN ('identity', 'text', 'session', 'window') OR (false AND kind = 'rawSpan'))
      AND (NOT false OR kind = 'text') AND NOT false
      AND (NOT false OR (
        kind IN ('session', 'window') AND (body ->> 'namespace') IS NOT DISTINCT FROM NULL::text
        OR kind = 'session' AND body #>> '{session,client}' = NULL::text AND (
          body #>> '{session,sessionId}' <> NULL::text OR body #>> '{session,sessionKeyHash}' IS NOT NULL
        )
      ))
  UNION ALL
  SELECT true, NOT COALESCE((SELECT ready FROM owner_state), false), id, NULL, NULL, NULL,
    jsonb_build_object('id', id, 'kind', kind, 'origin', origin, 'client', client, 'session_id', session_id,
      'start_ms', floor(EXTRACT(EPOCH FROM window_start) * 1000),
      'end_ms', ceil(EXTRACT(EPOCH FROM window_end) * 1000),
      'text_hash', text_hash, 'text_hmac', text_hmac, 'key_id', key_id,
      'embedding', embedding::text, 'redaction_version', redaction_version, 'shingles', shingles),
    trunc(EXTRACT(EPOCH FROM created_at) * 1000000)::text, NULL, NULL, NULL, NULL
    FROM suppressions WHERE user_id = $1
      AND (NOT false OR kind = 'text' OR (NOT false AND NOT COALESCE((SELECT ready FROM owner_state), false)))
      AND NOT COALESCE((SELECT ready AND reconciled FROM owner_state), false)
      AND (NOT false OR (
        kind IN ('session', 'window') AND NULL::text IS NULL
        OR kind = 'session' AND client = NULL::text AND session_id <> NULL::text
      ))
    LIMIT NULL) f`, 2, 1],
  [`SELECT count(*)::text AS eligible,
            count(*) FILTER (WHERE $7::boolean AND embedding_model = $8)::text AS embedded
            FROM memories WHERE user_id = $1 AND array_position($2::text[], core_namespace) IS NOT NULL
  AND ($3::text[] IS NULL OR source_client = ANY($3))
  AND ($4::bigint IS NULL OR COALESCE(core_created_at_ms, floor(EXTRACT(EPOCH FROM created_at) * 1000)) >= $4)
  AND ($5::bigint IS NULL OR COALESCE(core_created_at_ms, floor(EXTRACT(EPOCH FROM created_at) * 1000)) < $5)
  AND ($6::boolean OR currentness = 'current')`, 2, 8],
  [`SET LOCAL hnsw.iterative_scan = 'relaxed_order'`, 2, 0],
  [`SELECT current_setting('enable_sort') AS enable_sort`, 2, 0],
  [`SET LOCAL enable_sort = off`, 2, 0],
  [`WITH candidates AS MATERIALIZED (
                  SELECT id, updated_at, embedding <=> $8::vector AS distance FROM memories
                  WHERE user_id = $1 AND array_position($2::text[], core_namespace) IS NOT NULL
  AND ($3::text[] IS NULL OR source_client = ANY($3))
  AND ($4::bigint IS NULL OR COALESCE(core_created_at_ms, floor(EXTRACT(EPOCH FROM created_at) * 1000)) >= $4)
  AND ($5::bigint IS NULL OR COALESCE(core_created_at_ms, floor(EXTRACT(EPOCH FROM created_at) * 1000)) < $5)
  AND ($6::boolean OR currentness = 'current') AND embedding_model = $7 AND $8::vector IS NOT NULL AND id <> ALL ($10::text[]) AND embedding <=> $8::vector <> 'NaN'::float8
                  ORDER BY embedding <=> $8::vector LIMIT $9
                )
                SELECT page.*, c.distance FROM candidates c CROSS JOIN LATERAL (
                  SELECT id, core_namespace, revision, (EXTRACT(EPOCH FROM updated_at) * 1000000)::bigint::text AS updated_us, false AS vector_hidden FROM memories m WHERE m.id = c.id AND m.user_id = $1
                  OFFSET 0
                ) page ORDER BY c.distance + 0, c.updated_at DESC, c.id COLLATE "C" DESC`, 2, 10],
  [`SET LOCAL enable_sort = on`, 2, 0],
  [`WITH candidates AS MATERIALIZED (
                  SELECT id, updated_at, 1::float8 AS distance FROM memories
                  WHERE user_id = $1 AND array_position($2::text[], core_namespace) IS NOT NULL
  AND ($3::text[] IS NULL OR source_client = ANY($3))
  AND ($4::bigint IS NULL OR COALESCE(core_created_at_ms, floor(EXTRACT(EPOCH FROM created_at) * 1000)) >= $4)
  AND ($5::bigint IS NULL OR COALESCE(core_created_at_ms, floor(EXTRACT(EPOCH FROM created_at) * 1000)) < $5)
  AND ($6::boolean OR currentness = 'current') AND embedding_model = $7 AND $8::vector IS NOT NULL AND vector_norm(embedding) = 0
                  ORDER BY updated_at DESC, id COLLATE "C" DESC LIMIT $9 OFFSET $10
                )
                SELECT page.*, c.distance FROM candidates c CROSS JOIN LATERAL (
                  SELECT id, core_namespace, revision, (EXTRACT(EPOCH FROM updated_at) * 1000000)::bigint::text AS updated_us, false AS vector_hidden FROM memories m WHERE m.id = c.id AND m.user_id = $1
                  OFFSET 0
                ) page ORDER BY c.distance, c.updated_at DESC, c.id COLLATE "C" DESC`, 2, 10],
  [`COMMIT`, 1, 0],
  [`DISCARD ALL`, 1, 0],
];

test("a broad ANN read without queryBatch preserves the default statement trace", async () => {
  const trace = [];
  const uow = createPostgresUnitOfWork({
    async connect() {
      return {
        async query(...args) {
          const [sql, values] = args;
          trace.push([sql, args.length, values?.length ?? 0]);
          if (sql === "SELECT current_setting('enable_sort') AS enable_sort") {
            return { command: "SELECT", rows: [{ enable_sort: "on" }] };
          }
          if (sql.startsWith("SELECT count(*)::text AS eligible")) {
            return { command: "SELECT", rows: [{ eligible: "500", embedded: "500" }] };
          }
          return { command: sql.split(" ", 1)[0], rows: [] };
        },
        async release() {},
      };
    },
  });

  const owner = "owner";
  const vector = new Float32Array(1536);
  vector[0] = 1;
  const candidates = createPostgresMemoryCandidates();
  await uow.run(owner, { readOnly: true }, tx =>
    candidates.vector.vector(tx, { owner, namespaces: [null] }, vector, "test", 1));

  assert.deepEqual(trace, expectedTrace);
});
