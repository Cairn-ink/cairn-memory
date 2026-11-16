import { LOCAL_RAW_PRIVACY_DDL, LOCAL_RAW_PEER_INDEX_DDL, LOCAL_RAW_PACKAGES, attestedLocalRawPackage, localRawPackageVersion } from './content-safety-schema.mjs';
import { readdirSync, writeFileSync, renameSync, unlinkSync, statfsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
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
const markerPrefix = path => basename(path) + '.peer-index-retry.';
const nativeSQLiteError = error => typeof error?.errcode === 'number';
const systemError = error => typeof error?.code === 'string' && /^E[A-Z]+$/.test(error.code);
const nativeReason = error => ({ 5: 'busy', 6: 'busy', 9: 'interrupt', 10: 'io', 13: 'full' })[error.errcode & 255] ?? 'error';
const outcome = (status, reason = null) => ({ status, reason });
function parsePeerIndexRetry(path, name) {
  const prefix = markerPrefix(path);
  if (!name.startsWith(prefix)) return null;
  // Reserved leaves: <store file name>.peer-index-retry.<notBefore>.<delayMs>.<reason>.
  // Both numbers are decimal nonnegative safe integers; reasons are fixed below.
  // Names are the entire format. Never inspect or open a marker entry, even
  // if it is a swapped symlink, hard-linked companion, directory or FIFO.
  const fields = /^([0-9]+)\.([0-9]+)\.(busy|io|full|interrupt|space|error)$/.exec(name.slice(prefix.length));
  if (!fields || fields[0].length !== name.length - prefix.length) return null;
  const [, deadline, delay, reason] = fields, notBefore = Number(deadline), delayMs = Number(delay);
  return Number.isSafeInteger(notBefore) && Number.isSafeInteger(delayMs) ? { notBefore, delayMs, reason } : null;
}
function peerIndexRetryNames(path) {
  if (path === ':memory:') return [];
  try { return readdirSync(dirname(resolve(path))).filter(name => parsePeerIndexRetry(path, name)); }
  catch { return []; }
}
function readPeerIndexRetry(path, names) {
  const now = Date.now();
  let active = null, previous = null;
  for (const name of names) {
    const marker = parsePeerIndexRetry(path, name);
    if (!marker || marker.delayMs < firstRetryMs || marker.delayMs > maxRetryMs) continue;
    // Expiry ends backoff, not the delay history used by the next failure.
    if (!previous || marker.notBefore > previous.notBefore) previous = marker;
    if (marker.notBefore >= now && marker.notBefore <= now + maxRetryMs &&
        (!active || marker.notBefore > active.notBefore)) active = marker;
  }
  return { active, previous };
}
function clearPeerIndexRetry(path, names, published) {
  for (const name of names) {
    const marker = parsePeerIndexRetry(path, name);
    if (!marker || published && !(marker.notBefore < published.now && marker.notBefore < published.notBefore)) continue;
    try { unlinkSync(join(dirname(resolve(path)), name)); } catch { /* Optional marker only; never follow. */ }
  }
}
function deferPeerIndex(path, previous, reason, status = 'deferred') {
  if (path !== ':memory:') {
    const directory = dirname(resolve(path));
    const delayMs = Math.min(maxRetryMs, previous ? previous.delayMs * 2 : firstRetryMs);
    const now = Date.now(), notBefore = now + delayMs;
    const name = markerPrefix(path) + notBefore + '.' + delayMs + '.' + reason;
    // Keep temporary leaves outside the marker namespace so another publisher
    // clearing old markers cannot unlink an in-progress exclusive write.
    const temporary = join(directory, '.' + markerPrefix(path) + randomUUID() + '.tmp');
    let pending = true;
    try {
      writeFileSync(temporary, '', { flag: 'wx', mode: 0o600 });
      renameSync(temporary, join(directory, name));
      pending = false;
      // A failed publisher owns only its new leaf and strictly older expired
      // history. Concurrent unexpired publications must survive both snapshots.
      clearPeerIndexRetry(path, peerIndexRetryNames(path), { now, notBefore });
    } catch { /* Marker failures must never turn an optional build into a refusal. */ }
    finally { if (pending) { try { unlinkSync(temporary); } catch { /* Optional marker only. */ } } }
  }
  return outcome(status, reason);
}

/** Read-only status on an already attested connection and absolute store path. */
export function readLocalRawPeerIndexStatus(db, path) {
  attestedLocalRawPackage(db); // Preserve refusal, but never use its stale package for presence.
  const present = peerPackage(db) === 'v2';
  const retry = present ? null : readPeerIndexRetry(path, peerIndexRetryNames(path)).active;
  const absolute = resolve(path);
  return {
    present,
    overThreshold: peerIndexSize(db) > peerIndexThreshold,
    deferredReason: retry?.reason ?? null,
    deferredUntil: retry?.notBefore ?? null,
    offlineCommand: "cairn-memory raw index --db '" + absolute.replaceAll("'", "'\\''") + "'",
    offlineArgv: ['cairn-memory', 'raw', 'index', '--db', absolute],
  };
}
function buildPeerIndexConnection(db, timeout, admission) {
  // Schema-only, synchronous work within the same approved opening scope as
  // the package install. Check routing on the bound runtime, but never transact
  // on it: a failed side connection must not poison its attestation cache.
  assertCommitWriteRouted(db, 'local raw peer index');
  let builder;
  try {
    if (!admission) return outcome('deferred', 'error');
    admission.check();
    builder = new DatabaseSync(admission.uri, { timeout });
    builder.exec('PRAGMA foreign_keys = ON; PRAGMA trusted_schema = OFF;');
    builder.exec('BEGIN IMMEDIATE');
    admission.check();
    // Complete runtime admission, including the L1 census, on this handle only.
    // A refusal cannot poison the runtime's safety-header cache.
    admission.validate(builder);
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
    if (nativeSQLiteError(error)) return outcome('deferred', nativeReason(error));
    if (systemError(error) || ['unsafe_database_file', 'unsupported_database', 'method_not_found'].includes(error?.code)) return outcome('deferred', 'error');
    throw error;
  } finally {
    // Native close also rolls back any transaction left by a failed ROLLBACK.
    // Once COMMIT succeeds, a native close error cannot undo the built result.
    try { builder?.close(); } catch (error) { if (!nativeSQLiteError(error)) throw error; }
  }
}
function upgradeLocalRawPeerIndex(db, path, offline, timeout, admission) {
  // Preserve the existing accessor's refusal behaviour, even during backoff.
  const cachedVersion = attestedLocalRawPackage(db), names = peerIndexRetryNames(path);
  if (cachedVersion === 'v2') { clearPeerIndexRetry(path, names); return outcome('present'); }
  const { active, previous } = readPeerIndexRetry(path, names);
  if (!offline && active) return outcome('skipped', 'backoff');
  try {
    const version = cachedVersion ?? peerPackage(db);
    if (version === 'v2') { clearPeerIndexRetry(path, names); return outcome('present'); }
    if (version !== 'v1') return deferPeerIndex(path, previous, 'error');
    const n = peerIndexSize(db);
    if (!offline && n > peerIndexThreshold) return outcome('skipped', 'over_threshold');
    let space;
    try { space = statfsSync(dirname(resolve(path))); }
    catch (error) {
      if (!systemError(error)) throw error;
      return deferPeerIndex(path, previous, 'io');
    }
    if (space.bavail * space.bsize < 2 * 84 * Math.max(n, 1)) return deferPeerIndex(path, previous, 'space', 'skipped');
    if (path === ':memory:') return deferPeerIndex(path, previous, 'error');
    const result = buildPeerIndexConnection(db, timeout, admission);
    if (result.status === 'deferred') return deferPeerIndex(path, previous, result.reason);
    clearPeerIndexRetry(path, peerIndexRetryNames(path));
    return result;
  } catch (error) {
    if (!nativeSQLiteError(error)) throw error;
    return deferPeerIndex(path, previous, nativeReason(error));
  }
}
/** Bounded, best-effort open-time build; only the opener supplies admission. */
export function installLocalRawPeerIndex(db, path, admission, timeout = 5000) {
  return upgradeLocalRawPeerIndex(db, path, false, timeout, admission);
}
/** Offline bypasses only the automatic threshold and the retry deadline. */
export function buildLocalRawPeerIndex(db, path, admission, timeout = 5000) {
  return upgradeLocalRawPeerIndex(db, path, true, timeout, admission);
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
