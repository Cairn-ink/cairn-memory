import assert from 'node:assert/strict';
import test from 'node:test';

import { Mem0NativeRuntimeError } from '../../experiment-budget/mem0-native-runtime.mjs';
import { Mem0NativeGatewayError, runMem0NativeCase } from '../../experiment-budget/mem0-native-gateway.mjs';
import { Mem0NativeArtifactError } from '../../experiment-budget/mem0-native-artifact.mjs';
import { projectMixedNativeFailure } from '../mixed-native-failure.mjs';
import { freeze, reportSnapshot } from '../mixed-validation.mjs';

test('NF1/NF2 finite native classifications are immutable exact own data', () => {
  for (const [ErrorClass, layer, reason] of [
    [Mem0NativeRuntimeError, 'runtime', 'native_gateway_failed'],
    [Mem0NativeRuntimeError, 'runtime', 'native_reap_failed'],
    [Mem0NativeRuntimeError, 'runtime', 'native_child_failed'],
    [Mem0NativeGatewayError, 'gateway', 'native_guard_required'],
    [Mem0NativeGatewayError, 'gateway', 'native_artifact_changed'],
    [Mem0NativeGatewayError, 'gateway', 'invalid_native_input'],
  ]) {
    const error = new ErrorClass(reason);
    for (const key of ['message', 'stack', 'cause', 'name', 'constructor']) {
      Object.defineProperty(error, key, { get() { assert.fail(`${key} read`); } });
    }
    const observation = projectMixedNativeFailure(error);
    assert.deepEqual(observation, { version: 1, layer, reason });
    assert.deepEqual(Reflect.ownKeys(observation), ['version', 'layer', 'reason']);
    assert.equal(Object.isFrozen(observation), true);
    assert.ok(Object.values(Object.getOwnPropertyDescriptors(observation))
      .every(descriptor => Object.hasOwn(descriptor, 'value') && !descriptor.writable));
    error.code = 'changed_after_projection';
    assert.equal(observation.reason, reason);
    assert.throws(() => { observation.reason = 'caller-value'; }, TypeError);
    const retained = freeze(reportSnapshot({ diagnostics: { nativeFailure: observation } }));
    assert.deepEqual({ ...retained.diagnostics.nativeFailure }, observation);
    assert.deepEqual(Reflect.ownKeys(retained.diagnostics.nativeFailure), ['version', 'layer', 'reason']);
    assert.equal(Object.isFrozen(retained.diagnostics.nativeFailure), true);
  }
});

test('NF2 rejects hostile codes, descriptors, proxies and unknown classes without reading them', () => {
  const revoked = Proxy.revocable(new Mem0NativeRuntimeError('native_gateway_failed'), {});
  revoked.revoke();
  const hostileProxy = new Proxy(new Mem0NativeRuntimeError('native_gateway_failed'), {
    get() { assert.fail('proxy get'); },
    getPrototypeOf() { assert.fail('proxy prototype'); },
    getOwnPropertyDescriptor() { assert.fail('proxy descriptor'); },
    ownKeys() { assert.fail('proxy keys'); },
  });
  class UnknownNativeSubclass extends Mem0NativeRuntimeError {}
  const fake = Object.create(Mem0NativeRuntimeError.prototype);
  Object.defineProperty(fake, 'code', { value: 'native_gateway_failed' });
  const missing = new Mem0NativeRuntimeError('native_gateway_failed');
  delete missing.code;
  const accessor = new Mem0NativeRuntimeError('native_gateway_failed');
  Object.defineProperty(accessor, 'code', { get() { assert.fail('code getter'); } });
  for (const value of [null, undefined, 1, 'native_gateway_failed',
    { code: 'native_gateway_failed' }, fake, missing, accessor, hostileProxy, revoked.proxy,
    new Error('native_gateway_failed'), new Mem0NativeArtifactError('native_artifact_changed'),
    new UnknownNativeSubclass('native_gateway_failed'),
    new Mem0NativeGatewayError('native_gateway_failed'),
    new Mem0NativeRuntimeError('invalid_native_input')]) {
    assert.equal(projectMixedNativeFailure(value), undefined);
  }
  for (const value of ['', 'native_future_code', 'native_gateway_failed\nsecret',
    'secret-key-path-url', null, undefined, 1, Symbol('secret'),
    { toString() { assert.fail('coercion'); } },
    new Proxy({}, { get() { assert.fail('code proxy'); } })]) {
    // Avoid the native Error constructor's message coercion: only the code is hostile.
    const error = new Mem0NativeRuntimeError('native_gateway_failed');
    error.code = value;
    assert.equal(projectMixedNativeFailure(error), undefined);
  }
});

test('NF4 genuine gateway rejection projects its category without retaining thrown payload', async () => {
  let caught;
  try {
    await runMem0NativeCase({ artifact: {}, configuration: {}, guard: {}, handle: {},
      input: { batches: [[{ role: 'user', content: '\ud800' }]], query: 'synthetic' } });
  } catch (error) { caught = error; }
  assert.ok(caught instanceof Mem0NativeGatewayError);
  assert.deepEqual(projectMixedNativeFailure(caught),
    { version: 1, layer: 'gateway', reason: 'invalid_native_input' });
});
