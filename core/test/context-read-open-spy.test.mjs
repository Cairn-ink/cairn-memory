import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { sqliteOpenSpy, SpiedDatabaseSync } from '../testing/context-read-open-spy.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const { databaseOpens, databaseBindings, backupBindings, childLaunches, workerLaunches } =
  await import('../testing/context-read-open-patterns.mjs');

test('every SQLite acquisition route records a real read-only open', t => {
  const workspace = createTestWorkspace(t, { prefix: 'open-spy-control-' });
  const path = join(workspace.path, 'synthetic.sqlite');
  const db = new SpiedDatabaseSync(path);
  db.exec("CREATE TABLE synthetic_control(value TEXT); INSERT INTO synthetic_control VALUES('synthetic');");
  db.close();
  assert.equal(SpiedDatabaseSync.prototype.constructor, SpiedDatabaseSync);
  assert.equal(db.constructor, SpiedDatabaseSync);
  for (const binding of databaseBindings) assert.equal(binding, SpiedDatabaseSync);
  for (const [pattern, open] of Object.entries(databaseOpens)) {
    const { result, calls } = sqliteOpenSpy(() => open(path));
    assert.equal(result, 'synthetic', pattern);
    assert.deepEqual(calls, [{ kind: 'in-process', args: [path, { readOnly: true }] }], pattern);
  }
  assert.throws(() => sqliteOpenSpy(() => { throw new Error('synthetic failure'); }), /synthetic failure/);
  assert.equal(databaseOpens['cached-default'](path), 'synthetic', 'outside-spy delegation after failure');
  assert.equal(sqliteOpenSpy(() => databaseOpens['cached-default'](path)).calls.length, 1);
});

test('spawnSync records every acquisition route', () => {
  const args = ['--input-type=module', '-e', "process.stdout.write('synthetic')"];
  const options = { encoding: 'utf8', env: {}, timeout: 5000, maxBuffer: 4096 };
  for (const [pattern, launches] of Object.entries(childLaunches)) {
    const { result, calls } = sqliteOpenSpy(() => launches.spawnSync(process.execPath, args, options));
    assert.equal(result.status, 0, pattern);
    assert.equal(result.stdout, 'synthetic', pattern);
    assert.deepEqual(calls, [{ kind: 'child', command: process.execPath, args, options }], pattern);
  }
});

test('Worker refuses every alias before launch, even if caught, then delegates outside the spy', async () => {
  const source = "require('node:worker_threads').parentPort.postMessage('synthetic')";
  for (const [pattern, Worker] of Object.entries(workerLaunches)) {
    let calls;
    assert.throws(() => sqliteOpenSpy(transcript => {
      calls = transcript;
      new Worker(source, { eval: true });
    }), { code: 'open_spy_worker_launch_refused' }, pattern);
    assert.deepEqual(calls, [{ kind: 'refused-worker', api: 'Worker' }], pattern);
    assert.throws(() => sqliteOpenSpy(transcript => {
      calls = transcript;
      try { new Worker(source, { eval: true }); } catch {}
    }), { code: 'open_spy_worker_launch_refused' }, `caught ${pattern}`);
    assert.deepEqual(calls, [{ kind: 'refused-worker', api: 'Worker' }], `caught ${pattern}`);
  }
  assert.deepEqual(sqliteOpenSpy(() => 'restored').calls, []);
  const worker = new workerLaunches['cached-default'](source, { eval: true });
  assert.equal(worker.constructor, workerLaunches['cached-default']);
  let message;
  worker.on('message', value => { message = value; });
  const exit = await new Promise((resolve, reject) => {
    worker.once('error', reject);
    worker.once('exit', resolve);
  });
  assert.equal(exit, 0);
  assert.equal(message, 'synthetic');
  assert.deepEqual(sqliteOpenSpy(() => 'restored after worker').calls, []);
});

