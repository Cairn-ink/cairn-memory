import { spawnSync } from 'node:child_process';
import { createExclusiveSqliteFile } from '../sqlite-journal-probe.mjs';
import { initLocalRawStore } from '../../integrations/client/raw/local-setup-init.mjs';
import { openReadDatabase } from '../read-database.mjs';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createTopicSqlitePolicy, topicJournalMode, SQLITE_STAGES, SQLITE_STATEMENTS,
  recordSqliteFailure, unsupportedTopicStorage, TOPIC_WAL_WAIT_MS } from '../topic-reader-sqlite.mjs';
import { readerOptions, safeReaderFailure, safeLegacyReaderFailure } from '../topic-overview-input.mjs';
import { openMemoryReader } from '../memory-reader.mjs';
import { memberFixture, namespace } from '../testing/topic-members-fixture.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const busy = (errcode = 261) => Object.assign(Error('SECRET path SQL content owner'), { code: 'ERR_SQLITE_ERROR', errcode });
test('diagnostics have a closed, content-free shape; default errors remain byte-identical', () => {
  const error = recordSqliteFailure(busy(), 'prepare', 'application_id');
  const original = '{"ok":false,"error":{"code":"storage_busy"}}';
  for (const safe of [safeReaderFailure, safeLegacyReaderFailure]) {
    assert.equal(JSON.stringify(safe(error)), original);
    assert.equal(JSON.stringify(safe(error, false)), original);
    assert.deepEqual(safe(error, true), { ok: false, error: { code: 'storage_busy', diagnostics: {
      stage: 'prepare', statement: 'application_id', sqlite: { code: 5, extendedCode: 261 } } } });
  }
  const mapped = unsupportedTopicStorage(recordSqliteFailure(busy(1), 'prepare', 'schema_metadata'));
  assert.equal(safeLegacyReaderFailure(mapped).error.diagnostics, undefined);
  assert.deepEqual(safeLegacyReaderFailure(mapped, true), { ok: false, error: { code: 'unsupported_database', diagnostics: {
    stage: 'prepare', statement: 'schema_metadata', sqlite: { code: 1, extendedCode: 1 } } } });
  assert.equal(Object.isFrozen(SQLITE_STAGES), true); assert.equal(Object.isFrozen(SQLITE_STATEMENTS), true);
  for (const code of [5, 6, 261, 517, 773]) assert.equal(safeReaderFailure(recordSqliteFailure(busy(code), 'execute', 'topic_metadata'), true).error.diagnostics.sqlite.extendedCode, code);
  for (const [stage, statement] of [['SECRET', 'application_id'], ['execute', 'SELECT SECRET']]) {
    assert.equal(safeReaderFailure(recordSqliteFailure(busy(), stage, statement), true).error.diagnostics, undefined);
  }
  const path = '/tmp/reader-options-only';
  for (const diagnostics of [true, false, undefined]) assert.doesNotThrow(() => readerOptions({ path, ownerId: 'owner', diagnostics }));
  for (const diagnostics of [1, 'true', null, {}]) assert.throws(() => readerOptions({ path, ownerId: 'owner', diagnostics }));
});
for (const mode of ['DELETE', 'WAL']) test(`SQLite detects ${mode}, including absent companions`, t => {
  const workspace = createTestWorkspace(t), path = join(workspace.path, 'mode.sqlite');
  const core = openMemoryCore({ path }); core.close();
  const writer = new DatabaseSync(path); writer.exec(`PRAGMA journal_mode=${mode}`); writer.close();
  assert.equal(existsSync(path + '-wal'), false); assert.equal(existsSync(path + '-shm'), false);
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const policy = createTopicSqlitePolicy(); policy.start(Infinity);
    assert.equal(topicJournalMode(db, path, policy), mode);
    assert.equal(db.prepare('PRAGMA busy_timeout').get().timeout, 0);
  } finally { db.close(); }
});
test('opening mode query: stat hints, one BUSY retry, DELETE zero wait and deadline', t => {
  const workspace = createTestWorkspace(t), path = join(workspace.path, 'probe');
  function attempt({ suffix, failures = 0, deadline = 100 } = {}) {
    if (suffix) writeFileSync(path + suffix, 'hint');
    const configured = []; let calls = 0;
    const native = { exec: sql => configured.push(sql), prepare: () => ({ get() {
      if (calls++ < failures) throw busy();
      return { journal_mode: 'delete' };
    } }) };
    const policy = createTopicSqlitePolicy({ diagnostics: true, now: () => 0 }); policy.start(deadline);
    let error, mode;
    try { mode = topicJournalMode(native, path, policy); } catch (e) { error = e; }
    if (suffix) unlinkSync(path + suffix);
    return { configured, calls, error, mode };
  }
  for (const suffix of ['-wal', '-shm']) {
    const r = attempt({ suffix }); assert.equal(r.mode, 'DELETE');
    assert.deepEqual(r.configured, ['PRAGMA busy_timeout=100', 'PRAGMA busy_timeout=0']);
  }
  const rollback = attempt({ suffix: '-journal', failures: 1 });
  assert.equal(rollback.calls, 1); assert.equal(rollback.error.errcode, 261);
  assert.deepEqual(rollback.configured, ['PRAGMA busy_timeout=0']);
  const reset = attempt({ failures: 1, deadline: 37 }); assert.equal(reset.calls, 2); assert.equal(reset.mode, 'DELETE');
  assert.deepEqual(reset.configured, ['PRAGMA busy_timeout=37', 'PRAGMA busy_timeout=0']);
  const exhausted = attempt({ failures: 2, deadline: 0 });
  assert.equal(exhausted.calls, 2); assert.equal(exhausted.error.errcode, 261);
  assert.deepEqual(safeReaderFailure(exhausted.error, true).error.diagnostics,
    { stage: 'execute', statement: 'journal_mode', sqlite: { code: 5, extendedCode: 261 } });
  assert.deepEqual(exhausted.configured, ['PRAGMA busy_timeout=0']);
});
test('native waits share a single bounded request deadline, including cached statements and iterator steps', () => {
  let now = 10; const configured = [];
  const native = { exec: sql => configured.push(sql), prepare: () => ({ get: () => 1, iterate: function* () { yield 1; } }) };
  const policy = createTopicSqlitePolicy({ now: () => now });
  policy.start(45.9); const db = policy.database(native, true), statement = db.prepare('SELECT metadata');
  assert.deepEqual(configured, ['PRAGMA busy_timeout=35']);
  now = 30; statement.get(); assert.equal(configured.at(-1), 'PRAGMA busy_timeout=15');
  now = 45.5; statement.get(); assert.equal(configured.at(-1), 'PRAGMA busy_timeout=0');
  now = 60; statement.get(); assert.equal(configured.at(-1), 'PRAGMA busy_timeout=0');
  policy.start(10000); statement.get(); assert.equal(configured.at(-1), `PRAGMA busy_timeout=${TOPIC_WAL_WAIT_MS}`);
  const iterator = statement.iterate(); now += 80; iterator.next(); assert.equal(configured.at(-1), 'PRAGMA busy_timeout=20');
  now += 30; iterator.next(); assert.equal(configured.at(-1), 'PRAGMA busy_timeout=0');
  const deletePolicy = createTopicSqlitePolicy({ diagnostics: true, now: () => now }); deletePolicy.start(10000);
  configured.length = 0; deletePolicy.database(native, false).prepare('SELECT metadata').get(); assert.deepEqual(configured, []);
  assert.equal(createTopicSqlitePolicy().database(native, false), native);
});
test('boundary-specific faults retain exact native labels, including timeout installation', () => {
  for (const boundary of ['configure', 'prepare', 'begin', 'get', 'next', 'for-of']) {
    const executed = [];
    const native = {
      exec(sql) {
        executed.push(sql);
        if ((boundary === 'configure' && sql.startsWith('PRAGMA busy_timeout=')) ||
            (boundary === 'begin' && sql === 'BEGIN')) throw busy();
      },
      prepare(sql) {
        executed.push(sql);
        if (boundary === 'prepare') throw busy();
        return { get() { throw busy(); }, iterate: function* () { throw busy(); } };
      },
    };
    const policy = createTopicSqlitePolicy({ diagnostics: true, now: () => 0 }); policy.start(1);
    const db = policy.database(native, true);
    assert.throws(() => {
      if (boundary === 'begin') db.exec('BEGIN');
      else if (['configure', 'prepare'].includes(boundary)) db.prepare('PRAGMA application_id');
      else if (boundary === 'for-of') { for (const row of db.prepare('SELECT SECRET').iterate()) void row; }
      else if (boundary === 'next') db.prepare('SELECT SECRET').iterate().next();
      else db.prepare('SELECT SECRET').get();
    }, error => {
      const labels = boundary === 'configure' ? ['configure', 'reader_configuration'] :
        boundary === 'prepare' ? ['prepare', 'application_id'] :
        boundary === 'begin' ? ['begin', 'transaction'] : ['execute', 'topic_metadata'];
      assert.deepEqual(safeReaderFailure(error, true), { ok: false, error: { code: 'storage_busy', diagnostics: {
        stage: labels[0], statement: labels[1], sqlite: { code: 5, extendedCode: 261 } } } });
      return true;
    });
    assert.deepEqual(executed, boundary === 'configure' ? ['PRAGMA busy_timeout=1'] :
      ['PRAGMA busy_timeout=1', boundary === 'begin' ? 'BEGIN' : boundary === 'prepare' ? 'PRAGMA application_id' : 'SELECT SECRET']);
  }
});
test('public Worker diagnostics cross boundary; default and false preserve exact failure bytes', async t => {
  const f = memberFixture(t); f.admit('locked');
  f.db.exec('BEGIN EXCLUSIVE');
  try {
    for (const diagnostics of [undefined, false, true]) for (const members of [false, true]) {
      const reader = openMemoryReader({ path: f.path, ownerId: namespace.ownerId, diagnostics });
      try {
        const result = await (members ? reader.readTopicMembers({ namespace, selection: { type: 'unfiled' }, accessRevision: 'g' }) : reader.readTopicOverview({ namespace }));
        assert.equal(result.error.code, 'storage_busy');
        if (!diagnostics) assert.equal(JSON.stringify(result), '{"ok":false,"error":{"code":"storage_busy"}}');
        else {
          assert.equal(result.error.diagnostics.sqlite.code, 5);
          assert.equal(result.error.diagnostics.statement, 'journal_mode');
          assert.equal(result.error.diagnostics.stage, 'prepare');
          assert.deepEqual(Object.keys(result.error.diagnostics).sort(), ['sqlite', 'stage', 'statement']);
        }
      } finally { await reader.close(); }
    }
  } finally { f.db.exec('ROLLBACK'); }
});

