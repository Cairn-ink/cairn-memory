import { assertNoCardCurrentDependencies } from './card-current-schema.mjs';
import { assertNoRoleProfiles } from './role-profile-schema.mjs';
import { assertNoAssets } from './asset-schema.mjs';
import { validateExistingStore } from './existing-store.mjs';
import { lstatSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { APPLICATION_ID, READ_SCHEMA_VERSIONS, CONTEXT_READ_SCHEMA_VERSIONS, readTransaction } from './database.mjs';
import { topicJournalMode, recordSqliteFailure } from './topic-reader-sqlite.mjs';
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
// Worker preflight handoff: safe identity before any native connection opens.
export function contextProductFileIdentity(path) {
  const stat = identity(path); return `${stat.dev}:${stat.ino}`;
}
export function openReadDatabase(path, { contextRead = false, topicMembers = false, deferTopicValidation = false, topicPolicy, nativeObserver, preflight, validateProduct, productSqlite } = {}) {
  const initial = identity(path);
  nativeObserver?.identity?.(`${initial.dev}:${initial.ino}`);
  nativeObserver?.openDiagnostic?.mark('canonicalIdentity');
  preflight?.();
  nativeObserver?.openDiagnostic?.mark('canonicalPreflight');
  const productFiles = productSqlite?.files(path);
  let native;
  try { native = nativeObserver ? nativeObserver.invoke('open', 'connection', () => new DatabaseSync(path, { readOnly: true })) : new DatabaseSync(path, { readOnly: true }); }
  catch (error) {
    recordSqliteFailure(error, 'open', 'connection');
    if (productSqlite) productSqlite.openingFailure(error);
    throw error;
  }
  let db = native;
  nativeObserver?.openDiagnostic?.mark('canonicalNative');
  try {
    if (productSqlite) {
      db = productSqlite.open(native, path).db;
      productFiles({ afterProbe: true });
    }
    else if (nativeObserver) db = nativeObserver.database(native);
    try { (nativeObserver || productSqlite ? db : native).exec(productSqlite ? 'PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;' : `PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=${contextRead && !nativeObserver ? 5000 : 0};`); }
    catch (error) { throw recordSqliteFailure(error, 'configure', 'reader_configuration'); }
    let wal = false;
    if (topicPolicy) {
      wal = topicJournalMode(native, path, topicPolicy, { deferQueryErrors: true }) === 'WAL';
    }
    if (!nativeObserver && topicPolicy) db = topicPolicy.database(native, wal);
    const current = identity(path);
    if (initial.dev !== current.dev || initial.ino !== current.ino) fail('unsafe_database_file');
    nativeObserver?.openDiagnostic?.mark('canonicalConfigured');
    const validate = () => {
    validateProduct?.(db);
    nativeObserver?.openDiagnostic?.mark('productLayout');
    if (db.prepare('PRAGMA application_id').get().application_id !== APPLICATION_ID ||
        !(contextRead ? CONTEXT_READ_SCHEMA_VERSIONS : READ_SCHEMA_VERSIONS).includes(db.prepare('PRAGMA user_version').get().user_version)) fail('unsupported_database');
    // Member reads validate only consumed Memory metadata and seek paths below;
    // full-store attestation can read unrelated Card/Raw bodies and is unbounded.
    if (!topicMembers && db.prepare('PRAGMA user_version').get().user_version < 33) assertNoCardCurrentDependencies(db);
    if (!topicMembers && db.prepare('PRAGMA user_version').get().user_version < 32) assertNoRoleProfiles(db);
    if (!topicMembers && db.prepare('PRAGMA user_version').get().user_version < 31) assertNoAssets(db);
    // Product attestation above is metadata-only; full-store content checks
    // belong to legacy openers, never to unauthenticated product bootstrap.
    if (!validateProduct && !topicMembers && db.prepare('PRAGMA user_version').get().user_version >= 30) validateExistingStore(db, {
      storeId: db.prepare('SELECT store_id FROM store_metadata WHERE singleton=1').get()?.store_id });
    if (topicMembers) {
      // Attest version boundaries from schema metadata, never private data rows.
      // A v18 file relabelled as current is not a current physical layout.
      const version = db.prepare('PRAGMA user_version').get().user_version;
      const present = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?");
      for (const [first, table] of [[20, 'private_cards'], [20, 'card_notes'],
        [21, 'card_memory_bindings'], [22, 'card_applicability_reviews'], [23, 'card_mocs'],
        [24, 'raw_conversations'], [25, 'raw_capture_events'], [26, 'raw_source_maps'],
        [27, 'raw_deletion_actions'], [28, 'card_raw_bindings'], [29, 'local_capture_controls'],
        [30, 'method_packages'], [31, 'assets'], [32, 'role_profiles'], [33, 'card_current_dependencies']]) {
        if (Boolean(present.get(table)) !== (version >= first)) fail('unsupported_database');
      }
    }
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
    if (!(topicMembers && deferTopicValidation)) {
      if (contextRead) readTransaction(db, validate); else validate();
    }
    nativeObserver?.openDiagnostic?.mark('canonicalValidated');
    return { db, fileIdentity: `${initial.dev}:${initial.ino}`, assertFile() {
      const stat = identity(path);
      if (stat.dev !== initial.dev || stat.ino !== initial.ino) fail('cursor_stale');
    } };
  } catch (error) { if(!productSqlite || db.isOpen)db.close(); throw error; }
}
