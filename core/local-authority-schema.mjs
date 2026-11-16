import { LOCAL_RAW_PRIVACY_DDL, LOCAL_RAW_PEER_INDEX_DDL, LOCAL_RAW_PACKAGES, attestedLocalRawPackage, localRawPackageVersion } from './content-safety-schema.mjs';
import { lstatSync, readFileSync, writeFileSync, renameSync, rmSync, statfsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { assertCommitWriteRouted } from './commit-dispatch.mjs';
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

// Include foreign indexes/triggers on local tables and an overflow witness.
const peerPackageSQL = "SELECT name,type,sql FROM sqlite_schema WHERE sql IS NOT NULL AND (name GLOB 'local_raw_*' OR tbl_name GLOB 'local_raw_*') LIMIT " + (LOCAL_RAW_PACKAGES.v2.length + 1);
const peerPackage = db => localRawPackageVersion(db.prepare(peerPackageSQL).all());
const peerIndexSize = db => db.prepare('SELECT max(rowid) AS n FROM raw_messages').get().n ?? 0;
const peerIndexThreshold = 2_000_000;
const firstRetryMs = 6 * 60 * 60 * 1000, maxRetryMs = 24 * 60 * 60 * 1000;
const retryReasons = new Set(['busy', 'io', 'full', 'interrupt', 'space', 'error']);
const markerPath = path => resolve(path) + '.peer-index-retry';
const nativeSQLiteError = error => typeof error?.errcode === 'number';
const systemError = error => typeof error?.code === 'string' && /^E[A-Z]+$/.test(error.code);
const nativeReason = error => ({ 5: 'busy', 6: 'busy', 9: 'interrupt', 10: 'io', 13: 'full' })[error.errcode & 255] ?? 'error';
const outcome = (status, reason = null) => ({ status, reason });
function readPeerIndexRetry(path) {
  if (path === ':memory:') return null;
  try {
    const marker = markerPath(path), stat = lstatSync(marker);
    if (!stat.isFile() || stat.size > 4096) return null;
    const value = JSON.parse(readFileSync(marker, 'utf8'));
    return value && Number.isSafeInteger(value.notBefore) && value.notBefore >= 0 &&
      Number.isSafeInteger(value.delayMs) && value.delayMs >= firstRetryMs && value.delayMs <= maxRetryMs &&
      retryReasons.has(value.reason) ? value : null;
  } catch { return null; }
}
function clearPeerIndexRetry(path) {
  if (path === ':memory:') return;
  try { rmSync(markerPath(path), { force: true }); } catch { /* Optional marker only. */ }
}
function deferPeerIndex(path, previous, reason, status = 'deferred') {
  if (path !== ':memory:') {
    const marker = markerPath(path);
    let temporary;
    const delayMs = Math.min(maxRetryMs, previous ? previous.delayMs * 2 : firstRetryMs);
    try {
      temporary = marker + '.' + randomUUID() + '.tmp';
      // Only marker paths reach fs: never a database, journal, WAL or SHM path.
      writeFileSync(temporary, JSON.stringify({ notBefore: Date.now() + delayMs, delayMs, reason }), { flag: 'wx', mode: 0o600 });
      renameSync(temporary, marker);
    } catch { /* Marker failures must never turn an optional build into a refusal. */ }
    finally { try { if (temporary) rmSync(temporary, { force: true }); } catch { /* Optional marker only. */ } }
  }
  return outcome(status, reason);
}

/** Read-only status on an already attested connection and absolute store path. */
export function readLocalRawPeerIndexStatus(db, path) {
  const version = attestedLocalRawPackage(db), retry = readPeerIndexRetry(path);
  return {
    present: version === 'v2' || version === null && peerPackage(db) === 'v2',
    overThreshold: peerIndexSize(db) > peerIndexThreshold,
    deferredReason: retry?.reason ?? null,
    deferredUntil: retry?.notBefore ?? null,
    offlineCommand: 'cairn-memory raw index --db ' + resolve(path),
  };
}
function buildPeerIndexConnection(db, path, timeout) {
  // Schema-only, synchronous work within the same approved opening scope as
  // the package install. Check routing on the bound runtime, but never transact
  // on it: a failed side connection must not poison its attestation cache.
  assertCommitWriteRouted(db, 'local raw peer index');
  let builder;
  try {
    builder = new DatabaseSync(path, { timeout });
    builder.exec('BEGIN IMMEDIATE');
    const version = peerPackage(builder);
    if (version !== 'v1') {
      builder.exec('ROLLBACK');
      return outcome(version === 'v2' ? 'present' : 'deferred', version === 'v2' ? null : 'error');
    }
    builder.exec(LOCAL_RAW_PEER_INDEX_DDL.join('\n'));
    builder.exec('COMMIT');
    // No fallible SQL/audit after COMMIT that could relabel committed v2 as v1.
    return outcome('built');
  } catch (error) {
    try { if (builder?.isTransaction) builder.exec('ROLLBACK'); }
    catch (rollback) { if (!nativeSQLiteError(rollback)) throw rollback; }
    if (!nativeSQLiteError(error)) throw error;
    return outcome('deferred', nativeReason(error));
  } finally {
    // Native close also rolls back any transaction left by a failed ROLLBACK.
    // Once COMMIT succeeds, a native close error cannot undo the built result.
    try { builder?.close(); } catch (error) { if (!nativeSQLiteError(error)) throw error; }
  }
}
function upgradeLocalRawPeerIndex(db, path, offline, timeout) {
  // Preserve the existing accessor's refusal behaviour, even during backoff.
  const cachedVersion = attestedLocalRawPackage(db), retry = readPeerIndexRetry(path);
  if (!offline && retry && Date.now() < retry.notBefore) return outcome('skipped', 'backoff');
  try {
    const version = cachedVersion ?? peerPackage(db);
    if (version === 'v2') { clearPeerIndexRetry(path); return outcome('present'); }
    if (version !== 'v1') return deferPeerIndex(path, retry, 'error');
    const n = peerIndexSize(db);
    if (!offline && n > peerIndexThreshold) return outcome('skipped', 'over_threshold');
    let space;
    try { space = statfsSync(dirname(resolve(path))); }
    catch (error) {
      if (!systemError(error)) throw error;
      return deferPeerIndex(path, retry, 'io');
    }
    if (space.bavail * space.bsize < 2 * 84 * Math.max(n, 1)) return deferPeerIndex(path, retry, 'space', 'skipped');
    if (path === ':memory:') return deferPeerIndex(path, retry, 'error');
    const result = buildPeerIndexConnection(db, path, timeout);
    if (result.status === 'deferred') return deferPeerIndex(path, retry, result.reason);
    clearPeerIndexRetry(path);
    return result;
  } catch (error) {
    if (!nativeSQLiteError(error)) throw error;
    return deferPeerIndex(path, retry, nativeReason(error));
  }
}
/** Bounded, best-effort open-time build, after the package install commits. */
export function installLocalRawPeerIndex(db, path, timeout = 5000) {
  return upgradeLocalRawPeerIndex(db, path, false, timeout);
}
/** Offline bypasses only the automatic threshold and the retry deadline. */
export function buildLocalRawPeerIndex(db, path, timeout = 5000) {
  return upgradeLocalRawPeerIndex(db, path, true, timeout);
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