test('simulated native busy consumes the deadline once and is never retried or converted to success', () => {
  let now = 10, installed = 0, reads = 0;
  const native = { exec(sql) { installed = Number(sql.split('=').at(-1)); }, prepare() { return { get() {
    reads++; now += installed; throw busy();
  } }; } };
  const policy = createTopicSqlitePolicy({ diagnostics: true, now: () => now }); policy.start(37);
  const statement = policy.database(native, true).prepare('SELECT metadata');
  for (let i = 0; i < 2; i++) {
    assert.throws(() => statement.get(), error => {
      assert.deepEqual(safeReaderFailure(error, true).error.diagnostics,
        { stage: 'execute', statement: 'topic_metadata', sqlite: { code: 5, extendedCode: 261 } });
      return true;
    });
    assert.equal(reads, i + 1); assert.equal(now, 37);
  }
  assert.equal(installed, 0, 'expired deadline cannot reinstall the request budget');
});

test('native statement constructor and iterator cancellation semantics are preserved', () => {
  for (const wal of [false, true]) {
    const native = new DatabaseSync(':memory:');
    try {
      native.exec('CREATE TABLE probe(id); INSERT INTO probe VALUES(1),(2)');
      const policy = createTopicSqlitePolicy({ diagnostics: true, now: () => 0 }); policy.start(100);
      const db = policy.database(native, wal), statement = db.prepare('SELECT id FROM probe');
      const reference = native.prepare('SELECT id FROM probe');
      assert.equal(statement.constructor, reference.constructor);
      assert.equal(statement.constructor.prototype, reference.constructor.prototype);
      assert.equal(statement instanceof reference.constructor, true);
      const iterator = statement.iterate(), raw = reference.iterate();
      for (const key of ['next', 'return', 'throw']) assert.equal(typeof iterator[key], typeof raw[key], String(key));
      raw.return();
      function* delegate() { yield* iterator; }
      const generator = delegate(); assert.equal(generator.next().done, false);
      assert.throws(() => generator.throw(new Error('cancel')));
      // A fabricated throw() bypasses IteratorClose and leaves this cursor active.
      assert.doesNotThrow(() => native.exec('DROP TABLE probe'));
    } finally { native.close(); }
  }
});

