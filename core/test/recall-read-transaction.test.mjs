import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { readTransaction, transaction, STORAGE_BUSY_TIMEOUT_MS } from '../database.mjs';
import { createMockRecallModel } from '../testing/mock-recall-model.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';

const namespace = { ownerId: 'synthetic-recall-read', scope: 'personal', projectId: null };
const ns = { ...namespace, projectId: '' };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const select = ({ input }) => ({ refs: input.maps.flatMap(page => page.items.map(item => ({
  namespaceIndex: page.namespaceIndex, ...(item.type === 'unfiled' ? item.ref
    : { memoryId: item.ref.childId, revision: item.ref.childRevision }),
}))) });
const rank = ({ input }) => ({ refs: input.candidates.slice(0, input.limit).map(candidate => ({
  namespaceIndex: candidate.namespaceIndex, memoryId: candidate.memory.id, revision: candidate.memory.revision,
})) });
const recall = core => core.recall({ readSet: [namespace], query: 'Synthetic protocol notes' });
const receipt = content => ({ client: 'synthetic', sessionId: 'read-test', eventId: content, role: 'user', excerpt: content });
function admit(core, content = 'Synthetic protocol note') {
  const saved = ok(core.admit({ namespace, memory: { content, kind: 'fact' }, receipts: [receipt(content)] })).memory;
  return ok(core.get({ namespace, memoryId: saved.id })).memory;
}

function fixture(t, options = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'recall-read-' });
  const path = join(workspace.path, 'canonical.sqlite');
  const model = createMockRecallModel({ select: Array(20).fill(select), rank: Array(20).fill(rank), ...options });
  const core = openMemoryCore({ path, model });
  workspace.defer(() => core.close());
  let db;
  const runtime = createMemoryRuntime({ path }, { attachRaw(connection) { db = connection; } });
  workspace.defer(() => runtime.close());
  assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'delete');
  return { workspace, path, core, model, runtime, db };
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

function helperCalls(f, memory) {
  const ref = { memoryId: memory.id, revision: memory.revision };
  return {
    queryCandidateRows: () => f.runtime.queryCandidateRows(ns, { score: () => 1, memoryLabel: text => text }),
    assertEpoch: () => f.runtime.assertEpoch(ns, f.runtime.epoch(ns)),
    listPage: () => f.runtime.listPage(ns, ['filed', 'unfiled'], 10),
    getPage: () => f.runtime.getPage(ns, memory.id, 10),
    fetchPage: () => f.runtime.fetchPage(ns, ref, 0),
    recentReceipts: () => f.runtime.recentReceipts(ns, ref, 10),
    recallSnapshot: () => f.runtime.recallSnapshot([{ namespace: ns, ...ref, receiptLimit: 10 }], [0]),
  };
}

test('recall and all seven helpers proceed under RESERVED without waiting for the busy timeout', async t => {
  const f = fixture(t), memory = admit(f.core), calls = helperCalls(f, memory);
  const expected = await recall(f.core);
  ok(expected);
  const pages = Object.fromEntries(Object.entries(calls).map(([name, call]) => [name, call()]));
  const other = await writer(f);
  const start = performance.now();
  const actual = await recall(f.core);
  const elapsedMs = performance.now() - start;
  t.diagnostic(JSON.stringify({ scenario: 'RESERVED recall', elapsedMs, busyTimeoutMs: STORAGE_BUSY_TIMEOUT_MS, ok: actual.ok, error: actual.error }));
  assert.deepEqual(actual, expected);
  assert.ok(elapsedMs < STORAGE_BUSY_TIMEOUT_MS / 3, 'recall waited behind RESERVED');
  for (const [name, call] of Object.entries(calls)) {
    const start = performance.now();
    assert.deepEqual(call(), pages[name], name);
    assert.ok(performance.now() - start < STORAGE_BUSY_TIMEOUT_MS / 3, name + ' waited behind RESERVED');
  }
  await other.close();
});

test('committed forget stays hidden and suppression prevents readmission', async t => {
  const f = fixture(t), memory = admit(f.core);
  assert.equal(ok(await recall(f.core)).memories[0].memory.id, memory.id);
  ok(f.core.forget({ namespace, memoryId: memory.id, expectedRevision: memory.revision }));
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM suppressed').get().n, 1);
  assert.equal(f.db.prepare('SELECT deleted FROM memories WHERE id=?').get(memory.id).deleted, 1);
  const blocked = f.core.admit({ namespace, memory: { content: memory.content, kind: 'fact' }, receipts: [receipt(memory.content)] });
  assert.equal(blocked.error?.code, 'memory_suppressed');
  assert.deepEqual(ok(await recall(f.core)).memories, []);
  assert.deepEqual(f.runtime.recallSnapshot([], []), []);
  assert.throws(() => f.runtime.recallSnapshot([{ namespace: ns, memoryId: memory.id, revision: memory.revision }], [0]),
    { code: 'revision_conflict' });
});

