import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { copyFileSync, writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';
import { coreFixture, query, refresh, policy, ns, foreign, ok, denied, receipt, openContextReader, waitForContextEntry } from '../testing/context-read-core-fixture.mjs';
import { observeDatabaseFiles } from '../testing/context-read-fixture.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { createFakeEmbedder } from '../context-read-embedder.mjs';
import { openContextCore } from '../context-read-facade.mjs';
import { openMemoryCore } from '../index.mjs';

test('review 2: lookup and refresh expose sanitized rebuild reasons and publication states', async t => {
  for (const method of ['findCandidates', 'refreshContextIndex']) for (const reason of ['missing', 'corrupt', 'wrong-store', 'incompatible']) {
    const f = coreFixture(t); f.admit('apple rebuild');
    if (reason !== 'missing') {
      ok(await f.call('findCandidates', query())); f.context.close();
      const path = f.path + '.context-read-v1.sqlite';
      if (reason === 'corrupt') writeFileSync(path, 'synthetic corrupt cache');
      else {
        const db = new DatabaseSync(path);
        try {
          if (reason === 'wrong-store') db.prepare('UPDATE generations SET store_id=?').run('foreign-synthetic-store');
          else db.exec('PRAGMA user_version=99');
        } finally { db.close(); }
      }
      f.reopen();
    }
    const value = ok(await f.call(method, method === 'findCandidates' ? query({ deadlineMs: 5000 }) : refresh()));
    assert.equal(value.coverage.maintenance.reason, reason);
    assert.equal(value.coverage.maintenance.buildState, 'rebuilt');
    assert.equal(value.coverage.maintenance.state, 'ready');
    const reader = openContextReader({ path: f.path, contextRead: f.config });
    try {
      const read = ok(await f.trusted.call(reader, 'findCandidates', query()));
      assert.equal(read.coverage.maintenance.reason, reason); assert.equal(read.coverage.maintenance.buildState, 'rebuilt');
    } finally { reader.close(); }
  }
});

test('review 2: incomplete refresh reports item-budget stops and no unverified counts', async t => {
  const f = coreFixture(t); for (let i = 0; i < 3; i++) f.admit('apple partial ' + i);
  const value = ok(await f.call('refreshContextIndex', refresh({ budget: { maxItems: 1, maxMs: 5000 } })));
  assert.equal(value.status, 'rebuilding'); assert.equal(value.coverage.maintenance.reason, 'missing');
  assert.equal(value.coverage.maintenance.buildState, 'rebuilding'); assert.equal(value.coverage.stops.budget, true);
  assert.equal(value.coverage.byType.memory.eligible, null);
});

test('review 2: deadline exhaustion during a metadata scan is reported on both rebuilding paths', async t => {
  const originalPrepare = DatabaseSync.prototype.prepare, descriptor = Object.getOwnPropertyDescriptor(performance, 'now');
  const now = performance.now.bind(performance); let offset = 0;
  try {
    for (const method of ['findCandidates', 'refreshContextIndex']) {
      DatabaseSync.prototype.prepare = originalPrepare;
      if (descriptor) Object.defineProperty(performance, 'now', descriptor); else delete performance.now;
      offset = 0;
      const f = coreFixture(t); f.admit('apple initial'); ok(await f.call('findCandidates', query())); f.admit('apple changed');
      Object.defineProperty(performance, 'now', { configurable: true, value: () => now() + offset });
      DatabaseSync.prototype.prepare = function(sql) {
        const statement = originalPrepare.call(this, sql);
        if (!/FROM memories INDEXED/.test(sql)) return statement;
        return { all(...args) { const rows = statement.all(...args); offset = 6000; return rows; } };
      };
      const result = await f.call(method, method === 'findCandidates' ? query({ deadlineMs: 5000 }) : refresh());
      const value = method === 'findCandidates' ? (denied(result, 'index_unavailable'), result.error.details) : ok(result);
      assert.equal(value.coverage.maintenance.buildState, 'rebuilding'); assert.equal(value.coverage.stops.deadline, true);
    }
  } finally {
    DatabaseSync.prototype.prepare = originalPrepare;
    if (descriptor) Object.defineProperty(performance, 'now', descriptor); else delete performance.now;
  }
});

test('R09/R12 review 3: the filesystem monitor detects creation and deletion of both databases and every auxiliary', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'context-monitor-control-' }), f = { workspace, path: join(workspace.path, 'canonical.sqlite') };
  for (const database of [f.path, f.path + '.context-read-v1.sqlite']) for (const suffix of ['', '-journal', '-wal', '-shm']) {
    const path = database + suffix;
    const observed = await observeDatabaseFiles(f, async flush => {
      writeFileSync(path, 'synthetic', { flag: 'wx', mode: 0o600 }); await flush();
      unlinkSync(path); await flush();
    });
    assert.ok(observed.events.filter(([event, name]) => event === 'rename' && name === basename(path)).length >= 2,
      'creation and deletion were both observed: ' + basename(path));
  }
});

