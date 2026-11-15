// Threat model (Node 22.16 / 24.22): bootstrap precedes application imports;
// activation covers a synchronous callback. Shared prototypes cover connections,
// statements, methods and tag stores cached at initialization, including callers'
// already-open canonical handles. Ordinary queries keep their exact transcripts.
//
// File-opening/writing APIs: DatabaseSync construction records its arguments;
// DatabaseSync.open records even for a cached { open: false } instance. exec,
// prepare and StatementSync.run/get/all/iterate refuse file-capable SQL; Node 24
// SQLTagStore.run/get/all/iterate do likewise, including iterator creation before
// activation and next() inside it. backup (module export, no database method on
// either Node) refuses before starting asynchronous work. loadExtension and
// enableLoadExtension refuse; so does SQL load_extension, even on a connection
// whose extensions were enabled earlier. applyChangeset refuses (writes existing
// databases and can create journals). SQL writes, ATTACH, all VACUUM
// (also its temporary database) refuse. A single-pass SQLite lexer separates
// bare tokens, quoted identifiers, strings and comments across all statements;
// only bare tokens participate in keyword detection. Quoted load_extension
// calls are separately recognized as the loader API. PRAGMAs refuse by default:
// only the read forms in allowedPragma and the exact connection-local settings
// in connectionPragmas delegate. Schema quoting does not change that allowlist.
// This is conservative token detection, not a full SQL grammar/authorizer;
// matching bare identifiers may falsely refuse. Implicit read I/O is below.
//
// Cannot independently open files: function/aggregate/setAuthorizer register JS
// callbacks; enableDefensive changes a flag; createSession tracks an existing
// database; Session.changeset/patchset return memory, close/dispose release it.
// serialize returns memory; deserialize replaces a schema with in-memory bytes.
// location/isOpen/isTransaction/limits and StatementSync sourceSQL/expandedSQL,
// columns, setAllowBareNamedParameters, setAllowUnknownNamedParameters,
// setReadBigInts, setReturnArrays, and SQLTagStore size/capacity/db/clear inspect
// metadata/configuration. Iterator.return resets an existing statement.
// close/dispose release existing handles (may finish existing transactions). StatementSync/Session/SQLTagStore constructors are
// illegal directly; SQLTagStore is not exported. constants and module branding
// are data only. createTagStore allocates a cache; its execution APIs are above.
// Node 22 also implements StatementSync.setReturnArrays, omitted in its docs.
//
// Out of scope: SQLite's implicit I/O on already-open databases during ordinary
// reads (recovery, temp spills, virtual tables), finishing existing transactions
// on close/COMMIT/ROLLBACK, work started before activation (including backup),
// and arbitrary I/O in preinstalled native extensions or JS callbacks.
// Nested calls through the patched APIs remain covered. These are not an OS I/O
// monitor. Named/namespace/default/cached/dynamic/createRequire/getBuiltinModule
// and constructor aliases, every child_process launch API, and Worker are covered.
// Deliberate evasion via native addons, vm contexts, process.binding/internal
// bindings, inspector or other processes remains outside the guarantee.
import assert from 'node:assert/strict';
import sqlite from 'node:sqlite';
import childProcess from 'node:child_process';
import workerThreads from 'node:worker_threads';
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
// Patch before application imports so aliases of methods also keep forwarding.
const databasePrototype = sqlite.DatabaseSync.prototype;
const statementPrototype = sqlite.StatementSync.prototype;
const refusedSQLite = api => Object.assign(new Error(`open spy refuses SQLite file operation: ${api}`),
  { code: 'open_spy_sqlite_file_refused' });
