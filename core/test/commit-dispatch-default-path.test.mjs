import { testClock } from '../testing/context-product-test-clock.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import threads from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';

const preload = new URL('./fixtures/commit-dispatch-default-guard.mjs', import.meta.url).href;
await import(preload);
const PreviousWorker = threads.Worker;
threads.Worker = class extends PreviousWorker {
  constructor(entry, options = {}) {
    super(entry, { ...options, execArgv: [...(options.execArgv ?? []), '--import', preload] });
  }
};
syncBuiltinESMExports();

const { setupProductSemantic, ns, ok } = await import('../testing/content-safety-s2h-product-semantic-probe.mjs');
const { openContextIndexMaintainer, openContextProductReader } = await import('../index.mjs');
const { maintenanceFailureDiagnostic } = await import('../context-product-reader.mjs');
const { createCommitDispatcher } = await import('../commit-dispatch.mjs');

// Same v33 DELETE setup and getter/account event as the unchanged main gate.
// A dispatcher-only entry throws in every realm, including the native Workers.
test('unbound native Worker v33 DELETE getter/account never reaches dispatcher-only code', async t => {
  assert.throws(() => createCommitDispatcher(), /R2M_DEFAULT_DISPATCHER_REACHED:createCommitDispatcher/,
    'R2M_DEFAULT_GUARD_ACTIVE');
  const portState = new SharedArrayBuffer(64), state = new Int32Array(portState);
  t.after(() => { Atomics.store(state, 11, 1); Atomics.notify(state, 11); });
  const s = await setupProductSemantic(t, { version: 33, family: 'event-time', safety: true, corpus: 12,
    canonicalMode: 'DELETE', host: { portState, factMutation: 'account', counterDivisor: 1000 } });
  ok(await s.coordinator.setOwnerSemantic({ ownerId: ns.ownerId, semantic: true, expectedRevision: 0 }, s.token));
  const m = s.configure(true);
  Object.assign(m.options.host.configuration, { portState, counterDivisor: 1000 });
  const maintainer = await openContextIndexMaintainer(m.options);
  s.f.workspace.defer(() => maintainer.close());
  const input = { readSet: [ns], types: ['memory'], intent: 'current' };
  ok(await maintainer.refreshContextIndex({ ...input, mode: 'lexical', budget: { maxItems: 1024, maxMs: 5000 } }, m.credential));
  const refreshed = await maintainer.refreshContextIndex({ ...input, mode: 'embeddings', budget: { maxItems: 1024, maxMs: 5000, maxUsd: '0.50' } }, m.credential);
  assert.equal(refreshed.ok, true, 'R2M_DEFAULT_NATIVE_REFRESH:' + JSON.stringify({ refreshed, failure: maintenanceFailureDiagnostic(refreshed) }));
  assert.equal(refreshed.value.channels.semantic.state, 'ready');
  const r = s.configure(false);
  Object.assign(r.options.host.configuration, { portState, counterDivisor: 1000 });
  const reader = await openContextProductReader(r.options);
  s.f.workspace.defer(() => reader.close());
  Atomics.store(state, 0, 4);
  const result = await reader.contextRead({ ...input, query: 'semantic', semantic: true, deadlineMs: 5000,
    budget: { maxTokens: 4000, maxItems: 12 } }, r.credential);
  assert.equal(Atomics.load(state, 1), 1, 'getter committed account erasure');
  assert.equal(result.ok, false);
  assert.doesNotMatch(JSON.stringify(result), /semantic probecommon synthetic evidence/);
  assert.equal(Atomics.load(state, 2), 0, 'no provider after account erasure');
  assert.equal(Atomics.load(state, 6), 0, 'first SQL after caller return is the autocommit epoch');
  assert.equal(Atomics.load(state, 12), Atomics.load(state, 8));
  await reader.close(); await maintainer.close(); await s.coordinator.close(); await s.supervisor.close();
  await testClock.advance(5001, { waitForWorkers: false });
});
