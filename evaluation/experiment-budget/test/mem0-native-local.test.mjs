// Explicit LOCAL native gate. Missing installed prerequisites fail, never skip.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { dirname } from 'node:path';
import readline from 'node:readline';
import test from 'node:test';
import { checkedMem0NativeArtifact, inspectMem0NativeArtifact } from '../mem0-native-artifact.mjs';
import { mem0NativeConfiguration, runMem0NativeCase } from '../mem0-native-gateway.mjs';
import { bubblewrapArguments, runNativeGatewayKernel } from '../mem0-native-runtime.mjs';
import { nativeFakeProvider, nativeFixture } from './mem0-native-fixture.mjs';

function installed() {
  const venvRoot = process.env.CAIRN_MEM0_NATIVE_VENV_ROOT;
  const pythonRoot = process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT;
  assert.ok(venvRoot && pythonRoot, 'explicit pinned local roots required');
  return inspectMem0NativeArtifact({ venvRoot, pythonRoot });
}

function configured() { return mem0NativeConfiguration({ topK: 3, threshold: 0,
  childTimeoutMs: 60_000, httpTimeoutMs: 10_000 }); }

const input = { batches: [[{ role: 'user', content: 'Synthetic memory fact.' }]],
  query: 'Synthetic memory fact?' };
const call = (f, artifact, configuration) => f.guard.withCaseScope(f.capability.schedule[0], handle =>
  runMem0NativeCase({ artifact, configuration, guard: f.guard, handle, input }));
const embeddingResponse = count => ({ object: 'list', model: 'text-embedding-3-small',
  usage: { prompt_tokens: 1, total_tokens: 1 },
  data: Array.from({ length: count }, (_, index) => ({ object: 'embedding', index,
    embedding: Array.from({ length: 1536 }, (_, dimension) => dimension === 0 ? 1 : 0) })) });
const chatResponse = (content, usage = { prompt_tokens: 1, completion_tokens: 1,
  total_tokens: 2 }) => ({ object: 'chat.completion', model: 'gpt-4.1-mini-2025-04-14',
  usage, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }] });

test('Y14 real pinned Mem0 add/get/search over contained UDS, fake provider only', async t => {
  const artifact = installed();
  const configuration = configured();
  const fake = nativeFakeProvider();
  const f = nativeFixture(t, { artifact, configuration, httpTimeoutMs: 10_000,
    fetchImpl: fake.fetchImpl });
  try {
    const result = await call(f, artifact, configuration);
    assert.equal(result.status, 'completed');
    assert.equal(result.value.status, 'completed');
    assert.equal(result.value.value.version, 'cairn-mem0-native-result-v1');
    assert.equal(result.value.value.verifiedAddRecords, 1);
    assert.equal(result.value.value.results.length, 1);
    assert.ok(fake.requests.some(request => request.route === 'chat'));
    assert.ok(fake.requests.some(request => request.route === 'embedding'));
    assert.equal(f.guard.attempts().filter(attempt => attempt.outcome === null).length, 0);
    assert.equal(f.guard.isHalted(), false);
  } finally { f.guard.close(); }
});

test('Y14 native batch 500 then singleton fallback has distinct priced physical attempts', async t => {
  const artifact = installed();
  const configuration = configured();
  const requests = [];
  const f = nativeFixture(t, { artifact, configuration, httpTimeoutMs: 10_000,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      requests.push({ route: url.endsWith('/embeddings') ? 'embedding' : 'chat', body });
      if (url.endsWith('/embeddings')) {
        if (body.input.length === 2) return new Response('{"error":"synthetic batch 500"}',
          { status: 500 });
        return Response.json(embeddingResponse(body.input.length));
      }
      return Response.json(chatResponse(JSON.stringify({ memory: [
        { text: 'Synthetic first fact.' }, { text: 'Synthetic second fact.' }] })));
    } });
  try {
    const result = await call(f, artifact, configuration);
    assert.equal(result.status, 'completed');
    assert.equal(result.value.status, 'completed');
    assert.equal(result.value.value.verifiedAddRecords, 2);
    assert.ok(requests.some(request => request.route === 'embedding'
      && request.body.input.length === 2));
    const attempts = f.guard.attempts();
    assert.equal(attempts.filter(attempt => attempt.outcome === 'failed').length, 1);
    assert.ok(attempts.filter(attempt => attempt.stage === 'mem0-embedding'
      && attempt.outcome === 'succeeded').length >= 3);
    assert.equal(attempts.some(attempt => attempt.outcome === null), false);
    assert.equal(f.guard.isHalted(), false);
  } finally { f.guard.close(); }
});

