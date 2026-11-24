import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSqliteAdapter } from "../../packages/adapter-sqlite/src/index.mjs";
import { migrateLegacyStore } from "../../packages/adapter-sqlite/src/migrate/index.mjs";
import { createLegacyBackup, fileDigest, legacyVisible, migratedVisible, seededStore } from "../../packages/adapter-sqlite/test/migration-fixtures.mjs";

const directory = mkdtempSync(join(tmpdir(), "sqlite-migrate-qualification-"));
try {
  const { input, sentinels } = await seededStore(directory);
  const expected = await legacyVisible(input.path);
  await createLegacyBackup(input);
  const before = fileDigest(input.path);
  const migration = await migrateLegacyStore(input);
  assert.equal(fileDigest(input.path), before);
  const adapter = await openSqliteAdapter(input.destination);
  try {
    const actual = await migratedVisible(adapter);
    assert.deepEqual(actual, expected);
    for (const { text } of sentinels) assert.ok(actual.every(item => item.text !== text));
    console.log(JSON.stringify({ sourceLayout: migration.sourceLayout, legacyVisible: expected.length,
      migratedVisible: actual.length, historical: actual.filter(item => item.historical).length,
      receipts: actual.reduce((total, item) => total + item.receipts.length, 0), forgotten: sentinels.length }));
  } finally {
    await adapter.close();
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
