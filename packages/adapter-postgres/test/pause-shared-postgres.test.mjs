import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { CoreError } from "../../core/src/index.mjs";
import { createPostgresUnitOfWork, query } from "../src/index.mjs";
import { migrationDatabase, migrationDbTest } from "./migration-database.mjs";

const owner = "pause-owner";
const readOptions = { readOnly: true, pauseLock: true };
const writeOptions = { pauseLock: true };
const lockModes = "SELECT mode FROM pg_locks WHERE locktype = 'advisory' AND pid = $1";

async function database(t, intercept) {
  const { pool } = await migrationDatabase(t);
  const checkouts = [];
  const { run } = createPostgresUnitOfWork({
    async connect() {
      const client = await pool.connect();
      const checkout = {
        pid: client.processID,
        closed: new Promise((resolve) => client.once("end", resolve)),
      };
      checkouts.push(checkout);
      return {
        async query(sql, values) {
          const result = await intercept?.(client, sql);
          return result ?? client.query(sql, values);
        },
        release(destroy) {
          checkout.discarded = destroy === true;
          client.release(destroy);
        },
      };
    },
  });
  return { pool, run, checkouts };
}

function holdRun(run, options, setup = async () => {}) {
  const entered = Promise.withResolvers();
  const leave = Promise.withResolvers();
  const done = run(owner, options, async (tx) => {
    await setup(tx);
    entered.resolve();
    await leave.promise;
  });
  return { ready: Promise.race([entered.promise, done]), leave: leave.resolve, done };
}

async function waitForBlock({ pool, checkouts }, waiter) {
  const finished = waiter.then(() => true, () => true);
  const deadline = performance.now() + 3_000;
  while (performance.now() < deadline) {
    const [holder, waiting] = checkouts;
    if (waiting) {
      const { rows: [{ blocked }] } = await pool.query(
        "SELECT $2::int = ANY(pg_blocking_pids($1)) AS blocked", [waiting.pid, holder.pid],
      );
      if (blocked) return;
    }
    if (await Promise.race([finished, delay(20, false)])) {
      assert.fail("contending run finished without waiting on the pause lock");
    }
  }
  assert.fail("Postgres did not report the expected pause lock wait");
}

async function assertDiscarded({ pool, checkouts }, index = 0) {
  const { pid, closed, discarded } = checkouts[index];
  assert.equal(discarded, true);
  await closed;
  assert.deepEqual((await pool.query(lockModes, [pid])).rows, []);
}

test("Postgres pause writer waits for a read-only pause run to end", migrationDbTest, async (t) => {
  const db = await database(t);
  const reader = holdRun(db.run, readOptions);
  let writer;
  let writerEntered = false;
  try {
    await reader.ready;
    writer = db.run(owner, writeOptions, async () => { writerEntered = true; });
    await waitForBlock(db, writer);
    assert.equal(writerEntered, false);
  } finally {
    reader.leave();
    await Promise.all([reader.done, writer]);
  }
  assert.equal(writerEntered, true);
});

test("Postgres grants overlapping read-only pause runs shared locks", migrationDbTest, async (t) => {
  const { pool, run, checkouts } = await database(t);
  const reader = holdRun(run, readOptions);
  try {
    await reader.ready;
    await run(owner, readOptions, async () => {
      const [first, second] = checkouts;
      assert.notEqual(first.pid, second.pid);
      const { rows } = await pool.query(`
        SELECT mode, granted FROM pg_locks
        WHERE locktype = 'advisory' AND pid IN ($1, $2)
      `, [first.pid, second.pid]);
      assert.deepEqual(rows, [
        { mode: "ShareLock", granted: true },
        { mode: "ShareLock", granted: true },
      ]);
    });
  } finally {
    reader.leave();
    await reader.done;
  }
});

test("Postgres takes the reader snapshot after the waiting pause lock is granted", migrationDbTest, async (t) => {
  const db = await database(t);
  await db.pool.query("INSERT INTO users (id) VALUES ($1)", [owner]);
  const writer = holdRun(db.run, writeOptions, (tx) => query(tx,
    "INSERT INTO memory_pause (user_id, paused, generation) VALUES ($1, true, 1)", [owner],
  ));
  let reader;
  try {
    await writer.ready;
    reader = db.run(owner, readOptions, (tx) => query(tx,
      "SELECT paused, generation FROM memory_pause WHERE user_id = $1", [owner],
    ));
    await waitForBlock(db, reader);
  } finally {
    writer.leave();
    await Promise.all([writer.done, reader]);
  }
  assert.deepEqual((await reader).rows, [{ paused: true, generation: 1 }]);
});

test("Postgres unlocks before session reset and reuses the reader backend after commit", migrationDbTest, async (t) => {
  let locksBeforeReset;
  const { pool, run, checkouts } = await database(t, async (client, sql) => {
    if (sql === "DISCARD ALL") locksBeforeReset = (await client.query(lockModes, [client.processID])).rows;
  });
  await run(owner, readOptions, async () => {});
  assert.deepEqual(locksBeforeReset, []);
  assert.equal(checkouts[0].discarded, false);

  const reused = await pool.connect();
  try {
    assert.equal(reused.processID, checkouts[0].pid);
    assert.deepEqual((await reused.query(lockModes, [reused.processID])).rows, []);
  } finally {
    reused.release();
  }
});

for (const [label, code, fn] of [
  ["a rolled-back statement failure", "internal_error", async (tx) => {
    await assert.rejects(query(tx, "SELECT 1 / 0"), { code: "internal_error" });
  }],
  ["a callback throw", "capture_paused", async () => { throw new CoreError("capture_paused"); }],
]) {
  test(`Postgres leaves no pause lock after ${label}`, migrationDbTest, async (t) => {
    const db = await database(t);
    await assert.rejects(db.run(owner, readOptions, fn), { code });
    await assertDiscarded(db);
  });
}

for (const [label, failUnlock] of [
  ["returns false", () => ({ command: "SELECT", rows: [{ value: false }] })],
  ["throws", () => { throw new Error("unlock failed"); }],
]) {
  test(`Postgres discards a committed reader backend if unlock ${label}`, migrationDbTest, async (t) => {
    const db = await database(t, (_client, sql) => {
      if (sql.startsWith("SELECT pg_advisory_unlock_shared(")) return failUnlock();
    });
    assert.equal(await db.run(owner, readOptions, async () => "committed"), "committed");
    await assertDiscarded(db);
  });
}

test("Postgres maps a shared pause lock timeout and leaves no reader lock", migrationDbTest, async (t) => {
  const db = await database(t);
  const writer = holdRun(db.run, writeOptions);
  try {
    await writer.ready;
    const started = performance.now();
    await assert.rejects(
      db.run(owner, readOptions, async () => assert.fail("blocked reader entered the callback")),
      (error) => {
        assert.ok(error instanceof CoreError);
        assert.equal(error.code, "lock_timeout");
        assert.equal(error.message, "lock_timeout");
        assert.equal(error.cause, undefined);
        assert.equal(error.retryable, true);
        return true;
      },
    );
    assert.ok(performance.now() - started >= 5_000, "the lock wait ended before five seconds");
    await assertDiscarded(db, 1);
  } finally {
    writer.leave();
    await writer.done;
  }
});
