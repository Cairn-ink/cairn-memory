import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { openMemoryCore } from "../../../core/index.mjs";
import { defaultRawOptions } from "../../../core/local-defaults.mjs";
import { rawRequest, splitRaw } from "../../../core/testing/raw-fixtures.mjs";
import { rationaleModel } from "../../../core/testing/rationale-model.mjs";
import { openSqliteAdapter, SQLITE_PHYSICAL_VERSION } from "../src/index.mjs";
import { migrateLegacyStore } from "../src/migrate/index.mjs";
import { editFixture, fixture, scratch } from "./legacy/fixtures.mjs";
import { coreScope, createLegacyBackup, ok, prepareInput, project, service, sha256 } from "./migration-fixtures.mjs";

const scope = coreScope(project);
const installed = process.env.CAIRN_TEST_LEGACY_ENGINE;
const engine = installed
  ? (await import(pathToFileURL(join(installed, "core/index.mjs")).href)).openMemoryCore
  : openMemoryCore;
const rawOptions = installed
  ? (await import(pathToFileURL(join(installed, "core/local-defaults.mjs")).href)).defaultRawOptions
  : defaultRawOptions;

for (const archive of [false, true]) {
  test(`conversion preserves filed ${archive ? "Raw" : "plain"} captures and excludes legacy-fenced receipts`, async t => {
    const directory = scratch(t);
    const input = prepareInput(directory, await fixture(directory, 29, { localPrivacy: true }));
    const visible = "The synthetic telescope looks west.";
    const hidden = "The synthetic telescope looks east.";
    const client = archive ? "claude-code" : "synthetic-observer";
    const model = {
      ...rationaleModel(),
      extract: ({ input }) => ({ items: input.messages.map(({ index, content }) => ({
        content: `Synthetic observation ${content === visible ? "west" : "east"} is on the schedule.`, kind: "fact", confidence: 0.8, sourceIndices: [index],
      })) }),
    };
    const source = engine({ path: input.path, model, rawSearch: false, ...(archive && { rawConversations: rawOptions() }) });
    let kept, blocked;
    try {
      const capture = async (name, content) => ok(await source.capture({
        namespace: project, client, sessionId: name, eventId: name, messages: [{ id: name, role: "user", content }],
      })).admission.memories[0];
      if (archive) {
        const request = rawRequest(splitRaw(visible, { id: "west", occurredAt: new Date().toISOString() })[0],
          { namespace: project, client, sessionId: "west" });
        kept = ok(ok(await source.captureRaw(request)).interpretation).admission.memories[0];
      } else {
        kept = await capture("west", visible);
      }
      blocked = ok(source.admit({ namespace: project,
        memory: { content: "Synthetic eastern entry is on the schedule.", kind: "fact" },
        receipts: [{ client: "manual", sessionId: "east", eventId: "east", role: "user", excerpt: hidden }],
      })).memory;
      const memories = [kept, blocked];
      const index = ok(source.map({ namespace: project, purpose: "classification" })).indexRevision;
      ok(source.applyPlacement({
        namespace: project, expectedIndexRevision: index,
        expectedMemoryRevisions: memories.map(({ id, revision }) => ({ memoryId: id, revision })),
        proposal: { items: memories.map(memory => ({ memoryId: memory.id, parentIds: [],
          newL1: { title: memory.id === kept.id ? "Western observations" : "Eastern observations", parentL2Ids: [] } })) },
      }));
    } finally {
      await source.close();
    }
    editFixture(input.path, db => db.prepare("INSERT INTO raw_session_fences VALUES (?, ?, ?, ?, ?)")
      .run(project.ownerId, project.scope, project.projectId, "manual", "east"));
    const oracle = engine({ path: input.path, rawSearch: false, ...(archive && { rawConversations: rawOptions() }) });
    let placements;
    try {
      const inspect = (memoryId) => ok(oracle.get({ namespace: project, memoryId }));
      assert.deepEqual(inspect(kept.id).receipts.map(({ excerpt }) => excerpt), [visible]);
      placements = inspect(kept.id).placements;
      assert.equal(placements.length, 1);
      assert.deepEqual(inspect(blocked.id).receipts, []);
    } finally {
      await oracle.close();
    }
    await createLegacyBackup(input);
    const migrated = await migrateLegacyStore(input);
    assert.equal(migrated.withheldReceipts, 1);
    assert.equal(readFileSync(input.destination).includes(hidden), false);
    const storage = await openSqliteAdapter(input.destination, { legacyInspectPlacements: true });
    try {
      const read = (memoryId) => service(storage).inspect(scope, { memoryId });
      const before = await read(kept.id);
      assert.deepEqual(before.receipts.map(({ excerpt }) => excerpt), [visible]);
      assert.deepEqual(before.placements, placements.map(({ mocId, ...fields }) => ({ id: mocId, ...fields })));
      const withdrawn = await read(blocked.id);
      assert.deepEqual(withdrawn.receipts, []);
      assert.deepEqual(withdrawn.placements, []);
      await storage.uow.run(scope.owner, { pauseLock: true }, tx =>
        storage.raw.deleteConversation(tx, scope, { client, sessionId: "west" }));
      const after = await read(kept.id);
      assert.deepEqual(after.receipts, []);
      assert.deepEqual(after.placements, []);
    } finally {
      await storage.close();
    }
    const closed = readFileSync(input.destination);
    for (const text of [visible, hidden, "Western observations", "Eastern observations"]) {
      assert.equal(closed.includes(text), false, text);
    }
  });
}

