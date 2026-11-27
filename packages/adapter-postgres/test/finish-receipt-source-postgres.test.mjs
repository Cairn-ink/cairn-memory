import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { factIncarnationBody } from "../../core/src/index.mjs";
import {
  createPostgresCapturePorts, createPostgresMemoryStore, createPostgresRawPorts,
  createPostgresSuppressionStore, createPostgresUnitOfWork,
} from "../src/index.mjs";
import { migrationDatabase, migrationDbTest } from "./migration-database.mjs";

const write = { pauseLock: true };
const leaseMs = 60_000;
const sourceTimeMs = 10;
const hash = (text) => createHash("sha256").update(text).digest("hex");
const message = (content) => ({ id: randomUUID(), role: "user", content, occurredAtMs: sourceTimeMs });

async function fixture(t) {
  const { pool, source } = await migrationDatabase(t);
  const owner = randomUUID();
  const scope = { owner, namespace: null };
  const key = { scope, client: "test-client", sessionId: randomUUID(), eventId: randomUUID(), payloadDigest: hash("event") };
  await pool.query("INSERT INTO users (id) VALUES ($1)", [owner]);
  const uow = createPostgresUnitOfWork(source);
  const lineageSecret = randomBytes(32).toString("hex");
  const now = Date.now();
  const capture = createPostgresCapturePorts({ lineageSecret, nearDuplicate: false, now: () => now });
  const { raw } = createPostgresRawPorts({ lineageSecret });
  const run = (operation) => uow.run(owner, write, operation);
  const acquire = (event, messages, admit = true) => run(async (tx) => {
    if (admit) assert.deepEqual(await capture.admit(tx, event, messages), { status: "admitted" });
    const claim = await capture.claim(tx, event, messages, { leaseMs });
    assert.equal(claim.status, "claimed");
    return claim.token;
  });
  return { pool, owner, key, capture, raw, run, acquire };
}

function item(content, key, source) {
  const vector = new Float32Array(1536);
  vector[0] = 1;
  return {
    kind: "fact", content, confidence: 0.8, textHash: "sha256:" + hash(content), embedding: { model: "test", vector },
    receipts: [{ client: key.client, sessionId: key.sessionId, messageId: source.id,
      role: source.role, occurredAtMs: source.occurredAtMs }],
  };
}

async function ledger({ pool, owner, key }) {
  const { rows: [row] } = await pool.query(`SELECT status, core_lease_token, core_result
    FROM capture_events WHERE user_id = $1 AND client = $2 AND event_id = $3`, [owner, key.client, key.eventId]);
  return row;
}

async function writeCounts({ pool, owner }) {
  const { rows: [row] } = await pool.query(`SELECT
    (SELECT count(*)::int FROM memories WHERE user_id = $1) AS memories,
    (SELECT count(*)::int FROM core_memory_receipts WHERE user_id = $1) AS receipts,
    (SELECT count(*)::int FROM core_memory_receipts WHERE user_id = $1 AND forgotten_at IS NOT NULL) AS tombstones,
    (SELECT COALESCE(max(index_revision), 0)::int FROM core_owner_state WHERE user_id = $1) AS revision`, [owner]);
  return row;
}

async function writeWindow(tx, key) {
  const suppressions = createPostgresSuppressionStore();
  const fact = { ...key.scope, client: key.client, actionId: randomUUID(), origin: "forget", kind: "window",
    window: { startMs: sourceTimeMs - 1, endMs: sourceTimeMs + 1 } };
  assert.equal((await suppressions.writeFact(tx, fact, hash(factIncarnationBody(fact)))).created, true);
}

async function assertSuppressedThenFinish(db, token, candidate, change) {
  const { key, capture, run } = db;
  const before = await writeCounts(db);
  let finish;
  const transaction = run(async (tx) => {
    await capture.assertEligible(tx, key, [0]);
    await change(tx);
    finish = capture.finish(tx, token, [candidate]);
    await finish;
  });
  await assert.rejects(transaction, { code: "suppressed" });
  assert.ok(finish, "finish must run after the state change");
  await assert.rejects(finish, { code: "suppressed" });
  assert.deepEqual(await writeCounts(db), before);
  const pending = await ledger(db);
  assert.equal(pending.status, "pending");
  assert.equal(pending.core_lease_token, token);
  assert.equal(pending.core_result, null);

  const result = await run(async (tx) => {
    await capture.assertEligible(tx, key, [0]);
    return capture.finish(tx, token, [candidate]);
  });
  assert.equal(result.memories.length, 1);
  const { memories, receipts, tombstones } = await writeCounts(db);
  assert.deepEqual({ memories, receipts, tombstones }, { memories: 1, receipts: 1, tombstones: 0 });
  const completed = await ledger(db);
  assert.equal(completed.status, "completed");
  assert.equal(completed.core_lease_token, null);
  assert.deepEqual(completed.core_result, result);
  return result;
}

test("finish rejects a receipt tombstoned after eligibility", migrationDbTest, async (t) => {
  const db = await fixture(t);
  const { key, capture, run, acquire } = db;
  const source = message("The shelf holds a spare filter.");
  const candidate = item("A spare filter is on the shelf.", key, source);
  const seed = { ...key, eventId: randomUUID() };
  const seedToken = await acquire(seed, [source]);
  const seeded = await run(async (tx) => {
    await capture.assertEligible(tx, seed, [0]);
    return capture.finish(tx, seedToken, [candidate]);
  });
  const [{ id }] = seeded.memories;
  assert.deepEqual(await writeCounts(db), { memories: 1, receipts: 1, tombstones: 0, revision: seeded.indexRevision });

  // Erase scrubs outboxes. A direct claim supplies lease evidence for the same receipt address.
  const token = await acquire(key, [source], false);
  const store = createPostgresMemoryStore();
  const result = await assertSuppressedThenFinish(db, token, candidate, async (tx) => {
    assert.equal(await store.erase(tx, key.scope, id), true);
  });
  assert.equal(result.memories[0].id, id);
});

test("finish rejects an admitted receipt inside a window written after eligibility", migrationDbTest, async (t) => {
  const db = await fixture(t);
  const source = message("The workshop closes at dusk.");
  const token = await db.acquire(db.key, [source]);
  const candidate = item("The workshop closes at dusk.", db.key, source);
  await assertSuppressedThenFinish(db, token, candidate, (tx) => writeWindow(tx, db.key));
});

test("finish uses the archived time when the receipt and claim times are outside the window", migrationDbTest, async (t) => {
  const db = await fixture(t);
  const { key, raw, run, acquire } = db;
  const archived = message("The garden shed contains a rake.");
  const claimed = { ...archived, occurredAtMs: sourceTimeMs + 2 };
  assert.deepEqual(await run((tx) => raw.archive(tx, key, [archived])), { archived: 1 });
  const token = await acquire(key, [claimed]);
  const candidate = item("A rake is in the garden shed.", key, claimed);
  await assertSuppressedThenFinish(db, token, candidate, (tx) => writeWindow(tx, key));
});