test('a committed revision change between map and finalize still fails with revision_conflict', async t => {
  let memory;
  const f = fixture(t, { rank: [request => {
    ok(f.core.correct({ namespace, memoryId: memory.id, expectedRevision: memory.revision,
      content: 'Synthetic corrected protocol', kind: 'fact', receipt: receipt('Synthetic correction') }));
    return rank(request);
  }] });
  memory = admit(f.core);
  assert.deepEqual(await recall(f.core), { ok: false, error: { code: 'revision_conflict', retryable: false } });
});

test('uncommitted forget permits pre-forget recall; its commit waits for the same read snapshot to release', async t => {
  const f = fixture(t), memory = admit(f.core), expected = await recall(f.core);
  const other = await writer(f, 'forget', memory);
  const start = performance.now();
  assert.deepEqual(await recall(f.core), expected);
  const recallMs = performance.now() - start;
  assert.ok(recallMs < STORAGE_BUSY_TIMEOUT_MS / 3);
  let injected = false;
  const prepare = f.db.prepare.bind(f.db);
  const mock = t.mock.method(f.db, 'prepare', sql => {
    const statement = prepare(sql);
    if (!injected && sql.startsWith('SELECT * FROM memories WHERE')) {
      const get = statement.get.bind(statement);
      statement.get = (...args) => {
        const row = get(...args); // Establish the snapshot's SHARED lock first.
        injected = true;
        other.send('commit');
        const deadline = Date.now() + 3000;
        while (!existsSync(other.marker)) {
          assert.ok(Date.now() < deadline, 'writer did not prove commit was blocked');
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
        }
        assert.equal(readFileSync(other.marker, 'utf8'), 'busy');
        assert.equal(existsSync(other.marker + '.committed'), false);
        assert.equal(f.db.isTransaction, true);
        return row;
      };
    }
    return statement;
  });
  const snapshot = f.runtime.recallSnapshot([{ namespace: ns, memoryId: memory.id,
    revision: memory.revision, receiptLimit: 10 }], [0]);
  mock.mock.restore();
  assert.equal(injected, true);
  assert.equal(snapshot[0].memory.id, memory.id);
  assert.equal(snapshot[0].memory.content, memory.content);
  assert.deepEqual(snapshot[0].receipts, ok(expected).memories[0].receipts);
  const committed = await other.wait('committed');
  t.diagnostic(JSON.stringify({ scenario: 'uncommitted forget', recallMs,
    commitWaitMs: committed.elapsedMs, busyProbe: true, preForgetSnapshotReturned: true }));
  assert.equal(readFileSync(other.marker + '.committed', 'utf8'), 'committed');
  assert.deepEqual(ok(await recall(f.core)).memories, []);
  await other.close();
});

test('every switched helper rejects nesting and returns only materialized plain results', t => {
  const f = fixture(t), memory = admit(f.core);
  for (const [name, call] of Object.entries(helperCalls(f, memory))) {
    const value = call(); // Each helper's readTransaction runs materializedRead.
    assert.deepEqual(readTransaction(f.db, () => value), value, name);
    transaction(f.db, () => {
      assert.throws(call, { code: 'storage_error' }, name);
      assert.equal(f.db.isTransaction, true);
    });
    assert.equal(f.db.prepare('PRAGMA query_only').get().query_only, 0);
    assert.equal(f.db.isTransaction, false);
  }
  let ran = false;
  assert.throws(() => readTransaction(f.db, async () => { ran = true; }), { code: 'storage_error' });
  assert.equal(ran, false);
  // Promise-returning ordinary functions are rejected too, discarding their
  // connection as specified; keep that test isolated from the runtime handle.
  const db = new DatabaseSync(':memory:');
  assert.throws(() => readTransaction(db, () => Promise.resolve({})), { code: 'storage_error' });
  assert.equal(db.isOpen, false);
});

test('all migrated helpers retain the installed safety check inside the read snapshot', async t => {
  const f = safetyFixture(t);
  await f.migrate();
  f.core = openMemoryCore({ path: f.path });
  f.workspace.defer(() => f.core.close());
  const memory = admit(f.core);
  f.runtime = createMemoryRuntime({ path: f.path }, { attachRaw(db) { f.db = db; } });
  f.workspace.defer(() => f.runtime.close());
  const other = f.connect();
  f.workspace.defer(() => other.close());
  other.exec('DROP TRIGGER safety_memories_insert');
  for (const [name, call] of Object.entries(helperCalls(f, memory))) {
    assert.throws(call, { code: 'unsupported_database' }, name);
    assert.equal(f.db.isTransaction, false);
    assert.equal(f.db.prepare('PRAGMA query_only').get().query_only, 0);
  }
});
