import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceFixture, savedSource, localPlainPort } from '../testing/raw-source-fixtures.mjs';
import { searchFixture } from '../testing/raw-search-fixtures.mjs';
import { installRawSearchTestClock, rawSearchTestWait } from '../testing/raw-search-clock.mjs';
import { MemoryStoreError } from '../validation.mjs';
import { openReadDatabase } from '../read-database.mjs';
import { createRawSearchAuthority } from '../raw-search-authority.mjs';
import { withRawSearchRequestScope } from '../raw-search-request-scope.mjs';
import { openRawSearchStorage } from '../raw-search-storage.mjs';

test.beforeEach(installRawSearchTestClock);
test.beforeEach(t => {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 50;
  t.after(() => { Error.stackTraceLimit = limit; });
});

async function fixture(t, current = (_state, value) => value) {
  const port = localPlainPort(), openRaw = port.openRaw, opens = new Map();
  port.openRaw = input => {
    const { conversationId } = input.context;
    opens.set(conversationId, (opens.get(conversationId) ?? 0) + 1);
    return openRaw(input);
  };
  const f = sourceFixture(t, { port }), calls = new Map(), live = new Map(), grants = new WeakMap();
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
      opens.clear();
      return { f, s, candidates: found.candidates, calls, live, opens };
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
  const { s, candidates, calls, live, opens } = await fixture(t, (state, value) => {
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
  calls.clear(); live.clear(); opens.clear();
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
  assert.deepEqual(candidates.map(({ conversationId }) => opens.get(conversationId) ?? 0), [1, 0, 1]);
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

async function retryAfterFirstHandle(s, candidates, betweenAttempts) {
  const progress = [];
  const result = await s.service.prepareMany(candidates, { onPrepared(handle, index) {
    progress.push([handle, index]);
    if (index === 0) {
      assert.ok(handle);
      betweenAttempts();
      throw busy();
    }
  } }, s.host.token);
  assert.equal(result.complete, true);
  assert.deepEqual(progress.map(([, index]) => index), [0, 1, 2]);
  assert.deepEqual(result.handles, progress.map(([handle]) => handle));
  return result.handles;
}

function assertCandidateRows(handles, candidates) {
  assert.deepEqual(handles.map(handle => handle?.value.conversationId), candidates.map(candidate => candidate.conversationId));
  for (let index = 0; index < handles.length; index++) {
    assert.deepEqual(handles[index].value.ranges.map(range => range.source), candidates[index].ranges);
  }
}

test('prepareMany retry parity: swapped slots rebuild in the new order', async t => {
  const { s, candidates, calls } = await fixture(t), pending = [...candidates];
  const handles = await retryAfterFirstHandle(s, pending, () => {
    [pending[1], pending[2]] = [pending[2], pending[1]];
  });
  assertCandidateRows(handles, pending);
  assert.deepEqual(counts(pending.slice(1), calls), [2, 2]);
});

test('prepareMany retry parity: an in-place proof change rebuilds the same object', async t => {
  const { s, candidates, calls } = await fixture(t), pending = [...candidates];
  const next = await s.search({ query: 'telescope' });
  const replacement = next.candidates.find(candidate => candidate.id === candidates[1].id);
  assert.ok(replacement);
  assert.notEqual(replacement.proof, candidates[1].proof);
  assert.deepEqual(replacement, { ...candidates[1], proof: replacement.proof });

  let proof = candidates[1].proof;
  const target = { ...candidates[1] };
  // Authorization freezes the object. This accessor lets the caller change
  // its proof value in place while the slot still holds the same reference.
  Object.defineProperty(target, 'proof', { enumerable: true, get: () => proof,
    set: value => { proof = value; } });
  pending[1] = target;
  const handles = await retryAfterFirstHandle(s, pending, () => { target.proof = replacement.proof; });
  assertCandidateRows(handles, pending);
  assert.equal(calls.get(target.id), 2, 'the changed proof requires fresh authorization');
});

test('prepareMany retry parity: an expired search proof refuses the suffix', async t => {
  const { s, candidates, opens } = await fixture(t);
  await rawSearchTestWait(4999);
  let advance;
  const handles = await retryAfterFirstHandle(s, candidates, () => { advance = rawSearchTestWait(2); });
  await advance;
  assert.deepEqual(handles.slice(1), [null, null]);
  assert.deepEqual(candidates.map(({ conversationId }) => opens.get(conversationId) ?? 0), [1, 0, 0]);
});

test('prepareMany retry parity: an evicted search proof refuses the suffix', async t => {
  const { s, candidates, opens } = await fixture(t);
  let searches;
  const handles = await retryAfterFirstHandle(s, candidates, () => {
    searches = Promise.all(Array.from({ length: 4 }, () => s.search({ query: 'telescope' })));
    // Native BUSY yields for the retry backoff so the searches can publish
    // their proofs in the same request state before the next attempt.
    throw Object.assign(new Error('synthetic contention'), { code: 'ERR_SQLITE_ERROR', errcode: 5 });
  });
  const replacements = await searches;
  assert.ok(replacements.every(result => result.publication === candidates[0].publication && result.candidates.length === 3));
  const proofs = new Set(replacements.map(result => result.candidates[0].proof));
  assert.equal(proofs.size, 4);
  assert.ok(!proofs.has(candidates[0].proof));
  assert.deepEqual(handles.slice(1), [null, null]);
  assert.deepEqual(candidates.map(({ conversationId }) => opens.get(conversationId) ?? 0), [1, 0, 0]);
});

test('prepareMany retry parity: closing the request scope refuses the suffix before crypto', async t => {
  const { s, opens } = await fixture(t);
  await withRawSearchRequestScope(async scope => {
    const { candidates } = await s.search({ query: 'telescope' });
    assert.equal(candidates.length, 3);
    const handles = await retryAfterFirstHandle(s, candidates, () => scope.close());
    assert.deepEqual(candidates.map(({ conversationId }) => opens.get(conversationId) ?? 0), [1, 0, 0]);
    assert.deepEqual(handles.slice(1), [null, null]);
  });
});

test('prepareMany plain data parity: a ranges accessor can switch to a same-JSON array with its own some', async t => {
  const { s, candidates, calls, opens } = await fixture(t), pending = [...candidates];
  const target = { ...candidates[1] };
  let ranges = target.ranges;
  const replacement = [...ranges];
  replacement.some = () => false;
  assert.notEqual(replacement, ranges);
  assert.ok(replacement.every((ref, index) => ref === ranges[index]));
  assert.ok(Object.hasOwn(replacement, 'some'));
  assert.equal(JSON.stringify(replacement) === JSON.stringify(ranges), true);
  Object.defineProperty(target, 'ranges', { enumerable: true, get: () => ranges });
  pending[1] = target;

  const handles = await retryAfterFirstHandle(s, pending, () => { ranges = replacement; });
  assert.equal(handles[1] === null, true, 'the changed ranges must produce a null slot');
  assertCandidateRows([handles[0], handles[2]], [pending[0], pending[2]]);
  assert.deepEqual(pending.map(({ conversationId }) => opens.get(conversationId) ?? 0), [1, 0, 1]);
  assert.equal(calls.get(target.id), 1, 'the retry refuses the slot before authorization');
});

test('prepareMany plain data: a frozen plain candidate keeps its memo', async t => {
  const { s, candidates, calls } = await fixture(t), pending = [...candidates];
  const target = Object.freeze({ ...candidates[1] });
  pending[1] = target;

  const handles = await retryAfterFirstHandle(s, pending, () => {});
  assertCandidateRows(handles, pending);
  assert.equal(calls.get(target.id), 1, 'the already frozen candidate needs only one authorization');
});

test('prepareMany plain data parity: a nested accessor at build forces fresh authorization', async t => {
  const { s, candidates, calls, opens } = await fixture(t), pending = [...candidates];
  const classification = { ...candidates[1].classification };
  const { kind } = classification;
  Object.defineProperty(classification, 'kind', { enumerable: true, configurable: true, get() {
    // The ordinary proof lookup reads this accessor. The candidate will be
    // plain by retry time, so the decision made at build time matters.
    Object.defineProperty(classification, 'kind', { enumerable: true, value: kind });
    return kind;
  } });
  pending[1] = { ...candidates[1], classification };

  const handles = await retryAfterFirstHandle(s, pending, () => {});
  assertCandidateRows(handles, candidates);
  assert.equal(Object.getOwnPropertyDescriptor(classification, 'kind').value, kind);
  assert.equal(calls.get(candidates[1].id), 2);
  assert.deepEqual(pending.map(({ conversationId }) => opens.get(conversationId) ?? 0), [1, 1, 1]);
});

function tracedProxy(target, traps) {
  const handler = Object.fromEntries(Object.keys(Object.getOwnPropertyDescriptors(Reflect)).map(name => [name, (...args) => {
    traps.push({ name, fromPlainCheck: new Error().stack.includes('at plainCandidateData (') });
    return Reflect[name](...args);
  }]));
  return new Proxy(target, handler);
}

test('prepareMany plain data parity: proxies on the candidate and ranges trigger no traps in the plain-data check', async t => {
  const { s, candidates, calls, opens } = await fixture(t), pending = [...candidates];
  const candidateTraps = [], rangesTraps = [];
  pending[1] = tracedProxy({ ...candidates[1] }, candidateTraps);
  pending[2] = { ...candidates[2], ranges: tracedProxy([...candidates[2].ranges], rangesTraps) };

  const handles = await retryAfterFirstHandle(s, pending, () => {});
  for (const [label, traps] of [['candidate', candidateTraps], ['ranges', rangesTraps]]) {
    const names = traps.map(({ name }) => name);
    t.diagnostic(`proxy ${label} traps ${JSON.stringify(names)}`);
    assert.ok(names.includes('get'), 'the ordinary build must exercise the proxy');
    assert.deepEqual(traps.filter(({ fromPlainCheck }) => fromPlainCheck), []);
  }
  assertCandidateRows(handles, candidates);
  assert.deepEqual(counts(candidates.slice(1), calls), [2, 2]);
  assert.deepEqual(candidates.map(({ conversationId }) => opens.get(conversationId) ?? 0), [1, 1, 1]);
});

test('prepareMany plain data parity: a ranges array with its own method rebuilds', async t => {
  const { s, candidates, calls } = await fixture(t), pending = [...candidates];
  const ranges = [...candidates[1].ranges];
  ranges.some = Array.prototype.some;
  pending[1] = { ...candidates[1], ranges };

  const handles = await retryAfterFirstHandle(s, pending, () => {});
  assertCandidateRows(handles, candidates);
  assert.equal(calls.get(pending[1].id), 2, 'the own array method makes the slot ineligible for reuse');
});
