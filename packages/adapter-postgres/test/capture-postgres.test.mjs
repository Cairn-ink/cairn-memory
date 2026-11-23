import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { factIncarnationBody } from "../../core/src/index.mjs";
import { createPostgresCapturePorts, createPostgresSuppressionStore, createPostgresUnitOfWork } from "../src/index.mjs";
import { migrationDatabase, migrationDbTest } from "./migration-database.mjs";

const owner = "capture-owner";
const otherOwner = "another-capture-owner";
const write = { pauseLock: true };
const read = { readOnly: true };
const options = { leaseMs: 60_000 };
const messages = [
  { id: "message", role: "user", content: "Capture one message.", occurredAtMs: 10 },
];
const event = {
  scope: { owner, namespace: null }, client: "client", eventId: "event", sessionId: "session",
  payloadDigest: "a".repeat(64),
};
const terminal = { code: "invalid_input", retryable: false };

async function database(t, captureOptions) {
  const { pool } = await migrationDatabase(t);
  await pool.query("INSERT INTO users (id) VALUES ($1), ($2)", [owner, otherOwner]);
  const backends = [];
  const uow = createPostgresUnitOfWork({
    async connect() {
      const client = await pool.connect();
      backends.push(client.processID);
      return {
        query: (sql, params) => client.query(sql, params),
        release: (destroy) => client.release(destroy),
      };
    },
  });
  return { pool, uow, backends, capture: createPostgresCapturePorts(captureOptions) };
}

function holdWrite(uow, operation) {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const done = uow.run(owner, write, async (tx) => {
    const result = await operation(tx);
    entered.resolve(result);
    await release.promise;
    return result;
  });
  return { ready: Promise.race([entered.promise, done]), done, release: release.resolve };
}

async function waitForBlock(pool, backends, offset, waiter) {
  const settled = waiter.then(() => true, () => true);
  const deadline = performance.now() + 3_000;
  while (performance.now() < deadline) {
    const [holder, waiting] = backends.slice(offset);
    if (waiting) {
      assert.notEqual(holder, waiting);
      const { rows: [{ blocked }] } = await pool.query(
        "SELECT $2::int = ANY(pg_blocking_pids($1)) AS blocked", [waiting, holder],
      );
      if (blocked) return;
    }
    if (await Promise.race([settled, delay(20, false)])) assert.fail("contender completed while the first write held its lock");
  }
  assert.fail("Postgres did not report the expected lock wait");
}

test("capture concurrency gives two connections exactly one lease for an identity", migrationDbTest, async (t) => {
  const { pool, uow, capture, backends } = await database(t);
  const claim = (tx) => capture.claim(tx, event, messages, options);
  const holder = holdWrite(uow, claim);
  let waiter;
  try {
    const first = await holder.ready;
    assert.equal(first.status, "claimed");
    waiter = uow.run(owner, write, claim);
    await waitForBlock(pool, backends, 0, waiter);
    holder.release();
    assert.deepEqual(await waiter, { status: "processing" });
    const { rows } = await pool.query("SELECT core_lease_token FROM capture_events WHERE user_id = $1", [owner]);
    assert.deepEqual(rows, [{ core_lease_token: first.token }]);
  } finally {
    holder.release();
    await Promise.allSettled([holder.done, waiter]);
  }
});

test("admission concurrency keeps the first outbox and rejects a changed digest", migrationDbTest, async (t) => {
  const { pool, uow, capture, backends } = await database(t);
  const holder = holdWrite(uow, (tx) => capture.admit(tx, event, messages));
  const conflict = { ...event, payloadDigest: "b".repeat(64) };
  let waiter;
  try {
    assert.deepEqual(await holder.ready, { status: "admitted" });
    waiter = uow.run(owner, write, (tx) => capture.admit(tx, conflict, [{ ...messages[0], content: "" }]));
    const rejected = assert.rejects(waiter, { code: "event_payload_conflict" });
    await waitForBlock(pool, backends, 0, waiter);
    holder.release();
    await rejected;
    assert.deepEqual(await uow.run(owner, read, (tx) => capture.load(tx, event)), { key: event, messages });
    await assert.rejects(uow.run(owner, write, (tx) => capture.claim(tx, conflict, messages, options)),
      { code: "event_payload_conflict" });
  } finally {
    holder.release();
    await Promise.allSettled([holder.done, waiter]);
  }
});

