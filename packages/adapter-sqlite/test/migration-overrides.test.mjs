import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { openMemoryCore } from "../../../core/index.mjs";
import { defaultRawOptions } from "../../../core/local-defaults.mjs";
import { rationaleModel } from "../../../core/testing/rationale-model.mjs";
import { rawRequest, splitRaw } from "../../../core/testing/raw-fixtures.mjs";
import { factIncarnationBody } from "../../core/src/index.mjs";
import { openSqliteAdapter } from "../src/index.mjs";
import { migrateLegacyStore } from "../src/migrate/index.mjs";
import { editFixture, fixture, scratch } from "./legacy/fixtures.mjs";
import { admit, coreScope, createLegacyBackup, ok, personal, prepareInput, project, service, sha256 } from "./migration-fixtures.mjs";

const installed = process.env.CAIRN_TEST_LEGACY_ENGINE;
const engine = installed
  ? (await import(pathToFileURL(join(installed, "core/index.mjs")).href)).openMemoryCore
  : openMemoryCore;
const rawOptions = installed
  ? (await import(pathToFileURL(join(installed, "core/local-defaults.mjs")).href)).defaultRawOptions
  : defaultRawOptions;

const scope = coreScope(project);
const source = { kind: "mcp", client: null, sessionId: null };
const manual = { client: "manual", sessionId: "synthetic-manual-turn", eventId: "message", role: "user" };
const rawSource = { client: "claude-code", sessionId: "synthetic-retained-turn" };
const instant = Date.UTC(2025, 7, 3, 10);
const options = { rawSearch: false, model: rationaleModel() };
const read = (storage, namespace, memoryId) => service(storage).inspect(coreScope(namespace), { memoryId });
const write = (storage, operation) => storage.uow.run(scope.owner, { pauseLock: true }, operation);

async function prepare(t, layout) {
  const directory = scratch(t);
  return prepareInput(directory, await fixture(directory, layout, { localPrivacy: layout === 29 }));
}

async function convert(input) {
  await createLegacyBackup(input);
  await migrateLegacyStore(input);
}

function legacyPlace(legacy, namespace, memory, placement) {
  return ok(legacy.applyPlacement({
    namespace, expectedIndexRevision: ok(legacy.map({ namespace, purpose: "classification" })).indexRevision,
    expectedMemoryRevisions: [{ memoryId: memory.id, revision: memory.revision }],
    proposal: { items: [{ memoryId: memory.id, ...placement }] },
  }));
}

function fileReceipt(legacy, namespace, label, receipt) {
  const memory = admit(legacy, "Synthetic independent body " + label, namespace, [receipt]);
  legacyPlace(legacy, namespace, memory, {
    parentIds: [], newL1: { title: "Synthetic topic " + label, parentL2Ids: [] },
  });
  const view = ok(legacy.get({ namespace, memoryId: memory.id }));
  assert.equal(view.receipts[0].excerpt, receipt.excerpt);
  assert.equal(view.placements.length, 1);
  return { namespace, id: memory.id, excerpt: receipt.excerpt };
}

async function assertVisible(storage, { namespace, id, excerpt }) {
  const view = await read(storage, namespace, id);
  assert.deepEqual(view.receipts.map(receipt => receipt.excerpt), [excerpt]);
  assert.equal(view.placements.length, 1);
  return view;
}

async function assertWithheld(storage, { namespace, id }) {
  const view = await read(storage, namespace, id);
  assert.deepEqual([view.receipts.length, view.placements.length], [0, 0]);
  assert.equal(view.memory.receiptCount, 0);
}

