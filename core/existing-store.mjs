import { resolveContentLayout, contentSafetyPin } from './content-safety-layout.mjs';
import { attestContentSafety } from './content-safety-schema.mjs';
import { validateContextProductLayout } from './context-product-schema.mjs';
import { validateCardCurrentDependencies, assertNoCardCurrentDependencies } from './card-current-schema.mjs';
import { validateRoleProfiles, assertNoRoleProfiles } from './role-profile-schema.mjs';
import { validateAssets, assertNoAssets } from './asset-schema.mjs';
import { validateMethodPackages } from './method-package-schema.mjs';
import { lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ownData } from './local-authority-input.mjs';
import { validateLocalAuthorityMetadata } from './local-authority-schema.mjs';
import { fail, identifier } from './validation.mjs';

export function existingStoreOption(value) {
  const input = ownData(value, ['version', 'storeId', 'physical', 'base', 'suppressionRevision', 'cardLineageRevision']);
  if (input.version === 'content-safety-existing-v1') {
    const layout = resolveContentLayout(input.physical);
    if (Object.keys(input).length !== 6 || !layout.suppressionRevision || input.base !== layout.base || input.suppressionRevision !== 1 || input.cardLineageRevision !== 0) fail('invalid_input');
    identifier(input.storeId);
    return Object.freeze({ ...input });
  }
  if (Object.keys(input).length !== 2 || !['schema29-existing-v1','schema30-existing-v1','schema31-existing-v1','schema32-existing-v1','schema33-existing-v1'].includes(input.version)) fail('invalid_input');
  try { identifier(input.storeId); } catch { fail('invalid_input'); }
  return Object.freeze({ version: input.version, storeId: input.storeId });
}

function privateEntry(path, directory) {
  const stat = lstatSync(path);
  if ((directory ? !stat.isDirectory() : !stat.isFile()) || stat.isSymbolicLink() ||
      typeof process.getuid !== 'function' || stat.uid !== process.getuid() ||
      (stat.mode & 0o777) !== (directory ? 0o700 : 0o600)) fail('unsafe_database_file');
  return stat;
}

export function existingStorePath(path) {
  if (typeof path !== 'string' || !path.isWellFormed() || path.includes('\0') ||
      !isAbsolute(path) || resolve(path) !== path) fail('invalid_path');
  // Host-owned ancestors may be aliases. Only the owned parent/leaf are private.
  const canonical = join(realpathSync(dirname(path)), basename(path));
  const parent = privateEntry(dirname(canonical), true), file = privateEntry(canonical, false);
  const uri = pathToFileURL(canonical);
  uri.searchParams.set('mode', 'rw');
  return { uri: uri.href, check() {
    if (join(realpathSync(dirname(path)), basename(path)) !== canonical) fail('unsafe_database_file');
    const currentParent = privateEntry(dirname(canonical), true), currentFile = privateEntry(canonical, false);
    if (parent.dev !== currentParent.dev || parent.ino !== currentParent.ino ||
        file.dev !== currentFile.dev || file.ino !== currentFile.ino) fail('unsafe_database_file');
  } };
}

const text = (name, pk = 0, nullable = false) => [name, 'TEXT', nullable ? 0 : 1, pk];
const integer = (name, pk = 0, nullable = false) => [name, 'INTEGER', nullable ? 0 : 1, pk];
const ns = () => [text('owner_id', 1), text('scope', 2), text('project_id', 3)];
const namespaceFields = () => [text('owner_id'), text('scope'), text('project_id')];

// Only the selected Raw/source/control seam, not a second whole-schema manifest.
const layouts = {
  store_metadata: [integer('singleton', 1, true), text('store_id'), text('cursor_secret')],
  episode_identity: [integer('singleton', 1, true), text('secret')],
  namespace_epochs: [...ns(), integer('epoch')],
  raw_conversations: [text('id', 1), ...namespaceFields(), text('client'), text('session_key'),
    integer('revision'), text('first_received_at'), text('last_received_at')],
  raw_messages: [text('conversation_id', 1), text('message_id', 2), integer('ordinal'), text('role'),
    text('occurred_at', 0, true), integer('total_units'), integer('total_bytes'), integer('next_index'),
    integer('next_start'), integer('received_bytes'), text('assembly_state'), text('reason', 0, true),
    integer('reserved_bytes'), text('first_event_id')],
  raw_parts: [text('conversation_id', 1), text('message_id', 2), integer('part_index', 3), integer('start'),
    integer('end'), integer('byte_count'), text('digest'), text('event_id'), integer('saved'),
    text('reason', 0, true), text('format', 0, true), text('key_version', 0, true), ['sealed', 'BLOB', 0, 0]],
  raw_source_exclusions: [text('conversation_id', 1), text('message_id', 2), integer('start', 3),
    integer('end', 4), integer('generation')],
  card_raw_bindings: [text('card_id', 1), text('binding_id', 2), text('conversation_id'), text('message_id'),
    integer('start'), integer('end'), text('source_ref'), integer('position')],
  card_raw_mutation_context: [integer('singleton', 1, true), ...namespaceFields(), text('action_id')],
  card_raw_pending_invalidations: [text('card_id', 1), integer('revision')],
  raw_capture_events: [...ns(), text('client', 4), text('event_id', 5), text('conversation_id'), text('session_key'),
    text('first_message_ids'), text('eligible_message_ids'), text('projection_digest'), text('binding_digest'),
    text('capture_generation'), text('staging'), text('local_target_id', 0, true), text('local_store_id', 0, true),
    text('local_consent_generation', 0, true)],
};
const tables = [...Object.keys(layouts), 'local_capture_controls', 'raw_events', 'raw_owner_usage', 'raw_capture_controls',
  'raw_session_fences', 'raw_source_maps', 'raw_receipt_lineage', 'raw_receipt_origins', 'raw_exclusion_clocks',
  'raw_deletion_actions', 'raw_job_sources', 'raw_closed_jobs', 'raw_deletion_effects',
  'private_cards', 'card_notes', 'card_applicability_reviews', 'evidence_mappings'];
