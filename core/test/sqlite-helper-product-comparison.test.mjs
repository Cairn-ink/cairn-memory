import { faults } from './fixtures/sqlite-helper-child-faults.mjs';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { utimesSync, statSync } from 'node:fs';
import { fixture, ns } from '../testing/context-read-fixture.mjs';
import { nativeObserver, nativeTelemetry } from '../context-product-telemetry.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { openProductIndex } from '../context-product-index.mjs';
import { accessDigest } from '../context-product-validation.mjs';
import { PRODUCT_SIDECAR_SUFFIX } from '../context-product-sidecar.mjs';

beforeEach(t => faults.install(t));
const ownerCoverage = { policy: 'recent-projects-v1', selectionRevision: 'synthetic', requestedNamespaces: 1, selectedNamespaces: 1, omittedNamespaces: 0 };
const selection = { readSet: [ns], types: ['memory'], intent: 'current' };
const refresh = { ...selection, mode: 'lexical', budget: { maxItems: 1024, maxMs: 5000 } };
function index(t, path, observer) {
  const facade = openContextProductFacade(path, {}); t.after(() => facade.close());
  const access = { accessGenerations: accessDigest({ ownerId: ns.ownerId, namespaces: { readSet: [ns] } }), check() {}, envelope: work => work() };
  const h = openProductIndex({ path, facade, observer, maintenance: true, authorize: () => access, ownerCoverage, now: () => 0, counter: { id: 'synthetic', countTokens: () => 1 } });
  t.after(() => h.close()); return h;
}
function build(h) {
  for (let i = 0; i < 100; i++) {
    const r = h.run('refreshContextIndex', refresh); assert.equal(r.ok, true, JSON.stringify(r));
    if (r.value.status === 'complete') return;
  }
  assert.fail('COMPARISON_RETRY_CONVERGES');
}
// The same file runs unchanged with main, round 2, and round 3 production.
// Results are compared by the dispatch driver; fault/retry/frame checks run here.
for (const method of ['getContextIndexStatus', 'findCandidates', 'contextRead', 'refreshContextIndex'])
for (const site of ['probe-364', 'probe-394'])
for (const observed of [true, false])
for (const [fault, mode] of [['timeout', 1], ['exit', 2]])
test(`PRODUCT_COMPARISON ${method} ${site} ${observed} ${fault}`, t => {
  const f = fixture(t), observer = observed ? nativeObserver() : undefined;
  let h = index(t, f.path, observer); build(h);
  if (site === 'probe-394') { h.close(); h = index(t, f.path, observer); }
  const path = f.path + PRODUCT_SIDECAR_SUFFIX, s = statSync(path);
  utimesSync(path, s.atime, new Date(s.mtimeMs + 1000));
  const frame = nativeTelemetry('comparison', 1); observer?.select(frame);
  faults.arm(4, mode);
  const input = method === 'refreshContextIndex' ? refresh : method === 'getContextIndexStatus'
    ? { ...selection, deadlineMs: 5000 } : { ...selection, query: 'synthetic', deadlineMs: 5000 };
  const result = h.run(method, input), counters = new Int32Array(frame.buffer);
  console.log(JSON.stringify({ marker: 'PRODUCT_COMPARISON', method, site, observed, fault, result, slot5: counters[5], slot6: counters[6] }));
  assert.equal(faults.counts.injected, 1, 'COMPARISON_REAL_CHILD');
  if (mode === 1) assert.equal(faults.counts.reached, 1, 'COMPARISON_REAL_TIMEOUT');
  assert.equal(counters[5], 0, 'COMPARISON_BALANCED_FRAME');
  assert.equal(counters[6], observed ? 1 : 0, 'COMPARISON_INCOMPLETE_FRAME');
  faults.reset(); observer?.select(nativeTelemetry('retry', 1));
  if (method === 'refreshContextIndex') build(h);
  else assert.equal(h.run(method, input).ok, true, 'COMPARISON_NEXT_SUCCEEDS');
});
