import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import test from "node:test";
import { openSqliteAdapter, openSqliteUnitOfWork } from "../src/index.mjs";
import { migrateLegacyStore } from "../src/migrate/index.mjs";
import { BOOTSTRAP_FILENAME } from "../src/migrate/layout.mjs";
import { editFixture, fixture, scratch } from "./legacy/fixtures.mjs";
import { coreScope, createLegacyBackup, fileDigest, prepareInput, service, sha256 } from "./migration-fixtures.mjs";
import { legacyRawVisible, migratedRawVisible, seedRawDeletion } from "./raw-migration-fixtures.mjs";

const minute = 60_000;
const refFor = (scope, key, id) => ({
  type: "raw", namespace: scope.namespace, id: JSON.stringify([scope.owner, scope.namespace, key.client, key.sessionId, id]),
});
const selection = scope => ({ owner: scope.owner, namespaces: [scope.namespace] });
const read = (adapter, scope, body) => adapter.uow.run(scope.owner, { readOnly: true }, body);
const write = (adapter, scope, body) => adapter.uow.run(scope.owner, { pauseLock: true }, body);
const replay = (request, sessionId = request.sessionId) => ({
  scope: coreScope(request.namespace), client: request.client, sessionId,
  eventId: "replay-" + request.eventId, payloadDigest: sha256(request.eventId),
});
const messagesOf = request => request.messages.map(({ id, role, content, occurredAt }) => ({
  id, role, content, occurredAtMs: occurredAt === null ? null : Date.parse(occurredAt),
}));

test("migrates Raw deletion journals and denies replay through the SQLite ports", async t => {
  const { input, deleted, spanned, unknown, time } = await seedRawDeletion(scratch(t));
  assert.deepEqual(await legacyRawVisible(input.path), []);
  await createLegacyBackup(input);
  const before = fileDigest(input.path);
  const result = await migrateLegacyStore(input);
  assert.ok(result.rawFences >= 3);
  assert.equal(fileDigest(input.path), before);
  assert.ok(result.dropped.rawMessages >= 2);
  const proof = editFixture(input.destination, db =>
    JSON.parse(db.prepare("SELECT source_evidence FROM cairn_migration").get().source_evidence));
  assert.deepEqual(proof.rawDeletionActions.map(row => row.action_id), ["remove-magnolia"]);
  assert.equal(proof.rawDeletionEffects.filter(row => row.entity_type === "conversation").length, 1);
  assert.equal(editFixture(input.destination, db => db.prepare(
    "SELECT count(*) AS n FROM cairn_migrated_raw_privacy WHERE kind = 'range' AND json_extract(body, '$[2]') = 1").get().n) >= 1, true);

  const adapter = await openSqliteAdapter(input.destination);
  t.after(() => adapter.close());
  const api = service(adapter);
  const refused = async (key, messages) => {
    const { scope, client, sessionId } = key;
    const writePort = body => write(adapter, scope, body);
    const readPort = body => read(adapter, scope, body);
    assert.deepEqual(await writePort(tx => adapter.raw.archive(tx, key, messages)), { archived: 0 });
    assert.deepEqual(await api.importRawMessages(scope, [{ client, sessionId, messages }]),
      { imported: 0, duplicate: 0, suppressed: messages.length, invalid: 0 });
    assert.deepEqual(await readPort(tx => adapter.capture.eligible(tx, key, messages)), []);
    await assert.rejects(writePort(tx => adapter.capture.claim(tx, key, messages, { leaseMs: minute })),
      { code: "lineage_fenced" });
    await assert.rejects(writePort(tx => adapter.capture.admit(tx, key, messages)), { code: "lineage_fenced" });
    for (const { id, content } of messages) {
      const refs = [refFor(scope, key, id)];
      await readPort(async tx => {
        assert.deepEqual((await adapter.raw.raw(tx, selection(scope), content, "search", { limit: 10 })).segments, []);
        assert.deepEqual(await adapter.fence.assertVisible(tx, selection(scope), refs, "read"), []);
      });
    }
  };
  for (const item of [deleted, spanned, unknown]) {
    const key = replay(item.request);
    const messages = messagesOf(item.request);
    assert.equal(await read(adapter, key.scope, tx => adapter.raw.archiveAllowed(tx, key)), false);
    assert.deepEqual(await api.enqueueCapture(key.scope, { client: key.client, sessionId: key.sessionId,
      eventId: key.eventId, messages }), { status: "blocked" });
    await refused(key, messages);
  }
  // Move the same UUID to a fresh session and outside the window.
  const fork = replay(deleted.request, "fresh-session");
  await refused(fork, [{ ...messagesOf(deleted.request)[0], occurredAtMs: time - 120 * minute }]);
  // Neither endpoint is within the window. Legacy tests the session range.
  const across = replay(spanned.request, "session-crossing-window");
  await refused(across, [
    { id: "earlier", role: "user", content: "Earlier synthetic evidence", occurredAtMs: time - 120 * minute },
    { id: "later", role: "user", content: "Later synthetic evidence", occurredAtMs: time + 120 * minute },
  ]);
  assert.deepEqual(await migratedRawVisible(adapter), []);
  // A fresh UUID outside the window and a different namespace remain eligible.
  const control = { id: "outside", role: "user", content: "Independent synthetic evidence", occurredAtMs: time - 120 * minute };
  const allowed = replay(spanned.request, "outside-window");
  assert.deepEqual(await write(adapter, allowed.scope, tx => adapter.raw.archive(tx, allowed, [control])), { archived: 1 });
  assert.deepEqual(await read(adapter, allowed.scope, tx => adapter.capture.eligible(tx, allowed, [control])), [0]);
  const otherScope = { ...allowed.scope, namespace: "project\0other-project" };
  assert.deepEqual(await read(adapter, otherScope, tx => adapter.capture.eligible(tx, {
    ...across, scope: otherScope,
  }, [{ ...control, occurredAtMs: time }])), [0]);
  const forgottenRef = { type: "memory", namespace: allowed.scope.namespace, id: spanned.memory.id };
  await read(adapter, allowed.scope, async tx => {
    assert.equal(await adapter.memories.get(tx, allowed.scope, spanned.memory.id), null);
    assert.deepEqual(await adapter.hydrate.hydrate(tx, selection(allowed.scope), [forgottenRef], "export"), []);
  });
  await adapter.close();
  const bytes = readFileSync(input.destination);
  for (const item of [deleted, spanned, unknown]) assert.equal(bytes.includes(item.raw), false);
  assert.equal(existsSync(input.destination + "-wal"), false);
});

