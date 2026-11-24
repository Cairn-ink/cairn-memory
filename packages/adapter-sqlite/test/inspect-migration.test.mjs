import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { join } from "node:path";
import { test } from "node:test";
import { createMemoryService } from "@cairn-ink/core/service";
import { openMemoryCore } from "../../../core/index.mjs";
import { openSqliteAdapter } from "../src/index.mjs";
import { migrateLegacyStore } from "../src/migrate/index.mjs";
import { editFixture, fixture, scratch } from "./legacy/fixtures.mjs";
import { admit, coreScope, createLegacyBackup, ok, personal, prepareInput, project } from "./migration-fixtures.mjs";

const clock = { async hmacHex(key, value) { return createHmac("sha256", key).update(value).digest("hex"); } };
const inspect = adapter => createMemoryService({ profile: "keyless-local", storage: adapter, clock }).inspect;
const mcpSource = { kind: "mcp", client: null, sessionId: null };
const from = (eventId, excerpt) => ({ client: "cairn-local-mcp", sessionId: "explicit-tool", eventId, role: "user", excerpt });
const timestamp = ms => new Date(ms).toISOString();

function wireMetadata({ scope, createdAtMs, updatedAtMs, text, ...metadata }) {
  const [scopeKind, projectId] = scope.namespace.split("\0");
  return {
    ...metadata, namespace: { ownerId: scope.owner, scope: scopeKind, projectId: projectId || null },
    createdAt: timestamp(createdAtMs), updatedAt: timestamp(updatedAtMs),
    ...(text !== undefined && { content: text }),
  };
}

function wireReceipts(receipts) {
  return receipts.map(({ createdAtMs, occurredAtMs, messageId, ...receipt }) => ({ ...receipt, createdAt: timestamp(createdAtMs) }));
}

test("migrated inspect matches the legacy body, qualification, procedural anchors and receipt cursors", async t => {
  const directory = scratch(t);
  const fixtureStore = await fixture(directory, 18);
  const engine = openMemoryCore({ path: fixtureStore.path });
  const scope = coreScope(personal);
  let detailed, listing, forgotten, corrected, memoryId, modelTaggedId;
  let legacyList, legacyReceipt, legacyTimeReceipt;
  try {
    assert.deepEqual(ok(engine.list({ namespace: personal })), { memories: [], nextCursor: null, exhausted: true });
    const disposable = admit(engine, "Synthetic forgotten fixture memory", personal);
    forgotten = disposable.id;
    ok(engine.forget({ namespace: personal, memoryId: forgotten, expectedRevision: disposable.revision }));
    const original = admit(engine, "An albatross wears a teal scarf.", personal);
    corrected = ok(engine.correct({ namespace: personal, memoryId: original.id, expectedRevision: original.revision,
      content: "An albatross wears an amber scarf.", kind: "fact",
      receipt: from("correction", "An albatross wears an amber scarf.") })).memory;

    const procedure = "Use the synthetic brass latch.";
    const item = ok(engine.admit({ namespace: personal, memory: { content: procedure, kind: "instruction" },
      receipts: [from("first-source", procedure), from("second-source", "The brass latch is visible.")],
      procedural: { anchors: [{ receiptIndex: 0, start: 0, end: 13 }] },
      qualification: { version: 1, slot: { subject: null, property: null, scope: null, applies: null },
        value: null, attribution: "direct", commitment: "unknown",
        anchors: [{ receiptIndex: 0, start: 0, end: 13, text: procedure.slice(0, 13), fields: ["attribution"] }] },
    })).memory;
    memoryId = item.id;
    modelTaggedId = ok(engine.admit({ namespace: project, memory: { content: procedure, kind: "instruction" },
      receipts: [from("model-source", procedure)],
      procedural: { anchors: [{ receiptIndex: 0, start: 0, end: 13 }] },
    })).memory.id;
    detailed = ok(engine.get({ namespace: personal, memoryId, includeQualification: true }));
    assert.ok(detailed.procedural);
    assert.ok(detailed.qualification);
    listing = ok(engine.list({ namespace: personal }));
    const firstList = ok(engine.list({ namespace: personal, limit: 1 }));
    legacyList = ok(engine.list({ namespace: personal, limit: 1, cursor: firstList.nextCursor }));
    legacyList.cursor = firstList.nextCursor;
    const firstReceipt = ok(engine.get({ namespace: personal, memoryId, receiptLimit: 1 }));
    legacyReceipt = ok(engine.get({ namespace: personal, memoryId, receiptLimit: 1,
      receiptCursor: firstReceipt.nextReceiptCursor }));
    legacyReceipt.cursor = firstReceipt.nextReceiptCursor;

    // This older anchor form is signed here independently of core's encoder.
    const [encoded] = firstReceipt.nextReceiptCursor.split(".");
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    const [anchor] = firstReceipt.receipts;
    payload.a = { createdAt: anchor.createdAt, id: anchor.id };
    legacyTimeReceipt = { data: Buffer.from(JSON.stringify(payload)).toString("base64url") };
  } finally {
    await engine.close();
  }

  editFixture(fixtureStore.path, db => {
    db.prepare("UPDATE procedural_tags SET origin = 'model' WHERE memory_id = ?").run(modelTaggedId);
    const { cursor_secret: secret } = db.prepare("SELECT cursor_secret FROM store_metadata").get();
    legacyTimeReceipt.cursor = legacyTimeReceipt.data + "." +
      createHmac("sha256", secret).update(legacyTimeReceipt.data).digest("base64url");
  });
  const input = prepareInput(directory, fixtureStore);
  await createLegacyBackup(input);
  assert.equal((await migrateLegacyStore(input)).sourceLayout, 18);

  const adapter = await openSqliteAdapter(input.destination);
  try {
    const get = inspect(adapter);
    const list = await get(scope, {});
    assert.deepEqual(list.memories.map(wireMetadata), listing.memories);
    const item = await get(scope, { memoryId, includeQualification: true });
    assert.deepEqual(wireMetadata(item.memory), detailed.memory);
    assert.deepEqual(wireReceipts(item.receipts), detailed.receipts);
    assert.deepEqual(item.procedural, detailed.procedural);
    assert.deepEqual(item.qualification, detailed.qualification);
    assert.deepEqual([item.placements, item.conflicts, item.exhausted, item.nextReceiptCursor], [[], [], true, null]);
    const inferred = await get(coreScope(project), { memoryId: modelTaggedId });
    assert.equal(inferred.procedural.origin, "inferred");

    const nextList = await get(scope, { cursor: legacyList.cursor, limit: 1 });
    assert.deepEqual(nextList.memories.map(wireMetadata), legacyList.memories);
    for (const receiptCursor of [legacyReceipt.cursor, legacyTimeReceipt.cursor]) {
      const next = await get(scope, { memoryId, receiptLimit: 1, receiptCursor });
      assert.deepEqual(wireReceipts(next.receipts), legacyReceipt.receipts);
      assert.equal(next.exhausted, true);
    }
    const afterCorrect = await get(scope, { memoryId: corrected.id, includeQualification: true });
    assert.equal(afterCorrect.memory.text, corrected.content);
    assert.equal(afterCorrect.memory.revision, corrected.revision);
    assert.equal(afterCorrect.qualification, null);
    await assert.rejects(get(scope, { memoryId: forgotten }), { code: "memory_not_found" });
  } finally {
    await adapter.close();
  }
});

