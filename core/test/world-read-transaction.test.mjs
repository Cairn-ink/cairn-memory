import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { STORAGE_BUSY_TIMEOUT_MS, transaction } from '../database.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { batch, digest } from '../testing/episode-helpers.mjs';
import { safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';

const namespace = { ownerId: 'synthetic-world-read', scope: 'personal', projectId: null };
const ns = { ...namespace, projectId: '' };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const range = { namespace, since: '2026-01-01T00:00:00.000Z', until: '2027-01-01T00:00:00.000Z' };
async function fixture(t, safety = false) {
  const f = safety ? safetyFixture(t) : { workspace: createTestWorkspace(t, { prefix: 'world-read-' }) };
  f.path ??= join(f.workspace.path, 'store.sqlite');
  if (safety) await f.migrate();
  const options = { path: f.path, decisionReview: 'required-v1', model: { contextWindow: 8192, countTokens: () => 1 } };
  f.core = openMemoryCore(options);
  f.runtime = createMemoryRuntime({ path: f.path, decisionReview: 'required-v1', sessionEpisodes: { mode: 'episode-v1' } }, { attachRaw(db) { f.db = db; } });
  f.workspace.defer(() => f.runtime.close());
  f.workspace.defer(() => f.core.close());
  assert.equal(f.db.prepare('PRAGMA journal_mode').get().journal_mode, 'delete');
  f.db.exec('PRAGMA busy_timeout=5000');
  f.memory = ok(f.core.admit({ namespace, memory: { content: 'Synthetic world instruction', kind: 'instruction' },
    receipts: [{ client: 'synthetic', sessionId: 'world', eventId: 'one', role: 'user', excerpt: 'Synthetic evidence' }] })).memory;
  f.memory = ok(f.core.get({ namespace, memoryId: f.memory.id })).memory;
  const other = ok(f.core.admit({ namespace, memory: { content: 'Synthetic other fact', kind: 'fact' },
    receipts: [{ client: 'synthetic', sessionId: 'world', eventId: 'two', role: 'user', excerpt: 'Synthetic other evidence' }] })).memory;
  f.db.prepare('UPDATE memories SET created_at=?,updated_at=?').run(range.since, range.since);
  f.db.prepare('UPDATE receipts SET created_at=?').run(range.since);
  f.db.prepare(`INSERT INTO confirmation_supersessions VALUES(?,?,?,?,?,?,?,?,?)`).run(
    f.memory.id, f.memory.revision, other.id, other.revision, '[]', 'synthetic', '[]', 'unresolved', '{"status":"unresolved"}');
  f.db.prepare(`INSERT INTO confirmation_conflicts VALUES(?,?,?,?,?,?,?,?)`).run(
    f.memory.id, f.memory.revision, other.id, other.revision, 'synthetic', null, 'pending', null);
  const input = batch('world-event', 'Synthetic episode evidence', 'world-session');
  const registered = f.runtime.reserveEpisodeBatch(ns, input);
  f.episodeId = registered.episodeId;
  const lease = f.runtime.claimEpisodeWriter(ns, { episodeId: f.episodeId, generation: 'initial' });
  const claim = f.runtime.claimEpisodeDraft(ns, { episodeId: f.episodeId, generation: 'initial',
    writerToken: lease.token, trigger: 'batch', watermark: registered.position });
  const field = value => ({ value, anchors: [{ sourceIndex: 0, start: 0, end: input.view.messages[0].content.length }] });
  f.runtime.commitEpisodeDraft(ns, { episodeId: f.episodeId, token: claim.token,
    sources: [{ eventId: input.eventId, messageId: input.view.messages[0].id }],
    result: { type: field('work'), language: 'en', gist: field('Synthetic gist'), outcome: null,
      nextStep: field('Review synthetic evidence'), disposition: null },
    dispositions: [{ eventId: input.eventId, omitted: 0 }],
    modelMetadata: { adapter: 'scripted', model: null, profile: null, promptVersion: 'storage-test',
      digest: digest('prompt'), portVersion: 'episode-v1' } });
  f.db.prepare(`UPDATE session_episodes SET first_received_at=?,record=json_set(record,'$.eventStart',?,'$.eventEnd',?) WHERE id=?`)
    .run(range.since, range.since, range.since, f.episodeId);
  return f;
}
function calls(f) {
  return {
    revision: () => f.core.listMemoriesByTime({ ...range, timeBasis: 'revision' }),
    receipt: () => f.core.listMemoriesByTime({ ...range, timeBasis: 'receipt' }),
  };
}
// The other SQLite connection lives in a child process. No raw DB descriptors
// are opened here. For forget, the real public mutation runs unchanged and only
// its final COMMIT is deferred by a test hook until the parent asks for it.
const writerSource = String.raw`
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';
const [moduleURL, path, mode, serialized, marker] = process.argv.slice(1);
let db, core;
if (mode === 'forget') {
  const { openMemoryCore } = await import(moduleURL);
  core = openMemoryCore({ path });
  const exec = DatabaseSync.prototype.exec;
  let defer = true;
  DatabaseSync.prototype.exec = function(sql) {
    if (defer && sql === 'COMMIT') { db = this; return; }
    return exec.call(this, sql);
  };
  const result = core.forget(JSON.parse(serialized));
  defer = false;
  DatabaseSync.prototype.exec = exec;
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(db.isTransaction, true);
} else {
  db = new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
}
process.send({ type: 'ready' });
process.on('message', command => {
  if (command === 'commit') {
    // A zero-timeout probe proves A already holds SHARED. Then the real
    // blocking commit must remain pending until that exact snapshot releases.
    db.exec('PRAGMA busy_timeout=0');
    assert.throws(() => db.exec('COMMIT'), error => (error.errcode & 255) === 5);
    db.exec('PRAGMA busy_timeout=5000');
    writeFileSync(marker, 'busy', { flag: 'wx' });
    const start = performance.now();
    db.exec('COMMIT');
    const elapsedMs = performance.now() - start;
    writeFileSync(marker + '.committed', 'committed', { flag: 'wx' });
    process.send({ type: 'committed', elapsedMs });
  } else if (command === 'close') {
    if (db.isTransaction) db.exec('ROLLBACK');
    if (core) core.close(); else db.close();
    process.disconnect();
  }
});
`;

async function writer(f, mode = 'hold', memory) {
  const marker = join(f.workspace.path, 'commit-probe');
  const child = spawn(process.execPath, ['--input-type=module', '--eval', writerSource,
    new URL('../contract.mjs', import.meta.url).href, f.path, mode,
    JSON.stringify({ namespace, memoryId: memory?.id, expectedRevision: memory?.revision }), marker],
  { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  const messages = [];
  child.on('message', message => messages.push(message));
  const ended = once(child, 'exit');
  f.workspace.defer(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await ended;
  });
  async function wait(type) {
    const deadline = Date.now() + 15_000;
    while (true) {
      const message = messages.find(message => message.type === type);
      if (message) return message;
      assert.equal(child.exitCode, null, stderr);
      assert.equal(child.signalCode, null, stderr);
      assert.ok(Date.now() < deadline, 'child rendezvous timed out: ' + stderr);
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  }
  await wait('ready');
  return { marker, wait, send: command => child.send(command), async close() {
    child.send('close');
    const [code, signal] = await ended;
    assert.equal(signal, null, stderr);
    assert.equal(code, 0, stderr);
  } };
}


for (const name of ['revision', 'receipt']) {
  test(name + ' returns the identical page under RESERVED', async t => {
    const f = await fixture(t), call = calls(f)[name], expected = call();
    assert.ok(ok(expected).items.some(item => item.memory.id === f.memory.id));
    const other = await writer(f), start = performance.now(), actual = call(), elapsedMs = performance.now() - start;
    t.diagnostic(JSON.stringify({ name, elapsedMs, busyTimeoutMs: STORAGE_BUSY_TIMEOUT_MS, ok: actual.ok, error: actual.error }));
    await other.close();
    assert.deepEqual(actual, expected);
    assert.ok(elapsedMs < STORAGE_BUSY_TIMEOUT_MS / 3, name + ' waited behind RESERVED');
  });
}

test('suppression-enabled world pages proceed under RESERVED and fail closed after a committed fact', async t => {
  const f = await fixture(t, true), readers = calls(f);
  const expected = Object.fromEntries(Object.entries(readers).map(([name, call]) => [name, call()]));
  for (const page of Object.values(expected)) ok(page);
  const other = await writer(f), timings = {};
  for (const [name, call] of Object.entries(readers)) {
    const start = performance.now();
    assert.deepEqual(call(), expected[name], name);
    timings[name] = performance.now() - start;
    assert.ok(timings[name] < STORAGE_BUSY_TIMEOUT_MS / 3);
  }
  await other.close();
  t.diagnostic(JSON.stringify({ scenario: 'suppression-enabled RESERVED', timings }));
  transaction(f.db, () => writeContentSuppressionInside(f.db, { namespace: ns, kind: 'memory',
    key: f.memory.id, reason: 'purge', actionId: 'synthetic-world-fact' }));
  for (const call of Object.values(readers)) assert.equal(call().ok, false);
});

test('uncommitted forget returns pre-forget world pages and COMMIT waits for the range snapshot', async t => {
  const f = await fixture(t), readers = calls(f);
  const expected = Object.fromEntries(Object.entries(readers).map(([name, call]) => [name, call()]));
  const other = await writer(f, 'forget', f.memory), timings = {};
  for (const [name, call] of Object.entries(readers)) {
    const start = performance.now();
    assert.deepEqual(call(), expected[name], name);
    timings[name] = performance.now() - start;
    assert.ok(timings[name] < STORAGE_BUSY_TIMEOUT_MS / 3);
  }
  let injected = false;
  const prepare = DatabaseSync.prototype.prepare;
  const mock = t.mock.method(DatabaseSync.prototype, 'prepare', function(sql) {
    const statement = prepare.call(this, sql);
    if (!injected && sql.startsWith('SELECT m.* FROM memories m INDEXED BY namespace_memories')) {
      const all = statement.all.bind(statement);
      statement.all = (...args) => {
        const rows = all(...args); // SELECT has acquired SHARED on this snapshot.
        injected = true;
        other.send('commit');
        const deadline = Date.now() + 3000;
        while (!existsSync(other.marker)) {
          assert.ok(Date.now() < deadline, 'writer did not prove COMMIT was blocked');
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
        }
        assert.equal(readFileSync(other.marker, 'utf8'), 'busy');
        assert.equal(existsSync(other.marker + '.committed'), false);
        assert.equal(this.isTransaction, true);
        return rows;
      };
    }
    return statement;
  });
  const snapshot = readers.revision();
  mock.mock.restore();
  assert.equal(injected, true);
  assert.deepEqual(snapshot, expected.revision);
  const committed = await other.wait('committed');
  t.diagnostic(JSON.stringify({ scenario: 'uncommitted forget', timings, commitWaitMs: committed.elapsedMs, busyProbe: true }));
  await other.close();
  for (const call of Object.values(readers)) {
    assert.ok(!ok(call()).items.some(item => item.memory.id === f.memory.id));
  }
  const blocked = f.core.admit({ namespace, memory: { content: f.memory.content, kind: 'instruction' },
    receipts: [{ client: 'synthetic', sessionId: 'world', eventId: 'again', role: 'user', excerpt: 'Synthetic evidence' }] });
  assert.equal(blocked.error?.code, 'memory_suppressed');
});


test('exhaustive world reads and episode detail staging retain IMMEDIATE acquisition', async t => {
  const f = await fixture(t), begins = [], exec = DatabaseSync.prototype.exec;
  const mock = t.mock.method(DatabaseSync.prototype, 'exec', function(sql) {
    if (sql.startsWith('BEGIN')) begins.push(sql);
    return exec.call(this, sql);
  });
  const readers = {
    map: () => f.core.map({ namespace }),
    sourceSnapshot: () => f.core.sourceSnapshot({ readSet: [namespace] }),
    sessionStartContext: () => f.core.sessionStartContext({ namespace }),
    listReviewTransitions: () => f.core.listReviewTransitions({ namespace }),
    listReviewConflicts: () => f.core.listReviewConflicts({ namespace }),
    listEpisodes: () => f.core.listEpisodes(range),
    getEpisode: () => f.core.getEpisode({ namespace, episodeId: f.episodeId }),
  };
  for (const [name, call] of Object.entries(readers)) {
    begins.length = 0;
    ok(call());
    assert.ok(begins.includes('BEGIN IMMEDIATE'), name);
  }
  mock.mock.restore();
});

test('migrated world bodies execute with SQLite query_only enforced', async t => {
  const f = await fixture(t, true), exec = DatabaseSync.prototype.exec, connections = new Set();
  const mock = t.mock.method(DatabaseSync.prototype, 'exec', function(sql) {
    if (sql === 'BEGIN') { exec.call(this, 'PRAGMA query_only=ON'); connections.add(this); }
    return exec.call(this, sql);
  });
  try {
    for (const [name, call] of Object.entries(calls(f))) ok(call());
  } finally {
    mock.mock.restore();
    for (const db of connections) exec.call(db, 'PRAGMA query_only=OFF');
  }
  assert.ok(connections.size > 0);
});