test("version 7 fails read-only preflight with bytes unchanged", async t => {
  const path = join(scratch(t), "previous.sqlite");
  await (await openSqliteAdapter(path)).close();
  editFixture(path, db => db.exec("PRAGMA user_version = 7"));
  const previous = readFileSync(path);
  await assert.rejects(openSqliteAdapter(path).then(storage => storage.close()), { code: "storage_error" });
  assert.deepEqual(readFileSync(path), previous);
  assert.equal(SQLITE_PHYSICAL_VERSION, 9);
});

test("forget advances a live topic once when it withdraws both the title and a member", async t => {
  const path = join(scratch(t), "live.sqlite");
  const storage = await openSqliteAdapter(path, {
    legacyInspectPlacements: true, capabilities: { placement: true },
  });
  const source = { kind: "mcp", client: null, sessionId: null };
  const title = "Synthetic maintenance notes";
  const write = operation => storage.uow.run(scope.owner, { pauseLock: true }, operation);
  const insert = text => write(tx => storage.memories.insert(tx, scope, {
    text, textHash: "sha256:" + sha256(text.toLowerCase()), kind: "fact",
    confidence: 1, origin: "explicit", source, embedding: null,
  }, [], 1));
  const place = (memory, assignment) => write(async tx => {
    const { indexRevision } = await storage.placement.catalog(tx, scope, { cursor: null, limit: 10 });
    return storage.placement.applyPlacement(tx, scope, {
      indexRevision, memoryRevisions: [{ memoryId: memory.id, revision: memory.revision }],
    }, { items: [{ memoryId: memory.id, ...assignment }] });
  });
  try {
    const contributor = await insert("Synthetic title contributor");
    const member = await insert("Independent synthetic member");
    const { createdTopics: [{ id }] } = await place(contributor, {
      parentIds: [], newL1: { title, parentL2Ids: [] },
    });
    await place(member, { parentIds: [id] });
    const inspect = () => service(storage).inspect(scope, { memoryId: member.id });
    assert.deepEqual((await inspect()).placements, [{ id, mocRevision: 2, title }]);
    assert.equal((await service(storage).forget(scope, contributor.id, source)).status, "forgotten");
    assert.deepEqual((await inspect()).placements, [{ id, mocRevision: 3, title: null }]);
  } finally {
    await storage.close();
  }
  assert.equal(readFileSync(path).includes(title), false);
});
