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
const discard = ["DISCARD ALL"];
const commitAndReset = [commit, discard];
const rollback = ["ROLLBACK"];
const writeSequence = [begin, lockTimeout, statementTimeout, pauseLock, ownerLock, write, commit];

function stub({ onConnect, onQuery, onRelease, commitResult = () => ({ command: "COMMIT", rows: [] }) } = {}) {
  const statements = [];
  const releases = [];
  const events = [];
  let checkouts = 0;
  const uow = createPostgresUnitOfWork({
    async connect() {
      checkouts++;
      await onConnect?.();
      return {
        async query(...args) {
          statements.push(args);
          events.push(["query", ...args]);
          const [sql] = args;
          const result = await onQuery?.(sql, statements.length - 1);
          if (sql === "COMMIT") return commitResult();
          return result ?? {
            command: sql === discard[0] ? sql : sql.split(" ", 1)[0],
            rows: [{ value: 1 }],
            rowCount: 1,
          };
        },
        async release(...args) {
          releases.push(args);
          events.push(["release", ...args]);
          await onRelease?.(...args);
        },
      };
    },
  });
  return { uow, statements, releases, events, get checkouts() { return checkouts; } };
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
    assert.deepEqual(result, { command: statement[0].split(" ", 1)[0], rows: [{ value: 1 }], rowCount: 1 });
    assert.equal(db.checkouts, 1);
    const expectedQueries = [...expected, discard].map((args) => ["query", ...args]);
    assert.deepEqual(db.events, [...expectedQueries, ["release"]]);
  });
}