test('rollback refreshes the WAL timeout after the shared budget has expired', () => {
  let now = 0; const executed = [];
  const native = { exec: sql => executed.push(sql) };
  const policy = createTopicSqlitePolicy({ now: () => now }); policy.start(5000);
  const db = policy.database(native, true); db.exec('BEGIN');
  now = 100; db.exec('ROLLBACK');
  assert.deepEqual(executed, ['PRAGMA busy_timeout=100', 'BEGIN', 'PRAGMA busy_timeout=0', 'ROLLBACK']);
});

test('exclusive creation and setup refuse a store with an active host writer', async t => {
  const f = memberFixture(t); f.admit('exclusive create');
  f.db.exec('BEGIN IMMEDIATE; UPDATE store_metadata SET store_id=store_id');
  try {
    assert.throws(() => createExclusiveSqliteFile(f.path), { code: 'EEXIST' });
    const result = await initLocalRawStore({ databasePath: f.path });
    assert.equal(result.status, 'blocked'); assert.equal(result.reason, 'store_invalid');
  } finally { f.db.exec('ROLLBACK'); }
});

test('wrong application ID plus malformed schema retains b2513501 legacy error precedence', async t => {
  const { baselineReader } = await import('../testing/topic-members-round3-fixture.mjs');
  const f = memberFixture(t);
  f.db.exec("PRAGMA application_id=1; PRAGMA writable_schema=ON; UPDATE sqlite_master SET sql='CREATE TABLE invalid (' WHERE name='memories'; PRAGMA writable_schema=OFF;");
  const oldOpen = await baselineReader(f.workspace, message => t.diagnostic(message));
  const expected = { ok: false, error: { code: 'unsupported_database' } };
  for (const open of [oldOpen, openMemoryReader]) {
    const reader = open({ path: f.path, ownerId: namespace.ownerId });
    try { assert.deepEqual(await reader.readTopicOverview({ namespace }), expected); }
    finally { await reader.close(); }
  }
});

