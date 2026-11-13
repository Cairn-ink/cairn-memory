import assert from 'node:assert/strict';
import sqlite from 'node:sqlite';
import childProcess from 'node:child_process';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { pathToFileURL } from 'node:url';

// Node 22 does not synchronize node:sqlite's named constructor export. Load
// application modules only after this hook: their SQLite imports receive this
// forwarding constructor, while all application statements run unchanged.
// The default export is patched as well for default-import constructor users.
export const sqliteDefault = sqlite;
let activeCalls;
export const SpiedDatabaseSync = new Proxy(sqlite.DatabaseSync, {
  construct(target, args, newTarget) {
    activeCalls?.push({ kind: 'in-process', args });
    return Reflect.construct(target, args, newTarget);
  },
});
const binding = 'data:text/javascript,' + encodeURIComponent(
  `export { SpiedDatabaseSync as DatabaseSync, sqliteDefault as default } from ${JSON.stringify(import.meta.url)};`);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'node:sqlite' && context.parentURL !== import.meta.url)
      return { url: binding, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

// Exact child programs are deliberate expectations, not imported from the
// implementation: changing their open flags or adding an open must fail here.
const sqliteProbe = `
  const { DatabaseSync } = await import('node:sqlite');
  let db, stage = 'open';
  try {
    db = new DatabaseSync(process.argv[1], { readOnly: true });
    stage = 'query';
    console.log(JSON.stringify({ mode: db.prepare('PRAGMA journal_mode').get().journal_mode }));
  } catch (error) { console.log(JSON.stringify({ stage, code: error.errcode & 255 })); }
  finally { db?.close(); }
`;
const headerProbe = `
      import { openSync, readSync, closeSync, fstatSync, constants } from 'node:fs';
      let fd;
      try {
        fd = openSync(process.argv[1], constants.O_RDONLY | constants.O_NOFOLLOW);
        const opened = fstatSync(fd, { bigint: true });
        const header = Buffer.alloc(20), length = readSync(fd, header, 0, 20, 0);
        process.stdout.write(JSON.stringify({ device: String(opened.dev), inode: String(opened.ino),
          mode: length === 20 && header.subarray(0,16).equals(Buffer.from('SQLite format 3\\0')) &&
          header[18] === 1 && header[19] === 1 ? 'delete' : 'other' }));
      } finally { if (fd !== undefined) closeSync(fd); }
    `;
const options = maxBuffer => ({ encoding: 'utf8', env: {}, timeout: 5000, maxBuffer });
export const sqliteHeaderCall = path => {
  const uri = pathToFileURL(path);
  uri.searchParams.set('mode', 'ro'); uri.searchParams.set('nolock', '1');
  return { kind: 'child', command: process.execPath,
    args: ['--input-type=module', '-e', sqliteProbe, uri.href], options: options(4096) };
};
export const rawHeaderCall = path => ({ kind: 'child', command: process.execPath,
  args: ['--input-type=module', '-e', headerProbe, path], options: options(1024) });
export const refusalCall = error => ({ kind: 'refusal', ...error });

// Scope both builtin patches to one synchronous operation. Record every child,
// not just recognized probes, and every constructor before delegating. Record
// refusals in the same transcript so an early open cannot hide behind a catch.
export function sqliteOpenSpy(work, { failProbeOpen = false, beforeHeader } = {}) {
  const originalDatabase = sqlite.DatabaseSync, originalSpawn = childProcess.spawnSync, calls = [];
  assert.equal(activeCalls, undefined, 'open spies must not overlap');
  activeCalls = calls;
  sqlite.DatabaseSync = SpiedDatabaseSync;
  childProcess.spawnSync = (command, args, options) => {
    calls.push({ kind: 'child', command, args: [...args], options: { ...options } });
    if (args[2] === headerProbe) beforeHeader?.();
    if (failProbeOpen && args[2] === sqliteProbe) {
      args = args.map((arg, i) => i === 2 ? arg.replace(
        'new DatabaseSync(process.argv[1], { readOnly: true })',
        "(() => { throw Object.assign(new Error('unreadable'), { errcode: 14 }); })()") : arg);
    }
    return originalSpawn(command, args, options);
  };
  syncBuiltinESMExports();
  try { return { result: work(calls), calls }; }
  finally {
    activeCalls = undefined;
    sqlite.DatabaseSync = originalDatabase; childProcess.spawnSync = originalSpawn;
    syncBuiltinESMExports();
  }
}
export function refusesWithoutOpens(work, error, allowed = [], options) {
  const { calls } = sqliteOpenSpy(calls => {
    assert.throws(() => {
      try { work(); }
      catch (caught) {
        calls.push(refusalCall({ code: caught.code, ...(caught.reason ? { reason: caught.reason } : {}) }));
        throw caught;
      }
    }, error);
  }, options);
  assert.deepEqual(calls, [...allowed, refusalCall(error)], 'exact opens before refusal');
  return calls;
}
