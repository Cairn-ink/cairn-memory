import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createOpenAIModel } from '../../../adapters/openai/index.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';
import { createExperimentBudget } from '../../experiment-budget/index.mjs';
import { createExperimentRequestGuard } from '../../experiment-budget/request-guard.mjs';
import { experimentPolicy } from '../session.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';

for (const stalls of [false, true]) {
  test(`N22B/H real adapter and guarded fake HTTP ${stalls ? 'abort with conservative settlement' : 'complete beyond the default cap'}`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const workspace = createTestWorkspace(t, { prefix: 'cairn-call-http-' });
    const ledger = { directory: join(workspace.path, 'ledger'), runId: randomUUID(),
      limitMicroUsd: 1_000_000, requestCap: 10 };
    createExperimentBudget(ledger).close();
    let startCount, startGeneration, releaseLate;
    const counting = new Promise(resolve => { startCount = resolve; });
    const generating = new Promise(resolve => { startGeneration = resolve; });
    const output = model => Response.json({ id: 'resp_synthetic', object: 'response', model,
      status: 'completed', error: null, incomplete_details: null,
      output: [{ id: 'msg_synthetic', type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: '{"items":[]}', annotations: [] }] }],
      usage: { input_tokens: 100, output_tokens: 5, total_tokens: 105 } });
    const guard = createExperimentRequestGuard({ ledger, policy: experimentPolicy(), fetchImpl: (url, request) => {
      if (url.endsWith('/input_tokens')) {
        startCount(); return new Promise(resolve => setTimeout(() => resolve(Response.json({
          object: 'response.input_tokens', input_tokens: 100 })), 10_000));
      }
      startGeneration(); const model = JSON.parse(request.body).model;
      return new Promise(resolve => {
        releaseLate = () => resolve(output(model));
        if (!stalls) setTimeout(releaseLate, 40_000);
      });
    } });
    workspace.defer(() => guard.close());
    const diagnostics = [];
    const model = createOpenAIModel({ apiKey: 'synthetic-only', fetchImpl: guard.cairnFetch,
      onDiagnostic: event => diagnostics.push(event) });
    const path = join(workspace.path, 'memory.sqlite');
    const core = openMemoryCore({ path, model, modelCallTimeoutMs: 60_000 });
    workspace.defer(() => core.close());
    const db = new DatabaseSync(path); workspace.defer(() => db.close());
    const pending = core.capture({ namespace: { ownerId: 'synthetic', scope: 'personal', projectId: null },
      client: 'synthetic', eventId: 'event', sessionId: 'session',
      messages: [{ id: 'message', role: 'user', content: 'Synthetic train preference.' }] });
    await counting; t.mock.timers.tick(10_000); await generating;
    t.mock.timers.tick(stalls ? 50_000 : 40_000);
    const result = await pending; await setImmediate();
    if (stalls) {
      assert.deepEqual(result, { ok: false, error: { code: 'model_timeout', retryable: false } });
      assert.deepEqual(diagnostics.slice(-2).sort((a, b) => a.layer.localeCompare(b.layer)), [
        { version: 1, stage: 'extract', layer: 'adapter', reason: 'model_cancelled' },
        { version: 1, stage: 'extract', layer: 'core_call', reason: 'model_timeout' },
      ]);
      assert.equal(guard.getState().attempts.at(-1).outcome, 'unknown');
      assert.equal(guard.getState().attempts.at(-1).actualMicroUsd, null);
      const before = guard.getState().attempts; releaseLate(); await setImmediate();
      assert.deepEqual(guard.getState().attempts, before);
    } else {
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(guard.getState().attempts.every(attempt => attempt.outcome === 'succeeded'), true);
    }
    assert.equal(guard.getState().attempts.length, 2);
    assert.equal(db.prepare('SELECT count(*) n FROM memories').get().n, 0);
  });
}
