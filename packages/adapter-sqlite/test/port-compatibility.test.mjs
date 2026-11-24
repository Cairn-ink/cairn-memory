import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { openSqliteUnitOfWork } from "@cairn-ink/adapter-sqlite";

const owner = "test-owner";
const write = { write: true };
const internal = { code: "internal_error" };

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "sqlite-port-compatibility-"));
  const filename = join(directory, "store.sqlite");
  let store;
  t.after(async () => {
    try { await store?.close(); }
    finally { rmSync(directory, { recursive: true, force: true }); }
  });
  const setup = new DatabaseSync(filename);
  try { setup.exec("CREATE TABLE markers (content TEXT PRIMARY KEY)"); }
  finally { setup.close(); }
  store = openSqliteUnitOfWork(filename);
  return store;
}

function rows(store) {
  return store.uow.run(owner, { readOnly: true }, tx => store.port(tx, owner, {}, db =>
    db.prepare("SELECT content FROM markers ORDER BY content").all().map(row => row.content)));
}

test("exec batches can roll back and release a savepoint inside the outer transaction", async t => {
  const store = fixture(t);
  await store.uow.run(owner, {}, tx => store.port(tx, owner, write, db => {
    db.exec(`
      INSERT INTO markers VALUES ('before');
      SAVEPOINT batch_segment;
      INSERT INTO markers VALUES ('discard');
      ROLLBACK TO SAVEPOINT batch_segment;
      RELEASE SAVEPOINT batch_segment;
      INSERT INTO markers VALUES ('after');
    `);
    assert.equal(db.isTransaction, true);
  }));
  assert.deepEqual(await rows(store), ["after", "before"]);
});

test("rolling back the enclosing savepoint discards all nested work", async t => {
  const store = fixture(t);
  await store.uow.run(owner, {}, async tx => {
    await store.port(tx, owner, write, db => db.exec(`
      SAVEPOINT "outer segment";
      INSERT INTO markers VALUES ('enclosing');
      SAVEPOINT inner_segment;
      INSERT INTO markers VALUES ('nested');
    `));
    await store.port(tx, owner, write, db => {
      db.prepare('/* prefix */ RoLlBaCk/* gap */ TRANSACTION -- target follows\n TO "outer segment"').run();
      db.prepare('RELEASE "outer segment"').run();
      assert.equal(db.isTransaction, true);
    });
  });
  assert.deepEqual(await rows(store), []);
});

test("exec and prepare refuse explicit outer transaction control", async t => {
  const store = fixture(t);
  for (const sql of [
    "BEGIN IMMEDIATE", "COMMIT", "END TRANSACTION", "ROLLBACK", "ROLLBACK /* gap */ TRANSACTION",
    "ROLLBACK /* gap */; /* another comment */ TO segment",
  ]) {
    for (const method of ["exec", "prepare"]) {
      let refusal;
      await assert.rejects(store.uow.run(owner, {}, tx => store.port(tx, owner, write, db => {
        db.exec("INSERT INTO markers VALUES ('before refusal')");
        try {
          db[method](`; -- prefix\n /* gap */ ${sql}; INSERT INTO markers VALUES ('after refusal')`);
        } catch (error) {
          // Inspect the underlying exception before the port maps it to a CoreError.
          refusal = { code: error.code, inTransaction: db.isTransaction };
          throw error;
        }
      })), internal);
      assert.deepEqual(refusal, { code: "internal_error", inTransaction: true }, `${method}: ${sql}`);
      assert.deepEqual(await rows(store), [], `${method}: ${sql}`);
    }
  }
});

test("an automatic rollback inside a savepoint batch still invalidates the run", async t => {
  const store = fixture(t);
  let checked = false;
  await assert.rejects(store.uow.run(owner, {}, tx => store.port(tx, owner, write, db => {
    const prepared = db.prepare("INSERT INTO markers VALUES ('prepared after rollback')");
    assert.throws(() => db.exec(`
      SAVEPOINT segment;
      INSERT INTO markers VALUES ('duplicate');
      INSERT OR ROLLBACK INTO markers VALUES ('duplicate');
      INSERT INTO markers VALUES ('batch after rollback');
    `), { code: "ERR_SQLITE_ERROR" });
    assert.throws(() => prepared.run(), internal);
    assert.throws(() => db.exec("INSERT INTO markers VALUES ('exec after rollback')"), internal);
    checked = true;
  })), internal);
  assert.equal(checked, true);
  assert.deepEqual(await rows(store), []);
});

test("setReturnArrays preserves both columns with the same name", async t => {
  const store = fixture(t);
  const row = await store.uow.run(owner, { readOnly: true }, tx => store.port(tx, owner, {}, db => {
    const statement = db.prepare("SELECT 'left' AS duplicate, 'right' AS duplicate");
    if (typeof statement.setReturnArrays !== "function") return { missing: "setReturnArrays" };
    statement.setReturnArrays(true);
    return statement.get();
  }));
  assert.deepEqual(row, ["left", "right"]);
});

test("every native StatementSync method is available and revokes with its scope", async t => {
  const store = fixture(t);
  const memory = new DatabaseSync(":memory:");
  t.after(() => memory.close());
  const native = memory.prepare("SELECT 1");
  const methods = [];
  const accessors = [];
  for (let object = native; object !== Object.prototype; object = Object.getPrototypeOf(object)) {
    for (const key of Reflect.ownKeys(object)) {
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      if (key !== "constructor" && typeof descriptor.value === "function") methods.push(key);
      if (descriptor.get) accessors.push(key);
    }
  }
  await store.uow.run(owner, { readOnly: true }, async tx => {
    let statement;
    const missing = await store.port(tx, owner, {}, db => {
      statement = db.prepare("SELECT 1");
      for (const key of accessors) assert.equal(statement[key], native[key], String(key));
      return methods.filter(key => typeof statement[key] !== "function").map(String);
    });
    assert.deepEqual(missing, []);
    for (const key of methods) assert.throws(() => statement[key](), internal, String(key));
    for (const key of accessors) assert.throws(() => statement[key], internal, String(key));
  });
});

test("native statement finalizers work with an active scoped iterator", async t => {
  const store = fixture(t);
  const memory = new DatabaseSync(":memory:");
  t.after(() => memory.close());
  const native = memory.prepare("SELECT 1");
  const finalizers = ["close", Symbol.dispose].filter(key => typeof native[key] === "function");
  for (const key of finalizers) {
    await store.uow.run(owner, { readOnly: true }, async tx => {
      let iterator;
      await store.port(tx, owner, {}, db => {
        const statement = db.prepare("SELECT 1 AS value UNION ALL SELECT 2");
        iterator = statement.iterate();
        assert.equal(iterator.next().value.value, 1);
        statement[key]();
        assert.throws(() => iterator.next(), { code: "ERR_INVALID_STATE" });
        assert.equal(db.prepare("SELECT 2 AS value").get().value, 2);
      });
      assert.throws(() => iterator.next(), internal);
    });
  }
});
