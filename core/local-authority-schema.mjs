import { LOCAL_RAW_PRIVACY_DDL, LOCAL_RAW_PEER_INDEX_DDL, attestedLocalRawPackage } from './content-safety-schema.mjs';
import { statfsSync } from 'node:fs';
import { dirname } from 'node:path';
import { fail } from './validation.mjs';

export const LOCAL_AUTHORITY_SCHEMA_VERSION = 29;
export const LOCAL_BINDING_COLUMNS = ['local_target_id','local_store_id','local_consent_generation'];

// Selected locally, additive, and deliberately independent of user_version.
// Product stores opening the base or an explicit hosted Raw profile get no DDL.
export function installLocalRawPrivacy(db) {
  const ddl = LOCAL_RAW_PRIVACY_DDL.join('\n');
  if (db) db.exec(ddl);
  return ddl;
}

const peerIndexPresent = db => Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='index' AND name='local_raw_message_peers'").get());
const peerIndexSize = db => db.prepare('SELECT max(rowid) AS n FROM raw_messages').get().n ?? 0;
const peerIndexThreshold = 2_000_000;

/** Read-only status on an already attested connection; never installs anything. */
export function localRawPeerIndexState(db) {
  return { present: peerIndexPresent(db), overThreshold: peerIndexSize(db) > peerIndexThreshold };
}
function upgradeLocalRawPeerIndex(db, path, offline, transaction) {
  const version = attestedLocalRawPackage(db);
  if (version === 'v2' || version === null && peerIndexPresent(db)) return 'present';
  const n = peerIndexSize(db);
  if (!offline && n > peerIndexThreshold) return 'over_threshold';
  const { bavail, bsize } = statfsSync(dirname(path));
  if (bavail * bsize < 2 * 84 * Math.max(n, 1)) return 'insufficient_space';
  try {
    // Inherits the package install's daemon synchronous commit scope. Probes
    // above never acquire a writer; only the actual build enters this helper.
    transaction(db, () => db.exec(LOCAL_RAW_PEER_INDEX_DDL.join('\n')));
    return 'built';
  } catch (error) {
    const code = Number(error?.errcode) & 255;
    if ([5,6].includes(code)) return 'busy';
    if (!offline && [9,10,13].includes(code)) return 'deferred';
    throw error;
  }
}
/** Best-effort bounded build on every writable local open. The caller supplies
 * the existing transaction helper to keep schema imports independent of openers. */
export function installLocalRawPeerIndex(db, path, transaction) {
  return upgradeLocalRawPeerIndex(db, path, false, transaction);
}
/** Explicit offline operator route retains the space and native lock limits. */
export function buildLocalRawPeerIndex(db, path, transaction) {
  return upgradeLocalRawPeerIndex(db, path, true, transaction);
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
