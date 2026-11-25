import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { allDigests, factIncarnationBody } from "@cairn-ink/core";
import { captureFixture } from "./capture-fixtures.mjs";
import { sha256, testAccess } from "./storage-fixtures.mjs";

const scope = { owner: "owner", namespace: null };
const captureKey = { scope, client: "client", sessionId: "session", eventId: "event", payloadDigest: sha256("event") };
const message = { id: "message", role: "user", content: "A greenhouse with rhubarb and basil.", occurredAtMs: 25 };
const receipt = { client: captureKey.client, sessionId: captureKey.sessionId, messageId: message.id,
  role: message.role, occurredAtMs: message.occurredAtMs };
const item = (content, receipts) => ({
  content, kind: "fact", confidence: 0.8, textHash: "sha256:" + sha256(content), embedding: null, receipts,
});
const write = (adapter, work) => adapter.uow.run(scope.owner, { pauseLock: true }, work);

async function setup(t) {
  const fixture = await captureFixture();
  t.after(fixture.close);
  return fixture;
}

async function seedDenial(fixture) {
  const { client, sessionId, messageId, role } = receipt;
  const address = sha256(JSON.stringify(["receipt-source-address-v1", client, sessionId, messageId, role]));
  await testAccess(fixture, scope, { write: true }, db => db.prepare("INSERT INTO cairn_legacy_denials VALUES (?, ?, ?)")
    .run(scope.owner, JSON.stringify(scope.namespace), "rs1:a:" + address));
}

test("a captured memory can be forgotten after deleting its archived conversation", async t => {
  const fixture = await setup(t);
  const { adapter } = fixture;
  const { raw, capture, memories, spanLineage, suppressions } = adapter;
  const output = item("Rhubarb grows in the greenhouse.", [receipt]);
  const id = await write(adapter, async tx => {
    await raw.archive(tx, captureKey, [message]);
    const { token } = await capture.claim(tx, captureKey, [message], { leaseMs: 100 });
    await capture.assertEligible(tx, captureKey, [0]);
    const result = await capture.finish(tx, token, [output]);
    return result.memories[0].id;
  });

  const stored = () => testAccess(fixture, scope, {}, db => ({ ...db.prepare(
    "SELECT deleted, body, text_hash, legacy_hash FROM cairn_memories WHERE id = ?").get(id) }));
  assert.ok((await stored()).legacy_hash);
  await write(adapter, async tx => {
    assert.equal((await spanLineage.resolveSpans(tx, scope, id)).length, 1);
    assert.equal((await raw.deleteConversation(tx, scope, captureKey)).rawDeleted, 1);
  });

  const digests = await allDigests(output.content, null);
  const fact = { ...scope, kind: "text", origin: "forget", mode: "exact", actionId: "forget-plant", text: { digests } };
  const incarnation = sha256(factIncarnationBody(fact));
  await write(adapter, async tx => {
    assert.ok(await memories.get(tx, scope, id));
    const spans = await spanLineage.resolveSpans(tx, scope, id);
    assert.deepEqual(spans, []);
    const persisted = await suppressions.writeFact(tx, fact, incarnation);
    await raw.fenceSession(tx, scope, captureKey);
    await raw.purgeWithheld(tx, scope, [{ fact, incarnation, ...persisted }]);
    assert.equal(await memories.erase(tx, scope, id), true);
  });

  assert.deepEqual(await stored(), { deleted: 1, body: null, text_hash: null, legacy_hash: null });
  await adapter.uow.run(scope.owner, { readOnly: true }, async tx => {
    assert.equal(await memories.get(tx, scope, id), null);
  });
});

