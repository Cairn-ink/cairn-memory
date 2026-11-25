import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { allDigests, assertAdapterCapabilities } from "@cairn-ink/core";
import { createMemoryAdapter } from "../../adapter-memory/src/index.mjs";
import { openSqliteAdapter, SQLITE_PHYSICAL_VERSION } from "../src/index.mjs";
import { migrateLegacyStore } from "../src/migrate/index.mjs";
import { PLACEMENT_RELATION_TABLES } from "../src/schema/placement-relations.mjs";
import { editFixture, fixture } from "./legacy/fixtures.mjs";
import { createLegacyBackup, prepareInput, service } from "./migration-fixtures.mjs";
import { scratch, seedFact, sha256 } from "./storage-fixtures.mjs";

const scope = { owner: "synthetic-owner", namespace: "synthetic-scope" };
const otherScope = { ...scope, namespace: "other-synthetic-scope" };
const flags = { placement: true, supersession: true, conflictEdges: true };
const page = { cursor: null, limit: 10 };
const session = { client: "synthetic-client", sessionId: "synthetic-session" };
const source = { kind: "mcp", client: null, sessionId: null };

async function row(text) {
  const digests = await allDigests(text, null);
  return { text, textHash: "sha256:" + digests[0].value, digests, kind: "fact", origin: "explicit",
    confidence: 1, embedding: null, source };
}

const write = (adapter, work, target = scope) => adapter.uow.run(target.owner, { pauseLock: true }, work);
const read = (adapter, work, target = scope) => adapter.uow.run(target.owner, { readOnly: true }, work);
const guard = ({ id, revision }) => ({ memoryId: id, revision });
const item = ({ id }, parentIds = [], title) => ({ memoryId: id, parentIds,
  ...(title && { newL1: { title, parentL2Ids: [], newL2Title: title + " parent" } }) });
const edge = (left, right) => ({ left, right, relation: "contradicts", source: "explicit-hint" });
const insert = async (adapter, text, { receipts = [], target = scope } = {}) => {
  const content = await row(text);
  return write(adapter, tx => adapter.memories.insert(tx, target, content, receipts, 10), target);
};

async function apply(adapter, sources, items, target = scope) {
  return write(adapter, async tx => {
    const { indexRevision } = await adapter.placement.catalog(tx, target, page);
    return adapter.placement.applyPlacement(tx, target, { memoryRevisions: sources.map(guard), indexRevision }, { items });
  }, target);
}

test("each optional store is independently gated and card placement remains unavailable", async t => {
  const { path, remove } = scratch();
  t.after(remove);
  for (const [flag, port] of [["placement", "placement"], ["supersession", "supersession"], ["conflictEdges", "conflicts"]]) {
    const adapter = await openSqliteAdapter(path, { capabilities: { [flag]: true } });
    try {
      assert.doesNotThrow(() => assertAdapterCapabilities(adapter));
      for (const name of ["placement", "supersession", "conflicts"]) assert.equal(Boolean(adapter[name]), name === port);
      assert.equal(adapter.capabilities.documentCards, false);
      if (adapter.placement) {
        assert.deepEqual(await read(adapter, tx => adapter.placement.pendingCards(tx, scope, { limit: 1 })), []);
        await assert.rejects(write(adapter, tx => adapter.placement.dropCard(tx, scope, "synthetic-card")),
          { code: "capability_unavailable" });
      }
    } finally {
      await adapter.close();
    }
  }
});

test("index revision advances match the memory adapter across changing writes, no-ops and rollback", async t => {
  const { path, remove } = scratch();
  const capabilities = { ...flags, inspect: true, rawArchive: true, rawSpans: true, rawWindowHide: true,
    receiptAttachAdvancesRevision: true, proceduralTags: true };
  const now = () => 1_000;
  const memory = createMemoryAdapter({ capabilities, now });
  const sqlite = await openSqliteAdapter(path, { capabilities, now });
  t.after(async () => {
    try { await sqlite.close(); }
    finally { remove(); }
  });

  async function trace(adapter) {
    const { memories, placement, conflicts, supersession } = adapter;
    const values = [];
    const record = async () => values.push(await read(adapter, tx => memories.indexRevision(tx)));
    await record();
    const a = await insert(adapter, "Revision source A");
    const b = await insert(adapter, "Revision source B");
    await record();
    const { createdTopics } = await apply(adapter, [a, b], [item(a, [], "Revision topic"), item(b)]);
    const child = createdTopics.find(({ level }) => level === "L1").id;
    await record();
    await apply(adapter, [a], [item(a, [child])]);
    await record();
    await write(adapter, async tx => {
      const { indexRevision } = await placement.catalog(tx, scope, page);
      await placement.applyPlacement(tx, scope, { memoryRevisions: [guard(b)], indexRevision }, { items: [item(b, [child])] });
      assert.deepEqual(await conflicts.insert(tx, scope, edge(b, a), 10), { inserted: true });
      assert.equal(await memories.indexRevision(tx), indexRevision);
      assert.equal(await memories.committedIndexRevision(tx), indexRevision + 1);
      assert.equal((await placement.catalog(tx, scope, page)).indexRevision, indexRevision);
    });
    await record();
    await write(adapter, tx => conflicts.insert(tx, scope, edge(a, b), 10));
    await record();
    await write(adapter, tx => conflicts.invalidate(tx, scope, a.id));
    await record();
    await write(adapter, tx => conflicts.invalidate(tx, scope, a.id));
    await record();
    await assert.rejects(write(adapter, async tx => {
      await conflicts.insert(tx, scope, edge(a, b), 10);
      await supersession.record(tx, scope, { previous: a, replacement: b }, [], 10);
      // A duplicate record fails against state. Dropping its rejection still rolls back the unit.
      void supersession.record(tx, scope, { previous: a, replacement: b }, [], 10);
    }), { code: "invalid_ref" });
    await record();
    assert.deepEqual(await read(adapter, tx => conflicts.list(tx, scope, a.id)), []);
    await write(adapter, tx => placement.markFailed(tx, scope, [a.id], "model_unavailable"));
    await record();
    await write(adapter, tx => placement.dropMemory(tx, scope, a.id));
    await record();
    await write(adapter, async tx => {
      await supersession.record(tx, scope, { previous: a, replacement: b }, [], 10);
      await supersession.markHistorical(tx, scope, a.id, 10);
    });
    await record();
    return values;
  }

  const expected = await trace(memory);
  assert.deepEqual(expected, [0, 2, 3, 3, 4, 4, 5, 5, 5, 5, 6, 7]);
  assert.deepEqual(await trace(sqlite), expected);
});

