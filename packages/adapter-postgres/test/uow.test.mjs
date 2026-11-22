import assert from "node:assert/strict";
import test from "node:test";
import { CoreError } from "../../core/src/index.mjs";
import { createPostgresUnitOfWork, query } from "../src/index.mjs";

const owner = "owner";
const begin = ["BEGIN"];
const readBegin = ["BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"];
const lockTimeout = ["SET LOCAL lock_timeout = '5s'"];
const statementTimeout = ["SET LOCAL statement_timeout = '30s'"];
const pauseLock = ["SELECT pg_advisory_xact_lock(hashtextextended('cairn:memory-pause:' || $1, 0))", [owner]];
const ownerLock = ["SELECT pg_advisory_xact_lock(hashtext('w3:' || $1))", [owner]];
const write = ["UPDATE example SET value = $1", [1]];
const read = ["SELECT $1", [1]];
const commit = ["COMMIT"];
const rollback = ["ROLLBACK"];
const writeSequence = [begin, lockTimeout, statementTimeout, pauseLock, ownerLock, write, commit];

function stub({ onConnect, onQuery, onRelease } = {}) {
  const statements = [];
  const releases = [];
  let checkouts = 0;
  const result = { rows: [{ value: 1 }], rowCount: 1 };
  const uow = createPostgresUnitOfWork({
    async connect() {
      checkouts++;
      await onConnect?.();
      return {
        async query(...args) {
          statements.push(args);
          return await onQuery?.(args[0], statements.length - 1) ?? result;
        },
        async release(...args) {
          releases.push(args);
          await onRelease?.();
        },
      };
    },
  });
  return { uow, statements, releases, result, get checkouts() { return checkouts; } };
}

function hasCode(code) {
  return (error) => {
    assert.ok(error instanceof CoreError);
    assert.equal(error.message, code);
    assert.equal(error.code, code);
    assert.equal(error.cause, undefined);
    return true;
  };
}

for (const [label, options, statement, expected] of [
  ["write", {}, write, [begin, lockTimeout, statementTimeout, ownerLock, write, commit]],
  ["pause lock", { pauseLock: true }, write, writeSequence],
  ["read only", { readOnly: true, pauseLock: true }, read, [readBegin, lockTimeout, statementTimeout, read, commit]],
]) {
  test(`${label} uses one connection and the exact SQL sequence`, async () => {
    const db = stub();
    const result = await db.uow.run(owner, options, async (tx) => {
      assert.equal(tx.owner, owner);
      assert.equal(tx.readOnly, options.readOnly ?? false);
      return query(tx, ...statement);
    });
    assert.equal(result, db.result);
    assert.equal(db.checkouts, 1);
    assert.deepEqual(db.releases, [[]]);
    assert.deepEqual(db.statements, expected);
  });
}

for (const [index, [sql]] of writeSequence.entries()) {
  test(`failure at ${sql} rolls back and destroys the connection`, async () => {
    const db = stub({
      onQuery(_sql, step) {
        if (step === index) throw Object.assign(new Error("private native message"), { code: "55P03" });
      },
    });
    await assert.rejects(
      db.uow.run(owner, { pauseLock: true }, (tx) => query(tx, ...write)),
      hasCode("lock_timeout"),
    );
    assert.deepEqual(db.statements, [...writeSequence.slice(0, index + 1), rollback]);
    assert.deepEqual(db.releases, [[true]]);
    assert.equal(db.checkouts, 1);
  });
}

test("checkout failure is mapped without attempting release", async () => {
  const db = stub({ onConnect() { throw { code: "08006", message: "private connection details" }; } });
  await assert.rejects(db.uow.run(owner, {}, async () => {}), hasCode("storage_error"));
  assert.deepEqual(db.statements, []);
  assert.deepEqual(db.releases, []);
});

test("callback failure survives rollback and release failures", async () => {
  const db = stub({
    onQuery(sql) {
      if (sql === "ROLLBACK") throw new Error("private rollback details");
    },
    onRelease() { throw new Error("private release details"); },
  });
  const original = new CoreError("capture_paused");
  await assert.rejects(
    db.uow.run(owner, {}, async () => { throw original; }),
    (error) => error === original,
  );
  assert.deepEqual(db.statements, [begin, lockTimeout, statementTimeout, ownerLock, rollback]);
  assert.deepEqual(db.releases, [[true]]);
});

