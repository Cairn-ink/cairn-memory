import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { coreDigest, factIncarnationBody } from "../../core/src/index.mjs";
import { createPostgresCapturePorts, createPostgresRawPorts, createPostgresSuppressionStore, createPostgresUnitOfWork } from "../src/index.mjs";
import { migrationDatabase, migrationDbTest } from "./migration-database.mjs";

const write = { pauseLock: true };
const leaseMs = 60_000;
const hash = (text) => createHash("sha256").update(text).digest("hex");
const message = (content, id = randomUUID()) => ({ id, role: "user", content, occurredAtMs: 10 });

async function fixture(t) {
  const { pool } = await migrationDatabase(t);
  const owner = randomUUID();
  const otherOwner = randomUUID();
  const scope = { owner, namespace: null };
  const key = { scope, client: "test-client", sessionId: randomUUID(), eventId: randomUUID(), payloadDigest: hash("event") };
  await pool.query("INSERT INTO users (id) VALUES ($1), ($2)", [owner, otherOwner]);
  const backends = [];
  const uow = createPostgresUnitOfWork({
    async connect() {
      const client = await pool.connect();
      backends.push(client.processID);
      return { query: (sql, params) => client.query(sql, params), release: (destroy) => client.release(destroy) };
    },
  });
  let now = Date.now();
  const lineageSecret = randomBytes(32).toString("hex");
  const capture = createPostgresCapturePorts({ lineageSecret, nearDuplicate: false, now: () => now });
  const { raw } = createPostgresRawPorts({ lineageSecret });
  const run = (operation) => uow.run(owner, write, operation);
  const acquire = (messages, admit = true) => run(async (tx) => {
    if (admit) assert.deepEqual(await capture.admit(tx, key, messages), { status: "admitted" });
    const claim = await capture.claim(tx, key, messages, { leaseMs });
    assert.equal(claim.status, "claimed");
    return claim.token;
  });
  return { pool, uow, owner, otherOwner, scope, key, capture, raw, run, acquire, backends,
    advanceClock: (ms) => { now += ms; } };
}

function item(content, key, source) {
  const vector = new Float32Array(1536);
  vector[0] = 1;
  return {
    kind: "fact", content, confidence: 0.8, textHash: "sha256:" + hash(content), embedding: { model: "test", vector },
    receipts: source ? [{ client: key.client, sessionId: key.sessionId, messageId: source.id,
      role: source.role, occurredAtMs: source.occurredAtMs }] : [],
  };
}

async function ledger({ pool, owner, key }) {
  const { rows: [row] } = await pool.query(`SELECT status, memory_count, core_lease_token, core_result, raw_request
    FROM capture_events WHERE user_id = $1 AND client = $2 AND event_id = $3`, [owner, key.client, key.eventId]);
  return row;
}

async function writeCounts({ pool, owner }) {
  const { rows: [row] } = await pool.query(`SELECT
    (SELECT count(*)::int FROM memories WHERE user_id = $1) AS memories,
    (SELECT count(*)::int FROM core_memory_receipts WHERE user_id = $1) AS receipts,
    (SELECT COALESCE(max(index_revision), 0)::int FROM core_owner_state WHERE user_id = $1) AS revision`, [owner]);
  return row;
}

test("a mid-finish statement failure rolls back memory rows, receipts, revision and lease retirement", migrationDbTest, async (t) => {
  const db = await fixture(t);
  const { pool, key, capture, acquire, run } = db;
  const source = message("A source for both items.");
  const token = await acquire([source]);
  await pool.query(`CREATE FUNCTION reject_second_finish_item() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF EXISTS (SELECT 1 FROM memories WHERE user_id = NEW.user_id AND text = 'First memory') THEN
        RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'second item rejected';
      END IF;
      RAISE EXCEPTION 'first item did not reach storage';
    END;
    $$;
    CREATE TRIGGER reject_second_finish_item BEFORE INSERT ON memories
      FOR EACH ROW WHEN (NEW.text = 'Second memory') EXECUTE FUNCTION reject_second_finish_item()`);
  const first = item("First memory", key, source);
  await assert.rejects(run(async (tx) => {
    await assert.rejects(capture.finish(tx, token, [first, item("Second memory", key, source)]), { code: "storage_busy" });
  }), { code: "storage_busy" });
  assert.deepEqual(await writeCounts(db), { memories: 0, receipts: 0, revision: 0 });
  const pending = await ledger(db);
  assert.equal(pending.status, "pending");
  assert.equal(pending.core_lease_token, token);
  assert.equal(pending.core_result, null);
  assert.equal((await run((tx) => capture.finish(tx, token, [first]))).memories.length, 1);
});

