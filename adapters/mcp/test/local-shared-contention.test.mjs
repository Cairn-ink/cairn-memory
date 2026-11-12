import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { rationaleModel } from '../../../core/testing/rationale-model.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { createLocalSharedRuntime } from '../local-shared-runtime.mjs';
import { ns, counter, query, ok, connect, call, context } from './local-shared-support.mjs';

test('A4 measure B-H reads while A waits on a three-second external canonical write lock', { timeout: 60000 }, async t => {
  const w = createTestWorkspace(t), path = join(w.path, 'synthetic-contention.sqlite');
  const host = createLocalSharedRuntime({ path, namespace: ns, contextCounter: counter, model: rationaleModel(), captureQualification: 'source-bound-v2' });
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
  // This is another process using the same SQLite library, never a raw fd.
  const child = spawn(process.execPath, ['--input-type=module', '-e',
    "import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync(process.argv[1]); db.exec('BEGIN IMMEDIATE'); process.stdout.write('locked\\n'); setTimeout(() => { db.exec('ROLLBACK'); db.close(); }, 3000);", path],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await exited; });
  const [ready] = await once(child.stdout, 'data'); assert.equal(ready.toString(), 'locked\n');
  const start = performance.now(), write = call(clients[0], 'remember_memory', writeInput);
  const locked = await measure(start), written = await write;
  const [code, signal] = await exited; assert.equal(code, 0); assert.equal(signal, null);
  const stats = samples => ({ reads: samples.length,
    p95Ms: [...samples].sort((a,b) => a.latencyMs-b.latencyMs)[Math.ceil(samples.length * .95)-1].latencyMs,
    partials: samples.filter(sample => sample.partial).length, partialRate: samples.filter(sample => sample.partial).length / samples.length,
    rawPartials: samples.filter(sample => sample.rawPartial).length, failures: samples.filter(sample => sample.failed).length,
    storageBusy: samples.filter(sample => sample.storageBusy).length });
  const single = stats(baseline), held = stats(locked);
  const stalled = held.p95Ms > 2 * single.p95Ms || held.partialRate > single.partialRate;
  t.diagnostic('A4 ' + JSON.stringify({ baseline: single, locked: held, ratio: held.p95Ms / single.p95Ms, stalled,
    writeOk: written.ok, raw: 'enabled; warmed included before measurement',
    action: stalled ? 'owner decision required; canonical fallback not implemented' : 'no stall observed' }));
  ok(written);
});
