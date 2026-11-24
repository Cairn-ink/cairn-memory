import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { coreDigest, engineLegacyDigest } from "@cairn-ink/core";
import { openMemoryCore } from "../../../core/index.mjs";
import { openSqliteAdapter } from "../src/index.mjs";
import { LEGACY_LAYOUTS } from "../src/legacy/refusal.mjs";
import { migrateLegacyStore } from "../src/migrate/index.mjs";
import { editFixture, fixture, scratch } from "./legacy/fixtures.mjs";
import {
  admit, coreScope, createLegacyBackup, fileDigest, legacyVisible, migratedVisible, ok,
  pausedScope, personal, prepareInput, project, seededStore, service, sha256,
} from "./migration-fixtures.mjs";

const source = { kind: "mcp", client: null, sessionId: null };

test("legacy forget evidence denies reads and future writes across the SQLite ports", async t => {
  const { input, sentinels } = await seededStore(scratch(t));
  const expected = await legacyVisible(input.path);
  await createLegacyBackup(input);
  const before = fileDigest(input.path);
  const result = await migrateLegacyStore(input);
  assert.equal(result.sourceLayout, 29);
  assert.equal(result.storeId, input.expectedStoreId);
  assert.deepEqual(result.pausedOwners, []);
  assert.equal(fileDigest(input.path), before);
  const bytes = readFileSync(input.destination);
  for (const { text } of sentinels) assert.equal(bytes.includes(Buffer.from(text)), false);
  const hashOnly = sentinels.find(item => item.hashOnly);
  editFixture(input.destination, db => {
    assert.equal(db.prepare("SELECT 1 FROM cairn_memories WHERE id = ?").get(hashOnly.id), undefined);
    assert.ok(db.prepare("SELECT 1 FROM cairn_legacy_denials WHERE fingerprint = ?")
      .get(sha256(hashOnly.text.toLowerCase())));
  });
  const adapter = await openSqliteAdapter(input.destination);
  t.after(() => adapter.close());
  assert.deepEqual(await migratedVisible(adapter), expected);
  const api = service(adapter);
  for (const { text, id, namespace, retainedId } of sentinels) {
    const scope = coreScope(namespace);
    const view = { owner: scope.owner, namespaces: [scope.namespace] };
    const ref = { type: "memory", id, namespace: scope.namespace };
    const [canonical, legacy] = await Promise.all([coreDigest(text), engineLegacyDigest(text)]);
    const query = [{ textHash: "sha256:" + canonical.value, legacyHash: "sha256:" + legacy.value }];
    await adapter.uow.run(scope.owner, { readOnly: true }, async tx => {
      const row = await adapter.memories.get(tx, scope, id);
      const revision = await adapter.memories.readRevision(tx, scope, id);
      if (retainedId) {
        assert.equal(row.text, "Corrected synthetic memory");
        assert.equal(revision.revision, 2);
        assert.notEqual(revision.textHash, query[0].textHash);
      } else {
        assert.equal(row, null);
        assert.equal(revision, null);
      }
      assert.deepEqual(await adapter.memories.findDuplicates(tx, scope, query, { nearDistance: 0 }), [[]]);
      for (const mode of ["hash", "full"]) {
        const policy = await adapter.memories.readWritePolicy(tx, scope, query, source, mode);
        assert.deepEqual(policy.blockedPositions, [0]);
        assert.deepEqual(policy.matches, [[]]);
      }
      assert.deepEqual((await adapter.lexical.lexical(tx, view, text.split(" ")[0], 50, {})).rows, []);
      assert.deepEqual((await adapter.raw.raw(tx, view, text, "search", { limit: 50 })).segments, []);
      assert.deepEqual((await adapter.raw.listRaw(tx, view, { cursor: null, limit: 50 })).items, []);
      for (const intent of ["export", "read", "recall"]) {
        const hydrated = await adapter.hydrate.hydrate(tx, view, [ref], intent);
        assert.deepEqual(hydrated.map(item => item.memory?.text), retainedId ? [row.text] : []);
      }
      assert.deepEqual(await adapter.fence.assertVisible(tx, view, [ref], "read"), retainedId ? [ref] : []);
      assert.equal((await adapter.recent.recent(tx, view, { cursor: null, limit: 50 })).items.some(item => item.text === text), false);
      assert.equal((await adapter.memories.exportPage(tx, scope, { cursor: null, limit: 50 })).items.some(item => item.text === text), false);
    });
    await assert.rejects(api.save(scope, text, source), { code: "ineligible" });
    assert.deepEqual(await api.importMemories(scope, [{ text, kind: "fact" }], { ...source, kind: "import" }),
      { imported: 0, duplicate: 0, suppressed: 1, invalid: 0 });
    const messages = [{ id: "new-message", role: "user", content: text, occurredAtMs: null }];
    const session = { client: "codex", sessionId: "new-raw-session" };
    assert.deepEqual(await api.importRawMessages(scope, [{ ...session, messages }]),
      { imported: 0, duplicate: 0, suppressed: 1, invalid: 0 });
    const digest = sha256(text);
    const key = { ...session, scope, eventId: digest, payloadDigest: digest };
    assert.deepEqual(await adapter.uow.run(scope.owner, {}, tx => adapter.raw.archive(tx, key, messages)),
      { archived: 0 });
    const write = callback => adapter.uow.run(scope.owner, { pauseLock: true }, callback);
    const supplied = [{ ...messages[0], content: "Independent synthetic capture evidence" }];
    const claim = await write(tx => adapter.capture.claim(tx, key, supplied, { leaseMs: 60_000 }));
    assert.equal(claim.status, "claimed");
    const captured = await write(tx => adapter.capture.finish(tx, claim.token, [{
      content: text, kind: "fact", confidence: 0.5, textHash: query[0].textHash, embedding: null, receipts: [],
    }]));
    assert.equal(captured.suppressedCount, 1);
    assert.deepEqual(captured.memories, []);
  }
  const scope = coreScope(personal);
  assert.equal((await api.save(scope, "New synthetic memory with no denial", source)).status, "saved");
  await adapter.uow.run(scope.owner, {}, async tx => {
    const previous = await adapter.suppressions.epoch(tx, scope.owner);
    assert.ok(previous >= BigInt(sentinels.length));
    const fact = await adapter.suppressions.writeFact(tx,
      { ...scope, origin: "forget", actionId: "new-action", kind: "identity", memoryId: "synthetic-id" },
      sha256("synthetic-incarnation"));
    assert.equal(fact.epoch, previous + 1n);
  });
  const paused = await adapter.uow.run(pausedScope.ownerId, { pauseLock: true, readOnly: true },
    tx => adapter.pause.get(tx, pausedScope.ownerId));
  assert.deepEqual(paused, { paused: false, generation: 1 });
});