test('all other child launches refuse through every alias, even if caught', () => {
  for (const [pattern, launches] of Object.entries(childLaunches)) {
    for (const api of ['spawn', 'execFileSync', 'execFile', 'execSync', 'exec', 'fork']) {
      let calls;
      assert.throws(() => sqliteOpenSpy(transcript => {
        calls = transcript;
        launches[api](process.execPath, ['--eval', "throw new Error('must not launch')"]);
      }), { code: 'open_spy_child_launch_refused' }, `${pattern}.${api}`);
      assert.deepEqual(calls, [{ kind: 'refused-child', api }], `${pattern}.${api}`);
      assert.throws(() => sqliteOpenSpy(() => {
        try { launches[api](process.execPath); } catch {}
      }), { code: 'open_spy_child_launch_refused' }, `caught ${pattern}.${api}`);
    }
  }
  assert.deepEqual(sqliteOpenSpy(() => 'restored').calls, []);
  assert.equal(childLaunches['cached-default'].spawnSync(process.execPath,
    ['--eval', ''], { env: {}, timeout: 5000 }).status, 0, 'outside-spy delegation after refusal');
});

// These connections and method aliases exist before any active callback.
const sqlite = await import('node:sqlite');
const preopened = new sqlite.DatabaseSync(':memory:');
const deferredWorkspace = createTestWorkspace(null, { prefix: 'open-spy-deferred-' });
const deferredPath = join(deferredWorkspace.path, 'synthetic-deferred.sqlite');
const deferred = new sqlite.DatabaseSync(deferredPath, { open: false });
const cachedOpen = deferred.open;
const cachedExec = preopened.exec;
const cachedPrepare = preopened.prepare;
const cachedRun = sqlite.StatementSync.prototype.run;
const backupAliases = backupBindings;
const cachedStatements = Object.fromEntries(['run', 'get', 'all', 'iterate'].map(api =>
  [api, preopened.prepare('ATTACH DATABASE ? AS synthetic_attached')]));
const cachedVacuum = preopened.prepare('VACUUM INTO ?');
const deferredIterator = preopened.prepare('ATTACH DATABASE ? AS synthetic_iterator').iterate(':memory:');
const cachedTagStore = preopened.createTagStore?.();
const cachedTagRun = cachedTagStore?.run;

test('deferred open cached at initialization is recorded and delegates outside activation', t => {
  t.after(deferredWorkspace.cleanup);
  assert.equal(existsSync(deferredPath), false);
  const { calls } = sqliteOpenSpy(() => cachedOpen.call(deferred));
  assert.deepEqual(calls, [{ kind: 'sqlite-open', api: 'open' }]);
  assert.equal(existsSync(deferredPath), true);
  assert.equal(deferred.prepare('SELECT 42 AS n').get().n, 42);
  deferred.close();
  deferred.open();
  assert.equal(sqliteOpenSpy(() => deferred.prepare('SELECT 42 AS n').get()).result.n, 42);
  deferred.close();
});

function refusesSQLite(work, api, sql) {
  let calls;
  assert.throws(() => sqliteOpenSpy(transcript => { calls = transcript; work(); }),
    { code: 'open_spy_sqlite_file_refused' }, api);
  assert.deepEqual(calls, [{ kind: 'refused-sqlite', api, ...(sql === undefined ? {} : { sql }) }]);
  assert.throws(() => sqliteOpenSpy(() => { try { work(); } catch {} }),
    { code: 'open_spy_sqlite_file_refused' }, `swallowed ${api}`);
}

