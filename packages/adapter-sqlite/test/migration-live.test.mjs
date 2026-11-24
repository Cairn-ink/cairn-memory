import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { openMemoryCore } from "../../../core/index.mjs";
import { defaultRawOptions } from "../../../core/local-defaults.mjs";
import { rawRequest, splitRaw } from "../../../core/testing/raw-fixtures.mjs";
import { rationaleModel } from "../../../core/testing/rationale-model.mjs";
import { openSqliteAdapter } from "../src/index.mjs";
import { migrateLegacyStore } from "../src/migrate/index.mjs";
import { fixture, scratch } from "./legacy/fixtures.mjs";
import { coreScope, createLegacyBackup, fileDigest, ok, personal, prepareInput, project, service, sha256 } from "./migration-fixtures.mjs";
import { qualifyLiveMigration } from "./migration-live-fixtures.mjs";
import { seedRawDeletion } from "./raw-migration-fixtures.mjs";

for (const layout of [29, 48, 53]) test(`migrates visible Raw and its receipt ancestry from layout ${layout}`, async t => {
  await qualifyLiveMigration(scratch(t), layout);
});

test("refuses a retained Raw envelope before creating a replacement", async t => {
  const directory = scratch(t);
  const input = prepareInput(directory, await fixture(directory, 29, { localPrivacy: true }));
  const options = defaultRawOptions();
  const engine = openMemoryCore({ path: input.path, rawSearch: false, model: rationaleModel(),
    rawConversations: { ...options, port: { ...options.port, async sealRaw({ text }) {
      return { format: "envelope-aes-256-gcm-v1", keyVersion: "synthetic", sealed: Buffer.alloc(Buffer.byteLength(text) + 28) };
    } } },
  });
  try {
    const result = ok(await engine.captureRaw(rawRequest(splitRaw("Synthetic encrypted source")[0])));
    assert.equal(result.raw.parts[0].saved, true);
  } finally {
    await engine.close();
  }
  await createLegacyBackup(input);
  const digest = fileDigest(input.path);
  await assert.rejects(migrateLegacyStore(input), { code: "legacy_raw_format_unrepresentable" });
  assert.equal(existsSync(input.destination), false);
  assert.equal(fileDigest(input.path), digest);
});

test("a newly refused capture fences its session and closes earlier admission", async t => {
  const { input, time, deleted } = await seedRawDeletion(scratch(t));
  await createLegacyBackup(input);
  await migrateLegacyStore(input);
  const adapter = await openSqliteAdapter(input.destination);
  t.after(() => adapter.close());
  const api = service(adapter);
  const hour = 3_600_000;
  const rows = [
    { namespace: personal, id: "window", time: time + 2 * hour },
    { namespace: personal, id: "unknown-time", time: null },
    { namespace: project, id: "uuid", time: time - 2 * hour, source: deleted.request.messages[0].id },
  ];
  for (const { namespace, id, time: arrivingAt, source } of rows) {
    const scope = coreScope(namespace);
    const client = "claude-code";
    const sessionId = "refused-" + id;
    const first = { id: "first-" + id, role: "user", content: "Earlier visible synthetic source " + id,
      occurredAtMs: time - 2 * hour };
    const denied = { id: source ?? id, role: "user", content: "Refused synthetic source", occurredAtMs: arrivingAt };
    assert.deepEqual(await api.importRawMessages(scope, [{ client, sessionId, messages: [first] }]),
      { imported: 1, duplicate: 0, suppressed: 0, invalid: 0 });
    assert.deepEqual(await api.enqueueCapture(scope, { client, sessionId, eventId: id, messages: [first] }),
      { status: "accepted" });
    const read = body => adapter.uow.run(scope.owner, { readOnly: true }, body);
    const visible = async () => (await read(tx => adapter.raw.raw(tx, { owner: scope.owner, namespaces: [scope.namespace] },
      first.content, "search", { limit: 10 }))).segments.some(segment => segment.messageId === first.id);
    assert.equal(await visible(), true);
    const rejected = "rejected-" + id;
    await assert.rejects(api.enqueueCapture(scope, { client, sessionId, eventId: rejected, messages: [denied] }),
      { code: "lineage_fenced" });
    assert.equal(await visible(), false);
    assert.deepEqual(await api.captureStatus(scope, rejected, { client }), { status: "unknown" });
    assert.deepEqual(await api.captureStatus(scope, id, { client }), { status: "failed", code: "lineage_fenced" });
  }
});

test("refused Raw import preserves the fence without accepting the second arrival", async t => {
  const { input, time } = await seedRawDeletion(scratch(t));
  await createLegacyBackup(input);
  await migrateLegacyStore(input);
  const adapter = await openSqliteAdapter(input.destination);
  t.after(() => adapter.close());
  const api = service(adapter);
  const scope = coreScope(personal);
  const client = "codex", sessionId = "import-arrival";
  const first = { id: "first", role: "user", content: "Synthetic import across a window", occurredAtMs: time - 7_200_000 };
  const later = { ...first, id: "later", occurredAtMs: time + 7_200_000 };
  assert.equal((await api.importRawMessages(scope, [{ client, sessionId, messages: [first] }])).imported, 1);
  assert.equal((await api.importRawMessages(scope, [{ client, sessionId, messages: [later] }])).suppressed, 1);
  const key = { scope, client, sessionId, eventId: "fresh-event", payloadDigest: sha256("fresh-event") };
  await adapter.uow.run(scope.owner, { readOnly: true }, async tx => {
    assert.equal(await adapter.raw.archiveAllowed(tx, key), false);
    const page = await adapter.raw.listRaw(tx, { owner: scope.owner, namespaces: [scope.namespace] }, { cursor: null, limit: 10 });
    assert.equal(page.items.some(row => row.sessionId === sessionId), false);
  });
});
