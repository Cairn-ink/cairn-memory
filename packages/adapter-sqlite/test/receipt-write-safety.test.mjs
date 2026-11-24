import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { openSqliteAdapter } from "../src/index.mjs";
import { migrateLegacyStore } from "../src/migrate/index.mjs";
import { scratch as legacyScratch } from "./legacy/fixtures.mjs";
import { coreScope, createLegacyBackup, service } from "./migration-fixtures.mjs";
import { seedRawDeletion } from "./raw-migration-fixtures.mjs";
import { fixture, scratch, seedFact } from "./storage-fixtures.mjs";

const scope = { owner: "writer", namespace: "notes" };
const source = { kind: "mcp", client: null, sessionId: null };
const text = "Synthetic evidence from a terminal message";
const receipt = { client: "terminal", sessionId: "thread", messageId: "message", role: "user", occurredAtMs: 10 };

function read(adapter, scope, work) {
  return adapter.uow.run(scope.owner, { readOnly: true }, work);
}

function index(adapter, scope) {
  return read(adapter, scope, tx => adapter.memories.indexRevision(tx));
}

test("receipt withholding uses scoped Raw fences and tombstones independently of the excerpt", async t => {
  const { adapter, close } = await fixture();
  t.after(close);
  const { raw, suppressions, uow } = adapter;
  const fenced = { ...receipt, sessionId: "fenced", messageId: "unarchived" };
  await uow.run(scope.owner, { pauseLock: true }, async tx => {
    const archive = await raw.importArchive(tx, scope, receipt,
      [{ id: receipt.messageId, role: receipt.role, occurredAtMs: receipt.occurredAtMs, content: text }]);
    assert.equal(archive.archived, 1);
    assert.equal(await suppressions.receiptWithheld(tx, scope, { ...receipt, excerpt: text }), false);
    assert.deepEqual(await raw.deleteConversation(tx, scope, receipt), { rawDeleted: 1 });
    await raw.fenceSession(tx, scope, fenced);
  });
  for (const target of [scope, { ...scope, owner: "another-writer" }, { ...scope, namespace: "other-notes" }]) {
    for (const input of [receipt, fenced]) {
      assert.equal(await read(adapter, target, tx => suppressions.receiptWithheld(tx, target,
        { ...input, excerpt: "Reworded synthetic evidence" })), target === scope);
    }
  }
});

test("a hidden window withholds both unknown-time and archived in-window receipts", async t => {
  const { adapter, close } = await fixture();
  t.after(close);
  await adapter.uow.run(scope.owner, { pauseLock: true }, tx => adapter.raw.importArchive(tx, scope, receipt,
    [{ id: receipt.messageId, role: receipt.role, occurredAtMs: receipt.occurredAtMs, content: text }]));
  await seedFact(adapter, { ...scope, actionId: "hide-window", origin: "forget", kind: "window", client: receipt.client,
    window: { startMs: 5, endMs: 15 }, unknownTime: true });
  const start = await index(adapter, scope);
  const core = service(adapter);
  for (const input of [{ ...receipt, sessionId: "unknown", occurredAtMs: null }, { ...receipt, occurredAtMs: 20 }]) {
    const result = await core.save(scope, text, source, "fact", { receipt: input });
    assert.deepEqual(result, { status: "suppressed", indexRevision: start });
    assert.equal(await index(adapter, scope), start);
  }
  assert.equal((await core.save(scope, text, source, "fact", {
    receipt: { ...receipt, sessionId: "outside", occurredAtMs: 20 },
  })).status, "saved");
});

test("the legacy deletion fence suppresses a receipt save with identical closed database bytes", async t => {
  const { input, deleted } = await seedRawDeletion(legacyScratch(t));
  await createLegacyBackup(input);
  await migrateLegacyStore(input);
  const target = coreScope(deleted.request.namespace);
  const { client, sessionId, messages: [message] } = deleted.request;
  const incoming = { client, sessionId, messageId: message.id, role: message.role,
    occurredAtMs: Date.parse(message.occurredAt) };
  const before = readFileSync(input.destination);
  const adapter = await openSqliteAdapter(input.destination);
  try {
    const start = await index(adapter, target);
    assert.deepEqual(await service(adapter).save(target, text, source, "fact", { receipt: incoming }),
      { status: "suppressed", indexRevision: start });
    assert.equal(await index(adapter, target), start);
  } finally {
    await adapter.close();
  }
  assert.deepEqual(readFileSync(input.destination), before);
});

test("a conflicting explicit excerpt replay preserves the receipt, index and closed database", async t => {
  const file = scratch();
  t.after(file.remove);
  const original = await openSqliteAdapter(file.path);
  let id, start, inspected;
  try {
    const core = service(original);
    const saved = await core.save(scope, text, source, "fact", { receipt });
    assert.equal(saved.status, "saved");
    assert.equal((await core.save(scope, text, source, "fact", { receipt })).status, "duplicate");
    id = saved.item.id;
    start = await index(original, scope);
    inspected = await core.inspect(scope, { memoryId: id });
    assert.equal(inspected.receipts[0].excerpt, text);
  } finally {
    await original.close();
  }
  const before = readFileSync(file.path);
  const adapter = await openSqliteAdapter(file.path);
  try {
    const core = service(adapter);
    assert.equal((await core.save(scope, text.toUpperCase(), source, "fact", { receipt })).status, "invalid");
    assert.equal(await index(adapter, scope), start);
    assert.deepEqual(await core.inspect(scope, { memoryId: id }), inspected);
  } finally {
    await adapter.close();
  }
  assert.deepEqual(readFileSync(file.path), before);
});