test('SQL file operations refuse on preopened connections and initialization-cached statements', t => {
  const workspace = createTestWorkspace(t, { prefix: 'open-spy-sql-' });
  const target = join(workspace.path, 'synthetic-output.sqlite');
  const literal = target.replaceAll("'", "''");
  const attach = `ATTACH /* synthetic comment */ DATABASE '${literal}' AS synthetic_exec`;
  refusesSQLite(() => cachedExec.call(preopened, attach), 'exec', attach);
  const sql = 'ATTACH DATABASE ? AS synthetic_attached';
  refusesSQLite(() => cachedPrepare.call(preopened, sql), 'prepare', sql);
  for (const api of ['run', 'get', 'all', 'iterate'])
    refusesSQLite(() => cachedStatements[api][api](target), `StatementSync.${api}`, sql);
  refusesSQLite(() => cachedRun.call(cachedStatements.run, target), 'StatementSync.run', sql);
  refusesSQLite(() => cachedVacuum.run(target), 'StatementSync.run', 'VACUUM INTO ?');
  refusesSQLite(() => deferredIterator.next(), 'iterator.next', 'ATTACH DATABASE ? AS synthetic_iterator');
  for (const sql of ["VACUUM", "BEGIN IMMEDIATE", "BEGIN EXCLUSIVE", "PRAGMA journal_mode=WAL", 'PRAGMA "main"."journal_mode"(WAL)', "PRAGMA 'journal_mode'=WAL",
    "PRAGMA wal_checkpoint", "PRAGMA optimize",
    "CREATE TEMP TABLE synthetic_temp(n)", "INSERT INTO synthetic_temp VALUES(1)",
    "SELECT load_extension(?)", 'SELECT "load_extension"(?)'])
    refusesSQLite(() => preopened.exec(sql), 'exec', sql);
  assert.equal(existsSync(target), false, 'no refused destination was opened');
  // Read-only SQL, connection flags, strings and comments containing keywords
  // must keep the pinned callers' transcripts empty.
  const ordinary = sqliteOpenSpy(() => {
    preopened.exec('PRAGMA query_only=ON');
    preopened.exec('BEGIN');
    const row = preopened.prepare("SELECT 'ATTACH VACUUM INSERT' AS value /* ATTACH */").get();
    preopened.prepare('PRAGMA journal_mode').get();
    assert.equal(preopened.prepare("SELECT replace('synthetic', 'syn', 'SYN') AS value").get().value, 'SYNthetic');
    preopened.prepare("PRAGMA table_info('synthetic_missing')").all();
    preopened.prepare('PRAGMA quick_check(1)').all();
    preopened.exec('COMMIT');
    preopened.exec('PRAGMA query_only=OFF');
    return row.value;
  });
  assert.equal(ordinary.result, 'ATTACH VACUUM INSERT');
  assert.deepEqual(ordinary.calls, []);
  cachedExec.call(preopened, `ATTACH DATABASE '${literal}' AS synthetic_outside`);
  assert.equal(existsSync(target), true, 'exec delegates outside activation');
  preopened.exec('DETACH DATABASE synthetic_outside');
  const vacuumTarget = join(workspace.path, 'synthetic-vacuum.sqlite');
  cachedVacuum.run(vacuumTarget);
  assert.equal(existsSync(vacuumTarget), true, 'prepared run delegates outside activation');
});

test('SQL lexer keeps identifier-comment boundaries through every statement', () => {
  const quoted = [
    '"report--total"', '`report--total`', '[report--total]', "'report--total'",
    '"report/* total */end"', '`report/* total */end`', '[report/* total */end]', "'report/* total */end'",
    '"report""--total"', '`report``--total`', "'report''--total'",
    '"report""/* total */end"', '`report``/* total */end`', "'report''/* total */end'",
  ];
  for (const identifier of quoted) {
    const sql = `SELECT 1 AS ${identifier}; ATTACH DATABASE ':memory:' AS synthetic_hidden`;
    for (const api of ['exec', 'prepare']) refusesSQLite(() => preopened[api](sql), api, sql);
    const create = `SELECT 1 AS ${identifier}; CREATE TABLE synthetic_hidden(n)`;
    refusesSQLite(() => preopened.exec(create), 'exec', create);
  }
  for (const sql of [
    "SELECT 1; VACUUM INTO ':memory:'",
    'SELECT 1; /* synthetic comment */ VACUUM INTO ?',
    'SELECT 1; -- synthetic comment\n ATTACH DATABASE ? AS synthetic_hidden',
    'SELECT 1; /* " \' ` [ */ ATTACH DATABASE ? AS synthetic_hidden',
    'SELECT 1; /* synthetic */ ATTaCH/**/DATABASE ? AS synthetic_hidden',
    'SELECT 1; PRAGMA journal_mode; VACUUM INTO ?',
  ]) for (const api of ['exec', 'prepare']) refusesSQLite(() => preopened[api](sql), api, sql);
});

