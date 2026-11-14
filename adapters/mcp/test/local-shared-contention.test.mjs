import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { rationaleModel } from '../../../core/testing/rationale-model.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { createLocalSharedRuntime as createSharedRuntime } from '../local-shared-runtime.mjs';
const createLocalSharedRuntime = options => createSharedRuntime(options, { strict: true });
import { ns, counter, query, ok, connect, call, context, holdWriteLock } from './local-shared-support.mjs';

for (const holdMs of [3000, 7000]) test(`A4 eight connections remain responsive under an external ${holdMs}ms canonical write lock`, { timeout: 60000 }, async t => {
  const w = createTestWorkspace(t), path = join(w.path, 'synthetic-contention.sqlite');
  // The default MCP client is Memory-only; exercise real retained Raw here.
  const host = createLocalSharedRuntime({ path, namespace: ns, client: 'codex', contextCounter: counter, model: rationaleModel(), captureQualification: 'source-bound-v2' });
  w.defer(() => host.close());
  const clients = [];
  for (let i = 0; i < 8; i++) clients.push((await connect(t, host)).client);
  ok(await call(clients[0], 'remember_memory', { content: 'Synthetic cobalt telescope lock measurement', kind: 'fact' }));
  ok(await call(clients[0], 'capture_memory', { batchId: 'synthetic-lock-batch', messages: [
    { role: 'user', content: 'Synthetic cobalt telescope Raw lock measurement' } ] }));
  let warm;
  for (let turn = 0; turn < 12; turn++) {
    await delay(1100); warm = await context(clients[1]);
    if (warm.diagnostics.coverage.raw === 'included') break;
  }
  assert.equal(warm.diagnostics.coverage.raw, 'included');
  assert.ok(warm.value.items.some(item => item.ref.type === 'raw' || item.evidence?.some(e => e.ref.type === 'raw')),
    'contention measurement must warm actual retained Raw');
  for (const client of clients.slice(1)) await context(client);
  // Include dispatch delay: a synchronous A write can block even this
  // in-process client's turn before B-H reach callTool(). Both cells use
  // the same write-first batch and the same shared dispatch timestamp.
  const measure = start => Promise.all(clients.slice(1).map(async client => {
    let diagnostics, code, failed = false;
    try {
      const response = await client.callTool({ name: 'read_memory_context', arguments: query });
      const result = JSON.parse(response.content[0].text);
      failed = !result.ok; code = result.error?.code;
      diagnostics = response._meta?.['ink.cairn/context-read-diagnostics'];
    } catch { failed = true; code = 'transport_error'; }
    return { latencyMs: performance.now() - start,
      partial: failed || diagnostics?.coverage?.raw === 'partial' || diagnostics?.stops?.deadline,
      rawPartial: diagnostics?.coverage?.raw === 'partial', failed, storageBusy: code === 'storage_busy' };
  }));
  const baseline = [];
  const writeInput = { content: 'Synthetic cobalt telescope timing write', kind: 'fact' };
  for (let i = 0; i < 3; i++) {
    const start = performance.now(), write = call(clients[0], 'remember_memory', writeInput);
    baseline.push(...await measure(start)); ok(await write);
  }
  const { exited } = await holdWriteLock(t, path, holdMs);
  // remember_memory has no caller-supplied budget: the A4 default is 5000ms.
  const deadlineMs = 5000, granularityMs = 256;
  const start = performance.now(), write = call(clients[0], 'remember_memory', writeInput)
    .then(result => ({ result, elapsedMs: performance.now() - start }));
  const locked = await measure(start), { result: written, elapsedMs } = await write;
  const [code, signal] = await exited; assert.equal(code, 0); assert.equal(signal, null);
  const stats = samples => ({ reads: samples.length,
    p95Ms: [...samples].sort((a,b) => a.latencyMs-b.latencyMs)[Math.ceil(samples.length * .95)-1].latencyMs,
    partials: samples.filter(sample => sample.partial).length, partialRate: samples.filter(sample => sample.partial).length / samples.length,
    rawPartials: samples.filter(sample => sample.rawPartial).length, failures: samples.filter(sample => sample.failed).length,
    storageBusy: samples.filter(sample => sample.storageBusy).length });
  const single = stats(baseline), held = stats(locked);
  t.diagnostic('A4 ' + JSON.stringify({ connections: clients.length, holdMs, deadlineMs,
    baseline: single, locked: held, ratio: held.p95Ms / single.p95Ms, writeMs: elapsedMs,
    writeOk: written.ok, writeBusy: written.error?.code === 'storage_busy' }));
  assert.ok(held.p95Ms <= 2 * single.p95Ms, 'A4 B-H read p95 must stay within 2x unlocked baseline');
  assert.ok(held.partialRate <= single.partialRate, 'A4 locked reads must not increase the partial rate');
  assert.equal(held.failures, 0, 'A4 every B-H read must succeed under the external write lock');
  assert.ok(elapsedMs <= deadlineMs + granularityMs, 'A4 write must finish inside its original deadline plus one back-off granularity');
  if (!written.ok || holdMs > deadlineMs) {
    assert.equal(written.ok, false, 'A4 lock beyond the deadline must refuse the write');
    assert.equal(written.error.code, 'storage_busy', 'A4 deadline exhaustion must return the named busy code');
    assert.equal(written.error.retryable, true, 'A4 busy refusal must remain retryable');
  }
  if (holdMs > deadlineMs) assert.ok(elapsedMs >= deadlineMs - granularityMs,
    'A4 write must use its budget instead of failing at the native short timeout');
  else if (written.ok) assert.ok(elapsedMs >= holdMs - granularityMs,
    'A4 successful write must wait asynchronously for the external lock release');
  // STOPPED: the engine has no diagnostic seam at this revision. This is the
  // proposed adapter observation, deliberately a required regression guard.
  assert.equal(typeof host.inspectTransactions, 'function', 'A4 requires an engine-owned transaction-state seam');
  const states = host.inspectTransactions();
  assert.ok(states.length > 0, 'A4 transaction diagnostics must cover the owned connections');
  for (const state of states) {
    assert.equal(state.isOpen, true, 'A4 contention must leave every engine connection open');
    assert.equal(state.isTransaction, false, 'A4 contention must leave no engine connection mid-transaction');
  }
  for (const client of clients) await context(client);
  ok(await call(clients[0], 'remember_memory', { content: 'Synthetic post-contention write', kind: 'fact' }));
});