for (const [index, [sql]] of writeSequence.slice(0, -1).entries()) {
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

test("a rolled-back run skips DISCARD ALL and preserves the original error", async () => {
  const db = stub();
  const original = new CoreError("capture_paused");
  await assert.rejects(
    db.uow.run(owner, { readOnly: true }, async () => { throw original; }),
    (error) => error === original,
  );
  assert.deepEqual(db.events, [
    ["query", ...readBegin], ["query", ...lockTimeout], ["query", ...statementTimeout],
    ["query", ...rollback], ["release", true],
  ]);
});

for (const [label, fail] of [
  ["rejects", () => { throw { code: "08006" }; }],
  ["returns an unexpected command", () => ({ command: "DISCARD", rows: [] })],
]) {
  test(`a committed run returns its result and destroys the connection if DISCARD ALL ${label}`, async () => {
    const result = {};
    const db = stub({ onQuery: (sql) => sql === discard[0] ? fail() : undefined });
    assert.equal(await db.uow.run(owner, {}, async () => result), result);
    assert.deepEqual(db.statements, [begin, lockTimeout, statementTimeout, ownerLock, ...commitAndReset]);
    assert.deepEqual(db.releases, [[true]]);
  });
}

test("a confirmed commit returns the callback result even when both release attempts fail", async () => {
  const result = {};
  const db = stub({ onRelease() { throw { code: "08006", message: "private release details" }; } });
  assert.equal(await db.uow.run(owner, {}, async () => result), result);
  assert.deepEqual(db.statements, [begin, lockTimeout, statementTimeout, ownerLock, ...commitAndReset]);
  assert.deepEqual(db.releases, [[], [true]]);
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
  const db = stub({ commitResult: () => ({ rows: [], command: "ROLLBACK" }) });
  await assert.rejects(db.uow.run(owner, {}, async () => {}), hasCode("storage_error"));
  assert.deepEqual(db.statements, [begin, lockTimeout, statementTimeout, ownerLock, commit]);
  assert.deepEqual(db.releases, [[true]]);
});

for (const [label, commitResult] of [
  ["connection rejection", () => { throw { code: "08007", message: "private connection details" }; }],
  ["serialization rejection", () => { throw { code: "40001" }; }],
  ["missing result", () => undefined],
  ["missing command", () => ({ rows: [] })],
  ["non-string command", () => ({ rows: [], command: 1 })],
  ["unexpected command", () => ({ rows: [], command: "SELECT" })],
  ["throwing command getter", () => ({ rows: [], get command() { throw new Error("private driver details"); } })],
]) {
  test(`COMMIT ${label} surfaces as non-retryable commit_outcome_unknown`, async () => {
    const db = stub({ commitResult });
    await assert.rejects(db.uow.run(owner, {}, async () => {}), (error) => {
      assert.equal(error.code, "commit_outcome_unknown");
      assert.equal(error.kind, "unavailable");
      assert.equal(error.retryable, false);
      return hasCode("commit_outcome_unknown")(error);
    });
    assert.deepEqual(db.statements, [begin, lockTimeout, statementTimeout, ownerLock, commit]);
    assert.deepEqual(db.releases, [[true]]);
  });
}

for (const [label, callbackFails, queryFails] of [
  ["a successful callback and two successful queries", false, false],
  ["a successful callback and a failed query", false, true],
  ["a failing callback and two successful queries", true, false],
  ["a failing callback and a failed query", true, true],
]) {
  test(`the runner drains both unawaited queries after ${label}`, async () => {
    const first = Promise.withResolvers();
    const second = Promise.withResolvers();
    const started = Promise.withResolvers();
    const secondSql = "SELECT 2";
    const db = stub({
      onQuery(sql) {
        if (sql === write[0]) return first.promise;
        if (sql === secondSql) return second.promise;
      },
    });
    const outcome = db.uow.run(owner, {}, async (tx) => {
      void query(tx, ...write);
      void query(tx, secondSql);
      started.resolve();
      if (callbackFails) throw new CoreError("capture_paused");
      return 1;
    }).then((value) => ({ value }), (error) => ({ error }));

    const pendingStatements = [begin, lockTimeout, statementTimeout, ownerLock, write, [secondSql, undefined]];
    try {
      await started.promise;
      await new Promise(setImmediate);
      assert.deepEqual(db.statements, pendingStatements);
      assert.deepEqual(db.releases, []);
      if (queryFails) first.reject({ code: "40001" });
      else first.resolve();
      await new Promise(setImmediate);
      assert.deepEqual(db.statements, pendingStatements);
      assert.deepEqual(db.releases, []);
    } finally {
      first.resolve();
      second.resolve();
      await outcome;
    }

    const { error, value } = await outcome;
    if (queryFails || callbackFails) {
      hasCode(queryFails ? "storage_busy" : "capture_paused")(error);
      assert.deepEqual(db.statements, [...pendingStatements, rollback]);
      assert.deepEqual(db.releases, [[true]]);
    } else {
      assert.equal(value, 1);
      assert.deepEqual(db.statements, [...pendingStatements, ...commitAndReset]);
      assert.deepEqual(db.releases, [[]]);
    }
  });
}

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
    assert.deepEqual(db.statements, [begin, lockTimeout, statementTimeout, ownerLock,
      ...(endpoint === "COMMIT" ? commitAndReset : [rollback]),
    ]);
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
  ["FOR UPDATE", "SELECT * FROM example FOR UPDATE"],
  ["FOR NO KEY UPDATE", "SELECT * FROM example FOR NO KEY UPDATE"],
  ["FOR SHARE", "SELECT * FROM example FoR /* lock mode */ ShArE"],
  ["FOR KEY SHARE", "SELECT * FROM example FOR KEY SHARE"],
  ["qualified function", "SELECT pg_catalog.set_config('application_name', 'changed', false)"],
  ["quoted function", 'SELECT "set_config"(\'application_name\', \'changed\', false)'],
  ["quoted qualified function", 'SELECT "pg_catalog" . "set_config" /* call */ (\'application_name\', \'changed\', false)'],
  ["Unicode-escaped function", String.raw`SELECT U&"set\005fconfig"('application_name', 'changed', false)`],
]) {
  test(`read-only Tx rejects ${label} before issuing SQL`, async () => {
    const db = stub();
    await assert.rejects(db.uow.run(owner, { readOnly: true }, (tx) => query(tx, sql)), hasCode("internal_error"));
    assert.deepEqual(db.statements, [readBegin, lockTimeout, statementTimeout, rollback]);
    assert.deepEqual(db.releases, [[true]]);
  });
}

