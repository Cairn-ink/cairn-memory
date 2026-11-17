import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceFixture, savedSource } from '../testing/raw-source-fixtures.mjs';
import { searchFixture } from '../testing/raw-search-fixtures.mjs';
import { installRawSearchTestClock } from '../testing/raw-search-clock.mjs';
import { MemoryStoreError } from '../validation.mjs';
import { openReadDatabase } from '../read-database.mjs';
import { createRawSearchAuthority } from '../raw-search-authority.mjs';
import { openRawSearchStorage } from '../raw-search-storage.mjs';

test.beforeEach(installRawSearchTestClock);
test.beforeEach(t => {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 50;
  t.after(() => { Error.stackTraceLimit = limit; });
});

async function fixture(t, current = (_state, value) => value) {
  const f = sourceFixture(t), calls = new Map(), live = new Map(), grants = new WeakMap();
  for (let index = 0; index < 3; index++) {
    await savedSource(f, 'Synthetic telescope source ' + index + '.', { sessionId: 'authorization-' + index });
  }
  const s = await searchFixture(f, { setupHost(host) {
    const { authorize, isCurrent } = host.authority;
    host.authority.authorize = (request, token) => {
      const grant = authorize(request, token);
      if (request.method === 'rawSearchSource') {
        const id = request.input.candidate.id;
        const attempt = (calls.get(id) ?? 0) + 1;
        calls.set(id, attempt);
        grants.set(grant, { id, attempt, reads: 0 });
      }
      return grant;
    };
    host.authority.isCurrent = (grant, request) => {
      const state = grants.get(grant), value = isCurrent(grant, request);
      if (!state) return value;
      state.reads++;
      // Count the source-opening guard, separately from initial authorization
      // and ticket validation; no engine or reader implementation is replaced.
      if (new Error().stack.includes('at guard (')) live.set(state.id, (live.get(state.id) ?? 0) + 1);
      return current(state, value);
    };
  } });
  await s.maintain({ maxItems: 128, maxMs: 5000 });
  for (let attempt = 0; attempt < 64; attempt++) {
    const found = await s.search({ query: 'telescope' });
    if (found.coverage.status === 'complete' && found.candidates.length === 3) {
      return { f, s, candidates: found.candidates, calls, live };
    }
    await s.tick({ maxItems: 128, maxMs: 5000 });
  }
  assert.fail('synthetic authorization fixture must publish all candidates');
}

const busy = () => new MemoryStoreError('source_busy');
const counts = (candidates, calls) => candidates.map(candidate => calls.get(candidate.id) ?? 0);

test('prepareMany authorizes each candidate once across a retry after its first prepared handle', async t => {
  const { s, candidates, calls } = await fixture(t), progress = [];
  let interruptions = 0;
  const result = await s.service.prepareMany(candidates, { onPrepared(handle, index) {
    progress.push([handle, index]);
    if (index === 0) { interruptions++; throw busy(); }
  } }, s.host.token);
  assert.equal(interruptions, 1);
  assert.equal(result.complete, true);
  assert.deepEqual(progress.map(([, index]) => index), [0, 1, 2]);
  assert.deepEqual(result.handles, progress.map(([handle]) => handle));
  assert.ok(result.handles.every(Boolean));
  assert.equal(result.handles[0], progress[0][0], 'retain the original prepared prefix');
  assert.deepEqual(result.handles.map(handle => handle.value.conversationId), candidates.map(candidate => candidate.conversationId));
  assert.deepEqual(candidates.map(candidate => calls.get(candidate.id)), [1, 1, 1]);
});

test('prepareMany rereads publication on retry and keeps nulls aligned after its prepared prefix', async t => {
  const { f, s, candidates } = await fixture(t), progress = [];
  const reader = openReadDatabase(f.path, { contextRead: true });
  let storage, change;
  try {
    const authority = createRawSearchAuthority(reader, s.options);
    storage = await openRawSearchStorage({ directory: s.directory, identity: authority.identity,
      bind: authority.bind, quotaBytes: 512 * 1024 * 1024 });
    const before = storage.head();
    const result = await s.service.prepareMany(candidates, { onPrepared(handle, index) {
      progress.push([handle, index]);
      if (index === 0) {
        change = storage.commitBatch({ checkpoint: before.checkpoint });
        throw busy();
      }
    } }, s.host.token);
    await change;
    assert.equal(storage.head().sequence, before.sequence + 1);
    assert.equal(result.complete, true);
    assert.deepEqual(progress.map(([, index]) => index), [0, 1, 2]);
    assert.ok(progress[0][0]);
    assert.equal(result.handles[0], progress[0][0]);
    assert.deepEqual(result.handles, [progress[0][0], null, null]);
    assert.deepEqual(progress.map(([handle]) => handle), result.handles);
  } finally {
    try { await change; } finally { try { await storage?.close(); } finally { reader.db.close(); } }
  }
});

