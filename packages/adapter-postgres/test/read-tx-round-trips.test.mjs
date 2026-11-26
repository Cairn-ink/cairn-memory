import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { factIncarnationBody } from "../../core/src/index.mjs";
import { createPostgresMemoryCandidates, createPostgresUnitOfWork, factSlot, query } from "../src/index.mjs";
import { isReadStatement } from "../src/read-only.mjs";

const owner = "owner";
const readBegin = "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY";
const lockTimeout = "SET LOCAL lock_timeout = '5s'";
const statementTimeout = "SET LOCAL statement_timeout = '30s'";
const readStart = "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '30s'";
const writeStart = "BEGIN; SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '30s'";
const iterative = "SET LOCAL hnsw.iterative_scan = 'relaxed_order'";
const readSort = "SELECT current_setting('enable_sort') AS enable_sort";
const disableSort = "SET LOCAL enable_sort = off";
const restoreSort = "SET LOCAL enable_sort = on";
const annSetup = "SET LOCAL hnsw.iterative_scan = 'relaxed_order'; SELECT current_setting('enable_sort') AS enable_sort; SET LOCAL enable_sort = off";
const discard = ["DISCARD ALL"];
const end = [["COMMIT"], discard];
const annStatement = sql => sql.includes("ORDER BY embedding <=> $8::vector LIMIT $9");
const axis = new Float32Array(1536);
axis[0] = 1;

function recordingSource({ batched = false, initialSort = "on", embedded = 500, fail = () => {} } = {}) {
  const statements = [];
  const releases = [];
  let sort = initialSort;

  function execute(sql) {
    const unexpected = fail(sql);
    if (unexpected) return unexpected;
    if (sql === "ROLLBACK" || sql === "COMMIT") sort = initialSort;
    if (sql === disableSort) sort = "off";
    if (sql === restoreSort) sort = "on";
    if (sql === readSort) return { command: "SELECT", rows: [{ enable_sort: sort }] };
    if (sql === "SELECT current_setting('lock_timeout') AS value") {
      return { command: "SELECT", rows: [{ value: "0" }] };
    }
    if (sql.startsWith("SELECT pg_advisory_unlock_shared(")) {
      return { command: "SELECT", rows: [{ value: true }] };
    }
    if (sql.startsWith("SELECT count(*)::text AS eligible")) {
      return { command: "SELECT", rows: [{ eligible: embedded, embedded }] };
    }
    return { command: sql.split(" ", 1)[0], rows: [] };
  }

  const source = {
    async connect() {
      const connection = {
        async query(...args) {
          statements.push(args);
          return execute(args[0]);
        },
        async release(...args) {
          releases.push(args);
        },
      };
      if (batched) {
        connection.queryBatch = async (...args) => {
          statements.push(args);
          return args[0].split("; ").map(execute);
        };
      }
      return connection;
    },
  };

  const uow = createPostgresUnitOfWork(source);
  return { uow, statements, releases, sort: () => sort };
}

test("the read pause lock still precedes the transaction start and snapshot", async () => {
  const db = recordingSource({ batched: true });
  await db.uow.run(owner, { readOnly: true, pauseLock: true }, tx => query(tx, "SELECT 1"));
  const pauseKey = "hashtextextended('cairn:memory-pause:' || $1, 0)";
  assert.deepEqual(db.statements, [
    ["SELECT current_setting('lock_timeout') AS value"],
    ["SET lock_timeout = '5s'"],
    [`SELECT pg_advisory_lock_shared(${pauseKey})`, [owner]],
    ["SELECT set_config('lock_timeout', $1, false)", ["0"]],
    [readStart],
    ["SELECT 1", undefined],
    ["COMMIT"],
    [`SELECT pg_advisory_unlock_shared(${pauseKey}) AS value`, [owner]],
    discard,
  ]);
});

test("a concurrent direct read waits for the ANN planner setting to be restored", async () => {
  const db = recordingSource({ batched: true });
  await db.uow.run(owner, { readOnly: true }, tx => Promise.all([vector(tx), query(tx, "SELECT 42")]));
  const restored = db.statements.findIndex(([sql]) => sql === restoreSort);
  assert.ok(restored >= 0);
  assert.ok(db.statements.findIndex(([sql]) => sql === "SELECT 42") > restored);
});

