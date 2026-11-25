import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  createPostgresCapturePorts, createPostgresMemoryStore, createPostgresRawPorts,
  createPostgresSuppressionStore, createPostgresUnitOfWork,
} from "../src/index.mjs";
import { migrationDatabase, migrationDbTest } from "./migration-database.mjs";

const scope = { owner: "owner", namespace: null };
const lineageSecret = "fixture";
const newEvent = (sessionId = randomUUID()) => ({
  scope, client: "test-client", sessionId, eventId: randomUUID(), payloadDigest: "a".repeat(64),
});
const message = (content, occurredAtMs) => ({ id: randomUUID(), role: "user", content, occurredAtMs });

async function fixture(t) {
  const { pool, source } = await migrationDatabase(t);
  await pool.query("INSERT INTO users (id) VALUES ($1)", [scope.owner]);
  const uow = createPostgresUnitOfWork(source);
  const { raw } = createPostgresRawPorts({ lineageSecret });
  const capture = createPostgresCapturePorts({ lineageSecret });
  const { receiptWithheld } = createPostgresSuppressionStore();
  const memories = createPostgresMemoryStore();
  const write = work => uow.run(scope.owner, { pauseLock: true }, work);
  const read = work => uow.run(scope.owner, { readOnly: true }, work);
  const revision = () => read(tx => memories.indexRevision(tx));
  return { pool, raw, capture, receiptWithheld, write, read, revision };
}

test("deleting a Postgres conversation durably refuses new sources and advances the index once", migrationDbTest, async t => {
  const { pool, raw, capture, receiptWithheld, write, read, revision } = await fixture(t);
  const deleted = newEvent();
  const control = newEvent();
  const original = message("The latch is brass.", 1);
  const controlMessage = message("The shelf is oak.", 2);
  const archive = (event, item) => write(tx => raw.archive(tx, event, [item]));
  const remove = event => write(tx => raw.deleteConversation(tx, scope, event));
  const allowed = event => read(tx => raw.archiveAllowed(tx, event));
  const withheld = (event, { id, role, occurredAtMs, content }) => read(tx => receiptWithheld(tx, scope, {
    client: event.client, sessionId: event.sessionId, messageId: id, role, occurredAtMs, excerpt: content,
  }));

  assert.deepEqual(await archive(deleted, original), { archived: 1 });
  const before = await revision();
  const abort = new Error("rollback");
  await assert.rejects(write(async tx => {
    assert.deepEqual(await raw.deleteConversation(tx, scope, deleted), { rawDeleted: 1 });
    throw abort;
  }), error => error === abort);
  assert.equal(await revision(), before);
  assert.equal(await allowed(deleted), true);
  assert.deepEqual(await remove(deleted), { rawDeleted: 1 });
  assert.equal(await revision(), before + 1);

  const later = newEvent(deleted.sessionId);
  const resent = message("The latch was polished.", 3);
  const late = message("The latch was replaced.", Date.now() + 86_400_000);
  assert.equal(await allowed(later), false);
  assert.deepEqual(await archive(later, resent), { archived: 0 });
  assert.deepEqual(await archive(later, late), { archived: 0 });
  assert.deepEqual(await write(tx => raw.importArchive(tx, scope, later, [resent, late])),
    { archived: 0, existing: 0, withheld: 2 });
  assert.equal(await withheld(later, late), true);
  assert.deepEqual(await read(tx => capture.eligible(tx, later, [resent, late])), []);
  assert.deepEqual(await remove(deleted), { rawDeleted: 0 });
  assert.equal(await revision(), before + 1);

  assert.deepEqual(await archive(control, controlMessage), { archived: 1 });
  assert.equal(await withheld(control, controlMessage), false);
  assert.deepEqual((await pool.query("SELECT message_id FROM raw_messages WHERE user_id = $1", [scope.owner])).rows,
    [{ message_id: controlMessage.id }]);

  const empty = newEvent();
  const beforeEmptyDelete = await revision();
  assert.deepEqual(await remove(empty), { rawDeleted: 0 });
  assert.equal(await revision(), beforeEmptyDelete + 1);
  assert.equal(await allowed(empty), false);
  assert.deepEqual(await remove(empty), { rawDeleted: 0 });
  assert.equal(await revision(), beforeEmptyDelete + 1);
});

test("only an all-blank admitted outbox can recheck an empty selection in a deleted conversation", migrationDbTest, async t => {
  const { raw, capture, write } = await fixture(t);
  const deleted = newEvent();
  const original = message("The latch is brass.", 1);
  const claim = (event, batch) => write(tx => capture.claim(tx, event, batch, { leaseMs: 60_000 }));
  const recheck = (event, positions) => write(tx => capture.assertEligible(tx, event, positions));

  assert.deepEqual(await write(tx => capture.admit(tx, deleted, [original])), { status: "admitted" });
  assert.deepEqual(await write(tx => raw.deleteConversation(tx, scope, deleted)), { rawDeleted: 0 });
  const scrubbed = await claim(deleted, []);
  assert.equal(scrubbed.status, "claimed");
  await recheck(deleted, []);
  await assert.rejects(recheck(deleted, [0]), { code: "lineage_fenced" });
  assert.deepEqual((await write(tx => capture.finish(tx, scrubbed.token, []))).memories, []);

  const late = newEvent(deleted.sessionId);
  const fresh = message("The latch was replaced.", 2);
  assert.deepEqual(await write(tx => capture.admit(tx, late, [fresh])), { status: "admitted" });
  const freshClaim = await claim(late, [fresh]);
  assert.equal(freshClaim.status, "claimed");
  await assert.rejects(recheck(late, []), { code: "lineage_fenced" });
  await assert.rejects(recheck(late, [0]), { code: "lineage_fenced" });
  await assert.rejects(write(tx => capture.finish(tx, freshClaim.token, [{
    content: fresh.content, kind: "fact", confidence: 0.9, textHash: `sha256:${"a".repeat(64)}`,
    embedding: { model: "fixture", vector: [1, ...Array(1535).fill(0)] }, receipts: [],
  }])), { code: "lineage_fenced" });
});
