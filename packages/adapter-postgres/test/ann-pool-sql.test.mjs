import assert from "node:assert/strict";
import test from "node:test";
import { createPostgresMemoryCandidates, createPostgresUnitOfWork } from "../src/index.mjs";
import { isReadStatement } from "../src/read-only.mjs";

const begin = "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY";
const lock = "SET LOCAL lock_timeout = '5s'";
const timeout = "SET LOCAL statement_timeout = '30s'";
const scan = "SET LOCAL hnsw.iterative_scan = 'relaxed_order'";
const readSort = "SELECT current_setting('enable_sort') AS enable_sort";
const disableSort = "SET LOCAL enable_sort = off";
const restoreSort = "SET LOCAL enable_sort = on";
const setup = [scan, readSort, disableSort].join("; ");

function command(sql) {
  if (sql === readSort) return { command: "SELECT", rows: [{ enable_sort: "on" }] };
  return { command: sql.split(" ")[0], rows: [] };
}

test("ANN emits a materialized 400-row pool and the same exact SQL with and without batching", async () => {
  const owner = "owner";
  const axis = new Float32Array(1536);
  axis[0] = 1;
  const observed = [];
  for (const batched of [false, true]) {
    const statements = [];
    const uow = createPostgresUnitOfWork({ async connect() {
      return {
        release() {},
        ...(batched && { async queryBatch(sql) {
          statements.push([sql]);
          return sql.split("; ").map(command);
        } }),
        async query(sql, values) {
          statements.push([sql, values]);
          if (sql.startsWith("SELECT count(*)::text AS eligible")) {
            return { command: "SELECT", rows: [{ eligible: "2000", embedded: "2000" }] };
          }
          if (sql.includes("ORDER BY embedding <=> $8::vector")) {
            const rows = Array.from({ length: 400 }, (_, i) => ({
              id: String(i), core_namespace: null, revision: 1, updated_us: "1",
              distance: i / 1000, vector_hidden: false,
            }));
            return { command: "SELECT", rows };
          }
          return command(sql);
        },
      };
    } });
    const result = await uow.run(owner, { readOnly: true },
      tx => createPostgresMemoryCandidates().vector.vector(tx, { owner, namespaces: [null] }, axis, "test", 50));
    assert.equal(result.rows.length, 50);
    assert.deepEqual(result.coverage, { eligible: 2000, embedded: 2000, complete: true });

    const start = batched ? [[[begin, lock, timeout].join("; ")]] : [[begin, undefined], [lock, undefined], [timeout, undefined]];
    assert.deepEqual(statements.splice(0, start.length), start);
    assert.match(statements.shift()[0], /^WITH owner_state AS/);
    assert.match(statements.shift()[0], /^SELECT count\(\*\)::text AS eligible/);
    const expectedSetup = batched ? [[setup]] : [[scan, undefined], [readSort, undefined], [disableSort, undefined]];
    assert.deepEqual(statements.splice(0, expectedSetup.length), expectedSetup);
    const [sql, values] = statements.shift();
    assert.deepEqual(values, [owner, [null], null, null, null, false, "test", JSON.stringify(Array.from(axis)), 400, []]);
    assert.match(sql, /^WITH candidates AS MATERIALIZED \(\s*SELECT id, updated_at, embedding <=> \$8::vector AS distance/);
    assert.match(sql, /AND id <> ALL \(\$10::text\[\]\)/);
    assert.match(sql, /ORDER BY embedding <=> \$8::vector LIMIT \$9/);
    assert.match(sql, /m\.id = c\.id AND m\.user_id = \$1/);
    assert.match(sql, /ORDER BY c\.distance \+ 0, c\.updated_at DESC, c\.id COLLATE "C" DESC$/);
    assert.deepEqual(statements.map(([text]) => text), [restoreSort, "COMMIT", "DISCARD ALL"]);
    observed.push([sql, values]);
  }
  assert.deepEqual(observed[0], observed[1]);
});

test("the read lint admits only the exact relaxed scan and setup strings", () => {
  assert.equal(isReadStatement(scan, false), true);
  assert.equal(isReadStatement(setup), true);
  assert.equal(isReadStatement(setup, false), false);
  for (const sql of [scan, setup]) {
    for (const variant of [sql + ";", sql + " ", sql.replace("relaxed_order", "strict_order"),
      sql.replace("relaxed_order", "off"), sql.replace("SET LOCAL", "set local")]) {
      assert.equal(isReadStatement(variant), false, variant);
    }
  }
});
