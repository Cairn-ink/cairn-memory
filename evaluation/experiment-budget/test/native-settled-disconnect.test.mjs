import assert from 'node:assert/strict';
import test from 'node:test';
import { settledDisconnectProbe } from '../testing/native-settled-disconnect-fixture.mjs';
import { projectMixedNativeFailure } from '../../longmemeval/mixed-native-failure.mjs';
import { isMixedNativeFailure } from '../../longmemeval/mixed-native-failure-shape.mjs';

for (const prefix of [0, 8]) test(`D1/D2 accounted real UDS EPIPE seals native failure prefix ${prefix}`, async t => {
  const observed = await settledDisconnectProbe(t, { prefix });
  t.diagnostic(JSON.stringify({ prefix, events: observed.events, native: observed.value,
    scopeAtStop: observed.scopeAtStop, outer: observed.outer?.code ?? null }));
  assert.ok(observed.events.some(row => row.code === 'EPIPE' && row.syscall === 'write'));
  assert.equal(observed.outer, undefined, 'accounted response disconnect must not globally halt');
  assert.deepEqual(observed.value, { status: 'sealed', reason: 'native_response_disconnect', value: null });
  assert.equal(observed.result.status, 'failed');
  assert.equal(observed.result.reason, 'cancelled');
  assert.equal(observed.scopeAtStop.status, 'failed');
});

for (const mode of ['healthy', 'fin', 'received']) test(`D1 settled-disconnect ${mode} control completes`, async t => {
  const observed = await settledDisconnectProbe(t, { mode });
  assert.equal(observed.result.status, 'completed');
  assert.equal(observed.outer, undefined);
  assert.deepEqual(observed.events, []);
});

test('D4 late genuine malformed header overrides local response-disconnect seal', async t => {
  const observed = await settledDisconnectProbe(t, { mode: 'late-parser' });
  t.diagnostic(JSON.stringify({ events: observed.events, scopeAtStop: observed.scopeAtStop }));
  assert.equal(observed.scopeAtStop.status, 'failed');
  assert.ok(observed.events.some(row => row.code === 'HPE_INVALID_HEADER_TOKEN'));
  assert.equal(observed.inner.code, 'native_http_invalid');
  assert.equal(observed.outer.code, 'callback_failed');
});

for (const [veto, code] of [['accounting', 'native_accounting_unsettled'],
  ['descendants', 'native_process_group_live'], ['cleanup', 'native_cleanup_failed']]) {
  test(`D3/D4 ${veto} veto overrides settled response-disconnect`, async t => {
    const observed = await settledDisconnectProbe(t, { veto });
    assert.equal(observed.inner.code, code);
    assert.equal(observed.outer.code, 'callback_failed');
    assert.equal(observed.scopeAtStop.status, 'failed');
  });
}

for (const veto of ['settlement', 'scope', 'unknown']) test(`D2/D4 ${veto} cannot confer EPIPE local eligibility`, async t => {
  const observed = await settledDisconnectProbe(t, { veto });
  assert.equal(observed.inner.code, 'native_http_invalid');
  assert.equal(observed.outer.code, 'callback_failed');
  assert.equal(observed.scopeAtStop.status, 'active');
  const projected = projectMixedNativeFailure(observed.inner);
  assert.equal(projected.httpClientError.code, veto === 'unknown' ? 'other' : 'EPIPE');
  assert.equal(isMixedNativeFailure(JSON.parse(JSON.stringify(projected))), true);
});

test('D2/D4 new request on reused connection clears prior settled-response eligibility', async t => {
  const observed = await settledDisconnectProbe(t, { mode: 'reuse' });
  assert.equal(observed.inner.code, 'native_http_invalid');
  assert.equal(observed.outer.code, 'callback_failed');
  assert.equal(observed.scopeAtStop.status, 'active');
});

test('D2 additional lifecycle-injected EPIPE after child exit0 cannot publish cached native success', async t => {
  const observed = await settledDisconnectProbe(t, { mode: 'late-exit' });
  t.diagnostic(JSON.stringify({ native: observed.value, scope: observed.result }));
  assert.equal(observed.outer, undefined);
  assert.equal(observed.result.status, 'failed');
  assert.deepEqual(observed.value, { status: 'sealed', reason: 'native_response_disconnect', value: null });
});

