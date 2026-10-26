import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { lstatSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createTopicSqlitePolicy, topicJournalMode, SQLITE_STAGES, SQLITE_STATEMENTS,
  recordSqliteFailure, unsupportedTopicStorage, TOPIC_WAL_WAIT_MS, TOPIC_WAL_REPLY_RESERVE_MS } from '../topic-reader-sqlite.mjs';
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
  const path = join('synthetic-reader-options', 'memory.sqlite');
  for (const diagnostics of [true, false, undefined]) assert.doesNotThrow(() => readerOptions({ path, ownerId: 'owner', diagnostics }));
  for (const diagnostics of [1, 'true', null, {}]) assert.throws(() => readerOptions({ path, ownerId: 'owner', diagnostics }));
});
for (const mode of ['DELETE', 'WAL']) test(`header detection ${mode}, without a SQLite query or companions`, t => {
  const workspace = createTestWorkspace(t), path = join(workspace.path, 'mode.sqlite');
  const core = openMemoryCore({ path }); core.close();
  const db = new DatabaseSync(path);
  try {
    db.exec(`PRAGMA journal_mode=${mode}`);
    assert.equal(topicJournalMode(path, lstatSync(path)), mode);
  } finally { db.close(); }
  assert.equal(topicJournalMode(path, lstatSync(path)), mode);
  assert.equal(existsSync(path + '-wal'), false); assert.equal(existsSync(path + '-shm'), false);
  assert.throws(() => topicJournalMode(path, { dev: -1, ino: -1 }), /unsafe_database_file/);
});
test('unknown or truncated headers never enable waiting', t => {
  const w = createTestWorkspace(t), path = join(w.path, 'header');
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(19), Buffer.from('SECRET malformed database'),
    Buffer.from('SQLite format 3\0xx\x02\x01')]) {
    writeFileSync(path, bytes); assert.equal(topicJournalMode(path, lstatSync(path)), 'DELETE');
  }
});
test('native waits share a single bounded request deadline, including cached statements and iterator steps', () => {
  let now = 10; const configured = [];
  const native = { exec: sql => configured.push(sql), prepare: () => ({ get: () => 1, iterate: function* () { yield 1; } }) };
  const policy = createTopicSqlitePolicy({ now: () => now });
  policy.start(45.9); const db = policy.database(native, true), statement = db.prepare('SELECT metadata');
  assert.deepEqual(configured, ['PRAGMA busy_timeout=15']);
  now = 20; statement.get(); assert.equal(configured.at(-1), 'PRAGMA busy_timeout=5');
  now = 45.5; statement.get(); assert.equal(configured.at(-1), 'PRAGMA busy_timeout=0');
  now = 60; statement.get(); assert.equal(configured.at(-1), 'PRAGMA busy_timeout=0');
  policy.start(10000); statement.get(); assert.equal(configured.at(-1), `PRAGMA busy_timeout=${TOPIC_WAL_WAIT_MS - TOPIC_WAL_REPLY_RESERVE_MS}`);
  const iterator = statement.iterate(); now += 80; iterator.next(); assert.equal(configured.at(-1), 'PRAGMA busy_timeout=900');
  now += 901; iterator.next(); assert.equal(configured.at(-1), 'PRAGMA busy_timeout=0');
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
    const policy = createTopicSqlitePolicy({ diagnostics: true, now: () => 0 }); policy.start(21);
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
          assert.equal(result.error.diagnostics.statement, members ? 'user_version' : 'application_id');
          assert.equal(result.error.diagnostics.stage, 'execute');
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
    assert.equal(reads, i + 1); assert.equal(now, 17);
  }
  assert.equal(installed, 0, 'expired deadline cannot reinstall the request budget');
});

test('complete 100-byte header required; WAL prefixes of every truncated length retain zero wait', t => {
  const w = createTestWorkspace(t), path = join(w.path, 'prefix');
  const header = Buffer.alloc(100); header.write('SQLite format 3\0'); header[18] = header[19] = 2;
  for (let length = 20; length < 100; length++) {
    writeFileSync(path, header.subarray(0, length));
    assert.equal(topicJournalMode(path, lstatSync(path)), 'DELETE', 'truncated length ' + length);
  }
  writeFileSync(path, header); assert.equal(topicJournalMode(path, lstatSync(path)), 'WAL');
  header[18] = header[19] = 1;
  writeFileSync(path, header); assert.equal(topicJournalMode(path, lstatSync(path)), 'DELETE');
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
  now = 980; db.exec('ROLLBACK');
  assert.deepEqual(executed, ['PRAGMA busy_timeout=980', 'BEGIN', 'PRAGMA busy_timeout=0', 'ROLLBACK']);
});

