import assert from "node:assert/strict";
import { chmodSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { openMemoryCore } from "../../../core/index.mjs";
import { openSqliteAdapter } from "../src/index.mjs";
import { migrateLegacyStore } from "../src/migrate/index.mjs";
import { installContextReadSchema } from "../src/schema/context-read.mjs";
import { installInspectSchema } from "../src/schema/inspect.mjs";
import { INITIALIZE_STORE, SQLITE_PHYSICAL_VERSION, STORAGE_SCHEMA } from "../src/schema/layout.mjs";
import { fixture as legacyFixture, scratch as legacyScratch } from "./legacy/fixtures.mjs";
import { coreScope, createLegacyBackup, ok, personal, prepareInput } from "./migration-fixtures.mjs";
import { fixture, scratch, sha256, testAccess } from "./storage-fixtures.mjs";

const scope = { owner: "writer", namespace: "notes" };
const otherNamespace = { ...scope, namespace: "other" };
const otherOwner = { ...scope, owner: "another-writer" };
const receipt = {
  client: "terminal", sessionId: "session", messageId: "message", role: "user", occurredAtMs: 1,
  excerpt: "Fixture source excerpt 🌱",
};
const write = (adapter, work) => adapter.uow.run(scope.owner, { pauseLock: true }, work);
const read = (adapter, selection, work) => adapter.uow.run(selection.owner, { readOnly: true }, work);

function row(text) {
  return { text, textHash: "sha256:" + sha256(text), kind: "instruction", origin: "explicit", confidence: 1,
    source: { kind: "mcp", client: null, sessionId: null }, embedding: null };
}

test("run start stays fixed while the commit revision tracks every advance", async t => {
  const { adapter, close } = await fixture();
  t.after(close);
  const { memories, raw } = adapter;
  const session = { client: "terminal", sessionId: "archive" };
  const message = id => ({ id, role: "user", occurredAtMs: 1, content: "Archive fixture" });

  await write(adapter, async tx => {
    // The first access to the run revision follows the first write.
    await raw.importArchive(tx, scope, session, [message("first")]);
    assert.equal(await memories.indexRevision(tx), 0);
    assert.equal(await memories.committedIndexRevision(tx), 1);
    await memories.insert(tx, scope, row("First instruction"), [], 1);
    await memories.insert(tx, otherNamespace, row("Second instruction"), [], 1);
    assert.equal(await memories.committedIndexRevision(tx), 2);
    await raw.importArchive(tx, scope, session, [message("second")]);
    await raw.importArchive(tx, scope, session, [message("second")]);
    assert.equal(await memories.indexRevision(tx), 0);
    assert.equal(await memories.committedIndexRevision(tx), 3);
  });

  await assert.rejects(write(adapter, async tx => {
    assert.equal(await memories.indexRevision(tx), 3);
    await memories.insert(tx, scope, row("Rolled-back instruction"), [], 2);
    assert.equal(await memories.committedIndexRevision(tx), 4);
    throw new Error("rollback fixture");
  }), /rollback fixture/u);

  await read(adapter, scope, async tx => {
    assert.equal(await memories.indexRevision(tx), 3);
    assert.equal(await memories.committedIndexRevision(tx), 3);
  });
  await read(adapter, otherOwner, async tx => {
    assert.equal(await memories.indexRevision(tx), 0);
    assert.equal(await memories.committedIndexRevision(tx), 0);
  });
});

test("null embeddings persist and receipt-only touches return stored IDs in input order", async t => {
  const opened = await fixture();
  t.after(opened.close);
  const { adapter } = opened;
  const { capabilities, memories, inspect } = adapter;
  assert.equal(capabilities.embeddingRequiredOnInsert, false);
  assert.equal(capabilities.receiptAttachAdvancesRevision, true);
  const input = row("Use the fixture instructions");
  const { id, receiptIds: [firstId, repeatedId] } = await write(adapter, tx =>
    memories.insert(tx, scope, input, [receipt, receipt], 1));
  assert.match(firstId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  assert.equal(repeatedId, firstId);
  const second = { ...receipt, messageId: "second", excerpt: "Second fixture excerpt" };
  const touch = receipts => write(adapter, tx => memories.touchDuplicate(tx, scope, id, receipts, { confidence: 1 }, 1));
  const attached = await touch([second, receipt, second]);
  const [secondId] = attached.receiptIds;
  assert.notEqual(secondId, firstId);
  assert.deepEqual(attached, { outcome: "changed", revision: 2, receiptIds: [secondId, firstId, secondId] });
  assert.deepEqual(await touch([receipt, second]), { outcome: "touched", revision: 2, receiptIds: [firstId, secondId] });
  const persisted = await testAccess(opened, scope, {}, db => db.prepare(
    "SELECT json_type(body, '$.embedding') AS embedding_type FROM cairn_memories WHERE id = ?"
  ).get(id));
  assert.equal(persisted.embedding_type, "null");
  await read(adapter, scope, async tx => {
    const memory = await memories.get(tx, scope, id);
    assert.equal(memory.embedding, null);
    assert.equal(memory.revision, 2);
    assert.equal(memory.updatedAtUs, 1000n);
    const { item } = await inspect.item(tx, scope, id, { limit: 10 });
    const byId = new Map(item.receipts.map(value => [value.id, value.excerpt]));
    assert.deepEqual(byId, new Map([[firstId, receipt.excerpt], [secondId, second.excerpt]]));
  });
});

test("procedural anchors stay scoped, roll back, clear on correct and leave no bytes after forget", async t => {
  const file = scratch();
  t.after(file.remove);
  const adapter = await openSqliteAdapter(file.path);
  let forgotten;
  try {
    const { capabilities, memories, proceduralTags, inspect, raw } = adapter;
    assert.equal(capabilities.proceduralTags, true);
    const tagged = (text, source) => write(adapter, async tx => {
      const start = await memories.indexRevision(tx);
      const { id, receiptIds: [receiptId] } = await memories.insert(tx, scope, row(text), [source], 1);
      const tag = { positive: true, origin: "explicit",
        anchors: [{ receiptId, digest: sha256(source.excerpt), start: 0, end: source.excerpt.length }] };
      await proceduralTags.write(tx, scope, id, tag);
      assert.equal(await memories.committedIndexRevision(tx), start + 1);
      assert.deepEqual(await proceduralTags.read(tx, scope, id), { tagRevision: 1, ...tag });
      return { id, receiptId, tag };
    });
    forgotten = await tagged("Instruction for forget", receipt);
    const { id, tag } = forgotten;
    const corrected = await tagged("Instruction for correct", { ...receipt, messageId: "correct",
      sessionId: "correct-session", excerpt: "A different excerpt" });
    await read(adapter, scope, async tx => {
      assert.equal(await proceduralTags.read(tx, otherNamespace, id), null);
      const { item } = await inspect.item(tx, scope, id, { limit: 10 });
      assert.deepEqual(item.procedural, { procedural: true, origin: "explicit", tagRevision: 1, anchors: tag.anchors });
      assert.equal(item.receipts[0].excerpt, receipt.excerpt);
    });
    assert.equal(await read(adapter, otherOwner, tx => proceduralTags.read(tx, otherOwner, id)), null);
    await assert.rejects(write(adapter, tx => proceduralTags.write(tx, scope, corrected.id, tag)),
      { code: "invalid_input" });
    const splitAnchor = { ...tag.anchors[0], start: receipt.excerpt.length - 1 };
    await assert.rejects(write(adapter, tx => proceduralTags.write(tx, scope, id, { ...tag, anchors: [splitAnchor] })),
      { code: "invalid_input" });

    await assert.rejects(write(adapter, async tx => {
      await proceduralTags.clear(tx, scope, id);
      assert.deepEqual(await proceduralTags.read(tx, scope, id), {
        positive: false, origin: null, tagRevision: 2, anchors: [],
      });
      throw new Error("rollback tag");
    }), /rollback tag/u);
    assert.deepEqual(await read(adapter, scope, tx => proceduralTags.read(tx, scope, id)), { tagRevision: 1, ...tag });

    await write(adapter, async tx => {
      assert.deepEqual(await memories.replaceContent(tx, scope, corrected.id, 1, row("Corrected fixture"), null, 2),
        { outcome: "changed", revision: 2 });
      assert.deepEqual(await proceduralTags.read(tx, scope, corrected.id), {
        positive: false, origin: null, tagRevision: 2, anchors: [],
      });
      await raw.fenceSession(tx, scope, receipt);
      assert.equal(await proceduralTags.read(tx, scope, id), null);
      assert.equal((await inspect.item(tx, scope, id, { limit: 10 })).item.procedural, null);
    });
    await write(adapter, async tx => {
      assert.equal(await memories.erase(tx, scope, id), true);
      assert.equal(await proceduralTags.read(tx, scope, id), null);
      assert.equal((await inspect.item(tx, scope, id, { limit: 10 })).item, null);
    });
  } finally {
    await adapter.close();
  }
  const reopened = await openSqliteAdapter(file.path);
  try {
    assert.equal(await read(reopened, scope, tx => reopened.proceduralTags.read(tx, scope, forgotten.id)), null);
  } finally {
    await reopened.close();
  }
  const bytes = readFileSync(file.path);
  for (const value of [receipt.excerpt, forgotten.receiptId, forgotten.tag.anchors[0].digest, "Instruction for forget"]) {
    assert.equal(bytes.includes(value), false, "erased evidence survived in the closed database");
  }
});

for (const version of [SQLITE_PHYSICAL_VERSION - 1, SQLITE_PHYSICAL_VERSION]) {
  test(`storage refuses layout ${version} without the procedural table and preserves its bytes`, async t => {
    const file = scratch();
    t.after(file.remove);
    const db = new DatabaseSync(file.path);
    try {
      db.exec(STORAGE_SCHEMA + INITIALIZE_STORE);
      installInspectSchema(db);
      installContextReadSchema(db);
      db.exec(`DROP TABLE cairn_procedural_tags; PRAGMA user_version = ${version};`);
    } finally {
      db.close();
    }
    chmodSync(file.path, 0o600);
    const original = readFileSync(file.path);
    await assert.rejects(openSqliteAdapter(file.path).then(adapter => adapter.close()), { code: "storage_error" });
    assert.deepEqual(readFileSync(file.path), original);
  });
}

test("a migrated procedural tag keeps its revision and uses the original receipt ID", async t => {
  const directory = legacyScratch(t);
  const legacy = await legacyFixture(directory, 18);
  const engine = openMemoryCore({ path: legacy.path });
  const text = "Use the migrated fixture instructions";
  let saved;
  try {
    const source = { client: receipt.client, sessionId: receipt.sessionId, eventId: receipt.messageId,
      role: receipt.role, excerpt: text };
    const { memory } = ok(engine.admit({ namespace: personal, memory: { content: text, kind: "instruction" },
      receipts: [source], procedural: { anchors: [{ receiptIndex: 0, start: 0, end: text.length }] } }));
    saved = ok(engine.get({ namespace: personal, memoryId: memory.id }));
  } finally {
    await engine.close();
  }

  const input = prepareInput(directory, legacy);
  await createLegacyBackup(input);
  await migrateLegacyStore(input);
  const adapter = await openSqliteAdapter(input.destination);
  try {
    const selection = coreScope(personal);
    const { id, revision, confidence, updatedAt } = saved.memory;
    const { tagRevision, origin, anchors } = saved.procedural;
    const [stored] = saved.receipts;
    const { memories, proceduralTags } = adapter;
    await adapter.uow.run(selection.owner, {}, async tx => {
      assert.deepEqual(await proceduralTags.read(tx, selection, id), { positive: true, tagRevision, origin, anchors });
      const result = await memories.touchDuplicate(tx, selection, id, [{ ...receipt, excerpt: text }],
        { confidence }, Date.parse(updatedAt));
      assert.deepEqual(result, { outcome: "touched", revision, receiptIds: [stored.id] });
      await proceduralTags.write(tx, selection, id, { positive: true, origin, anchors });
      assert.equal((await proceduralTags.read(tx, selection, id)).tagRevision, tagRevision + 1);
    });
  } finally {
    await adapter.close();
  }
});
