import { fail } from './validation.mjs';

export const METHOD_PACKAGE_SCHEMA_VERSION = 30;
const canonicalSQL = `
    CREATE TABLE method_packages (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, scope TEXT NOT NULL, project_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('available','deleted')),
      revision INTEGER NOT NULL CHECK(revision>0), next_ordinal INTEGER NOT NULL CHECK(next_ordinal>0),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX method_package_scope ON method_packages(owner_id,scope,project_id,id);
    CREATE TABLE method_versions (
      id TEXT PRIMARY KEY, package_id TEXT NOT NULL REFERENCES method_packages(id),
      ordinal INTEGER NOT NULL CHECK(ordinal>0), based_on TEXT,
      manifest_identity TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('available','deleted')),
      revision INTEGER NOT NULL CHECK(revision>0), title TEXT, submitted_by TEXT,
      imported_at TEXT NOT NULL, byte_count INTEGER NOT NULL CHECK(byte_count>=0),
      UNIQUE(package_id,ordinal),
      CHECK((state='available' AND title IS NOT NULL) OR
        (state='deleted' AND title IS NULL AND submitted_by IS NULL AND byte_count=0))
    ) STRICT;
    CREATE UNIQUE INDEX method_version_ref ON method_versions(package_id,id,manifest_identity);
    CREATE TABLE method_files (
      version_id TEXT NOT NULL REFERENCES method_versions(id), position INTEGER NOT NULL,
      path TEXT NOT NULL, text TEXT NOT NULL, byte_count INTEGER NOT NULL CHECK(byte_count>=0),
      content_identity TEXT NOT NULL, media_type TEXT NOT NULL,
      PRIMARY KEY(version_id,position), UNIQUE(version_id,path)
    ) STRICT;
    CREATE TABLE method_changes (
      to_id TEXT PRIMARY KEY REFERENCES method_versions(id), from_ref TEXT, to_ref TEXT NOT NULL,
      items TEXT NOT NULL, reason_refs TEXT NOT NULL
    ) STRICT;
    CREATE TABLE method_operations (
      owner_id TEXT NOT NULL, scope TEXT NOT NULL, project_id TEXT NOT NULL,
      action_id TEXT NOT NULL, method TEXT NOT NULL, payload_binding TEXT NOT NULL,
      target_id TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(owner_id,scope,project_id,action_id)
    ) STRICT;
    CREATE TABLE method_effects (
      effect_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, scope TEXT NOT NULL, project_id TEXT NOT NULL,
      kind TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
      revision INTEGER NOT NULL, action_id TEXT NOT NULL, ordinal INTEGER NOT NULL UNIQUE
    ) STRICT;
    CREATE INDEX method_effect_scope ON method_effects(owner_id,scope,project_id,ordinal);
    CREATE TABLE method_epochs (
      owner_id TEXT NOT NULL, scope TEXT NOT NULL, project_id TEXT NOT NULL,
      generation INTEGER NOT NULL, PRIMARY KEY(owner_id,scope,project_id)
    ) STRICT;
    CREATE TABLE method_owner_usage (
      owner_id TEXT PRIMARY KEY, byte_count INTEGER NOT NULL CHECK(byte_count>=0)
    ) STRICT;
    -- The complete v30 binding layout is installed by U2a, without binding
    -- behaviour or rows. U2b must use this layout without a schema change.
    CREATE TABLE method_binding_generations (
      owner_id TEXT NOT NULL, scope TEXT NOT NULL CHECK(scope IN ('personal','project')),
      project_id TEXT NOT NULL, package_id TEXT NOT NULL REFERENCES method_packages(id),
      generation INTEGER NOT NULL CHECK(generation>0),
      CHECK((scope='personal' AND project_id='') OR (scope='project' AND length(project_id)>0)),
      PRIMARY KEY(owner_id,scope,project_id,package_id)
    ) STRICT;
    CREATE TABLE method_bindings (
      owner_id TEXT NOT NULL, scope TEXT NOT NULL CHECK(scope IN ('personal','project')),
      project_id TEXT NOT NULL, package_id TEXT NOT NULL,
      role_key TEXT NOT NULL CHECK(role_key='*' OR
        (length(role_key) BETWEEN 1 AND 200 AND role_key NOT GLOB '*[^A-Za-z0-9._-]*')),
      state TEXT NOT NULL CHECK(state IN ('active','disabled')),
      version_id TEXT, manifest_identity TEXT,
      revision INTEGER NOT NULL CHECK(revision>0), generation INTEGER NOT NULL CHECK(generation>0),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      CHECK((scope='personal' AND project_id='') OR (scope='project' AND length(project_id)>0)),
      CHECK((state='active' AND version_id IS NOT NULL AND manifest_identity IS NOT NULL) OR
        (state='disabled' AND version_id IS NULL AND manifest_identity IS NULL)),
      PRIMARY KEY(owner_id,scope,project_id,package_id,role_key),
      FOREIGN KEY(owner_id,scope,project_id,package_id)
        REFERENCES method_binding_generations(owner_id,scope,project_id,package_id),
      FOREIGN KEY(package_id,version_id,manifest_identity)
        REFERENCES method_versions(package_id,id,manifest_identity)
    ) STRICT;
    CREATE TABLE method_binding_events (
      event_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL,
      scope TEXT NOT NULL CHECK(scope IN ('personal','project')), project_id TEXT NOT NULL,
      package_id TEXT NOT NULL, role_key TEXT NOT NULL CHECK(role_key='*' OR
        (length(role_key) BETWEEN 1 AND 200 AND role_key NOT GLOB '*[^A-Za-z0-9._-]*')),
      kind TEXT NOT NULL CHECK(kind='binding_changed'),
      revision INTEGER NOT NULL CHECK(revision>0), generation INTEGER NOT NULL CHECK(generation>0),
      state TEXT NOT NULL CHECK(state IN ('active','disabled')), version_id TEXT, manifest_identity TEXT,
      action_id TEXT NOT NULL, created_at TEXT NOT NULL,
      reason_refs TEXT NOT NULL CHECK(json_valid(reason_refs) AND json_type(reason_refs)='array'
        AND json_array_length(reason_refs)<=16),
      ordinal INTEGER NOT NULL UNIQUE CHECK(ordinal>0),
      CHECK((scope='personal' AND project_id='') OR (scope='project' AND length(project_id)>0)),
      CHECK((state='active' AND version_id IS NOT NULL AND manifest_identity IS NOT NULL) OR
        (state='disabled' AND version_id IS NULL AND manifest_identity IS NULL)),
      FOREIGN KEY(owner_id,scope,project_id,package_id,role_key)
        REFERENCES method_bindings(owner_id,scope,project_id,package_id,role_key),
      FOREIGN KEY(package_id,version_id,manifest_identity)
        REFERENCES method_versions(package_id,id,manifest_identity)
    ) STRICT;
    CREATE INDEX method_binding_event_scope ON method_binding_events(owner_id,scope,project_id,ordinal);
    CREATE INDEX method_binding_event_package ON method_binding_events(owner_id,scope,project_id,package_id,ordinal);
    CREATE UNIQUE INDEX method_binding_event_revision ON method_binding_events(owner_id,scope,project_id,package_id,role_key,revision);
    CREATE UNIQUE INDEX method_binding_event_generation ON method_binding_events(owner_id,scope,project_id,package_id,generation);
    CREATE TRIGGER method_binding_namespace_insert BEFORE INSERT ON method_binding_generations
      WHEN NOT EXISTS(SELECT 1 FROM method_packages p WHERE p.id=NEW.package_id AND p.owner_id=NEW.owner_id AND
        ((p.scope=NEW.scope AND p.project_id=NEW.project_id) OR (NEW.scope='project' AND p.scope='personal' AND p.project_id='')))
      BEGIN SELECT RAISE(ABORT,'invalid_method_binding_namespace'); END;
    CREATE TRIGGER method_binding_namespace_update BEFORE UPDATE ON method_binding_generations
      WHEN NOT EXISTS(SELECT 1 FROM method_packages p WHERE p.id=NEW.package_id AND p.owner_id=NEW.owner_id AND
        ((p.scope=NEW.scope AND p.project_id=NEW.project_id) OR (NEW.scope='project' AND p.scope='personal' AND p.project_id='')))
      BEGIN SELECT RAISE(ABORT,'invalid_method_binding_namespace'); END;
  `;