test("refuses a deletion journal without retained session fences", async t => {
  const { input } = await seedRawDeletion(scratch(t));
  editFixture(input.path, db => db.prepare("DELETE FROM raw_session_fences WHERE scope = 'project'").run());
  await createLegacyBackup(input);
  const before = fileDigest(input.path);
  await assert.rejects(migrateLegacyStore(input), { code: "legacy_raw_privacy_unrepresentable" });
  assert.equal(existsSync(input.destination), false);
  assert.equal(fileDigest(input.path), before);
});

for (const publish of [false, true]) {
  test(`resumes after process loss ${publish ? "after" : "before"} publishing the bootstrap`, async t => {
    const directory = scratch(t);
    const input = prepareInput(directory, await fixture(directory, 18));
    await createLegacyBackup(input);
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import fs from "node:fs";
      import { syncBuiltinESMExports } from "node:module";
      const link = fs.linkSync;
      fs.linkSync = (...args) => {
        if (${publish}) link(...args);
        process.kill(process.pid, "SIGKILL");
      };
      syncBuiltinESMExports();
      const { migrateLegacyStore } = await import(${JSON.stringify(new URL("../src/migrate/index.mjs", import.meta.url).href)});
      await migrateLegacyStore(JSON.parse(process.argv[1]));
    `, JSON.stringify(input)], { encoding: "utf8", timeout: 30_000 });
    assert.equal(child.signal, "SIGKILL", child.stderr);
    const [scratchName] = readdirSync(directory).filter(name => name.startsWith(".sqlite-migration-"));
    assert.ok(scratchName);
    const file = directory + "/" + scratchName + "/" + BOOTSTRAP_FILENAME;
    assert.throws(() => openSqliteUnitOfWork(file), { code: "storage_error" });
    if (publish) {
      assert.equal(statSync(input.destination).nlink, 2);
      assert.throws(() => openSqliteUnitOfWork(input.destination), { code: "storage_error" });
    } else {
      assert.equal(existsSync(input.destination), false);
    }
    await migrateLegacyStore(input);
    assert.equal(existsSync(file), false);
    assert.equal(statSync(input.destination).nlink, 1);
    await openSqliteUnitOfWork(input.destination).close();
  });
}
