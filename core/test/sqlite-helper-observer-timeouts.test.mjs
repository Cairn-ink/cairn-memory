import { faults } from './fixtures/sqlite-helper-child-faults.mjs';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { utimesSync, statSync } from 'node:fs';
import { fixture, ns } from '../testing/context-read-fixture.mjs';
import { nativeObserver, nativeTelemetry, drainNative, sealNative } from '../context-product-telemetry.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { openProductIndex } from '../context-product-index.mjs';
import { accessDigest } from '../context-product-validation.mjs';
import { createProductSqlitePolicy } from '../context-product-sqlite.mjs';
import { PRODUCT_SIDECAR_SUFFIX } from '../context-product-sidecar.mjs';

beforeEach(t => faults.install?.(t));
const ownerCoverage = { policy: 'recent-projects-v1', selectionRevision: 'synthetic', requestedNamespaces: 1, selectedNamespaces: 1, omittedNamespaces: 0 };
const input = { readSet: [ns], types: ['memory'], intent: 'current', deadlineMs: 5000 };
const refresh = { readSet: [ns], types: ['memory'], intent: 'current', mode: 'lexical', budget: { maxItems: 1024, maxMs: 5000 } };
function index(t, path, observer, policy = false) {
  const sqlite = policy ? createProductSqlitePolicy({ observer, now: () => 0 }) : undefined; sqlite?.start(Infinity);
  const facade = openContextProductFacade(path, {}); t.after(() => facade.close());
  const access = { accessGenerations: accessDigest({ ownerId: ns.ownerId, namespaces: { readSet: [ns] } }), check() {}, envelope: work => work() };
  const h = openProductIndex({ path, facade, observer, sqlite, maintenance: true, authorize: () => access, ownerCoverage, now: () => 0 });
  t.after(() => h.close()); return h;
}
function build(h) {
  for (let i = 0; i < 100; i++) {
    const r = h.run('refreshContextIndex', refresh); assert.equal(r.ok, true, JSON.stringify(r));
    if (r.value.status === 'complete') return;
  }
  assert.fail('OBSERVER_RETRY_CONVERGES');
}
const unavailableStatus = {
  profile: 'context-read-product-v1.1',
  lexical: { state: 'unavailable', reason: 'storage_unavailable', progress: null },
  semantic: { state: 'disabled', reason: 'not_enabled' },
  coverage: { status: 'unavailable', freshness: 'unverified', byType: { memory: { eligible: null, indexed: null, embedded: null } }, namespaces: ownerCoverage },
};
for (const site of ['creation-265', 'probe-364', 'probe-394'])
for (const observed of site === 'creation-265' ? [true] : [true, false])
for (const [fault, mode] of [['timeout', 1], ['exit', 2]])
test(`OBSERVER_LIVE ${site} ${observed ? 'observer' : 'plain'} ${fault}: public envelope, balanced counters, successful retry`, t => {
  const f = fixture(t), observer = nativeObserver();
  let h;
  if (site !== 'creation-265') {
    h = index(t, f.path, observed ? observer : undefined); build(h);
    if (site === 'probe-394') { h.close(); h = index(t, f.path, observed ? observer : undefined); }
    // Force a real cache miss without any raw database descriptor.
    const path = f.path + PRODUCT_SIDECAR_SUFFIX, s = statSync(path);
    utimesSync(path, s.atime, new Date(s.mtimeMs + 1000));
  } else h = index(t, f.path, observer, true);
  const frame = nativeTelemetry(site, 1); observer.select(frame);
  faults.arm(site === 'creation-265' ? 3 : 4, mode); t.after(() => faults.reset());
  const method = site === 'creation-265' ? 'refreshContextIndex' : 'getContextIndexStatus';
  const result = h.run(method, method === 'refreshContextIndex' ? refresh : input);
  console.log(JSON.stringify({ marker: 'STATUS_RESULT', site, observed, fault, method, result }));
  assert.equal(faults.counts.injected, 1, 'OBSERVER_REAL_CHILD_FAULT');
  if (fault === 'timeout') assert.equal(faults.counts.reached, 1, 'OBSERVER_REAL_CHILD_TIMEOUT');
  if (site !== 'creation-265' && observed) {
    assert.equal(result.ok, true, 'OBSERVER_PUBLIC_STATUS');
    assert.deepEqual(result.value, unavailableStatus, 'OBSERVER_FULL_STATUS_VALUE');
  } else assert.deepEqual(result, { ok: false, error: { code: mode === 1 ? 'storage_busy' : 'storage_error', retryable: mode === 1 } }, 'OBSERVER_PUBLIC_BUSY');
  const v = new Int32Array(frame.buffer);
  assert.equal(v[5], 0, 'OBSERVER_SLOT5_BALANCED');
  assert.equal(v[6], observed ? 1 : 0, 'OBSERVER_SLOT6_INCOMPLETE');
  sealNative(frame); assert.equal(drainNative(frame, true).coverage, observed ? 'incomplete' : 'complete');
  const next = nativeTelemetry(site + '-retry', 1); observer.select(next);
  faults.reset();
  if (site === 'creation-265') build(h);
  else assert.equal(h.run(method, input).ok, true, 'OBSERVER_NEXT_SUCCEEDS');
  assert.equal(new Int32Array(next.buffer)[5], 0);
  assert.equal(new Int32Array(next.buffer)[6], 0);
  console.log(JSON.stringify({ marker: 'OBSERVER_LIVE', site, slot5: v[5], slot6: v[6], next: 'success' }));
});
