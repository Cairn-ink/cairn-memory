import assert from "node:assert/strict";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { contextReadTestService } from "@cairn-ink/conformance/context-read";
import { migrateContentSafety, migrateReceiptEventTime } from "../../../core/content-safety-migration.mjs";
import { openMemoryCore } from "../../../core/index.mjs";
import { createMemoryAdapter } from "../../adapter-memory/src/index.mjs";
import { openSqliteAdapter } from "../src/index.mjs";
import { migrateLegacyStore } from "../src/migrate/index.mjs";
import { editFixture, fixture, scratch } from "./legacy/fixtures.mjs";
import { admit, coreScope, createLegacyBackup, ok, prepareInput, project, sha256 } from "./migration-fixtures.mjs";

const scope = coreScope(project);
const readSet = { owner: scope.owner, namespaces: [scope.namespace], accessGenerations: [1] };
const source = { kind: "mcp", client: null, sessionId: null };
const forgottenText = "The synthetic marten carries a map.";
const survivingText = "The synthetic heron carries a compass.";
const receipt = { client: "manual", sessionId: "synthetic-shared", messageId: "synthetic-turn",
  role: "user", occurredAtMs: null, excerpt: "A synthetic patch of indigo cloth." };
const { client, sessionId, messageId } = receipt;
const address = { client, sessionId, messageId };
const flags = { inspect: true, contextRead: true, documentCards: true, rawArchive: true };
const read = (adapter, fn) => adapter.uow.run(scope.owner, { readOnly: true }, fn);
const write = (adapter, fn) => adapter.uow.run(scope.owner, { pauseLock: true }, fn);
const cardId = "synthetic-shared-card";

async function open(t, path) {
  const adapter = await openSqliteAdapter(path, { capabilities: flags });
  t.after(() => adapter.close());
  return adapter;
}

async function putCard(adapter, survivor) {
  const body = "A synthetic card linked only to the surviving memory.";
  assert.equal((await write(adapter, tx => adapter.documentCards.put(tx, scope, {
    id: cardId, scope, origin: "router", title: "Synthetic card", body, contentHash: sha256(body),
    date: null, sourceMessage: address, sourceMemories: [{ id: survivor.id, revision: survivor.revision }],
    sentences: [{ start: 0, end: body.length, source: address }], stale: [],
  }))).status, "inserted");
}

async function assertDelivery(adapter, survivor, withheld) {
  const api = contextReadTestService(adapter);
  const ref = { type: "memory", id: survivor.id, namespace: scope.namespace };
  const list = await api.inspect(scope, {});
  const detail = await api.inspect(scope, { memoryId: survivor.id });
  const [hydrated] = await read(adapter, tx => adapter.hydrate.hydrate(tx, readSet, [ref], "export"));
  const evidenceRef = { type: ref.type, id: ref.id, scope, revision: survivor.revision };
  const { items: [evidence] } = await api.fetchEvidence(readSet, { refs: [evidenceRef], intent: "current" });
  const [sourceRead] = await read(adapter, tx => adapter.contextRead.evidence(tx, readSet, [evidenceRef], "current"));
  assert.equal(hydrated.memory.text, survivingText);
  assert.equal(evidence.text, survivingText);
  const card = await read(adapter, tx => adapter.documentCards.get(tx, scope, cardId));
  const denied = await read(adapter, tx => adapter.suppressions.receiptWithheld(tx, scope, receipt));
  const expectedExcerpts = withheld ? [] : [survivingText];
  assert.deepEqual({
    listed: list.memories.find(memory => memory.id === survivor.id)?.receiptCount,
    receipts: detail.receipts.map(({ excerpt }) => excerpt),
    sourceAddresses: hydrated.receipts.map(({ client, sessionId, messageId }) => ({ client, sessionId, messageId })),
    sourceExcerpts: sourceRead.receipts.map(({ excerpt }) => excerpt),
    sourceCount: evidence.provenance.sources.length,
    evidenceCount: evidence.provenance.receiptMetadata.length,
    sourceDenied: denied,
    cardEligible: card !== null,
  }, {
    listed: withheld ? 0 : 1,
    receipts: expectedExcerpts,
    sourceAddresses: withheld ? [] : [address],
    sourceExcerpts: expectedExcerpts,
    sourceCount: withheld ? 0 : 1,
    evidenceCount: withheld ? 0 : 1,
    sourceDenied: withheld,
    cardEligible: !withheld,
  });
}

