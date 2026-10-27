// Keep this module SQLite-free at link time (store-fence is CLI-reachable).
import { spawnSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// A normal read-only PRAGMA can create WAL/SHM. nolock refuses WAL without
// creating either, but must NEVER run in the host: its VFS close could drop
// locks on another host connection. Isolate the SQLite-only header query in a
// child. It reads no tables, performs no recovery, and never changes the mode.
const probe = `
  const { DatabaseSync } = await import('node:sqlite');
  let db, stage = 'open';
  try {
    db = new DatabaseSync(process.argv[1], { readOnly: true });
    stage = 'query';
    console.log(JSON.stringify({ mode: db.prepare('PRAGMA journal_mode').get().journal_mode }));
  } catch (error) { console.log(JSON.stringify({ stage, code: error.errcode & 255 })); }
  finally { db?.close(); }
`;
// Product transcript: fixed labels and numeric outcomes only. Begin records
// identify a child call whose outcome was lost to interruption or failure.
const observedProbe = `
  const { DatabaseSync } = await import('node:sqlite');
  let db, stage = 'open', value, closeFailed = false;
  const call = (stage, statement, work) => {
    console.log(JSON.stringify({ begin: { stage, statement } }));
    try {
      const result = work();
      console.log(JSON.stringify({ outcome: { stage, statement, ok: true } }));
      return result;
    } catch (error) {
      console.log(JSON.stringify({ outcome: { stage, statement, ok: false,
        extendedCode: Number.isInteger(error.errcode) ? error.errcode : 0 } }));
      throw error;
    }
  };
  try {
    db = call('open', 'connection', () => new DatabaseSync(process.argv[1], { readOnly: true }));
    stage = 'query';
    const query = call('prepare', 'journal_mode', () => db.prepare('PRAGMA journal_mode'));
    value = { mode: call('execute', 'journal_mode', () => query.get()).journal_mode };
  } catch (error) { value = { stage, code: error.errcode & 255 }; }
  finally {
    if (db) try { call('close', 'connection', () => db.close()); }
    catch (error) { closeFailed = true; value = { stage: 'close', code: error.errcode & 255 }; }
  }
  console.log(JSON.stringify({ value, closeFailed }));
`;
// The header cannot change without inode/size/mtime/ctime changing. Bound this
// cache; compare nanosecond stats before AND after probing, never cache errors.
const cache = new Map();
// Metadata only: safe while this process (including Workers) holds SQLite locks.
export const sqliteFileStat = path => lstatSync(path, { bigint: true });
const fingerprint = path => {
  const s = lstatSync(path, { bigint: true });
  return [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].join(':');
};
export function probeRollbackJournal(path, { observe } = {}) {
  if (observe) return observe(() => runProbe(path, true));
  return runProbe(path, false);
}
function runProbe(path, structured) {
  const before = fingerprint(path);
  if (cache.get(path) === before) return structured ? { value: { mode: 'delete' }, events: [], complete: true, cached: true } : { mode: 'delete' };
  const uri = pathToFileURL(path);
  uri.searchParams.set('mode', 'ro'); uri.searchParams.set('nolock', '1');
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', structured ? observedProbe : probe, uri.href], {
    encoding: 'utf8', timeout: 5000, maxBuffer: 4096, env: {},
  });
  if (!structured) {
    if (result.error || result.status !== 0 || result.signal) throw new Error('sqlite_journal_probe_failed');
    const value = JSON.parse(result.stdout);
    if (fingerprint(path) !== before) throw new Error('sqlite_journal_probe_changed');
    if (value.mode === 'delete') {
      if (cache.size >= 64) cache.clear();
      cache.set(path, before);
    }
    return value;
  }
  const events = [];
  let value, closeFailed = false, complete = !result.error && result.status === 0 && !result.signal;
  try {
    for (const line of result.stdout.trim().split('\n')) {
      const event = JSON.parse(line);
      if (event.value) { value = event.value; closeFailed = event.closeFailed === true; }
      else events.push(event);
    }
    complete &&= fingerprint(path) === before && Boolean(value);
  } catch { complete = false; }
  if (complete && !closeFailed && value.mode === 'delete') {
    if (cache.size >= 64) cache.clear();
    cache.set(path, before);
  }
  return { value, events, complete };
}