test("a fresh SQLite store preserves signed continuations and receipt IDs across reopen", async t => {
  const path = join(scratch(t), "fresh.sqlite");
  const scope = { owner: "fixture-owner", namespace: null };
  const content = "The stored body survives reopen";
  const textHash = "sha256:" + createHash("sha256").update(content).digest("hex");
  const first = await openSqliteAdapter(path);
  let page, list, id;
  try {
    ({ id } = await first.uow.run(scope.owner, {}, tx => first.memories.insert(tx, scope, {
      text: content, kind: "fact", origin: "explicit", confidence: 1, textHash, source: mcpSource, embedding: null,
    }, ["first", "second"].map(messageId => ({ client: "fixture", sessionId: "fixture",
      messageId, role: "user", occurredAtMs: null, excerpt: "Stored " + messageId })), 2)));
    const older = "An earlier body to make the list paginated";
    await first.uow.run(scope.owner, {}, tx => first.memories.insert(tx, scope, {
      text: older, kind: "fact", origin: "explicit", confidence: 1,
      textHash: "sha256:" + createHash("sha256").update(older).digest("hex"), source: mcpSource, embedding: null,
    }, [], 1));
    page = await inspect(first)(scope, { memoryId: id, receiptLimit: 1 });
    list = await inspect(first)(scope, { limit: 1 });
    assert.equal(page.exhausted, false);
    assert.equal(list.exhausted, false);
  } finally {
    await first.close();
  }
  const reopened = await openSqliteAdapter(path);
  try {
    const read = inspect(reopened);
    const continued = await read(scope, { memoryId: id, receiptLimit: 1, receiptCursor: page.nextReceiptCursor });
    const original = await read(scope, { memoryId: id, receiptLimit: 1 });
    assert.deepEqual(original.receipts, page.receipts);
    assert.notEqual(continued.receipts[0].id, original.receipts[0].id);
    assert.equal(continued.exhausted, true);
    const listContinued = await read(scope, { limit: 1, cursor: list.nextCursor });
    assert.equal(listContinued.memories.length, 1);
    assert.equal(listContinued.exhausted, true);
  } finally {
    await reopened.close();
  }
});
