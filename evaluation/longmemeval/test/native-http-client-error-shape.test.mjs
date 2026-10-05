import assert from 'node:assert/strict';
import test from 'node:test';
import { isMixedNativeFailure } from '../mixed-native-failure-shape.mjs';
import { reportSnapshot } from '../mixed-validation.mjs';
import { syntheticHttpClientFailure } from '../testing/native-http-client-error-fixture.mjs';

test('NHC2/NHC3 new diagnostic is exact enumerable bounded finite own data', () => {
  const valid = syntheticHttpClientFailure();
  assert.equal(isMixedNativeFailure(valid), true);
  assert.equal(isMixedNativeFailure(JSON.parse(JSON.stringify(valid))), true);
  for (const [key, value] of [
    ['version', 2], ['code', 'SECRET_ARBITRARY_CODE'], ['code', 'HPE_SECRET'],
    ['connectionOrdinal', 0], ['connectionOrdinal', 1_000_001], ['requestCount', -0],
    ['requestCount', 1_000_001], ['connectionRequestCount', 2],
    ['phase', 'private-phase'], ['stopping', 1], ['scopeStatus', 'unknown'],
    ['connectionAgeMs', 2_147_483_648], ['connectionAgeMs', -1],
    ['sinceLastResponseMs', Infinity], ['sinceLastResponseMs', -0],
    ['sinceLastResponseMs', '1'], ['sinceLastResponseMs', NaN],
  ]) {
    const row = syntheticHttpClientFailure(); row.httpClientError[key] = value;
    assert.equal(isMixedNativeFailure(row), false, key);
  }
  for (const alter of [row => { row.httpClientError.extra = 'PRIVATE_CANARY'; },
    row => { row.httpClientError[Symbol('extra')] = true; },
    row => { row.layer = 'gateway'; }, row => { row.reason = 'native_gateway_failed'; },
    row => { Object.defineProperty(row, 'reason', { enumerable: false }); },
    row => { Object.defineProperty(row, 'httpClientError', { enumerable: false }); },
    row => { Object.defineProperty(row.httpClientError, 'code', { enumerable: false }); }]) {
    const row = syntheticHttpClientFailure(); alter(row); assert.equal(isMixedNativeFailure(row), false);
  }
  for (const alter of [row => { Object.defineProperty(row, 'httpClientError', { enumerable: false }); },
    row => { Object.defineProperty(row.httpClientError, 'code', { enumerable: false }); }]) {
    const row = syntheticHttpClientFailure(); alter(row);
    assert.throws(() => reportSnapshot(row), { code: 'invalid_mixed_report' }, 'nonserializable own data must reject');
  }
  const capped = syntheticHttpClientFailure();
  Object.assign(capped.httpClientError, { connectionOrdinal: 1_000_000, requestCount: 1_000_000,
    connectionRequestCount: 1_000_000, connectionAgeMs: 2_147_483_647, sinceLastResponseMs: 2_147_483_647 });
  assert.equal(isMixedNativeFailure(capped), true);
});

test('NHC3 nested proxy/accessor diagnostics reject before callbacks', () => {
  let invoked = 0;
  const accessor = { ...syntheticHttpClientFailure().httpClientError };
  Object.defineProperty(accessor, 'code', { enumerable: true, get() { invoked++; return 'ECONNRESET'; } });
  const proxy = new Proxy(syntheticHttpClientFailure().httpClientError, {
    ownKeys() { invoked++; throw Error('PRIVATE_CANARY'); },
    getPrototypeOf() { invoked++; throw Error('PRIVATE_CANARY'); },
    get() { invoked++; throw Error('PRIVATE_CANARY'); },
  });
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  for (const value of [accessor, proxy, revoked.proxy, Object.create(accessor)]) {
    const row = syntheticHttpClientFailure(); row.httpClientError = value;
    assert.equal(isMixedNativeFailure(row), false);
    assert.throws(() => reportSnapshot(row), { code: 'invalid_mixed_report' });
  }
  assert.equal(invoked, 0);
});
