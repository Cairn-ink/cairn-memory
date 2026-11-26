import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { factIncarnationBody } from "../../core/src/index.mjs";
import { recallSearch } from "../../core/src/service/recall.mjs";
import {
  createPostgresMemoryCandidates, createPostgresMemoryReads, createPostgresSuppressionStore, createPostgresUnitOfWork,
} from "../src/index.mjs";
import { migrationDatabase, migrationDbTest } from "./migration-database.mjs";

const owner = "target";
const other = "neighbour";
const model = "test-model";
const scope = { owner, namespaces: [null] };
const readOnly = { readOnly: true };
const distance = "embedding <=> $1::vector";
const tieOrder = 'updated_at DESC, id COLLATE "C" DESC';

function direction(angle) {
  return Float32Array.from([Math.cos(angle), Math.sin(angle), ...Array(1534).fill(0)]);
}

const bind = vector => JSON.stringify(Array.from(vector));
const ids = result => result.rows.map(row => row.ref.id);

async function seed(pool, paging) {
  await pool.query("INSERT INTO users (id) VALUES ($1), ($2)", [owner, other]);
  await pool.query(`INSERT INTO memories (id, user_id, text, kind, text_hash, embedding, embedding_model,
    source_kind, source_client, source_session_id, created_at, updated_at)
    SELECT who || '-' || lpad(i::text, 4, '0'), who, 'example', 'fact', i::text,
      (ARRAY[cos(angle), sin(angle)] || CASE WHEN $4 THEN array_fill(0.0, ARRAY[62]) ELSE ARRAY(
        SELECT ((('x' || substr(md5(who || ':' || i || ':' || j), 1, 4))::bit(16)::int / 65536.0) - 0.5) * 0.5
        FROM generate_series(1, 62) AS dimension(j)
      ) END || array_fill(0, ARRAY[1472]))::vector(1536),
      $3, 'import', 'test-client', session_id, '2024-01-01', '2024-01-01'
    FROM (
      SELECT $1 AS who, i,
        CASE WHEN $4 THEN CASE WHEN i <= 680 THEN i / 1200.0 ELSE 0.95 + (i - 681) * 0.01 END
          ELSE i / 1500.0 + (('x' || substr(md5(i::text), 1, 4))::bit(16)::int % 23) / 100000.0 END::double precision AS angle,
        CASE WHEN $4 AND i BETWEEN 2 AND 680 THEN 'closed' ELSE 'open' END AS session_id
      FROM generate_series(1, CASE WHEN $4 THEN 700 ELSE 1700 END) AS seed(i)
      UNION ALL
      SELECT $2, i, i / 1700.0, 'open' FROM generate_series(1, 650) AS seed(i)
    ) seed`, [owner, other, model, paging]);
  await pool.query("ANALYZE memories");
}

function recordingSource(pool, pages, efSearch = 40) {
  return {
    async connect() {
      const client = await pool.connect();
      await client.query("LOAD 'vector'");
      await client.query("SELECT set_config('hnsw.ef_search', $1, false)", [String(efSearch)]);
      return {
        async query(sql, values) {
          const result = await client.query(sql, values);
          if (sql.includes("ORDER BY embedding <=> $8::vector LIMIT $9")) {
            const { rows } = await client.query("EXPLAIN (COSTS OFF) " + sql, values);
            assert.ok(rows.some(row => row["QUERY PLAN"].includes("Index Scan using memories_embedding_idx")));
            pages.push({ rows: result.rows, limit: values[8], excluded: values[9] });
          }
          return result;
        },
        release: destroy => client.release(destroy),
      };
    },
  };
}

async function scan(pool, vector, order) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("LOAD 'vector'");
    const settings = {
      strict: "SET LOCAL hnsw.iterative_scan = 'strict_order'; SET LOCAL hnsw.ef_search = 8; SET LOCAL enable_sort = off",
      relaxed: "SET LOCAL hnsw.iterative_scan = 'relaxed_order'; SET LOCAL enable_sort = off",
      exact: "SET LOCAL enable_indexscan = off; SET LOCAL enable_indexonlyscan = off",
    };
    await client.query(settings[order]);
    const boundary = {
      strict: `ORDER BY ${distance} FETCH FIRST 200 ROWS WITH TIES`,
      relaxed: `ORDER BY ${distance} LIMIT 800`,
      exact: `ORDER BY (${distance}) + 0, ${tieOrder}`,
    };
    const { rows } = await client.query(`WITH candidates AS MATERIALIZED (
      SELECT id, updated_at, ${distance} AS distance FROM memories
      WHERE user_id = $2 AND core_namespace IS NULL AND currentness = 'current' AND embedding_model = $3
      ${boundary[order]}
    )
    SELECT id FROM candidates ORDER BY distance + 0, ${tieOrder}`, [bind(vector), owner, model]);
    return rows.map(row => row.id);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

