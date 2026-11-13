import assert from 'node:assert/strict';
import sqlite from 'node:sqlite';
import childProcess from 'node:child_process';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { pathToFileURL } from 'node:url';

// Install forwarding bindings before dynamically importing application modules.
// They stay worker-scoped, so even module-initialization aliases delegate through
// the active spy. Outside an operation they call the original builtins unchanged.
export const sqliteDefault = sqlite;
let active;
export const SpiedDatabaseSync = new Proxy(sqlite.DatabaseSync, {
  construct(target, args, newTarget) {
    active?.calls.push({ kind: 'in-process', args });
    return Reflect.construct(target, args, newTarget);
  },
});
sqlite.DatabaseSync = SpiedDatabaseSync;
// Node 22 does not synchronize node:sqlite's named constructor export. ESM
// receives an explicit forwarding export; createRequire receives the patched
// builtin object. Preserve the other SQLite exports on both routes.
const binding = 'data:text/javascript,' + encodeURIComponent(
  `export * from 'node:sqlite'; export { SpiedDatabaseSync as DatabaseSync, sqliteDefault as default } from ${JSON.stringify(import.meta.url)};`);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'node:sqlite' &&
        context.parentURL !== import.meta.url && context.parentURL !== binding &&
        ![...context.conditions].includes('require'))
      return { url: binding, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const refusedChild = api => Object.assign(new Error(`open spy refuses child launch: ${api}`),
  { code: 'open_spy_child_launch_refused' });
for (const api of ['spawnSync', 'spawn', 'execFileSync', 'execFile', 'execSync', 'exec', 'fork']) {
  const original = childProcess[api];
  childProcess[api] = (...parameters) => {
    if (!active) return Reflect.apply(original, childProcess, parameters);
    const { calls, failProbeOpen, beforeHeader } = active;
    if (api !== 'spawnSync') {
      calls.push({ kind: 'refused-child', api });
      throw refusedChild(api);
    }
    const [command, args, options] = parameters;
    calls.push({ kind: 'child', command,
      args: Array.isArray(args) ? [...args] : args, options: { ...options } });
    if (Array.isArray(args)) {
      if (args[2] === headerProbe) beforeHeader?.();
      if (failProbeOpen && args[2] === sqliteProbe) {
        parameters[1] = args.map((arg, i) => i === 2 ? arg.replace(
          'new DatabaseSync(process.argv[1], { readOnly: true })',
          "(() => { throw Object.assign(new Error('unreadable'), { errcode: 14 }); })()") : arg);
      }
    }
    return Reflect.apply(original, childProcess, parameters);
  };
}
syncBuiltinESMExports();

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

// Only recording is scoped to the synchronous operation; forwarding bindings
// remain installed for cached aliases. A swallowed unsupported-launch error must
// still fail the operation, and overlapping spies are refused.
export function sqliteOpenSpy(work, { failProbeOpen = false, beforeHeader } = {}) {
  assert.equal(active, undefined, 'open spies must not overlap');
  const calls = [];
  active = { calls, failProbeOpen, beforeHeader };
  try {
    const result = work(calls);
    const refused = calls.find(call => call.kind === 'refused-child');
    if (refused) throw refusedChild(refused.api);
    return { result, calls };
  } finally { active = undefined; }
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