function refuseSQLite(api, sql) {
  if (!active) return;
  active.calls.push({ kind: 'refused-sqlite', api, ...(sql === undefined ? {} : { sql }) });
  throw refusedSQLite(api);
}
function forwardMethod(prototype, api, check) {
  const original = prototype[api];
  prototype[api] = function (...args) {
    if (active) check.call(this, args);
    return Reflect.apply(original, this, args);
  };
}
// One scan gives comments, literals and identifiers their SQLite boundaries.
// In particular, comment delimiters inside any quoted token are just contents.
function lexSQL(sql) {
  const tokens = [];
  for (let i = 0; i < sql.length;) {
    const c = sql[i], next = sql[i + 1];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '-' && next === '-') {
      i += 2;
      while (i < sql.length && sql[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i = Math.min(i + 2, sql.length);
      continue;
    }
    if (c === "'" || c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c;
      let value = '', closed = false;
      i++;
      while (i < sql.length) {
        if (sql[i] === close) {
          i++;
          if (c !== '[' && sql[i] === close) { value += close; i++; continue; }
          closed = true;
          break;
        }
        value += sql[i++];
      }
      tokens.push({ kind: closed ? (c === "'" ? 'string' : 'identifier') : 'invalid',
        value: value.toLowerCase() });
      continue;
    }
    if (/[a-z_\u0080-\uffff]/i.test(c)) {
      const start = i++;
      while (i < sql.length && /[a-z_0-9$\u0080-\uffff]/i.test(sql[i])) i++;
      tokens.push({ kind: 'bare', value: sql.slice(start, i).toLowerCase() });
      continue;
    }
    if (/[0-9]/.test(c)) {
      const start = i++;
      while (i < sql.length && /[0-9]/.test(sql[i])) i++;
      tokens.push({ kind: 'number', value: sql.slice(start, i) });
      continue;
    }
    tokens.push({ kind: 'symbol', value: c });
    i++;
  }
  return tokens;
}
const namedToken = token => token && ['bare', 'identifier', 'string'].includes(token.kind);
const symbol = (token, value) => token?.kind === 'symbol' && token.value === value;
// Derived from the pinned probe/sidecar reads, database/facade/fence metadata reads and
// ordinary-read controls. No unknown PRAGMA or persistent assignment delegates.
const readPragmas = new Set(['journal_mode', 'application_id', 'user_version', 'foreign_key_check', 'query_only']);
const tablePragmas = new Set(['table_info']);
const connectionPragmas = new Map([
  ['foreign_keys', ['on']], ['trusted_schema', ['off']],
  ['busy_timeout', ['5000']], ['query_only', ['on', 'off']],
]);
function allowedPragma(tokens) {
  let i = 0;
  if (!namedToken(tokens[i])) return false;
  // Schema names have no word-character restriction, regardless of quoting.
  if (symbol(tokens[i + 1], '.')) i += 2;
  if (!namedToken(tokens[i])) return false;
  const name = tokens[i++].value, args = tokens.slice(i);
  if (readPragmas.has(name) && args.length === 0) return true;
  if (name === 'quick_check') return args.length === 0 ||
    (args.length === 3 && symbol(args[0], '(') &&
      args[1].kind === 'number' && args[1].value === '1' && symbol(args[2], ')'));
  if (tablePragmas.has(name)) return args.length === 3 && symbol(args[0], '(') &&
    namedToken(args[1]) && symbol(args[2], ')');
  // The existing read-only opener also sets these connection-local flags.
  // Admit only the exact forms it and the read controls use, never disk writes.
  return args.length === 2 && symbol(args[0], '=') &&
    ['bare', 'number', 'string', 'identifier'].includes(args[1].kind) &&
    (connectionPragmas.get(name)?.includes(args[1].value) ?? false);
}
const fileKeywords = new Set(['attach', 'vacuum', 'load_extension', 'insert', 'update',
  'delete', 'create', 'drop', 'alter', 'reindex', 'analyze']);
function fileSQL(sql) {
  if (typeof sql !== 'string') return false;
  const tokens = lexSQL(sql);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i], next = tokens[i + 1];
    // A quoted function name is not a keyword, but still names the loader API.
    if (namedToken(token) && token.value === 'load_extension' && symbol(next, '(')) return true;
    if (token.kind !== 'bare') continue;
    if (fileKeywords.has(token.value)) return true;
    if (token.value === 'replace' && !symbol(next, '(')) return true;
    if (token.value === 'begin' && next?.kind === 'bare' &&
        ['immediate', 'exclusive'].includes(next.value)) return true;
    // Inspect every PRAGMA in every statement; incomplete/unknown forms refuse.
    if (token.value === 'pragma') {
      let end = i + 1;
      while (end < tokens.length && !symbol(tokens[end], ';')) end++;
      if (!allowedPragma(tokens.slice(i + 1, end))) return true;
      i = end;
    }
  }
  return false;
}
const checkSQL = (api, sql) => { if (fileSQL(sql)) refuseSQLite(api, sql); };
forwardMethod(databasePrototype, 'open', () => active.calls.push({ kind: 'sqlite-open', api: 'open' }));
for (const api of ['loadExtension', 'enableLoadExtension', 'applyChangeset'])
  forwardMethod(databasePrototype, api, () => refuseSQLite(api));
