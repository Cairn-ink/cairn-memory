import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { openSqliteAdapter, SQLITE_PHYSICAL_VERSION } from "../src/index.mjs";
import { migrateLegacyStore } from "../src/migrate/index.mjs";
import { CONTEXT_READ_TABLES } from "../src/schema/context-read.mjs";
import { INSPECT_TABLES } from "../src/schema/inspect.mjs";
import { editFixture, fixture } from "./legacy/fixtures.mjs";
import { createLegacyBackup, prepareInput } from "./migration-fixtures.mjs";
import { scratch } from "./storage-fixtures.mjs";

async function openAndClose(path) {
  const adapter = await openSqliteAdapter(path);
  await adapter.close();
}

function snapshot(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return {
      version: db.prepare("PRAGMA user_version").get().user_version,
      schema: db.prepare("SELECT type, name, sql FROM sqlite_schema ORDER BY type, name").all(),
    };
  } finally {
    db.close();
  }
}

const compatibilityTables = ["cairn_migrated_raw_privacy", "cairn_migrated_safety", "cairn_migrated_raw_maps"];

function assertReadTables({ schema }) {
  const tables = new Set(schema.filter(row => row.type === "table").map(row => row.name));
  for (const name of [...INSPECT_TABLES, ...CONTEXT_READ_TABLES, ...compatibilityTables]) {
    assert.ok(tables.has(name), `missing table ${name}`);
  }
}

for (const [name, sql] of [
  ["refuses version 3 with the full table set", "PRAGMA user_version = 3"],
  ["refuses a v4 store", `
    PRAGMA journal_mode = DELETE;
    DROP TRIGGER cairn_migrated_memory_reservation;
    ${compatibilityTables.map(name => `DROP TABLE ${name};`).join("\n")}
    PRAGMA user_version = 4;`],
  ["refuses a missing migration compatibility table", "DROP TABLE cairn_migrated_raw_maps"],
  ["refuses a missing inspect table", "DROP TABLE cairn_inspect_evidence"],
  ["refuses a missing Context Read table", "DROP TABLE cairn_context_raw_checkpoints"],
  ["refuses a missing inspect identity row", "DELETE FROM cairn_inspect_identity"],
  ["refuses an invalid inspect cursor secret", "UPDATE cairn_inspect_identity SET cursor_secret = 'invalid'"],
  ["refuses an extra table", "CREATE TABLE extra (value INTEGER)"],
]) {
  test(name, async () => {
    const { path, remove } = scratch();
    try {
      await openAndClose(path);
      editFixture(path, db => db.exec(sql));
      const bytes = readFileSync(path);
      await assert.rejects(openAndClose(path), { code: "storage_error" });
      assert.deepEqual(readFileSync(path), bytes);
    } finally {
      remove();
    }
  });
}

test("fresh version 5 store has all read and compatibility tables and reopens with identical bytes", async () => {
  const { path, remove } = scratch();
  try {
    await openAndClose(path);
    const initial = snapshot(path);
    assert.equal(initial.version, SQLITE_PHYSICAL_VERSION);
    assertReadTables(initial);
    const bytes = readFileSync(path);
    await openAndClose(path);
    assert.deepEqual(readFileSync(path), bytes);
  } finally {
    remove();
  }
});

test("migrated version 5 store has all read and compatibility tables before open and keeps its schema", async () => {
  const { path, remove } = scratch();
  try {
    const directory = dirname(path);
    const legacy = await fixture(directory, 29);
    const input = prepareInput(directory, legacy);
    await createLegacyBackup(input);
    await migrateLegacyStore(input);

    const initial = snapshot(input.destination);
    assertReadTables(initial);
    assert.equal(initial.version, SQLITE_PHYSICAL_VERSION);
    await openAndClose(input.destination);
    assert.deepEqual(snapshot(input.destination), initial);
  } finally {
    remove();
  }
});
