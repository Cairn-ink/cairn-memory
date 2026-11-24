import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { sqlitePortScope } from "../src/port-scope.mjs";

function fixture(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec("CREATE TABLE markers (value TEXT); BEGIN; INSERT INTO markers VALUES ('before')");
  const scope = sqlitePortScope(db, operation => operation());
  t.after(() => scope.revoke());
  const rows = () => db.prepare("SELECT value FROM markers ORDER BY rowid").all().map(row => row.value);
  return { db, connection: scope.connection, rows };
}

const rollbackSpellings = [
  "ROLLBACK TRANSACTION TO$",
  "ROLLBACK TO$x",
  "ROLLBACK TOé",
  "ROLLBACK TO\u00a0",
  "ROLLBACK TRANSACTION TO$x",
  "ROLLBACK TRANSACTION TOé",
  "ROLLBACK TRANSACTION TO\u00a0",
];

for (const [method, run] of [
  ["prepare", (connection, sql) => connection.prepare(sql).run()],
  ["exec", (connection, sql) => connection.exec(sql)],
]) {
  for (const sql of rollbackSpellings) {
    test(`${method} refuses "${sql}" while the outer transaction is active`, t => {
      const { db, connection, rows } = fixture(t);
      assert.throws(() => run(connection, sql), { code: "internal_error" });
      assert.equal(db.isTransaction, true);
      db.exec("COMMIT");
      assert.deepEqual(rows(), ["before"]);
    });
  }

  test(`${method} can roll back and release nested savepoints`, t => {
    const { db, connection, rows } = fixture(t);
    run(connection, "SAVEPOINT enclosing_segment");
    run(connection, "INSERT INTO markers VALUES ('enclosing')");
    run(connection, "SAVEPOINT nested_segment");
    run(connection, "INSERT INTO markers VALUES ('nested')");
    run(connection, "ROLLBACK TO SAVEPOINT nested_segment");
    run(connection, "RELEASE SAVEPOINT nested_segment");
    assert.deepEqual(rows(), ["before", "enclosing"]);
    run(connection, "ROLLBACK TRANSACTION TO/* target */ enclosing_segment");
    run(connection, "RELEASE enclosing_segment");
    run(connection, "INSERT INTO markers VALUES ('after')");
    assert.equal(db.isTransaction, true);
    db.exec("COMMIT");
    assert.deepEqual(rows(), ["before", "after"]);
  });
}
