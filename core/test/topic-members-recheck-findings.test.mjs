import assert from 'node:assert/strict';
import test from 'node:test';
import threads, { MessageChannel } from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';
import { createTopicOpening } from '../topic-members-opening.mjs';
import { createTopicSession } from '../topic-members-session.mjs';
import { createTopicMemberReader } from '../topic-members-reader.mjs';
import { createTopicTokens } from '../topic-snapshot.mjs';
import { membersInput } from '../topic-members-input.mjs';
import { DatabaseSync } from 'node:sqlite';
import { memberFixture, smallHierarchy, namespace, overview, ok } from '../testing/topic-members-fixture.mjs';
const base = { namespace, selection: { type: 'unfiled' }, accessRevision: 'recheck' };
const stale = { ok: false, error: { code: 'cursor_stale' } };
function observed(t, f, constructionError) {
  const NativeWorker = threads.Worker, reports = [], waiters = [], ports = [];
  threads.Worker = class extends NativeWorker {
    constructor(url, options) {
      const { port1, port2 } = new MessageChannel(); ports.push(port1);
      port1.on('message', record => { const resolve = waiters.shift(); if (resolve) resolve(record); else reports.push(record); });
      super(url, { ...options, workerData: { ...options.workerData, constructionError, recheckPort: port2 }, transferList: [port2],
        execArgv: ['--import', new URL('../testing/topic-members-clock.mjs', import.meta.url).href,
          '--import', new URL('../testing/topic-members-recheck-observer.mjs', import.meta.url).href] });
    }
  };
  syncBuiltinESMExports();
  const reader = f.reader();
  t.after(async () => { await reader.close(); ports.forEach(port => port.close()); threads.Worker = NativeWorker; syncBuiltinESMExports(); });
  return { reader, report: () => reports.length ? Promise.resolve(reports.shift()) : new Promise(resolve => waiters.push(resolve)) };
}
for (const method of ['members', 'opt-in overview']) test(`spec/standards P1: Opening still does work outside workLimit metering — ${method}`, async t => {
  const f = memberFixture(t);
  f.db.exec('BEGIN');
  for (let i = 0; i < 96; i++) f.db.exec(`ALTER TABLE memories ADD COLUMN recheck_${i} TEXT`);
  for (let i = 0; i < 128; i++) f.db.exec(`CREATE INDEX recheck_index_${i} ON memories(created_at)`);
  f.db.exec('COMMIT');
  const { reader, report } = observed(t, f);
  let cursor, completed = false, maximum = 0, metadataReads = 0, filteredPragmas = 0;
  for (let page = 0; page < 3000; page++) {
    const input = { workLimit: 16, ...(cursor ? { cursor } : {}) };
    const result = method === 'members' ? await reader.readTopicMembers({ ...base, ...input })
      : await reader.readTopicOverview({ namespace, snapshotVersion: 'topic-snapshot-v1', ...input });
    const physical = await report(); maximum = Math.max(maximum, physical.rows); metadataReads += physical.queries.length;
    assert.ok(physical.rows <= 64, JSON.stringify({ page, ...physical }));
    filteredPragmas += physical.filteredPragmas;
    const value = ok(result); cursor = value.nextCursor;
    if (!cursor) { assert.equal(value.coverage.complete, true); completed = true; break; }
  }
  assert.equal(completed, true); assert.ok(metadataReads > 0);
  assert.equal(filteredPragmas, 0, 'filtered virtual metadata scans may not hide discarded rows');
  // No iterator into the real store may survive a page or a transaction.
  f.db.exec('BEGIN EXCLUSIVE; ROLLBACK');
  t.diagnostic(JSON.stringify({ method, maximumPhysicalVisits: maximum, allowed: 64, metadataReads }));
});

