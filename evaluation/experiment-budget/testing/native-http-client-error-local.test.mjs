// Installed native/httpx sustained healthy control; synthetic fake provider only.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { dirname } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkedMem0NativeArtifact, inspectMem0NativeArtifact } from '../mem0-native-artifact.mjs';
import { mem0NativeConfiguration } from '../mem0-native-gateway.mjs';
import { bubblewrapArguments, runNativeGatewayKernel } from '../mem0-native-runtime.mjs';
import { nativeFakeProvider } from '../test/mem0-native-fixture.mjs';
import { nativeHttpTimeoutFixture } from './native-http-timeout-fixture.mjs';

test('NHC4 pinned native/httpx sustained six-batch healthy reconnect control', async t => {
  assert.ok(process.env.CAIRN_MEM0_NATIVE_VENV_ROOT && process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT,
    'explicit pinned synthetic native roots required');
  const artifact = inspectMem0NativeArtifact({ venvRoot: process.env.CAIRN_MEM0_NATIVE_VENV_ROOT,
    pythonRoot: process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT });
  const configuration = mem0NativeConfiguration({ topK: 1, threshold: 0,
    childTimeoutMs: 60_000, httpTimeoutMs: 10_000 });
  const fake = nativeFakeProvider();
  const fixture = nativeHttpTimeoutFixture(t, { artifact, configuration, fetchImpl: fake.fetchImpl });
  let child, childClosed = false, childExited = false, caseRoot;
  try {
    const result = await fixture.guard.withCaseScope(fixture.capability.schedule[0], handle =>
      runNativeGatewayKernel({ artifact, roots: checkedMem0NativeArtifact(artifact),
        configuration: configuration.configuration,
        childFile: fileURLToPath(new URL('./mem0-native-child.py', import.meta.url)),
        guard: fixture.guard, handle,
        input: { batches: Array.from({ length: 6 }, () => [{ role: 'user', content: 'Synthetic memory fact.' }]),
          query: 'Synthetic memory fact?' }, scope: { caseId: fixture.capability.schedule[0].caseId } }, {
        startChild(settings) {
          caseRoot = dirname(settings.socket);
          child = spawn('bwrap', bubblewrapArguments(settings), {
            env: {}, stdio: ['pipe', 'pipe', 'pipe'], detached: true, windowsHide: true });
          child.once('exit', () => { childExited = true; });
          child.once('close', () => { childClosed = true; });
          return child;
        },
      }));
    const routes = fake.requests.map(request => request.route);
    t.diagnostic(JSON.stringify({ routes, requests: routes.length, halted: fixture.guard.isHalted(),
      scopeStatus: fixture.guard.caseScopeSnapshot().status, childClosed,
      localRootAbsent: !fs.existsSync(caseRoot) }));
    assert.equal(result.status, 'completed'); assert.equal(result.value.status, 'completed');
    assert.deepEqual(routes, [...Array.from({ length: 6 }, () => ['embedding', 'chat', 'embedding']).flat(), 'embedding']);
    assert.equal(routes.length, 19, 'healthy native physical requests exceed the N9 observed prefix');
    assert.equal(result.value.value.verifiedAddRecords, 1);
    assert.equal(result.value.value.results.length, 1);
    assert.equal(fixture.guard.isHalted(), false);
    assert.equal(childClosed, true); assert.equal(fs.existsSync(caseRoot), false);
    assert.throws(() => process.kill(-child.pid, 0), { code: 'ESRCH' }, 'owned OS group is gone');
    assert.equal(fixture.guard.attempts().length, 19);
    assert.ok(fixture.guard.attempts().every(attempt => attempt.outcome === 'succeeded'
      && Number.isSafeInteger(attempt.actualMicroUsd) && attempt.transportTermination === 'response'));
    assert.ok(fixture.guard.getState().attempts.every(attempt => attempt.outcome !== null));
    let entered = 0;
    await fixture.guard.withCaseScope(fixture.capability.schedule[1], () => { entered++; });
    assert.equal(entered, 1);
  } finally {
    if (child && !childExited && !childClosed) {
      const closed = new Promise(resolve => child.once('close', resolve));
      process.kill(-child.pid, 'SIGKILL'); await closed;
    }
    fixture.guard.close();
  }
});