for (const mode of ["forget", "correct", "source suppression", "forgotten source", "Raw deletion"]) {
  test(`${mode} withholds placement, title and conflicts across reopen and scrubs the closed file`, async t => {
    const { path, remove } = scratch();
    t.after(remove);
    const marker = "Synthetic " + mode + " marigold witness";
    const options = { capabilities: flags };
    let adapter = await openSqliteAdapter(path, options);
    try {
      const raw = mode === "Raw deletion";
      const message = { id: "synthetic-source", role: "user", occurredAtMs: 1, content: marker };
      const receipt = { ...session, messageId: message.id, role: message.role, occurredAtMs: message.occurredAtMs };
      if (raw) {
        await write(adapter, tx => adapter.raw.archive(tx, { ...session, scope, eventId: "synthetic-event",
          payloadDigest: sha256(marker) }, [message]));
      }
      const derived = raw || mode === "source suppression" || mode === "forgotten source";
      const lost = await insert(adapter, derived ? "Source-derived memory" : marker, { receipts: derived ? [receipt] : [] });
      const authority = mode === "forgotten source"
        ? await insert(adapter, "Memory sharing the source address", { receipts: [receipt] }) : null;
      const retained = await insert(adapter, "Retained member");
      const control = await insert(adapter, "Other namespace member", { target: otherScope, receipts: [receipt] });
      const otherOwner = { ...scope, owner: "other-synthetic-owner" };
      const independent = await insert(adapter, "Other owner member", { target: otherOwner, receipts: [receipt] });
      await apply(adapter, [control], [item(control, [], "Other namespace title")], otherScope);
      await apply(adapter, [independent], [item(independent, [], "Other owner title")], otherOwner);
      const { createdTopics } = await apply(adapter, [lost, retained], [item(lost, [], marker), item(retained)]);
      const child = createdTopics.find(({ level }) => level === "L1").id;
      await apply(adapter, [retained], [item(retained, [child])]);
      await write(adapter, tx => adapter.conflicts.insert(tx, scope, edge(lost, retained), 10));
      const inspect = (tx, id) => adapter.inspect.item(tx, scope, id, { limit: 5, includeQualification: false });
      await read(adapter, async tx => {
        const { item } = await inspect(tx, lost.id);
        assert.deepEqual(item.placements, [{ id: child }]);
        assert.equal(item.memory.filing.status, "filed");
        assert.equal(item.conflicts[0].memoryId, retained.id);
      });
      await adapter.close();
      assert.ok(readFileSync(path).includes(marker), "The plaintext witness must exist before withdrawal");
      adapter = await openSqliteAdapter(path, options);

      if (mode === "forget") {
        assert.equal((await service(adapter).forget(scope, lost.id, source)).status, "forgotten");
      } else if (mode === "correct") {
        const replacement = await row("Corrected marigold description");
        await write(adapter, tx => adapter.memories.replaceContent(tx, scope, lost.id, lost.revision, replacement, null, 11));
      } else if (authority) {
        assert.equal(await write(adapter, tx => adapter.memories.erase(tx, scope, authority.id)), true);
      } else if (mode === "source suppression") {
        await seedFact(adapter, { ...scope, kind: "session", actionId: "hide-source", origin: "forget",
          session: { client: session.client, sessionKeyHash: adapter.hashSessionKey(scope, session.client, session.sessionId) } });
      } else {
        assert.deepEqual(await write(adapter, tx => adapter.raw.deleteConversation(tx, scope, session)), { rawDeleted: 1 });
        assert.deepEqual(await write(adapter, tx => adapter.raw.archive(tx, { ...session, scope, eventId: "fresh-event",
          payloadDigest: sha256("fresh fixture") }, [{ ...message, id: "new-message" }])), { archived: 0 });
      }

      await adapter.close();
      assert.equal(readFileSync(path).includes(marker), false);
      for (const suffix of ["-wal", "-journal"]) {
        if (existsSync(path + suffix)) assert.equal(readFileSync(path + suffix).includes(marker), false);
      }
      adapter = await openSqliteAdapter(path, options);
      await read(adapter, async tx => {
        assert.deepEqual(await adapter.placement.forMemory(tx, scope, lost.id), []);
        assert.deepEqual(await adapter.placement.forMemories(tx, scope, [lost.id, retained.id]),
          [{ memoryId: retained.id, topics: [{ id: child, title: null }] }]);
        for (const topic of createdTopics) {
          assert.deepEqual((await adapter.placement.members(tx, scope, topic.id, page)).items.map(({ id }) => id), [retained.id]);
        }
        for (const method of ["list", "catalog"]) {
          assert.deepEqual((await adapter.placement[method](tx, scope, page)).items.map(({ title }) => title), [null, null]);
        }
        assert.deepEqual(await adapter.conflicts.list(tx, scope, retained.id), []);
        assert.deepEqual(await adapter.conflicts.readMany(tx, scope, [lost.id, retained.id]),
          new Map([[lost.id, []], [retained.id, []]]));
        assert.deepEqual((await inspect(tx, retained.id)).item.conflicts, []);
        assert.deepEqual((await inspect(tx, lost.id)).item?.placements ?? [], []);
      });
      for (const [target, title] of [[otherScope, "Other namespace title"], [otherOwner, "Other owner title"]]) {
        assert.ok((await read(adapter, tx => adapter.placement.list(tx, target, page), target)).items.some(topic => topic.title === title));
      }
    } finally {
      await adapter.close();
    }
  });
}

