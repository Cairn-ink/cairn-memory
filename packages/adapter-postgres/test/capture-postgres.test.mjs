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

async function database(t, captureOptions, afterQuery) {
  const { pool } = await migrationDatabase(t);
  await pool.query("INSERT INTO users (id) VALUES ($1), ($2)", [owner, otherOwner]);
  const backends = [];
  const uow = createPostgresUnitOfWork({
    async connect() {
      const client = await pool.connect();
      backends.push(client.processID);
      return {
        async query(sql, params) {
          const result = await client.query(sql, params);
          afterQuery?.(sql);
          return result;
        },
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
  [owner, event.client, original, mac("id-only"), mac("another-id"), contentMac]);
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

for (const [legacyState, ledgerState, retryStatus, eventStatus] of [
  ["completed", "completed", "duplicate", "done"],
  ["pending", "pending", "processing", "pending"],
  ["queued", "queued", "processing", "pending"],
  ["failed", "queued", "duplicate", "failed"],
]) {
  test(`legacy retry preserves a ${legacyState} capture`, migrationDbTest, async (t) => {
    const { pool, uow, capture } = await database(t);
    const key = { ...event, eventId: "capture-event" };
    const raw = { client: key.client, event_id: key.eventId, session_id: key.sessionId,
      messages: [{ id: messages[0].id, role: messages[0].role, content: messages[0].content }] };
    const { rows: before } = await pool.query(`INSERT INTO capture_events
      (user_id, client, event_id, session_id, received_at, raw_request, status, memory_count)
      VALUES ($1, $2, $3, $4, clock_timestamp(), $5, $6, $7) RETURNING *`,
    [owner, key.client, key.eventId, key.sessionId, raw, ledgerState, ledgerState === "completed" ? 2 : 0]);
    if (legacyState === "failed") {
      await pool.query(`INSERT INTO jobs (id, user_id, capture_id, kind, status, attempts, error_code)
        VALUES ($1, $2, $3, 'ingest', 'failed', 1, 'extraction_failed')`,
      [crypto.randomUUID(), owner, `${key.client}:${key.eventId}`]);
    }
    assert.deepEqual(await uow.run(owner, write, (tx) => capture.admit(tx, key, messages)), { status: retryStatus });
    assert.deepEqual(await uow.run(owner, write, (tx) => capture.claim(tx, key, messages, options)), { status: retryStatus });
    assert.equal(await uow.run(owner, read, (tx) => capture.load(tx, key)), null);
    assert.deepEqual(await uow.run(owner, read, (tx) => capture.status(tx, key.scope, key.eventId, key.client)),
      { status: eventStatus });
    assert.deepEqual((await pool.query("SELECT * FROM capture_events WHERE user_id = $1", [owner])).rows, before);
  });
}

// Mirror the stored request fields that the parser and scrubber consume.
function storedRequest(raw) {
  const request = typeof raw === "string" ? JSON.parse(raw) : raw;
  assert.match(request.client, /^[\s\S]{1,200}$/u);
  assert.match(request.event_id, /^[\s\S]{8,200}$/u);
  assert.match(request.session_id, /^[\s\S]{1,200}$/u);
  assert.ok(Array.isArray(request.messages) && request.messages.length <= 24);
  if (request.boundary !== undefined) assert.ok(["PreCompact", "SessionEnd"].includes(request.boundary));
  assert.ok(request.messages.length || request.boundary);
  for (const message of request.messages) {
    assert.deepEqual(Object.keys(message).sort(), [
      "content", "id", ...(message.occurred_at === undefined ? [] : ["occurred_at"]), "role",
    ]);
    assert.match(message.id, /^[\s\S]{1,200}$/u);
    assert.ok(["user", "assistant"].includes(message.role));
    assert.equal(typeof message.content, "string");
    if (message.occurred_at !== undefined) {
      assert.equal(message.occurred_at, new Date(message.occurred_at).toISOString());
    }
  }
  return request;
}

test("a Core admission stores a parseable prepared request", migrationDbTest, async (t) => {
  const { pool, uow, capture } = await database(t);
  const key = { ...event, eventId: "capture-event", scope: { owner, namespace: "private" } };
  const batch = [messages[0], { id: "blank", role: "assistant", content: "", occurredAtMs: null }];
  assert.deepEqual(await uow.run(owner, write, (tx) => capture.admit(tx, key, batch)), { status: "admitted" });
  const { rows: [{ raw_request: raw }] } = await pool.query("SELECT raw_request FROM capture_events");
  assert.deepEqual(storedRequest(raw), {
    client: key.client, event_id: key.eventId, session_id: key.sessionId,
    messages: [
      { id: batch[0].id, role: batch[0].role, content: batch[0].content,
        occurred_at: new Date(batch[0].occurredAtMs).toISOString() },
      { id: batch[1].id, role: batch[1].role, content: batch[1].content },
    ],
  });
  assert.deepEqual(await uow.run(owner, read, (tx) => capture.load(tx, key)), { key, messages: batch });
});

test("a standalone claim stores a parseable request with no messages", migrationDbTest, async (t) => {
  const { pool, uow, capture } = await database(t);
  const key = { ...event, eventId: "capture-event" };
  assert.equal((await uow.run(owner, write, (tx) => capture.claim(tx, key, messages, options))).status, "claimed");
  const { rows: [{ raw_request: raw }] } = await pool.query("SELECT raw_request FROM capture_events");
  assert.deepEqual(storedRequest(raw), {
    client: key.client, event_id: key.eventId, session_id: key.sessionId, boundary: "SessionEnd", messages: [],
  });
  assert.equal(await uow.run(owner, read, (tx) => capture.load(tx, key)), null);
});

test("Core message metadata round-trips when it exceeds stored request bounds", migrationDbTest, async (t) => {
  const { pool, uow, capture } = await database(t);
  const key = { ...event, client: "c".repeat(201) };
  const batch = [{ ...messages[0], id: "\u0000".repeat(201), occurredAtMs: Number.MAX_SAFE_INTEGER }];
  await uow.run(owner, write, (tx) => capture.admit(tx, key, batch));
  const { rows: [{ raw_request: raw }] } = await pool.query("SELECT raw_request FROM capture_events");
  assert.deepEqual(storedRequest(raw), {
    client: key.client.slice(0, 200), event_id: "event---", session_id: key.sessionId,
    messages: [{ id: "message-0", role: batch[0].role, content: batch[0].content }],
  });
  await pool.query(`UPDATE capture_events SET raw_request = jsonb_set(raw_request, '{messages,0,content}', '""')`);
  assert.deepEqual(await uow.run(owner, read, (tx) => capture.load(tx, key)),
    { key, messages: [{ ...batch[0], content: "" }] });
});

test("a Core admission completed by the hosted service deduplicates both retry paths", migrationDbTest, async (t) => {
  const { pool, uow, capture } = await database(t);
  const key = { ...event, eventId: "capture-event", scope: { owner, namespace: "archive" } };
  const admit = () => uow.run(owner, write, (tx) => capture.admit(tx, key, messages));
  const claim = () => uow.run(owner, write, (tx) => capture.claim(tx, key, messages, options));
  assert.deepEqual(await admit(), { status: "admitted" });
  const { rows: [completed] } = await pool.query(`UPDATE capture_events
    SET status = 'completed', memory_count = greatest(memory_count, $4)
    WHERE user_id = $1 AND client = $2 AND event_id = $3 RETURNING *`, [owner, key.client, key.eventId, 1]);
  assert.equal(completed.core_payload_digest, key.payloadDigest);
  assert.equal(completed.core_result, null);
  assert.deepEqual(await uow.run(owner, read, (tx) => capture.status(tx, key.scope, key.eventId)), { status: "done" });
  assert.deepEqual(await admit(), { status: "duplicate" });
  assert.deepEqual(await claim(), { status: "duplicate" });
  assert.deepEqual((await pool.query("SELECT * FROM capture_events")).rows, [completed]);
});

test("hosted completion takes precedence over a stale Core failure", migrationDbTest, async (t) => {
  const { pool, uow, capture } = await database(t);
  const key = { ...event, eventId: "capture-event" };
  await uow.run(owner, write, async (tx) => {
    await capture.admit(tx, key, messages);
    const { token } = await capture.claim(tx, key, messages, options);
    await capture.abandon(tx, token, terminal);
  });
  await pool.query(`UPDATE capture_events SET status = 'completed', memory_count = greatest(memory_count, $4)
    WHERE user_id = $1 AND client = $2 AND event_id = $3`, [owner, key.client, key.eventId, 1]);
  assert.deepEqual(await uow.run(owner, read, (tx) => capture.status(tx, key.scope, key.eventId)), { status: "done" });
});

for (const state of ["pending", "queued"]) {
  test(`a Core admission held ${state} by the hosted service reports processing`, migrationDbTest, async (t) => {
    const { pool, uow, capture } = await database(t);
    const key = { ...event, eventId: "capture-event" };
    const admit = () => uow.run(owner, write, (tx) => capture.admit(tx, key, messages));
    assert.deepEqual(await admit(), { status: "admitted" });
    const identity = [owner, key.client, key.eventId];
    const { rows: [held] } = state === "pending"
      ? await pool.query(`UPDATE capture_events SET raw_archive_from = $4
          WHERE user_id = $1 AND client = $2 AND event_id = $3 RETURNING *`, [...identity, 0])
      : await pool.query(`UPDATE capture_events SET status = 'queued'
          WHERE user_id = $1 AND client = $2 AND event_id = $3 RETURNING *`, identity);
    assert.equal(held.status, state);
    assert.deepEqual(await admit(), { status: "processing" });
    assert.deepEqual(await uow.run(owner, write, (tx) => capture.claim(tx, key, messages, options)),
      { status: "processing" });
    assert.deepEqual(await uow.run(owner, read, (tx) => capture.status(tx, key.scope, key.eventId)), { status: "pending" });
    assert.deepEqual((await pool.query("SELECT * FROM capture_events")).rows, [held]);
  });
}

test("a proven fork rechecks the ancestor's namespace on read and write", migrationDbTest, async (t) => {
  const secret = randomBytes(32).toString("hex");
  const { pool, uow, capture } = await database(t, { lineageSecret: secret });
  const ancestor = { ...event, scope: { owner, namespace: "work" }, sessionId: "ancestor-session" };
  const replay = { ...event, scope: { owner, namespace: "personal" } };
  const { id, content } = messages[0];
  const mac = (value) => createHmac("sha256", secret).update(value).digest("hex");
  await pool.query(`INSERT INTO capture_raw_lineage (user_id, client, session_id, message_mac, content_mac)
    VALUES ($1, $2, $3, $4, $5)`, [owner, ancestor.client, ancestor.sessionId, mac(id),
    mac("\0cairn:raw-lineage-content:" + JSON.stringify([owner, ancestor.client, id, content]))]);
  await uow.run(owner, write, (tx) => capture.claim(tx, replay, messages, options));
  const eligible = () => uow.run(owner, read, (tx) => capture.eligible(tx, replay, messages));
  const suppress = (sessionId) => {
    const fact = { owner, namespace: ancestor.scope.namespace, actionId: sessionId, origin: "forget",
      kind: "session", session: { client: ancestor.client, sessionId } };
    const incarnation = createHash("sha256").update(factIncarnationBody(fact)).digest("hex");
    return uow.run(owner, write, (tx) => createPostgresSuppressionStore().writeFact(tx, fact, incarnation));
  };
  await suppress(replay.sessionId);
  assert.deepEqual(await eligible(), [0]);
  await suppress(ancestor.sessionId);
  assert.deepEqual(await eligible(), []);
  await assert.rejects(uow.run(owner, {}, (tx) => capture.assertEligible(tx, replay, [0])), { code: "lineage_fenced" });
});

test("a proven fork checks hashed ancestor facts across namespaces on read and write", migrationDbTest, async (t) => {
  const secret = randomBytes(32).toString("hex");
  const { pool, uow, capture } = await database(t, { lineageSecret: secret });
  const ancestor = { ...event, client: 'client"', scope: { owner, namespace: "archive" }, sessionId: "source\n🌿" };
  const replay = { ...ancestor, scope: { owner, namespace: "replay" }, sessionId: event.sessionId };
  const { id, content } = messages[0];
  const mac = (value) => createHmac("sha256", secret).update(value).digest("hex");
  await pool.query(`INSERT INTO capture_raw_lineage (user_id, client, session_id, message_mac, content_mac)
    VALUES ($1, $2, $3, $4, $5)`, [owner, ancestor.client, ancestor.sessionId, mac(id),
    mac("\0cairn:raw-lineage-content:" + JSON.stringify([owner, ancestor.client, id, content]))]);
  await uow.run(owner, write, (tx) => capture.claim(tx, replay, messages, options));
  const eligible = () => uow.run(owner, read, (tx) => capture.eligible(tx, replay, messages));
  const recheck = () => uow.run(owner, {}, (tx) => capture.assertEligible(tx, replay, [0]));
  const suppress = (actionId, sessionId) => {
    const sessionKeyHash = createHash("sha256").update(JSON.stringify([ancestor.client, sessionId])).digest("hex");
    const fact = { ...ancestor.scope, actionId, origin: "forget", kind: "session",
      session: { client: ancestor.client, sessionKeyHash } };
    const incarnation = createHash("sha256").update(factIncarnationBody(fact)).digest("hex");
    return uow.run(owner, write, (tx) => createPostgresSuppressionStore().writeFact(tx, fact, incarnation));
  };
  await suppress("different-hash", "unrelated-session");
  assert.deepEqual(await eligible(), [0]);
  await recheck();
  await suppress("matching-hash", ancestor.sessionId);
  await Promise.all([
    eligible().then((positions) => assert.deepEqual(positions, [])),
    assert.rejects(recheck(), { code: "lineage_fenced" }),
  ]);
});

for (const keyed of [true, false]) {
  test(`an ID-only anchor withholds a replay ${keyed ? "with" : "without"} a signing secret`, migrationDbTest, async (t) => {
    const secret = randomBytes(32).toString("hex");
    const { pool, uow, capture } = await database(t, keyed ? { lineageSecret: secret } : undefined);
    const ancestor = "ancestor-session";
    const messageMac = createHmac("sha256", secret).update(messages[0].id).digest("hex");
    await pool.query("INSERT INTO capture_raw_fences (user_id, client, session_id) VALUES ($1, $2, $3)",
      [owner, event.client, ancestor]);
    await pool.query(`INSERT INTO capture_raw_lineage (user_id, client, session_id, message_mac, content_mac)
      VALUES ($1, $2, $3, $4, NULL)`, [owner, event.client, ancestor, messageMac]);
    const eligible = (batch) => uow.run(owner, read, (tx) => capture.eligible(tx, event, batch));
    await uow.run(owner, write, (tx) => capture.claim(tx, event, messages, options));
    assert.deepEqual(await eligible(messages), []);
    assert.deepEqual(await eligible([{ ...messages[0], content: "" }]), []);
    if (keyed) assert.deepEqual(await eligible([{ ...messages[0], id: "unrelated" }]), [0]);
    await assert.rejects(uow.run(owner, {}, (tx) => capture.assertEligible(tx, event, [0])), { code: "lineage_fenced" });
  });
}

for (const operation of ["beginDispatch", "abandon"]) {
  test(`${operation} refuses a lease that expires at token lock acquisition`, migrationDbTest, async (t) => {
    let now = 0;
    let locks = 0;
    const { pool, uow, capture } = await database(t, { now: () => now }, (sql) => {
      if (sql.includes("core_lease_token = $2 FOR UPDATE")) {
        locks++;
        now = options.leaseMs + 1;
      }
    });
    const { token } = await uow.run(owner, write, (tx) => capture.claim(tx, event, messages, options));
    now = options.leaseMs - 1;
    await assert.rejects(uow.run(owner, write, (tx) =>
      operation === "abandon" ? capture.abandon(tx, token, terminal) : capture.beginDispatch(tx, token)),
    { code: "stale_admission" });
    assert.equal(locks, 1);
    assert.deepEqual((await pool.query("SELECT core_dispatched, core_failure_code FROM capture_events")).rows,
      [{ core_dispatched: false, core_failure_code: null }]);
    const retry = await uow.run(owner, write, (tx) => capture.claim(tx, event, messages, options));
    assert.equal(retry.status, "claimed");
    assert.notEqual(retry.token, token);
  });
}
