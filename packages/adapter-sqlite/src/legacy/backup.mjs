import { spawnSync } from 'node:child_process';
import { chmodSync, closeSync, fsyncSync, mkdtempSync, openSync, readdirSync,
  readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { sameDirectory } from '../../../../core/sqlite-journal-probe.mjs';
import { readLegacySnapshot } from './inventory.mjs';
import { assertPrivateDirectory, entry, privateFile, privateLocation } from './paths.mjs';
import { assertLegacyOpen, LEGACY_RULES, LegacyRefusal } from './refusal.mjs';

const dbName = 'store.sqlite';
const proofName = 'proof.json';
const proofFormat = 'legacy-sqlite-backup-v1';
const stagePrefix = '.legacy-backup-';
const digestPattern = /^[0-9a-f]{64}$/;
const quiescenceFlags = ['admissionsClosed', 'writersStopped', 'readersDrained', 'oldHandlesClosed'];

function assertQuiescent(quiescence, expectedStoreId) {
  if (!expectedStoreId || quiescenceFlags.some(flag => quiescence?.[flag] !== true)) {
    throw new LegacyRefusal('legacy_quiescence_required');
  }
}

function syncDirectory(path) {
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); }
  finally { closeSync(fd); }
}

function publishedLocation(path) {
  const location = privateLocation(path);
  if (basename(location.path).startsWith(stagePrefix)) throw new LegacyRefusal('legacy_backup_unpublished');
  return location;
}

// Byte hashing and fsync run in a process that has no SQLite connection.
// The logical digest is the engine's separate schema/row inventory proof.
function byteDigest(path, sync = false) {
  const script = `import { createHash } from 'node:crypto';
    import { createReadStream } from 'node:fs';
    import { open } from 'node:fs/promises';
    const [path, durable] = process.argv.slice(1);
    const file = await open(path, 'r');
    try {
      if (durable === 'sync') await file.sync();
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(path, { fd: file.fd, autoClose: false })) hash.update(chunk);
      console.log(hash.digest('hex'));
    } finally { await file.close(); }`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, path, sync ? 'sync' : 'read'],
    { encoding: 'utf8', env: {}, timeout: 120_000, maxBuffer: 4096 });
  const digest = result.stdout?.trim();
  if (result.error || result.status !== 0 || !digestPattern.test(digest ?? '')) {
    throw new LegacyRefusal('legacy_backup_io');
  }
  return digest;
}

