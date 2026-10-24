import { assertNoRoleProfiles } from './role-profile-schema.mjs';
import { assertNoAssets } from './asset-schema.mjs';
import { validateExistingStore } from './existing-store.mjs';
import { lstatSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { APPLICATION_ID, READ_SCHEMA_VERSIONS, CONTEXT_READ_SCHEMA_VERSIONS, readTransaction } from './database.mjs';
import { fail } from './validation.mjs';

function identity(path) {
  let stat;
  try { stat = lstatSync(path); } catch (error) {
    if (error.code === 'ENOENT') fail('database_not_found');
    fail('unsafe_database_file');
  }
  if (!stat.isFile() || stat.isSymbolicLink() || (process.platform !== 'win32' && (stat.mode & 0o077))) {
    fail('unsafe_database_file');
  }
  return stat;
}
export function openReadDatabase(path, { contextRead = false, preflight } = {}) {
  const initial = identity(path);
  preflight?.();
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec(`PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=${contextRead ? 5000 : 0};`);
    const current = identity(path);
    if (initial.dev !== current.dev || initial.ino !== current.ino) fail('unsafe_database_file');
    const validate = () => {
    if (db.prepare('PRAGMA application_id').get().application_id !== APPLICATION_ID ||
        !(contextRead ? CONTEXT_READ_SCHEMA_VERSIONS : READ_SCHEMA_VERSIONS).includes(db.prepare('PRAGMA user_version').get().user_version)) fail('unsupported_database');
    if (db.prepare('PRAGMA user_version').get().user_version < 32) assertNoRoleProfiles(db);
    if (db.prepare('PRAGMA user_version').get().user_version < 31) assertNoAssets(db);
    if (db.prepare('PRAGMA user_version').get().user_version >= 30) validateExistingStore(db, {
      storeId: db.prepare('SELECT store_id FROM store_metadata WHERE singleton=1').get()?.store_id });
    // Validate every physical seek, including automatically named primary keys.
    // A matching name alone does not establish column order/collation/coverage.
    const list = db.prepare('SELECT name,origin,partial FROM pragma_index_list(?)');
    const info = db.prepare('SELECT name,"desc",coll,"key" FROM pragma_index_xinfo(?) ORDER BY seqno');
    function exact(index, columns) {
      if (!index || index.partial) fail('unsupported_database');
      const keys = info.all(index.name).filter(row => row.key);
      if (keys.length !== columns.length || keys.some((row, i) => row.name !== columns[i] ||
          row.desc || row.coll !== 'BINARY')) fail('unsupported_database');
    }
    for (const [table, name, columns] of [
      ['memories', 'index_memory_keyset', ['owner_id', 'scope', 'project_id', 'id']],
      ['mocs', 'index_moc_keyset', ['owner_id', 'scope', 'project_id', 'id']],
      ['moc_memory_refs', 'memory_moc_refs', ['memory_id', 'moc_id']],
    ]) exact(list.all(table).find(index => index.name === name), columns);
    for (const [table, columns] of Object.entries({
      memories: ['id'], mocs: ['id'], moc_title_sources: ['moc_id', 'memory_id'],
      moc_edges: ['parent_id', 'child_id'], moc_memory_refs: ['moc_id', 'memory_id'],
      namespace_epochs: ['owner_id', 'scope', 'project_id'],
      namespace_index_state: ['owner_id', 'scope', 'project_id'], index_generations: ['id'],
      index_memories: ['generation', 'id'], index_mocs: ['generation', 'id'],
      index_title_sources: ['generation', 'moc_id', 'memory_id'],
      index_memory_refs: ['generation', 'moc_id', 'memory_id'],
      index_edges: ['generation', 'parent_id', 'child_id'],
    })) exact(list.all(table).find(index => index.origin === 'pk'), columns);
    const metadataKey = db.prepare("SELECT name,type,pk FROM pragma_table_info('store_metadata') WHERE pk!=0").all();
    if (metadataKey.length !== 1 || metadataKey[0].name !== 'singleton' ||
        metadataKey[0].type !== 'INTEGER' || metadataKey[0].pk !== 1) fail('unsupported_database');
    };
    if (contextRead) readTransaction(db, validate); else validate();
    return { db, assertFile() {
      const stat = identity(path);
      if (stat.dev !== initial.dev || stat.ino !== initial.ino) fail('cursor_stale');
    } };
  } catch (error) { db.close(); throw error; }
}