test('Y14 real native priced invalid chat payload seals locally and next arm remains usable',
  async t => {
    const artifact = installed();
    const configuration = configured();
    const f = nativeFixture(t, { artifact, configuration, httpTimeoutMs: 10_000,
      fetchImpl: async (url, options) => url.endsWith('/embeddings')
        ? Response.json(embeddingResponse(JSON.parse(options.body).input.length))
        : Response.json(chatResponse('{"memory":"invalid"}')) });
    try {
      const result = await call(f, artifact, configuration);
      assert.equal(result.status, 'failed');
      assert.equal(result.reason, 'invalid_payload');
      assert.equal(f.guard.isHalted(), false);
      assert.deepEqual(f.guard.attempts().map(attempt => attempt.outcome),
        ['succeeded', 'failed']);
      assert.equal(f.guard.attempts()[1].actualMicroUsd, 3);
      const next = await f.guard.withCaseScope(f.capability.schedule[1], async () => 'next');
      assert.equal(next.status, 'completed');
    } finally { f.guard.close(); }
  });

test('Y14 real native malformed usage halts globally; no later arm', async t => {
  const artifact = installed();
  const configuration = configured();
  const f = nativeFixture(t, { artifact, configuration, httpTimeoutMs: 10_000,
    fetchImpl: async (url, options) => url.endsWith('/embeddings')
      ? Response.json(embeddingResponse(JSON.parse(options.body).input.length))
      : Response.json(chatResponse('{"memory":[]}', null)) });
  try {
    await assert.rejects(call(f, artifact, configuration), { code: 'callback_failed' });
    assert.equal(f.guard.isHalted(), true);
    assert.deepEqual(f.guard.attempts().map(attempt => attempt.outcome),
      ['succeeded', 'unknown']);
    await assert.rejects(f.guard.withCaseScope(f.capability.schedule[1], async () => 'denied'),
      { code: 'paid_work_halted' });
  } finally { f.guard.close(); }
});

test('Y14 live child revocation is locally sealed/reaped before next arm', async t => {
  const artifact = installed();
  const configuration = configured();
  const f = nativeFixture(t, { artifact, configuration, httpTimeoutMs: 10_000,
    fetchImpl: () => assert.fail('revoked pre-dispatch child reached provider') });
  try {
    const result = await f.guard.withCaseScope(f.capability.schedule[0], async handle => {
      const work = runMem0NativeCase({ artifact, configuration, guard: f.guard, handle, input });
      setTimeout(() => handle.revoke(), 30);
      return work;
    });
    assert.equal(result.status, 'failed');
    assert.equal(result.reason, 'cancelled');
    assert.equal(f.guard.isHalted(), false);
    assert.equal(f.guard.attempts().length, 0);
    const next = await f.guard.withCaseScope(f.capability.schedule[1], async () => 'next');
    assert.equal(next.status, 'completed');
  } finally { f.guard.close(); }
});

test('Y14 short native watchdog reaps child with large synthetic piped input', async t => {
  const artifact = installed();
  const configuration = mem0NativeConfiguration({ topK: 3, threshold: 0,
    childTimeoutMs: 1, httpTimeoutMs: 10_000 });
  const f = nativeFixture(t, { artifact, configuration, httpTimeoutMs: 10_000,
    fetchImpl: () => assert.fail('short watchdog reached provider') });
  try {
    const result = await f.guard.withCaseScope(f.capability.schedule[0], handle =>
      runMem0NativeCase({ artifact, configuration, guard: f.guard, handle,
        input: { batches: [[{ role: 'user', content: 'x'.repeat(256 * 1024) }]],
          query: 'synthetic question' } }));
    assert.equal(result.status, 'failed');
    assert.equal(result.reason, 'cancelled');
    assert.equal(f.guard.isHalted(), false);
    assert.equal(f.guard.attempts().length, 0);
    const next = await f.guard.withCaseScope(f.capability.schedule[1], async () => 'next');
    assert.equal(next.status, 'completed');
  } finally { f.guard.close(); }
});