test('review 6: failed initialization closes its connection and base, preserves refusal and rejects missing metadata', t => {
  const f = coreFixture(t), original = DatabaseSync.prototype.prepare;
  for (const missing of [false, true]) for (const reader of [false, true]) {
    const refusal = Object.assign(Error('synthetic initialization refusal'), { code: 'storage_error' });
    let connection, baseClosed = false;
    DatabaseSync.prototype.prepare = function(sql) {
      if (sql !== 'SELECT store_id,cursor_secret FROM store_metadata WHERE singleton=1') return original.call(this, sql);
      connection = this;
      return { get() { if (missing) return undefined; throw refusal; } };
    };
    try {
      assert.throws(() => reader ? openContextReader({ path: f.path, contextRead: f.config }) :
        openContextCore({ path: f.path }, f.config, () => ({ close() { baseClosed = true; throw Error('secondary close failure'); } })),
      error => missing ? error.code === 'unsupported_database' : error === refusal);
      assert.ok(connection); assert.equal(connection.isOpen, false); assert.equal(baseClosed, !reader);
    } finally { DatabaseSync.prototype.prepare = original; }
  }
});

function assertSanitized(open, path) {
  assert.throws(open, error => {
    assert.equal(error.code, 'index_unavailable'); assert.equal(error.message, 'index_unavailable');
    for (const key of ['path', 'syscall', 'errno', 'cause']) assert.equal(Object.hasOwn(error, key), false);
    for (const value of Object.values(Object.getOwnPropertyDescriptors(error))) {
      if (typeof value.value === 'string') assert.equal(value.value.includes(path), false);
    }
    return true;
  });
}
test('review 7: auxiliary probe errors including real ENAMETOOLONG never expose paths or native error properties', t => {
  const f = coreFixture(t), original = fs.lstatSync;
  const openers = path => [() => openContextReader({ path, contextRead: f.config }),
    () => openMemoryCore({ path, contextRead: f.config, existingStore: { version: 'schema30-existing-v1', storeId: 'synthetic' } })];
  try {
    for (const code of ['EACCES', 'ENOTDIR', 'ELOOP', 'ENAMETOOLONG']) {
      fs.lstatSync = function(path, ...args) {
        if (String(path) === f.path + '-journal') throw Object.assign(Error('private-path: ' + path), { code, path, syscall: 'lstat', errno: -1 });
        return original.call(this, path, ...args);
      };
      syncBuiltinESMExports();
      for (const open of openers(f.path)) assertSanitized(open, f.path);
    }
  } finally { fs.lstatSync = original; syncBuiltinESMExports(); }
  const longPath = join(f.workspace.path, 'private-' + 'x'.repeat(232)); // Canonical/journal names fit; sidecar names exceed NAME_MAX.
  copyFileSync(f.path, longPath);
  for (const open of openers(longPath)) assertSanitized(open, longPath);
});

test('review 8: provider-entry waits fail on early completion, rejection or a finite watchdog', async () => {
  const never = new Promise(() => {});
  await assert.rejects(waitForContextEntry(never, Promise.resolve({ ok: false })), /operation_settled_before_entry/);
  const refusal = Error('synthetic operation refused');
  await assert.rejects(waitForContextEntry(never, Promise.reject(refusal)), error => error === refusal);
  await assert.rejects(waitForContextEntry(never, never, 5), /context_entry_timeout/);
  await waitForContextEntry(Promise.resolve(), never);
});

