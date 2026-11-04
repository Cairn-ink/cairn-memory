import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../database.mjs';
import { migrateContentSafety } from '../content-safety-migration.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
export { ns, ok, receipt } from './context-read-fixture.mjs';
// File descriptors for fixture backups/byte comparisons belong to a child
// which never imports SQLite, even when another fixture is already connected.
export function copySqliteFixture(source, target) {
  const child = spawnSync(process.execPath, ['--input-type=module','-e',
    "import { copyFileSync } from 'node:fs'; copyFileSync(process.argv[1],process.argv[2]);",source,target],{env:{}});
  if(child.status !== 0)throw Error('fixture_copy_failed');
}
export function readSqliteFixture(path) {
  const child = spawnSync(process.execPath, ['--input-type=module','-e',
    "import { readFileSync } from 'node:fs'; process.stdout.write(readFileSync(process.argv[1]));",path], {env:{},maxBuffer:64*1024*1024});
  if(child.status !== 0)throw Error('fixture_read_failed');
  return child.stdout;
}
export const quiescence = Object.freeze({ admissionsClosed: true, writersStopped: true, readersDrained: true, oldHandlesClosed: true });
export function safetyFixture(t, base = 18) {
  const workspace = createTestWorkspace(t, { prefix: 'content-safety-' });
  const path = join(workspace.path, 'store.sqlite'), backupPath = join(workspace.path, 'offline.sqlite');
  const db = openDatabase(path, base === 18 ? {} : base === 23 ? { privateCards: true } : { currentDependencies: true });
  const storeId = db.prepare('SELECT store_id FROM store_metadata').get().store_id; db.close();
  return { workspace, path, backupPath, base, storeId,
    connect() { const db = new DatabaseSync(path); db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF'); return db; },
    async migrate() { copySqliteFixture(path, backupPath); return migrateContentSafety({ path, backupPath, expected: { storeId, base }, quiescence }); } };
}
