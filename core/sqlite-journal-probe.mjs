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
// A killed child can leave a stage; generic creation checks owner liveness,
// while product creation cleans stages under its exclusive lifecycle lock.
// Ordinary creation never replaces a target;
// explicit product repair stages a full successor and uses a verified rename.
const create = `
  import { openSync, closeSync, fstatSync, fsyncSync, linkSync, unlinkSync, readdirSync } from 'node:fs';
  import { lstatSync, renameSync, mkdirSync, rmdirSync } from 'node:fs';
  import { dirname, basename, join } from 'node:path';
  import { randomUUID } from 'node:crypto';
  const target = process.argv[1], directory = dirname(target);
  const prefix = '.' + basename(target) + '.cairn-create-';
  let fd, dir, temporary, lifecycle, published = false;
  const replacing = process.argv[2] === 'replace-product-cache';
  const init = process.argv[4] ? JSON.parse(process.argv[4]) : null;
  try {
    if (replacing || init) {
      if (!target.endsWith('.context-read-product-v1.1.sqlite')) throw Error('unsafe_cache');
      const lock = target + '.lifecycle-lock.sqlite';
      try { const pin = openSync(lock, 'wx', 0o600); closeSync(pin); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      const lockStat = lstatSync(lock);
      if (!lockStat.isFile() || lockStat.isSymbolicLink() || (lockStat.mode & 0o777) !== 0o600) throw Error('unsafe_lock');
      const { DatabaseSync } = await import('node:sqlite');
      lifecycle = new DatabaseSync(lock);
      lifecycle.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE');
      if (replacing) {
        const current = lstatSync(target, { bigint: true });
        const stamp = [current.dev,current.ino,current.size,current.mtimeNs,current.ctimeNs].join(':');
        if (init?.expectedStamp && stamp !== init.expectedStamp) throw Object.assign(Error('changed_cache'), { code:'ESTALE' });
        // Re-decide under exclusion, independently of timestamp granularity.
        // A valid incumbent may have been initialized or committed meanwhile.
        // nolock stays in this child; lifecycle exclusion protects all users,
        // and companions are refused before opening the incumbent.
        for (const suffix of ['-journal','-wal','-shm']) {
          try { lstatSync(target + suffix); throw Object.assign(Error('cache_companion'), { code:'EBUSY' }); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
        if (init?.attestation) {
          const { pathToFileURL } = await import('node:url');
          const uri=pathToFileURL(target);uri.searchParams.set('mode','ro');uri.searchParams.set('nolock','1');
          let incumbent, damaged=false;
          try {
            incumbent=new DatabaseSync(uri.href,{readOnly:true});
            const format=init.attestation;
            const rows=incumbent.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
            damaged=incumbent.prepare('PRAGMA application_id').get().application_id!==format.applicationId ||
              incumbent.prepare('PRAGMA user_version').get().user_version!==1 || JSON.stringify(rows)!==JSON.stringify(format.schema);
            if(!damaged){
              const metadata=incumbent.prepare('SELECT * FROM product_metadata WHERE singleton=1').get();
              damaged=!metadata || metadata.store_id!==init.storeId || metadata.profile!==init.profile;
            }
            if(!damaged)damaged=incumbent.prepare('PRAGMA quick_check').get().quick_check!=='ok' || Boolean(incumbent.prepare('PRAGMA foreign_key_check').get());
          } catch(error) {
            if(error.code!=='ERR_SQLITE_ERROR' || ![1,11,14,26].includes(error.errcode&255))throw error;
            damaged=true;
          } finally {incumbent?.close();}
          if(!damaged)throw Object.assign(Error('valid_cache'),{code:'ESTALE'});
        }
      }
    }
    for (const name of readdirSync(directory)) {
      if (!name.startsWith(prefix)) continue;
      const suffix = name.slice(prefix.length), dash = suffix.indexOf('-');
      const pid = Number(suffix.slice(0, dash));
      if (dash < 1 || !Number.isSafeInteger(pid) || pid < 1 || !/^[0-9a-f-]{36}(?:-journal|-wal|-shm)?$/.test(suffix.slice(dash + 1))) continue;
      try { if (lifecycle) throw Object.assign(Error('exclusive stages'), { code:'ESRCH' }); process.kill(pid, 0); }
      catch (error) {
        if (error.code !== 'ESRCH') continue;
        try { unlinkSync(join(directory, name)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }
    temporary = join(directory, prefix + process.pid + '-' + randomUUID());
    fd = openSync(temporary, 'wx', 0o600);
    const { dev, ino } = fstatSync(fd);
    if (init) {
      // Repair publishes a complete format, so another selection cannot mistake
      // an intermediate empty successor for a damaged cache and replace it.
      const { DatabaseSync } = await import('node:sqlite');
      const db = new DatabaseSync(temporary);
      try {
        if (init.journalMode !== undefined) {
          if (!['DELETE','WAL'].includes(init.journalMode)) throw Error('unsafe_journal_mode');
          db.exec('PRAGMA journal_mode=' + init.journalMode);
        }
        db.exec('BEGIN IMMEDIATE;' + init.sql);
        db.prepare('INSERT INTO product_metadata VALUES(1,?,?,?,?)').run(init.storeId,init.profile,init.incarnation,replacing ? 'rebuild' : 'initial');
        db.exec('COMMIT');
      } finally { db.close(); }
    }
    fsyncSync(fd);
    closeSync(fd); fd = undefined;
    if (replacing) {
      // All coordinated replacements hold this lock. Check immediately before
      // rename, in the child; a stale parent observation never removes a winner.
      const current = lstatSync(target, { bigint: true });
      if (!current.isFile() || current.isSymbolicLink() || (current.mode & 0o777n) !== 0o600n ||
          String(current.dev)+':'+String(current.ino) !== process.argv[3]) throw Object.assign(Error('stale_cache'), { code:'ESTALE' });
      // No coordinated transaction can start while the exclusive lifecycle lock
      // is held. Refuse even a hot journal left by a dead ordinary writer.
      for (const suffix of ['-journal','-wal','-shm']) {
        try { lstatSync(target + suffix); throw Object.assign(Error('cache_companion'), { code:'EBUSY' }); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      renameSync(temporary, target);
    } else { linkSync(temporary, target); }
    published = true;
    if (!replacing) unlinkSync(temporary); temporary = undefined;
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
  } catch (error) { console.log(JSON.stringify({ error: error.code ?? 'EIO', errcode: Number.isInteger(error.errcode) ? error.errcode : null, published })); }
  finally {
    if (fd !== undefined) closeSync(fd);
    if (dir !== undefined) closeSync(dir);
    if (temporary !== undefined) { try { unlinkSync(temporary); } catch {} }
    lifecycle?.close();
  }
`;
export function createExclusiveSqliteFile(path, productReplacement, productInitialization) {
  if (productReplacement) {
    const current = sqliteFileStat(path);
    if (!path.endsWith('.context-read-product-v1.1.sqlite') || !current.isFile() || current.isSymbolicLink() ||
        (current.mode & 0o777n) !== 0o600n || String(current.dev)+':'+String(current.ino) !== productReplacement) throw Error('unsafe_cache');
  }
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', create, path,
    ...(productReplacement || productInitialization ? [productReplacement ? 'replace-product-cache' : 'initialize-product-cache', productReplacement ?? '', ...(productInitialization ? [JSON.stringify(productInitialization)] : [])] : [])], {
    encoding: 'utf8', timeout: 5000, maxBuffer: 4096, env: {},
  });
  if (result.error || result.status !== 0 || result.signal) throw new Error('sqlite_file_creation_failed');
  const value = JSON.parse(result.stdout);
  if (value.error) throw Object.assign(new Error('sqlite_file_creation_failed'), { code: Number.isInteger(value.errcode) ? 'ERR_SQLITE_ERROR' : value.error, ...(Number.isInteger(value.errcode) ? {errcode:value.errcode} : {}), published: value.published });
  return value;
}
