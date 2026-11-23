import assert from "node:assert/strict";
import { once } from "node:events";
import { linkSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { Worker } from "node:worker_threads";
import { openSqliteUnitOfWork } from "@cairn-ink/adapter-sqlite";

const owner = "test-owner";
const readOnly = { readOnly: true };
const write = { write: true };
const internal = { code: "internal_error" };
const insert = "INSERT INTO test_rows VALUES (?)";
const duplicateRollback = "INSERT OR ROLLBACK INTO test_rows VALUES (?)";

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "sqlite-uow-regression-"));
  const filename = join(directory, "store.sqlite");
  let store;
  t.after(async () => {
    try { await store?.close(); }
    finally { rmSync(directory, { recursive: true, force: true }); }
  });
  const db = new DatabaseSync(filename);
  try {
    db.exec("CREATE TABLE test_rows (content TEXT PRIMARY KEY)");
  } finally {
    db.close();
  }
  store = openSqliteUnitOfWork(filename);
  return { ...store, filename, directory };
}

function rows(store) {
  return store.uow.run(owner, readOnly, tx => store.port(tx, owner, {}, db =>
    db.prepare("SELECT content FROM test_rows ORDER BY content").all().map(row => row.content)));
}

test("a rejected bound async port cannot use its connection or statement after rollback", async t => {
  const store = fixture(t);
  const resume = Promise.withResolvers();
  const finished = Promise.withResolvers();
  const use = method => {
    try {
      method();
      return "wrote";
    } catch (error) {
      return error.code;
    }
  };
  const body = (async function (db) {
    const statement = db.prepare(insert);
    await resume.promise;
    finished.resolve([
      use(() => statement.run("escaped statement")),
      use(() => db.exec("INSERT INTO test_rows VALUES ('escaped connection')")),
    ]);
  }).bind(null);
  try {
    await assert.rejects(store.uow.run(owner, {}, tx => store.port(tx, owner, write, body)), internal);
  } finally {
    resume.resolve();
  }
  const outcomes = await finished.promise;
  assert.deepEqual(await rows(store), []);
  assert.deepEqual(outcomes, ["internal_error", "internal_error"]);
});

test("a caught SQLite rollback blocks prepared statements and exec within the same port", async t => {
  const store = fixture(t);
  const failures = [];
  await assert.rejects(store.uow.run(owner, {}, tx => store.port(tx, owner, write, db => {
    const prepared = db.prepare(insert);
    prepared.run("duplicate");
    assert.throws(() => db.prepare(duplicateRollback).run("duplicate"), { code: "ERR_SQLITE_ERROR" });
    for (const attemptedWrite of [
      () => prepared.run("prepared after rollback"),
      () => db.exec("INSERT INTO test_rows VALUES ('exec after rollback'); SELECT 1"),
    ]) {
      try { attemptedWrite(); }
      catch (error) { failures.push(error.code); }
    }
  })), internal);
  assert.deepEqual(await rows(store), []);
  assert.deepEqual(failures, ["internal_error", "internal_error"]);
});

test("exec cannot finish the transaction and continue to an autocommit statement", async t => {
  const store = fixture(t);
  await store.uow.run(owner, {}, tx => store.port(tx, owner, write, db => db.exec(`
    INSERT INTO test_rows VALUES ('first; row');
    /* comment; with semicolon */ INSERT INTO test_rows VALUES ('second');
    -- trailing comment
  `)));
  await assert.rejects(store.uow.run(owner, {}, tx => store.port(tx, owner, write, db =>
    db.exec("/* end */ ROLLBACK; INSERT INTO test_rows VALUES ('batch after rollback')"))), internal);
  assert.deepEqual(await rows(store), ["first; row", "second"]);
});

