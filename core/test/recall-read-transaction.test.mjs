import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { readTransaction, transaction, STORAGE_BUSY_TIMEOUT_MS } from '../database.mjs';
import { createMockRecallModel } from '../testing/mock-recall-model.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { createHash } from 'node:crypto';
import { boundedText, fingerprint } from '../validation.mjs';
import { createQueryScore, QUERY_CANDIDATES } from '../query-candidates.mjs';
import { withContentSuppressionRequest, writeContentSuppressionInside } from '../content-suppression-storage.mjs';
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
    ...(f.suppressionEnabled ? { suppressionFence: () => f.runtime.suppressionFence(ns) } : {}),
    assertEpoch: () => f.runtime.assertEpoch(ns, f.runtime.epoch(ns)),
    listPage: () => f.runtime.listPage(ns, ['filed', 'unfiled'], 10),
    getPage: () => f.runtime.getPage(ns, memory.id, 10),
    fetchPage: () => f.runtime.fetchPage(ns, ref, 0),
    recentReceipts: () => f.runtime.recentReceipts(ns, ref, 10),
    recallSnapshot: () => f.runtime.recallSnapshot([{ namespace: ns, ...ref, receiptLimit: 10 }], [0]),
  };
}

// Conservative source tripwire, like the split capability audit: reject every
// unreviewed spelling of the option, including aliases/options in other modules.
// This is not an adversarial JS analyzer (computed/eval spellings need review).
function productionSources() {
  const root = new URL('../../', import.meta.url).pathname, sources = new Map();
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (['.git', '.research-private', 'node_modules', 'test', 'testing', 'fixtures'].includes(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (/\.(?:[cm]?js|ts)$/.test(entry.name)) sources.set(relative(root, path), readFileSync(path, 'utf8'));
    }
  }
  visit(root);
  return sources;
}

const deferredReaders = [
  ['core/moc-storage.mjs', 'queryCandidateRows', '  function queryCandidateRows(', '\n  function mapRows',
    'transaction(db, work, undefined, { deferred: true })'],
  ['core/moc-storage.mjs', 'suppressionFence', '    suppressionFence(ns)', '\n    assertEpoch(',
    '? transaction(db, () => suppressionEpochInside(ns), undefined, { deferred: true }) : null; },'],
  ['core/moc-storage.mjs', 'assertEpoch', '    assertEpoch(ns, expected, suppressionEpoch)', '\n}',
    '}, undefined, { deferred: true }); } });'],
  ['core/episode-reads.mjs', 'read', '  return function read(', '\n  };',
    '}, undefined, { deferred: true });'],
  ['core/moc-storage.mjs', 'classificationSnapshot', '  function classificationSnapshot(', '\n  function placementRefs(',
    '}, undefined, { deferred: true });'],
  ['core/session-context.mjs', 'snapshot', '  return function snapshot(', '\n  };',
    '}, undefined, { deferred: true });'],
  ...['listReviewConflicts', 'listReviewTransitions'].map(name =>
    ['core/runtime.mjs', name, '    ' + name + '(', '\n    },', '}, undefined, { deferred: true });']),
  ...['listPage', 'getPage', 'recentReceipts', 'fetchPage', 'sourceSnapshot', 'recallSnapshot'].map(name =>
    ['core/runtime.mjs', name, '  function ' + name + '(', '\n  }', '}, undefined, { deferred: true });']),
];

