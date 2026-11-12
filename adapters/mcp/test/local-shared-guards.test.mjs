import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalAuthorityRouter } from '../local-authority-router.mjs';
import { createContextReadAccess } from '../context-read-access.mjs';
import { createLocalContextContinuations } from '../local-context-continuations.mjs';
import { ns, ok, deferred } from './local-shared-support.mjs';

test('revocation refuses late provider results and subsequent provider invocations only for the owner', async () => {
  const router = createLocalAuthorityRouter(), a = router.register({}), b = router.register({});
  const gate = deferred();
  let calls = 0;
  const provider = router.protect(Object.freeze({ dimensions: 1, async embed() { assert.equal(this.dimensions, 1); calls++; await gate.promise; return [[1]]; } }));
  const pending = a.run(() => provider.embed(['synthetic']));
  a.revoke(); gate.resolve();
  await assert.rejects(pending, { code: 'authority_required' });
  a.run(() => assert.throws(() => provider.embed(['synthetic']), { code: 'authority_required' }));
  assert.deepEqual(await b.run(() => provider.embed(['synthetic'])), [[1]]);
  assert.equal(calls, 2);
});

test('operation tokens and grants route once to their exact connection, including across awaits', async () => {
  const router = createLocalAuthorityRouter(), authority = router.authority('context');
  const a = createContextReadAccess(ns), b = createContextReadAccess(ns);
  let bAuthorizations = 0;
  const port = b.configuration.authority;
  const ar = router.register({ context: a.configuration.authority });
  const br = router.register({ context: { ...port, authorize(...args) { bAuthorizations++; return port.authorize(...args); } } });
  const input = { readSet: [ns], types: ['memory'], query: 'synthetic', intent: 'current' };
  let tokenA, grantA, requestA;
  const core = Object.freeze({ findCandidates(payload, token) {
    tokenA = token;
    requestA = { method: 'findCandidates', input: payload, namespace: ns, actionClass: 'read', actionId: null, targetId: null, expectedRevision: null };
    grantA = authority.authorize(requestA, token);
    assert.ok(grantA, 'dispatch must reach the owner synchronously');
    br.run(() => assert.equal(authority.authorize(requestA, token), null, 'even a live A token cannot authorize B'));
    assert.equal(router.authority('assets').isCurrent(grantA, requestA), null, 'grants also belong to the exact authority port');
    return { ok: true, value: {} };
  } });
  const dispatched = ar.run(() => a.call(ar.core(core), 'findCandidates', input));
  assert.equal(dispatched.ok, true, 'dispatch remains synchronous up to authority admission');
  br.run(() => {
    assert.equal(authority.authorize(requestA, tokenA), null);
    assert.equal(authority.isCurrent(grantA, requestA), null, 'A grant is not B authority');
  });
  assert.equal(bAuthorizations, 0, 'unknown tokens must not probe other authorities');
  await ar.run(async () => {
    await Promise.resolve();
    assert.equal(authority.isCurrent(grantA, requestA).accessGeneration, 1);
    ar.revoke();
    assert.equal(authority.isCurrent(grantA, requestA), null);
  });
  const maintenance = createContextReadAccess(ns, false, { refresh: true });
  const mr = router.register({ context: maintenance.configuration.authority });
  const refreshCore = { refreshContextIndex(payload, token) {
    const grant = authority.authorize({ ...requestA, method: 'refreshContextIndex', input: payload }, token);
    assert.ok(grant); assert.equal(authority.isCurrent(grant).accessGeneration, 1);
    return { ok: true, value: {} };
  } };
  mr.run(() => ok(maintenance.call(mr.core(refreshCore), 'refreshContextIndex', input)));
  br.run(() => assert.equal(b.call(br.core(refreshCore), 'refreshContextIndex', input).error.code, 'authority_required'));
});