test("copies layout 18 while preserving exact fractional keys and owner scope boundaries", async t => {
  const directory = scratch(t);
  const legacy = await fixture(directory, 18);
  const engine = openMemoryCore({ path: legacy.path });
  const a = admit(engine, "Old layout memory");
  const b = admit(engine, "Old layout project memory", project);
  engine.close();
  editFixture(legacy.path, db => db.prepare("UPDATE memories SET updated_at = ? WHERE id = ?")
    .run("2024-01-01T12:34:56.987654Z", a.id));
  const input = prepareInput(directory, legacy);
  await createLegacyBackup(input);
  const before = fileDigest(input.path);
  assert.equal((await migrateLegacyStore(input)).sourceLayout, 18);
  assert.equal(fileDigest(input.path), before);
  const adapter = await openSqliteAdapter(input.destination);
  t.after(() => adapter.close());
  const scope = coreScope(personal);
  await adapter.uow.run(scope.owner, { readOnly: true }, async tx => {
    const row = await adapter.memories.get(tx, scope, a.id);
    assert.equal(row.updatedAtUs, 1704112496987654n);
    assert.equal(await adapter.memories.get(tx, scope, b.id), null);
    assert.equal((await adapter.memories.get(tx, coreScope(project), b.id)).text, "Old layout project memory");
  });
});

test("a stale pre-forget backup is refused before a destination write", async t => {
  const directory = scratch(t);
  const input = prepareInput(directory, await fixture(directory, 29));
  const engine = openMemoryCore({ path: input.path });
  const memory = admit(engine, "Backup sentinel");
  assert.equal(ok(engine.get({ namespace: personal, memoryId: memory.id })).memory.content, "Backup sentinel");
  engine.close();
  await createLegacyBackup(input);
  const forgetting = openMemoryCore({ path: input.path });
  ok(forgetting.forget({ namespace: personal, memoryId: memory.id, expectedRevision: memory.revision }));
  forgetting.close();
  const before = fileDigest(input.path);
  await assert.rejects(migrateLegacyStore(input), { code: "legacy_backup_stale" });
  assert.equal(fileDigest(input.path), before);
  assert.equal(existsSync(input.destination), false);
});