for (const name of [
  "pg_advisory_lock", "pg_advisory_unlock_all", "pg_advisory_xact_lock_shared",
  "pg_try_advisory_lock", "pg_try_advisory_xact_lock_shared", "set_config",
  "nextval", "setval", "currval", "pg_notify", "lo_create", "lo_import", "lo_unlink",
  "dblink", "dblink_connect", "pg_sleep", "pg_sleep_for", "pg_sleep_until",
  "pg_terminate_backend", "pg_cancel_backend", "pg_reload_conf",
  "query_to_xml", "query_to_xml_and_xmlschema", "cursor_to_xml",
  "table_to_xml", "table_to_xmlschema", "table_to_xml_and_xmlschema",
  "database_to_xml", "database_to_xmlschema", "database_to_xml_and_xmlschema",
  "schema_to_xml", "schema_to_xmlschema", "schema_to_xml_and_xmlschema", "setseed",
]) {
  test(`read-only Tx rejects calls to ${name} before issuing SQL`, async () => {
    const db = stub();
    for (const sql of [`SELECT ${name.toUpperCase()}()`, `SELECT pg_catalog."${name}" ()`]) {
      await assert.rejects(db.uow.run(owner, { readOnly: true }, (tx) => query(tx, sql)), hasCode("internal_error"));
    }
    const refused = [readBegin, lockTimeout, statementTimeout, rollback];
    assert.deepEqual(db.statements, [...refused, ...refused]);
    assert.deepEqual(db.releases, [[true], [true]]);
  });
}

test("a caught read-only guard failure still aborts the run", async () => {
  const db = stub();
  await assert.rejects(db.uow.run(owner, { readOnly: true }, async (tx) => {
    await assert.rejects(query(tx, "UPDATE example SET value = 1"), hasCode("internal_error"));
  }), hasCode("internal_error"));
  assert.deepEqual(db.statements, [readBegin, lockTimeout, statementTimeout, rollback]);
  assert.deepEqual(db.releases, [[true]]);
});

for (const [label, statement, values] of [
  ["VALUES CTE", "WITH c(value) AS (VALUES (1), (2)) SELECT value FROM c"],
  ["window function", "SELECT row_number() OVER (PARTITION BY owner ORDER BY id) FROM example"],
  ["PGroonga search and score", "SELECT pgroonga_score(tableoid, ctid) FROM example WHERE body &@~ $1", ["search"]],
  ["pgvector distance and cast", "SELECT embedding <=> $1::vector AS distance FROM example", ["[0,1]"]],
  ["quoted collation", 'SELECT id FROM example ORDER BY id COLLATE "C" DESC'],
  ["to_regclass", "SELECT to_regclass('public.example')"],
  ["EXISTS", "SELECT EXISTS (SELECT 1 FROM example WHERE id = $1)", [1]],
  ["quoted update identifier", 'SELECT "last update", "set_config" FROM example'],
  ["function and locking names in literals", "SELECT 'pg_sleep(1)', $$FOR UPDATE$$, 'set_config('"],
]) {
  test(`read-only Tx accepts ${label}`, async () => {
    const db = stub();
    await db.uow.run(owner, { readOnly: true }, (tx) => query(tx, statement, values));
    assert.deepEqual(db.statements, [readBegin, lockTimeout, statementTimeout, [statement, values], ...commitAndReset]);
    assert.deepEqual(db.releases, [[]]);
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
  assert.deepEqual(db.statements, [
    readBegin, lockTimeout, statementTimeout, [sql[0], undefined], [sql[1], [1]], ...commitAndReset,
  ]);
});
