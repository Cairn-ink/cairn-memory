import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeClientErrorProbe } from '../testing/native-http-client-error-fixture.mjs';
import { projectMixedNativeFailure } from '../../longmemeval/mixed-native-failure.mjs';
import { Mem0NativeRuntimeError, nativeHttpClientErrorDiagnostic } from '../mem0-native-runtime.mjs';

for (const [mode, code] of [['bad-header', 'HPE_INVALID_HEADER_TOKEN'],
  ['partial-eof', 'HPE_INVALID_EOF_STATE'], ['header-timeout', 'ERR_HTTP_REQUEST_TIMEOUT']]) {
  test(`NHC1 genuine kernel settled prefix then ${mode} retains finite provenance`, async t => {
    const observed = await nativeClientErrorProbe(t, mode);
    const failure = projectMixedNativeFailure(observed.innerError);
    t.diagnostic(JSON.stringify({ mode, nativeReason: observed.innerError.code,
      guardReason: observed.outerError.code, requests: observed.requests,
      diagnosticPresent: Object.hasOwn(failure, 'httpClientError') }));
    assert.equal(failure.httpClientError?.code, code, 'first accepted clientError provenance is required');
    const diagnostic = failure.httpClientError;
    assert.equal(Object.isFrozen(failure), true); assert.equal(Object.isFrozen(diagnostic), true);
    assert.equal(diagnostic.connectionOrdinal, 2); assert.equal(diagnostic.requestCount, 1);
    assert.equal(diagnostic.connectionRequestCount, 0); assert.equal(diagnostic.phase, 'headers');
    assert.equal(diagnostic.stopping, false); assert.equal(diagnostic.scopeStatus, 'active');
    assert.ok(Number.isSafeInteger(diagnostic.connectionAgeMs) && diagnostic.connectionAgeMs >= 0);
    assert.ok(Number.isSafeInteger(diagnostic.sinceLastResponseMs) && diagnostic.sinceLastResponseMs >= 0);
    assert.deepEqual(JSON.parse(JSON.stringify(failure)), failure);
    assert.equal(nativeHttpClientErrorDiagnostic(observed.innerError), diagnostic);
    // Genuine error provenance ignores hostile caller properties entirely.
    Object.defineProperty(observed.innerError, 'httpClientError', { get() { assert.fail('caller getter'); } });
    assert.equal(projectMixedNativeFailure(observed.innerError).httpClientError, diagnostic);
    const forged = new Mem0NativeRuntimeError('native_http_invalid');
    forged.httpClientError = diagnostic;
    assert.equal(nativeHttpClientErrorDiagnostic(forged), undefined);
    assert.deepEqual(projectMixedNativeFailure(forged), { version: 1, layer: 'runtime', reason: 'native_http_invalid' });
    const hostile = new Proxy(observed.innerError, { get() { assert.fail('proxy get'); },
      getPrototypeOf() { assert.fail('proxy prototype'); } });
    assert.equal(nativeHttpClientErrorDiagnostic(hostile), undefined);
    assert.equal(projectMixedNativeFailure(hostile), undefined);
  });
}

test('NHC1 complete HTTP with invalid JSON remains gateway_failed without clientError diagnostic', async t => {
  const observed = await nativeClientErrorProbe(t, 'bad-json');
  assert.deepEqual(projectMixedNativeFailure(observed.innerError),
    { version: 1, layer: 'runtime', reason: 'native_gateway_failed' });
});

test('NHC1 genuine kernel healthy settled prefix permits next scope', async t => {
  await nativeClientErrorProbe(t, 'healthy');
});