test('NLB3 callback-only eligible EPIPE cannot publish native success', async t => {
  const observed = await settledDisconnectProbe(t, { mode: 'write-callback-epipe' });
  assert.ok(observed.events.some(row => row.code === 'callback_EPIPE'));
  assert.equal(observed.outer, undefined);
  assert.equal(observed.result.status, 'failed');
  assert.deepEqual(observed.value, { status: 'sealed', reason: 'native_response_disconnect', value: null });
});

test('NLB3 callback-only unknown write fault remains global', async t => {
  const observed = await settledDisconnectProbe(t, { mode: 'write-callback-unknown' });
  assert.ok(observed.events.some(row => row.code === 'callback_other'));
  assert.equal(observed.inner.code, 'native_http_invalid');
  assert.equal(observed.outer.code, 'callback_failed');
});

test('NLB3 revoke during successful write callback cannot resurrect response', async t => {
  const observed = await settledDisconnectProbe(t, { mode: 'write-callback-revoke' });
  assert.equal(observed.outer, undefined);
  assert.equal(observed.result.status, 'failed');
  assert.deepEqual(observed.value, { status: 'sealed', value: null });
  assert.equal(observed.events.some(row => row.code === 'end_after_revoke'), false);
});

test('NLB3 unknown teardown write callback after revoke remains global', async t => {
  const observed = await settledDisconnectProbe(t, { mode: 'write-callback-revoke-error' });
  assert.equal(observed.scopeAtStop.status, 'failed');
  assert.equal(observed.inner.code, 'native_http_invalid');
  assert.equal(observed.outer.code, 'callback_failed');
  assert.equal(projectMixedNativeFailure(observed.inner).httpClientError.code, 'other');
  assert.equal(observed.events.some(row => row.code === 'end_after_revoke'), false);
});

test('NLB4 pending write callback is drained after controlled child exit0 before kernel return', async t => {
  const observed = await settledDisconnectProbe(t, { mode: 'write-callback-delayed-exit' });
  assert.equal(observed.outer, undefined);
  assert.equal(observed.result.status, 'completed');
  const at = code => observed.events.find(row => row.code === code)?.atMs;
  assert.ok(at('controlled_child_closed') < at('delayed_callback_delivered'));
  assert.ok(at('delayed_callback_delivered') <= at('kernel_returned'));
});

test('NLB4 unexpected response-end callback exception cannot escape fail-closed cleanup', async t => {
  const observed = await settledDisconnectProbe(t, { mode: 'write-callback-end-throws' });
  assert.equal(observed.inner.code, 'native_gateway_failed');
  assert.equal(observed.outer.code, 'callback_failed');
});

test('NLB5 settled destroyed body-write ECANCELED after own revoke retains cancellation', async t => {
  const observed = await settledDisconnectProbe(t, { mode: 'write-callback-cancel-destroyed' });
  assert.equal(observed.outer, undefined);
  assert.equal(observed.result.status, 'failed');
  assert.deepEqual(observed.value, { status: 'sealed', value: null });
  assert.equal(observed.fixture.guard.isHalted(), false);
});

for (const mode of ['active', 'live', 'event', 'accessor', 'proxy']) {
  test(`NLB5 ${mode} ECANCELED cannot confer callback cancellation`, async t => {
    const observed = await settledDisconnectProbe(t, { mode: `write-callback-cancel-${mode}` });
    assert.equal(observed.inner.code, 'native_http_invalid');
    assert.equal(observed.outer.code, 'callback_failed');
    assert.equal(projectMixedNativeFailure(observed.inner).httpClientError.code, 'other');
    assert.equal(observed.events.some(row => ['getter_invoked', 'proxy_trap_invoked'].includes(row.code)), false);
  });
}

test('NLB5 unsettled response cannot confer own-revoked callback cancellation', async t => {
  const observed = await settledDisconnectProbe(t, { mode: 'write-callback-cancel-destroyed', veto: 'settlement' });
  assert.equal(observed.inner.code, 'native_http_invalid');
  assert.equal(observed.outer.code, 'callback_failed');
});