test("different owners admit and claim the same identity without waiting or sharing rows", migrationDbTest, async (t) => {
  const { uow, capture, backends } = await database(t);
  const other = { ...event, scope: { owner: otherOwner, namespace: null } };
  const fresh = (key) => async (tx) => {
    assert.deepEqual(await capture.admit(tx, key, messages), { status: "admitted" });
    return capture.claim(tx, key, messages, options);
  };
  const holder = holdWrite(uow, fresh(event));
  let otherWrite;
  try {
    const first = await holder.ready;
    otherWrite = uow.run(otherOwner, write, fresh(other));
    const second = await otherWrite;
    assert.equal(second.status, "claimed");
    assert.notEqual(backends[0], backends[1]);
    assert.notEqual(first.token, second.token);
    await assert.rejects(uow.run(otherOwner, write, (tx) => capture.beginDispatch(tx, first.token)),
      { code: "stale_admission" });
  } finally {
    holder.release();
    await Promise.allSettled([holder.done, otherWrite]);
  }
  const privateKey = { ...event, eventId: "private" };
  await uow.run(owner, write, (tx) => capture.admit(tx, privateKey, messages));
  await uow.run(otherOwner, read, async (tx) => {
    assert.equal(await capture.load(tx, { ...privateKey, scope: other.scope }), null);
    assert.deepEqual(await capture.status(tx, other.scope, privateKey.eventId), { status: "unknown" });
    await assert.rejects(capture.load(tx, privateKey), { code: "internal_error" });
  });
  await assert.rejects(uow.run(otherOwner, write, (tx) => capture.claim(tx, privateKey, messages, options)),
    { code: "internal_error" });
  const otherPrivate = { ...privateKey, scope: other.scope };
  const isolated = await uow.run(otherOwner, write, (tx) => capture.claim(tx, otherPrivate, messages, options));
  assert.equal(isolated.status, "claimed");
});

test("dispatch, lease expiry, abandon retries and rollback keep token ownership", migrationDbTest, async (t) => {
  let now = 1;
  const { uow, capture } = await database(t, { now: () => now });
  const claim = (tx) => capture.claim(tx, event, messages, options);
  const first = await uow.run(owner, write, claim);
  assert.equal(first.status, "claimed");
  const dispatch = (tx) => capture.beginDispatch(tx, first.token);
  const abandon = (tx) => capture.abandon(tx, first.token, { code: "storage_error", retryable: true });
  for (const command of [claim, dispatch, abandon]) {
    await assert.rejects(uow.run(owner, {}, command), { code: "internal_error" });
    await assert.rejects(uow.run(owner, { ...write, ...read }, command), { code: "internal_error" });
  }
  assert.deepEqual(await uow.run(owner, write, dispatch), { token: first.token });
  assert.deepEqual(await uow.run(owner, write, dispatch), { token: first.token });
  await assert.rejects(uow.run(owner, write, async (tx) => {
    await abandon(tx);
    await assert.rejects(dispatch(tx), { code: "stale_admission" });
  }), { code: "stale_admission" });
  assert.deepEqual(await uow.run(owner, write, dispatch), { token: first.token });
  await uow.run(owner, write, abandon);
  const second = await uow.run(owner, write, claim);
  assert.equal(second.status, "claimed");
  assert.notEqual(first.token, second.token);
  await uow.run(owner, write, (tx) => capture.abandon(tx, first.token, terminal));
  assert.deepEqual(await uow.run(owner, write, claim), { status: "processing" });
  now += options.leaseMs;
  const third = await uow.run(owner, write, claim);
  assert.equal(third.status, "claimed");
  assert.notEqual(third.token, second.token);
  await assert.rejects(uow.run(owner, write, (tx) => capture.abandon(tx, second.token, terminal)),
    { code: "stale_admission" });
  await uow.run(owner, write, (tx) => capture.abandon(tx, third.token, terminal));
  assert.deepEqual(await uow.run(owner, write, claim), { status: "duplicate" });
});

test("admission status is read-only and ranks pending, failed, then done", migrationDbTest, async (t) => {
  const { pool, uow, capture } = await database(t);
  const done = { ...event, client: "done" };
  const failed = { ...event, client: "failed" };
  const pending = { ...event, client: "pending" };
  const admit = (key, batch = messages) => uow.run(owner, write, (tx) => capture.admit(tx, key, batch));
  const status = (client) => uow.run(owner, read, (tx) => capture.status(tx, event.scope, event.eventId, client));
  const dump = async () => (await pool.query(`
    SELECT to_jsonb(e) AS row, xmin::text AS version FROM capture_events e WHERE user_id = $1 ORDER BY client
  `, [owner])).rows;
  assert.deepEqual(await status(), { status: "unknown" });
  await admit(done);
  // A stored result represents a finish committed by the writer.
  const result = { indexRevision: 3, memories: [], suppressedCount: 0, duplicateCount: 0, counters: {} };
  await pool.query("UPDATE capture_events SET status = 'completed', core_result = $3 WHERE user_id = $1 AND client = $2",
    [owner, done.client, result]);
  assert.deepEqual(await status(), { status: "done" });
  const replay = await admit(done);
  replay.result.memories.push({ id: "modified" });
  assert.deepEqual(await uow.run(owner, write, (tx) => capture.claim(tx, done, messages, options)),
    { status: "rawReplay", result });
  await admit(failed);
  await uow.run(owner, write, async (tx) => {
    const { token } = await capture.claim(tx, failed, messages, options);
    await capture.abandon(tx, token, { ...terminal, message: "Discard this private detail." });
  });
  const codeOnly = { status: "failed", code: terminal.code };
  assert.deepEqual(await status(), codeOnly);
  const withheld = [{ ...messages[0], id: "free\u0000form\ud800", content: "" }];
  await admit(pending, withheld);
  await uow.run(owner, write, async (tx) => {
    assert.deepEqual(await capture.load(tx, pending), { key: pending, messages: withheld });
    const { token } = await capture.claim(tx, pending, withheld, options);
    await capture.abandon(tx, token, { code: "storage_error", retryable: true });
  });
  const before = await dump();
  assert.deepEqual(await status(), { status: "pending" });
  assert.deepEqual(await status(pending.client), { status: "pending" });
  assert.deepEqual(await status(failed.client), codeOnly);
  assert.deepEqual(await status(done.client), { status: "done" });
  assert.deepEqual(await dump(), before);
});