test("all other legacy layouts refuse without copying or changing source bytes", async t => {
  const directory = scratch(t);
  for (const physical of LEGACY_LAYOUTS.filter(layout => layout !== 29 && layout !== 18)) {
    const input = prepareInput(directory, await fixture(directory, physical));
    const before = fileDigest(input.path);
    await assert.rejects(migrateLegacyStore(input), { code: [48, 53].includes(physical) ? "legacy_backup_unpublished" : "legacy_cross_version" });
    assert.equal(fileDigest(input.path), before);
    assert.equal(existsSync(input.destination), false);
  }
  const path = join(directory, "layout-29.sqlite");
  const legacy = await fixture(directory, 29);
  editFixture(path, db => db.exec("PRAGMA user_version = 99"));
  const before = fileDigest(path);
  await assert.rejects(migrateLegacyStore(prepareInput(directory, legacy)), { code: "legacy_unknown_layout" });
  assert.equal(fileDigest(path), before);
});

function crash(input, at) {
  const source = `
    import { migrateLegacyStore } from ${JSON.stringify(new URL("../src/migrate/index.mjs", import.meta.url).href)};
    const [json, at] = process.argv.slice(1);
    await migrateLegacyStore({ ...JSON.parse(json), onCheckpoint(name) {
      if (name === at) process.kill(process.pid, "SIGKILL");
    } });
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", source, JSON.stringify(input), at],
    { encoding: "utf8", timeout: 30_000 });
  assert.equal(child.signal, "SIGKILL", child.stderr);
}

test("process loss at each checkpoint is fail-closed and resumes the same migration", async t => {
  const directory = scratch(t);
  const { input } = await seededStore(directory);
  const expected = await legacyVisible(input.path);
  await createLegacyBackup(input);
  const before = fileDigest(input.path);
  for (const [index, checkpoint] of ["initialized", "memories", "privacy", "verified"].entries()) {
    const destination = join(directory, checkpoint + ".sqlite");
    const current = { ...input, destination };
    crash(current, checkpoint);
    const record = editFixture(destination, db => db.prepare("SELECT migration_id, checkpoint FROM cairn_migration").get());
    assert.equal(record.checkpoint, index);
    if (checkpoint !== "verified") {
      await assert.rejects(openSqliteAdapter(destination), { code: "storage_error" });
    }
    const resumed = await migrateLegacyStore(current);
    assert.equal(resumed.migrationId, record.migration_id);
    assert.deepEqual(await migrateLegacyStore(current), resumed);
    assert.equal(fileDigest(input.path), before);
    const adapter = await openSqliteAdapter(destination);
    try { assert.deepEqual(await migratedVisible(adapter), expected); }
    finally { await adapter.close(); }
  }
});

test("verification failure cannot mark a mismatched copy as complete", async t => {
  const directory = scratch(t);
  const { input } = await seededStore(directory);
  await createLegacyBackup(input);
  crash(input, "privacy");
  const before = fileDigest(input.path);
  const removed = editFixture(input.destination, db => {
    const table = "cairn_legacy_denials";
    const row = db.prepare(`SELECT * FROM ${table} LIMIT 1`).get();
    db.prepare(`DELETE FROM ${table} WHERE (owner_id, namespace_key, fingerprint) = (?, ?, ?)`).run(...Object.values(row));
    return row;
  });
  await assert.rejects(migrateLegacyStore(input), { code: "legacy_integrity_mismatch" });
  await assert.rejects(openSqliteAdapter(input.destination), { code: "storage_error" });
  const record = editFixture(input.destination, db => {
    const record = db.prepare("SELECT checkpoint, attestation FROM cairn_migration").get();
    db.prepare("INSERT INTO cairn_legacy_denials VALUES (?, ?, ?)").run(...Object.values(removed));
    return record;
  });
  assert.deepEqual({ ...record }, { checkpoint: 2, attestation: null });
  assert.match((await migrateLegacyStore(input)).attestation, /^[0-9a-f]{64}$/u);
  assert.equal(fileDigest(input.path), before);
});