// Stage and fsync before publication, then link atomically without replacing.
// All descriptors, including the directory fsync, belong to this child.
// A killed child can leave a stage; the next attempt removes only stages whose
// recorded child PID no longer exists. Ordinary creation never replaces a target;
// explicit product repair stages a full successor and uses a verified rename.
const create = `
  import { openSync, closeSync, fstatSync, fsyncSync, linkSync, unlinkSync, readdirSync } from 'node:fs';
  import { lstatSync, renameSync, mkdirSync, rmdirSync } from 'node:fs';
  import { dirname, basename, join } from 'node:path';
  import { randomUUID } from 'node:crypto';
  const target = process.argv[1], directory = dirname(target);
  const prefix = '.' + basename(target) + '.cairn-create-';
  let fd, dir, temporary, repairLock, published = false;
  try {
    if (process.argv[2] === 'replace-product-cache') {
      // One lock for the whole cache, independent of projection, owner and
      // Worker. A killed repair leaves a fail-closed lock for operator recovery.
      if (!target.endsWith('.context-read-product-v1.1.sqlite')) throw Error('unsafe_cache');
      const lock = target + '.repair-lock';
      mkdirSync(lock, { mode: 0o700 }); repairLock = lock;
    }
    for (const name of readdirSync(directory)) {
      if (!name.startsWith(prefix)) continue;
      const suffix = name.slice(prefix.length), dash = suffix.indexOf('-');
      const pid = Number(suffix.slice(0, dash));
      if (dash < 1 || !Number.isSafeInteger(pid) || pid < 1 || !/^[0-9a-f-]{36}$/.test(suffix.slice(dash + 1))) continue;
      try { process.kill(pid, 0); }
      catch (error) {
        if (error.code !== 'ESRCH') continue;
        try { unlinkSync(join(directory, name)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }
    temporary = join(directory, prefix + process.pid + '-' + randomUUID());
    fd = openSync(temporary, 'wx', 0o600);
    const { dev, ino } = fstatSync(fd);
    if (process.argv[4]) {
      // Repair publishes a complete format, so another selection cannot mistake
      // an intermediate empty successor for a damaged cache and replace it.
      const { DatabaseSync } = await import('node:sqlite');
      const init = JSON.parse(process.argv[4]), db = new DatabaseSync(temporary);
      try {
        db.exec('BEGIN IMMEDIATE;' + init.sql);
        db.prepare('INSERT INTO product_metadata VALUES(1,?,?,?,?)').run(init.storeId,init.profile,init.incarnation,'rebuild');
        db.exec('COMMIT');
      } finally { db.close(); }
    }
    fsyncSync(fd);
    closeSync(fd); fd = undefined;
    if (repairLock) {
      // All coordinated replacements hold this lock. Check immediately before
      // rename, in the child; a stale parent observation never removes a winner.
      const current = lstatSync(target, { bigint: true });
      if (!current.isFile() || current.isSymbolicLink() || (current.mode & 0o777n) !== 0o600n ||
          String(current.dev)+':'+String(current.ino) !== process.argv[3]) throw Object.assign(Error('stale_cache'), { code:'ESTALE' });
      renameSync(temporary, target);
    } else { linkSync(temporary, target); }
    published = true;
    if (!repairLock) unlinkSync(temporary); temporary = undefined;
    if (process.platform !== 'win32') {
      try {
        dir = openSync(directory, 'r'); fsyncSync(dir);
      } catch (error) {
        // The target is already published; some filesystems cannot sync directories.
        if (!['EISDIR', 'EPERM', 'EINVAL', 'ENOTSUP'].includes(error.code)) throw error;
      }
      if (dir !== undefined) { closeSync(dir); dir = undefined; }
    }
    console.log(JSON.stringify({ dev, ino }));
  } catch (error) { console.log(JSON.stringify({ error: error.code ?? 'EIO', published })); }
  finally {
    if (fd !== undefined) closeSync(fd);
    if (dir !== undefined) closeSync(dir);
    if (temporary !== undefined) { try { unlinkSync(temporary); } catch {} }
    if (repairLock !== undefined) rmdirSync(repairLock);
  }
`;
export function createExclusiveSqliteFile(path, productReplacement, productInitialization) {
  if (productReplacement) {
    const current = sqliteFileStat(path);
    if (!path.endsWith('.context-read-product-v1.1.sqlite') || !current.isFile() || current.isSymbolicLink() ||
        (current.mode & 0o777n) !== 0o600n || String(current.dev)+':'+String(current.ino) !== productReplacement) throw Error('unsafe_cache');
  }
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', create, path,
    ...(productReplacement ? ['replace-product-cache', productReplacement, ...(productInitialization ? [JSON.stringify(productInitialization)] : [])] : [])], {
    encoding: 'utf8', timeout: 5000, maxBuffer: 4096, env: {},
  });
  if (result.error || result.status !== 0 || result.signal) throw new Error('sqlite_file_creation_failed');
  const value = JSON.parse(result.stdout);
  if (value.error) throw Object.assign(new Error('sqlite_file_creation_failed'), { code: value.error, published: value.published });
  return value;
}
