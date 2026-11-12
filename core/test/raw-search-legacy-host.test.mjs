import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { legacyRawHost, assertLegacyDelivery } from '../testing/raw-search-legacy-host.mjs';
import { installRawSearchTestClock } from '../testing/raw-search-clock.mjs';
import { readRawChannel } from '../context-read-three-layer.mjs';
import { contextOptions } from '../context-read-input.mjs';
import { openMemoryCore } from '../index.mjs';
import { openProductIndex } from '../context-product-index.mjs';
import { ok } from '../testing/raw-source-fixtures.mjs';

test.beforeEach(installRawSearchTestClock);
const options = rawSearch => ({ version: 'context-read-v1',
  authority: { authorize() {}, isCurrent() {} }, rawSearch });

test('legacy port and candidate-only authorizer preserve exact base trace bytes and complete delivery', async t => {
  const f = await legacyRawHost(t);
  assert.deepEqual(Object.keys(f.port), ['search', 'prepare', 'revalidate']);
  assert.equal(contextOptions(options(f.port)).rawSearch, f.port);
  const reader = openMemoryCore({ path: f.path, contextRead: options(f.port) });
  t.after(() => reader.close());
  assert.deepEqual(ok(reader.getContextReadCapabilities()).assembly.raw, { default: true, configured: true });
  assertLegacyDelivery(f, await readRawChannel(f.port, f.input, f.token, performance.now() + 1000));
});

test('legacy host recovers from a rejected optional batch without losing items or changing authorizer inputs', async t => {
  const f = await legacyRawHost(t); let batches = 0;
  f.port.prepareMany = async () => { batches++; throw Object.assign(Error('synthetic rejected batch'), { code: 'authority_required' }); };
  const result = await readRawChannel(f.port, f.input, f.token, performance.now() + 1000);
  assert.equal(batches, 1); assertLegacyDelivery(f, result);
});

test('optional native batch needs no batch declaration from the candidate-only authorizer', async t => {
  const f = await legacyRawHost(t);
  f.port.prepareMany = (...args) => f.s.service.prepareMany(...args);
  const result = await readRawChannel(f.port, f.input, f.token, performance.now() + 1000);
  assert.equal(result.coverage, 'included'); assert.equal(result.items.length, 3);
  assert.equal(JSON.stringify(f.events.filter(event => event.authorize)),
    JSON.stringify(f.expected().filter(event => event.authorize)), 'all authorization arguments equal base bytes');
  assert.deepEqual(result.items.map(item => item.value.messageId), f.issued.map(candidate => candidate.messageId));
});

test('missing preparation method is refused before local or product configuration is advertised', async t => {
  const f = await legacyRawHost(t), { prepare, ...invalid } = f.port;
  assert.throws(() => contextOptions(options(invalid)), { code: 'invalid_input' });
  assert.throws(() => openMemoryCore({ path: f.path, contextRead: options(invalid) }), { code: 'invalid_input' });
  assert.throws(() => openProductIndex({ rawSearch: invalid }), { code: 'invalid_input' });
  assert.deepEqual(await readRawChannel(invalid, f.input, f.token, performance.now() + 1000),
    { items: [], coverage: 'unavailable' });
});