test("inspect projects supersession and only still-visible replacement receipts", async t => {
  const { path, remove } = scratch();
  const adapter = await openSqliteAdapter(path, { capabilities: flags });
  t.after(async () => {
    try { await adapter.close(); }
    finally { remove(); }
  });
  const prior = await insert(adapter, "Prior memory");
  const replacement = await insert(adapter, "Successor memory", {
    receipts: [{ ...session, messageId: "synthetic-proof", role: "user", excerpt: "Synthetic proof", occurredAtMs: 1 }],
  });
  await write(adapter, async tx => {
    await adapter.supersession.record(tx, scope, { previous: prior, replacement }, replacement.receiptIds, 11);
    await adapter.supersession.markHistorical(tx, scope, prior.id, 11);
  });
  const inspectLink = () => read(adapter, async tx => (await adapter.inspect.item(tx, scope, prior.id,
    { limit: 2, includeQualification: false })).item.supersession);
  assert.deepEqual(await inspectLink(), { previousRevision: 1,
    replacement: { memoryId: replacement.id, currentRevision: 1, revision: 1, state: "active" },
    receiptIds: replacement.receiptIds, evidenceAvailable: true });
  await write(adapter, tx => adapter.raw.deleteConversation(tx, scope, session));
  assert.deepEqual(await inspectLink(), { previousRevision: 1, replacement: null, receiptIds: [], evidenceAvailable: false });
});

function newTables(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, SQLITE_PHYSICAL_VERSION);
    return PLACEMENT_RELATION_TABLES.map(table => {
      const { sql } = db.prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?").get(table);
      assert.equal(db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count, 0);
      return sql;
    });
  } finally {
    db.close();
  }
}

test("the exact placement and relation table set exists at creation and migration, and v6 is refused read-only", async t => {
  const { path, remove } = scratch();
  t.after(remove);
  const fresh = await openSqliteAdapter(path);
  await fresh.close();
  const initial = newTables(path);
  const legacy = await fixture(dirname(path), 29);
  const input = prepareInput(dirname(path), legacy);
  await createLegacyBackup(input);
  await migrateLegacyStore(input);
  assert.deepEqual(newTables(input.destination), initial);
  const migrated = await openSqliteAdapter(input.destination, { capabilities: flags });
  try {
    assert.deepEqual((await read(migrated, tx => migrated.placement.catalog(tx, scope, page))).items, []);
  } finally {
    await migrated.close();
  }

  editFixture(path, db => db.exec(`PRAGMA journal_mode = DELETE;
    DROP TRIGGER cairn_topic_source_revision;
    DROP TRIGGER cairn_memory_erase_dependents;
    ${[...PLACEMENT_RELATION_TABLES].reverse().map(table => `DROP TABLE ${table};`).join("\n")}
    PRAGMA user_version = 6;`));
  const versionSix = readFileSync(path);
  await assert.rejects(openSqliteAdapter(path), { code: "storage_error" });
  assert.deepEqual(readFileSync(path), versionSix);
  assert.equal(existsSync(path + "-wal"), false);
  assert.equal(existsSync(path + "-shm"), false);
});