test('spec/standards P1: Opening still does work outside workLimit metering — native filtering evidence', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE wide(' + Array.from({ length: 1000 }, (_, i) => 'c' + i + ' TEXT').join(',') + ')');
    let visited = 0; db.function('recheck_visit', () => { visited++; return 1; });
    const sql = 'SELECT name FROM pragma_table_info(?) WHERE recheck_visit() AND cid=?';
    assert.match(db.prepare('EXPLAIN QUERY PLAN ' + sql).get('wide', 999).detail, /SCAN/);
    assert.equal(db.prepare(sql).get('wide', 999).name, 'c999');
    assert.equal(visited, 1000, 'observer sees underlying VNext work, not just the one returned row');
  } finally { db.close(); }
});

test('spec/standards P1: Opening still does work outside workLimit metering — every batch charged before execution', async t => {
  const f = memberFixture(t);
  let physical = 0, charged = 0, maximumBatch = 0;
  f.db.function('recheck_batch_visit', () => { physical++; return 1; });
  const db = new Proxy(f.db, { get(target, key) {
    if (key === 'prepare') return sql => {
      const metadata = /FROM pragma_/.test(sql);
      if (metadata) sql = /WHERE/i.test(sql) ? sql.replace(/WHERE/i, 'WHERE recheck_batch_visit() AND')
        : sql.replace(/(FROM pragma_\w+\(\?\))/, '$1 WHERE recheck_batch_visit()');
      const statement = target.prepare(sql);
      return new Proxy(statement, { get(stmt, name) {
        if (name === 'columns') return () => { physical++; assert.ok(physical <= charged); return stmt.columns(); };
        if (name === 'get') return (...args) => { if (!metadata) physical++; assert.ok(physical <= charged); return stmt.get(...args); };
        if (name === 'iterate') return (...args) => {
          // No row may be visited before the entire bounded batch is charged.
          const iterator = stmt.iterate(...args);
          return { next() { const value = iterator.next(); assert.ok(physical <= charged); return value; }, return: () => iterator.return() };
        };
        const value = Reflect.get(stmt, name, stmt); return typeof value === 'function' ? value.bind(stmt) : value;
      } });
    };
    const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
  const opening = createTopicOpening(db, 18), state = opening.create();
  for (let step = 0; !state.done && step < 2000; step++) {
    physical = 0; charged = opening.cost?.(state) ?? 1; maximumBatch = Math.max(maximumBatch, charged);
    opening.step(state); assert.ok(physical <= charged, JSON.stringify({ physical, charged, state }));
  }
  assert.equal(state.done, true); assert.equal(maximumBatch, 5);
  // The real reader must reserve the same variable batch costs, including
  // cursor authentication and both fences, on cold and warm continuations.
  const session = createTopicSession(f.path); t.after(() => session.dispose());
  const uses = [], engine = createTopicMemberReader({ ...session, tokens: createTopicTokens(), observe: value => uses.push(value.used) });
  let cursor;
  for (let call = 0; call < 1000; call++) {
    uses.length = 0;
    const input = membersInput({ ...base, workLimit: 16, ...(cursor ? { cursor } : {}) }, namespace.ownerId);
    const page = ok(await engine.read(input));
    assert.ok(Math.max(...uses) <= 16, JSON.stringify(uses));
    cursor = page.nextCursor;
    f.db.exec('BEGIN EXCLUSIVE; ROLLBACK');
    if (!cursor) { assert.equal(page.coverage.complete, true); return; }
  }
  assert.fail('metered initialization did not complete');
});

for (const mode of ['DELETE', 'WAL']) for (const change of [
  ['drop snapshot table', 'DROP TABLE namespace_epochs'],
  ['drop projection table', 'DROP TABLE index_memories'],
  ['rename consumed column', 'ALTER TABLE mocs RENAME COLUMN title TO renamed_title'],
]) test(`spec P1: Destructive schema changes return reader_failed instead of cursor_stale — ${mode} ${change[0]}`, async t => {
  const f = memberFixture(t, { mode }); smallHierarchy(f); f.admit('another-unfiled');
  const pending = f.reader(), replay = f.reader(), final = f.reader(), work = f.reader(), optin = f.reader();
  const input = { ...base, limit: 1 }, first = ok(await pending.readTopicMembers(input)); assert.ok(first.nextCursor);
  const replayFirst = ok(await replay.readTopicMembers(input)), replayInput = { ...input, cursor: replayFirst.nextCursor };
  const cached = ok(await replay.readTopicMembers(replayInput)); assert.equal(cached.coverage.complete, true);
  const finalFirst = ok(await final.readTopicMembers(input)), finalInput = { ...input, cursor: finalFirst.nextCursor };
  ok(await final.readTopicMembers(finalInput));
  const workInput = { ...base, workLimit: 16 }, workFirst = ok(await work.readTopicMembers(workInput)); assert.ok(workFirst.nextCursor);
  const overviewInput = { namespace, snapshotVersion: 'topic-snapshot-v1', nodeLimit: 1 };
  const optFirst = ok(await optin.readTopicOverview(overviewInput)); assert.ok(optFirst.nextCursor);
  const overviewReplay = f.reader(), oFirst = ok(await overviewReplay.readTopicOverview(overviewInput));
  const oReplayInput = { ...overviewInput, cursor: oFirst.nextCursor }; ok(await overviewReplay.readTopicOverview(oReplayInput));
  const origin = (await overview(f.reader())).snapshot;
  f.db.exec(change[1]);
  assert.deepEqual(await pending.readTopicMembers({ ...input, cursor: first.nextCursor }), stale, 'next page');
  assert.deepEqual(await replay.readTopicMembers(replayInput), stale, 'cached final page');
  assert.deepEqual(await final.readTopicMembers(finalInput), stale, 'second cached final page');
  assert.deepEqual(await work.readTopicMembers({ ...workInput, cursor: workFirst.nextCursor }), stale, 'initialization checkpoint');
  assert.deepEqual(await optin.readTopicOverview({ ...overviewInput, cursor: optFirst.nextCursor }), stale, 'opt-in next page');
  assert.deepEqual(await overviewReplay.readTopicOverview(oReplayInput), stale, 'opt-in cached page');
  assert.deepEqual(await pending.readTopicMembers({ ...base, expectedSnapshot: origin }), stale, 'old origin after invalidation');
});

test('spec/standards P2: Legacy overview malformed-layout error classification changed — missing title', async t => {
  const f = memberFixture(t); smallHierarchy(f);
  f.db.exec('ALTER TABLE mocs RENAME COLUMN title TO renamed_title');
  assert.equal(JSON.stringify(await f.reader().readTopicOverview({ namespace })), '{"ok":false,"error":{"code":"unsupported_database"}}');
});
for (const [label, error, code] of [
  ['SQL error', { code: 'ERR_SQLITE_ERROR', errcode: 1 }, 'unsupported_database'],
  ['busy', { code: 'ERR_SQLITE_ERROR', errcode: 5 }, 'storage_busy'],
  ['locked', { code: 'ERR_SQLITE_ERROR', errcode: 6 }, 'storage_busy'],
  ['extended busy', { code: 'ERR_SQLITE_ERROR', errcode: 261 }, 'storage_busy'],
  ['extended locked', { code: 'ERR_SQLITE_ERROR', errcode: 262 }, 'storage_busy'],
  ...['invalid_input', 'invalid_cursor', 'cursor_stale', 'index_unavailable', 'unsafe_database_file',
    'unsupported_database', 'database_not_found', 'storage_busy', 'state_limit', 'context_item_too_large',
    'store_closed', 'moc_not_found', 'revision_conflict', 'invalid_ref', 'read_timeout', 'reader_failed']
    .map(code => [code, { code }, 'unsupported_database']),
  ['unexpected error', {}, 'unsupported_database'],
]) test(`spec/standards P2: Legacy overview malformed-layout error classification changed — ${label}`, async t => {
  const f = memberFixture(t), { reader } = observed(t, f, error);
  assert.equal(JSON.stringify(await reader.readTopicOverview({ namespace })), JSON.stringify({ ok: false, error: { code } }));
});
