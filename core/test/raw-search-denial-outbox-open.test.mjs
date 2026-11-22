import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../index.mjs';
import { lineageFixture } from '../testing/card-lineage-fixture.mjs';
import { installRawSearchTestClock, rawSearchTestWait } from '../testing/raw-search-clock.mjs';
import { ns, ok, request, splitRaw } from '../testing/raw-capture-fixtures.mjs';
import { localOpenFixture, observeOpen } from './fixtures/local-open-tools.mjs';
import { isWrite } from './fixtures/deferred-open-child.mjs';

const outbox = 'raw_search_denial_queue';
const client = 'codex';
const sessionId = 'synthetic-denied-session';
const needle = 'quartz telescope';
const fence = { namespace: ns, client, sessionId };
const coreModule = new URL('../index.mjs', import.meta.url).href;

function inspect(path, read) {
  const db = new DatabaseSync(path, { readOnly: true });
  try { return read(db); }
  finally { db.close(); }
}

function schema(path) {
  return inspect(path, db => ({
    layout: db.prepare('PRAGMA user_version').get().user_version,
    cookie: db.prepare('PRAGMA schema_version').get().schema_version,
    outbox: db.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name=?").get(outbox)?.sql,
  }));
}

function selectors(path) {
  return inspect(path, db => db.prepare(`SELECT * FROM ${outbox} ORDER BY ordinal`).all().map(row => ({ ...row })));
}

async function deferredOpen(config) {
  const before = schema(config.path);
  const { value, trace } = observeOpen(() => openMemoryCore(config));
  try {
    assert.deepEqual(trace.filter(row => /^(BEGIN|COMMIT|ROLLBACK)\b/.test(row.sql)).map(row => row.sql),
      ['BEGIN', 'COMMIT'], 'a successful deferred snapshot never enters the writer fallback');
    assert.deepEqual(trace.filter(row => isWrite(row.sql)), [], 'open performs no canonical repair');
    assert.deepEqual(schema(config.path), before, 'open leaves the layout and schema cookie intact');
    return value;
  } catch (error) {
    await value.close();
    throw error;
  }
}

async function save(core) {
  return ok(await core.captureRaw(request(splitRaw(needle)[0], { client, sessionId }))).raw.conversationId;
}

function expectedSelector(conversationId) {
  return { owner_id: ns.ownerId, scope: ns.scope, project_id: '', ordinal: 1,
    conversation_id: conversationId, message_id: null, start: null, end: null };
}

test('ordinary layout 29 defers open and installs the outbox on its first denial', async t => {
  const { path, config } = await localOpenFixture(t, 29);
  assert.equal(schema(path).outbox, undefined);
  const core = await deferredOpen(config);
  try {
    assert.equal(schema(path).outbox, undefined, 'the opener did not create the outbox');
    const conversationId = await save(core);
    assert.equal(schema(path).outbox, undefined, 'capture alone did not create the outbox');
    ok(await core.fenceSession(fence));
    assert.ok(schema(path).outbox, 'the denial installed the outbox');
    assert.deepEqual(selectors(path), [expectedSelector(conversationId)]);
  } finally { await core.close(); }
});

