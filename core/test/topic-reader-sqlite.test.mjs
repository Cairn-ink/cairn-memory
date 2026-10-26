import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { lstatSync, writeFileSync, existsSync } from 'node:fs';
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
test('simulated busy preserves original code and labels at every native boundary', () => {
  for (const method of ['prepare', 'exec', 'get', 'next', 'for-of']) {
    const native = { exec: () => { if (method === 'exec') throw busy(); }, prepare: () => {
      if (method === 'prepare') throw busy();
      return { get() { throw busy(); }, iterate: function* () { throw busy(); } };
    } };
    const policy = createTopicSqlitePolicy({ diagnostics: true, now: () => 0 }); policy.start(1);
    const db = policy.database(native, true);
    try {
      if (method === 'exec') db.exec('BEGIN');
      else if (method === 'prepare') db.prepare('PRAGMA application_id');
      else if (method === 'for-of') { for (const row of db.prepare('SELECT SECRET').iterate()) void row; }
      else if (method === 'next') db.prepare('SELECT SECRET').iterate().next();
      else db.prepare('SELECT SECRET').get();
      assert.fail('busy expected');
    } catch (error) {
      const result = safeReaderFailure(error, true);
      assert.equal(result.error.code, 'storage_busy');
      assert.ok(SQLITE_STAGES.includes(result.error.diagnostics.stage));
      assert.ok(SQLITE_STATEMENTS.includes(result.error.diagnostics.statement));
      assert.doesNotMatch(JSON.stringify(result), /SECRET/);
    }
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
    assert.equal(reads, i + 1); assert.equal(now, 37);
  }
  assert.equal(installed, 0, 'expired deadline cannot reinstall the request budget');
});
