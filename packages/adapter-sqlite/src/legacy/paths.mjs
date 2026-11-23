import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { sameDirectory, sqliteFileStat } from '../../../../core/sqlite-journal-probe.mjs';
import { LegacyRefusal } from './refusal.mjs';

export function entry(path) {
  try {
    return sqliteFileStat(path);
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw new LegacyRefusal('legacy_unsafe_path');
  }
}

function privateEntry(stat, directory) {
  return stat && stat.uid === BigInt(process.getuid?.() ?? -1) &&
    (directory
      ? stat.isDirectory() && (stat.mode & 0o7777n) === 0o700n
      : stat.isFile() && stat.nlink === 1n && (stat.mode & 0o7777n) === 0o600n);
}

export function assertPrivateDirectory(path) {
  const stat = entry(path);
  if (!privateEntry(stat, true)) throw new LegacyRefusal('legacy_unsafe_path');
  return stat;
}

export function privateLocation(path) {
  if (typeof path !== 'string' || !path.isWellFormed() || path.includes('\0') ||
      !isAbsolute(path) || resolve(path) !== path || path === dirname(path)) {
    throw new LegacyRefusal('legacy_unsafe_path');
  }
  const parent = dirname(path);
  const directory = assertPrivateDirectory(parent);
  let canonicalParent;
  try { canonicalParent = realpathSync(parent); }
  catch { throw new LegacyRefusal('legacy_unsafe_path'); }
  function check() {
    if (!sameDirectory(assertPrivateDirectory(parent), directory) ||
        !sameDirectory(assertPrivateDirectory(canonicalParent), directory)) {
      throw new LegacyRefusal('legacy_unsafe_path');
    }
  }
  check();
  return { path: join(canonicalParent, basename(path)), parent: canonicalParent, check };
}

function assertNoCompanions(path) {
  if (['-journal', '-wal', '-shm'].some(suffix => entry(path + suffix))) {
    throw new LegacyRefusal('legacy_unsafe_path');
  }
}

export function privateFile(path) {
  const stat = entry(path);
  if (!stat) throw new LegacyRefusal('legacy_missing_file');
  if (!privateEntry(stat, false)) throw new LegacyRefusal('legacy_unsafe_path');
  return stat;
}

export function pinColdFile(path) {
  const location = privateLocation(path);
  const stat = privateFile(location.path);
  assertNoCompanions(location.path);
  function check() {
    location.check();
    assertNoCompanions(location.path);
    const current = privateFile(location.path);
    if (['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].some(key => current[key] !== stat[key])) {
      throw new LegacyRefusal('legacy_unsafe_path');
    }
  }
  return { path: location.path, stat, check };
}