test("a post-cutover window withholds a known-time attested receipt and placement", async t => {
  const input = await prepare(t, 53);
  const legacy = engine({ path: input.path, ...options });
  const timed = (namespace, label, ms) => fileReceipt(legacy, namespace, label, {
    ...manual, excerpt: "Synthetic receipt " + label, eventId: label,
    ...(ms !== undefined && { occurredAt: new Date(ms).toISOString() }),
  });
  let target, outside, otherNamespace, otherOwner, unknown;
  try {
    target = timed(project, "window target", instant);
    outside = timed(project, "outside window", instant + 100);
    otherNamespace = timed(personal, "other namespace", instant);
    otherOwner = timed({ ...project, ownerId: "independent-synthetic-owner" }, "other owner", instant);
    unknown = timed(project, "unknown time");
  } finally {
    await legacy.close();
  }
  editFixture(input.path, db => {
    const receipt = db.prepare("SELECT occurred_at FROM receipts WHERE memory_id = ?");
    assert.equal(Date.parse(receipt.get(target.id).occurred_at), instant);
    assert.equal(receipt.get(unknown.id).occurred_at, null);
  });
  await convert(input);
  const storage = await openSqliteAdapter(input.destination);
  try {
    const before = await assertVisible(storage, target);
    for (const row of [outside, otherNamespace, otherOwner, unknown]) await assertVisible(storage, row);
    const fact = { ...scope, kind: "window", client: manual.client, origin: "forget",
      actionId: "synthetic-timed-withdrawal", window: { startMs: instant - 1, endMs: instant + 1 } };
    const suppress = fact => write(storage, tx => storage.suppressions.writeFact(tx, fact, sha256(factIncarnationBody(fact))));
    await suppress(fact);
    await assertWithheld(storage, target);
    assert.equal(before.receipts[0].occurredAtMs, instant);
    for (const row of [outside, otherNamespace, otherOwner]) {
      assert.equal((await assertVisible(storage, row)).receipts[0].occurredAtMs,
        row === outside ? instant + 100 : instant);
    }
    assert.equal((await assertVisible(storage, unknown)).receipts[0].occurredAtMs, null);
    await suppress({ ...fact, actionId: "synthetic-unknown-withdrawal", unknownTime: true });
    await assertWithheld(storage, unknown);
    for (const row of [outside, otherNamespace, otherOwner]) await assertVisible(storage, row);
  } finally {
    await storage.close();
  }
});

test("forgetting a separate Memory by text withholds the attested receipt and placement", async t => {
  const input = await prepare(t, 29);
  const legacy = engine({ path: input.path, ...options });
  const excerpt = "Quartz synthetic excerpt for separate Memory forget";
  let target, control, forgotten;
  try {
    target = fileReceipt(legacy, project, "separate forget", { ...manual, excerpt });
    control = fileReceipt(legacy, personal, "separate namespace", { ...manual, excerpt });
    forgotten = admit(legacy, excerpt, project, [{ ...manual, eventId: "separate", excerpt: "Independent evidence" }]);
    assert.notEqual(forgotten.id, target.id);
  } finally {
    await legacy.close();
  }
  await convert(input);
  const storage = await openSqliteAdapter(input.destination);
  try {
    assert.equal((await assertVisible(storage, target)).receipts[0].occurredAtMs, null);
    await assertVisible(storage, control);
    assert.equal((await service(storage).forget(scope, forgotten.id, source)).status, "forgotten");
    await assert.rejects(read(storage, project, forgotten.id), { code: "memory_not_found" });
    await assertWithheld(storage, target);
    await assertVisible(storage, control);
  } finally {
    await storage.close();
  }
});

test("filing transitions match legacy title invalidation and topic revisions on the surviving member", async t => {
  const input = await prepare(t, 29);
  const legacy = engine({ path: input.path, ...options });
  const title = "Quartz original";
  let contributor, witness, original, parent, alternate;
  try {
    const first = admit(legacy, "Synthetic original title contributor", project);
    const created = legacyPlace(legacy, project, first, {
      parentIds: [], newL1: { title, parentL2Ids: [], newL2Title: "Quartz parent" },
    });
    contributor = created.memories[0];
    original = created.createdMocs.find(row => row.title === title).id;
    parent = created.createdMocs.find(row => row.title === "Quartz parent").id;
    witness = admit(legacy, "Synthetic independent member", project);
    legacyPlace(legacy, project, witness, { parentIds: [original] });
    const other = admit(legacy, "Synthetic alternate title contributor", project);
    alternate = legacyPlace(legacy, project, other, {
      parentIds: [], newL1: { title: "Agate alternate", parentL2Ids: [] },
    }).createdMocs[0].id;
  } finally {
    await legacy.close();
  }
  await convert(input);
  const oracle = engine({ path: input.path, ...options });
  const storage = await openSqliteAdapter(input.destination, {
    legacyInspectPlacements: true, capabilities: { placement: true },
  });
  const legacySnapshots = [];
  const migratedSnapshots = [];
  const legacyRevisions = [];
  const migratedRevisions = [];
  const snapshot = async () => {
    const { mocId: id, ...fields } = ok(oracle.get({ namespace: project, memoryId: witness.id }))
      .placements.find(row => row.mocId === original);
    legacySnapshots.push({ id, ...fields });
    migratedSnapshots.push((await read(storage, project, witness.id)).placements.find(row => row.id === original));
  };
  try {
    await snapshot();
    for (const parentIds of [[], [alternate]]) {
      const { id, revision } = (await read(storage, project, contributor.id)).memory;
      contributor = legacyPlace(oracle, project, contributor, { parentIds }).memories[0];
      await write(storage, async tx => {
        const { indexRevision } = await storage.placement.catalog(tx, scope, { cursor: null, limit: 30 });
        return storage.placement.applyPlacement(tx, scope, {
          indexRevision, memoryRevisions: [{ memoryId: id, revision }],
        }, { items: [{ memoryId: id, parentIds }] });
      });
      await snapshot();
      legacyRevisions.push(contributor.revision);
      migratedRevisions.push((await read(storage, project, id)).memory.revision);
    }
  } finally {
    await oracle.close();
    await storage.close();
  }
  const l2 = (path, table) => editFixture(path, db => db.prepare("SELECT revision FROM " + table + " WHERE id = ?").get(parent).revision);
  const legacyL2 = l2(input.path, "mocs");
  const migratedL2 = l2(input.destination, "cairn_topics");
  assert.deepEqual(legacySnapshots, [
    { id: original, mocRevision: 2, title },
    { id: original, mocRevision: 3, title: null },
    { id: original, mocRevision: 4, title: null },
  ]);
  assert.equal(legacyL2, 3);
  assert.deepEqual(
    { placements: migratedSnapshots, l2: migratedL2, memoryRevisions: migratedRevisions },
    { placements: legacySnapshots, l2: legacyL2, memoryRevisions: legacyRevisions },
  );
});

