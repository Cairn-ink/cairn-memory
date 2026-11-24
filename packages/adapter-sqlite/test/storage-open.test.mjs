import assert from "node:assert/strict";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { APPLICATION_ID } from "../../../core/database.mjs";
import { openSqliteAdapter, SQLITE_PHYSICAL_VERSION } from "../src/index.mjs";
import { inventoryLegacyStore } from "../src/legacy/inventory.mjs";
import { LEGACY_LAYOUTS, LEGACY_RULES, LegacyRefusal } from "../src/legacy/refusal.mjs";
import { INITIALIZE_STORE, SQLITE_APPLICATION_ID, STORAGE_SCHEMA } from "../src/schema/layout.mjs";
import { editFixture, fixture, scratch } from "./legacy/fixtures.mjs";
import { sha256 } from "./storage-fixtures.mjs";

function legacyClassification(file) {
  try {
    return inventoryLegacyStore(file);
  } catch (error) {
    if (!(error instanceof LegacyRefusal)) throw error;
    return error.code;
  }
}

async function assertRefusedWithoutChange(file) {
  const before = legacyClassification(file);
  const digest = sha256(readFileSync(file));
  await assert.rejects(openSqliteAdapter(file).then(adapter => adapter.close()), { code: "storage_error" });
  assert.equal(sha256(readFileSync(file)), digest);
  assert.deepEqual(legacyClassification(file), before);
}

for (let version = Math.min(...LEGACY_LAYOUTS); version <= LEGACY_RULES.firstPossibleSuccessor + 1; version++) {
  test(`refuses legacy application layout ${version} without changing bytes or inventory`, async t => {
    const supported = LEGACY_LAYOUTS.includes(version);
    const { path: file } = await fixture(scratch(t), supported ? version : 29);
    if (!supported) editFixture(file, db => db.exec(`PRAGMA user_version = ${version}`));
    await assertRefusedWithoutChange(file);
  });
}

const currentSchema = STORAGE_SCHEMA + INITIALIZE_STORE;

function writeSchemaFixture(file, schema) {
  editFixture(file, db => db.exec(schema));
  chmodSync(file, 0o600);
}

for (const [label, setup] of [
  ["foreign application", currentSchema + "PRAGMA application_id = 7;"],
  ["unmarked nonempty database", "CREATE TABLE example (value INTEGER);"],
  ["core-next version 2", currentSchema + "PRAGMA user_version = 2;"],
  ["unsupported core-next version", currentSchema + `PRAGMA user_version = ${SQLITE_PHYSICAL_VERSION + 1};`],
  ["missing table", currentSchema + "DROP TABLE cairn_pause;"],
  ["extra table", currentSchema + "CREATE TABLE extra (value INTEGER);"],
  ["missing identity row", currentSchema + "DELETE FROM cairn_store;"],
  ["invalid identity row", currentSchema + "UPDATE cairn_store SET session_hash_key = 'invalid';"],
]) {
  test(`refuses ${label} without changing bytes or inventory`, async t => {
    const file = join(scratch(t), "store.sqlite");
    writeSchemaFixture(file, setup);
    await assertRefusedWithoutChange(file);
  });
}

test("legacy inventory identifies the core-next application independently of the version number", t => {
  const file = join(scratch(t), "store.sqlite");
  // A rollback-journal fixture reaches the application ID check in legacy inventory.
  writeSchemaFixture(file, currentSchema);
  assert.notEqual(SQLITE_APPLICATION_ID, APPLICATION_ID);
  assert.equal(legacyClassification(file), "legacy_foreign_store");
  editFixture(file, db => db.exec(`PRAGMA user_version = ${Math.min(...LEGACY_LAYOUTS)}`));
  assert.equal(legacyClassification(file), "legacy_foreign_store");
});

test("a zero-length file initializes and a no-op reopen preserves database bytes", async t => {
  const file = join(scratch(t), "store.sqlite");
  writeFileSync(file, "");
  const scope = { owner: "fixture-owner", namespace: null };
  const first = await openSqliteAdapter(file);
  const keyHash = first.hashSessionKey(scope, "fixture-client", "fixture-session");
  await first.close();
  const digest = sha256(readFileSync(file));
  const reopened = await openSqliteAdapter(file);
  try {
    assert.equal(reopened.hashSessionKey(scope, "fixture-client", "fixture-session"), keyHash);
  } finally {
    await reopened.close();
  }
  assert.equal(sha256(readFileSync(file)), digest);
  const reader = new DatabaseSync(file, { readOnly: true });
  try {
    assert.equal(reader.prepare("PRAGMA application_id").get().application_id, SQLITE_APPLICATION_ID);
    assert.equal(reader.prepare("PRAGMA user_version").get().user_version, SQLITE_PHYSICAL_VERSION);
  } finally {
    reader.close();
  }
});
