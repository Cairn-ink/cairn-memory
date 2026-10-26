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
  let db;
  try {
    db = new DatabaseSync(process.argv[1], { readOnly: true });
    console.log(JSON.stringify({ mode: db.prepare('PRAGMA journal_mode').get().journal_mode }));
  } catch (error) { console.log(JSON.stringify({ code: error.errcode & 255 })); }
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

// O_EXCL protects against opening an existing inode, but another Worker can
// open a just-created inode before the creation fd closes. Keep even this
// close outside the host process. No file contents are read or written here.
const create = `
  import { openSync, closeSync, fstatSync, fsyncSync } from 'node:fs';
  let fd;
  try {
    fd = openSync(process.argv[1], 'wx', 0o600);
    const { dev, ino } = fstatSync(fd); fsyncSync(fd);
    console.log(JSON.stringify({ dev, ino }));
  } catch (error) { console.log(JSON.stringify({ error: error.code })); }
  finally { if (fd !== undefined) closeSync(fd); }
`;
export function createExclusiveSqliteFile(path) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', create, path], {
    encoding: 'utf8', timeout: 5000, maxBuffer: 4096, env: {},
  });
  if (result.error || result.status !== 0 || result.signal) throw new Error('sqlite_file_creation_failed');
  const value = JSON.parse(result.stdout);
  if (value.error) throw Object.assign(new Error('sqlite_file_creation_failed'), { code: value.error });
  return value;
}