test('PRAGMA refuses unknown, write and malformed forms with every schema spelling', () => {
  for (const prefix of ['', 'aux.', '"aux-db".', '[aux db].', '`x`.', "'aux-db'.", '"aux""--db".']) {
    for (const form of ['wal_checkpoint', 'journal_mode=WAL', 'optimize', 'incremental_vacuum',
      'application_id=1', 'user_version(1)', 'writable_schema=ON', 'unknown_synthetic',
      'unknown_synthetic(1)', 'query_only=maybe', 'busy_timeout=1', 'table_info',
      'table_info(x, y)', 'journal_mode(DELETE)', 'quick_check(2)', 'journal_mode garbage']) {
      const sql = `PRAGMA ${prefix}${form}`;
      for (const api of ['exec', 'prepare']) refusesSQLite(() => preopened[api](sql), api, sql);
    }
  }
  for (const sql of ['PRAGMA', 'PRAGMA "unterminated', 'PRAGMA [unterminated',
    'PRAGMA aux.', 'PRAGMA /* unterminated',
    'SELECT 1; PRAGMA "aux-db".wal_checkpoint',
    'PRAGMA journal_mode; PRAGMA [aux db].journal_mode=WAL'])
    refusesSQLite(() => preopened.exec(sql), 'exec', sql);
  for (const name of ['"wal_checkpoint"', '[wal_checkpoint]', '`wal_checkpoint`', "'wal_checkpoint'"])
    refusesSQLite(() => preopened.prepare(`PRAGMA ${name}`), 'prepare', `PRAGMA ${name}`);
});

test('quoted reads and the exact PRAGMA allowlist retain empty transcripts', () => {
  // Attach only synthetic in-memory schemas while inactive. The allowlist must
  // handle schema tokens by kind, including escapes and comment-looking names.
  const schemas = ['main', '"aux-db"', '[aux db]', '`x`', '"aux""--db"'];
  for (const schema of schemas.slice(1)) preopened.exec(`ATTACH ':memory:' AS ${schema}`);
  try {
    const { calls } = sqliteOpenSpy(() => {
      for (const identifier of ['"report--total"', '`report--total`', '[report--total]',
        '"report/* total */end"', '`report/* total */end`', '[report/* total */end]',
        '"report""--total"', '`report``--total`', '"ATTACH"', '`VACUUM`', '[CREATE]']) {
        const row = preopened.prepare(`SELECT 7 AS ${identifier}`).get();
        assert.deepEqual(Object.values(row), [7]);
      }
      for (const sql of ["SELECT 'report--total'", "SELECT 'report/* total */end'",
        "SELECT 'report''--total'", 'SELECT 1 /* unterminated',
        'SELECT 1 -- ATTACH', 'SELECT 1 /* \' " ` [ ATTACH */']) preopened.prepare(sql).get();
      for (const schema of ['', ...schemas.map(name => name + '.')]) {
        for (const name of ['journal_mode', 'application_id', 'user_version', 'foreign_key_check', 'quick_check', 'query_only'])
          preopened.prepare(`PRAGMA ${schema}${name}`).all();
        preopened.prepare(`PRAGMA ${schema}quick_check(1)`).all();
        for (const table of ["'synthetic_missing'", '"synthetic--missing"', '[synthetic missing]', '`synthetic`', 'synthetic'])
          preopened.prepare(`PRAGMA ${schema}table_info(${table})`).all();
      }
      for (const name of ['"journal_mode"', '[journal_mode]', '`journal_mode`', "'journal_mode'"])
        preopened.prepare(`PRAGMA /* synthetic */ ${name}`).get();
      preopened.exec('PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=5000;');
      preopened.exec('PRAGMA query_only=ON; BEGIN; SELECT 1; COMMIT; PRAGMA query_only=OFF;');
    });
    assert.deepEqual(calls, []);
  } finally {
    for (const schema of schemas.slice(1)) preopened.exec(`DETACH ${schema}`);
  }
});

test('backup aliases and extension/changeset APIs refuse before file work', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'open-spy-backup-' });
  const target = join(workspace.path, 'synthetic-backup.sqlite');
  for (const backup of backupAliases) refusesSQLite(() => backup(preopened, target), 'backup');
  for (const api of ['loadExtension', 'enableLoadExtension', 'applyChangeset'])
    refusesSQLite(() => preopened[api](api === 'enableLoadExtension' ? true : target), api);
  assert.equal(existsSync(target), false);
  preopened.exec('CREATE TABLE synthetic_backup(n); INSERT INTO synthetic_backup VALUES(7)');
  assert.ok(await backupAliases[0](preopened, target) > 0, 'backup delegates outside activation');
  const copy = new sqlite.DatabaseSync(target, { readOnly: true });
  try { assert.equal(copy.prepare('SELECT n FROM synthetic_backup').get().n, 7); }
  finally { copy.close(); }
  assert.deepEqual(sqliteOpenSpy(() => 'after async backup').calls, []);
});