test("source filter rechecks admitted times and requires both MACs for a fork", migrationDbTest, async (t) => {
  const secret = randomBytes(32).toString("hex");
  const { pool, uow, capture } = await database(t, { lineageSecret: secret });
  const original = "fenced-session";
  const message = messages[0];
  const mac = (value) => createHmac("sha256", secret).update(value).digest("hex");
  const messageMac = mac(message.id);
  const contentMac = mac("\0cairn:raw-lineage-content:" +
    JSON.stringify([owner, event.client, message.id, message.content]));
  await pool.query("INSERT INTO capture_raw_fences (user_id, client, session_id) VALUES ($1, $2, $3)",
    [owner, event.client, original]);
  await pool.query(`INSERT INTO capture_raw_lineage (user_id, client, session_id, message_mac, content_mac)
    VALUES ($1, $2, $3, $4, NULL), ($1, $2, $3, $5, $6)`,
  [owner, event.client, original, messageMac, mac("another-id"), contentMac]);
  const eligible = (batch, key = event) => uow.run(owner, read, (tx) => capture.eligible(tx, key, batch));
  const seedFact = (fact) => {
    const incarnation = createHash("sha256").update(factIncarnationBody(fact)).digest("hex");
    return uow.run(owner, write, (tx) => createPostgresSuppressionStore().writeFact(tx, fact, incarnation));
  };
  const value = createHash("sha256").update(message.content).digest("hex");
  await seedFact({ owner, actionId: "text", origin: "forget", kind: "text", mode: "exact",
    text: { digests: [{ alg: "sha256", value, pipeline: "core", redactionVersion: 1, keyId: null }] } });
  assert.deepEqual(await eligible(messages, { ...event, sessionId: original }), []);
  assert.deepEqual(await eligible(messages), [0]);
  await uow.run(owner, write, async (tx) => {
    await capture.admit(tx, event, messages);
    await capture.claim(tx, event, [{ ...message, occurredAtMs: 20 }], options);
  });
  await seedFact({ owner, actionId: "window", origin: "forget", kind: "window", client: event.client,
    window: { startMs: 10, endMs: 20 } });
  const recheck = (positions) => uow.run(owner, {}, (tx) => capture.assertEligible(tx, event, positions));
  await assert.rejects(recheck([0]), { code: "suppressed" });
  assert.deepEqual(await eligible([{ ...message, occurredAtMs: 20 }]), [0]);

  await pool.query(`INSERT INTO capture_raw_lineage (user_id, client, session_id, message_mac, content_mac)
    VALUES ($1, $2, $3, $4, $5)`, [owner, event.client, original, messageMac, contentMac]);
  assert.deepEqual(await eligible([{ ...message, occurredAtMs: 20 }]), []);
  assert.deepEqual(await eligible([{ ...message, content: "Different", occurredAtMs: 20 }]), [0]);
  await assert.rejects(recheck([]), { code: "lineage_fenced" });
  const unkeyed = createPostgresCapturePorts();
  assert.deepEqual(await uow.run(owner, read, (tx) => unkeyed.eligible(tx, event, [{ ...message, occurredAtMs: 20 }])), []);
});

test("legacy capture rows reserve identity without being changed or loaded as a new outbox", migrationDbTest, async (t) => {
  const { pool, uow, capture } = await database(t);
  const raw = { client: event.client, event_id: event.eventId, session_id: event.sessionId, messages: [] };
  const { rows: before } = await pool.query(`INSERT INTO capture_events
    (user_id, client, event_id, session_id, received_at, raw_request)
    VALUES ($1, $2, $3, $4, clock_timestamp(), $5) RETURNING *`,
  [owner, event.client, event.eventId, event.sessionId, raw]);
  await assert.rejects(uow.run(owner, write, (tx) => capture.admit(tx, event, messages)), { code: "event_payload_conflict" });
  await assert.rejects(uow.run(owner, write, (tx) => capture.claim(tx, event, messages, options)),
    { code: "event_payload_conflict" });
  assert.equal(await uow.run(owner, read, (tx) => capture.load(tx, event)), null);
  assert.deepEqual((await pool.query("SELECT * FROM capture_events WHERE user_id = $1", [owner])).rows, before);
});
