import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { capabilities } from "../../core/src/index.mjs";
import { forgetMethod } from "../../core/src/service/forget.mjs";
import { createPostgresMemoryReads, createPostgresMemoryStore, createPostgresSuppressionStore,
  createPostgresUnitOfWork } from "../src/index.mjs";
import { migrationDatabase, migrationDbTest } from "./migration-database.mjs";

test("hosted forget withholds shared receipt coordinates without erasing the survivor or its links", migrationDbTest, async t => {
  const { pool, source: connection } = await migrationDatabase(t);
  const owner = "synthetic-shared-receipt-owner";
  const scope = { owner, namespace: null };
  await pool.query("INSERT INTO users (id) VALUES ($1)", [owner]);
  const uow = createPostgresUnitOfWork(connection);
  const memories = createPostgresMemoryStore();
  const suppressions = createPostgresSuppressionStore();
  const { hydrate } = createPostgresMemoryReads();
  const source = { kind: "mcp", client: null, sessionId: null };
  const sha256Hex = text => createHash("sha256").update(text).digest("hex");
  const receipt = { client: "synthetic-client", sessionId: "synthetic-session", messageId: "shared",
    role: "user", occurredAtMs: 42 };
  const independent = { ...receipt, messageId: "independent", occurredAtMs: 84 };
  const insert = (tx, text, receipts) => memories.insert(tx, scope, {
    text, textHash: "sha256:" + sha256Hex(text.toLowerCase()), source, confidence: 1, kind: "fact",
    origin: "explicit", embedding: { model: "synthetic", vector: [1, ...Array(1535).fill(0)] },
  }, receipts, 100);
  const [forgotten, surviving] = await uow.run(owner, { pauseLock: true }, async tx => [
    await insert(tx, "The synthetic marten carries a map.", [receipt]),
    await insert(tx, "The synthetic heron carries a compass.", [receipt, independent]),
  ]);
  const read = () => uow.run(owner, { readOnly: true }, tx => hydrate.hydrate(tx, { owner, namespaces: [null] },
    [{ type: "memory", id: surviving.id, namespace: null }], "read"));
  const [before] = await read();
  assert.deepEqual(before.receipts, [independent, receipt]);
  const forget = forgetMethod({
    storage: { uow, memories, suppressions, capabilities: capabilities({}) },
    clock: { nowMs: () => 200, sha256Hex: async text => sha256Hex(text) },
  });
  assert.equal((await forget(scope, forgotten.id, source)).status, "forgotten");
  const [after] = await read();
  assert.equal(after.memory.id, surviving.id);
  assert.deepEqual(after.receipts, [independent]);
  assert.deepEqual(after.sourceDates, { firstMs: 84, lastMs: 84 });
  const { rows: [{ n }] } = await pool.query(`SELECT count(*)::int AS n FROM core_memory_receipts
    WHERE user_id = $1 AND memory_id = $2 AND forgotten_at IS NULL`, [owner, surviving.id]);
  assert.equal(n, 2);
});

test("hosted forget withholds only the exact owner, client, session and message coordinate", migrationDbTest, async t => {
  const { pool, source: connection } = await migrationDatabase(t);
  const owner = "synthetic-coordinate-owner";
  const other = "synthetic-coordinate-other-owner";
  for (const id of [owner, other]) await pool.query("INSERT INTO users (id) VALUES ($1)", [id]);
  const uow = createPostgresUnitOfWork(connection);
  const memories = createPostgresMemoryStore();
  const suppressions = createPostgresSuppressionStore();
  const { hydrate } = createPostgresMemoryReads();
  const source = { kind: "mcp", client: null, sessionId: null };
  const sha256Hex = text => createHash("sha256").update(text).digest("hex");
  const receipt = { client: "synthetic-client", sessionId: "synthetic-session", messageId: "shared",
    role: "user", occurredAtMs: 42 };
  const otherSession = { ...receipt, sessionId: "synthetic-other-session", occurredAtMs: 63 };
  const insert = (tx, scope, text, receipts) => memories.insert(tx, scope, {
    text, textHash: "sha256:" + sha256Hex(text.toLowerCase()), source, confidence: 1, kind: "fact",
    origin: "explicit", embedding: { model: "synthetic", vector: [1, ...Array(1535).fill(0)] },
  }, receipts, 100);
  const scope = { owner, namespace: null };
  const otherScope = { owner: other, namespace: null };
  const [forgotten, surviving] = await uow.run(owner, { pauseLock: true }, async tx => [
    await insert(tx, scope, "The synthetic otter carries a lantern.", [receipt]),
    await insert(tx, scope, "The synthetic lynx carries a rope.", [receipt, otherSession]),
  ]);
  const foreign = await uow.run(other, { pauseLock: true }, tx =>
    insert(tx, otherScope, "The synthetic badger carries a kettle.", [receipt]));
  const read = (who, id) => uow.run(who, { readOnly: true }, tx => hydrate.hydrate(tx, { owner: who, namespaces: [null] },
    [{ type: "memory", id, namespace: null }], "read"));
  const forget = forgetMethod({
    storage: { uow, memories, suppressions, capabilities: capabilities({}) },
    clock: { nowMs: () => 200, sha256Hex: async text => sha256Hex(text) },
  });
  assert.equal((await forget(scope, forgotten.id, source)).status, "forgotten");
  const [after] = await read(owner, surviving.id);
  // Same client and message id in another session is a different coordinate and stays deliverable.
  assert.deepEqual(after.receipts, [otherSession]);
  const [foreignAfter] = await read(other, foreign.id);
  // Another owner's receipt at the same (client, session, message) is never withheld by this owner's forget.
  assert.deepEqual(foreignAfter.receipts, [receipt]);
});
