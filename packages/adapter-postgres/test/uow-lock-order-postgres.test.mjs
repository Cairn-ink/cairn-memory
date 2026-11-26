import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createPostgresUnitOfWork, query } from "../src/index.mjs";
import { migrationDatabase, migrationDbTest } from "./migration-database.mjs";

const owner = "lock-order-owner";
const capture = [owner, "client", "event"];
const selectCapture = `SELECT event_id FROM capture_events
  WHERE user_id = $1 AND client = $2 AND event_id = $3 FOR UPDATE`;
const insertFence = `INSERT INTO capture_raw_fences (user_id, client, session_id)
  VALUES ($1, $2, $3) RETURNING session_id`;

async function waitForBlock(pool, pids, waiter) {
  const finished = waiter.then(() => true, () => true);
  const deadline = performance.now() + 3_000;
  while (performance.now() < deadline) {
    const [holderPid, waiterPid] = pids;
    if (waiterPid !== undefined) {
      assert.notEqual(waiterPid, holderPid);
      // Inspect the blocker, the kind of lock the waiter needs, and whether it is
      // the owner key that older hosted writers also take. That key is a fixed
      // wire constant, so it is spelled out here rather than read from the adapter.
      const { rows } = await pool.query(`
        WITH k AS (SELECT hashtext('w3:' || $3)::bigint AS key)
        SELECT l.locktype, (l.classid::bigint = ((k.key >> 32) & 4294967295)
          AND l.objid::bigint = (k.key & 4294967295) AND l.objsubid = 1) AS owner_key
        FROM pg_locks l, k
        WHERE l.pid = $1 AND NOT l.granted AND $2::int = ANY(pg_blocking_pids($1))
      `, [waiterPid, holderPid, owner]);
      if (rows.length) return rows;
    }
    assert.equal(await Promise.race([finished, delay(20, false)]), false,
      "second writer finished without an observed lock wait");
  }
  assert.fail("Postgres did not report a lock wait behind the first writer");
}

for (const firstPauseLock of [true, false]) {
  test(`Postgres writes serialize on the owner lock with pauseLock=${firstPauseLock} starting first`,
    migrationDbTest, async (t) => {
      const { pool } = await migrationDatabase(t);
      await pool.query("INSERT INTO users (id) VALUES ($1)", [owner]);
      await pool.query(`INSERT INTO capture_events (user_id, client, event_id, session_id, raw_request, received_at)
        VALUES ($1, $2, $3, 'session', '{}', now())`, capture);

      const pids = [];
      const nativeErrors = [];
      const firstAtGate = Promise.withResolvers();
      const releaseFirst = Promise.withResolvers();
      const { run } = createPostgresUnitOfWork({
        async connect() {
          const client = await pool.connect();
          const first = pids.length === 0;
          pids.push(client.processID);
          return {
            async query(sql, values) {
              const result = await client.query(sql, values).catch((error) => {
                nativeErrors.push(error.code);
                throw error;
              });
              // Hold the first writer at its owner-lock reply so the second
              // prologue overlaps. Also hold at the row if it comes earlier.
              if (first && (sql.startsWith("SELECT pg_advisory_xact_lock(hashtext(") || sql === selectCapture)) {
                firstAtGate.resolve();
                await releaseFirst.promise;
              }
              return result;
            },
            release: (destroy) => client.release(destroy),
          };
        },
      });

      let secondEntered = false;
      const write = (pauseLock, session) => run(owner, { pauseLock }, async (tx) => {
        if (session === "second") secondEntered = true;
        const locked = await query(tx, selectCapture, capture);
        assert.deepEqual(locked.rows, [{ event_id: capture[2] }]);
        const inserted = await query(tx, insertFence, [owner, capture[1], session]);
        return inserted.rows[0].session_id;
      });

      const first = write(firstPauseLock, "first");
      const writers = [first];
      let outcomes;
      try {
        await Promise.race([firstAtGate.promise, first]);
        const second = write(!firstPauseLock, "second");
        writers.push(second);
        assert.deepEqual(await waitForBlock(pool, pids, second), [{ locktype: "advisory", owner_key: true }],
          "second writer must wait on the shared owner key before locking the capture row");
        assert.equal(secondEntered, false, "second writer entered its callback while the owner lock was held");
      } finally {
        releaseFirst.resolve();
        outcomes = await Promise.allSettled(writers);
      }

      assert.deepEqual(nativeErrors, [], "neither writer should see a native error such as 40P01");
      assert.deepEqual(outcomes, [
        { status: "fulfilled", value: "first" }, { status: "fulfilled", value: "second" },
      ], "both writers must commit without an adapter error such as storage_busy");
      const { rows } = await pool.query("SELECT session_id FROM capture_raw_fences WHERE user_id = $1 ORDER BY session_id", [owner]);
      assert.deepEqual(rows, [{ session_id: "first" }, { session_id: "second" }]);
    });
}
