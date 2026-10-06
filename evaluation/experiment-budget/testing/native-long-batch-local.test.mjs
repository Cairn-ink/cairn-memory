// Registered installed-native regression, synthetic fake provider only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { dirname } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkedMem0NativeArtifact, inspectMem0NativeArtifact } from '../mem0-native-artifact.mjs';
import { mem0NativeConfiguration } from '../mem0-native-gateway.mjs';
import { runNativeGatewayKernel } from '../mem0-native-runtime.mjs';
import { nativeHttpTimeoutFixture } from './native-http-timeout-fixture.mjs';

test('NLB1 synthetic long-batch allowance rejects unbounded or non-integer counts', () => {
  for (const generationBatchCount of [-1, 0, 55, 1.5, '54', NaN]) {
    assert.throws(() => nativeHttpTimeoutFixture(null, { generationBatchCount }),
      { code: 'ERR_ASSERTION' });
  }
});

for (let repeat = 1; repeat <= 3; repeat++) {
  test(`NLB2 installed native receives large16 embedding and persists/searches repeat${repeat}`, async t => {
    assert.ok(process.env.CAIRN_MEM0_NATIVE_VENV_ROOT && process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT,
      'explicit pinned synthetic native roots required');
    const artifact = inspectMem0NativeArtifact({ venvRoot: process.env.CAIRN_MEM0_NATIVE_VENV_ROOT,
      pythonRoot: process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT });
    const configuration = mem0NativeConfiguration({ topK: 6, threshold: 0,
      childTimeoutMs: 3_600_000, httpTimeoutMs: 60_000 });
    const routes = [], errors = [], lengths = [];
    let caseRoot, zeroByteWrites = 0;
    const originalServer = http.createServer;
    t.mock.method(http, 'createServer', function(...args) {
      const server = originalServer.apply(this, args);
      server.on('connection', socket => {
        const write = socket.write;
        socket.write = function(chunk, ...values) {
          if ((typeof chunk === 'string' || Buffer.isBuffer(chunk)) && chunk.length === 0) zeroByteWrites++;
          return write.call(this, chunk, ...values);
        };
      });
      server.once('listening', () => { caseRoot = dirname(server.address()); });
      server.on('request', (request, response) => {
        const original = response.writeHead;
        response.writeHead = function(status, headers) {
          lengths.push(headers?.['content-length']);
          return original.apply(this, arguments);
        };
      });
      server.on('clientError', error => {
        const code = Object.getOwnPropertyDescriptor(error, 'code')?.value;
        errors.push(code === 'EPIPE' ? 'EPIPE' : 'other');
      });
      return server;
    });
    const fixture = nativeHttpTimeoutFixture(t, { artifact, configuration,
      fetchImpl: async (url, options) => {
        const body = JSON.parse(options.body), embedding = url.endsWith('/embeddings');
        routes.push({ route: embedding ? 'embedding' : 'chat',
          itemCount: embedding ? body.input.length : 16 });
        return Response.json(embedding ? { object: 'list', model: 'text-embedding-3-small',
          usage: { prompt_tokens: body.input.length, total_tokens: body.input.length },
          data: body.input.map((_, index) => ({ object: 'embedding', index,
            embedding: Array.from({ length: 1536 }, (_, dimension) =>
              Math.sin(dimension + index + 1) * 0.5) })) }
          : { object: 'chat.completion', model: 'gpt-4.1-mini-2025-04-14',
            usage: { prompt_tokens: 64, completion_tokens: 256, total_tokens: 320 },
            choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant',
              content: JSON.stringify({ memory: Array.from({ length: 16 }, (_, index) =>
                ({ text: `synthetic bounded fact batch 1 item ${index + 1}` })) }) } }] });
      } });
    const result = await fixture.guard.withCaseScope(fixture.capability.schedule[0], handle =>
      runNativeGatewayKernel({ artifact, roots: checkedMem0NativeArtifact(artifact),
        configuration: configuration.configuration,
        childFile: fileURLToPath(new URL('./mem0-native-child.py', import.meta.url)),
        guard: fixture.guard, handle,
        input: { batches: [[{ role: 'user', content: 'synthetic distinct evidence batch 1' }]],
          query: 'synthetic bounded facts?' }, scope: { caseId: fixture.capability.schedule[0].caseId } }));
    assert.equal(result.status, 'completed');
    assert.equal(result.value.status, 'completed');
    assert.equal(result.value.value.verifiedAddRecords, 16);
    assert.ok(result.value.value.results.length > 0);
    assert.deepEqual(routes, [{ route: 'embedding', itemCount: 1 }, { route: 'chat', itemCount: 16 },
      { route: 'embedding', itemCount: 16 }, { route: 'embedding', itemCount: 1 }]);
    assert.equal(Math.max(...lengths), 494943, 'actual guard-normalized native Content-Length');
    assert.deepEqual(errors, [], 'all production clientError handling remains enabled');
    assert.equal(zeroByteWrites, 0, 'no redundant zero-byte response finishing write');
    assert.equal(fixture.guard.isHalted(), false);
    assert.equal(fixture.guard.attempts().length, 4);
    assert.ok(fixture.guard.attempts().every(row => row.outcome === 'succeeded'
      && Number.isSafeInteger(row.actualMicroUsd) && row.transportTermination === 'response'));
    assert.ok(fixture.guard.getState().attempts.every(row => row.outcome !== null));
    assert.equal(fs.existsSync(caseRoot), false, 'real default kernel verified group/reap/root cleanup');
  });
}
