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
// The header cannot change without inode/size/mtime/ctime changing. Bound this
// cache; compare nanosecond stats before AND after probing, never cache errors.
const cache = new Map();
const fingerprint = path => {
  const s = lstatSync(path, { bigint: true });
  return [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].join(':');
};
export function probeRollbackJournal(path) {
  const before = fingerprint(path);
  if (cache.get(path) === before) return { mode: 'delete' };
  const uri = pathToFileURL(path);
  uri.searchParams.set('mode', 'ro'); uri.searchParams.set('nolock', '1');
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe, uri.href], {
    encoding: 'utf8', timeout: 5000, maxBuffer: 4096, env: {},
  });
  if (result.error || result.status !== 0 || result.signal) throw new Error('sqlite_journal_probe_failed');
  const value = JSON.parse(result.stdout);
  if (fingerprint(path) !== before) throw new Error('sqlite_journal_probe_changed');
  if (value.mode === 'delete') {
    if (cache.size >= 64) cache.clear();
    cache.set(path, before);
  }
  return value;
}

// Stage and fsync before publication, then link atomically without replacing.
// All descriptors, including the directory fsync, belong to this child.
// A killed child can leave a stage; the next attempt removes only stages whose
// recorded child PID no longer exists. Published targets are NEVER removed.
const create = `
  import { openSync, closeSync, fstatSync, fsyncSync, linkSync, unlinkSync, readdirSync } from 'node:fs';
  import { dirname, basename, join } from 'node:path';
  import { randomUUID } from 'node:crypto';
  const target = process.argv[1], directory = dirname(target);
  const prefix = '.' + basename(target) + '.cairn-create-';
  let fd, dir, temporary, published = false;
  try {
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
    const { dev, ino } = fstatSync(fd); fsyncSync(fd);
    closeSync(fd); fd = undefined;
    linkSync(temporary, target); published = true;
    unlinkSync(temporary); temporary = undefined;
    dir = openSync(directory, 'r'); fsyncSync(dir);
    closeSync(dir); dir = undefined;
    console.log(JSON.stringify({ dev, ino }));
  } catch (error) { console.log(JSON.stringify({ error: error.code ?? 'EIO', published })); }
  finally {
    if (fd !== undefined) closeSync(fd);
    if (dir !== undefined) closeSync(dir);
    if (temporary !== undefined) { try { unlinkSync(temporary); } catch {} }
  }
`;
export function createExclusiveSqliteFile(path) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', create, path], {
    encoding: 'utf8', timeout: 5000, maxBuffer: 4096, env: {},
  });
  if (result.error || result.status !== 0 || result.signal) throw new Error('sqlite_file_creation_failed');
  const value = JSON.parse(result.stdout);
  if (value.error) throw Object.assign(new Error('sqlite_file_creation_failed'), { code: value.error, published: value.published });
  return value;
}