for (const hinted of [true, false]) for (const diagnostics of [true, false])
test(`opening propagates timeout-installation SQLITE_NOMEM (${hinted ? 'WAL hint' : 'BUSY fallback'}, diagnostics=${diagnostics})`, t => {
  const f = memberFixture(t, { mode: 'DELETE' });
  if (hinted) {
    const hint = spawnSync(process.execPath, ['--input-type=module', '-e',
      "import { writeFileSync } from 'node:fs'; writeFileSync(process.argv[1], 'hint');", f.path + '-wal'],
      { env: {}, timeout: 5000, maxBuffer: 4096 });
    assert.equal(hint.error, undefined); assert.equal(hint.status, 0);
    t.after(() => { if (existsSync(f.path + '-wal')) unlinkSync(f.path + '-wal'); });
  }
  const exec = DatabaseSync.prototype.exec, prepare = DatabaseSync.prototype.prepare, close = DatabaseSync.prototype.close;
  const fault = busy(7); let selected, closed = 0, queries = 0, installations = 0;
  t.mock.method(DatabaseSync.prototype, 'exec', function(sql) {
    if (/^PRAGMA busy_timeout=[1-9]\d*$/.test(sql)) {
      selected = this; installations++; throw fault;
    }
    return exec.call(this, sql);
  });
  t.mock.method(DatabaseSync.prototype, 'prepare', function(sql) {
    if (sql === 'PRAGMA journal_mode') { queries++; throw busy(); }
    return prepare.call(this, sql);
  });
  t.mock.method(DatabaseSync.prototype, 'close', function() { if (this === selected) closed++; return close.call(this); });
  const policy = createTopicSqlitePolicy({ diagnostics, now: () => 0 }); policy.start(Infinity);
  assert.throws(() => openReadDatabase(f.path, { topicPolicy: policy }), error => error === fault);
  assert.equal(installations, 1); assert.equal(queries, hinted ? 0 : 1);
  assert.equal(closed, 1); assert.equal(selected.isOpen, false);
  assert.deepEqual(safeReaderFailure(fault, true).error.diagnostics,
    { stage: 'configure', statement: 'reader_configuration', sqlite: { code: 7, extendedCode: 7 } });
});

test('DELETE opening propagates SQLITE_NOMEM on timeout reset and closes the connection', t => {
  const f = memberFixture(t, { mode: 'DELETE' });
  // A stale WAL hint installs a non-zero opening timeout on this DELETE store.
  const hint = spawnSync(process.execPath, ['--input-type=module', '-e',
    "import { writeFileSync } from 'node:fs'; writeFileSync(process.argv[1], 'hint');", f.path + '-wal'],
    { env: {}, timeout: 5000, maxBuffer: 4096 });
  assert.equal(hint.error, undefined); assert.equal(hint.status, 0);
  t.after(() => { if (existsSync(f.path + '-wal')) unlinkSync(f.path + '-wal'); });
  const exec = DatabaseSync.prototype.exec, close = DatabaseSync.prototype.close;
  const fault = busy(7); let selected, closed = 0, installed;
  t.mock.method(DatabaseSync.prototype, 'exec', function(sql) {
    if (sql === 'PRAGMA busy_timeout=0') {
      selected = this; installed = this.prepare('PRAGMA busy_timeout').get().timeout;
      throw fault;
    }
    return exec.call(this, sql);
  });
  t.mock.method(DatabaseSync.prototype, 'close', function() { if (this === selected) closed++; return close.call(this); });
  const policy = createTopicSqlitePolicy({ diagnostics: true }); policy.start(Infinity);
  assert.throws(() => openReadDatabase(f.path, { topicPolicy: policy }), error => error === fault);
  assert.ok(installed > 0); assert.equal(closed, 1); assert.equal(selected.isOpen, false);
  assert.deepEqual(safeReaderFailure(fault, true).error.diagnostics,
    { stage: 'configure', statement: 'reader_configuration', sqlite: { code: 7, extendedCode: 7 } });
});