test('continuations have per-connection and per-field ownership, fixed expiry and disconnect erasure', () => {
  let time = 1000;
  const a = createLocalContextContinuations({ now: () => time }), b = createLocalContextContinuations({ now: () => time });
  const original = { ok: true, value: { nextCursor: 'synthetic-signed-metadata', snapshot: 'synthetic-snapshot-metadata', items: [{ text: 'SYNTHETIC_NOT_RETAINED' }] } };
  const wrapped = a.wrap(original), tokens = wrapped.value;
  assert.notEqual(tokens.nextCursor, original.value.nextCursor);
  assert.ok(tokens.nextCursor.length <= 8192 && tokens.snapshot.length <= 16384);
  assert.equal(a.unwrap({ cursor: tokens.nextCursor }).input.cursor, original.value.nextCursor);
  assert.equal(b.unwrap({ cursor: tokens.nextCursor }).error?.error?.code, 'cursor_stale', 'copied cursor fails closed');
  assert.equal(b.unwrap({ snapshot: tokens.snapshot }).error?.error?.code, 'snapshot_stale');
  assert.equal(a.unwrap({ cursor: tokens.snapshot }).error?.error?.code, 'cursor_stale', 'snapshot cannot be used as cursor');
  assert.equal(a.unwrap({ snapshot: tokens.nextCursor }).error?.error?.code, 'snapshot_stale');
  assert.equal(a.unwrap({ cursor: 'unknown' }).error?.error?.code, 'cursor_stale');
  assert.ok(!JSON.stringify(a.inspect()).includes('SYNTHETIC_NOT_RETAINED'));
  time += 299999;
  assert.ok(a.unwrap({ cursor: tokens.nextCursor }).input);
  time++;
  assert.equal(a.unwrap({ cursor: tokens.nextCursor }).error?.error?.code, 'cursor_stale', 'use must never renew TTL');
  const fresh = a.wrap(original).value;
  a.close(); assert.equal(a.inspect().entries, 0, 'disconnect clears retained metadata'); assert.equal(a.inspect().bytes, 0);
  assert.equal(a.unwrap({ snapshot: fresh.snapshot }).error?.error?.code, 'snapshot_stale');
  assert.equal(a.inspect().entries, 0);
});

test('continuation capacity is 128 entries and one MiB independently for every connection', () => {
  const a = createLocalContextContinuations(), b = createLocalContextContinuations();
  const first = a.wrap({ ok: true, value: { nextCursor: 'signed' } }).value.nextCursor;
  for (let i = 0; i < 127; i++) a.wrap({ ok: true, value: { nextCursor: 'signed' } });
  assert.equal(a.inspect().entries, 128); assert.ok(a.unwrap({ cursor: first }).input);
  for (let i = 0; i < 200; i++) b.wrap({ ok: true, value: { nextCursor: 'signed' } });
  assert.ok(a.unwrap({ cursor: first }).input, 'B churn cannot evict A');
  a.wrap({ ok: true, value: { nextCursor: 'signed' } });
  assert.equal(a.unwrap({ cursor: first }).error?.error?.code, 'cursor_stale', '129th entry evicts oldest');
  const large = createLocalContextContinuations();
  for (let i = 0; i < 128; i++) large.wrap({ ok: true, value: { snapshot: 'm'.repeat(16384) } });
  assert.ok(large.inspect().bytes <= 1048576, 'one MiB maximum applies before entry limit'); assert.equal(large.inspect().entries, 63);
  a.close(); b.close(); large.close();
});

test('idle continuations are erased at their fixed expiry without another request', t => {
  let time = 0, clockReads = 0, cleanup;
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => {
    assert.equal(delay, 300000); cleanup = callback; return { unref() {} };
  });
  t.mock.method(globalThis, 'clearTimeout', () => {});
  const a = createLocalContextContinuations({ now: () => { clockReads++; return time; } });
  a.wrap({ ok: true, value: { snapshot: 'synthetic-signed-metadata' } });
  assert.equal(typeof cleanup, 'function', 'idle cleanup timer must be armed');
  const before = clockReads; time = 300000; cleanup();
  assert.ok(clockReads > before, 'idle expiry cleanup must run without another lookup');
  assert.equal(a.inspect().entries, 0); assert.equal(a.inspect().bytes, 0); a.close();
});