test('Y16 actual kernel kills an owned bwrap group before blocked startup can orphan init', async t => {
  const artifact = installed();
  const roots = checkedMem0NativeArtifact(artifact);
  const configuration = configured();
  const f = nativeFixture(t, { artifact, configuration, httpTimeoutMs: 10_000,
    fetchImpl: () => assert.fail('blocked startup reached provider') });
  const childFile = new URL('../testing/mem0-native-child.py', import.meta.url).pathname;
  const pinFile = new URL('../testing/mem0-native-startup-pidfd.py', import.meta.url).pathname;
  const signals = [];
  let child, helper, helperClosed, helperLines, currentHandle, caseRoot;
  let childClosed = false;
  let readyResolve, readyReject;
  const startupReady = new Promise((resolve, reject) => {
    readyResolve = resolve; readyReject = reject;
  });
  const bounded = (promise, milliseconds, code) => {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(code)), milliseconds);
    })]).finally(() => clearTimeout(timer));
  };
  const helperLine = async () => {
    const next = await bounded(helperLines.next(), 3_000, 'pidfd_helper_timeout');
    if (next.done) throw new Error('pidfd_helper_closed');
    return JSON.parse(next.value);
  };
  const startChild = ({ socket, store }) => {
    caseRoot = dirname(socket);
    const args = bubblewrapArguments({ roots, childFile, socket, store });
    const separator = args.lastIndexOf('--');
    const interpreter = args[separator + 1];
    args.splice(separator + 1, args.length, interpreter, '-I', '-B', '-c',
      'import sys; sys.stdin.buffer.read()');
    args.splice(separator, 0, '--info-fd', '3', '--userns-block-fd', '4');
    child = spawn('bwrap', args, { env: {}, detached: true,
      stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'] });
    child.once('close', () => { childClosed = true; });
    let info = '';
    child.stdio[3].setEncoding('utf8');
    child.stdio[3].on('data', chunk => { info += chunk; });
    child.stdio[3].once('end', async () => {
      try {
        const reported = JSON.parse(info)['child-pid'];
        assert.ok(Number.isSafeInteger(reported) && reported > 0);
        helper = spawn('/usr/bin/python3', ['-I', '-B', pinFile,
          String(reported), String(child.pid), caseRoot, childFile],
        { env: { PATH: '/usr/bin:/bin', PYTHONDONTWRITEBYTECODE: '1' },
          stdio: ['pipe', 'pipe', 'pipe'] });
        helperClosed = once(helper, 'close');
        helperLines = readline.createInterface({ input: helper.stdout })[Symbol.asyncIterator]();
        const ready = await helperLine();
        assert.equal(ready.ready?.pid, reported);
        assert.equal(ready.ready?.ppid, child.pid);
        readyResolve();
      } catch (error) { readyReject(error); }
    });
    child.once('error', readyReject);
    return child;
  };
  const stopChild = (owned, signal) => {
    signals.push(signal);
    process.kill(-owned.pid, signal);
  };
  let scopeWork;
  let pinned = false;
  let observed = null;
  let closeBeforeCleanup = false;
  let cleanupResult = null;
  let scopeResult;
  try {
    scopeWork = f.guard.withCaseScope(f.capability.schedule[0], handle => {
      currentHandle = handle;
      return runNativeGatewayKernel({ artifact, roots, configuration: configuration.configuration,
        childFile, guard: f.guard, handle,
        input: { batches: [[{ role: 'user', content: 'Synthetic.' }]], query: 'Synthetic?' },
        scope: { caseId: f.capability.schedule[0].caseId } }, { startChild, stopChild });
    });
    await bounded(startupReady, 5_000, 'blocked_startup_not_ready');
    pinned = true;
    currentHandle.revoke();
    await new Promise(resolve => setTimeout(resolve, 500));
    helper.stdin.write('probe\n');
    observed = await helperLine();
    closeBeforeCleanup = childClosed;
  } finally {
    try {
      if (pinned) {
        helper.stdin.write('cleanup\n');
        cleanupResult = await helperLine();
      }
      if (helper) {
        helper.stdin.end();
        await bounded(helperClosed, 3_000, 'pidfd_helper_unclosed');
      }
      child?.stdio[4].end();
      if (scopeWork) scopeResult = await bounded(scopeWork, 12_000,
        'kernel_startup_cleanup_timeout');
    } finally {
      f.guard.close();
    }
  }
  assert.equal(scopeResult.status, 'failed');
  assert.equal(scopeResult.reason, 'cancelled');
  assert.equal(cleanupResult?.cleanup, 'already_gone',
    'test-only pidfd cleanup must not repair a production cancellation');
  assert.equal(observed?.probe, null, 'namespace init must be gone before test cleanup');
  assert.equal(closeBeforeCleanup, true, 'bwrap stdio must close before test cleanup');
  let groupGone = false;
  try { process.kill(-child.pid, 0); }
  catch (error) { if (error?.code === 'ESRCH') groupGone = true; else throw error; }
  assert.equal(groupGone, true, 'owned numeric group must be absent after close');
  assert.deepEqual(signals, ['SIGKILL']);
});
