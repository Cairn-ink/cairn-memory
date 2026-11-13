import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, transaction, isStorageBusy } from '../../../core/database.mjs';
import { MemoryStoreError } from '../../../core/validation.mjs';
import { bindCommitConnection, createCommitDispatcher, dispatchCommit, commitFailure,
  APPROVED_SYNCHRONOUS_SCOPES, withSynchronousCommitScope } from '../../../core/commit-dispatch.mjs';

const busy = () => Object.assign(Error('synthetic lock'), { code: 'ERR_SQLITE_ERROR', errcode: 5 });
function fixture(t, options = {}) {
  const host = createCommitDispatcher({ strict: true, ...options });
  const db = host.open(() => openDatabase(':memory:'));
  t.after(() => { if (db.isOpen) db.close(); });
  return { host, db, run: (work, deadline, options) => dispatchCommit(db, work, deadline, options) };
}

test('P1-1/P2-1: even an expired explicit budget runs the first attempt', { timeout: 3000 }, t => {
  let clock = 9000, calls = 0;
  const f = fixture(t, { now: () => clock });
  const value = f.host.run(() => f.run(() => ++calls, { remainingMs() { throw new MemoryStoreError('model_timeout'); } }), { deadlineAt: 1 });
  assert.equal(value, 1, 'R2I_FIRST_ATTEMPT');
  assert.equal(calls, 1);
});

test('P1-1: commits after provider time each get a new five-second retry budget', { timeout: 3000 }, async t => {
  let clock = 0, calls = 0;
  const f = fixture(t, { now: () => clock, onBackoff: ({ waitMs }) => { clock += waitMs; } });
  await f.host.run(async () => {
    clock = 6100;
    assert.equal(await f.run(() => { if (++calls === 1) throw busy(); return 'first'; }), 'first');
    clock += 6100; calls = 0;
    assert.equal(await f.run(() => { if (++calls === 1) throw busy(); return 'second'; }), 'second');
  });
});

test('P1-2: compensation ignores expired deadlines and request abort but retries locks', { timeout: 3000 }, async t => {
  const request = new AbortController(); request.abort();
  let checks = 0, calls = 0, deadlineCalls = 0;
  const f = fixture(t);
  const value = await f.host.run(() => f.run(() => {
    if (++calls === 1) throw busy(); return 'released';
  }, { remainingMs() { deadlineCalls++; throw new MemoryStoreError('model_timeout'); } }, { compensating: true }),
  { signal: request.signal, deadlineAt: 0, check() { checks++; throw Error('revoked'); } });
  assert.equal(value, 'released'); assert.equal(calls, 2);
  assert.equal(checks, 0); assert.equal(deadlineCalls, 0, 'R2I_COMPENSATION_BUDGET');
});

test('P1-2: host close stops compensating retries', { timeout: 3000 }, async t => {
  const closing = new AbortController(); let calls = 0;
  const f = fixture(t, { signal: closing.signal, onBackoff: () => queueMicrotask(() => closing.abort()) });
  await assert.rejects(Promise.resolve().then(() => f.run(() => { calls++; throw busy(); }, undefined,
    { compensating: true })), { code: 'store_closed' });
  assert.equal(calls, 1);
});

test('P1-3: non-lock storage_busy errors and envelopes propagate on their first occurrence', { timeout: 3000 }, t => {
  const f = fixture(t); let calls = 0;
  const conflict = new MemoryStoreError('storage_busy');
  assert.throws(() => f.run(() => { calls++; throw conflict; }), error => error === conflict);
  assert.equal(calls, 1, 'R2I_LOCK_DISCRIMINATOR');
  const result = { ok: false, error: { code: 'storage_busy', retryable: true } };
  assert.equal(f.run(() => commitFailure(conflict, result)), result);
  assert.equal(isStorageBusy(conflict), false);
});

test('P2-3: dispatcher exhaustion is busy-aware, guard storage_busy is not', { timeout: 3000 }, async t => {
  const f = fixture(t);
  let error;
  try { await f.host.run(() => f.run(() => { throw busy(); }), { deadlineAt: 0 }); }
  catch (caught) { error = caught; }
  assert.equal(error.code, 'storage_busy');
  assert.equal(isStorageBusy(error), true, 'R2I_BUSY_AWARE');
  assert.equal(isStorageBusy(new MemoryStoreError('storage_busy')), false);
});

