import assert from "node:assert/strict";
import test from "node:test";
import { createPostgresMemoryCandidates, createPostgresUnitOfWork } from "../src/index.mjs";
import { migrationDatabase, migrationDbTest } from "./migration-database.mjs";

const owner = "round-trip-owner";
const axis = new Float32Array(1536);
axis[0] = 1;

function planShape(plan) {
  return {
    type: plan["Node Type"],
    index: plan["Index Name"],
    children: (plan.Plans ?? []).map(planShape),
  };
}

function hasAnnIndex(plan) {
  return (plan.type === "Index Scan" && plan.index === "memories_embedding_idx") ||
    plan.children.some(hasAnnIndex);
}

test("Postgres batches preserve timeouts, ANN plans, ordered IDs and enable_sort", migrationDbTest, async t => {
  const { pool } = await migrationDatabase(t);
  await pool.query("INSERT INTO users (id) VALUES ($1)", [owner]);
  await pool.query(`INSERT INTO memories (id, user_id, text, kind, text_hash, embedding, embedding_model,
    source_kind, created_at, updated_at)
    SELECT 'memory-' || i, $1, 'seed', 'fact', i::text,
      (ARRAY[cos(i/1000.0), sin(i/1000.0)] || array_fill(0, ARRAY[1534]))::vector(1536),
      'test', 'mcp', now(), now()
    FROM generate_series(1, 600) AS seed(i)`, [owner]);
  await pool.query("ANALYZE memories");

  async function search(batched, initialSort) {
    const plans = [];
    const batches = [];
    let show;
    const source = {
      async connect() {
        const client = await pool.connect();
        show = async name => (await client.query("SHOW " + name)).rows[0][name];
        await client.query(initialSort === "on" ? "SET enable_sort = on" : "SET enable_sort = off");
        const connection = {
          async query(text, values) {
            if (text.includes("ORDER BY embedding <=> $8::vector LIMIT $9")) {
              const { rows } = await client.query("EXPLAIN (FORMAT JSON) " + text, values);
              plans.push(planShape(rows[0]["QUERY PLAN"][0].Plan));
            }
            return client.query(text, values);
          },
          release: destroy => client.release(destroy),
        };
        if (batched) {
          connection.queryBatch = async (...args) => {
            assert.equal(args.length, 1);
            const results = await client.query(...args);
            assert.ok(Array.isArray(results));
            batches.push(results.map(result => result.command));
            return results;
          };
        }
        return connection;
      },
    };

    const ids = await createPostgresUnitOfWork(source).run(owner, { readOnly: true }, async tx => {
      // Use the active connection directly for SHOW, which is outside the adapter SQL lint.
      assert.equal(await show("lock_timeout"), "5s");
      assert.equal(await show("statement_timeout"), "30s");
      const result = await createPostgresMemoryCandidates().vector.vector(tx, { owner, namespaces: [null] }, axis, "test", 5);
      assert.equal(result.coverage.complete, true);
      assert.equal(await show("enable_sort"), initialSort);
      return result.rows.map(row => row.ref.id);
    });
    assert.deepEqual(batches, batched ? [["BEGIN", "SET", "SET"], ["SET", "SELECT", "SET"]] : []);
    return { ids, plans };
  }

  for (const sort of ["on", "off"]) {
    const before = await search(false, sort);
    assert.ok(before.plans.length && before.plans.every(hasAnnIndex));
    assert.deepEqual(before.ids, ["memory-1", "memory-2", "memory-3", "memory-4", "memory-5"]);
    assert.deepEqual(await search(true, sort), before);
  }
});
