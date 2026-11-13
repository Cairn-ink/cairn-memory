import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { bindCommitConnection, createCommitDispatcher, dispatchCommit, recordCommit } from '../commit-dispatch.mjs';
import { transaction } from '../database.mjs';

const busy = () => Object.assign(Error('synthetic busy'), { code: 'ERR_SQLITE_ERROR', errcode: 5 });
const code = expected => error => error.code === expected;
const invoke = work => Promise.resolve().then(work);
function fixture(options = {}, db = { isOpen: true, isTransaction: false }) {
  // Synthetic handles implement the native PRAGMA surface used at bind time.
  if (!db.prepare) { db.prepare = () => ({ get: () => ({ timeout: 5000 }) }); db.exec = () => {}; }
  const host = createCommitDispatcher(options);
  host.open(() => bindCommitConnection(db));
  return { host, db, run: (work, options) => host.run(() => dispatchCommit(db, work), options) };
}

test('equal jitter uses the original absolute deadline and records every await outside a transaction', async () => {
  let clock = 0, calls = 0;
  const waits = [], states = [], randoms = [0, .25, .75, 1, 0, 1];
  const f = fixture({ now: () => clock, random: () => randoms.shift() ?? 0, onAwait: state => states.push(state),
    onBackoff: state => { waits.push(state); clock += state.waitMs; } });
  const value = await f.run(() => { if (++calls <= 6) throw busy(); return 'committed'; }, { deadlineAt: 2000 });
  assert.equal(value, 'committed');
  assert.equal(calls, 7);
  const windows = [[8,16],[16,32],[32,64],[64,128],[128,256],[128,256]];
  waits.forEach(({ waitMs }, i) => assert.ok(waitMs >= windows[i][0] && waitMs <= windows[i][1], 'equal-jitter window ' + i));
  assert.deepEqual(waits.map(row => row.waitMs), [8,20,56,128,128,256]);
  assert.ok(new Set(waits.map(row => row.waitMs)).size > 3);
  assert.ok(states.some(row => row.point === 'before_timer'));
  assert.ok(states.some(row => row.point === 'after_timer'));
  assert.ok(states.every(row => row.isTransaction === false), 'every dispatcher await must be outside BEGIN/COMMIT');

  clock = 0; calls = 0; waits.length = 0;
  await assert.rejects(invoke(() => f.run(() => { calls++; throw busy(); }, { deadlineAt: 30 })), code('storage_busy'),
    'deadline expiry must return storage_busy');
  assert.ok(clock <= 30, 'original deadline must never reset');
  assert.ok(calls <= 4, 'no new native attempt with less than 5 ms left');
});

test('missing, unknown, closed and active native state fail closed without retry', async () => {
  for (const db of [{}, { isOpen: false, isTransaction: false }, { isOpen: true }, { isOpen: true, isTransaction: true }]) {
    let calls = 0;
    const f = fixture({}, db);
    await assert.rejects(invoke(() => f.run(() => { calls++; throw busy(); })),
      code(db.isOpen ? 'storage_transaction_active' : 'store_closed'), 'native transaction state must fail closed');
    assert.equal(calls, 0, 'invalid transaction state must fail closed before invocation');
  }
  let calls = 0, waits = 0;
  const f = fixture({ onBackoff: () => { waits++; } });
  await assert.rejects(invoke(() => f.run(() => { calls++; f.db.isTransaction = true; throw busy(); })),
    code('storage_transaction_active'), 'active transaction must fail closed before a second invocation');
  assert.equal(calls, 1); assert.equal(waits, 0);
});

test('native rollback failure cannot cross an await or start another attempt', async () => {
  const db = new DatabaseSync(':memory:', { timeout: 5000 });
  const states = []; let calls = 0;
  const f = fixture({ onAwait: state => states.push(state) }, db), original = db.exec.bind(db);
  db.exec = sql => { if (sql === 'ROLLBACK') throw busy(); return original(sql); };
  await assert.rejects(invoke(() => f.run(() => transaction(db, () => { calls++; throw busy(); }))),
    code('storage_transaction_active'));
  assert.equal(calls, 1);
  assert.ok(states.every(state => state.isTransaction === false), 'rollback failure must never suspend in a transaction');
  assert.equal(db.isOpen, false, 'failed rollback must retire the native connection');
});