test("ANN pagination restores sorting before receipt reads and disables it for the next ANN page", async () => {
  const body = {
    kind: "session", namespace: null, origin: "forget", session: { client: "one", sessionId: "closed" },
  };
  const fact = { ...body, owner, actionId: "forget" };
  const facts = [{
    fact_id: "session-fact", action_id: fact.actionId, epoch: "1", created_at_us: "0", body,
    kind: body.kind, origin: body.origin, mode: null, slot: factSlot(fact),
    incarnation: createHash("sha256").update(factIncarnationBody(fact)).digest("hex"),
  }];
  let pages = 0;
  let receipts = 0;
  const db = recordingSource({ batched: true, fail(sql) {
    if (sql.startsWith("WITH owner_state")) return { command: "SELECT", rows: facts };
    if (annStatement(sql)) {
      assert.equal(db.sort(), "off");
      const rows = pages++ ? [] : Array.from({ length: 400 }, (_, i) => ({
        id: String(i), core_namespace: null, revision: 1, updated_us: "1", created_ms: 0,
        distance: 0.1 * i, source_client: "one", source_session_id: "closed",
      }));
      return { command: "SELECT", rows };
    }
    if (sql.includes("FROM core_memory_receipts")) {
      assert.equal(db.sort(), "on");
      receipts++;
    }
  } });
  await db.uow.run(owner, { readOnly: true }, vector);
  assert.equal(pages, 2);
  assert.equal(receipts, 1);
});

function vector(tx) {
  return createPostgresMemoryCandidates().vector.vector(tx, { owner, namespaces: [null] }, axis, "test", 1);
}

for (const readOnly of [true, false]) {
  const sql = readOnly ? "SELECT $1" : "UPDATE example SET value = $1";
  const ownerLock = readOnly ? [] : [["SELECT pg_advisory_xact_lock(hashtext('w3:' || $1))", [owner]]];
  const today = [[readOnly ? readBegin : "BEGIN"], [lockTimeout], [statementTimeout]];
  for (const batched of [false, true]) {
    test(`${readOnly ? "read" : "write"} transaction with batching ${batched ? "enabled" : "absent"} sends the exact SQL and arguments`, async () => {
      const db = recordingSource({ batched });
      await db.uow.run(owner, { readOnly }, tx => query(tx, sql, [1]));
      const start = batched ? [[readOnly ? readStart : writeStart]] : today;
      assert.deepEqual(db.statements, [...start, ...ownerLock, [sql, [1]], ...end]);
      assert.deepEqual(db.releases, [[]]);
      assert.equal(db.statements.length, 6 + ownerLock.length - (batched ? 2 : 0));
    });
  }
}

for (const [initialSort, embedded, expectedDrop] of [["on", 500, 4], ["off", 500, 3], ["on", 16, 2]]) {
  test(`vector queries retain their SQL and restore enable_sort=${initialSort} at coverage ${embedded}`, async () => {
    async function run(batched) {
      const db = recordingSource({ batched, initialSort, embedded });
      await db.uow.run(owner, { readOnly: true }, async tx => {
        await vector(tx);
        assert.equal(db.sort(), initialSort);
        await query(tx, "SELECT 42");
      });
      return db.statements;
    }

    const before = await run(false);
    const after = await run(true);
    const ann = before.findIndex(([sql]) => annStatement(sql) || sql.includes("FETCH FIRST $9 ROWS WITH TIES"));
    const broad = embedded === 500;
    const beginSetup = ann - (broad ? (initialSort === "on" ? 3 : 2) : 1);
    const expectedSetup = [[iterative, undefined]];
    if (broad) expectedSetup.push([readSort, undefined]);
    if (broad && initialSort === "on") expectedSetup.push([disableSort, undefined]);
    assert.deepEqual(before.slice(beginSetup, ann), expectedSetup);
    const next = broad && initialSort === "on" ? ann + 2 : ann + 1;
    if (next === ann + 2) assert.deepEqual(before[ann + 1], [restoreSort, undefined]);
    assert.match(before[next][0], /vector_norm\(embedding\) = 0/);
    assert.deepEqual(after, [
      [readStart], ...before.slice(3, beginSetup),
      broad ? [annSetup] : [iterative, undefined], ...before.slice(ann),
    ]);
    assert.equal(before.length - after.length, expectedDrop);
  });
}

