import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { capabilities, userFingerprintKey } from "../../core/src/index.mjs";
import { createMemoryService } from "../../core/src/service/index.mjs";
import {
  createPostgresCapturePorts, createPostgresFingerprintKeyProvider, createPostgresMemoryReads,
  createPostgresMemoryStore, createPostgresPauseStore, createPostgresRawPorts, createPostgresSuppressionStore,
  createPostgresUnitOfWork, HOSTED_FINGERPRINT_LABELS,
} from "../src/index.mjs";
import { migrationDatabase, migrationDbTest } from "./migration-database.mjs";

const messages = [
  { id: "m1", role: "user", content: "The cedar drawer holds the spare keys.", occurredAtMs: 10 },
  { id: "m2", role: "assistant", content: "Noted: spare keys are in the cedar drawer.", occurredAtMs: 20 },
];
const memoryText = "Spare keys are kept in the cedar drawer.";
const sha256Hex = (text) => createHash("sha256").update(text).digest("hex");

async function fixture(t, { archiveFirst = true, onStage, beforeArchiveCommit } = {}) {
  const { pool } = await migrationDatabase(t);
  const owner = randomUUID();
  const scope = { owner, namespace: null };
  const key = { client: "test-client", sessionId: randomUUID(), eventId: randomUUID() };
  await pool.query("INSERT INTO users (id) VALUES ($1)", [owner]);
  await pool.query("INSERT INTO core_owner_state (user_id, legacy_facts_ready) VALUES ($1, true)", [owner]);

  const backends = [];
  const uow = createPostgresUnitOfWork({
    async connect() {
      const client = await pool.connect();
      backends.push(client.processID);
      return { query: (sql, params) => client.query(sql, params), release: (destroy) => client.release(destroy) };
    },
  });
  const write = (operation) => uow.run(owner, { pauseLock: true }, operation);
  const lineageSecret = randomBytes(32).toString("hex");
  const capture = createPostgresCapturePorts({ lineageSecret, nearDuplicate: false });
  const { raw, sessionLineage } = createPostgresRawPorts({ lineageSecret });
  const fingerprintSecret = randomBytes(32).toString("hex");
  const keys = createPostgresFingerprintKeyProvider(fingerprintSecret, { uow });
  const fingerprintKey = await userFingerprintKey(fingerprintSecret, owner, HOSTED_FINGERPRINT_LABELS);
  await keys.publish(owner, fingerprintKey.id);

  const archive = (event, batch) => write(async (tx) => {
    await raw.recordLineage(tx, event, batch);
    assert.equal((await raw.archive(tx, event, batch)).archived, batch.length);
  });
  if (archiveFirst) {
    // An earlier capture already archived the same messages.
    await archive({ ...key, scope, eventId: randomUUID(), payloadDigest: sha256Hex("earlier capture") }, messages);
  }

  const vector = new Float32Array(1536);
  vector[0] = 1;
  const tokens = { countTokens: () => 100 };
  const modelInputs = [];
  const service = createMemoryService({
    storage: {
      name: "Postgres", uow, keys, capture, sessionLineage, ...createPostgresMemoryReads(),
      suppressions: createPostgresSuppressionStore(), memories: createPostgresMemoryStore(), pause: createPostgresPauseStore(),
      capabilities: capabilities({ fingerprintKey: true, embeddingRequiredOnInsert: true, rawArchive: true, sessionLineage: true }),
      raw: {
        ...raw,
        async archive(tx, event, batch) {
          const result = await raw.archive(tx, event, batch);
          await beforeArchiveCommit?.();
          return result;
        },
      },
    },
    config: {}, tokens,
    clock: {
      nowMs: Date.now, monotonicMs: () => performance.now(), sha256Hex,
      hmacHex: (secret, text) => createHmac("sha256", secret).update(text).digest("hex"),
    },
    gate: { async assertOpen(_owner, stage) { await onStage?.(stage); } },
    model: {
      model: "fixture", contextWindow: 40_000, ...tokens,
      async call(_kind, request) {
        modelInputs.push(JSON.stringify(request.input));
        await onStage?.("model");
        return { items: [{ content: memoryText, kind: "fact", confidence: 0.9, sourceIndices: [0, 1] }] };
      },
    },
    embedder: {
      model: "fixture", dimensions: vector.length,
      async embed(texts) {
        await onStage?.("embed");
        return texts.map(() => vector);
      },
    },
  });

  const enqueue = async (event, batch) => {
    assert.deepEqual(await service.enqueueCapture(scope, { ...event, messages: batch }), { status: "accepted" });
  };
  await enqueue(key, messages);
  return {
    pool, key, scope, backends, archive, enqueue, modelInputs,
    finish: () => service.runCapture(scope, key),
    remove: () => write((tx) => raw.deleteConversation(tx, scope, key)),
    async revision() {
      const { rows: [row] } = await pool.query("SELECT index_revision FROM core_owner_state WHERE user_id = $1", [owner]);
      return BigInt(row.index_revision);
    },
    async rawRows(event = key) {
      return (await pool.query(`SELECT * FROM raw_messages
        WHERE user_id = $1 AND client = $2 AND session_id = $3 ORDER BY message_id`, [owner, event.client, event.sessionId])).rows;
    },
    async ledger(event = key) {
      const { rows: [row] } = await pool.query(`SELECT raw_request FROM capture_events
        WHERE user_id = $1 AND client = $2 AND event_id = $3`, [owner, event.client, event.eventId]);
      return row.raw_request;
    },
    async savedMemory() {
      return (await pool.query("SELECT text FROM memories WHERE user_id = $1", [owner])).rows;
    },
  };
}

