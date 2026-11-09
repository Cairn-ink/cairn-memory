import { fail } from './validation.mjs';

export const LOCAL_AUTHORITY_SCHEMA_VERSION = 29;
export const LOCAL_BINDING_COLUMNS = ['local_target_id','local_store_id','local_consent_generation'];

// Selected locally, additive, and deliberately independent of user_version.
// Product stores opening the base or an explicit hosted Raw profile get no DDL.
export function installLocalRawPrivacy(db) {
  const legacy = `CREATE TABLE IF NOT EXISTS local_raw_hide_windows (
    owner_id TEXT NOT NULL, scope TEXT NOT NULL, project_id TEXT NOT NULL,
    start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL CHECK(end_ms>=start_ms),
    PRIMARY KEY(owner_id,scope,project_id,start_ms)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS local_raw_session_modes (
    owner_id TEXT NOT NULL, scope TEXT NOT NULL, project_id TEXT NOT NULL,
    client TEXT NOT NULL, session_key TEXT NOT NULL, interpretation TEXT NOT NULL CHECK(interpretation IN ('engine','host')),
    PRIMARY KEY(owner_id,scope,project_id,client,session_key)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS local_raw_session_ranges (
    owner_id TEXT NOT NULL, scope TEXT NOT NULL, project_id TEXT NOT NULL,
    client TEXT NOT NULL, session_key TEXT NOT NULL,
    min_ms INTEGER, max_ms INTEGER, unknown_time INTEGER NOT NULL CHECK(unknown_time IN (0,1)),
    CHECK((min_ms IS NULL AND max_ms IS NULL) OR (min_ms IS NOT NULL AND max_ms IS NOT NULL AND max_ms>=min_ms)),
    CHECK(unknown_time=1 OR min_ms IS NOT NULL),
    PRIMARY KEY(owner_id,scope,project_id,client,session_key)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS local_raw_range_overlap ON local_raw_session_ranges
    (owner_id,scope,project_id,unknown_time,min_ms,max_ms,client,session_key);
  CREATE INDEX IF NOT EXISTS local_raw_capture_session_events ON raw_capture_events
    (owner_id,scope,project_id,client,session_key,event_id);`;
  const ddl = legacy + `
  CREATE TABLE IF NOT EXISTS local_raw_uuid_fences (
    owner_id TEXT NOT NULL, scope TEXT NOT NULL, project_id TEXT NOT NULL,
    client TEXT NOT NULL CHECK(client='claude-code'), uuid_hash TEXT NOT NULL,
    PRIMARY KEY(owner_id,scope,project_id,client,uuid_hash)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS local_raw_uuid_jobs (
    owner_id TEXT NOT NULL, scope TEXT NOT NULL, project_id TEXT NOT NULL,
    client TEXT NOT NULL CHECK(client='claude-code'), session_key TEXT NOT NULL,
    last_ordinal INTEGER NOT NULL DEFAULT 0, complete INTEGER NOT NULL DEFAULT 0 CHECK(complete IN (0,1)),
    PRIMARY KEY(owner_id,scope,project_id,client,session_key)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS local_raw_uuid_pending ON local_raw_uuid_jobs
    (complete,owner_id,scope,project_id,client,session_key);
  CREATE TABLE IF NOT EXISTS local_raw_uuid_backfill (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1), cursor TEXT NOT NULL, complete INTEGER NOT NULL CHECK(complete IN (0,1))
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS local_raw_uuid_delete_guard BEFORE DELETE ON raw_messages
  WHEN EXISTS (SELECT 1 FROM raw_conversations c WHERE c.id=OLD.conversation_id AND c.client='claude-code'
    AND (NOT EXISTS (SELECT 1 FROM local_raw_uuid_backfill WHERE singleton=1 AND complete=1)
      OR NOT EXISTS (SELECT 1 FROM local_raw_uuid_jobs j WHERE j.owner_id=c.owner_id AND j.scope=c.scope
        AND j.project_id=c.project_id AND j.client=c.client AND j.session_key=c.session_key AND j.complete=1)))
  BEGIN SELECT RAISE(ABORT,'local_raw_uuid_pending'); END;`;
  // The exact attestor consumes the same declarations without executing DDL.
  if (db) db.exec(ddl);
  return db === false ? legacy : ddl;
}
export function validateRawSourcePrerequisites(db) {
  for (const name of ['card_raw_bindings','card_raw_mutation_context','card_raw_pending_invalidations']) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)) fail('unsupported_database');
  }
  for (const name of ['raw_source_part_start','card_raw_dependents']) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name=?").get(name)) fail('unsupported_database');
  }
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='card_raw_purge'").get()) fail('unsupported_database');
}
export function assertNoLocalAuthority(db) {
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE name GLOB 'local_capture_*'").get() ||
      db.prepare('PRAGMA table_info(raw_capture_events)').all().some(row => LOCAL_BINDING_COLUMNS.includes(row.name))) fail('unsupported_database');
}
export function installLocalAuthority(db) {
  assertNoLocalAuthority(db);
  db.exec(`CREATE TABLE local_capture_controls (
    owner_id TEXT NOT NULL, scope TEXT NOT NULL CHECK(scope IN ('personal','project')), project_id TEXT NOT NULL,
    client TEXT NOT NULL CHECK(client IN ('claude-code','codex')), target_id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK(revision>0), automatic_capture_enabled INTEGER NOT NULL CHECK(automatic_capture_enabled IN (0,1)),
    consent_generation TEXT NOT NULL, raw_notice_version TEXT CHECK(raw_notice_version='local-plain-v1'),
    CHECK((scope='personal' AND project_id='') OR (scope='project' AND length(project_id)>0)),
    PRIMARY KEY(owner_id,scope,project_id,client)
  ) STRICT;
  ALTER TABLE raw_capture_events ADD COLUMN local_target_id TEXT;
  ALTER TABLE raw_capture_events ADD COLUMN local_store_id TEXT;
  ALTER TABLE raw_capture_events ADD COLUMN local_consent_generation TEXT;
  CREATE TRIGGER local_capture_binding_insert BEFORE INSERT ON raw_capture_events
    WHEN (NEW.local_target_id IS NULL)+(NEW.local_store_id IS NULL)+(NEW.local_consent_generation IS NULL) NOT IN (0,3)
    BEGIN SELECT RAISE(ABORT,'incomplete local capture binding'); END;
  CREATE TRIGGER local_capture_binding_update BEFORE UPDATE ON raw_capture_events
    WHEN (NEW.local_target_id IS NULL)+(NEW.local_store_id IS NULL)+(NEW.local_consent_generation IS NULL) NOT IN (0,3)
    BEGIN SELECT RAISE(ABORT,'incomplete local capture binding'); END;`);
}
export function validateLocalAuthorityMetadata(db) {
  const columns = db.prepare('PRAGMA table_info(local_capture_controls)').all();
  const expected = ['owner_id','scope','project_id','client','target_id','revision','automatic_capture_enabled','consent_generation','raw_notice_version'];
  if (columns.length !== expected.length || columns.some((row,i) => row.name !== expected[i] || row.type !== (['revision','automatic_capture_enabled'].includes(row.name) ? 'INTEGER':'TEXT') ||
      row.notnull !== (row.name === 'raw_notice_version' ? 0:1) || row.pk !== (i < 4 ? i+1:0)) ||
      !db.prepare("PRAGMA table_list").all().find(row => row.name === 'local_capture_controls' && row.strict === 1)) fail('unsupported_database');
  for (const name of LOCAL_BINDING_COLUMNS) if (!db.prepare('PRAGMA table_info(raw_capture_events)').all().some(row => row.name === name && row.type === 'TEXT')) fail('unsupported_database');
  for (const name of ['local_capture_binding_insert','local_capture_binding_update']) if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?").get(name)) fail('unsupported_database');
}
export function validateLocalAuthority(db) {
  validateLocalAuthorityMetadata(db);
  if (db.prepare(`SELECT 1 FROM raw_capture_events WHERE (local_target_id IS NULL)+(local_store_id IS NULL)+(local_consent_generation IS NULL) NOT IN (0,3)`).get()) fail('unsupported_database');
}
