import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { CoreError } from "../../core/src/index.mjs";
import { createPostgresUnitOfWork, query } from "../src/index.mjs";

const url = process.env.CORE_PG_TEST_URL;
const options = { skip: !url, timeout: 15_000 };
const owner = "same-owner";

function database(t) {
  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 3_000 });
  t.after(() => pool.end());
  const pids = [];
  const uow = createPostgresUnitOfWork({
    async connect() {
      const client = await pool.connect();
      pids.push(client.processID);
      return {
        async query(sql, values) {
          const { rows, rowCount, command } = await client.query(sql, values);
          return { rows, rowCount: rowCount ?? undefined, command };
        },
        release: (destroy) => client.release(destroy),
      };
    },
  });
  return { pool, pids, uow };
}

async function withHeldWriter(uow, check) {
  const entered = Promise.withResolvers();
  const unlocked = Promise.withResolvers();
  const holder = uow.run(owner, {}, async () => {
    entered.resolve();
    await unlocked.promise;
  });
  try {
    await Promise.race([entered.promise, holder]);
    await check(unlocked.resolve);
  } finally {
    unlocked.resolve();
    await holder;
  }
}

async function waitForBlock({ pids, pool }) {
  const deadline = performance.now() + 3_000;
  while (performance.now() < deadline) {
    const [holder, waiter] = pids;
    if (waiter) {
      const { rows: [state] } = await pool.query(
        "SELECT $2::int = ANY(pg_blocking_pids($1)) AS blocked",
        [waiter, holder],
      );
      if (state.blocked) return waiter;
    }
    await delay(20);
  }
  assert.fail("writer did not block behind the held owner lock");
}

test("Postgres serializes concurrent writes for the same owner", options, async (t) => {
  const db = database(t);
  await withHeldWriter(db.uow, async (unlock) => {
    let entered = false;
    const waiter = db.uow.run(owner, {}, async () => { entered = true; });
    // The cleanup below awaits the original promise even if observation fails.
    waiter.catch(() => {});
    try {
      await waitForBlock(db);
      assert.equal(entered, false);
    } finally {
      unlock();
      await waiter;
    }
    assert.equal(entered, true);
  });
});

test("Postgres allows different owners to write concurrently", options, async (t) => {
  const { uow } = database(t);
  await withHeldWriter(uow, async () => {
    const result = await uow.run("other-owner", {}, (tx) => query(tx, "SELECT 1 AS value"));
    assert.deepEqual(result.rows, [{ value: 1 }]);
  });
});

test("Postgres grants the pause lock before waiting on the plain owner lock", options, async (t) => {
  const db = database(t);
  await withHeldWriter(db.uow, async (unlock) => {
    const waiter = db.uow.run(owner, { pauseLock: true }, async () => {});
    waiter.catch(() => {});
    try {
      const pid = await waitForBlock(db);
      const { rows } = await db.pool.query(`
        SELECT waiting.granted, waiting.classid = held.classid AND waiting.objid = held.objid
          AND waiting.objsubid = held.objsubid AS owner_lock
        FROM pg_locks waiting
        CROSS JOIN pg_locks held
        WHERE waiting.locktype = 'advisory' AND waiting.pid = $1
          AND held.locktype = 'advisory' AND held.granted AND held.pid = $2
        ORDER BY waiting.granted DESC
      `, [pid, db.pids[0]]);
      assert.deepEqual(rows, [
        { granted: true, owner_lock: false },
        { granted: false, owner_lock: true },
      ]);
    } finally {
      unlock();
      await waiter;
    }
  });
});

test("Postgres lock timeout surfaces as a code-only lock_timeout", options, async (t) => {
  const { uow } = database(t);
  await withHeldWriter(uow, async () => {
    await assert.rejects(
      uow.run(owner, {}, async () => assert.fail("blocked writer entered the callback")),
      (error) => {
        assert.ok(error instanceof CoreError);
        assert.equal(error.code, "lock_timeout");
        assert.equal(error.message, "lock_timeout");
        assert.equal(error.cause, undefined);
        assert.equal(error.retryable, true);
        return true;
      },
    );
  });
});