test("finish rejects foreign and expired tokens and only the replacement can complete", migrationDbTest, async (t) => {
  const db = await fixture(t);
  const { uow, otherOwner, key, capture, acquire, run, advanceClock } = db;
  const messages = [message("A source.")];
  const token = await acquire(messages);
  await assert.rejects(uow.run(otherOwner, write, (tx) => capture.finish(tx, token, [])), { code: "stale_admission" });
  advanceClock(leaseMs);
  await assert.rejects(run((tx) => capture.finish(tx, token, [])), { code: "stale_admission" });
  assert.equal((await ledger(db)).core_lease_token, token);
  const replacement = await acquire(messages, false);
  assert.notEqual(replacement, token);
  await assert.rejects(run((tx) => capture.finish(tx, token, [])), { code: "stale_admission" });
  await run((tx) => capture.finish(tx, replacement, []));
  assert.deepEqual(await writeCounts(db), { memories: 0, receipts: 0, revision: 0 });
  assert.equal((await ledger(db)).core_lease_token, null);
});

test("finish persists lossless replay and the completed status and count read by the hosted service", migrationDbTest, async (t) => {
  const db = await fixture(t);
  const { pool, owner, key, capture, acquire, run } = db;
  const messages = [message("A source for one memory.")];
  const token = await acquire(messages);
  const first = item("An extracted memory", key, messages[0]);
  const retained = { alg: "hmac", keyId: randomUUID(), label: "test-retained", pipeline: "core",
    redactionVersion: 1, value: randomBytes(32).toString("hex") };
  const hosted = { alg: "hmac", keyId: retained.keyId, pipeline: "hosted-v1",
    redactionVersion: 1, value: randomBytes(32).toString("hex") };
  const fact = { owner, actionId: randomUUID(), origin: "forget", kind: "text", mode: "exact", text: { digests: [hosted] } };
  const suppressions = createPostgresSuppressionStore();
  await run((tx) => suppressions.writeFact(tx, fact, hash(factIncarnationBody(fact))));
  const comparable = { ...hosted, label: "hosted-v1", value: retained.value };
  first.digests = [await coreDigest(first.content), retained, comparable,
    { ...retained, alg: "test-algorithm", redactionVersion: 2 }];
  const blocked = item("Memory with evidence from a different signing domain", key, messages[0]);
  blocked.digests = [{ ...comparable, label: retained.label }];
  const result = await run((tx) => capture.finish(tx, token, [first, blocked, first]));
  const expected = structuredClone(result);
  assert.equal(result.indexRevision, 2);
  assert.equal(result.suppressedCount, 1);
  assert.equal(result.duplicateCount, 1);
  const { status, memory_count, core_result, core_lease_token, raw_request } = await ledger(db);
  assert.equal(status, "completed");
  assert.equal(memory_count, 1);
  assert.deepEqual(core_result, expected);
  assert.equal(core_lease_token, null);
  assert.equal(raw_request.messages[0].occurred_at, new Date(messages[0].occurredAtMs).toISOString());

  // The hosted producer returns the count and derives queued from status using only ledger columns.
  const { rows } = await pool.query(`SELECT memory_count AS "memoryCount", status <> 'completed' AS queued
    FROM capture_events WHERE user_id = $1 AND client = $2 AND event_id = $3`, [owner, key.client, key.eventId]);
  assert.deepEqual(rows, [{ memoryCount: 1, queued: false }]);
  const { rows: [memory] } = await pool.query(`SELECT text, source_kind, core_digests FROM memories
    WHERE user_id = $1 AND id = $2`, [owner, result.memories[0].id]);
  assert.equal(memory.text, first.content);
  assert.equal(memory.source_kind, "plugin");
  assert.deepEqual(memory.core_digests, first.digests);
  assert.deepEqual(await writeCounts(db), { memories: 1, receipts: 1, revision: 2 });

  result.memories.length = 0;
  const replay = await run((tx) => capture.claim(tx, key, messages, { leaseMs }));
  assert.deepEqual(replay, { status: "rawReplay", result: expected });
  assert.deepEqual(await run((tx) => capture.admit(tx, key, messages)), replay);
});

