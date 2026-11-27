import assert from "node:assert/strict";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { contextReadTestService } from "@cairn-ink/conformance/context-read";
import { createMemoryService } from "@cairn-ink/core/service";
import { migrateContentSafety, migrateReceiptEventTime } from "../../../core/content-safety-migration.mjs";
import { openMemoryCore } from "../../../core/index.mjs";
import { createMemoryAdapter } from "../../adapter-memory/src/index.mjs";
import { openSqliteAdapter } from "../src/index.mjs";
import { migrateLegacyStore } from "../src/migrate/index.mjs";
import { legacyRawHash } from "../src/migrate/raw-privacy.mjs";
import { receiptAddressDenial, receiptIdentityDenial, receiptIdentityKey } from "../src/receipt-identity.mjs";
import { scopeKey } from "../src/storage-values.mjs";
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

test("a retired shared receipt keeps its lineage when a legacy Raw fence also withholds its excerpt", async t => {
  const { input, survivor } = await legacyStore(scratch(t), 29);
  editFixture(input.path, db => db.prepare("INSERT INTO raw_session_fences VALUES (?, ?, ?, ?, ?)")
    .run(project.ownerId, project.scope, project.projectId, client, sessionId));
  await createLegacyBackup(input);
  await migrateLegacyStore(input);
  const adapter = await open(t, input.destination);
  await putCard(adapter, survivor);
  await assertDelivery(adapter, survivor, true);
  assertStored(input.destination, survivor);
  await adapter.close();
  assert.equal(readFileSync(input.destination).includes(receipt.excerpt), false);
});

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

const windowReceipt = { ...receipt, client: "claude-code", messageId: "11111111-1111-4111-8111-111111111111" };

async function migrateWindow(t, { occurredAtMs, marker } = {}) {
  const directory = scratch(t);
  const legacy = await fixture(directory, occurredAtMs === undefined ? 29 : 53, { localPrivacy: true });
  const input = prepareInput(directory, legacy);
  const engine = openMemoryCore({ path: input.path, raw: true, rawSearch: false });
  let survivor;
  try {
    const independent = { client: windowReceipt.client, sessionId, eventId: windowReceipt.messageId, role: receipt.role, excerpt: receipt.excerpt,
      ...(occurredAtMs === undefined ? {} : { occurredAt: new Date(occurredAtMs).toISOString() }) };
    const forgotten = admit(engine, forgottenText, project);
    survivor = admit(engine, survivingText, project, [independent]);
    ok(engine.forget({ namespace: project, memoryId: forgotten.id, expectedRevision: forgotten.revision }));
    assert.deepEqual(ok(engine.get({ namespace: project, memoryId: survivor.id })).receipts.map(r => r.excerpt), [receipt.excerpt]);
  } finally {
    await engine.close();
  }
  if (marker) editFixture(input.path, db => db.prepare("INSERT INTO suppressed VALUES (?, ?, ?, ?)")
    .run(project.ownerId, project.scope, project.projectId, marker));
  await createLegacyBackup(input);
  await migrateLegacyStore(input);
  const path = input.destination;
  const windows = editFixture(path, db => {
    const { body } = db.prepare("SELECT body FROM cairn_receipts WHERE memory_id = ?").get(survivor.id);
    const stored = JSON.parse(body);
    assert.equal(stored.legacyRawAncestryEmpty, true);
    assert.equal(stored.occurredAtMs, occurredAtMs ?? null);
    assert.equal(db.prepare("SELECT count(*) AS n FROM cairn_raw_messages").get().n, 0);
    return db.prepare("SELECT body FROM cairn_migrated_raw_privacy WHERE kind = 'window'").all()
      .map(row => JSON.parse(row.body));
  });
  assert.ok(windows.length > 0);
  return { path, survivor, windows };
}

async function assertWindowReceipt(adapter, survivor, visible) {
  const api = contextReadTestService(adapter);
  const view = await api.inspect(scope, { memoryId: survivor.id });
  assert.deepEqual(view.receipts.map(r => r.excerpt), visible ? [receipt.excerpt] : []);
  const ref = { type: "memory", id: survivor.id, scope, revision: survivor.revision };
  const [evidence] = await read(adapter, tx => adapter.contextRead.evidence(tx, readSet, [ref], "current"));
  assert.equal(evidence.text, survivingText);
  assert.deepEqual(evidence.receipts.map(r => r.excerpt), visible ? [receipt.excerpt] : []);
}

test("carried Raw time windows leave attested independent receipts visible", async t => {
  const { path, survivor } = await migrateWindow(t);
  await assertWindowReceipt(await open(t, path), survivor, true);
});

test("a missing or negative cold ancestry attestation keeps the imported window in force", async t => {
  const { path, survivor } = await migrateWindow(t);
  const adapter = await open(t, path);
  await assertWindowReceipt(adapter, survivor, true);
  for (const expression of ["json_remove(body, '$.legacyRawAncestryEmpty')", "json_set(body, '$.legacyRawAncestryEmpty', json('false'))"]) {
    editFixture(path, db => db.prepare(`UPDATE cairn_receipts SET body = ${expression} WHERE memory_id = ?`).run(survivor.id));
    await assertWindowReceipt(adapter, survivor, false);
  }
});

