import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  LOCAL_LOCK_TIMEOUT, LOCAL_STATEMENT_TIMEOUT, LOCK_TIMEOUT, READ_BEGIN, READ_START_BATCH, WRITE_START_BATCH,
} from "../src/statement-batches.mjs";
import { createPostgresUnitOfWork, query } from "../src/uow.mjs";

const owner = "lock-order-owner";
const selectCapture = "SELECT event_id FROM capture_events WHERE user_id = $1 FOR UPDATE";
const insertFence = "INSERT INTO capture_raw_fences (user_id, client, session_id) VALUES ($1, $2, $3)";
const readTimeout = "SELECT current_setting('lock_timeout') AS value";
const restoreTimeout = "SELECT set_config('lock_timeout', $1, false)";

// The advisory lock SQL is private to the module. Read its declarations so
// the expected SQL is independent of which statements run() actually sends.
const uowSource = readFileSync(new URL("../src/uow.mjs", import.meta.url), "utf8");
function privateSql(name) {
  const match = uowSource.match(new RegExp("^const " + name + " = ([\"`])(.+)\\1;$", "m"));
  assert.ok(match, `Missing SQL declaration for ${name}`);
  return match[2];
}
const pauseKey = privateSql("PAUSE_LOCK_KEY");
const pauseSql = (name) => privateSql(name).replace("${PAUSE_LOCK_KEY}", pauseKey);
const pause = [pauseSql("PAUSE_LOCK"), [owner]];
const sharedPause = [pauseSql("SHARED_PAUSE_LOCK"), [owner]];
const sharedUnlock = [pauseSql("SHARED_PAUSE_UNLOCK"), [owner]];
const ownerLock = [privateSql("OWNER_LOCK"), [owner]];

function recordingRun(batched) {
  const statements = [];
  const connection = {
    async query(...args) {
      statements.push(args);
      const [sql] = args;
      const value = sql === readTimeout ? "0" : true;
      return { command: sql.split(" ", 1)[0], rows: [{ value }] };
    },
    async release() {},
  };
  if (batched) {
    connection.queryBatch = async (sql) => {
      statements.push(["batch", sql]);
      return sql.split("; ").map((statement) => ({ command: statement.split(" ", 1)[0], rows: [] }));
    };
  }
  const { run } = createPostgresUnitOfWork({ connect: async () => connection });
  return { run, statements };
}

for (const batched of [false, true]) {
  const transport = batched ? "batched" : "unbatched";
  const localSettings = [[LOCAL_LOCK_TIMEOUT], [LOCAL_STATEMENT_TIMEOUT]];
  const writeStart = batched ? [["batch", WRITE_START_BATCH]] : [["BEGIN"], ...localSettings];
  const readStart = batched ? [["batch", READ_START_BATCH]] : [[READ_BEGIN], ...localSettings];

  for (const pauseLock of [false, true]) {
    test(`${transport} write with pauseLock=${pauseLock} takes owner locks before callback SQL`, async () => {
      const { run, statements } = recordingRun(batched);
      const rowLock = [selectCapture, [owner]];
      const insert = [insertFence, [owner, "client", "session"]];
      await run(owner, { pauseLock }, async (tx) => {
        await query(tx, ...rowLock);
        await query(tx, ...insert);
      });
      assert.deepEqual(statements, [
        ...writeStart, ...(pauseLock ? [pause] : []), ownerLock, rowLock, insert, ["COMMIT"], ["DISCARD ALL"],
      ]);
    });

    test(`${transport} read with pauseLock=${pauseLock} takes no owner write lock`, async () => {
      const { run, statements } = recordingRun(batched);
      const read = ["SELECT $1", [owner]];
      await run(owner, { readOnly: true, pauseLock }, (tx) => query(tx, ...read));
      assert.deepEqual(statements, [
        ...(pauseLock ? [[readTimeout], [`SET lock_timeout = '${LOCK_TIMEOUT}'`], sharedPause, [restoreTimeout, ["0"]]] : []),
        ...readStart, read, ["COMMIT"], ...(pauseLock ? [sharedUnlock] : []), ["DISCARD ALL"],
      ]);
    });
  }
}