test('v1.1 native wait never exceeds deadline minus reserve or the shared cap, including late Worker start', () => {
  assert.equal(TOPIC_WAL_WAIT_MS, 1000); assert.equal(TOPIC_WAL_REPLY_RESERVE_MS, 20);
  // Simulate host dispatch at zero and Worker startup at 35ms; include short,
  // exhausted and fractional deadlines, plus the legacy 5000ms watchdog.
  for (const deadlineAt of [10, 35, 50, 55, 55.9, 250, 1000, 1035, 2000, 5000]) {
    let now = 35, installed = 0;
    const native = { exec(sql) { installed = Number(sql.split('=').at(-1)); }, prepare: () => ({ get: () => installed }) };
    const policy = createTopicSqlitePolicy({ now: () => now }); policy.start(deadlineAt);
    const db = policy.database(native, true), statement = db.prepare('SELECT metadata');
    for (const elapsed of [0, .5, 5, 30, 150, 700, 979, 980, 1001]) {
      now = 35 + elapsed;
      const wait = statement.get();
      const deadlineBound = Math.max(0, Math.floor(deadlineAt - now - 20));
      const capBound = Math.max(0, Math.floor(1000 - elapsed - 20));
      assert.equal(wait, Math.min(deadlineBound, capBound), 'deadline ' + deadlineAt + ', elapsed ' + elapsed);
      assert.ok(wait <= deadlineBound); assert.ok(wait <= 980);
    }
  }
});

test('public dispatch supplies member deadlines and the existing 5000ms overview deadline to the Worker', async t => {
  const { Worker } = await import('node:worker_threads');
  const { performance } = await import('node:perf_hooks');
  const workspace = createTestWorkspace(t), messages = [];
  t.mock.method(performance, 'now', () => 1234);
  t.mock.method(Worker.prototype, 'postMessage', function(message) {
    messages.push(message);
    queueMicrotask(() => this.emit('message', { ok: false, error: { code: 'storage_busy' } }));
  });
  const reader = openMemoryReader({ path: join(workspace.path, 'synthetic.sqlite'), ownerId: namespace.ownerId });
  try {
    assert.equal((await reader.readTopicMembers({ namespace, selection: { type: 'unfiled' }, accessRevision: 'g', deadlineMs: 250 })).error.code, 'storage_busy');
    assert.equal(messages.at(-1).deadlineAt, 1234 + 250);
    assert.equal((await reader.readTopicOverview({ namespace })).error.code, 'storage_busy');
    assert.equal(messages.at(-1).deadlineAt, 1234 + 5000);
  } finally { await reader.close(); }
});

test('v1.1 permits a simulated lock over 100ms and preserves busy when its bound is exhausted', () => {
  for (const [deadlineAt, releaseAt, succeeds] of [[250, 175, true], [250, 400, false], [5000, 600, true], [5000, 2000, false]]) {
    let now = 35, installed = 0, reads = 0;
    const native = { exec(sql) { installed = Number(sql.split('=').at(-1)); }, prepare: () => ({ get() {
      reads++;
      if (releaseAt - now > installed) { now += installed; throw busy(5); }
      now = releaseAt; return 'snapshot';
    } }) };
    const policy = createTopicSqlitePolicy({ now: () => now }); policy.start(deadlineAt);
    const statement = policy.database(native, true).prepare('SELECT metadata');
    if (succeeds) assert.equal(statement.get(), 'snapshot');
    else {
      assert.throws(() => statement.get(), error => {
        assert.equal(safeReaderFailure(error).error.code, 'storage_busy'); return true;
      });
      assert.equal(now, Math.min(deadlineAt, 1035) - 20);
    }
    assert.equal(reads, 1, 'no application retry'); assert.ok(now <= deadlineAt - 20);
  }
});
