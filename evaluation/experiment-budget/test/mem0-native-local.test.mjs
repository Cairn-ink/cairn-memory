// Explicit LOCAL native gate. Missing installed prerequisites fail, never skip.
import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectMem0NativeArtifact } from '../mem0-native-artifact.mjs';
import { mem0NativeConfiguration, runMem0NativeCase } from '../mem0-native-gateway.mjs';
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