test('layout 29 defers both the pending and drained reopens and drains the selector', async t => {
  installRawSearchTestClock(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { path, config } = await localOpenFixture(t, 29);
  const searchConfig = { ...config, rawSearch: true };
  const search = async core => ok(await core.searchRaw({ namespace: ns, query: needle, semantic: false }));
  const turn = async core => {
    await rawSearchTestWait(1010);
    ok(await core.maintainRawSearch({ namespace: ns }));
  };

  const writer = openMemoryCore(searchConfig);
  let conversationId;
  try {
    conversationId = await save(writer);
    for (let i = 0; i < 12; i++) {
      await turn(writer);
      if ((await search(writer)).coverage.status === 'complete') break;
    }
    const indexed = await search(writer);
    assert.equal(indexed.coverage.status, 'complete');
    assert.equal(indexed.candidates.length, 1);
    ok(await writer.fenceSession(fence));
  } finally { await writer.close(); }

  assert.ok(schema(path).outbox, 'the closed writer left a durable outbox');
  const queued = [expectedSelector(conversationId)];
  assert.deepEqual(selectors(path), queued);
  const root = path + '.raw-search';
  const readSet = join(root, readdirSync(root)[0]);
  const sidecar = join(readSet, readdirSync(readSet).find(name => name.endsWith('.sqlite')));
  const state = () => inspect(sidecar, db => ({
    published: db.prepare('SELECT count(*) AS n FROM segments WHERE published=1').get().n,
    cursor: JSON.parse(db.prepare('SELECT checkpoint FROM header').get().checkpoint).denialQueue,
  }));
  const pending = state();
  assert.equal(pending.published, 1);
  assert.equal(pending.cursor, undefined);

  const reopened = await deferredOpen(searchConfig);
  try {
    assert.deepEqual(state(), pending, 'opener leaves the pending selector for upkeep');
    assert.deepEqual((await search(reopened)).candidates, [], 'live authority hides the pending segment');
    await turn(reopened);
    const drained = state();
    assert.equal(drained.published, 0);
    assert.deepEqual(drained.cursor.positions, [{ ordinal: 1 }]);
  } finally { await reopened.close(); }

  const drained = state();
  const reopenedDrained = await deferredOpen(searchConfig);
  try {
    assert.deepEqual((await search(reopenedDrained)).candidates, []);
    assert.deepEqual(state(), drained);
    assert.deepEqual(selectors(path), queued, 'draining advances the sidecar cursor and retains the canonical selector');
  } finally { await reopenedDrained.close(); }
});

test('a process exit after first-denial DDL rolls back the outbox and fence', async t => {
  const { path, config } = await localOpenFixture(t, 29);
  const writer = openMemoryCore(config);
  let conversationId;
  try { conversationId = await save(writer); }
  finally { await writer.close(); }
  const before = schema(path);
  assert.equal(before.outbox, undefined);

  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { DatabaseSync } from 'node:sqlite';
    import { openMemoryCore } from ${JSON.stringify(coreModule)};
    const [config, fence] = process.argv.slice(1).map(JSON.parse);
    const core = openMemoryCore(config);
    const exec = DatabaseSync.prototype.exec;
    DatabaseSync.prototype.exec = function(sql) {
      const result = exec.call(this, sql);
      if (sql.startsWith('CREATE TABLE IF NOT EXISTS raw_search_denial_queue (') && this.isTransaction &&
          this.prepare("SELECT 1 FROM sqlite_schema WHERE name='raw_search_denial_queue'").get()) process.exit(86);
      return result;
    };
    const result = await core.fenceSession(fence);
    if (!result.ok) throw Error(JSON.stringify(result));
    await core.close();
  `, JSON.stringify(config), JSON.stringify(fence)], { encoding: 'utf8', timeout: 15000 });
  assert.ifError(child.error);
  assert.equal(child.status, 86, 'child exited after DDL inside the uncommitted fence transaction: ' + child.stderr);
  assert.deepEqual(schema(path), before, 'SQLite rolled back the uncommitted declaration');
  assert.equal(inspect(path, db => db.prepare('SELECT count(*) AS n FROM raw_session_fences').get().n), 0);

  const reopened = await deferredOpen(config);
  try {
    ok(await reopened.fenceSession(fence));
    assert.ok(schema(path).outbox, 'the retried denial installs the outbox');
    assert.deepEqual(selectors(path), [expectedSelector(conversationId)]);
  } finally { await reopened.close(); }
});

test('the exact safety attestor admits the outbox and refuses an unexpected table', async t => {
  const f = await lineageFixture(t, { base: 33, eventTime: true });
  const config = { path: f.path };
  await f.core.close();
  assert.equal(f.db.prepare('SELECT card_lineage_revision FROM content_safety_control').get().card_lineage_revision, 1);
  // Install the declared shape independently of the writer so this cell tests
  // the attestor even when the engine has no denial outbox implementation.
  f.db.exec(`CREATE TABLE raw_search_denial_queue (
    owner_id TEXT NOT NULL, scope TEXT NOT NULL, project_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL CHECK(ordinal>0), conversation_id TEXT NOT NULL,
    message_id TEXT, start INTEGER, end INTEGER,
    CHECK((message_id IS NULL AND start IS NULL AND end IS NULL) OR
      (message_id IS NOT NULL AND start IS NOT NULL AND end IS NOT NULL AND start>=0 AND end>start)),
    PRIMARY KEY(owner_id,scope,project_id,ordinal)
  ) STRICT, WITHOUT ROWID`);
  f.db.exec('CREATE TABLE synthetic_unexpected (id INTEGER PRIMARY KEY) STRICT');
  assert.throws(() => openMemoryCore(config), { code: 'unsupported_database' });
  f.db.exec('DROP TABLE synthetic_unexpected');
  const reopened = await deferredOpen(config);
  await reopened.close();
});