async function assertScrubbed(db) {
  const request = await db.ledger();
  assert.deepEqual(request.messages.map(({ id, content }) => ({ id, content })), messages.map(({ id }) => ({ id, content: "" })));
  for (const { content } of messages) assert.ok(!JSON.stringify(request).includes(content));
}

for (const [stage, timing] of [
  ["beforeRun", "before runCapture"], ["dispatch", "at dispatch"],
  ["model", "during the model call"], ["embed", "during embedding"],
]) {
  test(`capture cannot restore Raw deleted ${timing}`, migrationDbTest, async (t) => {
    let deletion;
    const db = await fixture(t, { onStage: (current) => current === stage && deletion === undefined && remove() });
    async function remove() {
      assert.equal(deletion, undefined);
      const before = await db.revision();
      const result = await db.remove();
      deletion = { result, advance: (await db.revision()) - before };
    }

    if (stage === "beforeRun") await remove();
    const outcome = await db.finish();
    assert.deepEqual(deletion, { result: { rawDeleted: 2 }, advance: 1n });
    assert.deepEqual((await db.rawRows()).map(({ message_id }) => message_id), [], "finish restored deleted Raw");
    assert.deepEqual(await db.savedMemory(), []);
    await assertScrubbed(db);
    if (stage === "beforeRun") {
      assert.equal(outcome.status, "done");
      assert.deepEqual(db.modelInputs, []);
    } else {
      assert.deepEqual(outcome, { status: "failed", code: "suppressed" });
      assert.equal(db.modelInputs.length, 1);
      assert.ok(db.modelInputs[0].includes(messages[0].content));
    }
  });
}

async function waitForBlock({ pool, backends }, holder) {
  const deadline = performance.now() + 3_500;
  while (performance.now() < deadline) {
    const waiting = backends.at(-1);
    if (waiting !== holder) {
      const { rows: [{ blocked }] } = await pool.query(
        "SELECT $2::int = ANY(pg_blocking_pids($1)) AS blocked", [waiting, holder]);
      if (blocked) return;
    }
    await delay(20);
  }
  assert.fail("Postgres did not report deletion waiting on capture finish");
}

test("a conversation delete queued behind capture finish removes its committed Raw and ledger text", migrationDbTest, async (t) => {
  const ready = Promise.withResolvers();
  const release = Promise.withResolvers();
  const db = await fixture(t, {
    archiveFirst: false,
    async beforeArchiveCommit() {
      ready.resolve();
      await release.promise;
    },
  });
  const finish = db.finish();
  let deletion;
  try {
    await Promise.race([ready.promise, finish.then(({ status }) => assert.fail(`finish ended early: ${status}`))]);
    const holder = db.backends.at(-1);
    deletion = db.remove();
    void deletion.catch(() => {});
    await waitForBlock(db, holder);
  } finally {
    release.resolve();
    await Promise.allSettled([finish, deletion]);
  }
  assert.equal((await finish).status, "done");
  assert.deepEqual(await deletion, { rawDeleted: 2 });
  assert.deepEqual(await db.rawRows(), []);
  await assertScrubbed(db);
  assert.deepEqual(await db.savedMemory(), [{ text: memoryText }]);
});

test("a ledger-only conversation delete advances the index once and leaves unrelated Raw and ledger intact", migrationDbTest, async (t) => {
  const db = await fixture(t, { archiveFirst: false });
  const unrelated = { ...db.key, sessionId: randomUUID(), eventId: randomUUID() };
  await db.archive({ ...unrelated, scope: db.scope, payloadDigest: sha256Hex("unrelated capture") }, messages);
  await db.enqueue(unrelated, messages);
  const rawBefore = await db.rawRows(unrelated);
  const ledgerBefore = await db.ledger(unrelated);
  const revision = await db.revision();

  assert.deepEqual(await db.remove(), { rawDeleted: 0 });
  assert.equal(await db.revision(), revision + 1n);
  await assertScrubbed(db);
  assert.deepEqual(await db.rawRows(unrelated), rawBefore);
  assert.deepEqual(await db.ledger(unrelated), ledgerBefore);
  assert.deepEqual(await db.remove(), { rawDeleted: 0 });
  assert.equal(await db.revision(), revision + 1n);
});