test('R06 review 5: canonical and sidecar candidate reads bind the authorized scope before executing SQL', async t => {
  const fake = createFakeEmbedder(), f = coreFixture(t, { embedder: fake, selectedPolicy: policy() });
  f.admit('apple private target'); f.admit('FOREIGN_SECRET apple', foreign);
  f.trusted.state.allowed = [foreign];
  ok(await f.call('refreshContextIndex', refresh({ readSet: [foreign] })));
  f.trusted.state.allowed = [ns]; ok(await f.call('refreshContextIndex', refresh()));
  const projection = namespace => JSON.stringify({ readSet: [namespace], types: ['memory'], intent: 'current' });
  const expected = projection(ns), original = DatabaseSync.prototype.prepare;
  const reads = { canonical: 0, postings: 0, vectors: 0 };
  DatabaseSync.prototype.prepare = function(sql) {
    const statement = original.call(this, sql);
    const canonical = /\bFROM (memories|namespace_epochs)\b/.test(sql);
    const index = /\b(?:FROM|JOIN) (documents|postings|statistics|vectors)\b/.test(sql);
    if (!canonical && !index) return statement;
    return new Proxy(statement, { get(target, key) {
      const value = Reflect.get(target, key, target);
      if (!['all', 'get', 'iterate'].includes(key)) return typeof value === 'function' ? value.bind(target) : value;
      return (...args) => {
        if (canonical) { reads.canonical++; assert.deepEqual(args.slice(0, 3), [ns.ownerId, ns.scope, ns.projectId], 'foreign canonical read'); }
        if (index) {
          assert.ok(args.includes(expected), 'unscoped or foreign sidecar candidate read');
          if (/\bpostings\b/.test(sql)) reads.postings++;
          if (/\bvectors\b/.test(sql)) reads.vectors++;
        }
        return value.apply(target, args);
      };
    } });
  };
  let audit;
  try {
    audit = new DatabaseSync(f.path + '.context-read-v1.sqlite', { readOnly: true });
    assert.throws(() => f.db.prepare('SELECT id FROM memories WHERE owner_id=? AND scope=? AND project_id=?').all(foreign.ownerId, foreign.scope, foreign.projectId), /foreign canonical read/);
    assert.throws(() => audit.prepare('SELECT term FROM postings WHERE generation=?').all(projection(foreign)), /foreign sidecar/);
    assert.throws(() => audit.prepare('SELECT data FROM vectors WHERE generation=?').all(projection(foreign)), /foreign sidecar/);
    const result = ok(await f.call('findCandidates', query({ semantic: true, deadlineMs: 5000 })));
    assert.equal(result.items.length, 1); assert.equal(result.items[0].ref.namespace.ownerId, ns.ownerId);
    assert.equal(result.coverage.byType.memory.eligible, 1);
    assert.ok(reads.canonical > 1 && reads.postings > 0 && reads.vectors > 0);
  } finally { DatabaseSync.prototype.prepare = original; audit?.close(); }
});

test('R06 review 5: revoke after reservation but before transport, retaining conservative charges until settlement', async t => {
  let entered, release, paused = true, transmissions = 0;
  const entry = new Promise(resolve => { entered = resolve; }), fake = createFakeEmbedder();
  const embedder = { ...fake, id: 'review-post-reservation-public', async embed(texts, options) {
    if (paused) { entered(); await new Promise(resolve => { release = resolve; }); }
    options.beforeDispatch(); transmissions++; return fake.embed(texts, options);
  } };
  const caps = overrides => policy({ maxRequests: 1, maxUsd: 1, maxConcurrent: 1, estimateUsd: () => 1, ...overrides });
  const f = coreFixture(t, { embedder, selectedPolicy: caps() }); f.admit('apple');
  const operation = f.call('refreshContextIndex', refresh());
  try {
    await waitForContextEntry(entry, operation);
    const held = ok(await f.call('refreshContextIndex', refresh()));
    assert.equal(held.channels.semantic.state, 'budget_denied'); assert.equal(transmissions, 0);
    f.trusted.state.enabled = false; release();
    denied(await operation, 'scope_changed'); assert.equal(transmissions, 0);
  } finally { release?.(); await operation; }
  f.trusted.state.enabled = true; paused = false;
  f.reopen({ policy: caps({ maxConcurrent: 2 }) });
  assert.equal(ok(await f.call('refreshContextIndex', refresh())).channels.semantic.state, 'budget_denied');
  assert.equal(transmissions, 0, 'an invoked port keeps conservative request and USD charges across profiles');
  f.reopen({ policy: caps({ maxRequests: 2, maxUsd: 2, maxConcurrent: 3 }) });
  assert.equal(ok(await f.call('refreshContextIndex', refresh())).status, 'complete'); assert.equal(transmissions, 1);
  assert.equal(ok(await f.call('findCandidates', query({ semantic: true }))).channels.semantic.state, 'budget_denied');
});

test('review 9: core release and limitations notes retain the operational boundaries', () => {
  for (const [path, title] of [['../../CHANGELOG.md', 'Unreleased — opt-in core candidate retrieval'], ['../../docs/limitations.md', 'Opt-in core candidate retrieval']]) {
    const text = readFileSync(new URL(path, import.meta.url), 'utf8');
    const section = text.slice(text.indexOf('## ' + title)).split(/\n## /)[0];
    for (const pattern of [/opt-in/i, /sensitive/i, /sidecar/i, /logical/i, /physical erasure/i, /中/, /中文/, /synthetic/i, /observational/i]) assert.match(section, pattern);
    assert.match(section, /MCP, CLI and hosted adapter wiring[\s\S]*deferred/);
  }
});