test("direct Raw fencing honours the caller session and its migrated spelling in the same scope", async t => {
  const input = await prepare(t, 29);
  const legacy = engine({ path: input.path, ...options, rawConversations: rawOptions(), model: {
    ...options.model,
    extract: () => ({ items: [{ content: "Synthetic independent conclusion", kind: "fact", confidence: 0.8, sourceIndices: [0] }] }),
  } });
  const rows = [];
  try {
    for (const namespace of [project, personal]) {
      const excerpt = namespace === project
        ? "Quartz synthetic archived turn for a direct fence"
        : "Basalt independent archived turn in a different scope";
      const request = rawRequest(splitRaw(excerpt, { id: "message", occurredAt: new Date(instant).toISOString() })[0],
        { namespace, ...rawSource, eventId: namespace.scope });
      const memory = ok(ok(await legacy.captureRaw(request)).interpretation).admission.memories[0];
      legacyPlace(legacy, namespace, memory, {
        parentIds: [], newL1: { title: "Synthetic Raw topic", parentL2Ids: [] },
      });
      assert.equal(ok(legacy.get({ namespace, memoryId: memory.id })).receipts[0].excerpt, excerpt);
      rows.push({ namespace, id: memory.id, excerpt });
    }
  } finally {
    await legacy.close();
  }
  await convert(input);
  const storage = await openSqliteAdapter(input.destination);
  const rawList = namespace => {
    const { owner, namespace: key } = coreScope(namespace);
    return storage.uow.run(owner, { readOnly: true }, tx => storage.raw.listRaw(tx,
      { owner, namespaces: [key] }, { cursor: null, limit: 10 }));
  };
  const fence = (namespace, sessionId) => storage.uow.run(coreScope(namespace).owner, { pauseLock: true }, tx =>
    storage.raw.fenceSession(tx, coreScope(namespace), { ...rawSource, sessionId }));
  try {
    const [target, control] = rows;
    await assertVisible(storage, target);
    await assertVisible(storage, control);
    const targetRaw = (await rawList(project)).items;
    const controlRaw = (await rawList(personal)).items;
    assert.equal(targetRaw.length, 1);
    assert.equal(controlRaw.length, 1);
    const alias = raw => JSON.parse(raw.ref.id)[3];
    assert.match(alias(targetRaw[0]), /^s1:[0-9a-f]{64}$/u);
    assert.match(alias(controlRaw[0]), /^s1:[0-9a-f]{64}$/u);
    await fence(project, rawSource.sessionId);
    await assertWithheld(storage, target);
    assert.deepEqual((await rawList(project)).items, []);
    await assertVisible(storage, control);
    assert.deepEqual((await rawList(personal)).items, controlRaw);
    await fence(personal, alias(controlRaw[0]));
    await assertWithheld(storage, control);
    assert.deepEqual((await rawList(personal)).items, []);
  } finally {
    await storage.close();
  }
});
