import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { createMemoryService } from "@cairn-ink/core/service";
import { openMemoryCore } from "../../../core/index.mjs";
import { rationaleModel } from "../../../core/testing/rationale-model.mjs";
import { localPlainPort, rawRequest, splitRaw } from "../../../core/testing/raw-fixtures.mjs";
import { createMemoryAdapter } from "../../adapter-memory/src/index.mjs";
import { openSqliteAdapter } from "../src/index.mjs";
import { migrateLegacyStore } from "../src/migrate/index.mjs";
import { editFixture, fixture as legacyFixture, scratch } from "./legacy/fixtures.mjs";
import { admit, coreScope, createLegacyBackup, ok, personal, prepareInput, sha256 } from "./migration-fixtures.mjs";
import { fixture as sqliteFixture } from "./storage-fixtures.mjs";

const scope = coreScope(personal);
const source = { kind: "mcp", client: null, sessionId: null };
const clock = { async hmacHex(key, value) { return createHmac("sha256", key).update(value).digest("hex"); } };
const receipt = { client: "cairn-local-mcp", sessionId: "explicit-tool", messageId: "explicit-save",
  role: "user", occurredAtMs: null, excerpt: "Notes from an explicit save." };
const write = (storage, operation) => storage.uow.run(scope.owner, { pauseLock: true }, operation);
const inspect = (storage, memoryId) =>
  createMemoryService({ profile: "keyless-local", storage, clock }).inspect(scope, { memoryId });

async function save(storage, retained = receipt) {
  const text = "Keep this explicit synthetic Memory.";
  return write(storage, tx => storage.memories.insert(tx, scope,
    { text, textHash: "sha256:" + sha256(text.toLowerCase()), kind: "fact", origin: "explicit",
      confidence: 1, source, embedding: null },
    [retained], 1));
}

function rawInput(retained) {
  return [{ scope, client: retained.client, sessionId: retained.sessionId, eventId: "raw-event", payloadDigest: "a".repeat(64) },
    [{ id: retained.messageId, role: retained.role, content: retained.excerpt, occurredAtMs: retained.occurredAtMs }]];
}

async function open(t, name) {
  if (name === "memory") return createMemoryAdapter({ capabilities: { inspect: true, rawArchive: true } });
  const opened = await sqliteFixture();
  t.after(opened.close);
  return opened.adapter;
}

async function assertReceipt(storage, memoryId, retained = receipt) {
  const item = await inspect(storage, memoryId);
  assert.equal(item.memory.receiptCount, 1);
  assert.deepEqual(item.receipts.map(({ id, createdAtMs, ...row }) => row),
    [{ ...retained, eventId: retained.messageId }]);
}

async function assertWithheld(storage, memoryId) {
  const item = await inspect(storage, memoryId);
  assert.equal(item.memory.receiptCount, 0);
  assert.deepEqual(item.receipts, []);
}

for (const name of ["memory", "sqlite"]) {
  test(`${name}: Raw-enabled inspect delivers an explicit-save receipt with no Raw source`, async t => {
    const storage = await open(t, name);
    const { id } = await save(storage);
    await assertReceipt(storage, id);
  });

  test(`${name}: fencing the explicit-save session withholds the same receipt`, async t => {
    const storage = await open(t, name);
    const { id } = await save(storage);
    const before = await inspect(storage, id);
    await write(storage, tx => storage.raw.fenceSession(tx, scope, receipt));
    await assertWithheld(storage, id);
    assert.deepEqual(before.receipts.map(row => row.excerpt), [receipt.excerpt]);
  });

  test(`${name}: forgetting an archived source withholds its receipt`, async t => {
    const storage = await open(t, name);
    const retained = { ...receipt, client: "capture-client", sessionId: "capture-session" };
    const raw = rawInput(retained);
    assert.deepEqual(await write(storage, tx => storage.raw.archive(tx, ...raw)), { archived: 1 });
    const { id } = await save(storage, retained);
    await assertReceipt(storage, id, retained);
    assert.deepEqual(await write(storage, tx => storage.raw.deleteConversation(tx, scope, retained)), { rawDeleted: 1 });
    await assertWithheld(storage, id);
  });

  test(`${name}: a lineage record without an archived source keeps the receipt withheld`, async t => {
    const storage = await open(t, name);
    const original = { ...receipt, client: "capture-client", sessionId: "original-session" };
    const raw = rawInput(original);
    await write(storage, tx => storage.raw.recordLineage(tx, ...raw));
    const { id } = await save(storage, { ...original, sessionId: "forked-session" });
    await assertWithheld(storage, id);
  });
}

