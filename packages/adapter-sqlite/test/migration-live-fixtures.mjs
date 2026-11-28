import assert from "node:assert/strict";
import { copyFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { migrateContentSafety, migrateReceiptEventTime } from "../../../core/content-safety-migration.mjs";
import { openMemoryCore } from "../../../core/index.mjs";
import { defaultRawOptions } from "../../../core/local-defaults.mjs";
import { rawRequest, splitRaw } from "../../../core/testing/raw-fixtures.mjs";
import { rationaleModel } from "../../../core/testing/rationale-model.mjs";
import { openSqliteAdapter } from "../src/index.mjs";
import { migrateLegacyStore } from "../src/migrate/index.mjs";
import { editFixture, fixture } from "./legacy/fixtures.mjs";
import { admit, coreScope, createLegacyBackup, fileDigest, legacyVisible, migratedVisible,
  ok, personal, prepareInput, project, service } from "./migration-fixtures.mjs";
import { legacyRawVisible, migratedRawVisible } from "./raw-migration-fixtures.mjs";

const hour = 3_600_000;
const model = { ...rationaleModel(), extract: ({ input }) => ({ items: input.messages.map(message => ({
  content: "Derived " + message.content.split(" ")[0], kind: "fact", confidence: 0.8, sourceIndices: [message.index],
})) }) };

export async function seedLiveMigration(directory, layout) {
  const legacy = await fixture(directory, layout === 29 ? 29 : 33, { localPrivacy: true });
  const input = prepareInput(directory, legacy);
  const time = Date.now();
  const retired = [];
  const engine = openMemoryCore({ path: input.path, model, rawSearch: false, rawConversations: defaultRawOptions() });
  async function capture(id, namespace, when) {
    const raw = id + " synthetic archived source";
    const request = rawRequest(splitRaw(raw, { id, occurredAt: new Date(when).toISOString() })[0],
      { namespace, sessionId: id + "-session" });
    const value = ok(await engine.captureRaw(request));
    const memory = ok(value.interpretation).admission.memories[0];
    assert.equal(ok(engine.get({ namespace, memoryId: memory.id })).memory.content, "Derived " + id);
    return { memory, namespace, request, raw, conversationId: value.raw.conversationId };
  }
  let live, deleted, hidden;
  try {
    live = await capture("camellia", personal, time - 4 * hour);
    deleted = await capture("azalea", project, time - 2 * hour);
    hidden = await capture("dogwood", personal, time);
    const before = await legacyRawVisible(input.path);
    for (const { raw } of [live, deleted, hidden]) assert.ok(before.some(row => row.content === raw));
    const { conversation } = ok(await engine.getConversation({ namespace: project, conversationId: deleted.conversationId }));
    ok(await engine.deleteConversation({ namespace: project, conversationId: deleted.conversationId,
      expectedRevision: conversation.revision, actionId: "remove-conversation" }));
    ok(await engine.forget({ namespace: personal, memoryId: hidden.memory.id, expectedRevision: hidden.memory.revision }));
    const shared = { client: "manual", sessionId: "shared-session", eventId: "shared-message",
      role: "user", excerpt: "A shared synthetic receipt" };
    const forgotten = admit(engine, "Deleted synthetic memory", project, [shared]);
    const surviving = admit(engine, "Surviving synthetic memory", project, [shared]);
    ok(await engine.forget({ namespace: project, memoryId: forgotten.id, expectedRevision: forgotten.revision }));
    assert.equal(ok(engine.get({ namespace: project, memoryId: surviving.id })).receipts.length, 0);
    const control = ok(engine.getCaptureControl({ namespace: project }));
    ok(engine.setCapturePaused({ namespace: project, expectedGeneration: control.generation, paused: true }));
    assert.equal(ok(engine.getCaptureControl({ namespace: personal })).paused, false);
    retired.push({ namespace: project, memory: forgotten, text: "Deleted synthetic memory" });
  } finally {
    await engine.close();
  }
  const lease = "Synthetic unfinished admission token";
  editFixture(input.path, db => db.prepare(`INSERT INTO admission_claims
    (owner_id, scope, project_id, client, event_id, payload_digest, state, token, lease_expires_at)
    VALUES (?, 'personal', '', 'codex', 'interrupted-capture', ?, 'pending', ?, ?)`)
    .run(personal.ownerId, "a".repeat(64), lease, time + hour));
  if (layout !== 29) {
    const backupPath = join(directory, "safety-bootstrap.sqlite");
    copyFileSync(input.path, backupPath);
    const migrate = layout === 48 ? migrateContentSafety : migrateReceiptEventTime;
    const result = await migrate({ path: input.path, backupPath,
      expected: { storeId: input.expectedStoreId, base: 33 }, quiescence: input.quiescence });
    assert.equal(result.physical, layout);
  }
  return { input, live, deleted, hidden, retired, time, lease };
}

export async function qualifyLiveMigration(directory, layout) {
  const { input, live, deleted, hidden, retired, lease, time } = await seedLiveMigration(directory, layout);
  const expected = await legacyVisible(input.path);
  const rawExpected = await legacyRawVisible(input.path);
  assert.deepEqual(rawExpected.map(row => row.content), [live.raw]);
  assert.equal(expected.find(row => row.text === "Surviving synthetic memory").receipts.length, 0);
  await createLegacyBackup(input);
  const digest = fileDigest(input.path);
  const migrated = await migrateLegacyStore(input);
  assert.equal(fileDigest(input.path), digest);
  assert.equal(migrated.sourceLayout, layout);
  assert.equal(migrated.archived.rawMessages, 1);
  assert.ok(migrated.archived.rawSourceMaps);
  assert.ok(migrated.archived.rawReceiptLineage);
  assert.equal(migrated.ledger.invalidated, 1);
  assert.ok(layout === 29 || (migrated.safetyFacts > 0 && migrated.identityReservations > 0));
  if (layout !== 29) {
    const expectedFacts = editFixture(input.path, db => db.prepare(`SELECT fact_id AS identity,
      epoch_hi, epoch_lo, reason, evidence_origin AS origin FROM content_suppressions ORDER BY fact_id`).all())
      .map(({ epoch_hi, epoch_lo, ...row }) => ({ ...row, epoch: ((BigInt(epoch_hi) << 32n) | BigInt(epoch_lo)).toString() }));
    const actualFacts = editFixture(input.destination, db => db.prepare(`SELECT identity, epoch, reason, origin
      FROM cairn_migrated_safety WHERE kind='fact' ORDER BY identity`).all()).map(row => ({ ...row }));
    assert.deepEqual(actualFacts, expectedFacts);
  }
  const ledgerCounts = editFixture(input.destination, db =>
    db.prepare("SELECT (SELECT count(*) FROM cairn_capture_outbox) AS outbox, (SELECT count(*) FROM cairn_capture_claims) AS claims").get());
  assert.equal(ledgerCounts.outbox + ledgerCounts.claims, 0);
  const replacement = await openSqliteAdapter(input.destination);
  try {
    assert.deepEqual(await migratedVisible(replacement), expected);
    assert.deepEqual(await migratedRawVisible(replacement), rawExpected);
    const scope = coreScope(live.namespace);
    const selection = { owner: scope.owner, namespaces: [scope.namespace] };
    const spans = await replacement.uow.run(scope.owner, { readOnly: true }, tx =>
      replacement.spanLineage.resolveSpans(tx, scope, live.memory.id));
    assert.equal(spans.length, 1);
    assert.equal(spans[0].messageKey, live.request.messages[0].id);
    assert.equal(spans[0].endUtf16, live.raw.length);
    assert.equal((await replacement.uow.run(scope.owner, { readOnly: true }, tx =>
      replacement.raw.raw(tx, selection, "camellia", "search", { limit: 5 }))).segments[0].content, live.raw);
    const api = service(replacement);
    await assert.rejects(api.enqueueCapture(scope, { client: live.request.client,
      sessionId: live.request.sessionId, eventId: live.request.eventId,
      messages: [{ id: live.request.messages[0].id, role: "user", content: live.raw, occurredAtMs: null }],
    }), { code: "capture_evidence_closed" });
    await assert.rejects(api.enqueueCapture(scope, { client: "codex", sessionId: "interrupted",
      eventId: "interrupted-capture",
      messages: [{ id: "interrupt-source", role: "user", content: "Synthetic unfinished capture", occurredAtMs: Date.now() }],
    }), { code: "capture_evidence_closed" });
    const arrival = { client: "codex", sessionId: "new-session", eventId: "new-event",
      messages: [{ id: "new-source", role: "user", content: "Synthetic new capture", occurredAtMs: time - 4 * hour }] };
    assert.equal((await api.pauseState(scope.owner)).paused, false);
    await assert.rejects(api.enqueueCapture(coreScope(project), arrival), { code: "capture_disabled" });
    assert.deepEqual(await api.enqueueCapture(scope, arrival), { status: "accepted" });
    for (const item of [deleted, hidden, ...retired]) {
      const itemScope = coreScope(item.namespace);
      const readSet = { owner: itemScope.owner, namespaces: [itemScope.namespace] };
      await replacement.uow.run(itemScope.owner, { readOnly: true }, async tx => {
        assert.equal(await replacement.memories.get(tx, itemScope, item.memory.id), null);
        const ref = { type: "memory", namespace: itemScope.namespace, id: item.memory.id };
        assert.deepEqual(await replacement.fence.assertVisible(tx, readSet, [ref], "read"), []);
        assert.deepEqual(await replacement.hydrate.hydrate(tx, readSet, [ref], "export"), []);
      });
    }
  } finally {
    await replacement.close();
  }
  const file = readFileSync(input.destination);
  for (const { raw } of [deleted, hidden]) assert.equal(file.includes(raw), false);
  for (const { text } of retired) assert.equal(file.includes(text), false);
  assert.equal(file.includes(lease), false);
  return { sourceLayout: layout, legacyVisible: expected.length, migratedVisible: expected.length,
    legacyRawVisible: rawExpected.length, migratedRawVisible: migrated.archived.rawMessages,
    safetyFacts: migrated.safetyFacts, identityReservations: migrated.identityReservations, ledger: migrated.ledger };
}