test('prepareMany retries a candidate whose first access is busy without rebuilding successful peers', async t => {
  let interruptedId;
  const { s, candidates, calls } = await fixture(t, (state, value) => {
    if (state.id === interruptedId && state.attempt === 1 && state.reads === 2) throw busy();
    return value;
  });
  interruptedId = candidates[1].id;
  const progress = [];
  const result = await s.service.prepareMany(candidates, { onPrepared(handle, index) {
    progress.push([handle, index]);
  } }, s.host.token);
  assert.equal(result.complete, true);
  assert.deepEqual(progress.map(([, index]) => index), [0, 1, 2]);
  assert.deepEqual(result.handles, progress.map(([handle]) => handle));
  assert.ok(result.handles.every(Boolean));
  assert.deepEqual(result.handles.map(handle => handle.value.conversationId), candidates.map(candidate => candidate.conversationId));
  assert.deepEqual(counts(candidates, calls), [1, 2, 1]);
});

test('prepareMany reevaluates a deterministic initial refusal after a peer interrupts the attempt', async t => {
  let refusedId;
  const { s, candidates, calls } = await fixture(t, (state, value) => {
    if (state.id === refusedId && state.attempt === 1 && state.reads === 2) return null;
    return value;
  });
  refusedId = candidates[1].id;
  const progress = [];
  const result = await s.service.prepareMany(candidates, { onPrepared(handle, index) {
    progress.push([handle, index]);
    if (index === 0) throw busy();
  } }, s.host.token);
  assert.equal(result.complete, true);
  assert.deepEqual(progress.map(([, index]) => index), [0, 1, 2]);
  assert.deepEqual(result.handles, progress.map(([handle]) => handle));
  assert.ok(result.handles.every(Boolean), 'the initially refused candidate must succeed on retry');
  assert.deepEqual(counts(candidates, calls), [1, 2, 1]);
});

test('prepareMany refuses a memoized grant revoked between attempts with the existing access refusal', async t => {
  let targetId, revoke = false, initialFailure = false;
  const { s, candidates, calls, live } = await fixture(t, (state, value) => {
    if (state.id === targetId && (revoke || initialFailure && state.reads === 2)) return null;
    return value;
  });
  targetId = candidates[1].id;
  initialFailure = true;
  // The ordinary first-attempt access exposes the same host refusal code.
  await assert.rejects(s.prepare(candidates[1]), { code: 'authority_required' });
  const firstAttempt = await s.service.prepareMany([candidates[1]], {}, s.host.token);
  assert.deepEqual(firstAttempt, { handles: [null], complete: true });
  initialFailure = false;
  calls.clear(); live.clear();
  const progress = [];
  const result = await s.service.prepareMany(candidates, { onPrepared(handle, index) {
    progress.push([handle, index]);
    if (index === 0) { revoke = true; throw busy(); }
  } }, s.host.token);
  assert.equal(result.complete, true);
  assert.deepEqual(progress.map(([, index]) => index), [0, 1, 2]);
  assert.deepEqual(result.handles, [progress[0][0], null, progress[2][0]]);
  assert.ok(result.handles[0]); assert.ok(result.handles[2]);
  assert.deepEqual(counts(candidates, calls), [1, 1, 1]);
  assert.equal(live.get(targetId), 1, 'the retained access must refuse at the first live opening guard');
});

test('prepareMany keeps source-opening access checks live through retries', async t => {
  const { s, candidates, live } = await fixture(t);
  const first = await s.service.prepareMany(candidates, {}, s.host.token);
  assert.equal(first.complete, true);
  assert.ok(first.handles.every(Boolean));
  const baseline = counts(candidates, live);
  assert.deepEqual(baseline, [3, 3, 3], 'one-part sources keep all three opening guards');
  live.clear();
  const progress = [];
  const second = await s.service.prepareMany(candidates, { onPrepared(handle, index) {
    progress.push([handle, index]);
    if (index === 0) throw busy();
  } }, s.host.token);
  assert.equal(second.complete, true);
  assert.deepEqual(second.handles, progress.map(([handle]) => handle));
  assert.deepEqual(progress.map(([, index]) => index), [0, 1, 2]);
  assert.ok(second.handles.every(Boolean));
  assert.deepEqual(counts(candidates, live), baseline, 'retry must retain the base live guard count');
});

test('prepareMany authorization memo never crosses invocations', async t => {
  const { s, candidates, calls } = await fixture(t);
  for (let invocation = 0; invocation < 2; invocation++) {
    const result = await s.service.prepareMany(candidates, {}, s.host.token);
    assert.equal(result.complete, true);
    assert.ok(result.handles.every(Boolean));
    assert.deepEqual(counts(candidates, calls), candidates.map(() => invocation + 1));
  }
});