test("a 400-row ANN pool recovers the exact top 50 and feeds the existing fusion depth", migrationDbTest, async t => {
  const { pool } = await migrationDatabase(t);
  await seed(pool, false);
  const pages = [];
  const uow = createPostgresUnitOfWork(recordingSource(pool, pages, 8));
  const candidates = createPostgresMemoryCandidates();
  let strictMisses = 0;
  for (const angle of [0.04, 0.21, 0.44, 0.72, 0.95]) {
    const vector = direction(angle);
    const exact = (await scan(pool, vector, "exact")).slice(0, 50);
    const strict = (await scan(pool, vector, "strict")).slice(0, 50);
    strictMisses += exact.filter(id => !strict.includes(id)).length;
    const actual = await uow.run(owner, readOnly, tx => candidates.vector.vector(tx, scope, vector, model, 50));
    assert.deepEqual(ids(actual), exact);
    assert.deepEqual(actual.coverage, { eligible: 1700, embedded: 1700, complete: true });
  }
  assert.ok(strictMisses > 0, "strict-order control must miss at least one exact hit");
  assert.equal(pages.length, 5);
  for (const page of pages) {
    assert.equal(page.limit, 400);
    assert.equal(page.rows.length, 400);
    assert.deepEqual(page.excluded, []);
    assert.ok(page.rows.every(row => row.id.startsWith(owner + "-")));
  }

  const vector = direction(0.44);
  const exact = (await scan(pool, vector, "exact")).slice(0, 50);
  let vectorCalls = 0;
  const recall = recallSearch({
    storage: {
      ...createPostgresMemoryReads(), ...candidates, uow, capabilities: { semanticRetrieval: true },
      vector: { async vector(...args) {
        vectorCalls++;
        assert.equal(args[4], 50);
        const result = await candidates.vector.vector(...args);
        assert.deepEqual(ids(result), exact);
        return result;
      } },
      lexical: { async lexical() { return { matched: false, rows: [] }; } },
    },
    embedQuery: { async embedQuery() { return { model, vector }; } },
    gate: { async assertOpen() {} },
    clock: { async sha256Hex(text) { return createHash("sha256").update(text).digest("hex"); } },
  });
  const delivered = await recall({ owner, namespace: null }, "example", { cursor: null, limit: 6, mode: "search" });
  assert.equal(vectorCalls, 1);
  assert.deepEqual(delivered.items.map(row => row.id), exact.slice(0, 6));
});

test("pool extension has no gaps or duplicates and honors committed suppression", migrationDbTest, async t => {
  const { pool, source } = await migrationDatabase(t);
  await seed(pool, true);
  const vector = direction(0);
  const pages = [];
  const candidates = createPostgresMemoryCandidates();
  const uow = createPostgresUnitOfWork(recordingSource(pool, pages));
  const search = depth => uow.run(owner, readOnly, tx => candidates.vector.vector(tx, scope, vector, model, depth));
  const before = await search(5);
  assert.ok(ids(before).includes("target-0001"));

  const { writeFact } = createPostgresSuppressionStore();
  const facts = [
    { kind: "session", session: { client: "test-client", sessionId: "closed" } },
    { kind: "identity", memoryId: "target-0681" },
    { kind: "text", mode: "full", text: { embedding: Array.from(vector), digests: [{
      alg: "sha256", keyId: null, pipeline: "core", redactionVersion: 1, value: "a".repeat(64),
    }] } },
  ];
  await createPostgresUnitOfWork(source).run(owner, {}, async tx => {
    for (const [i, body] of facts.entries()) {
      const fact = { ...body, owner, actionId: "forget-" + i, origin: "forget" };
      await writeFact(tx, fact, createHash("sha256").update(factIncarnationBody(fact)).digest("hex"));
    }
  });

  const expected = Array.from({ length: 19 }, (_, i) => "target-" + String(682 + i).padStart(4, "0"));
  pages.length = 0;
  const extended = await search(5);
  assert.deepEqual(ids(extended), expected.slice(0, 5));
  assert.deepEqual(extended.coverage, { eligible: 19, embedded: 19, complete: true });
  assert.equal(pages.length, 2);
  assert.equal(pages[0].rows.length, 400);
  assert.ok(pages[0].rows.some(row => row.id === "target-0001" && row.vector_hidden));
  assert.deepEqual(pages[0].excluded, []);
  assert.deepEqual(new Set(pages[1].excluded), new Set(pages[0].rows.map(row => row.id)));
  const scanned = pages.flatMap(page => page.rows.map(row => row.id));
  assert.equal(new Set(scanned).size, scanned.length);
  assert.equal(scanned.length, 700);
  assert.deepEqual(new Set(scanned), new Set(await scan(pool, vector, "relaxed")));
  assert.ok(scanned.every(id => id.startsWith(owner + "-")));

  pages.length = 0;
  const exhausted = await search(20);
  assert.equal(pages.length, 2);
  assert.deepEqual(ids(exhausted), expected);
  assert.deepEqual(exhausted.coverage, { eligible: 19, embedded: 19, complete: false });
});
