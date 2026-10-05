// Explicit installed-native synthetic diagnosis; never ordinary CI or paid HTTP.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { checkedMem0NativeArtifact, inspectMem0NativeArtifact } from '../mem0-native-artifact.mjs';
import { mem0NativeConfiguration } from '../mem0-native-gateway.mjs';
import { bubblewrapArguments, Mem0NativeRuntimeError, runNativeGatewayKernel } from '../mem0-native-runtime.mjs';
import { ExperimentRequestGuardError } from '../request-guard.mjs';
import { nativeFakeProvider } from '../test/mem0-native-fixture.mjs';
import { keepAliveReplyProbe, nativeHttpTimeoutFixture } from './native-http-timeout-fixture.mjs';

const childFile = fileURLToPath(new URL('./mem0-native-child.py', import.meta.url));
const input = { batches: [[{ role: 'user', content: 'x' }]], query: 'x' };

function installed() {
  assert.ok(process.env.CAIRN_MEM0_NATIVE_VENV_ROOT && process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT,
    'explicit pinned synthetic native roots required');
  return inspectMem0NativeArtifact({ venvRoot: process.env.CAIRN_MEM0_NATIVE_VENV_ROOT,
    pythonRoot: process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT });
}

function code(error, type, allowed) {
  if (!(error instanceof type)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
  return descriptor && 'value' in descriptor && allowed.includes(descriptor.value)
    ? descriptor.value : null;
}

function groupGone(child) {
  assert.ok(Number.isSafeInteger(child?.pid) && child.pid > 0, 'owned spawned group required');
  try { process.kill(-child.pid, 0); return false; }
  catch (error) { if (error.code === 'ESRCH') return true; throw error; }
}

async function probe(t, mode) {
  const closeResume = mode === 'close-resume';
  const negativeKeepAlive = mode === 'baseline-starved' || mode === 'normal-keepalive';
  const starved = mode.startsWith('starved') || mode === 'baseline-starved' || closeResume;
  const artifact = installed();
  const configuration = mem0NativeConfiguration({ topK: 1, threshold: 0,
    childTimeoutMs: mode.startsWith('starved') ? 10_000 : 20_000,
    httpTimeoutMs: mode === 'x-deadline' ? 100 : mode === 'starved-long-http' ? 20_000 : 10_000 });
  const fake = nativeFakeProvider();
  let child;
  let childExited = false;
  let childClosed = false;
  let caseRoot;
  let suspended = false;
  let helper;
  let helperClosed;
  let helperLines;
  let transportOpen = 0;
  let transportClosed = 0;
  let lastPhysicalReturnAt = null;
  const physicalWork = [];
  const keepAliveProbe = negativeKeepAlive ? keepAliveReplyProbe(t, () => caseRoot
    ? join(caseRoot, 'gateway.sock') : null) : null;
  let resumeWork;
  const fixture = nativeHttpTimeoutFixture(t, { artifact, configuration,
    fetchImpl: (url, options) => {
      const physical = (async () => {
      transportOpen += 1;
      try {
        if (starved && !suspended) {
          assert.ok(Number.isSafeInteger(child?.pid) && child.pid > 0 && !childExited && !childClosed,
            'only the exact live owned native group may be paused');
          helper = spawn('/usr/bin/python3', ['-I', '-B',
            fileURLToPath(new URL('./native-http-timeout-pidfd.py', import.meta.url)),
            String(child.pid), join(process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT, 'bin/python3.11'),
            join(process.env.CAIRN_MEM0_NATIVE_VENV_ROOT, 'bin/python'), caseRoot, childFile],
          { env: {}, stdio: ['pipe', 'pipe', 'pipe'] });
          helperClosed = once(helper, 'close');
          helperLines = readline.createInterface({ input: helper.stdout })[Symbol.asyncIterator]();
          const stopped = await helperLines.next();
          assert.equal(stopped.done, false, 'pidfd helper authenticated exact owned interpreter');
          assert.deepEqual(JSON.parse(stopped.value), { stopped: true });
          suspended = true;
          if (closeResume) {
            resumeWork = (async () => {
              await new Promise(resolve => setTimeout(resolve, 8_000));
              helper.stdin.write('resume\n');
              const resumed = await helperLines.next();
              assert.deepEqual(JSON.parse(resumed.value), { resumed: true });
            })();
            resumeWork.catch(() => {});
          }
        }
        if (mode === 'x-deadline') await new Promise(resolve => setTimeout(resolve, 300));
        return await fake.fetchImpl(url, options);
      } finally {
        lastPhysicalReturnAt = performance.now();
        transportOpen -= 1;
        transportClosed += 1;
      }
      })();
      physicalWork.push(physical);
      return physical;
    } });
  assert.equal(fixture.benchmarkExtension.version, 'benchmark-budget-v3');
  let nativeCode = null;
  let guardCode = null;
  let result = null;
  const started = performance.now();
  try {
    try {
      result = await fixture.guard.withCaseScope(fixture.capability.schedule[0], async handle => {
        const snapshot = handle.snapshot();
        const scope = { ordinal: snapshot.ordinal, phase: snapshot.phase, arm: snapshot.arm,
          caseId: fixture.capability.schedule[snapshot.ordinal].caseId };
        try {
          return await runNativeGatewayKernel({ artifact, roots: checkedMem0NativeArtifact(artifact),
            configuration: configuration.configuration, childFile,
            guard: fixture.guard, handle, input, scope }, {
            startChild(settings) {
              assert.equal(child, undefined, 'one exact native child');
              caseRoot = dirname(settings.socket);
              child = spawn('bwrap', bubblewrapArguments(settings), {
                env: {}, stdio: ['pipe', 'pipe', 'pipe'], detached: true, windowsHide: true });
              child.once('exit', () => { childExited = true; });
              child.once('close', () => { childClosed = true; });
              return child;
            },
          });
        } catch (error) {
          nativeCode = code(error, Mem0NativeRuntimeError, ['native_http_timeout']);
          throw error;
        }
      });
    } catch (error) {
      guardCode = code(error, ExperimentRequestGuardError, ['callback_failed', 'paid_work_halted']);
      assert.ok(guardCode, 'only finite trusted guard closure errors are observed');
    }
    // All observations follow the accounting and kernel cleanup boundary.
    const beforeLatePhysical = fixture.guard.attempts();
    assert.equal(beforeLatePhysical.some(attempt => attempt.outcome === null), false);
    await Promise.allSettled(physicalWork);
    assert.deepEqual(fixture.guard.attempts(), beforeLatePhysical,
      'late fake physical completion cannot mutate accepted guard accounting');
    assert.equal(transportOpen, 0);
    assert.equal(transportClosed, fake.requests.length);
    assert.equal(childClosed, true);
    if (resumeWork) await resumeWork;
    if (helper) {
      helper.stdin.write('cleanup\n');
      const cleanup = await helperLines.next();
      assert.deepEqual(JSON.parse(cleanup.value), { cleanup: 'already_gone' },
        'test helper must not repair kernel child containment');
      helper.stdin.end();
      const [exitCode, signal] = await helperClosed;
      assert.equal(exitCode, 0);
      assert.equal(signal, null);
      helper = null;
    }
    assert.equal(groupGone(child), true, 'actual owned OS group is gone despite private launcher seam');
    assert.equal(existsSync(caseRoot), false, 'kernel removed socket/store only after cleanup');
    const attempts = fixture.guard.attempts();
    const current = fixture.guard.getState().attempts.slice(fixture.snapshot.requestCount);
    const projection = { mode, nativeCode, guardCode, elapsedMs: Math.round(performance.now() - started),
      sinceLastPhysicalReturnMs: lastPhysicalReturnAt === null ? null
        : Math.round(performance.now() - lastPhysicalReturnAt),
      providerTimeoutMs: configuration.configuration.httpTimeoutMs,
      localTimeoutMs: configuration.configuration.localTransportTimeoutMs,
      halted: fixture.guard.isHalted(), scope: fixture.guard.caseScopeSnapshot(),
      outcomeCount: fixture.guard.caseOutcomes().scopes.length,
      admitted: attempts.length, succeeded: attempts.filter(a => a.outcome === 'succeeded').length,
      unknown: attempts.filter(a => a.outcome === 'unknown').length,
      pending: attempts.filter(a => a.outcome === null).length,
      priced: attempts.filter(a => Number.isSafeInteger(a.actualMicroUsd)).length,
      responseTerminated: attempts.filter(a => a.transportTermination === 'response').length,
      durableTerminal: current.every(a => a.outcome !== null), childClosed,
      groupGone: true, localRootAbsent: true, transportClosed,
      negativeKeepAliveReplies: keepAliveProbe?.applied() ?? 0 };
    t.diagnostic(JSON.stringify(projection));
    assert.equal(projection.pending, 0);
    assert.equal(projection.durableTerminal, true);
    if (mode === 'baseline-starved') {
      assert.equal(nativeCode, 'native_http_timeout');
      assert.equal(guardCode, 'callback_failed');
      assert.equal(projection.halted, true);
      assert.equal(projection.scope.status, 'active');
      assert.equal(projection.scope.reason, null);
      assert.equal(projection.outcomeCount, 0);
      assert.equal(projection.admitted, 1);
      assert.equal(projection.succeeded, 1);
      assert.equal(projection.priced, 1);
      assert.equal(projection.responseTerminated, 1);
      assert.equal(projection.unknown, 0);
      assert.ok(projection.sinceLastPhysicalReturnMs >= 5_500
        && projection.sinceLastPhysicalReturnMs < 9_500,
      'completed-response idle expiry plus checked cleanup precedes configured local/provider watchdog');
      let nextEntered = false;
      await assert.rejects(fixture.guard.withCaseScope(fixture.capability.schedule[1], () => {
        nextEntered = true;
      }), { code: 'paid_work_halted' });
      assert.equal(nextEntered, false);
    } else {
      assert.equal(nativeCode, null);
      assert.equal(guardCode, null);
      assert.equal(projection.halted, false);
      const normal = mode === 'normal' || mode === 'normal-keepalive' || closeResume;
      assert.equal(result.status, normal ? 'completed' : 'failed');
      if (normal) {
        assert.equal(result.value.status, 'completed');
        assert.equal(result.value.value.verifiedAddRecords, 1);
        assert.equal(result.value.value.results.length, 1);
        if (closeResume) {
          assert.equal(keepAliveProbe, null, 'actual production header without positive shim');
          assert.ok(projection.elapsedMs >= 8_000);
        }
      } else if (mode === 'x-deadline') {
        assert.equal(result.reason, 'deadline');
        assert.equal(projection.unknown, 1);
        assert.equal(projection.priced, 0);
      } else {
        assert.equal(result.reason, 'cancelled');
        assert.equal(projection.admitted, 1);
        assert.equal(projection.succeeded, 1);
        assert.equal(projection.priced, 1);
        assert.equal(projection.unknown, 0);
        assert.ok(projection.elapsedMs >= configuration.configuration.childTimeoutMs);
      }
      let nextEntered = 0;
      await fixture.guard.withCaseScope(fixture.capability.schedule[1], () => { nextEntered += 1; });
      assert.equal(nextEntered, 1);
      if (process.env.CAIRN_NHT_EXPECT_SUCCESS === '1') {
        assert.equal(nativeCode, null, 'original RED witness: no intrinsic HTTP timeout after priced response');
      }
    }
    return structuredClone(fake.requests);
  } finally {
    // Kernel owns normal kill/reap. A failed harness must still close its exact child.
    if (child && !childExited && !childClosed && Number.isSafeInteger(child.pid) && child.pid > 0) {
      const closed = new Promise(resolve => child.once('close', resolve));
      process.kill(-child.pid, 'SIGKILL');
      await closed;
    }
    if (helper) {
      helper.stdin.end();
      await helperClosed;
    }
    if (resumeWork) await resumeWork;
    await Promise.allSettled(physicalWork);
    fixture.guard.close();
    keepAliveProbe?.restore();
  }
}

test('NHT intrinsic timeout with settled response in actual pinned native v3 kernel is prevented',
  t => probe(t, 'starved'));
test('NHT unchanged actual pinned native v3 normal control', t => probe(t, 'normal'));
test('NHT unchanged actual pinned native v3 X deadline control', t => probe(t, 'x-deadline'));
test('NHT intrinsic timeout is prevented with only permitted HTTP configuration increased',
  t => probe(t, 'starved-long-http'));
test('NHT standard completed-response closure survives eight-second starvation with exact request parity',
  async t => {
    const normal = await probe(t, 'normal-keepalive');
    const closed = await probe(t, 'close-resume');
    assert.equal(normal.length, 4);
    assert.deepEqual(closed, normal, 'pinned native request bodies/order/count are exact after reconnect');
  });
test('NHT baseline keepalive negative control reproduces authentic native HTTP timeout',
  t => probe(t, 'baseline-starved'));