test("withheld import positions never write raw rows and still fence a proven fork", migrationDbTest, async (t) => {
  const { pool, owner, key, scope, raw, run } = await fixture(t);
  const anchor = message("A passage withheld by the caller.");
  const kept = message("A passage cleared for import.");
  const outsideWire = { ...message("An unsupported time."), occurredAtMs: 8.64e15 };
  assert.deepEqual(await run((tx) => raw.importArchive(tx, scope, key,
    [anchor, kept, kept, outsideWire], { withheld: [0] })), { archived: 1, existing: 1, withheld: 2 });
  const stored = async () => (await pool.query("SELECT message_id, content FROM raw_messages WHERE user_id = $1", [owner])).rows;
  assert.deepEqual(await stored(), [{ message_id: kept.id, content: kept.content }]);

  await run(async (tx) => {
    await raw.recordLineage(tx, key, [anchor]);
    await raw.fenceSession(tx, scope, key);
    await raw.deleteConversation(tx, scope, key);
  });
  const fork = { client: key.client, sessionId: randomUUID() };
  assert.deepEqual(await run((tx) => raw.importArchive(tx, scope, fork, [kept, anchor], { withheld: [1] })),
    { archived: 0, existing: 0, withheld: 2 });
  assert.deepEqual(await stored(), []);
  const { rows: proofs } = await pool.query("SELECT session_id FROM capture_raw_lineage WHERE user_id = $1", [owner]);
  assert.deepEqual(proofs, [{ session_id: key.sessionId }]);
});

async function waitForBlock(pool, backends, offset) {
  const deadline = performance.now() + 3_500;
  while (performance.now() < deadline) {
    const [holder, waiting] = backends.slice(offset);
    if (waiting) {
      const { rows: [{ blocked }] } = await pool.query(
        "SELECT $2::int = ANY(pg_blocking_pids($1)) AS blocked", [waiting, holder],
      );
      if (blocked) return;
    }
    await delay(20);
  }
  assert.fail("Postgres did not report the finish waiting on the purge");
}

test("finish rereads an outbox slot scrubbed by a concurrent purge before writing memories or receipts", migrationDbTest, async (t) => {
  const db = await fixture(t);
  const { pool, owner, scope, key, capture, raw, acquire, run, backends } = db;
  const source = message("An original passage to scrub.");
  const token = await acquire([source]);
  const stored = { fact: { owner, actionId: randomUUID(), origin: "forget", kind: "text", mode: "exact",
    text: { digests: [await coreDigest(source.content)] } } };
  const ready = Promise.withResolvers();
  const release = Promise.withResolvers();
  const offset = backends.length;
  const purge = run(async (tx) => {
    const counts = await raw.purgeWithheld(tx, scope, [stored]);
    ready.resolve(counts);
    await release.promise;
  });
  let finish;
  try {
    assert.deepEqual(await Promise.race([ready.promise, purge]), { rawDeleted: 0, ledgerBlanked: 1 });
    finish = run((tx) => capture.finish(tx, token, [item("Recovered model output", key, source)]));
    const refused = assert.rejects(finish, { code: "suppressed" });
    void refused.catch(() => {});
    await waitForBlock(pool, backends, offset);
    release.resolve();
    await purge;
    await refused;
  } finally {
    release.resolve();
    await Promise.allSettled([purge, finish]);
  }
  const row = await ledger(db);
  assert.equal(row.raw_request.messages[0].content, "");
  assert.equal(row.status, "pending");
  assert.equal(row.core_lease_token, token);
  assert.equal(row.core_result, null);
  assert.deepEqual(await writeCounts(db), { memories: 0, receipts: 0, revision: 1 });
  assert.deepEqual(await run((tx) => raw.archive(tx, key, [source])), { archived: 0 });
});
