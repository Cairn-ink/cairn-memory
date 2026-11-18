import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { openDatabase } from '../database.mjs';
import { openContentSuppressionReader } from '../index.mjs';
import { safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';
import { ns, ok, suppressionFixture } from '../testing/content-suppression-fixture.mjs';

const configuration = 'PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=5000;';
const zeroWait = 'PRAGMA busy_timeout=0';
const nativeBusy = error => error?.code === 'ERR_SQLITE_ERROR' && [5, 6].includes(error.errcode & 255);
const nativeFault = errcode => Object.assign(new Error('synthetic native SQLite fault'), { code: 'ERR_SQLITE_ERROR', errcode });

function fixture(t) {
  return suppressionFixture(t, 18, context => {
    const workspace = createTestWorkspace(context, { prefix: 'cairn-suppression-open-' });
    const path = join(workspace.path, 'store.sqlite'), seed = openDatabase(path, { contentSafety: 's2h-v1' });
    let storeId;
    try { storeId = seed.prepare('SELECT store_id FROM store_metadata').get().store_id; }
    finally { seed.close(); }
    // The suppression fixture can use a freshly provisioned safety layout.
    return { workspace, path, storeId, migrate() {}, connect: () => new DatabaseSync(path) };
  });
}

async function lockActor(f) {
  const control = join(f.workspace.path, 'lock-control');
  mkdirSync(control);
  const child = fork(new URL('./fixtures/content-suppression-open-lock.mjs', import.meta.url), [f.path, control],
    { execArgv: [], stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  const exit = once(child, 'exit');
  const mark = name => mkdirSync(join(control, name), { recursive: true });
  f.workspace.defer(async () => {
    mark('release');
    assert.deepEqual(await exit, [0, null]);
  });
  const [ready] = await Promise.race([once(child, 'message'), exit]);
  assert.equal(ready, 'ready');
  const idle = new Int32Array(new SharedArrayBuffer(4));
  function waitFor(name) {
    const marker = join(control, name), until = performance.now() + 3000;
    while (!existsSync(marker) && performance.now() < until) Atomics.wait(idle, 0, 0, 5);
    assert.ok(existsSync(marker), 'lock actor did not reach ' + name);
  }
  return {
    lock() { mark('arm'); waitFor('locked'); },
    release() { mark('release'); waitFor('released'); },
    isReleased() { return existsSync(join(control, 'released')); },
  };
}

function trackAttempts(t, { lock, releaseOnBusy = false, zeroValidationWait = false, inject } = {}) {
  const handles = [], identityAttempts = new Set(), faults = [];
  const exec = DatabaseSync.prototype.exec, prepare = DatabaseSync.prototype.prepare;
  t.mock.method(DatabaseSync.prototype, 'exec', function (sql) {
    if (sql === configuration) {
      assert.ok(handles.every(db => !db.isOpen), 'each failed connection closes before the next open');
      handles.push(this);
    }
    const attempt = handles.indexOf(this) + 1;
    if (attempt) inject?.(sql, attempt, identityAttempts.has(this));
    // A sustained EXCLUSIVE lock also blocks the inherited validation. Use a
    // zero native timeout there only in the budget control to isolate retries.
    const query = zeroValidationWait && attempt > 1 && sql === configuration ? sql.replace('5000', '0') : sql;
    const result = exec.call(this, query);
    if (attempt && sql === zeroWait) {
      identityAttempts.add(this);
      if (attempt === 1) lock?.lock();
    }
    return result;
  });
  function observe(work) {
    try { return work(); }
    catch (error) {
      if (nativeBusy(error)) {
        faults.push(error);
        if (faults.length === 1 && releaseOnBusy) lock.release();
      }
      throw error;
    }
  }
  if (lock) t.mock.method(DatabaseSync.prototype, 'prepare', function (sql) {
    const statement = observe(() => prepare.call(this, sql));
    const get = statement.get;
    statement.get = (...args) => observe(() => get.apply(statement, args));
    return statement;
  });
  return { handles, faults, identityAttempts };
}

test('one suppression open retries after observing a real DELETE-mode SQLite BUSY', { timeout: 12000 }, async t => {
  const f = await fixture(t);
  for (let i = 0; i < 2; i++) f.fact(f.descriptor(f.memory('Synthetic pull content ' + i)));
  const { handle: original, options } = await f.reader();
  const input = { expected: f.checkpoint(0), limit: 1 };
  const { nextCursor: cursor } = ok(await original.listSuppressionsSince(ns.ownerId, '0', input, f.credential));
  assert.ok(cursor);
  const { storeId, suppressionDomain } = JSON.parse(Buffer.from(cursor.split('.')[0], 'base64url'));
  assert.deepEqual({ storeId, suppressionDomain }, f.expected);
  const continuation = { ...input, cursor };
  const expected = await original.listSuppressionsSince(ns.ownerId, '0', continuation, f.credential);
  assert.equal(ok(expected).items.length, 1);
  await original.close();

  const lock = await lockActor(f);
  const { handles, faults, identityAttempts } = trackAttempts(t, { lock, releaseOnBusy: true });
  const reopened = await openContentSuppressionReader({ ...options, requestMaxMs: 1000 });
  t.after(() => reopened.close());
  assert.equal(faults.length, 1);
  assert.equal(faults[0].errcode & 255, 5);
  assert.ok(lock.isReleased());
  assert.equal(handles.length, 2);
  assert.equal(identityAttempts.size, 2);
  assert.deepEqual(await reopened.listSuppressionsSince(ns.ownerId, '0', continuation, f.credential), expected);
});

test('a sustained DELETE lock exhausts the open budget and closes every attempt', { timeout: 12000 }, async t => {
  const f = await fixture(t), { options } = await f.reader();
  const lock = await lockActor(f);
  const { handles, faults } = trackAttempts(t, { lock, zeroValidationWait: true });
  const requestMaxMs = 320, toleranceMs = 200;
  const started = performance.now();
  await assert.rejects(() => openContentSuppressionReader({ ...options, requestMaxMs }), error => {
    assert.ok(nativeBusy(error));
    assert.equal(error, faults[0]);
    return true;
  });
  const elapsed = performance.now() - started;
  assert.ok(!lock.isReleased(), 'the writer still holds its exclusive lock');
  lock.release();
  assert.ok(handles.length > 1, 'opens were retried while the lock was held');
  assert.ok(handles.every(db => !db.isOpen));
  assert.ok(elapsed <= requestMaxMs + toleranceMs, 'elapsed milliseconds: ' + elapsed);
  t.diagnostic(`${handles.length} attempts in ${elapsed.toFixed(1)} ms with ${requestMaxMs} ms budget and ${toleranceMs} ms tolerance`);
});

test('changing BUSY faults exhaust with the first native error object', async t => {
  const f = await fixture(t), { options } = await f.reader();
  const first = nativeFault(261), later = nativeFault(262);
  const { handles } = trackAttempts(t, { inject(sql, attempt, identity) {
    if (attempt === 1 && identity && sql === 'COMMIT') throw first;
    if (attempt > 1 && sql === configuration) throw later;
  } });
  await assert.rejects(() => openContentSuppressionReader({ ...options, requestMaxMs: 250 }), error => error === first);
  assert.ok(handles.length > 1, 'the later extended LOCKED was reached');
  assert.ok(handles.every(db => !db.isOpen));
});

for (const [errcode, site] of [[6, zeroWait], [261, 'COMMIT']]) {
  test('native SQLite code ' + errcode + ' retries the whole open', async t => {
    const f = await fixture(t), { options } = await f.reader();
    const { handles, identityAttempts } = trackAttempts(t, { inject(sql, attempt, identity) {
      if (attempt === 1 && sql === site && (site !== 'COMMIT' || identity)) throw nativeFault(errcode);
    } });
    const handle = await openContentSuppressionReader(options);
    t.after(() => handle.close());
    assert.equal(handles.length, 2);
    assert.ok(identityAttempts.has(handles[1]));
    assert.ok(!handles[0].isOpen);
  });
}

for (const code of ['scope_changed', 'unsupported_database']) {
  test(code + ' is a terminal open result', async t => {
    const f = await fixture(t), { options } = await f.reader();
    let input;
    if (code === 'scope_changed') {
      const expected = { ...f.expected, suppressionDomain: randomUUID() };
      input = { ...options, expected, suppression: f.grant({ expected }) };
    } else {
      input = { ...options, path: safetyFixture(t).path };
    }
    const { handles, identityAttempts } = trackAttempts(t);
    await assert.rejects(() => openContentSuppressionReader(input), { code });
    assert.equal(handles.length, 1);
    assert.equal(identityAttempts.size, 1);
    assert.ok(!handles[0].isOpen);
  });
}
