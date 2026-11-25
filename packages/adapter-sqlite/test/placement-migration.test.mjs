import assert from "node:assert/strict";
import { copyFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { openMemoryCore } from "../../../core/index.mjs";
import { defaultRawOptions } from "../../../core/local-defaults.mjs";
import { migrateContentSafety, migrateReceiptEventTime } from "../../../core/content-safety-migration.mjs";
import { rawRequest, splitRaw } from "../../../core/testing/raw-fixtures.mjs";
import { rationaleModel } from "../../../core/testing/rationale-model.mjs";
import { openSqliteAdapter } from "../src/adapter.mjs";
import { migrateLegacyStore } from "../src/migrate/index.mjs";
import { editFixture, fixture, scratch } from "./legacy/fixtures.mjs";
import { admit, coreScope, createLegacyBackup, fileDigest, ok, personal, prepareInput, project, service } from "./migration-fixtures.mjs";

const namespace = project;
const scope = coreScope(namespace);
const options = { capabilities: { placement: true, supersession: true, conflictEdges: true } };
const page = { cursor: null, limit: 100 };
const model = { ...rationaleModel(), extract: ({ input }) => ({
  items: input.messages.map(({ index, content }) => ({ content, kind: "fact", confidence: 0.8, sourceIndices: [index] })),
}) };
const history = "The synthetic grove closes on Friday";
const replacement = "The synthetic grove closes on Monday";
const forgotten = "Synthetic forgotten cedar body";
const forgottenTitle = "Synthetic forgotten cedar label";
const deleted = "Synthetic deleted walnut conversation";
const deletedTitle = "Synthetic deleted walnut label";
const pendingText = "A synthetic datum awaits filing";
const classifiedText = "A synthetic datum needs no topic";
const classify = model.classify;
model.classify = request => {
  if (request.input.memories.some(memory => memory.content === pendingText)) throw new Error("Synthetic classifier failure");
  return classify(request);
};
const receipt = excerpt => ({ client: "manual", sessionId: "synthetic", eventId: excerpt, role: "user", excerpt });
const guard = ({ id, revision }) => ({ memoryId: id, revision });
const sort = items => [...items].sort((a, b) => a.id.localeCompare(b.id));

const installedRoot = process.env.CAIRN_TEST_LEGACY_ENGINE;
const engine = installedRoot ? (await import(pathToFileURL(join(installedRoot, "core/index.mjs")).href)).openMemoryCore : openMemoryCore;
const legacyRawOptions = installedRoot
  ? (await import(pathToFileURL(join(installedRoot, "core/local-defaults.mjs")).href)).defaultRawOptions : defaultRawOptions;

function legacyInspect(core, memoryId) {
  return ok(core.get({ namespace, memoryId, receiptLimit: 50, includeQualification: true }));
}

function map(core, purpose) {
  return ok(core.map({ namespace, purpose }));
}

function place(core, members) {
  return ok(core.applyPlacement({
    namespace, expectedIndexRevision: map(core, "classification").indexRevision,
    expectedMemoryRevisions: members.map(({ memory }) => guard(memory)),
    proposal: { items: members.map(({ memory, ...item }) => ({ memoryId: memory.id, ...item })) },
  }));
}

function newTopics(title, newL2Title) {
  return { parentIds: [], newL1: { title, parentL2Ids: [], ...(newL2Title && { newL2Title }) } };
}

async function seed(input, raw) {
  const core = engine({ path: input.path, model, rawSearch: false,
    ...(raw && { rawConversations: legacyRawOptions() }) });
  try {
    const left = admit(core, "The synthetic observatory roof is open", namespace, [receipt("The roof is open")]);
    const right = ok(core.admit({ namespace, memory: { content: "The synthetic observatory roof is shut", kind: "fact" },
      receipts: [receipt("The roof is shut")], conflictHints: [{ memoryId: left.id, expectedRevision: left.revision,
        relation: "contradicts" }] })).memory;
    const prior = admit(core, history, namespace, [receipt("The posted schedule says Friday")]);
    const successor = ok(core.supersede({ namespace, memoryId: prior.id, expectedRevision: prior.revision,
      replacement: { content: replacement, kind: "fact" }, receipts: [receipt(replacement)] })).memory;
    const retained = admit(core, "A synthetic cedar remains in the orchard", namespace, [receipt("A cedar remains")]);
    const lost = admit(core, forgotten, namespace, [receipt(forgotten)]);
    const pair = place(core, [
      { memory: retained, ...newTopics(forgottenTitle, "Synthetic orchard") },
      { memory: lost, ...newTopics(forgottenTitle, "Synthetic orchard") },
    ]);
    const lostRevision = pair.memories.find(({ id }) => id === lost.id).revision;
    ok(core.forget({ namespace, memoryId: lost.id, expectedRevision: lostRevision }));
    const filedSuccessor = place(core, [{ memory: successor, ...newTopics("Synthetic opening hours", "Synthetic grove") }]);
    assert.ok(filedSuccessor.memories[0].revision > successor.revision);

    async function capture(eventId, content, status) {
      const key = { namespace, client: "synthetic", eventId };
      const result = ok(await core.capture({ ...key, sessionId: "synthetic-classification",
        messages: [{ id: eventId, role: "user", content }] }));
      assert.equal(ok(core.inspectAdmission({ ...key, includeInitialClassification: true })).initialClassification.status, status);
      return result.admission.memories[0];
    }
    const pending = admit(core, "The synthetic orchard still needs a map", namespace, [receipt("The orchard needs a map")]);
    const failed = await capture("pending-filing", pendingText, "failed");
    const classified = await capture("completed-filing", classifiedText, "applied");

    if (raw) {
      const request = rawRequest(splitRaw(deleted, { id: "walnut", occurredAt: new Date().toISOString() })[0],
        { namespace, sessionId: "synthetic-walnut" });
      const captured = ok(await core.captureRaw(request));
      const lostMember = ok(captured.interpretation).admission.memories[0];
      place(core, [{ memory: lostMember, ...newTopics(deletedTitle) }]);
      const conversationId = captured.raw.conversationId;
      const { conversation } = ok(await core.getConversation({ namespace, conversationId }));
      const removal = ok(await core.deleteConversation({ namespace, conversationId, expectedRevision: conversation.revision,
        actionId: "delete-synthetic-walnut" }));
      assert.equal(removal.forgottenMemories, 1);
    }
    assert.deepEqual(legacyInspect(core, left.id).conflicts.map(({ memoryId }) => memoryId), [right.id]);
    assert.equal(legacyInspect(core, retained.id).placements[0].title, null);
    return { prior, successor, left, right, retained, lost, pending, failed, classified };
  } finally {
    await core.close();
  }
}

const date = ms => new Date(ms).toISOString();

function wireMemory({ scope: _scope, createdAtMs, updatedAtMs, text, origin, ...memory }) {
  return { ...memory, origin: origin === "inferred" ? "agent-inferred" : origin,
    namespace, createdAt: date(createdAtMs), updatedAt: date(updatedAtMs), ...(text !== undefined && { content: text }) };
}

function inspectWire({ mode: _mode, memory, receipts, ...item }) {
  return {
    ...item,
    memory: wireMemory(memory),
    receipts: receipts.map(({ occurredAtMs: _eventTime, messageId: _messageId, createdAtMs, ...row }) =>
      ({ ...row, createdAt: date(createdAtMs) })),
  };
}

for (const layout of [18, 29, 48, 53]) {
  test(`engine-made layout ${layout} retains visible topic and relation evidence`, async t => {
    const directory = scratch(t);
    const legacy = await fixture(directory, layout <= 29 ? layout : 33, { localPrivacy: layout >= 29 });
    const input = prepareInput(directory, legacy);
    const ids = await seed(input, layout >= 29);
    if (layout >= 48) {
      const backupPath = join(directory, "before-maintenance.sqlite");
      copyFileSync(input.path, backupPath);
      const upgrade = layout === 48 ? migrateContentSafety : migrateReceiptEventTime;
      assert.equal((await upgrade({ path: input.path, backupPath, expected: { storeId: legacy.storeId, base: 33 },
        quiescence: input.quiescence })).physical, layout);
    }

    const core = engine({ path: input.path, model, rawSearch: false,
      ...(layout >= 29 && { rawConversations: legacyRawOptions() }) });
    const expected = new Map();
    let catalog, activeMap, listing;
    try {
      for (const { id } of Object.values(ids)) {
        if (id !== ids.lost.id) expected.set(id, legacyInspect(core, id));
      }
      assert.equal(core.get({ namespace, memoryId: ids.lost.id }).error.code, "memory_not_found");
      catalog = map(core, "classification");
      activeMap = map(core, "recall");
      listing = ok(core.list({ namespace }));
      assert.ok(catalog.exhausted && activeMap.exhausted && listing.exhausted);
    } finally {
      await core.close();
    }
    const sourceTitles = editFixture(input.path, db => {
      assert.equal(db.prepare("PRAGMA user_version").get().user_version, layout);
      return db.prepare(`SELECT s.moc_id, s.memory_id AS memoryId, s.memory_revision AS memoryRevision
        FROM moc_title_sources s JOIN memories m ON m.id = s.memory_id AND m.revision = s.memory_revision
        WHERE m.deleted = 0 ORDER BY s.moc_id, s.memory_id`).all();
    });
    await createLegacyBackup(input);
    const before = fileDigest(input.path);
    const result = await migrateLegacyStore(input);
    assert.equal(result.sourceLayout, layout);
    assert.deepEqual(await migrateLegacyStore(input), result);
    assert.equal(fileDigest(input.path), before);

    const bytes = readFileSync(input.destination);
    for (const hidden of [forgotten, forgottenTitle, "Synthetic orchard", deleted, deletedTitle]) {
      assert.equal(bytes.includes(hidden), false, hidden);
    }
    assert.equal(bytes.includes("Synthetic opening hours"), true);
    // Raw-capable legacy layouts register plain captures without proving that
    // their receipts are independent of Raw. The serving adapter withholds them.
    const unknownAncestry = new Set(layout >= 29 ? [ids.failed.id, ids.classified.id] : []);
    const receiptCount = memory => unknownAncestry.has(memory.id) ? 0 : memory.receiptCount;
    const projected = ({ memory, placements, receipts, ...reference }) => ({
      ...reference, memory: { ...memory, receiptCount: receiptCount(memory) },
      placements: placements.map(({ mocId }) => ({ id: mocId })),
      receipts: unknownAncestry.has(memory.id) ? [] : receipts,
    });
    editFixture(input.destination, db => {
      assert.equal(db.prepare("SELECT count(*) AS n FROM cairn_topic_sources WHERE memory_id = ?").get(ids.lost.id).n, 0);
      assert.deepEqual(sort(db.prepare("SELECT memory_id AS id, revision FROM cairn_topic_outcomes").all().map(row => ({ ...row }))),
        sort([...expected.values()].filter(({ memory }) => memory.filing.status === "filed" ||
          (memory.id === ids.classified.id && !unknownAncestry.has(memory.id)))
          .map(({ memory }) => ({ id: memory.id, revision: memory.revision }))));
      assert.deepEqual(db.prepare(`SELECT topic_id AS moc_id, memory_id AS memoryId, revision AS memoryRevision
        FROM cairn_topic_sources ORDER BY topic_id, memory_id`).all(), sourceTitles);
    });

    const adapter = await openSqliteAdapter(input.destination, options);
    try {
      const query = service(adapter).inspect;
      for (const [id, reference] of expected) {
        const actual = inspectWire(await query(scope, { memoryId: id, receiptLimit: 50, includeQualification: true }));
        assert.deepEqual(actual, projected(reference));
      }
      const { mode, memories, ...paging } = await query(scope, {});
      assert.equal(mode, "list");
      assert.deepEqual({ ...paging, memories: memories.map(wireMemory) }, {
        ...listing, memories: listing.memories.map(memory => ({ ...memory, receiptCount: receiptCount(memory) })),
      });
      await assert.rejects(query(scope, { memoryId: ids.lost.id }), { code: "memory_not_found" });
      await assert.rejects(query(coreScope(personal), { memoryId: ids.retained.id }), { code: "memory_not_found" });

      await adapter.uow.run(scope.owner, { readOnly: true }, async tx => {
        const refs = catalog.items.filter(item => item.type === "ref").map(item => item.ref);
        const topics = catalog.items.filter(item => item.type === "moc").map(({ moc: { id, level, title } }) => ({
          id, level, title, parentIds: refs.filter(ref => ref.childType === "moc" && ref.childId === id).map(ref => ref.parentId),
        }));
        const actualCatalog = await adapter.placement.catalog(tx, scope, page);
        assert.deepEqual(sort(actualCatalog.items), sort(topics));
        assert.equal(actualCatalog.exhausted, true);
        const active = activeMap.items.filter(item => item.type === "moc").map(item => item.moc.id);
        const list = await adapter.placement.list(tx, scope, page);
        assert.deepEqual(list.items.map(({ id }) => id).sort(), active.sort());
        for (const topic of topics) {
          const target = topic.level === "L1" ? [topic.id] : topics.filter(child => child.parentIds.includes(topic.id)).map(child => child.id);
          const memberIds = [...new Set(refs.filter(ref => ref.childType === "memory" && target.includes(ref.parentId))
            .map(ref => ref.childId))].sort();
          const members = await adapter.placement.members(tx, scope, topic.id, page);
          assert.equal(members.nextCursor, null);
          assert.deepEqual(members.items.map(({ id }) => id).sort(), memberIds);
          for (const member of members.items) {
            const memory = expected.get(member.id).memory;
            assert.deepEqual(member, { kind: "memory", id: member.id, placedAtUs: BigInt(Date.parse(memory.updatedAt)) * 1000n });
          }
          const listed = list.items.find(({ id }) => id === topic.id);
          if (listed) {
            assert.equal(listed.memberCount, memberIds.length);
            assert.deepEqual(listed.newestMemberIds, members.items.slice(0, 3).map(({ id }) => id));
          }
        }
        const unfiled = catalog.items.filter(item => item.type === "unfiled").map(item => item.ref);
        assert.ok(unfiled.some(ref => ref.memoryId === ids.classified.id));
        const pending = await adapter.placement.pending(tx, scope, { limit: 5 });
        const byMemory = refs => [...refs].sort((a, b) => a.memoryId.localeCompare(b.memoryId));
        assert.deepEqual(byMemory(pending), byMemory(unfiled.filter(ref =>
          ref.memoryId !== ids.classified.id && !unknownAncestry.has(ref.memoryId))));
        assert.ok(pending.some(ref => ref.memoryId === ids.pending.id));
        for (const [id, reference] of expected) {
          assert.deepEqual(await adapter.placement.forMemory(tx, scope, id), reference.placements.map(({ mocId }) => mocId));
          assert.deepEqual(await adapter.conflicts.list(tx, scope, id), reference.conflicts);
        }
        const link = expected.get(ids.prior.id).supersession;
        assert.deepEqual(await adapter.supersession.read(tx, scope, ids.prior.id),
          { supersededBy: link.replacement.memoryId, supersedes: [] });
        assert.deepEqual(await adapter.supersession.read(tx, scope, ids.successor.id),
          { supersededBy: null, supersedes: [ids.prior.id] });
      });
    } finally {
      await adapter.close();
    }

    const defaults = await openSqliteAdapter(input.destination);
    try {
      const read = service(defaults).inspect;
      for (const [id, reference] of expected) {
        const actual = inspectWire(await read(scope, { memoryId: id, receiptLimit: 50, includeQualification: true }));
        assert.deepEqual(actual, projected(reference));
      }
    } finally {
      await defaults.close();
    }
    t.diagnostic(`${installedRoot ? "installed engine" : "legacy engine"} layout ${layout}, ${expected.size} inspect items, `
      + `${catalog.items.filter(item => item.type === "moc").length} topics, ${layout >= 29 ? 5 : 3} hidden byte witnesses`);
  });
}