function sqliteBackupSource(file) {
  const db = new DatabaseSync(file.path, { readOnly: true });
  try {
    db.exec('PRAGMA query_only = ON; PRAGMA trusted_schema = OFF');
    if (db.prepare('PRAGMA journal_mode').get().journal_mode !== 'delete') throw new LegacyRefusal('legacy_unsafe_path');
    file.check();
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

// The host owns the maintenance barrier throughout this call. SQLite cannot
// revoke another process's idle handle. A fresh destination directory appears
// atomically after both the private copy and its proof are durable.
export async function createLegacyBackup({ path, backupDirectory, expectedStoreId, quiescence }) {
  assertQuiescent(quiescence, expectedStoreId);
  const destination = publishedLocation(backupDirectory);
  if (entry(destination.path)) throw new LegacyRefusal('legacy_backup_exists');
  const source = readLegacySnapshot(path, { expectedStoreId, digest: true });

  let stage;
  try {
    stage = mkdtempSync(join(destination.parent, stagePrefix));
    assertPrivateDirectory(stage);
    const copyPath = join(stage, dbName);
    const db = sqliteBackupSource(source.file);
    try { await backup(db, copyPath); }
    finally { db.close(); }
    chmodSync(copyPath, 0o600);
    const copy = readLegacySnapshot(copyPath, { expectedStoreId, digest: true });
    assertLegacyOpen(copy.inventory, source.inventory);
    if (copy.logicalDigest !== source.logicalDigest) throw new LegacyRefusal('legacy_integrity_mismatch');

    const proof = Object.freeze({
      format: proofFormat,
      ...Object.fromEntries(LEGACY_RULES.openPin.map(field => [field, copy.inventory[field]])),
      logicalDigest: copy.logicalDigest,
      byteDigest: byteDigest(copyPath, true),
    });
    copy.file.check();
    writeFileSync(join(stage, proofName), JSON.stringify(proof) + '\n',
      { mode: 0o600, flag: 'wx', flush: true });
    syncDirectory(stage);
    source.file.check();
    destination.check();
    if (entry(destination.path)) throw new LegacyRefusal('legacy_backup_exists');
    renameSync(stage, destination.path);
    stage = undefined;
    syncDirectory(destination.parent);
    return proof;
  } catch (error) {
    if (error instanceof LegacyRefusal) throw error;
    if (entry(destination.path) && ['EEXIST', 'ENOTEMPTY'].includes(error.code)) {
      throw new LegacyRefusal('legacy_backup_exists');
    }
    throw new LegacyRefusal('legacy_backup_io');
  } finally {
    if (stage) rmSync(stage, { recursive: true, force: true });
  }
}

export function verifyLegacyBackup({ backupDirectory, expectedStoreId }) {
  const location = publishedLocation(backupDirectory);
  if (!entry(location.path)) throw new LegacyRefusal('legacy_backup_unpublished');
  const directory = assertPrivateDirectory(location.path);
  try {
    const proofPath = join(location.path, proofName);
    if (!entry(proofPath)) throw new LegacyRefusal('legacy_backup_unpublished');
    if (privateFile(proofPath).size > 4096n) throw new LegacyRefusal('legacy_integrity_mismatch');
    const proof = JSON.parse(readFileSync(proofPath, 'utf8'));
    if (proof?.format !== proofFormat || typeof proof.logicalDigest !== 'string' ||
        !digestPattern.test(proof.logicalDigest) || typeof proof.byteDigest !== 'string' ||
        !digestPattern.test(proof.byteDigest) ||
        Object.keys(proof).length !== LEGACY_RULES.openPin.length + 3) {
      throw new LegacyRefusal('legacy_integrity_mismatch');
    }
    if (readdirSync(location.path).sort().join(',') !== [proofName, dbName].join(',')) {
      throw new LegacyRefusal('legacy_unsafe_path');
    }
    const copy = readLegacySnapshot(join(location.path, dbName), { expectedStoreId, digest: true });
    if (LEGACY_RULES.openPin.some(field => proof[field] !== copy.inventory[field]) ||
        proof.logicalDigest !== copy.logicalDigest || proof.byteDigest !== byteDigest(copy.file.path)) {
      throw new LegacyRefusal('legacy_integrity_mismatch');
    }
    copy.file.check();
    location.check();
    if (!sameDirectory(directory, assertPrivateDirectory(location.path))) {
      throw new LegacyRefusal('legacy_unsafe_path');
    }
    return Object.freeze(proof);
  } catch (error) {
    if (error instanceof LegacyRefusal) throw error;
    throw new LegacyRefusal('legacy_integrity_mismatch');
  }
}

// Only a separately known canonical path can establish freshness. Any logical
// change is a refusal, including ordinary writes whose effect on forgetting
// cannot be proved by the legacy evidence. A lost source cannot serve as proof.
export function verifyLegacyBackupAgainstSource({ path, backupDirectory, expectedStoreId, quiescence }) {
  assertQuiescent(quiescence, expectedStoreId);
  const proof = verifyLegacyBackup({ backupDirectory, expectedStoreId });
  const copy = privateFile(join(backupDirectory, dbName));
  const source = readLegacySnapshot(path, { expectedStoreId, digest: true });
  if (source.file.stat.dev === copy.dev && source.file.stat.ino === copy.ino) {
    throw new LegacyRefusal('legacy_backup_no_authority');
  }
  if (source.logicalDigest !== proof.logicalDigest) throw new LegacyRefusal('legacy_backup_stale');
  return proof;
}

export function assertLegacyBackupCanServe(input) {
  verifyLegacyBackupAgainstSource(input);
  throw new LegacyRefusal('legacy_backup_archival_only');
}
