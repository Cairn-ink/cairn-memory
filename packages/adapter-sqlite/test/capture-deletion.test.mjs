import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createSqliteAdapter } from "../src/adapter.mjs";
import { receiptAddressDenial } from "../src/receipt-identity.mjs";
import { openStorage } from "../src/schema/open.mjs";
import { captureFixture } from "./capture-fixtures.mjs";
import { scratch, sha256, testAccess } from "./storage-fixtures.mjs";

const scope = { owner: "owner", namespace: "garden" };
const keyFor = (sessionId, target = scope) => ({ scope: target, client: "client", sessionId,
  eventId: `event-${target.namespace}-${sessionId}`, payloadDigest: sha256(sessionId) });
const message = (id, content) => ({ id, role: "user", content, occurredAtMs: 25 });
const deleted = [message("lantern", "Store the lantern under the stairs."),
  message("orchids", "Water the orchids on Mondays.")];
const control = message("cedar", "Plant the cedar by the fence.");
const write = (adapter, key, work) => adapter.uow.run(key.scope.owner, { pauseLock: true }, work);

async function beginCapture(adapter, key, messages) {
  const { capture, raw } = adapter;
  await write(adapter, key, async tx => {
    assert.deepEqual(await capture.admit(tx, key, messages), { status: "admitted" });
    await raw.recordLineage(tx, key, messages);
    assert.deepEqual(await raw.archive(tx, key, messages), { archived: messages.length });
  });
  return write(adapter, key, async tx => {
    const loaded = await capture.load(tx, key);
    const claim = await capture.claim(tx, key, loaded.messages, { leaseMs: 100 });
    assert.equal(claim.status, "claimed");
    const positions = await capture.eligible(tx, key, loaded.messages);
    assert.deepEqual(positions, [...messages.keys()]);
    await capture.assertEligible(tx, key, positions);
    const { token } = await capture.beginDispatch(tx, claim.token);
    return { token, positions, messages: loaded.messages };
  });
}

function modelItems({ client, sessionId }, messages) {
  return messages.map(({ id, role, occurredAtMs, content }) => ({ content, kind: "fact", confidence: 0.9,
    textHash: `sha256:${sha256(content.toLowerCase())}`, embedding: null,
    receipts: [{ client, sessionId, messageId: id, role, occurredAtMs }] }));
}

test("deletion after the dispatch recheck keeps stale capture text out of memory and Raw storage", async t => {
  const fixture = await captureFixture();
  t.after(fixture.close);
  const { adapter } = fixture;
  const { capture, raw } = adapter;
  const key = keyFor("deleted");
  const other = keyFor("unrelated");
  const loaded = await beginCapture(adapter, key, deleted);
  const unrelated = await beginCapture(adapter, other, [control]);

  // Commit after the pre-dispatch check and before the model sees the loaded batch.
  assert.deepEqual(await write(adapter, key, tx => raw.deleteConversation(tx, scope, key)), { rawDeleted: 2 });
  const blanked = await write(adapter, key, tx => capture.load(tx, key));
  assert.deepEqual(blanked.messages, deleted.map(item => ({ ...item, content: "" })));
  const outputs = modelItems(key, loaded.messages);

  const saved = await write(adapter, key, async tx => {
    const eligible = await capture.eligible(tx, key, loaded.messages);
    const positions = loaded.positions.filter(position => eligible.includes(position));
    if (positions.length) await capture.assertEligible(tx, key, positions);
    return capture.finish(tx, loaded.token, positions.map(position => outputs[position]));
  });
  // Exercise a finish-time archive with the original loaded copy independently of the source filter.
  const archived = await write(adapter, key, tx => raw.archive(tx, key, loaded.messages));
  const otherResult = await write(adapter, other, async tx => {
    assert.deepEqual(await capture.eligible(tx, other, unrelated.messages), unrelated.positions);
    await capture.assertEligible(tx, other, unrelated.positions);
    return capture.finish(tx, unrelated.token, modelItems(other, unrelated.messages));
  });
  assert.equal(otherResult.memories.length, 1);

  const state = await testAccess(fixture, scope, {}, db => ({
    memoryCount: db.prepare("SELECT count(*) AS count FROM cairn_memories").get().count,
    rawCount: db.prepare("SELECT count(*) AS count FROM cairn_raw_messages").get().count,
  }));
  await adapter.close();
  const bytes = readFileSync(fixture.path);
  assert.deepEqual({ saved: saved.memories.length, archived: archived.archived, ...state,
    deletedText: deleted.map(({ content }) => bytes.includes(content)), controlText: bytes.includes(control.content) },
  { saved: 0, archived: 0, memoryCount: 1, rawCount: 1, deletedText: [false, false], controlText: true });
});