test('SQLTagStore file SQL is guarded on Node versions providing it', () => {
  if (!cachedTagStore) {
    assert.equal(typeof preopened.createTagStore, 'undefined');
    return;
  }
  for (const api of ['run', 'get', 'all', 'iterate'])
    refusesSQLite(() => cachedTagStore[api]`ATTACH DATABASE ${':memory:'} AS synthetic_tag`,
      `SQLTagStore.${api}`, 'ATTACH DATABASE ? AS synthetic_tag');
  refusesSQLite(() => cachedTagRun.call(cachedTagStore, ['VACUUM INTO ', ''], ':memory:'),
    'SQLTagStore.run', 'VACUUM INTO ?');
  const iterator = cachedTagStore.iterate`ATTACH DATABASE ${':memory:'} AS synthetic_tag_iterator`;
  refusesSQLite(() => iterator.next(), 'iterator.next', 'ATTACH DATABASE ? AS synthetic_tag_iterator');
  assert.deepEqual(sqliteOpenSpy(() => cachedTagStore.get`SELECT ${3} AS n`).calls, []);
  assert.equal(cachedTagStore.get`SELECT ${3} AS n`.n, 3);
  cachedTagStore.run`ATTACH DATABASE ${':memory:'} AS synthetic_tag_outside`;
  preopened.exec('DETACH DATABASE synthetic_tag_outside');
});

// Fail visibly when a runtime adds a route that needs a fresh classification.
test('SQLite export and native prototype census stays completely classified', () => {
  const expected = {
    '22': {
      exports: "DatabaseSync StatementSync backup constants".split(' '),
      database: "Symbol(nodejs.dispose) aggregate applyChangeset close constructor createSession enableLoadExtension exec function loadExtension location open prepare".split(' '),
      statement: "all columns constructor get iterate run setAllowBareNamedParameters setAllowUnknownNamedParameters setReadBigInts setReturnArrays".split(' '),
      session: "changeset close constructor patchset".split(' '),
    },
    '24': {
      exports: "DatabaseSync Session StatementSync backup constants".split(' '),
      database: "Symbol(Symbol.dispose) aggregate applyChangeset close constructor createSession createTagStore deserialize enableDefensive enableLoadExtension exec function loadExtension location open prepare serialize setAuthorizer".split(' '),
      statement: "Symbol(Symbol.dispose) all close columns constructor get iterate run setAllowBareNamedParameters setAllowUnknownNamedParameters setReadBigInts setReturnArrays".split(' '),
      session: "Symbol(Symbol.dispose) changeset close constructor patchset".split(' '),
      tagStore: "all clear constructor get iterate run".split(' '),
    },
  };
  const key = Number(process.versions.node.split('.')[0]) < 24 ? '22' : '24';
  const keys = object => Reflect.ownKeys(object).map(String).sort();
  const session = preopened.createSession();
  try {
    const actual = { exports: keys(sqlite.default), database: keys(Object.getPrototypeOf(preopened)),
      statement: keys(Object.getPrototypeOf(cachedStatements.run)), session: keys(Object.getPrototypeOf(session)) };
    if (cachedTagStore) actual.tagStore = keys(Object.getPrototypeOf(cachedTagStore));
    assert.deepEqual(actual, expected[key], 'audit newly added SQLite APIs before accepting this runtime');
    assert.deepEqual(keys(Object.getPrototypeOf(preopened.prepare('SELECT 1').iterate())),
      ['constructor', 'next', 'return']);
    assert.throws(() => new sqlite.StatementSync(), /Illegal constructor/);
    assert.throws(() => new session.constructor(), /Illegal constructor/);
    if (cachedTagStore) assert.throws(() => new cachedTagStore.constructor(preopened), /Illegal constructor/);
  } finally { session.close(); preopened.close(); }
});
