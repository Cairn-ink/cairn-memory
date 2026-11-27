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
