import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { CoreError } from "../../core/src/index.mjs";
import { createPostgresUnitOfWork, query } from "../src/index.mjs";

const url = process.env.CORE_PG_TEST_URL;
const options = { skip: !url, timeout: 15_000 };
const owner = "same-owner";

function database(t, max) {
  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 3_000, max });
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

test("Postgres read runs leave no advisory locks on their backends", options, async (t) => {
  const { pool, pids, uow } = database(t);
  const readOptions = { readOnly: true, pauseLock: true };
  const { rows: [{ pid }] } = await uow.run(owner, readOptions, (tx) => query(tx, "SELECT pg_backend_pid() AS pid"));
  assert.equal(pid, pids[0]);

  const advisoryLocks = "SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND pid = $1";
  const reused = await pool.connect();
  try {
    assert.equal(reused.processID, pid);
    assert.deepEqual((await reused.query(advisoryLocks, [pid])).rows, []);
  } finally {
    reused.release();
  }

  const error = await uow.run(owner, readOptions, (tx) => query(tx,
    "SELECT pg_advisory_lock(hashtextextended(current_database(), 0))",
  )).then(() => undefined, (failure) => failure);
  assert.deepEqual((await pool.query(advisoryLocks, [pids[1]])).rows, []);
  assert.ok(error instanceof CoreError);
  assert.equal(error.code, "internal_error");
});

test("Postgres resets session locks and settings before reusing a read connection", options, async (t) => {
  const { pool, uow } = database(t, 1);
  const { rows: [defaults] } = await pool.query("SHOW application_name");
  const advisoryLocks = "SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()";

  // Use the driver checkout directly to exercise the reset independently of the SQL lint.
  let raw;
  pool.once("acquire", (client) => { raw = client; });
  await uow.run(owner, { readOnly: true }, async () => {
    await raw.query("SELECT pg_advisory_lock(hashtextextended(current_database(), 0))");
    await raw.query("SET application_name = 'adapter_test_changed'");
    assert.deepEqual((await raw.query(advisoryLocks)).rows, [{ pid: raw.processID }]);
    assert.deepEqual((await raw.query("SHOW application_name")).rows, [{ application_name: "adapter_test_changed" }]);
  });

  const reused = await pool.connect();
  try {
    assert.equal(reused.processID, raw.processID);
    assert.deepEqual({
      locks: (await reused.query(advisoryLocks)).rows,
      settings: (await reused.query("SHOW application_name")).rows,
    }, { locks: [], settings: [defaults] });
  } finally {
    reused.release();
  }
});

test("Postgres discards write session state before reusing the same backend", options, async (t) => {
  const { pool, uow } = database(t, 1);
  const sessionState = `
    SELECT pg_backend_pid() AS pid,
      to_regclass('pg_temp.adapter_test_table') IS NOT NULL AS has_temp_table,
      ARRAY(SELECT name FROM pg_prepared_statements ORDER BY name) AS prepared,
      ARRAY(SELECT name FROM pg_cursors ORDER BY name) AS cursors,
      ARRAY(SELECT pg_listening_channels()) AS channels,
      current_user::text AS current_role,
      session_user::text AS login_role,
      (SELECT count(*)::int FROM pg_locks
        WHERE locktype = 'advisory' AND pid = pg_backend_pid()) AS advisory_locks,
      current_setting('application_name') AS application_name
  `;
  const { rows: [defaults] } = await pool.query(sessionState);
  const role = `adapter_test_${randomUUID().replaceAll("-", "")}`;
  await pool.query(`CREATE ROLE ${role}`);
  try {
    await pool.query(`GRANT ${role} TO CURRENT_USER`);
    const { rows: [during] } = await uow.run(owner, {}, async (tx) => {
      await query(tx, "CREATE TEMP TABLE adapter_test_table (value int)");
      await query(tx, "PREPARE adapter_test_statement AS SELECT 1");
      await query(tx, "DECLARE adapter_test_cursor CURSOR WITH HOLD FOR SELECT 1");
      await query(tx, "LISTEN adapter_test_channel");
      await query(tx, `SET ROLE ${role}`);
      await query(tx, "SELECT pg_advisory_lock(1, 2)");
      await query(tx, "SET application_name = 'adapter_test_changed'");
      return query(tx, sessionState);
    });
    // LISTEN takes effect at commit. Both the owner lock and session lock are held during the run.
    assert.deepEqual(during, {
      pid: defaults.pid,
      has_temp_table: true,
      prepared: ["adapter_test_statement"],
      cursors: ["adapter_test_cursor"],
      channels: [],
      current_role: role,
      login_role: defaults.login_role,
      advisory_locks: 2,
      application_name: "adapter_test_changed",
    });

    const { rows: [after] } = await pool.query(sessionState);
    assert.equal(after.pid, during.pid);
    assert.deepEqual(after, {
      pid: during.pid,
      has_temp_table: false,
      prepared: [],
      cursors: [],
      channels: [],
      current_role: after.login_role,
      login_role: defaults.login_role,
      advisory_locks: 0,
      application_name: defaults.application_name,
    });
  } finally {
    await pool.query("RESET ROLE");
    await pool.query(`DROP ROLE ${role}`);
  }
});