async function converted(t, { fenced = false, archived = false, oldFormat = false } = {}) {
  const directory = scratch(t);
  const legacy = await legacyFixture(directory, 29);
  const engine = openMemoryCore({ path: legacy.path, ...(archived && { model: rationaleModel(), rawSearch: false,
    rawConversations: { mode: "raw-v1", capBytes: 100_000, port: localPlainPort(),
      readPolicy: () => ({ generation: "synthetic-policy", reason: null }) } }) });
  const fencedReceipt = { ...receipt, sessionId: "fenced-session" };
  const legacyReceipt = ({ messageId, occurredAtMs, ...row }) => ({ ...row, eventId: messageId });
  let allowed, covered, derived, request;
  try {
    allowed = admit(engine, "An independent legacy Memory.", personal, [legacyReceipt(receipt)]);
    if (fenced) covered = admit(engine, "A legacy Memory with a fenced source.", personal, [legacyReceipt(fencedReceipt)]);
    assert.equal(ok(engine.get({ namespace: personal, memoryId: allowed.id })).receipts.length, 1);
    if (archived) {
      request = rawRequest(splitRaw("A synthetic Memory derived from an archived turn.")[0],
        { namespace: personal, sessionId: "archived-legacy-session" });
      const captured = ok(await engine.captureRaw(request));
      derived = ok(captured.interpretation).admission.memories[0];
      assert.equal(ok(engine.get({ namespace: personal, memoryId: derived.id })).receipts.length, 1);
    }
  } finally {
    await engine.close();
  }
  if (fenced) editFixture(legacy.path, db => db.prepare("INSERT INTO raw_session_fences VALUES (?, ?, ?, ?, ?)")
    .run(personal.ownerId, personal.scope, "", fencedReceipt.client, fencedReceipt.sessionId));
  const input = prepareInput(directory, legacy);
  await createLegacyBackup(input);
  const result = await migrateLegacyStore(input);
  assert.equal(result.rawFences, Number(fenced));
  assert.equal(result.withheldReceipts, Number(fenced));
  if (oldFormat) editFixture(input.destination, db => db.exec(
    "UPDATE cairn_receipts SET body = json_remove(body, '$.legacyRawAncestryEmpty')"));
  const storage = await openSqliteAdapter(input.destination);
  t.after(() => storage.close());
  return { storage, allowed, covered, fencedReceipt, derived, request };
}

test("sqlite: a Raw-enabled conversion delivers an uncovered legacy receipt", async t => {
  const { storage, allowed } = await converted(t);
  await assertReceipt(storage, allowed.id);
});

test("sqlite: a carried legacy session fence withholds only the covered receipt", async t => {
  const { storage, allowed, covered, fencedReceipt } = await converted(t, { fenced: true });
  await assertWithheld(storage, covered.id);
  const { id } = await save(storage, fencedReceipt);
  await assertWithheld(storage, id);
  await assertReceipt(storage, allowed.id);
});

test("sqlite: older migrations can prove empty ancestry from an empty source inventory", async t => {
  const { storage, allowed } = await converted(t, { oldFormat: true });
  await assertReceipt(storage, allowed.id);
});

test("sqlite: losing legacy roots withholds the derived receipt alongside an independent receipt", async t => {
  const { storage, allowed, derived, request } = await converted(t, { archived: true });
  await assertReceipt(storage, allowed.id);
  await assertWithheld(storage, derived.id);
  const archived = request.messages.map(({ id, role, content, occurredAt }) =>
    ({ id, role, content, occurredAtMs: occurredAt === null ? null : Date.parse(occurredAt) }));
  const key = { scope, client: request.client, sessionId: request.sessionId, eventId: request.eventId,
    payloadDigest: "a".repeat(64) };
  assert.equal((await write(storage, tx => storage.raw.archive(tx, key, archived))).archived, archived.length);
  await assertWithheld(storage, derived.id);
});