test("span resolution checks surviving evidence even when another receipt points to no Raw row", async t => {
  const { adapter } = await setup(t);
  const { raw, capture, spanLineage } = adapter;
  const missing = { ...receipt, messageId: "unarchived", role: "user" };
  const wrongRole = { ...receipt, role: "assistant" };
  const [partial, mismatched] = await write(adapter, async tx => {
    await raw.archive(tx, captureKey, [message]);
    const { token } = await capture.claim(tx, captureKey, [message, { ...message, id: missing.messageId }], { leaseMs: 100 });
    await capture.assertEligible(tx, captureKey, [0, 1]);
    const result = await capture.finish(tx, token, [
      item("Valid surviving receipt", [missing, receipt]), item("Conflicting surviving receipt", [missing, wrongRole]),
    ]);
    return result.memories;
  });
  await adapter.uow.run(scope.owner, { readOnly: true }, async tx => {
    const spans = await spanLineage.resolveSpans(tx, scope, partial.id);
    assert.deepEqual(spans.map(({ messageKey, contentDigest }) => [messageKey, contentDigest]), [[message.id, sha256(message.content)]]);
    await assert.rejects(spanLineage.resolveSpans(tx, scope, mismatched.id), { code: "raw_lineage_unavailable" });
  });
});

test("a denied capture item never reaches storage and the allowed items still finish", async t => {
  const fixture = await setup(t);
  const { adapter } = fixture;
  const { capture } = adapter;
  const denied = "A violet weathervane with three brass stars";
  const allowed = "A second, allowed memory";
  const allowedReceipt = { ...receipt, messageId: "allowed" };
  const batch = [message, { ...message, id: allowedReceipt.messageId }];
  const { token } = await write(adapter, tx => capture.claim(tx, captureKey, batch, { leaseMs: 100 }));
  await seedDenial(fixture);

  const result = await write(adapter, async tx => {
    await capture.assertEligible(tx, captureKey, [0, 1]);
    return capture.finish(tx, token, [
      item(denied, [receipt]), item(allowed, [allowedReceipt]), item(allowed, [receipt]),
    ]);
  });
  const state = await testAccess(fixture, scope, {}, db => {
    const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all();
    return {
      textFound: tables.filter(({ name }) => db.prepare(`SELECT * FROM "${name}"`).all()
        .some(row => Object.values(row).some(value => typeof value === "string" && value.includes(denied)))),
      rows: db.prepare("SELECT id, json_extract(body, '$.text') AS text FROM cairn_memories").all()
        .map(row => ({ ...row })),
      receipts: db.prepare("SELECT body FROM cairn_receipts").all().map(({ body }) => JSON.parse(body)),
    };
  });
  await adapter.close();
  const finishedBytes = readFileSync(fixture.path);
  assert.equal(finishedBytes.includes(denied), false);
  assert.deepEqual(state.textFound, []);
  assert.equal(result.suppressedCount, 2);
  assert.equal(result.duplicateCount, 0);
  assert.deepEqual(result.memories.map(({ outcome }) => outcome), ["inserted"]);
  assert.deepEqual(state.rows, [{ id: result.memories[0].id, text: allowed }]);
  assert.deepEqual(state.receipts, [allowedReceipt]);

  const reopened = await fixture.reopen();
  const replay = await write(reopened, tx => reopened.capture.claim(tx, captureKey, [message], { leaseMs: 100 }));
  assert.equal(replay.status, "rawReplay");
  assert.deepEqual(replay.result, result);
  await reopened.close();
  assert.deepEqual(readFileSync(fixture.path), finishedBytes);
});

test("plain insert rejects denied receipts without changing the closed database", async t => {
  const fixture = await setup(t);
  await seedDenial(fixture);
  await fixture.adapter.close();
  const original = readFileSync(fixture.path);
  const adapter = await fixture.reopen();
  const row = { kind: "fact", confidence: 1, origin: "explicit", embedding: null, text: "A painted sundial",
    textHash: "sha256:" + sha256("A painted sundial"), source: { kind: "mcp", client: null, sessionId: null } };
  await assert.rejects(write(adapter, tx => adapter.memories.insert(tx, scope, row, [receipt], 1_000)), { code: "suppressed" });
  await adapter.close();
  assert.deepEqual(readFileSync(fixture.path), original);
});