const triggers = ['card_raw_purge', 'card_memory_revision_invalidation', 'local_capture_binding_insert', 'local_capture_binding_update'];

function indexShape(db, name, columns) {
  const rows = db.prepare('SELECT * FROM pragma_index_xinfo(?) WHERE key=1 ORDER BY seqno').all(name);
  return rows.length === columns.length && rows.every((row, index) =>
    row.name === columns[index] && row.desc === 0 && row.coll === 'BINARY');
}

export function validateExistingStore(db, option, layout = attestContentSafety(db)) {
  if (db.prepare('PRAGMA user_version').get().user_version !== layout.physical) fail('unsupported_database');
  const version = layout.base;
  if (layout.suppressionRevision) {
    if (option.version !== undefined && (option.version !== 'content-safety-existing-v1' || option.physical !== layout.physical || option.base !== layout.base || option.suppressionRevision !== 1 || option.cardLineageRevision !== 0)) fail('unsupported_database');
    validateContextProductLayout(db, layout);
    if (db.prepare('PRAGMA application_id').get().application_id !== 0x43414952 ||
        db.prepare('SELECT store_id FROM store_metadata WHERE singleton=1').get()?.store_id !== option.storeId) fail('unsupported_database');
    return;
  }
  if (option.version === 'content-safety-existing-v1') fail('unsupported_database');
  if (db.prepare('PRAGMA application_id').get().application_id !== 0x43414952 ||
      ![29,30,31,32,33].includes(version) || option.version === 'schema30-existing-v1' && version < 30 ||
      option.version === 'schema31-existing-v1' && version !== 31 ||
      option.version === 'schema32-existing-v1' && version !== 32 ||
      option.version === 'schema33-existing-v1' && version !== 33) fail('unsupported_database');
  if (version === 33) validateCardCurrentDependencies(db); else assertNoCardCurrentDependencies(db);
  if (version >= 32) validateRoleProfiles(db); else assertNoRoleProfiles(db);
  if (version >= 30) validateMethodPackages(db);
  if (version >= 31) validateAssets(db); else assertNoAssets(db);
  for (const name of tables) if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)) fail('unsupported_database');
  for (const [table, expected] of Object.entries(layouts)) {
    const info = db.prepare('SELECT * FROM pragma_table_info(?) ORDER BY cid').all(table);
    if (info.length !== expected.length || info.some((row, index) =>
      JSON.stringify([row.name, row.type, row.notnull, row.pk]) !== JSON.stringify(expected[index])) ||
      db.prepare('SELECT strict FROM pragma_table_list WHERE schema=? AND name=?').get('main', table)?.strict !== 1) fail('unsupported_database');
  }
  validateLocalAuthorityMetadata(db);
  for (const name of triggers) if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?").get(name)) fail('unsupported_database');
  const indexes = db.prepare('SELECT * FROM pragma_index_list(?)').all('raw_conversations');
  if (!indexes.some(row => row.unique === 1 && row.partial === 0 &&
      indexShape(db, row.name, ['owner_id', 'scope', 'project_id', 'client', 'session_key']))) fail('unsupported_database');
  for (const [table, name, columns] of [
    ['raw_parts', 'raw_source_part_start', ['conversation_id', 'message_id', 'start']],
    ['card_raw_bindings', 'card_raw_dependents', ['conversation_id', 'card_id', 'message_id', 'start', 'end']],
  ]) {
    const row = db.prepare('SELECT * FROM pragma_index_list(?) WHERE name=?').get(table, name);
    if (!row || row.partial !== 0 || !indexShape(db, name, columns)) fail('unsupported_database');
  }
  const identities = db.prepare('SELECT singleton,store_id,cursor_secret FROM store_metadata LIMIT 2').all();
  const episodes = db.prepare('SELECT singleton,secret FROM episode_identity LIMIT 2').all();
  if (identities.length !== 1 || identities[0].singleton !== 1 || identities[0].store_id !== option.storeId ||
      !/^[0-9a-f]{64}$/.test(identities[0].cursor_secret) || episodes.length !== 1 || episodes[0].singleton !== 1 ||
      !/^[0-9a-f]{64}$/.test(episodes[0].secret)) fail('unsupported_database');
}

/** Installed clients negotiate a fresh exact pin, then the writer re-attests it.
 * Never choose a legacy pin as fallback after safety validation fails. */
export async function inspectExistingStorePin(path, storeId, minimumBase = 29) {
  const location = existingStorePath(path);
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; BEGIN');
    const layout = attestContentSafety(db);
    if (layout.base < minimumBase || db.prepare('PRAGMA application_id').get().application_id !== 0x43414952 ||
        db.prepare('SELECT store_id FROM store_metadata WHERE singleton=1').get()?.store_id !== storeId) fail('unsupported_database');
    validateContextProductLayout(db, layout);
    location.check();
    const pin = contentSafetyPin(layout, storeId);
    db.exec('COMMIT');
    return pin;
  } finally { db.close(); }
}
