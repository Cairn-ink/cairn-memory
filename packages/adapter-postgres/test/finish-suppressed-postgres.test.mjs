import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { coreDigest, factIncarnationBody } from "../../core/src/index.mjs";
import { createPostgresCapturePorts, createPostgresSuppressionStore, createPostgresUnitOfWork } from "../src/index.mjs";
import { migrationDatabase, migrationDbTest } from "./migration-database.mjs";

async function claimBatch(t) {
  const { pool, source } = await migrationDatabase(t);
  const owner = randomUUID();
  await pool.query("INSERT INTO users (id) VALUES ($1)", [owner]);
  const key = { scope: { owner, namespace: null }, client: "test-client", sessionId: randomUUID(),
    eventId: randomUUID(), payloadDigest: "a".repeat(64) };
  const messages = ["First memory", "Middle memory", "Last memory"].map((content, position) => ({
    id: `message-${position}`, role: "user", content, occurredAtMs: position + 1,
  }));
  const items = await Promise.all(messages.map(async ({ id, role, content, occurredAtMs }) => {
    const digest = await coreDigest(content);
    const vector = new Float32Array(1536);
    vector[0] = 1;
    return { content, kind: "fact", confidence: 0.8, textHash: `sha256:${digest.value}`, embedding: { model: "test", vector },
      receipts: [{ client: key.client, sessionId: key.sessionId, messageId: id, role, occurredAtMs }] };
  }));
  const uow = createPostgresUnitOfWork(source);
  const capture = createPostgresCapturePorts({ lineageSecret: randomBytes(32).toString("hex"), nearDuplicate: false });
  const run = (operation) => uow.run(owner, { pauseLock: true }, operation);
  const admit = () => run((tx) => capture.admit(tx, key, messages));
  const claim = () => run((tx) => capture.claim(tx, key, messages, { leaseMs: 60_000 }));
  assert.deepEqual(await admit(), { status: "admitted" });
  const fresh = await claim();
  assert.equal(fresh.status, "claimed");
  const finish = () => run((tx) => capture.finish(tx, fresh.token, items));
  return { pool, owner, items, run, finish, claim, admit };
}

test("finish reports a suppressed middle item and preserves its position on claim and admission replay", migrationDbTest, async (t) => {
  const { pool, owner, items, run, finish, claim, admit } = await claimBatch(t);
  const fact = { owner, actionId: randomUUID(), origin: "forget", kind: "text", mode: "exact",
    text: { digests: [await coreDigest(items[1].content)] } };
  const incarnation = createHash("sha256").update(factIncarnationBody(fact)).digest("hex");
  const suppressions = createPostgresSuppressionStore();
  await run((tx) => suppressions.writeFact(tx, fact, incarnation));

  const result = await finish();
  assert.deepEqual(result.suppressedItems, [1]);
  assert.equal(result.suppressedCount, 1);
  const { rows } = await pool.query("SELECT id, text FROM memories WHERE user_id = $1 ORDER BY text", [owner]);
  assert.deepEqual(rows, [
    { id: result.memories[0].id, text: items[0].content },
    { id: result.memories[1].id, text: items[2].content },
  ]);
  const expected = { status: "rawReplay", result };
  assert.deepEqual(await claim(), expected, "Claim replay must preserve the finish result");
  assert.deepEqual(await admit(), expected, "Admission replay must preserve the finish result");
});

test("finish and replay omit suppression positions when no items were suppressed", migrationDbTest, async (t) => {
  const { items, finish, claim, admit } = await claimBatch(t);
  const result = await finish();
  assert.equal(result.suppressedCount, 0);
  assert.equal(result.memories.length, items.length);
  assert.equal(Object.hasOwn(result, "suppressedItems"), false);
  const expected = { status: "rawReplay", result };
  assert.deepEqual(await claim(), expected);
  assert.deepEqual(await admit(), expected);
});
