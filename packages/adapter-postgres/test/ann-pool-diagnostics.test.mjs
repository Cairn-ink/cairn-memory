import assert from "node:assert/strict";
import test from "node:test";
import { createPostgresMemoryCandidates, createPostgresUnitOfWork } from "../src/index.mjs";

const owner = "owner";
const axis = new Float32Array(1536);
axis[0] = 1;

function candidate(id, distance, hidden = false) {
  return { id, distance, core_namespace: null, revision: 1, updated_us: "1", vector_hidden: hidden };
}

test("pool totals preserve the ANN coverage rule", async t => {
  const cases = [
    { name: "short pool fills depth", ann: 2, zeros: 0, complete: true },
    { name: "short pool exhausts nonzero rows", ann: 1, zeros: 69, complete: true },
    { name: "short pool cuts off before exhaustion", ann: 1, zeros: 68, complete: false },
    { name: "empty pool cuts off despite zero fallback filling depth", ann: 0, zeros: 68, complete: false },
    { name: "filled depth with incomplete embedding coverage", ann: 2, zeros: 0, unembedded: 1, complete: false },
    { name: "a hidden full page extends to a short page", ann: 2, zeros: 0, hidden: 400, complete: true },
  ];
  for (const { name, ann, zeros, unembedded = 0, hidden = 0, complete } of cases) {
    await t.test(name, async () => {
      const uow = createPostgresUnitOfWork({
        async connect() {
          return {
            async query(sql, values) {
              const rowsOf = rows => ({ command: "SELECT", rows });
              if (sql === "SELECT current_setting('enable_sort') AS enable_sort") {
                return rowsOf([{ enable_sort: "on" }]);
              }
              if (sql.startsWith("SELECT count(*)::text AS eligible")) {
                return rowsOf([{ eligible: 70 + hidden + unembedded, embedded: 70 + hidden }]);
              }
              if (sql.includes("ORDER BY embedding <=> $8::vector LIMIT $9")) {
                const [limit, excluded] = values.slice(8);
                assert.equal(limit, 400);
                if (hidden && excluded.length === 0) {
                  return rowsOf(Array.from({ length: hidden }, (_, i) => candidate(`hidden-${i}`, 0.1, true)));
                }
                assert.equal(excluded.length, hidden);
                return rowsOf(Array.from({ length: ann }, (_, i) => candidate(`ann-${i}`, 0.5)));
              }
              if (sql.startsWith("SELECT count(*)::text AS zeros")) return rowsOf([{ zeros }]);
              if (sql.includes("vector_norm(embedding) = 0")) {
                return rowsOf(Array.from({ length: Math.min(zeros, values[8]) }, (_, i) => candidate(`zero-${i}`, 1)));
              }
              return { command: sql.split(" ", 1)[0], rows: [] };
            },
            release() {},
          };
        },
      });
      const { vector } = createPostgresMemoryCandidates();
      const result = await uow.run(owner, { readOnly: true },
        tx => vector.vector(tx, { owner, namespaces: [null] }, axis, "test", 2));
      assert.equal(result.rows.length, 2);
      assert.deepEqual(result.coverage, {
        eligible: 70 + unembedded,
        embedded: 70,
        complete,
        pool: { requested: hidden ? 800 : 400, returned: hidden + ann },
      });
    });
  }
});