test("revokes escaped iterators and refuses thenable accessors while a run is still live", async t => {
  const store = fixture(t);
  let accessed = 0;
  await store.uow.run(owner, {}, async tx => {
    let escaped;
    await store.port(tx, owner, write, db => {
      db.prepare(insert).run("first");
      db.prepare(insert).run("second");
      escaped = db.prepare("SELECT content FROM test_rows ORDER BY content").iterate();
      assert.equal(escaped.next().value.content, "first");
    });
    assert.throws(() => escaped.next(), internal);
    await assert.rejects(store.port(tx, owner, {}, () => ({
      get then() {
        if (++accessed === 1) return undefined;
        return resolve => resolve("assimilated");
      },
    })), internal);
  });
  assert.equal(accessed, 0);
  assert.deepEqual(await rows(store), ["first", "second"]);
});

async function workerWrite(filename) {
  const worker = new Worker(`
    const { parentPort, workerData } = require("node:worker_threads");
    (async () => {
      const { openSqliteUnitOfWork } = await import(workerData.module);
      const store = openSqliteUnitOfWork(workerData.filename);
      try {
        await store.uow.run(workerData.owner, { pauseLock: true }, tx =>
          store.port(tx, workerData.owner, { write: true, pauseLock: true }, db =>
            db.prepare(workerData.insert).run("worker write")));
      } finally {
        await store.close();
      }
      parentPort.postMessage("committed");
    })().catch(error => parentPort.postMessage(error.code ?? error.name));
  `, { eval: true, execArgv: [], workerData: {
    filename, owner, insert, module: import.meta.resolve("@cairn-ink/adapter-sqlite"),
  } });
  try {
    const [outcome] = await once(worker, "message");
    return outcome;
  } finally {
    await worker.terminate();
  }
}

test("a Worker cannot open the physical file while its owner holds a pause lock", async t => {
  const store = fixture(t);
  const alias = join(store.directory, "alias.sqlite");
  linkSync(store.filename, alias);
  const paused = Promise.withResolvers();
  const release = Promise.withResolvers();
  const reader = store.uow.run(owner, { readOnly: true, pauseLock: true }, async () => {
    paused.resolve();
    await release.promise;
  });
  let samePath;
  let sameFile;
  try {
    await Promise.race([paused.promise, reader]);
    samePath = await workerWrite(store.filename);
    if (samePath === "storage_busy") sameFile = await workerWrite(alias);
  } finally {
    release.resolve();
    await reader;
  }
  assert.deepEqual(await rows(store), []);
  assert.equal(samePath, "storage_busy");
  assert.equal(sameFile, "storage_busy");
  await store.close();
  assert.equal(await workerWrite(store.filename), "committed");
});

test("a reentrant options getter cannot schedule BEGIN after closing the store", async t => {
  const store = fixture(t);
  const attempts = [];
  const exec = DatabaseSync.prototype.exec;
  t.mock.method(DatabaseSync.prototype, "exec", function (sql) {
    if (sql.startsWith("BEGIN")) attempts.push({ open: this.isOpen, sql });
    return exec.call(this, sql);
  });
  let closing;
  const options = {
    get readOnly() {
      closing = store.close();
      return false;
    },
  };
  let entered = false;
  await assert.rejects(store.uow.run(owner, options, async () => { entered = true; }), internal);
  await closing;
  assert.deepEqual(attempts, []);
  assert.equal(entered, false);
});

test("a port after automatic rollback never enters the body with a sentinel insert", async t => {
  const store = fixture(t);
  let entered = false;
  await assert.rejects(store.uow.run(owner, {}, async tx => {
    await store.port(tx, owner, write, db => db.prepare(insert).run("duplicate"));
    await assert.rejects(store.port(tx, owner, write, db =>
      db.prepare(duplicateRollback).run("duplicate")), internal);
    await assert.rejects(store.port(tx, owner, write, db => {
      entered = true;
      db.prepare(insert).run("sentinel after automatic rollback");
      // This keeps the rejection identical even if the port-entry guard is missing.
      throw new Error("sentinel body entered");
    }), internal);
  }), internal);
  const persisted = await rows(store);
  assert.deepEqual({ entered, persisted }, { entered: false, persisted: [] });
});
