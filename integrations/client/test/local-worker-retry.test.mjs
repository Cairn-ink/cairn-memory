import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { performance } from 'node:perf_hooks';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { useCapture } from './fixtures/local-worker-retry-transport.mjs';
import { LocalCaptureTransportError } from '../raw/local-process.mjs';
import { withWriteObserver } from '../private-state.mjs';
import { claude } from './fixtures/raw-fixtures.mjs';

const replacement = new URL('./fixtures/local-worker-retry-transport.mjs', import.meta.url).href;
const hooks = registerHooks({ load(url, context, nextLoad) {
  if (url === new URL('../raw/local-transport.mjs', import.meta.url).href)
    return { format: 'module', source: `export { createLocalCaptureTransport } from ${JSON.stringify(replacement)};`, shortCircuit: true };
  return nextLoad(url, context);
} });
const { createLocalRawWorker } = await import('../raw/local-worker.mjs');
const { workerFixture } = await import('./fixtures/local-worker-workspace.mjs');
hooks.deregister();

const complete = request => ({ status: 200, body: { version: 2, duplicate: false, memoryCount: 0,
  raw: { conversationId: 'synthetic-conversation', revision: 1, parts: request.messages.map(message =>
    ({ messageId: message.id, index: message.part.index, saved: true, reason: null })) } } });
async function setup(t, options) {
  const f = workerFixture(t, options), worker = createLocalRawWorker(f.options);
  assert.equal((await worker.initialize({ ...f.context, start: 'beginning' })).status, 'ready');
  return { f, worker };
}

test('one definite failure retries the same frozen batch with a second durable dispatch and progresses', async t => {
  const { f, worker } = await setup(t), calls = [], dispatched = [];
  useCapture(async request => {
    calls.push(request);
    assert.equal(Object.isFrozen(request), true);
    assert.equal(f.cursor().pending.state, 'dispatched');
    assert.equal(dispatched.length, calls.length, 'each send follows its own durable write');
    if (calls.length === 1) throw new LocalCaptureTransportError(false, 'probe');
    return complete(request);
  });
  const result = await withWriteObserver(({ path }) => {
    if (path !== f.cursorPath()) return;
    const cursor = f.cursor(), pending = cursor.pending;
    if (pending?.state === 'dispatched' && pending.nextEligibleAt - pending.lastAttemptAt === 280000) dispatched.push(cursor);
  }, () => worker.run(f.context));
  assert.equal(result.status, 'progress'); assert.equal(result.reason, null);
  assert.equal(calls.length, 2); assert.equal(result.dispatchedParts, 2);
  assert.equal(calls[1], calls[0], 'the identical frozen request is sent twice');
  assert.equal(dispatched.length, 2);
  assert.deepEqual(dispatched[1].pending.projection, dispatched[0].pending.projection);
  for (const cursor of dispatched) {
    assert.equal(cursor.pending.attempts, 1); assert.equal(cursor.issuedOrdinal, 1);
    assert.equal(cursor.pending.nextEligibleAt - cursor.pending.lastAttemptAt, 280000);
  }
  assert.equal(result.completedRecords, 1); assert.equal(result.completedParts, 1);
  assert.equal(result.hasPending, false); assert.equal(f.cursor().pending, null);
  assert.equal(f.cursor().offset, statSync(f.sourcePath).size); assert.equal(f.cursor().issuedOrdinal, 1);
});

test('an uncertain failure is never retried and preserves its cooldown', async t => {
  const { f, worker } = await setup(t); let calls = 0;
  useCapture(async () => { calls++; throw new LocalCaptureTransportError(true, 'child_exit'); });
  const result = await worker.run(f.context), pending = f.cursor().pending;
  assert.equal(calls, 1); assert.equal(result.dispatchedParts, 1);
  assert.equal(result.status, 'waiting'); assert.equal(result.reason, 'uncertain');
  assert.equal(pending.state, 'uncertain'); assert.equal(pending.attempts, 1);
  assert.ok(pending.nextEligibleAt - pending.lastAttemptAt >= 125000);
  assert.equal(f.cursor().offset, 0); assert.equal(f.cursor().blockedReason, null);
});

test('a definite failure below 3000 ms remaining is not retried', async t => {
  const { f, worker } = await setup(t); let elapsed = 0, calls = 0;
  t.mock.method(performance, 'now', () => elapsed);
  useCapture(async () => { calls++; elapsed = 152001; throw new LocalCaptureTransportError(false, 'probe'); });
  const result = await worker.run(f.context);
  assert.equal(calls, 1); assert.equal(result.dispatchedParts, 1);
  assert.equal(result.status, 'blocked'); assert.equal(result.reason, 'unavailable');
  assert.equal(f.cursor().pending.state, 'unavailable'); assert.equal(f.cursor().pending.nextEligibleAt, null);
  assert.equal(f.cursor().pending.attempts, 1); assert.equal(f.cursor().offset, 0);
});

