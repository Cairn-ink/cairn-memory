import assert from "node:assert/strict";
import test from "node:test";
import { createPostgresMemoryCandidates, createPostgresUnitOfWork } from "../src/index.mjs";
import { migrationDatabase, migrationDbTest } from "./migration-database.mjs";

test("ANN coverage reports the statement pool sizes and omits them on other paths", migrationDbTest, async t => {
  const { pool } = await migrationDatabase(t);
  const owner = "owner";
  await pool.query("INSERT INTO users (id) VALUES ($1)", [owner]);
  await pool.query(`INSERT INTO memories (id, user_id, text, kind, text_hash, embedding, embedding_model,
    source_kind, updated_at)
    SELECT 'memory-' || i, $1, 'example', 'fact', i::text,
      CASE WHEN i <= 510 THEN
        (ARRAY[cos(i / 1000.0), sin(i / 1000.0)] || array_fill(0, ARRAY[1534]))::vector(1536)
        ELSE array_fill(0, ARRAY[1536])::vector(1536) END,
      CASE WHEN i <= 430 THEN 'full' WHEN i <= 510 THEN 'short' ELSE 'zero' END,
      'import', '2024-01-01'::timestamptz
    FROM generate_series(1, 590) AS seed(i)`, [owner]);
  await pool.query("ANALYZE memories");

  const pages = [];
  const uow = createPostgresUnitOfWork({
    async connect() {
      const client = await pool.connect();
      try {
        await client.query("SELECT '[1,0]'::vector <=> '[1,0]'::vector");
      } catch (error) {
        client.release(true);
        throw error;
      }
      return {
        async query(sql, values) {
          const result = await client.query(sql, values);
          if (sql.includes("ORDER BY embedding <=> $8::vector LIMIT $9")) {
            const plan = await client.query("EXPLAIN (COSTS OFF) " + sql, values);
            assert.ok(plan.rows.some(row => row["QUERY PLAN"].includes("Index Scan using memories_embedding_idx")));
            pages.push({ requested: values[8], returned: result.rows.length });
          }
          return result;
        },
        release: destroy => client.release(destroy),
      };
    },
  });
  const { vector } = createPostgresMemoryCandidates();
  const axis = new Float32Array(1536);
  axis[0] = 1;
  const cases = [
    { name: "full pool", model: "full", depth: 2, returned: 400 },
    { name: "short pool", model: "short", depth: 2, returned: 80 },
    { name: "empty pool with zero-vector fallback", model: "zero", depth: 2, returned: 0 },
    { name: "exact path", model: "short", depth: 3 },
    { name: "zero query", model: "full", depth: 2, query: new Float32Array(1536) },
    { name: "nothing embedded for the model", model: "missing", depth: 2 },
  ];
  for (const { name, model, depth, returned, query = axis } of cases) {
    await t.test(name, async () => {
      pages.length = 0;
      const result = await uow.run(owner, { readOnly: true },
        tx => vector.vector(tx, { owner, namespaces: [null] }, query, model, depth));
      if (returned === undefined) {
        assert.deepEqual(pages, []);
        assert.equal(Object.hasOwn(result.coverage, "pool"), false);
      } else {
        const expected = { requested: 400, returned };
        assert.deepEqual(pages, [expected]);
        assert.deepEqual(result.coverage.pool, expected);
      }
      assert.equal(result.rows.length, model === "missing" ? 0 : depth);
    });
  }
});