for (const [statement, native, mapped, batch] of [
  [lockTimeout, "55P03", "lock_timeout", readStart],
  [statementTimeout, "57014", "statement_timeout", readStart],
  [statementTimeout, "22023", "internal_error", readStart],
  [readBegin, "08006", "storage_error", readStart],
  [iterative, "22023", "internal_error", annSetup],
  [readSort, "57014", "statement_timeout", annSetup],
  [disableSort, "08006", "storage_error", annSetup],
]) {
  test(`failure ${native} in ${statement} rolls back and destroys the connection`, async () => {
    const db = recordingSource({ batched: true, fail(sql) {
      if (sql === statement) throw { code: native };
    } });
    await assert.rejects(db.uow.run(owner, { readOnly: true }, async tx => {
      assert.equal(batch, annSetup);
      await assert.rejects(vector(tx), { code: mapped });
    }), { code: mapped });
    assert.deepEqual(db.statements.slice(-2), [[batch], ["ROLLBACK"]]);
    assert.deepEqual(db.releases, [[true]]);
    assert.equal(db.sort(), "on");
  });
}

for (const statement of [readBegin, lockTimeout, statementTimeout, iterative, readSort, disableSort]) {
  test(`an unexpected command for ${statement} aborts the run`, async () => {
    const db = recordingSource({ batched: true, fail(sql) {
      if (sql === statement) return { command: "DELETE", rows: [] };
    } });
    await assert.rejects(db.uow.run(owner, { readOnly: true }, vector), { code: "storage_error" });
    assert.deepEqual(db.statements.at(-1), ["ROLLBACK"]);
    assert.deepEqual(db.releases, [[true]]);
  });
}

for (const initialSort of ["on", "off"]) {
  for (const driverFailure of [false, true]) {
    test(`ANN ${driverFailure ? "driver failure" : "processing throw"} preserves initial enable_sort=${initialSort}`, async () => {
      const db = recordingSource({ batched: true, initialSort, fail(sql) {
        if (!annStatement(sql)) return;
        if (driverFailure) throw { code: "57014" };
        return { command: "SELECT", rows: [{ id: "bad", distance: 0, updated_us: "not a sort key" }] };
      } });
      await assert.rejects(db.uow.run(owner, { readOnly: true }, vector), {
        code: driverFailure ? "statement_timeout" : "internal_error",
      });
      const ann = db.statements.findIndex(([sql]) => annStatement(sql));
      assert.deepEqual(db.statements.slice(ann + 1), [
        ...(!driverFailure && initialSort === "on" ? [[restoreSort, undefined]] : []),
        ["ROLLBACK"],
      ]);
      assert.equal(db.sort(), initialSort);
      assert.deepEqual(db.releases, [[true]]);
    });
  }
}

test("only exact read batches pass the read-only guard", () => {
  assert.equal(isReadStatement(iterative), true);
  assert.equal(isReadStatement(iterative.replace("relaxed_order", "strict_order")), false);
  assert.equal(isReadStatement(annSetup.replace("relaxed_order", "strict_order")), false);
  for (const sql of [readStart, annSetup]) {
    assert.equal(isReadStatement(sql), true, sql);
    for (const variant of [
      sql + "; SELECT 1", sql + ";", sql + " -- comment", "/* comment */ " + sql,
      sql + "; SELECT set_config('enable_sort', 'on', true)", sql.replace("; ", " /* comment */; "),
      sql.replace("; ", ";\n"),
    ]) {
      assert.equal(isReadStatement(variant), false, variant);
    }
  }
  assert.equal(isReadStatement(writeStart), false);
  assert.equal(isReadStatement("SELECT set_config('enable_sort', 'on', true)"), false);
});

test("the direct read API cannot submit batches through the single-statement driver path", async () => {
  for (const batched of [false, true]) {
    const db = recordingSource({ batched });
    await assert.rejects(db.uow.run(owner, { readOnly: true }, tx => query(tx, annSetup)), { code: "internal_error" });
    assert.ok(db.statements.every(([sql]) => sql !== annSetup));
  }
});
