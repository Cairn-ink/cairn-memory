import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSqliteAdapter } from "../../packages/adapter-sqlite/src/index.mjs";
import { migrateLegacyStore } from "../../packages/adapter-sqlite/src/migrate/index.mjs";
import { createLegacyBackup, fileDigest, legacyVisible, migratedVisible, seededStore } from "../../packages/adapter-sqlite/test/migration-fixtures.mjs";
import { legacyRawVisible, migratedRawVisible, seedRawDeletion } from "../../packages/adapter-sqlite/test/raw-migration-fixtures.mjs";

const directory = mkdtempSync(join(tmpdir(), "sqlite-migrate-qualification-"));
try {
  const { input, sentinels } = await seededStore(directory);
  const expected = await legacyVisible(input.path);
  const expectedRaw = await legacyRawVisible(input.path);
  await createLegacyBackup(input);
  const before = fileDigest(input.path);
  const migration = await migrateLegacyStore(input);
  assert.equal(fileDigest(input.path), before);
  const adapter = await openSqliteAdapter(input.destination);
  try {
    const actual = await migratedVisible(adapter);
    assert.deepEqual(actual, expected);
    const actualRaw = await migratedRawVisible(adapter);
    assert.deepEqual(actualRaw, expectedRaw);
    for (const { text } of sentinels) assert.ok(actual.every(item => item.text !== text));
    console.log(JSON.stringify({ sourceLayout: migration.sourceLayout, legacyVisible: expected.length,
      migratedVisible: actual.length, historical: actual.filter(item => item.historical).length,
      receipts: actual.reduce((total, item) => total + item.receipts.length, 0), forgotten: sentinels.length,
      legacyRawVisible: expectedRaw.length, migratedRawVisible: actualRaw.length }));
  } finally {
    await adapter.close();
  }
  const rawDirectory = join(directory, "raw-privacy");
  mkdirSync(rawDirectory, { mode: 0o700 });
  const raw = await seedRawDeletion(rawDirectory);
  const rawExpected = await legacyRawVisible(raw.input.path);
  const memoryExpected = await legacyVisible(raw.input.path);
  await createLegacyBackup(raw.input);
  const rawMigration = await migrateLegacyStore(raw.input);
  const replacement = await openSqliteAdapter(raw.input.destination);
  try {
    assert.deepEqual(await migratedRawVisible(replacement), rawExpected);
    assert.deepEqual(await migratedVisible(replacement), memoryExpected);
  } finally {
    await replacement.close();
  }
  const bytes = readFileSync(raw.input.destination);
  for (const item of [raw.deleted, raw.spanned, raw.unknown]) assert.equal(bytes.includes(item.raw), false);
  console.log(JSON.stringify({ sourceLayout: rawMigration.sourceLayout, visibleMemories: memoryExpected.length,
    visibleRaw: rawExpected.length, deletedRawSentinels: 3, migratedRawFences: rawMigration.rawFences }));
} finally {
  rmSync(directory, { recursive: true, force: true });
}