export function installMethodPackages(db) { db.exec(canonicalSQL); }

let canonicalDefinitions;
function validateDefinitions(db) {
  // Use SQLite's own persisted rendering of the installer, including every
  // CHECK, implicit UNIQUE/PRIMARY KEY, foreign key, index and trigger body.
  // Never normalize SQL by deleting whitespace inside string literals.
  if (!canonicalDefinitions) {
    // Reuse the caller's SQLite class so importing schema guards stays portable.
    const reference = new db.constructor(':memory:');
    try {
      installMethodPackages(reference);
      canonicalDefinitions = reference.prepare("SELECT name,type,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name").all();
    } finally { reference.close(); }
  }
  const lookup = db.prepare('SELECT type,tbl_name,sql FROM sqlite_master WHERE name=?');
  for (const expected of canonicalDefinitions) {
    const actual = lookup.get(expected.name);
    if (!actual || actual.type !== expected.type || actual.tbl_name !== expected.tbl_name ||
        actual.sql !== expected.sql) fail('unsupported_database');
  }
}
const layouts = {
  method_packages: 'id owner_id scope project_id state revision next_ordinal created_at updated_at',
  method_versions: 'id package_id ordinal based_on manifest_identity state revision title submitted_by imported_at byte_count',
  method_files: 'version_id position path text byte_count content_identity media_type',
  method_changes: 'to_id from_ref to_ref items reason_refs',
  method_operations: 'owner_id scope project_id action_id method payload_binding target_id result created_at',
  method_effects: 'effect_id owner_id scope project_id kind entity_type entity_id revision action_id ordinal',
  method_epochs: 'owner_id scope project_id generation', method_owner_usage: 'owner_id byte_count',
  method_binding_generations: 'owner_id scope project_id package_id generation',
  method_bindings: 'owner_id scope project_id package_id role_key state version_id manifest_identity revision generation created_at updated_at',
  method_binding_events: 'event_id owner_id scope project_id package_id role_key kind revision generation state version_id manifest_identity action_id created_at reason_refs ordinal',
};
const primaryKeys = {
  method_packages: ['id'], method_versions: ['id'], method_files: ['version_id','position'],
  method_changes: ['to_id'], method_operations: ['owner_id','scope','project_id','action_id'],
  method_effects: ['effect_id'], method_epochs: ['owner_id','scope','project_id'], method_owner_usage: ['owner_id'],
  method_binding_generations: ['owner_id','scope','project_id','package_id'],
  method_bindings: ['owner_id','scope','project_id','package_id','role_key'], method_binding_events: ['event_id'],
};
const integerColumns = new Set(['revision','next_ordinal','ordinal','byte_count','position','generation']);
const nullableColumns = new Set(['based_on','title','submitted_by','from_ref']);
export function validateMethodPrerequisites(db) {
  // The existing-store validator owns the Raw/local-control seam. Validate the
  // additional canonical Card and Memory readers used by method reason refs.
  for (const [table, columns] of Object.entries({
    memories: 'id owner_id scope project_id revision deleted currentness review_state',
    receipts: 'id memory_id client session_id event_id role excerpt',
    card_notes: 'id owner_id scope project_id revision state text byte_count',
    private_cards: 'id owner_id scope project_id revision state title body body_revision created_at updated_at confirmed_at',
    card_bindings: 'card_id source_id source_ref position',
    card_memory_bindings: 'card_id memory_id memory_revision receipt_id source_ref position',
    card_operations: 'owner_id scope project_id action_id method payload_binding target_id result created_at',
    card_effects: 'effect_id owner_id scope project_id kind entity_type entity_id revision action_id ordinal',
    card_epochs: 'owner_id scope project_id generation', card_note_usage: 'owner_id byte_count',
    card_applicability_reviews: 'card_id reviewed_revision applicability',
    card_moc_epochs: 'owner_id scope project_id revision', card_mocs: 'id owner_id scope project_id revision',
    card_moc_title_sources: 'moc_id card_id card_revision body_revision',
    card_moc_refs: 'moc_id moc_revision card_id card_revision body_revision',
    card_moc_edges: 'parent_id parent_revision child_id child_revision',
  })) {
    const actual = new Set(db.prepare('SELECT name FROM pragma_table_info(?)').all(table).map(row => row.name));
    if (columns.split(' ').some(name => !actual.has(name))) fail('unsupported_database');
  }
  for (const name of ['card_memory_purge','card_moc_card_insert','card_moc_card_update']) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?").get(name)) fail('unsupported_database');
  }
}
export function validateMethodPackages(db) {
  validateDefinitions(db);
  validateMethodPrerequisites(db);
  for (const [table, columns] of Object.entries(layouts)) {
    const rows = db.prepare('SELECT * FROM pragma_table_info(?) ORDER BY cid').all(table);
    if (rows.map(row => row.name).join(' ') !== columns || rows.some(row =>
      row.type !== (integerColumns.has(row.name) ? 'INTEGER' : 'TEXT') ||
      row.notnull !== (nullableColumns.has(row.name) ||
        ['method_bindings','method_binding_events'].includes(table) && ['version_id','manifest_identity'].includes(row.name) ? 0 : 1) ||
      row.pk !== Math.max(0, primaryKeys[table].indexOf(row.name)+1)) ||
        db.prepare("SELECT strict FROM pragma_table_list WHERE schema='main' AND name=?").get(table)?.strict !== 1) fail('unsupported_database');
  }
  for (const [table, name, columns, unique] of [
    ['method_packages', 'method_package_scope', 'owner_id scope project_id id', 0],
    ['method_effects', 'method_effect_scope', 'owner_id scope project_id ordinal', 0],
    ['method_versions', 'method_version_ref', 'package_id id manifest_identity', 1],
    ['method_binding_events', 'method_binding_event_scope', 'owner_id scope project_id ordinal', 0],
    ['method_binding_events', 'method_binding_event_package', 'owner_id scope project_id package_id ordinal', 0],
    ['method_binding_events', 'method_binding_event_revision', 'owner_id scope project_id package_id role_key revision', 1],
    ['method_binding_events', 'method_binding_event_generation', 'owner_id scope project_id package_id generation', 1],
  ]) {
    const rows = db.prepare('SELECT * FROM pragma_index_xinfo(?) WHERE key=1 ORDER BY seqno').all(name);
    const index = db.prepare('SELECT * FROM pragma_index_list(?) WHERE name=?').get(table,name);
    if (!index || index.unique !== unique || index.partial || rows.map(row => row.name).join(' ') !== columns ||
        rows.some(row => row.desc || row.coll !== 'BINARY')) fail('unsupported_database');
  }
  for (const name of ['method_binding_namespace_insert','method_binding_namespace_update']) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?").get(name)) fail('unsupported_database');
  }
  for (const [table, expected] of Object.entries({
    method_binding_generations: [['method_packages',['package_id'],['id']]],
    method_bindings: [['method_binding_generations',['owner_id','scope','project_id','package_id'],['owner_id','scope','project_id','package_id']],
      ['method_versions',['package_id','version_id','manifest_identity'],['package_id','id','manifest_identity']]],
    method_binding_events: [['method_bindings',['owner_id','scope','project_id','package_id','role_key'],['owner_id','scope','project_id','package_id','role_key']],
      ['method_versions',['package_id','version_id','manifest_identity'],['package_id','id','manifest_identity']]],
  })) {
    const groups = new Map();
    for (const row of db.prepare('SELECT * FROM pragma_foreign_key_list(?) ORDER BY id,seq').all(table)) {
      if (row.on_update !== 'NO ACTION' || row.on_delete !== 'NO ACTION') fail('unsupported_database');
      if (!groups.has(row.id)) groups.set(row.id,[row.table,[],[]]);
      groups.get(row.id)[1].push(row.from); groups.get(row.id)[2].push(row.to);
    }
    const ordered = values => values.map(value => JSON.stringify(value)).sort().join();
    if (ordered([...groups.values()]) !== ordered(expected)) fail('unsupported_database');
  }
}