function assertDeferredAllowlist(sources) {
  const allowed = new Map(), sites = [];
  const permit = (file, offset) => {
    const offsets = allowed.get(file) ?? new Set(); offsets.add(offset); allowed.set(file, offsets);
  };
  // Reviewed R2i routing guard: the mode declaration, write-route check and
  // BEGIN selector inspect this option; none forwards it to a new mode sink.
  const database = sources.get('core/database.mjs');
  for (const text of ['export function transaction(db, work, check, { deferred = false } = {}) {',
    "    if (!deferred) assertCommitWriteRouted(db, 'transaction');",
    '    db.exec(deferred ? "BEGIN" : "BEGIN IMMEDIATE");']) {
    const start = database.indexOf(text);
    assert.ok(start >= 0 && database.indexOf(text, start + 1) < 0, 'unique transaction mode implementation');
    permit('core/database.mjs', start + text.indexOf('deferred'));
  }
  for (const [file, name, first, last, option] of deferredReaders) {
    const source = sources.get(file), start = source.indexOf(first);
    assert.ok(start >= 0 && source.indexOf(first, start + 1) < 0, 'unique read helper: ' + name);
    const end = source.indexOf(last, start + first.length);
    assert.ok(end > start, 'read helper boundary: ' + name);
    const region = source.slice(start, end), index = region.indexOf(option);
    assert.ok(index >= 0 && region.indexOf(option, index + 1) < 0, 'exact deferred call: ' + file + ':' + name);
    assert.match(region, name === 'queryCandidateRows' ? /transaction\(db, work, undefined, \{ deferred: true \}\)/
      : /\breturn transaction\(db,|\? transaction\(db,/, 'read helper directly calls transaction');
    permit(file, start + index + option.indexOf('deferred'));
    sites.push(file + ':' + name);
  }
  for (const [file, source] of sources) for (const match of source.matchAll(/\bdeferred\b/g)) {
    const line = source.slice(source.lastIndexOf('\n', match.index) + 1, match.index);
    if (/^\s*(?:\/\/|\*)/.test(line)) continue; // prose comments are not option uses
    assert.ok(allowed.get(file)?.has(match.index), 'unreviewed deferred transaction use: ' + file + ':' +
      source.slice(0, match.index).split('\n').length);
  }
  return sites;
}

test('deferred transaction call-site allowlist covers exactly the fourteen reviewed read sites', t => {
  const sources = productionSources(), sites = assertDeferredAllowlist(sources);
  assert.equal(sites.length, 14);
  t.diagnostic(JSON.stringify({ productionModules: sources.size, deferredReaders: sites }));
});

test('deferred transaction allowlist rejects an injected writer and an extra call inside an allowed helper', t => {
  const sources = productionSources();
  sources.set('core/unreviewed-writer.mjs', `import { transaction } from './database.mjs';
export function write(db) { return transaction(db, () => db.exec('DELETE FROM memories'), undefined, { deferred: true }); }`);
  assert.throws(() => assertDeferredAllowlist(sources), /unreviewed deferred transaction use: core\/unreviewed-writer.mjs/);
  sources.delete('core/unreviewed-writer.mjs');
  for (const name of ['read', 'classificationSnapshot', 'snapshot', 'sourceSnapshot', 'listReviewConflicts', 'listReviewTransitions']) {
    const [file, , first] = deferredReaders.find(site => site[1] === name);
    const original = sources.get(file), body = original.indexOf('{', original.indexOf(first));
    sources.set(file, original.slice(0, body + 1) +
      '\n    transaction(db, () => null, undefined, { deferred: true });' + original.slice(body + 1));
    assert.throws(() => assertDeferredAllowlist(sources), /unreviewed deferred transaction use/, name);
    t.diagnostic('rejected injected extra deferred site: ' + file + ':' + name);
    sources.set(file, original);
  }
});

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
    if (!injected && sql.startsWith('SELECT memories.*') && sql.includes('FROM memories WHERE')) {
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

test('every switched helper retains transaction nesting refusal and returns plain results', t => {
  const f = fixture(t), memory = admit(f.core);
  for (const [name, call] of Object.entries(helperCalls(f, memory))) {
    const value = call(); // Validate actual read results independently of the wrapper.
    assert.deepEqual(readTransaction(f.db, () => value), value, name);
    transaction(f.db, () => {
      assert.throws(call, error => error.code === 'ERR_SQLITE_ERROR' &&
        /within a transaction/.test(error.message), name);
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
  f.suppressionEnabled = true;
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

// These stores exercise main's suppression epoch and request context as well as
// the legacy forget tombstone covered above. The writer holds only RESERVED.
test('suppression-enabled recall and fence proceed under RESERVED with identical results', async t => {
  const f = safetyFixture(t);
  f.suppressionEnabled = true;
  await f.migrate();
  f.core = openMemoryCore({ path: f.path, model: createMockRecallModel({
    select: Array(20).fill(select), rank: Array(20).fill(rank) }) });
  f.workspace.defer(() => f.core.close());
  const memory = admit(f.core);
  f.runtime = createMemoryRuntime({ path: f.path }, { attachRaw(db) { f.db = db; } });
  f.workspace.defer(() => f.runtime.close());
  const calls = helperCalls(f, memory), expected = await recall(f.core);
  ok(expected);
  const pages = withContentSuppressionRequest(() => Object.fromEntries(
    Object.entries(calls).map(([name, call]) => [name, call()])));
  assert.equal(pages.suppressionFence, '0:0');
  transaction(f.db, () => assert.throws(() => f.runtime.suppressionFence(ns),
    error => error.code === 'ERR_SQLITE_ERROR' && /within a transaction/.test(error.message)));
  const other = await writer(f), start = performance.now();
  assert.deepEqual(await recall(f.core), expected);
  withContentSuppressionRequest(() => {
    for (const [name, call] of Object.entries(calls)) assert.deepEqual(call(), pages[name], name);
  });
  const elapsedMs = performance.now() - start;
  assert.ok(elapsedMs < STORAGE_BUSY_TIMEOUT_MS / 3);
  t.diagnostic(JSON.stringify({ scenario: 'suppression-enabled RESERVED reads', elapsedMs }));
  await other.close();
  // A fact-only change advances no namespace epoch. Both independent fences
  // must still detect it, and the content must disappear from recall.
  const index = f.runtime.epoch(ns), fence = f.runtime.suppressionFence(ns);
  transaction(f.db, () => writeContentSuppressionInside(f.db, { namespace: ns,
    kind: 'memory', key: memory.id, reason: 'purge', actionId: 'synthetic-fact-only' }));
  assert.equal(f.runtime.epoch(ns), index);
  assert.notEqual(f.runtime.suppressionFence(ns), fence);
  assert.throws(() => f.runtime.assertEpoch(ns, index, fence), { code: 'cursor_stale' });
  assert.throws(() => f.runtime.recallSnapshot([], [], [{ namespace: ns,
    indexRevision: index, suppressionEpoch: fence }]), { code: 'index_revision_conflict' });
  assert.deepEqual(ok(await recall(f.core)).memories, []);
});

// Public capture writes its real Memory/receipt rows before parking at COMMIT.
// Only marker files have raw descriptors; the SQLite holder is a child process.
const captureWriterSource = String.raw`
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, writeFileSync } from 'node:fs';
const [moduleURL, path, marker, serialized] = process.argv.slice(1);
const { openMemoryCore } = await import(moduleURL);
const namespace = JSON.parse(serialized);
const core = openMemoryCore({ path, model: { contextWindow: 8192, countTokens: () => 1,
  extract: async () => ({ items: [{ content: 'Synthetic pending capture', kind: 'fact',
    confidence: .7, sourceIndices: [0] }] }) } });
const nativeExec = DatabaseSync.prototype.exec, nativePrepare = DatabaseSync.prototype.prepare;
let memoryWrite = false, held = false, connection, commitMs, commitError;
DatabaseSync.prototype.prepare = function(sql) {
  const statement = nativePrepare.call(this, sql);
  if (sql.startsWith('INSERT INTO memories')) {
    const run = statement.run.bind(statement);
    statement.run = (...args) => { const result = run(...args); memoryWrite = true; return result; };
  }
  return statement;
};
DatabaseSync.prototype.exec = function(sql) {
  if (sql === 'COMMIT' && memoryWrite && !held) {
    held = true; connection = this;
    assert.equal(this.isTransaction, true);
    writeFileSync(marker + '.reserved', '{}', { flag: 'wx' });
    process.send('ready');
    const deadline = Date.now() + 20000;
    while (!existsSync(marker + '.go')) {
      assert.ok(Date.now() < deadline, 'reader did not release capture commit');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
    }
    const start = performance.now();
    try { return nativeExec.call(this, sql); }
    catch (error) { commitError = error.errcode; throw error; }
    finally { commitMs = performance.now() - start; }
  }
  return nativeExec.call(this, sql);
};
process.on('message', command => {
  if (command === 'close') { core.close(); process.disconnect(); }
});
const result = await core.capture({ namespace, client: 'synthetic', sessionId: 'capture',
  eventId: 'pending', messages: [{ id: 'message', role: 'user', content: 'Synthetic pending capture source' }] });
const persisted = connection.prepare("SELECT count(*) AS n FROM memories WHERE content='Synthetic pending capture'").get().n;
writeFileSync(marker + '.done', JSON.stringify({ result, persisted, commitMs, commitError }), { flag: 'wx' });
process.send('done');
`;

test('a real capture holding RESERVED commits before a maximum bounded-keyset scan', async t => {
  const f = fixture(t), count = QUERY_CANDIDATES.scan;
  assert.equal(count, 20000);
  const body = ('Ω Σ '.repeat(1000)).slice(0, 3970), excerpt = ('Ω Σ '.repeat(200)).slice(0, 799);
  // Canonical normalized maximal-size inputs reproduce the review's slow scan
  // without sleeping inside the reader or shortening the writer's busy timeout.
  transaction(f.db, () => {
    const memory = f.db.prepare(`INSERT INTO memories(id,owner_id,scope,project_id,fingerprint,content,kind,origin,confidence,revision,created_at,updated_at)
      VALUES(?,?,?,'',?,?,'fact','explicit',1,1,'2026-01-01','2026-01-01')`);
    const receipt = f.db.prepare(`INSERT INTO receipts(id,memory_id,receipt_key,client,session_id,event_id,role,excerpt,created_at)
      VALUES(?,?,?,'synthetic','keyset',?,'user',?,'2026-01-01')`);
    for (let i = 0; i < count; i++) {
      const id = '!m-' + String(i).padStart(6, '0'), content = boundedText(body + ' ' + id, 4000);
      assert.equal(boundedText(content, 4000), content);
      assert.equal(boundedText(excerpt, 800), excerpt);
      memory.run(id, ns.ownerId, ns.scope, fingerprint(content), content);
      for (let j = 0; j < 4; j++) {
        const rid = id + '-' + j, source = { client: 'synthetic', sessionId: 'keyset', eventId: rid, role: 'user', excerpt };
        receipt.run(rid, id, createHash('sha256').update(JSON.stringify(source)).digest('hex'), rid, excerpt);
      }
    }
  });
  const marker = join(f.workspace.path, 'capture-commit'), messages = [];
  const child = spawn(process.execPath, ['--input-type=module', '--eval', captureWriterSource,
    new URL('../contract.mjs', import.meta.url).href, f.path, marker, JSON.stringify(namespace)],
  { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  child.on('message', message => messages.push(message));
  const ended = once(child, 'exit');
  f.workspace.defer(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await ended;
  });
  async function wait(message) {
    const deadline = Date.now() + 25000;
    while (!messages.includes(message)) {
      assert.equal(child.exitCode, null, stderr);
      assert.equal(child.signalCode, null, stderr);
      assert.ok(Date.now() < deadline, 'capture rendezvous timed out: ' + stderr);
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  }
  await wait('ready');
  assert.equal(existsSync(marker + '.reserved'), true);
  assert.equal(existsSync(marker + '.done'), false);
  let released = false, acquisition;
  const release = () => { assert.equal(released, false); released = true; writeFileSync(marker + '.go', '{}', { flag: 'wx' }); };
  const exec = f.db.exec.bind(f.db), prepare = f.db.prepare.bind(f.db);
  const execMock = t.mock.method(f.db, 'exec', sql => {
    // With IMMEDIATE, let the existing writer COMMIT while acquisition waits.
    // A deferred reader instead releases it after establishing SHARED below.
    if (!acquisition && (sql === 'BEGIN IMMEDIATE' || sql === 'BEGIN')) {
      acquisition = sql;
      if (sql === 'BEGIN IMMEDIATE') release();
    }
    return exec(sql);
  });
  const prepareMock = t.mock.method(f.db, 'prepare', sql => {
    const statement = prepare(sql);
    if (sql.includes('SELECT active_generation')) {
      const get = statement.get.bind(statement);
      statement.get = (...args) => { const row = get(...args); if (!released) release(); return row; };
    }
    return statement;
  });
  let scored = 0;
  const score = createQueryScore('ω σ'), start = performance.now();
  const page = f.runtime.queryCandidateRows(ns, { sourceReceiptLimit: 4,
    score: text => { scored++; return score(text); }, memoryLabel: () => 'Synthetic keyset label' });
  const scanMs = performance.now() - start;
  execMock.mock.restore(); prepareMock.mock.restore();
  await wait('done');
  const outcome = JSON.parse(readFileSync(marker + '.done', 'utf8'));
  t.diagnostic(JSON.stringify({ scenario: 'real capture COMMIT versus max keyset', count, scored, acquisition, scanMs, ...outcome }));
  // Assert the public mutation and its persisted row, not a raw COMMIT probe.
  assert.equal(outcome.result.ok, true, JSON.stringify(outcome));
  assert.equal(outcome.persisted, 1);
  assert.equal(outcome.commitError, undefined);
  assert.equal(acquisition, 'BEGIN');
  assert.ok(scored >= QUERY_CANDIDATES.floor * 5, 'body and four-receipt scan floor did not run');
  assert.equal(page.rows.length, QUERY_CANDIDATES.top);
  child.send('close');
  const [code, signal] = await ended;
  assert.equal(signal, null, stderr); assert.equal(code, 0, stderr);
});