test("release failure after a successful commit is mapped and release is attempted once", async () => {
  const db = stub({ onRelease() { throw new Error("private release details"); } });
  await assert.rejects(db.uow.run(owner, {}, async () => {}), hasCode("internal_error"));
  assert.deepEqual(db.statements, [begin, lockTimeout, statementTimeout, ownerLock, commit]);
  assert.deepEqual(db.releases, [[]]);
});

test("a caught statement failure still aborts the transaction", async () => {
  const db = stub({
    onQuery(sql) {
      if (sql === write[0]) throw { code: "40001" };
    },
  });
  await assert.rejects(db.uow.run(owner, {}, async (tx) => {
    await assert.rejects(query(tx, ...write), hasCode("storage_busy"));
  }), hasCode("storage_busy"));
  assert.deepEqual(db.statements, [begin, lockTimeout, statementTimeout, ownerLock, write, rollback]);
  assert.deepEqual(db.releases, [[true]]);
});

test("a ROLLBACK command tag from COMMIT fails the run", async () => {
  const db = stub({
    onQuery(sql) {
      if (sql === "COMMIT") return { rows: [], command: "ROLLBACK" };
    },
  });
  await assert.rejects(db.uow.run(owner, {}, async () => {}), hasCode("internal_error"));
  assert.deepEqual(db.statements, [begin, lockTimeout, statementTimeout, ownerLock, commit, rollback]);
  assert.deepEqual(db.releases, [[true]]);
});

for (const endpoint of ["COMMIT", "ROLLBACK"]) {
  test(`a Tx expires before ${endpoint} and stays expired`, async () => {
    let issued;
    const db = stub({
      async onQuery(sql) {
        if (sql === endpoint) await assert.rejects(query(issued, ...read), hasCode("internal_error"));
      },
    });
    const run = db.uow.run(owner, {}, async (tx) => {
      issued = tx;
      await assert.rejects(query({ ...tx }, ...read), hasCode("internal_error"));
      if (endpoint === "ROLLBACK") throw new CoreError("capture_paused");
    });
    if (endpoint === "COMMIT") await run;
    else await assert.rejects(run, hasCode("capture_paused"));
    await assert.rejects(query(issued, ...read), hasCode("internal_error"));
    assert.deepEqual(db.statements, [begin, lockTimeout, statementTimeout, ownerLock, [endpoint]]);
  });
}

test("a transaction-shaped object from another adapter is rejected", async () => {
  await assert.rejects(query({ owner, readOnly: false, __adapter: {} }, ...read), hasCode("internal_error"));
});

for (const [label, sql] of [
  ["direct write", "UPDATE example SET value = 1"],
  ["write after WITH", "WITH c AS (SELECT 1) INSERT INTO example SELECT * FROM c"],
  ["data-changing CTE", "WITH c AS (DELETE FROM example RETURNING *) SELECT * FROM c"],
  ["nested data-changing CTE", "WITH c AS (WITH d AS (DELETE FROM example RETURNING *) SELECT * FROM d) SELECT * FROM c"],
  ["SELECT INTO", "SELECT 1 INTO example"],
  ["multiple statements", "SELECT 1; /* separator */ COMMIT"],
  ["non-SELECT CTE", "WITH c AS (SELECT 1) TABLE c"],
]) {
  test(`read-only Tx rejects ${label} before issuing SQL`, async () => {
    const db = stub();
    await assert.rejects(db.uow.run(owner, { readOnly: true }, (tx) => query(tx, sql)), hasCode("internal_error"));
    assert.deepEqual(db.statements, [readBegin, lockTimeout, statementTimeout, rollback]);
    assert.deepEqual(db.releases, [[true]]);
  });
}

test("read-only Tx accepts commented SELECT or WITH SELECT and ignores quoted keywords", async () => {
  const db = stub();
  const sql = [
    " -- header\n select 'UPDATE; DELETE' AS \"INSERT\"; /* trailing */",
    "/* header */ with c as materialized (select $$MERGE;$$), d as (select $1) select * from c, d",
  ];
  await db.uow.run(owner, { readOnly: true }, async (tx) => {
    await query(tx, sql[0]);
    await query(tx, sql[1], [1]);
  });
  assert.deepEqual(db.statements, [readBegin, lockTimeout, statementTimeout, [sql[0], undefined], [sql[1], [1]], commit]);
});