test('P2-4: read-only transaction commits do not prevent retrying a later rolled-back write', { timeout: 3000 }, async t => {
  const f = fixture(t); let calls = 0;
  const result = await f.run(() => {
    transaction(f.db, () => f.db.prepare('SELECT 1 AS n').get());
    if (++calls === 1) throw busy();
    return 'complete';
  });
  assert.equal(result, 'complete', 'R2I_READ_COMMIT_ACCOUNTING'); assert.equal(calls, 2);
});

test('P2-4: a changed-row commit still prevents replay of an earlier phase', { timeout: 3000 }, t => {
  const f = fixture(t); let calls = 0;
  assert.throws(() => f.run(() => {
    calls++;
    transaction(f.db, () => f.db.prepare('UPDATE store_metadata SET store_id=store_id WHERE singleton=1').run());
    throw busy();
  }), { code: 'ERR_SQLITE_ERROR' });
  assert.equal(calls, 1);
});

test('P1-7 strict control: an unrouted write fails before BEGIN with its site label', { timeout: 3000 }, t => {
  const f = fixture(t);
  assert.throws(() => transaction(f.db, () => {}), error =>
    error.code === 'unrouted_synchronous_write' && error.site === 'transaction', 'R2I_STRICT_UNROUTED');
  assert.equal(f.db.isTransaction, false);
  assert.equal(f.host.inspectSynchronousWrites().count, 1);
});

test('P1-7: queued work cannot inherit a completed synchronous scope or attempt', { timeout: 3000 }, async t => {
  const f = fixture(t);
  for (const run of [work => f.run(work), work => withSynchronousCommitScope('daemon start install', work)]) {
    let caught;
    await run(() => queueMicrotask(() => {
      try { transaction(f.db, () => {}); } catch (error) { caught = error; }
    }));
    assert.equal(caught?.code, 'unrouted_synchronous_write');
  }
});

test('P1-7: strict contract inventory routes admission rather than silently allowing it', { timeout: 3000 }, async t => {
  const { openMemoryCore } = await import('../../../core/contract.mjs');
  const host = createCommitDispatcher({ strict: true });
  const core = host.open(() => openMemoryCore({ path: ':memory:', raw: false }));
  t.after(() => core.close());
  const result = await core.admit({ namespace: { ownerId: 'synthetic', scope: 'personal', projectId: null },
    memory: { content: 'Synthetic routed write', kind: 'fact' },
    receipts: [{ client: 'synthetic', sessionId: 's', eventId: 'e', role: 'user', excerpt: 'Synthetic routed write' }] });
  assert.equal(result.ok, true, 'R2I_DEROUTED_INVENTORY');
  const forgotten = await core.forget({ namespace: { ownerId: 'synthetic', scope: 'personal', projectId: null },
    memoryId: result.value.memory.id, expectedRevision: result.value.memory.revision });
  assert.equal(forgotten.ok, true, 'R2I_DEROUTED_FORGET');
  assert.equal(host.inspectSynchronousWrites().count, 0);
});

test('P1-7: exactly four names allow synchronous transactions', { timeout: 3000 }, t => {
  const f = fixture(t);
  const expected = ['daemon start install', 'sidecar create or repair at open', 'lazy Card storage init', 'read_role_task_context'];
  assert.deepEqual([...APPROVED_SYNCHRONOUS_SCOPES], expected);
  for (const name of expected) withSynchronousCommitScope(name, () => transaction(f.db, () => {}));
  assert.deepEqual(f.host.inspectSynchronousWrites().scopes, expected.sort());
});

test('P2-5: native close removes its WeakRef without a diagnostic sweep', { timeout: 3000 }, t => {
  const f = fixture(t);
  assert.equal(f.host.inspectSynchronousWrites().connections, 1);
  f.db.close();
  assert.equal(f.host.inspectSynchronousWrites().connections, 0, 'R2I_CLOSED_REF_REMOVED');
});