function assertStored(path, survivor) {
  editFixture(path, db => {
    assert.equal(db.prepare("SELECT count(*) AS n FROM cairn_receipts WHERE memory_id = ?").get(survivor.id).n, 1);
    assert.equal(db.prepare("SELECT count(*) AS n FROM cairn_inspect_receipts WHERE memory_id = ?").get(survivor.id).n, 1);
  });
}

async function legacyStore(directory, layout) {
  const legacy = await fixture(directory, layout === 29 ? 29 : 33, { localPrivacy: true });
  const input = prepareInput(directory, legacy);
  const engine = openMemoryCore({ path: input.path });
  let survivor;
  try {
    const from = { client, sessionId, eventId: messageId, role: receipt.role, excerpt: receipt.excerpt };
    const forgotten = admit(engine, forgottenText, project, [from]);
    survivor = admit(engine, survivingText, project, [from]);
    assert.equal(ok(engine.get({ namespace: project, memoryId: survivor.id })).receipts.length, 1);
    assert.equal(ok(engine.forget({ namespace: project, memoryId: forgotten.id, expectedRevision: forgotten.revision })).forgotten, true);
    assert.deepEqual(ok(engine.get({ namespace: project, memoryId: survivor.id })).receipts, []);
  } finally {
    await engine.close();
  }
  if (layout !== 29) {
    const backupPath = join(directory, "maintenance.sqlite");
    copyFileSync(input.path, backupPath);
    const migrate = layout === 48 ? migrateContentSafety : migrateReceiptEventTime;
    assert.equal((await migrate({ path: input.path, backupPath,
      expected: { storeId: input.expectedStoreId, base: 33 }, quiescence: input.quiescence })).physical, layout);
  }
  return { input, survivor };
}

for (const layout of [29, 48, 53]) {
  test(`layout ${layout} carries shared receipt withholding and keeps the survivor and its stored receipt`, async t => {
    const { input, survivor } = await legacyStore(scratch(t), layout);
    await createLegacyBackup(input);
    assert.equal((await migrateLegacyStore(input)).sourceLayout, layout);
    const adapter = await open(t, input.destination);
    await putCard(adapter, survivor);
    await assertDelivery(adapter, survivor, true);
    assertStored(input.destination, survivor);
  });
}

test("an unrepresentable receipt marker refuses before changing the source or creating a destination", async t => {
  const { input } = await legacyStore(scratch(t), 29);
  await createLegacyBackup(input);
  editFixture(input.path, db => db.prepare("INSERT INTO suppressed VALUES (?, ?, ?, ?)")
    .run(project.ownerId, project.scope, project.projectId, "rs1:unknown:" + "a".repeat(64)));
  const bytes = readFileSync(input.path);
  await assert.rejects(migrateLegacyStore(input), { code: "legacy_receipt_marker_unrepresentable" });
  assert.deepEqual(readFileSync(input.path), bytes);
  assert.equal(existsSync(input.destination), false);
});

async function forgetShared(adapter, { archived = false } = {}) {
  const api = contextReadTestService(adapter);
  const save = text => api.save(scope, text, source, "fact", { receipt });
  const forgotten = await save(forgottenText);
  const survivor = await save(survivingText);
  assert.equal(forgotten.status, "saved");
  assert.equal(survivor.status, "saved");
  if (archived) {
    await write(adapter, tx => adapter.raw.importArchive(tx, scope, receipt, [
      { id: messageId, role: receipt.role, content: receipt.excerpt, occurredAtMs: null },
    ]));
  }
  await putCard(adapter, survivor.item);
  // Archived card eligibility also requires evidence of capture admission.
  if (!archived) await assertDelivery(adapter, survivor.item, false);
  assert.equal((await api.forget(scope, forgotten.item.id, source)).status, "forgotten");
  await assertDelivery(adapter, survivor.item, true);
  return survivor.item;
}

for (const archived of [false, true]) {
  test(`fresh SQLite forget withholds the shared ${archived ? "archived" : "unarchived"} receipt`, async t => {
    const path = join(scratch(t), "fresh.sqlite");
    const survivor = await forgetShared(await open(t, path), { archived });
    assertStored(path, survivor);
  });
}

test("fresh memory adapter forget withholds the shared receipt", async () => {
  await forgetShared(createMemoryAdapter({ capabilities: flags }));
});
