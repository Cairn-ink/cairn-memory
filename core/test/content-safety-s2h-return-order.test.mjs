import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';
import { safetyFixture, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';
import { host, waitForContextEntry } from '../testing/context-read-core-fixture.mjs';
import { drain } from '../testing/context-read-fixture.mjs';
import { openMemoryCore } from '../index.mjs';
import { openContextReadSidecar } from '../context-read-sidecar.mjs';
import { MemoryStoreError } from '../validation.mjs';

const projection = { readSet: [ns], types: ['memory'], intent: 'current' };
const refresh = { ...projection, budget: { maxItems: 1024, maxMs: 5000 } };
const vector = () => new Float32Array([1,0,0,0,0,0,0,0]);
const gate = () => { let release; return { promise: new Promise(resolve => { release = resolve; }), release: () => release() }; };
async function fixture(t, layout) {
  const base = ({34:18,38:23,48:33})[layout] ?? layout;
  const f = safetyFixture(t, base); if (layout !== base) await f.migrate();
  const db = f.connect(); t.after(() => db.close());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, layout);
  return { ...f, db };
}
function admit(core, suffix) {
  return ok(core.admit({ namespace: ns, memory: { content: 'SyntheticProtectedEmbedding ' + suffix, kind: 'fact' },
    receipts: [receipt('embedding-' + suffix)] }));
}
function noContent(value) {
  assert.doesNotMatch(JSON.stringify(value), /SyntheticProtected/);
  assert.equal(value.value, undefined);
}

for (const layout of [18,23,33,34,38,48]) {
  // Below the public facade: these close tests fail on ba04ab33, whose
  // caller-return guard selects scope_changed before observing closure.
  for (const outcome of ['vector','provider_error','timeout','abort','revoked','guard-close'])
  test(`refreshVectors return refusal v${layout} ${outcome}`, async t => {
    t.mock.method(performance, 'now', () => 0);
    const f = await fixture(t, layout), core = openMemoryCore({ path: f.path });
    t.after(() => core.close()); admit(core, 'direct');
    const index = openContextReadSidecar({ path: f.path, db: f.db }); t.after(() => index.close());
    const input = { ...refresh, accessGeneration: 1 }; drain(index, input);
    const entered = gate(), release = gate(), controller = new AbortController();
    let current = true, calls = 0, afterReturnChecks = 0, embedded = 0, returned = false;
    const port = { id: 'synthetic-return-order', revision: 'direct', dimensions: 8, normalization: 'l2',
      async embed() {
        calls++; assert.equal(f.db.isTransaction, false); entered.release(); await release.promise;
        returned = true;
        if (['provider_error','timeout'].includes(outcome)) throw Object.assign(new Error(outcome), { code: outcome });
        return [vector()];
      } };
    const operation = index.refreshVectors(input, port, { signal: controller.signal,
      isCurrent() { if (returned) { afterReturnChecks++; if (outcome === 'guard-close') index.close(); } return current; },
      onProgress(value) { embedded = value.embedded; } });
    const observed = operation.then(value => ({ value }), error => ({ error }));
    try {
      await waitForContextEntry(entered.promise, operation);
      current = outcome === 'guard-close';
      if (!['revoked','guard-close'].includes(outcome)) index.close();
      if (outcome === 'abort') controller.abort(new MemoryStoreError('read_cancelled'));
      release.release();
      const result = await observed; noContent(result);
      assert.equal(calls, 1); assert.equal(embedded, 0);
      assert.ok(result.error instanceof MemoryStoreError);
      assert.equal(result.error.code, outcome === 'abort' ? 'read_cancelled' : outcome === 'revoked' ? 'scope_changed' : 'store_closed');
      assert.equal(afterReturnChecks, ['revoked','guard-close'].includes(outcome) ? 1 : 0);
      t.diagnostic(JSON.stringify({ layout, outcome, layer: 'sidecar', calls, embedded, afterReturnChecks, code: result.error.code }));
    } finally { release.release(); await observed; }
  });

  // The old delivery wrapper masks the inner difference on ba04ab33.
  // These public regressions instead fail on the rule-A-only candidate.
  for (const outcome of ['vector','provider_error','timeout'])
  test(`refreshContextIndex singleton close v${layout} ${outcome}`, async t => {
    t.mock.method(performance, 'now', () => 0);
    const f = await fixture(t, layout), trusted = host(), entered = gate(), release = gate();
    let calls = 0, returned = false;
    const embedder = { id: 'synthetic-return-order', revision: `public-${layout}-${outcome}`, dimensions: 8, normalization: 'l2',
      async embed(texts) {
        calls++; assert.equal(texts.length, 1); assert.equal(f.db.isTransaction, false);
        if (calls === 2) {
          entered.release(); await release.promise; returned = true;
          if (outcome !== 'vector') throw Object.assign(new Error(outcome), { code: outcome });
        }
        return [vector()];
      } };
    const core = openMemoryCore({ path: f.path, contextRead: { version: 'context-read-v1', authority: trusted.authority,
      embedder, policy: { family: 'local', maxRequests: 100, maxConcurrent: 1, maxBatchDocuments: 1 },
      localStatus: () => ({ state: 'ready', reason: null }) } });
    t.after(() => core.close()); admit(core, 'first'); admit(core, 'second');
    const operation = trusted.call(core, 'refreshContextIndex', refresh);
    try {
      await waitForContextEntry(entered.promise, operation);
      core.close(); release.release();
      const result = await operation; noContent(result);
      assert.equal(returned, true); assert.equal(calls, 2);
      assert.deepEqual(result, { ok: false, error: { code: 'store_closed', retryable: false } });
      t.diagnostic(JSON.stringify({ layout, outcome, layer: 'public', calls, code: result.error.code }));
    } finally { release.release(); await operation; }
  });
}