for (const reason of ['cancelled', 'work_limit', 'stopped']) test(`a definite ${reason} failure is not retried`, async t => {
  const { f, worker } = await setup(t), controller = new AbortController(); let calls = 0;
  useCapture(async () => {
    calls++;
    if (reason === 'stopped') controller.abort();
    throw Object.assign(new LocalCaptureTransportError(false, 'probe'), reason === 'stopped' ? {} : { reason });
  });
  const result = await worker.run(f.context, { signal: controller.signal });
  assert.equal(calls, 1); assert.equal(result.status, 'waiting');
  assert.equal(result.reason, reason === 'stopped' ? 'cancelled' : reason);
  assert.equal(f.cursor().pending.state, 'unavailable'); assert.equal(f.cursor().pending.nextEligibleAt, null);
});

test('two definite failures remain recoverable without consuming a second durable attempt', async t => {
  const { f, worker } = await setup(t); let calls = 0, original;
  useCapture(async request => { calls++; original ??= request; throw new LocalCaptureTransportError(false, 'probe'); });
  const result = await worker.run(f.context);
  assert.equal(calls, 2); assert.equal(result.status, 'blocked'); assert.equal(result.reason, 'unavailable');
  const cursor = f.cursor();
  assert.equal(cursor.pending.state, 'unavailable'); assert.equal(cursor.pending.attempts, 1);
  assert.equal(cursor.pending.nextEligibleAt, null); assert.equal(cursor.blockedReason, null);
  // Exercise recovery at the final allowed attempt: its retry must still fit.
  cursor.pending.attempts = 3; writeFileSync(f.cursorPath(), JSON.stringify(cursor));
  let recoveredCalls = 0;
  useCapture(async request => {
    recoveredCalls++; assert.deepEqual(request, original); assert.equal(f.cursor().pending.attempts, 4);
    if (recoveredCalls === 1) throw new LocalCaptureTransportError(false, 'probe');
    return complete(request);
  });
  assert.equal((await worker.run(f.context)).status, 'progress');
  assert.equal(recoveredCalls, 2); assert.equal(f.cursor().pending, null);
});

test('interruption at the second durable dispatch leaves a leased recoverable cursor', async t => {
  const { f, worker } = await setup(t); let calls = 0, writes = 0, original;
  useCapture(async request => { calls++; original = request; throw new LocalCaptureTransportError(false, 'probe'); });
  const result = await withWriteObserver(({ path }) => {
    if (path === f.cursorPath() && f.cursor().pending?.state === 'dispatched' && ++writes === 2)
      throw Error('synthetic interruption after durable retry dispatch');
  }, () => worker.run(f.context));
  assert.equal(calls, 1); assert.equal(writes, 2); assert.equal(result.reason, 'state_invalid');
  const pending = JSON.parse(readFileSync(f.cursorPath(), 'utf8')).pending;
  assert.equal(pending.state, 'dispatched'); assert.equal(pending.attempts, 1);
  assert.equal(pending.nextEligibleAt - pending.lastAttemptAt, 280000);
  assert.equal((await worker.run(f.context)).status, 'waiting'); assert.equal(calls, 1);
  t.mock.method(Date, 'now', () => pending.nextEligibleAt + 1);
  useCapture(async request => { calls++; assert.deepEqual(request, original); return complete(request); });
  assert.equal((await worker.run(f.context)).status, 'progress');
  assert.equal(calls, 2); assert.equal(f.cursor().pending, null);
});

test('the retry allowance is shared across all parts in one hook', async t => {
  const { f, worker } = await setup(t, { rows: [claude('x'.repeat(4001))] });
  let calls = 0;
  useCapture(async request => {
    calls++;
    if (calls !== 2) throw new LocalCaptureTransportError(false, 'probe');
    return complete(request);
  });
  const result = await worker.run(f.context);
  assert.equal(calls, 3); assert.equal(result.dispatchedParts, 3);
  assert.equal(result.completedParts, 1); assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'unavailable'); assert.equal(f.cursor().pending.projection.part.index, 1);
  assert.equal(f.cursor().pending.attempts, 1); assert.equal(f.cursor().issuedOrdinal, 1);
});