test("eligibility withdraws a blanked slot or a slot with a changed proof", async t => {
  const fixture = await captureFixture();
  t.after(fixture.close);
  const { adapter } = fixture;
  const { capture } = adapter;
  const key = keyFor("changed");
  const loaded = await beginCapture(adapter, key, [...deleted, control]);
  const current = [{ ...deleted[0], content: "" }, { ...deleted[1], id: "changed-id" }, control];
  await testAccess(fixture, scope, { write: true }, db => {
    db.prepare("UPDATE cairn_capture_outbox SET messages = ? WHERE owner_id = ? AND client_key = ? AND event_key = ?")
      .run(JSON.stringify(current), scope.owner, JSON.stringify(key.client), JSON.stringify(key.eventId));
  });

  for (const messages of [loaded.messages, current]) {
    assert.deepEqual(await write(adapter, key, tx => capture.eligible(tx, key, messages)), [2]);
  }
  await assert.rejects(write(adapter, key, tx => capture.assertEligible(tx, key, [0])), { code: "suppressed" });
  await assert.rejects(write(adapter, key, tx => capture.assertEligible(tx, key, [1])), { code: "stale_admission" });
  await write(adapter, key, tx => capture.assertEligible(tx, key, [2]));
});

test("archive and import refuse a deleted session within its owner and namespace", async t => {
  const fixture = await captureFixture();
  t.after(fixture.close);
  const { adapter } = fixture;
  const { raw } = adapter;
  const key = keyFor("deleted");
  const archive = (target, items) => write(adapter, target, tx => raw.archive(tx, target, items));
  const importArchive = (target, items) => write(adapter, target,
    tx => raw.importArchive(tx, target.scope, target, items));
  assert.deepEqual(await archive(key, deleted), { archived: 2 });
  await write(adapter, key, tx => raw.deleteConversation(tx, scope, key));

  const batch = [...deleted, message("new-id", "A late turn from the deleted conversation.")];
  assert.deepEqual(await archive(key, batch), { archived: 0 });
  assert.deepEqual(await importArchive(key, batch), { archived: 0, existing: 0, withheld: batch.length });
  for (const target of [{ ...scope, namespace: "other-garden" }, { ...scope, owner: "other-owner" }]) {
    const other = keyFor(key.sessionId, target);
    assert.deepEqual(await archive(other, deleted.slice(0, 1)), { archived: 1 });
    assert.deepEqual(await importArchive(other, deleted.slice(1)), { archived: 1, existing: 0, withheld: 0 });
  }
});

for (const legacyRawHashing of [false, true]) {
  test(`Raw writes honor a recorded ${legacyRawHashing ? "migrated" : "native"} message tombstone`, async t => {
    const { path, remove } = scratch();
    const storage = await openStorage(path);
    const adapter = createSqliteAdapter({ ...storage, legacyRawHashing });
    t.after(async () => {
      try {
        await adapter.close();
      } finally {
        remove();
      }
    });
    const key = keyFor("older-deletion");
    const sessionId = legacyRawHashing ? "legacy-raw:" + adapter.hashSessionKey(scope, key.client, key.sessionId) : key.sessionId;
    await testAccess({ adapter, port: storage.port }, scope, { write: true }, db => {
      db.prepare("INSERT INTO cairn_legacy_denials VALUES (?, ?, ?)")
        .run(scope.owner, JSON.stringify(scope.namespace), receiptAddressDenial({ ...key, sessionId, messageId: deleted[0].id }));
    });

    await write(adapter, key, async tx => {
      assert.equal(await adapter.raw.archiveAllowed(tx, key), true);
      assert.deepEqual(await adapter.raw.archive(tx, key, [deleted[0], control]), { archived: 1 });
      assert.deepEqual(await adapter.raw.importArchive(tx, scope, key, deleted),
        { archived: 1, existing: 0, withheld: 1 });
    });
  });
}