test("importing a Raw row at the attested address restores the imported window check", async t => {
  const { path, survivor, windows } = await migrateWindow(t);
  const adapter = await open(t, path);
  await assertWindowReceipt(adapter, survivor, true);
  // An outside-window Raw event can be accepted. The legacy receipt's own
  // unknown event time is still subject to the window once that row exists.
  const occurredAtMs = Math.max(...windows.map(([, end]) => end)) + 60_000;
  assert.deepEqual(await write(adapter, tx => adapter.raw.importArchive(tx, scope, windowReceipt, [
    { id: windowReceipt.messageId, role: receipt.role, content: receipt.excerpt, occurredAtMs },
  ])), { archived: 1, existing: 0, withheld: 0 });
  await assertWindowReceipt(adapter, survivor, false);
  editFixture(path, db => db.prepare("DELETE FROM cairn_migrated_raw_privacy WHERE kind = 'window'").run());
  await assertWindowReceipt(adapter, survivor, true);
});

test("a post-cutover forget window withholds an attested receipt with no Raw row", async t => {
  const now = Date.now();
  const { path, survivor } = await migrateWindow(t, { occurredAtMs: now });
  const adapter = await open(t, path);
  await assertWindowReceipt(adapter, survivor, true);
  const unused = () => assert.fail("Unexpected provider call");
  const countTokens = () => 1;
  const api = createMemoryService({ storage: adapter, config: { explicitWindowFence: { enabled: true } },
    clock: { nowMs: () => now, monotonicMs: () => 0, sha256Hex: async value => sha256(value), hmacHex: unused },
    gate: { assertOpen() {} }, tokens: { countTokens },
    model: { model: "synthetic", contextWindow: 4096, call: unused, countTokens },
    embedder: { model: "synthetic", dimensions: 2, embed: async texts => texts.map(() => new Float32Array([1, 0])) },
  });
  const target = await api.save(scope, "A separate synthetic owl keeps a ledger.", source, "fact");
  assert.equal(target.status, "saved");
  assert.equal((await api.forget(scope, target.item.id, source)).status, "forgotten");
  editFixture(path, db => {
    const { body } = db.prepare("SELECT body FROM cairn_suppression_facts WHERE json_extract(body, '$.kind') = 'window'").get();
    assert.deepEqual(JSON.parse(body).window, { startMs: now - 1_800_000, endMs: now + 1_800_000 });
    assert.equal(db.prepare("SELECT count(*) AS n FROM cairn_raw_messages").get().n, 0);
  });
  await assertWindowReceipt(adapter, survivor, false);
});

const insertDenial = (db, value) => db.prepare("INSERT INTO cairn_legacy_denials VALUES (?, ?, ?)").run(...scopeKey(scope), value);
const insertRawRule = (db, kind, selector, body) => db.prepare("INSERT INTO cairn_migrated_raw_privacy VALUES (?, ?, ?, ?, ?, ?)")
  .run(...scopeKey(scope), JSON.stringify(windowReceipt.client), kind, selector, JSON.stringify(body));

for (const [name, deny] of [
  ["address", db => insertDenial(db, receiptAddressDenial(windowReceipt))],
  ["receipt identity", db => insertDenial(db, receiptIdentityDenial(receiptIdentityKey(windowReceipt)))],
  ["span", (db, hash) => insertRawRule(db, "span", hash, [windowReceipt.messageId, 0, 1])],
  ["session", (db, hash) => db.prepare("INSERT INTO cairn_raw_fences VALUES (?, ?, ?)").run(...scopeKey(scope), hash)],
  ["UUID", db => {
    const { session_hash_key } = db.prepare("SELECT session_hash_key FROM cairn_store").get();
    return insertRawRule(db, "uuid", legacyRawHash(session_hash_key, scope, "local-raw-forgotten-uuid-v1",
      windowReceipt.client, windowReceipt.messageId), null);
  }],
]) {
  test(`the imported window bypass still enforces the ${name} denial`, async t => {
    const { path, survivor } = await migrateWindow(t);
    const adapter = await open(t, path);
    await assertWindowReceipt(adapter, survivor, true);
    editFixture(path, db => deny(db, adapter.hashSessionKey(scope, windowReceipt.client, sessionId)));
    await assertWindowReceipt(adapter, survivor, false);
  });
}

test("legacy rs1 address denial still withholds a receipt attested to have no Raw ancestry", async t => {
  // The legacy digest is role-bound. Migration must deny the retained address
  // even when the independent user receipt passed the legacy canonical read.
  const marker = "rs1:a:" + sha256(JSON.stringify([
    "receipt-source-address-v1", windowReceipt.client, sessionId, windowReceipt.messageId, "assistant",
  ]));
  const { path, survivor } = await migrateWindow(t, { marker });
  editFixture(path, db => {
    const denials = db.prepare("SELECT fingerprint FROM cairn_legacy_denials WHERE owner_id = ? AND namespace_key = ?")
      .all(...scopeKey(scope)).map(row => row.fingerprint);
    assert.ok(denials.includes(marker));
    assert.ok(denials.includes(receiptAddressDenial(windowReceipt)));
  });
  const adapter = await open(t, path);
  await assertWindowReceipt(adapter, survivor, false);
  const ref = { type: "memory", id: survivor.id, namespace: scope.namespace };
  const [hydrated] = await read(adapter, tx => adapter.hydrate.hydrate(tx, readSet, [ref], "export"));
  assert.equal(hydrated.memory.text, survivingText);
  assert.deepEqual(hydrated.receipts, []);
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
