import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { CASES, runCase } from "@cairn-ink/conformance";
import { CoreError } from "@cairn-ink/core";
import { openSqliteUnitOfWork, SQLITE_ERROR_MAP, toSqliteError } from "@cairn-ink/adapter-sqlite";

const owner = "test-owner";
const otherOwner = "other-owner";
const readOnly = { readOnly: true };
const write = { write: true };

function openFixture() {
  const directory = mkdtempSync(join(tmpdir(), "sqlite-uow-"));
  const filename = join(directory, "store.sqlite");
  try {
    const setup = new DatabaseSync(filename);
    try {
      setup.exec(`CREATE TABLE test_rows (
        id INTEGER PRIMARY KEY, owner TEXT NOT NULL, content TEXT NOT NULL UNIQUE,
        revision INTEGER NOT NULL DEFAULT 1
      ) STRICT`);
    } finally {
      setup.close();
    }
    const store = openSqliteUnitOfWork(filename);
    return {
      ...store, directory, filename,
      async dispose() {
        try { await store.close(); }
        finally { rmSync(directory, { recursive: true, force: true }); }
      },
    };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

function fixture(t) {
  const store = openFixture();
  t.after(() => store.dispose());
  return store;
}

function insert(store, tx, content) {
  return store.port(tx, tx.owner, write, db => db.prepare(
    "INSERT INTO test_rows(owner, content) VALUES (?, ?)"
  ).run(tx.owner, content));
}

function contents(store, tx) {
  return store.port(tx, tx.owner, {}, db => db.prepare(
    "SELECT content FROM test_rows WHERE owner = ? ORDER BY id"
  ).all(tx.owner).map(row => row.content));
}

const kitFactory = {
  name: "sqlite-uow",
  async open() {
    const store = openFixture();
    // Only the storage probes required by the kit's unit-of-work cases.
    function get(tx, scope, id) {
      return store.port(tx, scope.owner, {}, db => db.prepare(
        "SELECT id, revision FROM test_rows WHERE owner = ? AND id = ?"
      ).get(scope.owner, id) ?? null);
    }
    return {
      adapter: {
        uow: store.uow,
        capabilities: {},
        memories: {
          insert(tx, scope, content) {
            return store.port(tx, scope.owner, write, db => ({
              id: db.prepare("INSERT INTO test_rows(owner, content) VALUES (?, ?)")
                .run(scope.owner, content.text).lastInsertRowid,
            }));
          },
          get,
          readRevision: get,
          findDuplicates(tx, scope) {
            return store.port(tx, scope.owner, {}, () => []);
          },
          replaceContent(tx, scope, id, revision, next) {
            return store.port(tx, scope.owner, write, db => {
              const result = db.prepare("UPDATE test_rows SET content = ?, revision = revision + 1 WHERE owner = ? AND id = ? AND revision = ?")
                .run(next.text, scope.owner, id, revision);
              if (!result.changes) throw new CoreError("revision_conflict");
            });
          },
        },
      },
      harness: {
        dump: () => store.uow.run(owner, readOnly, tx => store.port(tx, owner, {}, db =>
          db.prepare("SELECT * FROM test_rows ORDER BY id").all().map(row => ({ ...row })))),
      },
      nativeErrorMap: SQLITE_ERROR_MAP,
      busyNativeCodes: Object.keys(SQLITE_ERROR_MAP),
      close: () => store.dispose(),
    };
  },
};

const pendingTopology = new Set(["K-UOW-2", "K-UOW-3"]);
for (const kitCase of CASES.filter(({ id }) => id.startsWith("K-UOW-") || id === "K-ERR-1")) {
  test(`${kitCase.id} ${kitCase.title}`, {
    skip: pendingTopology.has(kitCase.id) ? "pending the SQLite topology decision" : false,
  }, async () => assert.equal(await runCase(kitFactory, kitCase), null));
}

test("takes a snapshot before the first port call and keeps it across a writer commit", async t => {
  const store = fixture(t);
  const written = Promise.withResolvers();
  const reading = Promise.withResolvers();
  const commit = Promise.withResolvers();
  const read = Promise.withResolvers();
  const writer = store.uow.run(owner, {}, async tx => {
    await insert(store, tx, "incoming");
    written.resolve();
    await commit.promise;
  });
  await Promise.race([written.promise, writer]);
  const reader = store.uow.run(owner, readOnly, async tx => {
    reading.resolve();
    await read.promise;
    assert.deepEqual(await contents(store, tx), []);
  });
  try {
    await Promise.race([reading.promise, reader]);
    commit.resolve();
    await writer;
  } finally {
    commit.resolve();
    read.resolve();
  }
  await reader;
  assert.deepEqual(await store.uow.run(owner, readOnly, tx => contents(store, tx)), ["incoming"]);
});

test("acquires pause before the file writer and serializes same-file writers across owners", async t => {
  const store = fixture(t);
  const independent = fixture(t);
  const reading = Promise.withResolvers();
  const writing = Promise.withResolvers();
  const releasePause = Promise.withResolvers();
  const releaseWriter = Promise.withResolvers();
  const entered = [];
  const reader = store.uow.run(owner, { ...readOnly, pauseLock: true }, async () => {
    reading.resolve();
    await releasePause.promise;
  });
  let queued;
  let writer;
  let other;
  try {
    await Promise.race([reading.promise, reader]);
    queued = store.uow.run(owner, { pauseLock: true }, async tx => {
      entered.push("pause");
      await store.port(tx, owner, { ...write, pauseLock: true }, db => db.exec("SELECT 1"));
    });
    writer = store.uow.run(owner, {}, async tx => {
      await assert.rejects(store.port(tx, owner, { ...write, pauseLock: true }, () => assert.fail()), { code: "internal_error" });
      entered.push("write");
      writing.resolve();
      await releaseWriter.promise;
    });
    await Promise.race([writing.promise, writer]);
    other = store.uow.run(otherOwner, {}, async () => { entered.push("other owner"); });
    await independent.uow.run(otherOwner, { pauseLock: true }, tx => insert(independent, tx, "independent file"));
    assert.deepEqual(entered, ["write"]);
  } finally {
    releaseWriter.resolve();
    releasePause.resolve();
    await Promise.all([reader, writer, queued, other]);
  }
  assert.deepEqual(entered.slice(1).sort(), ["other owner", "pause"]);
});

test("a held native writer returns a retryable error while the reader can proceed", async t => {
  const store = fixture(t);
  const peer = new DatabaseSync(store.filename);
  try {
    peer.exec(`BEGIN IMMEDIATE; INSERT INTO test_rows(owner, content) VALUES ('test-owner', 'uncommitted');`);
    await assert.rejects(store.uow.run(owner, {}, () => assert.fail("writer entered")), {
      code: "storage_busy", kind: "retryable", retryable: true, message: "storage_busy",
    });
    assert.deepEqual(await store.uow.run(owner, readOnly, tx => contents(store, tx)), []);
    peer.exec("COMMIT");
  } finally {
    peer.close();
  }
  await store.uow.run(owner, {}, tx => insert(store, tx, "after commit"));
  assert.deepEqual(await store.uow.run(owner, readOnly, tx => contents(store, tx)), ["uncommitted", "after commit"]);
});

test("normalizes numeric primary and extended busy codes and redacts unknown failures", () => {
  for (const errcode of [5, 6, 5 | (2 << 8), 6 | (1 << 8)]) {
    const error = toSqliteError({ code: "ERR_SQLITE_ERROR", errcode, message: "synthetic detail" });
    assert.ok(error instanceof CoreError);
    assert.equal(error.code, "storage_busy");
    assert.equal(error.kind, "retryable");
    assert.equal(error.retryable, true);
    assert.equal(error.message, "storage_busy");
  }
  for (const errcode of [19, -251, "5", NaN, undefined]) {
    const error = toSqliteError({ code: "ERR_SQLITE_ERROR", errcode, message: "synthetic detail" });
    assert.equal(error.message, "internal_error");
    assert.equal(error.kind, "internal");
  }
  const existing = new CoreError("revision_conflict");
  assert.equal(toSqliteError(existing), existing);
});

test("rolls back a caught or unawaited failed write and preserves the first failure", async t => {
  const store = fixture(t);
  for (const observeFailure of [true, false]) {
    const first = new CoreError("revision_conflict");
    await assert.rejects(store.uow.run(owner, {}, async tx => {
      await insert(store, tx, "before failure");
      const failed = store.port(tx, owner, write, db => {
        db.prepare("INSERT INTO test_rows(owner, content) VALUES (?, ?)").run(owner, "partial port write");
        throw first;
      });
      if (observeFailure) await assert.rejects(failed, error => error === first);
      await assert.rejects(insert(store, tx, "before failure"), { code: "internal_error", message: "internal_error" });
      await insert(store, tx, "after failure");
    }), error => error === first);
    assert.deepEqual(await store.uow.run(owner, readOnly, tx => contents(store, tx)), []);
  }
});

test("refuses further statements after SQLite automatically rolls the transaction back", async t => {
  const store = fixture(t);
  await assert.rejects(store.uow.run(owner, {}, async tx => {
    await insert(store, tx, "duplicate");
    await assert.rejects(store.port(tx, owner, write, db => db.prepare(
      "INSERT OR ROLLBACK INTO test_rows(owner, content) VALUES (?, ?)"
    ).run(owner, "duplicate")), { code: "internal_error" });
    await assert.rejects(store.port(tx, owner, write, () => assert.fail("autocommit write")), { code: "internal_error" });
  }), { code: "internal_error" });
  assert.deepEqual(await store.uow.run(owner, readOnly, tx => contents(store, tx)), []);
  await store.uow.run(owner, {}, tx => insert(store, tx, "fresh run"));
});

test("rolls back when a deferred foreign key fails at commit", async t => {
  const store = fixture(t);
  await store.uow.run(owner, {}, tx => store.port(tx, owner, write, db => db.exec(`
    CREATE TABLE children (parent INTEGER REFERENCES test_rows(id) DEFERRABLE INITIALLY DEFERRED);
  `)));
  await assert.rejects(store.uow.run(owner, {}, async tx => {
    await insert(store, tx, "before commit");
    await store.port(tx, owner, write, db => db.exec("INSERT INTO children VALUES (999)"));
  }), { code: "internal_error" });
  assert.deepEqual(await store.uow.run(owner, readOnly, tx => contents(store, tx)), []);
  await store.uow.run(owner, {}, tx => insert(store, tx, "after rollback"));
});

test("rejects a Tx in a foreign live run and refuses nested runs and shutdown", async t => {
  const store = fixture(t);
  const independent = fixture(t);
  const captured = Promise.withResolvers();
  const release = Promise.withResolvers();
  const writer = store.uow.run(owner, {}, async tx => {
    assert.equal(tx.__adapter, undefined);
    captured.resolve(tx);
    await release.promise;
    await insert(store, tx, "owned write");
  });
  try {
    const foreignTx = await Promise.race([captured.promise, writer]);
    await assert.rejects(insert(store, foreignTx, "foreign write"), { code: "internal_error" });
    await store.uow.run(owner, readOnly, async tx => {
      await assert.rejects(contents(store, foreignTx), { code: "internal_error" });
      await assert.rejects(contents(independent, tx), { code: "internal_error" });
      await assert.rejects(store.uow.run(owner, {}, () => assert.fail()), { code: "internal_error" });
      await assert.rejects(store.close(), { code: "internal_error" });
      // Even a port mislabeled as a read gets a native read-only connection.
      await assert.rejects(store.port(tx, owner, {}, db => db.exec("DELETE FROM test_rows")), { code: "internal_error" });
    });
  } finally {
    release.resolve();
    await writer;
  }
});

test("never invokes async port bodies or assimilates their returned thenables", async t => {
  const store = fixture(t);
  const outbound = t.mock.fn(() => "prepared input");
  const prepared = outbound();
  await store.uow.run(owner, {}, async tx => {
    await insert(store, tx, prepared);
    await assert.rejects(store.port(tx, owner, {}, async () => outbound()), { code: "internal_error" });
    await assert.rejects(store.port(tx, owner, {}, () => ({ then: outbound })), { code: "internal_error" });
    assert.deepEqual(await contents(store, tx), [prepared]);
  });
  assert.equal(outbound.mock.callCount(), 1);
});

test("source uses filesystem metadata only and leaves the database descriptors to SQLite", () => {
  const sourceDir = new URL("../src/", import.meta.url);
  const sources = readdirSync(sourceDir).filter(path => path.endsWith(".mjs"));
  for (const path of sources) {
    const source = readFileSync(new URL(path, sourceDir), "utf8");
    const fsImports = source.match(/^.*['"](?:node:)?fs(?:\/promises)?['"].*$/gm) ?? [];
    assert.deepEqual(fsImports, path === "uow.mjs" ? ['import { realpathSync, statSync } from "node:fs";'] : []);
    assert.doesNotMatch(source, /\b(?:openSync|closeSync|readFileSync|writeFileSync|createReadStream|createWriteStream|FileHandle|getBuiltinModule)\b/);
  }
});

test("drains accepted runs, closes both connections and allows reopening the file", async t => {
  const store = fixture(t);
  const alias = join(store.directory, "alias.sqlite");
  symlinkSync(store.filename, alias);
  assert.throws(() => openSqliteUnitOfWork(alias), { code: "storage_busy" });
  const release = Promise.withResolvers();
  const started = Promise.withResolvers();
  const first = store.uow.run(owner, {}, async tx => {
    started.resolve();
    await release.promise;
    await insert(store, tx, "first");
  });
  await Promise.race([started.promise, first]);
  const second = store.uow.run(owner, {}, tx => insert(store, tx, "second"));
  const closing = store.close();
  try {
    assert.equal(store.close(), closing);
    await assert.rejects(store.uow.run(owner, {}, () => assert.fail()), { code: "internal_error" });
    assert.throws(() => openSqliteUnitOfWork(alias), { code: "storage_busy" });
  } finally {
    release.resolve();
    await Promise.all([first, second, closing]);
  }
  const reopened = openSqliteUnitOfWork(alias);
  try {
    assert.deepEqual(await reopened.uow.run(owner, readOnly, tx => contents(reopened, tx)), ["first", "second"]);
  } finally {
    await reopened.close();
  }
});