test('async commit closures and async transaction callbacks are rejected before BEGIN', async () => {
  const db = new DatabaseSync(':memory:', { timeout: 5000 });
  try {
    const f = fixture({}, db); let entered = false;
    await assert.rejects(invoke(() => f.run(async () => { entered = true; await delay(1); })), code('storage_error'),
      'an await inside the closure must be rejected');
    assert.equal(entered, false, 'async closure must never be invoked');
    assert.throws(() => transaction(db, async () => { await delay(1); }), code('storage_error'));
    assert.equal(db.isTransaction, false, 'async callback must be rejected before BEGIN');
  } finally { db.close(); }
});

test('transport abort and authority revocation wake the timer immediately and clean up listeners', async () => {
  for (const reason of ['disconnect', 'revocation']) {
    const controller = new AbortController(); let calls = 0, added = 0, removed = 0;
    const add = controller.signal.addEventListener.bind(controller.signal), remove = controller.signal.removeEventListener.bind(controller.signal);
    controller.signal.addEventListener = (...args) => { added++; return add(...args); };
    controller.signal.removeEventListener = (...args) => { removed++; return remove(...args); };
    const f = fixture({ random: () => 1, onBackoff: () => queueMicrotask(() => controller.abort(reason)) });
    const start = performance.now();
    await assert.rejects(invoke(() => f.run(() => { calls++; throw busy(); }, { signal: controller.signal })), code('authority_required'));
    assert.equal(calls, 1, 'revocation must prevent every subsequent commit');
    assert.equal(added, removed, 'retry listener must be removed on cancellation');
    assert.ok(performance.now() - start < 100, 'abort must wake retry without waiting for a capped timer');
    assert.deepEqual(f.host.inspectTransactions(), [{ isOpen: true, isTransaction: false }]);
  }
});

test('every retry reruns pause and forget guards around the detached provider result', async () => {
  for (const refusal of ['capture_disabled', 'source_excluded']) {
    let revoked = false, providerCalls = 0, calls = 0;
    const f = fixture({ onBackoff: () => { revoked = true; } });
    const output = (() => { providerCalls++; return Object.freeze({ content: 'synthetic detached result' }); })();
    const commit = () => {
      calls++;
      if (revoked) throw Object.assign(Error(refusal), { code: refusal });
      assert.equal(output.content, 'synthetic detached result');
      throw busy();
    };
    await assert.rejects(invoke(() => f.run(commit)), code(refusal),
      refusal === 'capture_disabled' ? 'pause guard must rerun during backoff' : 'forget guard must rerun during backoff');
    assert.equal(calls, 2); assert.equal(providerCalls, 1, 'provider-backed phase must execute exactly once despite storage_busy');
  }
});

test('a committed earlier phase and non-busy failures are never replayed', async () => {
  let calls = 0, waits = 0;
  const f = fixture({ onBackoff: () => { waits++; } });
  await assert.rejects(invoke(() => f.run(() => { calls++; recordCommit(f.db); throw busy(); })), code('ERR_SQLITE_ERROR'));
  assert.equal(calls, 1); assert.equal(waits, 0, 'a committed earlier phase cannot be retried');
  calls = 0;
  await assert.rejects(invoke(() => f.run(() => { calls++; throw Object.assign(Error('refused'), { code: 'memory_suppressed' }); })), code('memory_suppressed'));
  assert.equal(calls, 1); assert.equal(waits, 0);
});

test('unbound default path never takes the dispatcher and remains synchronous', () => {
  const db = { isOpen: false, isTransaction: true }; let calls = 0;
  let value;
  assert.doesNotThrow(() => { value = dispatchCommit(db, () => { calls++; return 'default'; }); },
    'default path must never take the dispatcher');
  assert.equal(value, 'default', 'default path must never take the dispatcher');
  assert.equal(calls, 1);
});

test('unbound dispatch preserves result identity without inspecting native state, options or then', () => {
  const touched = [];
  const poison = label => new Proxy({}, { get(_value, key) {
    touched.push([label, key]); throw Error('R2M_UNBOUND_PROPERTY_READ');
  } });
  const connection = poison('connection'), deadline = poison('deadline'), options = poison('options');
  const value = poison('result');
  assert.equal(dispatchCommit(connection, () => value, deadline, options), value, 'R2M_UNBOUND_RESULT_IDENTITY');
  assert.deepEqual(touched, [], 'R2M_UNBOUND_PROPERTY_READ');
});