for (const api of ['exec', 'prepare'])
  forwardMethod(databasePrototype, api, ([sql]) => checkSQL(api, sql));
for (const api of ['run', 'get', 'all', 'iterate'])
  forwardMethod(statementPrototype, api, function () { checkSQL(`StatementSync.${api}`, this.sourceSQL); });
// An iterator can be created while inactive and stepped while active. Its shared
// native next() must consult the statement's SQL on each step as well.
const iteratorSQL = new WeakMap();
function guardIterator(iterator, sql) {
  const prototype = Object.getPrototypeOf(iterator);
  if (!guardedIterators.has(prototype)) {
    forwardMethod(prototype, 'next', function () { checkSQL('iterator.next', iteratorSQL.get(this)); });
    guardedIterators.add(prototype);
  }
  iteratorSQL.set(iterator, sql);
  return iterator;
}
const guardedIterators = new WeakSet();
const originalIterate = statementPrototype.iterate;
statementPrototype.iterate = function (...args) {
  return guardIterator(Reflect.apply(originalIterate, this, args), this.sourceSQL);
};
// SQLTagStore is not exported, and native prototypes differ between stores.
// Guard every store at creation, including stores cached before activation.
if (databasePrototype.createTagStore) {
  const create = databasePrototype.createTagStore;
  databasePrototype.createTagStore = function (...parameters) {
    const store = Reflect.apply(create, this, parameters);
    const prototype = Object.getPrototypeOf(store);
    for (const api of ['run', 'get', 'all', 'iterate']) {
      const original = prototype[api];
      prototype[api] = function (strings, ...args) {
        const sql = Array.isArray(strings) ? strings.join('?') : undefined;
        if (active) checkSQL(`SQLTagStore.${api}`, sql);
        const result = Reflect.apply(original, this, [strings, ...args]);
        return api === 'iterate' ? guardIterator(result, sql) : result;
      };
    }
    return store;
  };
}
const originalBackup = sqlite.backup;
export const SpiedBackup = function (...args) {
  if (active) refuseSQLite('backup');
  return Reflect.apply(originalBackup, this, args);
};
sqlite.backup = SpiedBackup;

sqlite.DatabaseSync = SpiedDatabaseSync;
Object.defineProperty(SpiedDatabaseSync.prototype, 'constructor', { value: SpiedDatabaseSync });
// Node 22 does not synchronize node:sqlite's named constructor export. ESM
// receives an explicit forwarding export; createRequire receives the patched
// builtin object. Preserve the other SQLite exports on both routes.
const binding = 'data:text/javascript,' + encodeURIComponent(
  `export * from 'node:sqlite'; export { SpiedDatabaseSync as DatabaseSync, SpiedBackup as backup, sqliteDefault as default } from ${JSON.stringify(import.meta.url)};`);
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
const refusedWorker = () => Object.assign(new Error('open spy refuses worker launch'),
  { code: 'open_spy_worker_launch_refused' });
workerThreads.Worker = new Proxy(workerThreads.Worker, {
  construct(target, args, newTarget) {
    if (active) {
      active.calls.push({ kind: 'refused-worker', api: 'Worker' });
      throw refusedWorker();
    }
    return Reflect.construct(target, args, newTarget);
  },
});
Object.defineProperty(workerThreads.Worker.prototype, 'constructor', { value: workerThreads.Worker });
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
    if (calls.some(call => call.kind === 'refused-worker')) throw refusedWorker();
    const sqliteRefusal = calls.find(call => call.kind === 'refused-sqlite');
    if (sqliteRefusal) throw refusedSQLite(sqliteRefusal.api);
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
