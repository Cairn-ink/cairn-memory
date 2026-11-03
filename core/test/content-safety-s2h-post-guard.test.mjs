import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';
import { safetyFixture, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';
import { drain } from '../testing/context-read-fixture.mjs';
import { openMemoryCore } from '../index.mjs';
import { openContextReadSidecar } from '../context-read-sidecar.mjs';
import { MemoryStoreError } from '../validation.mjs';

for (const layout of [18,23,33,34,38,48]) for (const action of ['abort','close'])
test(`refreshVectors post-guard ${action} v${layout}`, async t => {
  t.mock.method(performance, 'now', () => 0);
  const base = ({34:18,38:23,48:33})[layout] ?? layout;
  const f = safetyFixture(t, base); if (layout !== base) await f.migrate();
  const db = f.connect(); t.after(() => db.close());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, layout);
  const core = openMemoryCore({ path: f.path }); t.after(() => core.close());
  for (const suffix of ['first','second']) ok(core.admit({ namespace: ns,
    memory: { content: 'SyntheticProtectedPostGuard ' + suffix, kind: 'fact' }, receipts: [receipt(suffix)] }));
  const index = openContextReadSidecar({ path: f.path, db, batchSize: 1 }); t.after(() => index.close());
  const input = { readSet: [ns], types: ['memory'], intent: 'current', accessGeneration: 1,
    budget: { maxItems: 1024, maxMs: 5000 } };
  drain(index, input);
  const controller = new AbortController(); let returned = false, calls = 0, checks = 0, progress = 0;
  const port = { id: 'synthetic-post-guard', revision: 'one', dimensions: 8, normalization: 'l2',
    async embed() {
      calls++; assert.equal(db.isTransaction, false); returned = true;
      return [new Float32Array([1,0,0,0,0,0,0,0])];
    } };
  let result;
  try { result = { value: await index.refreshVectors(input, port, { signal: controller.signal,
    isCurrent() {
      if (returned) { checks++; if (action === 'abort') controller.abort(new MemoryStoreError('read_cancelled')); else index.close(); }
      return true;
    }, onProgress() { progress++; } }) }; }
  catch (error) { result = { error: { code: error.code } }; }
  // Reopen through the existing sidecar helper to inspect publication after close.
  const inspect = openContextReadSidecar({ path: f.path, db }); t.after(() => inspect.close());
  const vectors = inspect.semanticPreflight(input, port).embedded;
  t.diagnostic(JSON.stringify({ layout, action, calls, checks, progress, vectors, result }));
  assert.equal(result.value, undefined);
  assert.doesNotMatch(JSON.stringify(result), /SyntheticProtected/);
  assert.equal(result.error?.code, action === 'abort' ? 'read_cancelled' : 'store_closed');
  assert.equal(calls, 1, 'no later batch dispatch after refusal');
  assert.equal(checks, 1); assert.equal(progress, 1);
  assert.equal(vectors, 0, 'no committed vector');
});
