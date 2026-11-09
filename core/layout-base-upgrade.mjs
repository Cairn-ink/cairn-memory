import { spawnSync } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sqliteFileStat } from './sqlite-journal-probe.mjs';
import { ownData } from './local-authority-input.mjs';
import { fail, identifier } from './validation.mjs';
import { contentSafetyInventory } from './content-safety-migration.mjs';
import { attestContentSafety } from './content-safety-schema.mjs';
import { validateContextProductLayout } from './context-product-schema.mjs';
import { installPrivateCards, installCardMemorySources } from './private-card-schema.mjs';
import { installPrivateEvidence } from './private-evidence-schema.mjs';
import { installPrivateOrganization } from './private-organization-schema.mjs';
import { installRawJournal, installRawCapture } from './raw-schema.mjs';
import { installRawLineage } from './raw-lineage-schema.mjs';
import { installRawDeletion } from './raw-deletion-schema.mjs';
import { installRawSources } from './raw-source-schema.mjs';
import { installLocalAuthority } from './local-authority-schema.mjs';
import { migrateMethodPrerequisites } from './method-package-migration.mjs';
import { installAssets, validateAssets, assertNoAssets } from './asset-schema.mjs';
import { installRoleProfiles, validateRoleProfiles, assertNoRoleProfiles } from './role-profile-schema.mjs';
import { installCardCurrentDependencies, validateCardCurrentDependencies, assertNoCardCurrentDependencies } from './card-current-schema.mjs';

export { contentSafetyInventory };

const flags = ['admissionsClosed', 'writersStopped', 'readersDrained', 'oldHandlesClosed'];
const quote = name => '"' + name.replaceAll('"', '""') + '"';

// Equivalent to the private migrateSafety file guard, with closed API errors.
function offlineFile(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) fail('invalid_input');
  const stat = sqliteFileStat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077n) fail('unsafe_database_file');
  for (const suffix of ['-wal', '-shm', '-journal']) {
    try { sqliteFileStat(path + suffix); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    fail('unsafe_database_file');
  }
  return stat;
}
function backupInventory(path) {
  // Only the child opens the backup; the parent never opens raw database fds.
  const script = `const { DatabaseSync } = await import('node:sqlite');
import { contentSafetyInventory } from ${JSON.stringify(import.meta.url)};
const db = new DatabaseSync(process.argv[1], { readOnly: true });
try { db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; BEGIN');
if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) throw Error('invalid_backup');
console.log(contentSafetyInventory(db)); db.exec('COMMIT'); } finally { db.close(); }`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, path], { encoding: 'utf8', timeout: 30000, maxBuffer: 4096 });
  if (result.status !== 0 || result.error || !/^[0-9a-f]{64}\n$/.test(result.stdout)) fail('unsupported_database');
  return result.stdout.trim();
}
function verifyIntegrity(db) {
  const rows = db.prepare('PRAGMA integrity_check').all();
  if (rows.length !== 1 || rows[0].integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) fail('unsupported_database');
}
function rowCounts(db, tables) {
  return Object.fromEntries(tables.map(name => [name, db.prepare(`SELECT count(*) AS n FROM ${quote(name)}`).get().n]));
}

/** Explicit offline schema maintenance. Hosts import this module directly. */
export async function upgradeLayoutBase(input) {
  let isStorageBusy = () => false;
  try {
    const { path, backupPath, expected, quiescence } = ownData(input, ['path', 'backupPath', 'expected', 'quiescence']);
    const quiet = ownData(quiescence, flags);
    if (flags.some(key => quiet[key] !== true)) fail('invalid_input');
    const target = ownData(expected, ['storeId', 'fromBase', 'toBase']);
    if (target.fromBase !== 18 || target.toBase !== 33) fail('invalid_input');
    let storeId;
    try { storeId = identifier(target.storeId); } catch { fail('invalid_input'); }
    const source = offlineFile(path), backup = offlineFile(backupPath);
    if (source.dev === backup.dev && source.ino === backup.ino) fail('invalid_input');
    const inventory = backupInventory(backupPath);
    const [{ DatabaseSync }, storage] = await Promise.all([
      import('node:sqlite'), import('./database.mjs'),
    ]);
    const { transaction, STORAGE_BUSY_TIMEOUT_MS, APPLICATION_ID } = storage;
    isStorageBusy = storage.isStorageBusy;
    const uri = pathToFileURL(path); uri.searchParams.set('mode', 'rw');
    const db = new DatabaseSync(uri.href, { timeout: STORAGE_BUSY_TIMEOUT_MS });
    try {
      db.exec('PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF;');
      return transaction(db, () => {
        const current = sqliteFileStat(path);
        if (source.dev !== current.dev || source.ino !== current.ino) fail('unsupported_database');
        if (db.prepare('PRAGMA journal_mode').get().journal_mode !== 'delete') fail('unsafe_database_file');
        if (db.prepare('PRAGMA application_id').get().application_id !== APPLICATION_ID ||
            ![18,118].includes(db.prepare('PRAGMA user_version').get().user_version)) fail('unsupported_database');
        const layout = attestContentSafety(db);
        const relationOffset=layout.relationsRevision?100:0;
        if (layout.suppressionRevision || layout.attestedFeatures ||
            db.prepare('SELECT store_id FROM store_metadata WHERE singleton=1').get()?.store_id !== storeId) fail('unsupported_database');
        validateContextProductLayout(db, layout); verifyIntegrity(db);
        if (contentSafetyInventory(db) !== inventory) fail('unsupported_database');
        const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(row => row.name);
        const counts = rowCounts(db, tables);
        // Match initialize()/upgrade() for the full openDatabase option set.
        assertNoCardCurrentDependencies(db); assertNoRoleProfiles(db); assertNoAssets(db);
        installPrivateCards(db);
        installCardMemorySources(db);
        installPrivateEvidence(db);
        installPrivateOrganization(db);
        db.exec(`PRAGMA user_version = ${23+relationOffset};`);
        for (const [version, install] of [[24, installRawJournal], [25, installRawCapture],
          [26, installRawLineage], [27, installRawDeletion], [28, installRawSources], [29, installLocalAuthority]]) {
          install(db); db.exec(`PRAGMA user_version = ${version+relationOffset};`);
        }
        migrateMethodPrerequisites(db);
        installAssets(db); db.exec(`PRAGMA user_version=${31+relationOffset}`); validateAssets(db);
        installRoleProfiles(db); db.exec(`PRAGMA user_version=${32+relationOffset}`); validateRoleProfiles(db);
        installCardCurrentDependencies(db); db.exec(`PRAGMA user_version=${33+relationOffset}`); validateCardCurrentDependencies(db);
        verifyIntegrity(db);
        if (db.prepare('PRAGMA user_version').get().user_version !== 33+relationOffset) fail('unsupported_database');
        const after = rowCounts(db, tables);
        if (tables.some(name => counts[name] !== after[name])) fail('unsupported_database');
        return Object.freeze({ storeId, fromBase: 18, toBase: 33, counts: Object.freeze(counts) });
      });
    } finally { db.close(); }
  } catch (error) {
    if (['invalid_input', 'unsafe_database_file', 'unsupported_database', 'storage_busy'].includes(error?.code)) fail(error.code);
    if (isStorageBusy(error)) fail('storage_busy');
    fail('unsupported_database');
  }
}
